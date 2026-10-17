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
use crate::meta::Title;
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
}

/// Something only the client that asked is owed.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Answer {
    /// The catalog rows a client asked to see, one per catalog asked about.
    Catalogs(Vec<CatalogRow>),
    /// The Title a client asked to open, with the Videos it can be watched as.
    /// Boxed because a Title is many fields and a `Vec` of rows is three words.
    Title(Box<Title>),
    /// The Streams a Video can be played as: one group per Addon that answered
    /// the `stream` request, in the configured order.
    Streams(Vec<AddonStreams>),
    /// The token a pairing was just issued, and the device it belongs to. The one
    /// answer that carries something a client holds rather than something it
    /// reads: it goes to the device that redeemed the code and to nobody else,
    /// and no Snapshot has a field it could occupy.
    Paired {
        device: DeviceSummary,
        token: DeviceToken,
    },
}
