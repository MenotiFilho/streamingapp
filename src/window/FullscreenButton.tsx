import { Icon } from "../kit/icons";
import { useFullscreen } from "./useFullscreen";

/**
 * The window chrome's fullscreen control: its label, its pressed state, its
 * title and what a click does come from the window's one fullscreen fact, so it
 * and the player's own menu button cannot drift apart (#125).
 *
 * Whether there is a window at all is the hook's synchronous answer: Tauri's
 * window, or the browser document on the Vite dev page. A page with no
 * Fullscreen API at all (a test, an embedded webview that refuses it) draws
 * nothing: a button that cannot work is worse than no button.
 */
export function FullscreenButton({
  className,
  testId,
}: {
  /** The class the surface draws the control with. */
  className: string;
  testId: string;
}) {
  const { fullscreen, supported, toggle } = useFullscreen();
  if (!supported) {
    return null;
  }
  const label = fullscreen ? "Exit full screen" : "Full screen";

  return (
    <button
      type="button"
      className={className}
      data-focusable
      data-testid={testId}
      aria-label={label}
      aria-pressed={fullscreen}
      title={label}
      onClick={() => void toggle()}
    >
      <Icon name="maximize" />
    </button>
  );
}
