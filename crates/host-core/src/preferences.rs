use serde::{Deserialize, Serialize};

/// The Host's global preferences: the choices that are not made per Video.
///
/// Only preferences a client is allowed to see live here — and everything in
/// here is published in every [`crate::Snapshot`], so nothing secret may be added
/// to it (ADR-0002, and the spec's "Credentials and secrets").
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Preferences {
    subtitle_language: Option<SubtitleLanguage>,
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

    /// The same preferences, with a subtitle language, for a store that has just
    /// read one back.
    pub fn with_subtitle_language(language: Option<SubtitleLanguage>) -> Self {
        Self {
            subtitle_language: language,
        }
    }
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
}
