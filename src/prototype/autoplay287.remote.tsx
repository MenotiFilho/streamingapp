/* PROTOTYPE (#287, throwaway): the Remote client's drawings of the three variants. */
import { Button } from "../kit/Button";
import { countdownDigit, proto, ProtoSwitch, type ProtoView } from "./autoplay287";

export function live(auto: ProtoView): boolean {
  return auto.phase === "countdown" || auto.phase === "still_there";
}

/** A — a sixth cell in the card's menu row. One press. */
export function MenuCell({ auto }: { auto: ProtoView }) {
  return (
    <button
      type="button"
      className="remote-player-icon proto-remote-cell"
      data-focusable
      data-testid="proto-autoplay-toggle"
      role="switch"
      aria-checked={auto.autoplay}
      aria-label="Autoplay"
      onClick={() => proto.toggle()}
    >
      {auto.autoplay ? "Auto" : "Auto off"}
    </button>
  );
}

/** C — a labelled switch that is always on the card, under the transport. */
export function CardSwitch({ auto }: { auto: ProtoView }) {
  return (
    <div className="proto-remote-switch">
      <ProtoSwitch
        compact
        on={auto.autoplay}
        label="Autoplay the next episode"
        testId="proto-card-switch"
        onToggle={() => proto.toggle()}
      />
    </div>
  );
}

/** B — the switch at the head of the Episodes sheet. Two presses. */
export function SheetSwitch({ auto }: { auto: ProtoView }) {
  return (
    <div className="proto-remote-switch proto-remote-switch-sheet">
      <ProtoSwitch
        compact
        on={auto.autoplay}
        label="Autoplay the next episode"
        testId="proto-sheet-switch"
        onToggle={() => proto.toggle()}
      />
    </div>
  );
}

function Actions({ auto }: { auto: ProtoView }) {
  return auto.phase === "still_there" ? (
    <div className="proto-actions">
      <Button variant="primary" data-testid="proto-continue" onClick={() => proto.playNow()}>
        Keep watching
      </Button>
    </div>
  ) : (
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

/** B — the plate becomes the next episode. */
export function TakeoverPlate({ auto }: { auto: ProtoView }) {
  const asking = auto.phase === "still_there";
  return (
    <>
      <div className="remote-player-plate proto-remote-plate" data-testid="proto-takeover">
        <img className="remote-player-plate-art" src={auto.next.still} alt="" />
        <span className="remote-player-plate-scrim" aria-hidden="true" />
        <div className="remote-player-plate-copy">
          <span className="remote-player-kicker">
            {asking ? "Still watching?" : `Up next in ${countdownDigit(auto)}`}
          </span>
          <h1 className="remote-player-title">{auto.next.name}</h1>
          <span className="remote-player-episode">{auto.next.label}</span>
        </div>
        {asking ? null : (
          <span className="proto-drain proto-drain-foot" aria-hidden="true">
            <span style={{ width: `${auto.fraction * 100}%` }} />
          </span>
        )}
      </div>
      <Actions auto={auto} />
    </>
  );
}

/** A's banner and C's line, where the card's state note sits today. */
export function EndedNote({ auto }: { auto: ProtoView }) {
  const asking = auto.phase === "still_there";
  if (auto.variant === "A") {
    return (
      <aside className="proto-remote-banner" data-testid="proto-card" role="status">
        <div className="proto-remote-banner-still">
          <img src={auto.next.still} alt="" />
          {asking ? null : <span className="tabular">{countdownDigit(auto)}</span>}
        </div>
        <div className="proto-remote-banner-copy">
          <p className="proto-kicker">
            <span>{asking ? "Still watching?" : "Up next"}</span>
            <span className="proto-kicker-rule" aria-hidden="true" />
            <span>{auto.next.label}</span>
          </p>
          <p className="proto-remote-banner-name">{auto.next.name}</p>
        </div>
        <Actions auto={auto} />
        {asking ? null : (
          <span className="proto-drain" aria-hidden="true">
            <span style={{ width: `${auto.fraction * 100}%` }} />
          </span>
        )}
      </aside>
    );
  }
  return (
    <div className="proto-remote-line" data-testid="proto-line" role="status">
      <p className="remote-player-state">
        {asking ? "Still watching? " : "Up next: "}
        {auto.next.label} · {auto.next.name}
      </p>
      {asking ? (
        <Actions auto={auto} />
      ) : (
        <div className="proto-remote-line-row">
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
        </div>
      )}
    </div>
  );
}
