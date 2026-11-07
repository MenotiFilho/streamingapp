//! The Titles the Host has read, kept on disk (ADR-0038).
//!
//! A Title is not a page: it is one item the owner opened on purpose, and the
//! one the Continue watching row and Up next are answered from. So the Host
//! keeps every Title it reads — its metadata and its Videos — with the moment
//! it was read, where it came from, and what TMDB says about a series' run. A
//! fresh copy opens without touching the network; a stale one is read again
//! before it answers (#271); from #272 it will answer at once and refresh
//! behind.
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
use crate::tmdb::{self, Kind, SeriesStatus, TmdbId};

/// The most Titles the cache holds at once, before protection.
pub const MAX_CACHED_TITLES: usize = 512;

/// How long a running series' copy stays fresh: episodes arrive weekly.
pub const RUNNING_FRESH_MILLIS: i64 = 24 * 60 * 60 * 1000;

/// How long a film's or a stopped series' copy stays fresh.
pub const OTHER_FRESH_MILLIS: i64 = 30 * 24 * 60 * 60 * 1000;

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
}

impl TitleCache {
    /// Load the Titles a previous run kept, dropping TMDB copies past the terms
    /// ceiling and trimming to the bound.
    pub(crate) fn load(
        store: Arc<dyn Store>,
        bound: usize,
        now: i64,
        protection: &TitleProtection,
    ) -> Result<Self, StoreError> {
        let mut cache = Self {
            store,
            bound,
            entries: Vec::new(),
        };
        for cached in cache.store.read_titles()? {
            if cached.is_expired(now) {
                cache.forget(&cached.title.key);
                continue;
            }
            cache.put(cached);
        }
        cache.trim(now, protection);
        Ok(cache)
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
        let index = self.entries.iter().position(|cached| {
            let title = &cached.title;
            (title.addon.as_ref() == Some(addon)
                && title.r#type == asked.r#type
                && title.id == asked.id)
                || matches!(
                    &title.key,
                    TitleKey::Tmdb { id }
                        if title.r#type == asked.r#type
                            && asked
                                .id
                                .strip_prefix("tmdb:")
                                .and_then(tmdb::TmdbId::parse)
                                .is_some_and(|asked| asked.0 == *id)
                )
        })?;
        self.take(index, now)
    }

    /// The cached copy for a Discovered Title, where one is held and still
    /// within TMDB's terms.
    pub(crate) fn for_tmdb(&mut self, id: TmdbId, kind: Kind, now: i64) -> Option<CachedTitle> {
        let index = self.entries.iter().position(|cached| {
            cached.title.key == TitleKey::Tmdb { id: id.0 }
                && cached.title.r#type == kind.as_protocol()
        })?;
        self.take(index, now)
    }

    /// Keep a Title just read, replacing the copy the open was answered from
    /// where its identity moved, then evict what the bound says to.
    pub(crate) fn keep(
        &mut self,
        cached: CachedTitle,
        replacing: Option<TitleKey>,
        protection: &TitleProtection,
        now: i64,
    ) {
        if cached.is_expired(now) {
            return;
        }
        if let Some(replacing) = replacing {
            if replacing != cached.title.key {
                self.forget(&replacing);
            }
        }
        let _ = self.store.write_title(&cached);
        self.put(cached);
        self.trim(now, protection);
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
    /// bound holds — never a protected one.
    fn trim(&mut self, now: i64, protection: &TitleProtection) {
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
        }
    }

    fn store() -> Arc<dyn Store> {
        Arc::new(crate::store::InMemoryStore::new())
    }

    fn unprotected() -> TitleProtection {
        TitleProtection::default()
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
        let mut cache = TitleCache::load(store, 2, 0, &unprotected()).expect("the cache loads");

        for id in 1..=3 {
            cache.keep(
                cached(TitleKey::Tmdb { id }, None, i64::from(id)),
                None,
                &unprotected(),
                0,
            );
        }

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
        let mut cache = TitleCache::load(store, 2, 0, &protection).expect("the cache loads");
        cache.keep(cache_entry, None, &protection, 0);

        for id in 2..=4 {
            cache.keep(
                cached(TitleKey::Tmdb { id }, None, i64::from(id)),
                None,
                &protection,
                0,
            );
        }

        assert!(
            cache.entries.iter().any(|held| held.title.key == watched),
            "the protected copy survives while unprotected ones go"
        );
        assert_eq!(cache.entries.len(), 2);
    }

    #[test]
    fn a_title_is_found_by_the_addon_and_id_it_was_opened_by() {
        let mut cache = TitleCache::load(store(), 4, 0, &unprotected()).expect("the cache loads");
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
