use serde::{Deserialize, Serialize};

use crate::addon::{AddonId, InvalidAddonId, InvalidManifestUrl, ManifestUrl, MAX_STRING_LEN};
use crate::playback::{ChosenStream, InvalidSeekTarget, SeekTarget, Unplayable};
use crate::preferences::{InvalidSubtitleLanguage, SubtitleLanguage};
use crate::request::{
    CatalogRef, Extra, InvalidCatalogRef, InvalidTitleRef, InvalidVideoRef, TitleRef, VideoRef,
    MAX_EXTRAS,
};
use crate::secret::{InvalidTmdbKey, TmdbKey};
use crate::stream::Stream;

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
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Action {
    /// Prefer `language` when the Host chooses a subtitle track.
    SetSubtitleLanguage { language: String },
    /// Carry no subtitle-language preference; the Host chooses per Video.
    ClearSubtitleLanguage,
    /// Configure the Addon whose manifest is at `url`.
    AddAddon { url: String },
    /// Take the Addon with this manifest id out of the Host's configuration.
    RemoveAddon { id: String },
    /// Store the key TMDB answers metadata with, in the secret store.
    ///
    /// A change, though one that touches no store this Snapshot could carry the
    /// value of: the credential lands in the keyring or the fallback file, and
    /// only where it landed travels outward.
    SetTmdbKey { key: String },
    /// Carry no TMDB key; the Addons are the Host's only metadata source.
    ClearTmdbKey,
    /// Show a page of one Addon's catalog, in the Addon's own order.
    ///
    /// A question rather than a change: it asks what the Addon has, and what
    /// comes back goes to the client that asked and to no one else (ADR-0005).
    BrowseCatalog {
        /// The Addon to ask, by the id its manifest gave.
        addon: String,
        /// The catalog to ask for, by the type and id its manifest gave.
        catalog: CatalogRef,
        /// The values the client chose: `skip` to page on, `genre` to filter,
        /// and whatever else this catalog declared.
        #[serde(default)]
        extra: Vec<Extra>,
    },
    /// Search every configured Addon whose catalogs offer search.
    SearchCatalogs { query: String },
    /// Open a Title: its metadata, and the Videos it can be watched as.
    ///
    /// A question rather than a change, like browsing: what one Addon says about
    /// one item goes to the client that asked and to no one else (ADR-0005), so
    /// it answers and publishes no Snapshot.
    OpenTitle {
        /// The Addon to ask, by the id its manifest gave — the Addon whose
        /// catalog supplied the item.
        addon: String,
        /// The Title to open, by the type and id the item carried.
        title: TitleRef,
    },
    /// Find the Streams a Video can be played as.
    ///
    /// A question rather than a change, like browsing and opening a Title.
    /// Every configured Addon that answers for the Video's `stream` request is
    /// asked, in the order they were configured; each one's candidates go to
    /// the client that asked and to no one else (ADR-0005).
    FindStreams {
        /// The Video, by the type its Title carries and the id its Addon
        /// indexes it by (`tt0903747:1:1`).
        video: VideoRef,
    },
    /// Play a Stream a client chose.
    ///
    /// The candidate a client sends back is one the Host answered it with, and
    /// it is sent whole — the Addon's own words about it, and where its bytes
    /// are — because the Host re-asks nothing: what plays is the candidate the
    /// client picked. What travels outward again is the words, never the URL
    /// (ADR-0013).
    ///
    /// A change, not a question: playback is the one genuinely shared state, so
    /// every client is told what is playing.
    PlayStream {
        /// The Video being watched, as the Streams were asked for.
        video: VideoRef,
        /// The Addon whose answer the candidate came from.
        addon: String,
        /// The candidate itself, as it was answered.
        stream: Box<Stream>,
    },
    /// Hold the picture where it is, or let it run.
    SetPaused { paused: bool },
    /// Move within the Stream being played.
    Seek {
        /// Where to go, or how far to move.
        target: SeekTarget,
    },
    /// Stop playing: nothing is playing afterwards, and the client is back to
    /// whatever it was reading.
    StopPlayback,
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
            Action::AddAddon { url } => {
                let url = ManifestUrl::parse(&url)?;
                Ok(ValidatedAction::AddAddon(url))
            }
            Action::RemoveAddon { id } => {
                let id = AddonId::parse(&id)?;
                Ok(ValidatedAction::RemoveAddon(id))
            }
            Action::SetTmdbKey { key } => {
                let key = TmdbKey::parse(&key)?;
                Ok(ValidatedAction::SetTmdbKey(key))
            }
            Action::ClearTmdbKey => Ok(ValidatedAction::ClearTmdbKey),
            Action::BrowseCatalog {
                addon,
                catalog,
                extra,
            } => {
                let addon = AddonId::parse(&addon)?;
                let catalog = CatalogRef::parse(&catalog.r#type, &catalog.id)?;
                let extra = extras(extra)?;
                Ok(ValidatedAction::BrowseCatalog {
                    addon,
                    catalog,
                    extra,
                })
            }
            Action::SearchCatalogs { query } => {
                let query = search_query(&query)?;
                Ok(ValidatedAction::SearchCatalogs { query })
            }
            Action::OpenTitle { addon, title } => {
                let addon = AddonId::parse(&addon)?;
                let title = TitleRef::parse(&title.r#type, &title.id)?;
                Ok(ValidatedAction::OpenTitle { addon, title })
            }
            Action::FindStreams { video } => {
                let video = VideoRef::parse(&video.r#type, &video.id)?;
                Ok(ValidatedAction::FindStreams { video })
            }
            Action::PlayStream {
                video,
                addon,
                stream,
            } => {
                let video = VideoRef::parse(&video.r#type, &video.id)?;
                let addon = AddonId::parse(&addon)?;
                let chosen = ChosenStream::parse(video, addon, &stream)?;
                Ok(ValidatedAction::PlayStream(Box::new(chosen)))
            }
            // A seek that is not a number of seconds is refused before a Player
            // hears of it, the way a Video that is not one is refused before an
            // Addon does.
            Action::Seek { target } => {
                let target = target.checked()?;
                Ok(ValidatedAction::Seek { target })
            }
            Action::SetPaused { paused } => Ok(ValidatedAction::SetPaused { paused }),
            Action::StopPlayback => Ok(ValidatedAction::StopPlayback),
        }
    }
}

/// The values a client chose, each judged on its own.
///
/// A client sends a list of names and values; this is what says the list is of a
/// size the Host will put in a URL and that every name and value is something it
/// will send.
fn extras(extra: Vec<Extra>) -> Result<Vec<Extra>, ActionError> {
    if extra.len() > MAX_EXTRAS {
        return Err(ActionError::Extra {
            detail: format!("an Action carries at most {MAX_EXTRAS} extra values"),
        });
    }

    extra
        .into_iter()
        .map(|extra| {
            Extra::parse(&extra.name, &extra.value).map_err(|error| ActionError::Extra {
                detail: error.to_string(),
            })
        })
        .collect()
}

/// A search query, trimmed of the space a person leaves around it.
fn search_query(raw: &str) -> Result<String, ActionError> {
    let query = raw.trim();
    let refused = || ActionError::Query {
        detail: format!("{raw:?} is not something this Host will search for"),
    };

    if query.is_empty() || query.len() > MAX_STRING_LEN {
        return Err(refused());
    }
    if query.chars().any(char::is_control) {
        return Err(refused());
    }

    Ok(query.to_owned())
}

/// An Action that has passed validation, carrying its payload in its domain type.
///
/// Only [`Action::validate`] yields this, and only this reaches the Host's state,
/// so "validated before it mutated anything" is a property of the types rather
/// than of the order of two statements.
#[derive(Debug, Clone, PartialEq)]
pub enum ValidatedAction {
    SetSubtitleLanguage(SubtitleLanguage),
    ClearSubtitleLanguage,
    AddAddon(ManifestUrl),
    RemoveAddon(AddonId),
    SetTmdbKey(TmdbKey),
    ClearTmdbKey,
    BrowseCatalog {
        addon: AddonId,
        catalog: CatalogRef,
        extra: Vec<Extra>,
    },
    SearchCatalogs {
        query: String,
    },
    OpenTitle {
        addon: AddonId,
        title: TitleRef,
    },
    FindStreams {
        video: VideoRef,
    },
    /// A candidate judged: the URL a Player will be given, and the words that
    /// will be published about it. Boxed because a Stream carries its own words
    /// and the enum's other variants are a word or two wide.
    PlayStream(Box<ChosenStream>),
    SetPaused {
        paused: bool,
    },
    Seek {
        target: SeekTarget,
    },
    StopPlayback,
}

/// The wire form of an Action: a version and the Action.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
struct ActionEnvelope {
    version: u16,
    action: Action,
}

/// An Action that cannot be taken, and why — in the Host's own vocabulary, so a
/// client can act on the kind and a person can read the message.
#[derive(Debug, Clone, PartialEq, Serialize, thiserror::Error)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ActionError {
    #[error("that is not an Action: {detail}")]
    Malformed { detail: String },
    #[error("the Host speaks action version {supported}; this Action carries version {got}")]
    UnsupportedVersion { got: u64, supported: u16 },
    #[error("{0}")]
    InvalidSubtitleLanguage(#[from] InvalidSubtitleLanguage),
    #[error("{0}")]
    InvalidManifestUrl(#[from] InvalidManifestUrl),
    #[error("{0}")]
    InvalidAddonId(#[from] InvalidAddonId),
    #[error("{0}")]
    InvalidTmdbKey(#[from] InvalidTmdbKey),
    #[error("{0}")]
    InvalidCatalogRef(#[from] InvalidCatalogRef),
    #[error("{0}")]
    InvalidTitleRef(#[from] InvalidTitleRef),
    #[error("{0}")]
    InvalidVideoRef(#[from] InvalidVideoRef),
    #[error("{0}")]
    InvalidSeekTarget(#[from] InvalidSeekTarget),
    #[error("the Addon's manifest could not be read: {detail}")]
    Manifest { detail: String },
    #[error("{detail}")]
    Fetch { detail: String },
    #[error("no Addon with the id {id:?} is configured")]
    UnknownAddon { id: String },
    #[error("the Addon {addon} offers no catalog {catalog}")]
    UnknownCatalog { addon: AddonId, catalog: CatalogRef },
    #[error("the Addon {addon} offers no meta for {title}")]
    UnknownTitle { addon: AddonId, title: TitleRef },
    #[error("{detail}")]
    Extra { detail: String },
    #[error("{detail}")]
    Query { detail: String },
    #[error("the Addon's catalog could not be read: {detail}")]
    Catalog { detail: String },
    #[error("the Addon's meta response could not be read: {detail}")]
    Meta { detail: String },
    #[error("the Addon's stream response could not be read: {detail}")]
    Stream { detail: String },
    /// The Stream a client asked to play is not one this Host can play: an
    /// `infoHash` with no bridge to fetch it, or a URL this Host will not open.
    #[error("{0}")]
    Unplayable(#[from] Unplayable),
    /// There is nothing playing to do that to. A control that arrives for a
    /// Stream that has already ended or been stopped is refused rather than
    /// silently obeyed, so a client hears why nothing happened.
    #[error("nothing is playing, so the Host cannot {what}")]
    NothingPlaying { what: String },
    /// The Player is the Host's own limb and its refusal is not the client's
    /// fault: it says what it could not do, in the Player's own words.
    #[error("{detail}")]
    Playback { detail: String },
    #[error("the Host could not keep that change: {detail}")]
    Store { detail: String },
    #[error("the Host could not keep that credential: {detail}")]
    Secret { detail: String },
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

    #[test]
    fn a_catalog_is_named_inside_the_action_rather_than_beside_its_own_type() {
        // An Action already has a `type`. A second one beside it would be the
        // same JSON key twice, and which one won would be serde's business
        // rather than the Host's.
        let value = serde_json::to_value(Action::BrowseCatalog {
            addon: "community.stremboxd".to_owned(),
            catalog: CatalogRef::parse("movie", "letterboxd-popular")
                .expect("a catalog a manifest could declare"),
            extra: vec![Extra::of("skip", "100")],
        })
        .expect("an Action serializes");

        assert_eq!(
            value,
            serde_json::json!({
                "type": "browse_catalog",
                "addon": "community.stremboxd",
                "catalog": { "type": "movie", "id": "letterboxd-popular" },
                "extra": [{ "name": "skip", "value": "100" }],
            })
        );
    }

    #[test]
    fn an_action_that_asks_for_a_videos_streams_is_flat_enough_to_write_by_hand() {
        let value = serde_json::to_value(Action::FindStreams {
            video: VideoRef::parse("series", "tt0903747:1:1")
                .expect("a Video a request could name"),
        })
        .expect("an Action serializes");

        assert_eq!(
            value,
            serde_json::json!({
                "type": "find_streams",
                "video": { "type": "series", "id": "tt0903747:1:1" },
            }),
            "the Video is named inside the Action, because the Action already has a `type`"
        );
    }

    #[test]
    fn an_action_that_asks_for_a_video_that_is_not_one_is_refused_before_an_addon_hears_of_it() {
        assert!(matches!(
            Action::FindStreams {
                video: VideoRef {
                    r#type: "ser ies".to_owned(),
                    id: "tt0903747:1:1".to_owned(),
                },
            }
            .validate(),
            Err(ActionError::InvalidVideoRef(_))
        ));
    }

    #[test]
    fn an_action_that_plays_a_chosen_stream_is_flat_enough_to_write_by_hand() {
        // The candidate a client sends back is the one it was answered, whole:
        // what the Host acts on is where its bytes are, and what travels outward
        // again is the Addon's own words (ADR-0013).
        let action = Action::parse(&format!(
            r#"{{"version":{ACTION_VERSION},"action":{{"type":"play_stream",
                "video":{{"type":"movie","id":"tt0133093"}},
                "addon":"community.aiostreams",
                "stream":{{"name":"AIOStreams\n1080p","playback":{{"kind":"direct","url":"https://stream.example.org/v/x.mkv"}}}}}}}}"#
        ))
        .expect("a client's own envelope parses");

        let Action::PlayStream {
            video,
            addon,
            stream,
        } = action
        else {
            panic!("that is the Action a client sent");
        };
        assert_eq!(video.id, "tt0133093");
        assert_eq!(addon, "community.aiostreams");
        assert_eq!(
            stream.playback,
            crate::stream::Playback::Direct {
                url: "https://stream.example.org/v/x.mkv".to_owned(),
            }
        );

        let chosen = Action::PlayStream {
            video,
            addon,
            stream,
        }
        .validate()
        .expect("a direct URL is a candidate this Host plays");
        assert_eq!(
            chosen,
            ValidatedAction::PlayStream(Box::new(
                crate::playback::ChosenStream::parse(
                    VideoRef::parse("movie", "tt0133093").expect("a Video"),
                    AddonId::parse("community.aiostreams").expect("an Addon id"),
                    &crate::stream::Stream {
                        name: Some("AIOStreams\n1080p".to_owned()),
                        description: None,
                        playback: crate::stream::Playback::Direct {
                            url: "https://stream.example.org/v/x.mkv".to_owned(),
                        },
                        warnings: Vec::new(),
                        filename: None,
                        binge_group: None,
                    },
                )
                .expect("a direct URL is a candidate this Host plays")
            ))
        );
    }

    #[test]
    fn the_playback_controls_are_flat_enough_to_write_by_hand() {
        assert_eq!(
            serde_json::to_value(Action::SetPaused { paused: true }).expect("an Action serializes"),
            serde_json::json!({ "type": "set_paused", "paused": true })
        );
        assert_eq!(
            serde_json::to_value(Action::StopPlayback).expect("an Action serializes"),
            serde_json::json!({ "type": "stop_playback" })
        );
        assert_eq!(
            serde_json::to_value(Action::Seek {
                target: crate::playback::SeekTarget::By { seconds: -10.0 },
            })
            .expect("an Action serializes"),
            serde_json::json!({
                "type": "seek",
                "target": { "kind": "by", "seconds": -10.0 },
            }),
            "a seek says whether it is a place to go or a distance to move"
        );
    }

    #[test]
    fn an_action_that_asks_for_a_catalog_is_validated_before_it_is_asked_for() {
        assert!(matches!(
            Action::BrowseCatalog {
                addon: "not an id at all".to_owned(),
                catalog: CatalogRef::parse("movie", "top").expect("a catalog"),
                extra: Vec::new(),
            }
            .validate(),
            Err(ActionError::InvalidAddonId(_))
        ));
        assert!(matches!(
            Action::BrowseCatalog {
                addon: "community.example".to_owned(),
                catalog: CatalogRef {
                    r#type: "mov ie".to_owned(),
                    id: "top".to_owned()
                },
                extra: Vec::new(),
            }
            .validate(),
            Err(ActionError::InvalidCatalogRef(_))
        ));
        assert!(matches!(
            Action::BrowseCatalog {
                addon: "community.example".to_owned(),
                catalog: CatalogRef::parse("movie", "top").expect("a catalog"),
                extra: vec![Extra::of("not a name", "x")],
            }
            .validate(),
            Err(ActionError::Extra { .. })
        ));
    }

    #[test]
    fn a_search_query_is_trimmed_before_it_is_searched_for() {
        let validated = Action::SearchCatalogs {
            query: "  the matrix  ".to_owned(),
        }
        .validate();

        assert_eq!(
            validated,
            Ok(ValidatedAction::SearchCatalogs {
                query: "the matrix".to_owned()
            })
        );
    }

    #[test]
    fn a_search_for_nothing_is_refused_rather_than_searched_for() {
        for query in ["", "   ", "\n", &"a".repeat(MAX_STRING_LEN + 1)] {
            assert!(
                matches!(
                    Action::SearchCatalogs {
                        query: query.to_owned()
                    }
                    .validate(),
                    Err(ActionError::Query { .. })
                ),
                "{query:?} is not something to search for"
            );
        }
    }

    #[test]
    fn an_action_carrying_more_values_than_the_host_will_send_is_refused() {
        let extra = (0..=MAX_EXTRAS)
            .map(|index| Extra::of(format!("extra{index}"), "value"))
            .collect();

        assert!(matches!(
            Action::BrowseCatalog {
                addon: "community.example".to_owned(),
                catalog: CatalogRef::parse("movie", "top").expect("a catalog"),
                extra,
            }
            .validate(),
            Err(ActionError::Extra { .. })
        ));
    }

    #[test]
    fn a_key_entered_for_the_secret_store_is_judged_before_anything_is_written() {
        let ok = Action::SetTmdbKey {
            key: "0123456789abcdef".to_owned(),
        }
        .validate();
        assert_eq!(
            ok,
            Ok(ValidatedAction::SetTmdbKey(
                TmdbKey::parse("0123456789abcdef").expect("a key")
            )),
        );

        assert!(
            matches!(
                Action::SetTmdbKey {
                    key: "the key".to_owned(),
                }
                .validate(),
                Err(ActionError::InvalidTmdbKey(_))
            ),
            "a key shaped unlike any TMDB credential is refused before the store hears of it"
        );

        assert_eq!(
            Action::ClearTmdbKey.validate(),
            Ok(ValidatedAction::ClearTmdbKey)
        );
    }
}
