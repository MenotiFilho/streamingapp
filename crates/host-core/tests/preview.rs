//! The Seek preview, driven the way a client drives it: a moment in, a still
//! out — and the brakes that decide whether a still may be asked for at all.
//!
//! Nothing here reaches mpv: the seam is [`FixturePreviewer`], so what is tested
//! is the Host's own rules — the eighth Question, the arm at a Stream's open, the
//! ceiling the Player's first report decides, and the silence of a preview that
//! cannot be produced (ADR-0028).

use std::sync::Arc;

use host_core::{
    Action, ActionError, AddonProvider, FixtureClock, FixtureFetcher, FixturePlayer,
    FixturePreviewer, Host, InMemorySecretStore, InMemoryStore, Observation, PlaybackState,
    Previewer, SecretBackend, Statistics, Store, ACTION_VERSION, PREVIEW_BITRATE_GRACE_MS,
};

/// The URL a recorded debrid answer would carry, with a session in it: the one
/// thing about a Stream that must never travel outward.
const CHOSEN: &str = "https://stream.example.org/v/tt0133093-1080p?token=SECRETSESSION";

/// A Host over an empty store, with a Player and a previewer whose other ends
/// the test holds.
struct Fixture {
    host: Host,
    player: Arc<FixturePlayer>,
    previewer: Arc<FixturePreviewer>,
    /// The Host's own clock, so the moment a Stream is given to state its
    /// bitrate is a fact a test decides.
    clock: Arc<FixtureClock>,
}

fn fixture() -> Fixture {
    fixture_over(Arc::new(FixturePreviewer::new()))
}

fn fixture_over(previewer: Arc<FixturePreviewer>) -> Fixture {
    let player = Arc::new(FixturePlayer::new());
    let fetcher = Arc::new(FixtureFetcher::new());
    let provider = Arc::new(AddonProvider::new(fetcher.clone()));
    let clock = Arc::new(FixtureClock::new());
    let host = Host::new(
        Arc::new(InMemoryStore::new()) as Arc<dyn Store>,
        fetcher,
        Arc::new(InMemorySecretStore::backed_by(SecretBackend::Keyring)),
        provider,
        player.clone(),
        clock.clone(),
    )
    .expect("a Host over a store starts")
    .with_previewer(previewer.clone() as Arc<dyn Previewer>);

    Fixture {
        host,
        player,
        previewer,
        clock,
    }
}

/// An Action as a client sends it: the versioned envelope, as JSON text.
fn action(body: &serde_json::Value) -> Action {
    let envelope = format!(r#"{{"version":{ACTION_VERSION},"action":{body}}}"#);
    Action::parse(&envelope).unwrap_or_else(|error| panic!("{envelope} should parse: {error}"))
}

/// What a client sends when it chooses a candidate.
fn a_chosen_stream() -> serde_json::Value {
    serde_json::json!({
        "type": "play_stream",
        "video": { "type": "movie", "id": "tt0133093" },
        "addon": "community.aiostreams",
        "title": {
            "addon": "com.linvo.cinemeta",
            "id": "tt0133093",
            "type": "movie",
            "name": "The Matrix",
            "poster": "https://images.example.org/matrix.jpg",
        },
        "stream": {
            "name": "AIOStreams\n1080p",
            "playback": { "kind": "direct", "url": CHOSEN },
            "warnings": [],
        },
    })
}

/// The report a Player gives once a Stream is up, saying what the Stream costs
/// — which is what the ceiling is decided from.
fn report(bitrate: Option<u64>) -> Observation {
    Observation {
        state: PlaybackState::Playing,
        position: Some(12.5),
        duration: Some(600.0),
        statistics: Some(Statistics {
            bitrate,
            dropped_frames: Some(0),
            hardware_decode: Some("no".to_owned()),
        }),
        ..Observation::idle()
    }
}

/// A Host with a candidate chosen, the Player reporting what the Stream costs,
/// and one sampling tick taken — the first report, which is where the ceiling is
/// decided.
fn playing(bitrate: Option<u64>) -> Fixture {
    let mut fixture = fixture();
    fixture
        .host
        .dispatch(action(&a_chosen_stream()))
        .expect("choosing a playable candidate should work");
    fixture.player.now_reporting(report(bitrate));
    fixture
        .host
        .sample()
        .expect("the Player's first report is a change");
    fixture
}

/// The answer to one preview ask.
fn preview(fixture: &mut Fixture, at: f64) -> host_core::Response {
    fixture
        .host
        .dispatch(action(&serde_json::json!({ "type": "preview", "at": at })))
        .unwrap_or_else(|error| panic!("a preview at {at} should be taken: {error}"))
}

#[test]
fn a_preview_is_answered_to_the_client_that_asked_and_publishes_nothing() {
    let mut fixture = playing(Some(8_000_000));
    let before = fixture.host.snapshot();

    let response = preview(&mut fixture, 42.5);

    assert!(
        response.snapshots.is_empty(),
        "a Question publishes no Snapshot: {:?}",
        response.snapshots
    );
    let (at, image) = response.preview().expect("a preview answer");
    assert_eq!(at, 42.5, "the answer echoes the moment asked about");
    assert!(
        image.is_some_and(|image| image.starts_with("data:image/jpeg;base64,")),
        "the still is a JPEG a client can draw"
    );
    assert_eq!(
        fixture.host.snapshot().revision,
        before.revision,
        "a Question moves no revision"
    );
}

#[test]
fn the_stream_is_armed_when_it_opens_and_the_url_never_travels_outward() {
    let fixture = playing(Some(8_000_000));

    assert_eq!(
        fixture.previewer.armings(),
        vec![CHOSEN.to_owned()],
        "the URL the Player was given is the one the previewer is armed with"
    );
    let published = serde_json::to_string(&fixture.host.snapshot()).expect("a Snapshot is JSON");
    assert!(
        !published.contains("SECRETSESSION"),
        "a Stream URL is a credential and no Snapshot carries it: {published}"
    );
}

#[test]
fn a_second_ask_for_the_same_bucket_is_served_without_another_capture() {
    let mut fixture = playing(Some(8_000_000));

    let first = preview(&mut fixture, 42.0);
    let second = preview(&mut fixture, 43.9);

    assert_eq!(
        first.preview().expect("a preview answer").1,
        second.preview().expect("a preview answer").1,
        "43.9 s is the same five-second bucket as 42 s"
    );
    assert_eq!(fixture.previewer.asks(), 2);
    assert_eq!(
        fixture.previewer.captures(),
        1,
        "the second ask cost no seek: the bucket was already in memory"
    );
}

#[test]
fn two_buckets_are_two_moments_and_two_pictures() {
    let mut fixture = playing(Some(8_000_000));

    let first = preview(&mut fixture, 42.0);
    let second = preview(&mut fixture, 48.0);

    assert_ne!(
        first.preview().expect("a preview answer").1,
        second.preview().expect("a preview answer").1,
        "a still of one moment is not a still of another"
    );
    assert_eq!(fixture.previewer.captures(), 2);
}

#[test]
fn a_previewer_that_cannot_answer_leaves_the_answer_empty_and_playback_untouched() {
    let mut fixture = fixture_over(Arc::new(FixturePreviewer::new().refusing()));
    fixture
        .host
        .dispatch(action(&a_chosen_stream()))
        .expect("choosing a playable candidate should work");
    fixture.player.now_reporting(report(Some(8_000_000)));
    fixture.host.sample().expect("the first report is a change");
    let before = fixture.host.snapshot();

    let response = preview(&mut fixture, 42.0);

    assert_eq!(
        response.preview(),
        Some((42.0, None)),
        "a still that cannot be produced is an absent picture, not a failure"
    );
    assert!(response.snapshots.is_empty());
    assert_eq!(
        fixture.host.snapshot(),
        before,
        "nothing about playback or the Snapshot moved"
    );
}

#[test]
fn a_stream_above_the_ceiling_is_disarmed_on_its_first_report() {
    let mut fixture = playing(Some(25_000_000));

    assert_eq!(
        fixture.previewer.disarms(),
        1,
        "a Stream too dear to ask twice is let go of before a still is asked for"
    );
    assert_eq!(
        preview(&mut fixture, 42.0).preview(),
        Some((42.0, None)),
        "nothing is answered for a Stream that may not be previewed"
    );
}

#[test]
fn a_stream_whose_bitrate_nobody_states_is_given_a_moment_and_then_disarmed() {
    let mut fixture = playing(None);
    assert_eq!(
        fixture.previewer.disarms(),
        0,
        "the report that says a file has loaded is not yet a report about its cost"
    );

    fixture.clock.tick(PREVIEW_BITRATE_GRACE_MS);
    fixture.host.sample();

    assert_eq!(
        fixture.previewer.disarms(),
        1,
        "a Stream that still will not say what it costs is not one to gamble on"
    );
    assert_eq!(preview(&mut fixture, 42.0).preview(), Some((42.0, None)));
}

#[test]
fn a_preview_asked_before_the_ceiling_is_settled_asks_no_worker() {
    let mut fixture = fixture();
    fixture
        .host
        .dispatch(action(&a_chosen_stream()))
        .expect("choosing a playable candidate should work");

    // Nothing has reported yet: the gate is Waiting, and Waiting is not a yes.
    let response = preview(&mut fixture, 42.0);

    assert_eq!(response.preview(), Some((42.0, None)));
    assert_eq!(
        fixture.previewer.asks(),
        0,
        "the second connection is not opened for a question the ceiling has not allowed"
    );

    fixture.player.now_reporting(report(Some(8_000_000)));
    fixture.host.sample();
    assert!(
        preview(&mut fixture, 42.0)
            .preview()
            .expect("a preview answer")
            .1
            .is_some(),
        "once the report says the Stream is affordable, the still is asked for"
    );
}

#[test]
fn a_stream_under_the_ceiling_stays_armed_and_a_later_report_does_not_redecide() {
    let mut fixture = playing(Some(8_000_000));
    assert_eq!(fixture.previewer.disarms(), 0);

    // A later report says nothing about the bitrate: the decision was taken at
    // the first report, and a measurement that is not there does not undo it.
    fixture.player.now_reporting(report(None));
    fixture.host.sample();

    assert_eq!(fixture.previewer.disarms(), 0);
    assert!(preview(&mut fixture, 42.0)
        .preview()
        .expect("a preview answer")
        .1
        .is_some());
}

#[test]
fn a_new_stream_is_armed_and_decided_again() {
    let mut fixture = playing(Some(8_000_000));
    assert_eq!(fixture.previewer.armings().len(), 1);

    fixture
        .host
        .dispatch(action(&serde_json::json!({ "type": "stop_playback" })))
        .expect("a Stream that is playing can be stopped");
    assert_eq!(fixture.previewer.disarms(), 1, "a stop lets the URL go");

    fixture
        .host
        .dispatch(action(&a_chosen_stream()))
        .expect("a second Stream plays");
    assert_eq!(fixture.previewer.armings().len(), 2);

    fixture.player.now_reporting(report(Some(30_000_000)));
    fixture.host.sample();
    assert_eq!(
        fixture.previewer.disarms(),
        2,
        "the second Stream's own report is what decides for it"
    );
}

#[test]
fn a_preview_answer_travels_as_the_window_and_the_remote_read_it() {
    let mut fixture = playing(Some(8_000_000));

    let response = preview(&mut fixture, 42.0);
    let json = serde_json::to_value(&response).expect("a Response is JSON");

    assert_eq!(
        json["answer"]["preview"]["at"], 42.0,
        "one externally tagged answer, as every other Answer is: {json}"
    );
    assert!(
        json["answer"]["preview"]["image"]
            .as_str()
            .is_some_and(|image| image.starts_with("data:image/jpeg;base64,")),
        "the still is the data URL both clients draw: {json}"
    );
    assert!(
        json["snapshots"].as_array().is_some_and(Vec::is_empty),
        "and it publishes nothing: {json}"
    );
}

#[test]
fn a_moment_that_is_not_a_number_of_seconds_is_refused_before_a_worker_hears_of_it() {
    let mut fixture = playing(Some(8_000_000));
    let refused = fixture
        .host
        .dispatch(Action::Preview { at: f64::NAN })
        .expect_err("a NaN is not a moment");

    assert!(
        matches!(refused, ActionError::InvalidPreviewAt(_)),
        "a moment a worker could not seek to is refused: {refused:?}"
    );
    assert_eq!(
        fixture.previewer.asks(),
        0,
        "the worker is never asked about a moment that is not one"
    );

    let negative = fixture
        .host
        .dispatch(Action::Preview { at: -1.0 })
        .expect_err("a negative second is not a moment");
    assert!(matches!(negative, ActionError::InvalidPreviewAt(_)));
}

#[test]
fn a_host_with_no_previewer_answers_with_nothing_rather_than_failing() {
    let player = Arc::new(FixturePlayer::new());
    let fetcher = Arc::new(FixtureFetcher::new());
    let provider = Arc::new(AddonProvider::new(fetcher.clone()));
    let mut host = Host::new(
        Arc::new(InMemoryStore::new()) as Arc<dyn Store>,
        fetcher,
        Arc::new(InMemorySecretStore::backed_by(SecretBackend::Keyring)),
        provider,
        player,
        Arc::new(FixtureClock::new()),
    )
    .expect("a Host over a store starts");

    let response = host
        .dispatch(action(
            &serde_json::json!({ "type": "preview", "at": 42.0 }),
        ))
        .expect("a Host without a previewer still answers");

    assert_eq!(response.preview(), Some((42.0, None)));
    assert!(response.snapshots.is_empty());
}
