//! Discover: the one feed of Titles that is not an Addon's, on its way to the
//! client that asked for it (CONTEXT.md, *Discover*; ADR-0020).
//!
//! A Discover page is TMDB's: [`crate::tmdb::DiscoverQuery`] is the ask judged,
//! [`crate::tmdb::read_page`] reads the answer into previews keyed `tmdb:<id>`,
//! and what travels to a client is a [`DiscoverRow`] — the items, how many TMDB
//! put in the page, and why there are none when TMDB did not answer. It is
//! `CatalogRow` minus the Addon, because there is no Addon: a client draws both
//! kinds of row with the same card, and the [`crate::response::Answer`] variant
//! around the row is what tells it that opening one goes the Discovered Title
//! way rather than `open_title`.
//!
//! A row is an answer and never a Snapshot: a feed is one client's browse
//! (ADR-0005). Nothing here is cached, either — every page hits TMDB — so the
//! row is read from the answer and dropped with it (ADR-0020).

use serde::Serialize;

use crate::action::ActionError;
use crate::catalog::MetaPreview;

/// One Discover page, as the client that asked reads it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverRow {
    /// The kind the page was asked for, in the protocol's spelling: every item
    /// in it is this kind, and it is what a client switches its grid on.
    #[serde(rename = "type")]
    pub r#type: String,
    /// How many items TMDB put in the page, including any this Host could not
    /// read. A client pages on by its own page number rather than by this, but
    /// a row that held two of a hundred items and said nothing would be a lie.
    pub sent: usize,
    /// The items, in TMDB's own order, each keyed `tmdb:<id>`.
    pub metas: Vec<MetaPreview>,
    /// Set when TMDB did not answer — a rate limit, an outage, a body that is
    /// not a page — in the Host's vocabulary. The row is then empty and this is
    /// why: a failed call is a row carrying a failure, never a retry, a block
    /// or a screen-level error (ADR-0020).
    pub failure: Option<ActionError>,
}
