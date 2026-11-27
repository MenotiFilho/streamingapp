import { useState, type FocusEvent, type FocusEventHandler } from "react";
import { useReducedMotionConfig } from "motion/react";

import type { InputModality } from "../../core/inputModality";
import { useInputModality } from "../../core/react/useInputModality";
import { useReducedMotion } from "../../core/react/useReducedMotion";

/**
 * Whether a control draws its focus treatment (ADR-0037): the explicit
 * `focused` prop always draws it, and DOM focus draws it only when navigation
 * chose it. A pointer press focuses natively and paints nothing.
 *
 * Controls get the same rule from CSS. This is for the parts CSS cannot do:
 * Motion's focus scale and the filled icon of a focused destination.
 */
export function showsFocus(state: {
  focused?: boolean;
  domFocused: boolean;
  modality: InputModality;
}): boolean {
  if (state.focused) {
    return true;
  }
  return state.domFocused && state.modality === "navigation";
}

/** The focus treatment of one control, and the handlers that keep it true. */
export function useShownFocus<E extends Element>({
  focused,
  onFocus,
  onBlur,
}: {
  focused?: boolean;
  onFocus?: FocusEventHandler<E>;
  onBlur?: FocusEventHandler<E>;
}) {
  const modality = useInputModality();
  const [domFocused, setDomFocused] = useState(false);

  return {
    shown: showsFocus({ focused, domFocused, modality }),
    focusProps: {
      "data-focused": focused ? ("true" as const) : undefined,
      onFocus: (event: FocusEvent<E>) => {
        setDomFocused(true);
        onFocus?.(event);
      },
      onBlur: (event: FocusEvent<E>) => {
        setDomFocused(false);
        onBlur?.(event);
      },
    },
  };
}

/**
 * Whether movement is left out (ADR-0031 §5): the nearest `MotionConfig` when
 * one asks for it, and otherwise the system's own setting. Motion's config
 * disables transforms and layout only, so a component that animates a custom
 * property reads this and snaps it itself.
 */
export function useCalmMotion(): boolean {
  const configured = useReducedMotionConfig();
  const system = useReducedMotion();
  return configured === true || system;
}
