//! Where the engine is and where it keeps its torrents: the two facts the app
//! shell needs to construct it, decided here so they are tested without a window.

use std::io;
use std::path::{Path, PathBuf};

/// The engine's file name beside the Host's executable: `streamingapp-torrent.exe`
/// on Windows, `streamingapp-torrent` elsewhere.
pub const ENGINE_FILE: &str = if cfg!(windows) {
    "streamingapp-torrent.exe"
} else {
    "streamingapp-torrent"
};

/// The directory of the Host's local data in which the engine keeps its torrents.
const TORRENTS_DIR: &str = "torrents";

/// Where a Host whose local data directory is `local_data_dir` keeps the torrents
/// it holds: one directory per torrent, named by its infoHash. Handed to the
/// engine as `--torrents-dir`.
pub fn torrents_dir(local_data_dir: &Path) -> PathBuf {
    local_data_dir.join(TORRENTS_DIR)
}

/// The engine's binary for a Host running as `executable`: the one beside it.
///
/// `dev_layout` also looks where `engine/build.sh` leaves the native build for a
/// `cargo run` in the dev container — `target/torrent/`, a sibling of
/// `target/debug/` — and is for debug builds only, so an installed Host looks in
/// one place. `None` when the binary is absent, and the shell then plays no
/// torrents rather than failing to start.
pub fn locate(executable: &Path, dev_layout: bool) -> Option<PathBuf> {
    let directory = executable.parent()?;
    let mut candidates = vec![directory.join(ENGINE_FILE)];
    if dev_layout {
        if let Some(target) = directory.parent() {
            candidates.push(target.join("torrent").join(ENGINE_FILE));
        }
    }
    candidates.into_iter().find(|candidate| candidate.is_file())
}

/// Remove the torrents directory a Host that did not get to let its torrents go
/// — one killed, or whose machine lost power — left behind.
///
/// Run at startup before the engine is constructed, whether or not a torrent is
/// ever played: nothing a torrent holds outlives its Stream (ADR-0042 §3), and
/// single-instance behaviour means no other Host's engine is using it. A
/// directory that is not there is nothing to remove, not an error.
pub fn wipe(torrents_dir: &Path) -> io::Result<()> {
    let metadata = match std::fs::symlink_metadata(torrents_dir) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    // A link is removed as the link it is, never followed into what it points at.
    if metadata.is_dir() {
        std::fs::remove_dir_all(torrents_dir)
    } else {
        std::fs::remove_file(torrents_dir)
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    #[test]
    fn the_torrents_directory_is_named_torrents_inside_the_local_data_directory() {
        assert_eq!(
            torrents_dir(Path::new("/data/dev.streamingapp.host")),
            Path::new("/data/dev.streamingapp.host/torrents")
        );
    }

    #[test]
    fn the_wipe_removes_every_torrent_a_killed_host_left_and_the_directory_itself() {
        let local = tempfile::tempdir().unwrap();
        let torrents = torrents_dir(local.path());
        fs::create_dir_all(torrents.join("c12fe1c06bba254a9dc9f519b335aa7c1367a88a")).unwrap();
        fs::write(
            torrents.join("c12fe1c06bba254a9dc9f519b335aa7c1367a88a/piece"),
            b"x",
        )
        .unwrap();
        fs::create_dir_all(torrents.join("leftover")).unwrap();
        fs::write(torrents.join("stray-file"), b"x").unwrap();

        wipe(&torrents).unwrap();

        assert!(!torrents.exists());
    }

    #[test]
    fn the_wipe_leaves_what_is_beside_the_torrents_directory() {
        let local = tempfile::tempdir().unwrap();
        fs::write(local.path().join("host.sqlite3"), b"keep").unwrap();
        fs::create_dir_all(torrents_dir(local.path()).join("a")).unwrap();

        wipe(&torrents_dir(local.path())).unwrap();

        assert_eq!(
            fs::read(local.path().join("host.sqlite3")).unwrap(),
            b"keep"
        );
    }

    #[test]
    fn a_wipe_with_nothing_to_wipe_is_not_an_error() {
        let local = tempfile::tempdir().unwrap();

        assert!(wipe(&torrents_dir(local.path())).is_ok());
        assert!(wipe(&torrents_dir(local.path())).is_ok(), "and again");
    }

    #[test]
    fn a_torrents_path_that_is_a_file_is_removed_too() {
        let local = tempfile::tempdir().unwrap();
        let torrents = torrents_dir(local.path());
        fs::write(&torrents, b"not a directory").unwrap();

        wipe(&torrents).unwrap();

        assert!(!torrents.exists());
    }

    #[cfg(unix)]
    #[test]
    fn a_link_is_removed_without_touching_what_it_points_at() {
        let local = tempfile::tempdir().unwrap();
        let elsewhere = tempfile::tempdir().unwrap();
        fs::write(elsewhere.path().join("precious"), b"keep").unwrap();
        let torrents = torrents_dir(local.path());
        std::os::unix::fs::symlink(elsewhere.path(), &torrents).unwrap();

        wipe(&torrents).unwrap();

        assert!(fs::symlink_metadata(&torrents).is_err());
        assert_eq!(
            fs::read(elsewhere.path().join("precious")).unwrap(),
            b"keep"
        );
    }

    #[test]
    fn the_engine_is_the_binary_beside_the_executable() {
        let install = tempfile::tempdir().unwrap();
        let engine = install.path().join(ENGINE_FILE);
        fs::write(&engine, b"binary").unwrap();

        let found = locate(&install.path().join("streamingapp"), false);

        assert_eq!(found, Some(engine));
    }

    #[test]
    fn no_binary_beside_the_executable_is_none() {
        let install = tempfile::tempdir().unwrap();

        assert_eq!(locate(&install.path().join("streamingapp"), false), None);
        // A directory of that name is not a binary.
        fs::create_dir(install.path().join(ENGINE_FILE)).unwrap();
        assert_eq!(locate(&install.path().join("streamingapp"), false), None);
    }

    #[test]
    fn the_dev_layout_finds_the_native_build_beside_the_debug_directory() {
        let target = tempfile::tempdir().unwrap();
        fs::create_dir_all(target.path().join("debug")).unwrap();
        fs::create_dir_all(target.path().join("torrent")).unwrap();
        let engine = target.path().join("torrent").join(ENGINE_FILE);
        fs::write(&engine, b"binary").unwrap();
        let executable = target.path().join("debug/streamingapp");

        assert_eq!(locate(&executable, true), Some(engine));
        assert_eq!(
            locate(&executable, false),
            None,
            "an installed Host does not look there"
        );
    }

    #[test]
    fn beside_the_executable_wins_over_the_dev_layout() {
        let target = tempfile::tempdir().unwrap();
        fs::create_dir_all(target.path().join("debug")).unwrap();
        fs::create_dir_all(target.path().join("torrent")).unwrap();
        fs::write(target.path().join("torrent").join(ENGINE_FILE), b"dev").unwrap();
        let beside = target.path().join("debug").join(ENGINE_FILE);
        fs::write(&beside, b"beside").unwrap();

        assert_eq!(
            locate(&target.path().join("debug/streamingapp"), true),
            Some(beside)
        );
    }
}
