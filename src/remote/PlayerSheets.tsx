import { useEffect, useRef, useState } from "react";

import { actionKey } from "../core/actionKey";
import { answeredStreams } from "../core/answers";
import { stepScale } from "../core/controls";
import { episodesOf } from "../core/episodes";
import { explain, type ActionError } from "../core/errors";
import { addonLabel } from "../core/home";
import {
  isPlayingStream,
  mergeRetriedAddonGroup,
  streamRowView,
  streamsEmptyState,
} from "../core/marqueeStreams";
import {
  marqueeAudioOptions,
  marqueeChaptersPanel,
  marqueeDetailsPanel,
  marqueePicturePanel,
  marqueeSpeedOptions,
  marqueeSubtitleOptions,
  type MarqueeTrackOption,
} from "../core/playerPanels";
import { usePlaybackView } from "../core/react/usePlaybackView";
import type { Session, SessionState } from "../core/session";
import { playabilityNote } from "../core/stream";
import { groupAnswerNote } from "../core/streamsList";
import { seasonName } from "../core/title";
import type {
  Action,
  AddonStreams,
  PlaybackSnapshot,
  Stream,
  Title,
  Video,
} from "../core/wire";
import { Chip } from "../kit/marquee/Chip";
import { GroupLabel } from "../kit/marquee/GroupLabel";
import { BottomSheet } from "../kit/marquee/phone/BottomSheet";
import { controlState, PhoneBadge, PhoneButton } from "../kit/marquee/phone/controls";
import { PhoneAddonNotice } from "../kit/marquee/phone/PhoneAddonNotice";
import { PhoneEpisodeRow } from "../kit/marquee/phone/PhoneEpisodeRow";
import { PhoneStreamRow } from "../kit/marquee/phone/PhoneStreamRow";
import { SizeStepper } from "../kit/marquee/SizeStepper";
import { StatList, StatRow } from "../kit/marquee/StatRow";
import { SyncControl } from "../kit/marquee/SyncControl";
import { TrackOption } from "../kit/marquee/TrackOption";
import { playingTitle } from "./playerScreen";
import {
  NO_EPISODES,
  SHEET_TITLES,
  sheetEpisode,
  type PlayerSheetName,
} from "./playerSheets";
import { unplayableAfter } from "./streamsScreen";

export type PlayerSheetsProps = {
  /** Which menu the Remote opened. */
  plate: PlayerSheetName;
  /** The Title the player belongs to, which the Episodes sheet lists. */
  title: Title | null;
  /** The Session every row's Action goes through. */
  session: Session;
  /** What the Host last published: the playback facts and the pending keys. */
  state: SessionState;
  /** Put the sheet away: its close control, its scrim, a drag, or Back. */
  onClose: () => void;
  /**
   * Open the Streams list for one episode. An episode is a Video like any
   * other, so the sheet hands the pair to the room, which puts the sheet away
   * and pushes the Streams level the Title's Play pushes (#215).
   */
  onEpisode: (title: Title, video: Video) => void;
};

/** The sheets whose rows arrive later keep one height, so they do not jump. */
const SHEET_HEIGHTS: Partial<Record<PlayerSheetName, string>> = {
  streams: "min(620px, calc(100% - 92px))",
  episodes: "min(620px, calc(100% - 92px))",
};

type SheetProps = {
  playback: PlaybackSnapshot;
  state: SessionState;
  take: (action: Action) => void;
  pending: (action: Action) => boolean;
};

/**
 * The fullscreen Remote's one bottom sheet, one menu at a time (#364, `P4`–`P4d`,
 * ADR-0035 §2).
 *
 * Every row is the core's, the same decisions the window's menus draw; this
 * arranges them at hand scale and sends the Action the core chose.
 */
export function PlayerSheets({
  plate,
  title,
  session,
  state,
  onClose,
  onEpisode,
}: PlayerSheetsProps) {
  const playback = state.snapshot?.playback ?? null;

  // The Remote is popped with the Stream, so a sheet over nothing is no sheet.
  if (!playback) {
    return null;
  }

  const sheet: SheetProps = {
    playback,
    state,
    take: (action) => void session.take(action),
    pending: (action) => state.pending.has(actionKey(action)),
  };

  return (
    <BottomSheet
      open
      title={SHEET_TITLES[plate]}
      onClose={onClose}
      height={SHEET_HEIGHTS[plate]}
      testId={`player-sheet-${plate}`}
    >
      <div className="mq-remote-sheet" data-sheet={plate}>
        {plate === "subtitles" ? (
          <SubtitlesSheet {...sheet} />
        ) : plate === "picture" ? (
          <PictureSheet {...sheet} />
        ) : plate === "streams" ? (
          <StreamsSheet {...sheet} title={title} session={session} onClose={onClose} />
        ) : plate === "episodes" ? (
          <EpisodesSheet {...sheet} title={title} session={session} onEpisode={onEpisode} />
        ) : plate === "speed" ? (
          <Options label="Playback speed" options={marqueeSpeedOptions(playback)} {...sheet} />
        ) : plate === "chapters" ? (
          <ChaptersSheet {...sheet} />
        ) : (
          <DetailsSheet {...sheet} session={session} />
        )}
      </div>
    </BottomSheet>
  );
}

/** The core's choices as one named list of rows, the chosen one checked. */
function Options({
  label,
  options,
  note,
  take,
  pending,
}: Pick<SheetProps, "take" | "pending"> & {
  label: string;
  options: MarqueeTrackOption[];
  /** The core's empty-list copy, where the Stream carries nothing to pick. */
  note?: string | null;
}) {
  return (
    <div className="mq-remote-sheet-list" role="group" aria-label={label}>
      {options.map((option) => (
        <TrackOption
          key={option.key}
          title={option.title}
          detail={option.detail}
          selected={option.selected}
          pending={pending(option.action)}
          onSelect={() => take(option.action)}
        />
      ))}
      {note ? <p className="mq-remote-sheet-note">{note}</p> : null}
    </div>
  );
}

/** Subtitles and audio, then the subtitle's sync and size (`P4`, ADR-0044 §4–5). */
function SubtitlesSheet(props: SheetProps) {
  const { playback, state, take, pending } = props;
  const subtitles = marqueeSubtitleOptions(playback);
  const audio = marqueeAudioOptions(playback);
  const scale = state.snapshot?.preferences.subtitleScale ?? 1;
  const resizing = ([-1, 1] as const).some((direction) =>
    pending({ type: "set_subtitle_scale", scale: stepScale(scale, direction) }),
  );

  return (
    <>
      <GroupLabel>Subtitles</GroupLabel>
      <Options
        label="Subtitle tracks"
        options={subtitles.options}
        note={subtitles.emptyNote}
        take={take}
        pending={pending}
      />
      <GroupLabel>Audio</GroupLabel>
      <Options
        label="Audio tracks"
        options={audio.options}
        note={audio.emptyNote}
        take={take}
        pending={pending}
      />
      <GroupLabel>Sync</GroupLabel>
      <SyncControl
        seconds={playback.subtitleDelay ?? 0}
        onChange={(seconds) => take({ type: "set_subtitle_delay", seconds })}
      />
      <GroupLabel>Size</GroupLabel>
      <SizeStepper
        scale={scale}
        pending={resizing}
        onChange={(next) => take({ type: "set_subtitle_scale", scale: next })}
      />
    </>
  );
}

function Chips({
  label,
  options,
  take,
  pending,
}: Pick<SheetProps, "take" | "pending"> & {
  label: string;
  options: MarqueeTrackOption[];
}) {
  return (
    <div className="mq-remote-sheet-chips" role="group" aria-label={label}>
      {options.map((option) => (
        <Chip
          key={option.key}
          selected={option.selected}
          disabled={pending(option.action)}
          onClick={() => take(option.action)}
        >
          {option.title}
        </Chip>
      ))}
    </div>
  );
}

/** Aspect, crop and Autocrop (`P4b`). Statistics are the Details sheet's. */
function PictureSheet({ playback, take, pending }: SheetProps) {
  const picture = marqueePicturePanel(playback);
  const autocrop: Action = { type: "autocrop" };

  return (
    <>
      <GroupLabel>Aspect</GroupLabel>
      <Chips label="Aspect" options={picture.aspect} take={take} pending={pending} />
      <GroupLabel>Crop</GroupLabel>
      <Chips label="Crop" options={picture.crop} take={take} pending={pending} />
      <PhoneButton
        kind="secondary"
        icon="maximize"
        className="mq-remote-sheet-button"
        {...controlState({ pending: pending(autocrop) })}
        onClick={() => take(autocrop)}
      >
        {picture.autocropLabel}
      </PhoneButton>
      <p className="mq-remote-sheet-note">{picture.autocropNote}</p>
    </>
  );
}

type StreamsLookup =
  | { kind: "waiting" }
  | { kind: "failed"; error: ActionError }
  | { kind: "answered"; groups: AddonStreams[] };

/**
 * The other Streams of the Video playing (`P4d`): a tap sends `switch_stream`,
 * so the Host keeps the position and the Hand pick (ADR-0044 §3). A Stream this
 * Host cannot open stays listed and marked, an Addon that did not answer offers
 * **Try again** on its own group, and what the answer proves about the Title is
 * remembered (ADR-0020).
 */
function StreamsSheet({
  playback,
  state,
  title,
  session,
  onClose,
}: SheetProps & { title: Title | null; session: Session; onClose: () => void }) {
  const [lookup, setLookup] = useState<StreamsLookup>({ kind: "waiting" });
  const [retrying, setRetrying] = useState<ReadonlySet<string>>(() => new Set());
  const [switching, setSwitching] = useState(false);
  const [refusal, setRefusal] = useState<ActionError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const videoType = playback.nowPlaying?.video.type ?? null;
  const videoId = playback.nowPlaying?.video.id ?? null;
  const shownVideo = useRef(videoId);
  shownVideo.current = videoId;
  const titleId = playingTitle(playback, state.snapshot?.watchProgress ?? [], title).id;

  // Each answer, a retried one included, settles what it proves (ADR-0020).
  useEffect(() => {
    if (lookup.kind !== "answered") {
      return;
    }
    const unplayable = unplayableAfter(lookup.groups);
    if (titleId !== null && unplayable !== null) {
      session.markUnplayable(titleId, unplayable);
    }
  }, [lookup]);

  const findStreams = () =>
    session.ask({ type: "find_streams", video: { type: videoType!, id: videoId! } });

  useEffect(() => {
    if (!videoType || !videoId) {
      setLookup({ kind: "answered", groups: [] });
      return;
    }
    let live = true;
    setLookup({ kind: "waiting" });
    setRefusal(null);
    setRetrying(new Set());
    void findStreams().then(({ response, error }) => {
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
  }, [session, videoType, videoId, attempt]);

  const retry = async (addon: string) => {
    if (lookup.kind !== "answered" || retrying.has(addon)) {
      return;
    }
    setRetrying((held) => new Set(held).add(addon));
    const { response, error } = await findStreams();
    if (!mounted.current || shownVideo.current !== videoId) {
      return;
    }
    setRetrying((held) => {
      const next = new Set(held);
      next.delete(addon);
      return next;
    });
    setLookup((current) => {
      if (current.kind !== "answered") {
        return current;
      }
      const groups = error
        ? current.groups.map((group) =>
            group.addon === addon ? { addon, streams: [], failure: error } : group,
          )
        : mergeRetriedAddonGroup(current.groups, addon, answeredStreams(response));
      return { kind: "answered", groups };
    });
  };

  const choose = async (addon: string, stream: Stream) => {
    if (switching || playabilityNote(stream.playback) !== null) {
      return;
    }
    setSwitching(true);
    setRefusal(null);
    const { error } = await session.ask({ type: "switch_stream", addon, stream });
    // A sheet already put away takes nothing else off the stack.
    if (!mounted.current) {
      return;
    }
    setSwitching(false);
    if (error) {
      setRefusal(error);
    } else {
      onClose();
    }
  };

  if (lookup.kind === "waiting") {
    return (
      <p className="mq-remote-sheet-note" role="status" data-testid="streams-loading">
        Looking for Streams…
      </p>
    );
  }

  if (lookup.kind === "failed") {
    return (
      <>
        <p className="mq-remote-inline-error" role="alert" data-testid="streams-failure">
          {explain(lookup.error)}
        </p>
        <PhoneButton
          kind="secondary"
          icon="arrow-clockwise"
          className="mq-remote-sheet-button"
          onClick={() => setAttempt((held) => held + 1)}
        >
          Try again
        </PhoneButton>
      </>
    );
  }

  const empty = streamsEmptyState(lookup.groups);
  const video: Video | null = playback.nowPlaying
    ? {
        id: playback.nowPlaying.video.id,
        name: null,
        season: null,
        episode: null,
        thumbnail: null,
        airDate: null,
      }
    : null;

  return (
    <>
      {refusal ? (
        <p className="mq-remote-inline-error" role="alert" data-testid="streams-switch-refusal">
          {explain(refusal)}
        </p>
      ) : null}

      {empty ? (
        <p className="mq-remote-sheet-note" data-testid="streams-none">
          {empty.body}
        </p>
      ) : (
        lookup.groups.map((group) => {
          const name = addonLabel(state.snapshot, group.addon);
          const note = groupAnswerNote(group);

          return (
            <section
              key={group.addon}
              className="mq-remote-sheet-list"
              aria-label={name}
              data-testid={`streams-${group.addon}`}
            >
              <GroupLabel>{name}</GroupLabel>
              {group.streams.map((stream, index) => {
                const row = streamRowView(stream);
                return (
                  <PhoneStreamRow
                    key={index}
                    tier={row.tier === "4K" ? "4k" : "hd"}
                    quality={row.tier ?? "HD"}
                    name={row.name}
                    details={
                      [row.peers && `${row.peers} peers`, row.size, row.source]
                        .filter(Boolean)
                        .join(" · ") || null
                    }
                    marks={row.marks}
                    playing={
                      video !== null &&
                      isPlayingStream(playback, group.addon, video, stream)
                    }
                    disabled={switching || row.unplayable !== null}
                    onPlay={() => void choose(group.addon, stream)}
                  >
                    {row.warnings.map((warning) => (
                      <PhoneBadge key={warning.tag} title={warning.note} aria-label={warning.note}>
                        {warning.tag}
                      </PhoneBadge>
                    ))}
                    {row.unplayable ? (
                      <PhoneBadge
                        tone="danger"
                        title={row.unplayable}
                        aria-label={row.unplayable}
                        data-testid="stream-unplayable"
                      >
                        Unplayable
                      </PhoneBadge>
                    ) : null}
                  </PhoneStreamRow>
                );
              })}
              {group.failure ? (
                <PhoneAddonNotice
                  title={`${name} did not answer`}
                  reason={explain(group.failure)}
                  disabled={retrying.has(group.addon)}
                  onRetry={() => void retry(group.addon)}
                />
              ) : note ? (
                <p className="mq-remote-sheet-note">{note}</p>
              ) : null}
            </section>
          );
        })
      )}
    </>
  );
}

/**
 * The Title's seasons and episodes (`P4c`). A press opens that episode's Streams
 * list; it picks no candidate behind the person's back (#215). A Title that
 * lists none says so, and nothing is asked of the Host.
 */
function EpisodesSheet({
  playback,
  state,
  title,
  session,
  onEpisode,
}: SheetProps & {
  title: Title | null;
  session: Session;
  onEpisode: (title: Title, video: Video) => void;
}) {
  const [chosen, setChosen] = useState<number | null | undefined>(undefined);
  const position = usePlaybackView(session, true)?.position ?? null;
  const seasons = title ? episodesOf(title) : [];
  const wanted = chosen === undefined ? (playback.episode?.season ?? null) : chosen;
  const shown = seasons.find((season) => season.season === wanted) ?? seasons[0] ?? null;

  if (!title || !shown) {
    return (
      <p className="mq-remote-sheet-note" role="status" data-testid="episode-note">
        {NO_EPISODES}
      </p>
    );
  }

  const today = new Date();

  return (
    <>
      <div className="mq-remote-sheet-seasons" role="group" aria-label="Seasons">
        {seasons.map(({ season }) => (
          <Chip
            key={season ?? "none"}
            selected={shown.season === season}
            onClick={() => setChosen(season)}
          >
            {seasonName(season)}
          </Chip>
        ))}
      </div>
      <ol className="mq-remote-sheet-list" aria-label={seasonName(shown.season)}>
        {shown.videos.map((video) => {
          const row = sheetEpisode(
            video,
            playback,
            state.snapshot?.watchProgress ?? [],
            position,
            today,
          );
          return (
            <li
              key={video.id}
              aria-current={row.playing ? "true" : undefined}
              data-testid={`episode-${video.id}`}
            >
              <PhoneEpisodeRow
                number={row.number}
                title={row.title}
                date={row.date}
                description={row.description}
                still={row.still}
                code={row.code}
                progress={row.progress}
                onPress={() => onEpisode(title, video)}
              />
            </li>
          );
        })}
      </ol>
    </>
  );
}

/** The two chapter steps, then the container's chapters in its own order. */
function ChaptersSheet({ playback, take, pending }: SheetProps) {
  const chapters = marqueeChaptersPanel(playback);
  const previous: Action = { type: "previous_chapter" };
  const next: Action = { type: "next_chapter" };

  return (
    <>
      <div className="mq-remote-sheet-steps">
        <PhoneButton
          kind="secondary"
          icon="skip-back"
          filled
          aria-label="Previous chapter"
          {...controlState({ pending: pending(previous) }, chapters.previousDisabled)}
          onClick={() => take(previous)}
        >
          Previous
        </PhoneButton>
        <PhoneButton
          kind="secondary"
          icon="skip-forward"
          filled
          aria-label="Next chapter"
          {...controlState({ pending: pending(next) }, chapters.nextDisabled)}
          onClick={() => take(next)}
        >
          Next
        </PhoneButton>
      </div>
      <Options
        label="Chapters"
        options={chapters.chapters}
        note={chapters.emptyNote}
        take={take}
        pending={pending}
      />
    </>
  );
}

/** The Torrent status and the Statistics (ADR-0043 §4). Nothing here is pressed. */
function DetailsSheet({ playback, session }: SheetProps & { session: Session }) {
  const position = usePlaybackView(session, true)?.position ?? null;
  const details = marqueeDetailsPanel(playback, position);

  return (
    <>
      <GroupLabel>Torrent</GroupLabel>
      {details.torrentRows ? (
        <StatList label="Torrent">
          {details.torrentRows.map((row) => (
            <StatRow key={row.label} label={row.label} value={row.value} />
          ))}
        </StatList>
      ) : (
        <p className="mq-remote-sheet-note" data-testid="details-direct-note">
          Direct stream · not using torrent engine
        </p>
      )}
      <GroupLabel>Playback</GroupLabel>
      <StatList label="Playback">
        {details.playbackRows.map((row) => (
          <StatRow key={row.label} label={row.label} value={row.value} />
        ))}
      </StatList>
    </>
  );
}
