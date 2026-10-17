use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use crate::addon::Addon;
use crate::device::{Device, DeviceId};
use crate::preferences::Preferences;
use crate::progress::WatchProgress;

/// Where the Host's non-secret state lives between runs.
///
/// Domain operations only: no SQL, no schema and no file layout show up above this
/// seam, and the same trait is implemented in memory for tests and over SQLite for
/// real. The Host reads once at startup and writes once per Action, so an
/// implementation may assume the calls are rare and not concurrent with each other.
pub trait Store: Send + Sync + 'static {
    /// The preferences that were persisted, or the defaults when nothing has ever
    /// been written.
    fn read_preferences(&self) -> Result<Preferences, StoreError>;

    /// Replace the persisted preferences.
    fn write_preferences(&self, preferences: &Preferences) -> Result<(), StoreError>;

    /// The Addons the Host is configured with, in the order they were configured.
    fn read_addons(&self) -> Result<Vec<Addon>, StoreError>;

    /// Replace the configured Addons.
    fn write_addons(&self, addons: &[Addon]) -> Result<(), StoreError>;

    /// Every Video the Host has Watch progress in, most recently written first.
    ///
    /// The whole of it in one read: the Host holds it in memory and consults it
    /// between Actions (a resume point, a next episode), so it is read once at
    /// startup rather than per Action.
    fn read_watch_progress(&self) -> Result<Vec<WatchProgress>, StoreError>;

    /// Write one Video's Watch progress, replacing whatever the entry was.
    ///
    /// One entry at a time because this is the write the Host makes while it
    /// plays: playback moves, and the position written down moves with it (#29).
    fn write_watch_progress(&self, progress: &WatchProgress) -> Result<(), StoreError>;

    /// The devices the Host has paired, in the order they paired.
    ///
    /// Read once at startup, like Addons and Watch progress: the Host holds them
    /// in memory and judges every frame a remote client sends against them, so
    /// this is not a per-frame read. What is stored is a device and the digest of
    /// its token, never the token itself.
    fn read_devices(&self) -> Result<Vec<Device>, StoreError>;

    /// Write one paired device, replacing whatever was there for its id.
    fn write_device(&self, device: &Device) -> Result<(), StoreError>;

    /// Take a paired device out by name: its token matches nothing from here on.
    fn remove_device(&self, id: &DeviceId) -> Result<(), StoreError>;
}

/// Something went wrong at the store, in the store's own terms.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum StoreError {
    #[error("the store could not be read: {detail}")]
    Read { detail: String },
    #[error("the store could not be written: {detail}")]
    Write { detail: String },
    #[error("the store could not be prepared: {detail}")]
    Prepare { detail: String },
}

impl StoreError {
    pub fn read(error: impl std::fmt::Display) -> Self {
        Self::Read {
            detail: error.to_string(),
        }
    }

    pub fn write(error: impl std::fmt::Display) -> Self {
        Self::Write {
            detail: error.to_string(),
        }
    }

    pub fn prepare(error: impl std::fmt::Display) -> Self {
        Self::Prepare {
            detail: error.to_string(),
        }
    }
}

/// The seam's in-memory implementation.
///
/// It is what drives the Action surface in tests, and `failing_writes` is what
/// proves the Host leaves its state alone when the store refuses a change.
#[derive(Debug, Default)]
pub struct InMemoryStore {
    preferences: Mutex<Preferences>,
    addons: Mutex<Vec<Addon>>,
    watch: Mutex<Vec<WatchProgress>>,
    devices: Mutex<Vec<Device>>,
    failing_writes: AtomicBool,
}

impl InMemoryStore {
    pub fn new() -> Self {
        Self::default()
    }

    /// Start from preferences the Host would have found on disk.
    pub fn holding(preferences: Preferences) -> Self {
        Self {
            preferences: Mutex::new(preferences),
            addons: Mutex::new(Vec::new()),
            watch: Mutex::new(Vec::new()),
            devices: Mutex::new(Vec::new()),
            failing_writes: AtomicBool::new(false),
        }
    }

    /// The same, with Addons the Host would have found on disk too.
    pub fn holding_addons(self, addons: Vec<Addon>) -> Self {
        *self
            .addons
            .lock()
            .expect("the in-memory store is not poisoned") = addons;
        self
    }

    /// The same, with the Watch progress a previous run left behind.
    pub fn holding_watch(self, watch: Vec<WatchProgress>) -> Self {
        *self
            .watch
            .lock()
            .expect("the in-memory store is not poisoned") = watch;
        self
    }

    /// The same, with the devices a previous run left paired.
    pub fn holding_devices(self, devices: Vec<Device>) -> Self {
        *self
            .devices
            .lock()
            .expect("the in-memory store is not poisoned") = devices;
        self
    }

    /// Make every write fail — a store that is read-only, full, or gone.
    pub fn failing_writes(&self) -> &Self {
        self.failing_writes.store(true, Ordering::SeqCst);
        self
    }

    /// One locked look at what is persisted, for tests that assert the store was
    /// or was not touched.
    pub fn persisted(&self) -> Preferences {
        self.preferences
            .lock()
            .expect("the in-memory store is not poisoned")
            .clone()
    }

    /// The same look, at the Addons.
    pub fn persisted_addons(&self) -> Vec<Addon> {
        self.addons
            .lock()
            .expect("the in-memory store is not poisoned")
            .clone()
    }

    /// The same look, at the Watch progress.
    pub fn persisted_watch(&self) -> Vec<WatchProgress> {
        self.watch
            .lock()
            .expect("the in-memory store is not poisoned")
            .clone()
    }

    /// The same look, at the paired devices.
    pub fn persisted_devices(&self) -> Vec<Device> {
        self.devices
            .lock()
            .expect("the in-memory store is not poisoned")
            .clone()
    }
}

impl Store for InMemoryStore {
    fn read_preferences(&self) -> Result<Preferences, StoreError> {
        Ok(self.persisted())
    }

    fn write_preferences(&self, preferences: &Preferences) -> Result<(), StoreError> {
        if self.failing_writes.load(Ordering::SeqCst) {
            return Err(StoreError::Write {
                detail: "the store is failing every write".to_owned(),
            });
        }
        *self
            .preferences
            .lock()
            .expect("the in-memory store is not poisoned") = preferences.clone();
        Ok(())
    }

    fn read_addons(&self) -> Result<Vec<Addon>, StoreError> {
        Ok(self.persisted_addons())
    }

    fn write_addons(&self, addons: &[Addon]) -> Result<(), StoreError> {
        if self.failing_writes.load(Ordering::SeqCst) {
            return Err(StoreError::Write {
                detail: "the store is failing every write".to_owned(),
            });
        }
        *self
            .addons
            .lock()
            .expect("the in-memory store is not poisoned") = addons.to_vec();
        Ok(())
    }

    fn read_watch_progress(&self) -> Result<Vec<WatchProgress>, StoreError> {
        let mut watch = self.persisted_watch();
        // The same order the real store reads in — most recently written first —
        // so a test cannot pass on an order production would not give.
        watch.sort_by_key(|entry| std::cmp::Reverse(entry.updated_at));
        Ok(watch)
    }

    fn write_watch_progress(&self, progress: &WatchProgress) -> Result<(), StoreError> {
        if self.failing_writes.load(Ordering::SeqCst) {
            return Err(StoreError::Write {
                detail: "the store is failing every write".to_owned(),
            });
        }

        let mut held = self
            .watch
            .lock()
            .expect("the in-memory store is not poisoned");
        // One entry per Video, and the one just written is the most recent: the
        // entry it replaces goes wherever it was, and the new one leads.
        held.retain(|entry| entry.video != progress.video);
        held.insert(0, progress.clone());
        Ok(())
    }

    fn read_devices(&self) -> Result<Vec<Device>, StoreError> {
        Ok(self
            .devices
            .lock()
            .expect("the in-memory store is not poisoned")
            .clone())
    }

    fn write_device(&self, device: &Device) -> Result<(), StoreError> {
        if self.failing_writes.load(Ordering::SeqCst) {
            return Err(StoreError::Write {
                detail: "the store is failing every write".to_owned(),
            });
        }

        let mut held = self
            .devices
            .lock()
            .expect("the in-memory store is not poisoned");
        // One row per device, in paired order: a device paired again — which is
        // a device that paired a second time — keeps its place.
        held.retain(|existing| existing.id() != device.id());
        held.push(device.clone());
        Ok(())
    }

    fn remove_device(&self, id: &DeviceId) -> Result<(), StoreError> {
        if self.failing_writes.load(Ordering::SeqCst) {
            return Err(StoreError::Write {
                detail: "the store is failing every write".to_owned(),
            });
        }

        self.devices
            .lock()
            .expect("the in-memory store is not poisoned")
            .retain(|device| device.id() != id);
        Ok(())
    }
}
