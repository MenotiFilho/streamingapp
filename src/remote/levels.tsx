import { useEffect, useRef, useState } from "react";

import { explain, type ActionError } from "../core/errors";
import type { Level, NewLevel } from "../core/navigation";
import type { Session } from "../core/session";
import type { Action, MetaPreview } from "../core/wire";
import { ConfirmDialog } from "../kit/ConfirmDialog";

/**
 * What a level on the Remote's stack carries (ADR-0035 §1).
 *
 * The stack is the core's; the payload is this client's. A Title a card opened
 * carries the card's identity so the screen B6 lands can ask the Host for the
 * rest without the stack being reshaped.
 *
 * The Addon travels with it because that is what `open_title` asks by, and a
 * card knows which Addon answered its row. `addon: null` is the other case: a
 * Discovered Title, which TMDB named before any Addon did — a Discover card and
 * a keyed Search hit carry no Addon, and B6 opens those against TMDB (#207,
 * ADR-0020).
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

/** One level's contents, as the Remote holds them. */
export type RemotePayload =
  | { kind: "title"; title: RemoteTitle }
  | { kind: "confirm"; confirm: RemoteConfirm };

/**
 * The level a press on a card pushes: an overlay above the destination, named
 * as the window names it. A Continue watching card pushes the same level,
 * because what it opens is the Title; resuming the Host's Video is B8 and B9's.
 */
export function titleLevel(title: RemoteTitle): NewLevel<RemotePayload> {
  return { name: "Title", kind: "overlay", payload: { kind: "title", title } };
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
 * The top level, drawn. A Title is B6's screen; a confirmation is the kit's
 * `ConfirmDialog`, because asking before removing an Addon is a question and
 * not a screen (#209).
 */
export function RemoteLevel({
  level,
  session,
  pop,
}: {
  level: Level<RemotePayload>;
  /** The Session the confirming answer is taken through. */
  session: Session;
  /** Pop this level: Cancel, and what a successful confirmation does. */
  pop: () => void;
}) {
  switch (level.payload.kind) {
    case "title":
      return <TitlePlaceholder title={level.payload.title} />;
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

/**
 * The Title until B6 draws it: the card's name, and whose screen it is. B2
 * pushes a real level so Back, the history sentinel and the stack's shape are
 * already the ones the screen will use.
 */
function TitlePlaceholder({ title }: { title: RemoteTitle }) {
  return (
    <section className="remote-level" aria-label="Title" data-testid="remote-title">
      <h2 className="remote-level-title">{title.name}</h2>
      <p className="remote-level-note">The Title screen lands in B6.</p>
    </section>
  );
}
