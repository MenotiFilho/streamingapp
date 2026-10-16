use std::sync::Arc;

use crate::action::{Action, ActionError, ValidatedAction};
use crate::addon::{Addon, AddonId, Manifest};
use crate::cache::CatalogCache;
use crate::catalog::{CatalogRow, Page};
use crate::fetcher::Fetcher;
use crate::meta::Title;
use crate::playback::{
    ChapterStep, ChosenStream, Control, Observation, Picture, PlaybackState, Player, Telling,
    TrackId, TrackKind,
};
use crate::provider::Provider;
use crate::request::{
    CatalogRef, Extra, ResourceRequest, TitleRef, VideoRef, CATALOG, META, STREAM, SUBTITLES,
};
use crate::response::{Answer, Response};
use crate::secret::{CredentialKind, SecretStore};
use crate::snapshot::Snapshot;
use crate::state::{Change, Persist, Protection, State};
use crate::store::{Store, StoreError};
use crate::stream::{AddonStreams, Stream};
use crate::subtitles::MAX_FALLBACK_SUBTITLES;
use crate::{meta, tmdb};

/// The Host: its state, and the one door to it.
///
/// Every Action — from the window, from a remote client, from a timer — arrives
/// at [`Host::dispatch`], and every publication leaves as a [`Response`]: the
/// Snapshots every client is owed, and the answer only the client that asked
/// gets. There is no second path (ADR-0002).
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
    /// Where the Player puts the picture, asked of it once: a fact about the
    /// machine rather than about a Stream, and one every Snapshot carries so a
    /// client sharing the Host's window knows where the hole for it goes.
    picture: Picture,
    state: State,
    revision: u64,
    /// Pages the Addons have already answered, so that a re-request inside the
    /// Addon's own `cacheMaxAge` never reaches the network.
    cache: CatalogCache,
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
    ) -> Result<Self, StoreError> {
        let tmdb_held = match secrets.read(CredentialKind::TmdbKey) {
            Ok(Some(_)) => true,
            // A store that cannot answer cannot be disagreed with by a Snapshot:
            // the Host opens knowing no key is held, and finds out when one is
            // asked for.
            Ok(None) => false,
            Err(_) => false,
        };
        let state = State::holding(
            store.read_preferences()?,
            store.read_addons()?,
            Protection {
                backend: secrets.backend(),
                tmdb_held,
            },
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
        Ok(Self {
            store,
            fetcher,
            secrets,
            provider,
            player,
            picture,
            state,
            revision: 0,
            cache: CatalogCache::default(),
        })
    }

    /// The state as it stands — what a client that has just connected, or just
    /// reconnected, is owed.
    pub fn snapshot(&self) -> Snapshot {
        Snapshot::build(&self.state, self.revision, self.picture)
    }

    /// Take an Action, and publish or answer what came of it.
    ///
    /// Validation is pure and comes first, then whatever I/O the Action needs,
    /// and only then the state. An Action that is rejected, that cannot be
    /// fetched, or that the store refuses leaves the state and every future
    /// Snapshot exactly as they were.
    pub fn dispatch(&mut self, action: Action) -> Result<Response, ActionError> {
        let validated = action.validate()?;

        let change = match self.resolve(validated)? {
            Resolved::Change(change) => change,
            // A question changed nothing anyone else can see, so there is no
            // Snapshot to publish and the revision does not move.
            Resolved::Answer(answer) => return Ok(Response::answered(answer)),
        };

        let mut next = self.state.clone();
        let persist = next.apply(change);
        match persist {
            Persist::Preferences => self.store.write_preferences(next.preferences()),
            Persist::Addons => self.store.write_addons(next.addons()),
            // The credential lives where the secret store keeps it; nothing the
            // non-secret store holds was left behind.
            Persist::Nothing => Ok(()),
        }
        .map_err(|error| ActionError::Store {
            detail: error.to_string(),
        })?;

        self.state = next;
        self.revision += 1;
        Ok(Response::published(vec![self.snapshot()]))
    }

    /// Read the Player, and publish where playback stands now.
    ///
    /// The one door that is not an Action: playback moves on its own, so the
    /// Host looks at its own Player between Actions and folds what it reports
    /// into state. A report that says the same thing as last time moves nothing
    /// and publishes nothing; a position that moved, a Stream that ended, and an
    /// open that failed all do.
    ///
    /// The Host holds no clock of its own — host-core has no threads and no
    /// timers — so whoever owns the shell's event loop calls this while
    /// something is playing (ADR-0013).
    pub fn sample(&mut self) -> Option<Snapshot> {
        let observation = self.player.observe();

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

        self.state.set_playback(next);
        self.revision += 1;
        Some(self.snapshot())
    }

    /// Whether the Addon subtitles fallback is owed right now.
    ///
    /// Only when the Stream is loaded and live — not merely opening — the
    /// Player reports no embedded subtitle track at all, and this Stream has
    /// not been asked about yet. Embedded tracks always win, so a Stream that
    /// reports one is never asked about; and the attempt is per Stream, so a
    /// Stream with no subtitles anywhere is asked about once rather than every
    /// tick (ADR-0014).
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

        !observation
            .tracks
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
        let requested = ResourceRequest::new(SUBTITLES, &video.r#type, &video.id);
        let addons: Vec<Addon> = self
            .state
            .addons()
            .iter()
            .filter(|addon| addon.manifest().answers(&requested))
            .cloned()
            .collect();

        let mut added = 0usize;
        for addon in &addons {
            if added >= MAX_FALLBACK_SUBTITLES {
                break;
            }
            // A fetch that fails, or an answer that cannot be read, is this
            // Addon having nothing: the Host does not invent a subtitle for it,
            // and the next Addon is still asked.
            let Ok(subtitles) = self.provider.subtitles(addon, &requested) else {
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

    /// Turn a validated Action into the change it will make, or the answer it
    /// will give.
    ///
    /// This is where an Action's I/O happens: an Addon's manifest, or a page of
    /// one of its catalogs, is fetched and read here, so that what reaches state
    /// is already a decided thing. A failure here has touched neither state nor
    /// store.
    fn resolve(&mut self, validated: ValidatedAction) -> Result<Resolved, ActionError> {
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
            ValidatedAction::BrowseCatalog {
                addon,
                catalog,
                extra,
            } => {
                let configured = self.addon(&addon)?;
                let requested = ResourceRequest::new(CATALOG, &catalog.r#type, &catalog.id)
                    .with_extra(with_required_values(configured.manifest(), &catalog, extra));
                if !configured.manifest().answers(&requested) {
                    return Err(why_not(configured.manifest(), &catalog, &requested));
                }

                let row = self.catalog_row(&configured, &requested);
                Resolved::Answer(Answer::Catalogs(vec![row]))
            }
            ValidatedAction::SearchCatalogs { query } => {
                // Every catalog that offers a search, in the order the Addons
                // were configured and each Addon's own order within that. One
                // Addon failing is one row with nothing in it, not a failed
                // search (ADR-0010).
                let plan: Vec<(Addon, ResourceRequest)> = self
                    .state
                    .addons()
                    .iter()
                    .flat_map(|addon| {
                        addon.manifest().catalogs.iter().filter_map(|catalog| {
                            let extra = catalog.search_extra(&query)?;
                            Some((
                                addon.clone(),
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

                let rows = plan
                    .iter()
                    .map(|(addon, requested)| self.catalog_row(addon, requested))
                    .collect();
                Resolved::Answer(Answer::Catalogs(rows))
            }
            ValidatedAction::OpenTitle { addon, title } => {
                let configured = self.addon(&addon)?;
                let requested = ResourceRequest::new(META, &title.r#type, &title.id);
                if !configured.manifest().answers(&requested) {
                    return Err(ActionError::UnknownTitle {
                        addon: configured.id().clone(),
                        title,
                    });
                }

                // The request the Addon was judged on is the one it is asked
                // with: a second construction is a second thing that can drift.
                let mut title = self.fetch_title(&configured, &title, &requested)?;
                self.tmdb_refine(&mut title);
                Resolved::Answer(Answer::Title(Box::new(title)))
            }
            ValidatedAction::FindStreams { video } => {
                // Every configured Addon that answers for it, in the order
                // they were configured, each answer a group of its own: one
                // Addon failing is that group with nothing in it, not a
                // question that fails (ADR-0010 — a search's rule, applied to
                // Streams).
                let requested = ResourceRequest::new(STREAM, &video.r#type, &video.id);
                let groups = self
                    .state
                    .addons()
                    .iter()
                    .filter(|addon| addon.manifest().answers(&requested))
                    .map(|addon| {
                        let (streams, failure) = match self.provider.streams(addon, &requested) {
                            Ok(streams) => (streams, None),
                            Err(failure) => (Vec::new(), Some(failure)),
                        };
                        AddonStreams {
                            addon: addon.id().clone(),
                            streams,
                            failure,
                        }
                    })
                    .collect();
                Resolved::Answer(Answer::Streams(groups))
            }
            ValidatedAction::PlayStream(chosen) => {
                // The Player is handed the URL and nothing else; whether the
                // Stream it leads to opens is found out later, through
                // `observe`, because agreeing to try is not playing.
                self.player
                    .open(&chosen.url)
                    .map_err(|error| ActionError::Playback {
                        detail: error.to_string(),
                    })?;
                Resolved::Change(Change::Play(*chosen))
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
            ValidatedAction::SetAspect { aspect } => {
                self.playing(Control::Aspect)?;
                self.told(Telling::Aspect(aspect))?;
                Resolved::Change(Change::SetAspect(aspect))
            }
            ValidatedAction::NextEpisode => {
                // The one control that legitimately opens a Stream: the Host
                // asks the Addons what comes after what is playing and plays it,
                // so this is a change like a `PlayStream` and not a telling.
                self.playing(Control::NextEpisode)?;
                let chosen = self.next_episode()?;
                self.player
                    .open(&chosen.url)
                    .map_err(|error| ActionError::Playback {
                        detail: error.to_string(),
                    })?;
                Resolved::Change(Change::Play(chosen))
            }
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
                Resolved::Change(Change::Stop)
            }
        })
    }

    /// Refuse a control about a Stream the Player is not on: one that never
    /// played, or one that has already ended.
    fn playing(&self, control: Control) -> Result<(), ActionError> {
        if self.state.playback().is_live() {
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
        let known = self
            .state
            .playback()
            .tracks()
            .iter()
            .any(|track| track.kind == kind && track.id == id);

        if known {
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

    /// The Stream to play when a client asks for the next episode, or why the
    /// Host will not open one.
    ///
    /// The Video playing must be an episode of a series, the Host asks the
    /// Addons that answer `meta` for its Title and takes the next Video in the
    /// Addon's own order, and then asks the Addon that is playing for that
    /// Video's Streams — preferring the release the one playing came from (the
    /// same `bingeGroup`) and falling back to that Addon's first playable
    /// candidate. Nothing here invents an id by arithmetic and nothing re-ranks
    /// the candidates: the next Video is the Addon's own, and continuing the
    /// release is continuity rather than a score (ADR-0012, ADR-0014).
    fn next_episode(&self) -> Result<ChosenStream, ActionError> {
        let Some(playing) = self.state.playback().chosen() else {
            // Behind `playing(Control::NextEpisode)` this cannot happen, and it
            // is a refusal rather than a panic all the same.
            return Err(ActionError::NothingPlaying {
                control: Control::NextEpisode,
            });
        };
        let now = &playing.now_playing;
        let title_id = episode_title(&now.video)?;
        let refused = |detail: String| ActionError::NoNextEpisode { detail };
        let asked = TitleRef::parse(&now.video.r#type, &title_id)
            .map_err(|error| refused(error.to_string()))?;

        // The Title's Videos come from the first Addon that answers `meta` for
        // it and still lists the Video playing; the Addon's own order decides
        // what comes next.
        let requested_meta = ResourceRequest::new(META, &now.video.r#type, &title_id);
        let mut next_id = None;
        for addon in self.state.addons() {
            if !addon.manifest().answers(&requested_meta) {
                continue;
            }
            let Ok(title) = self.fetch_title(addon, &asked, &requested_meta) else {
                continue;
            };
            let Some(index) = title
                .videos
                .iter()
                .position(|video| video.id == now.video.id)
            else {
                continue;
            };
            let Some(following) = title.videos.get(index + 1) else {
                continue;
            };
            next_id = Some(following.id.clone());
            break;
        }
        let Some(next_id) = next_id else {
            return Err(refused(format!(
                "no Addon offers an episode after {}",
                now.video
            )));
        };

        // The next episode is played from the Addon already playing, so that the
        // release continues: another Addon's candidates would be a different set
        // of releases, which is not "the next episode of what is playing".
        let playing_addon =
            self.state.addon(&now.addon).cloned().ok_or_else(|| {
                refused(format!("the Addon {} is no longer configured", now.addon))
            })?;
        let requested_stream = ResourceRequest::new(STREAM, &now.video.r#type, &next_id);
        if !playing_addon.manifest().answers(&requested_stream) {
            return Err(refused(format!(
                "{} has nothing for {}/{}",
                now.addon, now.video.r#type, next_id
            )));
        }
        let streams = self
            .provider
            .streams(&playing_addon, &requested_stream)
            .map_err(|error| refused(error.to_string()))?;

        let video = VideoRef::parse(&now.video.r#type, &next_id)
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
                    now.video.r#type, next_id
                ))
            })
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

    /// One catalog row: what is cached, or what the Addon answers, or why it
    /// could not answer — with what was cached served instead when the Addon
    /// said it may be.
    fn catalog_row(&mut self, addon: &Addon, requested: &ResourceRequest) -> CatalogRow {
        let url = requested.url(addon.manifest_url().as_str());
        let name = addon
            .manifest()
            .catalog(&requested.r#type, &requested.id)
            .map(|catalog| catalog.name.clone())
            .unwrap_or_else(|| requested.id.clone());

        let (sent, metas, failure) = match self.cache.fresh(&url) {
            Some(page) => (page.sent, page.metas, None),
            None => match self.fetch_page(&url) {
                Ok(page) => (page.sent, page.metas, None),
                Err(failure) => match self.cache.when_stale(&url) {
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
    fn fetch_page(&mut self, url: &str) -> Result<Page, ActionError> {
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
            .keep(url, page.sent, page.metas.clone(), page.hints);
        Ok(page)
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
    fn fetch_title(
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
    /// The credential is read here, at the moment of the request it builds,
    /// and kept no further: it reaches neither state nor Snapshot nor log.
    /// What keying there is follows the identity and is not the credential's
    /// business: a `tmdb:` id is keyed by its record whether the owner gave a
    /// key or not, for the id is the record's own.
    fn tmdb_refine(&self, title: &mut Title) {
        let Some(external) = tmdb::ExternalId::parse(&title.r#type, &title.id) else {
            return;
        };
        let id = match &external {
            tmdb::ExternalId::Tmdb(id) => {
                title.key = meta::TitleKey::Tmdb { id: id.0 };
                *id
            }
            tmdb::ExternalId::Imdb(imdb) => {
                let Some(key) = self.tmdb_credential() else {
                    return;
                };
                let kind = match tmdb::Kind::parse(&title.r#type) {
                    Some(kind) => kind,
                    None => return,
                };
                let request = tmdb::TmdbRequest::Find {
                    kind,
                    imdb: imdb.clone(),
                };
                let Some(answer) = self.fetch_tmdb(&request, &key) else {
                    return;
                };
                match tmdb::read_find(&answer, kind) {
                    Ok(Some(id)) => id,
                    // An answer that says nothing mapped is an answer: the
                    // Title stays the Addon's, visible and keyed by it.
                    Ok(None) => return,
                    Err(_) => return,
                }
            }
        };

        let Some(key) = self.tmdb_credential() else {
            return;
        };
        let kind = match tmdb::Kind::parse(&title.r#type) {
            Some(kind) => kind,
            None => return,
        };
        let Some(record) = self.fetch_tmdb(&tmdb::TmdbRequest::Details { kind, id }, &key) else {
            return;
        };
        match tmdb::read_details(&record, kind) {
            Ok(details) => {
                details.onto(title);
                title.key = meta::TitleKey::Tmdb { id: id.0 };
            }
            // A details answer that was not one: the id stood — the find said
            // so — and the metadata is the Addon's word.
            Err(_) if matches!(external, tmdb::ExternalId::Imdb(_)) => {
                title.key = meta::TitleKey::Tmdb { id: id.0 };
            }
            Err(_) => {}
        }
    }

    /// The credential TMDB wants, looked up at the moment of use — or nothing,
    /// which is the Host hearing no key is held.
    fn tmdb_credential(&self) -> Option<tmdb::Credential> {
        let key = self.secrets.read(CredentialKind::TmdbKey).ok().flatten()?;
        Some(tmdb::Credential::parse(&key))
    }

    /// Fetch one TMDB answer, or nothing. The URL a query credential built
    /// carries the credential in it, and is dropped when the fetch is over:
    /// a fetch failure is reported to nobody but this join, which degrades.
    fn fetch_tmdb(
        &self,
        request: &tmdb::TmdbRequest,
        credential: &tmdb::Credential,
    ) -> Option<String> {
        let url = request.url(credential);
        if let Some((name, value)) = credential.header() {
            self.fetcher
                .fetch_with_headers(&url, &[(name, &value)])
                .ok()
        } else {
            self.fetcher.fetch(&url).ok()
        }
    }
}

/// An Action with everything it needed already resolved.
enum Resolved {
    Change(Change),
    Answer(Answer),
}

/// A candidate for the next episode, judged: the Stream to play, or nothing
/// when this Host cannot open it — an `infoHash`, or a URL it will not open.
fn playable(video: &VideoRef, addon: &AddonId, stream: &Stream) -> Option<ChosenStream> {
    ChosenStream::parse(video.clone(), addon.clone(), stream).ok()
}

/// The Title id an episode's Video id carries, or why this Host will not take
/// it for an episode.
///
/// The protocol indexes an episode as `{title}:{season}:{episode}`, specials as
/// season zero, and the Title id is whatever stands before those last two
/// parts: an Addon keyed by a namespaced id (`kitsu:12345`) indexes its episodes
/// as `kitsu:12345:1:1`, so the shape to read is "two numeric parts at the end"
/// rather than "exactly three parts". A Video whose id does not end that way —
/// a film's — is not an episode, and there is no next episode of it. The season
/// and the episode numbers are deliberately not read: the next Video comes from
/// the Addon's own list, and inventing an id by arithmetic is exactly what
/// ADR-0014 forbids.
fn episode_title(video: &VideoRef) -> Result<String, ActionError> {
    let parts: Vec<&str> = video.id.split(':').collect();
    let (title, numbers) = parts.split_at(parts.len().saturating_sub(2));
    let title = title.join(":");

    let shaped = !title.is_empty()
        && numbers
            .first()
            .is_some_and(|value| value.parse::<u32>().is_ok())
        && numbers
            .get(1)
            .is_some_and(|value| value.parse::<u32>().is_ok());

    if shaped {
        Ok(title)
    } else {
        Err(ActionError::NoNextEpisode {
            detail: format!("{video} is playing, and it is not an episode of a series"),
        })
    }
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
