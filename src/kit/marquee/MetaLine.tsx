import { Fragment } from "react";

import { Badge } from "./Badge";
import { cx } from "./cx";
import { metaFacts, type MetaInput } from "./meta";

export type MetaLineProps = MetaInput & { className?: string };

/** The IMDb badge and rating, then year, runtime and genres (sheet C4). */
export function MetaLine({ className, ...input }: MetaLineProps) {
  const { rating, facts } = metaFacts(input);
  if (!rating && facts.length === 0) {
    return null;
  }

  return (
    <div className={cx("mq-meta-line", className)}>
      {rating ? (
        <>
          <Badge tone="imdb">IMDb</Badge>
          <span className="mq-meta-line-rating">{rating}</span>
        </>
      ) : null}
      {facts.map((fact, index) => (
        <Fragment key={fact.key}>
          {rating || index > 0 ? (
            <span className="mq-meta-line-dot" aria-hidden="true" />
          ) : null}
          <span className="mq-meta-line-fact" data-fact={fact.key}>
            {fact.text}
          </span>
        </Fragment>
      ))}
    </div>
  );
}
