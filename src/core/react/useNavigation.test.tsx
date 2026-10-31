import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { useNavigation, type NavigationReads } from "./useNavigation";

/** The client's own payload, standing in for the window's own contents. */
type Payload = { label: string };

/** The probe is the harness: it presses the buttons and hands back what it reads. */
function Probe({
  onRead,
  onPush,
}: {
  onRead: (read: NavigationReads<Payload>) => void;
  onPush: (id: string) => void;
}) {
  const nav = useNavigation<Payload>();
  onRead(nav);

  return (
    <>
      <button
        type="button"
        onClick={() => nav.choose("settings")}
      >
        Choose Settings
      </button>
      <button
        type="button"
        onClick={() =>
          onPush(
            nav.push({
              name: "Title",
              kind: "overlay",
              payload: { label: "Title" },
            }),
          )
        }
      >
        Push Title
      </button>
      <button
        type="button"
        onClick={() =>
          onPush(
            nav.push({
              id: "streams",
              name: "Streams",
              kind: "overlay",
              payload: { label: "Streams" },
            }),
          )
        }
      >
        Push Streams
      </button>
      <button
        type="button"
        onClick={() =>
          onPush(
            nav.push({
              id: "streams",
              name: "Streams",
              kind: "overlay",
              payload: { label: "Second Streams" },
            }),
          )
        }
      >
        Replace Streams
      </button>
      <button type="button" onClick={nav.back}>
        Back
      </button>
    </>
  );
}

/** The latest read the probe handed back, which the assertions look at. */
function latest(reads: NavigationReads<Payload>[]): NavigationReads<Payload> {
  const read = reads.at(-1);
  if (!read) {
    throw new Error("the probe did not read the navigation");
  }
  return read;
}

function harness() {
  const reads: NavigationReads<Payload>[] = [];
  const ids: string[] = [];
  const onRead = (read: NavigationReads<Payload>) => reads.push(read);
  const onPush = (id: string) => ids.push(id);
  return { reads, ids, onRead, onPush };
}

describe("useNavigation", () => {
  test("starts on Home with nothing pushed", () => {
    const { reads, onRead, onPush } = harness();
    render(<Probe onRead={onRead} onPush={onPush} />);

    const read = latest(reads);
    expect(read.state).toEqual({ destination: "home", levels: [] });
    expect(read.destination).toBe("home");
    expect(read.levels).toEqual([]);
    expect(read.canGoBack).toBe(false);
  });

  test("choosing a destination replaces the base and clears the stack", () => {
    const { reads, onRead, onPush } = harness();
    render(<Probe onRead={onRead} onPush={onPush} />);

    fireEvent.click(screen.getByRole("button", { name: "Choose Settings" }));

    const read = latest(reads);
    expect(read.destination).toBe("settings");
    expect(read.levels).toEqual([]);
    expect(read.canGoBack).toBe(true);
  });

  test("push assigns an id and keeps each pushed level in order", () => {
    const { reads, ids, onRead, onPush } = harness();
    render(<Probe onRead={onRead} onPush={onPush} />);

    fireEvent.click(screen.getByRole("button", { name: "Push Title" }));
    fireEvent.click(screen.getByRole("button", { name: "Push Title" }));

    expect(ids).toEqual(["level-1", "level-2"]);
    expect(latest(reads).levels.map((level) => level.id)).toEqual([
      "level-1",
      "level-2",
    ]);
    expect(latest(reads).canGoBack).toBe(true);
  });

  test("pushing the same id again replaces it in place, payload included", () => {
    const { reads, ids, onRead, onPush } = harness();
    render(<Probe onRead={onRead} onPush={onPush} />);

    fireEvent.click(screen.getByRole("button", { name: "Push Streams" }));
    fireEvent.click(screen.getByRole("button", { name: "Replace Streams" }));

    expect(ids).toEqual(["streams", "streams"]);
    expect(latest(reads).levels).toHaveLength(1);
    expect(latest(reads).levels[0]?.payload).toEqual({ label: "Second Streams" });
  });

  test("Back pops a level, then returns a non-Home base to Home", () => {
    const { reads, onRead, onPush } = harness();
    render(<Probe onRead={onRead} onPush={onPush} />);

    fireEvent.click(screen.getByRole("button", { name: "Push Title" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(latest(reads).levels).toEqual([]);
    expect(latest(reads).destination).toBe("home");
    expect(latest(reads).canGoBack).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Choose Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(latest(reads).destination).toBe("home");
    expect(latest(reads).canGoBack).toBe(false);
  });

  test("the reads and their callbacks keep their identity between unchanged renders", () => {
    const { reads, onRead, onPush } = harness();
    const view = render(<Probe onRead={onRead} onPush={onPush} />);
    const before = latest(reads);

    view.rerender(<Probe onRead={onRead} onPush={onPush} />);
    const after = latest(reads);

    expect(after.state).toBe(before.state);
    expect(after.choose).toBe(before.choose);
    expect(after.push).toBe(before.push);
    expect(after.remove).toBe(before.remove);
    expect(after.removeFrom).toBe(before.removeFrom);
    expect(after.pop).toBe(before.pop);
    expect(after.back).toBe(before.back);
  });
});
