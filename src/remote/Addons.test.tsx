import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  addOutcome,
  addStatusText,
  moveTarget,
} from "../core/addons";
import { explain, type ActionError } from "../core/errors";
import { Session } from "../core/session";
import type { AddonManifest, Response, Snapshot } from "../core/wire";
import { Addons as AddonsScreen } from "./Addons";
import { ADDONS_EMPTY, ADDON_FIELD_LABEL, ADDON_SUBMIT } from "./addonsScreen";
import { FakeHost, type Respond } from "./fakeHost.testing";
import { NOTHING } from "./fakeSocket.testing";
import { RemoteApp } from "./RemoteApp";

let previousSkipAnimations: boolean | undefined;
beforeAll(() => {
  previousSkipAnimations = MotionGlobalConfig.skipAnimations;
  MotionGlobalConfig.skipAnimations = true;
});
afterAll(() => {
  MotionGlobalConfig.skipAnimations = previousSkipAnimations;
});

const CINEMETA: AddonManifest = {
  id: "cinemeta",
  name: "Cinemeta",
  version: "3.0.14",
  resources: [{ name: "meta", types: ["movie", "series"], idPrefixes: ["tt"] }],
  types: ["movie", "series"],
  catalogs: [{ type: "movie", id: "top", name: "Top", extra: [] }],
  idPrefixes: ["tt"],
  behaviorHints: { configurable: false, configurationRequired: false },
  enabled: true,
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
  enabled: true,
};

function withAddons(addons: AddonManifest[], revision = 1): Snapshot {
  return { ...NOTHING, revision, addons };
}

function changed(addons: AddonManifest[]): Response {
  return { snapshots: [withAddons(addons, 2)], answer: null };
}

function mount({
  snapshot = withAddons([]),
  respond,
}: {
  snapshot?: Snapshot;
  respond?: Respond;
} = {}) {
  const host = new FakeHost(snapshot, respond);
  const view = render(<RemoteApp link={host} />);
  return { host, view };
}

async function openAddons() {
  fireEvent.click(await screen.findByRole("button", { name: "Addons" }));
  await screen.findByTestId("remote-addons");
}

async function submitManifest(value: string) {
  const field = screen.getByLabelText(ADDON_FIELD_LABEL);
  fireEvent.change(field, { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: ADDON_SUBMIT }));
  return field;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

function statusOf(before: AddonManifest[], after: AddonManifest[]): string {
  return addStatusText(addOutcome(before, after)!);
}

describe("adding a manifest", () => {
  test("before the first Snapshot nothing goes out", () => {
    const host = new FakeHost(NOTHING);
    const session = new Session(host);
    render(
      <AddonsScreen
        session={session}
        state={session.getState()}
        push={() => "level-1"}
      />,
    );

    expect(screen.queryByLabelText(ADDON_FIELD_LABEL)).not.toBeInTheDocument();
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
    expect(field).toHaveValue("https://example.com/bad.json");
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

describe("the Addons register and details", () => {
  test("lists Addons in Host order, toggles set_addon_enabled, and exposes no manifest URL or OFFLINE state", async () => {
    const { host } = mount({ snapshot: withAddons([SUBTITLES, CINEMETA]) });
    await openAddons();

    const list = screen.getByTestId("addons-list");
    expect(
      Array.from(list.children).map((el) => el.getAttribute("data-testid")),
    ).toEqual([`addon-${SUBTITLES.id}`, `addon-${CINEMETA.id}`]);
    expect(list).not.toHaveTextContent(/manifest\.json|https?:\/\//i);
    expect(list).not.toHaveTextContent(/offline/i);

    const cinemetaSwitch = screen.getByRole("switch", {
      name: `Use ${CINEMETA.name}`,
    });
    expect(cinemetaSwitch).toHaveAttribute("aria-checked", "true");
    fireEvent.click(cinemetaSwitch);

    await waitFor(() =>
      expect(host.asked("set_addon_enabled")).toEqual([
        { type: "set_addon_enabled", addon: CINEMETA.id, enabled: false },
      ]),
    );
  });

  test("opening an Addon row pushes details with Manifest fields (no URL), Move up/down, and Remove", async () => {
    const { host } = mount({ snapshot: withAddons([CINEMETA, SUBTITLES]) });
    await openAddons();

    fireEvent.click(screen.getByRole("button", { name: new RegExp(CINEMETA.name) }));

    const details = await screen.findByTestId("remote-addon-details");
    const facts = within(details).getByTestId("addon-details-facts");
    expect(facts).toHaveTextContent(CINEMETA.version);
    expect(facts).toHaveTextContent(CINEMETA.id);
    expect(facts).not.toHaveTextContent(/https?:\/\//i);

    expect(within(details).getByRole("button", { name: "Move up" })).toBeDisabled();
    fireEvent.click(within(details).getByRole("button", { name: "Move down" }));

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
});

describe("Edit mode and removing an Addon", () => {
  test("Edit mode reorders with ArrowDown and shows a refusal beside that row", async () => {
    const refusal: ActionError = {
      kind: "invalid_position",
      position: 1,
      count: 2,
    };
    const { host } = mount({
      snapshot: withAddons([CINEMETA, SUBTITLES]),
      respond: () => refusal,
    });
    await openAddons();

    fireEvent.click(screen.getByTestId("addons-edit-toggle"));
    const first = screen.getByTestId(`addon-${CINEMETA.id}`);
    const second = screen.getByTestId(`addon-${SUBTITLES.id}`);

    const handle = within(first).getByRole("button", {
      name: `Move ${CINEMETA.name}`,
    });
    fireEvent.keyDown(handle, { key: "ArrowDown" });

    expect(await within(first).findByRole("alert")).toHaveTextContent(explain(refusal));
    expect(within(second).queryByRole("alert")).toBeNull();
    expect(host.asked("reorder_addon")).toEqual([
      { type: "reorder_addon", id: CINEMETA.id, position: 1 },
    ]);
  });

  test("Remove asks first with Cancel initially focused: Cancel sends nothing, confirm sends remove_addon once", async () => {
    const { host } = mount({ snapshot: withAddons([CINEMETA]) });
    await openAddons();

    fireEvent.click(screen.getByTestId("addons-edit-toggle"));
    fireEvent.click(screen.getByRole("button", { name: `Remove ${CINEMETA.name}` }));

    const question = await screen.findByRole("dialog", {
      name: `Remove ${CINEMETA.name}?`,
    });
    expect(within(question).getByRole("button", { name: "Cancel" })).toHaveFocus();
    expect(host.asked("remove_addon")).toEqual([]);

    fireEvent.click(within(question).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(host.asked("remove_addon")).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: `Remove ${CINEMETA.name}` }));
    const again = await screen.findByRole("dialog", {
      name: `Remove ${CINEMETA.name}?`,
    });
    fireEvent.click(within(again).getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(host.asked("remove_addon")).toEqual([
      { type: "remove_addon", id: CINEMETA.id },
    ]);
  });

  test("Back on the question cancels it", async () => {
    const { host } = mount({ snapshot: withAddons([CINEMETA]) });
    await openAddons();

    fireEvent.click(screen.getByTestId("addons-edit-toggle"));
    fireEvent.click(screen.getByRole("button", { name: `Remove ${CINEMETA.name}` }));
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

    expect(screen.getByTestId("addons-empty")).toBeInTheDocument();
    expect(screen.getByTestId("addons-empty")).toHaveTextContent(ADDONS_EMPTY.body);
    expect(screen.queryByTestId("addons-list")).not.toBeInTheDocument();
  });
});
