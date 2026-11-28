import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { answeredTitle } from "../../core/answers";
import {
  endOfPlaybackDecision,
  hasAiredNextEpisode,
  matchesTitleIdentity,
} from "../../core/endOfPlayback";
import { seriesAction, type SeriesRef } from "../../core/episodes";
import { explain } from "../../core/errors";
import type { Intent } from "../../core/input";
import type { HostLink } from "../../core/link";
import { closingAfter, pictureBehind, requestsStop } from "../../core/playback";
import { useNavigation } from "../../core/react/useNavigation";
import { useSession } from "../../core/react/useSession";
import type { Action, PlaybackState, Response, Title } from "../../core/wire";
import { ShellContext } from "../context";
import type { Destination, ShellLevel, WindowPayload } from "../navigation";
import { PlayerDock, dockedTransport } from "../PlayerDock";
import { TauriLink } from "../tauriLink";
import { MarqueeFrame } from "./MarqueeFrame";
import { MarqueePlayer } from "./MarqueePlayer";
import { MarqueeDestinationScreen, marqueeTitleLevelOf } from "./MarqueeScreens";

const PLAYER_LEVEL = "player";

/**
 * The Marquee window shell: connects the Session over `TauriLink` (or a test /
 * rehearsal `HostLink`), provides `ShellContext`, manages the pushed Level
 * stack, and renders `MarqueeFrame`.
 */
export function MarqueeShell({ client }: { client?: HostLink }) {
  const link = useMemo(() => client ?? new TauriLink(), [client]);
  const { session, state } = useSession(link);
  const { snapshot, error, unplayable, pending } = state;
  const { ask, take: takeAction, markUnplayable, home, hint } = session;
  const nav = useNavigation<WindowPayload>();
  const [closing, setClosing] = useState(false);
  const [chosenDestination, setChosenDestination] = useState(false);
  const levelsRef = useRef(nav.levels);
  levelsRef.current = nav.levels;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const previousPlaybackState = useRef<PlaybackState | null>(null);

  const playerIntent = useRef<((intent: Intent) => boolean) | null>(null);
  const setIntentHandler = useCallback((handler: ((intent: Intent) => boolean) | null) => {
    playerIntent.current = handler;
  }, []);
  const baseIntent = useRef<((intent: Intent) => boolean) | null>(null);
  const setBaseIntentHandler = useCallback(
    (handler: ((intent: Intent) => boolean) | null) => {
      baseIntent.current = handler;
      return () => {
        if (baseIntent.current === handler) {
          baseIntent.current = null;
        }
      };
    },
    [],
  );

  const {
    choose: chooseDestination,
    push,
    pushBefore,
    remove,
    removeFrom,
    pop,
    back: backStack,
  } = nav;

  const choose = useCallback(
    (destination: Destination) => {
      setChosenDestination(true);
      chooseDestination(destination);
    },
    [chooseDestination],
  );

  const levelExists = useCallback(
    (id: string) => levelsRef.current.some((level) => level.id === id),
    [],
  );

  const playback = snapshot?.playback ?? null;
  const takeWithStop = useCallback(
    async (action: Action): Promise<Response | null> => {
      if (!requestsStop(action)) {
        return takeAction(action);
      }
      setClosing(true);
      const response = await takeAction(action);
      if (response === null) {
        setClosing(false);
      }
      return response;
    },
    [takeAction],
  );

  useEffect(() => {
    if (closing && !closingAfter(closing, playback)) {
      setClosing(false);
    }
  }, [closing, playback]);

  const playerActive = pictureBehind(playback, false);
  const docked =
    playback !== null && dockedTransport(playback.state, playback.picture);
  const popover = nav.levels.find((level) => level.kind === "popover")?.id ?? null;

  const back = useCallback(() => {
    const top = nav.levels[nav.levels.length - 1];
    if (top?.payload.onBack?.()) {
      return;
    }
    if (top?.kind === "player") {
      void takeWithStop({ type: "stop_playback" });
      return;
    }
    backStack();
  }, [nav.levels, backStack, takeWithStop]);

  useEffect(() => {
    if (!playerActive) {
      playerIntent.current = null;
      removeFrom(PLAYER_LEVEL);
      return;
    }
    const player: ShellLevel = {
      id: PLAYER_LEVEL,
      name: "Playing",
      kind: "player",
      payload: {
        render: () => <MarqueePlayer />,
        onIntent: (intent) => playerIntent.current?.(intent) ?? false,
      },
    };
    push(player);
  }, [playerActive, push, removeFrom]);

  useEffect(() => {
    const previous = previousPlaybackState.current;
    previousPlaybackState.current = playback?.state ?? null;

    if (!playerActive || snapshot === null) {
      return;
    }
    const decision = endOfPlaybackDecision(previous, snapshot, new Date());
    if (decision.kind === "stay") {
      return;
    }

    const endedVideoId = snapshot.playback.nowPlaying?.video.id ?? null;
    if (endedVideoId === null) {
      return;
    }

    const stillEnded = () => {
      const latest = snapshotRef.current?.playback ?? null;
      return (
        latest !== null &&
        pictureBehind(latest, false) &&
        latest.state === "ended" &&
        latest.nowPlaying?.video.id === endedVideoId
      );
    };

    const trimToExistingTitle = (ref: SeriesRef): boolean => {
      const levels = levelsRef.current;
      const playerIndex = levels.findIndex((level) => level.id === PLAYER_LEVEL);
      const limit = playerIndex < 0 ? levels.length : playerIndex;
      for (let i = limit - 1; i >= 0; i -= 1) {
        const candidate = levels[i]?.payload.title;
        if (candidate && matchesTitleIdentity(candidate, ref)) {
          for (let j = i + 1; j < limit; j += 1) {
            const between = levels[j];
            if (between) {
              remove(between.id);
            }
          }
          return true;
        }
      }
      return false;
    };

    const landOnTitleAndStop = (ref: SeriesRef, loaded?: Title | null) => {
      if (trimToExistingTitle(ref)) {
        void takeWithStop({ type: "stop_playback" });
        return;
      }
      if (loaded) {
        pushBefore(PLAYER_LEVEL, marqueeTitleLevelOf(loaded));
        void takeWithStop({ type: "stop_playback" });
        return;
      }
      void ask(seriesAction(ref)).then(({ response, error: titleError }) => {
        if (!stillEnded()) {
          return;
        }
        const title = titleError ? null : answeredTitle(response);
        if (title !== null && !trimToExistingTitle(ref)) {
          pushBefore(PLAYER_LEVEL, marqueeTitleLevelOf(title));
        }
        void takeWithStop({ type: "stop_playback" });
      });
    };

    if (decision.kind === "return") {
      landOnTitleAndStop(decision.ref);
      return;
    }

    void ask(seriesAction(decision.ref)).then(({ response, error: titleError }) => {
      if (!stillEnded()) {
        return;
      }
      const title = titleError ? null : answeredTitle(response);
      if (title === null) {
        return;
      }
      if (!hasAiredNextEpisode(title.videos, endedVideoId, new Date())) {
        landOnTitleAndStop(decision.ref, title);
      }
    });
  }, [ask, playback?.state, playerActive, pushBefore, remove, snapshot, takeWithStop]);

  const behind = pictureBehind(playback, closing);
  useEffect(() => {
    document.body.classList.toggle("picture-behind", behind);
    document.documentElement.classList.toggle("picture-behind", behind);
    return () => {
      document.body.classList.remove("picture-behind");
      document.documentElement.classList.remove("picture-behind");
    };
  }, [behind]);

  const value = useMemo(
    () => ({
      session,
      snapshot,
      error,
      destination: nav.destination,
      chosenDestination,
      popover,
      unplayable,
      pending,
      choose,
      push,
      remove,
      levelExists,
      pop,
      back,
      ask,
      take: takeWithStop,
      hint,
      markUnplayable,
      home,
      setIntentHandler,
      setBaseIntentHandler,
    }),
    [
      session,
      snapshot,
      error,
      nav.destination,
      chosenDestination,
      popover,
      unplayable,
      pending,
      choose,
      push,
      remove,
      levelExists,
      pop,
      back,
      ask,
      takeWithStop,
      hint,
      markUnplayable,
      home,
      setIntentHandler,
      setBaseIntentHandler,
    ],
  );

  return (
    <ShellContext.Provider value={value}>
      <MarqueeFrame
        destination={nav.destination}
        onChooseDestination={choose}
        levels={nav.levels}
        onBack={back}
        onBaseIntent={(intent) => baseIntent.current?.(intent) ?? false}
        screen={<MarqueeDestinationScreen destination={nav.destination} />}
        dock={docked ? <PlayerDock /> : null}
      />

      <div className="mq-alert-stack">
        {error ? (
          <p role="alert" className="mq-alert">
            {explain(error)}
          </p>
        ) : null}
        {!playerActive && playback?.failure ? (
          <p role="alert" className="mq-alert">
            {`${playback.failure} Pick another Stream from the list.`}
          </p>
        ) : null}
      </div>
    </ShellContext.Provider>
  );
}
