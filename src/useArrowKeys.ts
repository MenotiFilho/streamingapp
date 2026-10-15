import { useEffect, useRef, type RefObject } from "react";

/**
 * Arrow keys, OK and Back, so a gamepad or a TV remote drives the same controls
 * the mouse does.
 *
 * The order is the order the controls appear in, which is the order a person
 * reads them, and OK is the button's own Enter or Space — nothing here
 * re-implements activating a control, so every control that works with a mouse
 * works with a remote too. Escape goes back, and Backspace with it when the
 * focused control is not a text field.
 *
 * The one place the arrows are not the focus order's is a text field: Left and
 * Right belong to the caret there, because a person typing a search has to be
 * able to fix a typo without leaving the box. Up and Down still move on, which
 * is how a remote with no Backspace leaves the field at all.
 */
export function useArrowKeys(container: RefObject<HTMLElement | null>, back: () => void) {
  const remember = useRef(back);
  remember.current = back;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const root = container.current;
      if (!root) {
        return;
      }
      const focusables = Array.from(root.querySelectorAll<HTMLElement>("[data-focusable]"));
      if (focusables.length === 0) {
        return;
      }

      const active = document.activeElement as HTMLElement | null;
      const index = active ? focusables.indexOf(active) : -1;
      const move = (to: number) => {
        focusables[(to + focusables.length) % focusables.length]?.focus();
        event.preventDefault();
      };
      const typing = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;

      switch (event.key) {
        case "ArrowRight":
          if (typing) {
            return;
          }
          move(index + 1);
          break;
        case "ArrowLeft":
          if (typing) {
            return;
          }
          move(index <= 0 ? focusables.length - 1 : index - 1);
          break;
        case "ArrowDown":
          move(index + 1);
          break;
        case "ArrowUp":
          move(index <= 0 ? focusables.length - 1 : index - 1);
          break;
        case "Escape":
          remember.current();
          event.preventDefault();
          break;
        case "Backspace":
          if (!typing) {
            remember.current();
            event.preventDefault();
          }
          break;
        default:
          break;
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [container]);
}
