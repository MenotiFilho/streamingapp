import { MotionConfig } from "motion/react";

import type { HostLink } from "../../core/link";
import "../../kit/kit.css";
import "./marquee.css";
import { MarqueeShell } from "./MarqueeShell";

export type MarqueeEntryProps = {
  client?: HostLink;
};

/**
 * The window's entry point (#358, #365): the one client the window draws.
 *
 * Imports `kit.css` and `marquee.css`, wraps the shell in `<MotionConfig
 * reducedMotion="user">` (ADR-0031 §5) and `.mq-root`, and connects to the Host
 * through `TauriLink` (or an explicit `HostLink` in tests / rehearsal).
 */
export function MarqueeEntry({ client }: MarqueeEntryProps = {}) {
  return (
    <MotionConfig reducedMotion="user">
      <div className="mq-root mq-ui">
        <MarqueeShell client={client} />
      </div>
    </MotionConfig>
  );
}
