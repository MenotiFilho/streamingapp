import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import {
  libraryAddon,
  libraryExpired,
  libraryPreview,
} from "../../core/accountLibrary";
import { answeredLibrary } from "../../core/answers";
import { explain, type ActionError } from "../../core/errors";
import {
  LIBRARY_FILTERS,
  LIBRARY_SIGNED_OUT_BODY,
  LIBRARY_SUBTITLE,
  filterLibraryEntries,
  libraryEmptyCopy,
  libraryEntryProgress,
  libraryEntryWatched,
  type LibraryFilter,
} from "../../core/marqueeLibrary";
import type { Library } from "../../core/wire";
import { AddonNotice } from "../../kit/marquee/AddonNotice";
import { Button } from "../../kit/marquee/Button";
import { Chip } from "../../kit/marquee/Chip";
import { EmptyState } from "../../kit/marquee/EmptyState";
import { Poster } from "../../kit/marquee/Poster";
import { ScreenTitle } from "../../kit/marquee/ScreenTitle";
import { Spinner } from "../../kit/marquee/Spinner";
import { TextField } from "../../kit/marquee/TextField";
import { useShell } from "../context";
import { lookHintHandlers, useLookHints } from "../repertory/lookHint";
import { useTitleOpener } from "../TitleScreen";
import "./browse.css";

/**
 * Marquee Library (`17.jpg`, `17b.jpg`):
 * - Signed-out gate using Marquee `TextField` and `Button` to sign in to Stremio (`17b.jpg`).
 * - Signed-in collection with `All` / `Movies` / `Series` filter `Chip`s and a
 *   7-column `Poster` grid with watched and progress marks (`17.jpg`).
 * - Expired Stremio sessions prompt sign-in again; empty collections show `EmptyState`.
 */
export function MarqueeLibrary() {
  const { snapshot } = useShell();
  const held = snapshot?.protection.stremioHeld ?? false;

  return (
    <section
      className="mq-browse-screen mq-library"
      data-testid="screen-library"
      data-region="library"
      data-kind="branch"
      data-label="Library"
    >
      <div className="mq-browse-head">
        <ScreenTitle title="Library" subtitle={LIBRARY_SUBTITLE} />
      </div>

      {snapshot === null ? (
        <p className="mq-browse-waiting mq-type-caption mq-text-faint" role="status">
          Waiting for the Host…
        </p>
      ) : held ? (
        <LibraryRoom />
      ) : (
        <div className="mq-library-gate" data-testid="library-gate">
          <p className="mq-library-gate-body">{LIBRARY_SIGNED_OUT_BODY}</p>
          <MarqueeStremioSignIn />
        </div>
      )}
    </section>
  );
}

function MarqueeStremioSignIn({ onSignedIn }: { onSignedIn?: () => void }) {
  const { ask } = useShell();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<ActionError | null>(null);
  const [working, setWorking] = useState(false);

  const signIn = async (event: FormEvent<HTMLFormElement>) => {
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
    <form
      className="mq-library-signin-form"
      data-region="library-stremio-form"
      data-kind="branch"
      data-label="Stremio account"
      onSubmit={signIn}
      noValidate
    >
      <TextField
        id="mq-stremio-email"
        label="Stremio email"
        type="email"
        placeholder="you@example.com"
        value={email}
        onChange={setEmail}
      />
      <TextField
        id="mq-stremio-password"
        label="Stremio password"
        masked
        placeholder="the password Stremio knows"
        value={password}
        onChange={setPassword}
      />
      <Button
        type="submit"
        kind="primary"
        size="md"
        className="mq-library-signin-submit"
        disabled={working}
      >
        Sign in
      </Button>
      {error ? (
        <p role="alert" className="mq-browse-alert" data-testid="stremio-sign-in-error">
          {explain(error)}
        </p>
      ) : null}
    </form>
  );
}

function LibraryRoom() {
  const { snapshot, ask } = useShell();
  const { openTitle } = useTitleOpener();
  const look = useLookHints();
  const [library, setLibrary] = useState<Library | null>(null);
  const [error, setError] = useState<ActionError | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<LibraryFilter>("all");

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

  const watchProgress = snapshot?.watchProgress ?? [];
  const addons = snapshot?.addons ?? [];
  const filteredEntries = useMemo(
    () => filterLibraryEntries(library?.entries ?? [], filter),
    [library?.entries, filter],
  );

  const failure = error ?? library?.failure ?? null;
  if (failure) {
    const expired = libraryExpired(failure);
    return (
      <div className="mq-library-failure" data-testid="library-failure">
        {expired ? (
          <>
            <p role="alert" className="mq-browse-alert">
              {explain(failure)}
            </p>
            <p className="mq-library-expired-note">
              The Stremio session has expired. Sign in again to read your Library.
            </p>
            <MarqueeStremioSignIn onSignedIn={() => void load()} />
          </>
        ) : (
          <div className="mq-browse-notice-wrap">
            <AddonNotice
              addon="Stremio"
              reason={explain(failure)}
              onRetry={() => void load()}
            />
          </div>
        )}
      </div>
    );
  }

  if (loading && !library) {
    return (
      <div className="mq-browse-loading" data-testid="library-loading">
        <Spinner label="Reading the account Library…" />
      </div>
    );
  }

  if (!library) {
    return (
      <p className="mq-browse-waiting mq-type-caption mq-text-faint" role="status">
        Waiting for the Host…
      </p>
    );
  }

  if (library.entries.length === 0) {
    const empty = libraryEmptyCopy("all");
    return (
      <div className="mq-browse-empty-stage" data-testid="library-empty">
        <EmptyState icon="library" title={empty.title} body={empty.body} />
      </div>
    );
  }

  const empty = libraryEmptyCopy(filter);

  return (
    <>
      <div
        className="mq-library-filters"
        data-region="library-filters"
        data-kind="row"
        data-label="Filter Library"
      >
        {LIBRARY_FILTERS.map((option) => (
          <Chip
            key={option.id}
            selected={filter === option.id}
            data-testid={`library-filter-${option.id}`}
            onClick={() => setFilter(option.id)}
          >
            {option.label}
          </Chip>
        ))}
      </div>

      {filteredEntries.length === 0 ? (
        <div className="mq-browse-empty-stage" data-testid="library-empty">
          <EmptyState
            icon="library"
            title={empty.title}
            body={empty.body}
            action={
              empty.canReset
                ? { label: "Show all", onPress: () => setFilter("all") }
                : undefined
            }
          />
        </div>
      ) : (
        <div className="mq-browse-grid-port">
          <ul
            className="mq-poster-grid"
            data-testid="library-grid"
            data-region="library-grid"
            data-kind="branch"
            data-label="Library titles"
          >
            {filteredEntries.map((entry) => {
              const addon = libraryAddon(addons, entry);
              const preview = libraryPreview(entry);
              const watched = libraryEntryWatched(entry, watchProgress);
              const progress = libraryEntryProgress(entry, watched);
              const playable = addon !== null;
              return (
                <li key={entry.id} className="mq-poster-grid-item">
                  <Poster
                    {...lookHintHandlers(look, {
                      addon: addon?.id ?? null,
                      type: preview.type,
                      id: preview.id,
                    })}
                    className="mq-browse-card"
                    data-testid={`library-card-${entry.id}`}
                    name={entry.name}
                    poster={entry.poster}
                    watched={watched}
                    progress={progress}
                    unplayable={!playable}
                    disabled={!playable}
                    onClick={playable ? () => openTitle(addon.id, preview) : undefined}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}
