use serde::{Deserialize, Serialize};

use crate::preferences::{InvalidSubtitleLanguage, SubtitleLanguage};

/// The version of the Action wire form this Host speaks.
///
/// The version sits in the envelope, not in the Action, so that a client that is
/// too old or too new is told exactly that instead of being misparsed.
pub const ACTION_VERSION: u16 = 1;

/// Everything a client can ask the Host to do.
///
/// Deliberately one flat enum with no client-specific corners: the command space
/// *is* the client surface, so a capability is added here and the local window
/// and every remote client get it at once (ADR-0002).
///
/// Fields a variant does not know are ignored — serde allows that inside a tagged
/// enum and not on a struct, so the envelope above is strict while an action's own
/// object is not. That is the effect we want: a newer client adding to a version 1
/// action does not make an older Host refuse it, while an unknown or misspelled
/// field at the envelope, which is where the version lives, is malformed. A field
/// a variant does require is still required.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Action {
    /// Prefer `language` when the Host chooses a subtitle track.
    SetSubtitleLanguage { language: String },
    /// Carry no subtitle-language preference; the Host chooses per Video.
    ClearSubtitleLanguage,
}

impl Action {
    /// Parse the wire form: `{"version":1,"action":{"type":"…", …}}`.
    pub fn parse(json: &str) -> Result<Self, ActionError> {
        let value: serde_json::Value =
            serde_json::from_str(json).map_err(|error| ActionError::Malformed {
                detail: error.to_string(),
            })?;
        Self::parse_value(&value)
    }

    /// Parse an already-decoded envelope.
    ///
    /// The version is judged before the Action is, so a client speaking version 2
    /// hears "version 2 is not supported" rather than a complaint about a field
    /// this Host has never heard of.
    pub fn parse_value(envelope: &serde_json::Value) -> Result<Self, ActionError> {
        let version = envelope
            .get("version")
            .and_then(serde_json::Value::as_u64)
            .ok_or_else(|| ActionError::Malformed {
                detail: "the envelope carries no numeric `version`".to_owned(),
            })?;
        if version != u64::from(ACTION_VERSION) {
            return Err(ActionError::UnsupportedVersion {
                got: version,
                supported: ACTION_VERSION,
            });
        }

        let envelope: ActionEnvelope =
            serde_json::from_value(envelope.clone()).map_err(|error| ActionError::Malformed {
                detail: error.to_string(),
            })?;
        Ok(envelope.action)
    }

    /// The pure step ahead of mutation.
    ///
    /// Everything the Host can judge from the Action alone is judged here, and the
    /// payloads come back in their domain types — so the mutation that follows
    /// cannot be handed something invalid, and a rejected Action has touched
    /// neither state nor store.
    pub fn validate(self) -> Result<ValidatedAction, ActionError> {
        match self {
            Action::SetSubtitleLanguage { language } => {
                let language = SubtitleLanguage::parse(&language)?;
                Ok(ValidatedAction::SetSubtitleLanguage(language))
            }
            Action::ClearSubtitleLanguage => Ok(ValidatedAction::ClearSubtitleLanguage),
        }
    }
}

/// An Action that has passed validation, carrying its payload in its domain type.
///
/// Only [`Action::validate`] yields this, and only this reaches the Host's state,
/// so "validated before it mutated anything" is a property of the types rather
/// than of the order of two statements.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ValidatedAction {
    SetSubtitleLanguage(SubtitleLanguage),
    ClearSubtitleLanguage,
}

/// The wire form of an Action: a version and the Action.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
struct ActionEnvelope {
    version: u16,
    action: Action,
}

/// An Action that cannot be taken, and why — in the Host's own vocabulary, so a
/// client can act on the kind and a person can read the message.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, thiserror::Error)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ActionError {
    #[error("that is not an Action: {detail}")]
    Malformed { detail: String },
    #[error("the Host speaks action version {supported}; this Action carries version {got}")]
    UnsupportedVersion { got: u64, supported: u16 },
    #[error("{0}")]
    InvalidSubtitleLanguage(#[from] InvalidSubtitleLanguage),
    #[error("the Host could not keep that change: {detail}")]
    Store { detail: String },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_envelope_parses_into_its_action() {
        let action = Action::parse(
            r#"{"version":1,"action":{"type":"set_subtitle_language","language":"pt-BR"}}"#,
        )
        .expect("a well-formed envelope parses");
        assert_eq!(
            action,
            Action::SetSubtitleLanguage {
                language: "pt-BR".to_owned()
            }
        );
    }

    #[test]
    fn an_envelope_is_flat_enough_to_write_by_hand() {
        let value =
            serde_json::to_value(Action::ClearSubtitleLanguage).expect("an Action serializes");
        assert_eq!(
            value,
            serde_json::json!({"type": "clear_subtitle_language"})
        );
    }
}
