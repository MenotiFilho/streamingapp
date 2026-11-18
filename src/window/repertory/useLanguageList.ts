import { useLanguageList as useSharedLanguageList } from "../../core/react/useLanguageList";
import type { LanguageKind } from "../../core/languageList";
import { useShell } from "../context";

/** One language list as the window edits it: the shared hook over the shell's Host. */
export function useLanguageList(kind: LanguageKind) {
  const { snapshot, ask } = useShell();
  return useSharedLanguageList(kind, snapshot, ask);
}
