import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import {
  blankRow,
  catalogKey,
  declaredCatalogs,
  keyOf,
  pageable,
  rowWith,
  searchRow,
  SKIP,
  unaskable,
  type Row,
} from "./browse";
import {
  asActionError,
  explain,
  HostClient,
  type Action,
  type ActionError,
  type AddonManifest,
  type CatalogRow,
  type Extra,
  type MetaPreview,
  type Response,
  type Snapshot,
} from "./host-client";
import { useArrowKeys } from "./useArrowKeys";

/**
 * The Host's window.
 *
 * It holds no state of its own beyond what it is showing: it takes Actions, and
 * it renders the Snapshots the Host publishes — including the one that follows
 * its own Action, so what the window shows is what the Host holds. Browsing is
 * the exception that proves the rule: a catalog row is answered to the client
 * that asked, because two clients looking at different rows is the point.
 *
 * It knows nothing about what Addons want: which catalog can be asked for, and
 * what values it needs, are the Host's decisions, and the window finds out by
 * asking and being refused (ADR-0010).
 */
export function App({ client }: { client?: HostClient }) {
  const host = useMemo(() => client ?? new HostClient(), [client]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<ActionError | null>(null);
  const [languageDraft, setLanguageDraft] = useState("");
  const [urlDraft, setUrlDraft] = useState("");
  const [queryDraft, setQueryDraft] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Row[] | null>(null);
  const [chosen, setChosen] = useState<MetaPreview | null>(null);
  const surface = useRef<HTMLElement | null>(null);

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

  /** Take an Action and answer with what came of it, or with why it did not. */
  const send = useCallback(
    async (action: Action): Promise<{ response: Response | null; error: ActionError | null }> => {
      try {
        return { response: await host.dispatch(action), error: null };
      } catch (caught) {
        return { response: null, error: asActionError(caught) };
      }
    },
    [host],
  );

  /** The same, for an Action a person asked for: a refusal is shown to them. */
  const take = useCallback(
    async (action: Action) => {
      setError(null);
      const { response, error } = await send(action);
      if (error) {
        setError(error);
      }
      return response;
    },
    [send],
  );

  /** Ask the Host for a page of a row, and fold the answer into the row. */
  const load = useCallback(
    async (row: Row, extra: Extra[]): Promise<Row | null> => {
      const { response, error } = await send({
        type: "browse_catalog",
        addon: row.addon,
        catalog: { type: row.type, id: row.id },
        extra,
      });
      if (error) {
        // A catalog the Host will not answer is not a row at all; anything else
        // is a row that says what went wrong, so one Addon's trouble does not
        // take the whole home surface with it.
        return unaskable(error) ? null : { ...row, failure: error };
      }
      const answer = firstRow(response);
      return answer ? rowWith(row, answer) : null;
    },
    [send],
  );

  // The home surface: one row per catalog the Addons declare, in the order they
  // were configured. Asked for one at a time, so the first row appears as soon as
  // the first Addon answers rather than after the last.
  //
  // Keyed on which catalogs there are, not on every revision: a preference change
  // publishes a new Snapshot and does not make a new row.
  const catalogueKeys = useMemo(
    () => declaredCatalogs(snapshot).map(catalogKey).join("|"),
    [snapshot],
  );
  useEffect(() => {
    const catalogs = declaredCatalogs(snapshot);
    setRows([]);
    if (catalogs.length === 0) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    void (async () => {
      for (const catalog of catalogs) {
        if (cancelled) {
          return;
        }
        const row = await load(blankRow(catalog), []);
        if (cancelled) {
          return;
        }
        if (row) {
          setRows((held) => [...held, row]);
        }
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // Deliberately keyed on `catalogueKeys` rather than on `snapshot`: reading
    // `snapshot` here is how the catalogs are listed, but a new Snapshot with the
    // same catalogs in it must not throw away the rows a person has paged.
  }, [catalogueKeys, load]);

  const page = useCallback(
    (row: Row) => {
      void load(row, [{ name: SKIP, value: String(row.offset) }]).then((paged) => {
        if (paged) {
          setRows((held) => held.map((held) => (keyOf(held) === keyOf(row) ? paged : held)));
        }
      });
    },
    [load],
  );

  const runSearch = (event: FormEvent) => {
    event.preventDefault();
    const query = queryDraft.trim();
    if (!query) {
      return;
    }
    void take({ type: "search_catalogs", query }).then((response) => {
      if (response) {
        setChosen(null);
        setQueryDraft("");
        // One page per catalog: searching again is how a search is narrowed.
        setResults((response.answer?.catalogs ?? []).map(searchRow));
      }
    });
  };

  const back = useCallback(() => {
    setChosen(null);
    setResults(null);
    setQueryDraft("");
  }, []);

  useArrowKeys(surface, back);

  // Something is always focused, so the arrows have somewhere to start and a
  // person can see where they are without reaching for the mouse. When the
  // control they were on goes away — a search's results, an Addon removed —
  // focus would otherwise fall to the page body and the arrows would start over.
  useEffect(() => {
    const active = document.activeElement;
    if (active && active !== document.body) {
      return;
    }
    surface.current?.querySelector<HTMLElement>("[data-focusable]")?.focus();
  });

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

  const showing = results ?? rows;

  return (
    <main className="window" ref={surface}>
      <h1>streamingapp</h1>
      <p className="lede">
        The Host owns everything you see here. This window is one of its clients.
      </p>

      {snapshot ? (
        <p className="revision" data-testid="revision">
          Snapshot revision {snapshot.revision}
        </p>
      ) : (
        <p className="revision">Waiting for the Host…</p>
      )}

      <section aria-labelledby="browse-heading">
        <h2 id="browse-heading">Browse</h2>
        <form onSubmit={runSearch}>
          <label htmlFor="search">Search the Addons that offer it</label>
          <input
            id="search"
            placeholder="a title"
            size={32}
            value={queryDraft}
            onChange={(event) => setQueryDraft(event.target.value)}
            data-focusable
          />
          <button type="submit" data-focusable>
            Search
          </button>
          {results ? (
            <button type="button" onClick={back} data-focusable>
              Back to browsing
            </button>
          ) : null}
        </form>

        {chosen ? (
          // The seat #24 fills: choosing a Title opens it, with its metadata and
          // its Videos. Until then, OK says what it chose rather than nothing —
          // above the rows, where a person pressing OK on a remote can see it.
          <p role="status" data-testid="chosen">
            Selected {chosen.name}
            {chosen.releaseInfo ? ` (${chosen.releaseInfo})` : ""} — opening a Title
            arrives in #24.
          </p>
        ) : null}

        {loading ? <p data-testid="catalogs-loading">Loading…</p> : null}
        {!loading && showing.length === 0 ? (
          <p data-testid="catalogs-empty">
            {results
              ? "No Addon answered that search."
              : snapshot && snapshot.addons.length > 0
                ? "The configured Addons offer no catalog to browse."
                : "No Addons are configured yet."}
          </p>
        ) : null}

        {showing.map((row) => (
          <CatalogSection
            key={keyOf(row)}
            row={row}
            paging={pageable(snapshot, row)}
            onMore={page}
            onOpen={setChosen}
          />
        ))}
      </section>

      <section aria-labelledby="state-heading">
        <h2 id="state-heading">State</h2>
        <p data-testid="addon-count">
          {snapshot
            ? `${snapshot.addons.length} Addon${snapshot.addons.length === 1 ? "" : "s"} configured.`
            : "Waiting for the Host…"}
        </p>
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
            data-focusable
          />
          <button type="submit" data-focusable>
            Add
          </button>
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
            data-focusable
          />
          <button type="submit" data-focusable>
            Save
          </button>
          <button
            type="button"
            data-focusable
            onClick={() => void take({ type: "clear_subtitle_language" })}
          >
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

/** The first answer, when there is one; a search may answer with several. */
function firstRow(response: Response | null): CatalogRow | null {
  return response?.answer?.catalogs?.[0] ?? null;
}

/** One catalog's row: its name, its cards, and a way to page on. */
function CatalogSection({
  row,
  paging,
  onMore,
  onOpen,
}: {
  row: Row;
  paging: boolean;
  onMore: (row: Row) => void;
  onOpen: (meta: MetaPreview) => void;
}) {
  const heading = `row-${keyOf(row)}`;
  return (
    <section
      className="row"
      aria-labelledby={heading}
      data-testid={`row-${row.addon}-${row.type}-${row.id}`}
    >
      <h3 id={heading}>
        {row.name} <span className="addon-id">{row.addon}</span>
      </h3>
      {row.failure ? (
        <p role="alert" className="error">
          {explain(row.failure)}
        </p>
      ) : null}
      {row.metas.length === 0 && !row.failure ? (
        <p className="lede">This catalog is empty.</p>
      ) : null}

      <ul className="cards">
        {row.metas.map((meta) => (
          <li key={meta.id}>
            <button
              type="button"
              className="card"
              data-focusable
              data-testid={`card-${meta.id}`}
              onClick={() => onOpen(meta)}
            >
              {meta.poster ? (
                <img src={meta.poster} alt="" loading="lazy" />
              ) : (
                <span className="poster-missing" aria-hidden="true" />
              )}
              <span className="card-name">{meta.name}</span>
              {meta.releaseInfo ? <span className="card-year">{meta.releaseInfo}</span> : null}
              {meta.description ? (
                // For a catalog of releases — a library of films and episodes —
                // the description is the filename, and it is the only thing that
                // tells two entries with one poster and one title apart.
                <span className="card-note" title={meta.description}>
                  {meta.description}
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>

      {paging && !row.done ? (
        <button
          type="button"
          data-focusable
          aria-label={`More from ${row.name}`}
          onClick={() => onMore(row)}
        >
          More
        </button>
      ) : null}
    </section>
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
          <button
            type="button"
            data-focusable
            aria-label={`Remove ${addon.name}`}
            onClick={() => remove(addon.id)}
          >
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
