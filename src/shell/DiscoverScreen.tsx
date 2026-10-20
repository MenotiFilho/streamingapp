import { useCallback, useEffect, useRef, useState } from "react";

import {
  blankFeed,
  discoverAsk,
  discoverPlayable,
  feedWith,
  genresOf,
  MOVIE,
  type DiscoverFeed,
  type DiscoverKind,
} from "../discover";
import { answeredDiscover, explain } from "../host-client";
import { SERIES } from "../title";
import tmdbLogo from "../assets/tmdb-logo.svg";
import { useShell } from "./context";
import { Button, ChoiceChip, PosterCard } from "./kit";
import { credentialsLevel } from "./SettingsScreen";
import { useTitleOpener } from "./TitleScreen";
import "./discover.css";

/**
 * Discover: TMDB's weekly Trending feed, folded to one kind at a time, with a
 * genre filter drawn from that kind's own list and pages read as a spatial
 * grid.
 *
 * With no TMDB key the screen stays in the rail and says where a key goes
 * instead of disappearing (ADR-0020). With one, every page is a question to
 * the Host — this window never builds a TMDB URL and never holds the key — and
 * a failed page is drawn inline, holding the cards already read. The feed
 * itself is this client's own accumulated browse (ADR-0005); paging here
 * moves nothing on another device.
 *
 * A card is marked unplayable in two tiers: at once when no configured Addon
 * declares a spelling a TMDB Title could be asked by, and later when opening
 * the Title found every Addon's Streams answer empty (ADR-0020).
 */
export function DiscoverScreen() {
  const { snapshot, ask, push, unplayable } = useShell();
  const { openDiscoveredTitle } = useTitleOpener();
  const [kind, setKind] = useState<DiscoverKind>(MOVIE);
  const [genre, setGenre] = useState<number | null>(null);
  const [feed, setFeed] = useState<DiscoverFeed>(blankFeed);
  const [loading, setLoading] = useState(false);
  // Which ask owns the feed: an answer for a kind or genre a person has left
  // must not land in the one they are looking at.
  const serial = useRef(0);

  const keyed = snapshot?.protection.tmdbHeld ?? false;

  const load = useCallback(
    async (kind: DiscoverKind, genre: number | null, page: number) => {
      const token = (serial.current += 1);
      setLoading(true);
      const { response, error } = await ask(discoverAsk({ kind, page, genre }));
      if (token !== serial.current) {
        return;
      }
      setLoading(false);
      if (error) {
        setFeed((held) => ({ ...held, failure: error }));
        return;
      }
      const answer = answeredDiscover(response)[0];
      if (!answer) {
        setFeed((held) => ({ ...held, done: true }));
        return;
      }
      setFeed((held) => feedWith(held, answer));
    },
    [ask],
  );

  // A key, a kind, or a genre is a new feed: the page a person read for the
  // last one is not a page of this one. The same Snapshot arriving again (a
  // playback change, say) is not.
  useEffect(() => {
    if (!keyed) {
      serial.current += 1;
      setFeed(blankFeed());
      setLoading(false);
      return;
    }
    setFeed(blankFeed());
    void load(kind, genre, 1);
    return () => {
      serial.current += 1;
    };
  }, [keyed, kind, genre, load]);

  const more = useCallback(() => {
    if (loading) {
      return;
    }
    void load(kind, genre, feed.page + 1);
  }, [feed.page, genre, kind, load, loading]);

  const chooseKind = (next: DiscoverKind) => {
    if (next === kind) {
      return;
    }
    setKind(next);
    // TMDB's two genre lists are not the same set, so a film's genre is not a
    // series' filter. Switching kinds starts from an unfiltered feed.
    setGenre(null);
  };

  const chooseGenre = (next: number | null) => {
    if (next !== genre) {
      setGenre(next);
    }
  };

  const genres = genresOf(kind);
  const couldPlay = discoverPlayable(snapshot?.addons ?? [], kind);
  const moreAvailable =
    !feed.done && (feed.items.length > 0 || feed.failure !== null);

  return (
    <section
      className="discover-screen"
      data-testid="discover-screen"
      data-region="discover"
      data-kind="branch"
      data-label="Discover"
    >
      <h1 className="shell-screen-title">Discover</h1>

      {snapshot === null ? <p className="shell-note">Waiting for the Host…</p> : null}

      {snapshot !== null && !keyed ? (
        <div className="discover-empty" data-testid="discover-no-key">
          <h2 className="discover-empty-title">Discover is powered by TMDB</h2>
          <p className="discover-empty-body">
            TMDB supplies the weekly Trending feed and the genres it can be
            filtered by. Add a TMDB API key in <strong>Settings → Credentials</strong>{" "}
            to browse it.
          </p>
          <Button variant="primary" onClick={() => push(credentialsLevel())}>
            Open Settings → Credentials
          </Button>
        </div>
      ) : null}

      {snapshot !== null && keyed ? (
        <>
          <p className="shell-lede">
            TMDB's weekly Trending feed. Choose a kind, narrow it by a genre, or
            page on through what is popular now.
          </p>

          <div className="discover-controls">
            <div
              className="discover-kinds"
              data-region="discover-kinds"
              data-kind="row"
              data-label="Kind"
            >
              <ChoiceChip pressed={kind === MOVIE} onClick={() => chooseKind(MOVIE)}>
                Movie
              </ChoiceChip>
              <ChoiceChip pressed={kind === SERIES} onClick={() => chooseKind(SERIES)}>
                Series
              </ChoiceChip>
            </div>

            <div
              className="discover-genres"
              data-region="discover-genres"
              data-kind="row"
              data-label="Genres"
            >
              <ChoiceChip pressed={genre === null} onClick={() => chooseGenre(null)}>
                All genres
              </ChoiceChip>
              {genres.map((held) => (
                <ChoiceChip
                  key={held.id}
                  pressed={genre === held.id}
                  onClick={() => chooseGenre(held.id)}
                >
                  {held.name}
                </ChoiceChip>
              ))}
            </div>
          </div>

          {feed.page === 0 && loading ? (
            <p className="shell-note" data-testid="discover-loading">
              Looking for Titles…
            </p>
          ) : null}

          {feed.failure ? (
            <p role="alert" className="discover-failure" data-testid="discover-failure">
              {explain(feed.failure)}
            </p>
          ) : null}

          <section
            className="discover-grid"
            data-testid="discover-grid"
            data-region="discover-grid"
            data-kind="row"
            data-label="Discover titles"
            aria-label="Discover titles"
          >
            {feed.items.map((meta) => (
              <PosterCard
                key={meta.id}
                name={meta.name}
                poster={meta.poster}
                subtitle={meta.releaseInfo}
                description={meta.description}
                unplayable={!couldPlay || unplayable.has(meta.id)}
                testId={`discover-card-${meta.id}`}
                onClick={() => void openDiscoveredTitle(meta)}
              />
            ))}

            {moreAvailable ? (
              <div className="discover-more">
                <Button variant="ghost" disabled={loading} onClick={more}>
                  More
                </Button>
              </div>
            ) : null}
          </section>
        </>
      ) : null}

      <footer className="discover-credit" data-testid="discover-tmdb-credit">
        <img
          className="discover-tmdb-logo"
          src={tmdbLogo}
          alt="TMDB"
          data-testid="discover-tmdb-logo"
        />
        <p className="discover-credit-notice" data-testid="discover-tmdb-notice">
          This product uses the TMDB API but is not endorsed or certified by TMDB
        </p>
      </footer>
    </section>
  );
}
