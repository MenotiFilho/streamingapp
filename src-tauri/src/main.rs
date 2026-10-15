//! The Host's window.
//!
//! Nothing here decides anything: it resolves the platform directories, starts the
//! logs and the store, and hands the Tauri IPC bridge to the Action surface. Every
//! mutation goes through `ipc::dispatch`, and state comes back as Snapshots
//! (ADR-0002).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ipc;
mod paths;

use std::sync::{Arc, Mutex};

use host_core::Host;
use host_sqlite::SqliteStore;
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        // First, so that a second launch is turned away before it touches the
        // database: two Hosts over one store must never happen.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            tracing::info!(?argv, cwd, "the Host is already running; focusing it");
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .invoke_handler(tauri::generate_handler![ipc::dispatch, ipc::snapshot])
        .setup(|app| {
            let handle = app.handle().clone();
            let data_dir = paths::data_dir(&handle)?;
            let config_dir = paths::config_dir(&handle)?;
            let logs = host_logging::init(&data_dir)?;
            tracing::info!(
                version = env!("CARGO_PKG_VERSION"),
                data_dir = %data_dir.display(),
                config_dir = %config_dir.display(),
                log_file = %logs.path().display(),
                "the Host is starting",
            );

            let database = data_dir.join(paths::DATABASE_FILE);
            let store = SqliteStore::open(&database)?;
            tracing::info!(
                schema_version = store.schema_version()?,
                database = %database.display(),
                "the store is ready",
            );

            app.manage(ipc::HostHandle::new(Host::new(Arc::new(store))?));
            // Held, not read: the guard inside keeps the log writer alive for as
            // long as the Host runs.
            app.manage(Mutex::new(logs));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("the Host cannot start");
}
