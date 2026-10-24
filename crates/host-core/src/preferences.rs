use serde::{Deserialize, Serialize};

use crate::addon::AddonId;
use crate::request::CatalogRef;

/// The Host's global preferences: the choices that are not made per Video.
///
/// Only preferences a client is allowed to see live here — and everything in
/// here is published in every [`crate::Snapshot`], so nothing secret may be added
/// to it (ADR-0002, and the spec's "Credentials and secrets").
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Preferences {
    subtitle_language: Option<SubtitleLanguage>,
    subtitle_color: SubtitleColor,
    subtitle_scale: SubtitleScale,
    stream_buffer: StreamBuffer,
    featured_catalog: Option<FeaturedCatalog>,
}

impl Preferences {
    /// The preferences the Host starts from, before anyone has chosen anything.
    pub fn new() -> Self {
        Self::default()
    }

    /// The language the Host prefers when it picks a subtitle track, if the owner
    /// has expressed one.
    pub fn subtitle_language(&self) -> Option<&SubtitleLanguage> {
        self.subtitle_language.as_ref()
    }

    /// Set or clear the subtitle language preference.
    pub fn set_subtitle_language(&mut self, language: Option<SubtitleLanguage>) {
        self.subtitle_language = language;
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
    pub fn from_stored(
        subtitle_language: Option<SubtitleLanguage>,
        subtitle_color: SubtitleColor,
        subtitle_scale: SubtitleScale,
        stream_buffer: StreamBuffer,
        featured_catalog: Option<FeaturedCatalog>,
    ) -> Self {
        Self {
            subtitle_language,
            subtitle_color,
            subtitle_scale,
            stream_buffer,
            featured_catalog,
        }
    }

    /// The same preferences, with a subtitle language, for a store that has just
    /// read one back.
    pub fn with_subtitle_language(language: Option<SubtitleLanguage>) -> Self {
        Self::from_stored(
            language,
            SubtitleColor::default(),
            SubtitleScale::default(),
            StreamBuffer::default(),
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

/// The language the Host prefers when it chooses a subtitle track.
///
/// Held as a BCP-47 language tag but judged only on the shape a tag takes — a
/// primary subtag and optional hyphenated subtags — rather than against a
/// registry: this is a preference, and it is matched against whatever tracks a
/// Video turns out to have, not validated against IANA.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SubtitleLanguage(String);

impl SubtitleLanguage {
    /// The longest tag BCP-47 allows.
    const MAX_LEN: usize = 35;

    /// The longest subtag BCP-47 allows.
    const MAX_SUBTAG_LEN: usize = 8;

    /// Parse a language tag, or say why this string is not one.
    pub fn parse(raw: &str) -> Result<Self, InvalidSubtitleLanguage> {
        let invalid = || InvalidSubtitleLanguage {
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

impl std::fmt::Display for SubtitleLanguage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// A string that is not a language tag, offered as a subtitle language.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, thiserror::Error)]
#[error("{language:?} is not a language tag")]
pub struct InvalidSubtitleLanguage {
    pub language: String,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn language_tags_bcp_47_allows_are_accepted() {
        for tag in ["en", "pt-BR", "zh-Hans-CN", "es-419", "sr-Latn-RS"] {
            assert_eq!(
                SubtitleLanguage::parse(tag).map(|l| l.as_str().to_owned()),
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
                SubtitleLanguage::parse(not_a_tag).is_err(),
                "{not_a_tag:?} is not a language tag"
            );
        }
    }

    #[test]
    fn the_longest_tag_bcp_47_allows_is_accepted() {
        let tag = "aaaaaaaa-bbbbbbbb-cccccccc-dddddddd";
        assert_eq!(tag.len(), SubtitleLanguage::MAX_LEN);
        assert!(SubtitleLanguage::parse(tag).is_ok());
        assert!(SubtitleLanguage::parse(&format!("{tag}e")).is_err());
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
}
