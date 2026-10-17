use std::sync::Arc;

use crate::action::{Action, ActionError, ValidatedAction};
use crate::addon::{Addon, AddonId, Manifest};
use crate::cache::CatalogCache;
use crate::catalog::{CatalogRow, Page};
use crate::clock::Clock;
use crate::device::{Device, DeviceSummary, DeviceToken};
use crate::fetcher::Fetcher;
use crate::meta::{Title, Video};
use crate::pairing::PairingCode;
use crate::playback::{
    ChapterStep, ChosenStream, Control, Observation, Picture, PlaybackState, Player, Telling,
    TrackId, TrackKind, Unplayable,
};
use crate::progress::TitleStub;
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
use crate::stremio::StremioApi;
use crate::subtitles::MAX_FALLBACK_SUBTITLES;
use crate::sync::{merge, Merged, RemoteItem};
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
    /// Addon's own `cacheMaxAge` never reaches the network.
    cache: CatalogCache,
    /// Stremio's account service, where this Host was built with one (#30).
    /// `None` is a Host that cannot sync, and a Host that holds no `authKey` is
    /// one that does not: in both, nothing here is ever called.
    stremio: Option<Arc<dyn StremioApi>>,
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
        let state = State::holding(
            store.read_preferences()?,
            store.read_addons()?,
            Protection {
                backend: secrets.backend(),
                tmdb_held: held(CredentialKind::TmdbKey),
                stremio_held: held(CredentialKind::StremioAuthKey),
            },
            store.read_watch_progress()?,
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
        Ok(Self {
            store,
            fetcher,
            secrets,
            provider,
            player,
            clock,
            picture,
            serving: None,
            state,
            revision: 0,
            cache: CatalogCache::default(),
            stremio: None,
        })
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
        Snapshot::build(
            &self.state,
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

    /// Take an Action, and publish or answer what came of it.
    ///
    /// Validation is pure and comes first, then whatever I/O the Action needs,
    /// and only then the state. An Action that is rejected, that cannot be
    /// fetched, or that the store refuses leaves the state and every future
    /// Snapshot exactly as they were.
    pub fn dispatch(&mut self, action: Action) -> Result<Response, ActionError> {
        let validated = action.validate()?;

        let (change, answer) = match self.resolve(validated)? {
            Resolved::Change(change) => (change, None),
            // The one Action that both changes state and answers the client that
            // asked: pairing, where the token goes to the device and the device
            // joining the list goes to every client (#31).
            Resolved::Changed { change, answer } => (change, Some(answer)),
            // A question changed nothing anyone else can see, so there is no
            // Snapshot to publish and the revision does not move.
            Resolved::Answer(answer) => return Ok(Response::answered(answer)),
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

        let mut next = self.state.clone();
        let persist = next.apply(change, self.clock.now_millis());
        match persist {
            Persist::Preferences => self.store.write_preferences(next.preferences()),
            Persist::Addons => self.store.write_addons(next.addons()),
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
        }
        .map_err(|error| ActionError::Store {
            detail: error.to_string(),
        })?;

        self.state = next;
        self.revision += 1;

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

    /// Merge what the Stremio account holds into the library: remote progress
    /// that is newer than the Host's record is taken in.
    ///
    /// The Host's *open* (#30): the shell calls it once at startup, and signing
    /// in calls it too. It is a door beside [`Host::sample`] rather than an
    /// Action because nobody asked for it — and like `sample` it publishes only
    /// when it moved something. It *pulls* and does not push: what the Host has
    /// that the account does not is pushed when the owner pauses or stops, which
    /// is when it is known to be the newer write.
    ///
    /// With no account signed in it asks nothing, and a Stremio that cannot
    /// answer leaves the library as it was.
    pub fn pull_remote(&mut self) -> Option<Snapshot> {
        let (stremio, key) = self.account()?;
        let items = stremio.library(&key, None).ok()?;

        let mut moved = false;
        for raw in items {
            let Ok(item) = RemoteItem::parse(raw) else {
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
        let addon = self.state.addon(stub.addon())?;
        let requested = ResourceRequest::new(META, stub.r#type(), stub.id());
        if !addon.manifest().answers(&requested) {
            return None;
        }
        let asked = TitleRef::parse(stub.r#type(), stub.id()).ok()?;
        let title = self.fetch_title(addon, &asked, &requested).ok()?;

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

        // Where playback has got to is Watch progress the moment it is worth
        // writing — a position that moved a few seconds, a Video that finished,
        // a duration that arrived — and it is written *now* rather than on a
        // stop, which is what survives a Host killed mid-Stream (#29). A store
        // that refuses the write loses this tick and not the Stream: the next
        // write is seconds away, and playback is not the store's to stop.
        let now = self.clock.now_millis();
        if let Some(entry) = self.state.refresh_watch(now, false) {
            let _ = self.store.write_watch_progress(&entry);
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
                Resolved::Change(Change::Play {
                    chosen: Box::new(chosen),
                    title: Some(Box::new(title)),
                    start,
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

    /// Take one episode step: the neighbouring Stream chosen and opened, and
    /// the change every client is told.
    ///
    /// A step is one of the two controls that legitimately open a Stream — the
    /// other is a resume — so it is a change like a `PlayStream` and not a
    /// telling: the Host asks the Addons beside what is playing and opens it.
    /// The Title that is playing's is the neighbour's too — the Host was told it
    /// when the Stream started — so the new Video's progress is recorded against
    /// the same card.
    fn stepped(&self, step: EpisodeStep) -> Result<Resolved, ActionError> {
        self.playing(step.control())?;
        let chosen = self.adjacent_episode(step)?;
        let title = self.playing_title();
        self.player
            .open(&chosen.url, None)
            .map_err(|error| ActionError::Playback {
                detail: error.to_string(),
            })?;
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
    /// own shape, never of the Title's `type` — and the Host asks the Addons
    /// that answer `meta` for its Title, in the order they were configured, for
    /// the list that still holds the Video playing. The Video standing beside it
    /// in that Addon's own order is the one that plays, from the Addon already
    /// playing so continuity is kept: the same `bingeGroup` where that Addon
    /// offers one, and otherwise its first playable candidate. Nothing here
    /// invents an id by arithmetic and nothing re-ranks the candidates: the
    /// neighbour is the Addon's own, and continuing the release is continuity
    /// rather than a score (ADR-0012, ADR-0014).
    fn adjacent_episode(&self, step: EpisodeStep) -> Result<ChosenStream, ActionError> {
        let Some(playing) = self.state.playback().chosen() else {
            // Behind `playing(Control::…)` this cannot happen, and it is a
            // refusal rather than a panic all the same.
            return Err(ActionError::NothingPlaying {
                control: step.control(),
            });
        };
        let now = &playing.now_playing;
        let title_id = episode_title(step, &now.video)?;
        let refused = |detail: String| step.refusal(detail);
        let asked = TitleRef::parse(&now.video.r#type, &title_id)
            .map_err(|error| refused(error.to_string()))?;

        // The Title's Videos come from the first Addon that answers `meta` for
        // it and still lists the Video playing, and *that* list decides what
        // stands beside it — whether or not anything does. Two Addons can
        // number a series differently (ADR-0020), so only the list that
        // contains the Video playing is known to put the right one next to it.
        let requested_meta = ResourceRequest::new(META, &now.video.r#type, &title_id);
        let mut neighbour_id = None;
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
            neighbour_id = step
                .neighbour(&title.videos, index)
                .map(|video| video.id.clone());
            break;
        }
        let Some(neighbour_id) = neighbour_id else {
            return Err(refused(format!(
                "no Addon lists an episode {} {}",
                step.side(),
                now.video
            )));
        };

        // The neighbour is played from the Addon already playing, so that the
        // release continues: another Addon's candidates would be a different set
        // of releases, which is not "the episode beside what is playing".
        let playing_addon =
            self.state.addon(&now.addon).cloned().ok_or_else(|| {
                refused(format!("the Addon {} is no longer configured", now.addon))
            })?;
        let requested_stream = ResourceRequest::new(STREAM, &now.video.r#type, &neighbour_id);
        if !playing_addon.manifest().answers(&requested_stream) {
            return Err(refused(format!(
                "{} has nothing for {}/{}",
                now.addon, now.video.r#type, neighbour_id
            )));
        }
        let streams = self
            .provider
            .streams(&playing_addon, &requested_stream)
            .map_err(|error| refused(error.to_string()))?;

        let video = VideoRef::parse(&now.video.r#type, &neighbour_id)
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

        if !self.state.has_addon(entry.title.addon()) {
            return Err(ActionError::Unplayable(Unplayable {
                detail: format!(
                    "the Addon {} that supplied this Title is no longer configured",
                    entry.title.addon()
                ),
            }));
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
    /// configured Addon that answers for it, in the order they were configured —
    /// the rule `FindStreams` asks every Addon by, folded to the one a Host that
    /// is opening a Stream itself needs (a resume, ADR-0015).
    fn first_playable(&self, video: &VideoRef) -> Option<ChosenStream> {
        let requested = ResourceRequest::new(STREAM, &video.r#type, &video.id);

        for addon in self.state.addons() {
            if !addon.manifest().answers(&requested) {
                continue;
            }
            // An Addon that cannot answer is one Addon with nothing, and the
            // next is still asked (ADR-0010's rule for a search).
            let Ok(streams) = self.provider.streams(addon, &requested) else {
                continue;
            };
            if let Some(candidate) = streams
                .iter()
                .find_map(|stream| playable(video, addon.id(), stream))
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
    /// A change that also answers the client that asked. Pairing is the only one:
    /// a token goes to the device that redeemed the code, while the device it
    /// belongs to is state every client is told of.
    Changed {
        change: Change,
        answer: Answer,
    },
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
/// The one reading of the protocol's episode-id shape is [`meta::episode_of`],
/// which the library's card goes through too, so the two cannot disagree about
/// what an episode is. The season and the episode numbers are deliberately not
/// returned: the neighbouring Video comes from the Addon's own list, and
/// inventing an id by arithmetic is exactly what ADR-0014 forbids.
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
/// Title's order, or the one before (ADR-0014, ADR-0021).
///
/// The two directions are one rule read the other way, so the refusal they name
/// and the Video they take from the Addon's list are decided here once rather
/// than copied per direction.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EpisodeStep {
    Next,
    Previous,
}

impl EpisodeStep {
    /// The Video standing beside `index` in the Addon's own whole-list order,
    /// in this direction: the next one after it, or the one before — `None` at
    /// either end, which is how "the list begins here" refuses the step.
    fn neighbour(self, videos: &[Video], index: usize) -> Option<&Video> {
        match self {
            Self::Next => videos.get(index + 1),
            Self::Previous => index.checked_sub(1).and_then(|before| videos.get(before)),
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
