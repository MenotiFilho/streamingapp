import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useSyncExternalStore } from "react";
import { describe, expect, test, vi } from "vitest";

import { explain } from "../core/errors";
import type { Respond } from "./fakeHost.testing";
import { FakeHost } from "./fakeHost.testing";
import type { Session } from "../core/session";
import { Session as SessionClass } from "../core/session";
import { playStreamAction, unplayableNote } from "../core/stream";
import type { AddonStreams, AddonManifest, Response, Snapshot, Stream, Title, Video } from "../core/wire";
import { NOTHING } from "./fakeSocket.testing";
import { StreamsScreen } from "./StreamsScreen";
import { STREAMS_NONE } from "./streamsScreen";

/**
 * The Streams level over a fake HostLink (#210, ADR-0032, docs/agents/testing.md).
 *
 * The assertions are the level's decisions: the one `find_streams` it asks for
 * the Video it carries, the Host's group order and counts, the `play_stream`
 * one press builds through the core, the wait that disables every row, the
 * candidate this Host cannot open that sends nothing, and the unplayable mark
 * the answer settles (ADR-0020, ADR-0027).
 */

const CINEMETA: AddonManifest = {
  id: "cinemeta",
  name: "Cinemeta",
  version: "3.0.14",
  resources: [{ name: "stream", types: ["movie", "series"], idPrefixes: ["tt"] }],
  types: ["movie", "series"],
  catalogs: [],
  idPrefixes: ["tt"],
  behaviorHints: { configurable: false, configurationRequired: false },
};

const TORRENTIO: AddonManifest = {
  ...CINEMETA,
  id: "torrentio",
  name: "Torrentio",
};

const SNAPSHOT: Snapshot = { ...NOTHING, addons: [CINEMETA, TORRENTIO] };

const TITLE: Title = {
  addon: "cinemeta",
  id: "tt1",
  key: { kind: "addon", addon: "cinemeta", id: "tt1" },
  type: "movie",
  name: "One",
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

const VIDEO: Video = {
  id: "tt1",
  name: null,
  season: null,
  episode: null,
  thumbnail: null,
  airDate: null,
};

const DIRECT: Stream = {
  name: "Torrentio\n4k DV",
  description: "A release, in the Addon's words.",
  playback: { kind: "direct", url: "https://example.test/film.mkv" },
  warnings: ["p2p"],
  filename: "film.mkv",
  bingeGroup: null,
};

const OTHER: Stream = {
  ...DIRECT,
  name: "Cinemeta",
  filename: "other.mkv",
};

const HASH: Stream = {
  name: "Torrentio",
  description: null,
  playback: { kind: "info_hash", infoHash: "abc123" },
  warnings: [],
  filename: null,
  bingeGroup: null,
};

function group(
  addon: string,
  streams: Stream[] = [],
  failure: AddonStreams["failure"] = null,
): AddonStreams {
  return { addon, streams, failure };
}

function answer(groups: AddonStreams[]): Response {
  return { snapshots: [], answer: { streams: groups } };
}

/** The screen as the room hands it: a Session over the door, and the wait it publishes. */
function Shown({ session, onOpened }: { session: Session; onOpened?: () => void }) {
  const state = useSyncExternalStore(session.subscribe, session.getState);
  useEffect(() => session.start(), [session]);
  return (
    <StreamsScreen
      title={TITLE}
      video={VIDEO}
      session={session}
      state={state}
      onOpened={onOpened ?? (() => undefined)}
    />
  );
}

function mount(respond: Respond) {
  const host = new FakeHost(SNAPSHOT, respond);
  const session = new SessionClass(host);
  const view = render(<Shown session={session} />);
  return { host, session, view };
}

/** Mount the level with one answer, and wait until the ask has settled. */
async function mountAnswered(groups: AddonStreams[]) {
  const mounted = mount(() => answer(groups));
  await waitFor(() => expect(mounted.host.asked("find_streams")).toHaveLength(1));
  await flush();
  return mounted;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** The groups as drawn, in the order the level put them. */
function groupOrder(): Array<string | null> {
  return screen
    .getAllByTestId(/^streams-group-/)
    .map((element) => element.getAttribute("data-addon"));
}

describe("the Streams level's one question", () => {
  test("asks find_streams once for the Video it carries, and a Snapshot is not a new ask", async () => {
    const { host } = await mountAnswered([group("torrentio", [DIRECT])]);

    expect(host.asked("find_streams")).toEqual([
      { type: "find_streams", video: { type: "movie", id: "tt1" } },
    ]);

    await act(async () => {
      host.publish({ ...SNAPSHOT, revision: 2 });
      await Promise.resolve();
    });
    await flush();
    expect(host.asked("find_streams")).toHaveLength(1);
  });

  test("groups in the Host's order", async () => {
    await mountAnswered([
      group("torrentio", [DIRECT, { ...DIRECT, filename: "second.mkv" }]),
      group("cinemeta", [OTHER]),
    ]);

    expect(groupOrder()).toEqual(["torrentio", "cinemeta"]);
  });

  test("no group at all names the empty list, and marks the Title unplayable", async () => {
    const { session } = await mountAnswered([]);

    expect(screen.getByRole("status")).toHaveTextContent(STREAMS_NONE);
    expect(session.getState().unplayable.has(TITLE.id)).toBe(true);
  });
});

describe("choosing a candidate", () => {
  test("one press sends one play_stream with the Addon, the Stream and the Title stub", async () => {
    const held = deferred<Response>();
    const { host } = mount((action) =>
      action.type === "find_streams" ? answer([group("torrentio", [DIRECT])]) : held.promise,
    );
    await screen.findByTestId("stream-torrentio-0");

    fireEvent.click(screen.getByTestId("stream-torrentio-0"));

    await waitFor(() => expect(host.asked("play_stream")).toHaveLength(1));
    expect(host.asked("play_stream")).toEqual([
      playStreamAction(TITLE, VIDEO, "torrentio", DIRECT),
    ]);
  });

  test("the Stream the Host takes opens the player, and a refused one does not", async () => {
    let refused = false;
    const onOpened = vi.fn();
    const host = new FakeHost(SNAPSHOT, (action) =>
      action.type === "find_streams"
        ? answer([group("torrentio", [DIRECT])])
        : refused
          ? Promise.reject({ kind: "unreachable", detail: "the Host is not connected" })
          : { snapshots: [], answer: null },
    );
    const session = new SessionClass(host);
    render(<Shown session={session} onOpened={onOpened} />);
    await screen.findByTestId("stream-torrentio-0");

    fireEvent.click(screen.getByTestId("stream-torrentio-0"));
    await waitFor(() => expect(onOpened).toHaveBeenCalledOnce());

    // A refusal leaves the list where it is: the person still has candidates
    // to choose from, and a card of nothing is not the player.
    refused = true;
    fireEvent.click(screen.getByTestId("stream-torrentio-0"));
    await waitFor(() =>
      expect(screen.getByTestId("stream-torrentio-0")).not.toHaveAttribute(
        "aria-busy",
      ),
    );
    expect(onOpened).toHaveBeenCalledOnce();
  });

  test("every row is disabled while one is on its way, so a second press sends nothing", async () => {
    const held = deferred<Response>();
    const { host } = mount((action) =>
      action.type === "find_streams"
        ? answer([group("torrentio", [DIRECT, OTHER])])
        : held.promise,
    );
    await screen.findByTestId("stream-torrentio-1");

    fireEvent.click(screen.getByTestId("stream-torrentio-0"));
    await waitFor(() => expect(host.asked("play_stream")).toHaveLength(1));

    expect(
      screen.getByTestId("stream-torrentio-0"),
      "the pressed row is the one that says it is waiting",
    ).toHaveAttribute("aria-busy", "true");
    expect(screen.getByTestId("stream-torrentio-1")).toBeDisabled();
    fireEvent.click(screen.getByTestId("stream-torrentio-1"));
    await flush();
    expect(host.asked("play_stream")).toHaveLength(1);

    await act(async () => {
      held.resolve({ snapshots: [], answer: null });
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId("stream-torrentio-1")).not.toBeDisabled());

    // The wait is the Session's, and it is over: a different candidate is a
    // different Action and is sent as one.
    fireEvent.click(screen.getByTestId("stream-torrentio-1"));
    await waitFor(() => expect(host.asked("play_stream")).toHaveLength(2));
  });

  test("a candidate this Host cannot open sends nothing and draws its note", async () => {
    const { host } = await mountAnswered([group("torrentio", [HASH])]);

    fireEvent.click(screen.getByTestId("stream-torrentio-0"));
    await flush();

    expect(host.asked("play_stream")).toEqual([]);
    expect(screen.getByRole("status")).toHaveTextContent(unplayableNote(HASH));
  });
});

describe("the mark an answer settles", () => {
  test("every group answered with no candidate, so the Title is marked unplayable", async () => {
    const { session } = await mountAnswered([
      group("cinemeta"),
      group("torrentio"),
    ]);

    expect(session.getState().unplayable.has(TITLE.id)).toBe(true);
  });

  test("one candidate clears a mark an earlier answer set", async () => {
    const host = new FakeHost(SNAPSHOT, () => answer([group("torrentio", [DIRECT])]));
    const session = new SessionClass(host);
    session.markUnplayable(TITLE.id, true);
    render(<Shown session={session} />);
    await screen.findByTestId("stream-torrentio-0");

    expect(session.getState().unplayable.has(TITLE.id)).toBe(false);
  });

  test("a failed Addon proves nothing, so the mark is left alone and its refusal is the Host's words", async () => {
    const failure = { kind: "fetch", detail: "timeout" } as const;
    const { session } = await mountAnswered([
      group("cinemeta", [], failure),
      group("torrentio"),
    ]);

    expect(session.getState().unplayable.has(TITLE.id)).toBe(false);
    expect(screen.getByRole("alert")).toHaveTextContent(explain(failure));
  });
});
