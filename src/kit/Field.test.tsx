import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { explain, type ActionError } from "../core/errors";
import { Field } from "./Field";

const REFUSED_KEY: ActionError = {
  kind: "invalid_tmdb_key",
  detail: "the key is too short",
};

describe("the repertory field", () => {
  test("associates its label with the field and reports what is typed", () => {
    const onChange = vi.fn();
    render(
      <Field
        id="addons-manifest-url"
        label="Addon manifest URL"
        value=""
        onChange={onChange}
      />,
    );

    const input = screen.getByLabelText("Addon manifest URL");
    expect(input).toHaveAttribute("data-focusable");

    fireEvent.change(input, {
      target: { value: "https://example.test/manifest.json" },
    });
    expect(onChange).toHaveBeenCalledWith("https://example.test/manifest.json");
  });

  test("draws the trailing control in the field", () => {
    render(
      <Field
        id="rep-search-query"
        label="Search for a Title"
        value=""
        onChange={() => {}}
        trailing={<button type="button">Search</button>}
      />,
    );

    expect(screen.getByRole("button", { name: "Search" })).toBeInTheDocument();
  });

  test("names a refusal and wires it to the field", () => {
    render(
      <Field
        id="settings-tmdb-key"
        label="TMDB API key or read-access token"
        type="password"
        value="short"
        onChange={() => {}}
        error={REFUSED_KEY}
        refusalTestId="tmdb-key-error"
      />,
    );

    const refusal = screen.getByRole("alert");
    expect(refusal).toHaveTextContent(explain(REFUSED_KEY));

    const input = screen.getByLabelText("TMDB API key or read-access token");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", refusal.id);
  });

  test("leaves a field with no refusal unmarked", () => {
    render(
      <Field
        id="rep-search-query"
        label="Search for a Title"
        value="the"
        onChange={() => {}}
      />,
    );

    const input = screen.getByLabelText("Search for a Title");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).not.toHaveAttribute("aria-describedby");
  });

  test("takes the refusal mark away when the error clears", () => {
    const { rerender } = render(
      <Field
        id="settings-tmdb-key"
        label="TMDB API key or read-access token"
        value="short"
        onChange={() => {}}
        error={REFUSED_KEY}
        refusalTestId="tmdb-key-error"
      />,
    );

    rerender(
      <Field
        id="settings-tmdb-key"
        label="TMDB API key or read-access token"
        value="short"
        onChange={() => {}}
        error={null}
        refusalTestId="tmdb-key-error"
      />,
    );

    const input = screen.getByLabelText("TMDB API key or read-access token");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).not.toHaveAttribute("aria-describedby");
  });

  test("a disabled field is a disabled control", () => {
    render(
      <Field
        id="rep-search-query"
        label="Search for a Title"
        value=""
        onChange={() => {}}
        disabled
      />,
    );

    expect(screen.getByLabelText("Search for a Title")).toBeDisabled();
  });
});
