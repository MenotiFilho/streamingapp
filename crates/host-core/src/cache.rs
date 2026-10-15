//! The pages the Host has already fetched.
//!
//! An Addon says how long its own answer stays good for, on the answer itself
//! (`cacheMaxAge`, `staleError` — see [`CacheHints`]), and this is what keeps
//! that promise: a re-request inside the window is answered from here and never
//! reaches the network. Paging through a row, or two clients looking at the same
//! one, would otherwise ask the same Addon for the same hundred posters over and
//! over.
//!
//! In memory only, and deliberately: a page is a fact about what an Addon
//! answered a minute ago, and a Host that has just started has no business
//! showing yesterday's row. The store holds what the Host owns; this holds what
//! somebody else temporarily said.
//!
//! Bounded, because a URL is not: every distinct search is a URL of its own, so
//! an unbounded map would be a slowly growing record of everything the owner
//! looked for.

use std::collections::HashMap;
use std::time::Instant;

use crate::catalog::{CacheHints, MetaPreview};

/// The most pages the Host keeps at once.
///
/// A row is tens of kilobytes and an owner has a handful of Addons; this many
/// pages is more than a session of browsing asks for, and the oldest goes first
/// when it is reached.
const MAX_PAGES: usize = 256;

/// The Host's fetched pages, keyed by the URL they came from.
#[derive(Debug, Default)]
pub(crate) struct CatalogCache {
    pages: HashMap<String, Cached>,
}

#[derive(Debug)]
struct Cached {
    sent: usize,
    metas: Vec<MetaPreview>,
    hints: CacheHints,
    fetched: Instant,
}

/// One kept page, and how many items the Addon put in it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Kept {
    pub(crate) sent: usize,
    pub(crate) metas: Vec<MetaPreview>,
}

impl CatalogCache {
    /// The page for this URL, when the Addon said it is still good.
    pub(crate) fn fresh(&self, url: &str) -> Option<Kept> {
        let cached = self.pages.get(url)?;
        cached
            .hints
            .is_fresh(cached.fetched.elapsed())
            .then(|| cached.kept())
    }

    /// The same, for an Addon that cannot be reached: the page is served when
    /// the Addon said it may be served this long after it stopped being fresh.
    pub(crate) fn when_stale(&self, url: &str) -> Option<Kept> {
        let cached = self.pages.get(url)?;
        cached
            .hints
            .is_servable_when_stale(cached.fetched.elapsed())
            .then(|| cached.kept())
    }

    /// Keep this page, and what the Addon said about how long it lasts.
    pub(crate) fn keep(
        &mut self,
        url: &str,
        sent: usize,
        metas: Vec<MetaPreview>,
        hints: CacheHints,
    ) {
        if self.pages.len() >= MAX_PAGES && !self.pages.contains_key(url) {
            self.evict_oldest();
        }
        self.pages.insert(
            url.to_owned(),
            Cached {
                sent,
                metas,
                hints,
                fetched: Instant::now(),
            },
        );
    }

    /// Drop the page that was fetched longest ago, so the bound holds.
    fn evict_oldest(&mut self) {
        let oldest = self
            .pages
            .iter()
            .min_by_key(|(_, cached)| cached.fetched)
            .map(|(url, _)| url.clone());
        if let Some(oldest) = oldest {
            self.pages.remove(&oldest);
        }
    }
}

impl Cached {
    fn kept(&self) -> Kept {
        Kept {
            sent: self.sent,
            metas: self.metas.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    const URL: &str = "https://example.com/catalog/movie/top.json";

    /// A page fetched `age` ago, so the policy can be tested without waiting for
    /// it to come true.
    fn cached(age: Duration, hints: CacheHints) -> CatalogCache {
        let mut cache = CatalogCache::default();
        cache.keep(URL, 1, vec![meta()], hints);
        cache
            .pages
            .get_mut(URL)
            .expect("the page was just kept")
            .fetched = Instant::now()
            .checked_sub(age)
            .expect("the test does not ask for an age before the clock started");
        cache
    }

    fn meta() -> MetaPreview {
        MetaPreview {
            id: "tt0133093".to_owned(),
            r#type: "movie".to_owned(),
            name: "The Matrix".to_owned(),
            poster: None,
            poster_shape: None,
            release_info: None,
            imdb_rating: None,
            genres: Vec::new(),
            description: None,
        }
    }

    fn hints(cache_max_age: u64, stale_error: u64) -> CacheHints {
        CacheHints {
            cache_max_age: Some(cache_max_age),
            stale_error: Some(stale_error),
            ..CacheHints::default()
        }
    }

    fn kept() -> Kept {
        Kept {
            sent: 1,
            metas: vec![meta()],
        }
    }

    #[test]
    fn a_page_kept_inside_the_window_it_was_given_is_served_without_asking_again() {
        let cache = cached(Duration::from_secs(10), hints(3600, 600));

        assert_eq!(cache.fresh(URL), Some(kept()));
    }

    #[test]
    fn a_page_past_its_window_is_not_served_as_fresh() {
        let cache = cached(Duration::from_secs(3600), hints(3600, 600));

        assert_eq!(cache.fresh(URL), None);
    }

    #[test]
    fn a_page_the_addon_said_may_outlive_itself_is_served_when_the_addon_fails() {
        let cache = cached(Duration::from_secs(4000), hints(3600, 600));

        assert_eq!(cache.fresh(URL), None);
        assert_eq!(cache.when_stale(URL), Some(kept()));
    }

    #[test]
    fn a_page_past_even_the_stale_window_is_not_served_at_all() {
        let cache = cached(Duration::from_secs(4200), hints(3600, 600));

        assert_eq!(cache.when_stale(URL), None);
    }

    #[test]
    fn an_addon_that_said_nothing_about_caching_has_its_page_asked_for_again() {
        let cache = cached(Duration::from_secs(0), CacheHints::default());

        assert_eq!(cache.fresh(URL), None);
        assert_eq!(cache.when_stale(URL), None);
    }

    #[test]
    fn a_url_the_host_has_never_asked_is_not_in_the_cache() {
        let cache = CatalogCache::default();

        assert_eq!(cache.fresh(URL), None);
        assert_eq!(cache.when_stale(URL), None);
    }

    #[test]
    fn a_kept_page_remembers_how_many_items_the_addon_sent() {
        // The items this Host could not read are gone, but the Addon sent them:
        // a client paging on has to count them, or the next page starts short.
        let mut cache = CatalogCache::default();
        cache.keep(URL, 100, vec![meta()], hints(3600, 0));

        assert_eq!(cache.fresh(URL).map(|kept| kept.sent), Some(100));
    }

    #[test]
    fn asking_for_a_page_again_replaces_what_was_kept_for_it() {
        let mut cache = CatalogCache::default();
        cache.keep(URL, 1, Vec::new(), hints(3600, 0));
        let mut newer = meta();
        newer.name = "The Matrix Reloaded".to_owned();

        cache.keep(URL, 1, vec![newer.clone()], hints(3600, 0));

        assert_eq!(cache.fresh(URL).map(|kept| kept.metas), Some(vec![newer]));
    }

    #[test]
    fn the_cache_does_not_grow_without_bound() {
        // Every distinct search is a URL of its own, so an unbounded map would
        // be a record of everything the owner ever looked for.
        let mut cache = CatalogCache::default();
        for index in 0..(MAX_PAGES + 10) {
            cache.keep(
                &format!("https://example.com/catalog/movie/top/search=query{index}.json"),
                1,
                vec![meta()],
                hints(3600, 0),
            );
        }

        assert_eq!(cache.pages.len(), MAX_PAGES);
        assert_eq!(
            cache.fresh("https://example.com/catalog/movie/top/search=query0.json"),
            None,
            "the page fetched longest ago is the one that goes first"
        );
        assert!(
            cache
                .fresh(&format!(
                    "https://example.com/catalog/movie/top/search=query{}.json",
                    MAX_PAGES + 9
                ))
                .is_some(),
            "and the one fetched last is still here"
        );
    }
}
