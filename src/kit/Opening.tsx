/**
 * A Stream opening (sheet `C6`, 640×240): the Title's logo filling from its
 * leading edge over a dim copy of itself, or — with no logo — the name over a
 * lavender bar. The fill follows the phase the Snapshot reports and no number
 * of its own (ADR-0044 §7), so it is not announced as a percentage.
 */

import { useState, type CSSProperties } from "react";

import { openingFill, type OpeningPhase } from "./openingPhase";

export type OpeningProps = {
  /** The Title's name: the `text` variant, and what the logo is called. */
  title: string;
  /** The Title's wordmark; without one, or if it fails to load, the name is drawn. */
  logo?: string | null;
  phase: OpeningPhase;
  /** A line under it, such as the Torrent status. */
  detail?: string | null;
};

export function Opening({ title, logo, phase, detail }: OpeningProps) {
  /** The logo that failed to load; another one gets its own try. */
  const [broken, setBroken] = useState<string | null>(null);
  /** The logo's own shape, so its box hugs it and the fill ends where it does. */
  const [shape, setShape] = useState<{ logo: string; ratio: number } | null>(null);
  const art = logo && logo !== broken ? logo : null;
  const fill = openingFill(phase);

  return (
    <div
      className="mq-pp mq-pp-opening"
      role="status"
      aria-label={detail ? `${title}. ${detail}` : title}
      data-variant={art ? "logo" : "text"}
      data-phase={phase}
      style={{ "--mq-pp-fill": fill } as CSSProperties}
    >
      {art ? (
        <span
          className="mq-pp-opening-logo"
          data-measured={shape?.logo === art ? "true" : undefined}
          style={
            shape?.logo === art
              ? ({ "--mq-pp-logo-ratio": shape.ratio } as CSSProperties)
              : undefined
          }
        >
          <img
            className="mq-pp-opening-dim"
            src={art}
            alt=""
            onLoad={(event) => {
              const { naturalWidth, naturalHeight } = event.currentTarget;
              // Art with no size of its own (some SVGs) still has to show.
              const sized = naturalWidth > 0 && naturalHeight > 0;
              setShape({ logo: art, ratio: sized ? naturalWidth / naturalHeight : 3 });
            }}
            onError={() => setBroken(art)}
          />
          <img className="mq-pp-opening-fill" src={art} alt="" />
        </span>
      ) : (
        <>
          <p className="mq-pp-opening-name">{title}</p>
          <span className="mq-pp-opening-track" aria-hidden="true">
            <span className="mq-pp-opening-progress" />
          </span>
        </>
      )}
      {detail ? <p className="mq-pp-opening-detail">{detail}</p> : null}
    </div>
  );
}
