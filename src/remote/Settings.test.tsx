import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { version as packageVersion } from "../../package.json";
import {
  AUTOPLAY_CHOICES,
  stepScale,
  torrentCacheRequest,
} from "../core/controls";
import { explain, type ActionError } from "../core/errors";
import { FOLLOW_THE_FILE } from "../core/languages";
import { THREE_CHOSEN_NOTE } from "../core/languageList";
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
  LANGUAGE_FOLLOW_LINES,
  LANGUAGE_GROUP_HEADS,
  LONG_PRESS_MS,
  SUBTITLE_COLOUR_HEAD,
  featuredRequest,
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
  test("the Torrent cache is its own group, and a press sends its Action", async () => {
    const { host } = mount({ snapshot: WITH_SETTINGS });
    await openSettings();
    await openCategory(PREFERENCES);

    expect(screen.getByText("Torrents are fetched this far ahead too.")).toBeInTheDocument();

    // The default is held; a chip in the group is a press of the one Action. The
    // group is addressed by its heading because the Stream buffer's ladder also
    // has a 512 MB chip.
    const group = screen.getByRole("heading", { name: "Torrent cache" }).closest("section")!;
    expect(within(group).getByRole("button", { name: "2 GB" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(within(group).getByRole("button", { name: "8 GB" }));

    await waitFor(() =>
      expect(host.asked("set_torrent_cache")).toEqual([torrentCacheRequest(8000)]),
    );
    expect(host.asked("set_stream_buffer")).toEqual([]);
  });

  test("each control sends the Host's own Action on press", async () => {
    const { host } = mount({ snapshot: WITH_SETTINGS });
    await openSettings();
    await openCategory(PREFERENCES);

    fireEvent.click(screen.getByRole("button", { name: "Yellow" }));
    fireEvent.click(screen.getByRole("button", { name: "Larger subtitles" }));
    fireEvent.click(screen.getByRole("button", { name: "10 min" }));
    const catalog = CINEMETA.catalogs[0]!;
    fireEvent.click(
      screen.getByRole("button", { name: `${catalog.name} · ${CINEMETA.name}` }),
    );
    fireEvent.click(screen.getByRole("button", { name: FEATURED_NONE }));
    const wait = AUTOPLAY_CHOICES.find((choice) => !choice.autoplay)!;
    fireEvent.click(screen.getByRole("button", { name: wait.label }));
    fireEvent.click(screen.getByRole("button", { name: "Open the Streams picker" }));

    await waitFor(() =>
      expect(host.asked("set_subtitle_color")).toEqual([
        colorRequest("#FFFF00"),
      ]),
    );
    await waitFor(() =>
      expect(host.asked("set_subtitle_scale")).toEqual([
        scaleRequest(stepScale(WITH_SETTINGS.preferences.subtitleScale, 1)),
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
      expect(host.asked("clear_featured_catalog")).toEqual([
        featuredRequest(null),
      ]),
    );
  });
});

/** A Host holding both lists, as a person last left them. */
function withLanguages(subtitle: string[], audio: string[] = []): Snapshot {
  return {
    ...WITH_SETTINGS,
    preferences: {
      ...WITH_SETTINGS.preferences,
      subtitleLanguages: subtitle,
      audioLanguages: audio,
    },
  };
}

/** The tags of one field's chips, in the order they are drawn (which is rank). */
function chipsOf(kind: "subtitle" | "audio"): string[] {
  const field = screen.getByTestId(`language-field-${kind}`);
  const prefix = `language-remove-${kind}-`;
  return Array.from(field.querySelectorAll("[data-chip-index]"), (chip) =>
    (chip.querySelector("[data-testid^='language-remove-']")?.getAttribute("data-testid") ?? "")
      .replace(prefix, ""),
  );
}

describe("the Preferences leaf's language lists", () => {
  test("both groups sit above Subtitle appearance, each a field of ranked chips", async () => {
    mount({ snapshot: withLanguages(["pt-BR", "en"], ["ja"]) });
    await openSettings();
    await openCategory(PREFERENCES);

    const heads = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    const at = (head: string) => heads.indexOf(head);
    expect(at(LANGUAGE_GROUP_HEADS.subtitle)).toBeGreaterThanOrEqual(0);
    expect(at(LANGUAGE_GROUP_HEADS.audio)).toBeGreaterThan(at(LANGUAGE_GROUP_HEADS.subtitle));
    expect(at(SUBTITLE_COLOUR_HEAD)).toBeGreaterThan(at(LANGUAGE_GROUP_HEADS.audio));

    expect(chipsOf("subtitle")).toEqual(["pt-BR", "en"]);
    expect(chipsOf("audio")).toEqual(["ja"]);
  });

  test("an empty list reads Follow the file, with what that means for it", async () => {
    mount({ snapshot: withLanguages([], ["ja"]) });
    await openSettings();
    await openCategory(PREFERENCES);

    expect(screen.getByTestId("language-field-subtitle")).toHaveTextContent(FOLLOW_THE_FILE);
    expect(screen.getByTestId("language-follow-line-subtitle")).toHaveTextContent(
      LANGUAGE_FOLLOW_LINES.subtitle,
    );
    expect(screen.queryByTestId("language-follow-line-audio")).toBeNull();
  });

  test("× takes a language out and sends the whole list at once", async () => {
    const { host } = mount({ snapshot: withLanguages(["pt-BR", "en", "es-419"], ["ja"]) });
    await openSettings();
    await openCategory(PREFERENCES);

    fireEvent.click(screen.getByRole("button", { name: "Remove English" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove 日本語" }));

    await waitFor(() =>
      expect(host.asked("set_subtitle_languages")).toEqual([
        { type: "set_subtitle_languages", languages: ["pt-BR", "es-419"] },
      ]),
    );
    await waitFor(() =>
      expect(host.asked("set_audio_languages")).toEqual([
        { type: "set_audio_languages", languages: [] },
      ]),
    );
  });

  test("an unknown stored tag keeps its chip at its rank and can be removed", async () => {
    const { host } = mount({ snapshot: withLanguages(["en", "xx-YY"]) });
    await openSettings();
    await openCategory(PREFERENCES);

    expect(chipsOf("subtitle")).toEqual(["en", "xx-YY"]);
    fireEvent.click(screen.getByRole("button", { name: "Remove Other (xx-YY)" }));
    await waitFor(() =>
      expect(host.asked("set_subtitle_languages")).toEqual([
        { type: "set_subtitle_languages", languages: ["en"] },
      ]),
    );
  });

  test("a refusal is the Host's words beside the field, and the chips come back", async () => {
    const refusal: ActionError = { kind: "store", detail: "the store is read-only" };
    mount({ snapshot: withLanguages(["pt-BR", "en"]), respond: () => refusal });
    await openSettings();
    await openCategory(PREFERENCES);

    fireEvent.click(screen.getByRole("button", { name: "Remove English" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(explain(refusal));
    await waitFor(() => expect(chipsOf("subtitle")).toEqual(["pt-BR", "en"]));
  });

  test("the single-language picker is replaced by exactly the two fields", async () => {
    mount({ snapshot: withLanguages(["pt-BR"]) });
    await openSettings();
    await openCategory(PREFERENCES);

    expect(
      screen.getAllByTestId(/^language-field-/).map((field) => field.dataset.testid),
    ).toEqual(["language-field-subtitle", "language-field-audio"]);
  });
});

describe("the language sheet", () => {
  async function openSheet(kind: "subtitle" | "audio", snapshot: Snapshot) {
    const view = mount({ snapshot });
    await openSettings();
    await openCategory(PREFERENCES);
    fireEvent.click(screen.getByTestId(`language-open-${kind}`));
    const sheet = await screen.findByRole("dialog", { name: LANGUAGE_GROUP_HEADS[kind] });
    return { ...view, sheet };
  }

  test("lifts the chosen rows to the top in rank, with no ↑ ↓, and Done puts it away", async () => {
    const { sheet } = await openSheet("subtitle", withLanguages(["pt-BR", "en"]));

    const chosen = within(sheet).getAllByTestId(/^language-chosen-/);
    expect(chosen.map((row) => row.dataset.testid)).toEqual([
      "language-chosen-pt-BR",
      "language-chosen-en",
    ]);
    expect(within(sheet).queryByRole("button", { name: /Move .* (up|down)/ })).toBeNull();

    fireEvent.click(within(sheet).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  test("ticking sends the whole list with the language last; unticking closes the rest up", async () => {
    const { host, sheet } = await openSheet("audio", withLanguages([], ["ja"]));

    fireEvent.click(within(sheet).getByTestId("language-row-en"));
    fireEvent.click(within(sheet).getByTestId("language-chosen-ja"));

    await waitFor(() =>
      expect(host.asked("set_audio_languages")).toEqual([
        { type: "set_audio_languages", languages: ["ja", "en"] },
        { type: "set_audio_languages", languages: ["en"] },
      ]),
    );
  });

  test("at three chosen every other row is disabled and the note says why", async () => {
    const { host, sheet } = await openSheet(
      "subtitle",
      withLanguages(["pt-BR", "en", "es-419"]),
    );

    expect(within(sheet).getByTestId("language-note")).toHaveTextContent(THREE_CHOSEN_NOTE);
    const rest = within(sheet).getAllByTestId(/^language-row-/);
    expect(rest.length).toBeGreaterThan(0);
    for (const row of rest) {
      expect(row).toBeDisabled();
    }
    fireEvent.click(rest[0]!);
    expect(host.asked("set_subtitle_languages")).toEqual([]);

    // A chosen row still unticks, which is how a place is freed.
    fireEvent.click(within(sheet).getByTestId("language-chosen-en"));
    await waitFor(() =>
      expect(host.asked("set_subtitle_languages")).toEqual([
        { type: "set_subtitle_languages", languages: ["pt-BR", "es-419"] },
      ]),
    );
  });

  test("the page under it is inert while it is open, and Back puts it away", async () => {
    await openSheet("subtitle", withLanguages(["en"]));

    expect(screen.getByTestId("language-field-subtitle").closest("[inert]")).not.toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByTestId("language-field-subtitle")).toBeInTheDocument();
  });
});

describe("a chip's long-press drag", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Lay the three chips side by side, as a browser would have. */
  function layOut() {
    const field = screen.getByTestId("language-field-subtitle");
    Array.from(field.querySelectorAll<HTMLElement>("[data-chip-index]")).forEach((chip, index) => {
      chip.getBoundingClientRect = () =>
        ({ left: index * 100, top: 0, width: 90, height: 40, right: 0, bottom: 0 }) as DOMRect;
    });
    return Array.from(field.querySelectorAll<HTMLElement>("[data-chip-index]"));
  }

  test("held past the threshold, a chip is picked up and dropped on another rank", async () => {
    const { host } = mount({ snapshot: withLanguages(["pt-BR", "en", "es-419"]) });
    await openSettings();
    await openCategory(PREFERENCES);
    const [first] = layOut();
    vi.useFakeTimers();

    fireEvent.pointerDown(first!, { pointerId: 1, clientX: 10, clientY: 10 });
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
    fireEvent.pointerMove(first!, { pointerId: 1, clientX: 250, clientY: 10 });
    fireEvent.pointerUp(first!, { pointerId: 1, clientX: 250, clientY: 10 });
    vi.useRealTimers();

    await waitFor(() =>
      expect(host.asked("set_subtitle_languages")).toEqual([
        { type: "set_subtitle_languages", languages: ["en", "es-419", "pt-BR"] },
      ]),
    );
  });

  test("a move before the threshold is a swipe: nothing is picked up and nothing is sent", async () => {
    const { host } = mount({ snapshot: withLanguages(["pt-BR", "en", "es-419"]) });
    await openSettings();
    await openCategory(PREFERENCES);
    const [first] = layOut();
    vi.useFakeTimers();

    fireEvent.pointerDown(first!, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(first!, { pointerId: 1, clientX: 12, clientY: 60 });
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS * 2));
    fireEvent.pointerMove(first!, { pointerId: 1, clientX: 250, clientY: 10 });
    fireEvent.pointerUp(first!, { pointerId: 1, clientX: 250, clientY: 10 });
    vi.useRealTimers();

    expect(first!).not.toHaveAttribute("data-dragging");
    expect(host.asked("set_subtitle_languages")).toEqual([]);
  });

  test("a tap is no drag", async () => {
    const { host } = mount({ snapshot: withLanguages(["pt-BR", "en", "es-419"]) });
    await openSettings();
    await openCategory(PREFERENCES);
    const [first] = layOut();
    vi.useFakeTimers();

    fireEvent.pointerDown(first!, { pointerId: 1, clientX: 10, clientY: 10 });
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS / 2));
    fireEvent.pointerUp(first!, { pointerId: 1, clientX: 10, clientY: 10 });
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
    vi.useRealTimers();

    expect(host.asked("set_subtitle_languages")).toEqual([]);
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
