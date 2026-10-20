import { useCallback, useRef, useState } from "react";

import { answeredTitle, type Action, type Title, type Video } from "../host-client";
import {
  discoveredKeyOf,
  isSeries,
  labelOf,
  nameOf,
  releaseOf,
  seasonName,
  seasonsOf,
  titleArtOf,
  type OpenablePreview,
} from "../title";
import { theFilm } from "../stream";
import { useShell, type NewShellLevel } from "./context";
import { Button, Chip, ChoiceChip } from "./kit";
import { StreamsLoader } from "./StreamsScreen";
import "./title.css";

/**
 * The two doors a card has into the Title screen: its Addon's `open_title`, or
 * TMDB's `open_discovered_title` when the card was a Discovered Title.
 *
 * The Action is taken before the level is pushed, so a refusal leaves the card
 * where it was and the shell's one alert explains it. The answer is the client's
 * own (ADR-0005): the level is the screen that draws it, and nothing about it
 * travels back to the Host until a Video's Streams are asked for.
 */
export function useTitleOpener() {
  const { take, push, remove, levelExists } = useShell();
  // A second Activate before the first answer arrives would push a second
  // identical Title; one open is in flight at a time, whichever screen asked.
  const opening = useRef(false);

  /**
   * Open a Title at once: the card's own art and name are drawn as the level
   * while the Host asks for the full record, and the same level is replaced by
   * the real Title when the answer arrives. A Back while it loads takes the
   * level away, and an answer that comes later does not bring it back.
   */
  const openWith = useCallback(
    async (action: Action, preview: OpenablePreview) => {
      if (opening.current) {
        return;
      }
      opening.current = true;
      let cancelled = false;
      const id = push({
        name: "Title",
        kind: "overlay",
        render: () => <TitleLoading preview={preview} />,
        onBack: () => {
          // Backing out of the waiting Title lets the next card be pressed
          // without waiting for the first answer; the late answer is dropped.
          cancelled = true;
          opening.current = false;
          return false;
        },
      });
      try {
        const response = await take(action);
        if (cancelled || !levelExists(id)) {
          return;
        }
        const title = answeredTitle(response);
        if (title) {
          push({ ...titleLevelOf(title, preview), id });
        } else {
          remove(id);
        }
      } finally {
        opening.current = false;
      }
    },
    [levelExists, push, remove, take],
  );

  const openTitle = useCallback(
    (addon: string, preview: OpenablePreview) =>
      openWith(
        {
          type: "open_title",
          addon,
          title: { type: preview.type, id: preview.id },
        },
        preview,
      ),
    [openWith],
  );

  const openDiscoveredTitle = useCallback(
    async (preview: OpenablePreview) => {
      const key = discoveredKeyOf(preview.id);
      if (!key) {
        return;
      }
      await openWith(
        { type: "open_discovered_title", key, kind: preview.type },
        preview,
      );
    },
    [openWith],
  );

  return { openTitle, openDiscoveredTitle };
}

/** The pushed level a Title is drawn on. */
export function titleLevelOf(
  title: Title,
  preview?: OpenablePreview | null,
): NewShellLevel {
  return {
    name: "Title",
    kind: "overlay",
    render: () => <TitleScreen title={title} preview={preview} />,
  };
}

/**
 * One Title, as the Host answered it, over the screen that opened it.
 *
 * With a TMDB Credential held every field here is TMDB's; without one, or where
 * no record met the Title, the Addon's answer stands and the amber Unmapped mark
 * says so. Which season is folded out and which Video was chosen are this
 * client's own, like the Title itself (ADR-0005). Pressing a Video asks the Host
 * for its Streams and pushes the list as another level, leaving this one — and
 * its focus — exactly where it was.
 */
export function TitleScreen({
  title,
  preview,
}: {
  title: Title;
  preview?: OpenablePreview | null;
}) {
  const { pop, push } = useShell();
  const seasons = seasonsOf(title);
  const [shownSeason, setShownSeason] = useState<number | null>(
    seasons[0]?.season ?? null,
  );
  const [selected, setSelected] = useState<Video | null>(null);

  const name = nameOf(title, preview);
  const release = releaseOf(title, preview);
  const art = titleArtOf(title, preview);
  const hasFacts = Boolean(
    title.imdbRating || release || title.runtime || title.genres.length > 0,
  );
  const shown = seasons.find((season) => season.season === shownSeason) ?? seasons[0];

  /**
   * Put the Streams level over this screen at once. The level asks the Host
   * itself and draws its own waiting state, so a slow Addon is visible as a
   * list being looked for rather than as a button that seems not to have been
   * pressed. The Video is remembered before the push so a Back finds its row
   * still chosen.
   */
  const play = useCallback(
    (video: Video) => {
      setSelected(video);
      push({
        name: "Streams",
        kind: "overlay",
        render: () => (
          <StreamsLoader title={title} preview={preview} video={video} />
        ),
      });
    },
    [preview, push, title],
  );

  return (
    <div className="shell-title-level" data-testid="title-level">
      <article
        className="shell-title"
        data-testid={`title-${title.id}`}
        data-region="title"
        data-kind="branch"
        data-label={name}
        aria-label={name}
      >
        <header
          className="shell-title-hero"
          data-testid="title-hero"
          data-art={art.kind}
        >
          {art.src ? (
            <img
              className="shell-title-art"
              data-testid="title-poster"
              src={art.src}
              alt=""
            />
          ) : null}
          <span className="shell-title-scrim" aria-hidden="true" />

          <div className="shell-title-copy">
            <div className="shell-title-head">
              <Button variant="ghost" autoFocus onClick={pop}>
                Back
              </Button>
            </div>

            {title.logo ? (
              <img
                className="shell-title-logo"
                data-testid="title-logo"
                src={title.logo}
                alt={name}
              />
            ) : (
              <h1 className="shell-title-name" data-testid="title-name">
                {name}
              </h1>
            )}

            {hasFacts ? (
              <div
                className="shell-title-facts"
                data-testid="title-facts"
                aria-label="Facts"
              >
                {title.imdbRating ? (
                  <Chip tone="accent">{`★ ${title.imdbRating}`}</Chip>
                ) : null}
                {release ? <Chip>{release}</Chip> : null}
                {title.runtime ? <Chip>{title.runtime}</Chip> : null}
                {title.genres.map((genre) => (
                  <Chip key={genre}>{genre}</Chip>
                ))}
              </div>
            ) : null}

            {title.addon || title.key.kind === "addon" ? (
              <div className="shell-title-attribution">
                {title.addon ? (
                  <span data-testid="title-addon">
                    <Chip tone="accent">{title.addon}</Chip>
                  </span>
                ) : null}
                {title.key.kind === "addon" ? (
                  <span data-testid="title-unmapped">
                    <Chip tone="warn">
                      Unmapped — no TMDB record met this Title, so it is keyed by
                      its Addon.
                    </Chip>
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        </header>

        <div className="shell-title-body">
          {title.description ? (
            <p className="shell-title-description">{title.description}</p>
          ) : null}

          {seasons.length === 0 ? (
            <>
              <p className="shell-title-note" data-testid="title-no-videos">
                {isSeries(title)
                  ? "This series' Addon listed no episodes."
                  : "This Title is one Video: the film itself."}
              </p>
              {isSeries(title) ? null : (
                <Button
                  variant="primary"
                  data-testid="play-film"
                  onClick={() => void play(theFilm(title))}
                >
                  Play
                </Button>
              )}
            </>
          ) : (
            <>
              <div
                className="shell-title-seasons"
                data-testid="title-seasons"
                data-region="title-seasons"
                data-kind="row"
                data-label="Seasons"
              >
                {seasons.map(({ season }) => (
                  <ChoiceChip
                    key={season ?? "unnumbered"}
                    data-testid={`season-${season ?? "unnumbered"}`}
                    pressed={shown?.season === season}
                    onClick={() => setShownSeason(season)}
                  >
                    {seasonName(season)}
                  </ChoiceChip>
                ))}
              </div>

              <div
                className="shell-title-episodes"
                data-testid="title-episodes"
                data-region="title-episodes"
                data-kind="row"
                data-label="Episodes"
              >
                {shown?.videos.map((video) => (
                  <EpisodeRow
                    key={video.id}
                    video={video}
                    selected={selected?.id === video.id}
                    onPlay={(video) => void play(video)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </article>
    </div>
  );
}

/**
 * The Title level while the Host is still answering `open_title`: the card the
 * person pressed, at the size the real Title will take, so the press has an
 * immediate result. Back works here like it does on the Title itself.
 */
function TitleLoading({ preview }: { preview: OpenablePreview }) {
  const { pop } = useShell();
  const art = preview.background ?? preview.poster ?? null;

  return (
    <div className="shell-title-level">
      <section
        className="shell-title shell-title-loading"
        data-testid="title-loading"
        data-region="title"
        data-kind="branch"
        data-label={`Opening ${preview.name}`}
        aria-label={`Opening ${preview.name}`}
      >
        <header
          className="shell-title-hero"
          data-art={preview.background ? "background" : preview.poster ? "poster" : "none"}
        >
          {art ? <img className="shell-title-art" src={art} alt="" /> : null}
          <span className="shell-title-scrim" aria-hidden="true" />
          <div className="shell-title-copy">
            <div className="shell-title-head">
              <Button variant="ghost" autoFocus onClick={pop}>
                Back
              </Button>
            </div>
            <h1 className="shell-title-name">{preview.name}</h1>
            <p className="shell-title-note" data-testid="title-loading-note">
              Looking for this Title…
            </p>
          </div>
        </header>
      </section>
    </div>
  );
}

/** One 16:9 episode row: the still where there is one, and `S#E# · name`. */
function EpisodeRow({
  video,
  selected,
  onPlay,
}: {
  video: Video;
  selected: boolean;
  onPlay: (video: Video) => void;
}) {
  const label = labelOf(video);
  const name = video.name ?? video.id;

  return (
    <button
      type="button"
      className="shell-episode kit-focus-lift"
      data-focusable
      data-testid={`episode-${video.id}`}
      aria-pressed={selected}
      onClick={() => onPlay(video)}
    >
      {video.thumbnail ? (
        <span className="shell-episode-still" data-aspect="16:9">
          <img data-testid="episode-still" src={video.thumbnail} alt="" loading="lazy" />
        </span>
      ) : null}
      <span className="shell-episode-name">
        {label ? `${label} · ${name}` : name}
      </span>
    </button>
  );
}
