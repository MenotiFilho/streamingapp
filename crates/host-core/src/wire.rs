//! The wire protocol: the versioned frames a remote client and the Host exchange.
//!
//! This is the same translation the Tauri bridge does, written down as a codec
//! rather than lived out over IPC: a client sends a [`ClientFrame`], and the Host
//! answers with a [`ServerFrame`]. The command space is the Action space, not a
//! curated subset (ADR-0002), so a capability added for the window is added for
//! every remote client at once.
//!
//! Three things travel outward and they are worth keeping apart, because a
//! client's behaviour differs for each:
//!
//! - a [`ServerFrame::Reply`], correlated by the id of the command that asked;
//! - a [`ServerFrame::Refusal`], correlated the same way where the id could be
//!   read at all, carrying an [`ActionError`] in the Host's own vocabulary;
//! - a [`ServerFrame::Snapshot`], pushed to every paired client with no id,
//!   because nobody asked.
//!
//! The codec is pure: it parses text into frames and spells frames back into
//! text, and knows nothing of sockets, tokens or who may say what. The one
//! judgement that is a rule rather than a spelling — who may take which Action —
//! is [`permitted`], and it is pure too.
//!
//! The version is judged before anything else in a frame, exactly as the Action
//! envelope judges it: a client that speaks another version hears *that* rather
//! than a complaint about a field this Host has never heard of (#31).

use serde::Deserialize;
use serde_json::{json, Value};

use crate::action::{Action, ActionError, ACTION_VERSION};
use crate::device::{DeviceSummary, DeviceToken};
use crate::response::Response;
use crate::snapshot::Snapshot;

/// The version of the protocol, which is the version of the Action envelope.
///
/// Deliberately not a number of its own: the command space *is* the Action space,
/// so a client and the Host that agree on one number agree on the other, and
/// there is no second place for them to disagree.
pub const WIRE_VERSION: u16 = ACTION_VERSION;

/// A frame a client sends the Host.
#[derive(Debug, Clone, PartialEq)]
pub enum ClientFrame {
    /// Present the token a previous pairing issued, or nothing on a first
    /// connect. The Host answers [`ServerFrame::Welcome`], and what it says is
    /// whether this connection may do anything but pair.
    Hello { token: Option<DeviceToken> },
    /// Take an Action, carrying the id its reply will come back under.
    Command { id: u64, action: Action },
}

/// A frame the Host sends a client.
#[derive(Debug, Clone, PartialEq)]
pub enum ServerFrame {
    /// The answer to a [`ClientFrame::Hello`]: the device this connection is, or
    /// nothing, which is a connection that may only pair.
    Welcome { device: Option<DeviceSummary> },
    /// What taking a command produced, correlated by the command's id.
    Reply { id: u64, response: Response },
    /// A command that was not taken, and why. `id` is absent only when the frame
    /// was unreadable enough that there was no id to correlate — a version
    /// mismatch, or a frame that was not a frame.
    Refusal { id: Option<u64>, error: ActionError },
    /// State, pushed to every paired client. Boxed because a Snapshot is the
    /// largest thing here by an order of magnitude and every other frame is a
    /// handful of words.
    Snapshot(Box<Snapshot>),
}

/// A client frame that could not be read, already shaped as the refusal that
/// answers it.
#[derive(Debug, Clone, PartialEq)]
pub struct Refusal {
    pub id: Option<u64>,
    pub error: ActionError,
}

impl From<Refusal> for ServerFrame {
    fn from(refusal: Refusal) -> Self {
        ServerFrame::Refusal {
            id: refusal.id,
            error: refusal.error,
        }
    }
}

impl ClientFrame {
    /// Parse the wire form of a client frame.
    pub fn parse(json: &str) -> Result<Self, Refusal> {
        let value: Value = serde_json::from_str(json).map_err(|error| Refusal {
            id: None,
            error: ActionError::Malformed {
                detail: error.to_string(),
            },
        })?;
        Self::parse_value(&value)
    }

    /// Parse an already-decoded frame.
    ///
    /// The version is read off the raw value and judged before the frame is
    /// deserialized, so a client speaking another version is told so rather than
    /// being misparsed — the same order the Action envelope parses in.
    pub fn parse_value(value: &Value) -> Result<Self, Refusal> {
        // The id is worth reading before anything else that can fail: a frame
        // that is refused for its command can still be correlated.
        let id = value.get("id").and_then(Value::as_u64);

        let version = value
            .get("version")
            .and_then(Value::as_u64)
            .ok_or(Refusal {
                id,
                error: ActionError::Malformed {
                    detail: "the frame carries no numeric `version`".to_owned(),
                },
            })?;
        if version != u64::from(WIRE_VERSION) {
            return Err(Refusal {
                id,
                error: ActionError::UnsupportedVersion {
                    got: version,
                    supported: WIRE_VERSION,
                },
            });
        }

        let frame: ClientEnvelope =
            serde_json::from_value(value.clone()).map_err(|error| Refusal {
                id,
                error: ActionError::Malformed {
                    detail: error.to_string(),
                },
            })?;

        match (frame.hello, frame.command) {
            (Some(hello), None) => {
                if frame.id.is_some() {
                    return Err(malformed(id, "a greeting carries no `id`"));
                }
                Ok(Self::Hello { token: hello.token })
            }
            (None, Some(action)) => {
                let id = frame.id.ok_or_else(|| Refusal {
                    id: None,
                    error: ActionError::Malformed {
                        detail: "a command carries a numeric `id` to answer under".to_owned(),
                    },
                })?;
                Ok(Self::Command { id, action })
            }
            (Some(_), Some(_)) => Err(malformed(
                id,
                "a frame is a greeting or a command, not both",
            )),
            (None, None) => Err(malformed(id, "a frame carries no `hello` and no `command`")),
        }
    }

    /// The frame as the value a client would send. Its own spelling, so a test
    /// can hold both directions of the codec against one another.
    pub fn to_value(&self) -> Value {
        match self {
            Self::Hello { token } => json!({
                "version": WIRE_VERSION,
                "hello": { "token": token.as_ref().map(DeviceToken::as_str) },
            }),
            Self::Command { id, action } => json!({
                "version": WIRE_VERSION,
                "id": id,
                "command": serde_json::to_value(action).expect("an Action serializes"),
            }),
        }
    }

    /// The frame as the text a client would put on the wire.
    pub fn to_json(&self) -> String {
        self.to_value().to_string()
    }
}

impl ServerFrame {
    /// The frame as the value the Host puts on the wire.
    pub fn to_value(&self) -> Value {
        match self {
            Self::Welcome { device } => json!({
                "version": WIRE_VERSION,
                "welcome": {
                    "device": device
                        .as_ref()
                        .map(|device| serde_json::to_value(device).expect("a device serializes")),
                },
            }),
            Self::Reply { id, response } => json!({
                "version": WIRE_VERSION,
                "id": id,
                "response": serde_json::to_value(response).expect("a Response serializes"),
            }),
            Self::Refusal { id, error } => {
                let mut frame = json!({
                    "version": WIRE_VERSION,
                    "error": serde_json::to_value(error).expect("an ActionError serializes"),
                });
                // A frame that could not be read at all has no id to answer
                // under, and says so by carrying none.
                if let Some(id) = id {
                    frame["id"] = json!(id);
                }
                frame
            }
            Self::Snapshot(snapshot) => json!({
                "version": WIRE_VERSION,
                "snapshot": serde_json::to_value(snapshot).expect("a Snapshot serializes"),
            }),
        }
    }

    /// The frame as the text the Host puts on the wire.
    pub fn to_json(&self) -> String {
        self.to_value().to_string()
    }
}

/// Whether a client in this state may take this Action.
///
/// One rule, and it is the whole of what "unpaired" means: a connection that has
/// not paired may attempt to pair and nothing else. Node for node, every other
/// Action is what a paired device is for, so an open port on the network is not
/// a playback remote for whoever finds it (#31).
pub fn permitted(action: &Action, paired: bool) -> Result<(), ActionError> {
    if paired || matches!(action, Action::PairDevice { .. }) {
        Ok(())
    } else {
        Err(ActionError::Unpaired)
    }
}

fn malformed(id: Option<u64>, detail: &str) -> Refusal {
    Refusal {
        id,
        error: ActionError::Malformed {
            detail: detail.to_owned(),
        },
    }
}

/// The wire form of a client frame, as serde sees it.
///
/// Strict about the envelope, the way the Action envelope is: the version lives
/// here, so a misspelled key at this level is a frame this Host does not speak.
/// A field inside an Action is still the Action's own business and may be one
/// this Host does not know.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ClientEnvelope {
    // Read off the raw value and judged before this struct is built, so that a
    // frame in another version is refused as a version rather than misparsed.
    // Kept as a field only because `deny_unknown_fields` must know the key.
    #[allow(dead_code)]
    version: u64,
    #[serde(default)]
    id: Option<u64>,
    #[serde(default)]
    hello: Option<Hello>,
    #[serde(default)]
    command: Option<Action>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Hello {
    #[serde(default)]
    token: Option<DeviceToken>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_command_is_flat_enough_to_write_by_hand() {
        let frame = ClientFrame::parse(
            r#"{"version":1,"id":7,"command":{"type":"set_paused","paused":true}}"#,
        )
        .expect("a well-formed command parses");

        assert_eq!(
            frame,
            ClientFrame::Command {
                id: 7,
                action: Action::SetPaused { paused: true },
            }
        );
    }

    #[test]
    fn a_greeting_may_carry_a_token_or_nothing() {
        assert_eq!(
            ClientFrame::parse(r#"{"version":1,"hello":{}}"#).expect("a first connect"),
            ClientFrame::Hello { token: None }
        );

        let token = "a".repeat(43);
        assert_eq!(
            ClientFrame::parse(&format!(r#"{{"version":1,"hello":{{"token":"{token}"}}}}"#))
                .expect("a reconnect"),
            ClientFrame::Hello {
                token: Some(DeviceToken::parse(&token).expect("a token")),
            }
        );
    }

    #[test]
    fn a_frame_in_another_version_is_refused_as_a_version_rather_than_misparsed() {
        // A version 2 client's command carries an action this Host has never
        // heard of. It must hear about the version, not the action.
        let refused = ClientFrame::parse(
            r#"{"version":2,"id":9,"command":{"type":"something_from_the_future"}}"#,
        )
        .expect_err("version 2 is not version 1");

        assert_eq!(
            refused,
            Refusal {
                id: Some(9),
                error: ActionError::UnsupportedVersion {
                    got: 2,
                    supported: WIRE_VERSION,
                },
            },
            "the id is still read, so the refusal can be correlated"
        );
    }

    #[test]
    fn a_frame_with_no_version_at_all_is_malformed_rather_than_versioned() {
        let refused =
            ClientFrame::parse(r#"{"id":1,"command":{"type":"stop_playback"}}"#).unwrap_err();

        assert!(matches!(refused.error, ActionError::Malformed { .. }));
    }

    #[test]
    fn a_command_without_an_id_cannot_be_answered_and_is_refused() {
        let refused =
            ClientFrame::parse(r#"{"version":1,"command":{"type":"stop_playback"}}"#).unwrap_err();

        assert!(matches!(refused.error, ActionError::Malformed { .. }));
        assert_eq!(refused.id, None);
    }

    #[test]
    fn a_frame_that_is_both_a_greeting_and_a_command_is_refused() {
        let refused = ClientFrame::parse(
            r#"{"version":1,"id":1,"hello":{},"command":{"type":"stop_playback"}}"#,
        )
        .unwrap_err();

        assert!(matches!(refused.error, ActionError::Malformed { .. }));
    }

    #[test]
    fn a_frame_carries_a_greeting_or_a_command_and_not_neither() {
        let refused = ClientFrame::parse(r#"{"version":1,"id":1}"#).unwrap_err();
        assert!(matches!(refused.error, ActionError::Malformed { .. }));
    }

    #[test]
    fn a_frame_with_a_key_this_host_does_not_speak_is_refused() {
        // The version lives at this level, so a misspelling here is a frame this
        // Host cannot place at all.
        let refused =
            ClientFrame::parse(r#"{"version":1,"id":1,"commnad":{"type":"stop_playback"}}"#)
                .unwrap_err();

        assert!(matches!(refused.error, ActionError::Malformed { .. }));
    }

    #[test]
    fn the_frames_spell_themselves_the_way_the_clients_read_them() {
        assert_eq!(
            ServerFrame::Refusal {
                id: Some(4),
                error: ActionError::Unpaired,
            }
            .to_value(),
            json!({
                "version": 1,
                "id": 4,
                "error": { "kind": "unpaired" },
            }),
        );
        assert_eq!(
            ServerFrame::Refusal {
                id: None,
                error: ActionError::UnsupportedVersion {
                    got: 2,
                    supported: 1,
                },
            }
            .to_value(),
            json!({
                "version": 1,
                "error": { "kind": "unsupported_version", "got": 2, "supported": 1 },
            }),
            "a frame with no id says so by carrying none"
        );
        assert_eq!(
            ServerFrame::Welcome { device: None }.to_value(),
            json!({ "version": 1, "welcome": { "device": null } }),
        );
    }

    #[test]
    fn a_client_frame_spells_itself_back_into_itself() {
        let command = ClientFrame::Command {
            id: 12,
            action: Action::StopPlayback,
        };
        assert_eq!(
            ClientFrame::parse(&command.to_json()).expect("the frame it just wrote"),
            command
        );

        let hello = ClientFrame::Hello {
            token: Some(DeviceToken::parse(&"b".repeat(43)).expect("a token")),
        };
        assert_eq!(
            ClientFrame::parse(&hello.to_json()).expect("the frame it just wrote"),
            hello
        );
    }

    #[test]
    fn an_unpaired_connection_may_only_attempt_to_pair() {
        assert!(permitted(
            &Action::PairDevice {
                code: "ABCDEF".to_owned(),
                name: "Phone".to_owned(),
            },
            false,
        )
        .is_ok());

        assert_eq!(
            permitted(&Action::StopPlayback, false),
            Err(ActionError::Unpaired)
        );
        assert_eq!(
            permitted(
                &Action::BrowseCatalog {
                    addon: "community.example".to_owned(),
                    catalog: crate::request::CatalogRef::parse("movie", "top").expect("a catalog"),
                    extra: Vec::new(),
                },
                false,
            ),
            Err(ActionError::Unpaired)
        );

        // A paired device may pair another if it is showing the code, and may do
        // everything else.
        assert!(permitted(&Action::StopPlayback, true).is_ok());
        assert!(permitted(
            &Action::PairDevice {
                code: "ABCDEF".to_owned(),
                name: "Laptop".to_owned(),
            },
            true,
        )
        .is_ok());
    }
}
