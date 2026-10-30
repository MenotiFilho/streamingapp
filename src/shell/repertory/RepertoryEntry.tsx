import { MotionConfig } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";

import { HostClient } from "../../host-client";
import { Shell } from "../Shell";
import { PreviewDataProvider, RepertorySettingsProvider } from "./context";
import { RehearsalBar } from "./RehearsalBar";
import { previewTransport } from "./previewHost";
import { parseSettings, settingsQuery, type RepertorySettings } from "./settings";
import "./repertory.css";

function isTauriWindow(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * The repertory prototype's entry point, behind `VITE_UI=repertory`.
 *
 * In a plain Vite window there is no Host, so a preview transport answers from
 * the public Cinemeta addon; in the Tauri window the real HostClient is used
 * and only the frame and Home change. The settings live in the query string so
 * a frame comparison is a URL someone can send back.
 */
export function RepertoryEntry() {
  const [settings, setSettings] = useState<RepertorySettings>(() =>
    parseSettings(window.location.search),
  );
  const preview = useMemo(() => !isTauriWindow(), []);
  const client = useMemo(() => (preview ? new HostClient(previewTransport) : undefined), [preview]);
  const update = useCallback((patch: Partial<RepertorySettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

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

  useEffect(() => {
    const query = settingsQuery(settings);
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}?${query}${window.location.hash}`,
    );
  }, [settings]);

  return (
    <RepertorySettingsProvider value={{ settings, update }}>
      <PreviewDataProvider value={preview}>
        {/*
         * One reduced-motion setting for the whole room (ADR-0031 §5): Motion
         * drops transform and layout animations and keeps opacity and colour
         * fades. Direct `animate()` calls check `useReducedMotion()` themselves.
         */}
        <MotionConfig reducedMotion="user">
          <div className="repertory-ui" data-frame={settings.frame}>
            <Shell client={client} presentation="repertory" />
            {settings.rehearsal ? <RehearsalBar /> : null}
          </div>
        </MotionConfig>
      </PreviewDataProvider>
    </RepertorySettingsProvider>
  );
}
