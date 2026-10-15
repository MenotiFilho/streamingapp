import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import {
  asActionError,
  explain,
  HostClient,
  type Action,
  type ActionError,
  type Snapshot,
} from "./host-client";

/**
 * The Host's window.
 *
 * It holds no state of its own beyond what it is showing: it takes Actions, and
 * it renders the Snapshots the Host publishes — including the one that follows
 * its own Action, so what the window shows is what the Host holds.
 */
export function App({ client }: { client?: HostClient }) {
  const host = useMemo(() => client ?? new HostClient(), [client]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<ActionError | null>(null);
  const [draft, setDraft] = useState("");

  const publish = useCallback((next: Snapshot) => {
    setSnapshot((current) =>
      current && current.revision > next.revision ? current : next,
    );
  }, []);

  // Follow the Host first, then ask it where things stand: an update that lands
  // while the first read is in flight then still wins on revision.
  useEffect(() => {
    let stop: (() => void) | undefined;
    let closed = false;
    void host.onSnapshot(publish).then((unlisten) => {
      if (closed) {
        unlisten();
      } else {
        stop = unlisten;
      }
    });
    void host.snapshot().then(publish).catch((caught: unknown) => setError(asActionError(caught)));
    return () => {
      closed = true;
      stop?.();
    };
  }, [host, publish]);

  const take = useCallback(
    async (action: Action) => {
      setError(null);
      try {
        await host.dispatch(action);
        // The preference is shown above; the field is for entering the next one,
        // so a value that was just taken does not sit there looking like state.
        setDraft("");
      } catch (caught) {
        setError(asActionError(caught));
      }
    },
    [host],
  );

  const save = (event: FormEvent) => {
    event.preventDefault();
    const language = draft.trim();
    if (!language) {
      return;
    }
    void take({ type: "set_subtitle_language", language });
  };

  return (
    <main className="window">
      <h1>streamingapp</h1>
      <p className="lede">
        The Host owns everything you see here. This window is one of its clients.
      </p>

      <section aria-labelledby="state-heading">
        <h2 id="state-heading">State</h2>
        {snapshot ? (
          <p data-testid="revision">
            Snapshot revision {snapshot.revision}
          </p>
        ) : (
          <p>Waiting for the Host…</p>
        )}
      </section>

      <section aria-labelledby="preference-heading">
        <h2 id="preference-heading">Subtitle language</h2>
        <p data-testid="subtitle-language">
          {snapshot?.preferences.subtitleLanguage ?? "none — the Host picks per Video"}
        </p>
        <form onSubmit={save}>
          <label htmlFor="subtitle-language">Prefer a language tag</label>
          <input
            id="subtitle-language"
            placeholder="pt-BR"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="submit">Save</button>
          <button type="button" onClick={() => void take({ type: "clear_subtitle_language" })}>
            Clear
          </button>
        </form>
      </section>

      {error ? (
        <p role="alert" className="error">
          {explain(error)}
        </p>
      ) : null}
    </main>
  );
}
