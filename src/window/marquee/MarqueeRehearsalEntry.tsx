import { useMemo } from "react";

import { PreviewLink } from "../previewLink";
import { PreviewDataProvider } from "../repertory/context";
import { MarqueeEntry } from "./MarqueeEntry";

/**
 * Plain-Vite rehearsal entry for Marquee (`VITE_UI=marquee-rehearsal`, #358).
 *
 * Runs the Marquee window in a browser without a Tauri Host by supplying the
 * shared `PreviewLink` (live Cinemeta catalogs + sample Continue watching).
 */
export function MarqueeRehearsalEntry() {
  const client = useMemo(() => new PreviewLink(), []);

  return (
    <PreviewDataProvider value={true}>
      <MarqueeEntry client={client} />
    </PreviewDataProvider>
  );
}
