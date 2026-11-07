//! A frozen view of the Host, and the questions that resolve from it.
//!
//! A question — browsing a Catalog, searching, Discover, opening a Title,
//! finding Streams — reads state and then reaches the network. It must not hold
//! the Host's change lock for the length of that fetch, or one slow Addon queues
//! every other client behind it (ADR-0022).
//!
//! So the door clones a [`HostView`] under a short lock and lets the question
//! resolve outside it. What is frozen is the Addon list, which is the state a
//! question reads: a question that was dispatched before an Addon was removed may
//! still answer from it, and a change never waits for the question's fetch. The
//! credential and the page cache are *shared* rather than copied — a credential
//! is read at the moment of use and the cache is a memo, not state a client sees.
//!
//! The two questions that ask a set of Addons — `search_catalogs` and
//! `find_streams` — fan their asks out inside the question, under a bound, and
//! still answer in configured order (ADR-0023).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::action::{ActionError, ValidatedAction};
use crate::addon::{Addon, AddonId, Manifest, MAX_ITEMS};
use crate::background::{BackgroundQueue, Job, RevisionSink, Work};
use crate::cache::CatalogCache;
use crate::catalog::{CatalogRow, Page};
use crate::clock::Clock;
use crate::discover::DiscoverRow;
use crate::fetcher::{FetchError, Fetcher};
use crate::library::{Library, LibraryCache};
use crate::log::millis;
use crate::meta::{self, Title, TitleKey, Video};
use crate::preview::{PreviewCeiling, Previewer};
use crate::progress::WatchProgress;
use crate::provider::Provider;
use crate::request::{
    CatalogRef, Extra, ResourceRequest, TitleRef, VideoRef, CATALOG, META, STREAM,
};
use crate::response::Answer;
use crate::secret::{CredentialKind, SecretStore};
use crate::stream::AddonStreams;
use crate::stremio::StremioApi;
use crate::title_cache::{CachedTitle, TitleCache, TitleProbe, TitleProtection, TitleSource};
use crate::tmdb;

/// The Host as a question sees it: the Addon list frozen at dispatch, the seams
/// it reaches, and the one page cache every view shares.
///
/// Built by [`crate::Host::view`] under the change lock. Every field is either
/// owned or an `Arc`, so the view is `Send + Sync` and a question resolves on any
/// thread without the Host's state lock.
/// The seams and memos a view shares with the Host and every other view.
///
/// Grouped so [`HostView::new`] names one shared thing rather than growing an
/// argument list every time a question gains a seam; the fields are still one
/// `Arc` each, never a copied Host state.
pub(crate) struct HostViewShared {
    pub(crate) cache: Arc<Mutex<CatalogCache>>,
    pub(crate) library_cache: Arc<Mutex<LibraryCache>>,
    pub(crate) stremio: Option<Arc<dyn StremioApi>>,
    pub(crate) titles: Arc<Mutex<TitleCache>>,
    /// The work waiting to run outside the change lock. Shared so that a stale
    /// open, which resolves in a view, can hand a refresh to the Host's one
    /// queue (ADR-0038 §2).
    pub(crate) background: Arc<Mutex<BackgroundQueue>>,
    pub(crate) clock: Arc<dyn Clock>,
    /// The Watch progress when this view was frozen: the entries Continue
    /// watching is drawn from. A Title those entries name must never be
    /// evicted (ADR-0038 §1), and a cache write that moves one of their cards
    /// is a Snapshot even though a question made it (#274, #277).
    pub(crate) watch: Vec<WatchProgress>,
    /// The Titles the account's Library held when it was last read. The
    /// Library is read after the cache is loaded, so these probes are how a
    /// later write keeps its Titles (ADR-0038 §1).
    pub(crate) library: Vec<TitleProbe>,
}

pub struct HostView {
    /// The configured Addons, in the Host's order, as they stood when the view
    /// was taken. A change that removes one afterwards does not invalidate a
    /// question already dispatched (ADR-0022).
    addons: Vec<Addon>,
    fetcher: Arc<dyn Fetcher>,
    provider: Arc<dyn Provider>,
    secrets: Arc<dyn SecretStore>,
    /// The stills of the Stream playing, asked for by a client pointing at its
    /// timeline. Shared with the Host and every view; the URL it holds never
    /// leaves it (ADR-0028).
    previewer: Arc<dyn Previewer>,
    /// Whether the Stream may be previewed, as the Host last decided it. Frozen
    /// with the rest of the view, so a still is never asked for on a Stream whose
    /// ceiling has not been settled — or has been settled against it.
    preview_gate: PreviewCeiling,
    /// The pages Addons have already answered, shared with the Host and every
    /// other view. Its lock is taken for `fresh`, `when_stale` and `keep` and is
    /// never held across a fetch: two questions asking for different pages do not
    /// queue behind each other.
    cache: Arc<Mutex<CatalogCache>>,
    /// The account's Library documents, shared with the Host and every view.
    /// Like the catalog cache this is a memo: a question takes the lock for the
    /// plan, the keep and the read, never across the account's network call.
    library_cache: Arc<Mutex<LibraryCache>>,
    /// The account API, where the Host was built with one. No account or no
    /// `authKey` is a Host that does not read the room; the key itself is read
    /// from the secret store at the moment of the ask (ADR-0029).
    stremio: Option<Arc<dyn StremioApi>>,
    /// The Titles the Host has read, shared with it and every other view. A
    /// question takes the lock to read one before it fetches and to keep what
    /// it fetched; the lock is never held across a fetch (ADR-0038).
    titles: Arc<Mutex<TitleCache>>,
    /// The Host's background queue. A stale open pushes a refresh and answers
    /// the cached copy; the door runs the queue outside the change lock
    /// (ADR-0038 §2).
    background: Arc<Mutex<BackgroundQueue>>,
    /// The Host's clock, so that "fresh" is a fact a test decides.
    clock: Arc<dyn Clock>,
    /// The Watch progress when this view was frozen: what Continue watching is
    /// drawn from. A Title those entries name must never be evicted, and a
    /// cache write that moves one of their cards publishes a Snapshot
    /// (ADR-0038 §1, #274, #277).
    watch: Vec<WatchProgress>,
    /// The Titles the account's Library held when it was last read, frozen with
    /// the rest of the view (ADR-0038 §1).
    library: Vec<TitleProbe>,
    /// Whether keeping a Title in this view's one question moved the Continue
    /// watching row. Set by [`HostView::keep_title`] and read once after the
    /// question resolves, because the question is the only thing that knows
    /// what its cache write did (#274, #277).
    moved: AtomicBool,
}

/// What a TMDB refinement read, and what it said about a series' run.
#[derive(Debug, Default)]
struct TmdbRead {
    /// Whether a details record was read at all. A `find` that mapped an
    /// identity but whose record was not read leaves the Title an Addon's.
    details: bool,
    status: Option<tmdb::SeriesStatus>,
    /// The episode the record said comes next, where it named one.
    next_episode: Option<tmdb::NextEpisode>,
}

/// One record read from TMDB: its details, and the seasons the one details
/// request carried.
#[derive(Debug)]
pub(crate) struct RecordRead {
    pub(crate) details: tmdb::TmdbDetails,
    /// The seasons the answer was asked to append, ascending. Every season the
    /// record lists that is not here is read in a further batch.
    appended: Vec<u32>,
}

/// A Title opened from TMDB's own record, and the record's word on the series.
struct OpenedTitle {
    title: Title,
    status: Option<tmdb::SeriesStatus>,
    next_episode: Option<tmdb::NextEpisode>,
}

/// One Title as a read produced it, with the facts the cache decides on: where
/// it came from, what TMDB said about the series' run and what it announced.
struct KeptTitle {
    title: Title,
    source: TitleSource,
    status: Option<tmdb::SeriesStatus>,
    next_episode: Option<tmdb::NextEpisode>,
}

/// What a question answered, and whether keeping the Title it read moved
/// Continue watching.
///
/// The Answer still goes only to the client that asked (ADR-0005); `moved` is
/// the separate fact that the cache write changed a row every client draws, so
/// the door publishes the Snapshot it owes (#274, #277).
#[derive(Debug, Clone)]
pub(crate) struct Answered {
    pub(crate) answer: Answer,
    pub(crate) moved: bool,
}

impl HostView {
    pub(crate) fn new(
        addons: Vec<Addon>,
        fetcher: Arc<dyn Fetcher>,
        provider: Arc<dyn Provider>,
        secrets: Arc<dyn SecretStore>,
        previewer: Arc<dyn Previewer>,
        preview_gate: PreviewCeiling,
        shared: HostViewShared,
    ) -> Self {
        Self {
            addons,
            fetcher,
            provider,
            secrets,
            previewer,
            preview_gate,
            cache: shared.cache,
            library_cache: shared.library_cache,
            stremio: shared.stremio,
            titles: shared.titles,
            background: shared.background,
            clock: shared.clock,
            watch: shared.watch,
            library: shared.library,
            moved: AtomicBool::new(false),
        }
    }

    /// The Addons this view froze, in the Host's order — for a change that walks
    /// them with the same read-only helpers a question uses.
    pub(crate) fn addons(&self) -> &[Addon] {
        &self.addons
    }

    /// Resolve one of the nine questions.
    ///
    /// The door routes by [`ValidatedAction::is_question`](crate::ValidatedAction::is_question);
    /// a change reaching here is a door bug, refused rather than resolved. The
    /// read-only helpers this calls are also used by changes (`Resume`,
    /// `NextEpisode`, `PreviousEpisode`) through their own short view.
    ///
    /// `revisions` is where an Answer that arrives after the Response goes: the
    /// client whose open queued a background refresh, and nobody else. A
    /// question dispatched without one still refreshes; it just has nobody to
    /// tell (ADR-0038 §2).
    pub(crate) fn ask(
        &self,
        validated: ValidatedAction,
        revisions: Option<&Arc<dyn RevisionSink>>,
    ) -> Result<Answered, ActionError> {
        let answer = match &validated {
            ValidatedAction::BrowseCatalog {
                addon,
                catalog,
                extra,
            } => {
                let configured = self.addon(addon)?;
                let requested =
                    ResourceRequest::new(CATALOG, &catalog.r#type, &catalog.id).with_extra(
                        with_required_values(configured.manifest(), catalog, extra.clone()),
                    );
                if !configured.manifest().answers(&requested) {
                    return Err(why_not(configured.manifest(), catalog, &requested));
                }

                let row = self.catalog_row(&configured, &requested);
                Answer::Catalogs(vec![row])
            }
            ValidatedAction::SearchCatalogs { query } => {
                // Every catalog that offers a search, in the order the Addons
                // are configured, and each Addon's own order within that. One
                // Addon failing is one row with nothing in it, not a failed
                // search (ADR-0010). The asks fan out, and the rows are written
                // back by plan position, so completion order changes nothing a
                // client sees (ADR-0023).
                let plan: Vec<(&Addon, ResourceRequest)> = self
                    .addons
                    .iter()
                    .flat_map(|addon| {
                        addon.manifest().catalogs.iter().filter_map(move |catalog| {
                            let extra = catalog.search_extra(query)?;
                            Some((
                                addon,
                                ResourceRequest::new(
                                    CATALOG,
                                    catalog.r#type.as_str(),
                                    catalog.id.as_str(),
                                )
                                .with_extra(extra),
                            ))
                        })
                    })
                    .collect();

                let rows = fan_out(&plan, |(addon, requested)| {
                    let started = Instant::now();
                    let row = self.catalog_row(addon, requested);
                    // A cache hit is still this Addon's row, and still an ask
                    // worth timing; the line has no field for which it was.
                    addon_ask_log(
                        CATALOG,
                        addon.id(),
                        started.elapsed(),
                        row.failure.as_ref().map_or("ok", ActionError::kind),
                    );
                    row
                });
                Answer::Catalogs(rows)
            }
            ValidatedAction::Discover { query } => {
                // A Discover page is never cached: TMDB sends no cache hints to
                // honour and a feed is a live thing whose staleness is worse
                // than its latency, so every page reaches it (ADR-0020). A
                // credential that is not held refuses the ask itself, before a
                // row exists: there is nothing to ask TMDB with.
                let credential = self
                    .tmdb_credential()
                    .ok_or(ActionError::NoTmdbCredential)?;
                let row = self.tmdb_row(&query.request(), query.kind, &credential);
                Answer::Discover(vec![row])
            }
            ValidatedAction::Search { query } => {
                // Search with a key held is TMDB's, and never cached: every
                // submit and every page reaches it (ADR-0010's amendment). With
                // no key held the Addons' catalogs are the whole of Search, and
                // this question names no Addon to fall back to, so it refuses
                // before a row exists.
                let credential = self
                    .tmdb_credential()
                    .ok_or(ActionError::NoTmdbCredential)?;
                let row = self.tmdb_row(&query.request(), query.kind, &credential);
                Answer::Search(row)
            }
            ValidatedAction::OpenTitle { addon, title } => {
                let now = self.clock.now_millis();
                let cached = self.cached_for_addon(addon, title, now);
                if let Some(cached) = &cached {
                    if cached.is_fresh(now) {
                        return Ok(self.answered(Answer::Title(Box::new(cached.title.clone()))));
                    }
                    // Stale: the cached copy is the whole Answer, and the
                    // refresh happens behind the client (ADR-0038 §2). A
                    // refresh that fails keeps this copy; one that differs
                    // sends this client a revised Answer.
                    self.queue_refresh(
                        Work::Addon {
                            addon: addon.clone(),
                            asked: title.clone(),
                        },
                        cached,
                        revisions,
                    );
                    return Ok(self.answered(Answer::Title(Box::new(cached.title.clone()))));
                }

                // Absent: fetched, kept and answered as before.
                let read = self.read_title(addon, title, None)?;
                self.keep_title(&read, None, now);
                Answer::Title(Box::new(read.title))
            }
            ValidatedAction::OpenDiscoveredTitle { id, kind } => {
                let now = self.clock.now_millis();
                let cached = self.cached_for_tmdb(*id, *kind, now);
                if let Some(cached) = &cached {
                    if cached.is_fresh(now) {
                        return Ok(self.answered(Answer::Title(Box::new(cached.title.clone()))));
                    }
                    // Stale, the same as an Addon's Title: answer the cached
                    // copy and read it again behind the client (ADR-0038 §2).
                    self.queue_refresh(
                        Work::Discovered {
                            id: *id,
                            kind: *kind,
                        },
                        cached,
                        revisions,
                    );
                    return Ok(self.answered(Answer::Title(Box::new(cached.title.clone()))));
                }

                let read = self.read_discovered(*id, *kind, None)?;
                self.keep_title(&read, None, now);
                Answer::Title(Box::new(read.title))
            }
            ValidatedAction::FindStreams { video } => {
                // Every configured Addon that answers for it, in the order
                // they are configured, each answer a group of its own: one
                // Addon failing is that group with nothing in it, not a
                // question that fails (ADR-0010 — a search's rule, applied to
                // Streams). A TMDB-keyed Video is asked of each Addon in the
                // spelling that Addon declares (ADR-0020). The asks fan out and
                // the groups come back in configured order, never completion
                // order (ADR-0023).
                let asked = self.asks_for(STREAM, video);
                // An Addon that declares no spelling this Host can build is not
                // asked: its group stays empty at its configured index, and it
                // does not take one of the fan-out's eight slots (ADR-0020,
                // ADR-0023). Every other Addon is one ask to be timed.
                let mut slots: Vec<Option<AddonStreams>> = asked
                    .iter()
                    .map(|asked| {
                        asked.requested.is_none().then(|| AddonStreams {
                            addon: asked.addon.id().clone(),
                            streams: Vec::new(),
                            failure: None,
                        })
                    })
                    .collect();
                let asks: Vec<(usize, &Asked)> = asked
                    .iter()
                    .enumerate()
                    .filter(|(_, asked)| asked.requested.is_some())
                    .collect();

                let answers = fan_out(&asks, |(index, asked)| {
                    let requested = asked
                        .requested
                        .as_ref()
                        .expect("the fan-out plan holds only asked Addons");
                    let started = Instant::now();
                    let (streams, failure) = match self.provider.streams(&asked.addon, requested) {
                        Ok(streams) => (streams, None),
                        Err(failure) => (Vec::new(), Some(failure)),
                    };
                    addon_ask_log(
                        STREAM,
                        asked.addon.id(),
                        started.elapsed(),
                        failure.as_ref().map_or("ok", ActionError::kind),
                    );
                    (
                        *index,
                        AddonStreams {
                            addon: asked.addon.id().clone(),
                            streams,
                            failure,
                        },
                    )
                });
                for (index, group) in answers {
                    slots[index] = Some(group);
                }
                Answer::Streams(
                    slots
                        .into_iter()
                        .map(|group| group.expect("every Streams slot is filled"))
                        .collect(),
                )
            }
            // A still for one moment of the Stream playing, from the previewer's
            // own limb — never from the picture on screen (ADR-0028). A Stream
            // whose ceiling is not settled yet, or is settled against it, is
            // never asked about: the gate is what keeps the second connection
            // from being opened for a question that is already answered.
            ValidatedAction::Preview { at } => Answer::Preview {
                at: *at,
                image: self
                    .preview_gate
                    .affordable()
                    .then(|| self.previewer.preview(*at))
                    .flatten()
                    .map(|frame| frame.image().to_owned()),
            },
            ValidatedAction::Library => Answer::Library(self.library()?),
            // The door classifies before it gets here; a change is refused
            // rather than answered. Every change is named, so adding one to
            // `ValidatedAction` fails to compile until it is classified here
            // as well as in `is_question` and `Host::change`.
            ValidatedAction::SetSubtitleLanguage(_)
            | ValidatedAction::ClearSubtitleLanguage
            | ValidatedAction::SetSubtitleColor(_)
            | ValidatedAction::SetSubtitleScale(_)
            | ValidatedAction::SetStreamBuffer(_)
            | ValidatedAction::SetUpNextPlayback(_)
            | ValidatedAction::SetFeaturedCatalog { .. }
            | ValidatedAction::ClearFeaturedCatalog
            | ValidatedAction::AddAddon(_)
            | ValidatedAction::ReorderAddon { .. }
            | ValidatedAction::RemoveAddon(_)
            | ValidatedAction::SetTmdbKey(_)
            | ValidatedAction::ClearTmdbKey
            | ValidatedAction::SignInStremio(_)
            | ValidatedAction::SignOutStremio
            | ValidatedAction::PairDevice { .. }
            | ValidatedAction::RevokeDevice(_)
            | ValidatedAction::PlayStream { .. }
            | ValidatedAction::Resume { .. }
            | ValidatedAction::PlayUpNext { .. }
            | ValidatedAction::SetPaused { .. }
            | ValidatedAction::Seek { .. }
            | ValidatedAction::SetAudioTrack { .. }
            | ValidatedAction::SetSubtitleTrack { .. }
            | ValidatedAction::SetSubtitleDelay { .. }
            | ValidatedAction::SetSpeed { .. }
            | ValidatedAction::SetVolume { .. }
            | ValidatedAction::SetMuted { .. }
            | ValidatedAction::NextChapter
            | ValidatedAction::PreviousChapter
            | ValidatedAction::SetChapter { .. }
            | ValidatedAction::SetCrop { .. }
            | ValidatedAction::Autocrop
            | ValidatedAction::SetAspect { .. }
            | ValidatedAction::NextEpisode
            | ValidatedAction::PreviousEpisode
            | ValidatedAction::StopPlayback
            | ValidatedAction::LookHint { .. } => {
                return Err(ActionError::Malformed {
                    detail: "a change is not a question".to_owned(),
                })
            }
        };

        Ok(self.answered(answer))
    }

    /// One Answer, with whether this question's cache write moved the row.
    fn answered(&self, answer: Answer) -> Answered {
        Answered {
            answer,
            moved: self.moved.swap(false, Ordering::Relaxed),
        }
    }

    /// One configured Addon in this view, or the refusal that names it.
    fn addon(&self, id: &AddonId) -> Result<Addon, ActionError> {
        self.addons
            .iter()
            .find(|addon| addon.id() == id)
            .cloned()
            .ok_or_else(|| ActionError::UnknownAddon {
                id: id.as_str().to_owned(),
            })
    }

    /// One catalog row: what is cached, or what the Addon answers, or why it
    /// could not answer — with what was cached served instead when the Addon
    /// said it may be.
    fn catalog_row(&self, addon: &Addon, requested: &ResourceRequest) -> CatalogRow {
        let url = requested.url(addon.manifest_url().as_str());
        let name = addon
            .manifest()
            .catalog(&requested.r#type, &requested.id)
            .map(|catalog| catalog.name.clone())
            .unwrap_or_else(|| requested.id.clone());

        let (sent, metas, failure) = match self.fresh(&url) {
            Some(page) => (page.sent, page.metas, None),
            None => match self.fetch_page(&url) {
                Ok(page) => (page.sent, page.metas, None),
                Err(failure) => match self.when_stale(&url) {
                    Some(page) => (page.sent, page.metas, None),
                    None => (0, Vec::new(), Some(failure)),
                },
            },
        };

        CatalogRow {
            addon: addon.id().clone(),
            r#type: requested.r#type.clone(),
            id: requested.id.clone(),
            name,
            sent,
            metas,
            failure,
        }
    }

    /// Fetch one page and keep it for as long as its Addon says it lasts.
    ///
    /// The fetch and the parse are outside the cache lock, and `keep` takes it
    /// only to write the page back: a slow Addon holds no lock at all.
    fn fetch_page(&self, url: &str) -> Result<Page, ActionError> {
        let body = self
            .fetcher
            .fetch(url)
            .map_err(|error| ActionError::Fetch {
                detail: error.to_string(),
            })?;
        let page = Page::parse(&body).map_err(|error| ActionError::Catalog {
            detail: error.to_string(),
        })?;

        self.cache
            .lock()
            .expect("nothing panics while holding the catalog cache")
            .keep(url, page.sent, page.metas.clone(), page.hints);
        Ok(page)
    }

    /// The page for this URL while the Addon says it is still good.
    fn fresh(&self, url: &str) -> Option<crate::cache::Kept> {
        self.cache
            .lock()
            .expect("nothing panics while holding the catalog cache")
            .fresh(url)
    }

    /// The same, for an Addon that cannot be reached.
    fn when_stale(&self, url: &str) -> Option<crate::cache::Kept> {
        self.cache
            .lock()
            .expect("nothing panics while holding the catalog cache")
            .when_stale(url)
    }

    /// One page of TMDB's, whether a Discover feed or a Search: what TMDB
    /// answered, or why it could not — the failure in the Host's vocabulary, as
    /// a row rather than as a refused screen, so one failed call does not blank
    /// the feed or the row (ADR-0010's amendment, ADR-0020).
    ///
    /// Nothing is kept: the page is read and dropped with the answer that
    /// carried it, so the same page asked for twice reaches TMDB twice.
    fn tmdb_row(
        &self,
        request: &tmdb::TmdbRequest,
        kind: tmdb::Kind,
        credential: &tmdb::Credential,
    ) -> DiscoverRow {
        let protocol = kind.as_protocol().to_owned();
        let failed = |failure: ActionError| DiscoverRow {
            r#type: protocol.clone(),
            sent: 0,
            metas: Vec::new(),
            failure: Some(failure),
        };

        match self.fetch_tmdb(request, credential) {
            Err(error) => failed(tmdb_failure(error)),
            Ok(body) => match tmdb::read_page(&body, kind) {
                Ok(page) => DiscoverRow {
                    r#type: protocol,
                    sent: page.sent,
                    metas: page.metas,
                    failure: None,
                },
                Err(error) => failed(ActionError::Tmdb {
                    detail: error.to_string(),
                }),
            },
        }
    }

    /// The cached copy of a Title opened through an Addon, if one is held and
    /// still within TMDB's terms.
    fn cached_for_addon(&self, addon: &AddonId, asked: &TitleRef, now: i64) -> Option<CachedTitle> {
        self.titles
            .lock()
            .expect("the Title cache is not poisoned")
            .for_addon(addon, asked, now)
    }

    /// The cached copy of a Discovered Title, if one is held and still within
    /// TMDB's terms.
    fn cached_for_tmdb(&self, id: tmdb::TmdbId, kind: tmdb::Kind, now: i64) -> Option<CachedTitle> {
        self.titles
            .lock()
            .expect("the Title cache is not poisoned")
            .for_tmdb(id, kind, now)
    }

    /// Keep a Title this view just read, answering whether the Continue
    /// watching row now draws something different.
    ///
    /// A cache write is not by itself a change a client sees: a look hint on a
    /// Discover card keeps a Title no card is drawn from, and publishing a
    /// Snapshot for it would move a revision for nothing (#278). What matters
    /// is the row: the same Title may have gained the Video that follows a
    /// finished card, or the list a card was waiting on. That is compared
    /// before and after the write, so a new episode nobody's card names does
    /// not publish either.
    ///
    /// A failed write is not a failed open: the answer is already in hand, and
    /// the cache is the part that outlives it (ADR-0038 §1).
    fn keep_title(&self, read: &KeptTitle, replacing: Option<TitleKey>, now: i64) -> bool {
        let protection = self.protection();
        let addon_held = |addon: &AddonId| self.addons.iter().any(|held| held.id() == addon);
        let mut cache = self.titles.lock().expect("the Title cache is not poisoned");
        let before = crate::progress::continue_watching(&self.watch, cache.cached(), addon_held);
        let changed = cache.keep(
            CachedTitle {
                title: read.title.clone(),
                read_at: now,
                source: read.source,
                status: read.status,
                next_episode: read.next_episode,
            },
            replacing,
            &protection,
            now,
        );
        let after = crate::progress::continue_watching(&self.watch, cache.cached(), addon_held);

        let moved = changed && before != after;
        if moved {
            self.moved.store(true, Ordering::Relaxed);
        }
        moved
    }

    /// Queue the refresh a stale open owes, addressed to the client that asked.
    ///
    /// The job is keyed by the cached copy's own key, so two clients opening
    /// one stale Title — through the Addon's id or TMDB's — queue one refresh.
    fn queue_refresh(
        &self,
        work: Work,
        cached: &CachedTitle,
        revisions: Option<&Arc<dyn RevisionSink>>,
    ) {
        let mut job = Job {
            key: cached.title.key.clone(),
            answered: Some(cached.title.clone()),
            work,
            askers: Vec::new(),
        };
        if let Some(sink) = revisions {
            job.askers.push(sink.clone());
        }
        self.background
            .lock()
            .expect("the background queue is not poisoned")
            .enqueue(job);
    }

    /// Queue the read-ahead a card's look hint asks for (ADR-0038 §3, #278).
    ///
    /// A fresh copy is not read again. A stale copy is refreshed with no asker:
    /// a hint answers nobody, so nothing is revised when the read lands. An
    /// uncached Title is read and kept, which is what makes the next open
    /// instant. A hint for something no source here could answer — an Addon no
    /// longer configured, or an id that is not TMDB's — queues nothing: it is
    /// fire-and-forget, and there would be nobody to tell that it bought
    /// nothing.
    pub(crate) fn look_hint(&self, addon: Option<AddonId>, title: TitleRef) {
        let now = self.clock.now_millis();
        let (key, cached, work) = match addon {
            Some(addon) => {
                let cached = self.cached_for_addon(&addon, &title, now);
                if cached.as_ref().is_some_and(|cached| cached.is_fresh(now)) {
                    return;
                }
                let key = match &cached {
                    Some(cached) => cached.title.key.clone(),
                    None => {
                        if !self.addons.iter().any(|held| held.id() == &addon) {
                            return;
                        }
                        TitleKey::Addon {
                            addon: addon.clone(),
                            id: title.id.clone(),
                        }
                    }
                };
                (
                    key,
                    cached,
                    Work::Addon {
                        addon,
                        asked: title,
                    },
                )
            }
            None => {
                // A card that names no Addon is a Discovered Title, whose id is
                // TMDB's own `tmdb:<id>` spelling (ADR-0020). An IMDb id with no
                // Addon behind it is not one this Host can read ahead.
                let (Some(tmdb::ExternalId::Tmdb(id)), Some(kind)) = (
                    tmdb::ExternalId::parse(&title.r#type, &title.id),
                    tmdb::Kind::parse(&title.r#type),
                ) else {
                    return;
                };
                let cached = self.cached_for_tmdb(id, kind, now);
                if cached.as_ref().is_some_and(|cached| cached.is_fresh(now)) {
                    return;
                }
                let key = match &cached {
                    Some(cached) => cached.title.key.clone(),
                    None => TitleKey::Tmdb { id: id.0 },
                };
                (key, cached, Work::Discovered { id, kind })
            }
        };

        let job = Job {
            key,
            answered: cached.map(|cached| cached.title),
            work,
            askers: Vec::new(),
        };
        self.background
            .lock()
            .expect("the background queue is not poisoned")
            .enqueue(job);
    }

    /// Run every background job waiting, a bounded fan-out at a time, and answer
    /// how many ran and whether any of them changed a kept Title.
    ///
    /// The queue's own lock is taken to take the jobs; nothing is held while a
    /// job fetches. The fan-out is ADR-0023's bound, reused so that a server
    /// with several stale Titles waiting is read a handful at a time rather
    /// than one after another (ADR-0038 §3).
    pub(crate) fn drain(&self, jobs: Vec<Job>) -> (usize, bool) {
        let count = jobs.len();
        if count == 0 {
            return (0, false);
        }
        let changed = fan_out(&jobs, |job| self.refresh(job))
            .into_iter()
            .any(|moved| moved);
        (count, changed)
    }

    /// Read one stale Title again, keep what came back, and answer the clients
    /// that asked when it differs.
    ///
    /// A failed read — an Addon gone, TMDB down, a `429` — changes nothing: the
    /// cached copy stands, and nobody is told (ADR-0038 §2).
    fn refresh(&self, job: &Job) -> bool {
        let now = self.clock.now_millis();
        let replacing = job.key.clone();
        let read = match &job.work {
            Work::Addon { addon, asked } => self.read_title(addon, asked, job.answered.as_ref()),
            Work::Discovered { id, kind } => {
                self.read_discovered(*id, *kind, job.answered.as_ref())
            }
            Work::CatchUp { id, season, source } => {
                // A caught-up check is only ever queued for a copy it re-reads;
                // a job that collapsed into one without it is not a check.
                let Some(answered) = job.answered.as_ref() else {
                    return false;
                };
                self.read_caught_up(*id, *season, *source, answered)
            }
        };
        let Ok(read) = read else {
            return false;
        };

        let moved = self.keep_title(&read, Some(replacing), now);

        // A read-ahead answers nobody; a refresh with askers sends the revised
        // Answer only to them (ADR-0005). Either way, a cache write that moved
        // Continue watching is a Snapshot every client is owed (#274, #277).
        if job.askers.is_empty() {
            return moved;
        }

        let news = job
            .answered
            .as_ref()
            .is_none_or(|answered| read.title != *answered);
        if news {
            let answer = Answer::Revision(Box::new(read.title));
            for asker in &job.askers {
                asker.revise(answer.clone());
            }
        }

        moved
    }

    /// Read a Title the way an open does: the Addon that supplied it, and
    /// TMDB's record where it meets the Title — or TMDB alone once the Addon
    /// is gone and the copy is keyed by a record (ADR-0020, ADR-0038 §2).
    ///
    /// The Videos are returned in the one order the Title answer publishes
    /// (ADR-0039 §1). `cached` is the copy a stale open was answered from: its
    /// key decides whether an absent Addon leaves TMDB something to ask, and its
    /// identity is kept when TMDB is what answers, because the Title is still
    /// the one the client opened, however it was described.
    fn read_title(
        &self,
        addon: &AddonId,
        asked: &TitleRef,
        cached: Option<&Title>,
    ) -> Result<KeptTitle, ActionError> {
        let configured = self.addons.iter().find(|held| held.id() == addon).cloned();

        let (mut title, source, status, next_episode) = match configured {
            Some(configured) => {
                let requested = ResourceRequest::new(META, &asked.r#type, &asked.id);
                if !configured.manifest().answers(&requested) {
                    return Err(ActionError::UnknownTitle {
                        addon: configured.id().clone(),
                        title: asked.clone(),
                    });
                }

                // The request the Addon was judged on is the one it is asked
                // with: a second construction is a second thing that can drift.
                let mut fetched = self.fetch_title(&configured, asked, &requested)?;
                let word = self.tmdb_refine(&mut fetched);
                let source = if word.details {
                    TitleSource::Both
                } else {
                    TitleSource::Addon
                };
                (fetched, source, word.status, word.next_episode)
            }
            None => {
                let id = cached.and_then(|title| match &title.key {
                    TitleKey::Tmdb { id } => Some(tmdb::TmdbId(*id)),
                    TitleKey::Addon { .. } => None,
                });
                let kind = id.and_then(|_| tmdb::Kind::parse(&asked.r#type));
                match (id, kind, cached) {
                    (Some(id), Some(kind), Some(cached)) => {
                        let read = self.read_discovered_onto(cached, id, kind)?;
                        return Ok(read);
                    }
                    _ => {
                        return Err(ActionError::UnknownAddon {
                            id: addon.as_str().to_owned(),
                        })
                    }
                }
            }
        };

        title.videos = meta::ordered_videos(&title.videos);
        Ok(KeptTitle {
            title,
            source,
            status,
            next_episode,
        })
    }

    /// Read a Discovered Title: TMDB's record is the whole of it, in the one
    /// order the Title answer publishes (ADR-0020, ADR-0039 §1).
    ///
    /// `cached` is the copy a stale open answered from, where it did: its
    /// Videos already carry the record's season numbering, so the first batch
    /// is built from them rather than the protocol's guess (#270).
    fn read_discovered(
        &self,
        id: tmdb::TmdbId,
        kind: tmdb::Kind,
        cached: Option<&Title>,
    ) -> Result<KeptTitle, ActionError> {
        let hint = cached
            .map(|title| seasons_of(&title.videos))
            .unwrap_or_default();
        let opened = self.open_discovered(id, kind, &hint)?;
        let mut title = opened.title;
        title.videos = meta::ordered_videos(&title.videos);
        Ok(KeptTitle {
            title,
            source: TitleSource::Tmdb,
            status: opened.status,
            next_episode: opened.next_episode,
        })
    }

    /// Read a caught-up series again from TMDB's record with one season
    /// appended, and merge that season onto the cached copy (#277).
    ///
    /// The record's `next_episode_to_air` names the season when it is set; with
    /// nothing announced, the newest season the cached list holds is read. Only
    /// that season is asked for, because the rest are not what the hint is about
    /// (ADR-0038 §4, §5). A season the answer did not carry leaves the cached
    /// Videos standing, so a failed season changes nothing.
    fn read_caught_up(
        &self,
        id: tmdb::TmdbId,
        season: u32,
        source: TitleSource,
        cached: &Title,
    ) -> Result<KeptTitle, ActionError> {
        let key = self
            .tmdb_credential()
            .ok_or(ActionError::NoTmdbCredential)?;
        let request = tmdb::TmdbRequest::DetailsWithSeasons {
            kind: tmdb::Kind::Tv,
            id,
            seasons: vec![season],
        };
        let body = self.fetch_tmdb(&request, &key).map_err(tmdb_failure)?;
        let details =
            tmdb::read_details(&body, tmdb::Kind::Tv).map_err(|error| ActionError::Tmdb {
                detail: error.to_string(),
            })?;
        let season_read =
            tmdb::read_season_batch(&body, id, &[season]).map_err(|error| ActionError::Tmdb {
                detail: error.to_string(),
            })?;

        let mut title = cached.clone();
        title.key = TitleKey::Tmdb { id: id.0 };
        let status = details.status;
        let next_episode = details.next_episode;
        details.with_videos(None).onto(&mut title);
        if season_read.seasons > 0 {
            title.videos.retain(|video| video.season != Some(season));
            title.videos.extend(season_read.videos);
        }
        title.videos = meta::ordered_videos(&title.videos);

        // The record answered, so the copy is at least partly TMDB's now, and
        // TMDB's terms apply to it even where the cached copy was an Addon's.
        let source = if source.holds_tmdb() {
            source
        } else {
            TitleSource::Both
        };

        Ok(KeptTitle {
            title,
            source,
            status,
            next_episode,
        })
    }

    /// Read a Title again from TMDB alone, keeping the identity the client
    /// already holds: a Title whose Addon is gone is still the Title it was,
    /// and TMDB only describes it (ADR-0038 §2).
    fn read_discovered_onto(
        &self,
        cached: &Title,
        id: tmdb::TmdbId,
        kind: tmdb::Kind,
    ) -> Result<KeptTitle, ActionError> {
        let key = self
            .tmdb_credential()
            .ok_or(ActionError::NoTmdbCredential)?;
        let seasons = seasons_of(&cached.videos);
        let read = self.tmdb_details(kind, id, &key, &seasons)?;
        let videos = self.tmdb_videos(&read, id, &key);
        let details = read.details;
        let status = details.status;
        let next_episode = details.next_episode;

        let mut title = cached.clone();
        title.key = TitleKey::Tmdb { id: id.0 };
        details.with_videos(videos).onto(&mut title);
        // The Title answer publishes the Host's order whether the Addon is gone
        // or not: a refresh from TMDB alone must not put the specials first
        // (ADR-0039 §1).
        title.videos = meta::ordered_videos(&title.videos);

        Ok(KeptTitle {
            title,
            source: TitleSource::Tmdb,
            status,
            next_episode,
        })
    }

    /// The Titles behind Watch progress and in the Library, frozen with this
    /// view and read from the shared Library memo at the moment of a write.
    fn protection(&self) -> TitleProtection {
        let library = self
            .library_cache
            .lock()
            .expect("the Library cache is not poisoned")
            .entries();
        let probes = self
            .watch
            .iter()
            .map(|progress| TitleProbe::from_stub(&progress.title))
            .chain(self.library.iter().cloned())
            .chain(
                library
                    .into_iter()
                    .map(|entry| TitleProbe::new(None, &entry.r#type, &entry.id)),
            )
            .collect();

        TitleProtection::holding(probes)
    }

    /// Open one Title: what its Addon answers about the item the client asked for.
    ///
    /// A meta answer is not kept in the page cache: a Title is one item the owner
    /// opened on purpose, not a page a client pages through, and the Addon's
    /// `cacheMaxAge` is a hint for the latter (ADR-0010). Nor does it come back as
    /// a row with a failure in it — one Addon was asked for one Title, so an Addon
    /// that cannot answer is an error the window explains, not a Title with
    /// nothing in it that a person would have to guess about.
    ///
    /// `requested` is the request the Addon was already judged against, so the
    /// thing asked for is the thing `Manifest::answers` said yes to.
    pub(crate) fn fetch_title(
        &self,
        addon: &Addon,
        asked: &TitleRef,
        requested: &ResourceRequest,
    ) -> Result<Title, ActionError> {
        let url = requested.url(addon.manifest_url().as_str());
        let body = self
            .fetcher
            .fetch(&url)
            .map_err(|error| ActionError::Fetch {
                detail: error.to_string(),
            })?;

        Title::parse(&body, addon.id().clone(), asked).map_err(|error| ActionError::Meta {
            detail: error.to_string(),
        })
    }

    /// Open a Discovered Title: the record TMDB keeps for it, read whole.
    ///
    /// The one question that needs a TMDB credential to answer at all: a
    /// Discovered Title *is* its TMDB record, so a Host that holds no key has
    /// nothing to open it from, and a TMDB that cannot answer is the answer
    /// refused rather than degraded (ADR-0020).
    fn open_discovered(
        &self,
        id: tmdb::TmdbId,
        kind: tmdb::Kind,
        seasons: &[u32],
    ) -> Result<OpenedTitle, ActionError> {
        let key = self
            .tmdb_credential()
            .ok_or(ActionError::NoTmdbCredential)?;
        let read = self.tmdb_details(kind, id, &key, seasons)?;
        let videos = self.tmdb_videos(&read, id, &key);
        let details = read.details;
        let status = details.status;
        let next_episode = details.next_episode;

        // The record is the whole of it: no Addon answered, and every field
        // TMDB did not give stays empty rather than being invented.
        let mut title = Title {
            addon: None,
            id: tmdb::video_spelling(id, None),
            key: meta::TitleKey::Tmdb { id: id.0 },
            r#type: kind.as_protocol().to_owned(),
            name: tmdb::video_spelling(id, None),
            poster: None,
            background: None,
            logo: None,
            description: None,
            release_info: None,
            runtime: None,
            imdb_rating: None,
            genres: Vec::new(),
            videos: Vec::new(),
        };
        details.with_videos(videos).onto(&mut title);

        Ok(OpenedTitle {
            title,
            status,
            next_episode,
        })
    }

    /// One record's details, read whole — or why TMDB could not answer at all.
    ///
    /// A series' first batch of seasons rides in the details answer itself,
    /// through `append_to_response` (ADR-0038 §4), so a series with up to
    /// [`tmdb::MAX_APPENDED_SEASONS`] seasons costs one request for its metadata
    /// and its Videos together. `seasons` is what the caller already knows about
    /// the record's numbering — the Addon's own episode list, or the cached
    /// copy — and the batch is the first twenty of it; a cold Discovered open
    /// knows none and starts at season 0, the protocol's own specials number. A
    /// film has no seasons to append.
    pub(crate) fn tmdb_details(
        &self,
        kind: tmdb::Kind,
        id: tmdb::TmdbId,
        key: &tmdb::Credential,
        seasons: &[u32],
    ) -> Result<RecordRead, ActionError> {
        let appended = first_seasons(seasons);
        let request = details_request(kind, id, &appended);
        let body = self.fetch_tmdb(&request, key).map_err(tmdb_failure)?;

        let details = tmdb::read_details_with_seasons(&body, kind, id).map_err(|error| {
            ActionError::Tmdb {
                detail: error.to_string(),
            }
        })?;

        Ok(RecordRead { details, appended })
    }

    /// TMDB's Videos for a record: a series' seasons and episodes, read with
    /// the details answer and any further batches, or `None` where there were
    /// none to read.
    ///
    /// The details answer carried [`RecordRead::appended`] — the first
    /// [`tmdb::MAX_APPENDED_SEASONS`] seasons the caller knew or the record's
    /// own numbering from zero. Every season the record lists that is not among
    /// them is read in further batches, fanned out as a question's fetches are
    /// (ADR-0023), and only then is anything appended: batches answer in the
    /// order they were built, so completion order can never reorder a series.
    ///
    /// `None` is not "a film": it is "TMDB's Videos were not read" — a record
    /// that listed no seasons, or every season's answer failing — and it leaves
    /// the Title's own Videos standing rather than replacing them with
    /// emptiness. A season that could not be fetched or read is skipped rather
    /// than blanking the series around it, the way one bad catalog item is.
    ///
    /// A film is the case where TMDB's Videos and the Title's are one and the
    /// same Video, so there is nothing to replace: the film is played by the id
    /// its Title carries, `tt0133093` through an Addon and `tmdb:603` through
    /// Discover. The two unify in **Continue watching** when the client plays
    /// the spelling TMDB keys — which a TMDB-first Title screen does by its
    /// `key` — and not before; the Host will not renumber a Video the client
    /// named, because the id is what its Streams were found by (ADR-0011).
    pub(crate) fn tmdb_videos(
        &self,
        read: &RecordRead,
        id: tmdb::TmdbId,
        key: &tmdb::Credential,
    ) -> Option<Vec<Video>> {
        let details = &read.details;
        if details.seasons.is_empty() {
            return None;
        }

        // The first batch came back with the details answer, if any of its
        // seasons did. Every season the record lists past that batch is asked
        // for in one appended request per twenty.
        let mut videos = details.videos.clone().unwrap_or_default();
        let mut read_any = details.videos.is_some();

        let remaining: Vec<u32> = details
            .seasons
            .iter()
            .copied()
            .filter(|season| !read.appended.contains(season))
            .collect();
        let batches: Vec<&[u32]> = remaining
            .chunks(tmdb::MAX_APPENDED_SEASONS as usize)
            .collect();
        let answers = fan_out(&batches, |batch| {
            let request = tmdb::TmdbRequest::DetailsWithSeasons {
                kind: tmdb::Kind::Tv,
                id,
                seasons: batch.to_vec(),
            };
            self.fetch_tmdb(&request, key).ok()
        });

        for (batch, answer) in batches.iter().zip(answers) {
            let Some(body) = answer else {
                continue;
            };
            let Ok(read) = tmdb::read_season_batch(&body, id, batch) else {
                continue;
            };
            read_any |= read.seasons > 0;
            videos.extend(read.videos);
        }
        videos.truncate(MAX_ITEMS);

        read_any.then_some(videos)
    }

    /// Where TMDB's own record meets a Title it already names, deliver its
    /// metadata onto the Addon's answer — and key the Title by that record.
    ///
    /// Every step is one that can go without: a Title whose id belongs to
    /// nothing TMDB answers for, an owner who has entered no key, a credential
    /// the store cannot read back, a TMDB that cannot answer, and an answer
    /// that refuses to be read all leave the Title exactly the Addon's — open,
    /// keyed by the Addon, unmapped by whatever the interface commits to. A
    /// TMDB outage blanks nothing.
    ///
    /// Where TMDB *does* answer, its word is the Title's: the art, the
    /// description, the runtime, the rating, the genres — and the **Videos**,
    /// which are its seasons and episodes where they were read, so a series
    /// played through an Addon card and through Discover is one series with one
    /// set of Videos (ADR-0011's amendment, ADR-0020).
    ///
    /// The credential is read here, at the moment of the request it builds,
    /// and kept no further: it reaches neither state nor Snapshot nor log.
    /// What keying there is follows the identity and is not the credential's
    /// business: a `tmdb:` id is keyed by its record whether the owner gave a
    /// key or not, for the id is the record's own.
    fn tmdb_refine(&self, title: &mut Title) -> TmdbRead {
        let Some(external) = tmdb::ExternalId::parse(&title.r#type, &title.id) else {
            return TmdbRead::default();
        };
        let id = match &external {
            tmdb::ExternalId::Tmdb(id) => {
                title.key = meta::TitleKey::Tmdb { id: id.0 };
                *id
            }
            tmdb::ExternalId::Imdb(imdb) => {
                let Some(key) = self.tmdb_credential() else {
                    return TmdbRead::default();
                };
                let kind = match tmdb::Kind::parse(&title.r#type) {
                    Some(kind) => kind,
                    None => return TmdbRead::default(),
                };
                let request = tmdb::TmdbRequest::Find {
                    kind,
                    imdb: imdb.clone(),
                };
                let Some(answer) = self.fetch_tmdb(&request, &key).ok() else {
                    return TmdbRead::default();
                };
                match tmdb::read_find(&answer, kind) {
                    Ok(Some(id)) => id,
                    // An answer that says nothing mapped is an answer: the
                    // Title stays the Addon's, visible and keyed by it.
                    Ok(None) => return TmdbRead::default(),
                    Err(_) => return TmdbRead::default(),
                }
            }
        };

        let Some(key) = self.tmdb_credential() else {
            return TmdbRead::default();
        };
        let kind = match tmdb::Kind::parse(&title.r#type) {
            Some(kind) => kind,
            None => return TmdbRead::default(),
        };
        // The Addon's own episode list is what is known about the record's
        // numbering before the record answers, and it is what the first batch
        // of seasons is built from (#270, ADR-0038 §4).
        let seasons = seasons_of(&title.videos);
        let read = match self.tmdb_details(kind, id, &key, &seasons) {
            Ok(read) => read,
            Err(_) => {
                // The find stood: the id is TMDB's. What failed is the reading
                // of one answer, so the metadata stays the Addon's word and the
                // identity does not fall back with it.
                if matches!(&external, tmdb::ExternalId::Imdb(_)) {
                    title.key = meta::TitleKey::Tmdb { id: id.0 };
                }
                return TmdbRead::default();
            }
        };
        let videos = self.tmdb_videos(&read, id, &key);
        let details = read.details;
        let status = details.status;
        let next_episode = details.next_episode;
        details.with_videos(videos).onto(title);
        title.key = meta::TitleKey::Tmdb { id: id.0 };
        TmdbRead {
            details: true,
            status,
            next_episode,
        }
    }

    /// The credential TMDB wants, looked up at the moment of use — or nothing,
    /// which is the Host hearing no key is held.
    pub(crate) fn tmdb_credential(&self) -> Option<tmdb::Credential> {
        let key = self.secrets.read(CredentialKind::TmdbKey).ok().flatten()?;
        Some(tmdb::Credential::parse(&key))
    }

    /// Read the account Library, diffed against the index the cache was last
    /// read against (#165, ADR-0029).
    ///
    /// A cold cache asks `datastoreGet {all:true}`; a warm one asks only the ids
    /// whose `datastoreMeta` mtime moved. The cache lock is taken for the plan,
    /// the keep and the read, and never across the account's network call. A
    /// failed index or document read is returned *with* the rows the cache still
    /// has, so the room can say "could not refresh" without saying "empty".
    fn library(&self) -> Result<Library, ActionError> {
        let stremio = self.stremio.as_ref().ok_or(ActionError::SyncUnavailable)?;
        let key = self
            .secrets
            .read(CredentialKind::StremioAuthKey)
            .ok()
            .flatten()
            .ok_or(ActionError::SyncUnavailable)?;

        let meta = match stremio.library_meta(&key) {
            Ok(meta) => meta,
            Err(error) => {
                let entries = self
                    .library_cache
                    .lock()
                    .expect("the Library cache is not poisoned")
                    .entries();
                return Ok(Library {
                    entries,
                    failure: Some(ActionError::Library {
                        detail: error.to_string(),
                    }),
                });
            }
        };

        let plan = self
            .library_cache
            .lock()
            .expect("the Library cache is not poisoned")
            .plan(&meta);
        let fetched = if plan.all {
            stremio.library(&key, None)
        } else if plan.ids.is_empty() {
            Ok(Vec::new())
        } else {
            stremio.library(&key, Some(&plan.ids))
        };

        match fetched {
            Ok(items) => {
                let mut cache = self
                    .library_cache
                    .lock()
                    .expect("the Library cache is not poisoned");
                if plan.all || !plan.ids.is_empty() {
                    cache.keep(items, &meta);
                }
                cache.set_meta(&meta);
                Ok(Library {
                    entries: cache.entries(),
                    failure: None,
                })
            }
            Err(error) => {
                let entries = self
                    .library_cache
                    .lock()
                    .expect("the Library cache is not poisoned")
                    .entries();
                Ok(Library {
                    entries,
                    failure: Some(ActionError::Library {
                        detail: error.to_string(),
                    }),
                })
            }
        }
    }

    /// The Addons a Video's Streams — or subtitles — are asked of, each with
    /// the request its own manifest declares.
    ///
    /// For a Video in the addon protocol's own namespace this is
    /// `Manifest::answers`'s judgement, the one ADR-0010 wrote down: an Addon
    /// that does not answer is not asked, and appears nowhere. For a Video TMDB
    /// keys — `tmdb:603`, `tmdb:1396:1:2` — the request is built **per Addon**,
    /// in the spelling that Addon declares: `tmdb:` stays as it is,
    /// `tt`-declaring Addons are asked with the `/external_ids`-resolved IMDb
    /// id, and an Addon that declares neither is considered and not asked, its
    /// group empty (ADR-0020). The `/external_ids` ask happens once for the
    /// Video however many Addons want that spelling.
    ///
    /// The request built is still judged with `Manifest::answers` before it is
    /// returned: the request judged is the request asked.
    pub(crate) fn asks_for(&self, resource: &str, video: &VideoRef) -> Vec<Asked> {
        let plain = |video: &VideoRef| ResourceRequest::new(resource, &video.r#type, &video.id);

        let Some(tmdb_video) = tmdb::video_id(&video.r#type, &video.id) else {
            return self
                .addons
                .iter()
                .filter(|addon| addon.manifest().answers(&plain(video)))
                .map(|addon| Asked {
                    addon: addon.clone(),
                    requested: Some(plain(video)),
                })
                .collect();
        };

        let kind = tmdb_video.kind;
        // Which spelling each Addon that offers the resource wants, settled
        // before anything is resolved: an Addon with no `stream` resource is
        // never worth an `/external_ids` ask.
        let spelled: Vec<(&Addon, Option<Spelling>)> = self
            .addons
            .iter()
            .filter(|addon| addon.manifest().declares(resource, &video.r#type))
            .map(|addon| {
                let spelling = addon
                    .manifest()
                    .declared_prefixes(resource)
                    .and_then(spelling_of);
                (addon, spelling)
            })
            .collect();

        let wants_imdb = spelled
            .iter()
            .any(|(_, spelling)| *spelling == Some(Spelling::Imdb));
        let imdb = wants_imdb
            .then(|| self.tmdb_imdb(kind, tmdb_video.id))
            .flatten();

        spelled
            .into_iter()
            .map(|(addon, spelling)| {
                let requested = match (spelling, imdb.as_deref()) {
                    (Some(Spelling::Tmdb), _) => Some(plain(video)),
                    (Some(Spelling::Imdb), Some(imdb)) => Some(ResourceRequest::new(
                        resource,
                        &video.r#type,
                        episode_spelling(imdb, tmdb_video.at),
                    )),
                    // A spelling this Host could not build — the IMDb id TMDB
                    // does not keep, or an Addon that declared neither — is an
                    // Addon that is not asked.
                    _ => None,
                };

                Asked {
                    addon: addon.clone(),
                    requested: requested.filter(|requested| addon.manifest().answers(requested)),
                }
            })
            .collect()
    }

    /// The request one named Addon is asked one Video by, in the spelling its
    /// own manifest declares — or `None` where it declares none, or does not
    /// answer for the Video (ADR-0020).
    pub(crate) fn ask_of(
        &self,
        addon: &Addon,
        resource: &str,
        video: &VideoRef,
    ) -> Option<ResourceRequest> {
        self.asks_for(resource, video)
            .into_iter()
            .find(|asked| asked.addon.id() == addon.id())
            .and_then(|asked| asked.requested)
    }

    /// The IMDb id TMDB keeps for a record, where a key is held and TMDB
    /// answers: one hop of the per-Addon bridge (ADR-0020).
    fn tmdb_imdb(&self, kind: tmdb::Kind, id: tmdb::TmdbId) -> Option<String> {
        let key = self.tmdb_credential()?;
        let request = tmdb::TmdbRequest::ExternalIds { kind, id };
        let answer = self.fetch_tmdb(&request, &key).ok()?;

        tmdb::read_external_ids(&answer).ok().flatten()
    }

    /// Fetch one TMDB answer, or why it could not be fetched. The URL a query
    /// credential built carries the credential in it and is dropped when the
    /// fetch is over: a caller reads the answer, or TMDB's failure, and never
    /// the URL the credential rode in.
    fn fetch_tmdb(
        &self,
        request: &tmdb::TmdbRequest,
        credential: &tmdb::Credential,
    ) -> Result<String, FetchError> {
        let url = request.url(credential);
        if let Some((name, value)) = credential.header() {
            self.fetcher.fetch_with_headers(&url, &[(name, &value)])
        } else {
            self.fetcher.fetch(&url)
        }
    }
}

/// The most Addon asks one question has in flight at once.
///
/// A question asks a handful of Addons, and a wider burst would be one client's
/// search arriving at every Addon at once. Eight is wide enough that a Home-sized
/// search overlaps most of its Addons and narrow enough that one slow Addon
/// occupies one slot rather than the question (ADR-0023).
const FAN_OUT_LIMIT: usize = 8;

/// Ask the items up to [`FAN_OUT_LIMIT`] at a time, answering in the order they
/// were given.
///
/// One scoped thread per item, and the chunk's threads are joined before the
/// next chunk is spawned, so no more than the limit are ever in flight — even
/// when one ask is slow, in which case the next chunk waits (ADR-0023). Every
/// answer is written into the slot its item occupies, so completion order can
/// never move a Row or a group. A panic in an ask is re-raised on the asking
/// thread after the chunk's other threads have been accounted for.
fn fan_out<T, R, F>(items: &[T], ask: F) -> Vec<R>
where
    T: Sync,
    R: Send,
    F: Fn(&T) -> R + Sync,
{
    let mut answers: Vec<Option<R>> = items.iter().map(|_| None).collect();

    std::thread::scope(|scope| {
        let ask = &ask;
        for (asked, slots) in items
            .chunks(FAN_OUT_LIMIT)
            .zip(answers.chunks_mut(FAN_OUT_LIMIT))
        {
            let mut handles = Vec::with_capacity(asked.len());
            for (item, slot) in asked.iter().zip(slots.iter_mut()) {
                handles.push(scope.spawn(move || {
                    *slot = Some(ask(item));
                }));
            }
            // Joined before the next chunk is spawned: this is the bound. Every
            // thread in the chunk is accounted for before a panic is re-raised,
            // so the first failure cannot leave its siblings unjoined.
            let mut panic = None;
            for handle in handles {
                if let Err(caught) = handle.join() {
                    panic.get_or_insert(caught);
                }
            }
            if let Some(panic) = panic {
                std::panic::resume_unwind(panic);
            }
        }
    });

    answers
        .into_iter()
        .map(|answer| answer.expect("every fan-out item writes its answer"))
        .collect()
}

/// One `info` line per Addon ask inside a fan-out.
///
/// The helper takes only the resource's stable name, the Addon's own id, the
/// duration and the outcome — a stable word or an error's kind. There is no
/// slot for a URL, a query, an `ActionError`, or an answer, so a later caller
/// cannot accidentally widen the line, the way `HostDoor`'s question log cannot
/// (ADR-0022, ADR-0023).
fn addon_ask_log(
    resource: &'static str,
    addon: &AddonId,
    duration: Duration,
    outcome: &'static str,
) {
    tracing::info!(
        addon = addon.as_str(),
        resource,
        duration_ms = millis(duration),
        outcome,
        "an Addon was asked"
    );
}

/// One Addon, and the request one Video is asked of it by — or `None` where the
/// Addon was considered and not asked, which for a TMDB-keyed Video is its own
/// kind of answer: an empty group (ADR-0020).
pub(crate) struct Asked {
    pub(crate) addon: Addon,
    pub(crate) requested: Option<ResourceRequest>,
}

/// How one Addon's manifest says a TMDB-keyed Video is spelled to it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Spelling {
    /// `tmdb:<id>`, or `tmdb:<id>:<season>:<episode>`: the id the client
    /// named, which needs no second ask.
    Tmdb,
    /// `tt…`, or `tt…:<season>:<episode>`: TMDB's `/external_ids` answer,
    /// re-spelled.
    Imdb,
}

/// The spelling an Addon's declared id prefixes ask for, where it declares one.
///
/// `tmdb:` is preferred where an Addon declares both spellings, because it is
/// the id in hand and the `tt` one is a network hop. An Addon that declares
/// neither family — including one that declares nothing at all, which the
/// protocol reads as "every id" — is not asked: which of two namespaces to
/// guess is not the Host's to guess, and the ADR says the group is empty
/// (ADR-0020).
fn spelling_of(prefixes: &[String]) -> Option<Spelling> {
    if prefixes.iter().any(|prefix| prefix.starts_with("tmdb")) {
        Some(Spelling::Tmdb)
    } else if prefixes.iter().any(|prefix| prefix == "tt") {
        Some(Spelling::Imdb)
    } else {
        None
    }
}

/// The id an Addon keyed by `tt` is asked an episode by: TMDB's IMDb id with
/// the season and episode the playing Video carried.
fn episode_spelling(imdb: &str, at: Option<(u32, u32)>) -> String {
    match at {
        Some((season, episode)) => format!("{imdb}:{season}:{episode}"),
        None => imdb.to_owned(),
    }
}

/// Why a TMDB call failed, in TMDB's name.
///
/// The shared [`Fetcher`] speaks of the Addon it was built for, and a Discover
/// row that said "the Addon answered with status 429" would name the wrong
/// party: what a client reads is that TMDB did not answer, and with what
/// (ADR-0020).
fn tmdb_failure(error: FetchError) -> ActionError {
    ActionError::Tmdb {
        detail: match error {
            FetchError::Status { status } => format!("TMDB answered with status {status}"),
            FetchError::Unreachable { detail } => {
                format!("TMDB could not be reached: {detail}")
            }
            FetchError::Body { detail } => {
                format!("TMDB answered with something that is not text: {detail}")
            }
        },
    }
}

/// The request one record's metadata is read with.
///
/// A series' first batch of seasons is appended to its details answer, because
/// the details call is the one request that can carry them (ADR-0038 §4).
/// `seasons` is the batch [`first_seasons`] chose: the record's own first
/// twenty where its numbering is already known, or the protocol's own numbering
/// from season 0 when it is not. A film has no seasons to append.
fn details_request(kind: tmdb::Kind, id: tmdb::TmdbId, seasons: &[u32]) -> tmdb::TmdbRequest {
    match kind {
        tmdb::Kind::Movie => tmdb::TmdbRequest::Details { kind, id },
        tmdb::Kind::Tv => tmdb::TmdbRequest::DetailsWithSeasons {
            kind,
            id,
            seasons: seasons.to_vec(),
        },
    }
}

/// The seasons a details request appends: the first
/// [`tmdb::MAX_APPENDED_SEASONS`] of what is known, or the protocol's own
/// numbering from season 0 where nothing is.
///
/// The record's season numbers cannot be known before the record answers unless
/// a copy is in hand, so `known` is the Addon's episode list or the cached
/// Title. It is sorted and deduplicated because the request's order is not an
/// order a client sees; the answer's keys are `season/N` whichever order they
/// were asked in.
fn first_seasons(known: &[u32]) -> Vec<u32> {
    let mut seasons: Vec<u32> = if known.is_empty() {
        (0..tmdb::MAX_APPENDED_SEASONS).collect()
    } else {
        known.to_vec()
    };
    seasons.sort_unstable();
    seasons.dedup();
    seasons.truncate(tmdb::MAX_APPENDED_SEASONS as usize);
    seasons
}

/// The seasons a list of Videos is numbered in, in the order they first appear.
fn seasons_of(videos: &[Video]) -> Vec<u32> {
    let mut seasons = Vec::new();
    for season in videos.iter().filter_map(|video| video.season) {
        if !seasons.contains(&season) {
            seasons.push(season);
        }
    }
    seasons
}

/// The values a catalog requires, filled in from what it offers when the client
/// did not choose them.
fn with_required_values(
    manifest: &Manifest,
    catalog: &CatalogRef,
    chosen: Vec<Extra>,
) -> Vec<Extra> {
    match manifest.catalog(&catalog.r#type, &catalog.id) {
        Some(declared) => declared.with_defaults(chosen),
        None => chosen,
    }
}

/// Why an Addon will not answer this request, in the Host's own words.
///
/// Only reached when the request is one the Addon does not answer: a catalog it
/// never declared, a value it never declared, or one it requires and offers no
/// value to default to.
fn why_not(
    manifest: &Manifest,
    reference: &CatalogRef,
    requested: &ResourceRequest,
) -> ActionError {
    let Some(catalog) = manifest.catalog(&reference.r#type, &reference.id) else {
        return ActionError::UnknownCatalog {
            addon: manifest.id.clone(),
            catalog: reference.clone(),
        };
    };
    let named = reference;

    if let Some(unknown) = requested
        .extra
        .iter()
        .find(|chosen| !catalog.extra.iter().any(|prop| prop.name == chosen.name))
    {
        return ActionError::Extra {
            detail: format!("the catalog {named} does not take {:?}", unknown.name),
        };
    }
    if let Some(missing) = catalog.extra.iter().find(|prop| {
        prop.is_required
            && !requested
                .extra
                .iter()
                .any(|chosen| chosen.name == prop.name)
    }) {
        return ActionError::Extra {
            detail: format!(
                "the catalog {named} needs {:?}, and its Addon offers no value to default to",
                missing.name
            ),
        };
    }

    ActionError::Extra {
        detail: format!("the catalog {named} cannot be asked for with those values"),
    }
}
