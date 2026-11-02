/**
 * The input intent table.
 *
 * One table, two source columns: the window reads the keyboard and the pad, and
 * a remote client reads the keyboard column alone. The intents are the physical
 * expression of the shell's vocabulary — moving focus, activating, going back,
 * and stepping the volume — and nothing here knows what a screen does with one.
 *
 * The keyboard leaves Left, Right and Backspace to a text field: a person
 * typing a search has to be able to fix a typo without leaving the box, and
 * Backspace there is a deletion, not Back. Up and Down still move out, which is
 * how a remote with no Backspace leaves the field. A pad's A is `activate`
 * because the browser synthesizes no click for it.
 */

/** What a person asked the shell to do. */
export type Intent =
  | "up"
  | "down"
  | "left"
  | "right"
  | "activate"
  | "back"
  | "volume_up"
  | "volume_down";

/**
 * The keyboard column. Enter and Space are deliberately absent: they are the
 * control's own native activation, and re-implementing that here would press a
 * button twice.
 */
export const KEY_INTENTS: Readonly<Record<string, Intent>> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Escape: "back",
  Backspace: "back",
  GoBack: "back",
};

/**
 * The pad's button column, for a pad in the standard mapping. Indices are the
 * standard mapping's own: 12–15 are the D-pad, 0 is A, 1 is B, 2 is X, 3 is Y,
 * 8 is Back. The two unused faces become the player's volume: a pad has no
 * other way to ask for it, and a keyboard's own volume keys never reach the
 * page (research #49).
 */
export const PAD_BUTTONS: Readonly<Record<number, Intent>> = {
  12: "up",
  13: "down",
  14: "left",
  15: "right",
  0: "activate",
  1: "back",
  2: "volume_down",
  3: "volume_up",
  8: "back",
};

/** The pad's axis column: the left stick, read as two one-dimensional intents. */
export const PAD_AXES: Readonly<
  Record<number, { negative: Intent; positive: Intent }>
> = {
  0: { negative: "left", positive: "right" },
  1: { negative: "up", positive: "down" },
};

/** How far a stick must pass its rest before it counts as pressed. */
export const AXIS_THRESHOLD = 0.5;

/**
 * How far a pointer may move and still be a press rather than a drag. The row's
 * own drag and the cut-off press plan share it, so a drag that synthesises a
 * click is never mistaken for a press on the card under the pointer.
 */
export const DRAG_SLOP = 5;

/**
 * The one repeat cadence for a held direction. The pad and a held arrow key
 * both fire at once, then after this wait, then at this interval; otherwise
 * the keyboard's OS repeat would outrun the pad and the two would feel like
 * different rooms.
 */
export const REPEAT_AFTER_MS = 400;
export const REPEAT_EVERY_MS = 160;

/**
 * Which intents a held button repeats. A direction and a volume step are
 * things a person holds to go further; activating or going Back fires once per
 * press.
 */
export const REPEATABLE: ReadonlySet<Intent> = new Set<Intent>([
  "up",
  "down",
  "left",
  "right",
  "volume_up",
  "volume_down",
]);

/**
 * The least of a gamepad this table reads. A real `Gamepad` fits; a test does
 * not need to invent a whole device to ask what a press means.
 */
export type PadLike = {
  mapping: string;
  buttons: ReadonlyArray<{ pressed: boolean } | undefined>;
  axes: ReadonlyArray<number | undefined>;
};

/** The control that has the keyboard focus, where it is a place a person types. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).tagName !== "string") {
    return false;
  }
  const element = target as HTMLElement;
  if (element.isContentEditable) {
    return true;
  }

  switch (element.tagName) {
    case "TEXTAREA":
      return true;
    case "INPUT": {
      const type = (element as HTMLInputElement).type;
      // Buttons, checkboxes and sliders are controls, not places to type: the
      // arrows are the shell's there, not the caret's.
      return ![
        "button",
        "checkbox",
        "color",
        "file",
        "image",
        "radio",
        "range",
        "reset",
        "submit",
      ].includes(type);
    }
    default:
      return false;
  }
}

/**
 * The intent one keypress names, or null when the key is not this table's.
 * `typing` is whether the focus is in a text field; there Left, Right and
 * Backspace belong to the field.
 */
export function keyIntent(key: string, typing: boolean): Intent | null {
  const intent = KEY_INTENTS[key];
  if (!intent) {
    return null;
  }
  if (typing && (key === "ArrowLeft" || key === "ArrowRight" || key === "Backspace")) {
    return null;
  }
  return intent;
}

/**
 * Every intent a pad is holding right now, buttons before axes. Polling the pad
 * is the page's job: the Gamepad API has no key event to listen to.
 */
export function padIntents(pad: PadLike | null | undefined): Intent[] {
  const held: Intent[] = [];
  if (!pad || pad.mapping !== "standard") {
    return held;
  }

  for (let index = 0; index < pad.buttons.length; index += 1) {
    const intent = PAD_BUTTONS[index];
    if (intent && pad.buttons[index]?.pressed) {
      held.push(intent);
    }
  }

  for (let index = 0; index < pad.axes.length; index += 1) {
    const axis = PAD_AXES[index];
    const value = pad.axes[index];
    if (!axis || value === undefined) {
      continue;
    }
    if (value < -AXIS_THRESHOLD) {
      held.push(axis.negative);
    }
    if (value > AXIS_THRESHOLD) {
      held.push(axis.positive);
    }
  }

  return held;
}
