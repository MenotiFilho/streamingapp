import {
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { actionKey } from "../core/actionKey";
import { AUTOPLAY_SWITCH_LABEL, autoplayOn } from "../core/controls";
import type { NewLevel } from "../core/navigation";
import { marqueeTopBarFacts } from "../core/osd";
import { formatTime, watching } from "../core/playback";
import type { PlaybackView } from "../core/playbackView";
import { usePlaybackView } from "../core/react/usePlaybackView";
import { usePreview } from "../core/react/usePreview";
import { useStallShown } from "../core/react/useStallShown";
import type { Session } from "../core/session";
import { transportControls, type TransportControlId } from "../core/transportControls";
import type { Action, Title } from "../core/wire";
import { Icon } from "../kit/marquee/icons";
import {
  controlState,
  PhoneArt,
  PhoneBadge,
  PhoneButton,
  PhoneIconButton,
} from "../kit/marquee/phone/controls";
import { NowPlayingStrip } from "../kit/marquee/phone/NowPlayingStrip";
import { PhoneSeekBar } from "../kit/marquee/phone/PhoneSeekBar";
import { PhoneSwitchRow } from "../kit/marquee/phone/PhoneSwitchRow";
import { PhoneTransport } from "../kit/marquee/phone/PhoneTransport";
import { RemoteMenus } from "../kit/marquee/phone/RemoteMenus";
import { VolumeBox } from "../kit/marquee/phone/VolumeBox";
import { Spinner } from "../kit/marquee/Spinner";
import type { RemotePayload } from "./levels";
import {
  autoplayBanner,
  autoplaySwitch,
  cardStateNote,
  cardTorrentLine,
  CARD_NAME,
  chapterName,
  COLLAPSE_LABEL,
  FAILED_HINT,
  FAILED_TITLE,
  failedOpen,
  playerLevel,
  playingTitle,
  REMOTE_HEADING,
  seekTo,
  setMuted,
  setVolume,
  STRIP_LABEL,
  stripControls,
  stripLine,
  type AutoplayBanner,
  type PlayingTitle,
} from "./playerScreen";
import { playerSheetLevel, remoteMenus } from "./playerSheets";

/**
 * The served Remote's player (#364, `P1`–`P3`, `docs/design-system.md` §11).
 *
 * Two drawings of the core's playback facts: the now-playing strip that is on
 * every screen but the player's own while something is playing, and the
 * fullscreen Remote a strip press pushes. Neither invents Host state: the
 * position is the Snapshot's projection, a control's wait is the Session's
 * pending key, and the picture's absence is the core's `pictureNote`. The player
 * level is the core's, so Back puts the Remote away and leaves the destination
 * underneath; Stop is its own control.
 */

type Push = (level: NewLevel<RemotePayload>) => string;

/** What both drawings read from the Session. */
function usePlayer(session: Session, title: Title | null) {
  const view = usePlaybackView(session, true);
  const stallUp = useStallShown(view?.stalled ?? false);
  const state = useSyncExternalStore(session.subscribe, session.getState, session.getState);
  const snapshot = state.snapshot;
  const playback = snapshot?.playback ?? null;
  const playing = playback
    ? playingTitle(playback, snapshot?.watchProgress ?? [], title)
    : null;
  const take = (action: Action) => void session.take(action);
  return { view, stallUp, snapshot, playback, playing, take };
}

/**
 * The now-playing strip: the Title's poster, its name, the episode and the time
 * left, the two transport steps the phone keeps at hand, and the way into the
 * fullscreen Remote.
 *
 * It is drawn whenever the Host says something is playing — `watching`, not "the
 * picture is in this client" — because the controls are the Host's, so they work
 * wherever the picture is. The room withholds it on the player's own screen
 * (ADR-0036 §4).
 */
export function PlayerStrip({
  session,
  title,
  push,
}: {
  session: Session;
  /** The Title the playing Stream belongs to, where the stack still holds it. */
  title: Title | null;
  /** Push a level, which is how a strip press opens the Remote. */
  push: Push;
}) {
  const { view, stallUp, playing, take } = usePlayer(session, title);

  if (!view || !playing || !watching(view.state)) {
    return null;
  }

  const [rewind, playPause] = stripControls(view);

  return (
    <section
      className="mq-remote-strip"
      aria-label={STRIP_LABEL}
      data-testid="remote-player-strip"
    >
      <NowPlayingStrip
        title={playing.name}
        note={stripLine(view, stallUp)}
        poster={playing.poster}
        playing={view.state !== "paused"}
        progress={view.fraction}
        onOpen={() => push(playerLevel(title))}
        onBack={() => take(rewind.action)}
        onToggle={() => take(playPause.action)}
        backState={rewind}
        toggleState={playPause}
      />
    </section>
  );
}

/**
 * The fullscreen Remote: collapse and Stop, the Title and its marks, the seek
 * bar, the transport, the volume box, the menus that open one bottom sheet each,
 * and the Autoplay switch. It is the level a strip press pushes, so the room's
 * Back closes it without asking the Host anything.
 *
 * After a failed open it stays, with the Host's reason and the ways to another
 * Stream: `switch_stream` keeps the place (ADR-0044 §3).
 */
export function PlayerCard({
  session,
  title,
  push,
  pop,
}: {
  session: Session;
  /** The Title the player belongs to, handed on to the Episodes sheet. */
  title: Title | null;
  /** Push a level, which is how a sheet opens above the Remote. */
  push: Push;
  /** Put the Remote away, without stopping. */
  pop: () => void;
}) {
  const { view, stallUp, snapshot, playback, playing, take } = usePlayer(session, title);
  const failure = failedOpen(playback);
  const failed = failure !== null;

  if (!view || !playback || !playing || (!watching(view.state) && !failed)) {
    return null;
  }

  const controls = Object.fromEntries(
    transportControls(view).map((control) => [control.id, control]),
  ) as Record<TransportControlId, ReturnType<typeof transportControls>[number]>;
  const stateNote = cardStateNote(view, stallUp);
  const torrent = cardTorrentLine(view, stallUp);
  const waiting = view.stalled && stallUp;
  const banner = autoplayBanner(view);
  const facts = marqueeTopBarFacts(view.nowPlaying);
  const autoplay = autoplaySwitch(view, autoplayOn(snapshot));
  const mute = setMuted(!view.volume.muted);

  return (
    <section
      className="mq-remote-player"
      role="region"
      aria-label={CARD_NAME}
      data-testid="remote-player-card"
    >
      {playing.backdrop ? (
        <span className="mq-remote-player-ambient" aria-hidden="true">
          <img src={playing.backdrop} alt="" />
        </span>
      ) : null}

      <header className="mq-remote-player-top">
        <PhoneIconButton label={COLLAPSE_LABEL} icon="caret-down" onClick={pop} />
        <p className="mq-remote-player-heading">{failed ? null : REMOTE_HEADING}</p>
        <PhoneIconButton
          label={controls.stop.label}
          icon="stop"
          filled
          {...controlState(controls.stop)}
          onClick={() => take(controls.stop.action)}
        />
      </header>

      <Subject playing={playing} />

      {facts.length > 0 ? (
        <div className="mq-remote-player-facts">
          {facts.map((fact, index) => (
            <PhoneBadge key={index}>{fact}</PhoneBadge>
          ))}
        </div>
      ) : null}

      {view.pictureNote && !failed ? (
        <p className="mq-remote-inline-status" role="status">
          {view.pictureNote}
        </p>
      ) : null}

      {banner ? <Autoplay banner={banner} take={take} /> : null}

      {stateNote ? (
        <div className="mq-remote-player-state" role="status" data-testid="remote-player-state">
          {waiting ? (
            <span
              className="mq-remote-player-spinner"
              data-testid="remote-player-spinner"
              aria-hidden="true"
            >
              <Spinner />
            </span>
          ) : null}
          <span className="mq-remote-player-state-lines">
            <span>{stateNote}</span>
            {torrent ? (
              <span className="mq-remote-player-torrent" data-testid="remote-player-torrent">
                {torrent}
              </span>
            ) : null}
          </span>
        </div>
      ) : null}

      {failed ? (
        <>
          <div
            className="mq-remote-player-failure"
            role="alert"
            data-testid="remote-player-failure"
          >
            <Icon name="triangle-alert" size={22} />
            <span>
              <strong>{FAILED_TITLE}</strong>
              <span>{failure}</span>
              <span>{FAILED_HINT}</span>
            </span>
          </div>
          <PhoneButton
            icon="list-video"
            onClick={() => push(playerSheetLevel("streams", title))}
          >
            Choose stream
          </PhoneButton>
        </>
      ) : (
        <>
          <Timeline view={view} session={session} />

          <PhoneTransport
            playing={view.state !== "paused"}
            onToggle={() => take(controls.playPause.action)}
            onBack={() => take(controls.rewind.action)}
            onForward={() => take(controls.forward.action)}
            onPrevious={() => take(controls.previous.action)}
            onNext={() => take(controls.next.action)}
            states={{
              previous: controls.previous,
              back: controls.rewind,
              toggle: controls.playPause,
              forward: controls.forward,
              next: controls.next,
            }}
          />

          <VolumeBox
            level={view.volume.level}
            muted={view.volume.muted}
            disabled={!view.controllable}
            mutePending={view.pending.has(actionKey(mute))}
            onCommit={(level) => take(setVolume(level))}
            onMute={(muted) => take(setMuted(muted))}
          />
        </>
      )}

      <RemoteMenus
        menus={remoteMenus(playback, failed)}
        onOpen={(menu) => push(playerSheetLevel(menu, title))}
      />

      {autoplay && !failed ? (
        <PhoneSwitchRow
          label={AUTOPLAY_SWITCH_LABEL}
          checked={autoplay.on}
          onChange={(next) => take(autoplay.toggle(next))}
        />
      ) : null}
    </section>
  );
}

/** The Title's poster beside its name, the episode and the description. */
function Subject({ playing }: { playing: PlayingTitle }) {
  return (
    <div className="mq-remote-player-subject">
      <span className="mq-remote-player-poster">
        <PhoneArt
          src={playing.poster}
          className="mq-ph-cover"
          fallback={<span className="mq-ph-plate" aria-hidden="true">{playing.name}</span>}
        />
      </span>
      <div className="mq-remote-player-copy">
        <h1>{playing.name}</h1>
        {playing.episode ? (
          <p className="mq-remote-player-episode">{playing.episode}</p>
        ) : null}
        {playing.description ? (
          <p className="mq-remote-player-description">{playing.description}</p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The seek bar, one seek when the finger lifts. Pointing at it asks the Host for
 * the still of that moment through the core's one-in-flight rule (ADR-0028): the
 * answer is drawn above the bar with the time and the chapter, and an answer for
 * another Stream is dropped by the hook itself.
 */
function Timeline({ view, session }: { view: PlaybackView; session: Session }) {
  const [point, setPoint] = useState<{ at: number; fraction: number } | null>(null);
  const preview = usePreview(view.streamKey, session.ask);
  const chapter = point ? view.chapterAt(point.at) : null;

  const pointed = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (view.duration === null || !(view.duration > 0)) {
      return;
    }
    const bar = event.currentTarget.getBoundingClientRect();
    if (bar.width <= 0) {
      return;
    }
    const fraction = Math.min(1, Math.max(0, (event.clientX - bar.left) / bar.width));
    const at = fraction * view.duration;
    setPoint({ at, fraction });
    preview.point(at);
  };

  const unpoint = () => {
    setPoint(null);
    preview.point(null);
  };

  return (
    <div
      className="mq-remote-player-timeline"
      data-testid="remote-player-timeline"
      onPointerMove={pointed}
      onPointerLeave={unpoint}
      onPointerCancel={unpoint}
    >
      {point ? (
        <div
          className="mq-remote-player-preview"
          data-testid="remote-player-preview"
          data-pending={preview.waiting ? "true" : "false"}
          style={{ left: `${Math.min(82, Math.max(18, point.fraction * 100))}%` }}
        >
          {preview.still ? (
            <img data-testid="remote-player-preview-still" src={preview.still.image} alt="" />
          ) : null}
          <span className="mq-remote-player-preview-time">{formatTime(point.at)}</span>
          {chapter ? <span>{chapterName(chapter)}</span> : null}
        </div>
      ) : null}

      <PhoneSeekBar
        position={view.position}
        duration={view.duration}
        buffered={view.buffered}
        disabled={!view.transportable}
        onSeek={(seconds) => void session.take(seekTo(seconds, view.duration))}
      />
    </div>
  );
}

/**
 * Autoplay's banner: the next episode's still, its name, and what the Host is
 * doing about it. While it counts down the digit is over the still, with **Play
 * now**, **Cancel** and the lavender line that runs out; at the hold it asks
 * "Still watching?", with no digit and no line, and carries one **Keep
 * watching**. The view is the core's; this draws it and sends the Actions the
 * decision names.
 */
function Autoplay({
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
      className="mq-remote-upnext"
      role="group"
      aria-label={label}
      data-testid="remote-autoplay-banner"
    >
      <span className="mq-remote-upnext-still">
        {next.still ? <img src={next.still} alt="" /> : null}
        {counting ? (
          <span data-testid="remote-autoplay-digit" aria-hidden="true">
            {banner.digit}
          </span>
        ) : null}
      </span>
      <div className="mq-remote-upnext-copy">
        <p>{`${lead} · ${next.label}`}</p>
        {next.name ? <p className="mq-remote-upnext-name">{next.name}</p> : null}
      </div>
      <div className="mq-remote-upnext-actions">
        {banner.kind === "countdown" ? (
          <>
            <PhoneButton
              icon="play"
              filled
              data-testid="remote-autoplay-play-now"
              {...controlState(banner.playNow)}
              onClick={() => take(banner.playNow.action)}
            >
              Play now
            </PhoneButton>
            <PhoneButton
              kind="secondary"
              data-testid="remote-autoplay-cancel"
              onClick={() => take(banner.cancel.action)}
            >
              Cancel
            </PhoneButton>
          </>
        ) : (
          <PhoneButton
            data-testid="remote-autoplay-keep-watching"
            {...controlState(banner.keepWatching)}
            onClick={() => take(banner.keepWatching.action)}
          >
            Keep watching
          </PhoneButton>
        )}
      </div>
      {banner.kind === "countdown" ? (
        <span className="mq-remote-upnext-drain" aria-hidden="true">
          <span style={{ width: `${banner.fraction * 100}%` }} />
        </span>
      ) : null}
    </aside>
  );
}
