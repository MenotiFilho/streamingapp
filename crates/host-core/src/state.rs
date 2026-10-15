use crate::action::ValidatedAction;
use crate::preferences::Preferences;

/// The Host's state, as the Host holds it.
///
/// Private to the Host on purpose: nothing outside reads this. It is written
/// through the [`crate::Store`] seam and published as a [`crate::Snapshot`], and
/// a client only ever sees the latter.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct State {
    preferences: Preferences,
}

impl State {
    pub(crate) fn with_preferences(preferences: Preferences) -> Self {
        Self { preferences }
    }

    pub(crate) fn preferences(&self) -> &Preferences {
        &self.preferences
    }

    /// Take an already-validated Action. Pure: no I/O, and nothing to fail.
    pub(crate) fn apply(&mut self, action: ValidatedAction) {
        match action {
            ValidatedAction::SetSubtitleLanguage(language) => {
                self.preferences.set_subtitle_language(Some(language));
            }
            ValidatedAction::ClearSubtitleLanguage => {
                self.preferences.set_subtitle_language(None);
            }
        }
    }
}
