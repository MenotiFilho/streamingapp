import { useEffect, useRef, useState, type ReactNode } from "react";

import { explain, type ActionError } from "../core/errors";
import type { Level, NewLevel } from "../core/navigation";
import type { Session, SessionState } from "../core/session";
import type { SettingsCategoryId } from "../core/settingsRegister";
import type { Action, MetaPreview, Title, Video } from "../core/wire";
import { Button } from "../kit/Button";
import { ConfirmDialog } from "../kit/ConfirmDialog";
import { SettingsLeaf } from "./Settings";
import { StreamsScreen } from "./StreamsScreen";
import { TitleScreen } from "./TitleScreen";

/**
 * What a level on the Remote's stack carries (ADR-0035 §1).
 *
 * The stack is the core's; the payload is this client's. A Title a card opened
 * carries the card's identity so the Title screen can ask the Host the question
 * its card names, and the answer it gets is kept on the same level.
 *
 * The Addon travels with it because that is what `open_title` asks by, and a
 * card knows which Addon answered its row. `addon: null` is the other case: a
 * Discovered Title, which TMDB named before any Addon did — a Discover card and
 * a keyed Search hit carry no Addon, and the Title screen opens those against
 * TMDB (#207, ADR-0020).
 */
export type RemoteTitle = {
  /** The Addon whose Catalog answered, or null for a Discovered Title. */
  addon: string | null;
  id: string;
  type: string;
  name: string;
};

/**
 * One destructive question, as a level carries it: the words a person reads
 * and the one Action its confirming answer takes.
 *
 * It is data and never a closure, so the level stack stays the core's and a
 * confirmation is a kind the client draws rather than a function the client
 * smuggles onto the stack (#209).
 */
export type RemoteConfirm = {
  /** The level's id and the dialog's test id, so a second press replaces the question. */
  id: string;
  /** What the question asks, read as the dialog's name. */
  title: string;
  /** The consequence under the title. */
  body: string;
  /** The confirming control's label: `Remove`. */
  confirmLabel: string;
  /** The Action the confirming control takes. */
  action: Action;
};

/**
 * One level's contents, as the Remote holds them.
 *
 * A Title carries the card's identity and, once the Host has answered, the
 * Title itself: the level is re-pushed with its answer so a Streams level above
 * it and a Back do not ask the Host a second time. A Streams level carries the
 * answered Title and the one Video whose candidates it lists. A Settings level
 * carries the register id of the category it draws (#211).
 */
export type RemotePayload =
  | { kind: "title"; title: RemoteTitle; answer: Title | null }
  | { kind: "streams"; title: Title; video: Video }
  | { kind: "settings"; category: SettingsCategoryId }
  | { kind: "confirm"; confirm: RemoteConfirm };

/**
 * The level a press on a card pushes: an overlay above the destination, named
 * as the window names it. A Continue watching card pushes the same level,
 * because what it opens is the Title; resuming the Host's Video is B8 and B9's.
 * It is pushed unanswered, which is what makes the screen ask.
 */
export function titleLevel(title: RemoteTitle): NewLevel<RemotePayload> {
  return {
    name: "Title",
    kind: "overlay",
    payload: { kind: "title", title, answer: null },
  };
}

/**
 * The same level, from the card that was pressed: its identity, and the Addon
 * that answered where one did. A Discover or keyed-Search card names no Addon,
 * because TMDB named the Title before any Addon did (#207).
 */
export function titleLevelOf(
  addon: string | null,
  meta: Pick<MetaPreview, "id" | "type" | "name">,
): NewLevel<RemotePayload> {
  return titleLevel({ addon, id: meta.id, type: meta.type, name: meta.name });
}

/**
 * The top level, drawn. A Title is its own screen (B6), a Streams list is the
 * level a Play pushes (B6), a Settings category is its leaf (#211), and a
 * confirmation is the kit's `ConfirmDialog`, because asking before removing an
 * Addon is a question and not a screen (#209).
 */
export function RemoteLevel({
  level,
  session,
  state,
  push,
  pop,
}: {
  level: Level<RemotePayload>;
  /** The Session the level's questions are taken through. */
  session: Session;
  /** What the Host last published: the Addons a Streams group is named by. */
  state: SessionState;
  /** Push a level, which is how a Play opens the Streams list. */
  push: (level: NewLevel<RemotePayload>) => string;
  /** Pop this level: Back, Cancel, and what a successful confirmation does. */
  pop: () => void;
}) {
  switch (level.payload.kind) {
    case "title":
      return (
        <LevelPage onBack={pop}>
          <TitleScreen
            levelId={level.id}
            card={level.payload.title}
            answer={level.payload.answer}
            session={session}
            state={state}
            push={push}
          />
        </LevelPage>
      );
    case "streams":
      return (
        <LevelPage onBack={pop}>
          <StreamsScreen
            title={level.payload.title}
            video={level.payload.video}
            session={session}
            state={state}
          />
        </LevelPage>
      );
    case "settings":
      return (
        <LevelPage onBack={pop}>
          <SettingsLeaf
            category={level.payload.category}
            session={session}
            state={state}
            push={push}
          />
        </LevelPage>
      );
    case "confirm":
      return (
        <ConfirmLevel
          confirm={level.payload.confirm}
          session={session}
          pop={pop}
        />
      );
  }
}

/**
 * The frame a Title and a Streams level are drawn in: the room's Back control
 * at the top of the page, a hairline to the edge, and the level under it. Back
 * is the room's (ADR-0035 §1) — the level says only what it is.
 */
function LevelPage({
  onBack,
  children,
}: {
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <div className="remote-level-page">
      <header className="remote-level-head">
        <Button variant="ghost" className="remote-level-back" onClick={onBack}>
          Back
        </Button>
        <span className="remote-level-rule" aria-hidden="true" />
      </header>
      {children}
    </div>
  );
}

/**
 * One destructive question. Cancel pops it and dispatches nothing; the
 * confirming answer takes its Action through the Session and then pops it. A
 * refusal keeps the question open with the Host's own words, because the
 * question is still the one a person is answering.
 */
function ConfirmLevel({
  confirm,
  session,
  pop,
}: {
  confirm: RemoteConfirm;
  session: Session;
  pop: () => void;
}) {
  const [error, setError] = useState<ActionError | null>(null);
  const [working, setWorking] = useState(false);
  // A person can pop the level while the Host is still answering. The answer
  // then belongs to a question that is no longer on screen, and must not pop
  // whatever is on top now.
  const open = useRef(true);

  useEffect(
    () => () => {
      open.current = false;
    },
    [],
  );

  const answer = async () => {
    if (working) {
      return;
    }
    setError(null);
    setWorking(true);
    const outcome = await session.ask(confirm.action);
    setWorking(false);
    if (outcome.error) {
      if (open.current) {
        setError(outcome.error);
      }
      return;
    }
    if (open.current) {
      pop();
    }
  };

  return (
    <ConfirmDialog
      title={confirm.title}
      confirmLabel={confirm.confirmLabel}
      danger
      pending={working}
      onConfirm={() => void answer()}
      onCancel={pop}
      testId={confirm.id}
    >
      <p>{confirm.body}</p>
      {error ? (
        <p role="alert" className="remote-refusal">
          {explain(error)}
        </p>
      ) : null}
    </ConfirmDialog>
  );
}

