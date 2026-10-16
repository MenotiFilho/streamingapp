//! What the Host asks an Addon for, and the URL it asks at.
//!
//! The protocol is a REST shape: `/{resource}/{type}/{id}.json`, or
//! `/{resource}/{type}/{id}/{extra}.json` when the client chose something —
//! `skip` to page a catalog, `search` to search one, `genre` to filter. Every
//! path component is percent-encoded, and `extra` is a *stringified querystring*:
//! `name=value` pairs joined by `&`, with each name and value encoded on its own.
//!
//! All of it is pure and tested over fixtures, because encoding is exactly the
//! kind of thing that is assumed right and is not: a search for `blood & guts`
//! has to reach the Addon as `search=blood%20%26%20guts`, not as a second
//! parameter, and an id containing a `/` has to stay one path segment.
//!
//! The encoding set is the one Stremio's own client uses
//! (`URI_COMPONENT_ENCODE_SET` in `stremio-core`): alphanumerics and
//! `- _ . ! ~ * ' ( )` stay as they are, everything else is percent-encoded.
//! That is what `encodeURIComponent` does, which is what every Addon expects.

use percent_encoding::{utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
use serde::{Deserialize, Serialize};

use crate::addon::{MAX_STRING_LEN, MAX_URL_LEN};

/// The resource name the protocol asks about by name, and where a catalog's
/// search control lives.
pub const CATALOG: &str = "catalog";

/// The resource that answers with one item's metadata — what opening a Title
/// asks for.
pub const META: &str = "meta";

/// The `extra` name that carries a search query.
pub const SEARCH: &str = "search";

/// The `extra` name that carries a paging offset.
pub const SKIP: &str = "skip";

/// The characters left alone in a path component.
///
/// Alphanumerics are always left; these are the punctuation marks
/// `encodeURIComponent` leaves as well.
pub(crate) const COMPONENT: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'_')
    .remove(b'.')
    .remove(b'!')
    .remove(b'~')
    .remove(b'*')
    .remove(b'\'')
    .remove(b'(')
    .remove(b')');

/// The most `extra` values one request may carry.
pub const MAX_EXTRAS: usize = 32;

/// One thing a client chose about a request: `search=matrix`, `skip=100`,
/// `genre=Action`.
///
/// A name and a value, never a pre-built querystring: the Host builds the
/// string, so a value containing `&` or `=` is encoded rather than read as
/// another parameter.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Extra {
    pub name: String,
    pub value: String,
}

impl Extra {
    /// A chosen value, or why the Host will not send it.
    pub fn parse(name: &str, value: &str) -> Result<Self, InvalidExtra> {
        let invalid = || InvalidExtra {
            name: name.to_owned(),
        };

        if name.is_empty() || name.len() > MAX_STRING_LEN {
            return Err(invalid());
        }
        if name.chars().any(|c| c.is_control() || c.is_whitespace()) {
            return Err(invalid());
        }
        if value.len() > MAX_STRING_LEN {
            return Err(invalid());
        }
        if value.chars().any(char::is_control) {
            return Err(invalid());
        }

        Ok(Self {
            name: name.to_owned(),
            value: value.to_owned(),
        })
    }

    /// The same, by value, for the tests that have a literal pair.
    pub fn of(name: impl Into<String>, value: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            value: value.into(),
        }
    }
}

/// An `extra` the Host will not put in a request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, thiserror::Error)]
#[error("{name:?} is not something this Host will send as an extra")]
pub struct InvalidExtra {
    pub name: String,
}

/// Which catalog a request is about: the Addon's own type and id, as they were
/// declared in its manifest.
///
/// Nested inside an Action rather than flattened, because an Action already has a
/// `type` of its own — the variant — and a second one beside it would be the
/// same JSON key twice.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogRef {
    /// The content type: `movie`, `series`, `channel`, `tv`, …
    #[serde(rename = "type")]
    pub r#type: String,
    pub id: String,
}

impl std::fmt::Display for CatalogRef {
    /// How a catalog is named in a message a person reads: `movie/top`.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}/{}", self.r#type, self.id)
    }
}

impl CatalogRef {
    /// A catalog named by its type and id, or why the Host will not ask for it.
    pub fn parse(r#type: &str, id: &str) -> Result<Self, InvalidCatalogRef> {
        if let Some((which, value)) = unusable(r#type, id) {
            return Err(InvalidCatalogRef { which, value });
        }

        Ok(Self {
            r#type: r#type.to_owned(),
            id: id.to_owned(),
        })
    }
}

/// Which Title a meta request is about: the type and id an item carried, as its
/// Addon indexes it.
///
/// The same `{type}/{id}` pair a [`CatalogRef`] is, because the protocol names
/// both the same way — what differs is only what the Host is asked for, and the
/// two are never the same request. Kept a type of its own so that a message about
/// a Title does not name a catalog.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TitleRef {
    /// The content type: `movie`, `series`, `channel`, `tv`, …
    #[serde(rename = "type")]
    pub r#type: String,
    /// The id the Addon indexes the Title by: `tt0903747`, `tmdb:603`.
    pub id: String,
}

impl std::fmt::Display for TitleRef {
    /// How a Title is named in a message a person reads: `series/tt0903747`.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}/{}", self.r#type, self.id)
    }
}

impl TitleRef {
    /// A Title named by its type and id, or why the Host will not open it.
    pub fn parse(r#type: &str, id: &str) -> Result<Self, InvalidTitleRef> {
        if let Some((which, value)) = unusable(r#type, id) {
            return Err(InvalidTitleRef { which, value });
        }

        Ok(Self {
            r#type: r#type.to_owned(),
            id: id.to_owned(),
        })
    }
}

/// Which of a `{type}/{id}` pair is not usable, and the value offered for it.
///
/// A catalog and a Title are addressed the same way — `{type}/{id}` — so what a
/// usable pair is is decided once and applied by both references. A value is
/// usable when it says something, is short enough to put in a URL, and carries
/// no control character or space, which is what the path segment encoding would
/// otherwise have to hide.
fn unusable(r#type: &str, id: &str) -> Option<(&'static str, String)> {
    for (which, value) in [("type", r#type), ("id", id)] {
        if value.is_empty() || value.len() > MAX_STRING_LEN {
            return Some((which, value.to_owned()));
        }
        if value.chars().any(|c| c.is_control() || c.is_whitespace()) {
            return Some((which, value.to_owned()));
        }
    }

    None
}

/// A string that is not a catalog type or id, offered as one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, thiserror::Error)]
#[error("{value:?} is not a catalog {which}")]
pub struct InvalidCatalogRef {
    pub which: &'static str,
    pub value: String,
}

/// A string that is not a Title's type or id, offered as one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, thiserror::Error)]
#[error("{value:?} is not a Title {which}")]
pub struct InvalidTitleRef {
    pub which: &'static str,
    pub value: String,
}

/// A resource request, as values rather than as a URL.
///
/// Kept apart from its URL on purpose: which Addon it is asked of is a decision
/// above this type (ADR-0005 — a client browses where it likes), and the URL is
/// a pure function of the request and the Addon's manifest URL.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResourceRequest {
    /// `catalog`, `meta`, `stream`, `subtitles` — whatever the protocol grows.
    pub resource: String,
    /// The content type: `movie`, `series`, `channel`, `tv`, …
    #[serde(rename = "type")]
    pub r#type: String,
    /// The catalog's id, or the id of the item being asked about.
    pub id: String,
    /// The values the client chose, in the order they were chosen.
    pub extra: Vec<Extra>,
}

impl ResourceRequest {
    pub fn new(
        resource: impl Into<String>,
        r#type: impl Into<String>,
        id: impl Into<String>,
    ) -> Self {
        Self {
            resource: resource.into(),
            r#type: r#type.into(),
            id: id.into(),
            extra: Vec::new(),
        }
    }

    /// The same, carrying these chosen values.
    pub fn with_extra(mut self, extra: Vec<Extra>) -> Self {
        self.extra = extra;
        self
    }

    /// The URL to ask at, given the Addon's manifest URL.
    ///
    /// The manifest URL *is* the Addon's address: the resource path takes the
    /// place of its `manifest.json` segment. A URL that does not end in one
    /// keeps its own path, so an Addon that serves its manifest elsewhere still
    /// gets asked relative to where it serves it.
    pub fn url(&self, manifest_url: &str) -> String {
        let base = manifest_url
            .strip_suffix("/manifest.json")
            .unwrap_or(manifest_url)
            .trim_end_matches('/');

        let mut url = String::with_capacity(MAX_URL_LEN);
        url.push_str(base);
        url.push('/');
        url.push_str(&component(&self.resource));
        url.push('/');
        url.push_str(&component(&self.r#type));
        url.push('/');
        url.push_str(&component(&self.id));
        if !self.extra.is_empty() {
            url.push('/');
            url.push_str(&extra_segment(&self.extra));
        }
        url.push_str(".json");
        url
    }
}

/// One path component, percent-encoded.
fn component(value: &str) -> String {
    utf8_percent_encode(value, COMPONENT).to_string()
}

/// The `extra` values as the protocol's stringified querystring.
pub fn extra_segment(extra: &[Extra]) -> String {
    extra
        .iter()
        .map(|extra| format!("{}={}", component(&extra.name), component(&extra.value)))
        .collect::<Vec<_>>()
        .join("&")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(resource: &str, r#type: &str, id: &str) -> ResourceRequest {
        ResourceRequest::new(resource, r#type, id)
    }

    fn with(extra: &[(&str, &str)]) -> Vec<Extra> {
        extra.iter().map(|(n, v)| Extra::of(*n, *v)).collect()
    }

    #[test]
    fn a_request_without_a_choice_asks_for_the_resource_where_the_manifest_lives() {
        for (resource, r#type, id, expected) in [
            (
                "catalog",
                "movie",
                "top",
                "https://api.stremboxd.com/catalog/movie/top.json",
            ),
            (
                "meta",
                "series",
                "tt0903747",
                "https://api.stremboxd.com/meta/series/tt0903747.json",
            ),
            (
                "stream",
                "movie",
                "tt0111161",
                "https://api.stremboxd.com/stream/movie/tt0111161.json",
            ),
        ] {
            assert_eq!(
                request(resource, r#type, id).url("https://api.stremboxd.com/manifest.json"),
                expected,
                "a manifest URL is the Addon's address, and the resource path replaces manifest.json"
            );
        }
    }

    #[test]
    fn a_manifest_url_that_is_not_one_still_gets_a_relative_ask() {
        // The Host stores whatever URL answered a manifest. An Addon that serves
        // its manifest somewhere odd is still asked where it answered, not at a
        // manifest.json that was never there.
        for (base, expected) in [
            (
                "https://example.com/addon",
                "https://example.com/addon/catalog/movie/top.json",
            ),
            (
                "https://example.com/addon/",
                "https://example.com/addon/catalog/movie/top.json",
            ),
            (
                "https://example.com",
                "https://example.com/catalog/movie/top.json",
            ),
        ] {
            assert_eq!(
                request("catalog", "movie", "top").url(base),
                expected,
                "asked relative to {base}"
            );
        }
    }

    #[test]
    fn one_chosen_value_becomes_the_protocols_stringified_querystring() {
        assert_eq!(
            request("catalog", "movie", "top")
                .with_extra(with(&[("skip", "100")]))
                .url("https://api.stremboxd.com/manifest.json"),
            "https://api.stremboxd.com/catalog/movie/top/skip=100.json"
        );
    }

    #[test]
    fn more_than_one_chosen_value_is_joined_with_ampersands_in_order() {
        assert_eq!(
            request("catalog", "movie", "top")
                .with_extra(with(&[("genre", "Action"), ("skip", "100")]))
                .url("https://api.stremboxd.com/manifest.json"),
            "https://api.stremboxd.com/catalog/movie/top/genre=Action&skip=100.json"
        );
    }

    #[test]
    fn a_value_that_needs_encoding_is_encoded_rather_than_split_into_two() {
        // The whole point: a `&` inside a value is data, not another parameter,
        // and a `/` inside an id is data, not another path segment.
        for (extra, expected) in [
            (
                vec![("search", "blood & guts")],
                "search=blood%20%26%20guts",
            ),
            (vec![("search", "a=b")], "search=a%3Db"),
            (vec![("search", "café")], "search=caf%C3%A9"),
            (vec![("search", "100%")], "search=100%25"),
            (vec![("search", "a/b")], "search=a%2Fb"),
            (vec![("search", "what?")], "search=what%3F"),
            (vec![("search", "a#b")], "search=a%23b"),
        ] {
            assert_eq!(
                extra_segment(&with(&extra)),
                expected,
                "{extra:?} is one value, not a querystring to be reinterpreted"
            );
        }
    }

    #[test]
    fn the_characters_encode_uri_component_leaves_alone_are_left_alone() {
        // Stremio's own client does not encode these, so an Addon that gets one
        // gets what it would get from Stremio.
        let left_alone = "abcXYZ019-_.!~*'()";
        assert_eq!(component(left_alone), left_alone);
        assert_eq!(
            extra_segment(&with(&[("n", left_alone)])),
            format!("n={left_alone}")
        );
    }

    #[test]
    fn a_path_component_containing_a_slash_stays_one_component() {
        assert_eq!(
            request("catalog", "movie", "a/b").url("https://example.com/manifest.json"),
            "https://example.com/catalog/movie/a%2Fb.json"
        );
        assert_eq!(
            request("catalog", "movi e", "top").url("https://example.com/manifest.json"),
            "https://example.com/catalog/movi%20e/top.json"
        );
    }

    #[test]
    fn a_catalog_is_named_the_way_a_message_would_name_it() {
        assert_eq!(
            CatalogRef::parse("movie", "letterboxd-popular")
                .expect("a catalog a manifest could declare")
                .to_string(),
            "movie/letterboxd-popular"
        );
    }

    #[test]
    fn a_title_is_named_the_way_a_message_would_name_it() {
        assert_eq!(
            TitleRef::parse("series", "tt0903747")
                .expect("a Title a request could name")
                .to_string(),
            "series/tt0903747"
        );
    }

    #[test]
    fn a_title_type_or_id_that_is_not_one_is_refused_and_says_which_it_was() {
        for (r#type, id, which) in [
            ("", "tt0903747", "type"),
            ("series", "", "id"),
            ("ser ies", "tt0903747", "type"),
            ("series", "tt\t0903747", "id"),
            ("series", &"a".repeat(MAX_STRING_LEN + 1), "id"),
        ] {
            assert_eq!(
                TitleRef::parse(r#type, id),
                Err(InvalidTitleRef {
                    which,
                    value: if which == "type" { r#type } else { id }.to_owned(),
                }),
                "{type:?}/{id:?} is not a Title, and the {which} is what is wrong with it"
            );
        }
    }

    #[test]
    fn an_extra_name_that_is_not_a_name_is_refused() {
        for name in [
            "",
            "with space",
            "with\nnewline",
            &"a".repeat(MAX_STRING_LEN + 1),
        ] {
            assert!(
                Extra::parse(name, "value").is_err(),
                "{name:?} is not an extra name"
            );
        }
    }

    #[test]
    fn an_extra_value_longer_than_the_host_will_send_is_refused() {
        assert!(Extra::parse("search", &"a".repeat(MAX_STRING_LEN + 1)).is_err());
        assert!(Extra::parse("search", &"a".repeat(MAX_STRING_LEN)).is_ok());
    }

    #[test]
    fn an_extra_value_may_be_empty_and_may_hold_anything_printable() {
        for value in ["", "a b", "blood & guts", "café", "a/b?c=d#e"] {
            assert_eq!(
                Extra::parse("search", value)
                    .unwrap_or_else(|error| panic!("{value:?} is a value: {error}"))
                    .value,
                value
            );
        }
    }

    #[test]
    fn a_request_read_back_is_the_one_that_was_written() {
        // The Action surface carries requests over the wire, so the shape it
        // publishes is the shape a client can send back.
        let request = request("catalog", "movie", "top").with_extra(with(&[("skip", "100")]));

        let wire = serde_json::to_string(&request).expect("a request serializes");
        assert_eq!(
            wire,
            r#"{"resource":"catalog","type":"movie","id":"top","extra":[{"name":"skip","value":"100"}]}"#
        );
        assert_eq!(
            serde_json::from_str::<ResourceRequest>(&wire).expect("and reads back"),
            request
        );
    }
}
