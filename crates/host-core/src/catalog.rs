//! A catalog response, in the Host's own words.
//!
//! The response is third-party input and arrives in a shape the Host does not
//! control, so the parse is a pure decision like the manifest's: a body that is
//! not a catalog is refused with a typed reason, and — because a page of a
//! hundred items is not all-or-nothing — an item that lies is *dropped* rather
//! than allowed to blank the row around it (Stremio's own client skips them too).
//!
//! Two things ride along with the items that are easy to miss: the Addon's own
//! cache hints (`cacheMaxAge`, `staleRevalidate`, `staleError`), which the SDK
//! puts on the *response object* rather than in the manifest, and fields this
//! Host has no use for, which real Addons send in numbers — Cinemeta's pages
//! carry `hasMore`, `query` and `rank`, and its items carry `imdb_id`, `slug`,
//! `popularities` and more.

use serde::{Deserialize, Serialize};

use crate::action::ActionError;
use crate::addon::{AddonId, MAX_ITEMS, MAX_STRING_LEN};

/// The most of a catalog body the Host will read.
///
/// A page of a hundred poster records is tens of kilobytes; an Addon answering
/// with megabytes is misbehaving or lying.
pub const MAX_CATALOG_BYTES: usize = 4 * 1024 * 1024;

/// One item in a catalog row, as the Host needs it to draw a card.
///
/// A *preview*: the protocol's shorter Meta shape, which is what a catalog
/// returns. Fields the Host has no use for yet — `background`, `logo`, `links`,
/// `trailers`, `behaviorHints`, `videos` — are ignored rather than refused.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetaPreview {
    pub id: String,
    #[serde(rename = "type")]
    pub r#type: String,
    pub name: String,
    /// The poster's address. The protocol calls it required, but an Addon that
    /// omits one is not worth dropping an item over: the card shows a name.
    pub poster: Option<String>,
    /// `poster`, `square` or `landscape`; the protocol assumes `poster`.
    pub poster_shape: Option<String>,
    /// The year, or a series' years: `1999`, `2008-2013`, `2020-`.
    pub release_info: Option<String>,
    pub imdb_rating: Option<String>,
    pub genres: Vec<String>,
    pub description: Option<String>,
}

/// How long an Addon says an answer stays good for.
///
/// All three are seconds and all three are optional. They are the SDK's own
/// names, read from the *response body*: `cacheMaxAge` is how long an answer is
/// fresh, `staleRevalidate` how long it may be served while it is revalidated,
/// and `staleError` how long it may be served when the Addon is failing.
///
/// `staleRevalidate` is carried and not yet acted on: honouring it means
/// answering from the cache and revalidating behind the client's back, which a
/// synchronous Host has nowhere to put. Only `cacheMaxAge` and `staleError` are
/// decisions the Host makes today (ADR-0010).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CacheHints {
    pub cache_max_age: Option<u64>,
    pub stale_revalidate: Option<u64>,
    pub stale_error: Option<u64>,
}

impl CacheHints {
    /// Whether an answer fetched `age` ago is still fresh.
    ///
    /// No hint, or `0`, means "do not keep it": the Addon said nothing about how
    /// long the answer stays good for, and guessing on its behalf is how a
    /// client ends up showing the owner a stale row.
    pub fn is_fresh(&self, age: std::time::Duration) -> bool {
        self.cache_max_age
            .is_some_and(|seconds| age < std::time::Duration::from_secs(seconds))
    }

    /// Whether an answer fetched `age` ago may still be served when the Addon
    /// cannot be reached — the freshness lifetime `staleError` extends.
    pub fn is_servable_when_stale(&self, age: std::time::Duration) -> bool {
        self.stale_error.is_some_and(|seconds| {
            let keep = self.cache_max_age.unwrap_or(0).saturating_add(seconds);
            age < std::time::Duration::from_secs(keep)
        })
    }
}

/// One page of a catalog, as the Addon served it.
///
/// `sent` is how many items the Addon put in the page, which is not the same as
/// how many the Host could read: `metas` is what is left after dropping the
/// items that could not be read. A client pages on by `sent`, not by what it
/// holds, or a page with one bad item in it would make the next page start one
/// item too early.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Page {
    pub sent: usize,
    pub metas: Vec<MetaPreview>,
    pub hints: CacheHints,
}

/// Why a catalog response was not read, in the Host's own vocabulary.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum CatalogError {
    #[error("that is not a catalog: {detail}")]
    NotJson { detail: String },
    #[error("the catalog is missing {field}")]
    Missing { field: String },
    #[error("{field} should be {expected}")]
    WrongType {
        field: String,
        expected: &'static str,
    },
    #[error("{field} is longer than this Host will hold ({limit})")]
    TooLarge { field: String, limit: usize },
}

impl Page {
    /// Read a catalog response into the Host's vocabulary.
    ///
    /// Pure: no I/O, no state, and a refusal is just a value. Items that cannot
    /// be read at all are dropped, so one bad record does not blank the row —
    /// but a body that is not a catalog is a refusal, because that is a fact
    /// about the Addon rather than about one item.
    pub fn parse(body: &str) -> Result<Self, CatalogError> {
        if body.len() > MAX_CATALOG_BYTES {
            return Err(CatalogError::TooLarge {
                field: "the catalog".to_owned(),
                limit: MAX_CATALOG_BYTES,
            });
        }

        let value: serde_json::Value =
            serde_json::from_str(body).map_err(|error| CatalogError::NotJson {
                detail: error.to_string(),
            })?;
        let object = value.as_object().ok_or_else(|| CatalogError::NotJson {
            detail: "a catalog response is a JSON object".to_owned(),
        })?;

        let metas = object
            .get("metas")
            .ok_or_else(|| CatalogError::Missing {
                field: "metas".to_owned(),
            })?
            .as_array()
            .ok_or_else(|| CatalogError::WrongType {
                field: "metas".to_owned(),
                expected: "an array",
            })?;
        if metas.len() > MAX_ITEMS {
            return Err(CatalogError::TooLarge {
                field: "metas".to_owned(),
                limit: MAX_ITEMS,
            });
        }

        Ok(Self {
            sent: metas.len(),
            metas: metas.iter().filter_map(meta_preview).collect(),
            hints: CacheHints {
                cache_max_age: hint(object, "cacheMaxAge"),
                stale_revalidate: hint(object, "staleRevalidate"),
                stale_error: hint(object, "staleError"),
            },
        })
    }
}

/// One item, or nothing when it cannot be read as one.
///
/// An item that is not an object, or that is missing an id, a type or a name,
/// or that carries one of them as something other than a non-empty string, is
/// dropped rather than refused: it is one record out of a page, and the Addon
/// is not asked to be perfect about the rest.
fn meta_preview(value: &serde_json::Value) -> Option<MetaPreview> {
    let object = value.as_object()?;
    Some(MetaPreview {
        id: non_empty_string(object.get("id")?)?,
        r#type: non_empty_string(object.get("type")?)?,
        name: non_empty_string(object.get("name")?)?,
        poster: object.get("poster").and_then(non_empty_string),
        poster_shape: object.get("posterShape").and_then(non_empty_string),
        release_info: object.get("releaseInfo").and_then(non_empty_string),
        imdb_rating: object.get("imdbRating").and_then(non_empty_string),
        // A genre list that is not a list of strings is ignored rather than
        // dropping an item whose name and poster are perfectly good.
        genres: object
            .get("genres")
            .and_then(|value| {
                value
                    .as_array()?
                    .iter()
                    .map(non_empty_string)
                    .collect::<Option<Vec<String>>>()
            })
            .unwrap_or_default(),
        description: object.get("description").and_then(non_empty_string),
    })
}

/// A non-empty string of a length the Host will hold, or nothing.
fn non_empty_string(value: &serde_json::Value) -> Option<String> {
    let text = value.as_str()?;
    if text.is_empty() || text.len() > MAX_STRING_LEN {
        return None;
    }
    Some(text.to_owned())
}

/// One cache hint, when the Addon sent a number for it.
fn hint(object: &serde_json::Map<String, serde_json::Value>, name: &str) -> Option<u64> {
    object.get(name).and_then(serde_json::Value::as_u64)
}

/// One catalog's answer, on its way to the client that asked for it.
///
/// The Addon and the catalog travel with it, because a search asks several
/// Addons at once and the answer has to say which is which (ADR-0005 — a
/// client's browsing is its own, so a row travels as an answer and never as a
/// Snapshot).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogRow {
    pub addon: AddonId,
    #[serde(rename = "type")]
    pub r#type: String,
    pub id: String,
    /// The catalog's own name, as the Addon published it.
    pub name: String,
    /// How many items the Addon put in this page, including any this Host could
    /// not read. A client pages on by this, not by what it holds.
    pub sent: usize,
    /// The items, in the Addon's own order.
    pub metas: Vec<MetaPreview>,
    /// Set when the Addon did not answer: the row is then empty and this says
    /// why, in the Host's vocabulary, so one Addon's failure does not blank
    /// another's results.
    pub failure: Option<ActionError>,
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOP: &str = include_str!("../tests/fixtures/cinemeta-catalog-movie-top.json");
    const SEARCH: &str = include_str!("../tests/fixtures/cinemeta-search-movie-top.json");
    const STREMBOXD: &str =
        include_str!("../tests/fixtures/stremboxd-catalog-letterboxd-popular.json");
    const BAD_ITEM: &str = include_str!("../tests/fixtures/catalog-with-a-bad-item.json");

    fn parsed(body: &str) -> Page {
        Page::parse(body).unwrap_or_else(|error| panic!("{body} should parse: {error}"))
    }

    fn refused(body: &str) -> CatalogError {
        match Page::parse(body) {
            Ok(page) => panic!("{body} should be refused, but parsed as {page:?}"),
            Err(error) => error,
        }
    }

    #[test]
    fn a_recorded_catalog_is_read_into_items_in_the_addons_own_order() {
        let page = parsed(TOP);

        assert_eq!(page.metas.len(), 8);
        let first = &page.metas[0];
        assert_eq!(first.id, "tt22084616");
        assert_eq!(first.r#type, "movie");
        assert_eq!(first.name, "Spider-Man: Brand New Day");
        assert!(
            first
                .poster
                .as_deref()
                .is_some_and(|poster| poster.starts_with("https://")),
            "a card needs a poster: {:?}",
            first.poster
        );
        assert_eq!(first.release_info.as_deref(), Some("2026"));
        assert!(
            !first.genres.is_empty(),
            "genres come through: {:?}",
            first.genres
        );
        assert_ne!(
            page.metas[0].id, page.metas[1].id,
            "the order is the Addon's, and an item is not reordered or dropped"
        );
    }

    #[test]
    fn a_recorded_search_response_is_read_the_same_way() {
        let page = parsed(SEARCH);

        assert_eq!(page.metas.len(), 8);
        assert!(
            page.metas.iter().any(|meta| meta.name == "The Matrix"),
            "the search the Addon ran is the one that comes back: {:?}",
            page.metas.iter().map(|meta| &meta.name).collect::<Vec<_>>()
        );
    }

    #[test]
    fn a_recorded_catalog_that_says_nothing_about_caching_parses_too() {
        let page = parsed(STREMBOXD);

        assert_eq!(page.metas.len(), 8);
        assert_eq!(page.hints, CacheHints::default());
    }

    #[test]
    fn the_addons_cache_hints_are_read_from_the_response() {
        // They ride on the response object, not in the manifest — which is how
        // the SDK really serves them, and what ADR-0010 corrects.
        let page = parsed(TOP);

        assert_eq!(page.hints.cache_max_age, Some(14400));
        assert_eq!(page.hints.stale_revalidate, Some(3600));
        assert_eq!(page.hints.stale_error, Some(3600));
    }

    #[test]
    fn an_addon_that_says_nothing_about_caching_is_not_kept_for_anything() {
        let hints = CacheHints::default();

        assert!(!hints.is_fresh(std::time::Duration::from_secs(0)));
        assert!(!hints.is_fresh(std::time::Duration::from_secs(86_400)));
    }

    #[test]
    fn a_hint_is_fresh_inside_its_own_window_and_not_after_it() {
        let hints = CacheHints {
            cache_max_age: Some(3600),
            stale_revalidate: Some(60),
            stale_error: Some(600),
        };

        assert!(hints.is_fresh(std::time::Duration::from_secs(0)));
        assert!(hints.is_fresh(std::time::Duration::from_secs(3599)));
        assert!(
            !hints.is_fresh(std::time::Duration::from_secs(3600)),
            "the window runs up to the second, not including it"
        );
        assert!(!hints.is_fresh(std::time::Duration::from_secs(3601)));
    }

    #[test]
    fn stale_error_extends_how_long_an_answer_may_be_served_when_the_addon_fails() {
        let hints = CacheHints {
            cache_max_age: Some(3600),
            stale_error: Some(600),
            ..CacheHints::default()
        };

        assert!(hints.is_servable_when_stale(std::time::Duration::from_secs(4000)));
        assert!(
            !hints.is_servable_when_stale(std::time::Duration::from_secs(4200)),
            "the stale window is the freshness one, extended by staleError"
        );
    }

    #[test]
    fn an_addon_that_says_nothing_about_errors_has_nothing_to_serve_when_it_fails() {
        let hints = CacheHints {
            cache_max_age: Some(3600),
            ..CacheHints::default()
        };

        assert!(!hints.is_servable_when_stale(std::time::Duration::from_secs(1)));
    }

    #[test]
    fn an_item_that_lies_is_dropped_rather_than_blanking_the_row() {
        let page = parsed(BAD_ITEM);

        assert_eq!(
            page.metas
                .iter()
                .map(|meta| meta.name.as_str())
                .collect::<Vec<_>>(),
            vec!["The Matrix", "Paprika"],
            "the two items that read survive the one that does not"
        );
    }

    #[test]
    fn a_body_that_is_not_a_catalog_is_refused() {
        for body in [
            "",
            "not json at all",
            "<html>hello</html>",
            "[]",
            "\"a catalog\"",
            "5",
            "null",
        ] {
            assert!(
                matches!(refused(body), CatalogError::NotJson { .. }),
                "{body:?} is not a catalog"
            );
        }
    }

    #[test]
    fn a_response_without_metas_is_refused_rather_than_read_as_an_empty_row() {
        assert_eq!(
            refused(r#"{"hasMore":true,"cacheMaxAge":600}"#),
            CatalogError::Missing {
                field: "metas".to_owned()
            },
            "an answer with no items at all is not a row this Host invents"
        );
    }

    #[test]
    fn a_response_whose_metas_are_not_a_list_is_refused() {
        for body in [r#"{"metas":"The Matrix"}"#, r#"{"metas":null}"#] {
            assert_eq!(
                refused(body),
                CatalogError::WrongType {
                    field: "metas".to_owned(),
                    expected: "an array",
                },
                "in {body}, metas is not a list"
            );
        }
    }

    #[test]
    fn a_page_longer_than_the_host_holds_is_refused() {
        let body = serde_json::json!({
            "metas": vec![
                serde_json::json!({ "id": "tt1", "type": "movie", "name": "One" });
                MAX_ITEMS + 1
            ],
        })
        .to_string();

        assert_eq!(
            refused(&body),
            CatalogError::TooLarge {
                field: "metas".to_owned(),
                limit: MAX_ITEMS,
            }
        );
    }

    #[test]
    fn a_body_longer_than_the_host_holds_is_refused_before_it_is_parsed() {
        let body = format!("{} {{", " ".repeat(MAX_CATALOG_BYTES));

        assert_eq!(
            refused(&body),
            CatalogError::TooLarge {
                field: "the catalog".to_owned(),
                limit: MAX_CATALOG_BYTES,
            }
        );
    }

    #[test]
    fn fields_this_host_has_no_use_for_are_ignored_rather_than_refused() {
        // Real Addons send more than this Host reads: Cinemeta's pages carry
        // `hasMore`, `query` and `rank`, and its items carry `imdb_id`, `slug`
        // and `popularities`. An Addon that knows more than the Host does still
        // works, and the fields the Host does read still arrive.
        let page = parsed(SEARCH);
        let matrix = page
            .metas
            .iter()
            .find(|meta| meta.name == "The Matrix")
            .expect("the recorded search has The Matrix in it");

        assert_eq!(matrix.id, "tt0133093");
        assert_eq!(matrix.release_info.as_deref(), Some("1999"));
        assert!(page.metas.iter().all(|meta| !meta.name.is_empty()));
    }

    #[test]
    fn a_cache_hint_that_is_not_a_number_is_read_as_absent_rather_than_refused() {
        let page = parsed(r#"{"metas":[],"cacheMaxAge":"an hour","staleError":false}"#);

        assert_eq!(page.hints, CacheHints::default());
    }

    #[test]
    fn a_hint_of_zero_means_do_not_keep_it_rather_than_keep_it_forever() {
        let page = parsed(r#"{"metas":[],"cacheMaxAge":0}"#);

        assert_eq!(page.hints.cache_max_age, Some(0));
        assert!(!page.hints.is_fresh(std::time::Duration::from_secs(0)));
    }
}
