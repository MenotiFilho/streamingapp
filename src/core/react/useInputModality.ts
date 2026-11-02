import { useSyncExternalStore } from "react";

import {
  inputModality,
  subscribeInputModality,
  type InputModality,
} from "../inputModality";

/**
 * The modality a component draws against, as a React read of the one store.
 * The window's spine opens on navigation focus; a pointer click on the same
 * item leaves it compact (ADR-0037).
 */
export function useInputModality(): InputModality {
  return useSyncExternalStore(
    subscribeInputModality,
    inputModality,
    inputModality,
  );
}
