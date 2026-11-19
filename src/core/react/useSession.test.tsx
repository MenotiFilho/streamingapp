import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, test } from "vitest";

import type { HostLink, LinkState } from "../link";
import type { Action, Response, Snapshot } from "../wire";
import { useSession, type SessionReads } from "./useSession";

function nothing(revision: number): Snapshot {
  return {
    revision,
    playback: {
      state: "idle",
      autoplay: null,
      picture: "in_window",
      failure: null,
      nowPlaying: null,
      episode: null,
      position: null,
      duration: null,
      buffered: null,
      tracks: [],
      chapters: [],
      chapter: null,
      speed: null,
      volume: null,
      muted: null,
      subtitleDelay: null,
      stalled: false,
      crop: null,
      aspect: null,
      resolution: null,
      statistics: null,
    },
    preferences: {
      subtitleLanguages: [],
      audioLanguages: [],
      subtitleColor: "#FFFFFF",
      subtitleScale: 1,
      streamBuffer: { seconds: 300, megabytes: 512 },
      torrentCache: { megabytes: 2000 },
      upNextPlayback: "direct",
      autoplay: true,
    },
    addons: [],
    featuredCatalog: null,
    protection: { backend: "file", tmdbHeld: false, stremioHeld: false },
    continueWatching: [],
    watchProgress: [],
    devices: [],
    pairingCode: "4K7Q2M",
    address: null,
  };
}

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((fulfil) => {
    resolve = fulfil;
  });
  return { promise, resolve };
}

function fakeHost(answer: () => Promise<Response> = async () => ({ snapshots: [], answer: null })) {
  const state: LinkState = { kind: "ready", device: null };
  const snapshots = new Set<(snapshot: Snapshot) => void>();
  const states = new Set<(state: LinkState) => void>();
  const order: string[] = [];
  const actions: Action[] = [];
  let reads = 0;

  const link: HostLink = {
    snapshot: async () => {
      reads += 1;
      order.push("snapshot");
      return nothing(3);
    },
    dispatch: async (action) => {
      actions.push(action);
      return answer();
    },
    onSnapshot: (handler) => {
      order.push("onSnapshot");
      snapshots.add(handler);
      return () => {
        snapshots.delete(handler);
      };
    },
    onRevision: () => () => {},
    state: () => state,
    onState: (handler) => {
      order.push("onState");
      states.add(handler);
      return () => {
        states.delete(handler);
      };
    },
    close: () => undefined,
  };

  return {
    link,
    order,
    actions,
    reads: () => reads,
    snapshotListeners: () => snapshots.size,
    stateListeners: () => states.size,
  };
}

/** The probe is the harness: it presses the button and hands back what it reads. */
function Probe({
  link,
  onRead,
}: {
  link: HostLink;
  onRead?: (read: SessionReads) => void;
}) {
  const read = useSession(link);
  onRead?.(read);
  return (
    <button
      type="button"
      onClick={() => {
        void read.session.take({ type: "set_paused", paused: true });
      }}
    >
      Ask
    </button>
  );
}

/** The latest read the probe handed back, which the assertions look at. */
function latest(reads: SessionReads[]): SessionReads | undefined {
  return reads.at(-1);
}

describe("useSession", () => {
  test("subscribes before the first read and hands the Snapshot to the screen", async () => {
    const host = fakeHost();
    const reads: SessionReads[] = [];
    render(<Probe link={host.link} onRead={(read) => reads.push(read)} />);

    await waitFor(() => expect(latest(reads)?.state.snapshot?.revision).toBe(3));
    expect(host.order).toEqual(["onSnapshot", "onState", "snapshot"]);
    expect(host.reads()).toBe(1);
  });

  test("StrictMode's start/stop leaves one subscription and one first read", async () => {
    const host = fakeHost();
    const reads: SessionReads[] = [];
    render(
      <StrictMode>
        <Probe link={host.link} onRead={(read) => reads.push(read)} />
      </StrictMode>,
    );

    await waitFor(() => expect(latest(reads)?.state.snapshot?.revision).toBe(3));
    await waitFor(() => expect(host.snapshotListeners()).toBe(1));
    expect(host.stateListeners()).toBe(1);
    expect(host.reads()).toBe(1);
  });

  test("the Session's pending keys reach the screen", async () => {
    const gate = deferred<Response>();
    const host = fakeHost(() => gate.promise);
    const reads: SessionReads[] = [];
    render(<Probe link={host.link} onRead={(read) => reads.push(read)} />);

    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    await waitFor(() => expect(latest(reads)?.state.pending.size).toBe(1));
    expect(host.actions).toEqual([{ type: "set_paused", paused: true }]);

    await act(async () => {
      gate.resolve({ snapshots: [], answer: null });
      await Promise.resolve();
    });
    await waitFor(() => expect(latest(reads)?.state.pending.size).toBe(0));
  });

  test("the Session and its reads keep their identity between unchanged renders", async () => {
    const host = fakeHost();
    const reads: SessionReads[] = [];
    const view = render(<Probe link={host.link} onRead={(read) => reads.push(read)} />);
    await waitFor(() => expect(latest(reads)?.state.snapshot?.revision).toBe(3));

    const before = latest(reads);
    view.rerender(<Probe link={host.link} onRead={(read) => reads.push(read)} />);

    expect(latest(reads)).toBe(before);
  });
});
