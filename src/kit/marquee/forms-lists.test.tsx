import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { AnimatePresence } from "motion/react";
import { useState } from "react";
import { describe, expect, test, vi } from "vitest";

import { AddonRow, versionLabel, type AddonRowProps } from "./AddonRow";
import { CategoryItem } from "./CategoryItem";
import { Confirm } from "./Confirm";
import { DeviceRow } from "./DeviceRow";
import { Dropdown } from "./Dropdown";
import { EmptyState } from "./EmptyState";
import { formsPanel } from "./formsMotion";
import { ListRow } from "./ListRow";
import { PairingCode, pairingCells } from "./PairingCode";
import { RankedRow } from "./RankedRow";
import { SearchField } from "./SearchField";
import { Switch } from "./Switch";
import { TextField } from "./TextField";

const focus = (element: HTMLElement) => act(() => element.focus());
const button = (name: string | RegExp) => screen.getByRole("button", { name });
const noButton = (name: string) => screen.queryByRole("button", { name });

describe("the switch", () => {
  test("announces the state it was given and asks for the opposite, never flipping itself", () => {
    const onChange = vi.fn();
    const { rerender } = render(<Switch checked label="Autoplay" onChange={onChange} />);
    const control = screen.getByRole("switch", { name: "Autoplay" });

    expect(control).toHaveAttribute("data-focusable");
    fireEvent.click(control);
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(control).toHaveAttribute("aria-checked", "true");

    rerender(<Switch checked={false} label="Autoplay" onChange={onChange} />);
    expect(control).toHaveAttribute("aria-checked", "false");
    fireEvent.click(control);
    expect(onChange).toHaveBeenLastCalledWith(true);
  });

  test("is a native button, so Space and Enter are the browser's press", () => {
    render(<Switch checked label="Autoplay" onChange={() => {}} />);

    expect(screen.getByRole("switch")).toBeInstanceOf(HTMLButtonElement);
    expect(screen.getByRole("switch")).toHaveAttribute("type", "button");
  });

  test("takes no press while disabled", () => {
    const onChange = vi.fn();
    render(<Switch checked disabled label="Autoplay" onChange={onChange} />);

    fireEvent.click(screen.getByRole("switch"));

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("a forced focus", () => {
  test("is never carried by a disabled control", () => {
    render(
      <>
        <Switch checked disabled focused label="Autoplay" onChange={() => {}} />
        <ListRow label="Next episode" checked disabled focused onToggle={() => {}} />
        <ListRow label="Language" value="English" disabled focused />
        <TextField label="TMDB key" value="" disabled focused onChange={() => {}} />
        <AddonRow {...addonProps({ canMoveUp: false })} focused />
      </>,
    );

    expect(document.querySelectorAll(":disabled[data-focused]")).toHaveLength(0);
    expect(screen.getByRole("textbox").closest("[data-focused]")).toBeNull();
  });
});

describe("C7's movement", () => {
  test("is instant under reduced motion and the panel spring otherwise", () => {
    expect(formsPanel(true)).toEqual({ duration: 0 });
    expect(formsPanel(false)).toMatchObject({ type: "spring", bounce: 0 });
  });
});

describe("the list row", () => {
  test("a switch row is one switch, toggled by a press anywhere on it", () => {
    const onToggle = vi.fn();
    render(<ListRow label="Play the next episode" checked onToggle={onToggle} />);
    const row = screen.getByRole("switch", { name: "Play the next episode" });

    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(row).toHaveAttribute("aria-checked", "true");
    fireEvent.click(within(row).getByText("Play the next episode"));

    expect(onToggle).toHaveBeenCalledExactlyOnceWith(false);
  });

  test("a value row is one control that opens its list", () => {
    const onPress = vi.fn();
    render(<ListRow label="Subtitle language" value="English" onPress={onPress} />);
    const row = button(/Subtitle language/);

    expect(row).toHaveAttribute("data-focusable");
    fireEvent.click(row);

    expect(onPress).toHaveBeenCalledOnce();
  });

  test("a slot row is no control of its own: its slot's controls are", () => {
    const onPress = vi.fn();
    render(
      <ListRow label="TMDB key">
        <button type="button" onClick={onPress}>
          Clear
        </button>
      </ListRow>,
    );

    expect(screen.getAllByRole("button")).toHaveLength(1);
    fireEvent.click(button("Clear"));

    expect(onPress).toHaveBeenCalledOnce();
  });
});

function addonProps(overrides: Partial<AddonRowProps> = {}): AddonRowProps {
  return {
    name: "Torrentio",
    serves: "Streams · movies, series",
    version: "0.0.15",
    enabled: true,
    canMoveUp: true,
    canMoveDown: true,
    onToggle: vi.fn(),
    onDetails: vi.fn(),
    onMoveUp: vi.fn(),
    onMoveDown: vi.fn(),
    onRemove: vi.fn(),
    onPlace: vi.fn(),
    ...overrides,
  };
}

const CONTROLS = ["Details", "Move up", "Move down", "Remove"];

describe("the Addon row", () => {
  test("prints the Manifest's version once marked", () => {
    expect(versionLabel("0.0.15")).toBe("v0.0.15");
    expect(versionLabel("v2.0.0")).toBe("v2.0.0");
    expect(versionLabel("vNext")).toBe("vvNext");
  });

  test("its switch asks for the opposite of what the Host says", () => {
    const onToggle = vi.fn();
    const { rerender } = render(<AddonRow {...addonProps({ onToggle })} />);
    const control = screen.getByRole("switch", { name: "Enable Torrentio" });

    fireEvent.click(control);
    expect(onToggle).toHaveBeenLastCalledWith(false);

    rerender(<AddonRow {...addonProps({ onToggle, enabled: false })} />);
    fireEvent.click(control);
    expect(onToggle).toHaveBeenLastCalledWith(true);
  });

  test("offers its controls only while it holds the focus", () => {
    render(
      <>
        <AddonRow {...addonProps()} />
        <button type="button">Elsewhere</button>
      </>,
    );

    for (const name of CONTROLS) {
      expect(noButton(name)).toBeNull();
    }
    focus(button("Torrentio"));
    for (const name of CONTROLS) {
      expect(button(name)).toHaveAttribute("data-focusable");
    }
    focus(button("Remove"));
    expect(button("Details")).toBeInTheDocument();

    focus(button("Elsewhere"));
    expect(noButton("Details")).toBeNull();
  });

  test("keeps its controls while the question it asked holds the focus", () => {
    render(
      <>
        <AddonRow {...addonProps()} />
        <div role="dialog" aria-modal="true">
          <button type="button">Cancel</button>
        </div>
      </>,
    );
    focus(button("Torrentio"));
    focus(button("Remove"));

    focus(button("Cancel"));

    expect(button("Remove")).toBeInTheDocument();
  });

  test("lets its controls go when the focus leaves that question for somewhere else", () => {
    render(
      <>
        <AddonRow {...addonProps()} />
        <div role="dialog" aria-modal="true">
          <button type="button">Cancel</button>
        </div>
        <button type="button">Elsewhere</button>
      </>,
    );
    focus(button("Torrentio"));
    focus(button("Cancel"));

    focus(button("Elsewhere"));

    expect(noButton("Remove")).toBeNull();
  });

  test("each control takes its own request", () => {
    const props = addonProps();
    render(<AddonRow {...props} focused />);

    fireEvent.click(button("Details"));
    fireEvent.click(button("Move up"));
    fireEvent.click(button("Move down"));
    fireEvent.click(button("Remove"));

    expect(props.onDetails).toHaveBeenCalledOnce();
    expect(props.onMoveUp).toHaveBeenCalledOnce();
    expect(props.onMoveDown).toHaveBeenCalledOnce();
    expect(props.onRemove).toHaveBeenCalledOnce();
    expect(props.onToggle).not.toHaveBeenCalled();
  });

  test("refuses a move past either end of the list", () => {
    const { rerender } = render(<AddonRow {...addonProps({ canMoveUp: false })} focused />);
    expect(button("Move up")).toBeDisabled();
    expect(button("Move down")).toBeEnabled();

    rerender(<AddonRow {...addonProps({ canMoveDown: false })} focused />);
    expect(button("Move up")).toBeEnabled();
    expect(button("Move down")).toBeDisabled();
  });

  test("a move that reaches an end leaves the focus on the row", () => {
    function Last() {
      const [last, setLast] = useState(false);
      return <AddonRow {...addonProps({ canMoveDown: !last, onMoveDown: () => setLast(true) })} />;
    }
    render(<Last />);
    focus(button("Torrentio"));
    focus(button("Move down"));

    fireEvent.click(button("Move down"));

    expect(button("Torrentio")).toHaveFocus();
    expect(button("Move up")).toBeInTheDocument();
  });

  test("moving, it offers neither switch nor controls, and OK places it", () => {
    const props = addonProps({ moving: true });
    render(<AddonRow {...props} />);
    focus(button("Torrentio"));

    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    fireEvent.click(button("Torrentio"));

    expect(props.onPlace).toHaveBeenCalledOnce();
  });

  test("at rest, OK is the row's press and places nothing", () => {
    const props = addonProps({ onPress: vi.fn() });
    render(<AddonRow {...props} />);

    fireEvent.click(button("Torrentio"));

    expect(props.onPress).toHaveBeenCalledOnce();
    expect(props.onPlace).not.toHaveBeenCalled();
  });

  test("moving, Up and Down move it one place a press and the focus engine gets none", () => {
    const props = addonProps({ moving: true });
    render(<AddonRow {...props} />);
    const row = button("Torrentio");

    // `fireEvent` answers false when the default was prevented, which is how the
    // focus engine knows the row took the key.
    expect(fireEvent.keyDown(row, { key: "ArrowUp" })).toBe(false);
    expect(fireEvent.keyDown(row, { key: "ArrowDown" })).toBe(false);
    expect(fireEvent.keyDown(row, { key: "ArrowDown", repeat: true })).toBe(false);
    expect(fireEvent.keyDown(row, { key: "ArrowLeft" })).toBe(false);
    expect(fireEvent.keyDown(row, { key: "ArrowRight" })).toBe(false);
    expect(fireEvent.keyDown(row, { key: "Escape" })).toBe(true);

    expect(props.onMoveUp).toHaveBeenCalledOnce();
    expect(props.onMoveDown).toHaveBeenCalledOnce();
  });

  test("moving at an end, the key is still the row's and asks for nothing", () => {
    const props = addonProps({ moving: true, canMoveUp: false });
    render(<AddonRow {...props} />);

    expect(fireEvent.keyDown(button("Torrentio"), { key: "ArrowUp" })).toBe(false);

    expect(props.onMoveUp).not.toHaveBeenCalled();
  });

  test("at rest, the arrows are the focus engine's", () => {
    const props = addonProps();
    render(<AddonRow {...props} />);

    expect(fireEvent.keyDown(button("Torrentio"), { key: "ArrowDown" })).toBe(true);

    expect(props.onMoveDown).not.toHaveBeenCalled();
  });

  test("starting to move from one of its controls takes the focus to the row", () => {
    function Mover() {
      const [moving, setMoving] = useState(false);
      return (
        <AddonRow
          {...addonProps({
            moving,
            onMoveDown: () => setMoving(true),
            onPlace: () => setMoving(false),
          })}
        />
      );
    }
    render(<Mover />);
    focus(button("Torrentio"));
    focus(button("Move down"));

    fireEvent.click(button("Move down"));
    expect(button("Torrentio")).toHaveFocus();

    fireEvent.click(button("Torrentio"));
    expect(button("Torrentio")).toHaveFocus();
    expect(button("Details")).toBeInTheDocument();
  });

  test("a row the focus has left does not take it back when it starts to move", () => {
    const { rerender } = render(
      <>
        <AddonRow {...addonProps()} />
        <button type="button">Elsewhere</button>
      </>,
    );
    focus(button("Torrentio"));
    focus(button("Elsewhere"));

    rerender(
      <>
        <AddonRow {...addonProps({ moving: true })} />
        <button type="button">Elsewhere</button>
      </>,
    );

    expect(button("Elsewhere")).toHaveFocus();
  });
});

const GENRES = [
  { id: "all", label: "All genres" },
  { id: "action", label: "Action" },
  { id: "drama", label: "Drama" },
];

function Genre({
  onSelect = () => {},
  onOpenChange = () => {},
  initial = "all",
}: {
  onSelect?: (id: string) => void;
  onOpenChange?: (open: boolean) => void;
  initial?: string;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(initial);
  return (
    <Dropdown
      label="Genre"
      options={GENRES}
      selected={selected}
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        setOpen(next);
      }}
      onSelect={(id) => {
        onSelect(id);
        setSelected(id);
      }}
    />
  );
}

describe("the dropdown", () => {
  test("opens on a press and puts the focus on the chosen option", () => {
    const onOpenChange = vi.fn();
    render(<Genre initial="action" onOpenChange={onOpenChange} />);
    const trigger = button("Genre: Action");

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.click(trigger);

    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const chosen = screen.getByRole("option", { name: "Action" });
    expect(chosen).toHaveAttribute("aria-selected", "true");
    expect(chosen).toHaveFocus();
    expect(screen.getAllByRole("option", { selected: false })).toHaveLength(2);
  });

  test("a value no option names starts the menu on its first", () => {
    render(<Genre initial="gone" />);

    fireEvent.click(button(/^Genre:/));

    expect(screen.getByRole("option", { name: "All genres" })).toHaveFocus();
  });

  test("choosing takes the value, closes the menu and returns the focus", () => {
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    render(<Genre onSelect={onSelect} onOpenChange={onOpenChange} />);
    fireEvent.click(button("Genre: All genres"));

    fireEvent.click(screen.getByRole("option", { name: "Drama" }));

    expect(onSelect).toHaveBeenCalledExactlyOnceWith("drama");
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    const trigger = button("Genre: Drama");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  });

  const held = (open: boolean) => (
    <>
      <Dropdown
        label="Genre"
        options={GENRES}
        selected="all"
        open={open}
        onOpenChange={() => {}}
        onSelect={() => {}}
      />
      <button type="button">Elsewhere</button>
    </>
  );

  test("closed by its caller while the menu holds the focus, the pill takes it back", () => {
    const { rerender } = render(held(true));
    focus(screen.getByRole("option", { name: "Drama" }));

    rerender(held(false));

    expect(button("Genre: All genres")).toHaveFocus();
  });

  test("closed by its caller after the focus left, it takes nothing back", () => {
    const { rerender } = render(held(true));
    focus(button("Elsewhere"));

    rerender(held(false));

    expect(button("Elsewhere")).toHaveFocus();
  });

  test("a second press on the pill asks to close without choosing", () => {
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    render(<Genre onSelect={onSelect} onOpenChange={onOpenChange} />);

    fireEvent.click(button("Genre: All genres"));
    fireEvent.click(button("Genre: All genres"));

    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("the ranked row", () => {
  const row = (position: number, count: number) => {
    const handlers = { onMoveUp: vi.fn(), onMoveDown: vi.fn(), onRemove: vi.fn() };
    const view = render(
      <RankedRow position={position} count={count} label="English" {...handlers} />,
    );
    return { ...handlers, view };
  };

  test.each([
    { position: 1, count: 3, up: false, down: true },
    { position: 2, count: 3, up: true, down: true },
    { position: 3, count: 3, up: true, down: false },
    { position: 1, count: 1, up: false, down: false },
  ])("at $position of $count, up is $up and down is $down", ({ position, count, up, down }) => {
    const { onMoveUp, onMoveDown, onRemove } = row(position, count);

    fireEvent.click(button("Move up"));
    fireEvent.click(button("Move down"));
    fireEvent.click(button("Remove"));

    expect(onMoveUp).toHaveBeenCalledTimes(up ? 1 : 0);
    expect(onMoveDown).toHaveBeenCalledTimes(down ? 1 : 0);
    expect(onRemove).toHaveBeenCalledOnce();
  });

  function Order() {
    const [position, setPosition] = useState(2);
    return (
      <RankedRow
        position={position}
        count={3}
        label="English"
        onMoveUp={() => setPosition((held) => held - 1)}
        onMoveDown={() => setPosition((held) => held + 1)}
        onRemove={() => {}}
      />
    );
  }

  test.each([
    { move: "Move up", landed: "1. English" },
    { move: "Move down", landed: "3. English" },
  ])("$move to an end leaves the focus on the row", ({ move, landed }) => {
    render(<Order />);
    focus(button("2. English"));
    focus(button(move));

    fireEvent.click(button(move));

    expect(button(landed)).toHaveFocus();
  });

  test("a row the focus has left does not take it back when a control stops being one", () => {
    const ranked = (count: number) => (
      <RankedRow
        position={2}
        count={count}
        label="English"
        onMoveUp={() => {}}
        onMoveDown={() => {}}
        onRemove={() => {}}
      />
    );
    const { rerender } = render(ranked(3));
    focus(button("Move down"));
    act(() => button("Move down").blur());

    rerender(ranked(2));

    expect(button("2. English")).not.toHaveFocus();
  });

  test("announces its place in the order", () => {
    row(2, 3);

    expect(button("2. English")).toHaveAttribute("data-focusable");
  });
});

describe("the confirmation", () => {
  const ask = (props: { pending?: boolean } = {}) => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <Confirm
        title="Remove MediaFusion?"
        body="Its Streams stop showing on every client."
        confirmLabel="Remove"
        danger
        onConfirm={onConfirm}
        onCancel={onCancel}
        {...props}
      />,
    );
    return { onConfirm, onCancel };
  };

  test("starts the focus on Cancel", () => {
    ask();

    expect(button("Cancel")).toHaveFocus();
  });

  test("is a dialog region whose safe head, the first control, is Cancel", () => {
    ask();
    const dialog = screen.getByRole("dialog", { name: "Remove MediaFusion?" });

    expect(dialog).toHaveAttribute("data-kind", "dialog");
    expect(dialog.querySelector("[data-focusable]")).toBe(button("Cancel"));
    expect(dialog).toHaveAccessibleDescription("Its Streams stop showing on every client.");
  });

  test("each answer takes only its own", () => {
    const { onConfirm, onCancel } = ask();

    fireEvent.click(button("Cancel"));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(button("Remove"));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  test("on its way out it is inert, so no second answer leaves", () => {
    const asked = (open: boolean) => (
      <AnimatePresence>
        {open ? (
          <Confirm
            key="confirm"
            title="Remove MediaFusion?"
            body="Its Streams stop showing on every client."
            onConfirm={() => {}}
            onCancel={() => {}}
          />
        ) : null}
      </AnimatePresence>
    );
    const { rerender } = render(asked(true));
    const dialog = screen.getByRole("dialog");
    expect(dialog.closest("[inert]")).toBeNull();

    rerender(asked(false));

    expect(dialog).toBeInTheDocument();
    expect(dialog.closest("[inert]")).not.toBeNull();
  });

  test("while the answer is in flight it takes no second one, and Cancel still answers", () => {
    const { onConfirm, onCancel } = ask({ pending: true });

    fireEvent.click(button("Remove"));
    fireEvent.click(button("Cancel"));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledOnce();
  });
});

describe("the search field", () => {
  function Search({ onChange }: { onChange: (next: string) => void }) {
    const [query, setQuery] = useState("");
    return (
      <SearchField
        value={query}
        onChange={(next) => {
          onChange(next);
          setQuery(next);
        }}
      />
    );
  }

  test("takes what is typed, and clearing empties it with the focus back in the box", () => {
    const onChange = vi.fn();
    render(<Search onChange={onChange} />);
    const box = screen.getByRole("searchbox", { name: "Search movies and series" });

    expect(noButton("Clear search")).toBeNull();
    fireEvent.change(box, { target: { value: "dune" } });
    expect(onChange).toHaveBeenLastCalledWith("dune");

    focus(button("Clear search"));
    fireEvent.click(button("Clear search"));

    expect(onChange).toHaveBeenLastCalledWith("");
    expect(box).toHaveValue("");
    expect(box).toHaveFocus();
    expect(noButton("Clear search")).toBeNull();
  });
});

describe("the text field", () => {
  test("is named by its label and hands back what is typed", () => {
    const onChange = vi.fn();
    render(<TextField label="Install an Addon" value="" onChange={onChange} />);
    const box = screen.getByRole("textbox", { name: "Install an Addon" });

    expect(box).toHaveAttribute("data-focusable");
    expect(box).not.toHaveAttribute("aria-invalid");
    fireEvent.change(box, { target: { value: "https://example.com/manifest.json" } });

    expect(onChange).toHaveBeenLastCalledWith("https://example.com/manifest.json");
  });

  test("a refusal marks the box, describes it and keeps what was typed", () => {
    render(
      <TextField
        label="Install an Addon"
        value="nonsense"
        error="invalid_manifest_url"
        onChange={() => {}}
      />,
    );
    const box = screen.getByRole("textbox");

    expect(box).toHaveAttribute("aria-invalid", "true");
    expect(box).toHaveAccessibleDescription("invalid_manifest_url");
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(box).toHaveValue("nonsense");
  });

  test("a masked field does not show its secret", () => {
    render(<TextField label="TMDB key" masked value="secret" onChange={() => {}} />);

    expect(screen.getByLabelText("TMDB key")).toHaveAttribute("type", "password");
  });
});

describe("the Pairing code", () => {
  test.each([
    { code: "K7QX4M", cells: ["K", "7", "Q", "X", "4", "M"] },
    { code: " k7q-x4m ", cells: ["K", "7", "Q", "X", "4", "M"] },
    { code: "K7Q", cells: ["K", "7", "Q", "", "", ""] },
    { code: "", cells: ["", "", "", "", "", ""] },
    { code: "K7QX4MZZ", cells: ["K", "7", "Q", "X", "4", "M"] },
  ])("spells $code in six cells", ({ code, cells }) => {
    expect(pairingCells(code)).toEqual(cells);
  });

  test("shows the Host's address as it was said, and none when it serves none", () => {
    const { rerender } = render(<PairingCode code="K7QX4M" address="http://192.168.0.12:7878" />);
    expect(screen.getByRole("img", { name: "Pairing code K 7 Q X 4 M" })).toBeInTheDocument();
    expect(screen.getByText("http://192.168.0.12:7878")).toBeInTheDocument();

    rerender(<PairingCode code="K7QX4M" address={null} />);
    expect(screen.queryByText(/http:/)).toBeNull();
  });
});

describe("the rows that take one press", () => {
  test("revoking asks for that Device alone", () => {
    const first = vi.fn();
    const second = vi.fn();
    render(
      <>
        <DeviceRow name="Living-room phone" detail="Paired 12 Nov 2026" onRevoke={first} />
        <DeviceRow name="Tablet" detail="Paired 3 Oct 2026" onRevoke={second} />
      </>,
    );

    fireEvent.click(button("Revoke Tablet"));

    expect(second).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
  });

  test("the category on show says so, and a press asks for the one pressed", () => {
    const onPress = vi.fn();
    render(
      <>
        <CategoryItem label="Preferences" active onPress={() => {}} />
        <CategoryItem label="Credentials" onPress={onPress} />
      </>,
    );

    expect(button("Preferences")).toHaveAttribute("aria-current", "page");
    expect(button("Credentials")).not.toHaveAttribute("aria-current");
    fireEvent.click(button("Credentials"));

    expect(onPress).toHaveBeenCalledOnce();
  });

  test("an empty state offers its one action, and none when there is nothing to do", () => {
    const onPress = vi.fn();
    const { rerender } = render(
      <EmptyState
        title="Nothing in your Library yet"
        body="Titles you add or start watching show up here."
        action={{ label: "Go to Discover", onPress }}
      />,
    );

    fireEvent.click(button("Go to Discover"));
    expect(onPress).toHaveBeenCalledOnce();

    rerender(<EmptyState title="Nothing here" body="Nothing to do." />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
