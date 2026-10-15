import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test } from "vitest";

import { App } from "./App";
import {
  HostClient,
  type Action,
  type Snapshot,
  type Transport,
} from "./host-client";

type Invocation = { command: string; args?: Record<string, unknown> };

const NOTHING_SAID: Snapshot = {
  revision: 0,
  preferences: { subtitleLanguage: null },
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
          revision: state.revision + 1,
          preferences: { subtitleLanguage: action.language },
        });
        break;
      case "clear_subtitle_language":
        publish({ revision: state.revision + 1, preferences: { subtitleLanguage: null } });
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
    initial: { revision: 7, preferences: { subtitleLanguage: "pt-BR" } },
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
    initial: { revision: 3, preferences: { subtitleLanguage: "pt-BR" } },
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
    host.publish({ revision: 4, preferences: { subtitleLanguage: "en" } });
  });

  expect(shownLanguage()).toBe("en");
  expect(screen.getByTestId("revision")).toHaveTextContent("4");
});

test("an older Snapshot does not move the window backwards", async () => {
  const host = fakeHost({
    initial: { revision: 9, preferences: { subtitleLanguage: "de" } },
  });
  windowOver(host.transport);
  await waitFor(() => expect(shownLanguage()).toBe("de"));

  act(() => {
    host.publish({ revision: 2, preferences: { subtitleLanguage: "en" } });
  });

  expect(shownLanguage()).toBe("de");
  expect(screen.getByTestId("revision")).toHaveTextContent("9");
});

test("a rejected Action is explained and leaves the view where it was", async () => {
  const host = fakeHost({
    initial: { revision: 2, preferences: { subtitleLanguage: "pt-BR" } },
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
    initial: { revision: 1, preferences: { subtitleLanguage: "pt-BR" } },
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
