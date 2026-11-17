import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { actionKey } from "../core/actionKey";
import { formatVolume } from "../core/controls";
import type { NewLevel } from "../core/navigation";
import {
  remainingTime,
  spacedChapterMarks,
  timelineFraction,
} from "../core/osd";
import { formatTime, watching } from "../core/playback";
import type { PlaybackView } from "../core/playbackView";
import { usePlaybackView } from "../core/react/usePlaybackView";
import { usePreview } from "../core/react/usePreview";
import type { Session } from "../core/session";
import {
  transportControls,
  type TransportControl,
} from "../core/transportControls";
import type { Action, Title } from "../core/wire";
import { Button } from "../kit/Button";
import { Icon } from "../kit/icons";
import { PendingSpinner } from "../kit/PendingSpinner";
import { Switch } from "../kit/Switch";
import type { RemotePayload } from "./levels";
import {
  PLAYER_SHEET_CONTROLS,
  playerSheetLevel,
  SHEET_TITLES,
} from "./playerSheets";
import {
  autoplayBanner,
  autoplaySwitch,
  cardStateNote,
  CARD_NAME,
  chapterName,
  NOW_PLAYING,
  playerLevel,
  seekTo,
  setMuted,
  setVolume,
  STRIP_EXPAND,
  STRIP_LABEL,
  stripControls,
  stripEpisode,
  TIMELINE_LABEL,
  timelineRange,
  trackFills,
  volumeRange,
  VOLUME_LABEL,
  type AutoplayBanner,
  type TrackFill,
} from "./playerScreen";

/**
 * The Remote's player, drawn at hand scale (#213, ADR-0035 §2).
 *
 * Two drawings of the core's playback facts: a docked strip that is on every
 * screen but the player's own while something is playing, and the one expanded
 * card a strip press pushes. Neither invents Host state: the position is the
 * Snapshot's projection, a control's wait is the Session's pending key, and the
 * picture's absence is the core's `pictureNote`. The player level is the core's,
 * so Back pops the card and leaves the destination underneath; Stop is the sixth
 * cell and its own control.
 */

export type PlayerStripProps = {
  /** The Session the strip's questions go through. */
  session: Session;
  /** The Title the playing Stream belongs to, where the stack still holds it. */
  title: Title | null;
  /** Push a level, which is how a strip press opens the card. */
  push: (level: NewLevel<RemotePayload>) => string;
};

/**
 * The docked strip: the still, the Title and episode, the progress hairline,
 * the two transport steps the phone keeps at hand, and the way into the card.
 *
 * It is drawn whenever the Host says something is playing — `watching`, not
 * "the picture is in this client" — because that is the phone's rule: the
 * controls are the Host's, so they work wherever the picture is. The room
 * withholds it on the player's own screen, where the card already says what is
 * playing (ADR-0036 §4). Where the picture is not here (`own_window`,
 * `nowhere`), the strip says so in the core's own words.
 */
export function PlayerStrip({ session, title, push }: PlayerStripProps) {
  const view = usePlaybackView(session, true);

  if (!view || !watching(view.state)) {
    return null;
  }

  const [rewind, playPause] = stripControls(view);
  const art = view.openingPreview?.art ?? null;

  return (
    <section
      className="remote-player-strip"
      aria-label={STRIP_LABEL}
      data-testid="remote-player-strip"
    >
      <span className="remote-player-strip-art" aria-hidden="true">
        {art ? <img src={art} alt="" /> : null}
      </span>

      <button
        type="button"
        className="remote-player-strip-open"
        data-focusable
        onClick={() => push(playerLevel(title))}
      >
        <span className="remote-player-strip-title">{view.title}</span>
        <span className="remote-player-strip-episode">{stripEpisode(view)}</span>
        {view.pictureNote ? (
          <span className="remote-player-strip-note">{view.pictureNote}</span>
        ) : null}
        <span className="remote-visually-hidden">{STRIP_EXPAND}</span>
      </button>

      <PlayerIcon control={rewind} onTake={(action) => void session.take(action)} />
      <PlayerIcon
        control={playPause}
        primary
        onTake={(action) => void session.take(action)}
      />

      <span className="remote-player-strip-progress" aria-hidden="true">
        <span style={{ width: `${view.fraction * 100}%` }} />
      </span>
    </section>
  );
}

/**
 * The expanded card: the programme plate, the timeline, the six-cell transport
 * and the always-visible volume box. It is the level a strip press pushes, so
 * the room's Back closes it without asking the Host anything.
 */
export function PlayerCard({
  session,
  title,
  push,
}: {
  session: Session;
  /** The Title the player belongs to, handed on to the Episodes plate. */
  title: Title | null;
  /** Push a level, which is how a plate opens above the card. */
  push: (level: NewLevel<RemotePayload>) => string;
}) {
  const view = usePlaybackView(session, true);

  if (!view || !watching(view.state)) {
    return null;
  }

  const controls = transportControls(view);
  const take = (action: Action) => void session.take(action);
  const stateNote = cardStateNote(view);
  const banner = autoplayBanner(view);

  return (
    <section
      className="remote-player-card"
      role="region"
      aria-label={CARD_NAME}
      data-testid="remote-player-card"
    >
      <PlayerPlate view={view} />

      {view.pictureNote ? (
        <p className="remote-player-note" role="status">
          {view.pictureNote}
        </p>
      ) : null}

      {banner ? <PlayerAutoplayBanner banner={banner} take={take} /> : null}

      {stateNote ? (
        <p className="remote-player-state" role="status">
          {stateNote}
        </p>
      ) : null}

      <PlayerTimeline view={view} session={session} />

      <div className="remote-player-transport" role="group" aria-label="Transport">
        {controls.map((control) => (
          <PlayerIcon key={control.id} control={control} onTake={take} />
        ))}
      </div>

      <PlayerAutoplaySwitch session={session} episode={view.episode} />

      <PlayerMenus title={title} push={push} />

      <VolumeBox view={view} session={session} />
    </section>
  );
}

/**
 * The Autoplay switch row, always on the card for an episode: the Host's one
 * preference as it last published it, and `set_autoplay` on a press. It holds no
 * state of its own; flipping it mid-episode changes what this one's end does
 * (#318, #302).
 */
function PlayerAutoplaySwitch({
  session,
  episode,
}: {
  session: Session;
  episode: PlaybackView["episode"];
}) {
  const state = useSyncExternalStore(session.subscribe, session.getState, session.getState);
  const row = autoplaySwitch({ episode }, state.snapshot?.preferences.autoplay ?? true);

  if (row === null) {
    return null;
  }

  return (
    <div className="remote-player-autoplay">
      <Switch
        on={row.on}
        label={row.label}
        testId="remote-autoplay-switch"
        onToggle={(next) => void session.take(row.toggle(next))}
      />
    </div>
  );
}

/**
 * The banner under the plate, where the ended note sits: the next episode's
 * still, its name, and what the Host is doing about it. While it counts down the
 * digit is over the still, the kicker says "Up next · S1E4", **Play now** and
 * **Cancel** are full-width and the brass line drains along its foot. At the
 * hold it is titled "Still watching?", has no digit and no line, and carries one
 * **Keep watching**. The view is the core's; this draws it and sends the
 * Actions the decision names.
 */
function PlayerAutoplayBanner({
  banner,
  take,
}: {
  banner: AutoplayBanner;
  take: (action: Action) => void;
}) {
  const { next } = banner;
  const counting = banner.kind === "countdown";
  const lead = counting ? banner.kicker.lead : banner.title;
  const label = counting ? banner.kicker.text : banner.strip;

  return (
    <aside
      className="remote-autoplay-banner"
      role="group"
      aria-label={label}
      data-testid="remote-autoplay-banner"
    >
      <div className="remote-autoplay-still">
        {next.still ? <img src={next.still} alt="" /> : null}
        {counting ? (
          <span className="tabular" data-testid="remote-autoplay-digit" aria-hidden="true">
            {banner.digit}
          </span>
        ) : null}
      </div>
      <div className="remote-autoplay-copy">
        <p className="remote-autoplay-kicker">
          <span>{lead}</span>
          <span className="remote-autoplay-rule" aria-hidden="true" />
          <span>{next.label}</span>
        </p>
        {next.name ? <p className="remote-autoplay-name">{next.name}</p> : null}
      </div>
      <div className="remote-autoplay-actions">
        {banner.kind === "countdown" ? (
          <>
            <Button
              variant="primary"
              disabled={banner.playNow.pending}
              pending={banner.playNow.pending}
              onClick={() => take(banner.playNow.action)}
            >
              Play now
            </Button>
            <Button variant="ghost" onClick={() => take(banner.cancel.action)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button
            variant="primary"
            disabled={banner.keepWatching.pending}
            pending={banner.keepWatching.pending}
            onClick={() => take(banner.keepWatching.action)}
          >
            Keep watching
          </Button>
        )}
      </div>
      {banner.kind === "countdown" ? (
        <span className="remote-autoplay-drain" aria-hidden="true">
          <span style={{ width: `${banner.fraction * 100}%` }} />
        </span>
      ) : null}
    </aside>
  );
}

/**
 * The card's menu row: the five plates the core's sections fill (#214). Each
 * control is a level of its own, so Back puts the plate away and leaves the
 * card exactly as it was.
 */
function PlayerMenus({
  title,
  push,
}: {
  title: Title | null;
  push: (level: NewLevel<RemotePayload>) => string;
}) {
  return (
    <div className="remote-player-menus" role="group" aria-label="Player menus">
      {PLAYER_SHEET_CONTROLS.map((control) => (
        <button
          key={control.plate}
          type="button"
          className="remote-player-icon"
          data-focusable
          data-testid={`player-menu-${control.plate}`}
          aria-label={SHEET_TITLES[control.plate]}
          onClick={() => push(playerSheetLevel(control.plate, title))}
        >
          <Icon name={control.icon} strokeWidth={2} />
        </button>
      ))}
    </div>
  );
}

/** The card's plate: the film's own backdrop, the Title and the episode. */
function PlayerPlate({ view }: { view: PlaybackView }) {
  const art = view.openingPreview?.art ?? null;

  return (
    <div className="remote-player-plate" data-empty={art === null}>
      {art ? <img className="remote-player-plate-art" src={art} alt="" /> : null}
      <span className="remote-player-plate-scrim" aria-hidden="true" />
      <div className="remote-player-plate-copy">
        <span className="remote-player-kicker">{NOW_PLAYING}</span>
        <h1 className="remote-player-title">{view.title}</h1>
        <span className="remote-player-episode">{view.episodeLabel}</span>
      </div>
    </div>
  );
}

/**
 * The timeline: one range input over a drawn track — the played part in brass,
 * the Player's read-ahead in the hairline's own colour, the container's chapter
 * ticks, and the ivory playhead. A change is committed once, on the pointer's
 * release or the key's, so a drag is one Action rather than one per pixel.
 *
 * Pointing at the bar asks the Host for the still of that moment through the
 * core's one-in-flight rule (ADR-0028): the answer is drawn above the bar, and
 * an answer for another Stream is dropped by the hook itself.
 */
function PlayerTimeline({
  view,
  session,
}: {
  view: PlaybackView;
  session: Session;
}) {
  const range = timelineRange(view);
  const [scrub, setScrub] = useState<number | null>(null);
  const [point, setPoint] = useState<{ at: number; fraction: number } | null>(null);
  const [width, setWidth] = useState(0);
  const track = useRef<HTMLDivElement | null>(null);
  const preview = usePreview(view.streamKey, session.ask);
  const interactive = view.transportable && view.duration !== null && view.duration > 0;
  const shown = scrub ?? range.value;
  const fraction = timelineFraction(shown, view.duration);
  const fills = trackFills(fraction, view.buffered);
  const marks = spacedChapterMarks(view.marks, width);
  const chapter = point ? view.chapterAt(point.at) : null;

  useEffect(() => {
    const node = track.current;
    if (!node) {
      return;
    }
    const measure = () => setWidth(node.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver(measure);
      observer.observe(node);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const commit = () => {
    if (scrub === null || !interactive) {
      return;
    }
    const seconds = scrub;
    setScrub(null);
    void session.take(seekTo(seconds, view.duration));
  };

  /** Where on the bar the pointer is, in seconds from the Stream's start. */
  const pointed = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (view.duration === null || !(view.duration > 0)) {
      return;
    }
    const bar = event.currentTarget.getBoundingClientRect();
    if (bar.width <= 0) {
      return;
    }
    const at = Math.min(1, Math.max(0, (event.clientX - bar.left) / bar.width));
    const seconds = at * view.duration;
    setPoint({ at: seconds, fraction: at });
    preview.point(seconds);
  };

  const unpoint = () => {
    setPoint(null);
    preview.point(null);
  };

  return (
    <div
      className="remote-player-timeline"
      data-testid="remote-player-timeline"
      onPointerMove={pointed}
      onPointerLeave={unpoint}
    >
      <div
        className="remote-player-track"
        aria-hidden="true"
        ref={track}
        style={{ background: trackGradient(fills) }}
      >
        <span
          className="remote-player-playhead"
          style={{ left: `${fraction * 100}%` }}
        />
        {marks.map(({ chapter: mark, fraction: at }) => (
          <span
            key={mark.index}
            className="remote-player-chapter"
            style={{ left: `${at * 100}%` }}
          />
        ))}
      </div>

      {point ? (
        <div
          className="remote-player-preview"
          data-testid="remote-player-preview"
          data-pending={preview.waiting ? "true" : "false"}
          style={{ left: `${Math.min(92, Math.max(8, point.fraction * 100))}%` }}
        >
          {preview.still ? (
            <img
              className="remote-player-preview-still"
              data-testid="remote-player-preview-still"
              src={preview.still.image}
              alt=""
            />
          ) : null}
          <span className="remote-player-preview-time tabular">
            {formatTime(point.at)}
          </span>
          {chapter ? (
            <span className="remote-player-preview-chapter">
              {chapterName(chapter)}
            </span>
          ) : null}
        </div>
      ) : null}

      <input
        type="range"
        className="remote-player-scrubber"
        data-focusable
        aria-label={TIMELINE_LABEL}
        min={range.min}
        max={range.max}
        step={range.step}
        value={shown}
        aria-valuetext={formatTime(shown)}
        disabled={!interactive}
        onChange={(event) => setScrub(Number(event.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />

      <div className="remote-player-clocks" aria-hidden="true">
        <span className="tabular">{formatTime(shown)}</span>
        <span className="tabular">{remainingTime(shown, view.duration)}</span>
      </div>
    </div>
  );
}

/**
 * The always-visible volume box: the Host's level, its 0–130 slider and the
 * mute toggle. Moving the thumb draws the level being chosen; one change is one
 * `set_volume`, sent when the person lets go, never once per pointer move.
 */
function VolumeBox({ view, session }: { view: PlaybackView; session: Session }) {
  const range = volumeRange(view);
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? range.value;
  const interactive = view.controllable;
  const mute = setMuted(!view.volume.muted);
  const mutePending = view.pending.has(actionKey(mute));

  const commit = () => {
    if (draft === null || !interactive) {
      return;
    }
    const level = draft;
    setDraft(null);
    void session.take(setVolume(level));
  };

  return (
    <div className="remote-player-volume" role="group" aria-label="Volume box">
      <span className="remote-player-volume-level tabular" aria-hidden="true">
        {formatVolume(shown)}
      </span>
      <input
        type="range"
        className="remote-player-volume-slider"
        data-focusable
        aria-label={VOLUME_LABEL}
        min={range.min}
        max={range.max}
        step={range.step}
        value={shown}
        aria-valuetext={formatVolume(shown)}
        disabled={!interactive}
        onChange={(event) => setDraft(Number(event.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <button
        type="button"
        className="remote-player-icon"
        data-focusable
        aria-label={view.volume.muted ? "Unmute" : "Mute"}
        aria-pressed={view.volume.muted}
        aria-busy={mutePending || undefined}
        data-pending={mutePending ? "true" : undefined}
        disabled={!interactive || mutePending}
        onClick={() => void session.take(mute)}
      >
        {mutePending ? (
          <PendingSpinner />
        ) : (
          <Icon
            name={view.volume.muted ? "volume-muted" : "volume"}
            strokeWidth={2}
          />
        )}
      </button>
    </div>
  );
}

/** One bare mark in a hairline cell, with the wait the Session's key names. */
function PlayerIcon({
  control,
  primary = false,
  onTake,
}: {
  control: TransportControl;
  primary?: boolean;
  onTake: (action: Action) => void;
}) {
  return (
    <button
      type="button"
      className="remote-player-icon"
      data-focusable
      data-role={primary ? "primary" : undefined}
      data-testid={`remote-player-${control.id}`}
      aria-label={control.label}
      aria-busy={control.pending || undefined}
      data-pending={control.pending ? "true" : undefined}
      disabled={control.disabled || control.pending}
      onClick={() => onTake(control.action)}
    >
      {control.pending ? (
        <PendingSpinner />
      ) : (
        <Icon name={control.icon} strokeWidth={2.2} />
      )}
    </button>
  );
}

/**
 * The track's painted reading, as one gradient: the played part in brass, the
 * read-ahead in the muted ink, and the rest of the track bare. The spans are the
 * core-numbered `trackFills`; this only turns them into stops.
 */
function trackGradient(fills: TrackFill[]): string {
  const percent = (fraction: number) => `${Math.round(fraction * 1000) / 10}%`;
  const stops: string[] = [];
  let at = 0;

  for (const fill of fills) {
    if (fill.from > at) {
      stops.push(`var(--rep-hairline) ${percent(at)}`);
      stops.push(`var(--rep-hairline) ${percent(fill.from)}`);
    }
    const colour =
      fill.role === "played" ? "var(--rep-house)" : "var(--rep-muted)";
    stops.push(`${colour} ${percent(fill.from)}`);
    stops.push(`${colour} ${percent(fill.to)}`);
    at = fill.to;
  }

  if (at < 1) {
    stops.push(`var(--rep-hairline) ${percent(at)}`);
    stops.push("var(--rep-hairline) 100%");
  }

  return `linear-gradient(to right, ${stops.join(", ")})`;
}
