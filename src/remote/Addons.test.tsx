import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import {
  addOutcome,
  addStatusText,
  catalogsOf,
  moveTarget,
  resourcesOf,
} from "../core/addons";
import { explain, type ActionError } from "../core/errors";
import type { HostLink } from "../core/link";
import { Session } from "../core/session";
import type { AddonManifest, Response, Snapshot } from "../core/wire";
import { Addons as AddonsScreen } from "./Addons";
import { ADDONS_EMPTY, ADDON_FIELD_LABEL, ADDON_SUBMIT } from "./addonsScreen";
import { FakeHost, type Respond } from "./fakeHost.testing";
import { NOTHING } from "./fakeSocket.testing";
import { RemoteApp } from "./RemoteApp";

/**
 * Addons over a fake HostLink (#209, ADR-0032, docs/agents/testing.md).
 *
 * The app is the harness, because a Remove press is a level and not a banner:
 * every assertion is a decision at the boundary — the Action the form sends,
 * what a refusal leaves in the field, the status a successful add prints
 * through the core's `addOutcome`, the register's order, the position a Move
 * press names, and the question a Remove press pushes before anything leaves.
 */

const CINEMETA: AddonManifest = {
  id: "cinemeta",
  name: "Cinemeta",
  version: "3.0.14",
  resources: [{ name: "meta", types: ["movie", "series"], idPrefixes: ["tt"] }],
  types: ["movie", "series"],
  catalogs: [{ type: "movie", id: "top", name: "Top", extra: [] }],
  idPrefixes: ["tt"],
  behaviorHints: { configurable: false, configurationRequired: false },
};

const SUBTITLES: AddonManifest = {
  id: "opensubtitles",
  name: "OpenSubtitles v3",
  version: "1.0.0",
  resources: [{ name: "subtitles", types: ["movie"], idPrefixes: ["tt"] }],
  types: ["movie"],
  catalogs: [],
  idPrefixes: ["tt"],
  behaviorHints: { configurable: false, configurationRequired: false },
};

function withAddons(addons: AddonManifest[], revision = 1): Snapshot {
  return { ...NOTHING, revision, addons };
}

/** An answer that carries the Snapshot a successful Change publishes. */
function changed(addons: AddonManifest[]): Response {
  return { snapshots: [withAddons(addons, 2)], answer: null };
}

/** The status the form prints for an answer, through the core's own reading. */
function statusOf(before: AddonManifest[], after: AddonManifest[]): string {
  const outcome = addOutcome(before, after);
  if (!outcome) {
    throw new Error("an answer with a Snapshot always reads");
  }
  return addStatusText(outcome);
}

/**
 * The Host's door with a state read React can cache.
 *
 * `FakeHost.state` builds a fresh object per call, which `useSyncExternalStore`
 * would read as a change on every render; the door is wrapped rather than the
 * fake being reshaped, because the state this page follows never moves here.
 */
function doorOf(host: FakeHost): HostLink {
  const state = host.state();
  return {
    snapshot: () => host.snapshot(),
    dispatch: (action) => host.dispatch(action),
    onSnapshot: (handler) => host.onSnapshot(handler),
    state: () => state,
    onState: (handler) => host.onState(handler),
    close: () => host.close(),
  };
}

function mount({
  snapshot = withAddons([]),
  respond,
}: {
  snapshot?: Snapshot;
  respond?: Respond;
} = {}) {
  const host = new FakeHost(snapshot, respond);
  const view = render(<RemoteApp link={doorOf(host)} />);
  return { host, view };
}

/** Walk the index to the destination, and hand back once its screen is drawn. */
async function openAddons() {
  fireEvent.click(await screen.findByRole("button", { name: "Addons" }));
  await screen.findByTestId("remote-addons");
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

/** Paste one manifest into the form and press its one control. */
async function submitManifest(value: string) {
  const field = await screen.findByLabelText(ADDON_FIELD_LABEL);
  fireEvent.change(field, { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: ADDON_SUBMIT }));
  return field;
}

/** The register's rows, in the order the Host sent them. */
function rows(): HTMLElement[] {
  return screen.getAllByTestId(/^addon-row-/);
}

describe("the Addons form", () => {
  test("waits for the first Snapshot, so no add is read against a list it never saw", () => {
    const host = new FakeHost(NOTHING);
    const session = new Session(host);
    render(
      <AddonsScreen
        session={session}
        state={session.getState()}
        push={() => "level-1"}
      />,
    );

    expect(screen.getByLabelText(ADDON_FIELD_LABEL)).toBeDisabled();
    expect(screen.getByRole("button", { name: ADDON_SUBMIT })).toBeDisabled();
    expect(host.actions).toEqual([]);
  });

  test("an empty or whitespace field is not a manifest and sends nothing", async () => {
    const { host } = mount();
    await openAddons();

    const field = screen.getByLabelText(ADDON_FIELD_LABEL);
    fireEvent.submit(field.closest("form")!);
    fireEvent.change(field, { target: { value: "   \n\t " } });
    fireEvent.submit(field.closest("form")!);

    await flush();
    expect(host.asked("add_addon")).toEqual([]);
  });

  test("a pasted manifest is sent as add_addon, trimmed", async () => {
    const { host } = mount();
    await openAddons();

    await submitManifest("  https://example.com/manifest.json  ");

    await waitFor(() =>
      expect(host.asked("add_addon")).toEqual([
        { type: "add_addon", url: "https://example.com/manifest.json" },
      ]),
    );
  });

  test("a refusal keeps the pasted value and draws the Host's words", async () => {
    const refusal: ActionError = { kind: "manifest", detail: "the manifest is not JSON" };
    const { host } = mount({ respond: () => refusal });
    await openAddons();

    const field = await submitManifest("https://example.com/bad.json");

    expect(await screen.findByRole("alert")).toHaveTextContent(explain(refusal));
    expect(field, "a refusal is corrected, never retyped").toHaveValue(
      "https://example.com/bad.json",
    );
    expect(host.asked("add_addon")).toHaveLength(1);
  });

  test("a new Addon clears the field and says which arrived", async () => {
    const { host } = mount({ respond: () => changed([CINEMETA]) });
    await openAddons();

    const field = await submitManifest("https://example.com/manifest.json");

    expect(await screen.findByRole("status")).toHaveTextContent(
      statusOf([], [CINEMETA]),
    );
    expect(field).toHaveValue("");
    expect(host.asked("add_addon")).toHaveLength(1);
  });

  test("an Addon the Host already knew reads as a refresh, not a failed add", async () => {
    const before = [CINEMETA];
    const { host } = mount({
      snapshot: withAddons(before),
      respond: () => changed(before),
    });
    await openAddons();

    await submitManifest("https://example.com/manifest.json");

    expect(await screen.findByRole("status")).toHaveTextContent(
      statusOf(before, before),
    );
    expect(screen.getByLabelText(ADDON_FIELD_LABEL)).toHaveValue("");
    expect(host.asked("add_addon")).toHaveLength(1);
  });
});

describe("the Addons register", () => {
  test("lists the Snapshot's Addons in the Host's order, with what each offers", async () => {
    mount({ snapshot: withAddons([SUBTITLES, CINEMETA]) });
    await openAddons();

    expect(rows().map((row) => row.getAttribute("data-addon-id"))).toEqual([
      SUBTITLES.id,
      CINEMETA.id,
    ]);

    const row = rows()[1]!;
    expect(within(row).getByText(CINEMETA.name)).toBeInTheDocument();
    expect(within(row).getByText(CINEMETA.version)).toBeInTheDocument();
    expect(within(row).getByText(resourcesOf(CINEMETA))).toBeInTheDocument();
    expect(within(row).getByText(catalogsOf(CINEMETA))).toBeInTheDocument();
  });

  test("a Move press sends the position moveTarget names, and the ends are walls", async () => {
    const { host } = mount({ snapshot: withAddons([CINEMETA, SUBTITLES]) });
    await openAddons();

    const [first, last] = rows();
    expect(within(first!).getByRole("button", { name: "Move up" })).toBeDisabled();
    expect(within(last!).getByRole("button", { name: "Move down" })).toBeDisabled();

    fireEvent.click(within(first!).getByRole("button", { name: "Move down" }));

    await waitFor(() =>
      expect(host.asked("reorder_addon")).toEqual([
        {
          type: "reorder_addon",
          id: CINEMETA.id,
          position: moveTarget(0, 1, 2),
        },
      ]),
    );
  });

  test("a refused reorder draws the Host's words beside that row", async () => {
    const refusal: ActionError = {
      kind: "invalid_position",
      position: 1,
      count: 2,
    };
    mount({
      snapshot: withAddons([CINEMETA, SUBTITLES]),
      respond: () => refusal,
    });
    await openAddons();

    const [first, second] = rows();
    fireEvent.click(within(first!).getByRole("button", { name: "Move down" }));

    expect(await within(first!).findByRole("alert")).toHaveTextContent(explain(refusal));
    expect(within(second!).queryByRole("alert")).toBeNull();
  });
});

describe("removing an Addon", () => {
  test("asks first: cancel sends nothing, and confirm sends remove_addon once", async () => {
    const { host } = mount({ snapshot: withAddons([CINEMETA]) });
    await openAddons();

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    const question = await screen.findByRole("dialog", {
      name: `Remove ${CINEMETA.name}?`,
    });
    expect(host.asked("remove_addon"), "the question sends nothing").toEqual([]);

    fireEvent.click(within(question).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(host.asked("remove_addon")).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    const again = await screen.findByRole("dialog", {
      name: `Remove ${CINEMETA.name}?`,
    });
    fireEvent.click(within(again).getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(host.asked("remove_addon")).toEqual([
      { type: "remove_addon", id: CINEMETA.id },
    ]);
  });

  test("Back on the question cancels it, because Back pops the level", async () => {
    const { host } = mount({ snapshot: withAddons([CINEMETA]) });
    await openAddons();

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await screen.findByRole("dialog", { name: `Remove ${CINEMETA.name}?` });

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(host.asked("remove_addon")).toEqual([]);
  });
});

describe("a Host with no Addon", () => {
  test("says so, and names the form rather than drawing an empty list", async () => {
    mount();
    await openAddons();

    expect(screen.getByTestId("remote-addons-empty")).toBeInTheDocument();
    expect(screen.getByTestId("remote-addons-empty")).toHaveTextContent(
      ADDONS_EMPTY.body,
    );
    expect(screen.queryByTestId("remote-addons-list")).not.toBeInTheDocument();
  });
});
