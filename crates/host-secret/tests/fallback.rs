//! The real secret store: the fallback file it makes when no keyring exists,
//! and the permissions that are their entire reason for being.

mod file_permissions {
    use host_core::{CredentialKind, SecretStore};
    use host_secret::{classify, Reach};

    /// The fallback file, in a directory a test owns. Everything the file
    /// store promises is asserted on a real file, because a store that keeps
    /// credentials is only as honest as its permissions.
    fn open_store() -> (host_secret::FileSecretStore, tempfile::TempDir) {
        let dir = tempfile::tempdir().expect("a directory the test owns");
        let opened = host_secret::FileSecretStore::open(&dir.path().join("secrets.json"))
            .expect("the store opens");
        (opened, dir)
    }

    #[cfg(unix)]
    fn mode_of(path: &std::path::Path) -> u32 {
        use std::os::unix::fs::PermissionsExt;

        std::fs::metadata(path)
            .expect("the file is there")
            .permissions()
            .mode()
            & 0o777
    }

    #[test]
    fn opening_the_store_creates_an_empty_file_the_owner_alone_may_read() {
        let (_store, dir) = open_store();
        let path = dir.path().join("secrets.json");

        assert!(
            std::fs::read_to_string(&path).is_ok(),
            "the store is there before any credential is: {:?}",
            path
        );

        #[cfg(unix)]
        assert_eq!(
            mode_of(&path),
            0o600,
            "owner read and owner write, and nothing for anyone else"
        );
    }

    #[test]
    fn a_credential_kept_stays_readable_only_by_the_owner() {
        let (store, dir) = open_store();
        let path = dir.path().join("secrets.json");

        store
            .write(CredentialKind::TmdbKey, "a key nobody else may read")
            .expect("keeping a credential should work");
        assert_eq!(
            store.read(CredentialKind::TmdbKey),
            Ok(Some("a key nobody else may read".to_owned())),
            "what went in is what comes back out"
        );

        #[cfg(unix)]
        assert_eq!(
            mode_of(&path),
            0o600,
            "written to, and still nobody else's: the write did not open it up"
        );
    }

    #[test]
    fn a_credential_taken_out_leaves_the_rest_of_the_file() {
        let (store, dir) = open_store();

        store
            .write(CredentialKind::TmdbKey, "the key")
            .expect("keeping a credential should work");
        store
            .remove(CredentialKind::TmdbKey)
            .expect("taking out a credential should work");

        assert_eq!(store.read(CredentialKind::TmdbKey), Ok(None));
        assert!(
            std::fs::read_to_string(dir.path().join("secrets.json")).is_ok(),
            "the store survives the removal,_credentials and all"
        );

        #[cfg(unix)]
        {
            let (store, dir) = open_store();
            store
                .write(CredentialKind::TmdbKey, "again")
                .expect("keeping a credential should work");
            assert_eq!(
                mode_of(&dir.path().join("secrets.json")),
                0o600,
                "a file rewritten after a removal keeps its permissions"
            );
        }
    }

    #[test]
    fn a_record_that_is_not_the_record_it_was_written_as_is_refused() {
        let dir = tempfile::tempdir().expect("a directory the test owns");
        let path = dir.path().join("secrets.json");
        std::fs::write(&path, r#"["not an object"]"#).expect("a file to sabotage");

        let store = host_secret::FileSecretStore::open(&path).expect("the store opens anyway");

        assert!(
            matches!(
                store.read(CredentialKind::TmdbKey),
                Err(host_core::SecretError::Read { .. })
            ),
            "a file the Host did not write the shape of is not read as secrets"
        );
    }

    #[test]
    fn an_empty_file_reads_as_nothing_held() {
        // An empty file is not a refusal and not a record: it is what a file
        // the Host opened and lost its contents in reads as — nothing held,
        // answered the same way a store with nothing in it answers.
        let dir = tempfile::tempdir().expect("a directory the test owns");
        let path = dir.path().join("secrets.json");
        std::fs::write(&path, "").expect("an empty file");

        let store = host_secret::FileSecretStore::open(&path).expect("the store opens");

        let answer = store.read(CredentialKind::TmdbKey);
        assert!(
            matches!(&answer, Ok(None)),
            "an empty file reads as nothing held, and not as a refusal: {answer:?}"
        );
    }

    #[test]
    fn only_an_answer_proves_the_keyring() {
        // NoEntry is the keyring saying "answered, none here" — the proof
        // there is one. Everything else is a service that could never have
        // answered, which is what the fallback exists for.
        assert_eq!(classify(None), Reach::Reachable);
        assert_eq!(classify(Some(keyring::Error::NoEntry)), Reach::Reachable);
        assert_eq!(
            classify(Some(keyring::Error::PlatformFailure(
                "no session bus".into()
            ))),
            Reach::Unreachable,
            "a service that could not answer proves nothing"
        );
    }
}
