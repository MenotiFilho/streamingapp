import type { Ref } from "react";

import { Icon } from "./repertory/icons";
import { useFullscreen } from "./useFullscreen";

/**
 * The one fullscreen control: its label, its pressed state, its title, what a
 * click does, and its icon all come from here, so the shell's chrome and the
 * player's OSD cannot drift apart (#125).
 *
 * The surface that draws it decides only how it looks — the chrome's circle or
 * the OSD's icon-sized button. Whether there is a window at all is the hook's
 * synchronous answer: Tauri's window, or the browser document on the Vite dev
 * page. A page with no Fullscreen API at all (a test, an embedded webview that
 * refuses it) draws nothing: a button that cannot work is worse than no button.
 */
export function FullscreenButton({
  className,
  testId,
  ref,
  presentation = "velvet",
}: {
  /** The kit class the surface draws the control with. */
  className: string;
  testId: string;
  /** The OSD's focus ladder keeps hold of the control it lands on. */
  ref?: Ref<HTMLButtonElement>;
  /** Which drawn set the surface uses (#158). */
  presentation?: "velvet" | "repertory";
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
      {presentation === "repertory" ? (
        <Icon name="fullscreen" strokeWidth={2.2} />
      ) : (
        <FullscreenIcon exit={fullscreen} />
      )}
    </button>
  );
}

/**
 * The one fullscreen mark. Entering and leaving fullscreen look the same
 * wherever the control is drawn.
 */
function FullscreenIcon({ exit }: { exit: boolean }) {
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
