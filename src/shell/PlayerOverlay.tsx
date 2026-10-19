import { Button } from "./kit";
import { useShell } from "./context";
import { playingName } from "../playback";

/**
 * The player level over the video hole.
 *
 * Only the takeover is here: the window has become the player, so the browsing
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

      <div className="shell-player-bar">
        <div className="shell-player-now">
          <p className="shell-player-title" data-testid="shell-now-playing">
            {`Playing ${playingName(playback.nowPlaying)}`}
          </p>
        </div>

        <div className="shell-player-controls">
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
