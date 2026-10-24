//! Playing a Stream, driven the way a client drives it: an Action in, published
//! Snapshots out. Nothing below the Action surface is named here, and no test
//! reaches a real player: the Player is a fake that remembers every telling and
//! reports whatever the test told it to report.

use std::sync::Arc;

use host_core::{
    Action, ActionError, AddonProvider, Buffered, FixtureClock, FixtureFetcher, FixturePlayer,
    Host, InMemorySecretStore, InMemoryStore, Observation, PlaybackError, PlaybackState,
    SecretBackend, SeekTarget, Snapshot, Store, Telling, ACTION_VERSION,
};

/// The URL a recorded debrid answer would carry, with a session in it — the
/// shape a Snapshot must never carry outward.
const CHOSEN: &str = "https://stream.example.org/v/tt0133093-1080p?token=SECRETSESSION";

/// An Action as a client sends it: the versioned envelope, as JSON text.
fn action(body: &serde_json::Value) -> Action {
    let envelope = format!(r#"{{"version":{ACTION_VERSION},"action":{body}}}"#);
    Action::parse(&envelope).unwrap_or_else(|error| panic!("{envelope} should parse: {error}"))
}

/// What a client sends when it chooses a candidate: the Video it asked Streams
/// for, the Addon whose answer it was, the Title it was reading, and the
/// candidate itself, verbatim.
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
            "description": "The Matrix 1999 1080p BluRay x265-GROUP\n👤 112 💾 4.21 GB",
            "playback": { "kind": "direct", "url": CHOSEN },
            "warnings": [],
            "filename": "The.Matrix.1999.1080p.BluRay.x265-GROUP.mkv",
            "bingeGroup": "aiostreams|1080p|BluRay|x265",
        },
    })
}

/// A Host over an empty store, with a Player whose other end the test holds.
struct Fixture {
    host: Host,
    player: Arc<FixturePlayer>,
}

fn fixture() -> Fixture {
    fixture_over(Arc::new(InMemoryStore::new()) as Arc<dyn Store>)
}

fn fixture_over(store: Arc<dyn Store>) -> Fixture {
    let player = Arc::new(FixturePlayer::new());
    let fetcher = Arc::new(FixtureFetcher::new());
    let provider = Arc::new(AddonProvider::new(fetcher.clone()));
    let host = Host::new(
        store,
        fetcher,
        Arc::new(InMemorySecretStore::backed_by(SecretBackend::Keyring)),
        provider,
        player.clone(),
        Arc::new(FixtureClock::new()),
    )
    .expect("a Host over a store starts");

    Fixture { host, player }
}

/// Choose the recorded candidate: the Action a client takes, and the Snapshots
/// it publishes.
fn choose(fixture: &mut Fixture) -> Vec<Snapshot> {
    fixture
        .host
        .dispatch(action(&a_chosen_stream()))
        .unwrap_or_else(|error| panic!("choosing a playable candidate should work: {error}"))
        .snapshots
}

/// A Host with a Stream playing: the candidate chosen, the Player reporting it
/// started, and the position the Player says.
fn playing(fixture: &mut Fixture) {
    choose(fixture);
    fixture
        .player
        .now_reporting(Observation::playing(12.5, 8100.0));
    fixture
        .host
        .sample()
        .expect("the Player says something new about what is playing");
}

fn playback_of(published: &[Snapshot]) -> &host_core::PlaybackSnapshot {
    assert_eq!(published.len(), 1, "a change publishes one Snapshot");
    &published[0].playback
}

/// The tellings that are *controls*: everything but the preferences the Host
/// tells the Player once, at startup, from the store.
fn controls(player: &FixturePlayer) -> Vec<Telling> {
    player
        .tellings()
        .into_iter()
        .filter(|telling| {
            !matches!(
                telling,
                Telling::SubtitleLanguage(_)
                    | Telling::SubtitleColor(_)
                    | Telling::SubtitleScale(_)
                    | Telling::StreamBuffer(_)
            )
        })
        .collect()
}

#[test]
fn choosing_a_stream_opens_it_and_tells_every_client_what_is_playing() {
    let mut fixture = fixture();

    let published = choose(&mut fixture);
    let reported = playback_of(&published);

    assert_eq!(
        fixture.player.opened(),
        vec![CHOSEN.to_owned()],
        "the Player is given the URL the client chose, and nothing else about it"
    );
    assert_eq!(reported.state, PlaybackState::Opening);
    assert_eq!(reported.failure, None);
    assert_eq!(reported.position, None);
    assert_eq!(reported.duration, None);
    let now_playing = reported
        .now_playing
        .as_ref()
        .expect("what is playing travels to every client");
    assert_eq!(now_playing.addon.as_str(), "community.aiostreams");
    assert_eq!(now_playing.name.as_deref(), Some("AIOStreams\n1080p"));
    assert_eq!(
        now_playing.filename.as_deref(),
        Some("The.Matrix.1999.1080p.BluRay.x265-GROUP.mkv")
    );
    assert_eq!(
        now_playing.binge_group.as_deref(),
        Some("aiostreams|1080p|BluRay|x265")
    );
    assert_eq!(now_playing.video.id, "tt0133093");
}

#[test]
fn a_snapshot_says_what_is_playing_and_never_where_its_bytes_are() {
    let mut fixture = fixture();
    choose(&mut fixture);

    let published = serde_json::to_string(&fixture.host.snapshot()).expect("a Snapshot serializes");

    assert!(
        !published.contains(CHOSEN) && !published.contains("SECRETSESSION"),
        "a Stream URL can carry a debrid session and a Snapshot reaches every paired client: \
         {published}"
    );
    assert!(
        published.contains("AIOStreams"),
        "the Addon's own words about the candidate are what does travel: {published}"
    );
}

#[test]
fn what_the_player_reports_moves_the_snapshot_until_it_says_the_same_thing_twice() {
    let mut fixture = fixture();
    playing(&mut fixture);

    fixture
        .player
        .now_reporting(Observation::playing(15.0, 8100.0));
    let published = fixture.host.sample().expect("the position moved on again");
    let reported = playback_of(std::slice::from_ref(&published));

    assert_eq!(reported.state, PlaybackState::Playing);
    assert_eq!(reported.position, Some(15.0));
    assert_eq!(reported.duration, Some(8100.0));

    fixture
        .player
        .now_reporting(Observation::playing(15.0, 8100.0));
    assert_eq!(
        fixture.host.sample(),
        None,
        "a tick that reports what the Host already holds publishes nothing"
    );
}

#[test]
fn a_paused_streams_cache_filling_publishes_nothing_until_it_moves_by_a_second() {
    // A paused Stream's cache keeps filling while the position holds, and the
    // Host publishes nothing for a span that moved by less than a second at
    // both ends: four Snapshots a second would say nothing (ADR-0013).
    let mut fixture = fixture();
    playing(&mut fixture);

    fixture.player.now_reporting(Observation {
        state: PlaybackState::Paused,
        position: Some(12.5),
        duration: Some(8100.0),
        buffered: Some(Buffered {
            start: 0.0,
            end: 60.0,
        }),
        ..Observation::idle()
    });
    let published = fixture
        .host
        .sample()
        .expect("a span the Player had not reported before is a change");
    assert_eq!(
        playback_of(std::slice::from_ref(&published)).buffered,
        Some(Buffered {
            start: 0.0,
            end: 60.0,
        })
    );

    fixture.player.now_buffered(Some(Buffered {
        start: 0.4,
        end: 60.4,
    }));
    assert_eq!(
        fixture.host.sample(),
        None,
        "a cache that filled by 0.4 s is not news a client could see"
    );

    fixture.player.now_buffered(Some(Buffered {
        start: 1.5,
        end: 61.5,
    }));
    let published = fixture
        .host
        .sample()
        .expect("a span that moved by a second and a half is news");
    assert_eq!(
        playback_of(std::slice::from_ref(&published)).buffered,
        Some(Buffered {
            start: 1.5,
            end: 61.5,
        }),
        "the published span is the reading, not the one the Host held"
    );
}

#[test]
fn a_span_the_player_stops_answering_with_is_published_once() {
    let mut fixture = fixture();
    playing(&mut fixture);

    fixture.player.now_buffered(Some(Buffered {
        start: 0.0,
        end: 30.0,
    }));
    let published = fixture.host.sample().expect("a span arriving is a change");
    assert_eq!(
        playback_of(std::slice::from_ref(&published)).buffered,
        Some(Buffered {
            start: 0.0,
            end: 30.0,
        })
    );

    fixture.player.now_buffered(None);
    let published = fixture
        .host
        .sample()
        .expect("a Player that stops answering is a change");
    assert_eq!(
        playback_of(std::slice::from_ref(&published)).buffered,
        None,
        "no answer is not a span with nothing in it"
    );
    assert_eq!(fixture.host.sample(), None, "and saying so once is enough");
}

#[test]
fn a_torrent_is_refused_before_the_player_hears_of_it() {
    let mut fixture = fixture();
    let mut chosen = a_chosen_stream();
    chosen["stream"]["playback"] = serde_json::json!({
        "kind": "info_hash",
        "infoHash": "61065ea115b7cc3e8db9fb5ab1f6f327f08bd1c9",
    });
    let before = fixture.host.snapshot();

    let refused = fixture.host.dispatch(action(&chosen));

    assert!(
        matches!(refused, Err(ActionError::Unplayable(_))),
        "a candidate this Host cannot fetch is refused, not pretended about: {refused:?}"
    );
    assert!(fixture.player.opened().is_empty());
    assert_eq!(fixture.host.snapshot(), before);
}

#[test]
fn a_candidate_that_is_not_a_url_this_host_opens_is_refused() {
    let mut fixture = fixture();

    for url in [
        "not a url at all",
        "file:///etc/passwd",
        "magnet:?xt=urn:btih:deadbeef",
    ] {
        let mut chosen = a_chosen_stream();
        chosen["stream"]["playback"]["url"] = serde_json::Value::String(url.to_owned());

        assert!(
            matches!(
                fixture.host.dispatch(action(&chosen)),
                Err(ActionError::Unplayable(_))
            ),
            "{url:?} is not a Stream this Host opens"
        );
    }
    assert!(fixture.player.opened().is_empty());
}

#[test]
fn a_control_with_nothing_playing_is_refused_rather_than_silently_obeyed() {
    let mut fixture = fixture();
    let before = fixture.host.snapshot();
    let told = fixture.player.tellings();

    let refusals = [
        serde_json::json!({ "type": "set_paused", "paused": true }),
        serde_json::json!({ "type": "seek", "target": { "kind": "by", "seconds": -10.0 } }),
        serde_json::json!({ "type": "stop_playback" }),
    ];

    for body in refusals {
        assert!(
            matches!(
                fixture.host.dispatch(action(&body)),
                Err(ActionError::NothingPlaying { .. })
            ),
            "{body} does nothing when nothing is playing, and says so"
        );
    }

    assert_eq!(
        fixture.player.tellings(),
        told,
        "a control that was refused never reached the Player"
    );
    assert_eq!(fixture.player.stopped(), 0);
    assert_eq!(fixture.host.snapshot(), before);
}

#[test]
fn pausing_and_resuming_reach_the_player_and_move_the_state_at_once() {
    let mut fixture = fixture();
    playing(&mut fixture);

    let paused = fixture
        .host
        .dispatch(action(
            &serde_json::json!({ "type": "set_paused", "paused": true }),
        ))
        .expect("pausing something that is playing works");
    assert_eq!(controls(&fixture.player), vec![Telling::Pause(true)]);
    assert_eq!(playback_of(&paused.snapshots).state, PlaybackState::Paused);
    assert_eq!(
        playback_of(&paused.snapshots).position,
        Some(12.5),
        "a pause holds where playback is, not what the Player last said"
    );

    let resumed = fixture
        .host
        .dispatch(action(
            &serde_json::json!({ "type": "set_paused", "paused": false }),
        ))
        .expect("resuming works");
    assert_eq!(
        controls(&fixture.player),
        vec![Telling::Pause(true), Telling::Pause(false)]
    );
    assert_eq!(
        playback_of(&resumed.snapshots).state,
        PlaybackState::Playing
    );
}

#[test]
fn seeking_reaches_the_player_and_moves_the_hosts_own_record_of_the_position() {
    let mut fixture = fixture();
    playing(&mut fixture);

    let by = fixture
        .host
        .dispatch(action(&serde_json::json!({
            "type": "seek",
            "target": { "kind": "by", "seconds": -10.0 },
        })))
        .expect("seeking within a Stream works");
    assert_eq!(
        controls(&fixture.player),
        vec![Telling::Seek(SeekTarget::By { seconds: -10.0 })],
        "the Player is given the seek the client meant, not a position the Host worked out"
    );
    assert_eq!(
        playback_of(&by.snapshots).position,
        Some(2.5),
        "the Host's record moves at the moment of the Action, and the Player's next \
         report is what corrects it"
    );

    let to = fixture
        .host
        .dispatch(action(&serde_json::json!({
            "type": "seek",
            "target": { "kind": "to", "seconds": 9000.0 },
        })))
        .expect("seeking to a position works");
    assert_eq!(
        playback_of(&to.snapshots).position,
        Some(8100.0),
        "a seek past the end lands at the end of what the Stream said it is"
    );
    assert_eq!(playback_of(&to.snapshots).state, PlaybackState::Playing);
}

#[test]
fn a_seek_that_is_not_a_number_of_seconds_is_refused_before_the_player_hears_of_it() {
    let mut fixture = fixture();
    playing(&mut fixture);

    // A number too large for any reader to hold is refused before the Player
    // hears of it — whether that refusal comes from reading the envelope or
    // from judging the target.
    let envelope = format!(
        r#"{{"version":{ACTION_VERSION},"action":{{"type":"seek","target":{{"kind":"to","seconds":1e400}}}}}}"#
    );
    let refused = Action::parse(&envelope)
        .map_err(Some)
        .and_then(|action| fixture.host.dispatch(action).map_err(Some));

    assert!(
        refused.is_err(),
        "a number that is not a number of seconds is not a place to go: {refused:?}"
    );
    assert!(controls(&fixture.player).is_empty());

    // The naming case, which no JSON can carry: a `NaN` built in Rust.
    let refused = Action::Seek {
        target: SeekTarget::To { seconds: f64::NAN },
    }
    .validate();
    assert!(
        matches!(refused, Err(ActionError::InvalidSeekTarget(_))),
        "a NaN is not a number of seconds: {refused:?}"
    );
}

#[test]
fn stopping_gives_the_player_nothing_to_play_and_leaves_the_client_where_it_was() {
    let mut fixture = fixture();
    playing(&mut fixture);

    let stopped = fixture
        .host
        .dispatch(action(&serde_json::json!({ "type": "stop_playback" })))
        .expect("stopping something that is playing works");
    let reported = playback_of(&stopped.snapshots);

    assert_eq!(fixture.player.stopped(), 1);
    assert_eq!(reported.state, PlaybackState::Idle);
    assert_eq!(reported.now_playing, None);
    assert_eq!(reported.position, None);
    assert_eq!(reported.duration, None);
    assert_eq!(reported.failure, None);

    assert!(
        matches!(
            fixture.host.dispatch(action(
                &serde_json::json!({ "type": "set_paused", "paused": true }),
            )),
            Err(ActionError::NothingPlaying { .. })
        ),
        "a stop leaves nothing to pause"
    );
}

#[test]
fn a_stream_that_reaches_its_end_stays_named_while_the_state_says_it_ended() {
    let mut fixture = fixture();
    playing(&mut fixture);

    fixture.player.now_reporting(Observation {
        state: PlaybackState::Ended,
        position: Some(8100.0),
        duration: Some(8100.0),
        ..Observation::idle()
    });
    let published = fixture.host.sample().expect("reaching the end is a change");
    let reported = playback_of(std::slice::from_ref(&published));

    assert_eq!(reported.state, PlaybackState::Ended);
    assert_eq!(
        reported
            .now_playing
            .as_ref()
            .map(|playing| playing.name.as_deref()),
        Some(Some("AIOStreams\n1080p")),
        "the Video that ended is what a resume is offered from (#29)"
    );

    assert!(
        matches!(
            fixture.host.dispatch(action(
                &serde_json::json!({ "type": "set_paused", "paused": true }),
            )),
            Err(ActionError::NothingPlaying { .. })
        ),
        "a Stream that has ended is not one to pause"
    );
    assert!(
        fixture
            .host
            .dispatch(action(&serde_json::json!({ "type": "stop_playback" })))
            .is_ok(),
        "but a stop is always allowed, and clears what is left"
    );
}

#[test]
fn a_stream_that_fails_to_open_says_so_and_leaves_the_client_on_the_list() {
    let mut fixture = fixture();
    choose(&mut fixture);

    fixture.player.now_reporting(Observation {
        state: PlaybackState::Idle,
        failure: Some("That Stream could not be opened — mpv could not load it.".to_owned()),
        ..Observation::idle()
    });
    let published = fixture
        .host
        .sample()
        .expect("an open that failed is a change");
    let reported = playback_of(std::slice::from_ref(&published));

    assert_eq!(
        reported.state,
        PlaybackState::Idle,
        "nothing is playing when an open fails"
    );
    assert_eq!(
        reported.failure.as_deref(),
        Some("That Stream could not be opened — mpv could not load it."),
        "the Host says why, in the Player's own words, so the client can show it"
    );
    assert_eq!(
        reported
            .now_playing
            .as_ref()
            .map(|playing| playing.name.as_deref()),
        Some(Some("AIOStreams\n1080p")),
        "the candidate that did not open is still named, so the client knows which one"
    );

    let stopped = fixture
        .host
        .dispatch(action(&serde_json::json!({ "type": "stop_playback" })))
        .expect("a stop clears a failure like anything else");
    assert_eq!(playback_of(&stopped.snapshots).failure, None);
    assert_eq!(playback_of(&stopped.snapshots).now_playing, None);
}

#[test]
fn choosing_another_stream_replaces_the_one_that_was_playing() {
    let mut fixture = fixture();
    playing(&mut fixture);
    let before = fixture.host.snapshot().revision;

    let other = "https://stream.example.org/v/tt0133093-720p?token=OTHERSESSION";
    let mut chosen = a_chosen_stream();
    chosen["stream"]["playback"]["url"] = serde_json::Value::String(other.to_owned());
    let published = fixture
        .host
        .dispatch(action(&chosen))
        .expect("choosing another candidate works");

    assert_eq!(
        fixture.player.opened(),
        vec![CHOSEN.to_owned(), other.to_owned()]
    );
    assert_eq!(
        playback_of(&published.snapshots).state,
        PlaybackState::Opening
    );
    assert_eq!(
        playback_of(&published.snapshots).position,
        None,
        "the new Stream has not started, so where the old one was says nothing"
    );
    assert_eq!(published.snapshots[0].revision, before + 1);
}

#[test]
fn a_player_that_refuses_leaves_the_state_exactly_as_it_was() {
    let player = Arc::new(
        FixturePlayer::new()
            .refusing(PlaybackError::Open {
                detail: "mpv is gone".to_owned(),
            })
            .reporting(Observation::idle()),
    );
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
    let before = host.snapshot();

    let refused = host.dispatch(action(&a_chosen_stream()));

    assert!(
        matches!(&refused, Err(ActionError::Playback { detail }) if detail.contains("mpv is gone")),
        "the Player's refusal is reported in its own words: {refused:?}"
    );
    assert_eq!(
        host.snapshot(),
        before,
        "a Player that could not be told is not state the Host holds"
    );
}

#[test]
fn what_is_playing_does_not_survive_a_restart() {
    let store = Arc::new(InMemoryStore::new());
    let mut fixture = fixture_over(store.clone() as Arc<dyn Store>);
    playing(&mut fixture);
    assert_eq!(
        fixture.host.snapshot().playback.state,
        PlaybackState::Playing
    );

    let restarted = fixture_over(store as Arc<dyn Store>);

    assert_eq!(
        restarted.host.snapshot().playback.state,
        PlaybackState::Idle,
        "playback is state, not a stored fact: the Watch progress that outlives a \
         restart is #29's business"
    );
}
