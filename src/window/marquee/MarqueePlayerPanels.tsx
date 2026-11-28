import { useCallback, useEffect, useRef, useState } from "react";
import { useIsPresent } from "motion/react";

import { answeredStreams, answeredTitle } from "../../core/answers";
import { AUTOPLAY_SWITCH_LABEL, autoplayOn } from "../../core/controls";
import { episodesOf, seriesAction, seriesRef } from "../../core/episodes";
import { explain, type ActionError } from "../../core/errors";
import { addonLabel } from "../../core/home";
import { isPlayingStream, mergeRetriedAddonGroup, streamRowView } from "../../core/marqueeStreams";
import { marqueeEpisodeCode, streamTitle } from "../../core/osd";
import {
  marqueeAudioOptions,
  marqueeChaptersPanel,
  marqueeDetailsPanel,
  marqueeEpisodeRow,
  marqueePicturePanel,
  marqueeSpeedOptions,
  marqueeSubtitleOptions,
} from "../../core/playerPanels";
import { playabilityNote, playStreamAction, streamsSubject, unplayableNote } from "../../core/stream";
import { groupAnswerNote } from "../../core/streamsList";
import { seasonName } from "../../core/title";
import type { Action, AddonStreams, PlaybackSnapshot, Stream, Title, Video } from "../../core/wire";
import { AddonNotice } from "../../kit/AddonNotice";
import { Badge } from "../../kit/Badge";
import { Button } from "../../kit/Button";
import { Chip } from "../../kit/Chip";
import { GroupLabel } from "../../kit/GroupLabel";
import { Panel, PanelColumn } from "../../kit/Panel";
import { SizeStepper } from "../../kit/SizeStepper";
import { StatList, StatRow } from "../../kit/StatRow";
import { StreamRow } from "../../kit/StreamRow";
import { Switch } from "../../kit/Switch";
import { SyncControl } from "../../kit/SyncControl";
import { TrackOption } from "../../kit/TrackOption";
import { useShell, type NewShellLevel } from "../context";
import { EPISODES_EMPTY, EPISODES_LOOKING, playingVideoId } from "../episodesMenu";
import "./player.css";

/** The 7 player menus in Marquee (`08.jpg`–`08f.jpg`, `12.jpg`). */
export type MarqueePanelName =
  | "picture"
  | "audio-subtitles"
  | "streams"
  | "episodes"
  | "speed"
  | "chapters"
  | "details";

export type MarqueePanelOptions = {
  /** When opening Streams from Episodes, target that Video via `play_stream`. */
  episodeTarget?: { title: Title; video: Video };
};

export function marqueePanelId(name: MarqueePanelName): string {
  return `popover-${name}`;
}

const LABELS: Record<MarqueePanelName, string> = {
  picture: "Picture",
  "audio-subtitles": "Audio & Subtitles",
  streams: "Streams",
  episodes: "Episodes",
  speed: "Speed",
  chapters: "Chapters",
  details: "Details",
};

/**
 * Pushable popover level for one of the 7 Marquee player menus.
 */
export function marqueePanelLevel(
  name: MarqueePanelName,
  options: MarqueePanelOptions = {},
): NewShellLevel {
  return {
    id: marqueePanelId(name),
    name: `${LABELS[name]} menu`,
    kind: "popover",
    payload: {
      render: () => <MarqueePlayerPanel name={name} options={options} />,
    },
  };
}

function MarqueePlayerPanel({
  name,
  options,
}: {
  name: MarqueePanelName;
  options: MarqueePanelOptions;
}) {
  const { snapshot, take, pop, levelExists } = useShell();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const playback = snapshot?.playback ?? null;
  const subtitleScale = snapshot?.preferences.subtitleScale ?? 1;
  const id = marqueePanelId(name);

  const present = useIsPresent();
  useEffect(() => {
    if (!present) {
      return;
    }
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      const current = panelRef.current;
      if (!current || !levelExists(id)) {
        return;
      }
      if (target instanceof Node && !current.contains(target)) {
        pop();
      }
    };
    const onBlur = () => {
      if (levelExists(id)) {
        pop();
      }
    };

    document.addEventListener("focusin", onFocusIn, true);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("focusin", onFocusIn, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [id, levelExists, pop, present]);

  if (!playback) {
    return null;
  }

  const isSide = name === "streams";

  return (
    <div className="mq-player-panel-layer">
      <div
        className="mq-player-panel-scrim"
        data-testid="popover-scrim"
        data-dim={isSide ? "true" : undefined}
        aria-hidden="true"
        onClick={pop}
      />
      <div
        ref={panelRef}
        className={isSide ? "mq-player-side-wrap" : "mq-player-floating-wrap"}
        data-testid={id}
      >
        {name === "audio-subtitles" ? (
          <AudioSubtitlesPanel playback={playback} subtitleScale={subtitleScale} take={take} />
        ) : name === "picture" ? (
          <PicturePanel playback={playback} take={take} />
        ) : name === "speed" ? (
          <SpeedPanel playback={playback} take={take} />
        ) : name === "chapters" ? (
          <ChaptersPanel playback={playback} take={take} />
        ) : name === "episodes" ? (
          <EpisodesPanel playback={playback} />
        ) : name === "streams" ? (
          <StreamsPanel levelId={id} playback={playback} episodeTarget={options.episodeTarget} />
        ) : (
          <DetailsPanel playback={playback} />
        )}
      </div>
    </div>
  );
}

type PanelTake = (action: Action) => Promise<unknown>;

function AudioSubtitlesPanel({
  playback,
  subtitleScale,
  take,
}: {
  playback: PlaybackSnapshot;
  subtitleScale: number;
  take: PanelTake;
}) {
  const subs = marqueeSubtitleOptions(playback);
  const audio = marqueeAudioOptions(playback);

  return (
    <Panel placement="floating" split aria-label="Audio & Subtitles">
      <PanelColumn title="Subtitles">
        <div
          className="mq-panel-col-region"
          data-region="panel-subtitles"
          data-kind="branch"
          data-label="Subtitles"
        >
          {subs.options.map((option) => (
            <TrackOption
              key={option.key}
              title={option.title}
              detail={option.detail}
              selected={option.selected}
              onSelect={() => void take(option.action)}
            />
          ))}
          {subs.emptyNote ? <p className="mq-panel-note">{subs.emptyNote}</p> : null}
        </div>
      </PanelColumn>

      <PanelColumn title="Audio">
        <div
          className="mq-panel-col-region"
          data-region="panel-audio-col"
          data-kind="branch"
          data-label="Audio"
        >
          <div
            className="mq-panel-list-region"
            data-region="panel-audio"
            data-kind="branch"
            data-label="Audio tracks"
          >
            {audio.options.map((option) => (
              <TrackOption
                key={option.key}
                title={option.title}
                detail={option.detail}
                selected={option.selected}
                onSelect={() => void take(option.action)}
              />
            ))}
            {audio.emptyNote ? <p className="mq-panel-note">{audio.emptyNote}</p> : null}
          </div>

          <p className="mq-panel-subhead">Sync</p>
          <div
            className="mq-panel-control-row"
            data-region="panel-sync"
            data-kind="row"
            data-label="Subtitle sync"
          >
            <SyncControl
              seconds={playback.subtitleDelay ?? 0}
              onChange={(seconds) => void take({ type: "set_subtitle_delay", seconds })}
            />
          </div>

          <p className="mq-panel-subhead">Size</p>
          <div
            className="mq-panel-control-row"
            data-region="panel-size"
            data-kind="row"
            data-label="Subtitle size"
          >
            <SizeStepper
              scale={subtitleScale}
              onChange={(scale) => void take({ type: "set_subtitle_scale", scale })}
            />
          </div>
        </div>
      </PanelColumn>
    </Panel>
  );
}

function PicturePanel({
  playback,
  take,
}: {
  playback: PlaybackSnapshot;
  take: PanelTake;
}) {
  const { aspect, crop, autocropLabel, autocropNote } = marqueePicturePanel(playback);

  return (
    <Panel placement="floating" split aria-label="Picture">
      <PanelColumn title="Aspect">
        <div
          className="mq-panel-col-region"
          data-region="panel-aspect"
          data-kind="branch"
          data-label="Aspect"
        >
          {aspect.map((option) => (
            <TrackOption
              key={option.key}
              title={option.title}
              detail={option.detail}
              selected={option.selected}
              onSelect={() => void take(option.action)}
            />
          ))}
        </div>
      </PanelColumn>

      <PanelColumn title="Crop">
        <div
          className="mq-panel-col-region"
          data-region="panel-crop"
          data-kind="branch"
          data-label="Crop"
        >
          {crop.map((option) => (
            <TrackOption
              key={option.key}
              title={option.title}
              detail={option.detail}
              selected={option.selected}
              onSelect={() => void take(option.action)}
            />
          ))}
          <div className="mq-panel-autocrop">
            <Button
              kind="secondary"
              size="md"
              icon="maximize"
              data-testid="autocrop"
              onClick={() => void take({ type: "autocrop" })}
            >
              {autocropLabel}
            </Button>
            <p className="mq-panel-caption" data-testid="osd-crop-readout">
              {autocropNote}
            </p>
          </div>
        </div>
      </PanelColumn>
    </Panel>
  );
}

function SpeedPanel({
  playback,
  take,
}: {
  playback: PlaybackSnapshot;
  take: PanelTake;
}) {
  const options = marqueeSpeedOptions(playback);

  return (
    <Panel placement="floating" size="compact" aria-label="Speed">
      <PanelColumn title="Playback speed">
        <div
          className="mq-panel-col-region"
          data-region="panel-speed"
          data-kind="branch"
          data-label="Playback speed"
        >
          {options.map((option) => (
            <TrackOption
              key={option.key}
              title={option.title}
              selected={option.selected}
              onSelect={() => void take(option.action)}
            />
          ))}
        </div>
      </PanelColumn>
    </Panel>
  );
}

function ChaptersPanel({
  playback,
  take,
}: {
  playback: PlaybackSnapshot;
  take: PanelTake;
}) {
  const { previousDisabled, nextDisabled, chapters, emptyNote } = marqueeChaptersPanel(playback);

  return (
    <Panel placement="floating" aria-label="Chapters">
      <PanelColumn
        title="Chapters"
        actions={
          <div
            className="mq-panel-seasons"
            data-region="panel-chapters-actions"
            data-kind="row"
            data-label="Chapter steps"
          >
            <Button
              kind="secondary"
              size="md"
              icon="skip-back"
              iconWeight="fill"
              aria-label="Previous chapter"
              disabled={previousDisabled}
              onClick={() => void take({ type: "previous_chapter" })}
            >
              Previous
            </Button>
            <Button
              kind="secondary"
              size="md"
              icon="skip-forward"
              iconWeight="fill"
              aria-label="Next chapter"
              disabled={nextDisabled}
              onClick={() => void take({ type: "next_chapter" })}
            >
              Next
            </Button>
          </div>
        }
      >
        {emptyNote ? (
          <p className="mq-panel-note">{emptyNote}</p>
        ) : (
          <div
            className="mq-panel-chapters-grid"
            data-region="panel-chapters-list"
            data-kind="branch"
            data-label="Chapters"
          >
            {chapters.map((chapter) => (
              <TrackOption
                key={chapter.key}
                title={chapter.title}
                detail={chapter.detail}
                selected={chapter.selected}
                onSelect={() => void take(chapter.action)}
              />
            ))}
          </div>
        )}
      </PanelColumn>
    </Panel>
  );
}

type EpisodesLookup =
  | { kind: "waiting" }
  | { kind: "failed"; error: ActionError }
  | { kind: "empty" }
  | { kind: "answered"; title: Title };

function EpisodesPanel({ playback }: { playback: PlaybackSnapshot }) {
  const { snapshot, ask, take, pop, push } = useShell();
  const [lookup, setLookup] = useState<EpisodesLookup>({ kind: "waiting" });
  const [chosen, setChosen] = useState<number | null | undefined>(undefined);

  const nowPlaying = playback.nowPlaying;
  const series = nowPlaying ? seriesRef(snapshot, nowPlaying) : null;
  const cache = series?.cache ?? null;

  useEffect(() => {
    if (!nowPlaying || !series) {
      setLookup({ kind: "empty" });
      return;
    }
    let live = true;
    setLookup({ kind: "waiting" });
    setChosen(undefined);
    void ask(seriesAction(series)).then(({ response, error }) => {
      if (!live) {
        return;
      }
      if (error) {
        setLookup({ kind: "failed", error });
        return;
      }
      const title = answeredTitle(response);
      setLookup(title ? { kind: "answered", title } : { kind: "empty" });
    });
    return () => {
      live = false;
    };
  }, [ask, cache]);

  const openEpisode = (title: Title, video: Video) => {
    pop();
    push(marqueePanelLevel("streams", { episodeTarget: { title, video } }));
  };

  const answeredTitleObj = lookup.kind === "answered" ? lookup.title : null;
  const seasons = answeredTitleObj ? episodesOf(answeredTitleObj) : [];
  const defaultSeason = playback.episode?.season ?? seasons[0]?.season ?? null;
  const shownSeason = chosen === undefined ? defaultSeason : chosen;
  const shown =
    seasons.find((season) => season.season === shownSeason) ?? seasons[0] ?? null;
  const playing = playingVideoId(playback);
  const watchProgress = snapshot?.watchProgress ?? [];

  return (
    <Panel placement="floating" aria-label="Episodes">
      <PanelColumn
        title="Episodes"
        actions={
          seasons.length > 0 && shown ? (
            <div
              className="mq-panel-seasons"
              data-testid="osd-seasons"
              role="group"
              aria-label="Seasons"
              data-region="panel-seasons"
              data-kind="row"
            >
              {seasons.map(({ season }) => (
                <Chip
                  key={season ?? "unnumbered"}
                  selected={shown.season === season}
                  onClick={() => setChosen(season)}
                >
                  {seasonName(season)}
                </Chip>
              ))}
            </div>
          ) : undefined
        }
      >
        <div
          className="mq-panel-col-region mq-panel-col-region--episodes"
          data-region="panel-episodes"
          data-kind="branch"
          data-label="Episodes"
        >
          {lookup.kind === "waiting" ? (
            <p className="mq-panel-note" role="status" data-testid="osd-episodes-note">
              {EPISODES_LOOKING}
            </p>
          ) : lookup.kind === "failed" ? (
            <p className="mq-panel-refusal" role="alert" data-testid="osd-episodes-failure">
              {explain(lookup.error)}
            </p>
          ) : !shown ? (
            <p className="mq-panel-note" role="status" data-testid="osd-episodes-note">
              {EPISODES_EMPTY}
            </p>
          ) : (
            <div
              className="mq-panel-episodes-list"
              data-region="panel-episodes-list"
              data-kind="branch"
              data-label={seasonName(shown.season)}
            >
              {shown.videos.map((video) => {
                const progressEntry =
                  watchProgress.find((entry) => entry.video.id === video.id) ?? null;
                const row = marqueeEpisodeRow(
                  video,
                  playing,
                  progressEntry,
                  playback.position,
                  playback.duration,
                );
                return (
                  <button
                    key={row.id}
                    type="button"
                    className="mq-panel-episode"
                    data-focusable
                    data-testid={`osd-episode-${row.id}`}
                    data-playing={row.playing ? "true" : undefined}
                    aria-current={row.playing ? "true" : undefined}
                    onClick={() => answeredTitleObj && openEpisode(answeredTitleObj, video)}
                  >
                    <span className="mq-panel-episode-still">
                      {row.still ? <img src={row.still} alt="" /> : null}
                      {row.progress !== null && row.progress > 0 ? (
                        <span className="mq-panel-episode-progress" aria-hidden="true">
                          <span style={{ width: `${row.progress * 100}%` }} />
                        </span>
                      ) : null}
                    </span>
                    <span className="mq-panel-episode-copy">
                      <span className="mq-panel-episode-title">{row.title}</span>
                      {row.detail ? (
                        <span className="mq-panel-episode-detail">{row.detail}</span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <div
            className="mq-panel-episodes-autoplay"
            data-region="panel-episodes-autoplay"
            data-kind="row"
            data-label="Autoplay"
          >
            <span className="mq-panel-episodes-autoplay-label">{AUTOPLAY_SWITCH_LABEL}</span>
            <Switch
              checked={autoplayOn(snapshot)}
              label={AUTOPLAY_SWITCH_LABEL}
              data-testid="autoplay-switch"
              onChange={(autoplay) => void take({ type: "set_autoplay", autoplay })}
            />
          </div>
        </div>
      </PanelColumn>
    </Panel>
  );
}

type StreamsLookup =
  | { kind: "waiting" }
  | { kind: "failed"; error: ActionError }
  | { kind: "answered"; groups: AddonStreams[] };

function StreamsPanel({
  levelId,
  playback,
  episodeTarget,
}: {
  levelId: string;
  playback: PlaybackSnapshot;
  episodeTarget?: { title: Title; video: Video };
}) {
  const { snapshot, ask, pop, remove } = useShell();
  const [lookup, setLookup] = useState<StreamsLookup>({ kind: "waiting" });
  const [retryingAddons, setRetryingAddons] = useState<ReadonlySet<string>>(() => new Set());
  const [switching, setSwitching] = useState(false);
  const [refusal, setRefusal] = useState<ActionError | null>(null);
  const [unplayableMessage, setUnplayableMessage] = useState<string | null>(null);
  const switchingRef = useRef(false);
  const mountedRef = useRef(true);

  const nowPlaying = playback.nowPlaying;
  const targetVideo = episodeTarget
    ? { type: episodeTarget.title.type, id: episodeTarget.video.id }
    : nowPlaying?.video ?? null;

  const progress =
    nowPlaying && snapshot
      ? (snapshot.watchProgress.find((entry) => entry.video.id === nowPlaying.video.id) ?? null)
      : null;

  const subtitle = episodeTarget
    ? `${episodeTarget.title.name} · ${streamsSubject(episodeTarget.title, null, episodeTarget.video)}`
    : (() => {
        const titleName = progress?.title.name ?? streamTitle(nowPlaying);
        const ep = playback.episode ? marqueeEpisodeCode(playback.episode) : null;
        return [titleName, ep, "switching keeps your place"].filter(Boolean).join(" · ");
      })();

  const videoType = targetVideo?.type ?? null;
  const videoId = targetVideo?.id ?? null;
  const videoKey = `${videoType ?? ""}:${videoId ?? ""}`;
  const shownVideoRef = useRef(videoKey);
  shownVideoRef.current = videoKey;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!videoType || !videoId) {
      setLookup({ kind: "answered", groups: [] });
      return;
    }
    let live = true;
    setLookup({ kind: "waiting" });
    setRefusal(null);
    void ask({
      type: "find_streams",
      video: { type: videoType, id: videoId },
    }).then(({ response, error }) => {
      if (!live) {
        return;
      }
      if (error) {
        setLookup({ kind: "failed", error });
        return;
      }
      setLookup({ kind: "answered", groups: answeredStreams(response) });
    });
    return () => {
      live = false;
    };
  }, [ask, videoId, videoType]);

  const retryAddon = useCallback(
    async (addonId: string) => {
      if (!videoType || !videoId || retryingAddons.has(addonId)) {
        return;
      }
      setRetryingAddons((current) => new Set(current).add(addonId));
      const askedFor = `${videoType}:${videoId}`;
      try {
        const { response, error } = await ask({
          type: "find_streams",
          video: { type: videoType, id: videoId },
        });
        if (!mountedRef.current || shownVideoRef.current !== askedFor) {
          return;
        }
        setLookup((current) => {
          if (current.kind !== "answered") {
            return current;
          }
          const nextGroups = error
            ? current.groups.map((group) =>
                group.addon === addonId
                  ? { addon: addonId, streams: [], failure: error }
                  : group,
              )
            : mergeRetriedAddonGroup(current.groups, addonId, answeredStreams(response));
          return { kind: "answered", groups: nextGroups };
        });
      } finally {
        if (mountedRef.current) {
          setRetryingAddons((current) => {
            const next = new Set(current);
            next.delete(addonId);
            return next;
          });
        }
      }
    },
    [ask, retryingAddons, videoId, videoType],
  );

  const choose = async (addon: string, stream: Stream) => {
    if (playabilityNote(stream.playback) !== null) {
      setUnplayableMessage(unplayableNote(stream));
      return;
    }
    if (switchingRef.current) {
      return;
    }
    switchingRef.current = true;
    setSwitching(true);
    setUnplayableMessage(null);
    setRefusal(null);
    try {
      const action: Action = episodeTarget
        ? playStreamAction(episodeTarget.title, episodeTarget.video, addon, stream)
        : { type: "switch_stream", addon, stream };
      const { error } = await ask(action);
      if (!mountedRef.current) {
        return;
      }
      if (error) {
        setRefusal(error);
      } else {
        remove(levelId);
      }
    } finally {
      switchingRef.current = false;
      if (mountedRef.current) {
        setSwitching(false);
      }
    }
  };

  const currentVideo: Video | null = nowPlaying
    ? {
        id: nowPlaying.video.id,
        name: null,
        season: playback.episode?.season ?? null,
        episode: playback.episode?.episode ?? null,
        thumbnail: null,
        airDate: null,
      }
    : null;

  return (
    <Panel placement="side" title="Streams" subtitle={subtitle} onClose={pop}>
      <div
        className="mq-panel-streams-groups"
        data-region="panel-streams"
        data-kind="branch"
        data-label="Streams"
      >
        {refusal ? (
          <p className="mq-panel-refusal" role="alert" data-testid="streams-switch-refusal">
            {explain(refusal)}
          </p>
        ) : null}
        {unplayableMessage ? (
          <p className="mq-panel-note" role="status" data-testid="chosen-stream">
            {unplayableMessage}
          </p>
        ) : null}

        {lookup.kind === "waiting" ? (
          <p className="mq-panel-note" role="status" data-testid="streams-loading">
            Looking for Streams…
          </p>
        ) : lookup.kind === "failed" ? (
          <p className="mq-panel-refusal" role="alert" data-testid="streams-failure">
            {explain(lookup.error)}
          </p>
        ) : lookup.groups.length === 0 ? (
          <p className="mq-panel-note" data-testid="streams-none">
            No configured Addon offers Streams for this Video.
          </p>
        ) : (
          lookup.groups.map((group) => {
            const label = addonLabel(snapshot, group.addon);
            const answerNote = groupAnswerNote(group);
            const showLabel = group.streams.length > 0 || answerNote !== null;
            return (
              <div
                key={group.addon}
                className="mq-panel-streams-group"
                data-region={`panel-streams-${group.addon}`}
                data-kind="branch"
                data-label={label}
              >
                {showLabel ? <GroupLabel>{label}</GroupLabel> : null}
                {group.failure ? (
                  <AddonNotice
                    addon={label}
                    reason={explain(group.failure)}
                    pending={retryingAddons.has(group.addon)}
                    onRetry={() => void retryAddon(group.addon)}
                  />
                ) : null}
                {answerNote ? <p className="mq-panel-note">{answerNote}</p> : null}
                {group.streams.length > 0 ? (
                  <div className="mq-panel-streams-list">
                    {group.streams.map((stream, index) => {
                      const row = streamRowView(stream);
                      const playing =
                        !episodeTarget &&
                        currentVideo !== null &&
                        isPlayingStream(playback, group.addon, currentVideo, stream);
                      return (
                        <StreamRow
                          key={`${group.addon}:${index}`}
                          name={row.name}
                          tier={row.tier}
                          peers={row.peers}
                          size={row.size}
                          source={row.source}
                          marks={row.marks}
                          playing={playing}
                          disabled={switching}
                          onPlay={() => void choose(group.addon, stream)}
                        >
                          {row.warnings.map((warning) => (
                            <Badge
                              key={warning.tag}
                              tone="neutral"
                              title={warning.note}
                              aria-label={warning.note}
                            >
                              {warning.tag}
                            </Badge>
                          ))}
                          {row.unplayable ? (
                            <Badge
                              tone="danger"
                              title={row.unplayable}
                              aria-label={row.unplayable}
                            >
                              Unplayable
                            </Badge>
                          ) : null}
                        </StreamRow>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </Panel>
  );
}

function DetailsPanel({ playback }: { playback: PlaybackSnapshot }) {
  const { torrentRows, playbackRows } = marqueeDetailsPanel(playback, playback.position);

  return (
    <Panel placement="floating" split aria-label="Details">
      <PanelColumn title="Torrent" align="text">
        {torrentRows ? (
          <StatList label="Torrent">
            {torrentRows.map((row) => (
              <StatRow key={row.label} label={row.label} value={row.value} />
            ))}
          </StatList>
        ) : (
          <p className="mq-panel-note" data-testid="details-direct-note">
            Direct stream · not using torrent engine
          </p>
        )}
      </PanelColumn>

      <PanelColumn title="Playback" align="text">
        <StatList label="Playback">
          {playbackRows.map((row) => (
            <StatRow key={row.label} label={row.label} value={row.value} />
          ))}
        </StatList>
      </PanelColumn>
    </Panel>
  );
}
