import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { usePending } from "./usePending";

/** A control that fires its work twice from one press, the case a ref guards. */
function TwicePressed({ work }: { work: () => Promise<unknown> }) {
  const { pending, run } = usePending();
  return (
    <button
      disabled={pending}
      aria-busy={pending}
      onClick={() => {
        void run(work);
        void run(work);
      }}
    >
      Go
    </button>
  );
}

describe("usePending", () => {
  test("two starts in the same tick run the work once", async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    render(
      <TwicePressed
        work={() => {
          calls += 1;
          return gate;
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Go" }));

    expect(calls).toBe(1);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Go" })).toBeDisabled(),
    );
    expect(screen.getByRole("button", { name: "Go" })).toHaveAttribute(
      "aria-busy",
      "true",
    );

    release();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Go" })).toBeEnabled(),
    );
    expect(screen.getByRole("button", { name: "Go" })).toHaveAttribute(
      "aria-busy",
      "false",
    );
  });

  test("a refused Action clears the wait so the control can be tried again", async () => {
    let calls = 0;
    let refuse!: (error: unknown) => void;
    const gate = new Promise<void>((_resolve, reject) => {
      refuse = reject;
    });
    render(
      <TwicePressed
        work={() => {
          calls += 1;
          // What a screen does with a refusal: it catches it, shows it, and
          // lets the work settle so the control becomes pressable again.
          return gate.catch(() => undefined);
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    refuse(new Error("the Host refused it"));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Go" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(calls).toBe(2);
  });
});
