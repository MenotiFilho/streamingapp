import { motion } from "motion/react";
import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";

import { useReducedMotion } from "../core/react/useReducedMotion";
import { cx } from "./cx";
import { FormsIconButton } from "./FormsButton";
import { formsPanel } from "./formsMotion";
import { Icon } from "./icons";
import { Switch } from "./Switch";
import { staysWithRow, useRowFocus } from "./useRowFocus";

/**
 * Props carry only what the Manifest says (ADR-0044 §1). There is no URL, no
 * origin and no health: the Host publishes none of them (ADR-0009).
 */
export type AddonRowProps = {
  /** The Manifest's name. */
  name: string;
  /** What it serves, in the row's words: `Streams · movies, series`. */
  serves: string;
  /** The Manifest's version. */
  version: string;
  /** Whether the Host asks this Addon, as it last said. */
  enabled: boolean;
  /** Whether the row is being moved along the list. */
  moving?: boolean;
  /** Whether there is a place above, and below, to move to. */
  canMoveUp: boolean;
  canMoveDown: boolean;
  onToggle: (next: boolean) => void;
  onDetails: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  /** OK on a moving row: leave it where it is. */
  onPlace?: () => void;
  /** OK on the row at rest. */
  onPress?: () => void;
  /** Draw it focused, with its controls, for a caller that holds the focus itself. */
  focused?: boolean;
  className?: string;
};

/** The version as the row prints it: `v0.0.15`, never `vv0.0.15`. */
export function versionLabel(version: string): string {
  return /^v\d/i.test(version) ? version : `v${version}`;
}

const MOVE_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

/**
 * One installed Addon. Focused, it offers details, move up, move down and
 * remove beside its switch; moving, it rides along until OK places it.
 *
 * The row is its own focus region: the Addon itself, then its controls. While
 * it moves, the arrows are the row's own (it claims them before the focus
 * engine can walk away); a pad has no key event, so a screen routes the pad's
 * Up and Down through its level's `onIntent`.
 */
export function AddonRow({
  name,
  serves,
  version,
  enabled,
  moving = false,
  canMoveUp,
  canMoveDown,
  onToggle,
  onDetails,
  onMoveUp,
  onMoveDown,
  onRemove,
  onPlace,
  onPress,
  focused,
  className,
}: AddonRowProps) {
  const id = useId();
  const reduced = useReducedMotion();
  const servesId = `${id}-serves`;
  const versionId = `${id}-version`;
  const hintId = `${id}-hint`;
  const row = useRef<HTMLDivElement>(null);
  const rowFocus = useRowFocus();
  /** Whether the focus is in the row, or left it only for a question it asked. */
  const [holding, setHolding] = useState(false);

  const focus = (event: FocusEvent<HTMLDivElement>) => {
    rowFocus.onFocus(event);
    setHolding(true);
  };

  // Focus moving along the row stays in it. Focus moving into a question this
  // row opened keeps the controls too, so Back finds the one that asked.
  const blur = (event: FocusEvent<HTMLDivElement>) => {
    if (rowFocus.onBlur(event)) {
      setHolding(false);
    }
  };

  // Once a question has the focus, no blur of the row's says where it goes
  // next. So the row listens: landing anywhere else lets the controls go.
  useEffect(() => {
    if (!holding) {
      return;
    }
    const landed = ({ target }: Event) => {
      if (!staysWithRow(row.current, target)) {
        rowFocus.forget();
        setHolding(false);
      }
    };
    document.addEventListener("focusin", landed);
    return () => document.removeEventListener("focusin", landed);
  }, [holding]);

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!moving || !MOVE_KEYS.has(event.key)) {
      return;
    }
    event.preventDefault();
    // One press is one place: a held key must not queue a run of reorders.
    if (event.repeat) {
      return;
    }
    if (event.key === "ArrowUp" && canMoveUp) {
      onMoveUp();
    } else if (event.key === "ArrowDown" && canMoveDown) {
      onMoveDown();
    }
  };

  const offering = !moving && (holding || Boolean(focused));

  return (
    <motion.div
      ref={row}
      layout="position"
      transition={{ layout: formsPanel(reduced) }}
      className={cx("mq-c7-addon", className)}
      role="group"
      aria-label={name}
      data-enabled={enabled}
      data-moving={moving || undefined}
      data-focused={focused || undefined}
      data-region={`addon:${id}`}
      data-kind="row"
      data-label={name}
      onFocus={focus}
      onBlur={blur}
      onKeyDown={keyDown}
    >
      <button
        ref={rowFocus.main}
        type="button"
        className="mq-c7-row-main"
        aria-label={name}
        aria-describedby={cx(servesId, versionId, moving && hintId)}
        data-focusable
        onClick={moving ? onPlace : onPress}
      >
        <span className="mq-c7-addon-tile">
          <Icon name="puzzle" size="calc(var(--mq-u) * 34)" />
        </span>
        <span className="mq-c7-addon-text">
          <span className="mq-c7-addon-name mq-c7-ellipsis">{name}</span>
          <span id={servesId} className="mq-c7-addon-serves mq-c7-ellipsis">
            {serves}
          </span>
          <span id={versionId} className="mq-c7-addon-version mq-c7-ellipsis">
            {versionLabel(version)}
          </span>
        </span>
      </button>

      {moving ? (
        <>
          <span id={hintId} className="mq-c7-addon-hint">
            Up and down to move · OK to place
          </span>
          <Icon name="handle" size="calc(var(--mq-u) * 28)" className="mq-c7-addon-handle" />
        </>
      ) : (
        <>
          {offering ? (
            <span className="mq-c7-row-actions">
              <FormsIconButton label="Details" icon="info" onClick={onDetails} />
              <FormsIconButton
                label="Move up"
                icon="arrow-up"
                disabled={!canMoveUp}
                onClick={onMoveUp}
              />
              <FormsIconButton
                label="Move down"
                icon="arrow-down"
                disabled={!canMoveDown}
                onClick={onMoveDown}
              />
              <FormsIconButton label="Remove" icon="trash" onClick={onRemove} />
            </span>
          ) : null}
          <Switch checked={enabled} onChange={onToggle} label={`Enable ${name}`} />
        </>
      )}
    </motion.div>
  );
}
