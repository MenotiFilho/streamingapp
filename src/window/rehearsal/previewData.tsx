import { createContext, useContext, type ReactNode } from "react";

/**
 * Whether the screens are reading live preview data. It is the one bridge the
 * rehearsal needs: the plain Vite page has no Host, so the preview transport
 * answers from Cinemeta. The real Tauri window sees false.
 */
const PreviewContext = createContext(false);

export function PreviewDataProvider({
  value,
  children,
}: {
  value: boolean;
  children: ReactNode;
}) {
  return <PreviewContext.Provider value={value}>{children}</PreviewContext.Provider>;
}

/** Whether the screen is drawn from the live-catalogue preview rather than a Host. */
export function usePreviewData(): boolean {
  return useContext(PreviewContext);
}
