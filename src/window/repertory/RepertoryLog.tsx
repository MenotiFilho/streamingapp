import type { ReactNode } from "react";

import { useShell } from "../context";
import { usePreviewData } from "./context";

/**
 * The logbook's shared furniture (#147).
 *
 * Addons, Settings and Library are the booth's register rather than admin
 * forms: one brass destination line, plain mono section labels with their
 * rules, hairline rows, and the bookkeeping in mono. These pieces keep that
 * grammar one grammar — a section is a label plus its body, and a level is
 * Back and one title line.
 */

/** The base screen's one-line head: the destination in brass, then the rule. */
export function LogHead({
  title,
  tag,
  testId,
}: {
  title: string;
  tag?: string;
  testId?: string;
}) {
  return (
    <header className="rep-log-head" data-testid={testId}>
      <h1 className="rep-log-head-title">{title}</h1>
      <span className="rep-rule" aria-hidden="true" />
      {tag ? <span className="rep-log-head-tag">{tag}</span> : null}
    </header>
  );
}

/**
 * A pushed sub-screen's head: Back, then the section's name in the display
 * serif, its rule, and its own bookkeeping. Back is the first control, so a
 * level opens on the way out exactly as the Streams list does.
 */
export function LogLevelHead({
  title,
  tag,
  testId,
  backTestId,
}: {
  title: string;
  tag?: string;
  testId?: string;
  backTestId?: string;
}) {
  const { pop } = useShell();

  return (
    <header className="rep-log-level-head" data-testid={testId}>
      <button
        type="button"
        className="rep-button rep-log-back"
        data-focusable
        data-testid={backTestId}
        autoFocus
        onClick={pop}
      >
        Back
      </button>
      <h1 className="rep-log-title">{title}</h1>
      <span className="rep-rule" aria-hidden="true" />
      {tag ? <span className="rep-log-level-tag">{tag}</span> : null}
    </header>
  );
}

/** A section label in the register: mono, one line, and its rule. */
export function LogSectionHead({ title }: { title: string }) {
  return (
    <header className="rep-log-section-head">
      <h2 className="rep-log-section-title">{title}</h2>
      <span className="rep-rule" aria-hidden="true" />
    </header>
  );
}

/** One section: its label and the controls or facts under it. */
export function LogGroup({
  id,
  title,
  children,
  testId,
}: {
  id: string;
  title: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section
      className="rep-log-section"
      data-testid={testId}
      data-region={id}
      data-kind="branch"
      data-label={title}
    >
      <LogSectionHead title={title} />
      <div className="rep-log-section-body">{children}</div>
    </section>
  );
}

/** A term-and-value ledger: labels in mono, values in mono, one hairline per row. */
export function LogFacts({
  rows,
  testId,
}: {
  rows: readonly { term: string; value: ReactNode; testId?: string }[];
  testId?: string;
}) {
  return (
    <dl className="rep-log-facts" data-testid={testId}>
      {rows.map((row) => (
        <div key={row.term}>
          <dt>{row.term}</dt>
          <dd data-testid={row.testId}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A page with nothing on it yet: an explicit title and the reason. */
export function LogEmpty({
  title,
  body,
  testId,
}: {
  title: string;
  body: ReactNode;
  testId?: string;
}) {
  return (
    <div className="rep-log-empty" data-testid={testId}>
      <p className="rep-log-empty-title">{title}</p>
      <p className="rep-log-empty-body">{body}</p>
    </div>
  );
}

/** A quiet line of copy, the width of a printed paragraph. */
export function LogNote({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p className="rep-log-note" data-testid={testId}>
      {children}
    </p>
  );
}

/** The line that says the plain Vite window is a rehearsal, not the Host. */
export function LogPreviewNote({ children }: { children: ReactNode }) {
  const preview = usePreviewData();
  return preview ? <p className="rep-preview-note">{children}</p> : null;
}
