import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";

import { HostClient } from "../../host-client";
import { Shell } from "../Shell";
import { PreviewDataProvider, RepertorySettingsProvider } from "./context";
import { applyPalette, clearPalette } from "./palette";
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
 * a frame/pairing comparison is a URL someone can send back.
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
    const root = document.documentElement;
    applyPalette(root);
    root.dataset.ui = "repertory";
    root.dataset.pairing = settings.pairing;
    return () => {
      clearPalette(root);
      delete root.dataset.ui;
      delete root.dataset.pairing;
    };
  }, [settings.pairing]);

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
        <div className="repertory-ui" data-frame={settings.frame} data-pairing={settings.pairing}>
          <Shell client={client} presentation="repertory" />
          {settings.rehearsal ? <RehearsalBar /> : null}
        </div>
      </PreviewDataProvider>
    </RepertorySettingsProvider>
  );
}
