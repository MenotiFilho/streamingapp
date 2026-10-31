import { createContext, useContext, type ReactNode } from "react";

/**
 * Whether Home is reading live preview data. It is the one prototype bridge
 * left in the entry: the plain Vite page has no Host, so the preview transport
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

/** Whether Home is drawn from the live-catalogue preview rather than a Host. */
export function usePreviewData(): boolean {
  return useContext(PreviewContext);
}
