use serde::{Deserialize, Serialize};

use crate::addon::{AddonId, InvalidAddonId, InvalidManifestUrl, ManifestUrl, MAX_STRING_LEN};
use crate::device::{DeviceId, DeviceName, InvalidDeviceId, InvalidDeviceName};
use crate::pairing::{InvalidPairingCode, PairingCode};
use crate::playback::{
    checked_aspect, checked_crop, checked_speed, checked_subtitle_delay, checked_volume, Aspect,
    ChosenStream, Control, Crop, InvalidAspect, InvalidCrop, InvalidSeekTarget, InvalidSpeed,
    InvalidSubtitleDelay, InvalidVolume, SeekTarget, TrackId, Unplayable,
};
use crate::preferences::{InvalidSubtitleLanguage, SubtitleLanguage};
use crate::progress::{TitleCard, TitleStub};
use crate::request::{
    CatalogRef, Extra, InvalidCatalogRef, InvalidTitleRef, InvalidVideoRef, TitleRef, VideoRef,
    MAX_EXTRAS,
};
use crate::secret::{InvalidStremioLogin, InvalidTmdbKey, Password, StremioLogin, TmdbKey};
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
    /// Sign in to a Stremio account, so Watch progress travels both ways (#30).
    ///
    /// Optional, and off until this is taken. A change: the `authKey` Stremio
    /// answers with goes to the secret store and only the fact that one is held
    /// travels outward; the password is sent once and not kept.
    SignInStremio { email: String, password: Password },
    /// Forget the account: the `authKey` is taken out, and nothing talks to
    /// Stremio afterwards. Watch progress already merged stays where it is.
    SignOutStremio,
    /// Redeem the pairing code the Host is showing for a token of this device's
    /// own, under `name` (#31).
    ///
    /// The one Action a connection that has not paired may take: everything else
    /// is what a paired device is for. A change — the device is now one the Host
    /// knows, and its token is what later frames are judged by — and an answer,
    /// because the token goes to the device that asked and to nobody else. The
    /// code is single-use: redeeming it rotates the one the Host shows.
    PairDevice { code: String, name: String },
    /// Take a paired device's token away: it can do nothing from then on, and
    /// every other device keeps working (#31).
    ///
    /// A change like any other, so every client sees the device leave the list
    /// at the same moment it stops being able to act.
    RevokeDevice { id: String },
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
        /// The Title the Video belongs to, as the client was reading it: enough
        /// of it for the library to draw a card, and the Addon a removed one is
        /// judged against (#29). The client has it open — a Title is the
        /// client's own (ADR-0005) — so the Host is told which Title a Video is
        /// of rather than guessing one from an Addon that may not answer `meta`.
        title: TitleCard,
    },
    /// Play a Video again from where it was left.
    ///
    /// A change, like `PlayStream`: the Host reads its own Watch progress for the
    /// Video, asks the Addons that answer for its Streams, and opens the first
    /// candidate it can play *at the position it stored* (#29). The client names
    /// the Video and decides nothing else — where to resume from is the Host's
    /// own record.
    Resume { video: VideoRef },
    /// Hold the picture where it is, or let it run.
    SetPaused { paused: bool },
    /// Move within the Stream being played.
    Seek {
        /// Where to go, or how far to move.
        target: SeekTarget,
    },
    /// Play the audio track mpv numbers `track`.
    SetAudioTrack { track: i64 },
    /// Show the subtitles mpv numbers `track`, or none at all where it is null.
    SetSubtitleTrack { track: Option<i64> },
    /// Shift the subtitles by `seconds`, forward or back.
    SetSubtitleDelay { seconds: f64 },
    /// Play at `rate` times normal speed.
    SetSpeed { rate: f64 },
    /// Play at `level` on mpv's own scale.
    SetVolume { level: f64 },
    /// Hold the sound, or let it out.
    SetMuted { muted: bool },
    /// Move to the chapter after the one playing.
    NextChapter,
    /// Move to the chapter before it.
    PreviousChapter,
    /// Move to the chapter at `index` in the Stream's list.
    SetChapter { index: u32 },
    /// Crop the picture, or stop cropping it.
    SetCrop { crop: Crop },
    /// Override the shape the picture is drawn at.
    SetAspect { aspect: Aspect },
    /// Play the Video after the one playing, in its Title: the Addon's own next
    /// episode, and the release the one playing came from (ADR-0014).
    ///
    /// A change rather than a control like most of the rest — one of the two
    /// that legitimately open a Stream, the other being `Resume` — so the Host
    /// asks the Addons what comes next and plays it, and every client is told of
    /// the new Now playing.
    NextEpisode,
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
            Action::SignInStremio { email, password } => Ok(ValidatedAction::SignInStremio(
                StremioLogin::parse(&email, password.expose())?,
            )),
            Action::SignOutStremio => Ok(ValidatedAction::SignOutStremio),
            Action::PairDevice { code, name } => Ok(ValidatedAction::PairDevice {
                code: PairingCode::parse(&code)?,
                name: DeviceName::parse(&name)?,
            }),
            Action::RevokeDevice { id } => Ok(ValidatedAction::RevokeDevice(DeviceId::parse(&id)?)),
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
                title,
            } => {
                let video = VideoRef::parse(&video.r#type, &video.id)?;
                let addon = AddonId::parse(&addon)?;
                let chosen = ChosenStream::parse(video, addon, &stream)?;
                let title = TitleStub::parse(&title)?;
                Ok(ValidatedAction::PlayStream {
                    chosen: Box::new(chosen),
                    title,
                })
            }
            Action::Resume { video } => {
                let video = VideoRef::parse(&video.r#type, &video.id)?;
                Ok(ValidatedAction::Resume { video })
            }
            // A seek that is not a number of seconds is refused before a Player
            // hears of it, the way a Video that is not one is refused before an
            // Addon does.
            Action::Seek { target } => {
                let target = target.checked()?;
                Ok(ValidatedAction::Seek { target })
            }
            Action::SetAudioTrack { track } => Ok(ValidatedAction::SetAudioTrack {
                track: known_id(track, Control::AudioTrack)?,
            }),
            Action::SetSubtitleTrack { track } => Ok(ValidatedAction::SetSubtitleTrack {
                track: track
                    .map(|id| known_id(id, Control::SubtitleTrack))
                    .transpose()?,
            }),
            Action::SetSubtitleDelay { seconds } => Ok(ValidatedAction::SetSubtitleDelay {
                seconds: checked_subtitle_delay(seconds)?,
            }),
            Action::SetSpeed { rate } => Ok(ValidatedAction::SetSpeed {
                rate: checked_speed(rate)?,
            }),
            Action::SetVolume { level } => Ok(ValidatedAction::SetVolume {
                level: checked_volume(level)?,
            }),
            Action::SetMuted { muted } => Ok(ValidatedAction::SetMuted { muted }),
            Action::NextChapter => Ok(ValidatedAction::NextChapter),
            Action::PreviousChapter => Ok(ValidatedAction::PreviousChapter),
            Action::SetChapter { index } => Ok(ValidatedAction::SetChapter {
                index: index as usize,
            }),
            Action::SetCrop { crop } => {
                checked_crop(&crop)?;
                Ok(ValidatedAction::SetCrop { crop })
            }
            Action::SetAspect { aspect } => {
                checked_aspect(&aspect)?;
                Ok(ValidatedAction::SetAspect { aspect })
            }
            Action::NextEpisode => Ok(ValidatedAction::NextEpisode),
            Action::SetPaused { paused } => Ok(ValidatedAction::SetPaused { paused }),
            Action::StopPlayback => Ok(ValidatedAction::StopPlayback),
        }
    }
}

/// A track id a Player could be handed, or the refusal for one that is not a
/// track at all.
///
/// mpv numbers its tracks from one, so a zero or a negative id names nothing
/// anywhere; whether the id is *in the Stream* is the session's own record to
/// say, and is judged where the Stream is known.
fn known_id(id: i64, control: Control) -> Result<TrackId, ActionError> {
    TrackId::new(id).ok_or(ActionError::UnknownTrack { control, id })
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
    SignInStremio(StremioLogin),
    SignOutStremio,
    /// A redeemed pairing code and the name to pair the device under, both judged
    /// before anything is minted.
    PairDevice {
        code: PairingCode,
        name: DeviceName,
    },
    RevokeDevice(DeviceId),
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
    /// A candidate judged: the URL a Player will be given, the words that will
    /// be published about it, and the Title the Video is of — which is what the
    /// library records the play against. Boxed because a Stream carries its own
    /// words and the enum's other variants are a word or two wide.
    PlayStream {
        chosen: Box<ChosenStream>,
        title: TitleStub,
    },
    /// A Video to play again from where the Host's own Watch progress left it.
    Resume {
        video: VideoRef,
    },
    SetPaused {
        paused: bool,
    },
    Seek {
        target: SeekTarget,
    },
    SetAudioTrack {
        track: TrackId,
    },
    SetSubtitleTrack {
        track: Option<TrackId>,
    },
    SetSubtitleDelay {
        seconds: f64,
    },
    SetSpeed {
        rate: f64,
    },
    SetVolume {
        level: f64,
    },
    SetMuted {
        muted: bool,
    },
    NextChapter,
    PreviousChapter,
    SetChapter {
        index: usize,
    },
    SetCrop {
        crop: Crop,
    },
    SetAspect {
        aspect: Aspect,
    },
    /// The next episode of the Title playing, asked of the Addons and played:
    /// one of the two controls that open a Stream, the other being `Resume`.
    NextEpisode,
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
    #[error("{0}")]
    InvalidSpeed(#[from] InvalidSpeed),
    #[error("{0}")]
    InvalidVolume(#[from] InvalidVolume),
    #[error("{0}")]
    InvalidSubtitleDelay(#[from] InvalidSubtitleDelay),
    #[error("{0}")]
    InvalidAspect(#[from] InvalidAspect),
    #[error("{0}")]
    InvalidCrop(#[from] InvalidCrop),
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
    /// A track a control named that the Stream does not carry: refused before
    /// the Player hears of it, so a client is told rather than obeyed.
    #[error("the Stream has no {control} numbered {id}")]
    UnknownTrack { control: Control, id: i64 },
    /// A chapter a control named that the Stream does not have.
    #[error("the Stream has no chapter at position {index}")]
    UnknownChapter { index: usize },
    /// There is no next episode to play: what is playing is not an episode of a
    /// series, no Addon offers a Video after it, or none of an Addon's
    /// candidates for that Video is one this Host can play. The Host says so
    /// rather than playing something else, which is what ADR-0014 asks of it.
    #[error("{detail}")]
    NoNextEpisode { detail: String },
    /// A resume named a Video the Host has no Watch progress for: there is
    /// nothing to resume from, and playing it from the start would not be the
    /// thing the client asked for.
    #[error("the Host has no Watch progress for {video}")]
    NoProgress { video: VideoRef },
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
    #[error("the Addon's subtitles response could not be read: {detail}")]
    Subtitles { detail: String },
    /// The Stream a client asked to play is not one this Host can play: an
    /// `infoHash` with no bridge to fetch it, or a URL this Host will not open.
    #[error("{0}")]
    Unplayable(#[from] Unplayable),
    /// There is nothing playing to do that to. A control that arrives for a
    /// Stream that has already ended or been stopped is refused rather than
    /// silently obeyed, so a client hears why nothing happened.
    #[error("nothing is playing, so the Host cannot {control}")]
    NothingPlaying { control: Control },
    /// The Player is the Host's own limb and its refusal is not the client's
    /// fault: it says what it could not do, in the Player's own words.
    #[error("{detail}")]
    Playback { detail: String },
    #[error("the Host could not keep that change: {detail}")]
    Store { detail: String },
    #[error("the Host could not keep that credential: {detail}")]
    Secret { detail: String },
    #[error("{0}")]
    InvalidStremioLogin(#[from] InvalidStremioLogin),
    /// This Host was built without a way to reach Stremio's account service.
    #[error("this Host has no Stremio account sync")]
    SyncUnavailable,
    /// Stremio did not take the sign-in: wrong password, or not reachable. In
    /// Stremio's words and never with what was sent.
    #[error("{detail}")]
    Sync { detail: String },
    #[error("{0}")]
    InvalidPairingCode(#[from] InvalidPairingCode),
    #[error("{0}")]
    InvalidDeviceId(#[from] InvalidDeviceId),
    #[error("{0}")]
    InvalidDeviceName(#[from] InvalidDeviceName),
    /// A pairing code was offered that is not the one the Host is showing. The
    /// code is not carried back — a mistyped code may still be a code, and the
    /// Host has nothing useful to say about a string it has already refused.
    #[error("that is not the pairing code the Host is showing")]
    Pairing,
    /// A revoke named a device the Host does not have paired.
    #[error("no device with the id {id:?} is paired with this Host")]
    UnknownDevice { id: String },
    /// A connection that has not paired asked for something only a paired device
    /// may do. The one refusal the remote adapter makes on the Host's behalf,
    /// because "has this connection paired" is a fact about a socket and not
    /// about the state every client shares.
    #[error("this connection has not paired, so the Host will only take a pairing")]
    Unpaired,
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
        // again is the Addon's own words (ADR-0013). The Title rides beside it,
        // because the library draws a card from what the client was reading
        // (#29), and the Addon that supplied it is what a removed one is judged
        // against.
        let action = Action::parse(&format!(
            r#"{{"version":{ACTION_VERSION},"action":{{"type":"play_stream",
                "video":{{"type":"movie","id":"tt0133093"}},
                "addon":"community.aiostreams",
                "title":{{"addon":"com.linvo.cinemeta","id":"tt0133093","type":"movie",
                    "name":"The Matrix","poster":"https://images.example.org/matrix.jpg"}},
                "stream":{{"name":"AIOStreams\n1080p","playback":{{"kind":"direct","url":"https://stream.example.org/v/x.mkv"}}}}}}}}"#
        ))
        .expect("a client's own envelope parses");

        let Action::PlayStream {
            video,
            addon,
            stream,
            title,
        } = action
        else {
            panic!("that is the Action a client sent");
        };
        assert_eq!(video.id, "tt0133093");
        assert_eq!(addon, "community.aiostreams");
        assert_eq!(title.name, "The Matrix");
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
            title,
        }
        .validate()
        .expect("a direct URL is a candidate this Host plays");
        assert_eq!(
            chosen,
            ValidatedAction::PlayStream {
                chosen: Box::new(
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
                ),
                title: TitleStub::parse(&TitleCard {
                    addon: AddonId::parse("com.linvo.cinemeta").expect("an Addon id"),
                    id: "tt0133093".to_owned(),
                    r#type: "movie".to_owned(),
                    name: "The Matrix".to_owned(),
                    poster: Some("https://images.example.org/matrix.jpg".to_owned()),
                })
                .expect("a Title a request could name"),
            }
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

    #[test]
    fn every_control_action_parses_from_a_hand_written_envelope() {
        let cases = [
            (
                r#"{"type":"set_audio_track","track":1}"#,
                Action::SetAudioTrack { track: 1 },
            ),
            (
                r#"{"type":"set_subtitle_track","track":2}"#,
                Action::SetSubtitleTrack { track: Some(2) },
            ),
            (
                r#"{"type":"set_subtitle_track","track":null}"#,
                Action::SetSubtitleTrack { track: None },
            ),
            (
                r#"{"type":"set_subtitle_delay","seconds":-0.5}"#,
                Action::SetSubtitleDelay { seconds: -0.5 },
            ),
            (
                r#"{"type":"set_speed","rate":1.5}"#,
                Action::SetSpeed { rate: 1.5 },
            ),
            (
                r#"{"type":"set_volume","level":100.0}"#,
                Action::SetVolume { level: 100.0 },
            ),
            (
                r#"{"type":"set_muted","muted":true}"#,
                Action::SetMuted { muted: true },
            ),
            (r#"{"type":"next_chapter"}"#, Action::NextChapter),
            (r#"{"type":"previous_chapter"}"#, Action::PreviousChapter),
            (
                r#"{"type":"set_chapter","index":0}"#,
                Action::SetChapter { index: 0 },
            ),
            (
                r#"{"type":"set_crop","crop":{"kind":"rectangle","width":96,"height":72,"x":16,"y":0}}"#,
                Action::SetCrop {
                    crop: Crop::Rectangle {
                        width: 96,
                        height: 72,
                        x: 16,
                        y: 0,
                    },
                },
            ),
            (
                r#"{"type":"set_crop","crop":{"kind":"off"}}"#,
                Action::SetCrop { crop: Crop::Off },
            ),
            (
                r#"{"type":"set_aspect","aspect":{"kind":"ratio","value":1.7778}}"#,
                Action::SetAspect {
                    aspect: Aspect::Ratio { value: 1.7778 },
                },
            ),
            (
                r#"{"type":"set_aspect","aspect":{"kind":"source"}}"#,
                Action::SetAspect {
                    aspect: Aspect::Source,
                },
            ),
        ];

        for (body, expected) in cases {
            let envelope = format!(r#"{{"version":{ACTION_VERSION},"action":{body}}}"#);
            assert_eq!(
                Action::parse(&envelope),
                Ok(expected),
                "{body} is a control a client sends"
            );
        }
    }

    #[test]
    fn a_control_value_outside_its_bound_is_refused_with_the_right_kind() {
        assert!(matches!(
            Action::SetSpeed { rate: 0.04 }.validate(),
            Err(ActionError::InvalidSpeed(_))
        ));
        assert!(matches!(
            Action::SetVolume { level: 131.0 }.validate(),
            Err(ActionError::InvalidVolume(_))
        ));
        assert!(matches!(
            Action::SetSubtitleDelay { seconds: 3600.1 }.validate(),
            Err(ActionError::InvalidSubtitleDelay(_))
        ));
        assert!(matches!(
            Action::SetAspect {
                aspect: Aspect::Ratio { value: 0.0 },
            }
            .validate(),
            Err(ActionError::InvalidAspect(_))
        ));
        assert!(matches!(
            Action::SetCrop {
                crop: Crop::Rectangle {
                    width: 0,
                    height: 72,
                    x: 0,
                    y: 0,
                },
            }
            .validate(),
            Err(ActionError::InvalidCrop(_))
        ));
        assert!(
            matches!(
                Action::SetAudioTrack { track: 0 }.validate(),
                Err(ActionError::UnknownTrack { .. })
            ),
            "a zero or negative id names no track anywhere"
        );
        assert!(matches!(
            Action::SetSubtitleTrack { track: Some(-1) }.validate(),
            Err(ActionError::UnknownTrack { .. })
        ));
    }

    #[test]
    fn an_action_that_asks_for_the_next_episode_is_flat_and_judged_before_anything_is_asked() {
        let envelope =
            format!(r#"{{"version":{ACTION_VERSION},"action":{{"type":"next_episode"}}}}"#);

        assert_eq!(Action::parse(&envelope), Ok(Action::NextEpisode));
        assert_eq!(
            Action::NextEpisode.validate(),
            Ok(ValidatedAction::NextEpisode)
        );
        assert_eq!(
            serde_json::to_value(Action::NextEpisode).expect("an Action serializes"),
            serde_json::json!({ "type": "next_episode" })
        );
    }

    #[test]
    fn a_refusal_to_skip_to_the_next_episode_names_its_own_kind() {
        let refused = ActionError::NoNextEpisode {
            detail: "no Addon offers an episode after series/tt0903747:1:3".to_owned(),
        };

        assert_eq!(
            serde_json::to_value(&refused).expect("a refusal serializes"),
            serde_json::json!({
                "kind": "no_next_episode",
                "detail": "no Addon offers an episode after series/tt0903747:1:3",
            }),
            "a client acts on the kind and a person reads the sentence"
        );
    }

    #[test]
    fn the_controls_wire_shape_is_the_declared_one() {
        assert_eq!(
            serde_json::to_value(Action::SetSpeed { rate: 1.5 }).expect("an Action serializes"),
            serde_json::json!({ "type": "set_speed", "rate": 1.5 })
        );
        assert_eq!(
            serde_json::to_value(Action::SetCrop {
                crop: Crop::Rectangle {
                    width: 96,
                    height: 72,
                    x: 16,
                    y: 0,
                },
            })
            .expect("an Action serializes"),
            serde_json::json!({
                "type": "set_crop",
                "crop": { "kind": "rectangle", "width": 96, "height": 72, "x": 16, "y": 0 },
            }),
            "a crop names its own kind inside the field, because the Action already has a type"
        );
        assert_eq!(
            serde_json::to_value(Action::SetAspect {
                aspect: Aspect::Source,
            })
            .expect("an Action serializes"),
            serde_json::json!({
                "type": "set_aspect",
                "aspect": { "kind": "source" },
            })
        );
        assert_eq!(
            serde_json::to_value(Action::SetSubtitleTrack { track: None })
                .expect("an Action serializes"),
            serde_json::json!({ "type": "set_subtitle_track", "track": null }),
            "null is the subtitle track that is off"
        );
    }
}
