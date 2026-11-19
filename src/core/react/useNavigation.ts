import { useCallback, useMemo, useReducer, useRef } from "react";

import {
  INITIAL_NAVIGATION,
  canGoBack as hasBack,
  navigate,
  type Level,
  type Navigation,
  type NewLevel,
} from "../navigation";
import type { Destination } from "../destinations";

/** What a client reads from its Navigation, and the events it can send. */
export type NavigationReads<P> = {
  /** The whole state, for a caller that needs to hand it on. */
  state: Navigation<P>;
  /** The base screen that is showing. */
  destination: Destination;
  /** The stack above it, outermost first. */
  levels: Level<P>[];
  choose: (destination: Destination) => void;
  /** Push a level. Returns the id the navigation gave it. */
  push: (level: NewLevel<P>) => string;
  /** Place a level directly beneath `beforeId` (or at the top if absent). Returns its id. */
  pushBefore: (beforeId: string, level: NewLevel<P>) => string;
  /** Take one level out by id, wherever it sits. */
  remove: (id: string) => void;
  /** Take a level out along with everything above it. */
  removeFrom: (id: string) => void;
  /** Pop the top level, if there is one. */
  pop: () => void;
  /** Back: pop one level, then return a non-Home base to Home. */
  back: () => void;
  /** Whether Back has anywhere to go. */
  canGoBack: boolean;
};

/**
 * The Navigation, as the client that draws it reads it.
 *
 * The state and the callbacks keep their identity across an unchanged render,
 * so a screen that passes them down does not re-render for a fresh object. A
 * level without an id takes the next `level-<n>` this hook has not handed out;
 * the counter lives as long as the hook, so two clients never share ids.
 */
export function useNavigation<P>(): NavigationReads<P> {
  // The initial state's payload is `never`, which is assignable to every
  // client's payload; the hook is where that empty state becomes this client's.
  const [state, dispatch] = useReducer(navigate, INITIAL_NAVIGATION as Navigation<P>);
  const nextLevelId = useRef(0);

  const choose = useCallback(
    (destination: Destination) => dispatch({ type: "choose", destination }),
    [],
  );

  const push = useCallback((level: NewLevel<P>): string => {
    const id = level.id ?? `level-${(nextLevelId.current += 1)}`;
    dispatch({ type: "push", level: { ...level, id } });
    return id;
  }, []);

  const pushBefore = useCallback((beforeId: string, level: NewLevel<P>): string => {
    const id = level.id ?? `level-${(nextLevelId.current += 1)}`;
    dispatch({ type: "push-before", beforeId, level: { ...level, id } });
    return id;
  }, []);

  const remove = useCallback((id: string) => dispatch({ type: "remove", id }), []);
  const removeFrom = useCallback(
    (id: string) => dispatch({ type: "remove-from", id }),
    [],
  );
  const pop = useCallback(() => dispatch({ type: "pop" }), []);
  const back = useCallback(() => dispatch({ type: "back" }), []);
  const canGoBack = hasBack(state);

  return useMemo(
    () => ({
      state,
      destination: state.destination,
      levels: state.levels,
      choose,
      push,
      pushBefore,
      remove,
      removeFrom,
      pop,
      back,
      canGoBack,
    }),
    [state, choose, push, pushBefore, remove, removeFrom, pop, back, canGoBack],
  );
}
