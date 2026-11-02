/**
 * The input modality: which device last asked the client to do something.
 *
 * Focus is both a navigation instrument and a pointer side effect (#245). A
 * click or a tap is direct manipulation: it should show no focus decoration and
 * move nothing. A key or a pad intent is navigation: the control is decorated
 * and the movement's axis is brought into view. The modality is the last
 * input, not the control: a pointer press on a focused control then a key
 * switches the whole room back to navigation.
 *
 * The state is here, framework-free, because both clients read it (ADR-0035
 * §1). The installer takes the page root rather than reaching for a global
 * document, so the rule itself stays out of the platform; the entries pass
 * `document.documentElement` and the tests pass a fake root.
 */

/** Which device last asked for something. */
export type InputModality = "pointer" | "navigation";

/**
 * The page root the installer needs: the document element it listens on and
 * whose `data-input` attribute the stylesheets read. A real `HTMLElement`
 * fits.
 */
export type ModalityRoot = {
  dataset: DOMStringMap;
  addEventListener(
    type: "keydown" | "pointerdown",
    listener: (event: Event) => void,
    capture?: boolean,
  ): void;
  removeEventListener(
    type: "keydown" | "pointerdown",
    listener: (event: Event) => void,
    capture?: boolean,
  ): void;
};

/**
 * Pointer until a key or a pad intent says otherwise. This is what makes a
 * click on a control that was focused at mount paint nothing: the room opens
 * in pointer mode and only a navigation input dresses it.
 */
let current: InputModality = "pointer";

const listeners = new Set<(modality: InputModality) => void>();

/** The roots the attribute is written on; more than one page in tests. */
const roots = new Set<ModalityRoot>();

/** The page root each installed teardown belongs to, so install is idempotent. */
const installed = new WeakMap<ModalityRoot, () => void>();

function writeAttribute(root: ModalityRoot): void {
  root.dataset.input = current;
}

function announce(): void {
  for (const root of roots) {
    writeAttribute(root);
  }
  for (const listener of listeners) {
    listener(current);
  }
}

/** Which device last asked. */
export function inputModality(): InputModality {
  return current;
}

/** A key or a pad intent chose navigation: decoration and centring are back. */
export function markNavigation(): void {
  if (current === "navigation") {
    return;
  }
  current = "navigation";
  announce();
}

/** A pointer press is direct manipulation, whatever was focused before it. */
export function markPointer(): void {
  if (current === "pointer") {
    return;
  }
  current = "pointer";
  announce();
}

/** Watch the modality change; returns the unsubscribe. */
export function subscribeInputModality(
  listener: (modality: InputModality) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Make the last input the page's modality. Any `keydown` — Tab, an arrow key,
 * Enter — means navigation; any `pointerdown` — mouse, pen or touch — means
 * pointer. Capture, so the attribute is right before the browser moves focus
 * (a pointer press focuses natively, a key press is handled by the engine).
 *
 * Idempotent per root and cleanable: a second install returns the first
 * teardown rather than listening twice. The pad has no key event; the focus
 * engine calls `markNavigation` itself.
 */
export function installInputModality(root: ModalityRoot): () => void {
  const existing = installed.get(root);
  if (existing) {
    return existing;
  }

  const onKeyDown = () => markNavigation();
  const onPointerDown = () => markPointer();

  root.addEventListener("keydown", onKeyDown, true);
  root.addEventListener("pointerdown", onPointerDown, true);
  roots.add(root);
  writeAttribute(root);

  const teardown = () => {
    root.removeEventListener("keydown", onKeyDown, true);
    root.removeEventListener("pointerdown", onPointerDown, true);
    roots.delete(root);
    installed.delete(root);
  };
  installed.set(root, teardown);
  return teardown;
}
