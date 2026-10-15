import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import {
  asActionError,
  explain,
  HostClient,
  type Action,
  type ActionError,
  type AddonManifest,
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
  const [languageDraft, setLanguageDraft] = useState("");
  const [urlDraft, setUrlDraft] = useState("");

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
        return true;
      } catch (caught) {
        setError(asActionError(caught));
        return false;
      }
    },
    [host],
  );

  const save = (event: FormEvent) => {
    event.preventDefault();
    const language = languageDraft.trim();
    if (!language) {
      return;
    }
    // The preference is shown above; the field is for entering the next one, so a
    // value that was taken does not sit there looking like state.
    void take({ type: "set_subtitle_language", language }).then((taken) => {
      if (taken) {
        setLanguageDraft("");
      }
    });
  };

  const configure = (event: FormEvent) => {
    event.preventDefault();
    const url = urlDraft.trim();
    if (!url) {
      return;
    }
    void take({ type: "add_addon", url }).then((taken) => {
      if (taken) {
        setUrlDraft("");
      }
    });
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

      <section aria-labelledby="addons-heading">
        <h2 id="addons-heading">Addons</h2>
        <p className="lede">
          Paste an Addon's manifest URL. The Host fetches it, reads it, and keeps
          it; your Addons are the Host's, not this window's.
        </p>
        <form onSubmit={configure}>
          <label htmlFor="manifest-url">Addon manifest URL</label>
          <input
            id="manifest-url"
            placeholder="https://example.com/manifest.json"
            size={48}
            value={urlDraft}
            onChange={(event) => setUrlDraft(event.target.value)}
          />
          <button type="submit">Add</button>
        </form>

        {addonList(snapshot, (id) => void take({ type: "remove_addon", id }))}
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
            value={languageDraft}
            onChange={(event) => setLanguageDraft(event.target.value)}
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

/** What the Host is configured with, and what each Addon says it offers. */
function addonList(snapshot: Snapshot | null, remove: (id: string) => void) {
  if (!snapshot) {
    return null;
  }
  if (snapshot.addons.length === 0) {
    return <p data-testid="addons-empty">No Addons are configured yet.</p>;
  }

  return (
    <ul className="addons" data-testid="addons">
      {snapshot.addons.map((addon) => (
        <li className="addon" key={addon.id} data-testid={`addon-${addon.id}`}>
          <h3>
            {addon.name} <span className="version">{addon.version}</span>
          </h3>
          <p className="addon-id">{addon.id}</p>
          <dl>
            <dt>Resources</dt>
            <dd>{resourcesOf(addon)}</dd>
            <dt>Types</dt>
            <dd>{listed(addon.types)}</dd>
            <dt>Catalogs</dt>
            <dd>{catalogsOf(addon)}</dd>
          </dl>
          {/* The window has no private way to reach the Host: removing an Addon
              is the same Action a remote client would take, by the id the
              Snapshot published. */}
          <button type="button" aria-label={`Remove ${addon.name}`} onClick={() => remove(addon.id)}>
            Remove
          </button>
        </li>
      ))}
    </ul>
  );
}

function resourcesOf(addon: AddonManifest): string {
  if (addon.resources.length === 0) {
    return "none";
  }
  return addon.resources
    .map((resource) =>
      resource.types && resource.types.length > 0
        ? `${resource.name} (${resource.types.join(", ")})`
        : resource.name,
    )
    .join(", ");
}

function catalogsOf(addon: AddonManifest): string {
  if (addon.catalogs.length === 0) {
    return "none";
  }
  return addon.catalogs.map((catalog) => `${catalog.name} (${catalog.type})`).join(", ");
}

function listed(items: string[]): string {
  return items.length > 0 ? items.join(", ") : "none";
}
