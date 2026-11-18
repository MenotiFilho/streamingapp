import { rows, tick, untick, type LanguageKind } from "../core/languageList";
import { useLanguageList } from "../core/react/useLanguageList";
import type { Session, SessionState } from "../core/session";
import { MenuGroup, MenuRow } from "../kit/Menu";
import { Sheet } from "../kit/Sheet";
import { Refusal } from "./Settings";
import { LANGUAGE_GROUP_HEADS } from "./settingsScreen";

/**
 * The kit Sheet a field's ▾ opens (#330, ADR-0035 §2): the tick list of the
 * curated languages with the chosen ones lifted to the top in rank. A row is a
 * tick or an untick, and every press sends the whole list at once. There is no
 * ↑ ↓ here: the phone reorders by dragging a chip in the field, and a rank is
 * made by the order of ticks. The decisions are `core/languageList`.
 */
export function LanguageSheet({
  kind,
  session,
  state,
  onClose,
}: {
  kind: LanguageKind;
  session: Session;
  state: SessionState;
  onClose: () => void;
}) {
  const { list, error, change, current } = useLanguageList(kind, state.snapshot, session.ask);
  const view = rows(list);

  return (
    <Sheet
      open
      title={LANGUAGE_GROUP_HEADS[kind]}
      closeLabel="Done"
      onClose={onClose}
      testId={`language-sheet-${kind}`}
    >
      {view.chosen.length > 0 ? (
        <MenuGroup title="Chosen">
          {view.chosen.map((row) => (
            <MenuRow
              key={row.tag}
              pressed
              marks={row.ordinal ? [row.ordinal] : undefined}
              testId={`language-chosen-${row.tag}`}
              onPress={() => void change(untick(current(), row.tag))}
            >
              <span className="remote-lang-check">✓</span>
              {row.name}
            </MenuRow>
          ))}
        </MenuGroup>
      ) : null}

      <MenuGroup title="Languages">
        {view.rest.map((row) => (
          <MenuRow
            key={row.tag}
            pressed={false}
            disabled={row.disabled}
            testId={`language-row-${row.tag}`}
            onPress={() => void change(tick(current(), row.tag))}
          >
            <span className="remote-lang-check" />
            {row.name}
          </MenuRow>
        ))}
      </MenuGroup>

      {view.note ? (
        <p className="remote-quiet" data-testid="language-note">
          {view.note}
        </p>
      ) : null}
      <Refusal error={error} />
    </Sheet>
  );
}
