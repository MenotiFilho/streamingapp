import { AnimatePresence, motion } from "motion/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
  type WheelEvent,
} from "react";

import {
  type Action,
  type ActionError,
  type Chapter,
  type PlaybackSnapshot,
} from "../host-client";
import {
  VOLUME_MAX,
  controllable,
  formatSpeed,
  formatVolume,
  nextEpisodeDisabled,
  previousEpisodeDisabled,
  volumeFraction,
} from "../controls";
import type { Intent } from "../input";
import { formatTime, playingName, transportable } from "../playback";
import { labelOf } from "../title";
import { useShell } from "./context";
import { FullscreenButton } from "./FullscreenButton";
import { Button, PendingSpinner } from "./repertory/kit";
import { FOCUSABLE } from "./layout";
import { Refusal } from "./Refusal";
import { usePending } from "./usePending";
import { usePreview } from "./usePreview";
import {
  bufferedSpan,
  chapterAt,
  chapterMarks,
  qualityBadge,
  remainingTime,
  spacedChapterMarks,
  streamDetails,
  streamKey,
  streamTitle,
  timelineFraction,
} from "./osd";
import {
  osdPopoverId,
  osdPopoverLevel,
  type OsdPopoverName,
} from "./PlayerPopovers";
import { usePreviewData } from "./repertory/context";
import { POPOVER_RISE_PX } from "./repertory/frame";
import { Icon } from "./repertory/icons";
import { fade, panel } from "./repertory/motion";
import { focusAndReveal } from "./reveal";
import { useOsdVisibility } from "./useOsdVisibility";
import { usePlaybackPosition } from "./usePlaybackPosition";
import { useReducedMotion } from "./useReducedMotion";
import "./repertory/osd.css";

/** One press of the pad's volume faces, on the Host's 0–130 scale. */
const VOLUME_STEP = 5;

/** The three places the player's D-pad ladder stops at, top to bottom. */
type PlayerStop = "picture" | "strip" | "top";

/**
 * Up and Down from each stop. A missing direction is a wall: the picture is the
 * bottom of the ladder and the top row its top.
 */
const LADDER: Record<PlayerStop, { up?: PlayerStop; down?: PlayerStop }> = {
  top: { down: "strip" },
  strip: { up: "top", down: "picture" },
  picture: { up: "strip" },
};

/**
 * Which stop a control belongs to, by the mark its cluster carries. A control
 * outside the stops — the volume pillar, the timeline — answers as the strip
 * does: Up reaches the top row and Down reaches the picture.
 */
function stopOf(element: Element | null): PlayerStop {
  const stop =
    element instanceof HTMLElement
      ? element.closest<HTMLElement>("[data-player-stop]")?.dataset.playerStop
      : undefined;
  return stop === "picture" || stop === "top" ? stop : "strip";
}

/** A remembered control is worth landing on while it is still drawn and enabled. */
function usable(element: HTMLElement | null, cluster: HTMLElement | null): element is HTMLElement {
  return Boolean(
    element &&
      element.isConnected &&
      element.matches(FOCUSABLE) &&
      (!cluster || cluster.contains(element)),
  );
}

/**
 * The `in_window` player: mpv's picture, with the edge-to-edge OSD over it.
 *
 * The Host owns playback and the window only draws what the one Snapshot says
 * (ADR-0002, ADR-0013). Every control here takes the same Action a Remote
 * client takes: the top-left programme note says what is playing, the top-right
 * Stop is Back's second meaning, the right-edge fader is volume, the strip is
 * the transport and the five per-icon menus, and the flush bottom bar is the
 * timeline with the container's own chapters.
 *
 * The OSD summons on any input — a pad's X/Y included — and puts itself away
 * after three idle seconds unless a person is still in it. An open popover is
 * its own pushed level, so Back closes the menu first and stops playback on the
 * next press (#51, #57).
 *
 * Up and Down are the player's own ladder rather than the row geometry the
 * picture would otherwise swallow (#120): the picture, the strip, and the
 * top-right window pair. Left and Right stay the geometry's — between the
 * strip's controls, and between Full screen and Stop.
 */
export function PlayerOverlay() {
  const { snapshot, take, ask, popover, pop, push, setIntentHandler } = useShell();
  // The plain Vite window has no mpv, so the rehearsal paints the film's own
  // backdrop behind the OSD instead of a black hole. The Tauri window never
  // takes this branch: there the picture is mpv's (ADR-0003).
  const previewMode = usePreviewData();
  const playback = snapshot?.playback ?? null;
  const [refusal, setRefusal] = useState<ActionError | null>(null);
  // The episode step is the wait a person sees: the Host asks the Addons for the
  // list and the neighbour's Stream under its change lock, so no Snapshot
  // arrives until the step has resolved (#137, ADR-0022).
  const { pending: stepping, run: stepOnce } = usePending();
  const [stepSide, setStepSide] = useState<"previous" | "next" | null>(null);
  const [wheelVolume, setWheelVolume] = useState<number | null>(null);
  const [previewSettled, setPreviewSettled] = useState(() => playback?.state !== "opening");
  const chrome = useRef<HTMLDivElement | null>(null);
  const pictureButton = useRef<HTMLButtonElement | null>(null);
  const strip = useRef<HTMLDivElement | null>(null);
  const top = useRef<HTMLDivElement | null>(null);
  const playPause = useRef<HTMLButtonElement | null>(null);
  const fullscreen = useRef<HTMLButtonElement | null>(null);
  /** Where each stop was last left, while the OSD is up. */
  const rememberedStrip = useRef<HTMLElement | null>(null);
  const rememberedTop = useRef<HTMLElement | null>(null);
  /** Where an Up that summoned the OSD should land once it is drawn. */
  const pendingStop = useRef<PlayerStop | null>(null);
  const sawOpening = useRef(false);
  const wheel = useRef<{ level: number | null; timer: ReturnType<typeof setTimeout> | null }>({
    level: null,
    timer: null,
  });

  // The wheel sends one Action after a short pause rather than one per notch:
  // a trackpad produces many events, and the Host's volume is one value.
  useEffect(
    () => () => {
      if (wheel.current.timer !== null) {
        clearTimeout(wheel.current.timer);
      }
    },
    [],
  );

  // The pending level stays on screen until the Host's Snapshot agrees with it,
  // so the pillar does not flash the old number between the wheel and the event.
  useEffect(() => {
    const published = playback?.volume ?? null;
    if (
      wheelVolume !== null &&
      published !== null &&
      Math.abs(published - wheelVolume) < 0.5
    ) {
      setWheelVolume(null);
    }
  }, [playback?.volume, wheelVolume]);

  // The preview stays a moment past the Host's first `playing` report: mpv
  // reports the file before the compositor has put the first frame on screen,
  // and taking the art away at that instant is the transparent flash. It never
  // appears for a player that mounts already playing (a Remote started it).
  useEffect(() => {
    const state = playback?.state;
    if (state === "opening") {
      sawOpening.current = true;
      setPreviewSettled(false);
      return;
    }
    if (state === "playing" && sawOpening.current) {
      const timer = setTimeout(() => {
        sawOpening.current = false;
        setPreviewSettled(true);
      }, 600);
      return () => clearTimeout(timer);
    }
    sawOpening.current = false;
    setPreviewSettled(true);
  }, [playback?.state]);

  const { visible, wake } = useOsdVisibility({
    pinned: popover !== null,
    chrome,
    onHide: () => focusAndReveal(pictureButton.current),
  });
  const livePosition = usePlaybackPosition(playback, visible);

  /** Put focus on a stop, and say whether there was a control to land on. */
  const focusStop = (stop: PlayerStop): boolean => {
    if (stop === "picture") {
      const picture = pictureButton.current;
      if (!picture) {
        return false;
      }
      focusAndReveal(picture);
      return true;
    }
    const cluster = stop === "strip" ? strip.current : top.current;
    const remembered = stop === "strip" ? rememberedStrip.current : rememberedTop.current;
    const preferred = stop === "strip" ? playPause.current : fullscreen.current;

    for (const candidate of [remembered, preferred]) {
      if (usable(candidate, cluster)) {
        focusAndReveal(candidate);
        return true;
      }
    }

    // The remembered control and the default can both be gone — opening draws
    // no Play, and an ended Stream draws no strip at all — so the stop's own
    // first control answers next, and the OSD's first after that.
    const first =
      cluster?.querySelector<HTMLElement>(FOCUSABLE) ??
      chrome.current?.querySelector<HTMLElement>(FOCUSABLE) ??
      null;
    if (!first) {
      return false;
    }
    focusAndReveal(first);
    return true;
  };

  // The strip and the top row remember the control each was left on; Up and
  // Down are how a person goes back to it. Both forget when the OSD goes, so
  // the next summon opens on Play and Full screen again.
  useEffect(() => {
    if (!visible) {
      rememberedStrip.current = null;
      rememberedTop.current = null;
      return;
    }

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      if (strip.current?.contains(target)) {
        rememberedStrip.current = target;
      } else if (top.current?.contains(target)) {
        rememberedTop.current = target;
      }
    };

    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, [visible]);

  // An Up from a hidden OSD summons it and lands on its strip in the same
  // press; the control is not in the document until the render that shows it,
  // so the landing waits for that render.
  useEffect(() => {
    const stop = pendingStop.current;
    if (!stop) {
      return;
    }
    pendingStop.current = null;
    focusStop(stop);
  });

  const openPopover = useCallback(
    (name: OsdPopoverName, trigger: HTMLElement) => {
      if (popover !== null) {
        pop();
      }
      const { left, right } = trigger.getBoundingClientRect();
      push(osdPopoverLevel(name, { left, right }));
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
      const side = type === "next_episode" ? "next" : "previous";
      await stepOnce(async () => {
        // The side is set inside the guarded work: a press that the guard drops
        // must not relabel a step that is already in flight.
        setStepSide(side);
        try {
          const { error } = await ask({ type });
          if (error) {
            setRefusal(error);
          }
        } finally {
          setStepSide(null);
        }
      });
    },
    [ask, stepOnce],
  );

  /** The Host's volume, moved a step and sent once the steps settle. */
  const nudgeVolume = (delta: number) => {
    if (!playback) {
      return;
    }
    const current = wheel.current.level ?? playback.volume ?? 100;
    const next = Math.min(130, Math.max(0, Math.round(current + delta)));
    wheel.current.level = next;
    setWheelVolume(next);
    if (wheel.current.timer !== null) {
      clearTimeout(wheel.current.timer);
    }
    wheel.current.timer = setTimeout(() => {
      const level = wheel.current.level;
      wheel.current.level = null;
      wheel.current.timer = null;
      if (level !== null) {
        void take({ type: "set_volume", level });
      }
    }, 80);
  };

  const controls = playback !== null && controllable(playback.state);

  /**
   * The player's own intents. The pad's X and Y step the volume through the
   * same debounced path the wheel uses; Up and Down walk the
   * picture/strip/top ladder instead of the geometry the picture button would
   * otherwise swallow. A direction is input, so it summons the OSD whether or
   * not the player acts on the move; Left, Right and A stay the spatial
   * engine's.
   */
  const handleIntent = (intent: Intent): boolean => {
    if (intent === "volume_up" || intent === "volume_down") {
      wake("key");
      if (!controls) {
        return false;
      }
      nudgeVolume(intent === "volume_up" ? VOLUME_STEP : -VOLUME_STEP);
      return true;
    }

    if (intent !== "up" && intent !== "down" && intent !== "left" && intent !== "right") {
      return false;
    }

    // A pad's direction is input like a key's: it summons the OSD.
    wake("key");

    if (intent === "left" || intent === "right") {
      // The row geometry owns the move; waking the OSD is all the player does.
      return false;
    }

    // A hidden OSD leaves focus on the picture, and its strip and top row are
    // not drawn to ask which one is focused.
    const here: PlayerStop = visible ? stopOf(document.activeElement) : "picture";
    const next = LADDER[here][intent];
    if (!next) {
      // The ladder's own wall: the picture is its bottom, the top row its top.
      return true;
    }
    if (!visible) {
      // The stop is not drawn until the wake renders; land on it then.
      pendingStop.current = next;
      return true;
    }
    // A stop that is not drawn — the picture during opening or after the end —
    // leaves the direction to the focus engine rather than eating it.
    return focusStop(next);
  };

  // The level the shell built reads its handler through `playerIntent`. The
  // handler is registered after every render so it is always the one for the
  // screen on show; the shell is the single owner of clearing it when the
  // player level leaves.
  useEffect(() => {
    setIntentHandler(handleIntent);
  });

  // Nothing to draw while the Host is between Streams: the shell takes the
  // level away in the same pass that told it the Stream stopped.
  if (!playback) {
    return null;
  }

  const { state, picture, nowPlaying, episode } = playback;
  const playing = state === "playing";
  const canTransport = transportable(state);
  const quality = qualityBadge(nowPlaying);
  const details = streamDetails(playback);
  const shownPosition = livePosition;

  // What the opening Stream will be: the Watch progress entry the Host now
  // holds for this Video carries the Title's backdrop, poster and episode still
  // (#29). The player draws it in the hole while mpv is still opening, so the
  // wait is a picture of what is coming rather than an empty window.
  const progress =
    nowPlaying === null
      ? null
      : (snapshot?.watchProgress.find((entry) => entry.video.id === nowPlaying.video.id) ?? null);
  const preview = progress
    ? {
        art: progress.video.thumbnail ?? progress.title.background ?? progress.title.poster,
        title: progress.title.name,
        subtitle:
          [labelOf(progress.video), progress.video.name]
            .filter((part): part is string => Boolean(part))
            .join(" · ") || null,
      }
    : null;
  const showPreview = state === "opening" || (!previewSettled && Boolean(preview?.art));
  // The programme note names the Title alone: the episode is already on the
  // kicker's line, and a film is `Feature` there.
  const titleText = progress?.title.name ?? streamTitle(nowPlaying);

  const takeAction = (action: Action) => {
    void take(action);
  };

  const waitingText =
    stepSide === "previous" ? "Loading the previous episode…" : "Loading the next episode…";

  const onWheel = (event: WheelEvent<HTMLElement>) => {
    if (!controls || event.deltaY === 0) {
      return;
    }
    nudgeVolume(event.deltaY < 0 ? VOLUME_STEP : -VOLUME_STEP);
  };

  return (
    <section
      className="shell-player rep-player"
      aria-label="Playing"
      role="region"
      data-testid="shell-player"
      data-state={state}
      data-picture={picture}
      data-region="player"
      data-kind="branch"
      data-label="Player"
      onWheel={onWheel}
    >
      {/* The picture's hole. Where the picture is in this window the page
          paints nothing here and mpv's child window shows through; the button
          covering it is the largest control in the window, and pressing it
          squeezes or releases the Stream rather than merely summoning the
          OSD (ADR-0003). */}
      <div className="shell-player-picture" data-testid="picture" data-picture={picture} data-state={state}>
        {previewMode && picture === "in_window" && !showPreview && preview?.art ? (
          <div className="rep-player-still" data-testid="rehearsal-picture" aria-hidden="true">
            <img className="rep-player-still-art" src={preview.art} alt="" />
            <span className="rep-player-still-scrim" />
          </div>
        ) : null}
        {canTransport ? (
          <button
            ref={pictureButton}
            type="button"
            className="shell-picture-toggle"
            data-testid="picture-toggle"
            data-focusable
            data-player-stop="picture"
            aria-label="Play or pause"
            onClick={() => takeAction({ type: "set_paused", paused: playing })}
          />
        ) : null}
        {showPreview ? (
          <div
            className="shell-player-preview"
            data-testid="opening-preview"
            data-art={preview?.art ? "true" : "false"}
          >
            {preview?.art ? (
              <img
                className="shell-player-preview-art"
                data-testid="opening-preview-art"
                src={preview.art}
                alt=""
              />
            ) : null}
            <span className="shell-player-preview-scrim" aria-hidden="true" />
            <div className="shell-player-preview-copy">
              {preview?.title ? (
                <p className="shell-player-preview-title">{preview.title}</p>
              ) : null}
              {preview?.subtitle ? (
                <p className="shell-player-preview-subtitle">{preview.subtitle}</p>
              ) : null}
              {state === "opening" ? (
                <p className="shell-player-preview-note" data-testid="opening-stream">
                  {`Opening ${playingName(nowPlaying)}…`}
                </p>
              ) : null}
            </div>
          </div>
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
              <p className="rep-osd-kicker" data-testid="osd-kicker">
                <span>Now playing</span>
                <span className="rep-osd-kicker-rule" aria-hidden="true" />
                <span>{(episode ? `S${episode.season}E${episode.episode}` : (progress ? labelOf(progress.video) : null)) ?? "Feature"}</span>
              </p>
              <div className="shell-osd-line">
                {quality ? (
                  <span className="shell-osd-quality tabular" data-testid="osd-quality">
                    {quality}
                  </span>
                ) : null}
                <span className="shell-osd-title" data-testid="shell-now-playing">
                  {titleText}
                </span>
              </div>
              {details ? (
                <p className="shell-osd-details tabular" data-testid="osd-details">
                  {details}
                </p>
              ) : null}
            </div>

            <div className="shell-osd-window" data-player-stop="top" ref={top}>
              <FullscreenButton
                ref={fullscreen}
                className="shell-osd-icon"
                testId="fullscreen"
              />
              <button
                type="button"
                className="shell-osd-icon"
                data-focusable
                data-testid="stop"
                aria-label="Stop"
                title="Stop playback and return (Back)"
                onClick={() => takeAction({ type: "stop_playback" })}
              >
                <Icon name="close" strokeWidth={2.2} />
              </button>
            </div>
          </header>

          <div className="shell-osd-middle">
            <div className="shell-osd-spacer" />
            {controls ? (
              <VolumePillar
                playback={playback}
                sending={wheelVolume}
                onTake={takeAction}
              />
            ) : null}
          </div>

          <div className="shell-osd-bottom">
            {controls ? (
              <div
                className="shell-osd-strip"
                data-region="osd-strip"
                data-kind="row"
                data-label="Player controls"
                data-player-stop="strip"
                ref={strip}
              >
                <div className="shell-osd-cluster shell-osd-cluster-left">
                  <IconButton
                    testId="osd-picture"
                    label="Picture"
                    title="Picture — aspect, crop and statistics"
                    expanded={popover === osdPopoverId("picture")}
                    onClick={(event) => openPopover("picture", event.currentTarget)}
                  >
                    <Icon name="picture" strokeWidth={2} />
                  </IconButton>
                  <IconButton
                    testId="osd-subtitles"
                    label="Subtitles"
                    title="Subtitles"
                    expanded={popover === osdPopoverId("subtitles")}
                    onClick={(event) => openPopover("subtitles", event.currentTarget)}
                  >
                    <Icon name="subtitles" strokeWidth={2} />
                  </IconButton>
                  <IconButton
                    testId="osd-audio"
                    label="Audio"
                    title="Audio tracks"
                    expanded={popover === osdPopoverId("audio")}
                    onClick={(event) => openPopover("audio", event.currentTarget)}
                  >
                    <Icon name="audio" strokeWidth={2} />
                  </IconButton>
                </div>

                <div className="shell-osd-cluster shell-osd-cluster-center">
                  <IconButton
                    testId="previous-episode"
                    label="Previous episode"
                    title="Previous episode"
                    disabled={previousEpisodeDisabled(episode) || stepping}
                    pending={stepping && stepSide === "previous"}
                    onClick={() => void step("previous_episode")}
                  >
                    <Icon name="previous-episode" strokeWidth={2.2} />
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
                        <Icon name="rewind-10" strokeWidth={2.2} />
                      </IconButton>
                      <IconButton
                        testId={playing ? "pause" : "play"}
                        label={playing ? "Pause" : "Play"}
                        title={playing ? "Pause" : "Play"}
                        ref={playPause}
                        onClick={() => takeAction({ type: "set_paused", paused: playing })}
                      >
                        <Icon name={playing ? "pause" : "play"} strokeWidth={2.2} />
                      </IconButton>
                      <IconButton
                        testId="forward"
                        label="Forward ten seconds"
                        title="Forward 10 seconds"
                        className="shell-osd-glyph tabular"
                        onClick={() => takeAction({ type: "seek", target: { kind: "by", seconds: 10 } })}
                      >
                        <Icon name="forward-10" strokeWidth={2.2} />
                      </IconButton>
                    </>
                  ) : null}

                  <IconButton
                    testId="next-episode"
                    label="Next episode"
                    title="Next episode"
                    disabled={nextEpisodeDisabled(episode) || stepping}
                    pending={stepping && stepSide === "next"}
                    onClick={() => void step("next_episode")}
                  >
                    <Icon name="next-episode" strokeWidth={2.2} />
                  </IconButton>
                </div>

                <div className="shell-osd-cluster shell-osd-cluster-right">
                  <IconButton
                    testId="osd-speed"
                    label="Playback speed"
                    title="Playback speed"
                    expanded={popover === osdPopoverId("speed")}
                    onClick={(event) => openPopover("speed", event.currentTarget)}
                  >
                    <Icon name="speed" strokeWidth={2} />
                    <span className="rep-osd-speed-value tabular">
                      {formatSpeed(playback.speed ?? 1)}
                    </span>
                  </IconButton>
                  <IconButton
                    testId="osd-chapters"
                    label="Chapters"
                    title="Chapters"
                    expanded={popover === osdPopoverId("chapters")}
                    onClick={(event) => openPopover("chapters", event.currentTarget)}
                  >
                    <Icon name="chapters" strokeWidth={2} />
                  </IconButton>
                </div>
              </div>
            ) : null}

            {state === "ended" && !nextEpisodeDisabled(episode) ? (
              <div className="shell-osd-ended">
                <Button
                  variant="primary"
                  data-testid="next-episode-after-end"
                  disabled={stepping}
                  pending={stepping && stepSide === "next"}
                  onClick={() => void step("next_episode")}
                >
                  Next episode
                </Button>
              </div>
            ) : null}

            <AnimatePresence initial={false}>
              {stepping ? (
                <OsdRise
                  className="shell-osd-waiting"
                  role="status"
                  data-testid="episode-loading"
                >
                  {waitingText}
                </OsdRise>
              ) : null}
            </AnimatePresence>

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
  sending,
  onTake,
}: {
  playback: PlaybackSnapshot;
  /** The level the wheel is about to send, drawn until the Host agrees. */
  sending: number | null;
  onTake: (action: Action) => void;
}) {
  const [scrub, setScrub] = useState<number | null>(null);
  const shown = scrub ?? sending ?? Math.round(playback.volume ?? 100);
  const muted = playback.muted ?? false;

  const send = (level: number) => {
    setScrub(null);
    onTake({ type: "set_volume", level });
  };

  const fraction = volumeFraction(shown);

  return (
    <OsdRise
      className="shell-osd-volume"
      data-region="osd-volume"
      data-kind="row"
      data-label="Volume"
    >
      <span className="rep-osd-volume-label" aria-hidden="true">
        Vol
      </span>
      <span className="shell-osd-volume-level tabular" data-testid="volume-level">
        {formatVolume(shown)}
      </span>
      <span className="rep-osd-fader" data-testid="volume-rail">
        <span className="rep-osd-fader-rail" aria-hidden="true" />
        <span
          className="rep-osd-fader-fill"
          data-testid="volume-fill"
          style={{ height: `${fraction * 100}%` }}
          aria-hidden="true"
        />
        <span
          className="rep-osd-fader-playhead"
          style={{ bottom: `${fraction * 100}%` }}
          aria-hidden="true"
        />
        <input
          type="range"
          className="rep-osd-fader-input"
          aria-label="Volume"
          data-testid="volume"
          min={0}
          max={VOLUME_MAX}
          step={1}
          value={shown}
          onChange={(event) => setScrub(Number(event.target.value))}
          onPointerUp={() => scrub !== null && send(scrub)}
          onKeyUp={() => scrub !== null && send(scrub)}
          data-focusable
        />
      </span>
      <button
        type="button"
        className="shell-osd-icon"
        data-focusable
        data-testid="mute"
        aria-label={muted ? "Unmute" : "Mute"}
        aria-pressed={muted}
        title={muted ? "Unmute" : "Mute"}
        onClick={() => onTake({ type: "set_muted", muted: !muted })}
      >
        <Icon name={muted ? "volume-muted" : "volume"} strokeWidth={2} />
      </button>
    </OsdRise>
  );
}

/**
 * A plate that rises on the panel spring (design record §6).
 */
function OsdRise({
  className,
  children,
  ...rest
}: {
  className: string;
  children: ReactNode;
  role?: string;
  "data-testid"?: string;
  "data-region"?: string;
  "data-kind"?: string;
  "data-label"?: string;
}) {
  const reducedMotion = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: POPOVER_RISE_PX }}
      animate={reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
      exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: POPOVER_RISE_PX }}
      transition={reducedMotion ? fade() : panel()}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

/**
 * The flush bottom timeline: the track, its chapter ticks with hover
 * callouts, and the two tabular clocks. The range input is only drawn while the
 * Host would take a seek — the same state gate the old transport had — and it
 * covers the whole bar when it is.
 *
 * Pointing at the bar asks the Host for the still of that moment (ADR-0028):
 * one ask in flight, the newest bucket winning, and the still already drawn
 * staying under the pointer — dimmed — until its successor arrives. A Host that
 * cannot produce one answers with nothing, and the tooltip is then the time and
 * the chapter alone.
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
  const { duration, chapters } = playback;
  const [scrub, setScrub] = useState<number | null>(null);
  const [point, setPoint] = useState<{ at: number; fraction: number } | null>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  const track = useRef<HTMLDivElement | null>(null);
  const preview = usePreview(streamKey(playback.nowPlaying));
  const at = scrub ?? shown;
  const fraction = timelineFraction(at, duration);
  const buffered = bufferedSpan(playback.buffered, duration);
  const allMarks = chapterMarks(chapters, duration);
  // The timeline keeps its ticks at least 24px apart (design record §8); a
  // track that has not been measured yet keeps every mark.
  const marks = spacedChapterMarks(allMarks, trackWidth);
  const dense = marks.length < allMarks.length;
  const left = formatTime(at);
  const right = remainingTime(at, duration);
  const chapter = point ? chapterAt(chapters, point.at) : null;

  useEffect(() => {
    const node = track.current;
    if (!node) {
      return;
    }
    const measure = () => setTrackWidth(node.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver(measure);
      observer.observe(node);
      return () => observer.disconnect();
    }
    // A browser without ResizeObserver still has the window's own resize.
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const take = (seconds: number) => {
    setScrub(null);
    onSeek(seconds);
  };

  /** Where on the bar the pointer is, in seconds from the Stream's start. */
  const pointed = (event: PointerEvent<HTMLDivElement>) => {
    if (duration === null || !Number.isFinite(duration) || duration <= 0) {
      return;
    }
    const bar = event.currentTarget.getBoundingClientRect();
    if (bar.width <= 0) {
      return;
    }
    const fraction = Math.min(1, Math.max(0, (event.clientX - bar.left) / bar.width));
    const seconds = fraction * duration;
    setPoint({ at: seconds, fraction });
    preview.point(seconds);
  };

  const unpoint = () => {
    setPoint(null);
    preview.point(null);
  };

  return (
    <div
      className="shell-osd-timeline"
      data-testid="osd-timeline"
      onPointerMove={pointed}
      onPointerLeave={unpoint}
    >
      <div className="shell-osd-track" aria-hidden="true" ref={track}>
        {buffered && (
          <span
            className="shell-osd-buffered"
            data-testid="osd-buffered"
            style={{ left: `${buffered.left * 100}%`, width: `${buffered.width * 100}%` }}
          />
        )}
        <span className="shell-osd-progress" style={{ width: `${fraction * 100}%` }} />
        <span className="shell-osd-playhead" style={{ left: `${fraction * 100}%` }} />
        {marks.map(({ chapter, fraction: atFraction }) => (
          <span
            key={chapter.index}
            className="shell-osd-chapter"
            data-testid={`chapter-marker-${chapter.index}`}
            style={{ left: `${atFraction * 100}%` }}
          >
            <span className="rep-osd-chapter-tick" aria-hidden="true" />
            {dense ? null : (
              <span className="shell-osd-callout">
                <span className="shell-osd-callout-name">{chapterName(chapter)}</span>
                <span className="shell-osd-callout-time tabular">{formatTime(chapter.time)}</span>
              </span>
            )}
          </span>
        ))}
      </div>

      {point ? (
        <div
          className="shell-osd-preview"
          data-testid="osd-preview"
          data-pending={preview.waiting ? "true" : "false"}
          style={{ left: `${Math.min(94, Math.max(6, point.fraction * 100))}%` }}
        >
          {preview.still ? (
            <img
              className="shell-osd-preview-still"
              data-testid="osd-preview-still"
              src={preview.still.image}
              alt=""
            />
          ) : null}
          <span className="shell-osd-preview-time tabular" data-testid="osd-preview-time">
            {formatTime(point.at)}
          </span>
          {chapter ? (
            <span className="shell-osd-preview-chapter" data-testid="osd-preview-chapter">
              {chapterName(chapter)}
            </span>
          ) : null}
        </div>
      ) : null}

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
  pressed,
  disabled,
  pending = false,
  className,
  onClick,
  ref,
  children,
}: {
  testId: string;
  label: string;
  title?: string;
  expanded?: boolean;
  pressed?: boolean;
  disabled?: boolean;
  /** Whether the Action this control asked for is still in flight (#137). */
  pending?: boolean;
  className?: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  ref?: Ref<HTMLButtonElement>;
  children: ReactNode;
}) {
  return (
    <button
      ref={ref}
      type="button"
      className={`shell-osd-icon${className ? ` ${className}` : ""}`}
      data-focusable
      data-testid={testId}
      aria-label={label}
      aria-expanded={expanded}
      aria-pressed={pressed}
      aria-busy={pending || undefined}
      data-pending={pending ? "true" : undefined}
      title={title ?? label}
      disabled={disabled || pending}
      onClick={onClick}
    >
      {pending ? <PendingSpinner /> : children}
    </button>
  );
}
