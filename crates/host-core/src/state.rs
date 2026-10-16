use crate::addon::{Addon, AddonId};
use crate::preferences::{Preferences, SubtitleLanguage};
use crate::secret::SecretBackend;

/// The Host's state, as the Host holds it.
///
/// Private to the Host on purpose: nothing outside reads this. It is written
/// through the [`crate::Store`] seam and published as a [`crate::Snapshot`], and
/// a client only ever sees the latter.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct State {
    preferences: Preferences,
    /// The configured Addons, in the order they were configured: a handful of
    /// them, so a list is lookup enough and keeps that order.
    addons: Vec<Addon>,
    /// Where the Host's credentials live, and which kinds a credential is held
    /// for — without the credentials themselves, which are read from the secret
    /// store at the moment they are used and never copied in here.
    protection: Protection,
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
    /// The state, holding these preferences, these Addons, and this protection.
    pub(crate) fn holding(
        preferences: Preferences,
        addons: Vec<Addon>,
        protection: Protection,
    ) -> Self {
        Self {
            preferences,
            addons,
            protection,
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
#[derive(Debug, Clone, PartialEq, Eq)]
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
