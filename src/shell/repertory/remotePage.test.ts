import { JSDOM } from "jsdom";
import { describe, expect, test } from "vitest";

import template from "../../../crates/host-wire/remote/index.html?raw";
import icons from "../../../crates/host-wire/remote/icons.svg?raw";
import tmdbLogo from "../../assets/tmdb-logo.svg?raw";
import appearance from "../../subtitle-appearance.json?raw";
import languages from "../../subtitle-languages.json?raw";
import buffer from "../../stream-buffer.json?raw";
import velvetTokens from "../../tokens.css?raw";
import repertoryTokens from "./tokens.css?raw";

/**
 * The served Remote's own smoke (#159).
 *
 * The page has no seams of its own: one document, one classic script, one
 * module script. This test parses and boots the spliced template in jsdom, hands
 * it a Welcome and a Snapshot over a fake socket, and asks where the transport
 * is. It never asserts the drawing beyond the surface the ticket names.
 */

function spliced(): string {
  return template
    .replace("/*__SPLICE_TOKENS__*/", velvetTokens)
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
  private readonly listeners = new Map<string, Array<(event: { data?: string }) => void>>();

  constructor(public readonly url: string) {
    FakeSocket.instances.push(this);
  }

  addEventListener(type: string, handler: (event: { data?: string }) => void): void {
    const held = this.listeners.get(type) ?? [];
    held.push(handler);
    this.listeners.set(type, held);
  }

  send(): void {}

  close(): void {}

  emit(type: string, event: { data?: string } = {}): void {
    for (const handler of this.listeners.get(type) ?? []) {
      handler(event);
    }
  }
}

function boot(staged: boolean): { window: any; socket: FakeSocket } {
  const html = staged
    ? spliced().replace("<html lang=\"en\">", "<html lang=\"en\" data-ui=\"repertory\">")
    : spliced();
  FakeSocket.instances = [];
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: staged ? "http://127.0.0.1:8090/next" : "http://127.0.0.1:8090/",
    beforeParse(window: any) {
      window.WebSocket = FakeSocket as unknown as typeof WebSocket;
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

function snapshot(socket: FakeSocket): void {
  socket.emit("message", { data: JSON.stringify({ version: 1, snapshot: SNAPSHOT }) });
}

function expand(window: any): void {
  const center = window.document.querySelector('#mini-strip [data-a="expand-cast"]');
  if (!center) {
    throw new Error("the docked strip offers the expanded Remote");
  }
  center.click();
}

describe("the served Remote's page", () => {
  test("boots at /next, takes a Snapshot, and puts the transport on the card", () => {
    const { window, socket } = boot(true);

    expect(window.document.documentElement.dataset.ui).toBe("repertory");
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

  test("boots at / on the old surface, with the same page and no repertory attribute", () => {
    const { window, socket } = boot(false);

    expect(window.document.documentElement.dataset.ui).toBeUndefined();
    welcome(socket);
    snapshot(socket);
    expand(window);
    const cast = window.document.getElementById("surface-remote");
    expect(cast?.querySelector(".transport")).not.toBeNull();
    expect(
      cast?.querySelector(".transport .rep-icon"),
      "the old surface keeps its own drawing",
    ).toBeNull();
  });
});
