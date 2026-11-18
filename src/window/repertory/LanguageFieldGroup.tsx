import type { LanguageKind } from "../../core/languageList";
import {
  FOLLOW_THE_FILE_AUDIO_LINE,
  FOLLOW_THE_FILE_SUBTITLE_LINE,
} from "../../core/languages";
import { useShell } from "../context";
import { Refusal } from "../Refusal";
import { languageDrawerLevel } from "./LanguageDrawer";
import { LanguageField } from "./LanguageField";
import { useLanguageList } from "./useLanguageList";

const FOLLOW_LINES: Record<LanguageKind, string> = {
  subtitle: FOLLOW_THE_FILE_SUBTITLE_LINE,
  audio: FOLLOW_THE_FILE_AUDIO_LINE,
};

/** One list in Preferences: its field, what an empty list means, and a refusal. */
export function LanguageFieldGroup({ kind }: { kind: LanguageKind }) {
  const { push } = useShell();
  const { list, error, change } = useLanguageList(kind);

  return (
    <div className="rep-lang">
      <LanguageField
        kind={kind}
        list={list}
        regionId={`settings-${kind}-languages-field`}
        onChange={(next) => void change(next)}
        onOpen={() => push(languageDrawerLevel(kind))}
      />
      {list.length === 0 ? (
        <p className="rep-log-note" data-testid={`language-follow-line-${kind}`}>
          {FOLLOW_LINES[kind]}
        </p>
      ) : null}
      <Refusal error={error} testId={`${kind}-languages-error`} />
    </div>
  );
}
