import { useMemo } from "react";

import { MarqueeEntry } from "../marquee/MarqueeEntry";
import { PreviewLink } from "../previewLink";
import { PreviewDataProvider } from "./previewData";

/**
 * The rehearsal: the window in a plain browser, with no Tauri Host behind it.
 *
 * It mounts the same room as the window over `PreviewLink` (live Cinemeta
 * catalogs and sample Continue watching). Only `rehearsal.html` loads it, and
 * the build's one entry is `index.html`, so it never ships.
 */
export function RehearsalEntry() {
  const client = useMemo(() => new PreviewLink(), []);

  return (
    <PreviewDataProvider value={true}>
      <MarqueeEntry client={client} />
    </PreviewDataProvider>
  );
}
