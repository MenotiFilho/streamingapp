import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { explain } from "../core/errors";
import type { HostLink } from "../core/link";
import { useNavigation } from "../core/react/useNavigation";
import { useSession } from "../core/react/useSession";
import { TauriLink } from "./tauriLink";
import type { Intent } from "../core/input";
import { closingAfter, pictureBehind, requestsStop } from "../core/playback";
import type { Action, Response } from "../core/wire";
import { PlayerDock, dockedTransport } from "./PlayerDock";
import { PlayerOverlay } from "./PlayerOverlay";
import { RepertoryDestinationScreen } from "./repertory/RepertoryScreens";
import { DestinationGrid } from "./repertory/DestinationGrid";
import { ShellFrame } from "./ShellFrame";
import { ShellContext } from "./context";
import {
  type Destination,
  type ShellLevel,
  type WindowPayload,
} from "./navigation";

/** The id the player level holds, so a later push can replace it rather than stack a copy. */
const PLAYER_LEVEL = "player";

/**
 * The shell: the Host's Snapshot, the six-destination frame, and the level
 * stack above it.
 *
 * The window owns nothing the Host owns. It follows Snapshots, takes Actions
 * through the Host's one door, and draws a level over the level below without
 * disturbing the focus underneath. The player is a level like any other; when
 * it stops, the browsing stack that was underneath is exactly where it was.
 */
export function Shell({ client }: { client?: HostLink }) {
  // The window's link is always ready: it is the Host's own window, already
  // paired and with no socket to lose (ADR-0035 §1). A test hands its own in.
  const link = useMemo(() => client ?? new TauriLink(), [client]);
  const { session, state } = useSession(link);
  const { snapshot, error, unplayable, pending } = state;
  const { ask, take: takeAction, markUnplayable, home } = session;
  const nav = useNavigation<WindowPayload>();
  // A Stop the person has asked for and the Host has not yet reported (#250).
  const [closing, setClosing] = useState(false);
  const [chosenDestination, setChosenDestination] = useState(false);
  const levelsRef = useRef(nav.levels);
  levelsRef.current = nav.levels;
  /**
   * The player's own first look at an intent. A level is built once and holds
   * on to its handler, so the handler itself lives in a ref that the player
   * rewrites on every render with the one that matches what is on screen.
   */
  const playerIntent = useRef<((intent: Intent) => boolean) | null>(null);
  const setIntentHandler = useCallback((handler: ((intent: Intent) => boolean) | null) => {
    playerIntent.current = handler;
  }, []);
  const baseIntent = useRef<((intent: Intent) => boolean) | null>(null);
  const setBaseIntentHandler = useCallback(
    (handler: ((intent: Intent) => boolean) | null) => {
      baseIntent.current = handler;
      // Only the owner that set this handler may clear it: the base cross-fades,
      // and an old Home must not unmount the new one's handler.
      return () => {
        if (baseIntent.current === handler) {
          baseIntent.current = null;
        }
      };
    },
    [],
  );

  const { choose: chooseDestination, push, remove, removeFrom, pop, back: backStack } = nav;

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

  // The spine's All destinations screen is a level like any other: it paints
  // above the base, Back returns to the More control that opened it, and
  // choosing a room goes through the same `choose` the spine uses.
  const openDestinations = useCallback(() => {
    push({
      name: "All destinations",
      kind: "overlay",
      payload: {
        render: () => (
          <DestinationGrid active={nav.destination} onChoose={choose} onClose={pop} />
        ),
      },
    });
  }, [choose, nav.destination, pop, push]);

  const playback = snapshot?.playback ?? null;
  // The Host tears mpv's window down before it reports `idle`: the shell takes
  // its ink back the moment Stop is taken, and gives the picture back if the
  // Host refuses it. The wrapper is named for the Stop it holds, so it never
  // shadows the Session's own `take`.
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
  // The player level exists exactly where the picture is behind the shell: the
  // same seam the page's ink follows, without the Stop hold (a Stop already
  // taken still has its OSD until the Host reports the Stream gone).
  const playerActive = pictureBehind(playback, false);
  // Where the picture is elsewhere the transport is still the Host's: the
  // window draws it as a docked band rather than an OSD over a picture it does
  // not have (#194).
  const docked =
    playback !== null && dockedTransport(playback.state, playback.picture);
  // The player's open OSD popover, where there is one: its own level, so Back
  // puts it away before it reaches the player's stop rule.
  const popover = nav.levels.find((level) => level.kind === "popover")?.id ?? null;

  const back = useCallback(() => {
    const top = nav.levels[nav.levels.length - 1];
    if (top?.payload.onBack?.()) {
      return;
    }
    if (top?.kind === "player") {
      // Back in the player is Stop: the OSD's own popovers have already had
      // their chance through `onBack`, and the stack below is left untouched.
      void takeWithStop({ type: "stop_playback" });
      return;
    }
    backStack();
  }, [nav.levels, backStack, takeWithStop]);

  // The player takes over the window only where the picture is in this window:
  // mpv's own window is not something this page can draw over, and nowhere is
  // not a place to put a player.
  useEffect(() => {
    if (!playerActive) {
      // The level is going, and with it the handler it reads: the player
      // rewrites this on every render, so a stale one must not answer.
      playerIntent.current = null;
      removeFrom(PLAYER_LEVEL);
      return;
    }
    const player: ShellLevel = {
      id: PLAYER_LEVEL,
      name: "Playing",
      kind: "player",
      payload: {
        render: () => <PlayerOverlay />,
        onIntent: (intent) => playerIntent.current?.(intent) ?? false,
      },
    };
    push(player);
  }, [playerActive, push, removeFrom]);

  // Where the picture is in this window, the page must stop painting its own
  // rectangle so mpv's child window shows through (ADR-0003), and the browsing
  // page underneath must stop offering a scrollbar the player does not need.
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
      markUnplayable,
      home,
      setIntentHandler,
      setBaseIntentHandler,
    ],
  );

  return (
    <ShellContext.Provider value={value}>
      <ShellFrame
        destination={nav.destination}
        onChooseDestination={choose}
        levels={nav.levels}
        onBack={back}
        onOpenDestinations={openDestinations}
        onBaseIntent={(intent) => baseIntent.current?.(intent) ?? false}
        screen={<RepertoryDestinationScreen destination={nav.destination} />}
        dock={docked ? <PlayerDock /> : null}
      />

      <div className="shell-alert-stack">
        {error ? (
          <p role="alert" className="shell-alert">
            {explain(error)}
          </p>
        ) : null}
        {!playerActive && playback?.failure ? (
          <p role="alert" className="shell-alert">
            {`${playback.failure} Pick another Stream from the list.`}
          </p>
        ) : null}
      </div>
    </ShellContext.Provider>
  );
}
