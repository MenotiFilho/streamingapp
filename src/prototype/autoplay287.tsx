/*
 * PROTOTYPE (#287, throwaway — never merged).
 *
 * Three variants of where the autoplay switch and its countdown sit in the
 * player, switchable via `?variant=A|B|C`, drawn inside the real player on the
 * rehearsal Host (`?proto=autoplay`), on the window and on the Remote client.
 *
 * Everything here is client-side pretend: the real thing is a Host preference
 * and a Host-owned countdown in `PlaybackSnapshot` (see the autoplay decision
 * ticket, #286). No tests, no persistence, no Actions.
 */
import { useEffect, useSyncExternalStore } from "react";

import type { PlaybackState } from "../core/wire";
import {
  PROTO_AUTOPLAY,
  PROTO_EPISODES,
  protoAdvance,
  protoEnd,
  protoNearEnd,
  protoPlayingIndex,
  protoStill,
} from "../window/repertory/previewHost";
import "./autoplay287.css";

export const PROTO = PROTO_AUTOPLAY;

export type Variant = "A" | "B" | "C";
const VARIANTS: Variant[] = ["A", "B", "C"];
export const VARIANT_NAMES: Record<Variant, string> = {
  A: "Transport toggle + corner card",
  B: "Episodes panel + full-picture takeover",
  C: "Playback popover + one-line countdown",
};

/** What the ended episode is doing. */
export type Phase = "none" | "countdown" | "held" | "still_there";
type EndMode = "normal" | "still_there";

const COUNTDOWN_MS = 5_000;

type State = {
  variant: Variant;
  autoplay: boolean;
  phase: Phase;
  deadline: number;
  endMode: EndMode;
  /** Bumped by the ticking frame so readers of `remaining` redraw. */
  frame: number;
};

function readVariant(): Variant {
  if (typeof window === "undefined") {
    return "A";
  }
  const held = new URLSearchParams(window.location.search).get("variant");
  return VARIANTS.includes(held as Variant) ? (held as Variant) : "A";
}

let state: State = {
  variant: readVariant(),
  autoplay: true,
  phase: "none",
  deadline: 0,
  endMode: "normal",
  frame: 0,
};
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

function stopTimer() {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

function startCountdown() {
  stopTimer();
  set({ phase: "countdown", deadline: Date.now() + COUNTDOWN_MS });
  timer = setInterval(() => {
    if (Date.now() >= state.deadline) {
      stopTimer();
      set({ phase: "none" });
      protoAdvance();
      return;
    }
    set({ frame: state.frame + 1 });
  }, 50);
}

/** The Stream reached its end: what the Host would decide right then. */
function onEnded() {
  if (state.phase !== "none") {
    return;
  }
  if (state.endMode === "still_there") {
    set({ phase: "still_there" });
  } else if (state.autoplay) {
    startCountdown();
  } else {
    set({ phase: "held" });
  }
}

function onLeftEnded() {
  stopTimer();
  if (state.phase !== "none") {
    set({ phase: "none" });
  }
}

export const proto = {
  setAutoplay(autoplay: boolean) {
    set({ autoplay });
    // The decision ticket's rule: off cancels a running countdown, on while
    // sitting on Ended starts one.
    if (!autoplay && state.phase === "countdown") {
      stopTimer();
      set({ phase: "held" });
    } else if (autoplay && state.phase === "held") {
      startCountdown();
    }
  },
  toggle() {
    proto.setAutoplay(!state.autoplay);
  },
  cancel() {
    stopTimer();
    set({ phase: "held" });
  },
  playNow() {
    stopTimer();
    set({ phase: "none" });
    protoAdvance();
  },
  setVariant(variant: Variant) {
    const url = new URL(window.location.href);
    url.searchParams.set("variant", variant);
    window.history.replaceState(null, "", url);
    set({ variant });
  },
  setEndMode(endMode: EndMode) {
    set({ endMode });
  },
};

export type ProtoView = {
  variant: Variant;
  autoplay: boolean;
  phase: Phase;
  /** Seconds left on the countdown, as a float; 0 outside one. */
  remaining: number;
  /** 1 → 0 across the countdown. */
  fraction: number;
  next: { label: string; name: string; still: string };
};

/** The prototype's facts for a player that is drawing `playback`. */
export function useAutoplayProto(playback?: PlaybackState | null): ProtoView {
  const held = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );

  useEffect(() => {
    if (!PROTO || playback === undefined) {
      return;
    }
    if (playback === "ended") {
      onEnded();
    } else {
      onLeftEnded();
    }
  }, [playback]);

  const index = (protoPlayingIndex() + 1) % PROTO_EPISODES.length;
  const episode = PROTO_EPISODES[index]!;
  const left = held.phase === "countdown" ? Math.max(0, held.deadline - Date.now()) : 0;
  return {
    variant: held.variant,
    autoplay: held.autoplay,
    phase: PROTO ? held.phase : "none",
    remaining: left / 1000,
    fraction: left / COUNTDOWN_MS,
    next: {
      label: `S${episode.season}E${episode.episode}`,
      name: episode.name,
      still: protoStill(index),
    },
  };
}

/** The whole seconds a countdown shows: 5, 4, 3, 2, 1. */
export function countdownDigit(view: ProtoView): number {
  return Math.max(1, Math.ceil(view.remaining));
}

/** A switch drawn the kit's way: square, hairline, brass when on. */
export function ProtoSwitch({
  on,
  label,
  onToggle,
  testId,
  compact = false,
}: {
  on: boolean;
  label: string;
  onToggle: () => void;
  testId?: string;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className="proto-switch"
      data-compact={compact || undefined}
      data-focusable
      data-testid={testId}
      onClick={onToggle}
    >
      <span className="proto-switch-label">{label}</span>
      <span className="proto-switch-state">{on ? "On" : "Off"}</span>
      <span className="proto-switch-track" aria-hidden="true">
        <span className="proto-switch-thumb" />
      </span>
    </button>
  );
}

/**
 * The floating prototype bar: variants, the scene shortcuts, and the state.
 * High-contrast on purpose, so it is obviously not part of the design.
 */
export function PrototypeBar({ surface }: { surface: "window" | "remote" }) {
  const view = useAutoplayProto();
  const cycle = (step: number) => {
    const at = VARIANTS.indexOf(view.variant);
    proto.setVariant(VARIANTS[(at + step + VARIANTS.length) % VARIANTS.length]!);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable]")) {
        return;
      }
      if (event.key === "[") {
        cycle(-1);
      } else if (event.key === "]") {
        cycle(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!PROTO || import.meta.env.PROD) {
    return null;
  }

  return (
    <div className="proto-bar" data-surface={surface} data-testid="proto-bar">
      <button type="button" onClick={() => cycle(-1)} aria-label="Previous variant">
        ◀
      </button>
      <strong data-testid="proto-variant">
        {view.variant} · {VARIANT_NAMES[view.variant]}
      </strong>
      <button type="button" onClick={() => cycle(1)} aria-label="Next variant">
        ▶
      </button>
      <span className="proto-bar-rule" />
      <button type="button" data-testid="proto-near-end" onClick={() => protoNearEnd()}>
        5s before end
      </button>
      <button type="button" data-testid="proto-end" onClick={() => protoEnd()}>
        End now
      </button>
      <button
        type="button"
        data-testid="proto-still-there"
        aria-pressed={stateEndMode() === "still_there"}
        onClick={() =>
          proto.setEndMode(stateEndMode() === "still_there" ? "normal" : "still_there")
        }
      >
        {surface === "remote" ? "4th" : "Next end is the 4th unattended"}
      </button>
      <span className="proto-bar-rule" />
      <code data-testid="proto-state">
        autoplay={String(view.autoplay)} phase={view.phase}
        {view.phase === "countdown" ? ` ${view.remaining.toFixed(1)}s` : ""}
      </code>
      <small>[ and ] cycle variants</small>
    </div>
  );
}

function stateEndMode(): EndMode {
  return state.endMode;
}
