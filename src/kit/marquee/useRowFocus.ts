import { useLayoutEffect, useRef, type FocusEvent } from "react";

/** Whether focus landing on `target` is still the row's: inside it, or in a question it asked. */
export function staysWithRow(row: Element | null, target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    (Boolean(row?.contains(target)) || target.closest('[aria-modal="true"]') !== null)
  );
}

/**
 * Keeps the focus on a row whose control stops being one under the person: a
 * move that reaches an end disables the button that made it, and moving takes
 * the controls off an Addon row. The focus engine would retry that same element
 * and paint no ring, so the focus goes to the row's main button.
 *
 * The row hands `onFocus` and `onBlur` to its root and `main` to its main
 * button.
 */
export function useRowFocus() {
  const main = useRef<HTMLButtonElement>(null);
  /** The control of this row that had the focus last. */
  const last = useRef<Element | null>(null);

  useLayoutEffect(() => {
    const control = last.current;
    if (!control || (control.isConnected && !control.matches(":disabled"))) {
      return;
    }
    const active = document.activeElement;
    if (active === document.body || active === control) {
      main.current?.focus({ preventScroll: true });
    }
  });

  const forget = () => {
    last.current = null;
  };

  return {
    main,
    forget,
    onFocus: (event: FocusEvent<HTMLElement>) => {
      last.current = event.target;
    },
    /** Answers whether the focus left the row. */
    onBlur: (event: FocusEvent<HTMLElement>): boolean => {
      if (staysWithRow(event.currentTarget, event.relatedTarget)) {
        return false;
      }
      forget();
      return true;
    },
  };
}
