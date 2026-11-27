use crate::addon::{Addon, AddonId};
use crate::device::{Device, DeviceId, DeviceToken};
use crate::handpick::HandPick;
use crate::pairing::PairingCode;
use crate::playback::{
    Aspect, ChapterStep, ChosenStream, Crop, PlaybackSession, SeekTarget, TrackId, TrackKind,
};
use crate::preferences::{
    FeaturedCatalog, LanguageList, Preferences, StreamBuffer, SubtitleColor, SubtitleScale,
    TorrentCache, UpNextPlayback,
};
use crate::progress::{TitleStub, UnplayableReason, WatchProgress};
use crate::request::VideoRef;
use crate::secret::SecretBackend;
use crate::torrent::TorrentStatus;
use crate::tracks::SubtitleHandPick;

/// The Host's state, as the Host holds it.
///
/// Private to the Host on purpose: nothing outside reads this. It is written
/// through the [`crate::Store`] seam and published as a [`crate::Snapshot`], and
/// a client only ever sees the latter.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct State {
    preferences: Preferences,
    /// The Addons the Host is configured with, in the owner's order: the order
    /// they were configured, until a reorder moves one (#74). A handful of
    /// them, so a list is lookup enough and keeps that order.
    addons: Vec<Addon>,
    /// Where the Host's credentials live, and which kinds a credential is held
    /// for — without the credentials themselves, which are read from the secret
    /// store at the moment they are used and never copied in here.
    protection: Protection,
    /// What is playing, and what the Player last said about it. The one piece
    /// of state every client shares, and the one piece that is never stored:
    /// playback does not survive a restart (#29's Watch progress is the part
    /// that does).
    playback: PlaybackSession,
    /// Watch progress, one entry per Video, most recently written first. Loaded
    /// from the store at startup, so a Host that was killed mid-Stream comes back
    /// knowing where it was. Continue watching is built from this list, one card
    /// per Title (#273).
    watch: Vec<WatchProgress>,
    /// The devices the Host has paired, in the order they paired. The tokens
    /// themselves are not here — a [`Device`] holds a digest — so a Snapshot can
    /// be built from this list and carry none of what any device holds.
    devices: Vec<Device>,
    /// The code the Host is showing, and the one thing a connection that has not
    /// paired may redeem it with. Rotated the moment it is redeemed, so a code
    /// is worth exactly one pairing (#31).
    pairing: PairingCode,
    /// The Track a client picked during playback, carried as a language (or as
    /// "off") while the Title keeps playing (ADR-0041). Never stored and never
    /// published: it is not in any Snapshot, and a restarted Host holds none.
    hand_pick: HandPick,
}

/// Which credentials the Host is known to hold, and where the store that holds
/// them says they are.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Protection {
    /// The backend the secret store is made of.
    pub(crate) backend: SecretBackend,
    /// Whether a TMDB key is held — known from the store's own answer to a read
    /// at startup, and from every set or clear of one since.
    pub(crate) tmdb_held: bool,
    /// Whether a Stremio `authKey` is held — which is what "sync is on" means.
    /// Known from the store's answer at startup and from every sign-in and
    /// sign-out since.
    pub(crate) stremio_held: bool,
}

impl State {
    /// The state, holding these preferences, these Addons, this protection and
    /// this Watch progress — with nothing playing, which is how every Host
    /// starts.
    pub(crate) fn holding(
        preferences: Preferences,
        addons: Vec<Addon>,
        protection: Protection,
        watch: Vec<WatchProgress>,
        devices: Vec<Device>,
        pairing: PairingCode,
    ) -> Self {
        let mut state = Self {
            preferences,
            addons,
            protection,
            playback: PlaybackSession::idle(),
            watch,
            devices,
            pairing,
            hand_pick: HandPick::default(),
        };
        // A marking the store cannot honour — an Addon that is not configured,
        // or a Catalog the Addon's manifest does not offer — is not one the
        // Host holds: a store written by another Host, or a write that only
        // half landed, starts without it rather than with Home pointed at
        // nothing (#74). The row is left where it is; the next preference
        // write takes it away.
        state.clear_dead_featured();
        state
    }

    pub(crate) fn preferences(&self) -> &Preferences {
        &self.preferences
    }

    pub(crate) fn addons(&self) -> &[Addon] {
        &self.addons
    }

    pub(crate) fn protection(&self) -> Protection {
        self.protection
    }

    pub(crate) fn playback(&self) -> &PlaybackSession {
        &self.playback
    }

    /// The Hand pick: what the owner picked in the player, for the Title playing.
    pub(crate) fn hand_pick(&self) -> &HandPick {
        &self.hand_pick
    }

    /// The Continue watching entries, most recently written first.
    pub(crate) fn watch(&self) -> &[WatchProgress] {
        &self.watch
    }

    /// The devices the Host has paired, in the order they paired.
    pub(crate) fn devices(&self) -> &[Device] {
        &self.devices
    }

    /// The code the Host is showing.
    pub(crate) fn pairing(&self) -> &PairingCode {
        &self.pairing
    }

    /// The device a token was issued to, or nothing: the digest of what was
    /// presented matched no device the Host has paired. A token for a revoked
    /// device matches nothing, which is what revocation means.
    pub(crate) fn device_for(&self, token: &DeviceToken) -> Option<&Device> {
        self.devices.iter().find(|device| device.matches(token))
    }

    pub(crate) fn has_device(&self, id: &DeviceId) -> bool {
        self.devices.iter().any(|device| device.id() == id)
    }

    /// The Watch progress the Host holds for a Video, where it holds any: what a
    /// resume point is read from and what a next episode carries its Title from.
    pub(crate) fn watch_for(&self, video: &VideoRef) -> Option<&WatchProgress> {
        self.watch.iter().find(|entry| &entry.video == video)
    }

    /// The id of the Title the Stream playing now belongs to, as the Host was told
    /// it: the key of the Hand pick. None for a Stream the Host was never told a
    /// Title of, which is played and not recorded.
    fn playing_title_id(&self) -> Option<String> {
        let video = &self.playback.chosen()?.now_playing.video;
        self.watch_for(video)
            .map(|entry| entry.title.id().to_owned())
    }

    /// What is playing, as the Player's latest report leaves it.
    pub(crate) fn set_playback(&mut self, playback: PlaybackSession) {
        self.playback = playback;
    }

    /// The Host ended the Stream playing: `idle`, with `sentence` as the failure.
    pub(crate) fn end_playback_with_failure(&mut self, sentence: String) {
        self.playback.ended_with_failure(sentence);
    }

    /// Take the engine's reading of the torrent being served, and say whether
    /// the Snapshot's Torrent status moved with it.
    pub(crate) fn set_torrent_status(&mut self, status: TorrentStatus) -> bool {
        self.playback.torrent_status(status)
    }

    /// Clear the engine's reading of the torrent, and say whether the Snapshot's
    /// Torrent status moved with it.
    pub(crate) fn clear_torrent_status(&mut self) -> bool {
        self.playback.clear_torrent_status()
    }

    /// Record that the Addon subtitles fallback was attempted for the Stream
    /// playing now. The Host's note to itself rather than something the Player
    /// says, so it moves no revision and is published by nothing (ADR-0014).
    pub(crate) fn record_subtitles_attempt(&mut self) {
        self.playback.record_subtitles_attempt();
    }

    /// Record that the Stream playing now has had its first report chosen
    /// from (ADR-0041). The Host's note to itself, like the attempt above.
    pub(crate) fn record_initial_choice(&mut self) {
        self.playback.record_initial_choice();
    }

    /// Record how many Addon subtitles were added to the Stream playing now, so
    /// the Host looks for them in a later report (ADR-0041).
    pub(crate) fn record_addon_tracks_added(&mut self, count: usize) {
        self.playback.record_addon_tracks_added(count);
    }

    /// Record that the Host's one switch to an Addon subtitle is decided on the
    /// Stream playing now.
    pub(crate) fn record_addon_switch_done(&mut self) {
        self.playback.record_addon_switch_done();
    }

    pub(crate) fn has_addon(&self, id: &AddonId) -> bool {
        self.addons.iter().any(|addon| addon.id() == id)
    }

    /// The configured Addon with this id, whether enabled or disabled.
    pub(crate) fn addon(&self, id: &AddonId) -> Option<&Addon> {
        self.addons.iter().find(|addon| addon.id() == id)
    }

    /// Whether a configured Addon with this id exists and is enabled.
    pub(crate) fn is_addon_enabled(&self, id: &AddonId) -> bool {
        self.addon(id).is_some_and(Addon::is_enabled)
    }

    /// Why an Addon cannot be played from, or `None` when it is configured and
    /// enabled (ADR-0015, ADR-0044 §2).
    pub(crate) fn addon_unplayable(&self, id: &AddonId) -> Option<UnplayableReason> {
        match self.addon(id) {
            Some(addon) if addon.is_enabled() => None,
            Some(_) => Some(UnplayableReason::AddonDisabled),
            None => Some(UnplayableReason::AddonRemoved),
        }
    }

    /// Take one change, and say which part of the store it left behind.
    ///
    /// Pure: no I/O, and nothing to fail — the I/O an Action needed was done
    /// before this point, by [`Change`]'s construction. `now` is the moment the
    /// change is taken, stamped onto the Watch progress it writes (#29).
    pub(crate) fn apply(&mut self, change: Change, now: i64) -> Persist {
        match change {
            Change::SetSubtitleLanguages(languages) => {
                self.preferences.set_subtitle_languages(languages);
                Persist::Preferences
            }
            Change::SetAudioLanguages(languages) => {
                self.preferences.set_audio_languages(languages);
                Persist::Preferences
            }
            Change::SetSubtitleColor(color) => {
                self.preferences.set_subtitle_color(color);
                Persist::Preferences
            }
            Change::SetSubtitleScale(scale) => {
                self.preferences.set_subtitle_scale(scale);
                Persist::Preferences
            }
            Change::SetStreamBuffer(buffer) => {
                self.preferences.set_stream_buffer(buffer);
                Persist::Preferences
            }
            Change::SetTorrentCache(cache) => {
                self.preferences.set_torrent_cache(cache);
                Persist::Preferences
            }
            Change::SetUpNextPlayback(playback) => {
                self.preferences.set_up_next_playback(playback);
                Persist::Preferences
            }
            Change::SetAutoplay(autoplay) => {
                self.preferences.set_autoplay(autoplay);
                Persist::Preferences
            }
            // The countdown is the Host's own record beside the state, so there
            // is nothing here to move and nothing to keep (ADR-0040).
            Change::CancelAutoplay => Persist::Nothing,
            // The Featured catalog is a preference of the Host's, and it is
            // taken as given: whether the Addon it names is configured, and
            // whether the Addon offers the Catalog, was judged where the state
            // was readable (#74).
            Change::SetFeaturedCatalog(featured) => {
                self.preferences.set_featured_catalog(Some(featured));
                Persist::Preferences
            }
            Change::ClearFeaturedCatalog => {
                self.preferences.set_featured_catalog(None);
                Persist::Preferences
            }
            Change::AddAddon(addon) => {
                let mut addon = *addon;
                match self.addons.iter_mut().find(|held| held.id() == addon.id()) {
                    // An Addon this Host is already configured with, added again
                    // — a reconfiguration: it takes the place of the one before,
                    // keeping whether the owner had it enabled (ADR-0044 §2).
                    Some(held) => {
                        addon.set_enabled(held.is_enabled());
                        *held = addon;
                    }
                    None => self.addons.push(addon),
                }
                // A reconfiguration can stop a Catalog existing — an Addon's
                // catalogs are its own, and this one was fetched again — which
                // takes a Featured catalog that named it away in the same
                // change (#74).
                self.addons_persist()
            }
            // The Addon leaves where it stood and stands where the client put
            // it: the order is the list itself, so the move is a removal and an
            // insertion rather than a sort key (#74). The position is a place
            // the list has — the Host judged it before this — so the insertion
            // is in range.
            Change::ReorderAddon { id, position } => {
                if let Some(from) = self.addons.iter().position(|held| held.id() == &id) {
                    let addon = self.addons.remove(from);
                    self.addons.insert(position, addon);
                }
                // A move cannot change which Catalogs exist, so the marking
                // stands or falls as it did and the preferences are not
                // rewritten.
                Persist::Addons
            }
            Change::RemoveAddon(id) => {
                // The Addon goes and its Titles stay: an entry whose Addon is no
                // longer configured is a stub the Snapshot marks unplayable, not
                // a row that vanishes with it (#29).
                self.addons.retain(|held| held.id() != &id);
                // Taking the Addon away takes the Featured catalog with it: a
                // preference that named a removed Addon would be a hero drawn
                // from nothing, so Home falls back to no hero in the same
                // change (#74).
                self.addons_persist()
            }
            Change::SetAddonEnabled { addon, enabled } => {
                if let Some(held) = self.addons.iter_mut().find(|held| held.id() == &addon) {
                    held.set_enabled(enabled);
                }
                // Disabling an Addon keeps the Featured catalog preference
                // stored (only suppressing it in Snapshot::build until the
                // Addon is re-enabled — ADR-0044 §2), so preferences stay put.
                Persist::Addons
            }
            Change::SetTmdbKey { backend } => {
                self.protection = Protection {
                    backend,
                    tmdb_held: true,
                    ..self.protection
                };
                // The credential was already written where it lives; nothing in
                // the non-secret store is left behind by this.
                Persist::Nothing
            }
            Change::ClearTmdbKey => {
                self.protection.tmdb_held = false;
                Persist::Nothing
            }
            Change::SignInStremio { backend } => {
                self.protection = Protection {
                    backend,
                    stremio_held: true,
                    ..self.protection
                };
                Persist::Nothing
            }
            Change::SignOutStremio => {
                self.protection.stremio_held = false;
                Persist::Nothing
            }
            // A device the Host knows from here on, and the code it redeemed is
            // spent: the one the Host shows now is the one that came with the
            // change, so a code is worth exactly one pairing.
            Change::PairDevice { device, next_code } => {
                self.devices.push((*device).clone());
                self.pairing = next_code;
                Persist::Device(device)
            }
            // The device leaves the list, and with it the token it held: a token
            // that matches no device matches nothing, so there is nothing else to
            // take away.
            Change::RevokeDevice(id) => {
                self.devices.retain(|device| device.id() != &id);
                Persist::RemoveDevice(id)
            }
            // Playback is state every client shares and no store keeps: what
            // was on screen when a Host stopped is not what it resumes with.
            // The Watch progress that outlives it is written beside it, and it
            // is the part of a play that *is* stored.
            Change::Play {
                chosen,
                title,
                start,
            } => {
                let video = chosen.now_playing.video.clone();
                // The Hand pick follows the Title: a Stream of the same one
                // keeps it, any other play ends it (ADR-0041).
                self.hand_pick.played(title.as_deref().map(TitleStub::id));
                // The Stream the play came from is what Playing Up next
                // continues (#276): its Addon and release are read before the
                // PlaybackSession takes the candidate.
                let stream_addon = chosen.now_playing.addon.clone();
                let binge_group = chosen.now_playing.binge_group.clone();
                self.playback = PlaybackSession::opening(*chosen);

                match title {
                    Some(title) => {
                        let mut entry = WatchProgress::starting(video.clone(), *title, start, now)
                            .streamed_by(stream_addon, binge_group);
                        // A Stream replayed or resumed has the length it had: the
                        // Player has not reported the new one yet, and a Host
                        // killed before it does should not forget how long the
                        // Video is.
                        if let Some(previous) = self.watch.iter().find(|held| held.video == video) {
                            entry.duration = previous.duration;
                        }
                        Persist::Watch(Box::new(self.put_watch(entry)))
                    }
                    // A Stream with no Title behind it — a next episode whose
                    // Title the Host was never told — is played and not
                    // recorded: the entry a Continue watching card is drawn
                    // from is the Title.
                    None => Persist::Nothing,
                }
            }
            Change::SetPaused(paused) => {
                self.playback.set_paused(paused);
                self.touch(now)
            }
            Change::Seek(target) => {
                self.playback.seek(target);
                self.touch(now)
            }
            Change::SetAudioTrack(track) => {
                self.playback.select(TrackKind::Audio, Some(track));
                self.playback.record_hand_pick();
                if let Some(title) = self.playing_title_id() {
                    let language = self.playback.language_of_track(TrackKind::Audio, track);
                    self.hand_pick.picked_audio(&title, language);
                }
                Persist::Nothing
            }
            Change::SetSubtitleTrack(track) => {
                self.playback.select(TrackKind::Subtitle, track);
                self.playback.record_hand_pick();
                if let Some(title) = self.playing_title_id() {
                    let picked = match track {
                        None => Some(SubtitleHandPick::Off),
                        Some(id) => self
                            .playback
                            .language_of_track(TrackKind::Subtitle, id)
                            .map(SubtitleHandPick::Language),
                    };
                    self.hand_pick.picked_subtitle(&title, picked);
                }
                Persist::Nothing
            }
            Change::SetSubtitleDelay(seconds) => {
                self.playback.set_subtitle_delay(seconds);
                Persist::Nothing
            }
            Change::SetSpeed(rate) => {
                self.playback.set_speed(rate);
                Persist::Nothing
            }
            Change::SetVolume(level) => {
                self.playback.set_volume(level);
                Persist::Nothing
            }
            Change::SetMuted(muted) => {
                self.playback.set_muted(muted);
                Persist::Nothing
            }
            Change::Chapter(step) => {
                self.playback.chapter_step(step);
                Persist::Nothing
            }
            Change::SetCrop(crop) => {
                self.playback.cropped(crop);
                Persist::Nothing
            }
            // The rectangle is the Player's script's answer, and the Host's
            // record of the crop moves when the Player reports it. No state here
            // moves and no store keeps a crop (#119).
            Change::Autocrop => Persist::Nothing,
            Change::SetAspect(aspect) => {
                self.playback.shaped(aspect);
                Persist::Nothing
            }
            Change::Stop => {
                self.hand_pick.stopped();
                // Where the Stream got to is written before it is let go: after
                // the stop there is no position to read, and an unclean exit is
                // exactly the case this is for.
                let persist = self.touch(now);
                self.playback.stop();
                persist
            }
        }
    }

    /// Fold where playback is into the Watch progress for the Video playing, and
    /// say what the store must be told — or nothing when writing would say the
    /// same thing twice.
    ///
    /// `force` is for a change a client made: a pause, a seek, a stop. The write
    /// is worth making then even though the Player's next report would move the
    /// position again, because it is the last thing the Host was *told* and what
    /// an unclean exit keeps. A tick of the Player's clock does not force it, and
    /// is written only when playback has moved [`crate::PROGRESS_EVERY`] seconds.
    pub(crate) fn refresh_watch(&mut self, now: i64, force: bool) -> Option<WatchProgress> {
        let video = self.playback.chosen()?.now_playing.video.clone();
        let stored = self.watch.iter().find(|entry| entry.video == video)?;
        let next = stored.playing(self.playback.position(), self.playback.duration(), now);

        if !force && !next.worth_writing(stored) {
            return None;
        }

        Some(self.put_watch(next))
    }

    /// The same, as a [`Persist`] — what the Player moving leaves the store.
    fn touch(&mut self, now: i64) -> Persist {
        match self.refresh_watch(now, true) {
            Some(entry) => Persist::Watch(Box::new(entry)),
            None => Persist::Nothing,
        }
    }

    /// The part of the store a change to the Addons left out of date: the Addons
    /// themselves, and — where the change left the Featured catalog standing on
    /// nothing — the preference beside it (#74).
    fn addons_persist(&mut self) -> Persist {
        if self.clear_dead_featured() {
            Persist::AddonsAndPreferences
        } else {
            Persist::Addons
        }
    }

    /// Take the Featured catalog away where it names an Addon the Host does not
    /// have, or a Catalog that Addon no longer offers: the one preference a
    /// change to the Addons can leave standing on nothing. Answers whether one
    /// was cleared, so the caller knows the store holds a stale row.
    ///
    /// Called after every change that moves the Addons, and once at startup, so
    /// a dead reference never reaches a Snapshot — not from a removal, not from
    /// a reconfiguration that took the Catalog away, and not from a store
    /// written before the Addon was.
    fn clear_dead_featured(&mut self) -> bool {
        let Some(featured) = self.preferences.featured_catalog() else {
            return false;
        };
        let stands = self.addons.iter().any(|held| {
            held.id() == &featured.addon
                && held
                    .manifest()
                    .catalog(&featured.catalog.r#type, &featured.catalog.id)
                    .is_some()
        });
        if stands {
            return false;
        }

        self.preferences.set_featured_catalog(None);
        true
    }

    /// Take in an entry that was merged from the account (#30): it replaces the
    /// one for its Video, and the row keeps its order by *when each was written*
    /// — a pulled position is as recent as the account's write, not as recent as
    /// the moment it arrived, so it does not jump the row.
    pub(crate) fn merge_watch(&mut self, entry: WatchProgress) {
        self.watch.retain(|held| held.video != entry.video);
        self.watch.push(entry);
        self.watch
            .sort_by_key(|entry| std::cmp::Reverse(entry.updated_at));
    }

    /// Put one entry where it belongs: one per Video, and the one just written
    /// leads the row, so "most recent" is the order it is held in.
    fn put_watch(&mut self, entry: WatchProgress) -> WatchProgress {
        self.watch.retain(|held| held.video != entry.video);
        self.watch.insert(0, entry.clone());
        entry
    }
}

/// An Action with everything it needed already resolved: the fetch done, the
/// manifest parsed.
///
/// This is the type that reaches state, and the only one: [`State::apply`] takes a
/// `Change` and nothing else, so a `Change` that exists is a change that can be
/// made. It is one step past [`crate::ValidatedAction`] because validating cannot
/// resolve an Addon — the manifest has to be fetched first — and holding the I/O
/// here is what lets the state change itself stay pure and un-failable, with the
/// Addon behind a pointer because a manifest is a document and every other variant
/// is a word or two wide.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Change {
    SetSubtitleLanguages(LanguageList),
    SetAudioLanguages(LanguageList),
    SetSubtitleColor(SubtitleColor),
    SetSubtitleScale(SubtitleScale),
    /// The look-ahead and memory ceiling the Player is told, judged together
    /// before either reaches it (ADR-0026).
    SetStreamBuffer(StreamBuffer),
    /// The most disk a playing torrent may take (ADR-0042 §3).
    SetTorrentCache(TorrentCache),
    /// What Play does for a Title's Up next: play it directly, or open the
    /// Streams picker (#276).
    SetUpNextPlayback(UpNextPlayback),
    /// Whether the Host advances on its own when an episode's Stream ends
    /// (#302, #314).
    SetAutoplay(bool),
    /// Stop the running Autoplay countdown. A change so that every client is
    /// told the countdown is over, with nothing of its own in [`State`].
    CancelAutoplay,
    /// The one Catalog marked as the Host's featured feed, resolved against the
    /// Addon that offers it (#74).
    SetFeaturedCatalog(FeaturedCatalog),
    ClearFeaturedCatalog,
    AddAddon(Box<Addon>),
    /// The configured Addon written back at `position` in the order, which is
    /// the list itself: `position` was judged against it before this (#74).
    ReorderAddon {
        id: AddonId,
        position: usize,
    },
    RemoveAddon(AddonId),
    /// Switch a configured Addon on or off (ADR-0044 §2).
    SetAddonEnabled {
        addon: AddonId,
        enabled: bool,
    },
    /// The credential itself is not in the change — it was sent to the secret
    /// store on the way here, and the store answered. What reaches state is
    /// only where the store *is*.
    SetTmdbKey {
        backend: SecretBackend,
    },
    ClearTmdbKey,
    /// A Stremio account was signed in to: the `authKey` is in the secret store
    /// and what reaches state is only where that store is.
    SignInStremio {
        backend: SecretBackend,
    },
    SignOutStremio,
    /// A device was paired, and the code it redeemed is spent: `next_code` is the
    /// one the Host shows from here on. Boxed because a `Device` is a name, an id
    /// and a digest and every other variant here is a word or two wide.
    PairDevice {
        device: Box<Device>,
        next_code: PairingCode,
    },
    /// A paired device's token was taken away by name.
    RevokeDevice(DeviceId),
    /// A Stream was chosen and the Player agreed to open it, so the Host is on
    /// that Stream from here on and the open is in flight. `title` is the Title
    /// the Video belongs to, where the Host was told it: Continue watching
    /// records the Video's progress against it, and a play with no Title behind
    /// it — a next episode whose Title the Host never saw — is played and not
    /// recorded.
    /// `start` is where the open begins, which is a resume point and `None` for
    /// a Stream that starts at its beginning. Boxed because a `ChosenStream` and
    /// a `TitleStub` are both many words wide and every other variant here is a
    /// word or two.
    Play {
        chosen: Box<ChosenStream>,
        title: Option<Box<TitleStub>>,
        start: Option<f64>,
    },
    /// The Player was told to hold the picture or let it run. Like the change
    /// the credentials make, this is not something the store keeps — except the
    /// Watch progress written beside it.
    SetPaused(bool),
    /// The Player was told to move, and the Host's own record of where playback
    /// is moved with it — the Player's next report is what corrects it.
    Seek(SeekTarget),
    /// Which track of each kind is on, as the Host's own record moves it: the
    /// selection is the Host's to say at once, and the Player is only what
    /// makes it so.
    SetAudioTrack(TrackId),
    SetSubtitleTrack(Option<TrackId>),
    SetSubtitleDelay(f64),
    SetSpeed(f64),
    SetVolume(f64),
    SetMuted(bool),
    /// Move the Host's own record of which chapter is playing.
    Chapter(ChapterStep),
    SetCrop(Crop),
    /// The Player's stock autocrop script was asked for its toggle: the crop is
    /// the script's to find, so the Host's own record moves when the Player
    /// reports it, not here (#119).
    Autocrop,
    SetAspect(Aspect),
    /// The Player was told to let the Stream go: nothing is playing, and what
    /// failed no longer is.
    Stop,
}

/// Which part of the store a [`Change`] leaves out of date, so the Host knows
/// what to write back — and what not to.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Persist {
    Preferences,
    Addons,
    /// Removing the Addon that owned the Featured catalog left two parts of the
    /// store out of date in the one change: the Addons it was configured with,
    /// and the preference that named it (#74).
    AddonsAndPreferences,
    /// One Video's Watch progress was written: the store keeps it, and the entry
    /// here is what it is to be written as. Boxed because an entry is a Title
    /// and a Video and is many times the width of the two words the other
    /// variants carry.
    Watch(Box<WatchProgress>),
    /// A device was paired: the store keeps it, and it is what is to be written.
    Device(Box<Device>),
    /// A device was revoked: the store drops the row it was in.
    RemoveDevice(DeviceId),
    /// Nothing the store holds was left behind: the change was made somewhere
    /// else, or touched nothing the store keeps.
    Nothing,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A Host's state with nothing configured and nothing playing, which is
    /// where every Host starts.
    fn idle_state() -> State {
        State::holding(
            Preferences::new(),
            Vec::new(),
            Protection {
                backend: SecretBackend::File,
                tmdb_held: false,
                stremio_held: false,
            },
            Vec::new(),
            Vec::new(),
            PairingCode::generate(),
        )
    }

    #[test]
    fn autocrop_leaves_the_hosts_record_exactly_where_it_was() {
        let mut state = idle_state();
        let before = state.clone();

        assert_eq!(
            state.apply(Change::Autocrop, 1_000),
            Persist::Nothing,
            "a crop the Player's script finds is not the store's business"
        );
        assert_eq!(
            state, before,
            "the Host's record of the crop moves on the Player's next report, not on the ask"
        );
    }
}
