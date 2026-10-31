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
