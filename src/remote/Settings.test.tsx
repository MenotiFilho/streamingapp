import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { version as packageVersion } from "../../package.json";
import {
  SUBTITLE_SCALES,
  formatScale,
} from "../core/controls";
import { explain, type ActionError } from "../core/errors";
import { HOST_PICKS_PER_VIDEO } from "../core/languages";
import type { HostLink } from "../core/link";
import type { NewLevel } from "../core/navigation";
import {
  LICENCE,
  SETTINGS_CATEGORIES,
  TMDB_NOTICE,
  protectionLedger,
  settingsLevelId,
  type SettingsCategory,
} from "../core/settingsRegister";
import type { AddonManifest, DeviceSummary, Snapshot } from "../core/wire";
import tmdbLogo from "../assets/tmdb-logo.svg";
import { FakeHost, type Respond } from "./fakeHost.testing";
import { NOTHING, PAIRING_CODE, PHONE } from "./fakeSocket.testing";
import type { RemotePayload } from "./levels";
import { RemoteApp } from "./RemoteApp";
import {
  FEATURED_NONE,
  STREMIO_EMAIL_LABEL,
  STREMIO_PASSWORD_LABEL,
  STREMIO_SIGN_IN,
  STREMIO_SIGN_OUT,
  TMDB_CLEAR,
  TMDB_FIELD_LABEL,
  TMDB_MARK,
  TMDB_SAVE,
  bufferRequest,
  clearTmdbLevel,
  colorRequest,
  featuredRequest,
  languageRequest,
  revokeLevel,
  scaleRequest,
  signOutLevel,
} from "./settingsScreen";

/**
 * Settings over a fake HostLink (#211, ADR-0032, docs/agents/testing.md).
 *
 * The app is the harness, because a Settings category is a pushed level rather
 * than a destination: every assertion is a decision at the boundary — the level
 * a press pushes, the Action a form or chip sends, what a refusal leaves in a
 * field, and the question a destructive press raises before anything leaves.
 * The About leaf is read for the two facts it must carry: the bundle's version
 * and the imported TMDB mark.
 */

const CINEMETA: AddonManifest = {
  id: "cinemeta",
  name: "Cinemeta",
  version: "3.0.14",
  resources: [{ name: "meta", types: ["movie"], idPrefixes: ["tt"] }],
  types: ["movie"],
  catalogs: [{ type: "movie", id: "top", name: "Top", extra: [] }],
  idPrefixes: ["tt"],
  behaviorHints: { configurable: false, configurationRequired: false },
};

const ADDRESS = "192.168.1.20:8090";

/** A Host holding a key, a device and a Catalog, and signed out of Stremio. */
const WITH_SETTINGS: Snapshot = {
  ...NOTHING,
  revision: 2,
  addons: [CINEMETA],
  protection: { backend: "keyring", tmdbHeld: true, stremioHeld: false },
  devices: [PHONE],
  address: ADDRESS,
};

/** The same Host, with a Stremio account linked. */
const WITH_ACCOUNT: Snapshot = {
  ...WITH_SETTINGS,
  revision: 3,
  protection: { ...WITH_SETTINGS.protection, stremioHeld: true },
};

/** A second paired device, so the register's order is exercisable. */
const TABLET: DeviceSummary = {
  id: "device-2",
  name: "Tablet",
  pairedAt: 1_700_000_100_000,
};

const WITH_DEVICES: Snapshot = {
  ...WITH_SETTINGS,
  devices: [PHONE, TABLET],
};

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
    onRevision: (handler) => host.onRevision(handler),
    state: () => state,
    onState: (handler) => host.onState(handler),
    close: () => host.close(),
  };
}

function mount({
  snapshot = NOTHING,
  respond,
}: {
  snapshot?: Snapshot;
  respond?: Respond;
} = {}) {
  const host = new FakeHost(snapshot, respond);
  const view = render(<RemoteApp link={doorOf(host)} />);
  return { host, view };
}

/** Walk the index to Settings, and hand back once its register is drawn. */
async function openSettings() {
  fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
  await screen.findByTestId("settings-categories");
}

/** Walk the register to one category's leaf, and hand back once it is drawn. */
async function openCategory(category: SettingsCategory) {
  fireEvent.click(await screen.findByRole("button", { name: category.title }));
  return screen.findByTestId(settingsLevelId(category));
}

/** The confirming answer a pushed question carries, read from the level. */
function confirmOf(level: NewLevel<RemotePayload>) {
  if (level.payload.kind !== "confirm") {
    throw new Error("the level pushed is not a confirmation");
  }
  return level.payload.confirm;
}

const CREDENTIALS = SETTINGS_CATEGORIES[0]!;
const PREFERENCES = SETTINGS_CATEGORIES[1]!;
const DEVICES = SETTINGS_CATEGORIES[2]!;
const ABOUT = SETTINGS_CATEGORIES[3]!;

describe("the Settings register", () => {
  test("lists the core's four categories, in the record's order", async () => {
    mount();
    await openSettings();

    const register = screen.getByTestId("settings-categories");
    expect(
      within(register)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(SETTINGS_CATEGORIES.map((category) => category.title));
  });

  test("a press pushes that category's level, and Back returns to the register", async () => {
    mount();
    await openSettings();

    await openCategory(CREDENTIALS);

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    await waitFor(() =>
      expect(screen.queryByTestId(settingsLevelId(CREDENTIALS))).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("settings-categories")).toBeInTheDocument();
  });

  test("each category's leaf mounts", async () => {
    mount();
    await openSettings();

    for (const category of SETTINGS_CATEGORIES) {
      await openCategory(category);
      expect(screen.getByTestId(settingsLevelId(category))).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Back" }));
      await waitFor(() =>
        expect(
          screen.queryByTestId(settingsLevelId(category)),
        ).not.toBeInTheDocument(),
      );
    }
  });
});

describe("the Credentials leaf", () => {
  test("a refused key is the Host's words and leaves the field to correct", async () => {
    const refusal: ActionError = {
      kind: "store",
      detail: "the keyring is locked",
    };
    const { host } = mount({ respond: () => refusal });
    await openSettings();
    await openCategory(CREDENTIALS);

    const field = screen.getByLabelText(TMDB_FIELD_LABEL);
    fireEvent.change(field, { target: { value: "  the-key  " } });
    fireEvent.click(screen.getByRole("button", { name: TMDB_SAVE }));

    expect(await screen.findByRole("alert")).toHaveTextContent(explain(refusal));
    expect(field).toHaveValue("  the-key  ");
    expect(screen.queryByText("the-key"), "the key is never echoed").toBeNull();
    expect(host.asked("set_tmdb_key")).toEqual([
      { type: "set_tmdb_key", key: "the-key" },
    ]);
  });

  test("Sign in sends the pair, and the password is gone from the DOM after it", async () => {
    const { host } = mount({ snapshot: WITH_SETTINGS });
    await openSettings();
    await openCategory(CREDENTIALS);

    const email = screen.getByLabelText(STREMIO_EMAIL_LABEL);
    const password = screen.getByLabelText(STREMIO_PASSWORD_LABEL);
    fireEvent.change(email, { target: { value: " owner@example.com " } });
    fireEvent.change(password, { target: { value: "hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: STREMIO_SIGN_IN }));

    await waitFor(() =>
      expect(host.asked("sign_in_stremio")).toEqual([
        {
          type: "sign_in_stremio",
          email: "owner@example.com",
          password: "hunter2",
        },
      ]),
    );
    await waitFor(() => expect(password).toHaveValue(""));
    expect(email).toHaveValue("");
    expect(document.body.innerHTML, "the password is kept nowhere").not.toContain(
      "hunter2",
    );
  });

  test("Clear key asks first, and only the confirming answer clears it", async () => {
    const { host } = mount({ snapshot: WITH_SETTINGS });
    await openSettings();
    await openCategory(CREDENTIALS);

    const ledger = protectionLedger(WITH_SETTINGS.protection);
    expect(screen.getByTestId("protection-tmdb")).toHaveTextContent(ledger.tmdb);
    expect(screen.getByTestId("protection-stremio")).toHaveTextContent(
      ledger.stremio,
    );

    const clear = clearTmdbLevel();
    const question = confirmOf(clear);

    fireEvent.click(screen.getByRole("button", { name: TMDB_CLEAR }));
    const first = await screen.findByRole("dialog", { name: clear.name });
    expect(host.asked("clear_tmdb_key"), "the question sends nothing").toEqual([]);

    fireEvent.click(within(first).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(host.asked("clear_tmdb_key")).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: TMDB_CLEAR }));
    const again = await screen.findByRole("dialog", { name: clear.name });
    fireEvent.click(
      within(again).getByRole("button", { name: question.confirmLabel }),
    );

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(host.asked("clear_tmdb_key")).toEqual([question.action]);
  });

  test("Sign out asks first, and only the confirming answer signs out", async () => {
    const { host } = mount({ snapshot: WITH_ACCOUNT });
    await openSettings();
    await openCategory(CREDENTIALS);

    const signOut = signOutLevel();
    const question = confirmOf(signOut);

    fireEvent.click(screen.getByRole("button", { name: STREMIO_SIGN_OUT }));
    const dialog = await screen.findByRole("dialog", { name: signOut.name });
    expect(host.asked("sign_out_stremio"), "the question sends nothing").toEqual(
      [],
    );

    fireEvent.click(
      within(dialog).getByRole("button", { name: question.confirmLabel }),
    );

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(host.asked("sign_out_stremio")).toEqual([question.action]);
  });
});

describe("the Preferences leaf", () => {
  test("each control sends the Host's own Action on press", async () => {
    const { host } = mount({ snapshot: WITH_SETTINGS });
    await openSettings();
    await openCategory(PREFERENCES);

    fireEvent.click(screen.getByRole("button", { name: "Português (Brasil)" }));
    fireEvent.click(screen.getByRole("button", { name: "Yellow" }));
    const large = SUBTITLE_SCALES[2]!;
    fireEvent.click(
      screen.getByRole("button", {
        name: `${large.label} · ${formatScale(large.scale)}`,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "10 min" }));
    const catalog = CINEMETA.catalogs[0]!;
    fireEvent.click(
      screen.getByRole("button", { name: `${catalog.name} · ${CINEMETA.name}` }),
    );
    fireEvent.click(screen.getByRole("button", { name: HOST_PICKS_PER_VIDEO }));
    fireEvent.click(screen.getByRole("button", { name: FEATURED_NONE }));
    fireEvent.click(screen.getByRole("button", { name: "Wait" }));
    fireEvent.click(screen.getByRole("button", { name: "Open the Streams picker" }));

    await waitFor(() =>
      expect(host.asked("set_subtitle_language")).toEqual([
        languageRequest("pt-BR"),
      ]),
    );
    await waitFor(() =>
      expect(host.asked("set_subtitle_color")).toEqual([
        colorRequest("#FFFF00"),
      ]),
    );
    await waitFor(() =>
      expect(host.asked("set_subtitle_scale")).toEqual([
        scaleRequest(large.scale),
      ]),
    );
    await waitFor(() =>
      expect(host.asked("set_stream_buffer")).toEqual([
        bufferRequest({ seconds: 600, megabytes: 512 }),
      ]),
    );
    await waitFor(() =>
      expect(host.asked("set_featured_catalog")).toEqual([
        featuredRequest({ addon: CINEMETA.id, catalog }),
      ]),
    );
    await waitFor(() =>
      expect(host.asked("set_autoplay")).toEqual([
        { type: "set_autoplay", autoplay: false },
      ]),
    );
    await waitFor(() =>
      expect(host.asked("set_up_next_playback")).toEqual([
        { type: "set_up_next_playback", playback: "picker" },
      ]),
    );
    await waitFor(() =>
      expect(host.asked("clear_subtitle_language")).toEqual([
        languageRequest(null),
      ]),
    );
    await waitFor(() =>
      expect(host.asked("clear_featured_catalog")).toEqual([
        featuredRequest(null),
      ]),
    );
  });
});

describe("the Remote devices leaf", () => {
  test("reads the Host's address and code out, and a Revoke asks first", async () => {
    const { host } = mount({ snapshot: WITH_DEVICES });
    await openSettings();
    await openCategory(DEVICES);

    expect(screen.getByTestId("settings-pairing-code")).toHaveTextContent(
      PAIRING_CODE,
    );
    expect(screen.getByTestId("settings-address")).toHaveTextContent(ADDRESS);
    expect(
      screen
        .getAllByTestId(/^settings-device-/)
        .map((row) => row.getAttribute("data-device-id")),
      "the Host's order is the list's",
    ).toEqual([PHONE.id, TABLET.id]);

    const revoke = revokeLevel(PHONE);
    const question = confirmOf(revoke);
    const press = () =>
      fireEvent.click(
        screen.getByRole("button", { name: `Revoke ${PHONE.name}` }),
      );

    press();
    const first = await screen.findByRole("dialog", { name: revoke.name });
    expect(host.asked("revoke_device"), "the question sends nothing").toEqual([]);

    fireEvent.click(within(first).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(host.asked("revoke_device")).toEqual([]);

    press();
    const again = await screen.findByRole("dialog", { name: revoke.name });
    fireEvent.click(
      within(again).getByRole("button", { name: question.confirmLabel }),
    );

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(host.asked("revoke_device")).toEqual([question.action]);
  });
});

describe("the About/Credits leaf", () => {
  test("prints the bundle's version and the attribution the core requires", async () => {
    mount();
    await openSettings();
    await openCategory(ABOUT);

    expect(screen.getByTestId("settings-version")).toHaveTextContent(
      packageVersion,
    );

    const mark = screen.getByRole("img", { name: TMDB_MARK });
    expect(mark).toHaveAttribute("src", tmdbLogo);
    expect(screen.getByTestId("settings-tmdb-credit")).toHaveTextContent(
      TMDB_NOTICE,
    );
    expect(screen.getByTestId("settings-licence")).toHaveTextContent(LICENCE);
  });
});
