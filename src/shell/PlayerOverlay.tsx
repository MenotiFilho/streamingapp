import { Button } from "./kit";
import { useShell } from "./context";
import { formatTime, playingName, transportable } from "../playback";

/**
 * The player level over the video hole.
 *
 * Only the baseline is here: the window has become the player, so the browsing
 * stack is put aside and Back stops playback. The edge-to-edge uosc OSD — its
 * track popovers, chapter marks and episode stepping — is #83's screen, and it
 * pushes the same kind of level this frame already knows how to pop.
 */
export function PlayerOverlay() {
  const { snapshot, take } = useShell();
  const playback = snapshot?.playback ?? null;
  if (!playback) {
    return null;
  }

  const playing = playback.state === "playing";
  const canTransport = transportable(playback.state);

  return (
    <section
      className="shell-player"
      aria-label="Playing"
      role="region"
      data-testid="shell-player"
      data-state={playback.state}
      data-picture={playback.picture}
    >
      <div className="shell-player-picture" aria-hidden="true" />

      {playback.failure ? (
        <p role="alert" className="shell-alert shell-player-alert">
          {`${playback.failure} Pick another Stream from the list.`}
        </p>
      ) : null}

      <div className="shell-player-bar">
        <div className="shell-player-now">
          <p className="shell-player-title" data-testid="shell-now-playing">
            {`Playing ${playingName(playback.nowPlaying)}`}
          </p>
          <p className="shell-player-clock kit-tabular" data-testid="shell-clock">
            {`${formatTime(playback.position)} / ${formatTime(playback.duration)}`}
          </p>
        </div>

        <div className="shell-player-controls">
          {canTransport ? (
            <>
              <Button
                aria-label="Back ten seconds"
                onClick={() =>
                  void take({ type: "seek", target: { kind: "by", seconds: -10 } })
                }
              >
                −10 s
              </Button>
              <Button
                aria-label={playing ? "Pause" : "Play"}
                data-testid={playing ? "pause" : "play"}
                onClick={() => void take({ type: "set_paused", paused: playing })}
              >
                {playing ? "Pause" : "Play"}
              </Button>
              <Button
                aria-label="Forward ten seconds"
                onClick={() =>
                  void take({ type: "seek", target: { kind: "by", seconds: 10 } })
                }
              >
                +10 s
              </Button>
            </>
          ) : null}
          <Button
            variant="primary"
            danger
            data-testid="shell-stop"
            onClick={() => void take({ type: "stop_playback" })}
          >
            Stop
          </Button>
        </div>
      </div>
    </section>
  );
}
