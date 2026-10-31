import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { useIsPresent } from "motion/react";

import {
  ASPECTS,
  DELAY_STEP,
  SPEEDS,
  aspectSelected,
  chapterLabel,
  cropChoices,
  cropSelected,
  formatDelay,
  formatScale,
  formatSpeed,
  orderedTracks,
  speedSelected,
  statisticsLines,
  stepDelay,
  stepScale,
  subtitlesOn,
  trackLabel,
  trackMarks,
} from "../core/controls";
import type { Action, PlaybackSnapshot, Track } from "../core/wire";
import { useShell, type NewShellLevel } from "./context";
import { Popover } from "../kit/Popover";

/** The five menus the OSD's icon buttons open, one level each. */
export type OsdPopoverName = "picture" | "subtitles" | "audio" | "speed" | "chapters";

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
  speed: "Speed",
  chapters: "Chapters",
};

const SIDES: Record<OsdPopoverName, "start" | "end"> = {
  picture: "start",
  subtitles: "start",
  audio: "start",
  speed: "end",
  chapters: "end",
};

const MENUS: Record<Exclude<OsdPopoverName, "subtitles">, (props: MenuProps) => ReactNode> = {
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
  const { snapshot, take, pop } = useShell();
  const panel = useRef<HTMLDivElement | null>(null);
  const playback = snapshot?.playback ?? null;
  const subtitleScale = snapshot?.preferences.subtitleScale ?? 1;

  // A menu is a thing a person opened in passing: clicking anywhere outside it,
  // tabbing out of it, or leaving the window closes it rather than making them
  // find Back before they can touch the player again. The scrim catches the
  // pointer; focusin catches the keyboard and a pad's focus moves.
  //
  // A menu that is already leaving does not close itself again: its level is
  // inert the moment its exit starts, and the focus moving back to the OSD is
  // that exit, not a press outside the panel.
  const present = useIsPresent();
  useEffect(() => {
    if (!present) {
      return;
    }
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (target instanceof Node && panel.current && !panel.current.contains(target)) {
        pop();
      }
    };
    const onBlur = () => pop();

    document.addEventListener("focusin", onFocusIn, true);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("focusin", onFocusIn, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [pop, present]);

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
          heading={HEADINGS[name]}
          align={side}
          testId={osdPopoverId(name)}
        >
          {name === "subtitles" ? (
            <SubtitlesMenu playback={playback} subtitleScale={subtitleScale} take={take} />
          ) : (
            MENUS[name]({ playback, take })
          )}
        </Popover>
      </div>
    </div>
  );
}

/** Aspect, the crop choices, the Autocrop toggle, and statistics. */
function PictureMenu({ playback, take }: MenuProps) {
  const [showStatistics, setShowStatistics] = useState(false);
  const crop = playback.crop;

  return (
    <>
      <Group title="Aspect">
        {ASPECTS.map(({ label, aspect }) => (
          <Item
            key={label}
            testId={`aspect-${label}`}
            pressed={aspectSelected(playback.aspect, aspect)}
            onClick={() => void take({ type: "set_aspect", aspect })}
          >
            {label}
          </Item>
        ))}
      </Group>

      <Group title="Crop">
        {cropChoices(playback.resolution).map(({ label, crop: choice }) => (
          <Item
            key={label}
            testId={`crop-${label}`}
            pressed={cropSelected(crop, choice)}
            onClick={() => void take({ type: "set_crop", crop: choice })}
          >
            {label}
          </Item>
        ))}
        <Item testId="autocrop" onClick={() => void take({ type: "autocrop" })}>
          {crop ? "Restore full frame" : "Autocrop"}
        </Item>
        <p className="shell-osd-readout tabular" data-testid="osd-crop-readout">
          {crop
            ? `Autocrop keeps ${crop.width}×${crop.height}+${crop.x}+${crop.y}.`
            : "Autocrop keeps the whole frame."}
        </p>
      </Group>

      <Group title="Statistics">
        <Item
          testId="toggle-statistics"
          pressed={showStatistics}
          onClick={() => setShowStatistics((shown) => !shown)}
        >
          {showStatistics ? "Hide statistics" : "Show statistics"}
        </Item>
        {showStatistics ? (
          <dl className="shell-osd-statistics" data-testid="statistics">
            {statisticsLines(playback.statistics).map(({ label, value }) => (
              <Fragment key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </Fragment>
            ))}
          </dl>
        ) : null}
      </Group>
    </>
  );
}

/** Subtitle tracks embedded-first, subtitles off, the delay's tenth-of-a-second steps, and the size. */
function SubtitlesMenu({ playback, subtitleScale, take }: SubtitlesMenuProps) {
  const tracks = orderedTracks(playback.tracks, "subtitle");
  const delay = playback.subtitleDelay ?? 0;

  return (
    <>
      <Group title="Tracks">
        {tracks.length === 0 ? (
          <p className="shell-osd-note">This Stream carries no subtitle track to pick.</p>
        ) : null}
        {tracks.map((track) => (
          <TrackItem key={track.id} track={track} onTake={take} />
        ))}
        <Item
          testId="subtitles-off"
          pressed={!subtitlesOn(playback.tracks)}
          onClick={() => void take({ type: "set_subtitle_track", track: null })}
        >
          Subtitles off
        </Item>
      </Group>

      <Group title={`Delay · ${formatDelay(delay)}`}>
        <p className="shell-osd-readout tabular" data-testid="subtitle-delay">
          {formatDelay(delay)}
        </p>
        <div className="shell-osd-delay">
          <Item
            testId="delay-back"
            onClick={() =>
              void take({
                type: "set_subtitle_delay",
                seconds: stepDelay(delay, -DELAY_STEP),
              })
            }
          >
            −0.1 s
          </Item>
          <Item
            testId="delay-forward"
            onClick={() =>
              void take({
                type: "set_subtitle_delay",
                seconds: stepDelay(delay, DELAY_STEP),
              })
            }
          >
            +0.1 s
          </Item>
          <Item
            testId="delay-reset"
            pressed={delay === 0}
            onClick={() => void take({ type: "set_subtitle_delay", seconds: 0 })}
          >
            Reset
          </Item>
        </div>
      </Group>

      <Group title="Size">
        <p
          className="shell-osd-readout tabular"
          data-testid="subtitle-scale"
          aria-label={`Subtitle size ${formatScale(subtitleScale)}`}
        >
          {`Subtitle size ${formatScale(subtitleScale)}`}
        </p>
        <div className="shell-osd-delay">
          <Item
            testId="subtitle-scale-down"
            label="Smaller subtitles"
            onClick={() =>
              void take({
                type: "set_subtitle_scale",
                scale: stepScale(subtitleScale, -1),
              })
            }
          >
            −
          </Item>
          <Item
            testId="subtitle-scale-up"
            label="Larger subtitles"
            onClick={() =>
              void take({
                type: "set_subtitle_scale",
                scale: stepScale(subtitleScale, 1),
              })
            }
          >
            +
          </Item>
        </div>
      </Group>
    </>
  );
}

/** The Stream's audio tracks, embedded-first. */
function AudioMenu({ playback, take }: MenuProps) {
  const tracks = orderedTracks(playback.tracks, "audio");

  return (
    <Group title="Tracks">
      {tracks.length === 0 ? (
        <p className="shell-osd-note">This Stream carries no audio track to pick.</p>
      ) : null}
      {tracks.map((track) => (
        <TrackItem key={track.id} track={track} onTake={take} />
      ))}
    </Group>
  );
}

/** The rates a person can pick, with the one in force marked. */
function SpeedMenu({ playback, take }: MenuProps) {
  return (
    <Group title="Playback speed">
      {SPEEDS.map((rate) => (
        <Item
          key={rate}
          testId={`speed-${rate}`}
          pressed={speedSelected(playback.speed, rate)}
          onClick={() => void take({ type: "set_speed", rate })}
        >
          {formatSpeed(rate)}
        </Item>
      ))}
    </Group>
  );
}

/**
 * The container's chapters, in its own order. Choosing one is `set_chapter`;
 * there are deliberately no step buttons here (#50, #57).
 */
function ChaptersMenu({ playback, take }: MenuProps) {
  return (
    <Group title="Chapters">
      {playback.chapters.length === 0 ? (
        <p className="shell-osd-note">This Stream lists no chapters.</p>
      ) : null}
      {playback.chapters.map((chapter) => (
        <Item
          key={chapter.index}
          testId={`chapter-${chapter.index}`}
          pressed={playback.chapter === chapter.index}
          onClick={() => void take({ type: "set_chapter", index: chapter.index })}
        >
          <span>{chapterLabel(chapter)}</span>
        </Item>
      ))}
    </Group>
  );
}

/** One track choice: its own words, the marks the container gave it, and the Action. */
function TrackItem({
  track,
  onTake,
}: {
  track: Track;
  onTake: (action: Action) => Promise<unknown>;
}) {
  const marks = trackMarks(track);
  return (
    <Item
      testId={`track-${track.kind}-${track.id}`}
      pressed={track.selected}
      onClick={() =>
        void onTake(
          track.kind === "audio"
            ? { type: "set_audio_track", track: track.id }
            : { type: "set_subtitle_track", track: track.id },
        )
      }
    >
      <span>{trackLabel(track)}</span>
      {marks.length > 0 ? (
        <span className="shell-osd-marks">{marks.join(" · ")}</span>
      ) : null}
    </Item>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="shell-osd-group">
      <h3 className="shell-osd-group-title" data-group>
        {title}
      </h3>
      {children}
    </div>
  );
}

/** One full-width row in a popover: a choice, marked with `aria-pressed` where it is one. */
function Item({
  testId,
  label,
  pressed,
  onClick,
  children,
}: {
  testId?: string;
  /** The accessible name, where the visible text is a glyph. */
  label?: string;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="shell-osd-item"
      data-focusable
      data-testid={testId}
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
