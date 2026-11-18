//! Matching a language: the Host's code table (ADR-0041).
//!
//! Files and Addons do not spell a language the way a client's list does: a
//! Brazilian Portuguese Track arrives as `pob`, `pt-BR` or `por`, French as
//! `fre`, `fra` or `fr`, Simplified Chinese as `chs`. The table below is the
//! Host's own knowledge of those spellings, for the 32 languages a client can
//! offer (`src/languages.json`). It is data, and pure: what the Host means by a
//! code is tested row by row, with no player (ADR-0013).
//!
//! A tag outside the curated list is still a language (ADR-0041), and matches
//! only literally, ignoring case.

use crate::preferences::{Language, LanguageList};

/// The 32 curated tags, in the order a client offers them.
pub const CURATED: [&str; 32] = [
    "en", "en-GB", "pt-BR", "pt-PT", "es-ES", "es-419", "fr", "de", "it", "nl", "pl", "ru", "uk",
    "tr", "ar", "he", "hi", "ja", "ko", "zh-Hans", "zh-Hant", "sv", "no", "da", "fi", "cs", "hu",
    "ro", "el", "id", "vi", "th",
];

/// Each primary language the table knows: its ISO 639-1 code, then the other
/// codes files and Addons use for it, which are its ISO 639-2/B and /T codes and
/// the old or alternate tags (`iw`, `in`, `nb`, `nob`, `nn`, `nno`).
///
/// Every curated tag's language is here, and nothing else is: a language the
/// list does not carry has no row, and matches only literally.
const LANGUAGES: [(&str, &[&str]); 28] = [
    ("en", &["eng"]),
    ("pt", &["por"]),
    ("es", &["spa"]),
    ("fr", &["fre", "fra"]),
    ("de", &["ger", "deu"]),
    ("it", &["ita"]),
    ("nl", &["dut", "nld"]),
    ("pl", &["pol"]),
    ("ru", &["rus"]),
    ("uk", &["ukr"]),
    ("tr", &["tur"]),
    ("ar", &["ara"]),
    ("he", &["heb", "iw"]),
    ("hi", &["hin"]),
    ("ja", &["jpn"]),
    ("ko", &["kor"]),
    ("zh", &["chi", "zho"]),
    ("sv", &["swe"]),
    ("no", &["nor", "nb", "nob", "nn", "nno"]),
    ("da", &["dan"]),
    ("fi", &["fin"]),
    ("cs", &["cze", "ces"]),
    ("hu", &["hun"]),
    ("ro", &["rum", "ron"]),
    ("el", &["gre", "ell"]),
    ("id", &["ind", "in"]),
    ("vi", &["vie"]),
    ("th", &["tha"]),
];

/// The regional codes that are not a language and a region the ordinary way: a
/// code, and the curated entry it names. `pt-BR` and `es-419` are not here
/// because they read as they are written.
const REGIONAL: [(&str, &str); 8] = [
    ("pob", "pt-BR"),
    ("es-MX", "es-419"),
    ("zh-CN", "zh-Hans"),
    ("zh-SG", "zh-Hans"),
    ("chs", "zh-Hans"),
    ("zh-TW", "zh-Hant"),
    ("zh-HK", "zh-Hant"),
    ("cht", "zh-Hant"),
];

/// What a tag says about a language, once the table has read it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Locale {
    language: &'static str,
    region: Option<String>,
}

impl Locale {
    /// The language's ISO 639-1 code: `pt` for `por`, `pob` and `pt-BR`.
    pub fn language(&self) -> &'static str {
        self.language
    }

    /// The region or script the tag names, lower-cased: `br` for `pob`, `hans`
    /// for `chs`, and `None` for a tag that names the language alone.
    pub fn region(&self) -> Option<&str> {
        self.region.as_deref()
    }
}

/// The ISO 639-1 code of the language a primary subtag names, if the table
/// knows it.
fn primary_language(primary: &str) -> Option<&'static str> {
    LANGUAGES
        .iter()
        .find(|(iso1, others)| {
            primary.eq_ignore_ascii_case(iso1)
                || others.iter().any(|code| primary.eq_ignore_ascii_case(code))
        })
        .map(|(iso1, _)| *iso1)
}

/// Read a tag a file or an Addon sent through the table.
///
/// `None` is a tag the table does not know, whose only match is a literal one
/// ([`same_literally`]). A known tag is a language and, where it names one, a
/// region or script: `pob` is Portuguese from Brazil, `por` is Portuguese from
/// nowhere in particular, `fr-CA` is French from Canada.
pub fn locale_of(tag: &str) -> Option<Locale> {
    let tag = match REGIONAL
        .iter()
        .find(|(code, _)| tag.eq_ignore_ascii_case(code))
    {
        Some((_, entry)) => entry,
        None => tag,
    };
    let (primary, rest) = match tag.split_once('-') {
        Some((primary, rest)) => (primary, Some(rest)),
        None => (tag, None),
    };
    Some(Locale {
        language: primary_language(primary)?,
        region: rest.map(str::to_ascii_lowercase),
    })
}

/// The curated entry a tag is, or falls under: `pob` and `pt-BR` are `pt-BR`,
/// `eng` is `en`, `fr-CA` is `fr`, and `chs` is `zh-Hans`.
///
/// `None` for a tag the table does not know, and for one that does not pick
/// among the curated entries of its language: a bare `por` could be `pt-BR` or
/// `pt-PT`, and a region the list has no entry for (`pt-AO`) falls under none.
pub fn curated_entry(tag: &str) -> Option<&'static str> {
    if let Some(entry) = curated_tag(tag) {
        return Some(entry);
    }
    let locale = locale_of(tag)?;
    let entries = || {
        CURATED
            .iter()
            .filter_map(|entry| Some((*entry, locale_of(entry)?)))
            .filter(|(_, entry)| entry.language == locale.language)
    };
    // The entry for the same region, else the entry that takes any region.
    entries()
        .find(|(_, entry)| entry.region.is_some() && entry.region == locale.region)
        .or_else(|| entries().find(|(_, entry)| entry.region.is_none()))
        .map(|(entry, _)| entry)
}

/// The curated tag a string spells, ignoring case: the tag itself and no other
/// spelling of it.
fn curated_tag(tag: &str) -> Option<&'static str> {
    CURATED
        .iter()
        .find(|entry| entry.eq_ignore_ascii_case(tag))
        .copied()
}

/// The codes mpv is given for one listed language, the language's own tag first.
///
/// A curated tag is told with the other codes that name it: a language with no
/// region of its own with its ISO 639-2 codes and old tags (`en` is `en`, `eng`),
/// a regional entry with the regional codes (`pt-BR` is `pt-BR`, `pob`). A tag
/// outside the curated list is told as it is, since that is the only way it
/// matches (ADR-0041).
pub fn codes_for(language: &Language) -> Vec<String> {
    let Some(entry) = curated_tag(language.as_str()) else {
        return vec![language.as_str().to_owned()];
    };
    let mut codes = vec![entry.to_owned()];
    match entry.split_once('-') {
        None => {
            if let Some((_, others)) = LANGUAGES.iter().find(|(iso1, _)| *iso1 == entry) {
                codes.extend(others.iter().map(|code| (*code).to_owned()));
            }
        }
        Some(_) => codes.extend(
            REGIONAL
                .iter()
                .filter(|(_, named)| *named == entry)
                .map(|(code, _)| (*code).to_owned()),
        ),
    }
    codes
}

/// The codes mpv is given for a whole list, in order, with duplicates dropped
/// (ignoring case): `pt-BR, en` is `pt-BR, pob, en, eng`.
pub fn codes_for_list(languages: &LanguageList) -> Vec<String> {
    let mut codes: Vec<String> = Vec::new();
    for code in languages.iter().flat_map(codes_for) {
        if !codes.iter().any(|told| told.eq_ignore_ascii_case(&code)) {
            codes.push(code);
        }
    }
    codes
}

/// Two tags that match literally: the same, ignoring case.
pub fn same_literally(a: &str, b: &str) -> bool {
    a.eq_ignore_ascii_case(b)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn language(tag: &str) -> Language {
        Language::parse(tag).expect("a language tag")
    }

    fn codes(tag: &str) -> Vec<String> {
        codes_for(&language(tag))
    }

    fn list(tags: &[&str]) -> LanguageList {
        LanguageList::parse(tags).expect("a language list")
    }

    #[test]
    fn every_curated_tag_is_its_own_entry() {
        assert_eq!(CURATED.len(), 32);
        for tag in CURATED {
            assert_eq!(curated_entry(tag), Some(tag), "{tag}");
            assert_eq!(
                curated_entry(&tag.to_ascii_uppercase()),
                Some(tag),
                "{tag} in capitals"
            );
        }
    }

    #[test]
    fn the_curated_tags_are_the_ones_the_client_offers() {
        let offered: serde_json::Value =
            serde_json::from_str(include_str!("../../../src/languages.json"))
                .expect("the client's list is JSON");
        let offered: Vec<&str> = offered
            .as_array()
            .expect("an array")
            .iter()
            .map(|row| row["tag"].as_str().expect("a tag"))
            .collect();
        assert_eq!(offered, CURATED);
    }

    #[test]
    fn each_language_is_its_639_1_and_639_2_codes() {
        // (curated tag, the codes mpv is told besides the tag itself)
        let rows: [(&str, &[&str]); 25] = [
            ("en", &["eng"]),
            ("fr", &["fre", "fra"]),
            ("de", &["ger", "deu"]),
            ("it", &["ita"]),
            ("nl", &["dut", "nld"]),
            ("pl", &["pol"]),
            ("ru", &["rus"]),
            ("uk", &["ukr"]),
            ("tr", &["tur"]),
            ("ar", &["ara"]),
            ("he", &["heb", "iw"]),
            ("hi", &["hin"]),
            ("ja", &["jpn"]),
            ("ko", &["kor"]),
            ("sv", &["swe"]),
            ("no", &["nor", "nb", "nob", "nn", "nno"]),
            ("da", &["dan"]),
            ("fi", &["fin"]),
            ("cs", &["cze", "ces"]),
            ("hu", &["hun"]),
            ("ro", &["rum", "ron"]),
            ("el", &["gre", "ell"]),
            ("id", &["ind", "in"]),
            ("vi", &["vie"]),
            ("th", &["tha"]),
        ];
        for (tag, extra) in rows {
            let mut expected = vec![tag.to_owned()];
            expected.extend(extra.iter().map(|code| (*code).to_owned()));
            assert_eq!(codes(tag), expected, "{tag}");
            for code in extra {
                assert_eq!(
                    locale_of(code).map(|l| (l.language(), l.region().map(str::to_owned))),
                    locale_of(tag).map(|l| (l.language(), l.region().map(str::to_owned))),
                    "{code} reads as {tag}"
                );
                assert_eq!(curated_entry(code), Some(tag), "{code} falls under {tag}");
            }
        }
    }

    #[test]
    fn the_regional_codes_map_to_their_curated_entry() {
        let rows = [
            ("pob", "pt-BR"),
            ("pt-BR", "pt-BR"),
            ("pt-PT", "pt-PT"),
            ("es-MX", "es-419"),
            ("es-419", "es-419"),
            ("es-ES", "es-ES"),
            ("zh-CN", "zh-Hans"),
            ("zh-SG", "zh-Hans"),
            ("chs", "zh-Hans"),
            ("zh-Hans", "zh-Hans"),
            ("zh-TW", "zh-Hant"),
            ("zh-HK", "zh-Hant"),
            ("cht", "zh-Hant"),
            ("zh-Hant", "zh-Hant"),
            ("en-GB", "en-GB"),
        ];
        for (code, entry) in rows {
            assert_eq!(curated_entry(code), Some(entry), "{code}");
        }
    }

    #[test]
    fn a_regional_entry_is_told_with_its_regional_codes() {
        assert_eq!(codes("pt-BR"), ["pt-BR", "pob"]);
        assert_eq!(codes("pt-PT"), ["pt-PT"]);
        assert_eq!(codes("es-419"), ["es-419", "es-MX"]);
        assert_eq!(codes("es-ES"), ["es-ES"]);
        assert_eq!(codes("en-GB"), ["en-GB"]);
        assert_eq!(codes("zh-Hans"), ["zh-Hans", "zh-CN", "zh-SG", "chs"]);
        assert_eq!(codes("zh-Hant"), ["zh-Hant", "zh-TW", "zh-HK", "cht"]);
    }

    #[test]
    fn a_language_with_several_curated_regions_is_ambiguous_on_its_own() {
        for bare in ["pt", "por", "es", "spa", "zh", "chi", "zho"] {
            assert_eq!(curated_entry(bare), None, "{bare}");
        }
        let por = locale_of("por").expect("a known language");
        assert_eq!((por.language(), por.region()), ("pt", None));
        let pob = locale_of("pob").expect("a known code");
        assert_eq!((pob.language(), pob.region()), ("pt", Some("br")));
        let chs = locale_of("chs").expect("a known code");
        assert_eq!((chs.language(), chs.region()), ("zh", Some("hans")));
        let mexican = locale_of("es-MX").expect("a known code");
        assert_eq!((mexican.language(), mexican.region()), ("es", Some("419")));
    }

    #[test]
    fn another_region_of_a_curated_language_falls_under_the_regionless_entry() {
        assert_eq!(curated_entry("fr-CA"), Some("fr"));
        assert_eq!(curated_entry("en-US"), Some("en"));
        let canadian = locale_of("fr-ca").expect("a known language");
        assert_eq!((canadian.language(), canadian.region()), ("fr", Some("ca")));
        // …but a language that is only curated by region has none to fall under.
        assert_eq!(curated_entry("pt-AO"), None);
    }

    #[test]
    fn a_tag_outside_the_curated_list_matches_only_literally() {
        for tag in ["tlh", "sw", "sw-KE", "sr-Latn"] {
            assert_eq!(locale_of(tag), None, "{tag}");
            assert_eq!(curated_entry(tag), None, "{tag}");
            assert_eq!(codes(tag), [tag], "{tag} is told as it is");
        }
        assert!(same_literally("sw-KE", "SW-ke"));
        assert!(!same_literally("sw", "sw-KE"));
        assert!(!same_literally("eng", "en"));
    }

    #[test]
    fn a_listed_code_that_is_not_a_curated_tag_is_not_widened() {
        // `eng` is a language to the table, but a list that says `eng` said it
        // literally: only the curated tags are entries.
        assert_eq!(codes("eng"), ["eng"]);
        assert_eq!(codes("pob"), ["pob"]);
        // Case does not matter to which entry a tag is, and the entry's own
        // spelling is what mpv is told.
        assert_eq!(codes("PT-br"), ["pt-BR", "pob"]);
    }

    #[test]
    fn a_list_is_expanded_in_order_with_duplicates_dropped() {
        assert_eq!(
            codes_for_list(&list(&["pt-BR", "en"])),
            ["pt-BR", "pob", "en", "eng"]
        );
        assert_eq!(codes_for_list(&LanguageList::empty()), Vec::<String>::new());
        // `no` already carries `nb`, and a listed `nb` is one more spelling of it.
        assert_eq!(
            codes_for_list(&list(&["no", "nb"])),
            ["no", "nor", "nb", "nob", "nn", "nno"]
        );
        // Dropped without regard to case.
        assert_eq!(codes_for_list(&list(&["en", "ENG"])), ["en", "eng"]);
    }
}
