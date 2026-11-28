import { act, createEvent, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { markNavigation, markPointer } from "../core/inputModality";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { CardCaption } from "./CardCaption";
import { Chip } from "./Chip";
import { useCalmMotion, useShownFocus } from "./controlsFocus";
import { EpisodeCaption } from "./EpisodeCaption";
import { EpisodeCard } from "./EpisodeCard";
import { Hero, type HeroProps } from "./Hero";
import { HeroTicks } from "./HeroTicks";
import { IconButton } from "./IconButton";
import { NavItem } from "./NavItem";
import { NavRail } from "./NavRail";
import { Poster } from "./Poster";
import { RowHeader } from "./RowHeader";
import { WideCard } from "./WideCard";

afterEach(() => {
  act(() => markPointer());
});

/** The art is decoration with no accessible name, so the harness reaches for it. */
function breakArt(container: HTMLElement) {
  const art = container.querySelector("img");
  expect(art).not.toBeNull();
  fireEvent.error(art as HTMLImageElement);
}

describe("actions", () => {
  it("presses a button, which never submits a form by accident", () => {
    const onClick = vi.fn();
    render(
      <Button icon="play" kind="primary" onClick={onClick}>
        Watch now
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Watch now" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("data-focusable");
    expect(button).not.toHaveAttribute("data-focused");

    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("ignores a press while disabled", () => {
    const onClick = vi.fn();
    render(
      <>
        <Button disabled onClick={onClick}>
          Resume
        </Button>
        <IconButton icon="x" label="Close" disabled onClick={onClick} />
        <Chip selected={false} disabled onClick={onClick}>
          Specials
        </Chip>
      </>,
    );

    for (const name of ["Resume", "Close", "Specials"]) {
      const control = screen.getByRole("button", { name });
      expect(control).toBeDisabled();
      fireEvent.click(control);
    }
    expect(onClick).not.toHaveBeenCalled();
  });

  it("marks an explicitly focused control", () => {
    render(
      <>
        <Button focused>Details</Button>
        <IconButton icon="arrow-left" label="Back" focused />
        <Chip selected focused>
          Season 2
        </Chip>
      </>,
    );

    for (const control of screen.getAllByRole("button")) {
      expect(control).toHaveAttribute("data-focused", "true");
    }
  });

  it("names an icon button and passes its press on", () => {
    const onClick = vi.fn();
    render(<IconButton icon="x" label="Close" onClick={onClick} />);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("announces a chip's selection, which focus does not change", () => {
    const onClick = vi.fn();
    render(
      <>
        <Chip selected focused onClick={onClick}>
          Season 2
        </Chip>
        <Chip selected={false}>Season 1</Chip>
      </>,
    );

    const chosen = screen.getByRole("button", { name: "Season 2" });
    expect(chosen).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Season 1" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    fireEvent.click(chosen);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("draws a badge as a mark, in the caller's own words", () => {
    render(<Badge tone="danger">Dolby Vision</Badge>);

    expect(screen.getByText("Dolby Vision")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("focus as an input modality", () => {
  it("shows DOM focus under navigation and not under the pointer", () => {
    const { result } = renderHook(() => useShownFocus<HTMLButtonElement>({}));
    const event = {} as Parameters<typeof result.current.focusProps.onFocus>[0];

    act(() => result.current.focusProps.onFocus(event));
    expect(result.current.shown).toBe(false);

    act(() => markNavigation());
    expect(result.current.shown).toBe(true);

    act(() => result.current.focusProps.onBlur(event));
    expect(result.current.shown).toBe(false);
  });

  it("leaves movement out under a reduced-motion config", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MotionConfig reducedMotion="always">{children}</MotionConfig>
    );
    expect(renderHook(() => useCalmMotion(), { wrapper }).result.current).toBe(true);
    expect(renderHook(() => useCalmMotion()).result.current).toBe(false);
  });

  it("still hands a card's own focus handlers their events", () => {
    const onFocus = vi.fn();
    const onBlur = vi.fn();
    render(<Poster name="Dune" onFocus={onFocus} onBlur={onBlur} />);
    const card = screen.getByRole("button", { name: "Dune" });

    act(() => card.focus());
    act(() => card.blur());
    expect(onFocus).toHaveBeenCalledOnce();
    expect(onBlur).toHaveBeenCalledOnce();
  });
});

describe("navigation", () => {
  it("names a destination even collapsed, and marks only the active one current", () => {
    render(
      <>
        <NavItem icon="house" label="Home" active />
        <NavItem icon="compass" label="Discover" expanded />
      </>,
    );

    expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("button", { name: "Discover" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("offers the six destinations in order and reports the one chosen", () => {
    const onSelect = vi.fn();
    render(<NavRail expanded={false} active="library" clock="21:42" onSelect={onSelect} />);

    const destinations = screen.getAllByRole("button");
    expect(destinations.map((item) => item.getAttribute("aria-label"))).toEqual([
      "Home",
      "Discover",
      "Search",
      "Library",
      "Addons",
      "Settings",
    ]);
    expect(screen.getByRole("button", { name: "Library" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    for (const item of destinations) {
      expect(item).toHaveAttribute("data-focusable");
    }

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(onSelect).toHaveBeenCalledWith("settings");
  });

  it("keeps the same controls, and focus, as the rail expands", () => {
    const { rerender } = render(<NavRail expanded={false} active="home" clock="21:42" />);
    const discover = screen.getByRole("button", { name: "Discover" });
    act(() => discover.focus());

    rerender(<NavRail expanded active="home" clock="21:42" focused="discover" />);

    expect(document.activeElement).toBe(discover);
    expect(discover).toHaveAttribute("data-focused", "true");
  });

  it("jumps to a pressed tick without taking focus", () => {
    const onSelect = vi.fn();
    render(<HeroTicks count={5} active={1} onSelect={onSelect} />);

    const ticks = screen.getAllByRole("button");
    expect(ticks).toHaveLength(5);
    expect(ticks[1]).toHaveAttribute("aria-current", "step");
    expect(ticks[0]).not.toHaveAttribute("aria-current");
    // Outside the focus order: the arrows step the hero already.
    expect(ticks[3]).toHaveAttribute("tabindex", "-1");

    const press = createEvent.mouseDown(ticks[3]!);
    fireEvent(ticks[3]!, press);
    expect(press.defaultPrevented).toBe(true);
    fireEvent.click(ticks[3]!);
    expect(onSelect).toHaveBeenCalledWith(3);
  });

  it("marks nothing for a hero with one title", () => {
    render(<HeroTicks count={1} active={0} onSelect={vi.fn()} />);

    expect(screen.queryByRole("group")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("cards", () => {
  it("opens a poster's Title and says it is watched", () => {
    const onClick = vi.fn();
    render(<Poster name="Dune" watched progress={1.4} onClick={onClick} />);

    const card = screen.getByRole("button", { name: "Dune, Watched" });
    expect(card).toHaveAttribute("data-focusable");
    expect(screen.getByRole("progressbar", { hidden: true })).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
    fireEvent.click(card);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("marks an unplayable poster in words and in its name, and still lets it be pressed", () => {
    const onClick = vi.fn();
    render(<Poster name="Dune" unplayable onClick={onClick} />);

    const card = screen.getByRole("button", { name: "Dune, Unplayable" });
    expect(screen.getByText("UNPLAYABLE")).toBeInTheDocument();
    fireEvent.click(card);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("draws no progress without a reading", () => {
    render(<Poster name="Dune" />);

    expect(screen.queryByRole("progressbar", { hidden: true })).toBeNull();
  });

  it("draws the name when a poster does not load", () => {
    const { container } = render(<Poster name="Dune" poster="https://art.test/dune.jpg" />);
    expect(screen.queryByText("Dune")).toBeNull();

    breakArt(container);
    expect(screen.getByText("Dune")).toBeInTheDocument();
  });

  it("walks a wide card from its backdrop to the still to its name", () => {
    const { container } = render(
      <WideCard
        name="MobLand"
        backdrop="https://art.test/backdrop.jpg"
        still="https://art.test/still.jpg"
      />,
    );
    // The backdrop carries the name where there is no logo; the still does not.
    expect(screen.getByText("MobLand")).toBeInTheDocument();

    breakArt(container);
    expect(screen.queryByText("MobLand")).toBeNull();

    breakArt(container);
    expect(screen.getByText("MobLand")).toBeInTheDocument();
  });

  it("opens a Continue watching card and says it is Up next", () => {
    const onClick = vi.fn();
    render(<WideCard name="MobLand" upNext progress={0} onClick={onClick} />);

    fireEvent.click(screen.getByRole("button", { name: "MobLand, Up next" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it.each([
    ["addon_removed", "MobLand, Unplayable: Addon removed"],
    ["addon_disabled", "MobLand, Unplayable: Addon disabled"],
  ] as const)("lists an %s entry without letting it be pressed", (reason, name) => {
    const onClick = vi.fn();
    render(
      <WideCard name="MobLand" unplayable={reason} upNext focused onClick={onClick} />,
    );

    const card = screen.getByRole("button", { name });
    expect(card).toBeDisabled();
    expect(card).not.toHaveAttribute("data-focusable");
    expect(card).not.toHaveAttribute("data-focused");
    fireEvent.click(card);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("opens an episode by its number and name", () => {
    const onClick = vi.fn();
    render(<EpisodeCard name="Who Is Alive?" code="S2E3" watched onClick={onClick} />);

    fireEvent.click(screen.getByRole("button", { name: "S2E3, Who Is Alive?, Watched" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("captions a card and an episode with only what is known", () => {
    render(
      <>
        <RowHeader title="Popular movies" source="Cinemeta" />
        <CardCaption title="Dune" note="1 h 02 min left" />
        <EpisodeCaption episode={3} title="Who Is Alive?" />
        <EpisodeCaption title="A special" />
      </>,
    );

    expect(screen.getByRole("heading", { name: "Popular movies" })).toBeInTheDocument();
    expect(screen.getByText("Cinemeta")).toBeInTheDocument();
    expect(screen.getByText("1 h 02 min left")).toBeInTheDocument();
    expect(screen.getAllByText(/^Episode/)).toHaveLength(1);
  });
});

describe("the hero", () => {
  const watch = vi.fn();
  const dune: HeroProps = {
    mode: "rotating",
    titleKey: "dune",
    name: "Dune",
    meta: { rating: "8.4", year: "2024" },
    actions: <Button onClick={watch}>Watch now</Button>,
    ticks: { count: 5, active: 0, onSelect: vi.fn() },
  };

  it("offers its actions and ticks while rotating", () => {
    render(<Hero {...dune} />);

    expect(screen.getByRole("heading", { name: "Dune" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Watch now" }));
    expect(watch).toHaveBeenCalledOnce();
    expect(screen.getByRole("group", { name: "Featured titles" })).toBeInTheDocument();
  });

  it("offers neither while following focus", () => {
    render(<Hero {...dune} mode="following" />);

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("heading", { name: "Dune" })).toBeInTheDocument();
  });

  it("keeps focus on its action while the title turns", () => {
    const { rerender } = render(<Hero {...dune} />);
    const action = screen.getByRole("button", { name: "Watch now" });
    act(() => action.focus());

    rerender(<Hero {...dune} titleKey="mobland" name="MobLand" />);

    expect(document.activeElement).toBe(action);
    expect(screen.getByRole("heading", { name: "MobLand" })).toBeInTheDocument();
  });

  it("names the Title in type when its logo does not load", () => {
    const { container } = render(<Hero {...dune} logo="https://art.test/logo.png" />);
    expect(screen.getByRole("img", { name: "Dune" })).toBeInTheDocument();

    breakArt(container);
    expect(screen.queryByRole("img", { name: "Dune" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Dune" })).toBeInTheDocument();
  });
});
