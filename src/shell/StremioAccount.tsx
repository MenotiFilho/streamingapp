import { useState, type FormEvent } from "react";

import type { ActionError } from "../host-client";
import { useShell } from "./context";
import { confirmActionLevel } from "./ConfirmAction";
import { Button } from "./kit";
import { Refusal } from "./Refusal";

/**
 * The shared Stremio account control (#30, #82).
 *
 * A Host with no account draws the sign-in form; a Host holding one draws the
 * sign-out control. The sign-in sends the password once and keeps no part of
 * it — the Host exchanges it for an `authKey` it stores, and a refusal is the
 * Host's own answer, kept beside the fields so a typo can be fixed rather than
 * pre-judged. Library reuses the same form with `allowSignOut={false}`: its
 * stub has no sign-out of its own (#84).
 */
export function StremioAccount({ allowSignOut = true }: { allowSignOut?: boolean }) {
  const { snapshot, ask, push } = useShell();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<ActionError | null>(null);
  const [working, setWorking] = useState(false);

  if (!snapshot) {
    return <p className="shell-note">Waiting for the Host…</p>;
  }

  if (snapshot.protection.stremioHeld) {
    if (!allowSignOut) {
      return null;
    }
    return (
      <Button
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
  };

  return (
    <form className="shell-form" onSubmit={signIn} noValidate>
      <div className="shell-field">
        <label htmlFor="settings-stremio-email">Stremio email</label>
        <input
          id="settings-stremio-email"
          type="email"
          autoComplete="off"
          placeholder="you@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          data-focusable
        />
      </div>
      <div className="shell-field">
        <label htmlFor="settings-stremio-password">Stremio password</label>
        <input
          id="settings-stremio-password"
          type="password"
          autoComplete="off"
          placeholder="the password Stremio knows"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          data-focusable
        />
      </div>
      <Button type="submit" disabled={working}>
        Sign in
      </Button>
      <Refusal error={error} testId="stremio-sign-in-error" />
    </form>
  );
}
