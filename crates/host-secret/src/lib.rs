//! Credentials: the OS keyring when there is one, an owner-only file when there
//! is not.
//!
//! What lives here is the real [`host_core::SecretStore`], behind the same seam
//! the Host's in-memory double carries. The choice between the two backends is
//! made once, at open: the keyring is asked whether it answers at all — an
//! answer of "nothing stored" is the proof there is one — and where it cannot
//! answer, everything falls back to a file in the data directory that the
//! owner alone may read and write.
//!
//! That choice is the only decision this crate takes. Which credentials exist
//! is the Host's business ([`host_core::CredentialKind`]); how the Action
//! surface treats them is `host-core`'s; and what reaches a client is the
//! Snapshot's [`host_core::SecretBackend`] and nothing more.

use std::path::{Path, PathBuf};

use host_core::{CredentialKind, SecretBackend, SecretError, SecretStore};

/// The file the fallback holds its secrets in, in the data directory.
const FALLBACK_FILE: &str = "secrets.json";

/// The service name a keyring entry is filed under — the Host's own.
const SERVICE: &str = "dev.streamingapp.host";

/// Open the Host's credential store.
///
/// The keyring is probed once: an entry asked for that comes back "no entry"
/// has proven the keyring exists and answers, and that is the backend. Any
/// other answer — a platform failure, a service that cannot be reached — is a
/// keyring that is not available, and the owner-only file takes over.
pub fn open(data_dir: &Path) -> Result<Box<dyn SecretStore>, SetupError> {
    match probe_keyring() {
        Reach::Reachable => Ok(Box::new(KeyringSecretStore)),
        Reach::Unreachable => FileSecretStore::open(&data_dir.join(FALLBACK_FILE))
            .map(|store| Box::new(store) as Box<dyn SecretStore>),
    }
}

/// A setup that could not happen: the file could not be opened where the
/// fallback was meant to go.
#[derive(Debug, thiserror::Error)]
#[error("the secret store could not be prepared: {detail}")]
pub struct SetupError {
    pub(crate) detail: String,
}

/// Whether the OS keyring answered at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reach {
    /// It answered — even with "none stored", which is the proof.
    Reachable,
    /// It could not answer: no service, no session, no way to tell.
    Unreachable,
}

/// The keyring is probed by asking it for a credential.
///
/// That is the one question with an unambiguous answer: `NoEntry` means the
/// keyring is there and this item is simply not in it. The other errors mean
/// the keyring could not be reached — a platform failure, a storage access
/// the session does not carry — and those are "no keyring exists".
fn probe_keyring() -> Reach {
    let entry = match keyring::Entry::new(SERVICE, "probe").map_err(|_| Reach::Unreachable) {
        Ok(entry) => entry,
        Err(unreachable) => return unreachable,
    };
    classify(entry.get_password().err())
}

/// Which kind of keyring answer is which.
///
/// Only "answered, none stored" is proof of a keyring; anything else could be
/// a service that will never answer, and a store that cannot answer cannot be
/// the one the Host tells its owner about.
pub fn classify(error: Option<keyring::Error>) -> Reach {
    match error {
        None | Some(keyring::Error::NoEntry) => Reach::Reachable,
        Some(_) => Reach::Unreachable,
    }
}

/// The OS keyring, where it answers.
pub struct KeyringSecretStore;

impl SecretStore for KeyringSecretStore {
    fn backend(&self) -> SecretBackend {
        SecretBackend::Keyring
    }

    fn write(&self, credential: CredentialKind, value: &str) -> Result<(), SecretError> {
        entry(credential)?
            .set_password(value)
            .map_err(|error| SecretError::Write {
                detail: format!(
                    "the {kind} could not be kept: {error}",
                    kind = credential.label()
                ),
            })
    }

    fn read(&self, credential: CredentialKind) -> Result<Option<String>, SecretError> {
        match entry(credential)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(SecretError::Read {
                detail: format!(
                    "the {kind} could not be read back: {error}",
                    kind = credential.label()
                ),
            }),
        }
    }

    fn remove(&self, credential: CredentialKind) -> Result<(), SecretError> {
        match entry(credential)?.delete_credential() {
            Ok(()) => Ok(()),
            // Taking out what is not there is the end state already reached.
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(SecretError::Remove {
                detail: format!(
                    "the {kind} could not be taken out: {error}",
                    kind = credential.label()
                ),
            }),
        }
    }
}

/// The keyring entry a credential is filed under.
fn entry(credential: CredentialKind) -> Result<keyring::Entry, SecretError> {
    keyring::Entry::new(SERVICE, credential.id()).map_err(|error| SecretError::Read {
        detail: format!(
            "the {kind} could not be opened: {error}",
            kind = credential.label()
        ),
    })
}

/// The owner-only file, where no keyring exists.
///
/// The file is one JSON object of `secret id → value`, and its permissions are
/// the whole point of it: the owner reads, the owner writes, and nobody else
/// may do either. On a platform without POSIX permissions the guarantees come
/// from the data directory being the owner's own; the mode is set where it
/// can be set.
pub struct FileSecretStore {
    path: PathBuf,
}

impl FileSecretStore {
    /// Open the file, creating it owner-only when it is not there yet.
    ///
    /// Created eagerly: a store that only exists the first time a credential
    /// is written is a store whose permissions were never checked before they
    /// were needed, and "which backend am I on" is a question asked before
    /// any of that.
    pub fn open(path: &Path) -> Result<Self, SetupError> {
        let store = Self {
            path: path.to_owned(),
        };
        store.ensure()?;
        Ok(store)
    }

    /// The file exists, holds an empty record at worst, and is the owner's
    /// alone.
    fn ensure(&self) -> Result<(), SetupError> {
        use std::io::Write;

        if !self.path.exists() {
            // The mode is set before a byte goes in, so there is no window
            // where the file exists and another's bytes could land in it.
            let mut file = open_writable(&self.path).map_err(|error| SetupError {
                detail: format!("{} could not be opened: {error}", self.path.display()),
            })?;
            file.write_all(b"{}\n").map_err(|error| SetupError {
                detail: format!("{} could not be written: {error}", self.path.display()),
            })?;
        }
        reserve(&self.path).map_err(|error| SetupError {
            detail: format!(
                "{} could not be made the owner's alone: {error:?}",
                self.path.display()
            ),
        })
    }

    /// The whole file, read back as the record it was written as. A file that
    /// cannot be read is one the Host cannot answer for; a missing one is
    /// "nothing stored".
    fn contents(&self) -> Result<serde_json::Map<String, serde_json::Value>, SecretError> {
        match std::fs::read_to_string(&self.path) {
            Ok(text) if text.trim().is_empty() => Ok(serde_json::Map::new()),
            Ok(text) => {
                let value: serde_json::Value =
                    serde_json::from_str(&text).map_err(|error| SecretError::Read {
                        detail: format!("{} could not be read back: {error}", self.path.display()),
                    })?;
                match value {
                    serde_json::Value::Object(map) => Ok(map),
                    _ => Err(SecretError::Read {
                        detail: format!(
                            "{} is not the record it was written as",
                            self.path.display()
                        ),
                    }),
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                Ok(serde_json::Map::new())
            }
            Err(error) => Err(SecretError::Read {
                detail: format!("{} could not be read: {error}", self.path.display()),
            }),
        }
    }

    /// The record back onto the file, over whatever came before, and the
    /// permissions kept the owner's.
    fn keep(
        &self,
        contents: serde_json::Map<String, serde_json::Value>,
    ) -> Result<(), SecretError> {
        use std::io::Write;

        let mut file = open_writable(&self.path).map_err(|error| SecretError::Write {
            detail: format!("{} could not be opened: {error}", self.path.display()),
        })?;
        let json = serde_json::Value::Object(contents);
        file.write_all(json.to_string().as_bytes())
            .and_then(|_| file.flush())
            .map_err(|error| SecretError::Write {
                detail: format!("{} could not be written: {error}", self.path.display()),
            })?;
        // The mode is the file's, again: the write did not open it up.
        reserve(&self.path).map_err(|error| SecretError::Write {
            detail: format!(
                "{} could not be kept the owner's alone: {error:?}",
                self.path.display()
            ),
        })
    }
}

/// A file open for overwriting — itself created with nothing readable by
/// anyone but the owner.
fn open_writable(path: &Path) -> std::io::Result<std::fs::File> {
    let file = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(path)?;
    reserve(path)?;
    Ok(file)
}

/// The permissions of a file set back to the owner's own, where the platform
/// has a mode to set.
#[cfg(unix)]
fn reserve(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;

    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
}

#[cfg(not(unix))]
fn reserve(path: &Path) -> std::io::Result<()> {
    let _ = path;
    Ok(())
}

impl SecretStore for FileSecretStore {
    fn backend(&self) -> SecretBackend {
        SecretBackend::File
    }

    fn write(&self, credential: CredentialKind, value: &str) -> Result<(), SecretError> {
        let mut contents = self.contents()?;
        contents.insert(
            credential.id().to_owned(),
            serde_json::Value::String(value.to_owned()),
        );
        self.keep(contents)
    }

    fn read(&self, credential: CredentialKind) -> Result<Option<String>, SecretError> {
        Ok(self
            .contents()?
            .get(credential.id())
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned))
    }

    fn remove(&self, credential: CredentialKind) -> Result<(), SecretError> {
        let mut contents = self.contents()?;
        contents.remove(credential.id());
        self.keep(contents)
    }
}
