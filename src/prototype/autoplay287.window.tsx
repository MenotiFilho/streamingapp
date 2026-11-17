/* PROTOTYPE (#287, throwaway): the window's drawings of the three variants. */
import { Button } from "../kit/Button";
import { MenuGroup, MenuRow } from "../kit/Menu";
import { countdownDigit, proto, ProtoSwitch, type ProtoView } from "./autoplay287";

/** A — the toggle in the transport row, beside Episodes. One press. */
export function TransportToggle({ auto }: { auto: ProtoView }) {
  return (
    <button
      type="button"
      className="shell-osd-icon proto-transport-toggle"
      data-focusable
      data-testid="proto-autoplay-toggle"
      role="switch"
      aria-checked={auto.autoplay}
      aria-label="Autoplay"
      title={auto.autoplay ? "Autoplay is on" : "Autoplay is off"}
      onClick={() => proto.toggle()}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
        <path d="M5 5v14l9-7z" fill={auto.autoplay ? "currentColor" : "none"} />
        <path d="M18 5v14" />
        {auto.autoplay ? null : <path d="M3 3l18 18" />}
      </svg>
      <span className="rep-osd-speed-value tabular">{auto.autoplay ? "Auto" : "Off"}</span>
    </button>
  );
}

/** B — the switch at the head of the Episodes panel. Two presses. */
export function EpisodesHeadSwitch({ auto }: { auto: ProtoView }) {
  return (
    <div className="proto-episodes-head">
      <ProtoSwitch
        on={auto.autoplay}
        label="Autoplay the next episode"
        testId="proto-episodes-switch"
        onToggle={() => proto.toggle()}
      />
    </div>
  );
}

/** C — a second group in the Speed popover, which becomes "Playback". */
export function PlaybackGroup({ auto }: { auto: ProtoView }) {
  return (
    <MenuGroup title="When an episode ends">
      <MenuRow
        label="Play the next episode"
        testId="proto-playback-on"
        pressed={auto.autoplay}
        onPress={() => proto.setAutoplay(true)}
      >
        Play the next episode
      </MenuRow>
      <MenuRow
        label="Wait"
        testId="proto-playback-off"
        pressed={!auto.autoplay}
        onPress={() => proto.setAutoplay(false)}
      >
        Wait
      </MenuRow>
    </MenuGroup>
  );
}

function Actions({ auto }: { auto: ProtoView }) {
  if (auto.phase === "still_there") {
    return (
      <div className="proto-actions">
        <Button variant="primary" data-testid="proto-continue" onClick={() => proto.playNow()}>
          Keep watching
        </Button>
      </div>
    );
  }
  return (
    <div className="proto-actions">
      <Button variant="primary" data-testid="proto-play-now" onClick={() => proto.playNow()}>
        Play now
      </Button>
      <Button variant="ghost" data-testid="proto-cancel" onClick={() => proto.cancel()}>
        Cancel
      </Button>
    </div>
  );
}

/**
 * What the picture carries at the end of an episode, above the OSD's idle
 * clock: A's corner card and B's takeover. C draws nothing here.
 */
export function PictureLayer({ auto }: { auto: ProtoView }) {
  const live = auto.phase === "countdown" || auto.phase === "still_there";
  if (!live || auto.variant === "C") {
    return null;
  }
  const asking = auto.phase === "still_there";

  if (auto.variant === "A") {
    return (
      <aside className="proto-card" data-testid="proto-card" role="status">
        <div className="proto-card-still">
          <img src={auto.next.still} alt="" />
          {asking ? null : <span className="proto-card-digit tabular">{countdownDigit(auto)}</span>}
        </div>
        <div className="proto-card-copy">
          <p className="proto-kicker">
            <span>{asking ? "Still watching?" : "Up next"}</span>
            <span className="proto-kicker-rule" aria-hidden="true" />
            <span>{auto.next.label}</span>
          </p>
          <p className="proto-card-name">{auto.next.name}</p>
          <Actions auto={auto} />
        </div>
        {asking ? null : (
          <span className="proto-drain" aria-hidden="true">
            <span style={{ width: `${auto.fraction * 100}%` }} />
          </span>
        )}
      </aside>
    );
  }

  return (
    <div className="proto-takeover" data-testid="proto-takeover" role="status">
      <img className="proto-takeover-art" src={auto.next.still} alt="" />
      <span className="proto-takeover-scrim" aria-hidden="true" />
      <div className="proto-takeover-copy">
        <p className="proto-kicker">
          <span>{asking ? "Still watching?" : "Up next"}</span>
          <span className="proto-kicker-rule" aria-hidden="true" />
          <span>{auto.next.label}</span>
        </p>
        <p className="proto-takeover-name">{auto.next.name}</p>
        {asking ? (
          <p className="proto-takeover-line">Three episodes played on their own.</p>
        ) : (
          <p className="proto-takeover-line">
            Plays in <span className="proto-takeover-digit tabular">{countdownDigit(auto)}</span>
          </p>
        )}
        <Actions auto={auto} />
      </div>
      {asking ? null : (
        <span className="proto-drain proto-drain-foot" aria-hidden="true">
          <span style={{ width: `${auto.fraction * 100}%` }} />
        </span>
      )}
    </div>
  );
}

/** C — one line where today's "Next episode" prompt sits, the button draining. */
export function EndedLine({ auto }: { auto: ProtoView }) {
  const asking = auto.phase === "still_there";
  return (
    <div className="shell-osd-ended proto-line" data-testid="proto-line" role="status">
      <p className="proto-line-copy">
        <span className="proto-line-label">{asking ? "Still watching?" : "Up next"}</span>
        <span className="tabular">{auto.next.label}</span>
        <span className="proto-line-name">{auto.next.name}</span>
      </p>
      {asking ? (
        <Button variant="primary" data-testid="proto-continue" onClick={() => proto.playNow()}>
          Keep watching
        </Button>
      ) : (
        <>
          <button
            type="button"
            className="proto-line-next"
            data-focusable
            data-testid="proto-play-now"
            onClick={() => proto.playNow()}
          >
            <span className="proto-line-fill" style={{ width: `${(1 - auto.fraction) * 100}%` }} />
            <span className="proto-line-next-text">
              Next episode in <span className="tabular">{countdownDigit(auto)}</span>
            </span>
          </button>
          <Button variant="ghost" data-testid="proto-cancel" onClick={() => proto.cancel()}>
            Cancel
          </Button>
        </>
      )}
    </div>
  );
}
