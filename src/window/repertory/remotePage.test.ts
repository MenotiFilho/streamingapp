import { JSDOM } from "jsdom";
import { afterEach, describe, expect, test, vi } from "vitest";

import template from "../../../crates/host-wire/remote/index.html?raw";
import icons from "../../../crates/host-wire/remote/icons.svg?raw";
import tmdbLogo from "../../assets/tmdb-logo.svg?raw";
import appearance from "../../subtitle-appearance.json?raw";
import languages from "../../subtitle-languages.json?raw";
import buffer from "../../stream-buffer.json?raw";
import repertoryTokens from "./tokens.css?raw";

/**
 * The served Remote's own smoke (#159, cut over to `/` in #160).
 *
 * The page has no seams of its own: one document, one classic script, one
 * module script. This test parses and boots the spliced template in jsdom, hands
 * it a Welcome and a Snapshot over a fake socket, and asks where the transport
 * is. It never asserts the drawing beyond the surface the ticket names.
 */

function spliced(): string {
  return template
    .replace("/*__SPLICE_REPERTORY_TOKENS__*/", repertoryTokens)
    .replace("<!--__SPLICE_REPERTORY_ICONS__-->", icons)
    .replace("/*__SPLICE_SUBTITLE_LANGUAGES__*/", languages)
    .replace("/*__SPLICE_SUBTITLE_APPEARANCE__*/", appearance)
    .replace("/*__SPLICE_STREAM_BUFFER__*/", buffer)
    .replace("/*__SPLICE_TMDB_LOGO__*/", tmdbLogo);
}

const SNAPSHOT = {
  revision: 2,
  playback: {
    state: "playing",
    picture: "nowhere",
    failure: null,
    nowPlaying: {
      video: { type: "movie", id: "tt0133093" },
      addon: "cinemeta",
      name: "Cinemeta\n1080p",
      description: null,
      filename: null,
      bingeGroup: null,
    },
    episode: null,
    position: 120,
    duration: 600,
    buffered: null,
    tracks: [],
    chapters: [],
    chapter: null,
    speed: 1,
    volume: 80,
    muted: false,
    subtitleDelay: 0,
    crop: null,
    aspect: null,
    resolution: null,
    statistics: null,
  },
  preferences: {
    subtitleLanguage: null,
    subtitleColor: "#FFFFFF",
    subtitleScale: 1,
    streamBuffer: { seconds: 300, megabytes: 512 },
  },
  addons: [],
  featuredCatalog: null,
  protection: { backend: "file", tmdbHeld: false, stremioHeld: false },
  watchProgress: [],
  devices: [],
  pairingCode: "4K7Q2M",
  address: "127.0.0.1:8090",
};

class FakeSocket {
  static instances: FakeSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  private readonly listeners = new Map<string, Array<(event: { data?: string }) => void>>();
  readonly sent: string[] = [];
  readyState = 0;

  constructor(public readonly url: string) {
    FakeSocket.instances.push(this);
  }

  addEventListener(type: string, handler: (event: { data?: string }) => void): void {
    const held = this.listeners.get(type) ?? [];
    held.push(handler);
    this.listeners.set(type, held);
  }

  send(text: string): void {
    this.sent.push(text);
  }

  close(): void {
    this.readyState = 3;
  }

  emit(type: string, event: { data?: string } = {}): void {
    if (type === "open") { this.readyState = 1; }
    if (type === "close") { this.readyState = 3; }
    for (const handler of this.listeners.get(type) ?? []) {
      handler(event);
    }
  }
}

function boot(now?: () => number): { window: any; socket: FakeSocket } {
  FakeSocket.instances = [];
  const dom = new JSDOM(spliced(), {
    runScripts: "dangerously",
    url: "http://127.0.0.1:8090/",
    beforeParse(window: any) {
      window.WebSocket = FakeSocket as unknown as typeof WebSocket;
      if (now) { window.Date.now = now; }
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: () => ({
          matches: false,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }),
      });
    },
  });
  const socket = FakeSocket.instances[0];
  if (!socket) {
    throw new Error("the page opened a socket");
  }
  return { window: dom.window, socket };
}

function welcome(socket: FakeSocket): void {
  socket.emit("message", {
    data: JSON.stringify({
      version: 1,
      welcome: { device: { id: "device-1", name: "Phone" } },
    }),
  });
}

function snapshot(socket: FakeSocket, body: unknown = SNAPSHOT): void {
  socket.emit("message", { data: JSON.stringify({ version: 1, snapshot: body }) });
}

function lastSent(socket: FakeSocket): any {
  const last = socket.sent.at(-1);
  if (!last) {
    throw new Error("the page sent no frame");
  }
  return JSON.parse(last);
}

function expand(window: any): void {
  const center = window.document.querySelector('#mini-strip [data-a="expand-cast"]');
  if (!center) {
    throw new Error("the docked strip offers the expanded Remote");
  }
  center.click();
}

describe("the served Remote's page", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("boots at /, takes a Snapshot, and puts the transport on the card", () => {
    const { window, socket } = boot();

    expect(window.document.documentElement.dataset.ui).toBeUndefined();
    expect(
      window.document.getElementById("pairing")?.classList.contains("hidden"),
      "a page with no token asks to pair",
    ).toBe(false);
    expect(window.document.getElementById("app")?.classList.contains("hidden")).toBe(true);

    welcome(socket);
    snapshot(socket);
    expect(window.document.getElementById("app")?.classList.contains("hidden")).toBe(false);
    expect(
      window.document.getElementById("mini-strip")?.classList.contains("hidden"),
      "the docked strip is the collapsed Remote",
    ).toBe(false);

    expand(window);
    const cast = window.document.getElementById("surface-remote");
    expect(cast?.classList.contains("hidden")).toBe(false);
    expect(cast?.querySelector(".transport")).not.toBeNull();
    expect(cast?.querySelector('[data-a="pause-toggle"]')).not.toBeNull();
    expect(cast?.querySelectorAll(".cast-menus .utility")).toHaveLength(5);
    expect(
      cast?.querySelector(".transport [data-a='pause-toggle'] .rep-icon"),
      "the transport uses the sprite, not a Unicode mark",
    ).not.toBeNull();
  });

  test("a drawer closes on Done even when its animation cannot run", () => {
    const { window, socket } = boot();
    // A browser whose Motion bundle fails to start, or throws while reading a
    // panel it cannot measure, must not turn the drawer into a trap.
    window.startRepertoryMotion(() => {
      throw new Error("this browser cannot animate");
    });
    welcome(socket);
    snapshot(socket);
    expand(window);

    const cast = window.document.getElementById("surface-remote");
    cast.querySelector('[data-focus-key="cast-audio"]').click();
    const sheet = window.document.getElementById("sheet");
    expect(sheet?.classList.contains("hidden")).toBe(false);

    sheet.querySelector('[data-a="close-sheet"]').click();
    expect(sheet.classList.contains("hidden")).toBe(true);
  });

  test("a press on the ink around a drawer closes it", () => {
    const { window, socket } = boot();
    welcome(socket);
    snapshot(socket);
    expand(window);

    const cast = window.document.getElementById("surface-remote");
    cast.querySelector('[data-focus-key="cast-speed"]').click();
    const sheet = window.document.getElementById("sheet");
    expect(sheet?.classList.contains("hidden")).toBe(false);

    sheet.click();
    expect(sheet.classList.contains("hidden")).toBe(true);
  });

  test("the cast clock moves between Snapshots without another one", () => {
    vi.useFakeTimers();
    let now = 1_000_000;
    const { window, socket } = boot(() => now);
    welcome(socket);
    snapshot(socket);
    expand(window);

    const cast = window.document.getElementById("surface-remote");
    const clock = () => cast.querySelector("[data-clock]").textContent;
    expect(clock()).toBe("2:00");

    now += 2000;
    vi.advanceTimersByTime(2000);
    expect(clock()).toBe("2:02");
  });

  test("a moving bitrate updates the statistics where they stand", () => {
    const { window, socket } = boot();
    const playing = (bitrate: number, revision: number) => ({
      ...SNAPSHOT,
      revision,
      playback: {
        ...SNAPSHOT.playback,
        statistics: { bitrate, droppedFrames: 0, hardwareDecode: "no" },
      },
    });
    welcome(socket);
    snapshot(socket, playing(1000, 2));
    expand(window);

    const cast = window.document.getElementById("surface-remote");
    cast.querySelector('[data-focus-key="cast-picture"]').click();
    const sheet = window.document.getElementById("sheet");
    sheet.querySelector('[data-a="stats-toggle"]').click();
    const done = sheet.querySelector('[data-a="close-sheet"]');

    snapshot(socket, playing(2_000_000, 3));
    expect(
      sheet.querySelector('[data-a="close-sheet"]'),
      "the drawer, and the Done on it, are not rebuilt for a number that moves",
    ).toBe(done);
    expect(sheet.querySelector('[data-stat="Bitrate"]')?.textContent).toBe("2.0 Mbps");
  });

  test("a pushed Snapshot moves the transport's own state", async () => {
    const { window, socket } = boot();
    welcome(socket);
    snapshot(socket);
    socket.emit("open");
    expand(window);
    const cast = window.document.getElementById("surface-remote");

    cast.querySelector('[data-focus-key="cast-pause"]').click();
    const sent = lastSent(socket);
    expect(sent.command.type).toBe("set_paused");
    socket.emit("message", {
      data: JSON.stringify({
        version: 1,
        id: sent.id,
        response: { snapshots: [], answer: null },
      }),
    });
    socket.emit("message", {
      data: JSON.stringify({
        version: 1,
        snapshot: {
          ...SNAPSHOT,
          revision: 3,
          playback: { ...SNAPSHOT.playback, state: "paused" },
        },
      }),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      cast.querySelector('[data-focus-key="cast-pause"]').getAttribute("aria-label"),
      "the pushed state, not the reply, is what the button follows",
    ).toBe("Play");

    cast.querySelector('[data-focus-key="cast-mute"]').click();
    const muted = lastSent(socket);
    expect(muted.command.type).toBe("set_muted");
    socket.emit("message", {
      data: JSON.stringify({
        version: 1,
        id: muted.id,
        response: { snapshots: [], answer: null },
      }),
    });
    socket.emit("message", {
      data: JSON.stringify({
        version: 1,
        snapshot: {
          ...SNAPSHOT,
          revision: 4,
          playback: { ...SNAPSHOT.playback, state: "paused", muted: true },
        },
      }),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      cast.querySelector('[data-focus-key="cast-mute"]').getAttribute("aria-label"),
    ).toBe("Unmute");
  });

  test("a command in flight when the socket closes is refused, not left waiting", async () => {
    const { window, socket } = boot();
    welcome(socket);
    snapshot(socket);
    socket.emit("open");
    expand(window);

    const cast = window.document.getElementById("surface-remote");
    cast.querySelector('[data-focus-key="cast-pause"]').click();
    expect(socket.sent.some((frame) => frame.includes('"set_paused"'))).toBe(true);

    socket.emit("close");
    await new Promise((resolve) => setTimeout(resolve, 0));

    const error = window.document.getElementById("error");
    expect(error.classList.contains("hidden")).toBe(false);
    expect(error.textContent).toContain("could not reach the Host");
  });
});

describe("the served Remote's connection", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("a closed socket is replaced, and the new one greets the Host", () => {
    vi.useFakeTimers();
    const { socket } = boot();
    welcome(socket);
    socket.emit("close");

    vi.advanceTimersByTime(2000);
    expect(FakeSocket.instances).toHaveLength(2);
    const replacement = FakeSocket.instances[1];
    if (!replacement) {
      throw new Error("the page reconnected");
    }
    replacement.emit("open");
    expect(
      replacement.sent.some((frame) => frame.includes('"hello"')),
      "a reconnect is a greeting",
    ).toBe(true);
  });

  test("returning to the page probes at once, and a dead socket reconnects", () => {
    vi.useFakeTimers();
    let now = 1_000_000;
    const { window, socket } = boot(() => now);
    welcome(socket);
    socket.emit("open");
    socket.sent.length = 0;

    window.document.dispatchEvent(new window.Event("visibilitychange"));
    expect(
      socket.sent.some((frame) => frame.includes('"hello"')),
      "the page asks the moment it is looked at again",
    ).toBe(true);
    expect(FakeSocket.instances).toHaveLength(1);

    now += 2000;
    vi.advanceTimersByTime(1600);
    vi.advanceTimersByTime(1000);
    expect(
      FakeSocket.instances.length,
      "a socket that does not answer is replaced without waiting for the idle window",
    ).toBe(2);
  });

  test("an idle socket is greeted again before it is treated as dead", () => {
    vi.useFakeTimers();
    let now = 1_000_000;
    const { socket } = boot(() => now);
    welcome(socket);
    socket.emit("open");
    socket.sent.length = 0;

    now += 16000;
    vi.advanceTimersByTime(16000);
    expect(
      socket.sent.some((frame) => frame.includes('"hello"')),
      "the page asks the Host to say it is still there",
    ).toBe(true);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  test("a wake after a long sleep asks before it reconnects", () => {
    vi.useFakeTimers();
    let now = 1_000_000;
    const { window, socket } = boot(() => now);
    welcome(socket);
    socket.emit("open");
    socket.sent.length = 0;

    now += 31000;
    window.document.dispatchEvent(new window.Event("visibilitychange"));
    expect(
      socket.sent.some((frame) => frame.includes('"hello"')),
      "the socket that slept is asked whether it is still there",
    ).toBe(true);
    expect(FakeSocket.instances).toHaveLength(1);

    now += 6000;
    vi.advanceTimersByTime(6000);
    expect(
      FakeSocket.instances.length,
      "a socket that does not answer is replaced",
    ).toBe(2);
  });
});

describe("the served Remote's system Back", () => {
  // jsdom reports a traversal on its own queued step, after the one `back()`
  // books: one tick reads the history before the popstate has been dispatched.
  const settle = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  test("a paired page keeps one history entry; pairing keeps none", () => {
    const { window, socket } = boot();

    expect(
      window.history.state,
      "a page that has not paired has nothing to go back into",
    ).toBeNull();

    welcome(socket);

    expect(
      window.history.state,
      "once paired, the phone's Back belongs to the page",
    ).toEqual({ remote: "sentinel" });
    expect(
      window.location.href,
      "the entry is opaque: the position never reaches the URL",
    ).toBe("http://127.0.0.1:8090/");
  });

  test("a Back unwinds a surface and leaves the page armed again", async () => {
    const { window, socket } = boot();
    welcome(socket);
    snapshot(socket);
    expand(window);
    const cast = window.document.getElementById("surface-remote");
    expect(cast.classList.contains("hidden")).toBe(false);

    window.history.back();
    await settle();

    expect(
      cast.classList.contains("hidden"),
      "the system Back collapses the Cast Remote, as Escape does",
    ).toBe(true);
    expect(window.history.state, "there is still something to go back to").toEqual({
      remote: "sentinel",
    });
  });

  test("a Back at rest warns, and the next one is the browser's", async () => {
    const { window, socket } = boot();
    welcome(socket);
    snapshot(socket);
    const notice = window.document.getElementById("back-notice");
    expect(notice.hidden).toBe(true);

    window.history.back();
    await settle();

    expect(notice.hidden, "the first Back says what the second does").toBe(false);
    expect(
      window.history.state,
      "the warned page does not trap the Back",
    ).toBeNull();
  });

  test("a Snapshot arriving after the warning is not a navigation", async () => {
    const { window, socket } = boot();
    welcome(socket);
    snapshot(socket);

    window.history.back();
    await settle();
    expect(window.history.state).toBeNull();

    snapshot(socket, { ...SNAPSHOT, revision: 9 });

    expect(
      window.history.state,
      "a pushed Snapshot must not re-arm what the warning disarmed",
    ).toBeNull();
  });

  test("a reconnect's Welcome is not a navigation either", async () => {
    const { window, socket } = boot();
    welcome(socket);
    snapshot(socket);

    window.history.back();
    await settle();
    expect(window.history.state).toBeNull();

    // The probe greets again after a wake; the Host answers with another
    // Welcome for a page that is already inside the app.
    welcome(socket);
    snapshot(socket, { ...SNAPSHOT, revision: 9 });

    expect(
      window.history.state,
      "a Welcome after the warning must not re-arm the trap",
    ).toBeNull();
  });

  test("a Back closes a Level the way its own Back does", async () => {
    const { window, socket } = boot();
    welcome(socket);
    snapshot(socket);

    window.document.querySelector('[data-destination="settings"]')?.click();
    const category = window.document.querySelector('[data-a="settings-category"]');
    expect(category, "Settings offers a Level to open").not.toBeNull();
    category?.click();

    const level = window.document.getElementById("level-host");
    expect(level?.classList.contains("hidden")).toBe(false);

    window.history.back();
    await settle();

    expect(
      level?.classList.contains("hidden"),
      "the system Back pops the Level onto the screen it came from",
    ).toBe(true);
  });
});
