//! The seam Stremio's account API is reached through (#30), and the fake tests
//! drive it with.
//!
//! The account API is JSON over POST, which [`crate::Fetcher`] — GET-only, and
//! meant for Addons — is not, so this is a seam of its own rather than a widening
//! of that one. It speaks in the shapes the Host needs: sign in and get an
//! `authKey` back, read library items, write library items. The documents are
//! kept as [`serde_json::Value`]: they belong to Stremio, carry fields this Host
//! has no use for, and must be written back with those fields intact.
//!
//! A Host built without one of these never calls Stremio, which is what "sync is
//! off by default and nothing depends on it" means in types.

use std::sync::Mutex;

use serde_json::Value;

/// One entry in the account's `datastoreMeta` index: the library item's `_id`
/// and the server's mtime in milliseconds since the Unix epoch.
///
/// The index is the diff: a cached document whose mtime still matches needs no
/// `datastoreGet` at all.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LibraryMeta {
    pub id: String,
    pub mtime: i64,
}

/// Where the Host talks to Stremio's account service.
pub trait StremioApi: Send + Sync + 'static {
    /// Sign in, and get the `authKey` the account's later requests carry.
    fn login(&self, email: &str, password: &str) -> Result<String, SyncError>;

    /// Library items — every one when `ids` is `None`, else those with these
    /// `_id`s (a Title's id is its library item's).
    fn library(&self, auth_key: &str, ids: Option<&[String]>) -> Result<Vec<Value>, SyncError>;

    /// The account's `libraryItem` index: one `_id` and mtime per document,
    /// including tombstones. This is what makes a later read a diff.
    fn library_meta(&self, auth_key: &str) -> Result<Vec<LibraryMeta>, SyncError>;

    /// Write library items, each replacing the item with its `_id`.
    fn put_library(&self, auth_key: &str, items: &[Value]) -> Result<(), SyncError>;
}

/// Why Stremio did not do what was asked of it, in the Host's own terms.
///
/// The detail never carries what was sent: a password or an `authKey` in an error
/// message would be a credential in a place a client reads.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum SyncError {
    #[error("Stremio could not be reached: {detail}")]
    Unreachable { detail: String },
    #[error("Stremio refused the request: {detail}")]
    Refused { detail: String },
    #[error("Stremio answered with something that is not what was asked for: {detail}")]
    Malformed { detail: String },
}

/// A [`StremioApi`] that answers from what it was given, and records what it was
/// asked.
///
/// A real call is never made from a test: an account that was not set up refuses
/// the sign-in, and `calls` is what proves a Host with sync off asked nothing.
#[derive(Debug, Default)]
pub struct FixtureStremio {
    account: Option<(String, String, String)>,
    library: Mutex<Vec<Value>>,
    failing: Mutex<bool>,
    expired: Mutex<bool>,
    calls: Mutex<Vec<String>>,
    keys_seen: Mutex<Vec<String>>,
    library_ids: Mutex<Vec<Option<Vec<String>>>>,
}

impl FixtureStremio {
    pub fn new() -> Self {
        Self::default()
    }

    /// An account that signs in with `email` and `password`, and hands back
    /// `auth_key`.
    pub fn with_account(mut self, email: &str, password: &str, auth_key: &str) -> Self {
        self.account = Some((email.to_owned(), password.to_owned(), auth_key.to_owned()));
        self
    }

    /// Library items the account already holds.
    pub fn holding(self, items: Vec<Value>) -> Self {
        *self.library.lock().expect("the fixture is not poisoned") = items;
        self
    }

    /// Make every library call fail, as a Stremio that is down.
    pub fn failing_library(&self) -> &Self {
        *self.failing.lock().expect("the fixture is not poisoned") = true;
        self
    }

    /// Make every library call answer the API's expired-session refusal.
    pub fn expiring_session(&self) -> &Self {
        *self.expired.lock().expect("the fixture is not poisoned") = true;
        self
    }

    /// Replace the account's items, as another Stremio client would between two
    /// reads. The mtimes in the documents are the index's mtimes.
    pub fn replace_library(&self, items: Vec<Value>) {
        *self.library.lock().expect("the fixture is not poisoned") = items;
    }

    /// Every call made, by name, in order.
    pub fn calls(&self) -> Vec<String> {
        self.calls
            .lock()
            .expect("the fixture is not poisoned")
            .clone()
    }

    /// The library items as they stand now — what a later read would give.
    pub fn stored(&self) -> Vec<Value> {
        self.library
            .lock()
            .expect("the fixture is not poisoned")
            .clone()
    }

    /// Every `authKey` a library call carried.
    pub fn keys_seen(&self) -> Vec<String> {
        self.keys_seen
            .lock()
            .expect("the fixture is not poisoned")
            .clone()
    }

    /// The ids each `library` call asked for, in order; `None` is the full read.
    pub fn library_ids(&self) -> Vec<Option<Vec<String>>> {
        self.library_ids
            .lock()
            .expect("the fixture is not poisoned")
            .clone()
    }

    fn record(&self, call: &str) {
        self.calls
            .lock()
            .expect("the fixture is not poisoned")
            .push(call.to_owned());
    }

    fn check(&self, auth_key: &str) -> Result<(), SyncError> {
        self.keys_seen
            .lock()
            .expect("the fixture is not poisoned")
            .push(auth_key.to_owned());
        if *self.failing.lock().expect("the fixture is not poisoned") {
            return Err(SyncError::Unreachable {
                detail: "the fixture is failing every library call".to_owned(),
            });
        }
        if *self.expired.lock().expect("the fixture is not poisoned") {
            return Err(SyncError::Refused {
                detail: "Session does not exist".to_owned(),
            });
        }
        match &self.account {
            Some((_, _, key)) if key == auth_key => Ok(()),
            _ => Err(SyncError::Refused {
                detail: "Session does not exist".to_owned(),
            }),
        }
    }
}

impl StremioApi for FixtureStremio {
    fn login(&self, email: &str, password: &str) -> Result<String, SyncError> {
        self.record("login");
        match &self.account {
            Some((known, secret, key)) if known == email && secret == password => Ok(key.clone()),
            _ => Err(SyncError::Refused {
                detail: "Wrong passphrase".to_owned(),
            }),
        }
    }

    fn library(&self, auth_key: &str, ids: Option<&[String]>) -> Result<Vec<Value>, SyncError> {
        self.record("library");
        self.library_ids
            .lock()
            .expect("the fixture is not poisoned")
            .push(ids.map(|ids| ids.to_vec()));
        self.check(auth_key)?;
        let held = self.library.lock().expect("the fixture is not poisoned");
        Ok(held
            .iter()
            .filter(|item| {
                ids.is_none_or(|ids| {
                    item.get("_id")
                        .and_then(Value::as_str)
                        .is_some_and(|id| ids.iter().any(|wanted| wanted == id))
                })
            })
            .cloned()
            .collect())
    }

    fn library_meta(&self, auth_key: &str) -> Result<Vec<LibraryMeta>, SyncError> {
        self.record("library_meta");
        self.check(auth_key)?;
        let held = self.library.lock().expect("the fixture is not poisoned");
        Ok(held
            .iter()
            .filter_map(|item| {
                let id = item.get("_id").and_then(Value::as_str)?;
                let mtime = item
                    .get("_mtime")
                    .and_then(Value::as_str)
                    .and_then(crate::sync::millis_from_iso)
                    .unwrap_or(0);
                Some(LibraryMeta {
                    id: id.to_owned(),
                    mtime,
                })
            })
            .collect())
    }

    fn put_library(&self, auth_key: &str, items: &[Value]) -> Result<(), SyncError> {
        self.record("put_library");
        self.check(auth_key)?;
        let mut held = self.library.lock().expect("the fixture is not poisoned");
        for item in items {
            let id = item.get("_id").and_then(Value::as_str);
            held.retain(|have| have.get("_id").and_then(Value::as_str) != id);
            held.push(item.clone());
        }
        Ok(())
    }
}
