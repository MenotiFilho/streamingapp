import { motion, useReducedMotionConfig } from "motion/react";
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { useReducedMotion } from "../../../core/react/useReducedMotion";
import { Icon } from "../icons";
import { panel } from "../motion";
import { PhoneSwitchMark } from "./controls";
import { dragLimits, dragTarget, keyTarget } from "./editMove";

export type PhoneAddonRowProps = {
  /** The Addon's own name. */
  name: string;
  /** What it serves. Never its manifest URL or origin (ADR-0044 §1). */
  summary: string;
  disabled?: boolean;
} & (
  | {
      editing?: false;
      /** Whether the Host is asking it. */
      enabled: boolean;
      onToggle: (next: boolean) => void;
      /** A tap on the row, outside the switch: its details. */
      onOpen: () => void;
    }
  | {
      editing: true;
      /** Its position, from 0, among `count`. */
      index: number;
      count: number;
      /** One row and the gap under it, in px, as the screen lays them. */
      pitch?: number;
      /** Ask to remove it; the screen confirms. */
      onRemove: () => void;
      /** Put it at this position. */
      onMove: (to: number) => void;
    }
);

/**
 * One configured Addon (sheet `C8`, "Addon row · phone"), and its Edit mode:
 * remove on the left, a drag handle on the right. The row rides the list on the
 * panel spring when its position changes (ADR-0031).
 */
export function PhoneAddonRow(props: PhoneAddonRowProps) {
  const { name, summary, disabled = false } = props;
  const configuredReduced = useReducedMotionConfig();
  const systemReduced = useReducedMotion();
  const reduced = configuredReduced === true || systemReduced;

  return (
    <motion.div
      className="mq-ph-addon-slot"
      layout={props.editing && !reduced ? "position" : false}
      transition={reduced ? { duration: 0 } : panel()}
    >
      {props.editing ? (
        <EditingRow {...props} name={name} summary={summary} disabled={disabled} />
      ) : (
        <div className="mq-ph-addon">
          <button
            type="button"
            className="mq-ph mq-ph-addon-open mq-focus-row"
            data-focusable
            aria-label={`${name}, ${summary}`}
            disabled={disabled}
            onClick={props.onOpen}
          />
          <AddonFace name={name} summary={summary} />
          <button
            type="button"
            role="switch"
            aria-checked={props.enabled}
            aria-label={`Use ${name}`}
            className="mq-ph mq-ph-addon-switch mq-focus-control"
            data-focusable
            disabled={disabled}
            onClick={() => props.onToggle(!props.enabled)}
          >
            <PhoneSwitchMark on={props.enabled} />
          </button>
        </div>
      )}
    </motion.div>
  );
}

function AddonFace({ name, summary }: { name: string; summary: string }) {
  return (
    <>
      <span className="mq-ph-addon-logo" aria-hidden="true">
        <Icon name="puzzle" size={24} />
      </span>
      <span className="mq-ph-addon-name">{name}</span>
      <span className="mq-ph-addon-summary">{summary}</span>
    </>
  );
}

function EditingRow({
  name,
  summary,
  disabled,
  index,
  count,
  pitch,
  onRemove,
  onMove,
}: Extract<PhoneAddonRowProps, { editing: true }>) {
  const [offset, setOffset] = useState(0);
  const [moving, setMoving] = useState(false);
  const grabbed = useRef<{ id: number; y: number } | null>(null);

  const offsetOf = (event: ReactPointerEvent<HTMLElement>, from: number) => {
    const { min, max } = dragLimits(index, count, pitch);
    return Math.min(max, Math.max(min, event.clientY - from));
  };
  const release = () => {
    grabbed.current = null;
    setMoving(false);
    setOffset(0);
  };

  return (
    <div
      className="mq-ph-addon"
      data-editing="true"
      data-moving={moving || undefined}
      style={moving ? { transform: `translateY(${offset}px)` } : undefined}
    >
      <button
        type="button"
        className="mq-ph mq-ph-addon-remove mq-focus-control"
        data-focusable
        aria-label={`Remove ${name}`}
        disabled={disabled}
        onClick={onRemove}
      >
        <Icon name="minus-circle" weight="fill" size={26} />
      </button>
      <AddonFace name={name} summary={summary} />
      <button
        type="button"
        className="mq-ph mq-ph-addon-handle mq-focus-control"
        data-focusable
        aria-label={`Move ${name}`}
        aria-description={`Position ${index + 1} of ${count}. Up and down to move.`}
        disabled={disabled}
        onPointerDown={(event) => {
          if (disabled || event.button !== 0) {
            return;
          }
          grabbed.current = { id: event.pointerId, y: event.clientY };
          event.currentTarget.setPointerCapture?.(event.pointerId);
          setMoving(true);
        }}
        onPointerMove={(event) => {
          if (grabbed.current?.id === event.pointerId) {
            setOffset(offsetOf(event, grabbed.current.y));
          }
        }}
        onPointerUp={(event) => {
          if (grabbed.current?.id !== event.pointerId) {
            return;
          }
          const to = dragTarget(index, offsetOf(event, grabbed.current.y), count, pitch);
          release();
          if (to !== index) {
            onMove(to);
          }
        }}
        onPointerCancel={release}
        onLostPointerCapture={release}
        onKeyDown={(event) => {
          if (disabled || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) {
            return;
          }
          event.preventDefault();
          const to = keyTarget(event.key, index, count);
          if (to !== null) {
            onMove(to);
          }
        }}
      >
        <Icon name="handle" size={26} />
      </button>
    </div>
  );
}
