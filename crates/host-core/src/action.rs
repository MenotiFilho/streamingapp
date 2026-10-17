use serde::{Deserialize, Serialize};

use crate::addon::{AddonId, InvalidAddonId, InvalidManifestUrl, ManifestUrl, MAX_STRING_LEN};
use crate::device::{DeviceId, DeviceName, InvalidDeviceId, InvalidDeviceName};
use crate::meta::TitleKey;
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
use crate::tmdb;

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
    /// Mark the Addon's Catalog as the Host's featured feed.
    ///
    /// A preference of the Host's rather than a client's: every client's Home
    /// hero is drawn from this Catalog's first items, so the marking travels in
    /// every Snapshot rather than stopping at the client that made it (#74).
    SetFeaturedCatalog { addon: String, catalog: CatalogRef },
    /// Carry no Featured catalog: a client's Home has no hero to draw. The
    /// mirror of [`Action::SetFeaturedCatalog`], and never refused — taking a
    /// preference away is always something the Host can do.
    ClearFeaturedCatalog,
    /// Configure the Addon whose manifest is at `url`.
    AddAddon { url: String },
    /// Move the configured Addon with manifest `id` to the 0-based `position`
    /// in the persisted order.
    ///
    /// The order is the Host's, shared across every client — a client's Home
    /// rows follow it — so the move is published like any other change (#74).
    /// A position is signed on the wire so that every number the list does not
    /// have, a negative one included, is refused as [`ActionError::InvalidPosition`]
    /// rather than as a malformed Action.
    ReorderAddon { id: String, position: i64 },
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
    /// Browse the one feed that is not an Addon's: TMDB's page of Discovered
    /// Titles (#75, ADR-0020).
    ///
    /// A question rather than a change, like browsing and searching: what TMDB
    /// answers goes to the client that asked and to no one else (ADR-0005).
    /// With neither a genre nor a sort order it is the week's trending feed;
    /// with one it is a `/discover` page, filtered in the terms that kind is
    /// discovered by — the two kinds do not share their genres or their sort
    /// orders. Every page is asked fresh, and a failed call (a `429` included)
    /// comes back as a row carrying why rather than as a refused Action. The
    /// ask needs a held TMDB Credential, and with none it refuses cleanly.
    Discover {
        /// The kind to discover: a `movie` or a `series`.
        kind: String,
        /// Which page of the feed, numbered from 1.
        page: u32,
        /// A genre id from the list TMDB has for the kind, where the client
        /// chose one.
        #[serde(default)]
        genre: Option<u32>,
        /// A `sort_by` value from TMDB's enum for the kind, where the client
        /// chose one.
        #[serde(default)]
        sort: Option<String>,
    },
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
    /// Open a Discovered Title: one TMDB named before any Addon did.
    ///
    /// A question rather than a change, like opening any Title: what TMDB says
    /// about one record goes to the client that asked and to no one else
    /// (ADR-0005). It is its own Action rather than `open_title` with no Addon,
    /// because `open_title`'s meaning is "ask this Addon" and a Discovered
    /// Title has none to ask (ADR-0020).
    OpenDiscoveredTitle {
        /// What the Title is keyed by. A Discovered Title is TMDB's, by
        /// definition: a key naming an Addon is refused, and `open_title` is
        /// the question for it.
        key: TitleKey,
        /// The kind TMDB has a record for, in the protocol's spelling:
        /// `movie` or `series`.
        kind: String,
    },
    /// Find the Streams a Video can be played as.
    ///
    /// A question rather than a change, like browsing and opening a Title.
    /// Every configured Addon that answers for the Video's `stream` request is
    /// asked, in the configured order; each one's candidates go to
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
        /// of it for Continue watching to draw a card, and the Addon a removed
        /// one is judged against (#29). The client has it open — a Title is the
        /// client's own (ADR-0005) — so the Host is told which Title a Video is
        /// of rather than guessing one from an Addon that may not answer `meta`.
        /// Boxed because a card is the largest payload an Action carries beside
        /// a Stream, which is boxed beside it for the same reason.
        title: Box<TitleCard>,
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
    /// Play the Video *before* the one playing, in its Title: the Addon's own
    /// previous episode, and the release the one playing came from (ADR-0021).
    ///
    /// The mirror of [`Action::NextEpisode`], and a change for the same reason:
    /// the Host asks the Addons what the Addon's own order puts before what is
    /// playing and opens it, and every client is told of the new Now playing.
    PreviousEpisode,
    /// Stop playing: nothing is playing afterwards, and the client is back to
    /// whatever it was reading.
    StopPlayback,
}

/// The Action surface written down once: every variant's own `type` tag, and the
/// list of them.
///
/// A macro rather than a const and a hand-written `match` because the two must
/// not be able to disagree: `spelling` is an exhaustive `match`, so the compiler
/// refuses to build when a variant is added without a line below, and
/// [`Action::SPELLINGS`] is built from the same lines, so a spelling cannot reach
/// one and miss the other. That is what makes "a capability added to the surface
/// is one every client is held to have" a property of the build rather than a
/// promise in a comment (#32, ADR-0018).
macro_rules! action_spellings {
    ($( $action:pat => $spelling:literal ),* $(,)?) => {
        impl Action {
            /// Every Action's wire spelling, in declaration order: the one
            /// surface, written down as data, which a client's capability list
            /// is asserted against (#32, ADR-0018).
            pub const SPELLINGS: &'static [&'static str] = &[ $($spelling),* ];

            /// This Action's own `type` tag, the spelling the wire carries.
            pub fn spelling(&self) -> &'static str {
                match self {
                    $( $action => $spelling, )*
                }
            }
        }
    };
}

action_spellings! {
    Action::SetSubtitleLanguage { .. } => "set_subtitle_language",
    Action::ClearSubtitleLanguage => "clear_subtitle_language",
    Action::SetFeaturedCatalog { .. } => "set_featured_catalog",
    Action::ClearFeaturedCatalog => "clear_featured_catalog",
    Action::AddAddon { .. } => "add_addon",
    Action::ReorderAddon { .. } => "reorder_addon",
    Action::RemoveAddon { .. } => "remove_addon",
    Action::SetTmdbKey { .. } => "set_tmdb_key",
    Action::ClearTmdbKey => "clear_tmdb_key",
    Action::SignInStremio { .. } => "sign_in_stremio",
    Action::SignOutStremio => "sign_out_stremio",
    Action::PairDevice { .. } => "pair_device",
    Action::RevokeDevice { .. } => "revoke_device",
    Action::BrowseCatalog { .. } => "browse_catalog",
    Action::SearchCatalogs { .. } => "search_catalogs",
    Action::Discover { .. } => "discover",
    Action::OpenTitle { .. } => "open_title",
    Action::OpenDiscoveredTitle { .. } => "open_discovered_title",
    Action::FindStreams { .. } => "find_streams",
    Action::PlayStream { .. } => "play_stream",
    Action::Resume { .. } => "resume",
    Action::SetPaused { .. } => "set_paused",
    Action::Seek { .. } => "seek",
    Action::SetAudioTrack { .. } => "set_audio_track",
    Action::SetSubtitleTrack { .. } => "set_subtitle_track",
    Action::SetSubtitleDelay { .. } => "set_subtitle_delay",
    Action::SetSpeed { .. } => "set_speed",
    Action::SetVolume { .. } => "set_volume",
    Action::SetMuted { .. } => "set_muted",
    Action::NextChapter => "next_chapter",
    Action::PreviousChapter => "previous_chapter",
    Action::SetChapter { .. } => "set_chapter",
    Action::SetCrop { .. } => "set_crop",
    Action::SetAspect { .. } => "set_aspect",
    Action::NextEpisode => "next_episode",
    Action::PreviousEpisode => "previous_episode",
    Action::StopPlayback => "stop_playback",
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
            Action::SetFeaturedCatalog { addon, catalog } => {
                let addon = AddonId::parse(&addon)?;
                let catalog = CatalogRef::parse(&catalog.r#type, &catalog.id)?;
                Ok(ValidatedAction::SetFeaturedCatalog { addon, catalog })
            }
            Action::ClearFeaturedCatalog => Ok(ValidatedAction::ClearFeaturedCatalog),
            Action::AddAddon { url } => {
                let url = ManifestUrl::parse(&url)?;
                Ok(ValidatedAction::AddAddon(url))
            }
            Action::ReorderAddon { id, position } => {
                let id = AddonId::parse(&id)?;
                Ok(ValidatedAction::ReorderAddon { id, position })
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
            Action::Discover {
                kind,
                page,
                genre,
                sort,
            } => {
                let query =
                    tmdb::DiscoverQuery::parse(&kind, page, genre, sort).map_err(|error| {
                        ActionError::InvalidDiscover {
                            detail: error.to_string(),
                        }
                    })?;
                Ok(ValidatedAction::Discover { query })
            }
            Action::OpenTitle { addon, title } => {
                let addon = AddonId::parse(&addon)?;
                let title = TitleRef::parse(&title.r#type, &title.id)?;
                Ok(ValidatedAction::OpenTitle { addon, title })
            }
            Action::OpenDiscoveredTitle { key, kind } => {
                // The kind is judged first: an id names nothing without the
                // kind whose records it is a number in.
                let kind =
                    tmdb::Kind::parse(&kind).ok_or_else(|| ActionError::NotDiscoveredTitle {
                        detail: format!("{kind:?} is not a kind TMDB has records for"),
                    })?;
                let TitleKey::Tmdb { id } = key else {
                    return Err(ActionError::NotDiscoveredTitle {
                        detail: "the key names an Addon, which is `open_title`'s question"
                            .to_owned(),
                    });
                };
                let id = tmdb::TmdbId::from_number(id).ok_or_else(|| {
                    ActionError::NotDiscoveredTitle {
                        detail: "no TMDB record is numbered zero".to_owned(),
                    }
                })?;

                Ok(ValidatedAction::OpenDiscoveredTitle { id, kind })
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
            Action::PreviousEpisode => Ok(ValidatedAction::PreviousEpisode),
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
    /// A Catalog the owner marked as the featured one, with both halves judged
    /// before either is looked up: a marked Catalog exists.
    SetFeaturedCatalog {
        addon: AddonId,
        catalog: CatalogRef,
    },
    ClearFeaturedCatalog,
    AddAddon(ManifestUrl),
    /// An Addon to write back at `position` in the order. Judged here as an id
    /// and a number; whether the number is a place the list has is the Host's
    /// judgement, made where the list is known (#74).
    ReorderAddon {
        id: AddonId,
        position: i64,
    },
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
    /// A Discover ask judged: the feed, its page and its filters, in TMDB's own
    /// terms (#75, ADR-0020).
    Discover {
        query: tmdb::DiscoverQuery,
    },
    OpenTitle {
        addon: AddonId,
        title: TitleRef,
    },
    /// A Discovered Title to open against TMDB: the record, and the kind whose
    /// records its number is in.
    OpenDiscoveredTitle {
        id: tmdb::TmdbId,
        kind: tmdb::Kind,
    },
    FindStreams {
        video: VideoRef,
    },
    /// A candidate judged: the URL a Player will be given, the words that will
    /// be published about it, and the Title the Video is of — which is what
    /// Continue watching records the play against. Boxed because a Stream
    /// carries its own words and the enum's other variants are a word or two
    /// wide.
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
    /// The previous episode of the Title playing, asked of the Addons and
    /// played — the mirror of `NextEpisode` (ADR-0021).
    PreviousEpisode,
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
    /// `open_discovered_title` was handed something that is not a Discovered
    /// Title: a key that names an Addon, a kind TMDB keeps no records for, or
    /// an id no record is numbered by. A Title with an Addon behind it is
    /// `open_title`'s question, not this one's (#76, ADR-0020).
    #[error("that is not a Discovered Title: {detail}")]
    NotDiscoveredTitle { detail: String },
    /// A Discover ask TMDB cannot be given: a kind it does not discover, a page
    /// it does not number, a genre or a sort order from the other kind's set
    /// (#75, ADR-0020).
    #[error("{detail}")]
    InvalidDiscover { detail: String },
    /// A question only TMDB can answer, asked of a Host that holds no TMDB key:
    /// Discover, and a Discovered Title — both are TMDB's, and neither has an
    /// Addon to fall back to (#75, #76, ADR-0020).
    #[error("this Host holds no TMDB key, so it cannot ask TMDB")]
    NoTmdbCredential,
    /// TMDB could not answer a question that only TMDB can: the ask failed, or
    /// the answer could not be read. TMDB is not an Addon, and what was to come
    /// from its record has no other source to fall back to (#75, #76,
    /// ADR-0020). The detail never carries the URL a credential rode in.
    #[error("{detail}")]
    Tmdb { detail: String },
    /// A track a control named that the Stream does not carry: refused before
    /// the Player hears of it, so a client is told rather than obeyed.
    #[error("the Stream has no {control} numbered {id}")]
    UnknownTrack { control: Control, id: i64 },
    /// A chapter a control named that the Stream does not have.
    #[error("the Stream has no chapter at position {index}")]
    UnknownChapter { index: usize },
    /// A place in the configured Addons that the list does not have: the order
    /// is 0-based, and moving an Addon somewhere off either end — a negative
    /// number included — is a refusal rather than a clamp (#74).
    #[error(
        "the Addon {id:?} cannot be moved to position {position}: the Host has {count} configured"
    )]
    InvalidPosition {
        id: String,
        position: i64,
        count: usize,
    },
    /// There is no next episode to play: what is playing is not an episode of a
    /// series, no Addon offers a Video after it, or none of an Addon's
    /// candidates for that Video is one this Host can play. The Host says so
    /// rather than playing something else, which is what ADR-0014 asks of it.
    #[error("{detail}")]
    NoNextEpisode { detail: String },
    /// There is no previous episode to play: the mirror of
    /// [`Self::NoNextEpisode`] — what is playing is not an episode of a series,
    /// the Addon's own order begins at it, or none of an Addon's candidates for
    /// the Video before it is one this Host can play (ADR-0021).
    #[error("{detail}")]
    NoPreviousEpisode { detail: String },
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
    /// A connection that has already paired tried to redeem a pairing code. A
    /// device pairs by being unpaired: the code is for a client that is not in
    /// yet, and a device that is in already has everything pairing would buy it.
    #[error("this connection has already paired; a device pairs by being unpaired")]
    AlreadyPaired,
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
        // because Continue watching draws a card from what the client was
        // reading (#29), and the Addon that supplied it is what a removed one is
        // judged against.
        let action = Action::parse(&format!(
            r#"{{"version":{ACTION_VERSION},"action":{{"type":"play_stream",
                "video":{{"type":"movie","id":"tt0133093"}},
                "addon":"community.aiostreams",
                "title":{{"addon":"com.linvo.cinemeta","id":"tt0133093","type":"movie",
                    "name":"The Matrix","poster":"https://images.example.org/matrix.jpg",
                    "background":"https://images.example.org/matrix-backdrop.jpg"}},
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
                    addon: Some(AddonId::parse("com.linvo.cinemeta").expect("an Addon id")),
                    id: "tt0133093".to_owned(),
                    r#type: "movie".to_owned(),
                    name: "The Matrix".to_owned(),
                    poster: Some("https://images.example.org/matrix.jpg".to_owned()),
                    background: Some("https://images.example.org/matrix-backdrop.jpg".to_owned()),
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
    fn the_addon_order_and_the_featured_catalog_are_flat_enough_to_write_by_hand() {
        assert_eq!(
            serde_json::to_value(Action::ReorderAddon {
                id: "community.example".to_owned(),
                position: 1,
            })
            .expect("an Action serializes"),
            serde_json::json!({
                "type": "reorder_addon",
                "id": "community.example",
                "position": 1,
            })
        );
        assert_eq!(
            serde_json::to_value(Action::SetFeaturedCatalog {
                addon: "community.example".to_owned(),
                catalog: CatalogRef::parse("movie", "top")
                    .expect("a catalog a manifest could declare"),
            })
            .expect("an Action serializes"),
            serde_json::json!({
                "type": "set_featured_catalog",
                "addon": "community.example",
                "catalog": { "type": "movie", "id": "top" },
            }),
            "the Catalog is named inside the Action, because the Action already has a `type`"
        );
        assert_eq!(
            serde_json::to_value(Action::ClearFeaturedCatalog).expect("an Action serializes"),
            serde_json::json!({ "type": "clear_featured_catalog" })
        );
    }

    #[test]
    fn a_reorder_and_a_featured_catalog_are_judged_before_the_host_is_asked() {
        assert!(matches!(
            Action::ReorderAddon {
                id: "not an id at all".to_owned(),
                position: 0,
            }
            .validate(),
            Err(ActionError::InvalidAddonId(_))
        ));
        assert!(matches!(
            Action::SetFeaturedCatalog {
                addon: "community.example".to_owned(),
                catalog: CatalogRef {
                    r#type: "mov ie".to_owned(),
                    id: "top".to_owned(),
                },
            }
            .validate(),
            Err(ActionError::InvalidCatalogRef(_))
        ));

        assert_eq!(
            Action::ReorderAddon {
                id: "community.example".to_owned(),
                position: 2,
            }
            .validate(),
            Ok(ValidatedAction::ReorderAddon {
                id: AddonId::parse("community.example").expect("an Addon id"),
                position: 2,
            })
        );
        assert_eq!(
            Action::SetFeaturedCatalog {
                addon: "community.example".to_owned(),
                catalog: CatalogRef::parse("movie", "top").expect("a catalog"),
            }
            .validate(),
            Ok(ValidatedAction::SetFeaturedCatalog {
                addon: AddonId::parse("community.example").expect("an Addon id"),
                catalog: CatalogRef::parse("movie", "top").expect("a catalog"),
            })
        );
        assert_eq!(
            Action::ClearFeaturedCatalog.validate(),
            Ok(ValidatedAction::ClearFeaturedCatalog)
        );
    }

    #[test]
    fn a_position_the_configured_addons_do_not_have_names_its_own_kind() {
        let refused = ActionError::InvalidPosition {
            id: "community.example".to_owned(),
            position: 2,
            count: 2,
        };

        assert_eq!(
            serde_json::to_value(&refused).expect("a refusal serializes"),
            serde_json::json!({
                "kind": "invalid_position",
                "id": "community.example",
                "position": 2,
                "count": 2,
            }),
            "a client acts on the kind, and the numbers say what the list had"
        );
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
    fn an_action_that_asks_to_discover_is_flat_and_judged_before_tmdb_is_asked() {
        let envelope = format!(
            r#"{{"version":{ACTION_VERSION},"action":{{"type":"discover","kind":"series","page":2,"genre":10765}}}}"#
        );

        let action = Action::parse(&envelope).expect("a client's own envelope parses");
        assert_eq!(
            action,
            Action::Discover {
                kind: "series".to_owned(),
                page: 2,
                genre: Some(10765),
                sort: None,
            },
            "a filter the client left out is a filter it did not choose"
        );
        assert_eq!(
            action.clone().validate(),
            Ok(ValidatedAction::Discover {
                query: tmdb::DiscoverQuery {
                    kind: tmdb::Kind::Tv,
                    page: 2,
                    genre: Some(10765),
                    sort: None,
                },
            }),
            "the ask reaches the Host as TMDB's own terms"
        );
        assert_eq!(
            serde_json::to_value(action).expect("an Action serializes"),
            serde_json::json!({
                "type": "discover",
                "kind": "series",
                "page": 2,
                "genre": 10765,
                "sort": null,
            })
        );
    }

    #[test]
    fn a_discover_ask_that_is_not_one_is_refused_with_what_is_wrong() {
        let refused = Action::Discover {
            kind: "series".to_owned(),
            page: 1,
            genre: Some(28),
            sort: None,
        }
        .validate();

        assert_eq!(
            refused,
            Err(ActionError::InvalidDiscover {
                detail: "genre 28 is not one of the genres TMDB lists for a series".to_owned(),
            }),
            "a film's genre on a series is refused before TMDB hears of it"
        );
    }

    #[test]
    fn a_discover_ask_with_no_credential_held_names_its_own_kind() {
        let refused = ActionError::NoTmdbCredential;

        assert_eq!(
            serde_json::to_value(&refused).expect("a refusal serializes"),
            serde_json::json!({ "kind": "no_tmdb_credential" }),
            "a client acts on the kind and a person reads the sentence"
        );
    }

    #[test]
    fn a_tmdb_answer_that_could_not_be_read_names_tmdb_rather_than_an_addon() {
        let refused = ActionError::Tmdb {
            detail: "TMDB answered with status 429".to_owned(),
        };

        assert_eq!(
            serde_json::to_value(&refused).expect("a refusal serializes"),
            serde_json::json!({
                "kind": "tmdb",
                "detail": "TMDB answered with status 429",
            })
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
    fn an_action_that_asks_for_the_previous_episode_is_flat_and_judged_before_anything_is_asked() {
        let envelope =
            format!(r#"{{"version":{ACTION_VERSION},"action":{{"type":"previous_episode"}}}}"#);

        assert_eq!(Action::parse(&envelope), Ok(Action::PreviousEpisode));
        assert_eq!(
            Action::PreviousEpisode.validate(),
            Ok(ValidatedAction::PreviousEpisode)
        );
        assert_eq!(
            serde_json::to_value(Action::PreviousEpisode).expect("an Action serializes"),
            serde_json::json!({ "type": "previous_episode" })
        );
    }

    #[test]
    fn a_refusal_to_skip_to_the_previous_episode_names_its_own_kind() {
        let refused = ActionError::NoPreviousEpisode {
            detail: "no Addon offers an episode before series/tt0903747:0:1".to_owned(),
        };

        assert_eq!(
            serde_json::to_value(&refused).expect("a refusal serializes"),
            serde_json::json!({
                "kind": "no_previous_episode",
                "detail": "no Addon offers an episode before series/tt0903747:0:1",
            }),
            "the twin of `no_next_episode`, so a client tells the two apart by kind"
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

    /// One hand-written envelope per Action, so that "every Action" is a list a
    /// person can read. Completeness is the macro's job (the generated match is
    /// exhaustive); what this list proves is that every spelling [`Action::SPELLINGS`]
    /// names is the `type` tag serde actually writes, and that no variant is
    /// missing a representative here.
    const EVERY_ACTION: &[&str] = &[
        r#"{"type":"set_subtitle_language","language":"en"}"#,
        r#"{"type":"clear_subtitle_language"}"#,
        r#"{"type":"set_featured_catalog","addon":"community.example","catalog":{"type":"movie","id":"top"}}"#,
        r#"{"type":"clear_featured_catalog"}"#,
        r#"{"type":"add_addon","url":"https://example.com/manifest.json"}"#,
        r#"{"type":"reorder_addon","id":"community.example","position":1}"#,
        r#"{"type":"remove_addon","id":"community.example"}"#,
        r#"{"type":"set_tmdb_key","key":"0123456789abcdef"}"#,
        r#"{"type":"clear_tmdb_key"}"#,
        r#"{"type":"sign_in_stremio","email":"a@example.com","password":"a password"}"#,
        r#"{"type":"sign_out_stremio"}"#,
        r#"{"type":"pair_device","code":"ABCDEF","name":"Phone"}"#,
        r#"{"type":"revoke_device","id":"4K7Q2M"}"#,
        r#"{"type":"browse_catalog","addon":"community.example","catalog":{"type":"movie","id":"top"},"extra":[]}"#,
        r#"{"type":"search_catalogs","query":"matrix"}"#,
        r#"{"type":"discover","kind":"movie","page":1}"#,
        r#"{"type":"open_title","addon":"community.example","title":{"type":"movie","id":"tt0133093"}}"#,
        r#"{"type":"open_discovered_title","key":{"kind":"tmdb","id":603},"kind":"movie"}"#,
        r#"{"type":"find_streams","video":{"type":"movie","id":"tt0133093"}}"#,
        r#"{"type":"play_stream","video":{"type":"movie","id":"tt0133093"},"addon":"community.example","title":{"addon":"community.example","id":"tt0133093","type":"movie","name":"The Matrix","poster":null},"stream":{"name":null,"description":null,"playback":{"kind":"direct","url":"https://stream.example.org/x.mkv"},"warnings":[],"filename":null,"bingeGroup":null}}"#,
        r#"{"type":"resume","video":{"type":"movie","id":"tt0133093"}}"#,
        r#"{"type":"set_paused","paused":true}"#,
        r#"{"type":"seek","target":{"kind":"to","seconds":1.0}}"#,
        r#"{"type":"set_audio_track","track":1}"#,
        r#"{"type":"set_subtitle_track","track":2}"#,
        r#"{"type":"set_subtitle_delay","seconds":0.1}"#,
        r#"{"type":"set_speed","rate":1.5}"#,
        r#"{"type":"set_volume","level":100.0}"#,
        r#"{"type":"set_muted","muted":true}"#,
        r#"{"type":"next_chapter"}"#,
        r#"{"type":"previous_chapter"}"#,
        r#"{"type":"set_chapter","index":0}"#,
        r#"{"type":"set_crop","crop":{"kind":"off"}}"#,
        r#"{"type":"set_aspect","aspect":{"kind":"source"}}"#,
        r#"{"type":"next_episode"}"#,
        r#"{"type":"previous_episode"}"#,
        r#"{"type":"stop_playback"}"#,
    ];

    #[test]
    fn the_spelling_list_is_the_whole_surface() {
        let mut from_variants: Vec<&str> = EVERY_ACTION
            .iter()
            .map(|body| {
                let envelope = format!(r#"{{"version":{ACTION_VERSION},"action":{body}}}"#);
                Action::parse(&envelope)
                    .unwrap_or_else(|error| panic!("{envelope} should parse: {error}"))
                    .spelling()
            })
            .collect();
        from_variants.sort_unstable();

        let mut declared = Action::SPELLINGS.to_vec();
        declared.sort_unstable();

        assert_eq!(
            from_variants, declared,
            "the list spells every Action once and names nothing the surface does not have"
        );
        assert_eq!(
            EVERY_ACTION.len(),
            Action::SPELLINGS.len(),
            "the two lists are the same length, so neither can quietly shrink"
        );
    }
}
