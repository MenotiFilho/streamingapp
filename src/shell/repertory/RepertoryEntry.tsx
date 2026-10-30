import { MotionConfig } from "motion/react";
import { useLayoutEffect, useMemo } from "react";

import { HostClient } from "../../host-client";
import { Shell } from "../Shell";
import { PreviewDataProvider } from "./context";
import { previewTransport } from "./previewHost";
import "./repertory.css";

function isTauriWindow(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * The repertory entry point, behind `VITE_UI=repertory`.
 *
 * In a plain Vite window there is no Host, so a preview transport answers from
 * the public Cinemeta addon; in the Tauri window the real HostClient is used
 * and only the frame and Home change. The prototype's rehearsal settings are
 * gone: the frame is the spine and the feature rotates.
 */
export function RepertoryEntry() {
  const preview = useMemo(() => !isTauriWindow(), []);
  const client = useMemo(() => (preview ? new HostClient(previewTransport) : undefined), [preview]);

  useLayoutEffect(() => {
    // The tokens live in `repertory/tokens.css`; the attribute is what applies
    // them. The Host's served Remote sets the same attribute when its page is
    // asked for with `?ui=repertory`, so one token sheet dresses both clients.
    const root = document.documentElement;
    root.dataset.ui = "repertory";
    return () => {
      delete root.dataset.ui;
    };
  }, []);

  return (
    <PreviewDataProvider value={preview}>
      {/*
       * One reduced-motion setting for the whole room (ADR-0031 §5): Motion
       * drops transform and layout animations and keeps opacity and colour
       * fades. Direct `animate()` calls check `useReducedMotion()` themselves.
       */}
      <MotionConfig reducedMotion="user">
        <div className="repertory-ui">
          <Shell client={client} presentation="repertory" />
        </div>
      </MotionConfig>
    </PreviewDataProvider>
  );
}
