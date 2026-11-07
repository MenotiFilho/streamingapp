//! Watch progress and the library, driven the way a client drives it: an Action
//! in, published Snapshots out, and the URL the Player was asked to open. The
//! store is the in-memory one, so a "restart" is a second Host over the same
//! store — which is the whole of what "survives a restart" means here. Nothing
//! below the Action surface is named, and no test reaches the network.

use std::sync::Arc;

use host_core::{
    Action, ActionError, FixtureClock, FixtureFetcher, FixturePlayer, FixtureProvider, Host,
    InMemorySecretStore, InMemoryStore, Observation, Playback, PlaybackState, SecretBackend, Store,
    Stream, UnplayableReason, ACTION_VERSION,
};

/// The one Addon these tests configure: it answers `meta` and `stream` for a
/// series, which is what a Title card and a resume are both read from.
const SERIES: &str = "https://series.example.org/manifest.json";
const SERIES_ID: &str = "org.example.series";
const META_URL: &str = "https://series.example.org/meta/series/tt0903747.json";
const SERIES_META: &str = include_str!("fixtures/cinemeta-meta-series.json");

/// The candidate every Video is offered.
const EPISODE: &str = "https://stream.example.org/v/tt0903747.mkv";
const FILM: &str = "https://stream.example.org/v/tt0133093.mkv";

/// An Action as a client sends it: the versioned envelope, as JSON text.
fn action(body: &serde_json::Value) -> Action {
    let envelope = format!(r#"{{"version":{ACTION_VERSION},"action":{body}}}"#);
    Action::parse(&envelope).unwrap_or_else(|error| panic!("{envelope} should parse: {error}"))
}

/// A manifest that answers `meta` and `stream` for films and series.
fn manifest() -> String {
    format!(
        r#"{{"id":"{SERIES_ID}","name":"Series","version":"1.0.0",
             "resources":["meta","stream"],"types":["movie","series"],"catalogs":[]}}"#
    )
}

/// A candidate a direct URL is played as.
fn candidate(url: &str) -> Stream {
    Stream {
        name: Some("1080p".to_owned()),
        description: None,
        playback: Playback::Direct {
            url: url.to_owned(),
        },
        warnings: Vec::new(),
        filename: None,
        binge_group: None,
    }
}

/// A Host over an in-memory store, with the one Addon configured, and the ends
/// a test holds: the Player, the Provider, the store (to restart over) and the
/// clock (to order writes by).
struct Fixture {
    host: Host,
    player: Arc<FixturePlayer>,
    provider: Arc<FixtureProvider>,
    store: Arc<InMemoryStore>,
    clock: Arc<FixtureClock>,
}

fn fixture() -> Fixture {
    fixture_over(Arc::new(InMemoryStore::new()))
}

fn fixture_over(store: Arc<InMemoryStore>) -> Fixture {
    fixture_over_serving(store, SERIES_META)
}

/// A Host whose one series answers with `meta`: a test that needs a list of
/// Videos other than the recorded one serves its own body.
fn fixture_over_serving(store: Arc<InMemoryStore>, meta: &str) -> Fixture {
    let player = Arc::new(FixturePlayer::new());
    let provider = Arc::new(
        FixtureProvider::new().offering(SERIES_ID, vec![candidate(EPISODE), candidate(FILM)]),
    );
    let fetcher = FixtureFetcher::new()
        .serving(SERIES, manifest())
        .serving(META_URL, meta);
    let clock = Arc::new(FixtureClock::new().at(1_000));

    let mut host = Host::new(
        store.clone() as Arc<dyn Store>,
        Arc::new(fetcher),
        Arc::new(InMemorySecretStore::backed_by(SecretBackend::Keyring)),
        provider.clone(),
        player.clone(),
        clock.clone(),
    )
    .expect("a Host over a store starts");

    host.dispatch(action(
        &serde_json::json!({ "type": "add_addon", "url": SERIES }),
    ))
    .expect("configuring the Addon should work");

    Fixture {
        host,
        player,
        provider,
        store,
        clock,
    }
}

/// A Host restarted over the same store with nothing reachable: what an offline
/// start is, with no Addon asked anything.
fn restarted_without_network(store: Arc<InMemoryStore>) -> Host {
    Host::new(
        store as Arc<dyn Store>,
        Arc::new(FixtureFetcher::new()),
        Arc::new(InMemorySecretStore::backed_by(SecretBackend::Keyring)),
        Arc::new(FixtureProvider::new()),
        Arc::new(FixturePlayer::new()),
        Arc::new(FixtureClock::new().at(1_000)),
    )
    .expect("a Host over a store starts")
}

/// Choose a candidate for a Video of the configured Addon, with the Title card
/// a client that was reading it would send.
fn play(fixture: &mut Fixture, r#type: &str, video: &str) {
    let title_id = if r#type == "series" {
        "tt0903747"
    } else {
        "tt0133093"
    };

    fixture
        .host
        .dispatch(action(&serde_json::json!({
            "type": "play_stream",
            "video": { "type": r#type, "id": video },
            "addon": SERIES_ID,
            "title": {
                "addon": SERIES_ID,
                "id": title_id,
                "type": r#type,
                "name": "Breaking Bad",
                "poster": "https://images.example.org/bb.jpg",
                "background": "https://images.example.org/bb-backdrop.jpg",
            },
            "stream": {
                "name": "1080p",
                "playback": { "kind": "direct", "url": EPISODE },
                "warnings": [],
            },
        })))
        .unwrap_or_else(|error| panic!("playing a direct candidate should work: {error}"));
}

/// Report where playback is, and let the Host read it: the tick that records
/// Watch progress.
fn watching(fixture: &mut Fixture, position: f64, duration: f64, at: i64) {
    fixture
        .player
        .now_reporting(Observation::playing(position, duration));
    fixture.clock.set(at);
    fixture
        .host
        .sample()
        .expect("the Player says something new about what is playing");
}

/// Watch progress, per Video, as every client is told it.
fn watch_progress(fixture: &Host) -> Vec<host_core::ResumeEntry> {
    fixture.snapshot().watch_progress
}

/// Continue watching, one card per Title, as every client is told it.
fn continue_watching(fixture: &Host) -> Vec<host_core::ContinueEntry> {
    fixture.snapshot().continue_watching
}

#[test]
fn playing_a_video_records_where_it_got_to_and_the_snapshot_carries_it() {
    let mut fixture = fixture();

    play(&mut fixture, "series", "tt0903747:1:2");
    assert!(
        watch_progress(&fixture.host).len() == 1,
        "a play is a library entry from the moment it is chosen"
    );
    watching(&mut fixture, 402.0, 2820.0, 10_000);

    let entry = &watch_progress(&fixture.host)[0];
    assert_eq!(entry.video.id, "tt0903747:1:2");
    assert_eq!(entry.video.season, Some(1));
    assert_eq!(entry.video.episode, Some(2));
    assert_eq!(entry.title.name(), "Breaking Bad");
    assert_eq!(entry.position, Some(402.0));
    assert_eq!(entry.duration, Some(2820.0));
    assert!(!entry.watched, "a Stream at 402 seconds is not finished");
    assert_eq!(entry.unplayable, None);
}

#[test]
fn the_card_a_client_hands_back_carries_its_backdrop_into_watch_progress() {
    // Continue watching draws 16:9 art (#62), and the client has the backdrop
    // in hand — so the card it sends on `play_stream` is where the Host gets
    // it, and the Snapshot is where every client gets it back.
    let mut fixture = fixture();
    play(&mut fixture, "series", "tt0903747:1:2");
    watching(&mut fixture, 402.0, 2820.0, 10_000);

    let entry = &watch_progress(&fixture.host)[0];
    assert_eq!(
        entry.title.background(),
        Some("https://images.example.org/bb-backdrop.jpg")
    );
    assert_eq!(
        entry.title.poster(),
        Some("https://images.example.org/bb.jpg"),
        "the poster the backdrop falls back from rides beside it"
    );

    let published = serde_json::to_value(fixture.host.snapshot()).expect("a Snapshot serializes");
    assert_eq!(
        published["watchProgress"][0]["title"]["background"],
        "https://images.example.org/bb-backdrop.jpg",
        "the art is published on the Snapshot, camelCased for a JavaScript client"
    );

    // And the Host that comes back over the same store finds it again.
    let restarted = fixture_over(fixture.store.clone());
    assert_eq!(
        watch_progress(&restarted.host)[0].title.background(),
        Some("https://images.example.org/bb-backdrop.jpg"),
        "the backdrop survives a Host that was killed without a stop"
    );
}

#[test]
fn watch_progress_survives_a_host_that_was_killed_without_a_stop() {
    // The point of #29: the position is written *while* playback runs, so a
    // Host that never gets to stop is not a Host that forgot where it was.
    let mut fixture = fixture();
    play(&mut fixture, "series", "tt0903747:1:2");
    watching(&mut fixture, 900.0, 2820.0, 10_000);

    let restarted = fixture_over(fixture.store.clone());

    let entry = &watch_progress(&restarted.host)[0];
    assert_eq!(entry.video.id, "tt0903747:1:2");
    assert_eq!(
        entry.position,
        Some(900.0),
        "the store held the last position the Player reported"
    );
    assert_eq!(
        restarted.host.snapshot().playback.state,
        PlaybackState::Idle,
        "playback itself does not survive; only the progress does"
    );
}

#[test]
fn every_episode_of_a_series_keeps_its_own_progress() {
    let mut fixture = fixture();

    play(&mut fixture, "series", "tt0903747:1:3");
    watching(&mut fixture, 100.0, 2820.0, 10_000);
    play(&mut fixture, "series", "tt0903747:1:4");
    watching(&mut fixture, 200.0, 2820.0, 20_000);

    let mut held: Vec<(String, Option<f64>)> = watch_progress(&fixture.host)
        .iter()
        .map(|entry| (entry.video.id.clone(), entry.position))
        .collect();
    held.sort_by(|one, other| one.0.cmp(&other.0));

    assert_eq!(
        held,
        vec![
            ("tt0903747:1:3".to_owned(), Some(100.0)),
            ("tt0903747:1:4".to_owned(), Some(200.0)),
        ],
        "watching episode 4 did not overwrite episode 3"
    );
}

#[test]
fn watch_progress_comes_back_most_recently_played_first() {
    let mut fixture = fixture();

    play(&mut fixture, "series", "tt0903747:1:1");
    watching(&mut fixture, 100.0, 2820.0, 10_000);
    play(&mut fixture, "series", "tt0903747:1:2");
    watching(&mut fixture, 200.0, 2820.0, 20_000);

    assert_eq!(
        watch_progress(&fixture.host)
            .iter()
            .map(|entry| entry.video.id.as_str())
            .collect::<Vec<_>>(),
        vec!["tt0903747:1:2", "tt0903747:1:1"]
    );
}

#[test]
fn a_video_that_finishes_or_stops_within_its_last_moments_is_marked_watched() {
    let mut fixture = fixture();
    play(&mut fixture, "series", "tt0903747:1:1");
    watching(&mut fixture, 2800.0, 2820.0, 10_000);

    assert!(
        watch_progress(&fixture.host)[0].watched,
        "the last thirty seconds of a Stream are the end of it"
    );
}

#[test]
fn a_video_that_reaches_its_end_is_watched_and_paused_in_the_wrong_place_is_not() {
    let mut fixture = fixture();
    play(&mut fixture, "series", "tt0903747:1:1");
    watching(&mut fixture, 600.0, 2820.0, 10_000);
    assert!(
        !watch_progress(&fixture.host)[0].watched,
        "ten minutes into a forty-seven minute episode is not watched"
    );

    fixture.player.now_reporting(Observation {
        state: PlaybackState::Ended,
        position: Some(2820.0),
        duration: Some(2820.0),
        ..Observation::idle()
    });
    fixture.clock.set(20_000);
    fixture.host.sample().expect("reaching the end is a change");

    assert!(watch_progress(&fixture.host)[0].watched);
}

#[test]
fn the_next_episode_is_a_new_entry_under_the_same_title_and_the_one_watched_stays() {
    let mut fixture = fixture();
    play(&mut fixture, "series", "tt0903747:1:1");
    watching(&mut fixture, 2810.0, 2820.0, 10_000);

    fixture.clock.set(20_000);
    fixture
        .host
        .dispatch(action(&serde_json::json!({ "type": "next_episode" })))
        .expect("the next episode of a series plays");

    let held = watch_progress(&fixture.host);
    assert_eq!(held.len(), 2);
    assert_eq!(held[0].video.id, "tt0903747:1:2", "the new episode leads");
    assert_eq!(
        held[0].title.id(),
        "tt0903747",
        "the next episode is recorded against the same Title"
    );
    assert_eq!(
        held[0].title.background(),
        Some("https://images.example.org/bb-backdrop.jpg"),
        "the card the Title was told with — backdrop included — carries forward"
    );
    assert!(held[1].watched, "the episode that finished stays watched");
}

#[test]
fn the_previous_episode_is_a_new_entry_and_the_one_left_carries_on() {
    // Stepping back is a play like stepping forward: the earlier Video becomes
    // its own entry against the same Title, and the one left behind keeps what
    // it had (ADR-0015, ADR-0021).
    let mut fixture = fixture();
    play(&mut fixture, "series", "tt0903747:1:2");
    watching(&mut fixture, 2810.0, 2820.0, 10_000);

    fixture.clock.set(20_000);
    fixture
        .host
        .dispatch(action(&serde_json::json!({ "type": "previous_episode" })))
        .expect("the previous episode of a series plays");

    let held = watch_progress(&fixture.host);
    assert_eq!(held.len(), 2);
    assert_eq!(
        held[0].video.id, "tt0903747:1:1",
        "the earlier episode leads"
    );
    assert_eq!(
        held[0].title.id(),
        "tt0903747",
        "the previous episode is recorded against the same Title"
    );
    assert!(
        held[0].position.is_none(),
        "it starts fresh, where the play opened it"
    );
    assert!(
        held[1].watched,
        "the episode that had finished keeps its progress"
    );
}

#[test]
fn removing_the_addon_that_supplied_a_title_leaves_a_stub_that_is_still_listed() {
    let mut fixture = fixture();
    play(&mut fixture, "series", "tt0903747:1:2");
    watching(&mut fixture, 402.0, 2820.0, 10_000);

    fixture
        .host
        .dispatch(action(&serde_json::json!({
            "type": "remove_addon",
            "id": SERIES_ID,
        })))
        .expect("removing a configured Addon works");

    let published = fixture.host.snapshot();
    assert!(published.addons.is_empty());
    let entry = &published.watch_progress[0];
    assert_eq!(entry.video.id, "tt0903747:1:2");
    assert_eq!(
        entry.position,
        Some(402.0),
        "the progress it had is not thrown away with the Addon"
    );
    let unplayable = entry
        .unplayable
        .as_ref()
        .expect("the entry stays, marked unplayable");
    assert_eq!(unplayable.reason, UnplayableReason::AddonRemoved);
    assert_eq!(unplayable.addon.as_str(), SERIES_ID);

    let card = &published.continue_watching[0];
    assert_eq!(card.video.id, "tt0903747:1:2");
    assert_eq!(
        card.unplayable
            .as_ref()
            .expect("the card stays, marked unplayable")
            .reason,
        UnplayableReason::AddonRemoved
    );
}

#[test]
fn resuming_a_video_opens_a_stream_at_the_position_that_was_recorded() {
    let mut fixture = fixture();
    play(&mut fixture, "series", "tt0903747:1:2");
    watching(&mut fixture, 402.0, 2820.0, 10_000);

    let published = fixture
        .host
        .dispatch(action(&serde_json::json!({
            "type": "resume",
            "video": { "type": "series", "id": "tt0903747:1:2" },
        })))
        .expect("a Video with Watch progress resumes");

    assert_eq!(
        fixture.player.openings(),
        vec![
            (EPISODE.to_owned(), None),
            (EPISODE.to_owned(), Some(402.0)),
        ],
        "a fresh play begins at the Stream's start; a resume begins where it was left"
    );
    assert_eq!(
        published.snapshots[0].playback.state,
        PlaybackState::Opening
    );
    assert_eq!(
        published.snapshots[0]
            .playback
            .now_playing
            .as_ref()
            .map(|now| now.video.id.as_str()),
        Some("tt0903747:1:2")
    );
}

#[test]
fn resuming_a_video_the_host_has_no_progress_for_is_refused() {
    let mut fixture = fixture();

    let refused = fixture.host.dispatch(action(&serde_json::json!({
        "type": "resume",
        "video": { "type": "series", "id": "tt0903747:1:9" },
    })));

    assert!(
        matches!(refused, Err(ActionError::NoProgress { .. })),
        "there is nothing to resume from: {refused:?}"
    );
    assert!(fixture.player.openings().is_empty());
}

#[test]
fn resuming_a_stub_whose_addon_is_gone_is_refused_rather_than_opened() {
    let mut fixture = fixture();
    play(&mut fixture, "series", "tt0903747:1:2");
    watching(&mut fixture, 402.0, 2820.0, 10_000);
    fixture
        .host
        .dispatch(action(&serde_json::json!({
            "type": "remove_addon",
            "id": SERIES_ID,
        })))
        .expect("removing a configured Addon works");

    let refused = fixture.host.dispatch(action(&serde_json::json!({
        "type": "resume",
        "video": { "type": "series", "id": "tt0903747:1:2" },
    })));

    assert!(
        matches!(refused, Err(ActionError::Unplayable(_))),
        "the Addon that supplied the Title is gone: {refused:?}"
    );
    assert_eq!(
        fixture.player.openings().len(),
        1,
        "the Player was asked to open only the Stream that was played"
    );
}

#[test]
fn resuming_asks_the_addons_that_answer_for_the_videos_streams() {
    let mut fixture = fixture();
    play(&mut fixture, "series", "tt0903747:1:2");
    watching(&mut fixture, 402.0, 2820.0, 10_000);
    let asked = fixture.provider.asked().len();

    fixture
        .host
        .dispatch(action(&serde_json::json!({
            "type": "resume",
            "video": { "type": "series", "id": "tt0903747:1:2" },
        })))
        .expect("a Video with Watch progress resumes");

    assert_eq!(
        fixture.provider.asked()[asked..].to_vec(),
        vec![SERIES_ID.to_owned()],
        "the Streams are asked of the Addons that answer, through the one Provider"
    );
}

// --- The TMDB key unifies the two ways into one Title ------------------------

/// The owner's TMDB credential, as the v3 api-key shape the Host takes.
const TMDB_KEY: &str = "0123456789abcdef0123456789abcdef";
const TMDB_FIND_SERIES: &str =
    "https://api.themoviedb.org/3/find/tt0903747?external_source=imdb_id&api_key=0123456789abcdef0123456789abcdef";
/// The one request a series' details and its Videos are read with: the
/// Addon's episode list names seasons 0, 1 and 2, so those are appended (#270).
const TMDB_TV_1396: &str = concat!(
    "https://api.themoviedb.org/3/tv/1396?append_to_response=season/0,season/1,season/2",
    "&api_key=0123456789abcdef0123456789abcdef",
);
const TMDB_EXTERNAL_IDS_BB: &str =
    "https://api.themoviedb.org/3/tv/1396/external_ids?api_key=0123456789abcdef0123456789abcdef";

const TMDB_FIND_SERIES_BODY: &str = include_str!("fixtures/tmdb-find-bb.json");
const TMDB_TV_DETAILS_APPENDED: &str = include_str!("fixtures/tmdb-tv-details-appended.json");
const TMDB_EXTERNAL_BB: &str = include_str!("fixtures/tmdb-external-ids-bb.json");

/// The same Addon, declaring the one id namespace a TMDB-keyed Video reaches it
/// by — `tt` — so a resume of a TMDB-keyed Video can be asked of it.
fn manifest_declaring_tt() -> String {
    format!(
        r#"{{"id":"{SERIES_ID}","name":"Series","version":"1.0.0",
             "resources":["meta",{{"name":"stream","types":["movie","series"],"idPrefixes":["tt"]}}],
             "types":["movie","series"],"catalogs":[]}}"#
    )
}

/// A Host with a TMDB key held, the recorded Addon, and every TMDB answer the
/// mapping needs recorded.
fn tmdb_fixture() -> Fixture {
    let player = Arc::new(FixturePlayer::new());
    let provider = Arc::new(
        FixtureProvider::new().offering(SERIES_ID, vec![candidate(EPISODE), candidate(FILM)]),
    );
    let fetcher = FixtureFetcher::new()
        .serving(SERIES, manifest_declaring_tt())
        .serving(META_URL, SERIES_META)
        .serving(TMDB_FIND_SERIES, TMDB_FIND_SERIES_BODY)
        .serving(TMDB_TV_1396, TMDB_TV_DETAILS_APPENDED)
        .serving(TMDB_EXTERNAL_IDS_BB, TMDB_EXTERNAL_BB);
    let store = Arc::new(InMemoryStore::new());
    let clock = Arc::new(FixtureClock::new().at(1_000));

    let mut host = Host::new(
        store.clone() as Arc<dyn Store>,
        Arc::new(fetcher),
        Arc::new(InMemorySecretStore::backed_by(SecretBackend::Keyring)),
        provider.clone(),
        player.clone(),
        clock.clone(),
    )
    .expect("a Host over a store starts");
    host.dispatch(action(
        &serde_json::json!({ "type": "add_addon", "url": SERIES }),
    ))
    .expect("configuring the Addon should work");
    host.dispatch(action(
        &serde_json::json!({ "type": "set_tmdb_key", "key": TMDB_KEY }),
    ))
    .expect("entering a TMDB key should work");

    Fixture {
        host,
        player,
        provider,
        store,
        clock,
    }
}

/// Play one Video, with the Title card a client reading that Title would send:
/// the Addon's id for one opened from a catalog card, `null` for a Discovered
/// Title (ADR-0020).
fn play_as(fixture: &mut Fixture, r#type: &str, video: &str, card: serde_json::Value) {
    fixture
        .host
        .dispatch(action(&serde_json::json!({
            "type": "play_stream",
            "video": { "type": r#type, "id": video },
            "addon": SERIES_ID,
            "title": {
                "addon": card,
                "id": video,
                "type": r#type,
                "name": "Breaking Bad",
                "poster": null,
            },
            "stream": {
                "name": "1080p",
                "playback": { "kind": "direct", "url": EPISODE },
                "warnings": [],
            },
        })))
        .unwrap_or_else(|error| panic!("playing a direct candidate should work: {error}"));
}

#[test]
fn a_series_played_through_an_addon_card_and_through_discover_is_one_entry() {
    let mut fixture = tmdb_fixture();

    // The Addon path: the Title is TMDB-first, so the Video the client plays is
    // TMDB's own episode, keyed `tmdb:<id>:<s>:<e>`.
    let opened = fixture
        .host
        .dispatch(action(&serde_json::json!({
            "type": "open_title",
            "addon": SERIES_ID,
            "title": { "type": "series", "id": "tt0903747" },
        })))
        .expect("the recorded series opens");
    let from_addon = opened
        .title()
        .expect("opening a Title answers with one")
        .videos
        .iter()
        .find(|video| video.id == "tmdb:1396:1:1")
        .expect("TMDB supplies the Videos, keyed by TMDB's id")
        .id
        .clone();

    play_as(
        &mut fixture,
        "series",
        &from_addon,
        serde_json::json!(SERIES_ID),
    );
    let entry = fixture.host.snapshot().watch_progress;

    // The Discover path: the Title has no Addon, and its Video is the same one.
    let discovered = fixture
        .host
        .dispatch(action(&serde_json::json!({
            "type": "open_discovered_title",
            "key": { "kind": "tmdb", "id": 1396 },
            "kind": "series",
        })))
        .expect("the Discovered Title opens");
    let from_discover = discovered
        .title()
        .expect("opening a Title answers with one")
        .videos
        .iter()
        .find(|video| video.id == from_addon)
        .expect("both ways in name the same Video")
        .id
        .clone();

    play_as(
        &mut fixture,
        "series",
        &from_discover,
        serde_json::Value::Null,
    );

    let unified = fixture.host.snapshot().watch_progress;
    assert_eq!(
        unified.len(),
        1,
        "one Video is one entry however many ways the Title was reached: {unified:?}"
    );
    assert_eq!(unified[0].video.id, "tmdb:1396:1:1");
    assert_eq!(
        (
            entry[0].video.id.as_str(),
            entry[0].title.addon().map(host_core::AddonId::as_str),
        ),
        ("tmdb:1396:1:1", Some(SERIES_ID)),
        "the first play's entry was the Addon's card, as told"
    );
    assert_eq!(
        unified[0].unplayable, None,
        "a Title with no Addon behind it has no removal to be marked by"
    );
}

#[test]
fn a_discovered_titles_progress_resumes_through_the_addons_that_answer_by_tt() {
    let mut fixture = tmdb_fixture();
    play_as(
        &mut fixture,
        "series",
        "tmdb:1396:1:2",
        serde_json::Value::Null,
    );
    watching(&mut fixture, 402.0, 2820.0, 10_000);
    let asked = fixture.provider.asked().len();
    fixture.player.openings();

    fixture
        .host
        .dispatch(action(&serde_json::json!({
            "type": "resume",
            "video": { "type": "series", "id": "tmdb:1396:1:2" },
        })))
        .expect("a Discovered Title's progress resumes");

    assert_eq!(
        fixture.provider.asked()[asked..].to_vec(),
        vec![SERIES_ID.to_owned()],
        "the TMDB-keyed Video reaches the Addon that declares the `tt` spelling"
    );
    assert_eq!(
        fixture.player.openings().last().map(|open| open.1),
        Some(Some(402.0)),
        "and it opens where the Host's own record left it"
    );
}

#[test]
fn a_discovered_titles_entry_never_wears_the_addon_removed_mark() {
    let mut fixture = tmdb_fixture();
    play_as(
        &mut fixture,
        "series",
        "tmdb:1396:1:2",
        serde_json::Value::Null,
    );

    // The Addon is taken away, and the entry stays listed — unmarked, because
    // there was no Addon behind this Title to lose (ADR-0020).
    fixture
        .host
        .dispatch(action(
            &serde_json::json!({ "type": "remove_addon", "id": SERIES_ID }),
        ))
        .expect("the Addon is removed");

    let published = fixture.host.snapshot().watch_progress;
    assert_eq!(published.len(), 1);
    assert_eq!(
        published[0].unplayable, None,
        "a Title that never had an Addon cannot have lost one: {published:?}"
    );

    // And the same Snapshot against an entry that *did* have one marks it, so
    // the absence above is a decision rather than a missing feature.
    let mut was_the_addons = tmdb_fixture();
    play_as(
        &mut was_the_addons,
        "series",
        "tmdb:1396:1:2",
        serde_json::json!(SERIES_ID),
    );
    was_the_addons
        .host
        .dispatch(action(
            &serde_json::json!({ "type": "remove_addon", "id": SERIES_ID }),
        ))
        .expect("the Addon is removed");
    let marked = was_the_addons.host.snapshot().watch_progress;
    assert!(
        matches!(
            &marked[0].unplayable,
            Some(entry) if entry.reason == UnplayableReason::AddonRemoved
        ),
        "an entry whose Addon is gone is still marked: {marked:?}"
    );
}

// --- Continue watching: one card per Title -----------------------------------

#[test]
fn six_episodes_of_one_series_are_one_continue_watching_entry() {
    let mut fixture = fixture();

    for n in 1..=6 {
        fixture.clock.set(10_000 * i64::from(n));
        play(&mut fixture, "series", &format!("tt0903747:1:{n}"));
        watching(
            &mut fixture,
            100.0 * f64::from(n),
            2820.0,
            10_000 * i64::from(n),
        );
    }

    let snapshot = fixture.host.snapshot();
    assert_eq!(
        snapshot.continue_watching.len(),
        1,
        "a series is one card, not six: {:?}",
        snapshot.continue_watching
    );
    let card = &snapshot.continue_watching[0];
    assert_eq!(
        card.video.id, "tt0903747:1:6",
        "the card is the last one played"
    );
    assert_eq!(card.video.season, Some(1));
    assert_eq!(card.video.episode, Some(6));
    assert_eq!(card.title.name(), "Breaking Bad");
    assert_eq!(card.position, Some(600.0));
    assert_eq!(card.duration, Some(2820.0));
    assert_eq!(card.unplayable, None);
    assert_eq!(
        snapshot.watch_progress.len(),
        6,
        "the per-Video Watch progress the playback view and episode lookup read is unchanged"
    );
}

#[test]
fn rewatching_an_earlier_episode_makes_it_the_continue_watching_card() {
    let mut fixture = fixture();

    fixture.clock.set(10_000);
    play(&mut fixture, "series", "tt0903747:1:1");
    watching(&mut fixture, 300.0, 2820.0, 10_000);
    fixture.clock.set(20_000);
    play(&mut fixture, "series", "tt0903747:1:2");
    watching(&mut fixture, 500.0, 2820.0, 20_000);
    fixture.clock.set(30_000);
    play(&mut fixture, "series", "tt0903747:1:1");
    watching(&mut fixture, 700.0, 2820.0, 30_000);

    let snapshot = fixture.host.snapshot();
    assert_eq!(
        snapshot
            .continue_watching
            .iter()
            .map(|card| card.video.id.as_str())
            .collect::<Vec<_>>(),
        vec!["tt0903747:1:1"],
        "the card follows what was played last, not what is furthest along"
    );
    assert_eq!(snapshot.continue_watching[0].position, Some(700.0));
    assert_eq!(
        snapshot.watch_progress.len(),
        2,
        "both episodes keep their progress"
    );
}

#[test]
fn two_titles_are_ordered_by_the_latest_play_of_each() {
    let mut fixture = fixture();

    fixture.clock.set(10_000);
    play(&mut fixture, "series", "tt0903747:1:2");
    watching(&mut fixture, 100.0, 2820.0, 10_000);
    fixture.clock.set(20_000);
    play(&mut fixture, "movie", "tt0133093");
    watching(&mut fixture, 400.0, 8160.0, 20_000);

    let snapshot = fixture.host.snapshot();
    assert_eq!(
        snapshot
            .continue_watching
            .iter()
            .map(|card| (card.title.r#type(), card.video.id.as_str()))
            .collect::<Vec<_>>(),
        vec![("movie", "tt0133093"), ("series", "tt0903747:1:2")],
        "the Title played last leads the row"
    );
}

#[test]
fn a_finished_film_leaves_continue_watching_and_its_watch_progress_is_kept() {
    let mut fixture = fixture();
    play(&mut fixture, "movie", "tt0133093");
    watching(&mut fixture, 8160.0, 8160.0, 10_000);

    let snapshot = fixture.host.snapshot();
    assert!(
        snapshot.continue_watching.is_empty(),
        "a finished film has nothing to continue: {:?}",
        snapshot.continue_watching
    );
    assert_eq!(snapshot.watch_progress.len(), 1);
    assert!(
        snapshot.watch_progress[0].watched,
        "the progress survives the card leaving the row"
    );
}

#[test]
fn a_finished_episode_whose_title_is_not_cached_stays_watched() {
    let mut fixture = fixture();
    play(&mut fixture, "series", "tt0903747:1:1");
    watching(&mut fixture, 2820.0, 2820.0, 10_000);

    let cards = continue_watching(&fixture.host);
    assert_eq!(cards.len(), 1);
    assert_eq!(cards[0].video.id, "tt0903747:1:1");
    assert!(
        cards[0].watched,
        "with no cached Title there is no Up next to move to, so the finished Video stays"
    );
    assert!(!cards[0].up_next);
}

/// Open a Title the way a client does, so the Host caches its Videos: Up next
/// is worked out from the cache (ADR-0038).
fn open_series(fixture: &mut Fixture) {
    fixture
        .host
        .dispatch(action(&serde_json::json!({
            "type": "open_title",
            "addon": SERIES_ID,
            "title": { "type": "series", "id": "tt0903747" },
        })))
        .expect("the recorded series opens");
}

#[test]
fn finishing_an_episode_moves_the_card_to_its_up_next() {
    let mut fixture = fixture();
    open_series(&mut fixture);
    play(&mut fixture, "series", "tt0903747:1:1");
    watching(&mut fixture, 2820.0, 2820.0, 10_000);

    let cards = continue_watching(&fixture.host);
    assert_eq!(cards.len(), 1, "the series keeps its one card: {cards:?}");
    let card = &cards[0];
    assert_eq!(card.video.id, "tt0903747:1:2");
    assert_eq!(card.video.season, Some(1));
    assert_eq!(card.video.episode, Some(2));
    assert!(card.up_next, "the card says its Video is the Up next");
    assert_eq!(card.position, None, "an Up next with no progress has none");
    assert_eq!(card.duration, None);
    assert!(!card.watched);
    assert_eq!(card.unplayable, None);
}

#[test]
fn a_partly_watched_up_next_keeps_its_own_progress() {
    let mut fixture = fixture();
    open_series(&mut fixture);

    fixture.clock.set(10_000);
    play(&mut fixture, "series", "tt0903747:1:3");
    watching(&mut fixture, 300.0, 2820.0, 10_000);

    fixture.clock.set(20_000);
    play(&mut fixture, "series", "tt0903747:1:2");
    watching(&mut fixture, 2820.0, 2820.0, 20_000);

    let cards = continue_watching(&fixture.host);
    assert_eq!(cards.len(), 1);
    let card = &cards[0];
    assert_eq!(
        card.video.id, "tt0903747:1:3",
        "the card is the Up next of the Video that finished"
    );
    assert!(card.up_next);
    assert_eq!(
        card.position,
        Some(300.0),
        "an Up next already started resumes where it was left"
    );
    assert_eq!(card.duration, Some(2820.0));
    assert!(!card.watched);
}

#[test]
fn the_card_follows_the_video_played_last_not_the_furthest_one() {
    // At S1E3 with progress, went back and rewatched S1E1: the card is S1E1's
    // Up next, and the progress in S1E3 is kept for whenever it is resumed.
    let mut fixture = fixture();
    open_series(&mut fixture);

    fixture.clock.set(10_000);
    play(&mut fixture, "series", "tt0903747:1:3");
    watching(&mut fixture, 300.0, 2820.0, 10_000);

    fixture.clock.set(20_000);
    play(&mut fixture, "series", "tt0903747:1:1");
    watching(&mut fixture, 2820.0, 2820.0, 20_000);

    let snapshot = fixture.host.snapshot();
    assert_eq!(
        snapshot
            .continue_watching
            .iter()
            .map(|card| card.video.id.as_str())
            .collect::<Vec<_>>(),
        vec!["tt0903747:1:2"],
        "the card follows what was played last, not what is furthest along"
    );
    assert_eq!(snapshot.continue_watching[0].position, None);
    assert!(
        snapshot
            .watch_progress
            .iter()
            .any(|entry| entry.video.id == "tt0903747:1:3" && entry.position == Some(300.0)),
        "the earlier episode keeps its own progress"
    );
}

#[test]
fn a_season_finale_leads_into_the_next_seasons_first_episode() {
    let mut fixture = fixture();
    open_series(&mut fixture);
    play(&mut fixture, "series", "tt0903747:1:3");
    watching(&mut fixture, 2820.0, 2820.0, 10_000);

    let cards = continue_watching(&fixture.host);
    assert_eq!(cards.len(), 1);
    assert_eq!(cards[0].video.id, "tt0903747:2:1");
    assert!(cards[0].up_next);
    assert_eq!(cards[0].position, None);
}

#[test]
fn the_last_numbered_episode_leaves_the_row_and_keeps_the_progress() {
    let mut fixture = fixture();
    open_series(&mut fixture);
    play(&mut fixture, "series", "tt0903747:2:1");
    watching(&mut fixture, 2820.0, 2820.0, 10_000);

    let snapshot = fixture.host.snapshot();
    assert!(
        snapshot.continue_watching.is_empty(),
        "the last numbered episode has no Up next, and the specials are apart: {:?}",
        snapshot.continue_watching
    );
    assert_eq!(snapshot.watch_progress.len(), 1);
    assert!(
        snapshot.watch_progress[0].watched,
        "Watch progress is kept when the card leaves the row"
    );
}

#[test]
fn a_finished_episode_moves_to_its_up_next_once_the_title_is_cached() {
    let mut fixture = fixture();
    play(&mut fixture, "series", "tt0903747:1:1");
    watching(&mut fixture, 2820.0, 2820.0, 10_000);
    assert!(
        continue_watching(&fixture.host)[0].watched,
        "with no cached Title the card is the finished Video"
    );

    open_series(&mut fixture);

    let cards = continue_watching(&fixture.host);
    assert_eq!(
        cards[0].video.id, "tt0903747:1:2",
        "the next Snapshot moves the card to Up next once the Title is cached"
    );
    assert!(cards[0].up_next);
}

#[test]
fn a_host_restarted_with_no_network_publishes_the_same_up_next() {
    let mut fixture = fixture();
    open_series(&mut fixture);
    play(&mut fixture, "series", "tt0903747:1:1");
    watching(&mut fixture, 2820.0, 2820.0, 10_000);

    let restarted = restarted_without_network(fixture.store.clone());

    let cards = &restarted.snapshot().continue_watching;
    assert_eq!(cards.len(), 1);
    assert_eq!(
        cards[0].video.id, "tt0903747:1:2",
        "the cached Title answers Up next on a Host that cannot reach anything"
    );
    assert!(cards[0].up_next);
}

/// A series whose only Videos are two specials: Up next steps from special to
/// special, and never out of them.
const SPECIALS_META: &str = r#"{"meta":{"id":"tt0903747","type":"series","name":"Breaking Bad","videos":[
    {"id":"tt0903747:0:1","season":0,"episode":1,"name":"A special"},
    {"id":"tt0903747:0:2","season":0,"episode":2,"name":"Another special"}
]}}"#;

#[test]
fn inside_the_specials_up_next_is_the_next_special() {
    let mut fixture = fixture_over_serving(Arc::new(InMemoryStore::new()), SPECIALS_META);
    open_series(&mut fixture);
    play(&mut fixture, "series", "tt0903747:0:1");
    watching(&mut fixture, 2820.0, 2820.0, 10_000);

    let cards = continue_watching(&fixture.host);
    assert_eq!(cards.len(), 1);
    assert_eq!(cards[0].video.id, "tt0903747:0:2");
    assert!(cards[0].up_next);
}

#[test]
fn the_continue_watching_codec_round_trips_beside_watch_progress() {
    let mut fixture = fixture();
    fixture.clock.set(10_000);
    play(&mut fixture, "series", "tt0903747:1:1");
    watching(&mut fixture, 100.0, 2820.0, 10_000);
    fixture.clock.set(20_000);
    play(&mut fixture, "series", "tt0903747:1:2");
    watching(&mut fixture, 200.0, 2820.0, 20_000);

    let snapshot = fixture.host.snapshot();
    let json = serde_json::to_string(&snapshot).expect("a Snapshot serializes");
    let back: host_core::Snapshot = serde_json::from_str(&json).expect("the Snapshot round-trips");

    assert_eq!(back, snapshot);
    assert_eq!(back.continue_watching.len(), 1);
    assert_eq!(back.continue_watching[0].video.id, "tt0903747:1:2");
    assert_eq!(back.continue_watching[0].position, Some(200.0));
    assert_eq!(
        back.watch_progress.len(),
        2,
        "the per-Video list round-trips unchanged beside the row"
    );
}

#[test]
fn an_up_next_entry_round_trips_with_its_marker() {
    let mut fixture = fixture();
    open_series(&mut fixture);
    play(&mut fixture, "series", "tt0903747:1:1");
    watching(&mut fixture, 2820.0, 2820.0, 10_000);

    let snapshot = fixture.host.snapshot();
    let json = serde_json::to_string(&snapshot).expect("a Snapshot serializes");
    let published: serde_json::Value =
        serde_json::from_str(&json).expect("a Snapshot is a JSON object");
    assert_eq!(
        published["continueWatching"][0]["upNext"],
        serde_json::json!(true),
        "the Up next marker is published, camelCased for a JavaScript client"
    );

    let back: host_core::Snapshot = serde_json::from_str(&json).expect("the Snapshot round-trips");
    assert_eq!(back, snapshot);
    assert!(back.continue_watching[0].up_next);
}
