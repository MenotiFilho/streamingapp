import { describe, expect, test } from "vitest";

import { InFlight } from "./inFlight";

/** A promise a test opens or refuses by hand. */
function gate<T>() {
  let open!: (value: T) => void;
  let fail!: (error: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    open = resolve;
    fail = reject;
  });
  return { promise, open, fail };
}

describe("InFlight", () => {
  test("the same key joined twice runs once and both callers see the answer", async () => {
    const flight = new InFlight<string>();
    const first = gate<string>();
    let calls = 0;
    const work = () => {
      calls += 1;
      return first.promise;
    };

    const a = flight.run("next_episode", work);
    const b = flight.run("next_episode", work);

    expect(calls).toBe(1);
    first.open("one episode");
    await expect(a).resolves.toBe("one episode");
    await expect(b).resolves.toBe("one episode");
  });

  test("a key runs again once its first run settled", async () => {
    const flight = new InFlight<number>();
    let calls = 0;
    const work = async () => {
      calls += 1;
      return calls;
    };

    await expect(flight.run("a", work)).resolves.toBe(1);
    await expect(flight.run("a", work)).resolves.toBe(2);
  });

  test("different keys run at the same time", async () => {
    const flight = new InFlight<string>();
    const first = gate<string>();

    const a = flight.run("a", () => first.promise);
    await expect(flight.run("b", async () => "b")).resolves.toBe("b");
    first.open("a");
    await expect(a).resolves.toBe("a");
  });

  test("a refusal frees the key so the Action can be tried again", async () => {
    const flight = new InFlight<string>();
    const refused = gate<string>();
    let calls = 0;
    const failing = () => {
      calls += 1;
      return refused.promise;
    };

    const a = flight.run("a", failing);
    const b = flight.run("a", failing);
    refused.fail(new Error("no next episode"));

    await expect(a).rejects.toThrow("no next episode");
    await expect(b).rejects.toThrow("no next episode");
    expect(calls).toBe(1);
    await expect(flight.run("a", async () => "retry")).resolves.toBe("retry");
  });
});
