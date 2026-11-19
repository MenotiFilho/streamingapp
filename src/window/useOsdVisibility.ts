import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import { idleOsd, OSD_IDLE_MS, OSD_START, wakeOsd, type OsdInput, type OsdState } from "../core/osd";

// The idle duration is the OSD decision's; the hook that runs the timer reads
// it from the core, and window consumers keep this door.
export { OSD_IDLE_MS };

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
 * goes away after three idle seconds unless the person is still in it. The
 * mouse cursor over the Picture rides the same clock (`cursorVisible`), but only
 * the pointer brings it back: a key or pad press summons the OSD and leaves a
 * stationary cursor hidden, and keyboard focus in the chrome keeps the OSD up
 * without keeping the cursor. The rule itself is `core/osd`'s; this hook is the
 * timer and the listeners around it.
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
  // The decision's state lives in a ref and a render only follows the part a
  // person sees changing: a pointer moving over a visible OSD changes nothing.
  const osd = useRef<OsdState>(OSD_START);
  const [shown, setShown] = useState({
    visible: OSD_START.visible,
    cursorVisible: OSD_START.cursorVisible,
  });
  const settle = useCallback((next: OsdState) => {
    osd.current = next;
    setShown((last) =>
      last.visible === next.visible && last.cursorVisible === next.cursorVisible
        ? last
        : { visible: next.visible, cursorVisible: next.cursorVisible },
    );
  }, []);
  const pinnedRef = useRef(pinned);
  pinnedRef.current = pinned;
  const chromeRef = useRef(chrome);
  chromeRef.current = chrome;
  const onHideRef = useRef(onHide);
  onHideRef.current = onHide;
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

      const next = idleOsd(osd.current, { pinned: pinnedRef.current, focusedInside });
      settle(next);

      // The decision kept the OSD up (a popover open, or a keyboard/pad user
      // still in it): another idle window, so it can still go once they leave.
      if (next.visible) {
        timer.current = setTimeout(tick, OSD_IDLE_MS);
        return;
      }

      timer.current = null;
      onHideRef.current();
    };

    timer.current = setTimeout(tick, OSD_IDLE_MS);
  }, [settle]);

  const wake = useCallback(
    (input: OsdInput) => {
      settle(wakeOsd(osd.current, input));
      arm();
    },
    [arm, settle],
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

  return { visible: shown.visible, cursorVisible: shown.cursorVisible, wake };
}
