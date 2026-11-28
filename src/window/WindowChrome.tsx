import { FullscreenButton } from "./FullscreenButton";
import { useFullscreen } from "./useFullscreen";

/**
 * The window's own fullscreen control, fixed at the top right.
 *
 * The player's own control goes away with its OSD. Stop takes the player Level
 * off and leaves the window fullscreen, so the surface underneath needs a way
 * out of the window it is in; the same is true of Settings, a Title, and a
 * confirmation (#125). The frame draws this inside whichever screen is on top,
 * and a player Level has none because its OSD already carries the button.
 *
 * The region is a transparent strip across the top rather than the button
 * alone: it is what Up from a screen's top row lands on, and it must not take a
 * click meant for the content underneath. `pointer-events: none` on the strip
 * and `auto` on the button is the CSS half of that promise; the button is still
 * a normal focus target. `data-kind="window"` is the model half: the strip's
 * full width is allowed to carry the cross-axis guard, so Down from its button
 * at the right still reaches a dialog centred below. No other kind gets that.
 *
 * A page with no window it can put fullscreen — a test, an embedded webview
 * with no Fullscreen API — draws no strip at all: the control would be a button
 * that cannot work. The Vite dev page has the browser's own document, so it
 * gets the same strip on every screen.
 */
export function WindowChrome() {
  const { supported } = useFullscreen();
  if (!supported) {
    return null;
  }

  return (
    <div
      className="shell-window-chrome"
      data-testid="window-chrome"
      data-region="window"
      data-kind="window"
      data-label="Window"
    >
      <FullscreenButton
        className="shell-window-chrome-button"
        testId="window-fullscreen"
      />
    </div>
  );
}
