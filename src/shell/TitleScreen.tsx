import { useCallback, useState } from "react";

import {
  answeredStreams,
  answeredTitle,
  explain,
  type AddonStreams,
  type Stream,
  type Title,
  type Video,
} from "../host-client";
import {
  backdropOf,
  discoveredKeyOf,
  isSeries,
  labelOf,
  nameOf,
  releaseOf,
  seasonName,
  seasonsOf,
  titleStubOf,
  type OpenablePreview,
} from "../title";
import {
  badgeLines,
  playabilityNote,
  theFilm,
  unplayableNote,
  warningNote,
} from "../stream";
import { useShell, type NewShellLevel } from "./context";
import { Button, Chip, ChoiceChip } from "./kit";
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
  const { take, push } = useShell();

  const openTitle = useCallback(
    async (addon: string, preview: OpenablePreview) => {
      const response = await take({
        type: "open_title",
        addon,
        title: { type: preview.type, id: preview.id },
      });
      const title = answeredTitle(response);
      if (title) {
        push(titleLevelOf(title, preview));
      }
    },
    [push, take],
  );

  const openDiscoveredTitle = useCallback(
    async (preview: OpenablePreview) => {
      const key = discoveredKeyOf(preview.id);
      if (!key) {
        return;
      }
      const response = await take({
        type: "open_discovered_title",
        key,
        kind: preview.type,
      });
      const title = answeredTitle(response);
      if (title) {
        push(titleLevelOf(title, preview));
      }
    },
    [push, take],
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
  const { pop, push, take } = useShell();
  const seasons = seasonsOf(title);
  const [shownSeason, setShownSeason] = useState<number | null>(
    seasons[0]?.season ?? null,
  );
  const [selected, setSelected] = useState<Video | null>(null);

  const name = nameOf(title, preview);
  const release = releaseOf(title, preview);
  const art = backdropOf(title, preview);
  const artKind =
    title.background || preview?.background
      ? "background"
      : art
        ? "poster"
        : "none";
  const hasFacts = Boolean(
    title.imdbRating || release || title.runtime || title.genres.length > 0,
  );
  const shown = seasons.find((season) => season.season === shownSeason) ?? seasons[0];

  /**
   * Ask for a Video's Streams and put the list over this screen. The Video is
   * remembered before the ask so a Back from the list finds its row still
   * chosen, and the ask's refusal leaves the Title where it was.
   */
  const play = useCallback(
    async (video: Video) => {
      setSelected(video);
      const response = await take({
        type: "find_streams",
        video: { type: title.type, id: video.id },
      });
      if (!response) {
        return;
      }
      push({
        name: "Streams",
        kind: "overlay",
        render: () => (
          <StreamsScreen
            title={title}
            preview={preview}
            video={video}
            groups={answeredStreams(response)}
          />
        ),
      });
    },
    [preview, push, take, title],
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
          data-art={artKind}
        >
          {art ? (
            <img
              className="shell-title-art"
              data-testid="title-poster"
              src={art}
              alt=""
            />
          ) : null}
          <span className="shell-title-scrim" aria-hidden="true" />

          <div className="shell-title-copy">
            <div className="shell-title-head">
              <Button variant="ghost" onClick={pop}>
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
      className="shell-episode"
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

/**
 * The Streams a Video can be played as, pushed as a level over its Title.
 *
 * One block per Addon that answered, in the Host's order; an Addon that failed
 * or answered nothing says so in its own block without blanking the others. A
 * candidate is listed whether or not this Host can play it. Pressing one it can
 * play sends the whole candidate back with the Title card; pressing one it
 * cannot marks it here and asks the Host nothing.
 */
export function StreamsScreen({
  title,
  preview,
  video,
  groups,
}: {
  title: Title;
  preview?: OpenablePreview | null;
  video: Video;
  groups: AddonStreams[];
}) {
  const { pop, take } = useShell();
  const [chosen, setChosen] = useState<Stream | null>(null);
  const subject = video.id === title.id ? nameOf(title, preview) : subjectOf(video);

  const choose = useCallback(
    async (addon: string, stream: Stream) => {
      if (playabilityNote(stream.playback) !== null) {
        setChosen(stream);
        return;
      }

      setChosen(null);
      await take({
        type: "play_stream",
        video: { type: title.type, id: video.id },
        addon,
        stream,
        title: titleStubOf(title, preview),
      });
    },
    [preview, take, title, video.id],
  );

  return (
    <section
      className="shell-streams"
      data-testid="streams"
      data-region="streams"
      data-kind="branch"
      data-label={`Streams — ${subject}`}
      aria-label={`Streams — ${subject}`}
    >
      <header className="shell-streams-head">
        <Button variant="ghost" onClick={pop}>
          Back
        </Button>
        <h1 className="shell-streams-title" data-testid="streams-heading">
          {`Streams — ${subject}`}
        </h1>
      </header>

      {groups.length === 0 ? (
        <p className="shell-streams-note" data-testid="streams-none">
          No configured Addon offers Streams for this Video.
        </p>
      ) : null}

      {groups.map((group) => (
        <section
          className="shell-stream-group"
          key={group.addon}
          data-testid={`streams-${group.addon}`}
          data-region={`streams:${group.addon}`}
          data-kind="row"
          data-label={group.addon}
        >
          <h2 className="shell-stream-addon">{group.addon}</h2>

          {group.failure ? (
            <p role="alert" className="shell-stream-failure">
              {explain(group.failure)}
            </p>
          ) : null}
          {!group.failure && group.streams.length === 0 ? (
            <p className="shell-streams-note">
              This Addon answered nothing this Host can play.
            </p>
          ) : null}

          <ul className="shell-stream-list">
            {group.streams.map((stream, index) => (
              <li key={index}>
                <Candidate
                  addon={group.addon}
                  index={index}
                  stream={stream}
                  chosen={chosen === stream}
                  onChoose={(stream) => void choose(group.addon, stream)}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}

      {chosen ? (
        <p role="status" className="shell-streams-chosen" data-testid="chosen-stream">
          {unplayableNote(chosen)}
        </p>
      ) : null}
    </section>
  );
}

/** What the Streams are Streams *of*: the episode by its number and name. */
function subjectOf(video: Video): string {
  const label = labelOf(video) ?? video.id;
  return [label, video.name].filter((part): part is string => Boolean(part)).join(" — ");
}

/**
 * One candidate: the Addon's own badge lines, the filename, its description,
 * the hints it carries, and why this Host cannot open it where that is so.
 */
function Candidate({
  addon,
  index,
  stream,
  chosen,
  onChoose,
}: {
  addon: string;
  index: number;
  stream: Stream;
  chosen: boolean;
  onChoose: (stream: Stream) => void;
}) {
  const badges = badgeLines(stream);
  const note = playabilityNote(stream.playback);

  return (
    <button
      type="button"
      className="shell-candidate"
      data-focusable
      data-testid={`candidate-${addon}-${index}`}
      aria-pressed={chosen}
      onClick={() => onChoose(stream)}
    >
      {badges.length > 0 ? (
        <span className="shell-candidate-badges">
          {badges.map((badge, at) => (
            <Chip key={at} tone="accent">
              {badge}
            </Chip>
          ))}
        </span>
      ) : null}

      {stream.filename ? (
        <span className="shell-candidate-file" data-testid="stream-filename">
          {stream.filename}
        </span>
      ) : null}

      {stream.description ? (
        <span className="shell-candidate-description">{stream.description}</span>
      ) : null}

      {stream.warnings.length > 0 || note ? (
        <span className="shell-candidate-notes">
          {stream.warnings.map((warning) => (
            <Chip key={warning} tone="warn">
              {warningNote(warning)}
            </Chip>
          ))}
          {note ? <Chip tone="danger">{note}</Chip> : null}
        </span>
      ) : null}
    </button>
  );
}
