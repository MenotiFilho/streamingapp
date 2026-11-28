import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect, useSyncExternalStore } from "react";
import { describe, expect, test, vi } from "vitest";

import { explain } from "../core/errors";
import { streamsEmptyState } from "../core/marqueeStreams";
import type { Session } from "../core/session";
import { Session as SessionClass } from "../core/session";
import { playStreamAction, playabilityNote } from "../core/stream";
import type { AddonStreams, AddonManifest, Response, Snapshot, Stream, Title, Video } from "../core/wire";
import { FakeHost, type Respond } from "./fakeHost.testing";
import { NOTHING } from "./fakeSocket.testing";
import { StreamsScreen } from "./StreamsScreen";

const CINEMETA: AddonManifest = {
  id: "cinemeta",
  name: "Cinemeta",
  version: "3.0.14",
  resources: [{ name: "stream", types: ["movie", "series"], idPrefixes: ["tt"] }],
  types: ["movie", "series"],
  catalogs: [],
  idPrefixes: ["tt"],
  behaviorHints: { configurable: false, configurationRequired: false },
  enabled: true,
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

const TORRENT: Stream = {
  name: "Torrentio",
  description: null,
  playback: {
    kind: "torrent",
    infoHash: "0123456789abcdef0123456789abcdef01234567",
    fileIdx: 0,
    sources: [],
  },
  warnings: ["p2p"],
  filename: "torrent.mkv",
  bingeGroup: null,
};

const HASH: Stream = {
  name: "Unplayable",
  description: null,
  playback: { kind: "direct", url: "ftp://example.test/film.mkv" },
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

function rowButton(addon: string, index: number): HTMLElement {
  return within(screen.getByTestId(`candidate-${addon}-${index}`)).getByRole("button");
}

function groupOrder(): Array<string | null> {
  return screen
    .getAllByTestId(/^streams-(cinemeta|torrentio)$/)
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

  test("groups in the Host's order and supports Addon filter chips", async () => {
    await mountAnswered([
      group("torrentio", [DIRECT, { ...DIRECT, filename: "second.mkv" }]),
      group("cinemeta", [OTHER]),
    ]);

    expect(groupOrder()).toEqual(["torrentio", "cinemeta"]);

    fireEvent.click(screen.getByTestId("streams-filter-cinemeta"));
    expect(screen.queryByTestId("streams-torrentio")).not.toBeInTheDocument();
    expect(screen.getByTestId("streams-cinemeta")).toBeInTheDocument();
  });

  test("no group at all draws the empty state and marks the Title unplayable", async () => {
    const { session } = await mountAnswered([]);
    const empty = streamsEmptyState([]);

    const none = screen.getByTestId("streams-none");
    expect(none).toHaveTextContent(empty!.title);
    expect(none).toHaveTextContent(empty!.body);
    expect(session.getState().unplayable.has(TITLE.id)).toBe(true);
  });
});

describe("choosing a candidate", () => {
  test("one press sends one play_stream with the Addon, the Stream and the Title stub", async () => {
    const held = deferred<Response>();
    const { host } = mount((action) =>
      action.type === "find_streams" ? answer([group("torrentio", [DIRECT])]) : held.promise,
    );
    await screen.findByTestId("candidate-torrentio-0");

    fireEvent.click(rowButton("torrentio", 0));

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
    await screen.findByTestId("candidate-torrentio-0");

    fireEvent.click(rowButton("torrentio", 0));
    await waitFor(() => expect(onOpened).toHaveBeenCalledOnce());

    refused = true;
    fireEvent.click(rowButton("torrentio", 0));
    await waitFor(() => expect(rowButton("torrentio", 0)).not.toBeDisabled());
    expect(onOpened).toHaveBeenCalledOnce();
  });

  test("every row is disabled while one is on its way, so a second press sends nothing", async () => {
    const held = deferred<Response>();
    const { host } = mount((action) =>
      action.type === "find_streams"
        ? answer([group("torrentio", [DIRECT, OTHER])])
        : held.promise,
    );
    await screen.findByTestId("candidate-torrentio-1");

    fireEvent.click(rowButton("torrentio", 0));
    await waitFor(() => expect(host.asked("play_stream")).toHaveLength(1));

    expect(rowButton("torrentio", 0)).toBeDisabled();
    expect(rowButton("torrentio", 1)).toBeDisabled();
    fireEvent.click(rowButton("torrentio", 1));
    await flush();
    expect(host.asked("play_stream")).toHaveLength(1);

    await act(async () => {
      held.resolve({ snapshots: [], answer: null });
      await Promise.resolve();
    });
    await waitFor(() => expect(rowButton("torrentio", 1)).not.toBeDisabled());

    fireEvent.click(rowButton("torrentio", 1));
    await waitFor(() => expect(host.asked("play_stream")).toHaveLength(2));
  });

  test("a candidate this Host cannot open is disabled, sends nothing, and draws its unplayable badge", async () => {
    const { host } = await mountAnswered([group("torrentio", [HASH])]);

    const btn = rowButton("torrentio", 0);
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    await flush();

    expect(host.asked("play_stream")).toEqual([]);
    const badge = screen.getByTestId("stream-unplayable");
    expect(badge).toHaveAttribute("aria-label", playabilityNote(HASH.playback)!);
  });
});

describe("a torrent candidate", () => {
  test("is playable: one press sends the whole shape, and no unplayable badge is drawn", async () => {
    const { host } = await mountAnswered([group("torrentio", [TORRENT])]);

    fireEvent.click(rowButton("torrentio", 0));

    await waitFor(() => expect(host.asked("play_stream")).toHaveLength(1));
    expect(host.asked("play_stream")).toEqual([
      playStreamAction(TITLE, VIDEO, "torrentio", TORRENT),
    ]);
    expect(host.asked("play_stream")[0]).toMatchObject({ stream: TORRENT });
    expect(screen.queryByTestId("stream-unplayable")).toBeNull();
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
    await screen.findByTestId("candidate-torrentio-0");

    expect(session.getState().unplayable.has(TITLE.id)).toBe(false);
  });

  test("a failed Addon proves nothing, leaves the mark alone, and offers Try again", async () => {
    const failure = { kind: "fetch", detail: "timeout" } as const;
    let attempt = 0;
    const host = new FakeHost(SNAPSHOT, () => {
      attempt += 1;
      return attempt === 1
        ? answer([group("cinemeta", [], failure), group("torrentio")])
        : answer([group("cinemeta", [OTHER]), group("torrentio")]);
    });
    const session = new SessionClass(host);
    render(<Shown session={session} />);

    const cinemetaGroup = await screen.findByTestId("streams-cinemeta");
    expect(within(cinemetaGroup).getByRole("status")).toHaveTextContent(
      explain(failure),
    );
    expect(session.getState().unplayable.has(TITLE.id)).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("candidate-cinemeta-0")).toBeInTheDocument();
  });
});
