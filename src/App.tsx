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
  answeredStreams,
  answeredTitle,
  explain,
  HostClient,
  type Action,
  type ActionError,
  type AddonManifest,
  type AddonStreams,
  type Extra,
  type MetaPreview,
  type PlaybackSnapshot,
  type Protection,
  type Response,
  type Snapshot,
  type Stream,
  type Title,
  type Video,
} from "./host-client";
import {
  formatTime,
  pictureNote,
  playingName,
  transportable,
  watching,
} from "./playback";
import {
  badgeLines,
  playabilityNote,
  theFilm,
  unplayableNote,
  warningNote,
} from "./stream";
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
  const [keyDraft, setKeyDraft] = useState("");
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
  // The Streams the Host answered for the Video this client pressed play on,
  // and the candidate it chose. Both are this client's own, like the Title:
  // one client choosing among candidates moves nothing on another (ADR-0005).
  const [streams, setStreams] = useState<AddonStreams[] | null>(null);
  const [chosen, setChosen] = useState<Stream | null>(null);
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
        setStreams(null);
        setChosen(null);
        setTitle(opened);
      }
    },
    [take],
  );

  /**
   * Press play on a Video: ask every Addon that answers for its Streams. The
   * list replaces the Videos it was asked from, and going back returns to them;
   * a refusal leaves the client where it was, with the Videos it was reading.
   */
  const play = useCallback(
    async (video: Video) => {
      if (!title) {
        return;
      }
      setSelected(video);
      setChosen(null);
      setStreams(null);
      const response = await take({
        type: "find_streams",
        video: { type: title.type, id: video.id },
      });
      if (response) {
        setStreams(answeredStreams(response));
      }
    },
    [take, title],
  );

  /**
   * Choose a candidate. A Stream this Host can open starts playing it at once —
   * the common case is one click (story 19) — and one it cannot says so and
   * stays in the list.
   *
   * The candidate goes back whole, with the Addon whose answer it came from:
   * the Host re-asks nothing, so what plays is the candidate this client picked,
   * and what every client is told about it is the Addon's own words (ADR-0013).
   */
  const chooseStream = useCallback(
    async (addon: string, stream: Stream) => {
      if (!title || !selected) {
        return;
      }
      if (playabilityNote(stream.playback) !== null) {
        setChosen(stream);
        return;
      }

      setChosen(null);
      await take({
        type: "play_stream",
        video: { type: title.type, id: selected.id },
        addon,
        stream,
      });
    },
    [take, title, selected],
  );

  /** Close the Stream list and go back to the Videos it was asked from. */
  const closeStreams = useCallback(() => {
    setStreams(null);
    setChosen(null);
  }, []);

  /** Close the open Title and go back to what this client was browsing. */
  const closeTitle = useCallback(() => {
    setTitle(null);
    setPreview(null);
    setSelected(null);
    setStreams(null);
    setChosen(null);
  }, []);

  const back = useCallback(() => {
    if (streams) {
      closeStreams();
      return;
    }
    if (title) {
      closeTitle();
      return;
    }
    setResults(null);
    setQueryDraft("");
  }, [streams, title, closeStreams, closeTitle]);

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

  const storeKey = (event: FormEvent) => {
    event.preventDefault();
    // A pasted key can carry a stray space at either end; the Host will not take
    // one, and a trimmed key is the same key.
    const key = keyDraft.trim();
    if (!key) {
      return;
    }
    // The field is the only place the value is ever shown: once the Host has
    // taken it, it becomes a fact about the store — held, never the value.
    void take({ type: "set_tmdb_key", key }).then((taken) => {
      if (taken) {
        setKeyDraft("");
      }
    });
  };

  const showing = results ?? rows;
  // Playback is the one genuinely shared state, so while it is doing anything
  // this window *is* the player: the picture, and the interface over it. A
  // Stream that failed is `idle` — nothing is playing — which is what puts the
  // client back on the list it chose from, with the failure said beside it.
  const playback = snapshot?.playback ?? null;
  const isWatching = playback !== null && watching(playback.state);

  // Where the picture is in *this* window, the page has to stop painting its
  // rectangle: mpv's child window is behind the webview, and an opaque body
  // would cover the video with the page (ADR-0003). The Host said where the
  // picture is; this is the window acting on it.
  const pictureBehind = isWatching && playback?.picture === "in_window";

  useEffect(() => {
    document.body.classList.toggle("picture-behind", pictureBehind);
    return () => document.body.classList.remove("picture-behind");
  }, [pictureBehind]);

  return (
    <main className={`window${isWatching ? " watching" : ""}`} ref={surface}>
      {isWatching && playback ? (
        <PlayerSurface playback={playback} onTake={(action) => void take(action)} />
      ) : (
        <>
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
                streams={streams}
                chosen={chosen}
                onPlay={play}
                onChoose={(addon, stream) => void chooseStream(addon, stream)}
                onCloseStreams={closeStreams}
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

          <section aria-labelledby="tmdb-heading">
            <h2 id="tmdb-heading">TMDB key</h2>
            <p className="lede">
              Where an Addon's id maps to a TMDB record, TMDB's metadata stands over
              the Addon's. The Host reads the key when it asks, and no Snapshot
              carries it.
            </p>
            {/* Where a credential actually lives is the machine's answer, not this
                window's: it is read off the Snapshot the Host publishes. */}
            <p className="lede" data-testid="protection">
              {snapshot ? protectionOf(snapshot.protection) : "Waiting for the Host…"}
            </p>
            <form onSubmit={storeKey}>
              <label htmlFor="tmdb-key">TMDB API key or read-access token</label>
              <input
                id="tmdb-key"
                type="password"
                autoComplete="off"
                placeholder="the key TMDB gave you"
                size={40}
                value={keyDraft}
                onChange={(event) => setKeyDraft(event.target.value)}
                data-focusable
              />
              <button type="submit" data-focusable>
                Save key
              </button>
              <button
                type="button"
                data-focusable
                onClick={() => void take({ type: "clear_tmdb_key" })}
              >
                Clear key
              </button>
            </form>
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

        </>
      )}
      {error ? (
        <p role="alert" className="error">
          {explain(error)}
        </p>
      ) : null}

      {/* A Stream that failed to open is said so here, wherever the client has
          got to: it is what sends it back to the list it chose from. */}
      {playback?.failure ? (
        <p role="alert" className="error" data-testid="playback-failure">
          {`${playback.failure} Pick another Stream from the list.`}
        </p>
      ) : null}
    </main>
  );
}

/**
 * The Host's picture, with this window's interface drawn over it.
 *
 * The Host put the picture where this platform can put it (ADR-0003), and this
 * surface is the other half of that decision: where the picture is in the same
 * window as the interface, the page paints nothing over its rectangle and the
 * video shows through; where it is in mpv's own window, the interface says so
 * instead of pretending. The OSD is the control set the Host accepts Actions
 * for, and every one of them is an Action like any other (ADR-0002).
 */
function PlayerSurface({
  playback,
  onTake,
}: {
  playback: PlaybackSnapshot;
  onTake: (action: Action) => void;
}) {
  const { state, picture, nowPlaying, position, duration } = playback;
  const note = pictureNote(picture);
  // What the slider shows while it is being dragged: the position the Host
  // published, until a person moves the thumb, and then what they moved it to.
  const [scrub, setScrub] = useState<number | null>(null);
  const shown = scrub ?? position ?? 0;

  const seekTo = (seconds: number) => {
    setScrub(null);
    onTake({ type: "seek", target: { kind: "to", seconds } });
  };

  return (
    <section className="player" aria-label="Playing">
      {/* The rectangle the picture goes in. Where the picture is in this window
          the page leaves it unpainted — mpv's child window is behind it — and
          where it is not, this is where that is said. It is also the largest
          button in the window: pressing the video is how a person pauses it,
          and it is what makes "a click lands on the interface rather than on
          the video" something a person can do. */}
      <div
        className="picture"
        data-testid="picture"
        data-picture={picture}
        data-state={state}
      >
        <button
          type="button"
          className="picture-toggle"
          data-testid="picture-toggle"
          data-focusable
          aria-label="Play or pause"
          onClick={() => onTake({ type: "set_paused", paused: state === "playing" })}
        />
        {note ? <p className="picture-note">{note}</p> : null}
        {state === "opening" ? (
          <p className="picture-note" data-testid="opening-stream">
            {`Opening ${playingName(nowPlaying)}…`}
          </p>
        ) : null}
        {state === "ended" ? (
          <p className="picture-note" data-testid="stream-ended">
            The Stream reached its end.
          </p>
        ) : null}
      </div>

      <div className="osd">
        <p className="now-playing" data-testid="now-playing">
          {`Playing ${playingName(nowPlaying)}`}
        </p>

        <div className="transport">
          {transportable(state) ? (
            <>
              <button
                type="button"
                data-focusable
                aria-label="Back ten seconds"
                onClick={() => onTake({ type: "seek", target: { kind: "by", seconds: -10 } })}
              >
                −10 s
              </button>
              <button
                type="button"
                data-focusable
                data-testid={state === "playing" ? "pause" : "play"}
                aria-label={state === "playing" ? "Pause" : "Play"}
                onClick={() => onTake({ type: "set_paused", paused: state === "playing" })}
              >
                {state === "playing" ? "Pause" : "Play"}
              </button>
              <button
                type="button"
                data-focusable
                aria-label="Forward ten seconds"
                onClick={() => onTake({ type: "seek", target: { kind: "by", seconds: 10 } })}
              >
                +10 s
              </button>

              <input
                type="range"
                aria-label="Position"
                data-testid="position"
                min={0}
                max={duration ?? 0}
                step={1}
                value={shown}
                disabled={duration === null}
                onChange={(event) => setScrub(Number(event.target.value))}
                onPointerUp={() => scrub !== null && seekTo(scrub)}
                onKeyUp={() => scrub !== null && seekTo(scrub)}
                data-focusable
              />
            </>
          ) : null}
          {/* The readout is not a control: where playback is and how long the
              Stream is are worth saying even while it is still opening. */}
          <span className="clock" data-testid="clock">
            {`${formatTime(position)} / ${formatTime(duration)}`}
          </span>
        </div>

        <button
          type="button"
          className="stop"
          data-focusable
          onClick={() => onTake({ type: "stop_playback" })}
        >
          Stop
        </button>
      </div>
    </section>
  );
}

/**
 * An opened Title: what the Host says about it, its Videos to choose from, and
 * — once a Video is pressed — the Streams every answering Addon offered for it.
 *
 * The metadata has TMDB standing over the Addon's where the Host could map the
 * Title, and the card this client opened as the fallback for whatever a sparse
 * answer left out; a Title no record met is marked unmapped rather than hidden.
 * The Videos are grouped into seasons in the Addon's own order, and pressing
 * one asks the Host for its Streams. Choosing a candidate plays it, unless it is
 * one this Host has no way to open: what is chosen is this client's own — a
 * Remote client choosing among candidates must move nothing on another
 * (ADR-0005) — and what is *playing* travels to everyone as a Snapshot.
 */
function TitleView({
  title,
  preview,
  selected,
  streams,
  chosen,
  onPlay,
  onChoose,
  onCloseStreams,
  onBack,
}: {
  title: Title;
  preview: MetaPreview | null;
  selected: Video | null;
  streams: AddonStreams[] | null;
  chosen: Stream | null;
  onPlay: (video: Video) => void;
  onChoose: (addon: string, stream: Stream) => void;
  onCloseStreams: () => void;
  onBack: () => void;
}) {
  const poster = posterOf(title, preview);
  const release = releaseOf(title, preview);
  const facts = [release, title.runtime, title.imdbRating ? `★ ${title.imdbRating}` : null]
    .filter((fact): fact is string => Boolean(fact))
    .join(" · ");
  const seasons = seasonsOf(title);
  // What the Streams are Streams *of*: an episode by its number and name, or
  // the film itself.
  const subject =
    selected && selected.id !== title.id
      ? [labelOf(selected) ?? selected.id, selected.name]
          .filter((part): part is string => Boolean(part))
          .join(" — ")
      : nameOf(title, preview);

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
          {/* Keyed by the Addon is the unchanged key of a Title nothing mapped:
              it stays visible, keyed as its Addon indexes it (CONTEXT.md). */}
          {title.key.kind === "addon" ? (
            <p className="title-unmapped" data-testid="title-unmapped">
              Unmapped — no TMDB record met this Title, so it is keyed by its Addon.
            </p>
          ) : null}
          {title.genres.length > 0 ? (
            <p className="title-genres">{title.genres.join(", ")}</p>
          ) : null}
          {title.description ? (
            <p className="title-description">{title.description}</p>
          ) : null}
        </div>
      </header>

      {streams !== null ? (
        <StreamList
          subject={subject}
          groups={streams}
          chosen={chosen}
          onChoose={onChoose}
          onClose={onCloseStreams}
        />
      ) : seasons.length === 0 ? (
        <>
          <p className="lede" data-testid="title-no-videos">
            {isSeries(title)
              ? "This series' Addon listed no episodes."
              : "This Title is one Video: the film itself."}
          </p>
          {isSeries(title) ? null : (
            <button
              type="button"
              className="play"
              data-focusable
              data-testid="play-film"
              onClick={() => onPlay(theFilm(title))}
            >
              Play
            </button>
          )}
        </>
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
                      onClick={() => onPlay(video)}
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
    </article>
  );
}

/**
 * The Streams a Video can be played as: one block per Addon that answered, in
 * the order the Addons were configured, each candidate drawn from its own
 * fields. An Addon that failed, or answered nothing this Host can play, says so
 * without blanking the others; an unplayable candidate is listed and marked
 * rather than hidden, so the list is what exists and not only what will work.
 */
function StreamList({
  subject,
  groups,
  chosen,
  onChoose,
  onClose,
}: {
  subject: string;
  groups: AddonStreams[];
  chosen: Stream | null;
  onChoose: (addon: string, stream: Stream) => void;
  onClose: () => void;
}) {
  return (
    <section className="streams" aria-label={`Streams — ${subject}`}>
      <button type="button" data-focusable onClick={onClose}>
        Back to the Videos
      </button>
      <h4 data-testid="streams-heading">{`Streams — ${subject}`}</h4>

      {groups.length === 0 ? (
        <p className="lede" data-testid="streams-none">
          No configured Addon offers Streams for this Video.
        </p>
      ) : null}

      {groups.map((group) => (
        <section
          className="stream-group"
          key={group.addon}
          data-testid={`streams-${group.addon}`}
        >
          <h5 className="stream-addon">{group.addon}</h5>
          {group.failure ? (
            <p role="alert" className="error">
              {explain(group.failure)}
            </p>
          ) : null}
          {!group.failure && group.streams.length === 0 ? (
            <p className="lede">This Addon answered nothing this Host can play.</p>
          ) : null}

          <ul className="stream-list">
            {group.streams.map((stream, index) => (
              <li key={index}>
                <StreamChoice
                  stream={stream}
                  testId={`candidate-${group.addon}-${index}`}
                  chosen={chosen === stream}
                  onChoose={(stream) => onChoose(group.addon, stream)}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}

      {chosen ? (
        <p role="status" data-testid="chosen-stream">
          {unplayableNote(chosen)}
        </p>
      ) : null}
    </section>
  );
}

/**
 * One candidate: the Addon's own badge line, its description and filename, what
 * its hints warn about, and whether this Host can play it.
 */
function StreamChoice({
  stream,
  testId,
  chosen,
  onChoose,
}: {
  stream: Stream;
  testId: string;
  chosen: boolean;
  onChoose: (stream: Stream) => void;
}) {
  const badges = badgeLines(stream);
  const note = playabilityNote(stream.playback);

  return (
    <button
      type="button"
      className="stream"
      data-focusable
      data-testid={testId}
      aria-pressed={chosen}
      onClick={() => onChoose(stream)}
    >
      {badges.length > 0 ? (
        <span className="stream-badges">
          {badges.map((badge, index) => (
            <span className="badge" key={index}>
              {badge}
            </span>
          ))}
        </span>
      ) : null}
      {stream.description ? (
        <span className="stream-description">{stream.description}</span>
      ) : null}
      {stream.filename ? (
        <span className="stream-filename" data-testid="stream-filename">
          {stream.filename}
        </span>
      ) : null}
      {stream.bingeGroup ? (
        <span className="stream-binge">{`binge group ${stream.bingeGroup}`}</span>
      ) : null}
      {note ? <span className="stream-note">{note}</span> : null}
      {stream.warnings.map((warning) => (
        <span className="stream-warning" key={warning}>
          {warningNote(warning)}
        </span>
      ))}
    </button>
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

/**
 * Where the Host's credentials live, and whether it holds a TMDB key, in a
 * person's words.
 *
 * The backend is a fact about the machine — the OS keyring, or the owner-only
 * (0600) file fallback — so it is said even before a key is entered: knowing
 * where the next one would land is the point of asking (ADR-0002: the window
 * renders what the Host published and decides nothing itself).
 */
function protectionOf(protection: Protection): string {
  const where =
    protection.backend === "keyring"
      ? "the OS keyring"
      : "an owner-only (0600) file in the data directory, because no keyring is reachable here";
  return protection.tmdbHeld
    ? `A TMDB key is held in ${where}.`
    : `No TMDB key is held. One would be kept in ${where}.`;
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
