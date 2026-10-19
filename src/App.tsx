import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

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
  ASPECTS,
  DELAY_STEP,
  SPEEDS,
  aspectSelected,
  chapterLabel,
  controllable,
  cropChoices,
  cropSelected,
  formatDelay,
  formatSpeed,
  formatVolume,
  nextEpisodeDisabled,
  orderedTracks,
  speedSelected,
  statisticsLines,
  stepDelay,
  subtitlesOn,
  trackLabel,
  trackMarks,
} from "./controls";
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
  type ResumeEntry,
  type Snapshot,
  type Stream,
  type Title,
  type Track,
  type Video,
} from "./host-client";
import {
  formatTime,
  pictureNote,
  playingName,
  transportable,
  watching,
} from "./playback";
import { cardName, cardNote, progressOf, resumable } from "./library";
import {
  badgeLines,
  playabilityNote,
  theFilm,
  unplayableNote,
  warningNote,
} from "./stream";
import {
  isSeries,
  labelOf,
  nameOf,
  posterOf,
  releaseOf,
  seasonName,
  seasonsOf,
  titleStubOf,
} from "./title";
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
  // The Stremio sign-in fields (#30): what is being typed, and nothing that
  // outlives the attempt. A taken sign-in clears them; the password is sent once
  // and the Host keeps only the `authKey` Stremio answers with.
  const [emailDraft, setEmailDraft] = useState("");
  const [passwordDraft, setPasswordDraft] = useState("");
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
  // Whether the player menu is open. It is this window's own — which panel a
  // client has opened moves nothing on another (ADR-0005) — and it lives here
  // rather than in the player surface so that Escape, which the window handles
  // in one place, can close it the way it closes every other overlay.
  const [menu, setMenu] = useState(false);
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
        // The Title this client has open, which is what the Host records Watch
        // progress against (#29). The card it opened from stands in for what a
        // sparse meta answer left out.
        title: titleStubOf(title, preview),
      });
    },
    [take, title, preview, selected],
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

  /**
   * Continue watching: play a Video again from where the Host left it. The
   * client names only the Video — where to resume from, and which Addon's
   * candidate to open, are the Host's own record and its own rule (#29).
   */
  const resume = useCallback(
    (entry: ResumeEntry) => {
      void take({
        type: "resume",
        video: { type: entry.title.type, id: entry.video.id },
      });
    },
    [take],
  );

  const back = useCallback(() => {
    // The player menu is the innermost thing Escape closes: while it is open the
    // rest of the window is behind it.
    if (menu) {
      setMenu(false);
      return;
    }
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
  }, [menu, streams, title, closeStreams, closeTitle]);

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

  /**
   * Sign in to Stremio (#30). The Host exchanges the password once for an
   * `authKey` it keeps in the secret store; this window decides nothing about
   * the sign-in — whether the shape is one, and whether Stremio takes it, are
   * the Host's answers, and a refusal is shown rather than pre-empted. A taken
   * sign-in clears both fields; a refusal keeps them so a typo can be fixed. The
   * password is only ever what is in the field being typed into — it is in no
   * Snapshot, and the Host keeps only the `authKey` Stremio answers with.
   */
  const signIn = (event: FormEvent) => {
    event.preventDefault();
    void take({
      type: "sign_in_stremio",
      email: emailDraft.trim(),
      password: passwordDraft,
    }).then((taken) => {
      if (taken) {
        setEmailDraft("");
        setPasswordDraft("");
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

  // A menu left open when playback stops would meet whatever plays next already
  // unfolded; a client that is no longer the player does not keep a panel from
  // the last Stream.
  useEffect(() => {
    if (!isWatching) {
      setMenu(false);
    }
  }, [isWatching]);

  return (
    <main className={`window${isWatching ? " watching" : ""}`} ref={surface}>
      {isWatching && playback ? (
        <PlayerSurface
          playback={playback}
          onTake={(action) => void take(action)}
          menuOpen={menu && controllable(playback.state)}
          onMenu={setMenu}
        />
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

          {/* The Continue watching row (#29): what the Host holds Watch progress
              in, most recently played first. It is the Host's library, so every
              client sees the same row; pressing a card resumes from where that
              client — or another — left off. */}
          {!title && snapshot && snapshot.watchProgress.length > 0 ? (
            <section aria-labelledby="continue-heading">
              <h2 id="continue-heading">Continue watching</h2>
              <ul className="continue">
                {snapshot.watchProgress.map((entry) => (
                  <li key={`${entry.title.type}/${entry.video.id}`}>
                    <ContinueCard entry={entry} onResume={() => resume(entry)} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

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

          {/* Where credentials live is the machine's answer, not this window's: it
              is read off the Snapshot the Host publishes, and it covers every
              credential the Host holds — the TMDB key and the Stremio account. */}
          <section aria-labelledby="credentials-heading">
            <h2 id="credentials-heading">Credentials</h2>
            <p className="lede" data-testid="protection">
              {snapshot ? protectionOf(snapshot.protection) : "Waiting for the Host…"}
            </p>
          </section>

          <section aria-labelledby="tmdb-heading">
            <h2 id="tmdb-heading">TMDB key</h2>
            <p className="lede">
              Where an Addon's id maps to a TMDB record, TMDB's metadata stands over
              the Addon's. The Host reads the key when it asks, and no Snapshot
              carries it.
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

          <section aria-labelledby="stremio-heading">
            <h2 id="stremio-heading">Stremio account</h2>
            <p className="lede">
              Sign in once and Watch progress travels both ways: what you watch here
              appears in Stremio's own apps, and what you watch there is picked up
              here. Optional — with no account, nothing about the Host depends on
              Stremio.
            </p>
            {/* Whether an account is held is said by the protection line above,
                read off the Snapshot. Signing out only stops the Host talking to
                Stremio: Watch progress already merged stays in the Library.

                A sign-in the Host will not send is refused by the Host, in the
                Host's words (`invalid_stremio_login`), so the form does not
                pre-judge the shape of an email or a password: `noValidate` keeps
                the browser from turning a wrong shape into a silent non-submit
                the person cannot read. */}
            {snapshot?.protection.stremioHeld ? (
              <button
                type="button"
                data-focusable
                onClick={() => void take({ type: "sign_out_stremio" })}
              >
                Sign out
              </button>
            ) : (
              <form onSubmit={signIn} noValidate>
                <label htmlFor="stremio-email">Stremio email</label>
                <input
                  id="stremio-email"
                  type="email"
                  autoComplete="off"
                  placeholder="you@example.com"
                  size={32}
                  value={emailDraft}
                  onChange={(event) => setEmailDraft(event.target.value)}
                  data-focusable
                />
                <label htmlFor="stremio-password">Stremio password</label>
                <input
                  id="stremio-password"
                  type="password"
                  autoComplete="off"
                  placeholder="the password Stremio knows"
                  size={32}
                  value={passwordDraft}
                  onChange={(event) => setPasswordDraft(event.target.value)}
                  data-focusable
                />
                <button type="submit" data-focusable>
                  Sign in
                </button>
              </form>
            )}
          </section>

          {/* Where another device connects (#31): the address and the code the
              Host is showing, and the devices it has paired. Revoking takes one
              device's token away and leaves every other device working, which is
              what the list is for. */}
          <section aria-labelledby="remote-heading">
            <h2 id="remote-heading">Remote devices</h2>
            <p className="lede">
              On another device on this network, open the address below and enter
              the code once. That device is remembered; the code is not needed
              again, and a device can be revoked on its own.
            </p>
            {snapshot ? (
              <dl className="lede">
                <dt>Address</dt>
                <dd data-testid="remote-address">
                  {snapshot.address ?? "this Host is not serving the network"}
                </dd>
                <dt>Pairing code</dt>
                <dd data-testid="pairing-code">{snapshot.pairingCode}</dd>
              </dl>
            ) : (
              <p className="lede" data-testid="remote-address">
                Waiting for the Host…
              </p>
            )}
            <ul data-testid="devices" className="lede">
              {snapshot && snapshot.devices.length > 0 ? (
                snapshot.devices.map((device) => (
                  <li key={device.id} data-testid={`device-${device.id}`}>
                    <span>{device.name}</span>, paired{" "}
                    {new Date(device.pairedAt).toLocaleString()}{" "}
                    <button
                      type="button"
                      data-focusable
                      onClick={() => void take({ type: "revoke_device", id: device.id })}
                    >
                      Revoke
                    </button>
                  </li>
                ))
              ) : snapshot ? (
                <li data-testid="no-devices">No device is paired yet.</li>
              ) : null}
            </ul>
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
 * One card in the Continue watching row: the Title's poster and name, where the
 * Video was left, and how far in it is.
 *
 * It is a button because a press is how a person means "keep watching": the
 * Action it sends is `resume`, and where that play begins is the Host's own
 * record rather than anything kept here. An entry whose Addon is gone stays
 * listed — a stub is a mark, not a hiding — and is drawn as a button a person
 * cannot press, with the reason on it.
 */
function ContinueCard({
  entry,
  onResume,
}: {
  entry: ResumeEntry;
  onResume: () => void;
}) {
  const fraction = progressOf(entry);
  const playable = resumable(entry);

  return (
    <button
      type="button"
      className="continue-card"
      data-focusable
      data-testid={`resume-${entry.video.id}`}
      data-unplayable={playable ? undefined : "true"}
      disabled={!playable}
      onClick={onResume}
    >
      {entry.title.poster ? (
        <img className="continue-poster" src={entry.title.poster} alt="" />
      ) : (
        <span className="continue-poster continue-poster-empty" aria-hidden="true" />
      )}
      <span className="continue-name">{cardName(entry)}</span>
      <span className="continue-note" data-testid={`resume-note-${entry.video.id}`}>
        {cardNote(entry)}
      </span>
      {fraction !== null ? (
        <span className="continue-bar" aria-hidden="true">
          <span style={{ width: `${Math.round(fraction * 100)}%` }} />
        </span>
      ) : null}
    </button>
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
  menuOpen,
  onMenu,
}: {
  playback: PlaybackSnapshot;
  onTake: (action: Action) => void;
  menuOpen: boolean;
  onMenu: (open: boolean) => void;
}) {
  const { state, picture, nowPlaying, position, duration } = playback;
  const note = pictureNote(picture);
  // What the transport means in this state: the buttons and the picture are a
  // control only while the Host would take a pause or a seek, and a Stream that
  // is still opening, or one that has ended, offers Stop alone.
  const canTransport = transportable(state);
  // The full control set is wider than the transport: the Host takes every other
  // control while a Stream is opening too, so the menu is offered there as well.
  const live = controllable(state);
  const playing = state === "playing";
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
        {canTransport ? (
          <button
            type="button"
            className="picture-toggle"
            data-testid="picture-toggle"
            data-focusable
            aria-label="Play or pause"
            onClick={() => onTake({ type: "set_paused", paused: playing })}
          />
        ) : null}
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
          {canTransport ? (
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
                data-testid={playing ? "pause" : "play"}
                aria-label={playing ? "Pause" : "Play"}
                onClick={() => onTake({ type: "set_paused", paused: playing })}
              >
                {playing ? "Pause" : "Play"}
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

        {live ? (
          <button
            type="button"
            className="menu-toggle"
            data-focusable
            data-testid="toggle-menu"
            aria-expanded={menuOpen}
            onClick={() => onMenu(!menuOpen)}
          >
            {menuOpen ? "Close menu" : "Menu"}
          </button>
        ) : null}

        <button
          type="button"
          className="stop"
          data-focusable
          onClick={() => onTake({ type: "stop_playback" })}
        >
          Stop
        </button>

        {/* A Stream that reached its end is where a series' next episode is
            looked for: the control is offered here because the menu, which is
            the other place it lives, is not offered for a Stream the Host will
            not control (#29). What counts as an episode is the Host's own
            reading, published beside Now playing (ADR-0021). */}
        {state === "ended" && !nextEpisodeDisabled(playback.episode) ? (
          <button
            type="button"
            className="next-episode"
            data-focusable
            data-testid="next-episode-after-end"
            onClick={() => onTake({ type: "next_episode" })}
          >
            Next episode
          </button>
        ) : null}
      </div>

      {/* The control panel, drawn over the picture in the style the rest of the
          window uses: the compact bar stays, and the panel unfolds from it with
          every control the Host accepts while something plays. It is a menu like
          any other — its choices are Actions, and the selected one is the
          Snapshot's own answer, not this client's memory. */}
      {menuOpen ? (
        <div className="menu" role="group" aria-label="Playback controls" data-testid="player-menu">
          <PlayerMenu playback={playback} onTake={onTake} />
        </div>
      ) : null}
    </section>
  );
}

/**
 * The player menu: every control the Host accepts while a Stream plays, in the
 * one place a person reaches for them.
 *
 * Nothing here decides playback: each control sends the Action a remote client
 * would send, and the group it is drawn as selected in is the Snapshot the Host
 * published. The tracks are embedded-first, subtitles can be turned off, the
 * delay steps by a tenth, the crops are cut from the picture's own size, and the
 * statistics and the next-episode control appear on the terms the Host offers
 * them (ADR-0002, ADR-0005).
 */
function PlayerMenu({
  playback,
  onTake,
}: {
  playback: PlaybackSnapshot;
  onTake: (action: Action) => void;
}) {
  const audio = orderedTracks(playback.tracks, "audio");
  const subtitles = orderedTracks(playback.tracks, "subtitle");
  const delay = playback.subtitleDelay ?? 0;
  // What the volume slider shows while it is being dragged: the level the Host
  // published, until a person moves the thumb, and then what they moved it to.
  const [volumeScrub, setVolumeScrub] = useState<number | null>(null);
  const shownVolume = volumeScrub ?? Math.round(playback.volume ?? 100);
  const [showStatistics, setShowStatistics] = useState(false);

  const sendVolume = (level: number) => {
    setVolumeScrub(null);
    onTake({ type: "set_volume", level });
  };

  return (
    <>
      <section className="menu-group" aria-label="Tracks">
        <h3>Audio</h3>
        {audio.length === 0 ? (
          <p className="menu-empty">This Stream carries no audio track to pick.</p>
        ) : null}
        {audio.map((track) => (
          <TrackChoice key={track.id} track={track} onTake={onTake} />
        ))}

        <h3>Subtitles</h3>
        {subtitles.map((track) => (
          <TrackChoice key={track.id} track={track} onTake={onTake} />
        ))}
        <button
          type="button"
          className="choice"
          data-focusable
          data-testid="subtitles-off"
          aria-pressed={!subtitlesOn(playback.tracks)}
          onClick={() => onTake({ type: "set_subtitle_track", track: null })}
        >
          Subtitles off
        </button>
      </section>

      <section className="menu-group" aria-label="Subtitle delay">
        <h3>Subtitle delay</h3>
        <span className="readout" data-testid="subtitle-delay">
          {formatDelay(delay)}
        </span>
        <button
          type="button"
          className="choice"
          data-focusable
          data-testid="delay-back"
          onClick={() =>
            onTake({ type: "set_subtitle_delay", seconds: stepDelay(delay, -DELAY_STEP) })
          }
        >
          −0.1 s
        </button>
        <button
          type="button"
          className="choice"
          data-focusable
          data-testid="delay-forward"
          onClick={() =>
            onTake({ type: "set_subtitle_delay", seconds: stepDelay(delay, DELAY_STEP) })
          }
        >
          +0.1 s
        </button>
        <button
          type="button"
          className="choice"
          data-focusable
          data-testid="delay-reset"
          onClick={() => onTake({ type: "set_subtitle_delay", seconds: 0 })}
        >
          Reset
        </button>
      </section>

      <section className="menu-group" aria-label="Speed">
        <h3>Speed</h3>
        {SPEEDS.map((rate) => (
          <button
            key={rate}
            type="button"
            className="choice"
            data-focusable
            data-testid={`speed-${rate}`}
            aria-pressed={speedSelected(playback.speed, rate)}
            onClick={() => onTake({ type: "set_speed", rate })}
          >
            {formatSpeed(rate)}
          </button>
        ))}
      </section>

      <section className="menu-group" aria-label="Volume">
        <h3>Volume</h3>
        <input
          type="range"
          aria-label="Volume"
          data-testid="volume"
          min={0}
          max={130}
          step={1}
          value={shownVolume}
          onChange={(event) => setVolumeScrub(Number(event.target.value))}
          onPointerUp={() => volumeScrub !== null && sendVolume(volumeScrub)}
          onKeyUp={() => volumeScrub !== null && sendVolume(volumeScrub)}
          data-focusable
        />
        <span className="readout" data-testid="volume-level">
          {formatVolume(shownVolume)}
        </span>
        <button
          type="button"
          className="choice"
          data-focusable
          data-testid="mute"
          aria-pressed={playback.muted ?? false}
          onClick={() => onTake({ type: "set_muted", muted: !(playback.muted ?? false) })}
        >
          {playback.muted ? "Unmute" : "Mute"}
        </button>
      </section>

      <section className="menu-group" aria-label="Chapters">
        <h3>Chapters</h3>
        <button
          type="button"
          className="choice"
          data-focusable
          aria-label="Previous chapter"
          onClick={() => onTake({ type: "previous_chapter" })}
        >
          Previous
        </button>
        <button
          type="button"
          className="choice"
          data-focusable
          aria-label="Next chapter"
          onClick={() => onTake({ type: "next_chapter" })}
        >
          Next
        </button>
        {playback.chapters.length === 0 ? (
          <p className="menu-empty">This Stream lists no chapters.</p>
        ) : (
          <ul className="chapters">
            {playback.chapters.map((chapter) => (
              <li key={chapter.index}>
                <button
                  type="button"
                  className="choice"
                  data-focusable
                  data-testid={`chapter-${chapter.index}`}
                  aria-pressed={playback.chapter === chapter.index}
                  onClick={() => onTake({ type: "set_chapter", index: chapter.index })}
                >
                  {chapterLabel(chapter)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="menu-group" aria-label="Crop">
        <h3>Crop</h3>
        {cropChoices(playback.resolution).map(({ label, crop }) => (
          <button
            key={label}
            type="button"
            className="choice"
            data-focusable
            data-testid={`crop-${label}`}
            aria-pressed={cropSelected(playback.crop, crop)}
            onClick={() => onTake({ type: "set_crop", crop })}
          >
            {label}
          </button>
        ))}
      </section>

      <section className="menu-group" aria-label="Aspect">
        <h3>Aspect</h3>
        {ASPECTS.map(({ label, aspect }) => (
          <button
            key={label}
            type="button"
            className="choice"
            data-focusable
            data-testid={`aspect-${label}`}
            aria-pressed={aspectSelected(playback.aspect, aspect)}
            onClick={() => onTake({ type: "set_aspect", aspect })}
          >
            {label}
          </button>
        ))}
      </section>

      <section className="menu-group" aria-label="Statistics">
        <h3>Statistics</h3>
        <button
          type="button"
          className="choice"
          data-focusable
          data-testid="toggle-statistics"
          aria-pressed={showStatistics}
          onClick={() => setShowStatistics((shown) => !shown)}
        >
          {showStatistics ? "Hide statistics" : "Show statistics"}
        </button>
        {showStatistics ? (
          <dl className="statistics" data-testid="statistics">
            {statisticsLines(playback.statistics).map(({ label, value }) => (
              <Fragment key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </Fragment>
            ))}
          </dl>
        ) : null}
      </section>

      {!nextEpisodeDisabled(playback.episode) ? (
        <section className="menu-group" aria-label="Next episode">
          <button
            type="button"
            className="choice"
            data-focusable
            data-testid="next-episode"
            onClick={() => onTake({ type: "next_episode" })}
          >
            Next episode
          </button>
        </section>
      ) : null}
    </>
  );
}

/**
 * One track in the menu. Pressing it selects that track — the same Action a
 * remote client sends, carrying the id the Snapshot published — and the mark
 * beside it says what the container said about it. A subtitle track can only be
 * chosen, not turned off here: that is the "Subtitles off" choice.
 */
function TrackChoice({
  track,
  onTake,
}: {
  track: Track;
  onTake: (action: Action) => void;
}) {
  const marks = trackMarks(track);
  return (
    <button
      type="button"
      className="choice"
      data-focusable
      data-testid={`track-${track.kind}-${track.id}`}
      aria-pressed={track.selected}
      onClick={() =>
        onTake(
          track.kind === "audio"
            ? { type: "set_audio_track", track: track.id }
            : { type: "set_subtitle_track", track: track.id },
        )
      }
    >
      <span className="track-label">{trackLabel(track)}</span>
      {marks.map((mark) => (
        <span className="track-mark" key={mark}>
          {mark}
        </span>
      ))}
    </button>
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
    selected && isSeries(title)
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
            {`${title.addon ?? "TMDB"} · ${title.type}/${title.id}`}
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
 * Where the Host's credentials live, and which of them it holds, in a person's
 * words.
 *
 * The backend is a fact about the machine — the OS keyring, or the owner-only
 * (0600) file fallback — so it is said even before a credential is entered:
 * knowing where the next one would land is the point of asking (ADR-0002: the
 * window renders what the Host published and decides nothing itself). Both
 * credentials are covered, because "where they live" is the same place for
 * either, and "is one held" is the fact an owner reads to know whether an
 * account is signed in (#30).
 */
function protectionOf(protection: Protection): string {
  const where =
    protection.backend === "keyring"
      ? "the OS keyring"
      : "an owner-only (0600) file in the data directory, because no keyring is reachable here";
  const tmdb = protection.tmdbHeld
    ? `A TMDB key is held in ${where}.`
    : `No TMDB key is held. One would be kept in ${where}.`;
  const stremio = protection.stremioHeld
    ? "A Stremio account is signed in."
    : "No Stremio account is signed in.";
  return `${tmdb} ${stremio}`;
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
