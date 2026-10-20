import { Fragment, useState, type ReactNode } from "react";

import {
  ASPECTS,
  DELAY_STEP,
  SPEEDS,
  aspectSelected,
  chapterLabel,
  cropChoices,
  cropSelected,
  formatDelay,
  formatSpeed,
  orderedTracks,
  speedSelected,
  statisticsLines,
  stepDelay,
  subtitlesOn,
  trackLabel,
  trackMarks,
} from "../controls";
import type { Action, Track } from "../host-client";
import { useShell, type NewShellLevel } from "./context";
import { Popover } from "./kit";

/** The five menus the OSD's icon buttons open, one level each. */
export type OsdPopoverName = "picture" | "subtitles" | "audio" | "speed" | "chapters";

const LABELS: Record<OsdPopoverName, string> = {
  picture: "Picture",
  subtitles: "Subtitles",
  audio: "Audio",
  speed: "Speed",
  chapters: "Chapters",
};

/**
 * One OSD popover, as the level the shell pushes when its icon is pressed.
 *
 * `popover-${name}` is its id, so a second press of the same icon replaces the
 * level rather than stacking a copy; the shell's own Back pops it and restores
 * the icon's focus. The popover reads the Snapshot when it draws, so every
 * selection is the Host's answer and never a copy this client kept.
 */
export function osdPopoverLevel(name: OsdPopoverName): NewShellLevel {
  return {
    id: `popover-${name}`,
    name: `${LABELS[name]} popover`,
    kind: "popover",
    render: () => <OsdPopover name={name} />,
  };
}

function OsdPopover({ name }: { name: OsdPopoverName }) {
  const { snapshot } = useShell();
  const playback = snapshot?.playback ?? null;
  if (!playback) {
    return null;
  }

  const side = name === "speed" || name === "chapters" ? "right" : "left";

  return (
    <div className="shell-osd-popover" data-side={side}>
      <Popover
        label={LABELS[name]}
        heading={LABELS[name]}
        align={side === "right" ? "end" : "start"}
        testId={`popover-${name}`}
      >
        {name === "picture" ? <PictureMenu /> : null}
        {name === "subtitles" ? <SubtitlesMenu /> : null}
        {name === "audio" ? <AudioMenu /> : null}
        {name === "speed" ? <SpeedMenu /> : null}
        {name === "chapters" ? <ChaptersMenu /> : null}
      </Popover>
    </div>
  );
}

/** Aspect, the crop rectangle (including the one the stock autocrop keeps), and statistics. */
function PictureMenu() {
  const { snapshot, take } = useShell();
  const playback = snapshot?.playback;
  const [showStatistics, setShowStatistics] = useState(false);
  if (!playback) {
    return null;
  }

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

/** Subtitle tracks embedded-first, subtitles off, and the delay's tenth-of-a-second steps. */
function SubtitlesMenu() {
  const { snapshot, take } = useShell();
  const playback = snapshot?.playback;
  if (!playback) {
    return null;
  }

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
    </>
  );
}

/** The Stream's audio tracks, embedded-first. */
function AudioMenu() {
  const { snapshot, take } = useShell();
  const playback = snapshot?.playback;
  if (!playback) {
    return null;
  }

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
function SpeedMenu() {
  const { snapshot, take } = useShell();
  const playback = snapshot?.playback;
  if (!playback) {
    return null;
  }

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
function ChaptersMenu() {
  const { snapshot, take } = useShell();
  const playback = snapshot?.playback;
  if (!playback) {
    return null;
  }

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
      <h3 className="shell-osd-group-title">{title}</h3>
      {children}
    </div>
  );
}

/** One full-width row in a popover: a choice, marked with `aria-pressed` where it is one. */
function Item({
  testId,
  pressed,
  onClick,
  children,
}: {
  testId?: string;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="shell-osd-item kit-focus-invert"
      data-focusable
      data-testid={testId}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
