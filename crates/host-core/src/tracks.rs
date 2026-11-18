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

use crate::playback::{Track, TrackId, TrackKind};
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

/// What a title word says about a Track.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Meaning {
    /// A language and the region or script it is spoken in.
    Region(&'static str, &'static str),
    /// Subtitles for the deaf and hard of hearing.
    Sdh,
    /// Only the parts a viewer would not understand.
    Forced,
    /// A commentary soundtrack rather than the film's own.
    Commentary,
}

/// The title word table (ADR-0041): the words a Track's own title uses for what
/// its tag and flags leave open. Matched without regard to case, on whole words
/// (a phrase is its words in a row); a word in a script that does not separate
/// its words is matched wherever it stands.
const TITLE_WORDS: [(&str, Meaning); 24] = [
    ("brazilian", Meaning::Region("pt", "br")),
    ("brasil", Meaning::Region("pt", "br")),
    ("brazil", Meaning::Region("pt", "br")),
    ("european", Meaning::Region("pt", "pt")),
    ("portugal", Meaning::Region("pt", "pt")),
    ("latin", Meaning::Region("es", "419")),
    ("latino", Meaning::Region("es", "419")),
    ("latam", Meaning::Region("es", "419")),
    ("latinoamérica", Meaning::Region("es", "419")),
    ("castilian", Meaning::Region("es", "es")),
    ("castellano", Meaning::Region("es", "es")),
    ("españa", Meaning::Region("es", "es")),
    ("spain", Meaning::Region("es", "es")),
    ("simplified", Meaning::Region("zh", "hans")),
    ("简体", Meaning::Region("zh", "hans")),
    ("traditional", Meaning::Region("zh", "hant")),
    ("繁體", Meaning::Region("zh", "hant")),
    ("繁体", Meaning::Region("zh", "hant")),
    ("sdh", Meaning::Sdh),
    ("cc", Meaning::Sdh),
    ("hearing impaired", Meaning::Sdh),
    ("forced", Meaning::Forced),
    ("foreign", Meaning::Forced),
    ("commentary", Meaning::Commentary),
];

/// Whether a character is one of a script that writes no spaces between words.
fn is_han(c: char) -> bool {
    ('\u{4e00}'..='\u{9fff}').contains(&c)
}

/// Every meaning the words of a title carry, in the table's order.
fn title_meanings(title: &str) -> Vec<Meaning> {
    let lowered = title.to_lowercase();
    let words: Vec<&str> = lowered
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .collect();
    TITLE_WORDS
        .iter()
        .filter(|(phrase, _)| {
            if phrase.chars().all(is_han) {
                return lowered.contains(phrase);
            }
            let wanted: Vec<&str> = phrase.split(' ').collect();
            words.windows(wanted.len()).any(|run| run == wanted)
        })
        .map(|(_, meaning)| *meaning)
        .collect()
}

/// What the Host knows about one Track once its tag, its flags and its title
/// have been read: the one reading every choice ranks from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reading {
    /// The tag the container gave, as it gave it: what a literal match reads.
    tag: Option<String>,
    /// The language and region the tag names through the table, with the
    /// title's words filling a region the tag left out, or the language of a
    /// Track that has no tag. `None` when neither says.
    locale: Option<Locale>,
    /// Whether the container marks it the default of its kind.
    pub default: bool,
    /// Whether it is forced: the container's flag, or a title that says so.
    pub forced: bool,
    /// Whether it is for the hard of hearing, as a title says so.
    pub sdh: bool,
    /// Whether it is a commentary, as a title says so.
    pub commentary: bool,
}

/// Read a Track. Flags the container set are believed first, and a title only
/// adds what the container did not say: a region the tag lacks, and the flags
/// that follow its words (ADR-0041).
pub fn read(track: &Track) -> Reading {
    let tag = track.language.clone();
    let mut locale = tag.as_deref().and_then(locale_of);
    let meanings = track
        .title
        .as_deref()
        .map(title_meanings)
        .unwrap_or_default();

    let named = meanings.iter().find_map(|meaning| match meaning {
        Meaning::Region(language, region) => Some((*language, *region)),
        _ => None,
    });
    if let Some((language, region)) = named {
        match &mut locale {
            // A tag that names the language and no region: the title fills it.
            Some(held) if held.language == language && held.region.is_none() => {
                held.region = Some(region.to_owned());
            }
            // A Track with no tag at all is the language the title names.
            None if tag.is_none() => {
                locale = Some(Locale {
                    language,
                    region: Some(region.to_owned()),
                });
            }
            // Anything else is the tag's word against the title's: the tag's.
            _ => {}
        }
    }

    Reading {
        tag,
        locale,
        default: track.default,
        forced: track.forced || meanings.contains(&Meaning::Forced),
        sdh: meanings.contains(&Meaning::Sdh),
        commentary: meanings.contains(&Meaning::Commentary),
    }
}

/// How well a Track answers one listed language. Declared best first, so the
/// derived order is the rank: `Exact` before `Regionless`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Fit {
    /// The language and, where the entry names one, its region.
    Exact,
    /// The entry names a region and the Track names the language alone (`por`
    /// for `pt-BR`): a match, but below one that says the region.
    Regionless,
}

/// A Track's rank against one entry of a list, or `None` for no match.
///
/// A curated entry matches through the code table: with a region or script
/// (`pt-BR`) the same region is [`Fit::Exact`], the language alone is
/// [`Fit::Regionless`] and another region is no match; without one (`fr`) any
/// region is exact. An entry outside the curated list matches only literally
/// (ADR-0041).
pub fn fit(entry: &Language, track: &Reading) -> Option<Fit> {
    if curated_tag(entry.as_str()).is_none() {
        return track
            .tag
            .as_deref()
            .filter(|tag| same_literally(tag, entry.as_str()))
            .map(|_| Fit::Exact);
    }
    let wanted = locale_of(entry.as_str())?;
    let held = track.locale.as_ref()?;
    if held.language != wanted.language {
        return None;
    }
    match (&wanted.region, &held.region) {
        (None, _) => Some(Fit::Exact),
        (Some(wanted), Some(held)) if wanted == held => Some(Fit::Exact),
        (Some(_), Some(_)) => None,
        (Some(_), None) => Some(Fit::Regionless),
    }
}

/// The soundtrack the Host chooses: a Track id, or nothing where the Stream has
/// no audio at all.
///
/// Walks the Hand pick (a tag, like a list entry), then the list, in order. For
/// the first entry any audio Track answers: a commentary after the others, then
/// exact before region-less, then the one the file marks default, then file
/// order. Channel count and codec are not considered. Where nothing answers, or
/// the list is empty, the file's own default soundtrack, else its first.
pub fn choose_soundtrack(
    tracks: &[Track],
    audio_languages: &LanguageList,
    hand_pick: Option<&Language>,
) -> Option<TrackId> {
    let audio: Vec<(&Track, Reading)> = tracks
        .iter()
        .filter(|track| track.kind == TrackKind::Audio)
        .map(|track| (track, read(track)))
        .collect();

    for entry in hand_pick.into_iter().chain(audio_languages.as_slice()) {
        let best = audio
            .iter()
            .enumerate()
            .filter_map(|(order, (track, reading))| {
                let fit = fit(entry, reading)?;
                Some(((reading.commentary, fit, !reading.default, order), track.id))
            })
            .min_by_key(|(rank, _)| *rank);
        if let Some((_, id)) = best {
            return Some(id);
        }
    }

    audio
        .iter()
        .find(|(_, reading)| reading.default)
        .or_else(|| audio.first())
        .map(|(track, _)| track.id)
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

    /// An audio Track with a language tag and nothing else the container says.
    fn audio(id: i64, tag: &str) -> Track {
        track(id, TrackKind::Audio, Some(tag))
    }

    fn track(id: i64, kind: TrackKind, tag: Option<&str>) -> Track {
        Track {
            id: TrackId(id),
            kind,
            language: tag.map(str::to_owned),
            title: None,
            codec: None,
            embedded: true,
            selected: false,
            default: false,
            forced: false,
        }
    }

    fn titled(mut track: Track, title: &str) -> Track {
        track.title = Some(title.to_owned());
        track
    }

    fn marked_default(mut track: Track) -> Track {
        track.default = true;
        track
    }

    /// How a Track ranks against an entry given as a tag.
    fn fit_of(entry: &str, track: &Track) -> Option<Fit> {
        fit(&language(entry), &read(track))
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

    #[test]
    fn a_regional_entry_matches_its_region_exactly_and_the_bare_language_below_that() {
        for tag in ["pt-BR", "pob", "PT-br"] {
            assert_eq!(fit_of("pt-BR", &audio(1, tag)), Some(Fit::Exact), "{tag}");
        }
        for tag in ["por", "pt"] {
            assert_eq!(
                fit_of("pt-BR", &audio(1, tag)),
                Some(Fit::Regionless),
                "{tag}"
            );
        }
        assert_eq!(fit_of("pt-BR", &audio(1, "pt-PT")), None);
        assert_eq!(fit_of("pt-BR", &audio(1, "pt-AO")), None);
        assert_eq!(fit_of("pt-BR", &audio(1, "eng")), None);
        assert_eq!(fit_of("pt-BR", &track(1, TrackKind::Audio, None)), None);
    }

    #[test]
    fn a_script_entry_reads_the_regional_codes_too() {
        assert_eq!(fit_of("zh-Hans", &audio(1, "chs")), Some(Fit::Exact));
        assert_eq!(fit_of("zh-Hans", &audio(1, "zh-SG")), Some(Fit::Exact));
        assert_eq!(fit_of("zh-Hans", &audio(1, "chi")), Some(Fit::Regionless));
        assert_eq!(fit_of("zh-Hans", &audio(1, "zh-TW")), None);
        assert_eq!(fit_of("es-419", &audio(1, "es-MX")), Some(Fit::Exact));
        assert_eq!(fit_of("es-419", &audio(1, "es-ES")), None);
    }

    #[test]
    fn an_entry_without_a_region_matches_any_region_exactly() {
        for tag in ["fr", "fre", "fra", "fr-CA", "fr-FR"] {
            assert_eq!(fit_of("fr", &audio(1, tag)), Some(Fit::Exact), "{tag}");
        }
        assert_eq!(fit_of("fr", &audio(1, "de")), None);
        assert_eq!(fit_of("no", &audio(1, "nob")), Some(Fit::Exact));
    }

    #[test]
    fn a_non_curated_entry_matches_only_literally() {
        assert_eq!(fit_of("sw", &audio(1, "SW")), Some(Fit::Exact));
        assert_eq!(fit_of("sw", &audio(1, "sw-KE")), None);
        assert_eq!(fit_of("sw-KE", &audio(1, "sw")), None);
        // A listed code that is not a curated tag is not widened either.
        assert_eq!(fit_of("eng", &audio(1, "eng")), Some(Fit::Exact));
        assert_eq!(fit_of("eng", &audio(1, "en")), None);
    }

    #[test]
    fn the_title_fills_a_missing_region() {
        for title in ["Portuguese (Brazilian)", "Brasil", "brazil dub"] {
            let track = titled(audio(1, "por"), title);
            assert_eq!(fit_of("pt-BR", &track), Some(Fit::Exact), "{title}");
        }
        let european = titled(audio(1, "por"), "European Portuguese");
        assert_eq!(fit_of("pt-BR", &european), None);
        assert_eq!(fit_of("pt-PT", &european), Some(Fit::Exact));
        let latin = titled(audio(1, "spa"), "Español Latino");
        assert_eq!(fit_of("es-419", &latin), Some(Fit::Exact));
        assert_eq!(fit_of("es-ES", &latin), None);
        let castilian = titled(audio(1, "spa"), "Castellano");
        assert_eq!(fit_of("es-ES", &castilian), Some(Fit::Exact));
        let simplified = titled(audio(1, "chi"), "简体中文");
        assert_eq!(fit_of("zh-Hans", &simplified), Some(Fit::Exact));
        let traditional = titled(audio(1, "chi"), "Traditional");
        assert_eq!(fit_of("zh-Hant", &traditional), Some(Fit::Exact));
    }

    #[test]
    fn the_title_never_overrides_the_tag() {
        // The tag says Portugal; the title's "Brazilian" is not believed.
        let track = titled(audio(1, "pt-PT"), "Brazilian");
        assert_eq!(fit_of("pt-BR", &track), None);
        assert_eq!(fit_of("pt-PT", &track), Some(Fit::Exact));
        // A title about another language says nothing about this one.
        let track = titled(audio(1, "eng"), "Brazilian");
        assert_eq!(fit_of("pt-BR", &track), None);
        assert_eq!(fit_of("en", &track), Some(Fit::Exact));
        // And a word inside another word is no word.
        let track = titled(audio(1, "por"), "Brazilianesque");
        assert_eq!(fit_of("pt-BR", &track), Some(Fit::Regionless));
    }

    #[test]
    fn a_title_alone_names_a_track_the_container_left_untagged() {
        let track = titled(track(1, TrackKind::Audio, None), "Brazilian");
        assert_eq!(fit_of("pt-BR", &track), Some(Fit::Exact));
        assert_eq!(fit_of("pt-PT", &track), None);
        assert_eq!(fit_of("en", &track), None);
    }

    #[test]
    fn the_title_adds_flags_the_container_did_not_set() {
        let flags = |title: &str| {
            let reading = read(&titled(audio(1, "eng"), title));
            (reading.forced, reading.sdh, reading.commentary)
        };
        assert_eq!(flags("English"), (false, false, false));
        assert_eq!(flags("English [Forced]"), (true, false, false));
        assert_eq!(flags("Foreign parts only"), (true, false, false));
        assert_eq!(flags("English SDH"), (false, true, false));
        assert_eq!(flags("English (CC)"), (false, true, false));
        assert_eq!(flags("English - Hearing Impaired"), (false, true, false));
        assert_eq!(flags("Director's Commentary"), (false, false, true));
        assert_eq!(flags("Hearing and Impaired apart"), (false, false, false));

        // The container's own flags are believed first, and the title only adds.
        let mut forced = audio(1, "eng");
        forced.forced = true;
        forced.default = true;
        let reading = read(&titled(forced, "English"));
        assert!(reading.forced && reading.default);
        assert!(!reading.sdh);
    }

    fn soundtrack(tracks: &[Track], languages: &[&str]) -> Option<i64> {
        choose_soundtrack(tracks, &list(languages), None).map(|id| id.0)
    }

    #[test]
    fn the_soundtrack_follows_the_order_of_the_list() {
        let tracks = [audio(1, "eng"), audio(2, "por"), audio(3, "jpn")];
        assert_eq!(soundtrack(&tracks, &["ja", "en"]), Some(3));
        assert_eq!(soundtrack(&tracks, &["en", "ja"]), Some(1));
        assert_eq!(soundtrack(&tracks, &["de", "pt-BR", "en"]), Some(2));
    }

    #[test]
    fn a_portuguese_dub_beats_the_files_english_default_for_pt_br() {
        let tracks = [marked_default(audio(1, "eng")), audio(2, "pob")];
        assert_eq!(soundtrack(&tracks, &["pt-BR"]), Some(2));
    }

    #[test]
    fn an_exact_match_comes_before_a_regionless_one_whatever_the_flags() {
        let tracks = [marked_default(audio(1, "por")), audio(2, "pob")];
        assert_eq!(soundtrack(&tracks, &["pt-BR"]), Some(2));
        // And a region that is not asked for is not a match at all.
        let tracks = [audio(1, "eng"), audio(2, "pt-PT")];
        assert_eq!(soundtrack(&tracks, &["pt-BR"]), Some(1));
        assert_eq!(soundtrack(&tracks, &["pt-BR", "pt-PT"]), Some(2));
    }

    #[test]
    fn within_an_entry_the_default_flag_comes_before_file_order() {
        let tracks = [
            audio(1, "eng"),
            marked_default(audio(2, "eng")),
            audio(3, "eng"),
        ];
        assert_eq!(soundtrack(&tracks, &["en"]), Some(2));
        let tracks = [audio(1, "eng"), audio(2, "eng")];
        assert_eq!(soundtrack(&tracks, &["en"]), Some(1));
    }

    #[test]
    fn a_commentary_comes_last_within_an_entry() {
        let tracks = [
            titled(marked_default(audio(1, "eng")), "Director's Commentary"),
            audio(2, "eng"),
        ];
        assert_eq!(soundtrack(&tracks, &["en"]), Some(2));
        // Alone in its language it is still that language's soundtrack.
        let tracks = [titled(audio(1, "eng"), "Commentary"), audio(2, "jpn")];
        assert_eq!(soundtrack(&tracks, &["en", "ja"]), Some(1));
    }

    #[test]
    fn where_nothing_matches_the_file_decides() {
        let tracks = [
            audio(1, "eng"),
            marked_default(audio(2, "jpn")),
            audio(3, "fre"),
        ];
        assert_eq!(soundtrack(&tracks, &["pt-BR", "de"]), Some(2));
        let tracks = [audio(4, "eng"), audio(5, "jpn")];
        assert_eq!(soundtrack(&tracks, &["pt-BR"]), Some(4));
        // An empty list follows the file the same way.
        let tracks = [audio(1, "eng"), marked_default(audio(2, "jpn"))];
        assert_eq!(soundtrack(&tracks, &[]), Some(2));
    }

    #[test]
    fn a_stream_with_no_audio_has_no_soundtrack() {
        assert_eq!(soundtrack(&[], &["en"]), None);
        let only_subtitles = [track(1, TrackKind::Subtitle, Some("eng"))];
        assert_eq!(soundtrack(&only_subtitles, &["en"]), None);
        assert_eq!(soundtrack(&only_subtitles, &[]), None);
    }

    #[test]
    fn a_subtitle_is_never_the_soundtrack() {
        let tracks = [track(1, TrackKind::Subtitle, Some("por")), audio(2, "eng")];
        assert_eq!(soundtrack(&tracks, &["pt"]), Some(2));
    }

    #[test]
    fn a_hand_pick_comes_ahead_of_the_list() {
        let tracks = [audio(1, "eng"), audio(2, "pob"), audio(3, "jpn")];
        let picked = language("ja");
        assert_eq!(
            choose_soundtrack(&tracks, &list(&["pt-BR"]), Some(&picked)),
            Some(TrackId(3))
        );
        // A Hand pick no Track answers falls through to the list.
        let picked = language("de");
        assert_eq!(
            choose_soundtrack(&tracks, &list(&["pt-BR"]), Some(&picked)),
            Some(TrackId(2))
        );
        // And with an empty list it still decides.
        let picked = language("ja");
        assert_eq!(
            choose_soundtrack(&tracks, &LanguageList::empty(), Some(&picked)),
            Some(TrackId(3))
        );
    }

    #[test]
    fn a_non_curated_entry_chooses_a_soundtrack_literally() {
        let tracks = [audio(1, "eng"), audio(2, "tlh")];
        assert_eq!(soundtrack(&tracks, &["tlh"]), Some(2));
    }
}
