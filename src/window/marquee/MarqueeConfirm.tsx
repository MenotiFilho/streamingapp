import { useEffect, useRef, useState, type ReactNode } from "react";

import { explain, type ActionError } from "../../core/errors";
import type { Action } from "../../core/wire";
import { Confirm } from "../../kit/Confirm";
import type { IconName } from "../../kit/icons";
import { useShell, type NewShellLevel } from "../context";

export type MarqueeConfirmOptions = {
  /** A stable level id, so a second press replaces this question rather than stacking a copy. */
  id: string;
  /** What the confirmation asks, read as its accessible name. */
  title: string;
  /** The consequence or detail under the title. */
  body: ReactNode;
  /** The confirming control's label: `Remove`, `Revoke`, `Clear key`, `Sign out`. */
  confirmLabel: string;
  /** The Action the confirming control takes. */
  action: Action;
  /** Called once the Host has taken the Action, before the level pops. */
  onConfirmed?: () => void;
  danger?: boolean;
  icon?: IconName | null;
};

/**
 * Marquee confirmation level: pushes `Confirm` (`src/kit/Confirm.tsx`)
 * with initial focus on Cancel (`docs/design-system.md` §8), keeping any Host
 * refusal inline so the person can Cancel or retry.
 */
export function MarqueeConfirm({
  title,
  body,
  confirmLabel,
  action,
  onConfirmed,
  danger = true,
  icon,
}: MarqueeConfirmOptions) {
  const { pop, ask } = useShell();
  const [error, setError] = useState<ActionError | null>(null);
  const [working, setWorking] = useState(false);
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
    <Confirm
      title={title}
      confirmLabel={confirmLabel}
      danger={danger}
      icon={icon}
      pending={working}
      onConfirm={() => void confirm()}
      onCancel={pop}
      body={
        <>
          {typeof body === "string" ? <p>{body}</p> : body}
          {error ? (
            <p role="alert" className="mq-confirm-error">
              {explain(error)}
            </p>
          ) : null}
        </>
      }
    />
  );
}

/** The pushed level one destructive control opens in Marquee. */
export function marqueeConfirmLevel(options: MarqueeConfirmOptions): NewShellLevel {
  return {
    id: options.id,
    name: options.title,
    kind: "overlay",
    payload: {
      render: () => <MarqueeConfirm {...options} />,
    },
  };
}
