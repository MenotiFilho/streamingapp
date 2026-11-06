/**
 * A value the Session holds for a screen that unmounts (#264).
 *
 * Discover's chosen genre and Search's query are the person's place in a
 * surface, not the screen instance's: a Title or a whole-row grid is a pushed
 * level that unmounts Discover or Search on the Remote, and Back must return to
 * the same filter and the same words. It calls no React; a screen reads it
 * through `useSyncExternalStore`.
 */
export class Selection<T> {
  private value: T;
  private listeners = new Set<() => void>();

  constructor(initial: T) {
    this.value = initial;
  }

  get = (): T => this.value;

  set = (next: T): void => {
    if (Object.is(next, this.value)) {
      return;
    }
    this.value = next;
    for (const listener of this.listeners) {
      listener();
    }
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}
