import { useEffect, useState } from "react";

import {
  answeredCatalogs,
  explain,
  type ActionError,
  type CatalogRow,
  type MetaPreview,
} from "../../host-client";
import { discoverPlayable, MOVIE } from "../../discover";
import { SERIES } from "../../title";
import { DiscoverScreen } from "../DiscoverScreen";
import { useShell } from "../context";
import { ChoiceChip } from "./kit";
import { SearchScreen } from "../SearchScreen";
import { useTitleOpener } from "../TitleScreen";
import { usePreviewData } from "./context";
import { CINEMETA_MOVIE_GENRES, CINEMETA_SERIES_GENRES } from "./preview";
import { countLabel, programIndex } from "./program";
import { ProgramPoster } from "./ProgramPoster";
import { RowHead } from "./RowHead";

type PreviewKind = typeof MOVIE | typeof SERIES;

/**
 * Discover in a plain Vite window, where there is no Host and therefore no TMDB
 * Credential: the same editorial feed is drawn from Cinemeta's Popular
 * catalogue, with real posters and real metadata. The two chips pick one kind
 * at a time and the genre chips narrow it; both are single-select, with Movie
 * and All genres where a person lands. It is a preview stand-in, not a second
 * Discover — the Tauri window asks the Host for TMDB's feed and the destination
 * keeps its real behaviour (ADR-0020).
 */
function PreviewDiscover() {
  const { snapshot, ask } = useShell();
  const { openTitle } = useTitleOpener();
  const [kind, setKind] = useState<PreviewKind>(MOVIE);
  const [genre, setGenre] = useState<string | null>(null);
  const [row, setRow] = useState<CatalogRow | null>(null);
  const [failure, setFailure] = useState<ActionError | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailure(null);
    setRow(null);
    void ask({
      type: "browse_catalog",
      addon: "cinemeta",
      catalog: { type: kind, id: "top" },
      extra: genre === null ? [] : [{ name: "genre", value: genre }],
    }).then(({ response, error }) => {
      if (cancelled) {
        return;
      }
      setLoading(false);
      if (error) {
        setFailure(error);
        return;
      }
      const answered = answeredCatalogs(response)[0] ?? null;
      setRow(answered);
      setFailure(answered?.failure ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [ask, genre, kind]);

  const chooseKind = (next: PreviewKind) => {
    if (next === kind) {
      return;
    }
    setKind(next);
    // The two genre lists are not the same set, so a film's genre is not a
    // series' filter. A kind change starts from the whole new feed.
    setGenre(null);
  };

  const genres = kind === MOVIE ? CINEMETA_MOVIE_GENRES : CINEMETA_SERIES_GENRES;
  // Before the Snapshot lands there is no evidence against a Title, so it is
  // not marked; the mark is earned, never assumed (ADR-0020).
  const couldPlay = snapshot === null ? true : discoverPlayable(snapshot.addons, kind);
  const open = (row: CatalogRow, meta: MetaPreview) => {
    openTitle(row.addon, meta);
  };
  const label = kind === MOVIE ? "Films" : "Series";
  const tag = [
    genre,
    row ? row.name : null,
    row ? countLabel(kind, row.metas.length) : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" / ");

  return (
    <section
      className="rep-feed rep-feed--discover"
      data-testid="discover-screen"
      data-region="discover"
      data-kind="branch"
      data-label="Discover"
    >
      <p className="rep-feed-kicker">
        <span>Discover</span>
        <span className="rep-rule" aria-hidden="true" />
      </p>

      <div
        className="discover-kinds rep-kind-filter"
        data-region="discover-kinds"
        data-kind="row"
        data-label="Kind"
      >
        <ChoiceChip
          pressed={kind === MOVIE}
          data-testid="discover-kind-movie"
          onClick={() => chooseKind(MOVIE)}
        >
          Movie
        </ChoiceChip>
        <ChoiceChip
          pressed={kind === SERIES}
          data-testid="discover-kind-series"
          onClick={() => chooseKind(SERIES)}
        >
          Series
        </ChoiceChip>
      </div>

      <div
        className="discover-genres rep-kind-filter"
        data-region="discover-genres"
        data-kind="row"
        data-label="Genres"
      >
        <ChoiceChip pressed={genre === null} onClick={() => setGenre(null)}>
          All genres
        </ChoiceChip>
        {genres.map((held) => (
          <ChoiceChip key={held} pressed={genre === held} onClick={() => setGenre(held)}>
            {held}
          </ChoiceChip>
        ))}
      </div>

      {snapshot === null ? <p className="rep-feed-note">Waiting for the programme…</p> : null}

      <section
        className="rep-feed-section"
        data-region={`discover:${kind}`}
        data-kind="row"
        data-label={label}
        data-testid={`discover-section-${kind}`}
      >
        <RowHead index={programIndex(1)} title={label} tag={tag || "Reading"} />
        {row && row.metas.length > 0 ? (
          <div className="rep-feed-grid">
            {row.metas.map((meta) => (
              <ProgramPoster
                key={meta.id}
                meta={meta}
                testId={`discover-card-${meta.id}`}
                unplayable={!couldPlay}
                onOpen={() => open(row, meta)}
              />
            ))}
          </div>
        ) : null}
        {failure ? (
          <p role="alert" className="rep-feed-note rep-feed-note--failure">
            {explain(failure)}
          </p>
        ) : null}
        {!loading && !failure && row && row.metas.length === 0 ? (
          <p className="rep-feed-note">The Addon answered with no Titles in this section.</p>
        ) : null}
        {loading && !row ? <p className="rep-feed-note">Reading the programme…</p> : null}
      </section>

      <p className="rep-preview-note">
        Preview data: the catalogue is live from Cinemeta. The Tauri window asks the
        Host for TMDB's Discover feed instead. Artwork is served from Metahub and is
        not committed to the repository.
      </p>
    </section>
  );
}

/** Discover: the live Host's screen, or the preview feed where there is no Host. */
export function RepertoryDiscoverScreen() {
  const preview = usePreviewData();
  return preview ? (
    <PreviewDiscover />
  ) : (
    <div className="rep-feed rep-feed--discover">
      <p className="rep-feed-kicker">
        <span>Discover</span>
        <span className="rep-rule" aria-hidden="true" />
      </p>
      <DiscoverScreen />
    </div>
  );
}

/** Search: the Host's own two arms, drawn as an editorial feed. */
export function RepertorySearchScreen() {
  const preview = usePreviewData();
  return (
    <div className="rep-feed rep-feed--search">
      <p className="rep-feed-kicker">
        <span>Search</span>
        <span className="rep-rule" aria-hidden="true" />
      </p>
      <SearchScreen />
      {preview ? (
        <p className="rep-preview-note">
          Preview data: a query searches Cinemeta's Popular catalogues in this window.
          The Tauri window asks TMDB through the Host when a credential is held.
        </p>
      ) : null}
    </div>
  );
}
