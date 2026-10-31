import { useState, type FormEvent } from "react";

import type { ActionError } from "../core/errors";
import { useShell } from "./context";
import { confirmActionLevel } from "./ConfirmAction";
import { Button } from "../kit/Button";
import { Field } from "../kit/Field";
import { Refusal } from "./Refusal";
import { LogNote } from "./repertory/RepertoryLog";

/**
 * The shared Stremio account control (#30, #82).
 *
 * A Host with no account draws the sign-in form; a Host holding one draws the
 * sign-out control. The sign-in sends the password once and keeps no part of
 * it — the Host exchanges it for an `authKey` it stores, and a refusal is the
 * Host's own answer, kept beside the fields so a typo can be fixed rather than
 * pre-judged. Library reuses the same form with `allowSignOut={false}`: its
 * gate has no sign-out of its own (#84).
 */
export function StremioAccount({
  allowSignOut = true,
  forceSignIn = false,
  onSignedIn,
}: {
  allowSignOut?: boolean;
  /** Show the form even with an account held: an expired session's way back. */
  forceSignIn?: boolean;
  /** Called after the Host takes a sign-in, so the caller can ask again. */
  onSignedIn?: () => void;
}) {
  const { snapshot, ask, push } = useShell();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<ActionError | null>(null);
  const [working, setWorking] = useState(false);

  if (!snapshot) {
    return <LogNote>Waiting for the Host…</LogNote>;
  }

  if (snapshot.protection.stremioHeld && !forceSignIn) {
    if (!allowSignOut) {
      return null;
    }
    return (
      <Button
        variant="ghost"
        danger
        className="rep-log-action rep-log-action--danger"
        onClick={() =>
          push(
            confirmActionLevel({
              id: "confirm-sign-out-stremio",
              title: "Sign out of Stremio?",
              confirmLabel: "Sign out",
              testId: "confirm-sign-out-stremio",
              action: { type: "sign_out_stremio" },
              children: (
                <p>
                  The Host stops syncing Watch progress with this account. Progress
                  already merged stays recorded.
                </p>
              ),
            }),
          )
        }
      >
        Sign out
      </Button>
    );
  }

  const signIn = async (event: FormEvent) => {
    event.preventDefault();
    if (working) {
      return;
    }
    setError(null);
    setWorking(true);
    const outcome = await ask({
      type: "sign_in_stremio",
      email: email.trim(),
      password,
    });
    setWorking(false);
    if (outcome.error) {
      setError(outcome.error);
      return;
    }
    setEmail("");
    setPassword("");
    onSignedIn?.();
  };

  return (
    <form className="rep-settings-form" onSubmit={signIn} noValidate>
      <Field
        id="settings-stremio-email"
        label="Stremio email"
        type="email"
        autoComplete="off"
        placeholder="you@example.com"
        value={email}
        onChange={setEmail}
      />
      <Field
        id="settings-stremio-password"
        label="Stremio password"
        type="password"
        autoComplete="off"
        placeholder="the password Stremio knows"
        value={password}
        onChange={setPassword}
      />
      <div className="rep-log-actions">
        <Button type="submit" variant="primary" pending={working}>
          Sign in
        </Button>
      </div>
      <Refusal error={error} testId="stremio-sign-in-error" />
    </form>
  );
}
