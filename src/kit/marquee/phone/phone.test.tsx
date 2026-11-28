import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MotionConfig } from "motion/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { BottomSheet } from "./BottomSheet";
import { CodeInput } from "./CodeInput";
import { NowPlayingStrip } from "./NowPlayingStrip";
import { PhoneAddonNotice } from "./PhoneAddonNotice";
import { PhoneAddonRow } from "./PhoneAddonRow";
import { PhoneCardCaption } from "./PhoneCardCaption";
import { PhoneEpisodeRow } from "./PhoneEpisodeRow";
import { PhoneHeader } from "./PhoneHeader";
import { PhoneHero } from "./PhoneHero";
import { PhoneListRow } from "./PhoneListRow";
import { PhonePoster } from "./PhonePoster";
import { PhoneRowHeader } from "./PhoneRowHeader";
import { PhoneSeekBar } from "./PhoneSeekBar";
import { PhoneStreamRow } from "./PhoneStreamRow";
import { PhoneSwitchRow } from "./PhoneSwitchRow";
import { PhoneTransport } from "./PhoneTransport";
import { PhoneWideCard } from "./PhoneWideCard";
import { RemoteMenus } from "./RemoteMenus";
import { TabBar } from "./TabBar";
import { TabItem } from "./TabItem";
import { VolumeBox } from "./VolumeBox";

function setTrackRect(element: Element, left = 0, width = 200) {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      left,
      top: 0,
      right: left + width,
      bottom: 44,
      width,
      height: 44,
      x: left,
      y: 0,
      toJSON: () => ({}),
    }),
  });
}

describe("TabItem and TabBar", () => {
  it("renders all six destinations, marks only the active one, and reports selection", () => {
    const onSelect = vi.fn();
    render(<TabBar active="library" onSelect={onSelect} />);

    const nav = screen.getByRole("navigation", { name: "Destinations" });
    const tabs = within(nav).getAllByRole("button");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
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
    expect(screen.getByRole("button", { name: "Home" })).not.toHaveAttribute("aria-current");

    fireEvent.click(screen.getByRole("button", { name: "Addons" }));
    fireEvent.click(screen.getByRole("button", { name: "Library" }));
    expect(onSelect).toHaveBeenNthCalledWith(1, "addons");
    expect(onSelect).toHaveBeenNthCalledWith(2, "library");
  });

  it("allows pressing a standalone TabItem", () => {
    const onPress = vi.fn();
    render(<TabItem icon="house" label="Home" active onPress={onPress} />);

    const tab = screen.getByRole("button", { name: "Home" });
    expect(tab).toHaveAttribute("aria-current", "page");
    fireEvent.click(tab);
    expect(onPress).toHaveBeenCalledOnce();
  });
});

describe("NowPlayingStrip", () => {
  it("opens the full remote from the strip and keeps transport buttons independent", () => {
    const onOpen = vi.fn();
    const onBack = vi.fn();
    const onToggle = vi.fn();

    render(
      <NowPlayingStrip
        title="Severance"
        note="S2 E3 · 31 min left"
        playing
        progress={0.38}
        onOpen={onOpen}
        onBack={onBack}
        onToggle={onToggle}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Back 10 seconds" }));
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(onToggle).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Open the remote, Severance/ }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("blocks transport actions while disabled without blocking opening the remote", () => {
    const onOpen = vi.fn();
    const onBack = vi.fn();
    const onToggle = vi.fn();

    render(
      <NowPlayingStrip
        title="Severance"
        note="Opening…"
        playing={false}
        progress={0}
        disabled
        onOpen={onOpen}
        onBack={onBack}
        onToggle={onToggle}
      />,
    );

    expect(screen.getByRole("button", { name: "Back 10 seconds" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(onToggle).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Open the remote, Severance/ }));
    expect(onOpen).toHaveBeenCalledOnce();
  });
});

describe("PhoneHero, cards, captions and row headers", () => {
  it("triggers Watch now, Details, and sideways swipes without stealing button presses", () => {
    const onWatch = vi.fn();
    const onDetails = vi.fn();
    const onSwipe = vi.fn();

    render(
      <PhoneHero
        itemKey="dune"
        name="Dune"
        facts={["IMDb 8.4", "2024", "167 min"]}
        index={0}
        count={5}
        elapsed={0.5}
        onWatch={onWatch}
        onDetails={onDetails}
        onSwipe={onSwipe}
      />,
    );

    const hero = screen.getByRole("region", { name: "Featured" });
    expect(screen.getByText("IMDb 8.4 · 2024 · 167 min")).toBeInTheDocument();

    const watch = screen.getByRole("button", { name: "Watch now" });
    fireEvent.pointerDown(watch, { pointerId: 1, clientX: 200, clientY: 400 });
    fireEvent.pointerUp(watch, { pointerId: 1, clientX: 100, clientY: 400 });
    fireEvent.click(watch);
    expect(onWatch).toHaveBeenCalledOnce();
    expect(onSwipe).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(onDetails).toHaveBeenCalledOnce();

    fireEvent.pointerDown(hero, { pointerId: 2, clientX: 220, clientY: 200 });
    fireEvent.pointerUp(hero, { pointerId: 2, clientX: 150, clientY: 205 });
    expect(onSwipe).toHaveBeenCalledWith("next");

    fireEvent.pointerDown(hero, { pointerId: 3, clientX: 100, clientY: 200 });
    fireEvent.pointerUp(hero, { pointerId: 3, clientX: 170, clientY: 205 });
    expect(onSwipe).toHaveBeenCalledWith("previous");

    fireEvent.pointerDown(hero, { pointerId: 4, clientX: 150, clientY: 100 });
    fireEvent.pointerUp(hero, { pointerId: 4, clientX: 200, clientY: 220 });
    expect(onSwipe).toHaveBeenCalledTimes(2);
  });

  it("falls back to the Title name when hero or card art fails to load", () => {
    render(
      <>
        <PhoneHero
          itemKey="dune"
          name="Dune"
          logo="https://art.test/dune-logo.png"
          facts={["2024"]}
          index={0}
          count={1}
          onWatch={vi.fn()}
          onDetails={vi.fn()}
          onSwipe={vi.fn()}
        />
        <PhonePoster name="Inception" poster="https://art.test/inception.jpg" onPress={vi.fn()} />
        <PhoneWideCard
          name="Spider-Man"
          art="https://art.test/spider.jpg"
          upNext
          progress={0.4}
          onPress={vi.fn()}
        />
      </>,
    );

    fireEvent.error(screen.getByRole("img", { name: "Dune" }));
    expect(screen.getByRole("heading", { name: "Dune" })).toHaveTextContent("Dune");

    const images = document.querySelectorAll("img");
    for (const img of images) {
      fireEvent.error(img);
    }
    expect(screen.getByText("Inception")).toBeInTheDocument();
    expect(screen.getByText("Spider-Man")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Spider-Man, Up next" })).toBeInTheDocument();
  });

  it("renders captions and row headers with optional metadata", () => {
    render(
      <>
        <PhoneRowHeader title="Popular movies" source="Cinemeta" />
        <PhoneCardCaption title="Spider-Man: Across the Spider-Verse" note="1 h 51 min left" />
      </>,
    );

    expect(screen.getByRole("heading", { name: "Popular movies" })).toBeInTheDocument();
    expect(screen.getByText("Cinemeta")).toBeInTheDocument();
    expect(screen.getByText("Spider-Man: Across the Spider-Verse")).toBeInTheDocument();
    expect(screen.getByText("1 h 51 min left")).toBeInTheDocument();
  });
});

describe("PhoneSeekBar, PhoneTransport, VolumeBox, RemoteMenus, and PhoneSwitchRow", () => {
  it("commits a seek once when the finger lifts and discards cancelled drags", () => {
    const onSeek = vi.fn();
    render(
      <PhoneSeekBar
        position={60}
        duration={200}
        buffered={{ left: 0.1, width: 0.5 }}
        onSeek={onSeek}
      />,
    );

    const slider = screen.getByRole("slider", { name: "Seek" });
    setTrackRect(slider, 0, 200);

    fireEvent.pointerDown(slider, { pointerId: 1, button: 0, clientX: 80 });
    fireEvent.pointerMove(slider, { pointerId: 1, clientX: 120 });
    expect(slider).toHaveAttribute("aria-valuenow", "120");
    expect(onSeek).not.toHaveBeenCalled();

    fireEvent.pointerUp(slider, { pointerId: 1, clientX: 150 });
    expect(onSeek).toHaveBeenCalledOnce();
    expect(onSeek).toHaveBeenCalledWith(150);

    fireEvent.pointerDown(slider, { pointerId: 2, button: 0, clientX: 50 });
    expect(slider).toHaveAttribute("aria-valuenow", "50");
    fireEvent.pointerCancel(slider, { pointerId: 2 });
    expect(slider).toHaveAttribute("aria-valuenow", "60");
    expect(onSeek).toHaveBeenCalledOnce();
  });

  it("commits keyboard seek steps on release and locks when duration is unknown", () => {
    const onSeek = vi.fn();
    const { rerender } = render(
      <PhoneSeekBar position={30} duration={120} onSeek={onSeek} />,
    );

    const slider = screen.getByRole("slider", { name: "Seek" });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(slider).toHaveAttribute("aria-valuenow", "50");
    expect(onSeek).not.toHaveBeenCalled();
    fireEvent.keyUp(slider, { key: "ArrowRight" });
    expect(onSeek).toHaveBeenCalledWith(50);

    rerender(<PhoneSeekBar position={null} duration={null} onSeek={onSeek} />);
    expect(slider).toHaveAttribute("aria-disabled", "true");
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    fireEvent.keyUp(slider, { key: "ArrowRight" });
    expect(onSeek).toHaveBeenCalledOnce();
  });

  it("handles transport controls and disables missing episode steps", () => {
    const onToggle = vi.fn();
    const onBack = vi.fn();
    const onForward = vi.fn();
    const onNext = vi.fn();

    render(
      <PhoneTransport
        playing={false}
        onToggle={onToggle}
        onBack={onBack}
        onForward={onForward}
        onNext={onNext}
      />,
    );

    expect(screen.getByRole("button", { name: "Previous episode" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Back 10 seconds" }));
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    fireEvent.click(screen.getByRole("button", { name: "Forward 10 seconds" }));
    fireEvent.click(screen.getByRole("button", { name: "Next episode" }));

    expect(onBack).toHaveBeenCalledOnce();
    expect(onToggle).toHaveBeenCalledOnce();
    expect(onForward).toHaveBeenCalledOnce();
    expect(onNext).toHaveBeenCalledOnce();
  });

  it("mutes and commits volume changes on pointer release", () => {
    const onCommit = vi.fn();
    const onMute = vi.fn();
    render(
      <VolumeBox level={62} max={100} muted={false} onCommit={onCommit} onMute={onMute} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Mute" }));
    expect(onMute).toHaveBeenCalledWith(true);

    const slider = screen.getByRole("slider", { name: "Volume" });
    setTrackRect(slider, 0, 200);
    fireEvent.pointerDown(slider, { pointerId: 1, button: 0, clientX: 80 });
    expect(slider).toHaveAttribute("aria-valuenow", "40");
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.pointerUp(slider, { pointerId: 1, clientX: 160 });
    expect(onCommit).toHaveBeenCalledWith(80);
  });

  it("lists all seven remote menus, tracks expanded state, and filters when supplied", () => {
    const onOpen = vi.fn();
    const { rerender } = render(<RemoteMenus open="streams" onOpen={onOpen} />);

    const buttons = screen.getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual([
      "Subtitles",
      "Picture",
      "Streams",
      "Episodes",
      "Speed",
      "Chapters",
      "Details",
    ]);
    expect(screen.getByRole("button", { name: "Streams" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("button", { name: "Subtitles" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(onOpen).toHaveBeenCalledWith("details");

    rerender(<RemoteMenus menus={["subtitles", "picture", "streams"]} onOpen={onOpen} />);
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });

  it("toggles PhoneSwitchRow without mutating its own state", () => {
    const onChange = vi.fn();
    render(<PhoneSwitchRow label="Play the next episode" checked onChange={onChange} />);

    const row = screen.getByRole("switch", { name: "Play the next episode" });
    expect(row).toHaveAttribute("aria-checked", "true");
    fireEvent.click(row);
    expect(onChange).toHaveBeenCalledWith(false);
  });
});

describe("BottomSheet and PhoneHeader", () => {
  it("opens, focuses close, dismisses via close or scrim, and unmounts when closed", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <MotionConfig reducedMotion="always">
          <button type="button" onClick={() => setOpen(true)}>
            Open sheet
          </button>
          <BottomSheet
            open={open}
            title="Audio & subtitles"
            testId="remote-sheet"
            onClose={() => setOpen(false)}
          >
            <p>Track options</p>
          </BottomSheet>
        </MotionConfig>
      );
    }

    render(<Harness />);
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open sheet" }));
    const dialog = screen.getByRole("dialog", { name: "Audio & subtitles" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("Track options")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();

    fireEvent.click(screen.getByTestId("remote-sheet-scrim"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Open sheet" }));
    expect(screen.getByRole("dialog", { name: "Audio & subtitles" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("renders PhoneHeader with title, optional subtitle, and Back action", () => {
    const onBack = vi.fn();
    render(<PhoneHeader title="Streams" subtitle="Severance · S2 E3" onBack={onBack} />);

    expect(screen.getByRole("heading", { name: "Streams" })).toBeInTheDocument();
    expect(screen.getByText("Severance · S2 E3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});

describe("PhoneStreamRow, PhoneAddonNotice, PhoneEpisodeRow, PhoneListRow, and PhoneAddonRow", () => {
  it("renders StreamRow, marks the playing stream with PLAYING, and prevents disabled plays", () => {
    const onPlay = vi.fn();
    const { rerender } = render(
      <PhoneStreamRow
        tier="4k"
        quality="4K"
        name="Severance.S02E03"
        details="214 peers · 8.4 GB · ThePirateBay"
        marks={["DOLBY VISION", "ATMOS", "HEVC"]}
        onPlay={onPlay}
      />,
    );

    const row = screen.getByRole("button", { name: /Severance\.S02E03/ });
    expect(row).not.toHaveAttribute("aria-current");
    expect(screen.getByText("ATMOS")).toBeInTheDocument();
    fireEvent.click(row);
    expect(onPlay).toHaveBeenCalledOnce();

    rerender(
      <PhoneStreamRow
        tier="4k"
        quality="4K"
        name="Severance.S02E03"
        marks={["DOLBY VISION", "ATMOS", "HEVC"]}
        playing
        onPlay={onPlay}
      />,
    );
    expect(row).toHaveAttribute("aria-current", "true");
    expect(screen.getByText("PLAYING")).toBeInTheDocument();
    expect(screen.getByText("ATMOS")).toBeInTheDocument();
    expect(screen.getByText("HEVC")).toBeInTheDocument();

    rerender(
      <PhoneStreamRow
        tier="hd"
        quality="1080p"
        name="Severance.S02E03"
        disabled
        onPlay={onPlay}
      />,
    );
    expect(row).toBeDisabled();
    fireEvent.click(row);
    expect(onPlay).toHaveBeenCalledOnce();
  });

  it("renders AddonNotice verbatim and retries when offered", () => {
    const onRetry = vi.fn();
    render(
      <PhoneAddonNotice
        title="MediaFusion did not answer"
        reason="addon_unreachable"
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("MediaFusion did not answer");
    expect(screen.getByRole("status")).toHaveTextContent("addon_unreachable");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("renders EpisodeRow and falls back to the episode code when the still fails", () => {
    const onPress = vi.fn();
    render(
      <PhoneEpisodeRow
        number="E3 · 46 min"
        title="Who Is Alive?"
        date="31 Jan 2025"
        description="Mark, Helly, Irving, and Dylan search for answers."
        still="https://art.test/still.jpg"
        code="S2E3"
        progress={0.38}
        onPress={onPress}
      />,
    );

    const row = screen.getByRole("button", { name: /Who Is Alive\?/ });
    fireEvent.click(row);
    expect(onPress).toHaveBeenCalledOnce();

    const img = document.querySelector("img");
    expect(img).not.toBeNull();
    fireEvent.error(img as HTMLImageElement);
    expect(screen.getByText("S2E3")).toBeInTheDocument();
  });

  it("supports value, switch, and action ListRows", () => {
    const onValue = vi.fn();
    const onToggle = vi.fn();
    const onAction = vi.fn();

    render(
      <>
        <PhoneListRow
          kind="value"
          icon="captions"
          label="Subtitle languages"
          value="Português, English"
          onPress={onValue}
        />
        <PhoneListRow
          kind="switch"
          icon="skip-forward"
          label="Autoplay"
          checked={false}
          onChange={onToggle}
        />
        <PhoneListRow kind="action" icon="plus" label="Español" onPress={onAction} />
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Subtitle languages/ }));
    expect(onValue).toHaveBeenCalledOnce();

    const sw = screen.getByRole("switch", { name: "Autoplay" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    fireEvent.click(sw);
    expect(onToggle).toHaveBeenCalledWith(true);

    fireEvent.click(screen.getByRole("button", { name: "Español" }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("supports AddonRow normal mode (open + enable switch) without URL or OFFLINE", () => {
    const onOpen = vi.fn();
    const onToggle = vi.fn();

    render(
      <PhoneAddonRow
        name="Torrentio"
        summary="Streams · movies, series"
        enabled
        onOpen={onOpen}
        onToggle={onToggle}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Torrentio, Streams · movies, series" }));
    expect(onOpen).toHaveBeenCalledOnce();

    const sw = screen.getByRole("switch", { name: "Use Torrentio" });
    expect(sw).toHaveAttribute("aria-checked", "true");
    fireEvent.click(sw);
    expect(onToggle).toHaveBeenCalledWith(false);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("enforces AddonRow Edit-mode move bounds by keyboard and pointer drag", () => {
    const onRemove = vi.fn();
    const onMove = vi.fn();

    const { rerender } = render(
      <MotionConfig reducedMotion="always">
        <PhoneAddonRow
          editing
          name="Torrentio"
          summary="Streams · movies, series"
          index={0}
          count={3}
          onRemove={onRemove}
          onMove={onMove}
        />
      </MotionConfig>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove Torrentio" }));
    expect(onRemove).toHaveBeenCalledOnce();

    const handle = screen.getByRole("button", { name: "Move Torrentio" });
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(onMove).not.toHaveBeenCalled();
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    expect(onMove).toHaveBeenCalledWith(1);

    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientY: 100 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 360 });
    expect(onMove).toHaveBeenLastCalledWith(2);

    rerender(
      <MotionConfig reducedMotion="always">
        <PhoneAddonRow
          editing
          name="Torrentio"
          summary="Streams · movies, series"
          index={2}
          count={3}
          disabled
          onRemove={onRemove}
          onMove={onMove}
        />
      </MotionConfig>,
    );
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    fireEvent.pointerDown(handle, { pointerId: 2, button: 0, clientY: 200 });
    fireEvent.pointerUp(handle, { pointerId: 2, clientY: 50 });
    expect(onMove).toHaveBeenCalledTimes(2);
  });
});

describe("CodeInput", () => {
  it("normalizes 6-cell entry, fires onComplete at 6 chars, handles backspace and full-code paste", () => {
    const onChange = vi.fn();
    const onComplete = vi.fn();

    function Controlled() {
      const [code, setCode] = useState("K7");
      return (
        <CodeInput
          value={code}
          onChange={(next) => {
            setCode(next);
            onChange(next);
          }}
          onComplete={onComplete}
        />
      );
    }

    render(<Controlled />);
    const input = screen.getByRole("textbox", { name: "Pairing code" });
    expect(input).toHaveValue("K7");

    fireEvent.change(input, { target: { value: "k7q" } });
    expect(onChange).toHaveBeenLastCalledWith("K7Q");
    expect(input).toHaveValue("K7Q");
    expect(onComplete).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "K7" } });
    expect(onChange).toHaveBeenLastCalledWith("K7");
    expect(input).toHaveValue("K7");

    fireEvent.paste(input, {
      clipboardData: {
        getData: () => "k7q-x4m",
      },
    });
    expect(onChange).toHaveBeenLastCalledWith("K7QX4M");
    expect(onComplete).toHaveBeenCalledOnce();
    expect(onComplete).toHaveBeenCalledWith("K7QX4M");
  });

  it("respects disabled", () => {
    const onChange = vi.fn();
    render(<CodeInput value="K7" disabled onChange={onChange} />);

    const input = screen.getByRole("textbox", { name: "Pairing code" });
    expect(input).toBeDisabled();
  });
});
