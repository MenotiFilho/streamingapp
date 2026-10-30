import { useCallback, useEffect, useState } from "react";

import {
  answeredLibrary,
  explain,
  type ActionError,
  type Library,
} from "../../host-client";
import { useShell } from "../context";
import { Button, PosterCard } from "./kit";
import { StremioAccount } from "../StremioAccount";
import { useTitleOpener } from "../TitleScreen";
import { libraryAddon, libraryExpired, libraryPreview } from "./accountLibrary";
import { LogEmpty, LogGroup, LogHead, LogNote, LogPreviewNote } from "./RepertoryLog";

/**
 * The Library as the owner's Stremio account collection (#165, ADR-0029).
 *
 * The room is read-only: it reads the account's `libraryItem` collection, draws
 * the live items in `_mtime` order, and marks a Title whose `timeOffset > 0` as
 * Continue. It does not merge the account's row with the Host's own Continue
 * watching, and it offers no save/remove control: membership is still unbuilt.
 *
 * With no account the gate is the same sign-in surface it was. With an account
 * whose session has expired, the answer carries a failure and the room asks for
 * the sign-in again — it never draws the failure as an empty Library.
 */
export function RepertoryLibraryScreen() {
  const { snapshot } = useShell();
  const held = snapshot?.protection.stremioHeld ?? false;

  return (
    <section
      className="rep-log"
      data-testid="screen-library"
      data-region="library"
      data-kind="branch"
      data-label="Library"
    >
      <LogHead title="Library" />

      {snapshot === null ? (
        <LogNote>Waiting for the Host…</LogNote>
      ) : held ? (
        <LibraryRoom />
      ) : (
        <>
          <section className="rep-library-gate" data-testid="library-gate">
            <p className="rep-library-kicker">Stremio account</p>
            <h2 className="rep-library-title">Sign in to read your Library.</h2>
            <p className="rep-library-body">
              Your Library holds the Titles saved in your Stremio account. Sign in
              to Stremio to read the account's collection.
            </p>
          </section>

          <LogGroup id="library-stremio" title="Stremio account">
            <div
              data-region="library-stremio-form"
              data-kind="branch"
              data-label="Stremio account"
            >
              <StremioAccount allowSignOut={false} />
            </div>
          </LogGroup>

          <LogPreviewNote>
            Preview data: signing in here flips the gate locally; no Stremio account is
            contacted.
          </LogPreviewNote>
        </>
      )}
    </section>
  );
}

/** The signed-in room: the account's items, or the reason they could not be read. */
function LibraryRoom() {
  const { snapshot, ask } = useShell();
  const { openTitle } = useTitleOpener();
  const [library, setLibrary] = useState<Library | null>(null);
  const [error, setError] = useState<ActionError | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const outcome = await ask({ type: "library" });
    setLoading(false);
    if (outcome.error) {
      setError(outcome.error);
      setLibrary(null);
      return;
    }
    setLibrary(answeredLibrary(outcome.response));
  }, [ask]);

  useEffect(() => {
    void load();
  }, [load]);

  const failure = error ?? library?.failure ?? null;
  if (failure) {
    return <LibraryFailure failure={failure} onRetry={() => void load()} />;
  }
  if (loading && !library) {
    return <LogNote>Reading the account Library…</LogNote>;
  }
  if (!library) {
    return <LogNote>Waiting for the Host…</LogNote>;
  }
  if (library.entries.length === 0) {
    return (
      <>
        <LogEmpty
          testId="library-empty"
          title="The Library is empty."
          body="Titles saved in your Stremio account will appear here."
        />
        <LogPreviewNote>
          Preview data: the account Library is a sample of live Cinemeta artwork; the
          Tauri window reads the Host's account.
        </LogPreviewNote>
      </>
    );
  }

  return (
    <>
      <div
        className="rep-library-grid"
        data-testid="library-grid"
      >
        {library.entries.map((entry) => {
          const addon = libraryAddon(snapshot?.addons ?? [], entry);
          return (
            <PosterCard
              key={entry.id}
              name={entry.name}
              poster={entry.poster}
              continueWatching={entry.continueWatching}
              unplayable={addon === null}
              openable={addon !== null}
              testId={`library-card-${entry.id}`}
              onClick={
                addon
                  ? () => openTitle(addon.id, libraryPreview(entry))
                  : undefined
              }
            />
          );
        })}
      </div>

      <LogPreviewNote>
        Preview data: the account Library is a sample of live Cinemeta artwork; the
        Tauri window reads the Host's account.
      </LogPreviewNote>
    </>
  );
}

/** The failure a read can carry: a retry, or the way back into the account. */
function LibraryFailure({
  failure,
  onRetry,
}: {
  failure: ActionError;
  onRetry: () => void;
}) {
  const expired = libraryExpired(failure);

  return (
    <section className="rep-library-failure" data-testid="library-failure">
      <p role="alert" className="rep-log-refusal">
        {explain(failure)}
      </p>

      {expired ? (
        <>
          <LogNote>The Stremio session has expired. Sign in again to read your Library.</LogNote>
          <LogGroup id="library-signin" title="Stremio account">
            <div
              data-region="library-signin-form"
              data-kind="branch"
              data-label="Stremio account"
            >
              <StremioAccount
                allowSignOut={false}
                forceSignIn
                onSignedIn={onRetry}
              />
            </div>
          </LogGroup>
        </>
      ) : (
        <Button variant="ghost" className="rep-log-action" onClick={onRetry}>
          Try again
        </Button>
      )}
    </section>
  );
}
