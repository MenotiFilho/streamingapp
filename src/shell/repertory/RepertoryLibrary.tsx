import { StremioAccount } from "../StremioAccount";
import { useShell } from "../context";
import { LogGroup, LogHead, LogNote, LogPreviewNote } from "./RepertoryLog";

/**
 * Library as an honest, sign-in-gated room (#147).
 *
 * The collection it names is the Titles saved in a Stremio account, and
 * membership is not built: nothing stores it and Account sync reconciles Watch
 * progress only (CONTEXT.md). With no account the page draws the same Stremio
 * form Settings uses; with one it draws a stub that says exactly that and
 * nothing more. Sign-out stays in Settings → Credentials.
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
        <section className="rep-library-stub" aria-labelledby="library-stub-title">
          <p className="rep-library-kicker">Signed in to Stremio</p>
          <h2 id="library-stub-title" className="rep-library-title">
            The Library is not built yet.
          </h2>
          <p className="rep-library-body" data-testid="library-placeholder">
            Signed in to Stremio. The Titles saved in your account will appear here once
            the Library is built.
          </p>
          <p className="rep-library-body">
            Account sync reconciles Watch progress, not membership: nothing here saves or
            removes a Title from the account yet.
          </p>
        </section>
      ) : (
        <>
          <section className="rep-library-gate" data-testid="library-gate">
            <p className="rep-library-kicker">A room not yet furnished</p>
            <h2 className="rep-library-title">The Library is not built yet.</h2>
            <p className="rep-library-body">
              Your Library will hold the Titles saved in your Stremio account. It is not
              built yet — sign in to Stremio to connect the account it will draw from.
            </p>
          </section>

          <LogGroup id="library-stremio" title="Stremio account">
            <div
              className="rep-log-signin"
              data-region="library-stremio-form"
              data-kind="branch"
              data-label="Stremio account"
            >
              <StremioAccount allowSignOut={false} />
            </div>
          </LogGroup>

          <LogPreviewNote>
            Preview data: signing in here flips the stub locally; no Stremio account is
            contacted.
          </LogPreviewNote>
        </>
      )}
    </section>
  );
}
