//! Pairing and revocation, driven the way a remote client drives them: an Action
//! in, published Snapshots and a correlated answer out. Nothing below the Action
//! surface is named here.

use std::sync::Arc;

use host_core::{
    Action, ActionError, AddonProvider, Answer, DeviceSummary, DeviceToken, FixtureClock,
    FixtureFetcher, FixturePlayer, Host, InMemorySecretStore, InMemoryStore, Store, ACTION_VERSION,
};

/// An Action as a client sends it: the versioned envelope, as JSON text.
fn action(body: &str) -> Action {
    let envelope = format!(r#"{{"version":{ACTION_VERSION},"action":{body}}}"#);
    Action::parse(&envelope).unwrap_or_else(|error| panic!("{envelope} should parse: {error}"))
}

fn host_over(store: Arc<dyn Store>) -> Host {
    let fetcher = Arc::new(FixtureFetcher::new());
    let provider = Arc::new(AddonProvider::new(fetcher.clone()));
    Host::new(
        store,
        fetcher,
        Arc::new(InMemorySecretStore::new()),
        provider,
        Arc::new(FixturePlayer::new()),
        Arc::new(FixtureClock::new()),
    )
    .expect("a Host over a store starts")
}

/// The one thing a connection that has not paired knows: the code the Host is
/// showing.
fn shown_code(host: &Host) -> String {
    host.snapshot().pairing_code.as_str().to_owned()
}

/// Pair a device the way a client does, and hand back the device and the token
/// the Host answered with.
fn pair(host: &mut Host, name: &str) -> (DeviceSummary, DeviceToken) {
    let code = shown_code(host);
    let response = host
        .dispatch(action(&format!(
            r#"{{"type":"pair_device","code":"{code}","name":"{name}"}}"#
        )))
        .expect("the code the Host is showing pairs a device");

    assert_eq!(
        response.snapshots.len(),
        1,
        "a pairing is a change: every client is told the device joined"
    );
    match response.answer {
        Some(Answer::Paired { device, token }) => (device, token),
        other => panic!("a pairing answers with the device and its token: {other:?}"),
    }
}

#[test]
fn the_host_shows_a_code_and_redeeming_it_issues_a_token_for_that_device() {
    let mut host = host_over(Arc::new(InMemoryStore::new()));
    let code = shown_code(&host);
    assert_eq!(code.chars().count(), 6);

    let (device, token) = pair(&mut host, "Phone");
    assert_eq!(device.name.as_str(), "Phone");

    // The token is the device's: the Host answers the one that asked, and knows
    // the token from then on without ever holding it.
    assert_eq!(host.device(token.as_str()), Some(device.clone()));

    let published = host.snapshot();
    assert_eq!(published.devices, vec![device.clone()]);
    assert_ne!(
        published.pairing_code.as_str(),
        code,
        "redeeming the code spends it: the Host shows a new one"
    );
}

#[test]
fn a_code_that_is_not_the_one_showing_pairs_nothing() {
    let mut host = host_over(Arc::new(InMemoryStore::new()));
    let code = shown_code(&host);
    let other = if code == "AAAAAA" { "BBBBBB" } else { "AAAAAA" };

    let refused = host
        .dispatch(action(&format!(
            r#"{{"type":"pair_device","code":"{other}","name":"Phone"}}"#
        )))
        .expect_err("a code the Host is not showing pairs nothing");

    assert_eq!(refused, ActionError::Pairing);
    assert!(host.snapshot().devices.is_empty());
    assert_eq!(
        shown_code(&host),
        code,
        "a refusal spends nothing: the Host shows the same code"
    );
}

#[test]
fn a_redeemed_code_is_spent_rather_than_reusable() {
    let mut host = host_over(Arc::new(InMemoryStore::new()));
    let code = shown_code(&host);
    pair(&mut host, "Phone");

    let refused = host
        .dispatch(action(&format!(
            r#"{{"type":"pair_device","code":"{code}","name":"Laptop"}}"#
        )))
        .expect_err("the code was already redeemed");

    assert_eq!(refused, ActionError::Pairing);
    assert_eq!(host.snapshot().devices.len(), 1);
}

#[test]
fn revoking_one_device_cuts_it_off_and_leaves_the_others_working() {
    let mut host = host_over(Arc::new(InMemoryStore::new()));
    let (phone, phone_token) = pair(&mut host, "Phone");
    let (television, television_token) = pair(&mut host, "Television");

    // Both are in: each token names its own device and no other.
    assert_eq!(host.device(phone_token.as_str()), Some(phone.clone()));
    assert_eq!(
        host.device(television_token.as_str()),
        Some(television.clone())
    );

    host.dispatch(action(&format!(
        r#"{{"type":"revoke_device","id":"{}"}}"#,
        phone.id
    )))
    .expect("revoking a paired device is a change the Host takes");

    assert_eq!(
        host.device(phone_token.as_str()),
        None,
        "a revoked device's token matches nothing"
    );
    assert_eq!(
        host.device(television_token.as_str()),
        Some(television.clone()),
        "the other device is untouched"
    );
    assert_eq!(host.snapshot().devices, vec![television]);
}

#[test]
fn revoking_a_device_that_is_not_paired_is_refused_by_name() {
    let mut host = host_over(Arc::new(InMemoryStore::new()));

    let refused = host
        .dispatch(action(r#"{"type":"revoke_device","id":"deadbeef"}"#))
        .expect_err("no such device is paired");

    assert_eq!(
        refused,
        ActionError::UnknownDevice {
            id: "deadbeef".to_owned()
        }
    );
}

#[test]
fn a_paired_device_survives_a_host_that_was_restarted() {
    let store = Arc::new(InMemoryStore::new());
    let mut host = host_over(store.clone());
    let (device, token) = pair(&mut host, "Phone");
    drop(host);

    // A Host over the same store is a Host that was restarted: the device is
    // still paired, its token still names it, and the code is a fresh one nobody
    // was reading a screen for.
    let reopened = host_over(store);
    assert_eq!(reopened.device(token.as_str()), Some(device.clone()));
    assert_eq!(reopened.snapshot().devices, vec![device]);
}

#[test]
fn a_store_that_refuses_the_write_leaves_the_device_unpaired() {
    let store = Arc::new(InMemoryStore::new());
    let mut host = host_over(store.clone());
    let code = shown_code(&host);
    store.failing_writes();

    let refused = host
        .dispatch(action(&format!(
            r#"{{"type":"pair_device","code":"{code}","name":"Phone"}}"#
        )))
        .expect_err("the store refused the write");

    assert!(matches!(refused, ActionError::Store { .. }));
    assert!(host.snapshot().devices.is_empty());
    assert_eq!(
        shown_code(&host),
        code,
        "a pairing the store refused spent no code"
    );
}

#[test]
fn a_pairing_answers_with_the_device_and_the_token_under_one_name() {
    let mut host = host_over(Arc::new(InMemoryStore::new()));
    let code = shown_code(&host);
    let response = host
        .dispatch(action(&format!(
            r#"{{"type":"pair_device","code":"{code}","name":"Phone"}}"#
        )))
        .expect("the code pairs a device");

    let wire = serde_json::to_value(response).expect("a Response serializes");
    let answer = &wire["answer"]["paired"];
    assert_eq!(answer["device"]["name"], "Phone");
    assert_eq!(
        answer["token"].as_str().map(str::len),
        Some(43),
        "the token a client stores is the base64url spelling of 256 bits"
    );
    assert!(
        wire["snapshots"][0]["devices"][0].get("token").is_none()
            && wire["snapshots"][0].get("token").is_none(),
        "the Snapshot carries the device and never the token: {wire}"
    );
}

#[test]
fn the_refusals_a_remote_client_reads_name_their_own_kinds() {
    let refused = [
        ActionError::Pairing,
        ActionError::Unpaired,
        ActionError::UnknownDevice {
            id: "deadbeef".to_owned(),
        },
    ];
    let kinds: Vec<String> = refused
        .iter()
        .map(|error| {
            serde_json::to_value(error).expect("a refusal serializes")["kind"]
                .as_str()
                .expect("a refusal names a kind")
                .to_owned()
        })
        .collect();

    assert_eq!(kinds, vec!["pairing", "unpaired", "unknown_device"]);
}
