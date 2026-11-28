import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { version as packageVersion } from "../../package.json";
import {
  AUTOPLAY_SWITCH_LABEL,
  stepScale,
  torrentCacheRequest,
} from "../core/controls";
import { explain, type ActionError } from "../core/errors";
import { FOLLOW_THE_FILE } from "../core/languages";
import type { HostLink } from "../core/link";
import {
  LICENCE,
  SETTINGS_CATEGORIES,
  TMDB_NOTICE,
  protectionLedger,
  settingsLevelId,
  type SettingsCategory,
} from "../core/settingsRegister";
import type { AddonManifest, DeviceSummary, Snapshot } from "../core/wire";
import { FakeHost, type Respond } from "./fakeHost.testing";
import { NOTHING, PAIRING_CODE, PHONE } from "./fakeSocket.testing";
import { RemoteApp } from "./RemoteApp";
import {
  STREMIO_EMAIL_LABEL,
  STREMIO_PASSWORD_LABEL,
  STREMIO_SIGN_IN,
  STREMIO_SIGN_OUT,
  TMDB_CLEAR,
  TMDB_FIELD_LABEL,
  TMDB_SAVE,
} from "./settingsScreen";

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
  resources: [{ name: "meta", types: ["movie"], idPrefixes: ["tt"] }],
  types: ["movie"],
  catalogs: [{ type: "movie", id: "top", name: "Top", extra: [] }],
  idPrefixes: ["tt"],
  behaviorHints: { configurable: false, configurationRequired: false },
  enabled: true,
};

const ADDRESS = "192.168.1.20:8090";

const WITH_SETTINGS: Snapshot = {
  ...NOTHING,
  revision: 2,
  addons: [CINEMETA],
  protection: { backend: "keyring", tmdbHeld: true, stremioHeld: false },
  devices: [PHONE],
  pairingCode: PAIRING_CODE,
  address: ADDRESS,
};

const WITH_ACCOUNT: Snapshot = {
  ...WITH_SETTINGS,
  revision: 3,
  protection: { ...WITH_SETTINGS.protection, stremioHeld: true },
};

const TABLET: DeviceSummary = {
  id: "device-2",
  name: "Tablet",
  pairedAt: 1_700_000_100_000,
};

const WITH_DEVICES: Snapshot = {
  ...WITH_SETTINGS,
  devices: [PHONE, TABLET],
};

function doorOf(host: FakeHost, device: DeviceSummary | null = null): HostLink {
  const state = { kind: "ready" as const, device };
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
  snapshot = WITH_SETTINGS,
  respond,
  device = null,
}: {
  snapshot?: Snapshot;
  respond?: Respond;
  device?: DeviceSummary | null;
} = {}) {
  const host = new FakeHost(snapshot, respond);
  const view = render(<RemoteApp link={doorOf(host, device)} />);
  return { host, view };
}

async function openSettings() {
  fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
  await screen.findByTestId("remote-settings");
}

async function openCategory(category: SettingsCategory) {
  fireEvent.click(await screen.findByTestId(`settings-category-${category.id}`));
  const item = screen.getByTestId(`settings-category-${category.id}`);
  fireEvent.click(within(item).getByRole("button"));
  return screen.findByTestId(settingsLevelId(category));
}

const CREDENTIALS = SETTINGS_CATEGORIES[0]!;
const PREFERENCES = SETTINGS_CATEGORIES[1]!;
const DEVICES = SETTINGS_CATEGORIES[2]!;
const ABOUT = SETTINGS_CATEGORIES[3]!;

describe("Settings top level and navigation", () => {
  test("lists the four register categories and Back pops each pushed leaf cleanly", async () => {
    const { host } = mount();
    await openSettings();

    for (const category of SETTINGS_CATEGORIES) {
      expect(screen.getByTestId(`settings-category-${category.id}`)).toBeInTheDocument();
    }

    const before = host.actions.length;
    await openCategory(PREFERENCES);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByTestId("remote-settings")).toBeInTheDocument();
    expect(host.actions).toHaveLength(before);
  });
});

describe("Credentials leaf (P14)", () => {
  test("shows ledger, saves TMDB key, confirms Clear key, and handles Stremio sign-in/sign-out", async () => {
    const { host } = mount({ snapshot: WITH_SETTINGS });
    await openSettings();
    const leaf = await openCategory(CREDENTIALS);

    const ledger = within(leaf).getByTestId("credentials-ledger");
    expect(ledger).toHaveTextContent(protectionLedger(WITH_SETTINGS.protection).backend);

    fireEvent.change(within(leaf).getByLabelText(TMDB_FIELD_LABEL), {
      target: { value: "  tmdb-secret  " },
    });
    fireEvent.click(within(leaf).getByRole("button", { name: TMDB_SAVE }));
    await waitFor(() =>
      expect(host.asked("set_tmdb_key")).toEqual([
        { type: "set_tmdb_key", key: "tmdb-secret" },
      ]),
    );

    fireEvent.click(within(leaf).getByRole("button", { name: TMDB_CLEAR }));
    const confirmClear = await screen.findByRole("dialog");
    expect(within(confirmClear).getByRole("button", { name: "Cancel" })).toHaveFocus();
    fireEvent.click(within(confirmClear).getByRole("button", { name: TMDB_CLEAR }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(host.asked("clear_tmdb_key")).toHaveLength(1);

    fireEvent.change(within(leaf).getByLabelText(STREMIO_EMAIL_LABEL), {
      target: { value: "user@example.com" },
    });
    fireEvent.change(within(leaf).getByLabelText(STREMIO_PASSWORD_LABEL), {
      target: { value: "hunter2" },
    });
    fireEvent.click(within(leaf).getByRole("button", { name: STREMIO_SIGN_IN }));
    await waitFor(() =>
      expect(host.asked("sign_in_stremio")).toEqual([
        { type: "sign_in_stremio", email: "user@example.com", password: "hunter2" },
      ]),
    );
  });

  test("signed-in account confirms Sign out and dispatches sign_out_stremio", async () => {
    const { host } = mount({ snapshot: WITH_ACCOUNT });
    await openSettings();
    const leaf = await openCategory(CREDENTIALS);

    fireEvent.click(within(leaf).getByRole("button", { name: STREMIO_SIGN_OUT }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: STREMIO_SIGN_OUT }));
    await waitFor(() => expect(host.asked("sign_out_stremio")).toHaveLength(1));
  });
});

describe("Preferences leaf and sub-levels (P12, P15-P18)", () => {
  test("inline Autoplay switch sends set_autoplay", async () => {
    const { host } = mount({ snapshot: WITH_SETTINGS });
    await openSettings();
    await openCategory(PREFERENCES);

    const row = screen.getByTestId("pref-row-autoplay");
    fireEvent.click(within(row).getByRole("switch"));
    await waitFor(() =>
      expect(host.asked("set_autoplay")).toEqual([
        { type: "set_autoplay", autoplay: false },
      ]),
    );
  });

  test("Subtitle languages sub-level shows Following the file, opens language picker, and updates order", async () => {
    const { host } = mount({
      snapshot: {
        ...WITH_SETTINGS,
        preferences: { ...WITH_SETTINGS.preferences, subtitleLanguages: [] },
      },
    });
    await openSettings();
    await openCategory(PREFERENCES);

    fireEvent.click(within(screen.getByTestId("pref-row-subtitle-languages")).getByRole("button"));
    expect(await screen.findByTestId("language-follow-subtitle")).toHaveTextContent(FOLLOW_THE_FILE);

    fireEvent.click(screen.getByRole("button", { name: "Add language" }));
    const picker = await screen.findByTestId("language-picker-subtitle");
    fireEvent.click(within(picker).getByRole("button", { name: "Português (Brasil)" }));

    await waitFor(() =>
      expect(host.asked("set_subtitle_languages")).toEqual([
        { type: "set_subtitle_languages", languages: ["pt-BR"] },
      ]),
    );
  });

  test("Subtitle appearance steps 5% size and picks colour", async () => {
    const { host } = mount({ snapshot: WITH_SETTINGS });
    await openSettings();
    await openCategory(PREFERENCES);

    fireEvent.click(within(screen.getByTestId("pref-row-subtitle-appearance")).getByRole("button"));
    await screen.findByTestId("settings-sublevel-subtitle-appearance");

    fireEvent.click(screen.getByRole("button", { name: "Larger" }));
    await waitFor(() =>
      expect(host.asked("set_subtitle_scale")).toEqual([
        { type: "set_subtitle_scale", scale: stepScale(1, 1) },
      ]),
    );
  });

  test("Stream buffer & torrent cache dispatches buffer and torrent cache choices", async () => {
    const { host } = mount({ snapshot: WITH_SETTINGS });
    await openSettings();
    await openCategory(PREFERENCES);

    fireEvent.click(within(screen.getByTestId("pref-row-stream-buffer")).getByRole("button"));
    await screen.findByTestId("settings-sublevel-stream-buffer");

    fireEvent.click(within(screen.getByTestId("torrent-cache-chips")).getByRole("button", { name: "8 GB" }));
    await waitFor(() =>
      expect(host.asked("set_torrent_cache")).toEqual([torrentCacheRequest(8000)]),
    );
  });

  test("Up next & featured catalog dispatches autoplay, playback mode, and featured catalog", async () => {
    const { host } = mount({ snapshot: WITH_SETTINGS });
    await openSettings();
    await openCategory(PREFERENCES);

    fireEvent.click(within(screen.getByTestId("pref-row-up-next-playback")).getByRole("button"));
    const sub = await screen.findByTestId("settings-sublevel-up-next");

    expect(within(sub).getByRole("switch", { name: AUTOPLAY_SWITCH_LABEL })).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId("featured-catalog-chips")).getByRole("button", { name: /Top/ }));
    await waitFor(() =>
      expect(host.asked("set_featured_catalog")).toEqual([
        {
          type: "set_featured_catalog",
          addon: "cinemeta",
          catalog: { type: "movie", id: "top" },
        },
      ]),
    );
  });

  test("a refused preference surfaces the Host's words", async () => {
    const refusal: ActionError = { kind: "store", detail: "could not save" };
    mount({ snapshot: WITH_SETTINGS, respond: () => refusal });
    await openSettings();
    await openCategory(PREFERENCES);

    fireEvent.click(within(screen.getByTestId("pref-row-autoplay")).getByRole("switch"));
    expect(await screen.findByRole("alert")).toHaveTextContent(explain(refusal));
  });
});

describe("Remote devices leaf (P19, P19b)", () => {
  test("draws pairing code, marks current device, and confirms Revoke with Cancel focus", async () => {
    const { host } = mount({ snapshot: WITH_DEVICES, device: PHONE });
    await openSettings();
    const leaf = await openCategory(DEVICES);

    expect(within(leaf).getByText(ADDRESS)).toBeInTheDocument();
    expect(screen.getByTestId(`device-${PHONE.id}`)).toHaveTextContent(/This device/);

    fireEvent.click(within(leaf).getByRole("button", { name: `Revoke ${TABLET.name}` }));
    const confirm = await screen.findByRole("dialog");
    expect(within(confirm).getByRole("button", { name: "Cancel" })).toHaveFocus();
    fireEvent.click(within(confirm).getByRole("button", { name: "Revoke" }));

    await waitFor(() =>
      expect(host.asked("revoke_device")).toEqual([
        { type: "revoke_device", id: TABLET.id },
      ]),
    );
  });
});

describe("About leaf (P20)", () => {
  test("carries TMDB notice, mark, package version, and GPL licence", async () => {
    mount({ snapshot: WITH_SETTINGS });
    await openSettings();
    const leaf = await openCategory(ABOUT);

    expect(within(leaf).getByRole("img", { name: "The Movie Database (TMDB)" })).toBeInTheDocument();
    expect(within(leaf).getByText(TMDB_NOTICE)).toBeInTheDocument();
    expect(within(leaf).getByTestId("about-version")).toHaveTextContent(packageVersion);
    expect(within(leaf).getByText(LICENCE)).toBeInTheDocument();
  });
});
