import { useCallback, useRef, useState, type ReactNode } from "react";

import {
  type Action,
  type ActionError,
  type Chapter,
  type PlaybackSnapshot,
} from "../host-client";
import {
  controllable,
  formatSpeed,
  formatVolume,
  nextEpisodeDisabled,
  previousEpisodeDisabled,
} from "../controls";
import { formatTime, playingName, transportable } from "../playback";
import { useShell } from "./context";
import { Button } from "./kit";
import { Refusal } from "./Refusal";
import {
  chapterMarks,
  qualityBadge,
  remainingTime,
  streamDetails,
  timelineFraction,
} from "./osd";
import {
  osdPopoverId,
  osdPopoverLevel,
  type OsdPopoverName,
} from "./PlayerPopovers";
import { useOsdVisibility } from "./useOsdVisibility";
import "./osd.css";

/**
 * The `in_window` player: mpv's picture, with the edge-to-edge OSD over it.
 *
 * The Host owns playback and the window only draws what the one Snapshot says
 * (ADR-0002, ADR-0013). Every control here takes the same Action a Remote
 * client takes: the top-left pills say what is playing, the top-right Stop is
 * Back's second meaning, the right-edge pillar is volume, the strip is the
 * transport and the five per-icon menus, and the flush bottom bar is the
 * timeline with the container's own chapters.
 *
 * The OSD summons on any input and puts itself away after five idle seconds
 * unless a person is still in it. An open popover is its own pushed level, so
 * Back closes the menu first and stops playback on the next press (#51, #57).
 */
export function PlayerOverlay() {
  const { snapshot, take, ask, popover, pop, push } = useShell();
  const playback = snapshot?.playback ?? null;
  const [refusal, setRefusal] = useState<ActionError | null>(null);
  const chrome = useRef<HTMLDivElement | null>(null);
  const pictureButton = useRef<HTMLButtonElement | null>(null);

  const { visible } = useOsdVisibility({
    pinned: popover !== null,
    chrome,
    onHide: () => pictureButton.current?.focus({ preventScroll: true }),
  });

  const openPopover = useCallback(
    (name: OsdPopoverName) => {
      const id = osdPopoverId(name);
      if (popover === id) {
        pop();
        return;
      }
      if (popover !== null) {
        pop();
      }
      push(osdPopoverLevel(name));
    },
    [pop, popover, push],
  );

  /**
   * An episode step owns its refusal: the Host answers `no_previous_episode` /
   * `no_next_episode` at the boundary, and the OSD says so beside the transport
   * without stopping what is playing.
   */
  const step = useCallback(
    async (type: "previous_episode" | "next_episode") => {
      setRefusal(null);
      const { error } = await ask({ type });
      if (error) {
        setRefusal(error);
      }
    },
    [ask],
  );

  // Nothing to draw while the Host is between Streams: the shell takes the
  // level away in the same pass that told it the Stream stopped.
  if (!playback) {
    return null;
  }

  const { state, picture, nowPlaying, episode, position } = playback;
  const playing = state === "playing";
  const canTransport = transportable(state);
  const controls = controllable(state);
  const quality = qualityBadge(nowPlaying);
  const details = streamDetails(playback);
  const shownPosition = position ?? 0;

  const takeAction = (action: Action) => {
    void take(action);
  };

  return (
    <section
      className="shell-player"
      aria-label="Playing"
      role="region"
      data-testid="shell-player"
      data-state={state}
      data-picture={picture}
      data-region="player"
      data-kind="branch"
      data-label="Player"
    >
      {/* The picture's hole. Where the picture is in this window the page
          paints nothing here and mpv's child window shows through; the button
          covering it is the largest control in the window, and pressing it
          squeezes or releases the Stream rather than merely summoning the
          OSD (ADR-0003). */}
      <div className="shell-player-picture" data-testid="picture" data-picture={picture} data-state={state}>
        {canTransport ? (
          <button
            ref={pictureButton}
            type="button"
            className="shell-picture-toggle"
            data-testid="picture-toggle"
            data-focusable
            aria-label="Play or pause"
            onClick={() => takeAction({ type: "set_paused", paused: playing })}
          />
        ) : null}
        {state === "opening" ? (
          <p className="shell-picture-note" data-testid="opening-stream">
            {`Opening ${playingName(nowPlaying)}…`}
          </p>
        ) : null}
        {state === "ended" ? (
          <p className="shell-picture-note" data-testid="stream-ended">
            The Stream reached its end.
          </p>
        ) : null}
      </div>

      {visible ? (
        <div className="shell-osd" data-testid="shell-osd" ref={chrome}>
          <div className="shell-osd-vignette" aria-hidden="true" />

          <header className="shell-osd-top">
            <div className="shell-osd-meta">
              <div className="shell-osd-line">
                {quality ? (
                  <span className="shell-osd-quality tabular" data-testid="osd-quality">
                    {quality}
                  </span>
                ) : null}
                <span className="shell-osd-title" data-testid="shell-now-playing">
                  {playingName(nowPlaying)}
                </span>
              </div>
              {details ? (
                <p className="shell-osd-details tabular" data-testid="osd-details">
                  {details}
                </p>
              ) : null}
            </div>

            <button
              type="button"
              className="shell-osd-icon kit-focus-invert"
              data-focusable
              data-testid="stop"
              aria-label="Stop"
              title="Stop playback and return (Back)"
              onClick={() => takeAction({ type: "stop_playback" })}
            >
              <CloseIcon />
            </button>
          </header>

          <div className="shell-osd-middle">
            <div className="shell-osd-spacer" />
            {controls ? (
              <VolumePillar playback={playback} onTake={takeAction} />
            ) : null}
          </div>

          <div className="shell-osd-bottom">
            {controls ? (
              <div
                className="shell-osd-strip"
                data-region="osd-strip"
                data-kind="row"
                data-label="Player controls"
              >
                <div className="shell-osd-cluster shell-osd-cluster-left">
                  <IconButton
                    testId="osd-picture"
                    label="Picture"
                    title="Picture — aspect, crop and statistics"
                    expanded={popover === osdPopoverId("picture")}
                    onClick={() => openPopover("picture")}
                  >
                    <MenuIcon />
                  </IconButton>
                  <IconButton
                    testId="osd-subtitles"
                    label="Subtitles"
                    title="Subtitles"
                    expanded={popover === osdPopoverId("subtitles")}
                    onClick={() => openPopover("subtitles")}
                  >
                    <span className="shell-osd-glyph tabular">CC</span>
                  </IconButton>
                  <IconButton
                    testId="osd-audio"
                    label="Audio"
                    title="Audio tracks"
                    expanded={popover === osdPopoverId("audio")}
                    onClick={() => openPopover("audio")}
                  >
                    <WaveIcon />
                  </IconButton>
                </div>

                <div className="shell-osd-cluster shell-osd-cluster-center">
                  <IconButton
                    testId="previous-episode"
                    label="Previous episode"
                    title="Previous episode"
                    disabled={previousEpisodeDisabled(episode)}
                    onClick={() => void step("previous_episode")}
                  >
                    <SkipBackIcon />
                  </IconButton>

                  {canTransport ? (
                    <>
                      <IconButton
                        testId="rewind"
                        label="Back ten seconds"
                        title="Rewind 10 seconds"
                        className="shell-osd-glyph tabular"
                        onClick={() => takeAction({ type: "seek", target: { kind: "by", seconds: -10 } })}
                      >
                        ↺10
                      </IconButton>
                      <IconButton
                        testId={playing ? "pause" : "play"}
                        label={playing ? "Pause" : "Play"}
                        title={playing ? "Pause" : "Play"}
                        onClick={() => takeAction({ type: "set_paused", paused: playing })}
                      >
                        {playing ? <PauseIcon /> : <PlayIcon />}
                      </IconButton>
                      <IconButton
                        testId="forward"
                        label="Forward ten seconds"
                        title="Forward 10 seconds"
                        className="shell-osd-glyph tabular"
                        onClick={() => takeAction({ type: "seek", target: { kind: "by", seconds: 10 } })}
                      >
                        10↻
                      </IconButton>
                    </>
                  ) : null}

                  <IconButton
                    testId="next-episode"
                    label="Next episode"
                    title="Next episode"
                    disabled={nextEpisodeDisabled(episode)}
                    onClick={() => void step("next_episode")}
                  >
                    <SkipForwardIcon />
                  </IconButton>
                </div>

                <div className="shell-osd-cluster shell-osd-cluster-right">
                  <IconButton
                    testId="osd-speed"
                    label="Playback speed"
                    title="Playback speed"
                    expanded={popover === osdPopoverId("speed")}
                    onClick={() => openPopover("speed")}
                  >
                    <span className="shell-osd-glyph tabular">{formatSpeed(playback.speed ?? 1)}</span>
                  </IconButton>
                  <IconButton
                    testId="osd-chapters"
                    label="Chapters"
                    title="Chapters"
                    expanded={popover === osdPopoverId("chapters")}
                    onClick={() => openPopover("chapters")}
                  >
                    <ListIcon />
                  </IconButton>
                </div>
              </div>
            ) : null}

            {state === "ended" && !nextEpisodeDisabled(episode) ? (
              <div className="shell-osd-ended">
                <Button
                  variant="primary"
                  data-testid="next-episode-after-end"
                  onClick={() => void step("next_episode")}
                >
                  Next episode
                </Button>
              </div>
            ) : null}

            {refusal ? (
              <div className="shell-osd-refusal">
                <Refusal error={refusal} testId="osd-refusal" />
              </div>
            ) : null}

            <Timeline
              playback={playback}
              interactive={canTransport}
              shown={shownPosition}
              onSeek={(seconds) => takeAction({ type: "seek", target: { kind: "to", seconds } })}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}

/**
 * The right-edge volume pillar: a vertical level, its numeric readout, and the
 * mute toggle. The slider is the same `volume` control the player always had;
 * the level the Host publishes is shown until a person moves the thumb, and
 * then what they moved it to.
 */
function VolumePillar({
  playback,
  onTake,
}: {
  playback: PlaybackSnapshot;
  onTake: (action: Action) => void;
}) {
  const [scrub, setScrub] = useState<number | null>(null);
  const shown = scrub ?? Math.round(playback.volume ?? 100);
  const muted = playback.muted ?? false;

  const send = (level: number) => {
    setScrub(null);
    onTake({ type: "set_volume", level });
  };

  return (
    <div
      className="shell-osd-volume"
      data-region="osd-volume"
      data-kind="row"
      data-label="Volume"
    >
      <span className="shell-osd-volume-level tabular" data-testid="volume-level">
        {formatVolume(shown)}
      </span>
      <input
        type="range"
        className="shell-osd-volume-slider"
        aria-label="Volume"
        data-testid="volume"
        min={0}
        max={130}
        step={1}
        value={shown}
        onChange={(event) => setScrub(Number(event.target.value))}
        onPointerUp={() => scrub !== null && send(scrub)}
        onKeyUp={() => scrub !== null && send(scrub)}
        data-focusable
      />
      <button
        type="button"
        className="shell-osd-icon kit-focus-invert"
        data-focusable
        data-testid="mute"
        aria-label={muted ? "Unmute" : "Mute"}
        aria-pressed={muted}
        title={muted ? "Unmute" : "Mute"}
        onClick={() => onTake({ type: "set_muted", muted: !muted })}
      >
        <VolumeIcon muted={muted} />
      </button>
    </div>
  );
}

/**
 * The flush bottom timeline: the track, its chapter diamonds with hover
 * callouts, and the two tabular clocks. The range input is only drawn while the
 * Host would take a seek — the same state gate the old transport had — and it
 * covers the whole bar when it is.
 */
function Timeline({
  playback,
  interactive,
  shown,
  onSeek,
}: {
  playback: PlaybackSnapshot;
  interactive: boolean;
  shown: number;
  onSeek: (seconds: number) => void;
}) {
  const { position, duration, chapters } = playback;
  const [scrub, setScrub] = useState<number | null>(null);
  const at = scrub ?? shown;
  const fraction = timelineFraction(at, duration);
  const marks = chapterMarks(chapters, duration);
  const left = formatTime(scrub ?? position);
  const right = remainingTime(at, duration);

  const take = (seconds: number) => {
    setScrub(null);
    onSeek(seconds);
  };

  return (
    <div className="shell-osd-timeline" data-testid="osd-timeline">
      <div className="shell-osd-track" aria-hidden="true">
        <span className="shell-osd-progress" style={{ width: `${fraction * 100}%` }} />
        <span className="shell-osd-playhead" style={{ left: `${fraction * 100}%` }} />
        {marks.map(({ chapter, fraction: atFraction }) => (
          <span
            key={chapter.index}
            className="shell-osd-chapter"
            data-testid={`chapter-marker-${chapter.index}`}
            style={{ left: `${atFraction * 100}%` }}
          >
            <span className="shell-osd-diamond">◆</span>
            <span className="shell-osd-callout">
              <span className="shell-osd-callout-name">{chapterName(chapter)}</span>
              <span className="shell-osd-callout-time tabular">{formatTime(chapter.time)}</span>
            </span>
          </span>
        ))}
      </div>

      {interactive ? (
        <input
          type="range"
          className="shell-osd-scrubber"
          aria-label="Position"
          data-testid="position"
          min={0}
          max={duration ?? 0}
          step={1}
          value={at}
          disabled={duration === null}
          onChange={(event) => setScrub(Number(event.target.value))}
          onPointerUp={() => scrub !== null && take(scrub)}
          onKeyUp={() => scrub !== null && take(scrub)}
          data-focusable
        />
      ) : null}

      <span className="shell-osd-elapsed tabular" data-testid="elapsed">
        {left}
      </span>
      <span className="shell-osd-remaining tabular" data-testid="remaining">
        {right}
      </span>
    </div>
  );
}

/** A chapter's callout name: its title where the container gave one, else its place. */
function chapterName(chapter: Chapter): string {
  return chapter.title ?? `Chapter ${chapter.index + 1}`;
}

/** One icon-sized control in the OSD strip. */
function IconButton({
  testId,
  label,
  title,
  expanded,
  disabled,
  className,
  onClick,
  children,
}: {
  testId: string;
  label: string;
  title?: string;
  expanded?: boolean;
  disabled?: boolean;
  className?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`shell-osd-icon kit-focus-invert${className ? ` ${className}` : ""}`}
      data-focusable
      data-testid={testId}
      aria-label={label}
      aria-expanded={expanded}
      title={title ?? label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <path d="M4 6h16M4 12h16M4 18h11" />
    </svg>
  );
}

function WaveIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 3v18M8 7v10M4 10v4M16 7v10M20 10v4" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 9h8M8 12h8M8 15h5" />
    </svg>
  );
}

function SkipBackIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M6 6h2v12H6V6zm3.5 6 8.5 6V6l-8.5 6z" />
    </svg>
  );
}

function SkipForwardIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M6 5h4v14H6V5zm8 0h4v14h-4V5z" />
    </svg>
  );
}

function VolumeIcon({ muted }: { muted: boolean }) {
  return muted ? (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M11 5 6 9H2v6h4l5 4V5zm5.5 4.5 1.5-1.5 3 3 3-3 1.5 1.5-3 3 3 3-1.5 1.5-3-3-3 3-1.5-1.5 3-3-3-3z" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M11 5 6 9H2v6h4l5 4V5zm4.5 7c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM13 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
    </svg>
  );
}
