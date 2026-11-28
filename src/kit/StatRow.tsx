/**
 * One line of the Details menu (sheet `C6`, 352×40): the Torrent status and the
 * Statistics, with tabular figures. Rows belong inside a `StatList`.
 */

import type { ReactNode } from "react";

export function StatList({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <dl className="mq-pp mq-pp-stats" aria-label={label}>
      {children}
    </dl>
  );
}

export function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="mq-pp-stat">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
