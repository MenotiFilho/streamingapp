//! Search: TMDB's answer to a query, on its way to the client that asked for it
//! (ADR-0010's amendment, ADR-0020).
//!
//! Search is key-gated. With a TMDB Credential held, a query is TMDB's:
//! [`crate::tmdb::SearchQuery`] is the ask judged, [`crate::tmdb::read_page`]
//! reads the answer into previews keyed `tmdb:<id>`, and what travels to a
//! client is a [`SearchRow`] — the items, how many TMDB put in the page, and why
//! there are none when TMDB did not answer. It is the shape a
//! [`crate::discover::DiscoverRow`] is, because a client draws both with the
//! same card; the [`crate::response::Answer`] variant around it is what tells it
//! that a hit opens as a Discovered Title. Without a credential the Addons'
//! own search catalogs are the whole of Search, and `SearchCatalogs` is
//! unchanged.
//!
//! A row is an answer and never a Snapshot: a search is one client's question
//! (ADR-0005). Nothing here is cached, either — every page hits TMDB — so the
//! row is read from the answer and dropped with it (ADR-0020).

/// One Search page, as the client that asked reads it.
///
/// It is the shape a [`crate::discover::DiscoverRow`] is, not a second row
/// type: a client draws both answers with one card, and the `Answer` variant
/// around the row is what says which question produced it. An alias rather than
/// a copy keeps the two from drifting apart.
pub type SearchRow = crate::discover::DiscoverRow;
