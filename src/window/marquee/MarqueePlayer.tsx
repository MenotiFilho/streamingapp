import { AnimatePresence, motion } from "motion/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type WheelEvent,
} from "react";

import { answeredTitle } from "../../core/answers";
import { AUTOPLAY_SWITCH_LABEL, VOLUME_MAX, autoplayOn } from "../../core/controls";
import { missingStreamVideo, opensPicker, plainEnd, autoplayView } from "../../core/autoplay";
import { seriesAction, seriesRef } from "../../core/episodes";
import type { ActionError } from "../../core/errors";
import type { Intent } from "../../core/input";
import {
  marqueeEpisodeCode,
  marqueeTopBarFacts,
  marqueeTopBarSubtitle,
  nextPlayerStop,
  osdPinned,
  type MarqueePlayerStop,
} from "../../core/osd";
import { useMissingStream } from "../../core/react/useMissingStream";
import { usePlaybackView } from "../../core/react/usePlaybackView";
import { usePreview } from "../../core/react/usePreview";
import { useReducedMotion } from "../../core/react/useReducedMotion";
import { useStallShown } from "../../core/react/useStallShown";
import { playingName } from "../../core/playback";
import { transportControls, type TransportControl, type TransportControlId } from "../../core/transportControls";
import type { Action, Chapter } from "../../core/wire";
import { Button } from "../../kit/marquee/Button";
import { Opening } from "../../kit/marquee/Opening";
import { PlayerControls, type PlayerControlId } from "../../kit/marquee/PlayerControls";
import { PlayerTopBar } from "../../kit/marquee/PlayerTopBar";
import { SeekBar } from "../../kit/marquee/SeekBar";
import { Spinner } from "../../kit/marquee/Spinner";
import { StillWatchingCard } from "../../kit/marquee/StillWatchingCard";
import { Switch } from "../../kit/marquee/Switch";
import { UpNextCard } from "../../kit/marquee/UpNextCard";
import { fade, panel } from "../../kit/marquee/motion";
import { openingPhase } from "../../kit/marquee/openingPhase";
import type { PlayerMenuId } from "../../kit/marquee/playerMenus";
import { SEEK_STEP_SECONDS, seekable } from "../../kit/marquee/seekMath";
import { useShell } from "../context";
import { episodesMenuVisible } from "../episodesMenu";
import { FOCUSABLE } from "../layout";
import { Refusal } from "../Refusal";
import { usePreviewData } from "../repertory/context";
import { focusAndReveal } from "../reveal";
import { useFullscreen } from "../useFullscreen";
import { useOsdVisibility } from "../useOsdVisibility";
import { POPOVER_RISE_PX } from "./frame";
import { marqueePanelId, marqueePanelLevel, type MarqueePanelName } from "./MarqueePlayerPanels";
import { MarqueeStreamsLoader } from "./MarqueeStreams";
import "./player.css";

const VOLUME_STEP = 5;

const NEXT_EPISODE: Action = { type: "next_episode" };

function stopOf(element: Element | null): MarqueePlayerStop {
  const stop =
    element instanceof HTMLElement
      ? element.closest<HTMLElement>("[data-player-stop]")?.dataset.playerStop
      : undefined;
  return stop === "picture" || stop === "top" || stop === "seek" ? stop : "strip";
}

function usable(element: HTMLElement | null, cluster: HTMLElement | null): element is HTMLElement {
  return Boolean(
    element &&
      element.isConnected &&
      element.matches(FOCUSABLE) &&
      (!cluster || cluster.contains(element)),
  );
}

function chapterName(chapter: Chapter): string {
  return chapter.title ?? `Chapter ${chapter.index + 1}`;
}

function isPanelMenuId(value: string): value is MarqueePanelName {
  return (
    value === "picture" ||
    value === "audio-subtitles" ||
    value === "streams" ||
    value === "episodes" ||
    value === "speed" ||
    value === "chapters" ||
    value === "details"
  );
}

/**
 * The Marquee `in_window` player (`07.jpg`–`13.jpg`, `08b.jpg`–`08f.jpg`):
 * mpv owns the video surface behind a transparent OSD layer.
 */
export function MarqueePlayer() {
  const { session, snapshot, take, ask, popover, pop, push, remove, setIntentHandler } = useShell();
  const previewMode = usePreviewData();
  const { fullscreen, supported: fullscreenSupported, toggle: toggleFullscreen } = useFullscreen();
  const playback = snapshot?.playback ?? null;
  const [refusal, setRefusal] = useState<ActionError | null>(null);
  const [steppingNext, setSteppingNext] = useState(false);
  const [wheelVolume, setWheelVolume] = useState<number | null>(null);
  const [previewSettled, setPreviewSettled] = useState(() => playback?.state !== "opening");
  const [pointSeconds, setPointSeconds] = useState<number | null>(null);

  const root = useRef<HTMLElement | null>(null);
  const chrome = useRef<HTMLDivElement | null>(null);
  const cardWrap = useRef<HTMLElement | null>(null);
  const pictureButton = useRef<HTMLButtonElement | null>(null);
  const strip = useRef<HTMLDivElement | null>(null);
  const seekWrap = useRef<HTMLDivElement | null>(null);
  const top = useRef<HTMLDivElement | null>(null);

  const rememberedStrip = useRef<HTMLElement | null>(null);
  const rememberedSeek = useRef<HTMLElement | null>(null);
  const rememberedTop = useRef<HTMLElement | null>(null);
  const pendingStop = useRef<MarqueePlayerStop | null>(null);
  const steppingRef = useRef(false);
  const sawOpening = useRef(false);
  const initialFocused = useRef(false);
  const wheel = useRef<{ level: number | null; timer: ReturnType<typeof setTimeout> | null }>({
    level: null,
    timer: null,
  });

  useEffect(
    () => () => {
      if (wheel.current.timer !== null) {
        clearTimeout(wheel.current.timer);
      }
    },
    [],
  );

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

  const pendingAutoplay = autoplayView({ autoplay: playback?.autoplay ?? null }, 0);
  const counting =
    pendingAutoplay.kind === "countdown" || pendingAutoplay.kind === "still_watching";

  const latestPicker = useRef({ snapshot, popover });
  latestPicker.current = { snapshot, popover };
  const onPlayerLevel = () =>
    root.current !== null &&
    root.current.isConnected &&
    !root.current.closest("[inert]") &&
    latestPicker.current.popover === null;

  useMissingStream(
    pendingAutoplay,
    (previous, now) => opensPicker(previous, now) && onPlayerLevel(),
    ({ next }) => {
      const nowPlaying = latestPicker.current.snapshot?.playback.nowPlaying ?? null;
      if (nowPlaying === null) {
        return;
      }
      void ask(seriesAction(seriesRef(latestPicker.current.snapshot, nowPlaying))).then(
        ({ response, error }) => {
          const title = error ? null : answeredTitle(response);
          if (title === null || !onPlayerLevel()) {
            return;
          }
          const id = push({
            name: "Streams",
            kind: "overlay",
            payload: {
              render: () => (
                <MarqueeStreamsLoader
                  title={title}
                  video={missingStreamVideo(title, next)}
                  onOpened={() => remove(id)}
                />
              ),
            },
          });
        },
      );
    },
  );

  const { visible, cursorVisible, wake } = useOsdVisibility({
    pinned: osdPinned({ popoverOpen: popover !== null, autoplay: pendingAutoplay }),
    chrome,
    onHide: () => focusAndReveal(pictureButton.current),
  });

  const view = usePlaybackView(session, visible || counting);
  const stallUp = useStallShown(playback?.stalled ?? false);
  const preview = usePreview(view?.streamKey ?? null, ask);

  const canControl = view?.controllable ?? false;
  const canTransport = view?.transportable ?? false;
  const canSeek = canTransport && seekable(view?.duration ?? null);

  const focusStop = useCallback((stop: MarqueePlayerStop): boolean => {
    if (stop === "picture") {
      const picture = pictureButton.current;
      if (!picture) {
        return false;
      }
      focusAndReveal(picture);
      return true;
    }

    const cluster =
      stop === "strip" ? strip.current : stop === "seek" ? seekWrap.current : top.current;
    const remembered =
      stop === "strip"
        ? rememberedStrip.current
        : stop === "seek"
          ? rememberedSeek.current
          : rememberedTop.current;
    const preferred =
      stop === "strip"
        ? (cluster?.querySelector<HTMLElement>(
            'button[aria-label="Pause"], button[aria-label="Play"]',
          ) ?? null)
        : null;

    for (const candidate of [remembered, preferred]) {
      if (usable(candidate, cluster)) {
        focusAndReveal(candidate);
        return true;
      }
    }

    const first =
      cluster?.querySelector<HTMLElement>(FOCUSABLE) ??
      chrome.current?.querySelector<HTMLElement>(FOCUSABLE) ??
      null;
    if (!first) {
      return false;
    }
    focusAndReveal(first);
    return true;
  }, []);

  // Focus starts on Play/Pause when the OSD mounts in a transportable state (`07.jpg`).
  useEffect(() => {
    if (initialFocused.current || !visible || counting || popover !== null || !canTransport) {
      return;
    }
    if (focusStop("strip")) {
      initialFocused.current = true;
    }
  }, [canTransport, counting, focusStop, popover, visible]);

  // Focus lands on Cancel (Up next) or Keep watching (Still watching?) when the card appears.
  useEffect(() => {
    if (!counting || popover !== null || root.current?.closest("[inert]")) {
      return;
    }
    const label = pendingAutoplay.kind === "countdown" ? "Cancel" : "Keep watching";
    const target = Array.from(
      cardWrap.current?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    ).find((button) => button.textContent?.trim() === label);
    if (target) {
      focusAndReveal(target);
    }
  }, [counting, pendingAutoplay.kind, popover]);

  useEffect(() => {
    if (!visible) {
      rememberedStrip.current = null;
      rememberedSeek.current = null;
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
      } else if (seekWrap.current?.contains(target)) {
        rememberedSeek.current = target;
      } else if (top.current?.contains(target)) {
        rememberedTop.current = target;
      }
    };

    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, [visible]);

  useEffect(() => {
    const stop = pendingStop.current;
    if (!stop) {
      return;
    }
    pendingStop.current = null;
    focusStop(stop);
  });

  const stepNextEpisode = useCallback(async () => {
    if (steppingRef.current) {
      return;
    }
    steppingRef.current = true;
    setRefusal(null);
    setSteppingNext(true);
    try {
      const { error } = await ask(NEXT_EPISODE);
      if (error) {
        setRefusal(error);
      }
    } finally {
      steppingRef.current = false;
      setSteppingNext(false);
    }
  }, [ask]);

  const nudgeVolume = useCallback(
    (delta: number) => {
      if (!view) {
        return;
      }
      const current = wheel.current.level ?? view.volume.level;
      const next = Math.min(VOLUME_MAX, Math.max(0, Math.round(current + delta)));
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
    },
    [take, view],
  );

  const handleIntent = (intent: Intent): boolean => {
    if (intent === "volume_up" || intent === "volume_down") {
      wake("key");
      if (!canControl) {
        return false;
      }
      nudgeVolume(intent === "volume_up" ? VOLUME_STEP : -VOLUME_STEP);
      return true;
    }

    if (intent !== "up" && intent !== "down" && intent !== "left" && intent !== "right") {
      return false;
    }

    wake("key");

    if (intent === "left" || intent === "right") {
      // Gamepad Left/Right while SeekBar is focused steps playback; keyboard
      // arrows were already handled and prevented by SeekBar's own key handler.
      if (visible && stopOf(document.activeElement) === "seek" && canSeek) {
        void take({
          type: "seek",
          target: { kind: "by", seconds: intent === "left" ? -SEEK_STEP_SECONDS : SEEK_STEP_SECONDS },
        });
        return true;
      }
      return false;
    }

    const here: MarqueePlayerStop = visible ? stopOf(document.activeElement) : "picture";
    const next = nextPlayerStop(here, intent, { canSeek, canTransport });
    if (!next) {
      return true;
    }
    if (!visible) {
      pendingStop.current = next;
      return true;
    }
    return focusStop(next);
  };

  useEffect(() => {
    setIntentHandler(handleIntent);
  });

  const handleMenu = useCallback(
    (menu: PlayerMenuId) => {
      if (menu === "fullscreen") {
        void toggleFullscreen();
        return;
      }
      if (!isPanelMenuId(menu)) {
        return;
      }
      const id = marqueePanelId(menu);
      if (popover === id) {
        pop();
        return;
      }
      if (popover !== null) {
        pop();
      }
      push(marqueePanelLevel(menu));
    },
    [pop, popover, push, toggleFullscreen],
  );

  const { point: pointPreview } = preview;
  const handlePoint = useCallback(
    (seconds: number | null) => {
      const whole = seconds === null ? null : Math.floor(seconds);
      setPointSeconds((current) => (current === whole ? current : whole));
      pointPreview(seconds);
    },
    [pointPreview],
  );

  if (!playback || !view) {
    return null;
  }

  const allControls = transportControls(view);
  const controlOf = (id: TransportControlId): TransportControl =>
    allControls.find((held) => held.id === id)!;
  const rewind = controlOf("rewind");
  const playPauseControl = controlOf("playPause");
  const forward = controlOf("forward");
  const nextEpisode = controlOf("next");

  const stepping = steppingNext || nextEpisode.pending;
  const state = view.state;
  const picture = view.picture;
  const episodesMenu = episodesMenuVisible(playback);
  const showPreview =
    view.state === "opening" || (!previewSettled && Boolean(view.openingPreview?.art));
  const phase = openingPhase(playback);

  const takeAction = (action: Action) => {
    void take(action);
  };

  const openMenu: PlayerMenuId | null =
    popover?.startsWith("popover-") && isPanelMenuId(popover.slice("popover-".length))
      ? (popover.slice("popover-".length) as PlayerMenuId)
      : null;

  const availableMenus: PlayerMenuId[] = [
    "picture",
    "audio-subtitles",
    "streams",
    ...(episodesMenu ? (["episodes"] as const) : []),
    "speed",
    "chapters",
    "details",
    ...(fullscreenSupported ? (["fullscreen"] as const) : []),
  ];

  const pendingControls: PlayerControlId[] = [
    ...(rewind.pending ? (["rewind"] as const) : []),
    ...(playPauseControl.pending ? (["playPause"] as const) : []),
    ...(forward.pending ? (["forward"] as const) : []),
    ...(stepping ? (["nextEpisode"] as const) : []),
  ];

  const subtitle = marqueeTopBarSubtitle(playback, snapshot?.watchProgress ?? []);
  const facts = marqueeTopBarFacts(playback.nowPlaying);
  const pointedChapter = pointSeconds !== null ? view.chapterAt(pointSeconds) : null;
  const pointedChapterName = pointedChapter ? chapterName(pointedChapter) : null;

  const onWheel = (event: WheelEvent<HTMLElement>) => {
    if (!canControl || event.deltaY === 0) {
      return;
    }
    nudgeVolume(event.deltaY < 0 ? VOLUME_STEP : -VOLUME_STEP);
  };

  return (
    <section
      ref={root}
      className="mq-player"
      aria-label="Playing"
      role="region"
      data-testid="shell-player"
      data-state={state}
      data-picture={picture}
      data-cursor={cursorVisible ? "visible" : "hidden"}
      data-region="player"
      data-kind="branch"
      data-label="Player"
      onWheel={onWheel}
    >
      <div
        className="mq-player-picture"
        data-testid="picture"
        data-picture={picture}
        data-state={state}
      >
        {previewMode && picture === "in_window" && !showPreview && view.openingPreview?.art ? (
          <div className="mq-player-still" data-testid="rehearsal-picture" aria-hidden="true">
            <img className="mq-player-still-art" src={view.openingPreview.art} alt="" />
            <span className="mq-player-still-scrim" />
          </div>
        ) : null}

        {canTransport ? (
          <button
            ref={pictureButton}
            type="button"
            className="mq-picture-toggle"
            data-testid="picture-toggle"
            data-focusable
            data-player-stop="picture"
            aria-label="Play or pause"
            onClick={() => takeAction({ type: "set_paused", paused: view.state === "playing" })}
          />
        ) : null}

        {showPreview && phase ? (
          <div
            className="mq-player-opening"
            data-testid="opening-preview"
            data-art={view.openingPreview?.art ? "true" : "false"}
          >
            {view.openingPreview?.art ? (
              <img
                className="mq-player-opening-art"
                data-testid="opening-preview-art"
                src={view.openingPreview.art}
                alt=""
              />
            ) : null}
            <span className="mq-player-opening-dim" aria-hidden="true" />
            <div className="mq-player-opening-center" data-testid="opening-stream">
              <Opening
                title={view.openingPreview?.title ?? view.title}
                logo={view.openingPreview?.logo ?? view.logo}
                phase={phase}
                detail={
                  state === "opening"
                    ? (view.torrentLine ?? `Opening ${playingName(view.nowPlaying)}…`)
                    : null
                }
              />
            </div>
          </div>
        ) : null}

        {stallUp ? (
          <div className="mq-player-stalled" data-testid="stall-card">
            <Spinner />
          </div>
        ) : null}

        {state === "ended" && plainEnd(view.autoplay) ? (
          <p className="mq-player-ended-note" data-testid="stream-ended">
            The Stream reached its end.
          </p>
        ) : null}
      </div>

      {view.autoplay.kind === "countdown" ? (
        <>
          <div className="mq-player-autoplay-scrim" aria-hidden="true" />
          <aside
            ref={cardWrap}
            className="mq-player-autoplay"
            data-testid="autoplay-card"
            data-region="autoplay-card"
            data-kind="row"
            data-label="Up next"
          >
            <UpNextCard
              episode={marqueeEpisodeCode(view.autoplay.next.episode)}
              name={view.autoplay.next.name}
              still={view.autoplay.next.still}
              secondsLeft={view.autoplay.digit}
              fraction={view.autoplay.fraction}
              pending={stepping}
              onPlayNow={() => void stepNextEpisode()}
              onCancel={() => takeAction({ type: "cancel_autoplay" })}
            />
          </aside>
        </>
      ) : view.autoplay.kind === "still_watching" ? (
        <>
          <div className="mq-player-still-dim" aria-hidden="true" />
          <aside
            ref={cardWrap}
            className="mq-player-autoplay"
            data-testid="autoplay-card"
            data-region="autoplay-card"
            data-kind="row"
            data-label="Still watching?"
          >
            <StillWatchingCard
              next={
                view.autoplay.next.name
                  ? `${marqueeEpisodeCode(view.autoplay.next.episode)} · ${view.autoplay.next.name}`
                  : marqueeEpisodeCode(view.autoplay.next.episode)
              }
              pending={stepping}
              onKeepWatching={() => void stepNextEpisode()}
              onStop={() => takeAction({ type: "stop_playback" })}
            />
          </aside>
        </>
      ) : null}

      {visible ? (
        <div className="mq-player-osd" data-testid="shell-osd" ref={chrome}>
          <div className="mq-player-bottom-scrim" aria-hidden="true" />

          <div
            ref={top}
            className="mq-player-top"
            data-region="osd-top"
            data-kind="row"
            data-label="Player top bar"
            data-player-stop="top"
          >
            <PlayerTopBar
              title={view.title}
              subtitle={subtitle}
              facts={facts}
              onBack={() => takeAction({ type: "stop_playback" })}
              onClose={() => takeAction({ type: "stop_playback" })}
            />
          </div>

          <div className="mq-player-bottom">
            <AnimatePresence initial={false}>
              {stepping ? (
                <OsdRise className="mq-player-waiting" role="status" data-testid="episode-loading">
                  Loading the next episode…
                </OsdRise>
              ) : null}
            </AnimatePresence>

            {refusal ? (
              <div className="mq-player-refusal">
                <Refusal error={refusal} testId="osd-refusal" />
              </div>
            ) : null}

            {canControl ? (
              <>
                <div
                  ref={seekWrap}
                  className="mq-player-seek"
                  data-region="osd-seek"
                  data-kind="row"
                  data-label="Seek bar"
                  data-player-stop="seek"
                >
                  <SeekBar
                    position={view.position}
                    duration={view.duration}
                    buffered={playback.buffered}
                    chapters={view.chapters}
                    still={preview.still?.image ?? null}
                    chapterName={pointedChapterName}
                    disabled={!canTransport}
                    onPoint={handlePoint}
                    onCommit={(seconds) =>
                      takeAction({ type: "seek", target: { kind: "to", seconds } })
                    }
                  />
                </div>

                <div
                  ref={strip}
                  className="mq-player-strip"
                  data-region="osd-strip"
                  data-kind="row"
                  data-label="Player controls"
                  data-player-stop="strip"
                >
                  <PlayerControls
                    playing={view.state === "playing"}
                    volume={wheelVolume ?? view.volume.level}
                    muted={view.volume.muted}
                    disabled={!canTransport}
                    onPlayPause={() => takeAction(playPauseControl.action)}
                    onSeekBy={(seconds) =>
                      takeAction({ type: "seek", target: { kind: "by", seconds } })
                    }
                    onToggleMute={() =>
                      takeAction({ type: "set_muted", muted: !view.volume.muted })
                    }
                    onVolume={(level) => takeAction({ type: "set_volume", level })}
                    onNextEpisode={() => void stepNextEpisode()}
                    nextEpisodeDisabled={nextEpisode.disabled || stepping}
                    menus={availableMenus}
                    openMenu={openMenu}
                    fullscreen={fullscreen}
                    pending={pendingControls}
                    onMenu={handleMenu}
                  />
                </div>
              </>
            ) : null}

            {state === "ended" && plainEnd(view.autoplay) && !nextEpisode.disabled ? (
              <div
                className="mq-player-ended-actions"
                data-region="osd-ended"
                data-kind="row"
                data-label="Next episode"
              >
                <Button
                  kind="primary"
                  size="lg"
                  data-testid="next-episode-after-end"
                  disabled={stepping}
                  onClick={() => void stepNextEpisode()}
                >
                  Next episode
                </Button>
                {playback.episode ? (
                  <div className="mq-player-autoplay-toggle">
                    <span className="mq-player-autoplay-label">{AUTOPLAY_SWITCH_LABEL}</span>
                    <Switch
                      checked={autoplayOn(snapshot)}
                      label={AUTOPLAY_SWITCH_LABEL}
                      data-testid="autoplay-switch"
                      onChange={(autoplay) => void take({ type: "set_autoplay", autoplay })}
                    />
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function OsdRise({
  className,
  children,
  ...rest
}: {
  className: string;
  children: ReactNode;
  role?: string;
  "data-testid"?: string;
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
