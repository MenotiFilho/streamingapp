import { useShell } from "./context";
import { StremioAccount } from "./StremioAccount";

/**
 * Library: an honest sign-in-gated stub (#84).
 *
 * The collection it names is the Titles saved in a Stremio account, and
 * membership is not built: nothing stores it and Account sync reconciles Watch
 * progress only (CONTEXT.md). So the screen reads the one fact it can — whether
 * an account is held — and says what that means. With no account it draws the
 * same Stremio form Settings uses; with one it draws the placeholder and no
 * sign-out, because sign-out lives in Settings → Credentials.
 */
export function LibraryScreen() {
  const { snapshot } = useShell();

  return (
    <section
      className="shell-screen-body"
      data-destination="library"
      data-testid="screen-library"
    >
      <h1 className="shell-screen-title">Library</h1>

      {snapshot === null ? (
        <p className="shell-note">Waiting for the Host…</p>
      ) : snapshot.protection.stremioHeld ? (
        <p className="shell-lede" data-testid="library-placeholder">
          Signed in to Stremio. The Titles saved in your account will appear here
          once the Library is built.
        </p>
      ) : (
        <>
          <p className="shell-lede" data-testid="library-gate">
            Your Library will hold the Titles saved in your Stremio account. It is
            not built yet — sign in to Stremio to connect the account it will draw
            from.
          </p>
          <StremioAccount allowSignOut={false} />
        </>
      )}
    </section>
  );
}
