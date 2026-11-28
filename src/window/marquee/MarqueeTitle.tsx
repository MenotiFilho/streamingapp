import { useCallback, useRef, useState } from "react";

import { actionKey } from "../../core/actionKey";
import { answeredTitle } from "../../core/answers";
import { addonLabel } from "../../core/home";
import {
  episodeAirNote,
  episodeProgress,
  titleActionsModel,
  titleBackdropCandidates,
  titleInitialFocusTarget,
} from "../../core/marqueeTitle";
import { useRevisedTitle } from "../../core/react/useRevisedTitle";
import {
  discoveredKeyOf,
  labelOf,
  nameOf,
  releaseOf,
  seasonName,
  type OpenablePreview,
} from "../../core/title";
import { titleMainPress, titlePlayOutcome, unmappedOf } from "../../core/titlePage";
import type { Action, Title, Video } from "../../core/wire";
import { Button } from "../../kit/marquee/Button";
import { useArtChain } from "../../kit/marquee/cards";
import { Chip } from "../../kit/marquee/Chip";
import { EpisodeCard } from "../../kit/marquee/EpisodeCard";
import { EpisodeCaption } from "../../kit/marquee/EpisodeCaption";
import { IconButton } from "../../kit/marquee/IconButton";
import { MetaLine } from "../../kit/marquee/MetaLine";
import { useShell, type NewShellLevel } from "../context";
import { MarqueeStreamsLoader } from "./MarqueeStreams";
import "./title-streams.css";

/**
 * Marquee Title screen (`05.jpg`, `docs/design-system.md` §8–§9, #360):
 * - Full-bleed backdrop under left and bottom scrims, with Title logo or name,
 *   MetaLine, and synopsis.
 * - Primary Play / Resume (when Continue watching has an entry) plus
 *   **Choose stream** for both movies and series.
 * - Season selector Chips and horizontal EpisodeCard + EpisodeCaption rail
 *   displaying each episode's `Video.description`.
 */
export function MarqueeTitleScreen({
  title: answered,
  preview,
}: {
  title: Title;
  preview?: OpenablePreview | null;
}) {
  const { snapshot, pop, push, session, take, pending } = useShell();
  const title = useRevisedTitle(answered, session);

  const continueWatching = snapshot?.continueWatching ?? [];
  const watchProgress = snapshot?.watchProgress ?? [];
  const upNextPlayback = snapshot?.preferences.upNextPlayback ?? "direct";
  const name = nameOf(title, preview);
  const suppliedBy = title.addon ? addonLabel(snapshot, title.addon) : null;

  const backdropChain = titleBackdropCandidates(title, preview);
  const [backdropSrc, failBackdrop] = useArtChain(backdropChain);
  const [logoSrc, failLogo] = useArtChain([title.logo]);

  const initialModel = titleActionsModel({
    title,
    continueWatching,
    upNextPlayback,
  });
  const seasons = initialModel.side.kind === "series" ? initialModel.side.seasons : [];
  const [shownSeason, setShownSeason] = useState<number | null>(initialModel.anchor.season);
  const [selected, setSelected] = useState<Video | null>(initialModel.anchor.video);

  const shown = seasons.find((season) => season.season === shownSeason) ?? seasons[0];
  const selectedInShown =
    selected && shown?.videos.some((video) => video.id === selected.id)
      ? selected
      : (shown?.videos[0] ?? null);

  const model = titleActionsModel({
    title,
    continueWatching,
    upNextPlayback,
    selectedVideo: selectedInShown,
  });
  const { main, chooseStream, anchor, side } = model;
  const press = titleMainPress(main);
  const waiting =
    press !== null && press.kind !== "picker" && pending.has(actionKey(press.action));

  const anchorVideoId = anchor.video?.id ?? null;
  const anchoredVideo =
    anchorVideoId === null
      ? null
      : (seasons.flatMap((season) => season.videos).find((video) => video.id === anchorVideoId) ??
        null);

  const initialFocus = titleInitialFocusTarget({
    main,
    hasChooseStream: chooseStream !== null,
    anchoredVideo,
  });

  const openStreams = useCallback(
    (video: Video) => {
      setSelected(video);
      push({
        name: "Streams",
        kind: "overlay",
        payload: {
          render: () => (
            <MarqueeStreamsLoader title={title} preview={preview} video={video} />
          ),
        },
      });
    },
    [preview, push, title],
  );

  const takeMain = async () => {
    if (press === null) {
      return;
    }
    if (press.kind === "resume") {
      await take(press.action);
      return;
    }
    if (press.kind === "picker") {
      openStreams(press.video);
      return;
    }
    const { error } = await session.ask(press.action);
    const outcome = titlePlayOutcome(error);
    if (outcome === "picker") {
      openStreams(press.video);
      return;
    }
    if (outcome === "report") {
      session.report(error);
    }
  };

  const today = new Date();

  return (
    <article
      className="mq-title-screen"
      data-testid={`title-${title.id}`}
      data-region="title"
      data-kind="branch"
      data-label={name}
      aria-label={name}
    >
      <div className="mq-title-backdrop" aria-hidden="true">
        {backdropSrc ? (
          <img
            className="mq-title-backdrop-img"
            src={backdropSrc}
            alt=""
            draggable={false}
            onError={() => failBackdrop(backdropSrc)}
          />
        ) : null}
        <span className="mq-title-scrim mq-title-scrim--left" />
        <span className="mq-title-scrim mq-title-scrim--bottom" />
      </div>

      <div className="mq-title-content">
        <header className="mq-title-top">
          <IconButton
            icon="arrow-left"
            label="Back"
            kind="glass"
            size="sm"
            autoFocus={initialFocus === "back"}
            onClick={pop}
          />
        </header>

        <h1 className="mq-title-heading">
          {logoSrc ? (
            <img
              className="mq-title-logo"
              data-testid="title-logo"
              src={logoSrc}
              alt={name}
              draggable={false}
              onError={() => failLogo(logoSrc)}
            />
          ) : (
            <span className="mq-title-name" data-testid="title-name">
              {name}
            </span>
          )}
        </h1>

        <MetaLine
          className="mq-title-meta"
          rating={title.imdbRating}
          year={releaseOf(title, preview)}
          runtime={title.runtime}
          genres={title.genres}
        />

        {title.description ? (
          <p className="mq-title-synopsis">{title.description}</p>
        ) : null}

        {suppliedBy || unmappedOf(title) ? (
          <div className="mq-title-attribution">
            {suppliedBy ? <span>{`Supplied by ${suppliedBy}`}</span> : null}
            {unmappedOf(title) ? (
              <span className="mq-title-unmapped" data-testid="title-unmapped">
                Unmapped — no TMDB record met this Title, so it is keyed by its Addon.
              </span>
            ) : null}
          </div>
        ) : null}

        {main || chooseStream ? (
          <div
            className="mq-title-actions"
            data-region="title-actions"
            data-kind="row"
            data-label="Title actions"
          >
            {main ? (
              <Button
                kind="primary"
                size="lg"
                icon="play"
                data-testid="title-main"
                autoFocus={initialFocus === "main"}
                aria-busy={waiting || undefined}
                disabled={waiting}
                onClick={() => void takeMain()}
              >
                {waiting ? `${main.label}…` : main.label}
              </Button>
            ) : null}

            {chooseStream ? (
              <Button
                kind={chooseStream.primary ? "primary" : "secondary"}
                size="lg"
                icon="list-video"
                data-testid="title-choose-stream"
                autoFocus={initialFocus === "choose-stream"}
                onClick={() => openStreams(chooseStream.video)}
              >
                Choose stream
              </Button>
            ) : null}
          </div>
        ) : null}

        {side.kind === "series" ? (
          <section className="mq-title-series" aria-label="Seasons and episodes">
            <div
              className="mq-title-seasons"
              data-testid="title-seasons"
              data-region="title-seasons"
              data-kind="row"
              data-label="Seasons"
              data-reveal-axis="x"
            >
              {seasons.map(({ season }) => (
                <Chip
                  key={season ?? "unnumbered"}
                  data-testid={`season-${season ?? "unnumbered"}`}
                  selected={shown?.season === season}
                  onClick={() => setShownSeason(season)}
                >
                  {seasonName(season)}
                </Chip>
              ))}
            </div>

            <div
              className="mq-title-episodes"
              data-testid="title-episodes"
              data-region="title-episodes"
              data-kind="row"
              data-label="Episodes"
              data-reveal-axis="x"
            >
              {shown?.videos.map((video) => {
                const code = labelOf(video);
                const note = episodeAirNote(video, today);
                const { watched, progress } = episodeProgress(video.id, watchProgress);
                return (
                  <div key={video.id} className="mq-title-episode-item">
                    <EpisodeCard
                      name={video.name ?? video.id}
                      code={code}
                      still={video.thumbnail}
                      watched={watched}
                      progress={progress}
                      data-testid={`episode-${video.id}`}
                      autoFocus={
                        initialFocus === "episode" && anchoredVideo?.id === video.id
                      }
                      onClick={() => openStreams(video)}
                    />
                    <EpisodeCaption
                      episode={video.episode}
                      title={video.name ?? video.id}
                      note={note}
                      description={video.description}
                    />
                  </div>
                );
              })}
            </div>
          </section>
        ) : side.kind === "series-empty" ? (
          <div className="mq-title-empty-series">
            <p className="mq-title-empty-kicker">{side.kicker}</p>
            <p className="mq-title-empty-note" data-testid="title-no-videos">
              {side.note}
            </p>
          </div>
        ) : null}
      </div>
    </article>
  );
}

/** The Marquee Title surface while the Host is still answering. */
export function MarqueeTitleLoading({ preview }: { preview: OpenablePreview }) {
  const { pop } = useShell();
  const [art, failArt] = useArtChain([preview.background ?? null, preview.poster]);

  return (
    <section
      className="mq-title-screen"
      data-testid="title-loading"
      data-region="title"
      data-kind="branch"
      data-label={`Opening ${preview.name}`}
      aria-label={`Opening ${preview.name}`}
    >
      <div className="mq-title-backdrop" aria-hidden="true">
        {art ? (
          <img
            className="mq-title-backdrop-img"
            src={art}
            alt=""
            draggable={false}
            onError={() => failArt(art)}
          />
        ) : null}
        <span className="mq-title-scrim mq-title-scrim--left" />
        <span className="mq-title-scrim mq-title-scrim--bottom" />
      </div>

      <div className="mq-title-content">
        <header className="mq-title-top">
          <IconButton
            icon="arrow-left"
            label="Back"
            kind="glass"
            size="sm"
            autoFocus
            onClick={pop}
          />
        </header>
        <h1 className="mq-title-heading">
          <span className="mq-title-name">{preview.name}</span>
        </h1>
        <p className="mq-title-loading-note" data-testid="title-loading-note">
          Looking for this Title…
        </p>
      </div>
    </section>
  );
}

/** The pushed Level a Marquee Title is drawn on. */
export function marqueeTitleLevelOf(
  title: Title,
  preview?: OpenablePreview | null,
): NewShellLevel {
  return {
    name: "Title",
    kind: "overlay",
    payload: {
      title: { type: title.type, id: title.id, key: title.key },
      render: () => <MarqueeTitleScreen title={title} preview={preview} />,
    },
  };
}

/**
 * Open a Title in Marquee from a card or Hero Details (`open_title` or
 * `open_discovered_title`), keeping the exact Repertory opener contract.
 */
export function useMarqueeTitleOpener() {
  const { take, push, remove, levelExists } = useShell();
  const opening = useRef(false);

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
        payload: {
          render: () => <MarqueeTitleLoading preview={preview} />,
          onBack: () => {
            cancelled = true;
            opening.current = false;
            return false;
          },
        },
      });
      try {
        const response = await take(action);
        if (cancelled || !levelExists(id)) {
          return;
        }
        const title = answeredTitle(response);
        if (title) {
          push({ ...marqueeTitleLevelOf(title, preview), id });
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
