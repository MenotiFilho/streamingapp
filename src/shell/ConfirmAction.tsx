import { useEffect, useRef, useState, type ReactNode } from "react";

import type { Action, ActionError } from "../host-client";
import { useShell, type NewShellLevel } from "./context";
import { ConfirmDialog } from "./kit";
import { Refusal } from "./Refusal";

export type ConfirmActionOptions = {
  /** A stable level id, so a second press replaces this question rather than stacking a copy. */
  id: string;
  /** What the confirmation asks, read as its accessible name. */
  title: string;
  /** The consequence or detail under the title. */
  children?: ReactNode;
  /** The confirming control's label: `Remove`, `Revoke`, `Clear key`, `Sign out`. */
  confirmLabel: string;
  /** The Action the confirming control takes. */
  action: Action;
  /** Called once the Host has taken the Action, before the level pops. */
  onConfirmed?: () => void;
  testId?: string;
};

/**
 * The level a destructive control pushes: one question, the Action it would
 * take, and a refusal kept beside it when the Host says no.
 *
 * A refused Action leaves the level open, because the question is still the
 * one a person is answering; Back or Cancel pops it and returns the focus
 * underneath exactly where it was.
 */
export function ConfirmAction({
  title,
  children,
  confirmLabel,
  action,
  onConfirmed,
  testId,
}: ConfirmActionOptions) {
  const { pop, ask } = useShell();
  const [error, setError] = useState<ActionError | null>(null);
  const [working, setWorking] = useState(false);
  // A person can pop the level while the Host is still answering. The answer
  // then belongs to a question that is no longer on screen, and must not pop
  // whatever is on top now.
  const open = useRef(true);

  useEffect(
    () => () => {
      open.current = false;
    },
    [],
  );

  const confirm = async () => {
    if (working) {
      return;
    }
    setError(null);
    setWorking(true);
    const outcome = await ask(action);
    setWorking(false);
    if (outcome.error) {
      if (open.current) {
        setError(outcome.error);
      }
      return;
    }
    if (open.current) {
      onConfirmed?.();
      pop();
    }
  };

  return (
    <ConfirmDialog
      title={title}
      confirmLabel={confirmLabel}
      danger
      onConfirm={() => void confirm()}
      onCancel={pop}
      testId={testId}
    >
      {children}
      <Refusal error={error} />
    </ConfirmDialog>
  );
}

/** The pushed level one destructive control opens. */
export function confirmActionLevel(options: ConfirmActionOptions): NewShellLevel {
  return {
    id: options.id,
    name: options.title,
    kind: "overlay",
    render: () => <ConfirmAction {...options} />,
  };
}
