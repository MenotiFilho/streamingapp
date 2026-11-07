import type { Action } from "./wire";

/**
 * How long a card must be rested on before its Title is read ahead (#278,
 * ADR-0038 §3).
 *
 * Long enough that a D-pad cross or a pointer passing over the row costs the
 * Host nothing, short enough that the Title is usually in hand by the press.
 * The number lives here, with the decision, so a screen cannot choose its own
 * dwell.
 */
export const LOOK_HINT_DWELL_MS = 400;

/** A Title named the way a card names one: its Addon or none, its type and id. */
export type LookHintTarget = {
  addon: string | null;
  type: string;
  id: string;
};

/** What a card is being rested on with: keyboard/D-pad focus, or a pointer. */
export type LookHintSource = "focus" | "pointer";

type Rest = { target: LookHintTarget; since: number };

function sameTarget(one: LookHintTarget, other: LookHintTarget): boolean {
  return one.addon === other.addon && one.type === other.type && one.id === other.id;
}

/**
 * The dwell decision: which cards are being rested on, and which have been
 * rested on long enough to read ahead.
 *
 * The clock is injected so the window can use `Date.now` and a test can decide
 * the moment. Focus and the pointer are tracked separately: a pointer that
 * passes over a focused card and leaves must not cancel the keyboard's rest,
 * and a card focused and hovered at once is one hint, not two. `due` consumes
 * every rest on the target it answers, so one rest sends one hint.
 */
export class LookHintDwell {
  private readonly rests = new Map<LookHintSource, Rest>();

  constructor(private readonly now: () => number) {}

  /** A source came to rest on `target`; an unchanged rest keeps its moment. */
  rest(source: LookHintSource, target: LookHintTarget): void {
    const held = this.rests.get(source);
    if (held && sameTarget(held.target, target)) {
      return;
    }
    this.rests.set(source, { target, since: this.now() });
  }

  /** A source left the card it was on. A source that never rested does nothing. */
  left(source: LookHintSource): void {
    this.rests.delete(source);
  }

  /**
   * How long until a rest reaches the dwell, in milliseconds, or null when
   * nothing is resting. A screen schedules one timer from this and asks `due`
   * when it fires.
   */
  remaining(): number | null {
    if (this.rests.size === 0) {
      return null;
    }
    const at = this.now();
    let soonest = Number.POSITIVE_INFINITY;
    for (const rest of this.rests.values()) {
      soonest = Math.min(soonest, LOOK_HINT_DWELL_MS - (at - rest.since));
    }
    return Math.max(0, soonest);
  }

  /**
   * The target a rest has lasted the dwell for, where one has, and consumes
   * that target's rests so a rest that continues does not hint again. A rest
   * that ended before the dwell is not due and never was.
   */
  due(): LookHintTarget | null {
    const at = this.now();
    let chosen: Rest | null = null;
    for (const rest of this.rests.values()) {
      if (at - rest.since >= LOOK_HINT_DWELL_MS && (chosen === null || rest.since < chosen.since)) {
        chosen = rest;
      }
    }
    if (chosen === null) {
      return null;
    }
    for (const [source, rest] of [...this.rests]) {
      if (sameTarget(rest.target, chosen.target)) {
        this.rests.delete(source);
      }
    }
    return chosen.target;
  }
}

/** The fire-and-forget Action a rested card sends: its Title, read ahead. */
export function lookHint(target: LookHintTarget): Action {
  return {
    type: "look_hint",
    addon: target.addon,
    title: { type: target.type, id: target.id },
  };
}
