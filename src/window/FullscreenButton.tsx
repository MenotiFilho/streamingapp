import type { Ref } from "react";

import { Icon } from "./repertory/icons";
import { useFullscreen } from "./useFullscreen";

/**
 * The one fullscreen control: its label, its pressed state, its title, what a
 * click does, and its icon all come from here, so the shell's chrome and the
 * player's OSD cannot drift apart (#125).
 *
 * The surface that draws it decides only how it looks — the chrome's hairline
 * square or the OSD's icon-sized button. Whether there is a window at all is
 * the hook's synchronous answer: Tauri's window, or the browser document on the
 * Vite dev page. A page with no Fullscreen API at all (a test, an embedded
 * webview that refuses it) draws nothing: a button that cannot work is worse
 * than no button.
 */
export function FullscreenButton({
  className,
  testId,
  ref,
}: {
  /** The kit class the surface draws the control with. */
  className: string;
  testId: string;
  /** The OSD's focus ladder keeps hold of the control it lands on. */
  ref?: Ref<HTMLButtonElement>;
}) {
  const { fullscreen, supported, toggle } = useFullscreen();
  if (!supported) {
    return null;
  }
  const label = fullscreen ? "Exit full screen" : "Full screen";

  return (
    <button
      ref={ref}
      type="button"
      className={className}
      data-focusable
      data-testid={testId}
      aria-label={label}
      aria-pressed={fullscreen}
      title={label}
      onClick={() => void toggle()}
    >
      <Icon name="fullscreen" strokeWidth={2.2} />
    </button>
  );
}
