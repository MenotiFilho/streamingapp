use std::sync::{Arc, Mutex};

use crate::action::{Action, ActionError, ValidatedAction};
use crate::addon::{Addon, AddonId, Manifest};
use crate::background::{BackgroundQueue, Job, RevisionSink, Work};
use crate::cache::CatalogCache;
use crate::clock::Clock;
use crate::device::{Device, DeviceSummary, DeviceToken};
use crate::fetcher::Fetcher;
use crate::library::LibraryCache;
use crate::meta::{self, Title, TitleKey, Video};
use crate::pairing::PairingCode;
use crate::playback::{
    ChapterStep, ChosenStream, Control, Observation, Picture, PlaybackState, Player, StreamUrl,
    Telling, TrackId, TrackKind, Unplayable,
};
use crate::preferences::FeaturedCatalog;
use crate::preview::{
    preview_ceiling, NoPreviewer, PreviewCeiling, Previewer, PREVIEW_BITRATE_GRACE_MS,
};
use crate::progress::{ContinueEntry, TitleStub, WatchProgress};
use crate::provider::Provider;
use crate::request::{ResourceRequest, TitleRef, VideoRef, META, STREAM, SUBTITLES};
use crate::response::{Answer, Response};
use crate::secret::{CredentialKind, SecretStore};
use crate::snapshot::Snapshot;
use crate::state::{Change, Persist, Protection, State};
use crate::store::{Store, StoreError};
use crate::stream::Stream;
use crate::stremio::StremioApi;
use crate::subtitles::MAX_FALLBACK_SUBTITLES;
use crate::sync::{merge, Merged, RemoteItem};
use crate::title_cache::{
    CachedTitle, TitleCache, TitleProbe, TitleProtection, MAX_CACHED_TITLES, RUNNING_FRESH_MILLIS,
};
use crate::tmdb;
use crate::view::{HostView, HostViewShared};

/// How often the Host looks for a caught-up Title whose record is now due: a
/// day, the shortest rhythm any caught-up check runs at. It is the scan that
/// makes a week pass while the Host stays open, and it is why a failing source
/// is not asked again on every tick (#277, ADR-0038 §5).
const READ_AHEAD_SCAN_MILLIS: i64 = RUNNING_FRESH_MILLIS;

/// The Host: its state, and the surface over it.
///
/// Every Action — from the window, from a remote client, from a timer — arrives
/// through [`crate::HostDoor`]'s one door, and every publication leaves as a
/// [`Response`]: the Snapshots every client is owed, and the answer only the
/// client that asked gets. [`Host::dispatch`] is the one-call form used by tests,
/// and it takes the same two paths the door does. There is no second surface
/// (ADR-0002).
///
/// The one thing that is not an Action is the Host reading its own Player
/// ([`Host::sample`]): playback moves on its own, and what the Player reports is
/// folded in where the Host's clock looks at it.
pub struct Host {
    store: Arc<dyn Store>,
    fetcher: Arc<dyn Fetcher>,
    secrets: Arc<dyn SecretStore>,
    /// Where playable candidates come from. The real Host is built with the
    /// addon protocol; a test hands in a fake (ADR-0010's questions, applied
    /// to Streams).
    provider: Arc<dyn Provider>,
    /// What plays a Stream. The real Host is built with mpv, in-process; a test
    /// hands in a fake.
    player: Arc<dyn Player>,
    /// What takes a still of a moment of the Stream, for a timeline tooltip. The
    /// real Host is built with a second, silent libmpv; a test hands in a fake,
    /// and a Host that never names one has a previewer that answers nothing
    /// (ADR-0028).
    previewer: Arc<dyn Previewer>,
    /// Whether the Stream now open may be previewed, once the Player's first
    /// report has said what it costs. [`PreviewCeiling::Waiting`] until then, and
    /// decided once per Stream: a refusal is not revisited on a later report, and
    /// nothing here is published — it is a brake, not something a client sees
    /// (ADR-0028).
    preview_gate: PreviewCeiling,
    /// When the Stream was armed, in the Host's own millis: the Stream's moment
    /// to state what it costs before an absent bitrate is refused.
    preview_since: Option<i64>,
    /// The Host's clock: the one reading of time it makes, stamped onto the
    /// Watch progress it writes (#29). A seam, like the Player, so that "most
    /// recently played" is a fact a test decides.
    clock: Arc<dyn Clock>,
    /// Where the Player puts the picture, asked of it once: a fact about the
    /// machine rather than about a Stream, and one every Snapshot carries so a
    /// client sharing the Host's window knows where the hole for it goes.
    picture: Picture,
    /// Where this Host answers remote clients on the network, told to it by the
    /// shell once the wire server has bound. A fact about this run rather than
    /// about a client, carried in every Snapshot so the window can read it out.
    serving: Option<String>,
    state: State,
    revision: u64,
    /// Pages the Addons have already answered, so that a re-request inside the
    /// Addon's own `cacheMaxAge` never reaches the network. Shared with every
    /// [`HostView`], behind a lock a question takes only to read or write one
    /// page and never across a fetch (ADR-0022).
    cache: Arc<Mutex<CatalogCache>>,
    /// Stremio's account service, where this Host was built with one (#30).
    /// `None` is a Host that cannot sync, and a Host that holds no `authKey` is
    /// one that does not: in both, nothing here is ever called.
    stremio: Option<Arc<dyn StremioApi>>,
    /// The raw account Library documents, shared with every view as a memo.
    /// Never state, never a Snapshot; cleared when the account changes.
    library_cache: Arc<Mutex<LibraryCache>>,
    /// The Titles the Host has read, kept in memory and written through the
    /// store (ADR-0038). Shared with every view: a question reads it before it
    /// fetches, and keeps what it fetches.
    titles: Arc<Mutex<TitleCache>>,
    /// The work waiting to run outside the change lock: a stale Title's
    /// refresh, and a read-ahead of a Title the row or the Library holds.
    /// Shared with every view, because a stale open is resolved by one and
    /// queued here (ADR-0038 §2, §3).
    background: Arc<Mutex<BackgroundQueue>>,
    /// When a caught-up Title was last looked for, so the scan that lets a week
    /// pass on an open Host runs at most once a day (#277).
    read_ahead_scanned_at: Option<i64>,
}

/// What one look at the background queue did.
///
/// A background read that changes a kept Title moves Continue watching — a card
/// that was a finished Video becomes its Up next, or gains one — and every
/// client is owed a Snapshot for it. A read that changed nothing a client can
/// see publishes nothing (#277, #274).
#[derive(Debug, Clone)]
pub struct Drained {
    /// How many jobs ran.
    pub ran: usize,
    /// The Snapshot to publish, where a cache write changed what one carries.
    pub snapshot: Option<Snapshot>,
}

impl Drained {
    pub(crate) fn nothing() -> Self {
        Self {
            ran: 0,
            snapshot: None,
        }
    }
}

/// The cache key a read's work will be kept under, where the work names one.
fn key_of(work: &Work) -> Option<TitleKey> {
    match work {
        Work::Addon { addon, asked } => Some(TitleKey::Addon {
            addon: addon.clone(),
            id: asked.id.clone(),
        }),
        Work::Discovered { id, .. } | Work::CatchUp { id, .. } => Some(TitleKey::Tmdb { id: id.0 }),
    }
}

impl Host {
    /// Load the Host's state from the store.
    ///
    /// Preparing the store — creating the database, running its migrations — is
    /// the store's own concern; by the time this is called the store can be read.
    /// The fetching is only needed once an Action asks for something over the
    /// network, and the secret store only once a credential is looked up, so a
    /// Host with neither ever touches them.
    ///
    /// The secret store is asked once here — whether a TMDB key is already held
    /// — and the credential it answers with is read only as far as that word and
    /// dropped with it: state knows *what is held*, and holds none of it.
    pub fn new(
        store: Arc<dyn Store>,
        fetcher: Arc<dyn Fetcher>,
        secrets: Arc<dyn SecretStore>,
        provider: Arc<dyn Provider>,
        player: Arc<dyn Player>,
        clock: Arc<dyn Clock>,
    ) -> Result<Self, StoreError> {
        // A store that cannot answer cannot be disagreed with by a Snapshot:
        // the Host opens knowing no key is held, and finds out when one is
        // asked for.
        let held = |kind| matches!(secrets.read(kind), Ok(Some(_)));
        let watch = store.read_watch_progress()?;
        // The Titles the last run kept, loaded before any question can ask: the
        // Titles behind Watch progress are what the row and Up next are drawn
        // from, and they must open on a Host that started with no network
        // (ADR-0038 §1). Loading trims TMDB copies past the terms ceiling and
        // the bound, and never evicts one behind Watch progress.
        let protected = watch
            .iter()
            .map(|progress| TitleProbe::from_stub(&progress.title))
            .collect();
        let titles = Arc::new(Mutex::new(TitleCache::load(
            store.clone(),
            MAX_CACHED_TITLES,
            clock.now_millis(),
            &TitleProtection::holding(protected),
        )?));
        let state = State::holding(
            store.read_preferences()?,
            store.read_addons()?,
            Protection {
                backend: secrets.backend(),
                tmdb_held: held(CredentialKind::TmdbKey),
                stremio_held: held(CredentialKind::StremioAuthKey),
            },
            watch,
            store.read_devices()?,
            // A fresh code every run: a code is worth one pairing, and a Host
            // that was restarted is a Host whose screen nobody was reading.
            PairingCode::generate(),
        );
        let picture = player.picture();
        // The subtitle language the owner stored is told to the Player once,
        // before anything is opened: mpv's `slang` decides which subtitle track
        // it selects for a Stream, and it has to be set before the `open` that
        // would use it. A Player that refuses a preference is not a Host that
        // cannot hold one, so the refusal is dropped.
        let _ = player.tell(Telling::SubtitleLanguage(
            state.preferences().subtitle_language().cloned(),
        ));
        // The appearance follows, for the same reason and in the same order:
        // the preferences are Host state, and a Stream opened after a restart
        // must be drawn the way the owner left it (ADR-0024).
        let _ = player.tell(Telling::SubtitleColor(
            state.preferences().subtitle_color().clone(),
        ));
        let _ = player.tell(Telling::SubtitleScale(state.preferences().subtitle_scale()));
        // The buffer is told before anything is opened for the same reason: a
        // Stream that starts before its buffer limits are known would begin with
        // the Player's own defaults and only reach the owner's on the next one
        // (ADR-0026).
        let _ = player.tell(Telling::StreamBuffer(state.preferences().stream_buffer()));
        let mut host = Self {
            store,
            fetcher,
            secrets,
            provider,
            player,
            previewer: Arc::new(NoPreviewer),
            preview_gate: PreviewCeiling::Refused,
            preview_since: None,
            clock,
            picture,
            serving: None,
            state,
            revision: 0,
            cache: Arc::new(Mutex::new(CatalogCache::default())),
            stremio: None,
            library_cache: Arc::new(Mutex::new(LibraryCache::default())),
            titles,
            background: Arc::new(Mutex::new(BackgroundQueue::default())),
            read_ahead_scanned_at: None,
        };
        // The Titles behind Continue watching are known here, and they are the
        // ones the owner is most likely to open and the ones Up next is drawn
        // from: the queue is filled before any client asks (ADR-0038 §3, #277).
        let now = host.clock.now_millis();
        host.queue_watch_read_ahead(false, now);
        host.read_ahead_scanned_at = Some(now);
        Ok(host)
    }

    /// The same Host, able to take a still of a moment of the Stream playing
    /// (ADR-0028).
    ///
    /// A builder rather than a seventh argument to [`Host::new`], for the same
    /// reason sync is one: a Host built without a previewer is the default the
    /// repository's tests are written against, and every platform that cannot
    /// run a second player keeps it. Arm and disarm are the Host's own calls —
    /// a Stream's open is what arms the URL, and the Player's first report is
    /// what decides whether it may run — so nothing here needs a client to set
    /// anything.
    #[must_use]
    pub fn with_previewer(mut self, previewer: Arc<dyn Previewer>) -> Self {
        self.previewer = previewer;
        self
    }

    /// The same Host, able to sync with a Stremio account (#30).
    ///
    /// A builder rather than a seventh argument to [`Host::new`]: sync is the one
    /// seam that is optional, and a Host built without it is the default the
    /// whole repository's tests and the sync-off path are written against. Even
    /// with it, nothing reaches Stremio until the owner signs in.
    #[must_use]
    pub fn with_stremio(mut self, stremio: Arc<dyn StremioApi>) -> Self {
        self.stremio = Some(stremio);
        self
    }

    /// Tell the Host where it answers remote clients.
    ///
    /// A setter rather than a builder: the address belongs to the wire server,
    /// which the shell starts after the Host exists and only then knows which
    /// port it got, and a Host that is never told one — every test, and a Host
    /// that could not bind — is the default. It is not an Action: nobody asked
    /// for it, no client can change it, and it is a fact about this run rather
    /// than state.
    pub fn set_serving(&mut self, address: impl Into<String>) {
        self.serving = Some(address.into());
    }

    /// The state as it stands — what a client that has just connected, or just
    /// reconnected, is owed.
    pub fn snapshot(&self) -> Snapshot {
        let titles = self.titles.lock().expect("the Title cache is not poisoned");
        Snapshot::build(
            &self.state,
            titles.cached(),
            self.revision,
            self.picture,
            self.serving.as_deref(),
        )
    }

    /// The device a presented token belongs to, or nothing.
    ///
    /// A read beside [`Host::snapshot`], not an Action: judging whether a
    /// connection may speak is the adapter's question, and it is answered from
    /// the same state every Snapshot is built from. A token for a device that has
    /// been revoked matches nothing, which is what revocation means.
    pub fn device(&self, token: &DeviceToken) -> Option<DeviceSummary> {
        self.state.device_for(token).map(|device| device.summary())
    }

    /// The Host as one question sees it: the Addon list frozen now, and the
    /// seams the question resolves over.
    ///
    /// Cheap and short. The door calls this under its lock and lets the question
    /// fetch outside it (ADR-0022); a change that needs one of the same read-only
    /// helpers (a resume, an episode step) takes a view of its own and stays
    /// serialized around the change itself.
    pub fn view(&self) -> HostView {
        HostView::new(
            self.state.addons().to_vec(),
            self.fetcher.clone(),
            self.provider.clone(),
            self.secrets.clone(),
            self.previewer.clone(),
            self.preview_gate,
            HostViewShared {
                cache: self.cache.clone(),
                library_cache: self.library_cache.clone(),
                stremio: self.stremio.clone(),
                titles: self.titles.clone(),
                background: self.background.clone(),
                clock: self.clock.clone(),
                // The Watch progress frozen with the rest of the view: a cache
                // write must not evict a Title behind one of its cards, and a
                // write that moves a card publishes a Snapshot (ADR-0038 §1,
                // #274, #277).
                watch: self.state.watch().to_vec(),
            },
        )
    }

    /// Fill the queue with the Titles behind Continue watching that a read
    /// ahead is owed (#277).
    ///
    /// At startup every one that is not fresh is queued: the Titles behind the
    /// row are the ones most likely to be opened, and Up next is drawn from
    /// them (ADR-0038 §3). Once the Host is running, only a caught-up Title is
    /// looked for again, and only when its record has come due, so a week can
    /// pass with the Host open (ADR-0038 §5).
    fn queue_watch_read_ahead(&mut self, only_caught_up: bool, now: i64) {
        let mut groups: Vec<Vec<crate::progress::WatchProgress>> = Vec::new();
        for entry in self.state.watch() {
            match groups
                .iter_mut()
                .find(|group| crate::progress::same_title(&group[0], entry))
            {
                Some(group) => group.push(entry.clone()),
                None => groups.push(vec![entry.clone()]),
            }
        }

        for group in groups {
            let latest = group
                .iter()
                .max_by_key(|entry| entry.updated_at)
                .expect("a Title's progress is not empty");
            let probe = TitleProbe::from_stub(&latest.title);
            let (cached, caught_up) = {
                let cache = self.titles.lock().expect("the Title cache is not poisoned");
                let cached = crate::title_cache::newest_matching(cache.cached(), &probe).cloned();
                let caught_up = crate::progress::caught_up(&group, cache.cached());
                (cached, caught_up)
            };

            // An Unmapped Title has no TMDB record, so it is checked weekly
            // whether or not it is caught up; a mapped Title that is not caught
            // up is not periodically prefetched (ADR-0038 §3, §5, #277).
            let unmapped = cached
                .as_ref()
                .is_some_and(|held| matches!(held.title.key, TitleKey::Addon { .. }));
            if only_caught_up && !caught_up && !unmapped {
                continue;
            }
            let due = cached
                .as_ref()
                .is_none_or(|held| held.read_ahead_due(caught_up, now));
            if !due {
                continue;
            }
            if let Some((key, work, answered)) = self.read_ahead_job(&probe, cached, caught_up) {
                self.enqueue_read_ahead(key, work, answered);
            }
        }
    }

    /// Fill the queue with the Library Titles a read ahead is owed (#277).
    ///
    /// The account's Library is read at startup, so its Titles are queued then
    /// and only then: a Library Title with no Watch progress behind it has no
    /// caught-up check to run later. One already behind Continue watching is the
    /// same Title and the same job, collapsed by its key.
    fn queue_library_read_ahead(&mut self, items: &[serde_json::Value], now: i64) {
        for raw in items {
            let Ok(item) = RemoteItem::parse(raw.clone()) else {
                continue;
            };
            if item.removed() {
                continue;
            }
            let Some(r#type) = item.r#type() else {
                continue;
            };
            if tmdb::Kind::parse(r#type).is_none() {
                continue;
            }
            let probe = TitleProbe::new(None, r#type, item.id());
            let cached = {
                let cache = self.titles.lock().expect("the Title cache is not poisoned");
                crate::title_cache::newest_matching(cache.cached(), &probe).cloned()
            };
            let due = cached
                .as_ref()
                .is_none_or(|held| held.read_ahead_due(false, now));
            if !due {
                continue;
            }
            if let Some((key, work, answered)) = self.read_ahead_job(&probe, cached, false) {
                self.enqueue_read_ahead(key, work, answered);
            }
        }
    }

    /// What one read-ahead job for a Title is, where the Title can be read at
    /// all: its key, the work, and the copy a client was answered with where one
    /// exists.
    fn read_ahead_job(
        &self,
        probe: &TitleProbe,
        cached: Option<CachedTitle>,
        caught_up: bool,
    ) -> Option<(TitleKey, Work, Option<Title>)> {
        match cached {
            None => {
                let work = self.whole_read_work(probe, None)?;
                Some((key_of(&work)?, work, None))
            }
            Some(held) => {
                // A caught-up series is watched by its TMDB record: the season
                // it announces, or the newest one the cached list holds, and
                // nothing else (ADR-0038 §5).
                let season = if caught_up {
                    match held.title.key {
                        TitleKey::Tmdb { .. } => held
                            .next_episode
                            .map(|next| next.season)
                            .or_else(|| held.newest_season()),
                        TitleKey::Addon { .. } => None,
                    }
                } else {
                    None
                };
                let work = match season {
                    Some(season) => match held.title.key {
                        TitleKey::Tmdb { id } => Work::CatchUp {
                            id: tmdb::TmdbId(id),
                            season,
                            source: held.source,
                        },
                        // A caught-up Unmapped Title re-reads its Addon's meta
                        // whole, because it has no record of seasons.
                        TitleKey::Addon { .. } => self.whole_read_work(probe, Some(&held))?,
                    },
                    None => self.whole_read_work(probe, Some(&held))?,
                };
                Some((held.title.key.clone(), work, Some(held.title)))
            }
        }
    }

    /// The whole-Title read a Title is owed: its Addon's `meta` where an Addon
    /// can answer, TMDB's record where it cannot and the Title is TMDB's.
    fn whole_read_work(&self, probe: &TitleProbe, cached: Option<&CachedTitle>) -> Option<Work> {
        // The Addon that supplied the Title is the one to ask, where it is still
        // configured: it answers the same Title the client would open.
        if let Some(addon) = &probe.addon {
            if self.state.has_addon(addon) {
                return Some(Work::Addon {
                    addon: addon.clone(),
                    asked: TitleRef {
                        r#type: probe.r#type.clone(),
                        id: probe.id.clone(),
                    },
                });
            }
        }

        if let Some(cached) = cached {
            match cached.title.key.clone() {
                TitleKey::Tmdb { id } => {
                    return tmdb::Kind::parse(&cached.title.r#type).map(|kind| Work::Discovered {
                        id: tmdb::TmdbId(id),
                        kind,
                    })
                }
                TitleKey::Addon { addon, id } => {
                    return TitleRef::parse(&cached.title.r#type, &id)
                        .ok()
                        .map(|asked| Work::Addon { addon, asked })
                }
            }
        }

        if let Some(id) = probe.id.strip_prefix("tmdb:").and_then(tmdb::TmdbId::parse) {
            if let Some(kind) = tmdb::Kind::parse(&probe.r#type) {
                return Some(Work::Discovered { id, kind });
            }
        }
        if let Some(addon) = &probe.addon {
            return TitleRef::parse(&probe.r#type, &probe.id)
                .ok()
                .map(|asked| Work::Addon {
                    addon: addon.clone(),
                    asked,
                });
        }

        // A Library entry names no Addon: the first configured one that offers
        // the Title's `meta` is the one that can read it.
        let requested = ResourceRequest::new(META, &probe.r#type, &probe.id);
        self.state
            .addons()
            .iter()
            .find(|addon| addon.manifest().answers(&requested))
            .and_then(|addon| {
                TitleRef::parse(&probe.r#type, &probe.id)
                    .ok()
                    .map(|asked| Work::Addon {
                        addon: addon.id().clone(),
                        asked,
                    })
            })
    }

    /// Queue one read-ahead. It has no askers: nobody is waiting for it, and a
    /// refresh that changes something publishes a Snapshot rather than an
    /// Answer (#277).
    fn enqueue_read_ahead(&mut self, key: TitleKey, work: Work, answered: Option<Title>) {
        self.background
            .lock()
            .expect("the background queue is not poisoned")
            .enqueue(Job {
                key,
                answered,
                work,
                askers: Vec::new(),
            });
    }

    /// Take an Action, and publish or answer what came of it.
    ///
    /// Validation is pure and comes first. A question then resolves from a view
    /// frozen at this moment; a change applies where this call stands, and an
    /// Action that is rejected, that cannot be fetched, or that the store
    /// refuses leaves state and every future Snapshot exactly as they were.
    ///
    /// This is the one-call form for tests. The app shell and the wire reach the
    /// same two halves through [`crate::HostDoor`], which holds the change lock
    /// around a change; a direct caller here is serialized by `&mut self`.
    pub fn dispatch(&mut self, action: Action) -> Result<Response, ActionError> {
        self.dispatch_asking(action, None)
    }

    /// The same dispatch, saying where an Answer that follows the Response goes.
    ///
    /// A stale Title's open queues a refresh and answers the cached copy; when
    /// the refresh lands and differs, `revisions` receives the revised Answer
    /// (ADR-0038 §2). A caller with nobody to tell — every test that does not
    /// care about the revision — uses [`Host::dispatch`].
    pub fn dispatch_asking(
        &mut self,
        action: Action,
        revisions: Option<Arc<dyn RevisionSink>>,
    ) -> Result<Response, ActionError> {
        let validated = action.validate()?;
        if validated.is_question() {
            // A question publishes no Snapshot unless keeping the Title it read
            // moved Continue watching: the Answer is the asker's own business,
            // but a row every client draws is not (#274, #277).
            let answered = self.view().ask(validated, revisions.as_ref())?;
            let mut response = Response::answered(answered.answer);
            if answered.moved {
                response.snapshots.push(self.cache_changed());
            }
            Ok(response)
        } else {
            self.apply(validated)
        }
    }

    /// Take every background job waiting, so the caller can run it with the
    /// Host's change lock released.
    pub(crate) fn take_jobs(&self) -> Vec<Job> {
        self.background
            .lock()
            .expect("the background queue is not poisoned")
            .take()
    }

    /// Prepare one drain: fill the queue with what has come due, and take the
    /// jobs and the view they resolve over.
    ///
    /// This is the *one* place the daily caught-up scan is taken, so that every
    /// adapter that drains runs the same policy (ADR-0022's "one policy"): the
    /// shell drains through [`crate::HostDoor::drain`], and a test drains
    /// through [`Host::drain`], and neither can leave a check behind the other
    /// would run. A caught-up Title is checked when its record has come due, so
    /// a week can pass while the Host stays open; the scan itself is daily,
    /// which is the shortest rhythm any check runs at (ADR-0038 §5).
    ///
    /// The jobs are taken under the change lock and run outside it: the caller
    /// resolves them with the returned view and no lock held (ADR-0022).
    pub(crate) fn begin_drain(&mut self) -> (Vec<Job>, HostView) {
        let now = self.clock.now_millis();
        if self
            .read_ahead_scanned_at
            .is_none_or(|scanned| now.saturating_sub(scanned) >= READ_AHEAD_SCAN_MILLIS)
        {
            self.queue_watch_read_ahead(true, now);
            self.read_ahead_scanned_at = Some(now);
        }

        (self.take_jobs(), self.view())
    }

    /// Run every background job waiting, a bounded fan-out at a time, and
    /// answer what a client is owed.
    ///
    /// The shell's worker thread drains through [`crate::HostDoor::drain`],
    /// which takes its jobs from [`Host::begin_drain`] and runs them with the
    /// change lock released; this inline form exists for tests and for a caller
    /// that already owns the Host. A read that changed a kept Title publishes
    /// the Snapshot that moves Continue watching, once for the whole drain
    /// (#277, ADR-0038 §3).
    pub fn drain(&mut self) -> Drained {
        let (jobs, view) = self.begin_drain();
        if jobs.is_empty() {
            return Drained::nothing();
        }
        let (ran, changed) = view.drain(jobs);
        Drained {
            ran,
            snapshot: changed.then(|| self.cache_changed()),
        }
    }

    /// Bump the revision and build the Snapshot a background cache write owes.
    ///
    /// Under the change lock, like every publication: a Snapshot is built from
    /// the whole state, and a half-applied change is not a state any client may
    /// see. The queue's fetch runs outside this lock, so the door calls this
    /// once the drain has finished (ADR-0022).
    pub(crate) fn cache_changed(&mut self) -> Snapshot {
        self.revision += 1;
        self.snapshot()
    }

    /// Apply one change, publishing the Snapshot it owes and answering where it
    /// also answers.
    ///
    /// The door holds the Host's change lock for the whole of this, I/O
    /// included; a direct caller is serialized by `&mut self`. A change may
    /// fetch (an Addon's manifest), read the Player or write a credential, and
    /// serializing those is what keeps two changes from interleaving into a
    /// state neither asked for (ADR-0022).
    pub fn apply(&mut self, validated: ValidatedAction) -> Result<Response, ActionError> {
        let (change, answer) = match self.change(validated)? {
            Resolved::Change(change) => (change, None),
            // The one Action that both changes state and answers the client that
            // asked: pairing, where the token goes to the device and the device
            // joining the list goes to every client (#31).
            Resolved::Changed { change, answer } => (change, Some(answer)),
            // A fire-and-forget hint queued its read-ahead and owes nobody a
            // Snapshot or an Answer (ADR-0038 §3, #278).
            Resolved::Silent => return Ok(Response::silent()),
        };

        // The Title a pause or a stop leaves is the one the account is owed: the
        // Stream is still the Host's here, and after a stop it is not.
        let leaving = match &change {
            Change::SetPaused(true) | Change::Stop => {
                self.playing_title().map(|title| title.id().to_owned())
            }
            _ => None,
        };
        let signing_in = matches!(change, Change::SignInStremio { .. });
        let account_changed = matches!(
            change,
            Change::SignInStremio { .. } | Change::SignOutStremio
        );

        let mut next = self.state.clone();
        let persist = next.apply(change, self.clock.now_millis());
        let kept = match persist {
            Persist::Preferences => self.store.write_preferences(next.preferences()),
            Persist::Addons => self.store.write_addons(next.addons()),
            // One change — removing the Addon that owned the Featured catalog —
            // left two parts of the store out of date, and both are written: the
            // preference first, so a store read between the two writes never has
            // a Featured catalog naming the Addon the change is removing (#74).
            Persist::AddonsAndPreferences => self
                .store
                .write_preferences(next.preferences())
                .and_then(|()| self.store.write_addons(next.addons())),
            // One Video's Watch progress, written where it happened: the part of
            // a play that outlives the play (#29).
            Persist::Watch(entry) => self.store.write_watch_progress(&entry),
            // A device joining or leaving the paired list (#31): the digest of
            // its token is what the store keeps, so the row can never be the token
            // itself.
            Persist::Device(device) => self.store.write_device(&device),
            Persist::RemoveDevice(id) => self.store.remove_device(&id),
            // The credential lives where the secret store keeps it, and playback
            // is not stored at all: nothing the non-secret store holds was left
            // behind by those.
            Persist::Nothing => Ok(()),
        };
        kept.map_err(|error| ActionError::Store {
            detail: error.to_string(),
        })?;

        self.state = next;
        self.revision += 1;
        if account_changed {
            self.library_cache
                .lock()
                .expect("the Library cache is not poisoned")
                .clear();
        }

        // The account, last, and only when there is one: a sync that fails is
        // not an Action that fails — the change above is made and kept either
        // way (#30).
        if signing_in {
            self.pull_remote();
        }
        if let Some(title) = leaving {
            self.push_title(&title);
        }
        Ok(Response::changed(vec![self.snapshot()], answer))
    }

    /// Merge what the Stremio account holds into the Host's Watch progress:
    /// remote progress that is newer than the Host's record is taken in.
    ///
    /// The Host's *open* (#30): the shell calls it once at startup, and signing
    /// in calls it too. It is a door beside [`Host::sample`] rather than an
    /// Action because nobody asked for it — and like `sample` it publishes only
    /// when it moved something. It *pulls* and does not push: what the Host has
    /// that the account does not is pushed when the owner pauses or stops, which
    /// is when it is known to be the newer write.
    ///
    /// With no account signed in it asks nothing, and a Stremio that cannot
    /// answer leaves the Host's Watch progress as it was.
    pub fn pull_remote(&mut self) -> Option<Snapshot> {
        let (stremio, key) = self.account()?;
        let items = stremio.library(&key, None).ok()?;

        let mut moved = false;
        for raw in &items {
            let Ok(item) = RemoteItem::parse(raw.clone()) else {
                continue;
            };
            let known = self
                .state
                .watch()
                .iter()
                .any(|entry| entry.title.id() == item.id());
            if !known {
                continue;
            }
            let merged = self.merged_title(item.id(), Some(&item));
            moved |= self.adopt(merged.local);
        }

        // The Library is read at startup, so its Titles are read ahead here.
        // Remote progress that arrived with it joins the row, and any Title it
        // named that the Host had not seen is read ahead too (#277).
        let now = self.clock.now_millis();
        self.queue_library_read_ahead(&items, now);
        self.queue_watch_read_ahead(false, now);

        if !moved {
            return None;
        }
        self.revision += 1;
        Some(self.snapshot())
    }

    /// The Host is going away: write down where the Stream got to, and tell the
    /// account where one is signed in (#30). Called by the shell on exit — the
    /// Host has no clock of its own to notice, and a Stream killed with the
    /// window is exactly when the last position is worth keeping.
    ///
    /// Answers whether an account was told, so the shell can *say* what it did
    /// rather than what it hoped: with sync off, nothing was pushed anywhere.
    pub fn shutdown(&mut self) -> bool {
        let now = self.clock.now_millis();
        if let Some(entry) = self.state.refresh_watch(now, true) {
            let _ = self.store.write_watch_progress(&entry);
        }

        let account = self.account().is_some();
        if account {
            if let Some(title) = self.playing_title() {
                self.push_title(title.id());
            }
        }

        account
    }

    /// The account and the key it is signed in with — or nothing, which is a
    /// Host that does not sync: no seam, or no `authKey`.
    ///
    /// The key is read at the moment of use and dropped with the call, like the
    /// TMDB key: it reaches neither state nor a Snapshot.
    fn account(&self) -> Option<(Arc<dyn StremioApi>, String)> {
        let stremio = self.stremio.clone()?;
        let key = self
            .secrets
            .read(CredentialKind::StremioAuthKey)
            .ok()
            .flatten()?;
        Some((stremio, key))
    }

    /// Merge one Title with the account, both ways: what the account wrote later
    /// comes in, and what the Host wrote later goes out. A Stremio that cannot
    /// answer, or refuses the write, is a sync that did not happen — the Host's
    /// own progress is already kept.
    fn push_title(&mut self, title: &str) {
        let Some((stremio, key)) = self.account() else {
            return;
        };
        let ids = [title.to_owned()];
        let Ok(items) = stremio.library(&key, Some(&ids)) else {
            return;
        };
        let remote = items
            .into_iter()
            .filter_map(|raw| RemoteItem::parse(raw).ok())
            .find(|item| item.id() == title);

        let merged = self.merged_title(title, remote.as_ref());
        if self.adopt(merged.local) {
            self.revision += 1;
        }
        if let Some(item) = merged.remote {
            let _ = stremio.put_library(&key, &[item.into_value()]);
        }
    }

    /// What merging a Title's entries with the account's item for it decides.
    ///
    /// The Title's Videos are asked of the Addon that supplied it only when the
    /// answer can matter — an episode is watched on one side or the other — so a
    /// merge of plain positions is not a meta fetch per Title.
    fn merged_title(&self, title: &str, remote: Option<&RemoteItem>) -> Merged {
        let local: Vec<_> = self
            .state
            .watch()
            .iter()
            .filter(|entry| entry.title.id() == title)
            .cloned()
            .collect();
        let Some(stub) = local.first().map(|entry| entry.title.clone()) else {
            return Merged::default();
        };

        let matters = local.iter().any(|entry| entry.watched)
            || remote.is_some_and(|item| item.watched().is_some());
        let order = matters.then(|| self.videos_of(&stub)).flatten();

        merge(&local, remote, order.as_deref(), self.clock.now_millis())
    }

    /// The ids of a Title's Videos in its Addon's own order — what places an
    /// episode in Stremio's watched bitfield — or nothing where the Addon is
    /// gone or cannot say.
    fn videos_of(&self, stub: &TitleStub) -> Option<Vec<String>> {
        if stub.r#type() == "movie" {
            return None;
        }
        // A Discovered Title has no Addon to ask: none of its episodes is
        // ordered by one (ADR-0020).
        let addon = self.state.addon(stub.addon()?)?;
        let requested = ResourceRequest::new(META, stub.r#type(), stub.id());
        if !addon.manifest().answers(&requested) {
            return None;
        }
        let asked = TitleRef::parse(stub.r#type(), stub.id()).ok()?;
        let title = self.view().fetch_title(addon, &asked, &requested).ok()?;

        Some(title.videos.iter().map(|video| video.id.clone()).collect())
    }

    /// Keep entries that were merged in from the account, in state and in the
    /// store. A store that refuses one has lost that write and not the merge:
    /// the next one will find the account still newer.
    fn adopt(&mut self, entries: Vec<crate::progress::WatchProgress>) -> bool {
        let moved = !entries.is_empty();
        for entry in entries {
            let _ = self.store.write_watch_progress(&entry);
            self.state.merge_watch(entry);
        }
        moved
    }

    /// Read the Player, and publish where playback stands now.
    ///
    /// The one door that is not an Action: playback moves on its own, so the
    /// Host looks at its own Player between Actions and folds what it reports
    /// into state. A report that says exactly what the Host holds moves nothing
    /// and publishes nothing. A position that moved is not by itself a change:
    /// clients project the clock from the position a Snapshot anchored, so the
    /// tick updates the Host's own record and lets the next public change or
    /// Watch progress write carry the correction. A Stream that ended, an open
    /// that failed, a track list that arrived and a control that moved are what
    /// a client cannot invent and therefore what publishes.
    ///
    /// The Host holds no clock of its own — host-core has no threads and no
    /// timers — so whoever owns the shell's event loop calls this while
    /// something is playing (ADR-0013, ADR-0033).
    pub fn sample(&mut self) -> Option<Snapshot> {
        let observation = self.player.observe();

        // The first report of a Stream is where the Seek preview's ceiling is
        // decided: a Stream too dear to ask twice, or one that will not say what
        // it costs, is never previewed, and the worker is let go of here rather
        // than after it has already spent the connection. The decision is taken
        // once per Stream — a later report does not revisit it — and it is never
        // published: a brake is not something a client sees (ADR-0028). Only a
        // Stream that is actually playing is asked about: a report that still
        // describes the last file has nothing to say about this one.
        if self.preview_gate == PreviewCeiling::Waiting
            && matches!(
                observation.state,
                PlaybackState::Playing | PlaybackState::Paused
            )
        {
            let waited = self.preview_since.is_some_and(|since| {
                self.clock.now_millis().saturating_sub(since) >= PREVIEW_BITRATE_GRACE_MS
            });
            let decided = preview_ceiling(observation.statistics.as_ref(), waited);
            if decided != PreviewCeiling::Waiting {
                if !decided.affordable() {
                    self.previewer.disarm();
                }
                self.preview_gate = decided;
            }
        }

        // Reading the Player's report is also where the Host notices a Stream
        // that came up with no subtitles of its own, and offers the Addon
        // fallback once. The fetch is I/O inside the tick and that is
        // deliberate: a Stream that needs subtitles needs them whether or not a
        // client has a menu open, so no client can cause or prevent it
        // (ADR-0014). The attempt is the Host's own note and is not published;
        // a tick that only records it moves no revision.
        if self.offers_subtitles(&observation) {
            self.ask_addons_for_subtitles();
            self.state.record_subtitles_attempt();
        }

        let next = self.state.playback().advanced(&observation)?;
        let published = next.differs_publicly_from(self.state.playback());

        self.state.set_playback(next);

        // Where playback has got to is Watch progress the moment it is worth
        // writing — a position that moved a few seconds, a Video that finished,
        // a duration that arrived — and it is written *now* rather than on a
        // stop, which is what survives a Host killed mid-Stream (#29). A store
        // that refuses the write loses this tick and not the Stream: the next
        // write is seconds away, and playback is not the store's to stop. The
        // write is also the low-rate correction a projecting client gets: the
        // Snapshot carries the position its clock should be anchored to.
        let now = self.clock.now_millis();
        let written = self.state.refresh_watch(now, false);
        let corrected = written.is_some();
        if let Some(entry) = written {
            let _ = self.store.write_watch_progress(&entry);
        }

        if !published && !corrected {
            return None;
        }

        self.revision += 1;
        Some(self.snapshot())
    }

    /// Whether the Addon subtitles fallback is owed right now.
    ///
    /// Only when the Stream is loaded and live — not merely opening — the
    /// Player has *said* what the Stream carries, and what it said includes no
    /// embedded subtitle track, and this Stream has not been asked about yet.
    /// Embedded tracks always win, so a Stream that reports one is never asked
    /// about; and the attempt is per Stream, so a Stream with no subtitles
    /// anywhere is asked about once rather than every tick.
    ///
    /// `tracks` being `None` is a Player that could not read the track list,
    /// which is not the same as a Stream with no subtitles in it: the fallback
    /// waits for a report it can act on, and a failed read leaves the attempt
    /// un-made rather than spending it on the wrong answer (ADR-0014).
    fn offers_subtitles(&self, observation: &Observation) -> bool {
        if !self.state.playback().has_stream() || self.state.playback().subtitles_attempted() {
            return false;
        }
        if !matches!(
            observation.state,
            PlaybackState::Playing | PlaybackState::Paused
        ) {
            return false;
        }
        let Some(tracks) = observation.tracks.as_deref() else {
            return false;
        };

        !tracks
            .iter()
            .any(|track| track.kind == TrackKind::Subtitle && track.embedded)
    }

    /// Ask every configured Addon that answers a `subtitles` request for the
    /// Video playing, and tell the Player to load what comes back.
    ///
    /// One Addon failing is one Addon with nothing, not a failed fallback: the
    /// others still answer (ADR-0010's rule, applied here). What comes back is
    /// capped, across every Addon, at [`MAX_FALLBACK_SUBTITLES`], because a
    /// fallback is a handful of tracks and none of them is a choice a client
    /// made.
    fn ask_addons_for_subtitles(&self) {
        let Some(chosen) = self.state.playback().chosen() else {
            return;
        };
        let video = chosen.now_playing.video.clone();
        let addons: Vec<(Addon, ResourceRequest)> = self
            .view()
            .asks_for(SUBTITLES, &video)
            .into_iter()
            .filter_map(|asked| Some((asked.addon, asked.requested?)))
            .collect();

        let mut added = 0usize;
        for (addon, requested) in &addons {
            if added >= MAX_FALLBACK_SUBTITLES {
                break;
            }
            // A fetch that fails, or an answer that cannot be read, is this
            // Addon having nothing: the Host does not invent a subtitle for it,
            // and the next Addon is still asked.
            let Ok(subtitles) = self.provider.subtitles(addon, requested) else {
                continue;
            };
            for subtitle in subtitles {
                if added >= MAX_FALLBACK_SUBTITLES {
                    break;
                }
                // A Player that refuses one is not a failed fallback either: the
                // Host's own record has already noted the attempt, and a refusal
                // is the Player's to make.
                let _ = self.player.tell(Telling::AddSubtitle {
                    url: subtitle.url,
                    title: subtitle.id,
                    language: subtitle.language,
                });
                added += 1;
            }
        }
    }

    /// Turn a validated change into the change it will make.
    ///
    /// This is where a change's I/O happens: an Addon's manifest is fetched and
    /// read, a credential is written, the Player is told, so that what reaches
    /// state is already a decided thing. A failure here has touched neither
    /// state nor store. A question never reaches this method (ADR-0022).
    fn change(&mut self, validated: ValidatedAction) -> Result<Resolved, ActionError> {
        Ok(match validated {
            ValidatedAction::SetSubtitleLanguage(language) => {
                // The preference is the Host's and persists whether or not the
                // Player takes it; a Player that refuses is not a reason a
                // client cannot express a preference (ADR-0013).
                let _ = self
                    .player
                    .tell(Telling::SubtitleLanguage(Some(language.clone())));
                Resolved::Change(Change::SetSubtitleLanguage(language))
            }
            ValidatedAction::ClearSubtitleLanguage => {
                let _ = self.player.tell(Telling::SubtitleLanguage(None));
                Resolved::Change(Change::ClearSubtitleLanguage)
            }
            ValidatedAction::SetSubtitleColor(color) => {
                // A preference the Host keeps whether or not the Player takes
                // it: a Player that refuses is not a reason a client cannot
                // express one (ADR-0013, ADR-0024).
                let _ = self.player.tell(Telling::SubtitleColor(color.clone()));
                Resolved::Change(Change::SetSubtitleColor(color))
            }
            ValidatedAction::SetSubtitleScale(scale) => {
                let _ = self.player.tell(Telling::SubtitleScale(scale));
                Resolved::Change(Change::SetSubtitleScale(scale))
            }
            ValidatedAction::SetStreamBuffer(buffer) => {
                // A buffer is a preference the Host keeps whether or not the
                // Player takes it, like the appearance beside it; the Player's
                // buffer limits move without reopening the Stream (ADR-0026).
                let _ = self.player.tell(Telling::StreamBuffer(buffer));
                Resolved::Change(Change::SetStreamBuffer(buffer))
            }
            ValidatedAction::SetUpNextPlayback(playback) => {
                // A preference and nothing else: the Player is not told, because
                // what Play does is decided by the client that presses it from
                // the Snapshot (#276).
                Resolved::Change(Change::SetUpNextPlayback(playback))
            }
            ValidatedAction::AddAddon(url) => {
                let body =
                    self.fetcher
                        .fetch(url.as_str())
                        .map_err(|error| ActionError::Fetch {
                            detail: error.to_string(),
                        })?;
                let manifest = Manifest::parse(&body).map_err(|error| ActionError::Manifest {
                    detail: error.to_string(),
                })?;
                Resolved::Change(Change::AddAddon(Box::new(Addon::new(url, manifest))))
            }
            ValidatedAction::ReorderAddon { id, position } => {
                if !self.state.has_addon(&id) {
                    return Err(ActionError::UnknownAddon {
                        id: id.as_str().to_owned(),
                    });
                }
                // A position is a place in the list the Host has, 0-based: the
                // last Addon stands at `count - 1`, and every number that is
                // not one of those places — a negative a client counted to, a
                // place past the end — is the same refusal (#74).
                let count = self.state.addons().len();
                let position = usize::try_from(position)
                    .ok()
                    .filter(|position| *position < count)
                    .ok_or_else(|| ActionError::InvalidPosition {
                        id: id.as_str().to_owned(),
                        position,
                        count,
                    })?;
                Resolved::Change(Change::ReorderAddon { id, position })
            }
            ValidatedAction::SetFeaturedCatalog { addon, catalog } => {
                let configured = self.addon(&addon)?;
                // The Catalog is the Addon's own: one the manifest does not
                // declare is one the Host could never ask for, so it is refused
                // where it is named rather than left to fail on Home (#74).
                if configured
                    .manifest()
                    .catalog(&catalog.r#type, &catalog.id)
                    .is_none()
                {
                    return Err(ActionError::UnknownCatalog {
                        addon: configured.id().clone(),
                        catalog,
                    });
                }
                Resolved::Change(Change::SetFeaturedCatalog(FeaturedCatalog {
                    addon,
                    catalog,
                }))
            }
            ValidatedAction::ClearFeaturedCatalog => Resolved::Change(Change::ClearFeaturedCatalog),
            ValidatedAction::RemoveAddon(id) => {
                if !self.state.has_addon(&id) {
                    return Err(ActionError::UnknownAddon {
                        id: id.as_str().to_owned(),
                    });
                }
                Resolved::Change(Change::RemoveAddon(id))
            }
            ValidatedAction::SetTmdbKey(key) => {
                // The credential goes straight to where it lives and is not
                // carried anywhere past this call: the change that reaches
                // state is only where the store *is*.
                self.secrets
                    .write(CredentialKind::TmdbKey, key.as_str())
                    .map_err(|error| ActionError::Secret {
                        detail: error.to_string(),
                    })?;
                Resolved::Change(Change::SetTmdbKey {
                    backend: self.secrets.backend(),
                })
            }
            ValidatedAction::ClearTmdbKey => {
                self.secrets
                    .remove(CredentialKind::TmdbKey)
                    .map_err(|error| ActionError::Secret {
                        detail: error.to_string(),
                    })?;
                Resolved::Change(Change::ClearTmdbKey)
            }
            ValidatedAction::SignInStremio(login) => {
                let stremio = self.stremio.as_ref().ok_or(ActionError::SyncUnavailable)?;
                // The password is spent here: it goes to Stremio and is not
                // carried anywhere past this call. What comes back is a key, and
                // it goes straight to where credentials live.
                let key = stremio
                    .login(&login.email, login.password.expose())
                    .map_err(|error| ActionError::Sync {
                        detail: error.to_string(),
                    })?;
                self.secrets
                    .write(CredentialKind::StremioAuthKey, &key)
                    .map_err(|error| ActionError::Secret {
                        detail: error.to_string(),
                    })?;
                Resolved::Change(Change::SignInStremio {
                    backend: self.secrets.backend(),
                })
            }
            ValidatedAction::SignOutStremio => {
                self.secrets
                    .remove(CredentialKind::StremioAuthKey)
                    .map_err(|error| ActionError::Secret {
                        detail: error.to_string(),
                    })?;
                Resolved::Change(Change::SignOutStremio)
            }
            ValidatedAction::PairDevice { code, name } => {
                // The code is the whole of what lets a device in, so it is the
                // one thing judged: whatever the Host is showing and nothing
                // else. A wrong, spent or expired code is the same refusal — the
                // Host has nothing useful to say about a string it refuses.
                if self.state.pairing() != &code {
                    return Err(ActionError::Pairing);
                }
                // The device and its token are minted here, where entropy is
                // available: what reaches state is a digest and what reaches the
                // device is the token, once.
                let (device, token) = Device::paired(name, self.clock.now_millis());
                let answer = Answer::Paired {
                    device: device.summary(),
                    token,
                };
                Resolved::Changed {
                    change: Change::PairDevice {
                        device: Box::new(device),
                        // Redeeming spends the code; the one the Host shows from
                        // here on is drawn with it.
                        next_code: PairingCode::generate(),
                    },
                    answer,
                }
            }
            ValidatedAction::RevokeDevice(id) => {
                if !self.state.has_device(&id) {
                    return Err(ActionError::UnknownDevice {
                        id: id.as_str().to_owned(),
                    });
                }
                Resolved::Change(Change::RevokeDevice(id))
            }
            // A question resolves from a view outside this lock; the door never
            // sends one here. Refused rather than answered if it does.
            ValidatedAction::BrowseCatalog { .. }
            | ValidatedAction::SearchCatalogs { .. }
            | ValidatedAction::Discover { .. }
            | ValidatedAction::Search { .. }
            | ValidatedAction::OpenTitle { .. }
            | ValidatedAction::OpenDiscoveredTitle { .. }
            | ValidatedAction::FindStreams { .. }
            | ValidatedAction::Preview { .. }
            | ValidatedAction::Library => {
                return Err(ActionError::Malformed {
                    detail: "a question is not a change".to_owned(),
                })
            }
            ValidatedAction::PlayStream { chosen, title } => {
                // The Player is handed the URL and nothing else; whether the
                // Stream it leads to opens is found out later, through
                // `observe`, because agreeing to try is not playing. The Title
                // rides along so the play is recorded as progress in a Video of
                // it (#29), and a fresh play starts at the Stream's beginning.
                self.player
                    .open(&chosen.url, None)
                    .map_err(|error| ActionError::Playback {
                        detail: error.to_string(),
                    })?;
                // Armed at the same moment the Stream opens, and cheap: the
                // worker does not connect until the first still is asked for
                // (ADR-0028).
                self.arm_preview(&chosen.url);
                Resolved::Change(Change::Play {
                    chosen,
                    title: Some(Box::new(title)),
                    start: None,
                })
            }
            ValidatedAction::Resume { video } => {
                let (chosen, title, start) = self.resume(&video)?;
                self.player
                    .open(&chosen.url, start)
                    .map_err(|error| ActionError::Playback {
                        detail: error.to_string(),
                    })?;
                self.arm_preview(&chosen.url);
                Resolved::Change(Change::Play {
                    chosen: Box::new(chosen),
                    title: Some(Box::new(title)),
                    start,
                })
            }
            ValidatedAction::PlayUpNext { title } => {
                let (entry, previous) = self.up_next(&title)?;
                let chosen = self.up_next_stream(&entry, &previous)?;
                self.player
                    .open(&chosen.url, None)
                    .map_err(|error| ActionError::Playback {
                        detail: error.to_string(),
                    })?;
                self.arm_preview(&chosen.url);
                Resolved::Change(Change::Play {
                    chosen: Box::new(chosen),
                    title: Some(Box::new(entry.title)),
                    start: None,
                })
            }
            ValidatedAction::SetPaused { paused } => {
                self.playing(Control::Pause)?;
                self.told(Telling::Pause(paused))?;
                Resolved::Change(Change::SetPaused(paused))
            }
            ValidatedAction::Seek { target } => {
                self.playing(Control::Seek)?;
                self.told(Telling::Seek(target))?;
                Resolved::Change(Change::Seek(target))
            }
            ValidatedAction::SetAudioTrack { track } => {
                self.playing(Control::AudioTrack)?;
                self.known_track(Control::AudioTrack, TrackKind::Audio, track)?;
                self.told(Telling::AudioTrack(track))?;
                Resolved::Change(Change::SetAudioTrack(track))
            }
            ValidatedAction::SetSubtitleTrack { track } => {
                self.playing(Control::SubtitleTrack)?;
                if let Some(id) = track {
                    self.known_track(Control::SubtitleTrack, TrackKind::Subtitle, id)?;
                }
                self.told(Telling::SubtitleTrack(track))?;
                Resolved::Change(Change::SetSubtitleTrack(track))
            }
            ValidatedAction::SetSubtitleDelay { seconds } => {
                self.playing(Control::SubtitleDelay)?;
                self.told(Telling::SubtitleDelay { seconds })?;
                Resolved::Change(Change::SetSubtitleDelay(seconds))
            }
            ValidatedAction::SetSpeed { rate } => {
                self.playing(Control::Speed)?;
                self.told(Telling::Speed { rate })?;
                Resolved::Change(Change::SetSpeed(rate))
            }
            ValidatedAction::SetVolume { level } => {
                self.playing(Control::Volume)?;
                self.told(Telling::Volume { level })?;
                Resolved::Change(Change::SetVolume(level))
            }
            ValidatedAction::SetMuted { muted } => {
                self.playing(Control::Mute)?;
                self.told(Telling::Muted(muted))?;
                Resolved::Change(Change::SetMuted(muted))
            }
            ValidatedAction::NextChapter => {
                self.playing(Control::Chapter)?;
                self.told(Telling::Chapter(ChapterStep::Next))?;
                Resolved::Change(Change::Chapter(ChapterStep::Next))
            }
            ValidatedAction::PreviousChapter => {
                self.playing(Control::Chapter)?;
                self.told(Telling::Chapter(ChapterStep::Previous))?;
                Resolved::Change(Change::Chapter(ChapterStep::Previous))
            }
            ValidatedAction::SetChapter { index } => {
                self.playing(Control::Chapter)?;
                // The chapter list is the Host's own record of what the Player
                // last reported, so an index past it names nothing to move to.
                if index >= self.state.playback().chapters().len() {
                    return Err(ActionError::UnknownChapter { index });
                }
                self.told(Telling::Chapter(ChapterStep::At { index }))?;
                Resolved::Change(Change::Chapter(ChapterStep::At { index }))
            }
            ValidatedAction::SetCrop { crop } => {
                self.playing(Control::Crop)?;
                self.told(Telling::Crop(crop.clone()))?;
                Resolved::Change(Change::SetCrop(crop))
            }
            ValidatedAction::Autocrop => {
                // The Player's own script does the detecting and moves the
                // crop; the Host only asks. Its record of the rectangle follows
                // the next report, so this Change moves nothing (#119).
                self.playing(Control::Autocrop)?;
                self.told(Telling::Autocrop)?;
                Resolved::Change(Change::Autocrop)
            }
            ValidatedAction::SetAspect { aspect } => {
                self.playing(Control::Aspect)?;
                self.told(Telling::Aspect(aspect))?;
                Resolved::Change(Change::SetAspect(aspect))
            }
            ValidatedAction::NextEpisode => self.stepped(EpisodeStep::Next)?,
            ValidatedAction::PreviousEpisode => self.stepped(EpisodeStep::Previous)?,
            ValidatedAction::StopPlayback => {
                // A stop is allowed whenever the Host is on a Stream at all,
                // including a Stream that failed to open: it is how a client
                // clears the failure and goes back to what it was reading.
                if !self.state.playback().has_stream() {
                    return Err(ActionError::NothingPlaying {
                        control: Control::Stop,
                    });
                }
                self.player.stop().map_err(|error| ActionError::Playback {
                    detail: error.to_string(),
                })?;
                // Nothing is playing, so the previewer has nothing to be armed
                // for: letting the URL go ends a second connection the Stream
                // was only lent (ADR-0028).
                self.disarm_preview();
                Resolved::Change(Change::Stop)
            }
            ValidatedAction::LookHint { addon, title } => {
                // Fire-and-forget: the queue holds the read, and nothing state
                // publishes is touched (ADR-0038 §3, #278).
                self.view().look_hint(addon, title);
                Resolved::Silent
            }
        })
    }

    /// Refuse a control about a Stream the Player is not on: one that never
    /// played, one whose open failed, or one that has ended. The episode steps
    /// are the exception and go through [`Self::stepping`] instead.
    fn playing(&self, control: Control) -> Result<(), ActionError> {
        if self.state.playback().is_live() {
            return Ok(());
        }

        Err(ActionError::NothingPlaying { control })
    }

    /// Refuse an episode step about a Stream the Player is not on. A Stream
    /// that reached its end is still a position in its Title, so the step after
    /// it stays takeable — that is what the after-end affordance draws (#68);
    /// a stop or a failed open is not a position to step from.
    fn stepping(&self, control: Control) -> Result<(), ActionError> {
        let playback = self.state.playback();
        if playback.is_live() || playback.has_ended() {
            return Ok(());
        }

        Err(ActionError::NothingPlaying { control })
    }

    /// The track a control names, or the refusal that the Stream has none.
    ///
    /// Decided against the Host's own record of the Stream — what the Player
    /// last reported — and before the Player hears of it, so a client that names
    /// a track that is not there is told rather than obeyed.
    fn known_track(
        &self,
        control: Control,
        kind: TrackKind,
        id: TrackId,
    ) -> Result<(), ActionError> {
        if self.state.playback().knows_track(kind, id) {
            Ok(())
        } else {
            Err(ActionError::UnknownTrack { control, id: id.0 })
        }
    }

    /// Tell the Player one thing, in the words a client reads where it refuses.
    fn told(&self, telling: Telling) -> Result<(), ActionError> {
        self.player
            .tell(telling)
            .map_err(|error| ActionError::Playback {
                detail: error.to_string(),
            })
    }

    /// Arm the previewer for a Stream that is opening, and leave the ceiling
    /// undecided until the Player's first report says what the Stream costs.
    ///
    /// Arming is free — the worker connects on the first still, not here — and
    /// the URL is held by the previewer and nowhere else (ADR-0028).
    fn arm_preview(&mut self, url: &StreamUrl) {
        self.previewer.arm(url);
        self.preview_gate = PreviewCeiling::Waiting;
        self.preview_since = Some(self.clock.now_millis());
    }

    /// Let the Stream's URL go, and with it any second connection a still was
    /// being taken from. Nothing is armed afterwards, so nothing may be previewed.
    fn disarm_preview(&mut self) {
        self.previewer.disarm();
        self.preview_gate = PreviewCeiling::Refused;
        self.preview_since = None;
    }

    /// Take one episode step: the neighbouring Stream chosen and opened, and
    /// the change every client is told.
    ///
    /// A step is one of the two controls that legitimately open a Stream — the
    /// other is a resume — so it is a change like a `PlayStream` and not a
    /// telling: the Host asks the Addons beside what is playing and opens it.
    /// The Title that is playing's is the neighbour's too — the Host was told it
    /// when the Stream started — so the new Video's progress is recorded against
    /// the same card.
    fn stepped(&mut self, step: EpisodeStep) -> Result<Resolved, ActionError> {
        self.stepping(step.control())?;
        let chosen = self.adjacent_episode(step)?;
        let title = self.playing_title();
        self.player
            .open(&chosen.url, None)
            .map_err(|error| ActionError::Playback {
                detail: error.to_string(),
            })?;
        self.arm_preview(&chosen.url);
        Ok(Resolved::Change(Change::Play {
            chosen: Box::new(chosen),
            title: title.map(Box::new),
            start: None,
        }))
    }

    /// The Stream one step from the one playing in the direction `step` names,
    /// or why the Host will not open one.
    ///
    /// The Video playing must be an episode of a series — a reading of the id's
    /// own shape, never of the Title's `type`. Where the Video is an Addon's,
    /// the Host asks the Addons that answer `meta` for its Title, in the order
    /// they were configured, for the list that still holds the Video playing,
    /// and the Video standing beside it in the Host's series order is the one
    /// that plays; where the Video is TMDB's — a TMDB-first series' episode —
    /// the list is TMDB's own, the one the client is looking at, whose
    /// numbering the Addons may not share (ADR-0020's known hazard). That order
    /// is numbered seasons ascending, episodes within each season, then the
    /// specials, and no step crosses between the numbered seasons and the
    /// specials (ADR-0039). Either way the neighbour plays from the Addon
    /// already playing, in the spelling that Addon declares, so continuity is
    /// kept: the same `bingeGroup` where that Addon offers one, and otherwise
    /// its first playable candidate. Nothing here invents an id by arithmetic
    /// and nothing re-ranks the candidates: the neighbour is the source's own,
    /// and continuing the release is continuity rather than a score (ADR-0012,
    /// ADR-0014).
    fn adjacent_episode(&self, step: EpisodeStep) -> Result<ChosenStream, ActionError> {
        let Some(playing) = self.state.playback().chosen() else {
            // Behind `playing(Control::…)` this cannot happen, and it is a
            // refusal rather than a panic all the same.
            return Err(ActionError::NothingPlaying {
                control: step.control(),
            });
        };
        let now = &playing.now_playing;
        let refused = |detail: String| step.refusal(detail);

        let neighbour_id = match tmdb::video_id(&now.video.r#type, &now.video.id) {
            Some(video) => self.tmdb_adjacent_episode(step, video).ok_or_else(|| {
                refused(format!(
                    "TMDB lists no episode {} {}",
                    step.side(),
                    now.video
                ))
            })?,
            None => {
                let title_id = episode_title(step, &now.video)?;
                let asked = TitleRef::parse(&now.video.r#type, &title_id)
                    .map_err(|error| refused(error.to_string()))?;

                // The Title's Videos come from the first Addon that answers `meta` for
                // it and still lists the Video playing, and *that* list decides what
                // stands beside it — whether or not anything does. Two Addons can
                // number a series differently (ADR-0020), so only the list that
                // contains the Video playing is known to put the right one next to it.
                let requested_meta = ResourceRequest::new(META, &now.video.r#type, &title_id);
                let view = self.view();
                let mut neighbour_id = None;
                for addon in view.addons() {
                    if !addon.manifest().answers(&requested_meta) {
                        continue;
                    }
                    let Ok(title) = view.fetch_title(addon, &asked, &requested_meta) else {
                        continue;
                    };
                    // Only the list that still holds the Video playing is known
                    // to put the right one beside it; a list that does not hold
                    // it has nothing to say about it.
                    if !title.videos.iter().any(|video| video.id == now.video.id) {
                        continue;
                    }
                    neighbour_id = step
                        .neighbour(&title.videos, &now.video.id)
                        .map(|video| video.id.clone());
                    break;
                }

                neighbour_id.ok_or_else(|| {
                    refused(format!(
                        "no Addon lists an episode {} {}",
                        step.side(),
                        now.video
                    ))
                })?
            }
        };

        // The neighbour is played from the Addon already playing, so that the
        // release continues: another Addon's candidates would be a different set
        // of releases, which is not "the episode beside what is playing".
        let playing_addon =
            self.state.addon(&now.addon).cloned().ok_or_else(|| {
                refused(format!("the Addon {} is no longer configured", now.addon))
            })?;
        let video = VideoRef::parse(&now.video.r#type, &neighbour_id)
            .map_err(|error| refused(error.to_string()))?;
        let Some(requested_stream) = self.view().ask_of(&playing_addon, STREAM, &video) else {
            return Err(refused(format!(
                "{} has nothing for {}/{}",
                now.addon, now.video.r#type, neighbour_id
            )));
        };
        let streams = self
            .provider
            .streams(&playing_addon, &requested_stream)
            .map_err(|error| refused(error.to_string()))?;

        streams
            .iter()
            .find(|stream| stream.binge_group == now.binge_group)
            .and_then(|stream| playable(&video, playing_addon.id(), stream))
            .or_else(|| {
                streams
                    .iter()
                    .find_map(|stream| playable(&video, playing_addon.id(), stream))
            })
            .ok_or_else(|| {
                refused(format!(
                    "no candidate for {}/{} is one this Host can play",
                    now.video.r#type, neighbour_id
                ))
            })
    }

    /// The Video standing beside what is playing in TMDB's own episodes, in the
    /// direction `step` names — or nothing where TMDB lists none, the Video is
    /// a film, this Host cannot read the list, or the step would cross into the
    /// specials (ADR-0020, ADR-0039 §2).
    fn tmdb_adjacent_episode(&self, step: EpisodeStep, video: tmdb::TmdbVideo) -> Option<String> {
        let at = video.at?;
        let view = self.view();
        let key = view.tmdb_credential()?;
        let read = view.tmdb_details(video.kind, video.id, &key, &[]).ok()?;
        let videos = view.tmdb_videos(&read, video.id, &key)?;

        let id = tmdb::video_spelling(video.id, Some(at));
        step.neighbour(&videos, &id).map(|video| video.id.clone())
    }

    /// The Title's Up next and the finished Video whose Stream it continues, or
    /// why the Title has no Up next to play.
    ///
    /// Which Video is the Up next is the Host's own Continue watching decision
    /// (#274): the newest Watch progress entry of the Title, moved on to the
    /// Video after it once it is finished. The entry named by the Action is
    /// matched by type and id, the identity the row groups by.
    fn up_next(&self, title: &TitleRef) -> Result<(ContinueEntry, WatchProgress), ActionError> {
        let cards = {
            let titles = self.titles.lock().expect("the Title cache is not poisoned");
            crate::progress::continue_watching(self.state.watch(), titles.cached(), |addon| {
                self.state.has_addon(addon)
            })
        };

        let entry = cards
            .into_iter()
            .find(|entry| crate::progress::names(&entry.title, &title.r#type, &title.id))
            .ok_or_else(|| ActionError::NoUpNext {
                detail: format!("{title} is not on Continue watching, so it has no Up next"),
            })?;
        if !entry.up_next {
            return Err(ActionError::NoUpNext {
                detail: format!("{title} has no Up next: its card is not one"),
            });
        }

        // The Video before the Up next is the Title's newest entry: the card an
        // Up next was moved on from. Its Stream's Addon and release are what the
        // play continues.
        let up_next_id = entry.video.id.clone();
        let previous = self
            .state
            .watch()
            .iter()
            .filter(|held| crate::progress::names(&held.title, &title.r#type, &title.id))
            .max_by_key(|held| held.updated_at)
            .cloned()
            .filter(|held| held.watched && held.video.id != up_next_id)
            .ok_or_else(|| ActionError::NoUpNext {
                detail: format!("{title} has no finished Video to continue"),
            })?;

        Ok((entry, previous))
    }

    /// The Stream to play for an Up next: the Addon that streamed the Video
    /// before it, and the same `bingeGroup` where that Addon still offers one,
    /// and otherwise that Addon's first playable candidate (ADR-0012,
    /// ADR-0014).
    ///
    /// A different Addon is not a substitute: the Up next is the release the
    /// previous Video came from, which is continuity rather than a second
    /// ranking. Where continuity has nothing, the refusal is the one the client
    /// opens the Streams picker for (#276).
    fn up_next_stream(
        &self,
        entry: &ContinueEntry,
        previous: &WatchProgress,
    ) -> Result<ChosenStream, ActionError> {
        let refused = |detail: String| ActionError::NoUpNextStream { detail };
        let video = VideoRef::parse(entry.title.r#type(), &entry.video.id)
            .map_err(|error| refused(error.to_string()))?;
        let Some(stream_addon) = previous.stream_addon.as_ref() else {
            return Err(refused(format!(
                "the Host does not know which Addon streamed {}/{}",
                previous.video.r#type, previous.video.id
            )));
        };
        let Some(addon) = self.state.addon(stream_addon).cloned() else {
            return Err(refused(format!(
                "the Addon {stream_addon} that streamed {}/{} is no longer configured",
                previous.video.r#type, previous.video.id
            )));
        };
        let Some(requested) = self.view().ask_of(&addon, STREAM, &video) else {
            return Err(refused(format!("{stream_addon} has nothing for {video}")));
        };
        let streams = self
            .provider
            .streams(&addon, &requested)
            .map_err(|error| refused(error.to_string()))?;

        let same_release = previous
            .binge_group
            .as_ref()
            .and_then(|group| {
                streams
                    .iter()
                    .find(|stream| stream.binge_group.as_ref() == Some(group))
            })
            .and_then(|stream| playable(&video, stream_addon, stream));

        same_release
            .or_else(|| {
                streams
                    .iter()
                    .find_map(|stream| playable(&video, stream_addon, stream))
            })
            .ok_or_else(|| {
                refused(format!(
                    "no candidate for {video} is one this Host can play"
                ))
            })
    }

    /// The Stream a resume plays and where in it to start, or why the Host will
    /// not resume the Video.
    ///
    /// The Host reads its own Watch progress — the client names only the Video —
    /// asks every configured Addon that answers for its Streams, and takes the
    /// first candidate it can play. The Addon that supplied the Title has to
    /// still be configured: an entry whose Addon is gone is a stub the Snapshot
    /// marks unplayable, and opening it through some other Addon would be a
    /// different Title wearing its card (#29).
    fn resume(
        &self,
        video: &VideoRef,
    ) -> Result<(ChosenStream, TitleStub, Option<f64>), ActionError> {
        let entry =
            self.state
                .watch_for(video)
                .cloned()
                .ok_or_else(|| ActionError::NoProgress {
                    video: video.clone(),
                })?;

        // An entry with no Addon behind it — a Discovered Title — has no
        // configured Addon to check and resumes like any other (ADR-0020).
        if let Some(addon) = entry.title.addon() {
            if !self.state.has_addon(addon) {
                return Err(ActionError::Unplayable(Unplayable {
                    detail: format!(
                        "the Addon {addon} that supplied this Title is no longer configured"
                    ),
                }));
            }
        }

        let chosen = self.first_playable(video).ok_or_else(|| {
            ActionError::Unplayable(Unplayable {
                detail: format!(
                    "no configured Addon offers a Stream this Host can play for {video}"
                ),
            })
        })?;

        Ok((chosen, entry.title, entry.position))
    }

    /// The first candidate this Host can play for a Video, asked of every
    /// configured Addon that answers for it, in the configured order — the rule
    /// `FindStreams` asks every Addon by, folded to the one a Host that is
    /// opening a Stream itself needs (a resume, ADR-0015). A TMDB-keyed Video
    /// reaches each Addon in the spelling it declares (ADR-0020).
    fn first_playable(&self, video: &VideoRef) -> Option<ChosenStream> {
        for asked in self.view().asks_for(STREAM, video) {
            let Some(requested) = asked.requested else {
                continue;
            };
            // An Addon that cannot answer is one Addon with nothing, and the
            // next is still asked (ADR-0010's rule for a search).
            let Ok(streams) = self.provider.streams(&asked.addon, &requested) else {
                continue;
            };
            if let Some(candidate) = streams
                .iter()
                .find_map(|stream| playable(video, asked.addon.id(), stream))
            {
                return Some(candidate);
            }
        }

        None
    }

    /// The Title of the Video playing, as the Host was told it — which is also
    /// the neighbouring episode's Title. `None` for a Stream the Host was never
    /// told a Title of, which is played and not recorded.
    fn playing_title(&self) -> Option<TitleStub> {
        let video = self.state.playback().chosen()?.now_playing.video.clone();
        self.state
            .watch_for(&video)
            .map(|entry| entry.title.clone())
    }

    /// One configured Addon, or the refusal that names it.
    fn addon(&self, id: &AddonId) -> Result<Addon, ActionError> {
        self.state
            .addon(id)
            .cloned()
            .ok_or_else(|| ActionError::UnknownAddon {
                id: id.as_str().to_owned(),
            })
    }
}

/// An Action with everything it needed already resolved.
enum Resolved {
    Change(Change),
    /// A change that also answers the client that asked. Pairing is the only one:
    /// a token goes to the device that redeemed the code, while the device it
    /// belongs to is state every client is told of.
    Changed {
        change: Change,
        answer: Answer,
    },
    /// A fire-and-forget Action that neither changes state nor answers anybody:
    /// the look hint only queues the read-ahead of the Title a card named
    /// (ADR-0038 §3, #278).
    Silent,
}

/// A candidate for the next episode, judged: the Stream to play, or nothing
/// when this Host cannot open it — an `infoHash`, or a URL it will not open.
fn playable(video: &VideoRef, addon: &AddonId, stream: &Stream) -> Option<ChosenStream> {
    ChosenStream::parse(video.clone(), addon.clone(), stream).ok()
}

/// The Title id an episode's Video id carries, or why this Host will not take
/// it for an episode.
///
/// The one reading of the protocol's episode-id shape is [`meta::episode_of`],
/// which a Continue watching card goes through too, so the two cannot disagree
/// about what an episode is. The season and the episode numbers are deliberately
/// not returned: the neighbouring Video comes from the source's own list, walked
/// in the Host's series order — the path this is asked for, a TMDB-keyed Video
/// stepping through TMDB's list instead — and inventing an id by arithmetic is
/// exactly what ADR-0014 forbids.
fn episode_title(step: EpisodeStep, video: &VideoRef) -> Result<String, ActionError> {
    meta::episode_of(&video.id)
        .map(|(title, _, _)| title.to_owned())
        .ok_or_else(|| {
            step.refusal(format!(
                "{video} is playing, and it is not an episode of a series"
            ))
        })
}

/// Which way a step from the Video playing goes: to the one after it in its
/// Title's order, or the one before (ADR-0014, ADR-0021, ADR-0039).
///
/// The two directions are one rule read the other way, so the refusal they name
/// and the Video they take from the Host's series order are decided here once
/// rather than copied per direction.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EpisodeStep {
    Next,
    Previous,
}

impl EpisodeStep {
    /// The Video standing beside `id` in the Host's series order, in this
    /// direction — `None` at either end of the run, and never across the line
    /// between the numbered seasons and the specials (ADR-0039 §2).
    fn neighbour<'a>(self, videos: &'a [Video], id: &str) -> Option<&'a Video> {
        match self {
            Self::Next => meta::next_video(videos, id),
            Self::Previous => meta::previous_video(videos, id),
        }
    }

    /// The one word a refusal's sentence uses for this direction.
    fn side(self) -> &'static str {
        match self {
            Self::Next => "after",
            Self::Previous => "before",
        }
    }

    /// The control a refusal with nothing playing names.
    fn control(self) -> Control {
        match self {
            Self::Next => Control::NextEpisode,
            Self::Previous => Control::PreviousEpisode,
        }
    }

    /// The refusal this direction reports: `no_next_episode`, or its twin.
    fn refusal(self, detail: String) -> ActionError {
        match self {
            Self::Next => ActionError::NoNextEpisode { detail },
            Self::Previous => ActionError::NoPreviousEpisode { detail },
        }
    }
}
