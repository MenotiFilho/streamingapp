//! What taking an Action produced.
//!
//! Every Action goes in through one door and comes out as a [`Response`], so
//! that the window, and the remote client a later ticket adds, are the same
//! client twice (ADR-0002). A response carries two different things, and the
//! difference matters:
//!
//! - [`Snapshot`]s, which are state and go to *every* client — what is playing,
//!   what is on the Continue watching row, which Addons are configured.
//! - An [`Answer`], which is what the client that asked is owed and nobody else.
//!   Browsing is a client's own business (ADR-0005): what one client is looking
//!   at must not move what another one is looking at, so a catalog row can never
//!   travel as a Snapshot and there is no field in one it could occupy.

use serde::Serialize;

use crate::catalog::CatalogRow;
use crate::device::{DeviceSummary, DeviceToken};
use crate::discover::DiscoverRow;
use crate::library::Library;
use crate::meta::Title;
use crate::search::SearchRow;
use crate::snapshot::Snapshot;
use crate::stream::AddonStreams;

/// What taking an Action produced: what every client is owed, and what the one
/// that asked is owed on its own.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Response {
    /// The Snapshots published, in order. Empty when the Action changed nothing
    /// a client can see.
    pub snapshots: Vec<Snapshot>,
    /// The answer, when the Action was a question.
    pub answer: Option<Answer>,
}

impl Response {
    /// The response to an Action that changed something *and* answered: pairing
    /// is the one of those, because the token goes to the device that asked while
    /// the device joining the list is state every client sees.
    pub(crate) fn changed(snapshots: Vec<Snapshot>, answer: Option<Answer>) -> Self {
        Self { snapshots, answer }
    }

    /// The response to an Action that only asked something.
    pub(crate) fn answered(answer: Answer) -> Self {
        Self {
            snapshots: Vec::new(),
            answer: Some(answer),
        }
    }

    /// The catalog rows a client asked to see, when that is what it asked.
    pub fn catalogs(&self) -> Option<&[CatalogRow]> {
        match &self.answer {
            Some(Answer::Catalogs(rows)) => Some(rows),
            _ => None,
        }
    }

    /// The Discover rows a client asked to see, when that is what it asked.
    pub fn discover(&self) -> Option<&[DiscoverRow]> {
        match &self.answer {
            Some(Answer::Discover(rows)) => Some(rows),
            _ => None,
        }
    }

    /// The Search row a client asked for, when that is what it asked: one page
    /// of one kind, in TMDB's own order.
    pub fn search(&self) -> Option<&SearchRow> {
        match &self.answer {
            Some(Answer::Search(row)) => Some(row),
            _ => None,
        }
    }

    /// The Title a client asked to open, when that is what it asked.
    pub fn title(&self) -> Option<&Title> {
        match &self.answer {
            Some(Answer::Title(title)) => Some(title),
            _ => None,
        }
    }

    /// The Streams a client asked to see, when that is what it asked: one
    /// group per Addon that answered for the Video, in the configured order.
    pub fn streams(&self) -> Option<&[AddonStreams]> {
        match &self.answer {
            Some(Answer::Streams(groups)) => Some(groups),
            _ => None,
        }
    }

    /// The still a client asked for, when that is what it asked: the moment it
    /// named, and the image where the Host had one.
    pub fn preview(&self) -> Option<(f64, Option<&str>)> {
        match &self.answer {
            Some(Answer::Preview { at, image }) => Some((*at, image.as_deref())),
            _ => None,
        }
    }

    /// The account Library a client asked to read, when that is what it asked
    /// (#165, ADR-0029). The failure, where there is one, travels inside it: an
    /// expired session is not an empty Library.
    pub fn library(&self) -> Option<&Library> {
        match &self.answer {
            Some(Answer::Library(library)) => Some(library),
            _ => None,
        }
    }
}

/// Something only the client that asked is owed.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Answer {
    /// The catalog rows a client asked to see, one per catalog asked about.
    Catalogs(Vec<CatalogRow>),
    /// The one feed that is not an Addon's: TMDB's page of Discovered Titles,
    /// its items keyed `tmdb:<id>` (ADR-0020). The variant is what tells a
    /// client that opening a card goes the Discovered Title way.
    Discover(Vec<DiscoverRow>),
    /// One page of TMDB's answer to a query, its items keyed `tmdb:<id>`
    /// (ADR-0010's amendment). The variant is what tells a client that a hit
    /// opens as a Discovered Title rather than through an Addon.
    Search(SearchRow),
    /// The Title a client asked to open, with the Videos it can be watched as.
    /// Boxed because a Title is many fields and a `Vec` of rows is three words.
    Title(Box<Title>),
    /// The Streams a Video can be played as: one group per Addon that answered
    /// the `stream` request, in the configured order.
    Streams(Vec<AddonStreams>),
    /// The still of one moment of the Stream playing, for a timeline tooltip
    /// (ADR-0028). `at` is the moment the client asked about, echoed so a client
    /// that coalesces its asks knows which one this answers; `image` is a JPEG in
    /// a `data:` URL, or nothing where the Host could not take one — a preview is
    /// decoration, and its absence is drawn as absence rather than as a failure.
    Preview {
        /// The moment asked about, in seconds from the Stream's start.
        at: f64,
        /// The still, as a `data:image/jpeg` URL, where there is one.
        image: Option<String>,
    },
    /// The owner's Stremio account Library, read for the room (#165,
    /// ADR-0029): its rows in `_mtime` order, and the failure that says an empty
    /// answer is not an empty Library.
    Library(Library),
    /// The token a pairing was just issued, and the device it belongs to. The one
    /// answer that carries something a client holds rather than something it
    /// reads: it goes to the device that redeemed the code and to nobody else,
    /// and no Snapshot has a field it could occupy.
    Paired {
        device: DeviceSummary,
        token: DeviceToken,
    },
}
