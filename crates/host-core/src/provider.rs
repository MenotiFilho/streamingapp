//! The Host's seam for turning a Video into playable candidates.
//!
//! Finding a Stream is a question, and this is the door the Host asks it
//! through. Today the only kind of source the Host has is a configured Addon,
//! so [`AddonProvider`] is the implementation: one Addon's `stream` answer,
//! fetched through the Host's one [`Fetcher`] and read into the Host’s own
//! [`Stream`]s. A test hands in [`FixtureProvider`] instead, which is what lets
//! the Host's rules — whose answer is whose, what one failure does to the
//! others — be driven without a fetch per Addon. A source that is not an Addon
//! (a direct integration, the day there is one) arrives as another answerer
//! asked beside this one, with the `Stream`s, the answer and every client
//! unchanged above it; what identifies such a source is a question for the
//! ticket that brings one.
//!
//! The seam speaks in [`Stream`]s, not in addon objects, and that is the point
//! of it. An addon `stream` object has raw fields and implicitly claims that
//! everything it lists can be played; a `Stream` says where the bytes are *and
//! whether this Host can open them* — a direct URL, or an `infoHash` that is
//! listed and marked unplayable until something turns it into bytes. A
//! candidate that is not playable yet is expressible here, so what can be
//! played can change without the list, the answer or any client changing
//! shape.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::action::ActionError;
use crate::addon::Addon;
use crate::fetcher::Fetcher;
use crate::request::ResourceRequest;
use crate::stream::Stream;

/// The Host's way of asking one configured Addon for a Video's Streams, and
/// reading what it answers.
///
/// One implementation is the addon protocol ([`AddonProvider`], over the
/// Host's [`Fetcher`]); tests drive a fixture-backed fake, which is what makes
/// the Host's own rules — whose answer is whose, what one Addon's failure does
/// to the others, and that the Addon's order is the order — testable without a
/// fetch per Addon.
///
/// The seam is per Addon because every stream-capable Addon that answers is
/// asked at once, and each answer has to stay separable: one Addon being down
/// is one group that says so, not a question that fails (ADR-0010).
pub trait Provider: Send + Sync + 'static {
    /// The candidates one Addon offers for one Video, in the Addon's own order
    /// — or the failure that says why it offered none.
    ///
    /// `requested` is the `stream` request the Host has already judged this
    /// Addon against with `Manifest::answers`, so the thing asked for is the
    /// thing the Addon said yes to; a Provider is not where "is this id
    /// yours" is decided.
    fn streams(
        &self,
        addon: &Addon,
        requested: &ResourceRequest,
    ) -> Result<Vec<Stream>, ActionError>;
}

/// The Stremio addon protocol as a [`Provider`].
///
/// It fetches the request at the URL the Addon's manifest URL gives it, and
/// reads the body into the Host's Streams. Nothing about which Addons exist,
/// or which of them answers for an id, lives here: the Host decides that
/// before a Provider is ever asked (ADR-0010).
pub struct AddonProvider {
    fetcher: Arc<dyn Fetcher>,
}

impl AddonProvider {
    pub fn new(fetcher: Arc<dyn Fetcher>) -> Self {
        Self { fetcher }
    }
}

impl Provider for AddonProvider {
    fn streams(
        &self,
        addon: &Addon,
        requested: &ResourceRequest,
    ) -> Result<Vec<Stream>, ActionError> {
        let url = requested.url(addon.manifest_url().as_str());
        let body = self
            .fetcher
            .fetch(&url)
            .map_err(|error| ActionError::Fetch {
                detail: error.to_string(),
            })?;

        Stream::parse(&body).map_err(|error| ActionError::Stream {
            detail: error.to_string(),
        })
    }
}

/// A [`Provider`] that answers from recorded candidates, and refuses to answer
/// from anywhere else.
///
/// The fake the seam is tested against: a Host test drives its own rules —
/// which Addons are asked, whose answer is whose, what one Addon's failure does
/// to the others — without recording a fetch for every ask. A Provider that was
/// not told what an Addon answers panics, the way [`crate::FixtureFetcher`]
/// panics at an unrecorded URL, so an unintended ask is a failure rather than
/// an empty group.
#[derive(Debug, Default)]
pub struct FixtureProvider {
    answers: Mutex<HashMap<String, Result<Vec<Stream>, ActionError>>>,
    /// Every Addon this provider was asked about, in order.
    asked: Mutex<Vec<String>>,
}

impl FixtureProvider {
    pub fn new() -> Self {
        Self::default()
    }

    /// Serve these `streams` for the Addon with this id.
    pub fn offering(self, addon: &str, streams: Vec<Stream>) -> Self {
        self.answering(addon, Ok(streams))
    }

    /// Serve `error` for the Addon with this id, for the paths where it is down
    /// or angry.
    pub fn failing(self, addon: &str, error: ActionError) -> Self {
        self.answering(addon, Err(error))
    }

    /// Every Addon this provider was asked about, in order — for the tests that
    /// care which Addons were asked and which were left alone.
    pub fn asked(&self) -> Vec<String> {
        self.asked
            .lock()
            .expect("the fixture provider is not poisoned")
            .clone()
    }

    fn answering(mut self, addon: &str, answer: Result<Vec<Stream>, ActionError>) -> Self {
        self.answers
            .get_mut()
            .expect("the fixture provider is not poisoned")
            .insert(addon.to_owned(), answer);
        self
    }
}

impl Provider for FixtureProvider {
    fn streams(
        &self,
        addon: &Addon,
        _requested: &ResourceRequest,
    ) -> Result<Vec<Stream>, ActionError> {
        self.asked
            .lock()
            .expect("the fixture provider is not poisoned")
            .push(addon.id().as_str().to_owned());

        match self
            .answers
            .lock()
            .expect("the fixture provider is not poisoned")
            .get(addon.id().as_str())
        {
            Some(answer) => answer.clone(),
            None => panic!(
                "the fixture provider was not told what {} answers",
                addon.id()
            ),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stream::Playback;

    fn candidate(name: &str) -> Stream {
        Stream {
            name: Some(name.to_owned()),
            description: None,
            playback: Playback::Direct {
                url: "https://example.org/x.mkv".to_owned(),
            },
            warnings: Vec::new(),
            filename: None,
            binge_group: None,
        }
    }

    fn addon(id: &str) -> Addon {
        let manifest = crate::Manifest::parse(&format!(
            r#"{{"id":"{id}","name":"Example","version":"1.0.0","resources":["stream"],"types":["movie"],"catalogs":[]}}"#
        ))
        .expect("a manifest a fixture provider is asked with parses");
        Addon::new(
            crate::ManifestUrl::parse("https://example.org/manifest.json").expect("a manifest URL"),
            manifest,
        )
    }

    #[test]
    fn a_recorded_addon_is_served_its_candidates() {
        let provider = FixtureProvider::new().offering("community.example", vec![candidate("one")]);
        let requested = ResourceRequest::new("stream", "movie", "tt1");

        let streams = provider
            .streams(&addon("community.example"), &requested)
            .expect("a recorded Addon answers");
        assert_eq!(streams.len(), 1);
        assert_eq!(streams[0].name.as_deref(), Some("one"));
        assert_eq!(provider.asked(), vec!["community.example".to_owned()]);
    }

    #[test]
    fn a_recorded_failure_is_served_as_that_failure() {
        let provider = FixtureProvider::new().failing(
            "community.example",
            ActionError::Fetch {
                detail: "the Addon answered with status 503".to_owned(),
            },
        );
        let requested = ResourceRequest::new("stream", "movie", "tt1");

        assert!(matches!(
            provider.streams(&addon("community.example"), &requested),
            Err(ActionError::Fetch { .. })
        ));
    }

    #[test]
    #[should_panic(expected = "was not told what")]
    fn an_unrecorded_addon_panics_rather_than_being_answered_blankly() {
        let provider = FixtureProvider::new();
        let requested = ResourceRequest::new("stream", "movie", "tt1");
        let _ = provider.streams(&addon("community.example"), &requested);
    }
}
