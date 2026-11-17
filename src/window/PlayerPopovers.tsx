import { useEffect, useRef, useState, type ReactNode } from "react";
import { useIsPresent } from "motion/react";

import {
  audioSection,
  chaptersSection,
  pictureSections,
  speedSection,
  STATISTICS_TOGGLE_KEY,
  subtitleSections,
  type PanelGroup,
  type PanelRow,
} from "../core/playerPanels";
import type { Action, PlaybackSnapshot } from "../core/wire";
import { useShell, type NewShellLevel } from "./context";
import { MenuGroup, MenuReadout, MenuRow } from "../kit/Menu";
import { Popover } from "../kit/Popover";
import { OsdEpisodesMenu } from "./PlayerEpisodes";
import { PROTO, useAutoplayProto } from "../prototype/autoplay287";
import { PlaybackGroup } from "../prototype/autoplay287.window";

/** The six menus the OSD's icon buttons open, one level each. */
export type OsdPopoverName =
  | "picture"
  | "subtitles"
  | "audio"
  | "episodes"
  | "speed"
  | "chapters";

/** The id the shell's level stack and the OSD's icons both name a popover by. */
export function osdPopoverId(name: OsdPopoverName): string {
  return `popover-${name}`;
}

/** Where the pressed icon sits, so its menu opens above that icon rather than the edge. */
export type OsdPopoverAnchor = { left: number; right: number };

type MenuProps = {
  playback: PlaybackSnapshot;
  take: (action: Action) => Promise<unknown>;
};

/** The Subtitles menu alone needs the size the Host draws subtitles at. */
type SubtitlesMenuProps = MenuProps & { subtitleScale: number };

const LABELS: Record<OsdPopoverName, string> = {
  picture: "Picture",
  subtitles: "Subtitles",
  audio: "Audio",
  episodes: "Episodes",
  speed: "Speed",
  chapters: "Chapters",
};

// "Picture" is the control's name in the port contract; its visible heading
// says what the menu actually contains, because CONTEXT's **Picture** is where
// the Player draws, not a setting.
const HEADINGS: Record<OsdPopoverName, string> = {
  picture: "Aspect, crop & statistics",
  subtitles: "Subtitles",
  audio: "Audio",
  episodes: "Episodes",
  speed: "Speed",
  chapters: "Chapters",
};

const SIDES: Record<OsdPopoverName, "start" | "end"> = {
  picture: "start",
  subtitles: "start",
  audio: "start",
  episodes: "end",
  speed: "end",
  chapters: "end",
};

const MENUS: Record<
  Exclude<OsdPopoverName, "subtitles" | "episodes">,
  (props: MenuProps) => ReactNode
> = {
  picture: (props) => <PictureMenu {...props} />,
  audio: (props) => <AudioMenu {...props} />,
  speed: (props) => <SpeedMenu {...props} />,
  chapters: (props) => <ChaptersMenu {...props} />,
};

/**
 * One OSD popover, as the level the shell pushes when its icon is pressed.
 *
 * `popover-${name}` is its id, so a second press of the same icon replaces the
 * level rather than stacking a copy; the shell's own Back pops it and restores
 * the icon's focus. The popover reads the Snapshot when it draws, so every
 * selection is the Host's answer and never a copy this client kept.
 */
export function osdPopoverLevel(
  name: OsdPopoverName,
  anchor: OsdPopoverAnchor,
): NewShellLevel {
  return {
    id: osdPopoverId(name),
    name: `${LABELS[name]} popover`,
    kind: "popover",
    payload: {
      render: () => <OsdPopover name={name} anchor={anchor} />,
    },
  };
}

/** The panel's width and the window's margin: enough to keep it on screen. */
const PANEL_WIDTH = 352;
const VIEWPORT_MARGIN = 16;

function anchorStyle(side: "start" | "end", anchor: OsdPopoverAnchor) {
  const widest = Math.max(VIEWPORT_MARGIN, window.innerWidth - PANEL_WIDTH - VIEWPORT_MARGIN);
  const offset =
    side === "start"
      ? Math.min(Math.max(anchor.left, VIEWPORT_MARGIN), widest)
      : Math.min(Math.max(window.innerWidth - anchor.right, VIEWPORT_MARGIN), widest);

  return side === "start" ? { left: offset, right: "auto" } : { left: "auto", right: offset };
}

function OsdPopover({ name, anchor }: { name: OsdPopoverName; anchor: OsdPopoverAnchor }) {
  const { snapshot, take, pop, levelExists } = useShell();
  const panel = useRef<HTMLDivElement | null>(null);
  const playback = snapshot?.playback ?? null;
  const subtitleScale = snapshot?.preferences.subtitleScale ?? 1;
  const id = osdPopoverId(name);

  // A menu is a thing a person opened in passing: clicking anywhere outside it,
  // tabbing out of it, or leaving the window closes it rather than making them
  // find Back before they can touch the player again. The scrim catches the
  // pointer; focusin catches the keyboard and a pad's focus moves.
  //
  // A menu that has already been popped does not close itself again: its exit
  // moves focus back to the OSD, and that move is not a press outside the
  // panel.
  const present = useIsPresent();
  useEffect(() => {
    if (!present) {
      return;
    }
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      const current = panel.current;
      // A menu that has been popped is no longer a menu: its exit moves focus
      // to the surface beneath, and that move is not a press outside an open
      // plate. Checking the stack (rather than waiting for this level's cleanup
      // or its inert mark) also stops an Episodes press from closing the
      // Streams level it just opened.
      if (!current || !levelExists(id)) {
        return;
      }
      if (target instanceof Node && !current.contains(target)) {
        pop();
      }
    };
    const onBlur = () => {
      if (levelExists(id)) {
        pop();
      }
    };

    document.addEventListener("focusin", onFocusIn, true);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("focusin", onFocusIn, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [id, levelExists, pop, present]);

  if (!playback) {
    return null;
  }

  const side = SIDES[name];

  return (
    <div className="shell-osd-popover-layer">
      <div
        className="shell-osd-popover-scrim"
        data-testid="popover-scrim"
        aria-hidden="true"
        onClick={pop}
      />
      <div
        ref={panel}
        className="shell-osd-popover rep-osd-popover"
        data-side={side}
        style={anchorStyle(side, anchor)}
      >
        <Popover
          label={LABELS[name]}
          heading={PROTO && name === "speed" && window.location.search.includes("variant=C") ? "Playback" : HEADINGS[name]}
          align={side}
          testId={osdPopoverId(name)}
        >
          {name === "subtitles" ? (
            <SubtitlesMenu playback={playback} subtitleScale={subtitleScale} take={take} />
          ) : name === "episodes" ? (
            <OsdEpisodesMenu playback={playback} />
          ) : (
            MENUS[name]({ playback, take })
          )}
        </Popover>
      </div>
    </div>
  );
}

/** Render the shared sections as this client's groups and rows. */
function Sections({
  groups,
  onPress,
}: {
  groups: PanelGroup[];
  onPress: (row: PanelRow) => void;
}) {
  return (
    <>
      {groups.map((group, index) => (
        // The group's place is its identity: a delay group's title carries the
        // value in force, and keying by it would remount the row a press left
        // focus on.
        <MenuGroup key={index} title={group.title}>
          {group.rows.map((row) => (
            <Row key={row.key} row={row} onPress={onPress} />
          ))}
        </MenuGroup>
      ))}
    </>
  );
}

function Row({ row, onPress }: { row: PanelRow; onPress: (row: PanelRow) => void }) {
  if (row.kind === "note") {
    return (
      <p className="rep-kit-menu-note" data-testid={row.key}>
        {row.text}
      </p>
    );
  }

  if (row.kind === "readout") {
    return (
      <MenuReadout testId={row.key} label={row.label} value={row.value} lines={row.lines} />
    );
  }

  return (
    <MenuRow
      testId={row.key}
      label={row.label}
      pressed={row.pressed}
      marks={row.kind === "choice" ? row.marks : undefined}
      disabled={row.disabled}
      onPress={() => onPress(row)}
    >
      {row.text ?? row.label}
    </MenuRow>
  );
}

/** Send the row's one Action, where it has one. */
function send(take: MenuProps["take"], row: PanelRow): void {
  if (row.kind === "choice" || row.kind === "action") {
    if (row.action) {
      void take(row.action);
    }
  }
}

/** Aspect, the crop choices, the Autocrop toggle, and statistics. */
function PictureMenu({ playback, take }: MenuProps) {
  const [showStatistics, setShowStatistics] = useState(false);

  return (
    <Sections
      groups={pictureSections(playback, showStatistics)}
      onPress={(row) => {
        if (row.key === STATISTICS_TOGGLE_KEY) {
          setShowStatistics((shown) => !shown);
          return;
        }
        send(take, row);
      }}
    />
  );
}

/** Subtitle tracks embedded-first, subtitles off, the delay's tenth-of-a-second steps, and the size. */
function SubtitlesMenu({ playback, subtitleScale, take }: SubtitlesMenuProps) {
  return <Sections groups={subtitleSections(playback, subtitleScale)} onPress={(row) => send(take, row)} />;
}

/** The Stream's audio tracks, embedded-first. */
function AudioMenu({ playback, take }: MenuProps) {
  return <Sections groups={[audioSection(playback)]} onPress={(row) => send(take, row)} />;
}

/** The rates a person can pick, with the one in force marked. */
function SpeedMenu({ playback, take }: MenuProps) {
  const auto = useAutoplayProto();
  return (
    <>
      {PROTO && auto.variant === "C" && playback.episode ? <PlaybackGroup auto={auto} /> : null}
      <Sections groups={[speedSection(playback)]} onPress={(row) => send(take, row)} />
    </>
  );
}

/**
 * The container's chapters, in its own order. Choosing one is `set_chapter`;
 * the window deliberately draws no step buttons here (#50, #57), so the section
 * builder's Previous/Next rows are filtered out by this client alone.
 */
function ChaptersMenu({ playback, take }: MenuProps) {
  const section = chaptersSection(playback);
  const groups: PanelGroup[] = [
    {
      ...section,
      rows: section.rows.filter(
        (row) =>
          !(
            row.kind === "action" &&
            (row.action?.type === "previous_chapter" || row.action?.type === "next_chapter")
          ),
      ),
    },
  ];

  return <Sections groups={groups} onPress={(row) => send(take, row)} />;
}
