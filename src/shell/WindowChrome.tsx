import { useFullscreen } from "./useFullscreen";

/**
 * The window's own fullscreen control, fixed at the top right.
 *
 * The OSD's copy belongs to the player and goes away with it. Stop takes the
 * player level off and leaves the window fullscreen, so the surface underneath
 * needs a way out of the window it is in; the same is true of Settings, a
 * Title, and a dialog (#125). The frame draws this inside whichever screen is
 * on top, and a player level has none because its OSD already carries the
 * button.
 *
 * The region is a transparent strip across the top rather than the button
 * alone: it is what Up from a screen's top row lands on, and it must not take a
 * click meant for the content underneath. `pointer-events: none` on the strip
 * and `auto` on the button is the CSS half of that promise; the button is still
 * a normal focus target.
 */
export function WindowChrome() {
  const { fullscreen, toggle } = useFullscreen();
  const label = fullscreen ? "Exit full screen" : "Full screen";

  return (
    <div
      className="shell-window-chrome"
      data-testid="window-chrome"
      data-region="window"
      data-kind="row"
      data-label="Window"
    >
      <button
        type="button"
        className="shell-window-chrome-button kit-focus-invert"
        data-focusable
        data-testid="window-fullscreen"
        aria-label={label}
        aria-pressed={fullscreen}
        title={label}
        onClick={() => void toggle()}
      >
        <FullscreenIcon exit={fullscreen} />
      </button>
    </div>
  );
}

/**
 * The one fullscreen mark. The shell's chrome and the player's OSD draw the
 * same icon, so leaving and entering fullscreen look the same wherever the
 * control is.
 */
export function FullscreenIcon({ exit }: { exit: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      {exit ? (
        <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
      ) : (
        <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
      )}
    </svg>
  );
}
