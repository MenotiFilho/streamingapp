import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { MenuGroup, MenuReadout, MenuRow } from "./Menu";

describe("the repertory menu group", () => {
  test("is a mono caps label over its rows", () => {
    render(
      <MenuGroup title="Tracks">
        <MenuRow>English</MenuRow>
      </MenuGroup>,
    );

    expect(screen.getByText("Tracks")).toHaveAttribute("data-group");
    expect(screen.getByRole("button", { name: "English" })).toBeInTheDocument();
  });
});

describe("the repertory menu row", () => {
  test("is a real focusable button, and a choice announces whether it is pressed", () => {
    render(
      <>
        <MenuRow pressed testId="on">English</MenuRow>
        <MenuRow pressed={false}>Commentary</MenuRow>
        <MenuRow>Autocrop</MenuRow>
      </>,
    );

    const on = screen.getByRole("button", { name: "English" });
    expect(on).toHaveAttribute("data-focusable");
    expect(on).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Commentary" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(
      screen.getByRole("button", { name: "Autocrop" }),
      "an action is not a choice and announces no pressed state",
    ).not.toHaveAttribute("aria-pressed");
  });

  test("carries the container's marks beside the label", () => {
    render(<MenuRow marks={["embedded", "default"]}>English</MenuRow>);

    const row = screen.getByRole("button", { name: /English/ });
    expect(row).toHaveTextContent("English");
    expect(row).toHaveTextContent("embedded");
    expect(row).toHaveTextContent("default");
  });

  test("a press sends the row's one Action", () => {
    const onPress = vi.fn();
    render(<MenuRow onPress={onPress}>Reset</MenuRow>);

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test("a disabled row is inert and says so", () => {
    const onPress = vi.fn();
    render(
      <MenuRow disabled onPress={onPress}>
        Previous chapter
      </MenuRow>,
    );

    const row = screen.getByRole("button", { name: "Previous chapter" });
    expect(row).toBeDisabled();
    fireEvent.click(row);
    expect(onPress).not.toHaveBeenCalled();
  });

  test("a pending row is disabled and announces its wait", () => {
    render(
      <MenuRow pending onPress={vi.fn()}>
        Next episode
      </MenuRow>,
    );

    const row = screen.getByRole("button", { name: "Next episode" });
    expect(row).toBeDisabled();
    expect(row).toHaveAttribute("aria-busy", "true");
  });
});

describe("the repertory menu readout", () => {
  test("prints a value with its accessible name", () => {
    render(<MenuReadout testId="subtitle-scale" label="Subtitle size 125%" value="Subtitle size 125%" />);

    const readout = screen.getByTestId("subtitle-scale");
    expect(readout).toHaveTextContent("Subtitle size 125%");
    expect(readout).toHaveAccessibleName("Subtitle size 125%");
  });

  test("prints the Player's statistics as label/value pairs", () => {
    render(
      <MenuReadout
        testId="statistics"
        lines={[
          { label: "Bitrate", value: "4.0 Mbps" },
          { label: "Hardware decode", value: "d3d11va" },
        ]}
      />,
    );

    const statistics = screen.getByTestId("statistics");
    expect(within(statistics).getByText("Bitrate")).toBeInTheDocument();
    expect(within(statistics).getByText("4.0 Mbps")).toBeInTheDocument();
    expect(statistics).toHaveTextContent("Hardware decode");
    expect(statistics).toHaveTextContent("d3d11va");
  });
});
