import { useMemo } from "react";

import { PreviewLink } from "../previewLink";
import { PreviewDataProvider } from "./context";
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
  const client = useMemo(() => new PreviewLink(), []);

  return (
    <PreviewDataProvider value={true}>
      <RepertoryEntry client={client} />
    </PreviewDataProvider>
  );
}
