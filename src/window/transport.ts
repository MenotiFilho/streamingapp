/**
 * How a window reaches its Host: one command in, one event out (ADR-0035 §1).
 *
 * The Tauri transport is the real one; the rehearsal hands in the preview's,
 * and a test hands in its own so the window can be driven without a Host. The
 * shape lives beside the adapters rather than in the client core, because
 * `invoke` and `listen` are the Tauri IPC's own words.
 */
export type Transport = {
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
  listen: <T>(
    event: string,
    handler: (event: { payload: T }) => void,
  ) => Promise<() => void>;
};
