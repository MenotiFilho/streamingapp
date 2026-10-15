import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test } from "vitest";

import { App } from "./App";
import {
  HostClient,
  type Action,
  type AddonManifest,
  type Snapshot,
  type Transport,
} from "./host-client";

type Invocation = { command: string; args?: Record<string, unknown> };

const NOTHING_SAID: Snapshot = {
  revision: 0,
  preferences: { subtitleLanguage: null },
  addons: [],
};

/** An Addon as the Host would publish it, without the URL it lives at. */
const ADDON: AddonManifest = {
  id: "community.stremboxd",
  name: "Stremboxd",
  version: "2.0.0",
  resources: [
    { name: "catalog", types: null, idPrefixes: null },
    { name: "meta", types: ["movie"], idPrefixes: ["tt"] },
  ],
  types: ["movie"],
  catalogs: [{ type: "movie", id: "letterboxd-popular", name: "Popular This Week" }],
  idPrefixes: [],
  behaviorHints: { configurable: false, configurationRequired: false },
};

/**
 * A Host standing in for the real one: it holds the state, applies Actions the
 * way `host-core` does, and publishes a Snapshot for each change. The window
 * under test cannot tell the difference, which is the point.
 */
function fakeHost(options: { initial?: Snapshot; refuse?: unknown } = {}) {
  let state = options.initial ?? NOTHING_SAID;
  const invocations: Invocation[] = [];
  const listeners = new Set<(event: { payload: Snapshot }) => void>();

  const publish = (next: Snapshot) => {
    state = next;
    for (const listener of listeners) {
      listener({ payload: next });
    }
  };

  const invoke = async <T,>(
    command: string,
    args?: Record<string, unknown>,
  ): Promise<T> => {
    invocations.push({ command, args });
    if (command === "snapshot") {
      return state as unknown as T;
    }
    if (options.refuse) {
      throw options.refuse;
    }
    const { action } = args?.envelope as { action: Action };
    switch (action.type) {
      case "set_subtitle_language":
        publish({
          ...state,
          revision: state.revision + 1,
          preferences: { subtitleLanguage: action.language },
        });
        break;
      case "clear_subtitle_language":
        publish({
          ...state,
          revision: state.revision + 1,
          preferences: { subtitleLanguage: null },
        });
        break;
      case "add_addon":
        publish({
          ...state,
          revision: state.revision + 1,
          addons: [...state.addons, ADDON],
        });
        break;
      case "remove_addon":
        publish({
          ...state,
          revision: state.revision + 1,
          addons: state.addons.filter((addon) => addon.id !== action.id),
        });
        break;
    }
    return undefined as unknown as T;
  };

  const transport: Transport = {
    invoke,
    listen: async <T,>(
      _event: string,
      handler: (event: { payload: T }) => void,
    ) => {
      const record = handler as (event: { payload: Snapshot }) => void;
      listeners.add(record);
      return () => listeners.delete(record);
    },
  };

  return { transport, invocations, publish };
}

function windowOver(transport: Transport) {
  return render(<App client={new HostClient(transport)} />);
}

function shownLanguage() {
  return screen.getByTestId("subtitle-language").textContent;
}

function dispatched(invocations: Invocation[]): Invocation {
  const call = invocations.find(({ command }) => command === "dispatch");
  if (!call) {
    throw new Error(`no Action was taken: ${JSON.stringify(invocations)}`);
  }
  return call;
}

test("the window shows the preference the Host published", async () => {
  const host = fakeHost({
    initial: { revision: 7, preferences: { subtitleLanguage: "pt-BR" }, addons: [] },
  });

  windowOver(host.transport);

  await waitFor(() => expect(shownLanguage()).toBe("pt-BR"));
  expect(screen.getByTestId("revision")).toHaveTextContent("7");
});

test("a window that has had no preference set says so rather than inventing one", async () => {
  const host = fakeHost();

  windowOver(host.transport);

  await waitFor(() =>
    expect(shownLanguage()).toBe("none — the Host picks per Video"),
  );
});

test("saving a language takes a versioned Action through the Host", async () => {
  const host = fakeHost();
  windowOver(host.transport);
  await waitFor(() => expect(shownLanguage()).toBe("none — the Host picks per Video"));

  fireEvent.change(screen.getByLabelText("Prefer a language tag"), {
    target: { value: " pt-BR " },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(shownLanguage()).toBe("pt-BR"));
  expect(dispatched(host.invocations)).toEqual({
    command: "dispatch",
    args: {
      envelope: {
        version: 1,
        action: { type: "set_subtitle_language", language: "pt-BR" },
      },
    },
  });
  expect(screen.getByLabelText("Prefer a language tag")).toHaveValue("");
});

test("clearing the preference takes the clear Action", async () => {
  const host = fakeHost({
    initial: { revision: 3, preferences: { subtitleLanguage: "pt-BR" }, addons: [] },
  });
  windowOver(host.transport);
  await waitFor(() => expect(shownLanguage()).toBe("pt-BR"));

  fireEvent.click(screen.getByRole("button", { name: "Clear" }));

  await waitFor(() =>
    expect(shownLanguage()).toBe("none — the Host picks per Video"),
  );
  expect(dispatched(host.invocations).args).toEqual({
    envelope: { version: 1, action: { type: "clear_subtitle_language" } },
  });
  expect(screen.getByLabelText("Prefer a language tag")).toHaveValue("");
});

test("the window follows a Snapshot it did not ask for", async () => {
  const host = fakeHost();
  windowOver(host.transport);
  await waitFor(() => expect(shownLanguage()).toBe("none — the Host picks per Video"));

  act(() => {
    host.publish({ revision: 4, preferences: { subtitleLanguage: "en" }, addons: [] });
  });

  expect(shownLanguage()).toBe("en");
  expect(screen.getByTestId("revision")).toHaveTextContent("4");
});

test("an older Snapshot does not move the window backwards", async () => {
  const host = fakeHost({
    initial: { revision: 9, preferences: { subtitleLanguage: "de" }, addons: [] },
  });
  windowOver(host.transport);
  await waitFor(() => expect(shownLanguage()).toBe("de"));

  act(() => {
    host.publish({ revision: 2, preferences: { subtitleLanguage: "en" }, addons: [] });
  });

  expect(shownLanguage()).toBe("de");
  expect(screen.getByTestId("revision")).toHaveTextContent("9");
});

test("a rejected Action is explained and leaves the view where it was", async () => {
  const host = fakeHost({
    initial: { revision: 2, preferences: { subtitleLanguage: "pt-BR" }, addons: [] },
    refuse: { kind: "invalid_subtitle_language", language: "Brazilian Portuguese" },
  });
  windowOver(host.transport);
  await waitFor(() => expect(shownLanguage()).toBe("pt-BR"));

  fireEvent.change(screen.getByLabelText("Prefer a language tag"), {
    target: { value: "Brazilian Portuguese" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(
      '"Brazilian Portuguese" is not a subtitle language tag',
    ),
  );
  expect(shownLanguage()).toBe("pt-BR");
  expect(screen.getByLabelText("Prefer a language tag")).toHaveValue(
    "Brazilian Portuguese",
  );
});

test("a Host the window cannot reach is explained rather than swallowed", async () => {
  const host = fakeHost({
    initial: { revision: 1, preferences: { subtitleLanguage: "pt-BR" }, addons: [] },
    refuse: "the Host went away",
  });
  windowOver(host.transport);
  await waitFor(() => expect(shownLanguage()).toBe("pt-BR"));

  fireEvent.change(screen.getByLabelText("Prefer a language tag"), {
    target: { value: "en" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("could not reach the Host"),
  );
  expect(shownLanguage()).toBe("pt-BR");
  expect(screen.getByLabelText("Prefer a language tag")).toHaveValue("en");
});

test("the window lists the Addons the Host published, and what each offers", async () => {
  const host = fakeHost({
    initial: {
      revision: 4,
      preferences: { subtitleLanguage: null },
      addons: [ADDON],
    },
  });

  windowOver(host.transport);

  const addon = await screen.findByTestId("addon-community.stremboxd");
  expect(addon).toHaveTextContent("Stremboxd");
  expect(addon).toHaveTextContent("2.0.0");
  expect(addon).toHaveTextContent("community.stremboxd");
  expect(addon).toHaveTextContent("catalog");
  expect(addon).toHaveTextContent("meta (movie)");
  expect(addon).toHaveTextContent("movie");
  expect(addon).toHaveTextContent("Popular This Week (movie)");
});

test("a Host with no Addons says so rather than showing an empty list", async () => {
  const host = fakeHost();

  windowOver(host.transport);

  await waitFor(() =>
    expect(screen.getByTestId("addons-empty")).toHaveTextContent(
      "No Addons are configured yet.",
    ),
  );
  expect(screen.queryByTestId("addons")).not.toBeInTheDocument();
});

test("adding an Addon takes a versioned Action carrying the pasted URL", async () => {
  const host = fakeHost();
  windowOver(host.transport);
  await waitFor(() => expect(screen.getByTestId("addons-empty")).toBeInTheDocument());

  fireEvent.change(screen.getByLabelText("Addon manifest URL"), {
    target: { value: "  https://api.stremboxd.com/manifest.json  " },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));

  await waitFor(() =>
    expect(screen.getByTestId("addon-community.stremboxd")).toBeInTheDocument(),
  );
  expect(dispatched(host.invocations)).toEqual({
    command: "dispatch",
    args: {
      envelope: {
        version: 1,
        action: {
          type: "add_addon",
          url: "https://api.stremboxd.com/manifest.json",
        },
      },
    },
  });
  expect(screen.getByLabelText("Addon manifest URL")).toHaveValue("");
});

test("removing an Addon takes the id the Snapshot published", async () => {
  const host = fakeHost({
    initial: {
      revision: 2,
      preferences: { subtitleLanguage: null },
      addons: [ADDON],
    },
  });
  windowOver(host.transport);
  await waitFor(() => expect(screen.getByTestId("addon-community.stremboxd")).toBeInTheDocument());

  fireEvent.click(screen.getByRole("button", { name: "Remove Stremboxd" }));

  await waitFor(() => expect(screen.getByTestId("addons-empty")).toBeInTheDocument());
  expect(dispatched(host.invocations).args).toEqual({
    envelope: { version: 1, action: { type: "remove_addon", id: "community.stremboxd" } },
  });
});

test("a manifest the Host could not read is explained rather than swallowed", async () => {
  const host = fakeHost({
    refuse: { kind: "manifest", detail: "the manifest is missing name" },
  });
  windowOver(host.transport);
  await waitFor(() => expect(screen.getByTestId("addons-empty")).toBeInTheDocument());

  fireEvent.change(screen.getByLabelText("Addon manifest URL"), {
    target: { value: "https://example.com/manifest.json" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));

  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(
      "could not read that Addon's manifest: the manifest is missing name",
    ),
  );
  expect(screen.getByTestId("addons-empty")).toBeInTheDocument();
  expect(screen.getByLabelText("Addon manifest URL")).toHaveValue(
    "https://example.com/manifest.json",
  );
});

test("a URL that is not a manifest URL is explained with what it should look like", async () => {
  const host = fakeHost({
    refuse: { kind: "invalid_manifest_url", url: "not a url" },
  });
  windowOver(host.transport);
  await waitFor(() => expect(screen.getByTestId("addons-empty")).toBeInTheDocument());

  fireEvent.change(screen.getByLabelText("Addon manifest URL"), {
    target: { value: "not a url" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));

  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(
      '"not a url" is not a manifest URL',
    ),
  );
});
