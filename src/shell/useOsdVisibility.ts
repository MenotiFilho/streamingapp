import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/** How long the OSD stays up with nothing happening. */
export const OSD_IDLE_MS = 5000;

export type OsdVisibilityOptions = {
  /** Something above the OSD — an open popover — keeps it up by itself. */
  pinned: boolean;
  /** The OSD's own chrome: focus inside it counts as still using the OSD. */
  chrome: RefObject<HTMLElement | null>;
  /** Where focus goes when the OSD puts itself away. */
  onHide: () => void;
};

/**
 * The OSD's summon-and-hide rule: any key or pointer movement shows it, and it
 * goes away after five idle seconds unless the person is still in it.
 *
 * "In it" is focus: a control inside the chrome keeps the OSD up, and so does
 * an open popover, which lives on its own level above the player. The picture
 * surface is deliberately not the chrome — it is the play/pause control, and a
 * person watching without touching anything should get their picture back.
 *
 * The timer is a ref rather than a state tick: pointer movement is frequent,
 * and re-rendering the player on every move would measure the whole level
 * again. Re-arming the timer is enough; only showing and hiding re-render.
 */
export function useOsdVisibility({ pinned, chrome, onHide }: OsdVisibilityOptions) {
  const [visible, setVisible] = useState(true);
  const pinnedRef = useRef(pinned);
  pinnedRef.current = pinned;
  const chromeRef = useRef(chrome);
  chromeRef.current = chrome;
  const onHideRef = useRef(onHide);
  onHideRef.current = onHide;
  /**
   * Which kind of input moved last. A keyboard or pad user navigates by focus,
   * and focus on a control is what keeps the OSD up for them. A mouse click also
   * leaves focus on a control, but a person watching with the mouse wants the
   * OSD out of the way once they stop; pointer input therefore does not pin it.
   */
  const lastInput = useRef<"pointer" | "key">("pointer");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const arm = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
    }

    const tick = () => {
      const active = document.activeElement;
      const focusedInside =
        active instanceof HTMLElement &&
        (chromeRef.current.current?.contains(active) ?? false);

      // A keyboard/pad user still in the OSD, or a popover still open above it,
      // gets another idle window rather than having the surface pulled away. A
      // mouse click leaves focus behind too, but it does not pin the OSD.
      if (pinnedRef.current || (lastInput.current === "key" && focusedInside)) {
        timer.current = setTimeout(tick, OSD_IDLE_MS);
        return;
      }

      timer.current = null;
      setVisible(false);
      onHideRef.current();
    };

    timer.current = setTimeout(tick, OSD_IDLE_MS);
  }, []);

  const wake = useCallback(
    (input: "pointer" | "key") => {
      lastInput.current = input;
      setVisible(true);
      arm();
    },
    [arm],
  );

  useEffect(() => {
    arm();
    return () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
    };
  }, [arm]);

  useEffect(() => {
    const onKeyDown = () => wake("key");
    const onPointer = () => wake("pointer");

    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("pointermove", onPointer, true);
    // A wheel notch is input too: it changes the volume, and the OSD should
    // show the level it changed rather than doing it invisibly.
    window.addEventListener("wheel", onPointer, { passive: true });

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("pointermove", onPointer, true);
      window.removeEventListener("wheel", onPointer);
    };
  }, [wake]);

  return { visible, wake };
}
