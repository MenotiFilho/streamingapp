/*
 * PROTOTYPE (#300, throwaway — never merged).
 *
 * Three variants of how Subtitle languages and Audio languages are edited in
 * Settings, switchable via `?variant=A|B|C`, drawn inside the real Preferences
 * screens on the rehearsal Host (`?proto=languages`), on the window and on the
 * Remote client:
 *
 *   A  Three fixed slots per list ("1st / 2nd / 3rd"); a slot opens a picker.
 *   B  A short ranked list: rows with Up / Down / Remove, and "Add a language".
 *   C  Tap-to-rank: today's chip wall, where pressing a chip appends it with
 *      its rank and pressing it again takes it out.
 *   D  A multi-select field (the owner's reference): the chosen languages as
 *      removable chips in a field, and a list under it that ticks them.
 *
 * Client-side pretend: the real thing is two Host preferences and the Actions
 * `set_subtitle_languages` / `set_audio_languages`, each carrying the whole
 * list. The bar shows the list each edit would send. No tests, no persistence.
 */
import { useState, useSyncExternalStore } from "react";

import { SUBTITLE_LANGUAGES, subtitleLanguageName } from "../core/languages";
import { Button } from "../kit/Button";
import { ChoiceChip } from "../kit/Chip";
import { MenuGroup, MenuRow } from "../kit/Menu";
import { Sheet } from "../kit/Sheet";
import "./languages300.css";

const PARAMS =
  typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);

export const PROTO = PARAMS.get("proto") === "languages";

export type Variant = "A" | "B" | "C" | "D";
const VARIANTS: Variant[] = ["A", "B", "C", "D"];
const VARIANT_NAMES: Record<Variant, string> = {
  A: "Three fixed slots",
  B: "Ranked list: add, move, remove",
  C: "Tap-to-rank chips",
  D: "Chips in a field + a list",
};

export type Kind = "subtitle" | "audio";
type Lists = Record<Kind, string[]>;

const SEEDS: Record<string, Lists> = {
  empty: { subtitle: [], audio: [] },
  migrated: { subtitle: ["pt-BR"], audio: [] },
  full: { subtitle: ["pt-BR", "en", "es-419"], audio: ["ja", "en"] },
};

type State = { variant: Variant; lists: Lists; log: string[] };

function readVariant(): Variant {
  const held = PARAMS.get("variant");
  return VARIANTS.includes(held as Variant) ? (held as Variant) : "A";
}

let state: State = {
  variant: readVariant(),
  lists: SEEDS[PARAMS.get("seed") ?? "migrated"] ?? SEEDS.migrated!,
  log: [],
};
const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

function send(kind: Kind, list: string[]) {
  const action = `{ type: "set_${kind}_languages", languages: ${JSON.stringify(list)} }`;
  set({ lists: { ...state.lists, [kind]: list }, log: [action, ...state.log].slice(0, 4) });
}

function useProto(): State {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}

function setVariant(variant: Variant) {
  const url = new URL(window.location.href);
  url.searchParams.set("variant", variant);
  window.history.replaceState(null, "", url);
  set({ variant });
}

const ORDINALS = ["1st", "2nd", "3rd"];
const KIND_LABEL: Record<Kind, string> = { subtitle: "Subtitles", audio: "Audio" };
const KIND_HEAD: Record<Kind, string> = {
  subtitle: "Subtitle languages",
  audio: "Audio languages",
};
const FOLLOW = "Follow the file";
const FOLLOW_NOTE: Record<Kind, string> = {
  subtitle: "The subtitle the file marks as default, if it has one.",
  audio: "The soundtrack the file marks as default.",
};
const MAX = 3;

type Surface = "window" | "remote";

/* --------------------------------------------------------------------------
 * The prototype bar: deliberately not the design.
 * -------------------------------------------------------------------------- */

export function ProtoBar({ surface }: { surface: Surface }) {
  const { variant, lists, log } = useProto();
  const step = (by: number) =>
    setVariant(VARIANTS[(VARIANTS.indexOf(variant) + by + VARIANTS.length) % VARIANTS.length]!);
  return (
    <div className="proto-bar" data-surface={surface}>
      <button type="button" onClick={() => step(-1)} aria-label="Previous variant">
        ‹
      </button>
      <strong>
        {variant} <small>({VARIANT_NAMES[variant]})</small>
      </strong>
      <button type="button" onClick={() => step(1)} aria-label="Next variant">
        ›
      </button>
      <span className="proto-bar-rule" />
      <small>seed</small>
      {Object.keys(SEEDS).map((seed) => (
        <button type="button" key={seed} onClick={() => set({ lists: SEEDS[seed]!, log: [] })}>
          {seed}
        </button>
      ))}
      <span className="proto-bar-rule" />
      <code>
        subtitle {JSON.stringify(lists.subtitle)} · audio {JSON.stringify(lists.audio)}
      </code>
      {log[0] ? <code className="proto-bar-log">sent {log[0]}</code> : null}
    </div>
  );
}

/* --------------------------------------------------------------------------
 * The section, placed where the variant puts it.
 * -------------------------------------------------------------------------- */

/**
 * `at` is the place in Preferences the host screen offers: "before" Subtitle
 * appearance (where Subtitle language sits today) or "after" it.
 * `Group` is the screen's own section frame (LogGroup on the window, the
 * Remote's section), so the prototype sits in the real page's anatomy.
 */
export function ProtoLanguages({
  surface,
  at,
  Group,
}: {
  surface: Surface;
  at: "before" | "after";
  Group: (props: { id: string; title: string; children: React.ReactNode }) => React.ReactNode;
}) {
  const { variant } = useProto();

  if (variant === "A") {
    // One "Languages" group holding both lists, before appearance.
    if (at !== "before") return null;
    return (
      <Group id="settings-languages" title="Languages">
        <Slots surface={surface} kind="subtitle" />
        <Slots surface={surface} kind="audio" />
      </Group>
    );
  }
  if (variant === "B") {
    // Two groups, both before appearance.
    if (at !== "before") return null;
    return (
      <>
        <Group id="settings-subtitle-languages" title={KIND_HEAD.subtitle}>
          <Ranked surface={surface} kind="subtitle" />
        </Group>
        <Group id="settings-audio-languages" title={KIND_HEAD.audio}>
          <Ranked surface={surface} kind="audio" />
        </Group>
      </>
    );
  }
  if (variant === "D") {
    // One "Languages" group, a labelled field per list, before appearance.
    if (at !== "before") return null;
    return (
      <Group id="settings-languages" title="Languages">
        <ChipField surface={surface} kind="subtitle" />
        <ChipField surface={surface} kind="audio" />
      </Group>
    );
  }
  // C: subtitles before appearance (beside it), audio after it.
  const kind: Kind = at === "before" ? "subtitle" : "audio";
  return (
    <Group id={`settings-${kind}-languages`} title={KIND_HEAD[kind]}>
      <RankChips surface={surface} kind={kind} />
    </Group>
  );
}

/* --------------------------------------------------------------------------
 * A: three fixed slots.
 * -------------------------------------------------------------------------- */

function Slots({ surface, kind }: { surface: Surface; kind: Kind }) {
  const list = useProto().lists[kind];
  const [open, setOpen] = useState<number | null>(null);

  const choose = (slot: number, tag: string) => {
    const next = [...list];
    const at = list.indexOf(tag);
    if (at === slot) {
      // already here
    } else if (at >= 0 && slot < list.length) {
      // swap the two slots
      next[at] = list[slot]!;
      next[slot] = tag;
    } else if (at >= 0) {
      // slot is the next empty one: move it to the end
      next.splice(at, 1);
      next.push(tag);
    } else if (slot < list.length) {
      next[slot] = tag;
    } else {
      next.push(tag);
    }
    send(kind, next);
    setOpen(null);
  };
  const clear = (slot: number) => {
    send(kind, list.filter((_, index) => index !== slot));
    setOpen(null);
  };

  const options = (slot: number) =>
    SUBTITLE_LANGUAGES.map((language) => {
      const at = list.indexOf(language.tag);
      return {
        tag: language.tag,
        name: language.name,
        pressed: at === slot,
        mark: at >= 0 && at !== slot ? `${ORDINALS[at]} · swap` : undefined,
      };
    });

  return (
    <div className="rep-log-choice-group proto-slots" data-surface={surface}>
      <p className={surface === "window" ? "rep-log-choice-label" : "remote-settings-sub"}>
        {KIND_LABEL[kind]}
      </p>
      {[0, 1, 2].map((slot) => {
        const tag = list[slot];
        const reachable = slot <= list.length;
        const words =
          slot === 0 && list.length === 0
            ? FOLLOW
            : tag
              ? subtitleLanguageName(tag)
              : reachable
                ? "Add a fallback"
                : "—";
        return (
          <div key={slot}>
            <div data-region={`proto-${kind}-slot-${slot}`} data-kind="row">
            <button
              type="button"
              className="proto-slot"
              data-focusable
              data-empty={!tag || undefined}
              aria-expanded={open === slot}
              disabled={!reachable}
              onClick={() => setOpen(open === slot ? null : slot)}
            >
              <span className="proto-slot-ordinal">{ORDINALS[slot]}</span>
              <span className="proto-slot-name">{words}</span>
              <span className="proto-slot-trail">
                {slot === 0 && list.length === 0 ? "Choose" : tag ? "Change" : reachable ? "Choose" : ""}
              </span>
            </button>
            </div>
            {surface === "window" && open === slot ? (
              <div className="proto-inline-picker">
                <div className="rep-log-chips" data-region={`proto-${kind}-picker`} data-kind="row">
                  {tag ? (
                    <ChoiceChip pressed={false} onClick={() => clear(slot)}>
                      {slot === 0 && list.length === 1 ? `Clear (${FOLLOW.toLowerCase()})` : "Clear this slot"}
                    </ChoiceChip>
                  ) : null}
                  {options(slot).map((option) => (
                    <ChoiceChip
                      key={option.tag}
                      pressed={option.pressed}
                      onClick={() => choose(slot, option.tag)}
                    >
                      {option.name}
                      {option.mark ? <span className="proto-chip-mark"> {option.mark}</span> : null}
                    </ChoiceChip>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
      {list.length === 0 ? <p className="proto-note">{FOLLOW_NOTE[kind]}</p> : null}
      {surface === "remote" ? (
        <Sheet
          open={open !== null}
          title={`${KIND_LABEL[kind]} · ${open !== null ? ORDINALS[open] : ""}`}
          closeLabel="Done"
          onClose={() => setOpen(null)}
        >
          {open !== null ? (
            <MenuGroup title="Languages">
              {list[open] ? (
                <MenuRow onPress={() => clear(open)}>
                  {open === 0 && list.length === 1 ? `Clear · ${FOLLOW.toLowerCase()}` : "Clear this slot"}
                </MenuRow>
              ) : null}
              {options(open).map((option) => (
                <MenuRow
                  key={option.tag}
                  pressed={option.pressed}
                  marks={option.mark ? [option.mark] : undefined}
                  onPress={() => choose(open, option.tag)}
                >
                  {option.name}
                </MenuRow>
              ))}
            </MenuGroup>
          ) : null}
        </Sheet>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------------------
 * B: a ranked list with add, move and remove.
 * -------------------------------------------------------------------------- */

function Ranked({ surface, kind }: { surface: Surface; kind: Kind }) {
  const list = useProto().lists[kind];
  const [adding, setAdding] = useState(false);

  const move = (index: number, by: number) => {
    const next = [...list];
    const [tag] = next.splice(index, 1);
    next.splice(index + by, 0, tag!);
    send(kind, next);
  };
  const remove = (index: number) => send(kind, list.filter((_, at) => at !== index));
  const add = (tag: string) => {
    send(kind, [...list, tag]);
    setAdding(false);
  };
  const unlisted = SUBTITLE_LANGUAGES.filter((language) => !list.includes(language.tag));

  return (
    <div className="proto-ranked" data-surface={surface}>
      {list.length === 0 ? (
        <div className="proto-ranked-empty">
          <span className="proto-ranked-follow">{FOLLOW}</span>
          <span className="proto-note">{FOLLOW_NOTE[kind]}</span>
        </div>
      ) : (
        <ol className="proto-ranked-list">
          {list.map((tag, index) => (
            <li
              key={tag}
              className="proto-ranked-row"
              data-region={`proto-${kind}-row-${index}`}
              data-kind="row"
            >
              <span className="proto-slot-ordinal">{ORDINALS[index]}</span>
              <span className="proto-slot-name">{subtitleLanguageName(tag)}</span>
              <span className="proto-ranked-controls">
                <Button
                  variant="ghost"
                  disabled={index === 0}
                  aria-label={`Move ${subtitleLanguageName(tag)} up`}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </Button>
                <Button
                  variant="ghost"
                  disabled={index === list.length - 1}
                  aria-label={`Move ${subtitleLanguageName(tag)} down`}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </Button>
                <Button variant="ghost" onClick={() => remove(index)}>
                  Remove
                </Button>
              </span>
            </li>
          ))}
        </ol>
      )}
      {list.length < MAX ? (
        <div data-region={`proto-${kind}-add`} data-kind="row">
          <Button variant="secondary" aria-expanded={adding} onClick={() => setAdding(!adding)}>
            {list.length === 0 ? "Add a language" : "Add a fallback"}
          </Button>
        </div>
      ) : (
        <p className="proto-note">Three at most. Remove one to add another.</p>
      )}
      {surface === "window" && adding ? (
        <div className="proto-inline-picker">
          <div className="rep-log-chips" data-region={`proto-${kind}-picker`} data-kind="row">
            {unlisted.map((language) => (
              <ChoiceChip key={language.tag} pressed={false} onClick={() => add(language.tag)}>
                {language.name}
              </ChoiceChip>
            ))}
          </div>
        </div>
      ) : null}
      {surface === "remote" ? (
        <Sheet
          open={adding}
          title={`Add to ${KIND_HEAD[kind].toLowerCase()}`}
          onClose={() => setAdding(false)}
        >
          <MenuGroup title={list.length === 0 ? "First choice" : `${ORDINALS[list.length]} choice`}>
            {unlisted.map((language) => (
              <MenuRow key={language.tag} onPress={() => add(language.tag)}>
                {language.name}
              </MenuRow>
            ))}
          </MenuGroup>
        </Sheet>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------------------
 * C: tap-to-rank chips.
 * -------------------------------------------------------------------------- */

function RankChips({ surface, kind }: { surface: Surface; kind: Kind }) {
  const list = useProto().lists[kind];
  const full = list.length >= MAX;

  const press = (tag: string) => {
    if (list.includes(tag)) {
      send(kind, list.filter((held) => held !== tag));
    } else if (!full) {
      send(kind, [...list, tag]);
    }
  };

  return (
    <div className="proto-rank" data-surface={surface}>
      <p className="proto-rank-summary">
        {list.length === 0 ? (
          <>
            <strong>{FOLLOW}</strong> <span className="proto-note">{FOLLOW_NOTE[kind]}</span>
          </>
        ) : (
          <>
            {list.map((tag, index) => (
              <span key={tag}>
                {index > 0 ? <span className="proto-rank-then"> then </span> : null}
                <strong>{subtitleLanguageName(tag)}</strong>
              </span>
            ))}
          </>
        )}
      </p>
      <div
        className={surface === "window" ? "rep-log-chips" : "remote-settings-chips"}
        data-region={`proto-${kind}-chips`}
        data-kind="row"
      >
        <ChoiceChip pressed={list.length === 0} onClick={() => list.length && send(kind, [])}>
          {FOLLOW}
        </ChoiceChip>
        {SUBTITLE_LANGUAGES.map((language) => {
          const at = list.indexOf(language.tag);
          return (
            <ChoiceChip
              key={language.tag}
              pressed={at >= 0}
              aria-disabled={full && at < 0 ? true : undefined}
              className="proto-rank-chip"
              data-full={full && at < 0 ? true : undefined}
              onClick={() => press(language.tag)}
            >
              {at >= 0 ? <span className="proto-rank-badge">{at + 1}</span> : null}
              {language.name}
            </ChoiceChip>
          );
        })}
      </div>
      <p className="proto-note">
        {full
          ? "Three chosen. Press one to take it out before adding another."
          : "Press in order of preference. Press again to take it out."}
      </p>
    </div>
  );
}

/* --------------------------------------------------------------------------
 * D: chips in a field, and a list that ticks them (the owner's reference).
 * -------------------------------------------------------------------------- */

function ChipField({ surface, kind }: { surface: Surface; kind: Kind }) {
  const list = useProto().lists[kind];
  const [open, setOpen] = useState(false);
  const full = list.length >= MAX;

  const toggle = (tag: string) => {
    if (list.includes(tag)) {
      send(kind, list.filter((held) => held !== tag));
    } else if (!full) {
      send(kind, [...list, tag]);
    }
  };

  const rows = SUBTITLE_LANGUAGES.map((language) => {
    const at = list.indexOf(language.tag);
    return { ...language, at, blocked: full && at < 0 };
  });

  return (
    <div className="proto-field" data-surface={surface}>
      <p className={surface === "window" ? "rep-log-choice-label" : "remote-settings-sub"}>
        {KIND_LABEL[kind]}
      </p>
      <div
        className="proto-field-box"
        data-open={open || undefined}
        data-region={`proto-${kind}-field`}
        data-kind="row"
      >
        {list.length === 0 ? (
          <button
            type="button"
            className="proto-field-follow"
            data-focusable
            onClick={() => setOpen(!open)}
          >
            {FOLLOW}
          </button>
        ) : (
          list.map((tag, index) => (
            <span key={tag} className="proto-field-chip">
              <span className="proto-rank-badge">{index + 1}</span>
              {subtitleLanguageName(tag)}
              <button
                type="button"
                className="proto-field-x"
                data-focusable
                aria-label={`Remove ${subtitleLanguageName(tag)}`}
                onClick={() => toggle(tag)}
              >
                ×
              </button>
            </span>
          ))
        )}
        <button
          type="button"
          className="proto-field-open"
          data-focusable
          aria-expanded={open}
          aria-label={`Choose ${KIND_HEAD[kind].toLowerCase()}`}
          onClick={() => setOpen(!open)}
        >
          {open ? "▴" : "▾"}
        </button>
      </div>
      {list.length === 0 ? <p className="proto-note">{FOLLOW_NOTE[kind]}</p> : null}
      {surface === "window" && open ? (
        <div className="proto-field-list" data-region={`proto-${kind}-list`} data-kind="branch">
          <p className="proto-note">
            {full ? "Three chosen. Untick one to choose another." : "Tick in order of preference."}
          </p>
          <div className="proto-field-rows" data-region={`proto-${kind}-rows`} data-kind="row">
            {rows.map((row) => (
              <MenuRow
                key={row.tag}
                pressed={row.at >= 0}
                disabled={row.blocked}
                marks={row.at >= 0 ? [ORDINALS[row.at]!] : undefined}
                onPress={() => toggle(row.tag)}
              >
                <span className="proto-field-check">{row.at >= 0 ? "✓" : ""}</span>
                {row.name}
              </MenuRow>
            ))}
          </div>
        </div>
      ) : null}
      {surface === "remote" ? (
        <Sheet open={open} title={KIND_HEAD[kind]} closeLabel="Done" onClose={() => setOpen(false)}>
          <p className="proto-note proto-sheet-note">
            {list.length === 0
              ? `${FOLLOW}. Tick in order of preference.`
              : list.map((tag) => subtitleLanguageName(tag)).join(" then ")}
          </p>
          <MenuGroup title={full ? "Three chosen" : "Languages"}>
            {rows.map((row) => (
              <MenuRow
                key={row.tag}
                pressed={row.at >= 0}
                disabled={row.blocked}
                marks={row.at >= 0 ? [ORDINALS[row.at]!] : undefined}
                onPress={() => toggle(row.tag)}
              >
                <span className="proto-field-check">{row.at >= 0 ? "✓" : ""}</span>
                {row.name}
              </MenuRow>
            ))}
          </MenuGroup>
        </Sheet>
      ) : null}
    </div>
  );
}
