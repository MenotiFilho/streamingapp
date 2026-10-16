use crate::addon::{Addon, AddonId};
use crate::playback::{
    Aspect, ChapterStep, ChosenStream, Crop, PlaybackSession, SeekTarget, TrackId, TrackKind,
};
use crate::preferences::{Preferences, SubtitleLanguage};
use crate::secret::SecretBackend;

/// The Host's state, as the Host holds it.
///
/// Private to the Host on purpose: nothing outside reads this. It is written
/// through the [`crate::Store`] seam and published as a [`crate::Snapshot`], and
/// a client only ever sees the latter.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct State {
    preferences: Preferences,
    /// The configured Addons, in the order they were configured: a handful of
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
}

impl State {
    /// The state, holding these preferences, these Addons, and this protection
    /// — with nothing playing, which is how every Host starts.
    pub(crate) fn holding(
        preferences: Preferences,
        addons: Vec<Addon>,
        protection: Protection,
    ) -> Self {
        Self {
            preferences,
            addons,
            protection,
            playback: PlaybackSession::idle(),
        }
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

    /// What is playing, as the Player's latest report leaves it.
    pub(crate) fn set_playback(&mut self, playback: PlaybackSession) {
        self.playback = playback;
    }

    pub(crate) fn has_addon(&self, id: &AddonId) -> bool {
        self.addons.iter().any(|addon| addon.id() == id)
    }

    /// The configured Addon with this id.
    pub(crate) fn addon(&self, id: &AddonId) -> Option<&Addon> {
        self.addons.iter().find(|addon| addon.id() == id)
    }

    /// Take one change, and say which part of the store it left behind.
    ///
    /// Pure: no I/O, and nothing to fail — the I/O an Action needed was done
    /// before this point, by [`Change`]'s construction.
    pub(crate) fn apply(&mut self, change: Change) -> Persist {
        match change {
            Change::SetSubtitleLanguage(language) => {
                self.preferences.set_subtitle_language(Some(language));
                Persist::Preferences
            }
            Change::ClearSubtitleLanguage => {
                self.preferences.set_subtitle_language(None);
                Persist::Preferences
            }
            Change::AddAddon(addon) => {
                let addon = *addon;
                match self.addons.iter_mut().find(|held| held.id() == addon.id()) {
                    // An Addon this Host is already configured with, added again
                    // — a reconfiguration: it takes the place of the one before.
                    Some(held) => *held = addon,
                    None => self.addons.push(addon),
                }
                Persist::Addons
            }
            Change::RemoveAddon(id) => {
                self.addons.retain(|held| held.id() != &id);
                Persist::Addons
            }
            Change::SetTmdbKey { backend } => {
                self.protection = Protection {
                    backend,
                    tmdb_held: true,
                };
                // The credential was already written where it lives; nothing in
                // the non-secret store is left behind by this.
                Persist::Nothing
            }
            Change::ClearTmdbKey => {
                self.protection.tmdb_held = false;
                Persist::Nothing
            }
            // Playback is state every client shares and no store keeps: what
            // was on screen when a Host stopped is not what it resumes with.
            Change::Play(chosen) => {
                self.playback = PlaybackSession::opening(chosen);
                Persist::Nothing
            }
            Change::SetPaused(paused) => {
                self.playback.set_paused(paused);
                Persist::Nothing
            }
            Change::Seek(target) => {
                self.playback.seek(target);
                Persist::Nothing
            }
            Change::SetAudioTrack(track) => {
                self.playback.select(TrackKind::Audio, Some(track));
                Persist::Nothing
            }
            Change::SetSubtitleTrack(track) => {
                self.playback.select(TrackKind::Subtitle, track);
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
            Change::SetAspect(aspect) => {
                self.playback.shaped(aspect);
                Persist::Nothing
            }
            Change::Stop => {
                self.playback.stop();
                Persist::Nothing
            }
        }
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
    SetSubtitleLanguage(SubtitleLanguage),
    ClearSubtitleLanguage,
    AddAddon(Box<Addon>),
    RemoveAddon(AddonId),
    /// The credential itself is not in the change — it was sent to the secret
    /// store on the way here, and the store answered. What reaches state is
    /// only where the store *is*.
    SetTmdbKey {
        backend: SecretBackend,
    },
    ClearTmdbKey,
    /// A Stream was chosen and the Player agreed to open it, so the Host is on
    /// that Stream from here on and the open is in flight.
    Play(ChosenStream),
    /// The Player was told to hold the picture or let it run. Like the change
    /// the credentials make, this is not something the store keeps.
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
    SetAspect(Aspect),
    /// The Player was told to let the Stream go: nothing is playing, and what
    /// failed no longer is.
    Stop,
}

/// Which part of the store a [`Change`] leaves out of date, so the Host knows
/// what to write back — and what not to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Persist {
    Preferences,
    Addons,
    /// Nothing the store holds was left behind: the change was made somewhere
    /// else, or touched nothing the store keeps.
    Nothing,
}
