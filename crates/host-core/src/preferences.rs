use serde::{Deserialize, Serialize};

use crate::addon::AddonId;
use crate::request::CatalogRef;

/// The Host's global preferences: the choices that are not made per Video.
///
/// Only preferences a client is allowed to see live here — and everything in
/// here is published in every [`crate::Snapshot`], so nothing secret may be added
/// to it (ADR-0002, and the spec's "Credentials and secrets").
#[derive(Debug, Clone, PartialEq)]
pub struct Preferences {
    subtitle_languages: LanguageList,
    audio_languages: LanguageList,
    subtitle_color: SubtitleColor,
    subtitle_scale: SubtitleScale,
    stream_buffer: StreamBuffer,
    torrent_cache: TorrentCache,
    up_next_playback: UpNextPlayback,
    autoplay: bool,
    featured_catalog: Option<FeaturedCatalog>,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            subtitle_languages: LanguageList::empty(),
            audio_languages: LanguageList::empty(),
            subtitle_color: SubtitleColor::default(),
            subtitle_scale: SubtitleScale::default(),
            stream_buffer: StreamBuffer::default(),
            torrent_cache: TorrentCache::default(),
            up_next_playback: UpNextPlayback::default(),
            autoplay: true,
            featured_catalog: None,
        }
    }
}

impl Preferences {
    /// The preferences the Host starts from, before anyone has chosen anything.
    pub fn new() -> Self {
        Self::default()
    }

    /// The Subtitle languages: the languages the Host chooses a subtitle Track
    /// by, first the most wanted. Empty, it follows the file.
    pub fn subtitle_languages(&self) -> &LanguageList {
        &self.subtitle_languages
    }

    /// Set the Subtitle languages, whole.
    pub fn set_subtitle_languages(&mut self, languages: LanguageList) {
        self.subtitle_languages = languages;
    }

    /// The Audio languages: the same, for the soundtrack. Independent of the
    /// Subtitle languages.
    pub fn audio_languages(&self) -> &LanguageList {
        &self.audio_languages
    }

    /// Set the Audio languages, whole.
    pub fn set_audio_languages(&mut self, languages: LanguageList) {
        self.audio_languages = languages;
    }

    /// The colour the Player draws subtitles in, where a track leaves the colour
    /// open. White unless the owner chose another.
    pub fn subtitle_color(&self) -> &SubtitleColor {
        &self.subtitle_color
    }

    /// Set the subtitle colour preference.
    pub fn set_subtitle_color(&mut self, color: SubtitleColor) {
        self.subtitle_color = color;
    }

    /// How large the Player draws subtitles, relative to its own size. `1.0`
    /// unless the owner chose another.
    pub fn subtitle_scale(&self) -> SubtitleScale {
        self.subtitle_scale
    }

    /// Set the subtitle size preference.
    pub fn set_subtitle_scale(&mut self, scale: SubtitleScale) {
        self.subtitle_scale = scale;
    }

    /// How much of a Stream the Player keeps read ahead of where it is playing:
    /// the look-ahead it aims for and the memory that look-ahead may take.
    pub fn stream_buffer(&self) -> StreamBuffer {
        self.stream_buffer
    }

    /// Set the Stream buffer preference.
    pub fn set_stream_buffer(&mut self, buffer: StreamBuffer) {
        self.stream_buffer = buffer;
    }

    /// The most disk a playing torrent may take (ADR-0042 §3).
    pub fn torrent_cache(&self) -> TorrentCache {
        self.torrent_cache
    }

    /// Set the Torrent cache preference.
    pub fn set_torrent_cache(&mut self, cache: TorrentCache) {
        self.torrent_cache = cache;
    }

    /// What Play does for a Title's Up next: play it straight away, or open the
    /// Streams picker so the owner picks the Stream themselves.
    pub fn up_next_playback(&self) -> UpNextPlayback {
        self.up_next_playback
    }

    /// Set the Up next preference.
    pub fn set_up_next_playback(&mut self, playback: UpNextPlayback) {
        self.up_next_playback = playback;
    }

    /// Whether the Host advances on its own to a Title's Up next after a short
    /// countdown when an episode's Stream ends, or waits until someone asks.
    pub fn autoplay(&self) -> bool {
        self.autoplay
    }

    /// Set the Autoplay preference.
    pub fn set_autoplay(&mut self, autoplay: bool) {
        self.autoplay = autoplay;
    }

    /// The one Catalog the owner has marked as the Host's featured feed, where
    /// one is marked: what a client's Home hero is drawn from.
    pub fn featured_catalog(&self) -> Option<&FeaturedCatalog> {
        self.featured_catalog.as_ref()
    }

    /// Mark a Catalog as the featured one, or take the marking away.
    pub fn set_featured_catalog(&mut self, featured: Option<FeaturedCatalog>) {
        self.featured_catalog = featured;
    }

    /// The preferences a store read back, in one step: every value it holds,
    /// with an absent row already resolved to its default.
    #[allow(clippy::too_many_arguments)]
    pub fn from_stored(
        subtitle_languages: LanguageList,
        audio_languages: LanguageList,
        subtitle_color: SubtitleColor,
        subtitle_scale: SubtitleScale,
        stream_buffer: StreamBuffer,
        torrent_cache: TorrentCache,
        up_next_playback: UpNextPlayback,
        autoplay: bool,
        featured_catalog: Option<FeaturedCatalog>,
    ) -> Self {
        Self {
            subtitle_languages,
            audio_languages,
            subtitle_color,
            subtitle_scale,
            stream_buffer,
            torrent_cache,
            up_next_playback,
            autoplay,
            featured_catalog,
        }
    }

    /// The same preferences, with Subtitle languages, for a store that has just
    /// read them back.
    pub fn with_subtitle_languages(languages: LanguageList) -> Self {
        Self::from_stored(
            languages,
            LanguageList::empty(),
            SubtitleColor::default(),
            SubtitleScale::default(),
            StreamBuffer::default(),
            TorrentCache::default(),
            UpNextPlayback::default(),
            true,
            None,
        )
    }
}

/// The Featured catalog: the one Catalog the owner has marked as the Host's
/// featured feed — what a client's Home hero is drawn from, its first items in
/// the Addon's own order (CONTEXT.md, #74).
///
/// A preference of the Host's rather than a client's, so every client draws the
/// same hero. The Addon goes beside the Catalog because neither names the other
/// — a catalog id is only unique within the Addon that declared it — and the
/// pair is what the Host asks with ([`crate::Action::BrowseCatalog`]).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FeaturedCatalog {
    /// The Addon that offers it, by the id its manifest answers to.
    pub addon: AddonId,
    /// The Catalog itself, by the type and id its manifest declared.
    pub catalog: CatalogRef,
}

/// A language the Host chooses a Track by: the vocabulary of both language
/// preferences (Subtitle languages and Audio languages, ADR-0041).
///
/// Held as a BCP-47 language tag but judged only on the shape a tag takes — a
/// primary subtag and optional hyphenated subtags — rather than against a
/// registry: this is a preference, and it is matched against whatever tracks a
/// Video turns out to have, not validated against IANA.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Language(String);

impl Language {
    /// The longest tag BCP-47 allows.
    const MAX_LEN: usize = 35;

    /// The longest subtag BCP-47 allows.
    const MAX_SUBTAG_LEN: usize = 8;

    /// Parse a language tag, or say why this string is not one.
    pub fn parse(raw: &str) -> Result<Self, InvalidLanguage> {
        let invalid = || InvalidLanguage {
            language: raw.to_owned(),
        };

        if raw.is_empty() || raw.len() > Self::MAX_LEN {
            return Err(invalid());
        }

        let mut subtags = raw.split('-');
        let primary = subtags.next().expect("a non-empty string has a head");
        if primary.len() < 2 || primary.len() > Self::MAX_SUBTAG_LEN {
            return Err(invalid());
        }
        if !primary.chars().all(|c| c.is_ascii_alphabetic()) {
            return Err(invalid());
        }

        let rest_is_sound = subtags.all(|subtag| {
            !subtag.is_empty()
                && subtag.len() <= Self::MAX_SUBTAG_LEN
                && subtag.chars().all(|c| c.is_ascii_alphanumeric())
        });
        if !rest_is_sound {
            return Err(invalid());
        }

        Ok(Self(raw.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for Language {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// A string that is not a language tag, offered as a language.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, thiserror::Error)]
#[error("{language:?} is not a language tag")]
pub struct InvalidLanguage {
    pub language: String,
}

/// An ordered list of up to three [`Language`]s, first the most wanted: the shape
/// of both Subtitle languages and Audio languages (ADR-0041). Empty, it means
/// *follow the file*.
///
/// The list is the whole preference, so a client sends it whole and a refusal is
/// about the list: a fourth entry, a duplicate (compared case-insensitively, for
/// a tag is not case-sensitive) or a bad tag.
#[derive(Debug, Clone, Default, PartialEq, Eq, Hash, Serialize)]
#[serde(transparent)]
pub struct LanguageList(Vec<Language>);

impl LanguageList {
    /// The most languages a list may hold.
    pub const MAX: usize = 3;

    /// An empty list: follow the file.
    pub fn empty() -> Self {
        Self::default()
    }

    /// Parse a list of tags, or say why this is not a list.
    pub fn parse<S: AsRef<str>>(raw: &[S]) -> Result<Self, InvalidLanguageList> {
        let mut languages: Vec<Language> = Vec::with_capacity(raw.len());
        for tag in raw {
            let language = Language::parse(tag.as_ref())?;
            if languages
                .iter()
                .any(|held| held.as_str().eq_ignore_ascii_case(language.as_str()))
            {
                return Err(InvalidLanguageList::Duplicate(DuplicateLanguage {
                    language: language.to_string(),
                }));
            }
            languages.push(language);
        }
        if languages.len() > Self::MAX {
            return Err(InvalidLanguageList::TooMany(TooManyLanguages {
                count: languages.len(),
                max: Self::MAX,
            }));
        }

        Ok(Self(languages))
    }

    /// The languages, in order.
    pub fn as_slice(&self) -> &[Language] {
        &self.0
    }

    /// The languages, in order, as the Snapshot and the wire carry them.
    pub fn to_vec(&self) -> Vec<Language> {
        self.0.clone()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn iter(&self) -> std::slice::Iter<'_, Language> {
        self.0.iter()
    }
}

/// A list that is not a language list, and which way it fails.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InvalidLanguageList {
    /// An entry is not a tag.
    Invalid(InvalidLanguage),
    /// A language is listed twice.
    Duplicate(DuplicateLanguage),
    /// More than three languages.
    TooMany(TooManyLanguages),
}

impl From<InvalidLanguage> for InvalidLanguageList {
    fn from(invalid: InvalidLanguage) -> Self {
        Self::Invalid(invalid)
    }
}

/// A language listed twice, compared without regard to case.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, thiserror::Error)]
#[error("{language:?} is listed twice")]
pub struct DuplicateLanguage {
    pub language: String,
}

/// A list of more languages than a list may hold.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, thiserror::Error)]
#[error("{count} languages is too many — a list holds at most {max}")]
pub struct TooManyLanguages {
    pub count: usize,
    pub max: usize,
}

/// The colour the Player draws subtitles in, where a track leaves the colour open.
///
/// Held as `#RRGGBB`, normalized to uppercase when parsed so that the same
/// choice has one spelling in the store, in a Snapshot and on the wire. mpv's own
/// colour parser takes exactly this form; a named colour would be mpv's
/// vocabulary inside the Host's state.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SubtitleColor(String);

impl SubtitleColor {
    /// White, which is what a Player draws subtitles in until it is told
    /// otherwise. The preference has no "unset": white is an answer.
    pub const DEFAULT: &'static str = "#FFFFFF";

    /// Parse `#RRGGBB`, or say why this string is not a colour.
    pub fn parse(raw: &str) -> Result<Self, InvalidSubtitleColor> {
        let invalid = || InvalidSubtitleColor {
            color: raw.to_owned(),
        };
        let Some(digits) = raw.strip_prefix('#') else {
            return Err(invalid());
        };
        if digits.len() != 6 || !digits.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(invalid());
        }

        Ok(Self(format!("#{}", digits.to_ascii_uppercase())))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Default for SubtitleColor {
    fn default() -> Self {
        Self(Self::DEFAULT.to_owned())
    }
}

impl std::fmt::Display for SubtitleColor {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// A string that is not a colour, offered as a subtitle colour.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, thiserror::Error)]
#[error("{color:?} is not a subtitle colour — a colour is #RRGGBB")]
pub struct InvalidSubtitleColor {
    pub color: String,
}

/// How large the Player draws subtitles, relative to its own size.
///
/// A finite multiplier from a half to twice, held as the number mpv's
/// `sub-scale` takes. One value applies to both subtitles a file styles itself
/// and subtitles it does not; unlike colour, a track's own styling does not
/// override it (ADR-0024).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SubtitleScale(f64);

impl SubtitleScale {
    /// The size a Player draws subtitles at until it is told otherwise, and the
    /// preference's default.
    pub const DEFAULT: f64 = 1.0;

    /// The smallest scale the Host will set.
    pub const MIN: f64 = 0.5;

    /// The largest scale the Host will set.
    pub const MAX: f64 = 2.0;

    /// Parse a scale, or say why this number is not one.
    pub fn parse(raw: f64) -> Result<Self, InvalidSubtitleScale> {
        if raw.is_finite() && (Self::MIN..=Self::MAX).contains(&raw) {
            Ok(Self(raw))
        } else {
            Err(InvalidSubtitleScale {
                scale: raw.to_string(),
            })
        }
    }

    /// The number as mpv's `sub-scale` takes it.
    pub fn value(&self) -> f64 {
        self.0
    }
}

impl Default for SubtitleScale {
    fn default() -> Self {
        Self(Self::DEFAULT)
    }
}

impl std::fmt::Display for SubtitleScale {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(f)
    }
}

/// A number that is not a subtitle size, offered as one.
#[derive(Debug, Clone, PartialEq, Serialize, thiserror::Error)]
#[error("{scale} is not a subtitle size — a size is a number from 0.5 to 2")]
pub struct InvalidSubtitleScale {
    /// The value offered, as a refusal can carry it: `NaN` has no JSON form.
    pub scale: String,
}

/// How much of a Stream the Player keeps read ahead of where it is playing.
///
/// Two limits, because either alone lies: five minutes at a low bitrate is a
/// handful of megabytes, and five minutes at a 4K remux's bitrate is tens of
/// gigabytes. The Player aims for `seconds` and stops where `megabytes` is
/// reached, so a dip in the network is ridden out only as far as both allow. It
/// is the Host's preference and not a Stream's, and its two values are stored as
/// one document so they cannot drift (ADR-0026).
///
/// The unit of `megabytes` is the decimal megabyte, which is what the interface
/// says; the Player converts it to the byte counts its own cache takes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StreamBuffer {
    seconds: u64,
    megabytes: u64,
}

impl StreamBuffer {
    /// The look-ahead the Host starts from, in seconds.
    pub const DEFAULT_SECONDS: u64 = 300;

    /// The memory ceiling the Host starts from, in megabytes.
    pub const DEFAULT_MEGABYTES: u64 = 512;

    /// The shortest look-ahead the Host will set.
    pub const MIN_SECONDS: u64 = 5;

    /// The longest look-ahead the Host will set.
    pub const MAX_SECONDS: u64 = 3600;

    /// The smallest memory ceiling the Host will set.
    pub const MIN_MEGABYTES: u64 = 64;

    /// The largest memory ceiling the Host will set.
    pub const MAX_MEGABYTES: u64 = 4096;

    /// Parse a pair of limits, or say why this pair is not one.
    pub fn parse(seconds: u64, megabytes: u64) -> Result<Self, InvalidStreamBuffer> {
        if !(Self::MIN_SECONDS..=Self::MAX_SECONDS).contains(&seconds) {
            return Err(InvalidStreamBuffer {
                detail: format!(
                    "{seconds} is not a buffer time — a time is a whole number of seconds \
                     from {} to {}",
                    Self::MIN_SECONDS,
                    Self::MAX_SECONDS
                ),
            });
        }
        if !(Self::MIN_MEGABYTES..=Self::MAX_MEGABYTES).contains(&megabytes) {
            return Err(InvalidStreamBuffer {
                detail: format!(
                    "{megabytes} is not a buffer size — a size is a whole number of megabytes \
                     from {} to {}",
                    Self::MIN_MEGABYTES,
                    Self::MAX_MEGABYTES
                ),
            });
        }

        Ok(Self { seconds, megabytes })
    }

    /// How many seconds of a Stream the Player aims to keep read ahead.
    pub fn seconds(&self) -> u64 {
        self.seconds
    }

    /// The ceiling on the memory that read-ahead may take, in megabytes.
    pub fn megabytes(&self) -> u64 {
        self.megabytes
    }
}

impl Default for StreamBuffer {
    fn default() -> Self {
        Self {
            seconds: Self::DEFAULT_SECONDS,
            megabytes: Self::DEFAULT_MEGABYTES,
        }
    }
}

/// A pair of limits that is not a Stream buffer, offered as one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, thiserror::Error)]
#[error("{detail}")]
pub struct InvalidStreamBuffer {
    pub detail: String,
}

/// The Torrent cache: the most disk a held torrent may take while it plays
/// (CONTEXT.md, ADR-0042 §3).
///
/// Its own preference, with its own bounds and no coupling to the
/// [`StreamBuffer`]: the buffer is memory and this is disk, and an owner with a
/// small disk must be able to cap one without the other moving. The unit is the
/// decimal megabyte, as the Stream buffer's is (ADR-0026).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TorrentCache {
    megabytes: u64,
}

impl TorrentCache {
    /// The ceiling the Host starts from, in megabytes: 2 GB.
    pub const DEFAULT_MEGABYTES: u64 = 2000;

    /// The smallest ceiling the Host will set.
    pub const MIN_MEGABYTES: u64 = 256;

    /// The largest ceiling the Host will set.
    pub const MAX_MEGABYTES: u64 = 32000;

    /// Parse a ceiling, or say why this number is not one.
    pub fn parse(megabytes: u64) -> Result<Self, InvalidTorrentCache> {
        if !(Self::MIN_MEGABYTES..=Self::MAX_MEGABYTES).contains(&megabytes) {
            return Err(InvalidTorrentCache {
                detail: format!(
                    "{megabytes} is not a torrent cache size — a size is a whole number of \
                     megabytes from {} to {}",
                    Self::MIN_MEGABYTES,
                    Self::MAX_MEGABYTES
                ),
            });
        }
        Ok(Self { megabytes })
    }

    /// The ceiling, in megabytes.
    pub fn megabytes(&self) -> u64 {
        self.megabytes
    }

    /// The ceiling, in bytes: the decimal megabyte the interface says.
    pub fn bytes(&self) -> u64 {
        self.megabytes * 1_000_000
    }
}

impl Default for TorrentCache {
    fn default() -> Self {
        Self {
            megabytes: Self::DEFAULT_MEGABYTES,
        }
    }
}

/// A size that is not a Torrent cache, offered as one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, thiserror::Error)]
#[error("{detail}")]
pub struct InvalidTorrentCache {
    pub detail: String,
}

/// What Play does for a Title's Up next.
///
/// A preference of the Host's, not a client's: the choice is stored beside the
/// subtitle appearance and the Stream buffer and published in every Snapshot, so
/// the desktop and the remote Play the same way (ADR-0026's shape). It governs
/// only Up next — Resume always plays directly, because resuming is one press.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UpNextPlayback {
    /// Play the Up next straight away, from the release of the Video before it.
    #[default]
    Direct,
    /// Open the Streams picker for the Up next so the owner picks the Stream.
    Picker,
}

impl UpNextPlayback {
    /// The preference's wire spelling, as the preferences table holds it.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Direct => "direct",
            Self::Picker => "picker",
        }
    }
}

impl std::str::FromStr for UpNextPlayback {
    type Err = InvalidUpNextPlayback;

    fn from_str(raw: &str) -> Result<Self, Self::Err> {
        match raw {
            "direct" => Ok(Self::Direct),
            "picker" => Ok(Self::Picker),
            _ => Err(InvalidUpNextPlayback {
                value: raw.to_owned(),
            }),
        }
    }
}

/// A stored word that is not an Up next playback choice.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, thiserror::Error)]
#[error("{value:?} is not an Up next playback choice")]
pub struct InvalidUpNextPlayback {
    pub value: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn language_tags_bcp_47_allows_are_accepted() {
        for tag in ["en", "pt-BR", "zh-Hans-CN", "es-419", "sr-Latn-RS"] {
            assert_eq!(
                Language::parse(tag).map(|l| l.as_str().to_owned()),
                Ok(tag.to_owned()),
                "{tag} is a language tag"
            );
        }
    }

    #[test]
    fn strings_that_are_not_language_tags_are_refused() {
        for not_a_tag in [
            "",           // nothing at all
            "p",          // a primary subtag is at least two letters
            "portuguese", // too long for a primary subtag
            "pt_br",      // the separators are hyphens
            "pt-",        // and they separate something
            "-pt",        // on both sides
            "pt--BR",     // a subtag is never empty
            "pt BR",      // nor does it contain spaces
            "pt-BR-🇧🇷",   // nor anything outside ASCII alphanumerics
            "123",        // a primary subtag is alphabetic
            "abcdefghij", // and at most eight letters
        ] {
            assert!(
                Language::parse(not_a_tag).is_err(),
                "{not_a_tag:?} is not a language tag"
            );
        }
    }

    fn tags(list: &LanguageList) -> Vec<&str> {
        list.iter().map(Language::as_str).collect()
    }

    #[test]
    fn a_language_list_holds_nought_to_three_languages_in_order() {
        for raw in [
            &[][..],
            &["pt-BR"][..],
            &["pt-BR", "en"][..],
            &["pt-BR", "en", "fr-CA"][..],
        ] {
            let list = LanguageList::parse(raw).expect("up to three languages is a list");
            assert_eq!(tags(&list), raw, "the order is the owner's");
        }
        assert!(LanguageList::parse::<&str>(&[]).expect("empty").is_empty());
        assert_eq!(LanguageList::default(), LanguageList::empty());
    }

    #[test]
    fn a_fourth_language_is_refused() {
        assert_eq!(
            LanguageList::parse(&["en", "pt-BR", "fr", "de"]),
            Err(InvalidLanguageList::TooMany(TooManyLanguages {
                count: 4,
                max: 3
            }))
        );
    }

    #[test]
    fn a_language_listed_twice_is_refused_whatever_its_case() {
        assert_eq!(
            LanguageList::parse(&["pt-BR", "en", "PT-br"]),
            Err(InvalidLanguageList::Duplicate(DuplicateLanguage {
                language: "PT-br".to_owned()
            }))
        );
        assert!(LanguageList::parse(&["en", "en"]).is_err());
    }

    #[test]
    fn a_bad_tag_in_a_list_is_refused_as_an_invalid_language() {
        assert_eq!(
            LanguageList::parse(&["en", "Brazilian Portuguese"]),
            Err(InvalidLanguageList::Invalid(InvalidLanguage {
                language: "Brazilian Portuguese".to_owned()
            }))
        );
    }

    #[test]
    fn a_language_list_serializes_as_a_plain_array_of_tags() {
        let list = LanguageList::parse(&["pt-BR", "en"]).expect("a list");
        assert_eq!(
            serde_json::to_value(&list).expect("a list serializes"),
            serde_json::json!(["pt-BR", "en"])
        );
    }

    #[test]
    fn the_longest_tag_bcp_47_allows_is_accepted() {
        let tag = "aaaaaaaa-bbbbbbbb-cccccccc-dddddddd";
        assert_eq!(tag.len(), Language::MAX_LEN);
        assert!(Language::parse(tag).is_ok());
        assert!(Language::parse(&format!("{tag}e")).is_err());
    }

    #[test]
    fn a_colour_is_an_uppercase_hash_and_six_digits() {
        for (raw, normalized) in [
            ("#FFFFFF", "#FFFFFF"),
            ("#ffcc00", "#FFCC00"),
            ("#00ff00", "#00FF00"),
            ("#A1b2C3", "#A1B2C3"),
        ] {
            assert_eq!(
                SubtitleColor::parse(raw).map(|color| color.as_str().to_owned()),
                Ok(normalized.to_owned()),
                "{raw} is a colour, normalized to {normalized}"
            );
        }
    }

    #[test]
    fn strings_that_are_not_colours_are_refused() {
        for not_a_color in [
            "",         // nothing at all
            "FFFFFF",   // the hash is part of the colour
            "#FFF",     // three digits are CSS's shorthand, not mpv's
            "#FFFFFFF", // seven digits
            "#FFFFF",   // five digits
            "#GGGGGG",  // not hexadecimal
            "#FF FF00", // no spaces
            "red",      // a name is mpv's vocabulary, not the Host's
        ] {
            assert!(
                SubtitleColor::parse(not_a_color).is_err(),
                "{not_a_color:?} is not a subtitle colour"
            );
        }
    }

    #[test]
    fn the_default_colour_is_white() {
        assert_eq!(SubtitleColor::default().as_str(), "#FFFFFF");
    }

    #[test]
    fn a_scale_is_finite_and_between_a_half_and_twice() {
        for (raw, value) in [(0.5, 0.5), (1.0, 1.0), (1.25, 1.25), (2.0, 2.0)] {
            assert_eq!(
                SubtitleScale::parse(raw).map(|scale| scale.value()),
                Ok(value),
                "{raw} is a subtitle size"
            );
        }
    }

    #[test]
    fn scales_outside_the_range_and_non_numbers_are_refused() {
        for not_a_scale in [
            0.0,
            0.49,
            2.01,
            -1.0,
            f64::NAN,
            f64::INFINITY,
            f64::NEG_INFINITY,
        ] {
            assert!(
                SubtitleScale::parse(not_a_scale).is_err(),
                "{not_a_scale} is not a subtitle size"
            );
        }
    }

    #[test]
    fn the_default_scale_is_one() {
        assert_eq!(SubtitleScale::default().value(), 1.0);
    }

    #[test]
    fn a_stream_buffer_is_a_look_ahead_and_a_memory_ceiling() {
        for (seconds, megabytes) in [(5, 64), (300, 512), (3600, 4096)] {
            assert_eq!(
                StreamBuffer::parse(seconds, megabytes)
                    .map(|buffer| (buffer.seconds(), buffer.megabytes())),
                Ok((seconds, megabytes)),
                "{seconds} s and {megabytes} MB is a buffer"
            );
        }
    }

    #[test]
    fn buffer_values_outside_the_range_are_refused() {
        for (seconds, megabytes) in [
            (0, 512),    // no time at all
            (4, 512),    // shorter than the shortest
            (3601, 512), // longer than the longest
            (300, 0),    // no memory at all
            (300, 63),   // smaller than the smallest
            (300, 4097), // larger than the largest
        ] {
            assert!(
                StreamBuffer::parse(seconds, megabytes).is_err(),
                "{seconds} s and {megabytes} MB is not a buffer"
            );
        }
    }

    #[test]
    fn the_default_buffer_is_five_minutes_up_to_half_a_gigabyte() {
        let buffer = StreamBuffer::default();

        assert_eq!(buffer.seconds(), 300);
        assert_eq!(buffer.megabytes(), 512);
        assert_eq!(
            serde_json::to_value(buffer).expect("a buffer serializes"),
            serde_json::json!({"seconds": 300, "megabytes": 512}),
            "the wire carries the pair as two camelCase numbers"
        );
    }

    #[test]
    fn a_torrent_cache_is_a_whole_number_of_megabytes_from_256_to_32000() {
        for megabytes in [256, 2000, 32000] {
            assert_eq!(
                TorrentCache::parse(megabytes).map(|cache| cache.megabytes()),
                Ok(megabytes)
            );
        }
        for megabytes in [0, 255, 32001, u64::MAX] {
            assert!(
                TorrentCache::parse(megabytes).is_err(),
                "{megabytes} MB is not a torrent cache"
            );
        }
    }

    #[test]
    fn the_default_torrent_cache_is_two_decimal_gigabytes() {
        let cache = TorrentCache::default();

        assert_eq!(cache.megabytes(), 2000);
        assert_eq!(cache.bytes(), 2_000_000_000);
        assert_eq!(
            serde_json::to_value(cache).expect("a cache serializes"),
            serde_json::json!({"megabytes": 2000})
        );
        assert_eq!(Preferences::default().torrent_cache(), cache);
    }

    #[test]
    fn the_torrent_cache_is_not_judged_against_the_stream_buffer() {
        // The largest cache beside the smallest buffer, and the reverse: both
        // are preferences on their own.
        let mut preferences = Preferences::default();
        preferences.set_stream_buffer(StreamBuffer::parse(5, 64).expect("a buffer"));
        preferences.set_torrent_cache(TorrentCache::parse(32000).expect("a cache"));
        assert_eq!(preferences.torrent_cache().megabytes(), 32000);
        assert_eq!(preferences.stream_buffer().megabytes(), 64);

        preferences.set_stream_buffer(StreamBuffer::parse(3600, 4096).expect("a buffer"));
        preferences.set_torrent_cache(TorrentCache::parse(256).expect("a cache"));
        assert_eq!(preferences.torrent_cache().megabytes(), 256);
        assert_eq!(preferences.stream_buffer().megabytes(), 4096);
    }

    #[test]
    fn the_default_autoplay_is_on() {
        assert!(Preferences::default().autoplay());
        assert!(Preferences::new().autoplay());
    }
}
