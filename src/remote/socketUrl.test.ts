import { describe, expect, test } from "vitest";

import { socketUrl } from "./socketUrl";

describe("the Remote's socket address", () => {
  test("a dev page talks to the Host through the /host proxy", () => {
    expect(socketUrl({ protocol: "http:", host: "192.168.1.9:1420" }, true)).toBe(
      "ws://192.168.1.9:1420/host",
    );
  });

  test("a dev page served over https speaks wss", () => {
    expect(socketUrl({ protocol: "https:", host: "dev.example" }, true)).toBe(
      "wss://dev.example/host",
    );
  });

  test("a production page is served by the Host, so the socket is its origin", () => {
    expect(socketUrl({ protocol: "http:", host: "192.168.1.9:8090" }, false)).toBe(
      "ws://192.168.1.9:8090/",
    );
  });

  test("a production page over https speaks wss", () => {
    expect(socketUrl({ protocol: "https:", host: "host.example" }, false)).toBe(
      "wss://host.example/",
    );
  });
});
