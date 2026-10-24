//! The app shell: platform directories, logging, the store, the window, single
//! instance behaviour, the IPC commands, and the Player — and no rules.
//!
//! Nothing here decides anything: it resolves the platform directories, starts
//! the logs and the store, hands the Tauri IPC bridge to the Action surface, and
//! gives the Host a Player. Every mutation goes through `ipc::dispatch`, and
//! state comes back as Snapshots (ADR-0002).
//!
//! The one thing the shell does on its own is look at that Player and publish
//! where playback has got to: `host-core` holds no threads and no timers, so
//! the clock that turns "the picture moved on" into a Snapshot is the shell's
//! (ADR-0013).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ipc;
mod paths;
mod player;
mod wire;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use host_addon::{HttpFetcher, HttpStremio};
use host_core::{AddonProvider, Host};
use host_sqlite::SqliteStore;
use tauri::Manager;

/// How often the Host is asked what its Player is doing.
///
/// A quarter of a second is finer than a person reads a position and far coarser
/// than a frame: what moves between two ticks is what a Snapshot is for, and the
/// picture itself never travels through this.
const SAMPLE: Duration = Duration::from_millis(250);

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

            // Credentials live where the OS keeps them — or, where there is
            // no keyring to ask, in the owner-only file this makes. Which of
            // the two is the one the interface shows; the Host only ever says
            // what the store reports.
            let secrets = host_secret::open(&data_dir)?;
            tracing::info!(
                backend = secrets.backend().as_str(),
                "credentials are held through the secret store",
            );

            // The one Provider this Host is built with: the Stremio addon
            // protocol, over the one Fetcher. Which Addons it asks, and which
            // of them answers for an id, is the Host's decision above it.
            let fetcher: Arc<dyn host_core::Fetcher> = Arc::new(HttpFetcher::new());

            // And the one Player: mpv, in this process, with the picture put
            // where this platform can put it. A machine whose mpv will not start
            // still browses — the window says why nothing can play.
            let player: Arc<dyn host_core::Player> = match app
                .get_webview_window("main")
                .map(|window| player::start(&window))
            {
                Some(Ok(player)) => player,
                Some(Err(error)) => {
                    tracing::error!(%error, "the Host has no Player: nothing will play");
                    Arc::new(player::NoPlayer::new(error.to_string()))
                }
                None => {
                    tracing::error!("the Host has no window: nothing will play");
                    Arc::new(player::NoPlayer::new("there is no window to play in"))
                }
            };
            tracing::info!(picture = ?player.picture(), "the Player is ready");

            // And the second, silent Player: a still of a moment the owner
            // points at, from a libmpv of its own that draws nowhere and plays
            // to nobody (ADR-0028). It answers nothing at all when its own mpv
            // will not start, so it is started whether or not the first one did
            // — a preview is decoration and a Host without one still plays.
            let previewer: Arc<dyn host_core::Previewer> =
                Arc::new(host_mpv::MpvPreviewer::start());

            let stremio = Arc::new(HttpStremio::new());
            let host = Host::new(
                Arc::new(store),
                fetcher.clone(),
                secrets.into(),
                Arc::new(AddonProvider::new(fetcher)),
                player,
                Arc::new(host_core::SystemClock),
            )?
            .with_previewer(previewer)
            .with_stremio(stremio);

            app.manage(ipc::HostHandle::new(host));
            // Held, not read: the guard inside keeps the log writer alive for as
            // long as the Host runs.
            app.manage(Mutex::new(logs));

            // Where remote clients reach the Host (#31): the wire server over the
            // one Action surface, the Snapshots it pushes, and the mDNS
            // announcement that saves typing an address. A machine that cannot
            // bind, or cannot announce itself, still browses — the window says so
            // and manual `host:port` is the fallback.
            let broadcast = host_wire::Broadcast::new();
            app.manage(broadcast.clone());
            match wire::start(&handle, broadcast) {
                Ok(serving) => {
                    let wire::Serving {
                        server,
                        advertisement,
                        address,
                    } = serving;
                    tracing::info!(%address, "the Host answers remote clients");
                    handle.state::<ipc::HostHandle>().set_serving(&address);
                    // Held for as long as the Host runs: dropping the server
                    // stops answering, and dropping the announcement stops the
                    // mDNS record.
                    app.manage(server);
                    if let Some(advertisement) = advertisement {
                        app.manage(advertisement);
                    }
                }
                Err(error) => {
                    tracing::error!(
                        %error,
                        "the wire server could not start: no remote clients",
                    );
                }
            }

            // On open, remote progress newer than the local record is merged in
            // (#30). Runs in the background so a slow or unreachable Stremio
            // never blocks the window opening.
            let pull_handle = handle.clone();
            std::thread::spawn(move || {
                if let Some(snapshot) = pull_handle.state::<ipc::HostHandle>().pull_remote() {
                    tracing::info!(
                        revision = snapshot.revision,
                        "remote progress pulled into library"
                    );
                    ipc::publish(&pull_handle, &[snapshot]);
                }
            });

            // The Host's clock. Nothing else calls `sample`: playback moves on
            // its own, and this is what turns that into Snapshots every client
            // is sent (ADR-0002's one door, read rather than written).
            let clock = handle.clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(SAMPLE);
                let sampled = clock.state::<ipc::HostHandle>().sample();
                if let Some(snapshot) = sampled {
                    tracing::debug!(revision = snapshot.revision, "playback moved on");
                    ipc::publish(&clock, &[snapshot]);
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("the Host cannot start")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                // What the Host did, not what it hoped: with no Stremio account
                // signed in, `account` is false and nothing was pushed.
                let account = app.state::<ipc::HostHandle>().shutdown();
                tracing::info!(account, "the Host is exiting; the last position is saved");
            }
        });
}
