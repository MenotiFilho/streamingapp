import { MotionConfig } from "motion/react";

import type { HostLink } from "../../core/link";
import { Shell } from "../Shell";
import "./repertory.css";

interface RepertoryEntryProps {
  client?: HostLink;
}

/**
 * The window's entry point (#160).
 *
 * Renders the shell over the real `TauriLink` in the Tauri window (or an
 * explicit link handed in by a test or the rehearsal entry). It never wires the
 * rehearsal preview transport or sample data on its own.
 */
export function RepertoryEntry({ client }: RepertoryEntryProps = {}) {
  return (
    /*
     * One reduced-motion setting for the whole room (ADR-0031 §5): Motion
     * drops transform and layout animations and keeps opacity and colour
     * fades. Direct `animate()` calls check `useReducedMotion()` themselves.
     */
    <MotionConfig reducedMotion="user">
      <div className="repertory-ui">
        <Shell client={client} />
      </div>
    </MotionConfig>
  );
}
