import { useCallback, useEffect, useState, type FormEvent } from "react";

import {
  libraryAddon,
  libraryExpired,
  libraryPreview,
} from "../core/accountLibrary";
import { answeredLibrary } from "../core/answers";
import { explain, type ActionError } from "../core/errors";
import {
  LIBRARY_FILTERS,
  LIBRARY_SIGNED_OUT_BODY,
  LIBRARY_SUBTITLE,
  filterLibraryEntries,
  libraryEmptyCopy,
  libraryEntryProgress,
  libraryEntryWatched,
  type LibraryFilter,
} from "../core/marqueeLibrary";
import type { NewLevel } from "../core/navigation";
import type { Session, SessionState } from "../core/session";
import type { Library as AccountLibrary } from "../core/wire";
import { Chip } from "../kit/Chip";
import { EmptyState } from "../kit/EmptyState";
import { TextField } from "../kit/TextField";
import { PhoneAddonNotice } from "../kit/phone/PhoneAddonNotice";
import { PhonePoster } from "../kit/phone/PhonePoster";
import { PhoneButton } from "../kit/phone/controls";
import { titleLevel, type RemotePayload } from "./levels";
import {
  STREMIO_EMAIL_LABEL,
  STREMIO_EMAIL_PLACEHOLDER,
  STREMIO_PASSWORD_LABEL,
  STREMIO_PASSWORD_PLACEHOLDER,
  STREMIO_SIGN_IN,
  signInRequest,
} from "./settingsScreen";

export type LibraryProps = {
  session: Session;
  state: SessionState;
  push: (level: NewLevel<RemotePayload>) => string;
};

export function Library({ session, state, push }: LibraryProps) {
  const snapshot = state.snapshot;
  const held = snapshot?.protection.stremioHeld ?? false;

  return (
    <section
      className="mq-remote-screen"
      aria-label="Library"
      data-testid="remote-library"
    >
      <header className="mq-remote-large-head">
        <div className="mq-remote-large-head-titles">
          <h1 className="mq-remote-large-title">Library</h1>
          <p className="mq-remote-large-subtitle">{LIBRARY_SUBTITLE}</p>
        </div>
      </header>

      {snapshot === null ? (
        <p className="mq-remote-waiting" role="status">
          Waiting for the Host…
        </p>
      ) : held ? (
        <LibraryRoom session={session} state={state} push={push} />
      ) : (
        <div className="mq-remote-gate" data-testid="remote-library-gate">
          <h2 className="mq-remote-gate-title">Sign in to Stremio</h2>
          <p className="mq-remote-gate-body">{LIBRARY_SIGNED_OUT_BODY}</p>
          <StremioSignInForm session={session} />
        </div>
      )}
    </section>
  );
}

function LibraryRoom({
  session,
  state,
  push,
}: {
  session: Session;
  state: SessionState;
  push: (level: NewLevel<RemotePayload>) => string;
}) {
  const snapshot = state.snapshot;
  const [library, setLibrary] = useState<AccountLibrary | null>(null);
  const [error, setError] = useState<ActionError | null>(null);
  const [reading, setReading] = useState(true);
  const [filter, setFilter] = useState<LibraryFilter>("all");

  const load = useCallback(async () => {
    setReading(true);
    setError(null);
    const outcome = await session.ask({ type: "library" });
    setReading(false);
    if (outcome.error) {
      setError(outcome.error);
      setLibrary(null);
      return;
    }
    setLibrary(answeredLibrary(outcome.response));
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  const failure = error ?? library?.failure ?? null;
  const expired = libraryExpired(failure);
  const entries = library?.entries ?? [];
  const addons = snapshot?.addons ?? [];
  const watchProgress = snapshot?.watchProgress ?? [];
  const filtered = filterLibraryEntries(entries, filter);
  const emptyCopy = libraryEmptyCopy(filter);

  if (reading && library === null && !failure) {
    return (
      <p className="mq-remote-waiting" role="status" data-testid="library-loading">
        Reading your Library…
      </p>
    );
  }

  return (
    <>
      <div className="mq-remote-chips" data-testid="library-filters">
        {LIBRARY_FILTERS.map((item) => (
          <Chip
            key={item.id}
            selected={filter === item.id}
            data-testid={`library-filter-${item.id}`}
            onClick={() => setFilter(item.id)}
          >
            {item.label}
          </Chip>
        ))}
      </div>

      {expired ? (
        <div className="mq-remote-gate" data-testid="library-expired">
          <h2 className="mq-remote-gate-title">Stremio session expired</h2>
          <p className="mq-remote-gate-body" role="alert">
            {failure ? explain(failure) : "Your Stremio session has expired."}
          </p>
          <StremioSignInForm session={session} onSignedIn={() => void load()} />
        </div>
      ) : (
        <>
          {failure ? (
            <div className="mq-remote-row-notice" data-testid="remote-library-failure">
              <PhoneAddonNotice
                title="Stremio Library"
                reason={explain(failure)}
                disabled={reading}
                onRetry={() => void load()}
              />
            </div>
          ) : null}

          {filtered.length > 0 ? (
            <div className="mq-remote-grid" data-testid="library-grid">
              {filtered.map((entry) => {
                const addon = libraryAddon(addons, entry);
                const unplayable = !addon || state.unplayable.has(entry.id);
                const watched = libraryEntryWatched(entry, watchProgress);
                const progress = libraryEntryProgress(entry, watched);
                const preview = libraryPreview(entry);
                return (
                  <div
                    key={`${entry.type}/${entry.id}`}
                    className="mq-remote-poster-slot"
                    data-watched={watched || undefined}
                    data-unplayable={unplayable || undefined}
                  >
                    <PhonePoster
                      name={entry.name}
                      poster={entry.poster}
                      progress={progress}
                      disabled={!addon}
                      testId={`library-card-${entry.id}`}
                      onPress={() => {
                        if (!addon) {
                          return;
                        }
                        push(
                          titleLevel({
                            addon: addon.id,
                            id: preview.id,
                            type: preview.type,
                            name: preview.name,
                          }),
                        );
                      }}
                    />
                    {unplayable ? (
                      <span className="mq-remote-poster-badge" aria-hidden="true">
                        Unplayable
                      </span>
                    ) : watched ? (
                      <span
                        className="mq-remote-poster-badge"
                        data-tone="accent"
                        aria-hidden="true"
                      >
                        Watched
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : !reading ? (
            <div data-testid="remote-library-empty">
              <EmptyState
                icon="library"
                title={emptyCopy.title}
                body={emptyCopy.body}
              />
            </div>
          ) : null}
        </>
      )}
    </>
  );
}

function StremioSignInForm({
  session,
  onSignedIn,
}: {
  session: Session;
  onSignedIn?: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<ActionError | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const action = signInRequest(email, password);
    if (!action || pending) {
      return;
    }
    setError(null);
    setPending(true);
    const outcome = await session.ask(action);
    setPending(false);
    if (outcome.error) {
      setError(outcome.error);
      return;
    }
    setEmail("");
    setPassword("");
    onSignedIn?.();
  };

  return (
    <form className="mq-remote-settings-group" onSubmit={submit}>
      <TextField
        label={STREMIO_EMAIL_LABEL}
        type="email"
        autoComplete="email"
        placeholder={STREMIO_EMAIL_PLACEHOLDER}
        value={email}
        onChange={setEmail}
        disabled={pending}
      />
      <TextField
        label={STREMIO_PASSWORD_LABEL}
        type="password"
        autoComplete="current-password"
        placeholder={STREMIO_PASSWORD_PLACEHOLDER}
        value={password}
        onChange={setPassword}
        disabled={pending}
      />
      {error ? (
        <p role="alert" className="mq-remote-inline-error">
          {explain(error)}
        </p>
      ) : null}
      <PhoneButton type="submit" kind="primary" disabled={pending}>
        {pending ? "Signing in…" : STREMIO_SIGN_IN}
      </PhoneButton>
    </form>
  );
}
