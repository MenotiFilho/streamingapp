/**
 * Kit B's props contracts (#367, ADR-0032): what a press asks for, what a
 * control announces and when it refuses. Nothing here reads the drawing.
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AddonNotice } from "./AddonNotice";
import { GroupLabel } from "./GroupLabel";
import { Opening } from "./Opening";
import { Panel, PanelColumn } from "./Panel";
import { PlayerControls, type PlayerControlsProps } from "./PlayerControls";
import { PlayerTopBar } from "./PlayerTopBar";
import { SeekBar, type SeekBarProps } from "./SeekBar";
import { SizeStepper } from "./SizeStepper";
import { Spinner } from "./Spinner";
import { StatList, StatRow } from "./StatRow";
import { StillWatchingCard } from "./StillWatchingCard";
import { StreamRow } from "./StreamRow";
import { SyncControl } from "./SyncControl";
import { TrackOption } from "./TrackOption";
import { UpNextCard } from "./UpNextCard";

afterEach(() => {
  vi.restoreAllMocks();
});

const button = (name: string) => screen.getByRole("button", { name });

/** jsdom lays nothing out: give a track the rectangle a browser would. */
function laidOut(element: HTMLElement, left: number, width: number) {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    left,
    width,
    right: left + width,
    top: 0,
    bottom: 32,
    height: 32,
    x: left,
    y: 0,
    toJSON: () => ({}),
  });
}

describe("Panel", () => {
  it("draws nothing while closed, and leaves once closed", async () => {
    const { rerender } = render(
      <Panel open={false} title="Streams">
        rows
      </Panel>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();

    rerender(<Panel title="Streams">rows</Panel>);
    expect(screen.getByRole("dialog", { name: "Streams" })).toBeInTheDocument();

    rerender(
      <Panel open={false} title="Streams">
        rows
      </Panel>,
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("is a side dialog named by its title whose close control asks to leave", () => {
    const onClose = vi.fn();
    render(
      <Panel title="Streams" subtitle="4 from 2 Addons" onClose={onClose} data-region="streams">
        rows
      </Panel>,
    );

    const dialog = screen.getByRole("dialog", { name: "Streams" });
    expect(dialog).toHaveAttribute("data-region", "streams");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("draws no close control where the client gives it nothing to do", () => {
    render(<Panel title="Streams">rows</Panel>);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("floats two named columns", () => {
    render(
      <Panel placement="floating" split aria-label="Audio & Subtitles">
        <PanelColumn title="Subtitles">
          <TrackOption title="Off" />
        </PanelColumn>
        <PanelColumn title="Audio">
          <TrackOption title="English" />
        </PanelColumn>
      </Panel>,
    );

    const dialog = screen.getByRole("dialog", { name: "Audio & Subtitles" });
    const audio = within(dialog).getByRole("group", { name: "Audio" });
    expect(within(audio).getByRole("button", { name: "English" })).toBeInTheDocument();
    expect(within(audio).queryByRole("button", { name: "Off" })).toBeNull();
  });
});

describe("GroupLabel", () => {
  it("heads its list with the Addon's name as it was given", () => {
    render(<GroupLabel>Torrentio</GroupLabel>);
    expect(screen.getByRole("heading", { name: "Torrentio" })).toBeInTheDocument();
  });
});

describe("StreamRow", () => {
  const stream = {
    name: "Severance.S02E03.2160p.ATVP.WEB-DL.DDP5.1.Atmos.DV.H.265",
    tier: "4K",
    peers: "214",
    size: "8.4 GB",
    source: "ThePirateBay",
    marks: ["Dolby Vision", "ATMOS", "HEVC"],
  };

  it("is one focusable control that plays its Stream", () => {
    const onPlay = vi.fn();
    render(<StreamRow {...stream} onPlay={onPlay} />);

    const row = screen.getByRole("button");
    expect(row).toHaveAttribute("data-focusable");
    expect(row).not.toHaveAttribute("aria-current");
    fireEvent.click(row);
    expect(onPlay).toHaveBeenCalledOnce();
  });

  it("carries the Addon's words verbatim and names each detail", () => {
    render(<StreamRow {...stream} />);

    const row = screen.getByRole("button");
    for (const words of [stream.name, "214", "8.4 GB", "ThePirateBay", "Dolby Vision"]) {
      expect(row).toHaveTextContent(words);
    }
    for (const detail of ["Peers", "Size", "Source"]) {
      expect(within(row).getByRole("img", { name: detail })).toBeInTheDocument();
    }
  });

  it("leaves out a detail the Stream does not declare", () => {
    render(<StreamRow name="direct" size="1.8 GB" />);

    expect(screen.queryByRole("img", { name: "Peers" })).toBeNull();
    expect(screen.queryByRole("img", { name: "Source" })).toBeNull();
    expect(screen.getByRole("img", { name: "Size" })).toBeInTheDocument();
  });

  it("announces the Stream playing now, focused or not", () => {
    render(<StreamRow {...stream} playing focused />);

    const row = screen.getByRole("button");
    expect(row).toHaveAttribute("aria-current", "true");
    expect(row).toHaveAttribute("data-focused", "true");
    expect(row).toHaveTextContent("PLAYING");
  });

  it("refuses a press while disabled", () => {
    const onPlay = vi.fn();
    render(<StreamRow {...stream} disabled onPlay={onPlay} />);

    fireEvent.click(screen.getByRole("button"));
    expect(onPlay).not.toHaveBeenCalled();
  });
});

describe("AddonNotice", () => {
  it("says which Addon did not answer, with the Host's reason verbatim", () => {
    render(<AddonNotice addon="MediaFusion" reason="addon_unreachable" />);

    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent("MediaFusion did not answer");
    expect(notice).toHaveTextContent("addon_unreachable");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("asks again, once, and not while the retry is in flight", () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <AddonNotice addon="MediaFusion" reason="addon_unreachable" onRetry={onRetry} />,
    );
    fireEvent.click(button("Try again"));
    expect(onRetry).toHaveBeenCalledOnce();

    rerender(
      <AddonNotice addon="MediaFusion" reason="addon_unreachable" onRetry={onRetry} pending />,
    );
    expect(button("Try again")).toBeDisabled();
    expect(button("Try again")).toHaveAttribute("aria-busy", "true");
  });
});

describe("TrackOption", () => {
  it("announces its choice and asks for it", () => {
    const onSelect = vi.fn();
    render(<TrackOption title="English" detail="In the file · SRT" onSelect={onSelect} />);

    const option = screen.getByRole("button", { name: /English/ });
    expect(option).toHaveAttribute("aria-pressed", "false");
    expect(option).toHaveTextContent("In the file · SRT");
    fireEvent.click(option);
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("keeps chosen and focused apart", () => {
    render(
      <>
        <TrackOption title="Chosen" selected />
        <TrackOption title="Focused" focused />
      </>,
    );

    expect(button("Chosen")).toHaveAttribute("aria-pressed", "true");
    expect(button("Chosen")).not.toHaveAttribute("data-focused");
    expect(button("Focused")).toHaveAttribute("aria-pressed", "false");
    expect(button("Focused")).toHaveAttribute("data-focused", "true");
  });
});

describe("forced focus", () => {
  const noop = () => {};
  const controls = (props: Partial<PlayerControlsProps>) => (
    <PlayerControls
      playing
      volume={50}
      onPlayPause={noop}
      onSeekBy={noop}
      onToggleMute={noop}
      onVolume={noop}
      onMenu={noop}
      onNextEpisode={noop}
      {...props}
    />
  );
  type State = { disabled?: boolean; pending?: boolean };

  it.each<[string, string, (state: State) => ReactElement, State[]]>([
    [
      "a pill button",
      "+0.1 s",
      ({ disabled }) => (
        <SyncControl seconds={0} onChange={noop} focused="later" disabled={disabled} />
      ),
      [{ disabled: true }],
    ],
    [
      "a pending pill button",
      "Next episode",
      ({ pending }) =>
        controls({ focused: "nextEpisode", pending: pending ? ["nextEpisode"] : [] }),
      [{ pending: true }],
    ],
    [
      "a round button",
      "Pause",
      ({ disabled, pending }) =>
        controls({ focused: "playPause", disabled, pending: pending ? ["playPause"] : [] }),
      [{ disabled: true }, { pending: true }],
    ],
    [
      "a Stream row",
      "direct",
      ({ disabled }) => <StreamRow name="direct" focused disabled={disabled} />,
      [{ disabled: true }],
    ],
    [
      "a track option",
      "English",
      (state) => <TrackOption title="English" focused {...state} />,
      [{ disabled: true }, { pending: true }],
    ],
    [
      "the seek bar",
      "Position",
      ({ disabled }) => (
        <SeekBar position={1} duration={10} focused disabled={disabled} onCommit={noop} />
      ),
      [{ disabled: true }],
    ],
    [
      "a seek bar with no length",
      "Position",
      ({ disabled }) => (
        <SeekBar position={1} duration={disabled ? null : 10} focused onCommit={noop} />
      ),
      [{ disabled: true }],
    ],
  ])("is never forced on %s that refuses a press", (_, name, draw, refusals) => {
    const control = () =>
      screen.getByRole(name === "Position" ? "slider" : "button", { name });
    const { rerender } = render(draw({}));
    expect(control()).toHaveAttribute("data-focused", "true");

    for (const state of refusals) {
      rerender(draw(state));
      expect(control(), JSON.stringify(state)).not.toHaveAttribute("data-focused");
    }
  });
});

describe("PlayerTopBar", () => {
  it("names the Title and what the Stream plays, and offers back and close", () => {
    const onBack = vi.fn();
    const onClose = vi.fn();
    render(
      <PlayerTopBar
        title="Severance"
        subtitle="S2 E3 · Who Is Alive?"
        facts={["4K", "DOLBY VISION", "ATMOS"]}
        onBack={onBack}
        onClose={onClose}
      />,
    );

    expect(screen.getByRole("heading", { name: "Severance" })).toBeInTheDocument();
    const facts = within(screen.getByRole("list", { name: "Stream" })).getAllByRole("listitem");
    expect(facts.map((fact) => fact.textContent)).toEqual(["4K", "DOLBY VISION", "ATMOS"]);

    fireEvent.click(button("Back"));
    expect(onBack).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(button("Close"));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("SeekBar", () => {
  const setup = (props: Partial<SeekBarProps> = {}) => {
    const onCommit = vi.fn();
    const onScrub = vi.fn();
    const onPoint = vi.fn();
    const view = render(
      <SeekBar
        position={1072}
        duration={2913}
        onCommit={onCommit}
        onScrub={onScrub}
        onPoint={onPoint}
        {...props}
      />,
    );
    return { ...view, onCommit, onScrub, onPoint, bar: screen.getByRole("slider") };
  };

  it("is a focusable slider that reads the position and both clocks", () => {
    const { bar } = setup();

    expect(bar).toHaveAccessibleName("Position");
    expect(bar).toHaveAttribute("data-focusable");
    expect(bar).toHaveAttribute("aria-valuemax", "2913");
    expect(bar).toHaveAttribute("aria-valuenow", "1072");
    expect(bar).toHaveAttribute("aria-valuetext", "17:52");
    expect(bar).toHaveTextContent("17:52");
    expect(bar).toHaveTextContent("−30:41");
  });

  it("moves the playhead on a key and seeks once, when it is let go", () => {
    const { bar, onScrub, onCommit } = setup();

    // `false`: the bar took the key, so the focus engine leaves it alone.
    expect(fireEvent.keyDown(bar, { key: "ArrowRight" })).toBe(false);
    expect(onScrub).toHaveBeenLastCalledWith(1082);
    expect(bar).toHaveAttribute("aria-valuenow", "1082");
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.keyUp(bar, { key: "ArrowRight" });
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(1082);
    // The Host has not answered yet: the bar shows the Snapshot again.
    expect(bar).toHaveAttribute("aria-valuenow", "1072");
  });

  it("steps a held key at the room's cadence, not the system's", () => {
    const clock = vi.spyOn(performance, "now").mockReturnValue(1000);
    const { bar, onCommit } = setup();
    const repeat = (at: number) => {
      clock.mockReturnValue(at);
      fireEvent.keyDown(bar, { key: "ArrowRight", repeat: true });
    };

    fireEvent.keyDown(bar, { key: "ArrowRight" });
    repeat(1100); // inside the 400ms wait
    repeat(1400); // one step
    repeat(1430); // faster than 160ms
    repeat(1560); // one step
    fireEvent.keyUp(bar, { key: "ArrowRight" });

    expect(onCommit).toHaveBeenCalledExactlyOnceWith(1102);
  });

  it("leaves Up and Down to the focus engine", () => {
    const { bar, onScrub, onCommit } = setup();

    for (const key of ["ArrowUp", "ArrowDown", "Escape"]) {
      expect(fireEvent.keyDown(bar, { key }), key).toBe(true);
      fireEvent.keyUp(bar, { key });
    }
    expect(onScrub).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("seeks where a pointer drag is released", () => {
    const { onScrub, onCommit } = setup({ duration: 3000 });
    const track = screen.getByTestId("mq-seek-track");
    laidOut(track, 100, 1000);

    fireEvent.pointerDown(track, { clientX: 350, button: 0, pointerId: 1 });
    expect(onScrub).toHaveBeenLastCalledWith(750);
    fireEvent.pointerMove(track, { clientX: 600, pointerId: 1 });
    expect(onScrub).toHaveBeenLastCalledWith(1500);
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.pointerUp(track, { clientX: 850, pointerId: 1 });
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(2250);
  });

  it("asks for nothing after a cancelled drag or a secondary button", () => {
    const { onCommit, onScrub } = setup({ duration: 3000 });
    const track = screen.getByTestId("mq-seek-track");
    laidOut(track, 100, 1000);

    fireEvent.pointerDown(track, { clientX: 350, button: 2, pointerId: 1 });
    expect(onScrub).not.toHaveBeenCalled();

    fireEvent.pointerDown(track, { clientX: 350, button: 0, pointerId: 1 });
    fireEvent.pointerCancel(track, { pointerId: 1 });
    fireEvent.pointerUp(track, { clientX: 350, pointerId: 1 });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("names the moment under the pointer for its preview, and lets it go", () => {
    const { onPoint, onCommit } = setup({ duration: 3000 });
    const track = screen.getByTestId("mq-seek-track");
    laidOut(track, 100, 1000);
    expect(onPoint).not.toHaveBeenCalled();
    expect(screen.queryByTestId("mq-seek-preview")).toBeNull();

    fireEvent.pointerMove(track, { clientX: 200 });
    expect(onPoint).toHaveBeenLastCalledWith(300);
    expect(screen.getByTestId("mq-seek-preview")).toHaveTextContent("5:00");

    fireEvent.pointerLeave(track);
    expect(onPoint).toHaveBeenLastCalledWith(null);
    expect(screen.queryByTestId("mq-seek-preview")).toBeNull();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("previews the playhead while focused, with the Chapter where there is no still", () => {
    const { onPoint, rerender, onCommit } = setup({ focused: true, chapterName: "Outie" });

    expect(onPoint).toHaveBeenLastCalledWith(1072);
    expect(screen.getByTestId("mq-seek-preview")).toHaveTextContent("17:52 · Outie");
    expect(screen.queryByRole("presentation")).toBeNull();

    rerender(
      <SeekBar
        position={1072}
        duration={2913}
        focused
        chapterName="Outie"
        still="data:image/png;base64,AA=="
        onCommit={onCommit}
      />,
    );
    const preview = screen.getByTestId("mq-seek-preview");
    expect(preview).toHaveTextContent("17:52");
    expect(preview).not.toHaveTextContent("Outie");
    expect(within(preview).getByRole("presentation")).toHaveAttribute(
      "src",
      "data:image/png;base64,AA==",
    );
  });

  it.each([
    ["a Stream with no length", { duration: null }],
    ["a disabled bar", { disabled: true }],
  ])("takes no seek and no focus for %s", (_, props) => {
    const { bar, onCommit } = setup(props);
    const track = screen.getByTestId("mq-seek-track");
    laidOut(track, 100, 1000);

    expect(bar).toHaveAttribute("aria-disabled", "true");
    expect(bar).not.toHaveAttribute("data-focusable");
    fireEvent.keyDown(bar, { key: "ArrowRight" });
    fireEvent.keyUp(bar, { key: "ArrowRight" });
    fireEvent.pointerDown(track, { clientX: 350, button: 0 });
    fireEvent.pointerUp(track, { clientX: 350 });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("does not re-fire onPoint when only the callback identity changes", () => {
    const first = vi.fn();
    const second = vi.fn();
    const onCommit = vi.fn();
    const { rerender } = render(
      <SeekBar position={1072} duration={2913} focused onPoint={first} onCommit={onCommit} />,
    );
    expect(first).toHaveBeenCalledTimes(1);

    rerender(
      <SeekBar position={1072} duration={2913} focused onPoint={second} onCommit={onCommit} />,
    );
    expect(second).not.toHaveBeenCalled();
  });
});

describe("PlayerControls", () => {
  const setup = (props: Partial<PlayerControlsProps> = {}) => {
    const handlers = {
      onPlayPause: vi.fn(),
      onSeekBy: vi.fn(),
      onToggleMute: vi.fn(),
      onVolume: vi.fn(),
      onNextEpisode: vi.fn(),
      onMenu: vi.fn(),
    };
    render(<PlayerControls playing volume={91} {...handlers} {...props} />);
    return handlers;
  };

  it("asks for the transport it draws", () => {
    const handlers = setup();

    fireEvent.click(button("Pause"));
    fireEvent.click(button("Back ten seconds"));
    fireEvent.click(button("Forward ten seconds"));
    fireEvent.click(button("Next episode"));
    fireEvent.click(button("Mute"));

    expect(handlers.onPlayPause).toHaveBeenCalledOnce();
    expect(handlers.onSeekBy.mock.calls).toEqual([[-10], [10]]);
    expect(handlers.onNextEpisode).toHaveBeenCalledOnce();
    expect(handlers.onToggleMute).toHaveBeenCalledOnce();
  });

  it("offers Play while paused", () => {
    setup({ playing: false });
    expect(button("Play")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
  });

  it("has no Previous episode and no Stop", () => {
    setup();
    expect(screen.queryByRole("button", { name: /previous|stop/i })).toBeNull();
  });

  it("draws Next episode only where there is one to step to", () => {
    setup({ onNextEpisode: undefined });
    expect(screen.queryByRole("button", { name: "Next episode" })).toBeNull();
  });

  it("opens the menu pressed and says which one is up", () => {
    const handlers = setup({ openMenu: "speed" });

    expect(button("Speed")).toHaveAttribute("aria-expanded", "true");
    expect(button("Chapters")).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button("Audio & Subtitles"));
    expect(handlers.onMenu).toHaveBeenCalledExactlyOnceWith("audio-subtitles");
  });

  it("draws only the menus this Stream has", () => {
    setup({ menus: ["picture", "details"] });
    expect(button("Picture")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Episodes" })).toBeNull();
  });

  it("treats Full screen as a toggle rather than a menu", () => {
    const handlers = setup({ fullscreen: true });
    const toggle = button("Exit full screen");

    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(toggle).not.toHaveAttribute("aria-expanded");
    fireEvent.click(toggle);
    expect(handlers.onMenu).toHaveBeenCalledExactlyOnceWith("fullscreen");
  });

  it("refuses the transport while the Stream takes none, and a pending control", () => {
    const handlers = setup({ disabled: true, pending: ["nextEpisode"] });

    for (const name of ["Pause", "Back ten seconds", "Forward ten seconds", "Next episode"]) {
      fireEvent.click(button(name));
      expect(button(name), name).toBeDisabled();
    }
    expect(handlers.onPlayPause).not.toHaveBeenCalled();
    expect(handlers.onSeekBy).not.toHaveBeenCalled();
    expect(handlers.onNextEpisode).not.toHaveBeenCalled();
    expect(button("Next episode")).toHaveAttribute("aria-busy", "true");
  });

  it("sends one volume when a key is let go, and leaves the arrows to focus", () => {
    const handlers = setup();
    const level = screen.getByRole("slider", { name: "Volume" });
    expect(level).toHaveAttribute("aria-valuemax", "130");
    expect(level).toHaveAttribute("aria-valuenow", "91");

    expect(fireEvent.keyDown(level, { key: "ArrowRight" })).toBe(true);
    fireEvent.keyDown(level, { key: "PageUp" });
    fireEvent.keyDown(level, { key: "PageUp" });
    expect(handlers.onVolume).not.toHaveBeenCalled();
    fireEvent.keyUp(level, { key: "PageUp" });
    expect(handlers.onVolume).toHaveBeenCalledExactlyOnceWith(101);
  });

  it("sends the volume a pointer drag is released on", () => {
    const handlers = setup();
    const level = screen.getByRole("slider", { name: "Volume" });
    laidOut(level, 100, 160);

    fireEvent.pointerDown(level, { clientX: 140, button: 0, pointerId: 1 });
    fireEvent.pointerMove(level, { clientX: 180, pointerId: 1 });
    expect(handlers.onVolume).not.toHaveBeenCalled();
    fireEvent.pointerUp(level, { clientX: 180, pointerId: 1 });
    expect(handlers.onVolume).toHaveBeenCalledExactlyOnceWith(65);
  });

  it("says it is muted", () => {
    setup({ muted: true });
    expect(button("Unmute")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("slider", { name: "Volume" })).toHaveAttribute(
      "aria-valuetext",
      "Muted, 91%",
    );
  });
});

describe("UpNextCard", () => {
  it("counts down to the episode it names, and takes both answers", () => {
    const onPlayNow = vi.fn();
    const onCancel = vi.fn();
    render(
      <UpNextCard
        episode="S2 E4"
        name="Woe’s Hollow"
        secondsLeft={8}
        fraction={0.6}
        onPlayNow={onPlayNow}
        onCancel={onCancel}
      />,
    );

    const card = screen.getByRole("group", { name: "Up next: S2 E4 · Woe’s Hollow" });
    expect(card).toHaveTextContent("Up next in 8");
    fireEvent.click(button("Play now"));
    fireEvent.click(button("Cancel"));
    expect(onPlayNow).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("names the episode alone where it has no name", () => {
    render(
      <UpNextCard
        episode="S2 E4"
        secondsLeft={1}
        fraction={0}
        pending
        onPlayNow={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(screen.getByRole("heading", { name: "S2 E4" })).toBeInTheDocument();
    expect(button("Play now")).toBeDisabled();
    expect(button("Cancel")).toBeEnabled();
  });
});

describe("StillWatchingCard", () => {
  it("holds on Keep watching or Stop, naming what comes next", () => {
    const onKeepWatching = vi.fn();
    const onStop = vi.fn();
    render(
      <StillWatchingCard
        next="S2 E5 · Trojan’s Horse"
        onKeepWatching={onKeepWatching}
        onStop={onStop}
      />,
    );

    const card = screen.getByRole("group", { name: "Still watching?" });
    expect(card).toHaveTextContent("Next: S2 E5 · Trojan’s Horse");
    fireEvent.click(button("Keep watching"));
    expect(onKeepWatching).toHaveBeenCalledOnce();
    expect(onStop).not.toHaveBeenCalled();
    fireEvent.click(button("Stop"));
    expect(onStop).toHaveBeenCalledOnce();
  });
});

describe("Spinner", () => {
  it("says the Stream is waiting", () => {
    render(<Spinner />);
    expect(screen.getByRole("status", { name: "Waiting for the Stream…" })).toBeInTheDocument();
  });
});

describe("StatRow", () => {
  it("pairs each statistic with its value", () => {
    render(
      <StatList label="Playback">
        <StatRow label="Bitrate" value="38.4 Mb/s" />
      </StatList>,
    );

    expect(screen.getByRole("term")).toHaveTextContent("Bitrate");
    expect(screen.getByRole("definition")).toHaveTextContent("38.4 Mb/s");
  });
});

describe("SizeStepper", () => {
  it("reads the size and asks for one step either way", () => {
    const onChange = vi.fn();
    render(<SizeStepper scale={1.15} onChange={onChange} />);

    expect(screen.getByRole("status")).toHaveTextContent("115%");
    fireEvent.click(button("Smaller"));
    fireEvent.click(button("Larger"));
    expect(onChange.mock.calls).toEqual([[1.1], [1.2]]);
  });

  it("exposes a slider with ARIA bounds and steps 5% on Left/Right", () => {
    const onChange = vi.fn();
    const { rerender } = render(<SizeStepper scale={1.15} onChange={onChange} />);
    const slider = screen.getByRole("slider", { name: "Subtitle size" });

    expect(slider).toHaveAttribute("data-focusable");
    expect(slider).toHaveAttribute("aria-valuemin", "25");
    expect(slider).toHaveAttribute("aria-valuemax", "300");
    expect(slider).toHaveAttribute("aria-valuenow", "115");
    expect(slider).toHaveAttribute("aria-valuetext", "115%");

    // ArrowLeft/Right claim the key (`false`) and commit one step each.
    expect(fireEvent.keyDown(slider, { key: "ArrowLeft" })).toBe(false);
    expect(fireEvent.keyDown(slider, { key: "ArrowRight" })).toBe(false);
    expect(onChange.mock.calls).toEqual([[1.1], [1.2]]);

    // Up/Down remain free for spatial navigation.
    expect(fireEvent.keyDown(slider, { key: "ArrowUp" })).toBe(true);
    expect(fireEvent.keyDown(slider, { key: "ArrowDown" })).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(2);

    // At the ends, keys do not fire past 25% or 300%.
    onChange.mockClear();
    rerender(<SizeStepper scale={0.25} onChange={onChange} />);
    expect(fireEvent.keyDown(slider, { key: "ArrowLeft" })).toBe(false);
    expect(onChange).not.toHaveBeenCalled();

    rerender(<SizeStepper scale={3} onChange={onChange} />);
    expect(fireEvent.keyDown(slider, { key: "ArrowRight" })).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("previews locally while dragging and commits one snapped scale on release", () => {
    const onChange = vi.fn();
    render(<SizeStepper scale={1} onChange={onChange} />);
    const slider = screen.getByRole("slider", { name: "Subtitle size" });
    laidOut(slider, 100, 200);
    const capture = vi.fn();
    slider.setPointerCapture = capture;

    // 50% along the track -> 162.5% -> snaps to 165% (1.65).
    fireEvent.pointerDown(slider, { clientX: 200, button: 0, pointerId: 3 });
    expect(capture).toHaveBeenCalledWith(3);
    expect(onChange).not.toHaveBeenCalled();
    expect(slider).toHaveAttribute("aria-valuenow", "165");
    expect(slider).toHaveAttribute("aria-valuetext", "165%");
    expect(screen.getByRole("status")).toHaveTextContent("165%");

    // Dragging further updates locally with no Action yet.
    fireEvent.pointerMove(slider, { clientX: 250, pointerId: 3 });
    expect(onChange).not.toHaveBeenCalled();
    expect(slider).toHaveAttribute("aria-valuenow", "230");
    expect(screen.getByRole("status")).toHaveTextContent("230%");

    // Releasing commits once with the snapped scale, then reverts to props until Host answers.
    fireEvent.pointerUp(slider, { clientX: 260, pointerId: 3 });
    expect(onChange).toHaveBeenCalledExactlyOnceWith(2.45);
    expect(slider).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getByRole("status")).toHaveTextContent("100%");
  });

  it("commits once on a plain track press and ignores cancelled or disabled drags", () => {
    const onChange = vi.fn();
    const { rerender } = render(<SizeStepper scale={1} onChange={onChange} />);
    const slider = screen.getByRole("slider", { name: "Subtitle size" });
    laidOut(slider, 100, 200);

    fireEvent.pointerDown(slider, { clientX: 100, button: 0, pointerId: 1 });
    fireEvent.pointerUp(slider, { clientX: 100, pointerId: 1 });
    expect(onChange).toHaveBeenCalledExactlyOnceWith(0.25);

    onChange.mockClear();
    fireEvent.pointerDown(slider, { clientX: 200, button: 2, pointerId: 1 });
    fireEvent.pointerUp(slider, { clientX: 200, pointerId: 1 });
    fireEvent.pointerDown(slider, { clientX: 200, button: 0, pointerId: 1 });
    fireEvent.pointerCancel(slider, { pointerId: 1 });
    fireEvent.pointerUp(slider, { clientX: 200, pointerId: 1 });
    expect(onChange).not.toHaveBeenCalled();

    rerender(<SizeStepper scale={1} disabled onChange={onChange} />);
    expect(slider).toHaveAttribute("aria-disabled", "true");
    expect(slider).not.toHaveAttribute("data-focusable");
    fireEvent.pointerDown(slider, { clientX: 300, button: 0, pointerId: 1 });
    fireEvent.pointerUp(slider, { clientX: 300, pointerId: 1 });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(onChange).not.toHaveBeenCalled();

    rerender(<SizeStepper scale={1} pending onChange={onChange} />);
    expect(slider).toHaveAttribute("aria-disabled", "true");
    expect(slider).toHaveAttribute("aria-busy", "true");
    fireEvent.pointerDown(slider, { clientX: 300, button: 0, pointerId: 1 });
    fireEvent.pointerUp(slider, { clientX: 300, pointerId: 1 });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each([
    [0.25, "Smaller", "Larger", "25%"],
    [3, "Larger", "Smaller", "300%"],
  ])("disables the step past %s", (scale, spent, open, readout) => {
    const onChange = vi.fn();
    render(<SizeStepper scale={scale} onChange={onChange} />);

    expect(screen.getByRole("status")).toHaveTextContent(readout);
    expect(button(spent)).toBeDisabled();
    expect(button(open)).toBeEnabled();
    fireEvent.click(button(spent));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("SyncControl", () => {
  it.each([
    [0, "0.0 s"],
    [0.2, "+0.2 s"],
    [-0.2, "−0.2 s"],
    [0.30000000000000004, "+0.3 s"],
  ])("reads a delay of %s as %s", (seconds, readout) => {
    render(<SyncControl seconds={seconds} onChange={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent(readout);
  });

  it("asks for a tenth either way, and zero on Reset", () => {
    const onChange = vi.fn();
    render(<SyncControl seconds={0.2} onChange={onChange} />);

    fireEvent.click(button("−0.1 s"));
    fireEvent.click(button("+0.1 s"));
    fireEvent.click(button("Reset"));
    expect(onChange.mock.calls).toEqual([[0.1], [0.3], [0]]);
  });
});

describe("Opening", () => {
  it("fills the logo where the Title has one, and says what it is waiting on", () => {
    render(
      <Opening
        title="Severance"
        logo="logo.png"
        phase="finding"
        detail="Finding the torrent"
      />,
    );

    const opening = screen.getByRole("status", { name: "Severance. Finding the torrent" });
    expect(opening).toHaveAttribute("data-variant", "logo");
    expect(opening).toHaveAttribute("data-phase", "finding");
    expect(opening).not.toHaveAttribute("aria-valuenow");
  });

  it("falls back to the name when the logo is missing or fails to load", () => {
    const { rerender, container } = render(<Opening title="Severance" phase="opening" />);
    const opening = screen.getByRole("status", { name: "Severance" });
    expect(opening).toHaveAttribute("data-variant", "text");
    expect(opening).toHaveTextContent("Severance");

    rerender(<Opening title="Severance" logo="gone.png" phase="opening" />);
    expect(opening).toHaveAttribute("data-variant", "logo");
    fireEvent.error(container.querySelector("img")!);
    expect(opening).toHaveAttribute("data-variant", "text");

    // Another logo gets its own try.
    rerender(<Opening title="Severance" logo="other.png" phase="opening" />);
    expect(opening).toHaveAttribute("data-variant", "logo");
  });
});
