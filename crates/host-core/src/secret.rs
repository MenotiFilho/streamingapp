//! Where the Host's credentials live, and the seams around them.
//!
//! Credentials — the TMDB key today, the Stremio `authKey` later — are state the
//! Host *holds without ever reading into its own* state: they live in the OS
//! keyring when there is one, and in an owner-only (0600) file in the data
//! directory when there is not. What is picked up is picked up at the moment it
//! is used, so no credential is ever copied somewhere a [`crate::Snapshot`] is
//! built from.
//!
//! The trait carries the credential kind and the value, and says which backend
//! is actually holding it — because "which one am I using" is a question the
//! owner asks (`Snapshot.protection`), and an implementation that falls back
//! somewhere else than its caller was told about is a lie told by omission.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

/// The credential kinds the Host knows a name for.
///
/// One field today; one variant per credential the Host learns to hold, so a
/// caller can never ask for a secret the store has no place for under some
/// string it made up.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Secret {
    /// The key TMDB wants on its metadata requests.
    TmdbKey,
}

impl Secret {
    /// The id a store holds it under — its own spelling, below the seam.
    pub fn id(self) -> &'static str {
        "tmdb-key"
    }

    /// The credential's name, for a message a person reads.
    pub fn label(self) -> &'static str {
        "TMDB key"
    }
}

/// Which backend is actually holding the Host's credentials.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SecretBackend {
    /// The OS keyring.
    Keyring,
    /// The owner-only (0600) file in the data directory, where no keyring
    /// exists.
    File,
}

impl SecretBackend {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Keyring => "keyring",
            Self::File => "file",
        }
    }
}

/// The TMDB key the owner gave the Host, in the shape a credential answer takes.
///
/// It is judged only on the shape a secret travels in — non-empty, bounded, no
/// control character or space — and never on what it says: this Host does not
/// know what a TMDB key looks like on the inside, and neither key form TMDB
/// wants is an error to it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TmdbKey(String);

impl TmdbKey {
    /// The longest secret the Host will keep. A TMDB v3 key is 32 characters; a
    /// v4 read-access token is a JWT in the hundreds — 4096 is the room to
    /// change shape without a change here.
    pub const MAX_LEN: usize = 4096;

    /// A secret to keep, or why this is not one.
    pub fn parse(raw: &str) -> Result<Self, InvalidTmdbKey> {
        let invalid = |detail: &'static str| InvalidTmdbKey {
            key: raw.to_owned(),
            detail,
        };

        if raw.is_empty() {
            return Err(invalid("a key is not empty"));
        }
        if raw.len() > Self::MAX_LEN {
            return Err(invalid("a key is shorter than the Host will keep"));
        }
        if raw.chars().any(char::is_control) {
            return Err(invalid("a key carries no control characters"));
        }
        if raw.chars().any(char::is_whitespace) {
            return Err(invalid("a key carries no spaces"));
        }

        Ok(Self(raw.to_owned()))
    }

    /// The secret itself. It exists for the moment a store is written to and no
    /// longer: nothing checks whether it *is* the secret before then.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// A string that is not shaped like an entered key, offered as one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, thiserror::Error)]
#[error("{key:?} is not shaped like a TMDB key: {detail}")]
pub struct InvalidTmdbKey {
    pub key: String,
    pub detail: &'static str,
}

/// A credential the Host could not keep, get back, or take out.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum SecretError {
    #[error("the credential could not be read: {detail}")]
    Read { detail: String },
    #[error("the credential could not be kept: {detail}")]
    Write { detail: String },
    #[error("the credential could not be taken out: {detail}")]
    Remove { detail: String },
}

/// Where the Host's credentials live.
///
/// The calls are rare — one at startup, one when the owner enters a key, one
/// per open of a Title that could map — and never concurrent with each other,
/// because they arrive through the one Action surface.
pub trait SecretStore: Send + Sync + 'static {
    /// Which backend is actually holding the credentials.
    fn backend(&self) -> SecretBackend;

    /// Keep a credential. Replaces any value already there.
    fn write(&self, secret: Secret, value: &str) -> Result<(), SecretError>;

    /// The credential that is there, or `None` when none was kept.
    fn read(&self, secret: Secret) -> Result<Option<String>, SecretError>;

    /// Take a credential out. Taking out one that is not there is not an
    /// error: the end state is the same.
    fn remove(&self, secret: Secret) -> Result<(), SecretError>;
}

/// The seam's in-memory implementation.
///
/// It is what drives the Action surface in tests, and `failing` is what proves
/// the Host leaves its state alone when the store refuses a credential.
#[derive(Debug, Default)]
pub struct InMemorySecretStore {
    backend: Option<SecretBackend>,
    held: Mutex<Vec<(Secret, String)>>,
    failing: AtomicBool,
}

impl InMemorySecretStore {
    pub fn new() -> Self {
        Self::default()
    }

    /// A store that says it is backed by `backend`, for the tests that read a
    /// Snapshot's protection off the store.
    pub fn backed_by(backend: SecretBackend) -> Self {
        Self {
            backend: Some(backend),
            ..Self::default()
        }
    }

    /// Make every call fail — a store that is gone, full, or refusing.
    pub fn failing(&self) -> &Self {
        self.failing.store(true, Ordering::SeqCst);
        self
    }

    /// Whether a credential of this kind is kept — for the tests that check
    /// what landed without reading the value themselves.
    pub fn holds(&self, secret: Secret) -> bool {
        self.held
            .lock()
            .expect("the in-memory store is not poisoned")
            .iter()
            .any(|(held, value)| held == &secret && !value.is_empty())
    }
}

impl SecretStore for InMemorySecretStore {
    fn backend(&self) -> SecretBackend {
        self.backend.unwrap_or(SecretBackend::Keyring)
    }

    fn write(&self, secret: Secret, value: &str) -> Result<(), SecretError> {
        if self.failing.load(Ordering::SeqCst) {
            return Err(SecretError::Write {
                detail: "the secret store is failing every call".to_owned(),
            });
        }
        let mut held = self
            .held
            .lock()
            .expect("the in-memory store is not poisoned");
        held.retain(|(kept, _)| kept != &secret);
        held.push((secret, value.to_owned()));
        Ok(())
    }

    fn read(&self, secret: Secret) -> Result<Option<String>, SecretError> {
        if self.failing.load(Ordering::SeqCst) {
            return Err(SecretError::Read {
                detail: "the secret store is failing every call".to_owned(),
            });
        }
        Ok(self
            .held
            .lock()
            .expect("the in-memory store is not poisoned")
            .iter()
            .find(|(kept, _)| kept == &secret)
            .map(|(_, value)| value.clone()))
    }

    fn remove(&self, secret: Secret) -> Result<(), SecretError> {
        if self.failing.load(Ordering::SeqCst) {
            return Err(SecretError::Remove {
                detail: "the secret store is failing every call".to_owned(),
            });
        }
        self.held
            .lock()
            .expect("the in-memory store is not poisoned")
            .retain(|(kept, _)| kept != &secret);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secrets_know_their_place_beneath_the_seam_and_person_reading() {
        assert_eq!(Secret::TmdbKey.id(), "tmdb-key");
        assert_eq!(Secret::TmdbKey.label(), "TMDB key");
    }

    #[test]
    fn an_entered_key_that_is_shaped_like_one_is_kept() {
        let key =
            TmdbKey::parse("0123456789abcdef0123456789abcdef").expect("a v3 api key is a key");
        assert_eq!(key.as_str(), "0123456789abcdef0123456789abcdef");
    }

    #[test]
    fn a_token_long_enough_for_tmdbs_v4_is_also_a_key() {
        // A read-access token is a JWT in the hundreds of characters, and a
        // secret's shape is not one string length.
        let token = "a".repeat(900);
        assert!(TmdbKey::parse(&token).is_ok());
    }

    #[test]
    fn a_string_that_is_not_shaped_like_a_key_is_refused_with_what_is_wrong() {
        for (raw, detail) in [
            ("", "not empty"),
            (&"k".repeat(TmdbKey::MAX_LEN + 1), "shorter"),
            ("the key\n", "control"),
            ("the key", "spaces"),
        ] {
            let refused = TmdbKey::parse(raw).expect_err("{raw:?} is not a key");

            assert_eq!(refused.key, raw, "the offered key is carried back");
            assert!(
                detail_verifies(&refused, detail),
                "{refused} does not say {detail:?}"
            );
        }
    }

    fn detail_verifies(refused: &InvalidTmdbKey, word: &str) -> bool {
        refused.detail.contains(word) || refused.to_string().contains(word)
    }

    #[test]
    fn a_kept_credential_is_read_back_as_it_went_in() {
        let store = InMemorySecretStore::new();

        store
            .write(Secret::TmdbKey, "the key")
            .expect("keeping a credential should work");

        assert_eq!(
            store.read(Secret::TmdbKey),
            Ok(Some("the key".to_owned())),
            "what the store kept is what the store answers"
        );
        assert!(store.holds(Secret::TmdbKey));
    }

    #[test]
    fn a_credential_replaces_the_one_before_it() {
        let store = InMemorySecretStore::new();
        store
            .write(Secret::TmdbKey, "an old key")
            .expect("keeping a credential should work");
        store
            .write(Secret::TmdbKey, "a new key")
            .expect("keeping a credential should work");

        assert_eq!(
            store.read(Secret::TmdbKey),
            Ok(Some("a new key".to_owned()))
        );
    }

    #[test]
    fn a_credential_that_was_never_kept_reads_as_none() {
        let store = InMemorySecretStore::new();

        assert_eq!(store.read(Secret::TmdbKey), Ok(None));
    }

    #[test]
    fn a_removed_credential_is_gone_and_removing_an_absent_one_is_not_an_error() {
        let store = InMemorySecretStore::new();

        store
            .remove(Secret::TmdbKey)
            .expect("taking out nothing is the same as nothing there");

        store
            .write(Secret::TmdbKey, "the key")
            .expect("keeping a credential should work");
        store
            .remove(Secret::TmdbKey)
            .expect("taking out a credential should work");

        assert_eq!(store.read(Secret::TmdbKey), Ok(None));
    }

    #[test]
    fn the_store_says_which_backend_it_is() {
        assert_eq!(
            InMemorySecretStore::new().backend(),
            SecretBackend::Keyring,
            "the in-memory store presents as the real thing: the OS keyring"
        );
        assert_eq!(
            InMemorySecretStore::backed_by(SecretBackend::File).backend(),
            SecretBackend::File
        );
    }

    #[test]
    fn a_store_that_cannot_answer_refsues_with_its_kind_of_failure() {
        let held = InMemorySecretStore::new();
        let store = held.failing();

        assert!(matches!(
            store.read(Secret::TmdbKey),
            Err(SecretError::Read { .. })
        ));
        assert!(matches!(
            store.write(Secret::TmdbKey, "x"),
            Err(SecretError::Write { .. })
        ));
        assert!(matches!(
            store.remove(Secret::TmdbKey),
            Err(SecretError::Remove { .. })
        ));
    }
}
