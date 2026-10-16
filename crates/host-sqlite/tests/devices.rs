//! Paired devices through the store: a round trip, the order they paired, and
//! the fact that what is stored is a digest rather than a token. Driven through
//! the `Store` seam, so nothing here names a table or a column.

use host_core::{Device, DeviceId, DeviceName, DeviceToken, Store, TokenDigest};
use host_sqlite::SqliteStore;

fn device(id: &str, name: &str, at: i64) -> Device {
    Device::read(
        DeviceId::parse(id).expect("a device id"),
        DeviceName::parse(name).expect("a device name"),
        TokenDigest::parse(&"a".repeat(64)).expect("a digest"),
        at,
    )
}

#[test]
fn a_paired_device_round_trips_through_the_store() {
    let store = SqliteStore::open_in_memory().expect("an in-memory store opens");
    let written = device("phone1", "Phone", 1_700_000_000_000);

    store
        .write_device(&written)
        .expect("the store takes a paired device");

    assert_eq!(
        store.read_devices().expect("the store reads back"),
        vec![written],
        "every field the Host wrote is the field it reads"
    );
}

#[test]
fn devices_read_back_in_the_order_they_paired() {
    let store = SqliteStore::open_in_memory().expect("an in-memory store opens");
    for (id, name, at) in [
        ("phone1", "Phone", 1_000),
        ("tv1", "Television", 2_000),
        ("laptop1", "Laptop", 3_000),
    ] {
        store
            .write_device(&device(id, name, at))
            .expect("the store takes a paired device");
    }

    let names: Vec<String> = store
        .read_devices()
        .expect("the store reads back")
        .into_iter()
        .map(|device| device.name().as_str().to_owned())
        .collect();

    assert_eq!(names, ["Phone", "Television", "Laptop"]);
}

#[test]
fn a_revoked_device_is_gone_from_the_store() {
    let store = SqliteStore::open_in_memory().expect("an in-memory store opens");
    store
        .write_device(&device("phone1", "Phone", 1_000))
        .expect("the store takes a paired device");
    let id = DeviceId::parse("phone1").expect("a device id");

    store.remove_device(&id).expect("the store drops the row");

    assert!(store
        .read_devices()
        .expect("the store reads back")
        .is_empty());
}

#[test]
fn what_the_store_keeps_is_a_digest_and_never_the_token() {
    let store = SqliteStore::open_in_memory().expect("an in-memory store opens");
    // A token a real pairing would have issued, digested: the digest is what a
    // device row carries, so the token itself is nowhere in the database.
    let token = DeviceToken::parse(&"b".repeat(43)).expect("a device token");
    let written = Device::read(
        DeviceId::parse("phone1").expect("a device id"),
        DeviceName::parse("Phone").expect("a device name"),
        token.digest(),
        1_000,
    );

    store
        .write_device(&written)
        .expect("the store takes a paired device");

    let held = store.read_devices().expect("the store reads back");
    assert_eq!(held[0].digest(), &token.digest());
    assert!(
        !held[0].matches(&DeviceToken::parse(&"c".repeat(43)).expect("another token")),
        "the digest is what is kept, and it matches only the token it came from"
    );
}

#[test]
fn a_device_written_again_replaces_its_row_rather_than_repeating_it() {
    let store = SqliteStore::open_in_memory().expect("an in-memory store opens");
    store
        .write_device(&device("phone1", "Phone", 1_000))
        .expect("the store takes a paired device");

    // The same id paired again: a device that came back, under a new token.
    store
        .write_device(&Device::read(
            DeviceId::parse("phone1").expect("a device id"),
            DeviceName::parse("Phone again").expect("a device name"),
            TokenDigest::parse(&"c".repeat(64)).expect("a digest"),
            2_000,
        ))
        .expect("the store takes the device again");

    let held = store.read_devices().expect("the store reads back");
    assert_eq!(held.len(), 1);
    assert_eq!(held[0].name().as_str(), "Phone again");
}

#[test]
fn a_row_whose_digest_is_not_a_digest_is_unreadable_rather_than_a_device() {
    // The store is a seam: a Host reading a row it would not have written must
    // hear about it rather than silently pairing something it cannot match. The
    // row is written behind the seam's back, which is exactly the corruption
    // this guards against.
    let directory = tempfile::tempdir().expect("a temporary directory");
    let path = directory.path().join("host.sqlite3");
    let store = SqliteStore::open(&path).expect("a store opens");
    store
        .write_device(&device("phone1", "Phone", 1_000))
        .expect("the store takes a paired device");
    drop(store);

    let connection = rusqlite::Connection::open(&path).expect("the database opens");
    connection
        .execute("UPDATE devices SET token_digest = 'not a digest'", [])
        .expect("the row is corrupted behind the seam");

    let store = SqliteStore::open(&path).expect("the store opens again");
    let refused = store.read_devices();
    assert!(
        matches!(refused, Err(host_core::StoreError::Read { .. })),
        "a digest this Host would not have written is reported, not read: {refused:?}"
    );
}
