import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import {
  asActionError,
  explain,
  HostClient,
  type Action,
  type ActionError,
  type Response,
  type Snapshot,
} from "../host-client";
import type { Intent } from "../input";
import { watching } from "../playback";
import { actionKey, repeats } from "./actionKey";
import { DestinationScreen } from "./DestinationScreens";
import { InFlight } from "./inFlight";
import { PlayerOverlay } from "./PlayerOverlay";
import { RepertoryDestinationScreen } from "./repertory/RepertoryScreens";
import { DestinationGrid } from "./repertory/DestinationGrid";
import { ShellFrame } from "./ShellFrame";
import { ShellContext, type ActionOutcome, type NewShellLevel } from "./context";
import { HomeStore } from "./homeStore";
import {
  INITIAL_NAVIGATION,
  navigate,
  type Destination,
  type ShellLevel,
} from "./navigation";

/** The id the player level holds, so a later push can replace it rather than stack a copy. */
const PLAYER_LEVEL = "player";

/**
 * The new shell: the Host's Snapshot, the six-destination frame, and the level
 * stack above it.
 *
 * The window owns nothing the Host owns. It follows Snapshots, takes Actions
 * through the Host's one door, and draws a level over the level below without
 * disturbing the focus underneath. The player is a level like any other; when
 * it stops, the browsing stack that was underneath is exactly where it was.
 */
export function Shell({
  client,
  presentation = "velvet",
}: {
  client?: HostClient;
  presentation?: "velvet" | "repertory";
}) {
  const host = useMemo(() => client ?? new HostClient(), [client]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<ActionError | null>(null);
  const [nav, dispatch] = useReducer(navigate, INITIAL_NAVIGATION);
  const [chosenDestination, setChosenDestination] = useState(false);
  // What this client has learned about Titles that cannot be played (ADR-0020).
  // It is not the Host's state and is not published anywhere: a mark earned by
  // opening a Title stays for this window's lifetime, and a new window starts
  // as ignorant as the Host is.
  const [unplayable, setUnplayable] = useState<ReadonlySet<string>>(() => new Set());
  const nextLevelId = useRef(0);
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

  const publish = useCallback((next: Snapshot) => {
    setSnapshot((current) => (current && current.revision > next.revision ? current : next));
  }, []);

  // Follow the Host first, then ask it where things stand: an update that lands
  // while the first read is in flight then still wins on revision.
  useEffect(() => {
    let stop: (() => void) | undefined;
    let closed = false;
    void host.onSnapshot(publish).then((unlisten) => {
      if (closed) {
        unlisten();
      } else {
        stop = unlisten;
      }
    });
    void host.snapshot().then(publish).catch((caught: unknown) => setError(asActionError(caught)));
    return () => {
      closed = true;
      stop?.();
    };
  }, [host, publish]);

  /** The same, with the refusal returned rather than raised as the window's alert. */
  const inFlight = useRef(new InFlight<ActionOutcome>());
  const ask = useCallback(
    async (action: Action): Promise<ActionOutcome> => {
      const send = async (): Promise<ActionOutcome> => {
        try {
          return { response: await host.dispatch(action), error: null };
        } catch (caught) {
          return { response: null, error: asActionError(caught) };
        }
      };
      // A relative Action in flight does not absorb the next one: two rewinds
      // are two steps (#137). Everything else — the episode steps included —
      // joins an identical Action already in flight, so a double press sends
      // one.
      if (repeats(action)) {
        return send();
      }
      return inFlight.current.run(actionKey(action), send);
    },
    [host],
  );

  /** Take an Action a person asked for: a refusal becomes the window's alert. */
  const take = useCallback(
    async (action: Action): Promise<Response | null> => {
      setError(null);
      const { response, error } = await ask(action);
      if (error) {
        setError(error);
      }
      return response;
    },
    [ask],
  );

  // Home's rows belong to the session, not to the screen: leaving the
  // destination unmounts `HomeScreen`, and this store is what keeps the asks
  // already sent running and their answers on hand for the return (#112).
  // `useState`'s initializer, unlike `useMemo`, is guaranteed to be kept for
  // the life of this Shell; `ask` is stable for that life too.
  const [home] = useState(() => new HomeStore(ask));

  const choose = useCallback((destination: Destination) => {
    setChosenDestination(true);
    dispatch({ type: "choose", destination });
  }, []);

  const markUnplayable = useCallback((id: string, unplayable: boolean) => {
    setUnplayable((held) => {
      if (held.has(id) === unplayable) {
        return held;
      }
      const next = new Set(held);
      if (unplayable) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);

  const push = useCallback((level: NewShellLevel): string => {
    const id = level.id ?? `level-${(nextLevelId.current += 1)}`;
    dispatch({ type: "push", level: { ...level, id } });
    return id;
  }, []);

  const remove = useCallback((id: string) => dispatch({ type: "remove", id }), []);
  const levelExists = useCallback(
    (id: string) => levelsRef.current.some((level) => level.id === id),
    [],
  );
  const pop = useCallback(() => dispatch({ type: "pop" }), []);

  // The repertory spine's All destinations screen is a level like any other:
  // it paints above the base, Back returns to the More control that opened it,
  // and choosing a room goes through the same `choose` the spine uses.
  const openDestinations = useCallback(() => {
    push({
      name: "All destinations",
      kind: "overlay",
      render: () => (
        <DestinationGrid active={nav.destination} onChoose={choose} onClose={pop} />
      ),
    });
  }, [choose, nav.destination, pop, push]);

  const playback = snapshot?.playback ?? null;
  const playerActive =
    playback !== null && watching(playback.state) && playback.picture === "in_window";
  // The player's open OSD popover, where there is one: its own level, so Back
  // puts it away before it reaches the player's stop rule.
  const popover = nav.levels.find((level) => level.kind === "popover")?.id ?? null;

  const back = useCallback(() => {
    const top = nav.levels[nav.levels.length - 1];
    if (top?.onBack?.()) {
      return;
    }
    if (top?.kind === "player") {
      // Back in the player is Stop: the OSD's own popovers have already had
      // their chance through `onBack`, and the stack below is left untouched.
      void take({ type: "stop_playback" });
      return;
    }
    dispatch({ type: "back" });
  }, [nav.levels, take]);

  // The player takes over the window only where the picture is in this window:
  // mpv's own window is not something this page can draw over, and nowhere is
  // not a place to put a player.
  useEffect(() => {
    if (!playerActive) {
      // The level is going, and with it the handler it reads: the player
      // rewrites this on every render, so a stale one must not answer.
      playerIntent.current = null;
      dispatch({ type: "remove-from", id: PLAYER_LEVEL });
      return;
    }
    const player: ShellLevel = {
      id: PLAYER_LEVEL,
      name: "Playing",
      kind: "player",
      render: () => <PlayerOverlay />,
      onIntent: (intent) => playerIntent.current?.(intent) ?? false,
    };
    dispatch({ type: "push", level: player });
  }, [playerActive]);

  // Where the picture is in this window, the page must stop painting its own
  // rectangle so mpv's child window shows through (ADR-0003), and the browsing
  // page underneath must stop offering a scrollbar the player does not need.
  useEffect(() => {
    document.body.classList.toggle("picture-behind", playerActive);
    document.documentElement.classList.toggle("picture-behind", playerActive);
    return () => {
      document.body.classList.remove("picture-behind");
      document.documentElement.classList.remove("picture-behind");
    };
  }, [playerActive]);

  const value = useMemo(
    () => ({
      snapshot,
      error,
      destination: nav.destination,
      chosenDestination,
      popover,
      unplayable,
      choose,
      push,
      remove,
      levelExists,
      pop,
      back,
      ask,
      take,
      markUnplayable,
      home,
      setIntentHandler,
    }),
    [
      snapshot,
      error,
      nav.destination,
      chosenDestination,
      popover,
      unplayable,
      choose,
      push,
      remove,
      levelExists,
      pop,
      back,
      ask,
      take,
      markUnplayable,
      home,
      setIntentHandler,
    ],
  );

  return (
    <ShellContext.Provider value={value}>
      <ShellFrame
        destination={nav.destination}
        onChooseDestination={choose}
        levels={nav.levels}
        onBack={back}
        presentation={presentation}
        onOpenDestinations={openDestinations}
        screen={
          presentation === "repertory" ? (
            <RepertoryDestinationScreen destination={nav.destination} />
          ) : (
            <DestinationScreen destination={nav.destination} />
          )
        }
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
