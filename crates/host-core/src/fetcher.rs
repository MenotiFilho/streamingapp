//! The Host's one HTTP boundary, and the fixture-backed double tests drive it with.
//!
//! Everything the Host fetches from an Addon — a manifest today, catalogs and
//! Streams later — goes through [`Fetcher`]. The seam is deliberately synchronous:
//! the Action surface is a door one client goes through at a time, and a fetch is a
//! one-off the owner asked for, not a hot path (ADR-0009). The real implementation
//! lives outside this crate, next to the window, because nothing in `host-core`
//! knows about the network.
//!
//! The protocol's legacy JSON-RPC transport (`q.json`) is deliberately not
//! implemented. It is named here so that adding it later is another implementation
//! of this seam rather than a change to it.

use std::collections::HashMap;
use std::sync::Mutex;

/// Where the Host gets bytes from.
pub trait Fetcher: Send + Sync + 'static {
    /// Fetch the body at `url`.
    fn fetch(&self, url: &str) -> Result<String, FetchError> {
        self.fetch_with_headers(url, &[])
    }

    /// Fetch the body at `url`, saying what a credential wants said in the
    /// headers. A credential may travel as a header — TMDB's access token is
    /// one such — and a header is the one place it cannot end up in a log line
    /// or in history: a URL goes in a log, a header does not.
    fn fetch_with_headers(&self, url: &str, headers: &[(&str, &str)])
        -> Result<String, FetchError>;
}

/// Why a fetch did not produce a body, in the Host's own terms.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum FetchError {
    #[error("the Addon answered with status {status}")]
    Status { status: u16 },
    #[error("the Addon could not be reached: {detail}")]
    Unreachable { detail: String },
    #[error("the Addon answered with something that is not text: {detail}")]
    Body { detail: String },
}

/// A [`Fetcher`] that answers from recorded fixtures, and refuses to answer from
/// anywhere else.
///
/// A unit test must never touch the network, and this is what makes an accidental
/// live call a failure rather than a flake: a URL with no recorded fixture panics,
/// loudly, in the test that asked for it.
#[derive(Debug, Default)]
pub struct FixtureFetcher {
    responses: Mutex<HashMap<String, Result<String, FetchError>>>,
    /// Every URL the Host asked for, in order, with the headers each ask
    /// carried.
    asked: Mutex<Vec<(String, Vec<(String, String)>)>>,
}

impl FixtureFetcher {
    pub fn new() -> Self {
        Self::default()
    }

    /// Serve `body` for `url`.
    pub fn serving(self, url: &str, body: impl Into<String>) -> Self {
        self.holding(url, Ok(body.into()))
    }

    /// Serve `error` for `url`, for the paths where the Addon is down or angry.
    pub fn failing(self, url: &str, error: FetchError) -> Self {
        self.holding(url, Err(error))
    }

    /// Every URL this fetcher was asked for, in order — for the tests that care
    /// that the Host asked for the URL the owner pasted and no other.
    pub fn asked(&self) -> Vec<String> {
        self.asked
            .lock()
            .expect("the fixture fetcher is not poisoned")
            .iter()
            .map(|(url, _)| url.clone())
            .collect()
    }

    /// The headers the last ask of `url` carried — for the tests that care a
    /// credential went out in a header and nowhere a log could read.
    pub fn headers_of(&self, url: &str) -> Vec<(String, String)> {
        self.asked
            .lock()
            .expect("the fixture fetcher is not poisoned")
            .iter()
            .rev()
            .find(|(asked, _)| asked == url)
            .map(|(_, headers)| headers.clone())
            .expect("a fetcher that was asked for a url it has the ask of")
    }

    fn holding(mut self, url: &str, response: Result<String, FetchError>) -> Self {
        self.responses
            .get_mut()
            .expect("the fixture fetcher is not poisoned")
            .insert(url.to_owned(), response);
        self
    }
}

impl Fetcher for FixtureFetcher {
    fn fetch_with_headers(
        &self,
        url: &str,
        headers: &[(&str, &str)],
    ) -> Result<String, FetchError> {
        self.asked
            .lock()
            .expect("the fixture fetcher is not poisoned")
            .push((
                url.to_owned(),
                headers
                    .iter()
                    .map(|(name, value)| (name.to_string(), value.to_string()))
                    .collect(),
            ));

        match self
            .responses
            .lock()
            .expect("the fixture fetcher is not poisoned")
            .get(url)
        {
            Some(response) => response.clone(),
            None => {
                panic!("no recorded fixture for {url} — a unit test must never touch the network")
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_recorded_url_is_served_its_fixture() {
        let fetcher = FixtureFetcher::new().serving("https://example.com/manifest.json", "{}");

        assert_eq!(
            fetcher.fetch("https://example.com/manifest.json"),
            Ok("{}".to_owned())
        );
        assert_eq!(
            fetcher.asked(),
            vec!["https://example.com/manifest.json".to_owned()]
        );
    }

    #[test]
    fn a_recorded_failure_is_served_as_that_failure() {
        let fetcher = FixtureFetcher::new().failing(
            "https://example.com/manifest.json",
            FetchError::Status { status: 404 },
        );

        assert_eq!(
            fetcher.fetch("https://example.com/manifest.json"),
            Err(FetchError::Status { status: 404 })
        );
    }

    #[test]
    #[should_panic(expected = "no recorded fixture")]
    fn an_unrecorded_url_panics_rather_than_reaching_the_network() {
        let _ = FixtureFetcher::new().fetch("https://example.com/manifest.json");
    }
}
