import { describe, expect, test } from "vitest";

import { TOKEN_KEY, storageTokenStore } from "./tokenStore";

/** One storage, as a page holds it: a map with the three calls. */
function memoryStorage(initial: Record<string, string> = {}) {
  const held = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => held.get(key) ?? null,
    setItem: (key: string, value: string) => {
      held.set(key, value);
    },
    removeItem: (key: string) => {
      held.delete(key);
    },
    held,
  };
}

describe("the Device token's store", () => {
  test("keeps the token under the key the hand-written page used", () => {
    const storage = memoryStorage();
    const tokens = storageTokenStore(storage);

    tokens.write("a-token");

    expect(TOKEN_KEY).toBe("streamingapp.device.token");
    expect(storage.held.get(TOKEN_KEY)).toBe("a-token");
    expect(tokens.read()).toBe("a-token");
  });

  test("a cleared token reads as nothing", () => {
    const tokens = storageTokenStore(memoryStorage({ [TOKEN_KEY]: "a-token" }));

    tokens.clear();

    expect(tokens.read()).toBeNull();
  });

  test("a storage that refuses reads as no token and keeps the pairing for the visit", () => {
    const refused = {
      getItem: () => {
        throw new Error("site data is turned off");
      },
      setItem: () => {
        throw new Error("site data is turned off");
      },
      removeItem: () => {
        throw new Error("site data is turned off");
      },
    };
    const tokens = storageTokenStore(refused);

    expect(tokens.read()).toBeNull();
    expect(() => tokens.write("a-token")).not.toThrow();
    expect(() => tokens.clear()).not.toThrow();
  });
});
