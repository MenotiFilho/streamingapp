import { useCallback, useEffect, useState } from "react";

import { actionKey } from "../core/actionKey";
import { answeredLibrary } from "../core/answers";
import type { Destination } from "../core/destinations";
import type { ActionError } from "../core/errors";
import { explain } from "../core/errors";
import type { NewLevel } from "../core/navigation";
import type { Session, SessionState } from "../core/session";
import type { Library as AccountLibrary } from "../core/wire";
import { Button } from "../kit/Button";
import { PosterCard } from "../kit/PosterCard";
import {
  LIBRARY_ASK,
  LIBRARY_EMPTY,
  LIBRARY_READING,
  LIBRARY_RETRY_CONTROL,
  LIBRARY_SETTINGS_CONTROL,
  SIGNED_OUT,
  libraryCards,
  libraryFailure,
  libraryFailureCopy,
  libraryPhase,
} from "./libraryScreen";
import type { RemotePayload } from "./levels";

export type LibraryProps = {
  /** The Session the one `library` ask goes through. */
  session: Session;
  /** What the Host last published: the account fact, and the Addons. */
  state: SessionState;
  /** A press on an entry pushes the Title level B6 will draw. */
  push: (level: NewLevel<RemotePayload>) => string;
  /** The signed-out arm's one control: the destination where sign-in lives. */
  choose: (destination: Destination) => void;
};

/**
 * Library, in a hand (#208, ADR-0029, ADR-0035 §1).
 *
 * The account's Library is not the Host's Snapshot: it is a `library` question,
 * answered to the client that asked, so this screen holds its answer for the
 * visit and asks again only when a person asks it to. Which arm is drawn is the
 * Host's fact — no Stremio account linked is the gate, and sign-in is Settings'
 * form (B7), so the gate offers that destination and draws no credentials here.
 *
 * With an account, a mount reads once; a refusal is the Host's words, and its
 * way out is the way back into the account where the session expired, or a
 * retry where it did not. A press on an entry opens its Title through B3's
 * level; an entry no Addon answers is drawn with its mark and does not open.
 */
export function Library({ session, state, push, choose }: LibraryProps) {
  const snapshot = state.snapshot;
  // Whether an account is linked is the Host's fact. Before the first Snapshot
  // it is not a guess to make, so no ask leaves this client.
  const held = snapshot ? snapshot.protection.stremioHeld : null;

  const [answer, setAnswer] = useState<AccountLibrary | null>(null);
  const [refused, setRefused] = useState<ActionError | null>(null);

  const read = useCallback(async () => {
    const outcome = await session.ask(LIBRARY_ASK);
    setRefused(outcome.error);
    if (!outcome.error) {
      setAnswer(answeredLibrary(outcome.response));
    }
  }, [session]);

  // The signed-in arm reads on mount. The effect is keyed on the Host's fact,
  // so a Snapshot that moves no account never asks again; a retry asks through
  // the same function.
  useEffect(() => {
    if (held === true) {
      void read();
    }
  }, [held, read]);

  const reading = state.pending.has(actionKey(LIBRARY_ASK));
  const failure = libraryFailure(answer, refused);
  const phase = libraryPhase(answer, refused, reading);
  const cards =
    phase === "list" && answer
      ? libraryCards(snapshot?.addons ?? [], answer.entries)
      : [];

  return (
    <section className="remote-library" data-testid="remote-library">
      <header className="remote-screen-head">
        <h1 className="remote-screen-title">Library</h1>
        <span className="remote-screen-rule" aria-hidden="true" />
      </header>

      {held === null ? null : held === false ? (
        <div className="remote-empty" data-testid="remote-library-signed-out">
          <p className="remote-screen-title">{SIGNED_OUT.kicker}</p>
          <h2 className="remote-empty-title">{SIGNED_OUT.title}</h2>
          <p className="remote-empty-body">{SIGNED_OUT.body}</p>
          <Button variant="primary" onClick={() => choose("settings")}>
            {SIGNED_OUT.control}
          </Button>
        </div>
      ) : phase === "failure" && failure ? (
        <LibraryFailure
          failure={failure}
          pending={reading}
          onSettings={() => choose("settings")}
          onRetry={() => void read()}
        />
      ) : phase === "empty" ? (
        <div className="remote-empty" data-testid="remote-library-empty">
          <h2 className="remote-empty-title">{LIBRARY_EMPTY.title}</h2>
          <p className="remote-empty-body">{LIBRARY_EMPTY.body}</p>
        </div>
      ) : phase === "reading" ? (
        <p role="status" className="remote-quiet">
          {LIBRARY_READING}
        </p>
      ) : (
        <div className="remote-library-grid" data-testid="remote-library-grid">
          {cards.map(({ entry, level, openable, continueWatching }) => (
            <PosterCard
              key={entry.id}
              name={entry.name}
              poster={entry.poster}
              continueWatching={continueWatching}
              unplayable={!openable}
              openable={openable}
              testId={`library-card-${entry.id}`}
              onClick={level ? () => push(level) : undefined}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * A refused read: the Host's own words through `explain`, and the one control
 * that is the way out. An expired session points at Settings, where the account
 * is signed in again; anything else asks the Host again. Never an empty Library
 * (ADR-0029).
 */
function LibraryFailure({
  failure,
  pending,
  onSettings,
  onRetry,
}: {
  failure: ActionError;
  pending: boolean;
  onSettings: () => void;
  onRetry: () => void;
}) {
  const copy = libraryFailureCopy(failure);

  return (
    <section
      className="remote-library-failure"
      data-testid="remote-library-failure"
    >
      <p role="alert" className="remote-failure">
        {explain(failure)}
      </p>

      {copy.control === "settings" ? (
        <>
          <p className="remote-quiet">{copy.note}</p>
          <Button variant="primary" onClick={onSettings}>
            {LIBRARY_SETTINGS_CONTROL}
          </Button>
        </>
      ) : (
        <Button variant="ghost" pending={pending} onClick={onRetry}>
          {LIBRARY_RETRY_CONTROL}
        </Button>
      )}
    </section>
  );
}
