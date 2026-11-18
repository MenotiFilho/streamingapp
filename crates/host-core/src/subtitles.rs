//! A `subtitles` response, in the Host's own words: **the subtitle files one
//! Addon offers for one Video**.
//!
//! A container often carries its own subtitle tracks. When the Host follows the
//! file, a Stream whose container carries none is not a Stream without
//! subtitles: the Addon ecosystem answers a `subtitles` resource with files a
//! Player can load on top of the picture, and this is the Host's reading of that
//! answer (ADR-0014). When the owner lists Subtitle languages, the Addons are
//! asked for the languages the file lacks, and an Addon subtitle in a listed
//! language can beat an embedded one in a later language (ADR-0041).
//!
//! ## The URL is the point, and it never travels
//!
//! What makes an item here a subtitle is where its bytes are: an `http`/`https`
//! URL the Player can `sub-add`. The URL is validated once, through the same
//! [`StreamUrl`] a Stream's URL is validated by, and kept in the Host's own
//! state — an Addon's subtitle URL can carry a session token exactly the way a
//! debrid Stream URL can, and a Snapshot reaches every paired client. So this
//! type is deliberately not `Serialize`: what travels outward is the *track*
//! the Player reports once the file is loaded, never where it came from.
//!
//! ## Sparse is not broken, and one bad item is not a bad answer
//!
//! The parse is tolerant the way the other Addon parsers are (ADR-0010,
//! ADR-0011). A body that is not an answer — not JSON, not an object, no
//! `subtitles` list, or one that is not a list — is refused with a typed error
//! in the Host's own words, because that is a fact about the Addon. An *item*
//! that cannot be read is dropped and the rest stand: a subtitle whose URL is
//! not one this Host would load is one item nobody can use, and a list of ten
//! languages is not all-or-nothing. The list is capped like every other list
//! this Host reads, and every word it keeps is bounded the way an Addon's words
//! are, because each one travels in a `Telling` the Player shows.

use serde_json::{Map, Value};

use crate::addon::MAX_ITEMS;
use crate::playback::{StreamUrl, Track, TrackId, TrackKind};
use crate::preferences::{Language, LanguageList};
use crate::stream::holdable;
use crate::tracks::{fit, read, SubtitleHandPick};

/// The most of a subtitles body the Host will read.
///
/// A subtitle answer is a handful of items — an id, a URL and a language tag
/// each — so an Addon answering with megabytes is misbehaving or lying, the same
/// way one answering a stream request with megabytes is.
pub const MAX_SUBTITLES_BYTES: usize = 4 * 1024 * 1024;

/// The most subtitle files the Host will add to one Stream when it **follows the
/// file**: empty Subtitle languages and no Hand pick, so no language is asked for
/// (ADR-0014, ADR-0041).
///
/// A fallback is a handful of tracks, one per language an Addon offers; across
/// every configured Addon a hundred `sub-add`s would flood mpv's track list and
/// the Snapshot every paired client reads, and none of it is a choice a client
/// made. The cap is deliberately small: a person who wants one of the rest is
/// where a per-Title subtitle preference would live, and that is a ticket that
/// has not been asked for. With a list, the Host adds by language instead, at
/// most [`MAX_SUBTITLES_PER_LANGUAGE`] of each, and this cap does not apply.
pub const MAX_FALLBACK_SUBTITLES: usize = 5;

/// The most subtitle files the Host will add per missing language, in Addon
/// order, when it chooses by Subtitle languages (ADR-0041). A list is at most
/// three languages and a Hand pick ahead of it makes four, so a Stream gains at
/// most twelve.
pub const MAX_SUBTITLES_PER_LANGUAGE: usize = 3;

/// One subtitle file an Addon offers for a Video.
///
/// The [`url`](Self::url) is what makes it a subtitle and the one field that is
/// never published: a Player is handed it, `sub-add`s it, and a Snapshot carries
/// only the *track* that came of it. [`id`](Self::id) is the Addon's own word
/// for the file and becomes the title the external track lists under, and
/// [`language`](Self::language) is the tag the Addon called it by.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Subtitle {
    /// The Addon's own id for the subtitle, where it gave one — mpv's title for
    /// the added track.
    pub id: Option<String>,
    /// Where the subtitle's bytes are: an `http`/`https` URL, validated here and
    /// never published.
    pub url: StreamUrl,
    /// The language the Addon tagged the subtitle with (`por`, `eng`).
    pub language: Option<String>,
}

/// Why a subtitles response was not read, in the Host's own vocabulary.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum SubtitleError {
    #[error("that is not a subtitles response: {detail}")]
    NotJson { detail: String },
    #[error("the subtitles response is missing {field}")]
    Missing { field: String },
    #[error("{field} should be {expected}")]
    WrongType {
        field: String,
        expected: &'static str,
    },
    #[error("{field} is longer than this Host will hold ({limit})")]
    TooLarge { field: String, limit: usize },
}

impl Subtitle {
    /// Read a `subtitles` response into the Host's own subtitles.
    ///
    /// Pure: no I/O, no state, and a refusal is just a value. An item that
    /// cannot be read as a subtitle is dropped rather than blanking the answer
    /// around it — a handful of languages are not all-or-nothing — but a body
    /// that is not a subtitles response is a refusal, because that is a fact
    /// about the Addon rather than about one subtitle.
    pub fn parse(body: &str) -> Result<Vec<Self>, SubtitleError> {
        if body.len() > MAX_SUBTITLES_BYTES {
            return Err(SubtitleError::TooLarge {
                field: "the subtitles response".to_owned(),
                limit: MAX_SUBTITLES_BYTES,
            });
        }

        let value: Value = serde_json::from_str(body).map_err(|error| SubtitleError::NotJson {
            detail: error.to_string(),
        })?;
        let object = value.as_object().ok_or_else(|| SubtitleError::NotJson {
            detail: "a subtitles response is a JSON object".to_owned(),
        })?;

        let subtitles = object
            .get("subtitles")
            .ok_or_else(|| SubtitleError::Missing {
                field: "subtitles".to_owned(),
            })?
            .as_array()
            .ok_or_else(|| SubtitleError::WrongType {
                field: "subtitles".to_owned(),
                expected: "an array",
            })?;
        if subtitles.len() > MAX_ITEMS {
            return Err(SubtitleError::TooLarge {
                field: "subtitles".to_owned(),
                limit: MAX_ITEMS,
            });
        }

        Ok(subtitles.iter().filter_map(one).collect())
    }
}

/// One subtitle, or nothing when the item is not one.
///
/// What makes an object a subtitle is not its id or its language — either may be
/// missing — but where its bytes are: a URL this Host would hand a Player. A URL
/// that is not one, whatever else the object says, is an item nobody can load.
fn one(value: &Value) -> Option<Subtitle> {
    let object = value.as_object()?;

    Some(Subtitle {
        id: field(object, "id"),
        url: StreamUrl::parse(object.get("url")?.as_str()?).ok()?,
        // The protocol's own field is `lang`; `language` is read as a fallback
        // for the Addons that spell it the long way, on the same leniency every
        // other word gets.
        language: field(object, "lang").or_else(|| field(object, "language")),
    })
}

/// One named field of a subtitle object, read as a word the Host will hold.
fn field(object: &Map<String, Value>, name: &str) -> Option<String> {
    let text = object.get(name)?.as_str()?;
    if !holdable(text) {
        return None;
    }
    Some(text.to_owned())
}

/// The listed languages the file lacks, in the order they are asked for: the
/// Hand pick's language (if it is one) first, then the list, each once.
///
/// An entry is missing when no **embedded** subtitle Track answers it, by the
/// same rules the choice ranks by: a region-less Track answers a regional entry,
/// a Track of another region does not, and a forced-only Track is not a full
/// subtitle and answers nothing. An Addon subtitle already added says nothing
/// about what the *file* lacks. A Hand pick of "off" wants no subtitle at all,
/// so nothing is missing; an empty list with no Hand pick follows the file and
/// names no language (ADR-0041).
pub fn missing_languages(
    tracks: &[Track],
    lists: &LanguageList,
    hand_pick: Option<&SubtitleHandPick>,
) -> Vec<Language> {
    let picked = match hand_pick {
        Some(SubtitleHandPick::Off) => return Vec::new(),
        Some(SubtitleHandPick::Language(language)) => Some(language),
        None => None,
    };

    let carried: Vec<_> = tracks
        .iter()
        .filter(|track| track.kind == TrackKind::Subtitle && track.embedded)
        .map(read)
        .filter(|reading| !reading.forced)
        .collect();

    let mut asked: Vec<Language> = Vec::new();
    for entry in picked.into_iter().chain(lists.as_slice()) {
        let twice = asked
            .iter()
            .any(|held| held.as_str().eq_ignore_ascii_case(entry.as_str()));
        if !twice && !carried.iter().any(|reading| fit(entry, reading).is_some()) {
            asked.push(entry.clone());
        }
    }
    asked
}

/// Which of the subtitles Addons offer are loaded, language by language: the
/// pure half of the Addon fallback for a list (ADR-0041).
///
/// A subtitle is admitted when it answers one of the missing languages by the
/// rules the choice uses (its tag and its id, the title it will list under, are
/// read as a Track's would be) and fewer than
/// [`MAX_SUBTITLES_PER_LANGUAGE`] have been admitted for that language. Offers
/// are admitted in the order they are put, which is Addon order.
#[derive(Debug, Clone)]
pub struct Admission {
    wanted: Vec<(Language, usize)>,
}

impl Admission {
    /// Admit subtitles for these languages and no others.
    pub fn for_languages(languages: Vec<Language>) -> Self {
        Self {
            wanted: languages
                .into_iter()
                .map(|language| (language, 0))
                .collect(),
        }
    }

    /// Whether this subtitle is to be added; admitting it counts against its
    /// language. A subtitle that answers several languages counts for the first
    /// of them that still has room.
    pub fn admit(&mut self, subtitle: &Subtitle) -> bool {
        let reading = read(&Track {
            id: TrackId(0),
            kind: TrackKind::Subtitle,
            language: subtitle.language.clone(),
            title: subtitle.id.clone(),
            codec: None,
            embedded: false,
            selected: false,
            default: false,
            forced: false,
            hearing_impaired: false,
        });
        for (language, taken) in &mut self.wanted {
            if *taken < MAX_SUBTITLES_PER_LANGUAGE && fit(language, &reading).is_some() {
                *taken += 1;
                return true;
            }
        }
        false
    }

    /// Whether no language has room left, so asking another Addon is pointless.
    pub fn is_full(&self) -> bool {
        self.wanted
            .iter()
            .all(|(_, taken)| *taken >= MAX_SUBTITLES_PER_LANGUAGE)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::addon::MAX_STRING_LEN;

    const ANSWER: &str = include_str!("../tests/fixtures/subtitles-v3.json");

    fn parsed(body: &str) -> Vec<Subtitle> {
        Subtitle::parse(body).unwrap_or_else(|error| panic!("{body} should parse: {error}"))
    }

    fn refused(body: &str) -> SubtitleError {
        match Subtitle::parse(body) {
            Ok(subtitles) => panic!("{body} should be refused, but parsed as {subtitles:?}"),
            Err(error) => error,
        }
    }

    #[test]
    fn a_recorded_answer_is_read_into_its_subtitles_in_the_addons_own_order() {
        let subtitles = parsed(ANSWER);

        assert_eq!(subtitles.len(), 2);
        assert_eq!(subtitles[0].id.as_deref(), Some("sub-pt-BR-1"));
        assert_eq!(
            subtitles[0].url.as_str(),
            "https://subs.example.org/v3/tt0133093/pt-BR.srt",
            "the URL is the point: an http(s) address the Player can sub-add"
        );
        assert_eq!(subtitles[0].language.as_deref(), Some("por"));
        assert_eq!(subtitles[1].language.as_deref(), Some("eng"));
    }

    #[test]
    fn the_wire_shape_of_an_answer_is_the_declared_one() {
        // The recorded shape is written out by hand, so what the parser reads is
        // the shape an Addon really serves — an id, a URL and a language tag,
        // beside the top-level addon name this Host has no use for.
        let subtitles = parsed(
            r#"{"addonName":"OpenSubtitles v3","subtitles":[
                {"id":"sub-1","url":"https://subs.example.org/x.srt","lang":"por"}
            ]}"#,
        );

        assert_eq!(
            subtitles,
            vec![Subtitle {
                id: Some("sub-1".to_owned()),
                url: StreamUrl::parse("https://subs.example.org/x.srt").expect("a URL"),
                language: Some("por".to_owned()),
            }],
            "the item is read field by field into the Host's own type"
        );

        let no_name = parsed(r#"{"addonName":123,"subtitles":[]}"#);
        assert!(
            no_name.is_empty(),
            "the top-level addon name is present in the answer and not needed"
        );
    }

    #[test]
    fn a_subtitle_may_be_missing_its_id_or_its_language() {
        let subtitles = parsed(r#"{"subtitles":[{"url":"https://subs.example.org/x.srt"}]}"#);

        assert_eq!(subtitles.len(), 1);
        assert_eq!(subtitles[0].id, None);
        assert_eq!(subtitles[0].language, None);
        assert_eq!(subtitles[0].url.as_str(), "https://subs.example.org/x.srt");
    }

    #[test]
    fn a_subtitle_that_is_not_an_http_url_is_dropped() {
        // A subtitle is a URL a Player can load; a `file://` path, a magnet or
        // anything that is not an address this Host opens is an item nobody can
        // use, so it is one item dropped rather than a failed answer.
        for url in [
            "not a url",
            "/local/subtitle.srt",
            "file:///etc/passwd",
            "magnet:?xt=urn:btih:deadbeef",
            "s3://bucket/x.srt",
            "https://",
        ] {
            let body = format!(r#"{{"subtitles":[{{"url":{url:?},"lang":"por"}}]}}"#);

            assert!(
                parsed(&body).is_empty(),
                "{url:?} is not a URL this Host will load"
            );
        }
    }

    #[test]
    fn a_url_of_the_wrong_shape_is_dropped_rather_than_the_answer_failing() {
        let subtitles = parsed(
            r#"{"subtitles":[
                {"url":5,"lang":"por"},
                {"url":null,"lang":"por"},
                {"url":"https://subs.example.org/kept.srt","lang":"eng"}
            ]}"#,
        );

        assert_eq!(subtitles.len(), 1);
        assert_eq!(
            subtitles[0].url.as_str(),
            "https://subs.example.org/kept.srt"
        );
    }

    #[test]
    fn an_item_that_cannot_be_read_is_dropped_rather_than_blanking_the_answer() {
        let subtitles = parsed(
            r#"{"subtitles":[
                "not a subtitle at all",
                5,
                null,
                {"lang":"por"},
                {"url":"https://subs.example.org/one.srt","lang":"por"},
                {"url":"https://subs.example.org/two.srt","lang":"eng"}
            ]}"#,
        );

        assert_eq!(
            subtitles
                .iter()
                .map(|subtitle| subtitle.url.as_str())
                .collect::<Vec<_>>(),
            vec![
                "https://subs.example.org/one.srt",
                "https://subs.example.org/two.srt",
            ],
            "the subtitles that read survive the items that do not"
        );
    }

    #[test]
    fn a_word_too_long_to_hold_is_absence_rather_than_a_broken_answer() {
        let long = "x".repeat(MAX_STRING_LEN + 1);
        let body = serde_json::json!({
            "subtitles": [{
                "id": long,
                "url": "https://subs.example.org/x.srt",
                "lang": long,
            }],
        })
        .to_string();

        let subtitles = parsed(&body);
        assert_eq!(subtitles.len(), 1);
        assert_eq!(subtitles[0].id, None);
        assert_eq!(subtitles[0].language, None);
    }

    #[test]
    fn a_body_that_is_not_a_subtitles_response_is_refused() {
        for body in [
            "",
            "not json at all",
            "<html>hello</html>",
            "[]",
            "\"subtitles\"",
            "5",
            "null",
        ] {
            assert!(
                matches!(refused(body), SubtitleError::NotJson { .. }),
                "{body:?} is not a subtitles response"
            );
        }
    }

    #[test]
    fn a_response_without_subtitles_is_refused_rather_than_read_as_none_offered() {
        assert_eq!(
            refused(r#"{"addonName":"OpenSubtitles v3"}"#),
            SubtitleError::Missing {
                field: "subtitles".to_owned(),
            },
            "an answer with no list at all is not a list this Host invents"
        );
    }

    #[test]
    fn a_response_whose_subtitles_are_not_a_list_is_refused() {
        assert_eq!(
            refused(r#"{"subtitles":"every language"}"#),
            SubtitleError::WrongType {
                field: "subtitles".to_owned(),
                expected: "an array",
            },
            "a fact about the Addon rather than about one subtitle"
        );
        assert_eq!(
            refused(r#"{"subtitles":null}"#),
            SubtitleError::WrongType {
                field: "subtitles".to_owned(),
                expected: "an array",
            }
        );
    }

    #[test]
    fn a_list_longer_than_the_host_holds_is_refused() {
        let body = serde_json::json!({
            "subtitles": vec![
                serde_json::json!({ "url": "https://subs.example.org/x.srt" });
                MAX_ITEMS + 1
            ],
        })
        .to_string();

        assert_eq!(
            refused(&body),
            SubtitleError::TooLarge {
                field: "subtitles".to_owned(),
                limit: MAX_ITEMS,
            }
        );
    }

    #[test]
    fn a_body_longer_than_the_host_holds_is_refused_before_it_is_parsed() {
        let body = format!("{} {{", " ".repeat(MAX_SUBTITLES_BYTES));

        assert_eq!(
            refused(&body),
            SubtitleError::TooLarge {
                field: "the subtitles response".to_owned(),
                limit: MAX_SUBTITLES_BYTES,
            }
        );
    }

    // --- the languages the file lacks (ADR-0041) -------------------------------

    use crate::playback::{Track, TrackId, TrackKind};
    use crate::preferences::{Language, LanguageList};
    use crate::tracks::SubtitleHandPick;

    fn list(tags: &[&str]) -> LanguageList {
        LanguageList::parse(tags).expect("a language list")
    }

    fn language(tag: &str) -> Language {
        Language::parse(tag).expect("a language tag")
    }

    fn embedded(id: i64, tag: &str) -> Track {
        Track {
            id: TrackId(id),
            kind: TrackKind::Subtitle,
            language: Some(tag.to_owned()),
            title: None,
            codec: Some("subrip".to_owned()),
            embedded: true,
            selected: false,
            default: false,
            forced: false,
            hearing_impaired: false,
        }
    }

    fn missing(tracks: &[Track], tags: &[&str]) -> Vec<String> {
        missing_languages(tracks, &list(tags), None)
            .iter()
            .map(|language| language.as_str().to_owned())
            .collect()
    }

    #[test]
    fn a_listed_language_the_file_carries_is_not_missing() {
        let tracks = [embedded(1, "eng")];

        assert_eq!(missing(&tracks, &["en"]), Vec::<String>::new());
    }

    #[test]
    fn a_language_the_file_lacks_is_missing_in_the_lists_order() {
        let tracks = [embedded(1, "eng")];

        assert_eq!(missing(&tracks, &["pt-BR", "en", "ja"]), ["pt-BR", "ja"]);
    }

    #[test]
    fn a_region_strict_miss_is_missing() {
        // Only European Portuguese is embedded: it is not what was asked for.
        let tracks = [embedded(1, "pt-PT")];

        assert_eq!(missing(&tracks, &["pt-BR"]), ["pt-BR"]);
    }

    #[test]
    fn a_region_less_track_answers_a_regional_entry() {
        let tracks = [embedded(1, "por")];

        assert_eq!(missing(&tracks, &["pt-BR"]), Vec::<String>::new());
    }

    #[test]
    fn an_empty_list_misses_nothing() {
        assert_eq!(missing(&[], &[]), Vec::<String>::new());
    }

    #[test]
    fn a_forced_only_track_does_not_answer_an_entry() {
        let mut forced = embedded(1, "eng");
        forced.forced = true;

        assert_eq!(missing(&[forced], &["en"]), ["en"]);
    }

    #[test]
    fn an_added_track_does_not_answer_an_entry_the_file_lacks() {
        // Only what the file carries says what the file lacks.
        let mut added = embedded(5, "por");
        added.embedded = false;

        assert_eq!(missing(&[added], &["pt-BR"]), ["pt-BR"]);
    }

    #[test]
    fn a_hand_picks_language_counts_as_an_entry_ahead_of_the_list() {
        let tracks = [embedded(1, "eng")];
        let pick = SubtitleHandPick::Language(language("fr"));

        let asked = missing_languages(&tracks, &list(&["en", "de"]), Some(&pick));

        let asked: Vec<&str> = asked.iter().map(Language::as_str).collect();
        assert_eq!(asked, ["fr", "de"]);
    }

    #[test]
    fn a_hand_pick_the_file_carries_adds_nothing_and_one_in_the_list_is_not_twice() {
        let tracks = [embedded(1, "fre")];
        let pick = SubtitleHandPick::Language(language("fr"));

        assert!(missing_languages(&tracks, &list(&[]), Some(&pick)).is_empty());

        let pick = SubtitleHandPick::Language(language("DE"));
        let asked = missing_languages(&tracks, &list(&["de"]), Some(&pick));
        assert_eq!(asked.len(), 1, "one language is asked for once");
    }

    #[test]
    fn a_hand_pick_of_off_wants_no_subtitle_from_any_addon() {
        let pick = SubtitleHandPick::Off;

        assert!(missing_languages(&[], &list(&["en"]), Some(&pick)).is_empty());
    }

    // --- admitting an Addon's subtitles per missing language -------------------

    fn offered(id: &str, language: Option<&str>) -> Subtitle {
        Subtitle {
            id: Some(id.to_owned()),
            url: StreamUrl::parse(&format!("https://subs.example.org/{id}.srt"))
                .expect("a subtitle URL"),
            language: language.map(str::to_owned),
        }
    }

    #[test]
    fn only_subtitles_in_a_missing_language_are_admitted() {
        let mut quota = Admission::for_languages(vec![language("pt-BR")]);

        assert!(quota.admit(&offered("a", Some("pob"))));
        assert!(
            quota.admit(&offered("b", Some("por"))),
            "region-less matches"
        );
        assert!(!quota.admit(&offered("c", Some("pt-PT"))), "region-strict");
        assert!(!quota.admit(&offered("d", Some("eng"))), "not asked for");
        assert!(!quota.admit(&offered("e", None)), "says no language");
    }

    #[test]
    fn at_most_three_are_admitted_per_language_and_the_rest_are_other_languages() {
        let mut quota = Admission::for_languages(vec![language("pt-BR"), language("en")]);

        let admitted: Vec<bool> = [
            ("p1", "pob"),
            ("e1", "eng"),
            ("p2", "pob"),
            ("p3", "pob"),
            ("p4", "pob"),
            ("e2", "eng"),
        ]
        .into_iter()
        .map(|(id, tag)| quota.admit(&offered(id, Some(tag))))
        .collect();

        assert_eq!(admitted, [true, true, true, true, false, true]);
        assert_eq!(MAX_SUBTITLES_PER_LANGUAGE, 3);
    }

    #[test]
    fn the_quota_says_when_every_language_is_full() {
        let mut quota = Admission::for_languages(vec![language("en")]);
        assert!(!quota.is_full());

        for n in 0..MAX_SUBTITLES_PER_LANGUAGE {
            assert!(quota.admit(&offered(&format!("e{n}"), Some("eng"))));
        }

        assert!(quota.is_full());
    }
}
