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
import { watching } from "../playback";
import { DestinationScreen } from "./DestinationScreens";
import { PlayerOverlay } from "./PlayerOverlay";
import { ShellFrame } from "./ShellFrame";
import { ShellContext, type NewShellLevel } from "./context";
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
export function Shell({ client }: { client?: HostClient }) {
  const host = useMemo(() => client ?? new HostClient(), [client]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<ActionError | null>(null);
  const [nav, dispatch] = useReducer(navigate, INITIAL_NAVIGATION);
  const nextLevelId = useRef(0);

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

  /** Take an Action and answer with what came of it, or why the Host refused it. */
  const take = useCallback(
    async (action: Action): Promise<Response | null> => {
      setError(null);
      try {
        return await host.dispatch(action);
      } catch (caught) {
        setError(asActionError(caught));
        return null;
      }
    },
    [host],
  );

  const choose = useCallback((destination: Destination) => {
    dispatch({ type: "choose", destination });
  }, []);

  const push = useCallback((level: NewShellLevel): string => {
    const id = level.id ?? `level-${(nextLevelId.current += 1)}`;
    dispatch({ type: "push", level: { ...level, id } });
    return id;
  }, []);

  const pop = useCallback(() => dispatch({ type: "pop" }), []);

  const playback = snapshot?.playback ?? null;
  const playerActive =
    playback !== null && watching(playback.state) && playback.picture === "in_window";

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
      dispatch({ type: "remove-from", id: PLAYER_LEVEL });
      return;
    }
    const player: ShellLevel = {
      id: PLAYER_LEVEL,
      name: "Playing",
      kind: "player",
      render: () => <PlayerOverlay />,
    };
    dispatch({ type: "push", level: player });
  }, [playerActive]);

  // Where the picture is in this window, the page must stop painting its own
  // rectangle so mpv's child window shows through (ADR-0003).
  useEffect(() => {
    document.body.classList.toggle("picture-behind", playerActive);
    return () => document.body.classList.remove("picture-behind");
  }, [playerActive]);

  const value = useMemo(
    () => ({
      snapshot,
      error,
      destination: nav.destination,
      choose,
      push,
      pop,
      back,
      take,
    }),
    [snapshot, error, nav.destination, choose, push, pop, back, take],
  );

  return (
    <ShellContext.Provider value={value}>
      <ShellFrame
        destination={nav.destination}
        onChooseDestination={choose}
        levels={nav.levels}
        onBack={back}
        screen={<DestinationScreen destination={nav.destination} />}
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
