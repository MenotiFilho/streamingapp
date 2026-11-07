//! The Titles the Host has read, kept on disk (ADR-0038).
//!
//! A Title is not a page: it is one item the owner opened on purpose, and the
//! one the Continue watching row and Up next are answered from. So the Host
//! keeps every Title it reads — its metadata and its Videos — with the moment
//! it was read, where it came from, and what TMDB says about a series' run. A
//! fresh copy opens without touching the network; a stale one is answered at
//! once from the store and read again behind the client, whose revised Answer
//! is the second one (#271, #272, ADR-0038 §2).
//!
//! ## Freshness and the terms
//!
//! A running series gains episodes weekly, so its copy is fresh for a day.
//! Films and series TMDB says have ended are fresh for a month. TMDB's API
//! Terms cap holding its data at six months, so a copy that came from TMDB and
//! has not been refreshed by then is dropped whatever else it is behind.
//!
//! ## The bound
//!
//! The cache is bounded by count, oldest read first. It never evicts a Title
//! behind Watch progress or in the Library: those are the Titles the row and Up
//! next are drawn from. A cache whose every entry is protected may therefore
//! hold more than the bound, which is the lesser of the two errors.
//!
//! The store is the seam and SQL stays below it: this module decides what is
//! fresh, what is protected and what goes; [`crate::Store`] only writes it
//! down.

use std::sync::Arc;

use crate::addon::AddonId;
use crate::meta::{Title, TitleKey};
use crate::progress::TitleStub;
use crate::request::TitleRef;
use crate::store::{Store, StoreError};
use crate::tmdb::{self, Kind, NextEpisode, SeriesStatus, TmdbId};

/// The most Titles the cache holds at once, before protection.
pub const MAX_CACHED_TITLES: usize = 512;

/// How long a running series' copy stays fresh: episodes arrive weekly.
pub const RUNNING_FRESH_MILLIS: i64 = 24 * 60 * 60 * 1000;

/// How long a film's or a stopped series' copy stays fresh.
pub const OTHER_FRESH_MILLIS: i64 = 30 * 24 * 60 * 60 * 1000;

/// How long a caught-up Title's record is trusted before it is read again:
/// a week, which is how often a season gains an episode (ADR-0038 §5).
pub const CAUGHT_UP_CHECK_MILLIS: i64 = 7 * 24 * 60 * 60 * 1000;

/// The longest TMDB's API Terms allow its data to be held: six months.
pub const TMDB_CACHE_CEILING_MILLIS: i64 = 180 * 24 * 60 * 60 * 1000;

/// Where a cached Title's copy came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TitleSource {
    /// An Addon answered, and nothing met it with a TMDB record.
    Addon,
    /// TMDB answered, and no Addon did — a Discovered Title.
    Tmdb,
    /// An Addon answered and TMDB's record met it (ADR-0020).
    Both,
}

impl TitleSource {
    /// The word the store keeps it under.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Addon => "addon",
            Self::Tmdb => "tmdb",
            Self::Both => "both",
        }
    }

    /// Read the word back, or `None` where the row is not one this Host wrote.
    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "addon" => Some(Self::Addon),
            "tmdb" => Some(Self::Tmdb),
            "both" => Some(Self::Both),
            _ => None,
        }
    }

    /// Whether any of the copy is TMDB's — the data its terms cap at six
    /// months.
    pub fn holds_tmdb(self) -> bool {
        matches!(self, Self::Tmdb | Self::Both)
    }
}

/// One Title as the Host keeps it: the answer itself, and the facts the cache
/// decides on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CachedTitle {
    /// The Title exactly as it was answered, Videos and key included.
    pub title: Title,
    /// When it was read, in milliseconds since the Unix epoch.
    pub read_at: i64,
    /// Where the copy came from.
    pub source: TitleSource,
    /// What TMDB says about the series' run, where TMDB answered about one.
    pub status: Option<SeriesStatus>,
    /// The episode TMDB said comes next when this copy was read, where it named
    /// one. A hint for when the newest season is worth re-reading, not a Video:
    /// only the Title's list of Videos puts anything on the row (ADR-0038 §5).
    pub next_episode: Option<NextEpisode>,
}

impl CachedTitle {
    /// Whether this copy is the one a probe names: the same type and identity,
    /// under either spelling the cache may hold a Title by.
    ///
    /// A cache row keyed by TMDB may have been opened through an Addon's id or
    /// TMDB's, so both spellings match; a probe that names no Addon (`None`)
    /// matches the id alone, which is how a Library entry reaches a Title.
    pub(crate) fn names(&self, probe: &TitleProbe) -> bool {
        let title = &self.title;
        if probe.r#type != title.r#type {
            return false;
        }
        if probe.id == title.id && (probe.addon.is_none() || probe.addon == title.addon) {
            return true;
        }
        match &title.key {
            TitleKey::Tmdb { id } => probe.id == format!("tmdb:{id}"),
            TitleKey::Addon { addon, id } => probe.addon.as_ref() == Some(addon) && probe.id == *id,
        }
    }

    /// How long this copy stays fresh.
    pub fn fresh_for(&self) -> i64 {
        match self.status {
            Some(status) if status.is_running() => RUNNING_FRESH_MILLIS,
            _ => OTHER_FRESH_MILLIS,
        }
    }

    /// Whether the copy is still fresh at `now`.
    pub fn is_fresh(&self, now: i64) -> bool {
        !self.is_expired(now) && now.saturating_sub(self.read_at) < self.fresh_for()
    }

    /// Whether TMDB's six-month ceiling has passed, for a copy any of which is
    /// TMDB's.
    pub fn is_expired(&self, now: i64) -> bool {
        self.source.holds_tmdb() && now.saturating_sub(self.read_at) >= TMDB_CACHE_CEILING_MILLIS
    }

    /// Whether a read-ahead is owed for this copy now (#277).
    ///
    /// A Title that is not caught up follows the ordinary window: a running
    /// series after a day, a film or a stopped series after a month. A caught-up
    /// series is watched by what TMDB says about it instead (ADR-0038 §5):
    ///
    /// - an Ended or Canceled series is never read ahead — opening it still
    ///   refreshes it;
    /// - an announced next episode is looked for after a day, the rhythm TMDB
    ///   recomputes the field at;
    /// - nothing announced on a running series is looked for after a week;
    /// - an Unmapped Title has no record, so its Addon's `meta` is read weekly
    ///   whether or not it is caught up: TMDB's caught-up rules are not a
    ///   record's to make (ADR-0038 §5, #277).
    pub(crate) fn read_ahead_due(&self, caught_up: bool, now: i64) -> bool {
        let elapsed = now.saturating_sub(self.read_at);

        if matches!(self.title.key, TitleKey::Addon { .. }) {
            return elapsed >= CAUGHT_UP_CHECK_MILLIS;
        }

        if !caught_up {
            return !self.is_fresh(now);
        }

        if matches!(
            self.status,
            Some(SeriesStatus::Ended | SeriesStatus::Cancelled)
        ) {
            return false;
        }
        match self.next_episode {
            Some(_) => elapsed >= RUNNING_FRESH_MILLIS,
            None => elapsed >= CAUGHT_UP_CHECK_MILLIS,
        }
    }

    /// The newest season the cached list holds, which is the one a caught-up
    /// series with nothing announced reads again (#277). `None` for a film, and
    /// for a copy whose Videos were never numbered.
    pub(crate) fn newest_season(&self) -> Option<u32> {
        self.title
            .videos
            .iter()
            .filter_map(|video| video.season)
            .max()
    }
}

/// The newest cached copy matching a probe, where the cache holds one.
///
/// "Newest" is the copy read most recently: the same Title may be held under an
/// Addon's key and TMDB's, and the most recent read is the one that describes
/// it now. A caller with an extra condition on the copy — the list must carry a
/// particular Video — filters after this and would need its own scan.
pub(crate) fn newest_matching<'a>(
    cached: &'a [CachedTitle],
    probe: &TitleProbe,
) -> Option<&'a CachedTitle> {
    cached
        .iter()
        .filter(|held| held.names(probe))
        .max_by_key(|held| held.read_at)
}

/// One Title the cache must not evict: a card's, or the Library's.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TitleProbe {
    pub(crate) addon: Option<AddonId>,
    pub(crate) r#type: String,
    pub(crate) id: String,
}

impl TitleProbe {
    pub(crate) fn new(addon: Option<AddonId>, r#type: &str, id: &str) -> Self {
        Self {
            addon,
            r#type: r#type.to_owned(),
            id: id.to_owned(),
        }
    }

    /// The probe a Continue watching entry makes.
    pub(crate) fn from_stub(stub: &TitleStub) -> Self {
        Self::new(stub.addon().cloned(), stub.r#type(), stub.id())
    }
}

/// The Titles a cache write must leave alone.
#[derive(Debug, Default)]
pub(crate) struct TitleProtection {
    probes: Vec<TitleProbe>,
}

impl TitleProtection {
    pub(crate) fn holding(probes: Vec<TitleProbe>) -> Self {
        Self { probes }
    }

    /// Whether this cached copy is behind Watch progress or in the Library.
    ///
    /// A probe names a Title the way a card does: the Addon that supplied it
    /// (where one did), its type and its id. A cache row keyed by TMDB may have
    /// been opened through an Addon's id or TMDB's, so both spellings match;
    /// a Library probe has no Addon and matches the id alone.
    fn protects(&self, cached: &CachedTitle) -> bool {
        self.probes.iter().any(|probe| cached.names(probe))
    }
}

/// The Host's kept Titles, and the store they are written through.
pub(crate) struct TitleCache {
    store: Arc<dyn Store>,
    bound: usize,
    entries: Vec<CachedTitle>,
    /// Whether the bound is waiting for the Library to be read.
    ///
    /// The cache is loaded before the account's Library is, and a Title in the
    /// Library must never be evicted (ADR-0038 §1). So the load keeps every
    /// copy it read, and the trim waits until [`TitleCache::settle`] is handed
    /// the Library's probes. Until then a write may hold more than the bound,
    /// which is the lesser error.
    deferred: bool,
}

impl TitleCache {
    /// Load the Titles a previous run kept, dropping TMDB copies past the terms
    /// ceiling. The bound is not applied here: the Library is not known yet.
    pub(crate) fn load(store: Arc<dyn Store>, bound: usize, now: i64) -> Result<Self, StoreError> {
        let mut cache = Self {
            store,
            bound,
            entries: Vec::new(),
            deferred: true,
        };
        for cached in cache.store.read_titles()? {
            if cached.is_expired(now) {
                cache.forget(&cached.title.key);
                continue;
            }
            cache.put(cached);
        }
        Ok(cache)
    }

    /// Apply the bound now that the Titles the Library holds are known.
    ///
    /// The account's Library is read after the Host starts, so this is the one
    /// moment the trim can tell a Library-only Title from a cache entry nobody
    /// protects (ADR-0038 §1).
    pub(crate) fn settle(&mut self, now: i64, protection: &TitleProtection) {
        self.deferred = false;
        self.trim(now, protection);
    }

    /// The Titles held, as a Snapshot's Continue watching row reads them: Up
    /// next is worked out from these lists (#274).
    pub(crate) fn cached(&self) -> &[CachedTitle] {
        &self.entries
    }

    /// The cached copy for a Title opened through an Addon, where one is held
    /// and still within TMDB's terms. An expired copy is dropped as it is met.
    pub(crate) fn for_addon(
        &mut self,
        addon: &AddonId,
        asked: &TitleRef,
        now: i64,
    ) -> Option<CachedTitle> {
        let probe = TitleProbe::new(Some(addon.clone()), &asked.r#type, &asked.id);
        let index = self
            .entries
            .iter()
            .position(|cached| cached.names(&probe))?;
        self.take(index, now)
    }

    /// The cached copy for a Discovered Title, where one is held and still
    /// within TMDB's terms.
    ///
    /// Stricter than [`CachedTitle::names`] alone: the copy must be keyed by
    /// the record, because a Title an Addon happened to key `tmdb:<id>` is not
    /// TMDB's record of it.
    pub(crate) fn for_tmdb(&mut self, id: TmdbId, kind: Kind, now: i64) -> Option<CachedTitle> {
        let probe = TitleProbe::new(None, kind.as_protocol(), &tmdb::video_spelling(id, None));
        let index = self.entries.iter().position(|cached| {
            cached.title.key == TitleKey::Tmdb { id: id.0 } && cached.names(&probe)
        })?;
        self.take(index, now)
    }

    /// Keep a Title just read, replacing the copy the open was answered from
    /// where its identity moved, then evict what the bound says to. Answers
    /// whether the cache now holds a Title a Snapshot would draw differently —
    /// a new copy, or one whose content moved. Re-dating an equal copy is not a
    /// change any client can see (#277).
    pub(crate) fn keep(
        &mut self,
        cached: CachedTitle,
        replacing: Option<TitleKey>,
        protection: &TitleProtection,
        now: i64,
    ) -> bool {
        if cached.is_expired(now) {
            return false;
        }
        let changed = match self
            .entries
            .iter()
            .find(|held| held.title.key == cached.title.key)
        {
            Some(held) => held.title != cached.title,
            None => true,
        };
        let moved = replacing.as_ref().is_some_and(|old| {
            *old != cached.title.key && self.entries.iter().any(|held| &held.title.key == old)
        });
        if let Some(replacing) = replacing {
            if replacing != cached.title.key {
                self.forget(&replacing);
            }
        }
        let _ = self.store.write_title(&cached);
        self.put(cached);
        self.trim(now, protection);
        changed || moved
    }

    /// One entry by its index, dropping it where its terms have run out.
    fn take(&mut self, index: usize, now: i64) -> Option<CachedTitle> {
        if self.entries[index].is_expired(now) {
            let key = self.entries[index].title.key.clone();
            self.forget(&key);
            return None;
        }
        Some(self.entries[index].clone())
    }

    fn put(&mut self, cached: CachedTitle) {
        match self
            .entries
            .iter()
            .position(|held| held.title.key == cached.title.key)
        {
            Some(index) => self.entries[index] = cached,
            None => self.entries.push(cached),
        }
    }

    /// Drop every copy past the terms ceiling, then the oldest read until the
    /// bound holds — never a protected one. A cache still waiting for the
    /// Library to be read keeps everything: the bound is the lesser rule.
    fn trim(&mut self, now: i64, protection: &TitleProtection) {
        if self.deferred {
            return;
        }

        let expired: Vec<TitleKey> = self
            .entries
            .iter()
            .filter(|cached| cached.is_expired(now))
            .map(|cached| cached.title.key.clone())
            .collect();
        for key in expired {
            self.forget(&key);
        }

        while self.entries.len() > self.bound {
            let oldest = self
                .entries
                .iter()
                .filter(|cached| !protection.protects(cached))
                .min_by(|one, other| {
                    one.read_at
                        .cmp(&other.read_at)
                        .then_with(|| key_order(&one.title.key, &other.title.key))
                })
                .map(|cached| cached.title.key.clone());
            match oldest {
                Some(key) => {
                    self.forget(&key);
                }
                // Every entry is behind Watch progress or the Library; the
                // bound gives way rather than the rule.
                None => break,
            }
        }
    }

    /// Remove one entry, from memory and from the store.
    fn forget(&mut self, key: &TitleKey) {
        self.entries.retain(|held| &held.title.key != key);
        let _ = self.store.remove_title(key);
    }
}

/// A stable order for two keys read at the same moment.
fn key_order(one: &TitleKey, other: &TitleKey) -> std::cmp::Ordering {
    use std::cmp::Ordering;

    match (one, other) {
        (TitleKey::Addon { addon: a, id: x }, TitleKey::Addon { addon: b, id: y }) => {
            a.as_str().cmp(b.as_str()).then_with(|| x.cmp(y))
        }
        (TitleKey::Addon { .. }, TitleKey::Tmdb { .. }) => Ordering::Less,
        (TitleKey::Tmdb { .. }, TitleKey::Addon { .. }) => Ordering::Greater,
        (TitleKey::Tmdb { id: x }, TitleKey::Tmdb { id: y }) => x.cmp(y),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn addon() -> AddonId {
        AddonId::parse("com.linvo.cinemeta").expect("an Addon id")
    }

    fn cached(key: TitleKey, from_addon: Option<AddonId>, read_at: i64) -> CachedTitle {
        let id = match &key {
            TitleKey::Tmdb { id } => format!("tmdb:{id}"),
            TitleKey::Addon { id, .. } => id.clone(),
        };
        let title = Title::parse(
            r#"{"meta":{"id":"tt0903747","type":"series","name":"One"}}"#,
            from_addon.clone().unwrap_or_else(addon),
            &TitleRef::parse("series", &id).expect("a Title"),
        )
        .map(|mut title| {
            title.key = key;
            title.addon = from_addon;
            title
        })
        .expect("a Title parses");

        CachedTitle {
            title,
            read_at,
            source: TitleSource::Addon,
            status: None,
            next_episode: None,
        }
    }

    fn store() -> Arc<dyn Store> {
        Arc::new(crate::store::InMemoryStore::new())
    }

    fn unprotected() -> TitleProtection {
        TitleProtection::default()
    }

    #[test]
    fn a_caught_up_series_is_checked_on_its_records_rhythm() {
        let day = RUNNING_FRESH_MILLIS;
        let week = CAUGHT_UP_CHECK_MILLIS;
        let running = CachedTitle {
            status: Some(SeriesStatus::Running),
            ..cached(TitleKey::Tmdb { id: 1 }, None, 0)
        };
        let announced = CachedTitle {
            next_episode: Some(NextEpisode {
                season: 2,
                episode: 1,
            }),
            ..running.clone()
        };
        let ended = CachedTitle {
            status: Some(SeriesStatus::Ended),
            ..running.clone()
        };

        assert!(
            !announced.read_ahead_due(true, day - 1),
            "TMDB recomputes the announced field about once a day"
        );
        assert!(announced.read_ahead_due(true, day));
        assert!(
            !running.read_ahead_due(true, week - 1),
            "nothing announced is a week, not a day"
        );
        assert!(running.read_ahead_due(true, week));
        assert!(
            !ended.read_ahead_due(true, week * 100),
            "an Ended series is not checked again; opening it still refreshes it"
        );
        assert!(
            !ended.read_ahead_due(false, 30 * day - 1),
            "a Title that is not caught up keeps the ordinary window"
        );
        assert!(ended.read_ahead_due(false, 30 * day));

        let unmapped = cached(
            TitleKey::Addon {
                addon: addon(),
                id: "tt0903747".to_owned(),
            },
            Some(addon()),
            0,
        );
        assert!(!unmapped.read_ahead_due(true, week - 1));
        assert!(
            unmapped.read_ahead_due(true, week),
            "an Unmapped Title reads its Addon weekly"
        );
        assert!(
            !unmapped.read_ahead_due(false, week - 1),
            "and it does so even when it is not caught up: the caught-up rules are TMDB's"
        );
        assert!(
            unmapped.read_ahead_due(false, week),
            "mid-season or not, an Unmapped Title's meta is read weekly"
        );
    }

    #[test]
    fn a_running_series_is_fresh_for_a_day_and_an_ended_one_for_a_month() {
        let day = 24 * 60 * 60 * 1000;
        let running = CachedTitle {
            status: Some(SeriesStatus::Running),
            ..cached(TitleKey::Tmdb { id: 1 }, None, 0)
        };
        let ended = CachedTitle {
            status: Some(SeriesStatus::Ended),
            ..cached(TitleKey::Tmdb { id: 2 }, None, 0)
        };

        assert!(running.is_fresh(day - 1));
        assert!(!running.is_fresh(day), "a day after the read it is stale");
        assert!(ended.is_fresh(30 * day - 1));
        assert!(!ended.is_fresh(30 * day), "a month after it is stale");
    }

    #[test]
    fn a_tmdb_copy_past_six_months_is_expired_whatever_protects_it() {
        let six_months = 180 * 24 * 60 * 60 * 1000;
        let from_tmdb = CachedTitle {
            source: TitleSource::Both,
            ..cached(TitleKey::Tmdb { id: 1 }, None, 0)
        };
        let from_addon = cached(
            TitleKey::Addon {
                addon: addon(),
                id: "tt0903747".to_owned(),
            },
            Some(addon()),
            0,
        );

        assert!(!from_tmdb.is_expired(six_months - 1));
        assert!(from_tmdb.is_expired(six_months));
        assert!(
            !from_addon.is_expired(six_months * 10),
            "an Addon's copy is not TMDB's to expire"
        );
    }

    #[test]
    fn the_cache_evicts_the_oldest_read_title_at_its_bound() {
        let store = store();
        let mut cache = TitleCache::load(store, 2, 0).expect("the cache loads");

        for id in 1..=3 {
            cache.keep(
                cached(TitleKey::Tmdb { id }, None, i64::from(id)),
                None,
                &unprotected(),
                0,
            );
        }

        cache.settle(0, &unprotected());

        assert_eq!(cache.entries.len(), 2);
        assert!(
            !cache
                .entries
                .iter()
                .any(|held| held.title.key == TitleKey::Tmdb { id: 1 }),
            "the copy read longest ago went first"
        );
    }

    #[test]
    fn a_title_behind_watch_progress_or_in_the_library_is_not_evicted() {
        let store = store();
        let watched = TitleKey::Tmdb { id: 1 };
        let cache_entry = cached(watched.clone(), None, 0);
        let protection = TitleProtection::holding(vec![TitleProbe::new(
            None,
            &cache_entry.title.r#type,
            "tmdb:1",
        )]);
        let mut cache = TitleCache::load(store, 2, 0).expect("the cache loads");
        cache.keep(cache_entry, None, &protection, 0);

        for id in 2..=4 {
            cache.keep(
                cached(TitleKey::Tmdb { id }, None, i64::from(id)),
                None,
                &protection,
                0,
            );
        }

        cache.settle(0, &protection);

        assert!(
            cache.entries.iter().any(|held| held.title.key == watched),
            "the protected copy survives while unprotected ones go"
        );
        assert_eq!(cache.entries.len(), 2);
    }

    #[test]
    fn the_bound_waits_for_the_library_which_is_read_after_the_cache() {
        // Startup loads the cache before the account's Library is read. A trim
        // there would evict a Library-only Title beyond the bound; the cache
        // keeps every copy until it is told what the Library holds, then trims
        // to the bound with those Titles protected (ADR-0038 §1).
        let titles = (1..=3)
            .map(|id| cached(TitleKey::Tmdb { id }, None, i64::from(id)))
            .collect();
        let mut cache = TitleCache::load(
            Arc::new(crate::store::InMemoryStore::new().holding_titles(titles)),
            2,
            0,
        )
        .expect("the cache loads");
        assert_eq!(
            cache.entries.len(),
            3,
            "the bound is not applied before the Library is read"
        );

        let protection = TitleProtection::holding(vec![TitleProbe::new(None, "series", "tmdb:1")]);
        cache.settle(0, &protection);

        assert!(
            cache
                .entries
                .iter()
                .any(|held| held.title.key == TitleKey::Tmdb { id: 1 }),
            "the Library's Title survives the trim"
        );
        assert_eq!(cache.entries.len(), 2, "and the bound holds after it");
    }

    #[test]
    fn a_title_is_found_by_the_addon_and_id_it_was_opened_by() {
        let mut cache = TitleCache::load(store(), 4, 0).expect("the cache loads");
        let key = TitleKey::Addon {
            addon: addon(),
            id: "tt0903747".to_owned(),
        };
        cache.keep(cached(key, Some(addon()), 0), None, &unprotected(), 0);

        assert!(cache
            .for_addon(
                &addon(),
                &TitleRef::parse("series", "tt0903747").expect("a Title"),
                0
            )
            .is_some());
        assert!(
            cache
                .for_addon(
                    &AddonId::parse("org.example.other").expect("an Addon id"),
                    &TitleRef::parse("series", "tt0903747").expect("a Title"),
                    0
                )
                .is_none(),
            "another Addon's answer is not this one's"
        );
    }
}
