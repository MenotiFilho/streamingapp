use crate::addon::{Addon, AddonId};
use crate::preferences::{Preferences, SubtitleLanguage};

/// The Host's state, as the Host holds it.
///
/// Private to the Host on purpose: nothing outside reads this. It is written
/// through the [`crate::Store`] seam and published as a [`crate::Snapshot`], and
/// a client only ever sees the latter.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct State {
    preferences: Preferences,
    /// The configured Addons, in the order they were configured: a handful of
    /// them, so a list is lookup enough and keeps that order.
    addons: Vec<Addon>,
}

impl State {
    /// The state, holding these preferences and these Addons.
    pub(crate) fn holding(preferences: Preferences, addons: Vec<Addon>) -> Self {
        Self {
            preferences,
            addons,
        }
    }

    pub(crate) fn preferences(&self) -> &Preferences {
        &self.preferences
    }

    pub(crate) fn addons(&self) -> &[Addon] {
        &self.addons
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
}

/// Which part of the store a [`Change`] leaves out of date, so the Host knows
/// what to write back — and what not to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Persist {
    Preferences,
    Addons,
}
