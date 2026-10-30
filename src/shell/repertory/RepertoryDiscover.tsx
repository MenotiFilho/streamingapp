import { useCallback, useEffect, useRef, useState } from "react";

import {
  blankFeed,
  discoverAsk,
  discoverPlayable,
  feedWith,
  MOVIE,
  type DiscoverFeed,
  type DiscoverKind,
} from "../../discover";
import {
  answeredCatalogs,
  answeredDiscover,
  type MetaPreview,
} from "../../host-client";
import { SERIES } from "../../title";
import tmdbLogo from "../../assets/tmdb-logo.svg";
import { useShell } from "../context";
import { useTitleOpener } from "../TitleScreen";
import { usePreviewData } from "./context";
import {
  discoverEmptyNote,
  discoverTag,
  feedMore,
  feedState,
  genresFor,
  previewDiscoverAsk,
  type GenreChoice,
} from "./editorial";
import { EditorialRow } from "./EditorialRow";
import { Button, ChoiceChip, PosterCard } from "./kit";
import { PREVIEW_ADDON } from "./preview";
import { ProgrammeLine } from "./ProgrammeLine";
import { programIndex, yearOf } from "./program";
import { repertoryCredentialsLevel } from "./RepertorySettings";
import "./repertory.css";

/**
 * Discover as an editorial feed (design record §8): one programme line, the
 * two single-select kind chips with Movie where a person lands, the genre rail
 * for that kind, and one row of unframed posters.
 *
 * With a TMDB Credential the Host answers `discover`, and a page is asked
 * fresh: this client keeps only what it has read (ADR-0005). Without a key the
 * screen says what powers it and where the key goes rather than disappearing
 * (ADR-0020); in the plain Vite window there is no Host, so the same feed is
 * read from Cinemeta's Popular catalogue as a live stand-in.
 *
 * A page that fails is printed under this row and keeps the cards already read;
 * `More` asks that page again. A Title no configured Addon could play keeps its
 * Unplayable stamp and still opens (ADR-0020).
 */
export function RepertoryDiscoverScreen() {
  const preview = usePreviewData();
  const { snapshot, ask, push, unplayable } = useShell();
  const { openTitle, openDiscoveredTitle } = useTitleOpener();
  const [kind, setKind] = useState<DiscoverKind>(MOVIE);
  const [genre, setGenre] = useState<GenreChoice | null>(null);
  const [feed, setFeed] = useState<DiscoverFeed>(blankFeed);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  // Which ask owns the feed: an answer for a kind or genre a person has left
  // must not land in the one they are looking at.
  const serial = useRef(0);

  const keyed = snapshot?.protection.tmdbHeld ?? false;
  const source = preview ? "preview" : "host";
  const active = preview || keyed;

  const load = useCallback(
    async (page: number, skip: number) => {
      const token = (serial.current += 1);
      setLoading(true);
      const outcome = await ask(
        source === "preview"
          ? previewDiscoverAsk(kind, genre, skip)
          : discoverAsk({
              kind,
              page,
              genre: typeof genre?.value === "number" ? genre.value : null,
            }),
      );
      if (token !== serial.current) {
        return;
      }
      setLoading(false);
      if (outcome.error) {
        setFeed((held) => ({ ...held, failure: outcome.error }));
        return;
      }
      const answer =
        source === "preview"
          ? (answeredCatalogs(outcome.response)[0] ?? null)
          : (answeredDiscover(outcome.response)[0] ?? null);
      if (!answer) {
        setFeed((held) => ({ ...held, done: true }));
        return;
      }
      if (source === "preview" && !answer.failure) {
        setOffset((held) => held + answer.sent);
      }
      setFeed((held) => feedWith(held, answer));
    },
    [ask, genre, kind, source],
  );

  // A key, a kind, a genre, or the surface itself is a new feed: the page a
  // person read for the last one is not a page of this one.
  useEffect(() => {
    serial.current += 1;
    setFeed(blankFeed());
    setOffset(0);
    if (!active) {
      setLoading(false);
      return;
    }
    void load(1, 0);
    return () => {
      serial.current += 1;
    };
  }, [active, kind, genre, load]);

  const chooseKind = (next: DiscoverKind) => {
    if (next === kind) {
      return;
    }
    setKind(next);
    // TMDB's two genre lists are not the same set, so a film's genre is not a
    // series' filter. A kind change starts from the whole new feed.
    setGenre(null);
  };

  const chooseGenre = (next: GenreChoice | null) => {
    const key = next?.key ?? null;
    if ((genre?.key ?? null) !== key) {
      setGenre(next);
    }
  };

  const genres = genresFor(source, kind);
  const label = kind === MOVIE ? "Films" : "Series";
  const state = feedState(feed, loading);
  const couldPlay = snapshot === null ? true : discoverPlayable(snapshot.addons, kind);
  const tag =
    feed.page === 0 && !feed.failure
      ? "Reading"
      : discoverTag(kind, genre, feed.items.length);

  const note =
    state === "reading"
      ? "Reading the programme…"
      : state === "reading-more"
        ? "Reading on…"
        : state === "empty"
          ? discoverEmptyNote(genre)
          : null;

  const open = (meta: MetaPreview) => {
    if (source === "preview") {
      openTitle(PREVIEW_ADDON, meta);
      return;
    }
    void openDiscoveredTitle(meta);
  };

  const more = feedMore(feed) ? (
    <Button
      variant="ghost"
      disabled={loading}
      onClick={() => void load(feed.page + 1, offset)}
    >
      More
    </Button>
  ) : null;

  return (
    <section
      className="rep-feed rep-feed--discover"
      data-testid="discover-screen"
      data-region="discover"
      data-kind="branch"
      data-label="Discover"
    >
      <ProgrammeLine name="Discover" testId="discover-programme-line" />

      {snapshot === null && !preview ? (
        <p className="rep-home-waiting">Waiting for the Host…</p>
      ) : null}

      {snapshot !== null && !preview && !keyed ? (
        <section className="rep-feed-empty" data-testid="discover-no-key">
          <h2 className="rep-feed-empty-title">Discover is powered by TMDB</h2>
          <p className="rep-feed-empty-body">
            TMDB supplies the weekly Trending feed and the genres it can be filtered
            by. Add a TMDB API key in <strong>Settings → Credentials</strong> to
            browse it.
          </p>
          <Button variant="primary" onClick={() => push(repertoryCredentialsLevel())}>
            Open Settings → Credentials
          </Button>
        </section>
      ) : null}

      {active ? (
        <>
          <div
            className="rep-kind-filter"
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
            className="rep-kind-filter"
            data-region="discover-genres"
            data-kind="row"
            data-label="Genres"
          >
            <ChoiceChip pressed={genre === null} onClick={() => chooseGenre(null)}>
              All genres
            </ChoiceChip>
            {genres.map((held) => (
              <ChoiceChip
                key={held.key}
                pressed={genre?.key === held.key}
                onClick={() => chooseGenre(held)}
              >
                {held.name}
              </ChoiceChip>
            ))}
          </div>

          <EditorialRow
            title={label}
            index={programIndex(1)}
            tag={tag}
            action={more}
            failure={feed.failure}
            note={note}
            region={`discover:${kind}`}
            testId={`discover-section-${kind}`}
          >
            {feed.items.map((meta) => (
              <PosterCard
                key={meta.id}
                name={meta.name}
                poster={meta.poster}
                rating={meta.imdbRating?.trim() || null}
                subtitle={yearOf(meta)}
                unplayable={!couldPlay || unplayable.has(meta.id)}
                testId={`discover-card-${meta.id}`}
                onClick={() => open(meta)}
              />
            ))}
          </EditorialRow>
        </>
      ) : null}

      {preview ? (
        <p className="rep-preview-note">
          Preview data: the catalogue is live from Cinemeta. The Tauri window asks the
          Host for TMDB&rsquo;s Discover feed instead. Artwork is served from Metahub
          and is not committed to the repository.
        </p>
      ) : null}

      <footer className="rep-credit" data-testid="discover-tmdb-credit">
        <img
          className="rep-credit-logo"
          src={tmdbLogo}
          alt="TMDB"
          data-testid="discover-tmdb-logo"
        />
        <p className="rep-credit-notice" data-testid="discover-tmdb-notice">
          This product uses the TMDB API but is not endorsed or certified by TMDB
        </p>
      </footer>
    </section>
  );
}
