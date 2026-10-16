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
  answeredCatalogs,
  answeredTitle,
  explain,
  HostClient,
  type Action,
  type ActionError,
  type AddonManifest,
  type Extra,
  type MetaPreview,
  type Response,
  type Snapshot,
  type Title,
  type Video,
} from "./host-client";
import { isSeries, labelOf, nameOf, posterOf, releaseOf, seasonName, seasonsOf } from "./title";
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
  // The Title this client has opened, and the card it opened it from. Both are
  // this client's own: two people looking at different Titles is the point
  // (ADR-0005), so neither travels as a Snapshot. The card stays because a
  // sparse meta answer is allowed, and the card is then the fallback.
  const [preview, setPreview] = useState<MetaPreview | null>(null);
  const [title, setTitle] = useState<Title | null>(null);
  const [opening, setOpening] = useState<MetaPreview | null>(null);
  const [selected, setSelected] = useState<Video | null>(null);
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
      const answer = answeredCatalogs(response)[0] ?? null;
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
        setQueryDraft("");
        // One page per catalog: searching again is how a search is narrowed.
        setResults(answeredCatalogs(response).map(searchRow));
      }
    });
  };

  /**
   * Open a Title: ask the Addon that supplied the item for its metadata and its
   * Videos. A refusal leaves the client where it was, with the card it clicked.
   */
  const openTitle = useCallback(
    async (addon: string, meta: MetaPreview) => {
      setOpening(meta);
      const response = await take({
        type: "open_title",
        addon,
        title: { type: meta.type, id: meta.id },
      });
      setOpening(null);

      const opened = answeredTitle(response);
      if (opened) {
        setPreview(meta);
        setSelected(null);
        setTitle(opened);
      }
    },
    [take],
  );

  /** Close the open Title and go back to what this client was browsing. */
  const closeTitle = useCallback(() => {
    setTitle(null);
    setPreview(null);
    setSelected(null);
  }, []);

  const back = useCallback(() => {
    if (title) {
      closeTitle();
      return;
    }
    setResults(null);
    setQueryDraft("");
  }, [title, closeTitle]);

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
        {title ? (
          // Opening a Title replaces what this client was browsing: a person can
          // go back to it, and two clients can be on different screens at once
          // (ADR-0005).
          <TitleView
            title={title}
            preview={preview}
            selected={selected}
            onSelect={setSelected}
            onBack={closeTitle}
          />
        ) : (
          <>
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

            {opening ? (
              <p role="status" data-testid="opening-title">
                Opening {opening.name}…
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
                onOpen={(meta) => void openTitle(row.addon, meta)}
              />
            ))}
          </>
        )}
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

/**
 * An opened Title: what its Addon says about it, and its Videos to choose from.
 *
 * The metadata is the Addon's, with the card this client opened as the fallback
 * for whatever a sparse answer left out; the Videos are grouped into seasons in
 * the Addon's own order. Selecting an episode is this client's own choosing —
 * playing it arrives in #26/#27 — so it is held here and shown, not sent.
 */
function TitleView({
  title,
  preview,
  selected,
  onSelect,
  onBack,
}: {
  title: Title;
  preview: MetaPreview | null;
  selected: Video | null;
  onSelect: (video: Video) => void;
  onBack: () => void;
}) {
  const poster = posterOf(title, preview);
  const release = releaseOf(title, preview);
  const facts = [release, title.runtime, title.imdbRating ? `★ ${title.imdbRating}` : null]
    .filter((fact): fact is string => Boolean(fact))
    .join(" · ");
  const seasons = seasonsOf(title);

  return (
    <article className="title" data-testid={`title-${title.id}`}>
      <button type="button" data-focusable onClick={onBack}>
        Back to browsing
      </button>

      <header className="title-head">
        {poster ? (
          <img className="title-poster" src={poster} alt="" data-testid="title-poster" />
        ) : null}
        <div className="title-about">
          <h3 data-testid="title-name">{nameOf(title, preview)}</h3>
          {facts ? <p className="title-facts">{facts}</p> : null}
          {/* One string on purpose: adjacent JSX children become separate text
              nodes, which a reader of the accessibility tree sees as fragments
              of a phrase rather than the phrase. */}
          <p className="addon-id" data-testid="title-id">
            {`${title.addon} · ${title.type}/${title.id}`}
          </p>
          {title.genres.length > 0 ? (
            <p className="title-genres">{title.genres.join(", ")}</p>
          ) : null}
          {title.description ? (
            <p className="title-description">{title.description}</p>
          ) : null}
        </div>
      </header>

      {seasons.length === 0 ? (
        <p className="lede" data-testid="title-no-videos">
          {isSeries(title)
            ? "This series' Addon listed no episodes."
            : "This Title is one Video: the film itself."}
        </p>
      ) : (
        seasons.map(({ season, videos }) => (
          <section className="season" key={season ?? "unnumbered"}>
            <h4>{seasonName(season)}</h4>
            <ul className="episodes">
              {videos.map((video) => {
                const label = labelOf(video);
                return (
                  <li key={video.id}>
                    <button
                      type="button"
                      className="episode"
                      data-focusable
                      data-testid={`episode-${video.id}`}
                      aria-pressed={selected?.id === video.id}
                      onClick={() => onSelect(video)}
                    >
                      {label ? <span className="episode-label">{label}</span> : null}
                      <span className="episode-name">{video.name ?? video.id}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      {selected ? (
        <p role="status" data-testid="selected-video">
          Selected {labelOf(selected) ?? selected.id}
          {selected.name ? ` — ${selected.name}` : ""} — choosing a Stream arrives in
          #26.
        </p>
      ) : null}
    </article>
  );
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
