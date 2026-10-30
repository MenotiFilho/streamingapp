import { useMemo } from "react";

import { HostClient } from "../../host-client";
import { PreviewDataProvider } from "./context";
import { previewTransport } from "./previewHost";
import { RepertoryEntry } from "./RepertoryEntry";

/**
 * The plain-Vite rehearsal entry (`VITE_UI=rehearsal`, #160).
 *
 * When a developer runs the window in a browser with no Tauri Host behind it,
 * this entry supplies the Cinemeta preview transport and the sample Library /
 * Watch-progress fixtures so the room can be rehearsed on its own. The
 * production entry (`RepertoryEntry`) never imports or activates either.
 */
export function RehearsalEntry() {
  const client = useMemo(() => new HostClient(previewTransport), []);

  return (
    <PreviewDataProvider value={true}>
      <RepertoryEntry client={client} />
    </PreviewDataProvider>
  );
}
