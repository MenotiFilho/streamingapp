import { createContext, useContext, type ReactNode } from "react";

import { DEFAULT_SETTINGS, type RepertorySettings } from "./settings";

/**
 * The rehearsal's settings and whether Home is reading live preview data.
 *
 * Both are prototype-only. The settings context has a default so every screen
 * can read it without a guard; the preview boolean defaults to false, which is
 * what the real Host's window sees.
 */

export type RepertorySettingsValue = {
  settings: RepertorySettings;
  update: (patch: Partial<RepertorySettings>) => void;
};

const SettingsContext = createContext<RepertorySettingsValue>({
  settings: DEFAULT_SETTINGS,
  update: () => undefined,
});

export function RepertorySettingsProvider({
  value,
  children,
}: {
  value: RepertorySettingsValue;
  children: ReactNode;
}) {
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useRepertorySettings(): RepertorySettingsValue {
  return useContext(SettingsContext);
}

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
