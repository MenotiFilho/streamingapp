import { describe, expect, test, vi } from "vitest";

import type { ActionError } from "../core/errors";
import type { LinkCapabilities, LinkContractFixture } from "../core/testing/linkContract";
import { describeLinkContract } from "../core/testing/linkContract";
import { ACTION_VERSION, REVISION_EVENT, SNAPSHOT_EVENT } from "../core/wire";
import type { Action, Response, Snapshot, Title } from "../core/wire";
import { PreviewLink } from "./previewLink";
import { previewTransport } from "./rehearsal/previewHost";
import { TauriLink } from "./tauriLink";
import type { Transport } from "./tauriLink";

const NOTHING: Snapshot = {
  revision: 1,
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
    torrent: null,
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

/** An Action the fake Tauri Host answers with an answer that names it. */
const ACCEPTED: Action = { type: "preview", at: 12 };
/** An Action the fake Tauri Host refuses. */
const REFUSED: Action = { type: "set_volume", level: 999 };
const REFUSAL: ActionError = { kind: "invalid_volume", level: "999" };

/** A Title a background refresh answers again (ADR-0038 §2). */
const REVISED: Title = {
  addon: "cinemeta",
  id: "tt1",
  key: { kind: "addon", addon: "cinemeta", id: "tt1" },
  type: "movie",
  name: "One, again",
  poster: null,
  background: null,
  logo: null,
  description: null,
  releaseInfo: null,
  runtime: null,
  imdbRating: null,
  genres: [],
  videos: [],
};

/**
 * The Tauri Host's transport as a test can hold it: what it holds, the calls it
 * read in order, the Snapshots it can publish, and the listeners it installed.
 */
function fakeTauriHost(initial: Snapshot = NOTHING) {
  let held = initial;
  const commands: string[] = [];
  const envelopes: Array<{ version: number; action: Action }> = [];
  const actions: Action[] = [];
  const answers: Response[] = [];
  const listeners = new Set<(event: { payload: Snapshot }) => void>();
  const revisionListeners = new Set<(event: { payload: unknown }) => void>();
  let unlistened = 0;

  const transport: Transport = {
    invoke: async <T,>(command: string, args?: Record<string, unknown>): Promise<T> => {
      commands.push(command);
      if (command === "snapshot") {
        return held as T;
      }
      if (command !== "dispatch") {
        throw new Error(`the fake Host has no ${command}`);
      }

      const envelope = args?.envelope as { version: number; action: Action };
      envelopes.push(envelope);
      actions.push(envelope.action);

      if (envelope.action.type === "set_volume" && envelope.action.level > 100) {
        throw REFUSAL;
      }

      const answer: Response =
        envelope.action.type === "preview"
          ? { snapshots: [], answer: { preview: { at: envelope.action.at, image: null } } }
          : { snapshots: [], answer: null };
      answers.push(answer);
      return answer as T;
    },
    listen: async <T,>(event: string, handler: (event: { payload: T }) => void) => {
      if (event === REVISION_EVENT) {
        const listener = handler as (event: { payload: unknown }) => void;
        revisionListeners.add(listener);
        return () => {
          unlistened += 1;
          revisionListeners.delete(listener);
        };
      }
      if (event !== SNAPSHOT_EVENT) {
        return () => undefined;
      }
      const listener = handler as (event: { payload: Snapshot }) => void;
      listeners.add(listener);
      return () => {
        unlistened += 1;
        listeners.delete(listener);
      };
    },
  };

  return {
    transport,
    snapshot: async (): Promise<Snapshot> => held,
    received: (): readonly Action[] => actions,
    answered: (): readonly Response[] => answers,
    envelopes: (): ReadonlyArray<{ version: number; action: Action }> => envelopes,
    commands: (): readonly string[] => commands,
    unlistened: (): number => unlistened,
    listeners: (): number => listeners.size,
    revisionListeners: (): number => revisionListeners.size,
    publish: async (): Promise<Snapshot> => {
      held = { ...held, revision: held.revision + 1 };
      for (const listener of [...listeners]) {
        listener({ payload: held });
      }
      return held;
    },
    /** Send one revised Answer, as a background refresh does (ADR-0038 §2). */
    revise: (title: Title): void => {
      for (const listener of [...revisionListeners]) {
        listener({ payload: { revision: title } });
      }
    },
  };
}

/** The window's link over the fake Tauri Host, as the contract builds it. */
function tauriFixture(): LinkContractFixture {
  const host = fakeTauriHost();
  return {
    link: new TauriLink(host.transport),
    host: {
      accepts: ACCEPTED,
      refuses: { action: REFUSED, error: REFUSAL },
      snapshot: host.snapshot,
      received: host.received,
      answered: host.answered,
      publish: host.publish,
    },
  };
}

const READY: LinkCapabilities = {
  startsReady: true,
  paired: true,
  publishes: true,
  refuses: true,
  refusalMovesState: false,
  revokes: false,
};

describeLinkContract("TauriLink over a fake Transport", tauriFixture, READY);

/**
 * The preview Host as the contract needs it: the real `previewTransport`,
 * wrapped only to record the Actions it was sent and the answers it gave. The
 * preview publishes on its own when a change lands, so `publish()` dispatches
 * one and hands back the Snapshot it published.
 */
function fakePreviewHost() {
  const received: Action[] = [];
  const answers: Response[] = [];
  let scale = 1;

  const transport = {
    invoke: async <T,>(command: string, args?: Record<string, unknown>): Promise<T> => {
      if (command !== "dispatch") {
        return previewTransport.invoke<T>(command, args);
      }

      const envelope = args?.envelope as { version: number; action: Action };
      received.push(envelope.action);
      const answer = await previewTransport.invoke<Response>(command, args);
      answers.push(answer);
      return answer as T;
    },
    listen: previewTransport.listen,
  };

  return {
    transport,
    snapshot: (): Promise<Snapshot> => previewTransport.invoke<Snapshot>("snapshot"),
    received: (): readonly Action[] => received,
    answered: (): readonly Response[] => answers,
    publish: async (): Promise<Snapshot> => {
      scale = scale === 1 ? 1.25 : 1;
      const envelope = {
        version: ACTION_VERSION,
        action: { type: "set_subtitle_scale", scale } satisfies Action,
      };
      const answer = await transport.invoke<Response>("dispatch", { envelope });
      const published = answer.snapshots.at(-1);
      if (!published) {
        throw new Error("the preview answered without publishing a Snapshot");
      }
      return published;
    },
  };
}

function previewFixture(): LinkContractFixture {
  const host = fakePreviewHost();
  return {
    link: new PreviewLink(host.transport),
    host: {
      accepts: { type: "set_subtitle_scale", scale: 1.5 },
      refuses: {
        action: { type: "set_subtitle_scale", scale: 9 },
        error: { kind: "invalid_subtitle_scale", scale: "9" },
      },
      snapshot: host.snapshot,
      received: host.received,
      answered: host.answered,
      publish: host.publish,
    },
  };
}

describeLinkContract("PreviewLink over the rehearsal Host", previewFixture, READY);

describe("the Tauri link's adapter", () => {
  test("a dispatch travels in the versioned envelope", async () => {
    const host = fakeTauriHost();
    const link = new TauriLink(host.transport);

    await link.dispatch(ACCEPTED);

    expect(host.envelopes()).toEqual([{ version: ACTION_VERSION, action: ACCEPTED }]);
  });

  test("a Device token a transport still delivered never leaves the link", async () => {
    const device = { id: "device-1", name: "Phone", pairedAt: 1_700_000_000_000 };
    const leaked = {
      snapshots: [],
      answer: { paired: { device, token: "secret" } },
    } as unknown as Response;
    const transport: Transport = {
      invoke: async <T,>() => leaked as T,
      listen: async () => () => undefined,
    };
    const link = new TauriLink(transport);

    const response = await link.dispatch({
      type: "pair_device",
      code: "4K7Q2M",
      name: "Phone",
    });

    expect(response.answer).toEqual({ paired: { device } });
  });

  test("snapshot() asks the Host for the state it holds", async () => {
    const host = fakeTauriHost();
    const link = new TauriLink(host.transport);

    expect(await link.snapshot()).toEqual(NOTHING);
    expect(host.commands()).toEqual(["snapshot"]);
  });

  test("a failure that is not the Host's refusal leaves as unreachable", async () => {
    const transport: Transport = {
      invoke: async () => {
        throw new Error("the IPC bridge is gone");
      },
      listen: async () => () => undefined,
    };
    const link = new TauriLink(transport);

    await expect(link.dispatch(ACCEPTED)).rejects.toEqual({
      kind: "unreachable",
      detail: "Error: the IPC bridge is gone",
    });
  });

  test("a listener that settles after its unsubscribe unlistens at once", async () => {
    let release: (() => void) | undefined;
    let unlistened = 0;
    const transport: Transport = {
      invoke: async <T,>() => NOTHING as T,
      listen: async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return () => {
          unlistened += 1;
        };
      },
    };
    const link = new TauriLink(transport);

    const stop = link.onSnapshot(() => undefined);
    stop();
    release?.();

    await vi.waitFor(() => expect(unlistened).toBe(1));
  });

  test("a listener that settles after close unlistens at once", async () => {
    let release: (() => void) | undefined;
    let unlistened = 0;
    const transport: Transport = {
      invoke: async <T,>() => NOTHING as T,
      listen: async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return () => {
          unlistened += 1;
        };
      },
    };
    const link = new TauriLink(transport);

    link.onSnapshot(() => undefined);
    link.close();
    release?.();

    await vi.waitFor(() => expect(unlistened).toBe(1));
  });

  test("close() unlistens what is listening", async () => {
    const host = fakeTauriHost();
    const link = new TauriLink(host.transport);

    link.onSnapshot(() => undefined);
    link.onSnapshot(() => undefined);
    link.close();

    await vi.waitFor(() => expect(host.unlistened()).toBe(2));
    expect(host.listeners()).toBe(0);
  });

  test("a revised Title arrives as the Title it revises, and stops when unsubscribed", async () => {
    const host = fakeTauriHost();
    const link = new TauriLink(host.transport);
    const seen: Title[] = [];
    const stop = link.onRevision((title) => seen.push(title));

    host.revise(REVISED);
    expect(seen).toEqual([REVISED]);

    stop();
    host.revise(REVISED);
    expect(seen, "an unsubscribed screen hears nothing more").toEqual([REVISED]);
    await vi.waitFor(() => expect(host.revisionListeners()).toBe(0));
  });
});

describe("the preview link's adapter", () => {
  test("close() stops the rehearsal's clock", () => {
    const stop = vi.fn();
    const link = new PreviewLink(previewTransport, stop);

    link.close();

    expect(stop).toHaveBeenCalledTimes(1);
  });

  test("a refused Action rejects as an ActionError and leaves the link ready", async () => {
    const link = new PreviewLink(previewTransport);

    await expect(
      link.dispatch({ type: "set_subtitle_scale", scale: 9 }),
    ).rejects.toEqual({ kind: "invalid_subtitle_scale", scale: "9" });
    expect(link.state()).toEqual({ kind: "ready", device: null });
  });

  test("a change is answered with the Snapshot the preview published", async () => {
    const link = new PreviewLink(previewTransport);

    const response = await link.dispatch({ type: "set_subtitle_scale", scale: 1.25 });

    expect(response.snapshots.at(-1)?.preferences.subtitleScale).toBe(1.25);
  });

  test("the rehearsal Host holds both language lists whole and refuses a list as the Host does", async () => {
    const link = new PreviewLink(previewTransport);

    const set = await link.dispatch({
      type: "set_subtitle_languages",
      languages: ["pt-BR", "en"],
    });
    expect(set.snapshots.at(-1)?.preferences.subtitleLanguages).toEqual(["pt-BR", "en"]);
    const audio = await link.dispatch({ type: "set_audio_languages", languages: ["fr"] });
    expect(audio.snapshots.at(-1)?.preferences.audioLanguages).toEqual(["fr"]);
    expect(audio.snapshots.at(-1)?.preferences.subtitleLanguages).toEqual(["pt-BR", "en"]);

    await expect(
      link.dispatch({ type: "set_audio_languages", languages: ["en", "fr", "de", "es"] }),
    ).rejects.toEqual({ kind: "too_many_languages", count: 4, max: 3 });
    await expect(
      link.dispatch({ type: "set_audio_languages", languages: ["pt-BR", "PT-br"] }),
    ).rejects.toEqual({ kind: "duplicate_language", language: "PT-br" });

    const cleared = await link.dispatch({ type: "set_subtitle_languages", languages: [] });
    expect(cleared.snapshots.at(-1)?.preferences.subtitleLanguages).toEqual([]);
  });

  test("close() unsubscribes, so a later change is not delivered", async () => {
    const link = new PreviewLink(previewTransport);
    const seen: Snapshot[] = [];
    link.onSnapshot((snapshot) => seen.push(snapshot));
    const before = seen.length;

    link.close();
    await previewTransport.invoke<Response>("dispatch", {
      envelope: {
        version: ACTION_VERSION,
        action: { type: "set_subtitle_scale", scale: 1 } satisfies Action,
      },
    });

    expect(seen.length).toBe(before);
  });
});
