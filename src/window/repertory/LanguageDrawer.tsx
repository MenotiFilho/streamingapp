import { down, rows, tick, untick, up, type LanguageKind } from "../../core/languageList";
import { Button } from "../../kit/Button";
import { MenuGroup, MenuRow } from "../../kit/Menu";
import { useShell, type NewShellLevel } from "../context";
import { Refusal } from "../Refusal";
import { LanguageField } from "./LanguageField";
import { LANGUAGE_TITLES } from "./languageTitles";
import { useLanguageList } from "./useLanguageList";
import "./languages.css";

/**
 * The drawer a field's ▾ opens: the live field, the "Chosen" group in rank with
 * ↑ ↓ on each row, then "Languages", the rest in curated order, with rows
 * disabled at three. It is how the keyboard and the pad add, remove and
 * reorder, so every row is a control and none is drag-only.
 *
 * It is a pushed level, so Back puts it away and the focus underneath comes
 * back to the ▾; Done is the same pop, for a pointer. Every press sends the
 * whole list at once (`useLanguageList`). The decisions are
 * `src/core/languageList`.
 */
export function LanguageDrawer({ kind }: { kind: LanguageKind }) {
  const { pop } = useShell();
  const { list, error, change, current } = useLanguageList(kind);
  const title = LANGUAGE_TITLES[kind];
  const view = rows(list);

  return (
    <div className="rep-lang-scrim" onClick={pop}>
      <aside
        className="rep-lang-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid={`language-drawer-${kind}`}
        data-region={`language-drawer-${kind}-panel`}
        data-kind="branch"
        data-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="rep-lang-drawer-head">
          <h2 className="rep-lang-drawer-title">{title}</h2>
          <Button variant="ghost" autoFocus onClick={pop}>
            Done
          </Button>
        </header>

        <LanguageField
          kind={kind}
          list={list}
          regionId={`language-drawer-${kind}-field`}
          onChange={(next) => void change(next)}
        />

        {view.chosen.length > 0 ? (
          <div
            data-region={`language-drawer-${kind}-chosen`}
            data-kind="row"
            data-label="Chosen"
          >
            <MenuGroup title="Chosen">
              {view.chosen.map((row) => (
                <div key={row.tag} className="rep-lang-chosen">
                  <MenuRow
                    pressed
                    marks={row.ordinal ? [row.ordinal] : undefined}
                    testId={`language-chosen-${row.tag}`}
                    onPress={() => void change(untick(current(), row.tag))}
                  >
                    <span className="rep-lang-check">✓</span>
                    {row.name}
                  </MenuRow>
                  <Button
                    variant="ghost"
                    className="rep-lang-step"
                    disabled={!row.canUp}
                    aria-label={`Move ${row.name} up`}
                    data-testid={`language-up-${row.tag}`}
                    onClick={() => void change(up(current(), row.index))}
                  >
                    ↑
                  </Button>
                  <Button
                    variant="ghost"
                    className="rep-lang-step"
                    disabled={!row.canDown}
                    aria-label={`Move ${row.name} down`}
                    data-testid={`language-down-${row.tag}`}
                    onClick={() => void change(down(current(), row.index))}
                  >
                    ↓
                  </Button>
                </div>
              ))}
            </MenuGroup>
          </div>
        ) : null}

        <div
          data-region={`language-drawer-${kind}-languages`}
          data-kind="row"
          data-label="Languages"
        >
          <MenuGroup title="Languages">
            {view.rest.map((row) => (
              <MenuRow
                key={row.tag}
                pressed={false}
                disabled={row.disabled}
                testId={`language-row-${row.tag}`}
                onPress={() => void change(tick(current(), row.tag))}
              >
                <span className="rep-lang-check" />
                {row.name}
              </MenuRow>
            ))}
          </MenuGroup>
        </div>

        {view.note ? (
          <p className="rep-lang-note" data-testid="language-note">
            {view.note}
          </p>
        ) : null}
        <Refusal error={error} testId="language-drawer-error" />
      </aside>
    </div>
  );
}

/** The level a field's ▾ pushes; one id per list, so a second press replaces it. */
export function languageDrawerLevel(kind: LanguageKind): NewShellLevel {
  return {
    id: `language-drawer-${kind}`,
    name: LANGUAGE_TITLES[kind],
    kind: "overlay",
    payload: {
      render: () => <LanguageDrawer kind={kind} />,
    },
  };
}
