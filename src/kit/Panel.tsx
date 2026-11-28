/**
 * The Marquee panels (sheet `C5`, `docs/design-system.md` §8): the 936×1032
 * side panel the Streams picker slides in on, and the 840×540 floating panel of
 * the player's menus, in two columns split by a rule.
 *
 * A panel is a surface, not a place: where it sits on the screen, its scrim and
 * what Back does belong to the client that opens it. Extra `data-*` attributes
 * pass to the surface, so a client can mark its own focus region.
 */

import { AnimatePresence, motion } from "motion/react";
import { useId, type ReactNode } from "react";

import { useReducedMotion } from "../core/react/useReducedMotion";
import { cx } from "./cx";
import { panelMotion, panelTransition, type PanelPlacement } from "./panelMotion";
import { PpIconButton, u } from "./ppParts";

type CommonPanelProps = {
  /** Whether the panel is up; closing plays its exit before it leaves. */
  open?: boolean;
  /** A size of the client's own, in reference-frame units. */
  width?: number;
  height?: number;
  id?: string;
  className?: string;
  "aria-label"?: string;
  children?: ReactNode;
};

export type SidePanelProps = CommonPanelProps & {
  placement?: "side";
  title: string;
  subtitle?: string;
  /** Draws the close control where the client gives it something to do. */
  onClose?: () => void;
  closeLabel?: string;
  closeFocused?: boolean;
};

export type FloatingPanelProps = CommonPanelProps & {
  placement: "floating";
  /** A floating panel draws no title of its own, so the client names the dialog. */
  "aria-label": string;
  /** Two `PanelColumn`s of equal width with a rule between them. */
  split?: boolean;
  /** `compact` is the 420-wide menu with one column. */
  size?: "default" | "compact";
};

export type PanelProps = SidePanelProps | FloatingPanelProps;

export function Panel(props: PanelProps) {
  return props.placement === "floating" ? (
    <FloatingPanel {...props} />
  ) : (
    <SidePanel {...props} />
  );
}

type SurfaceProps = CommonPanelProps & {
  placement: PanelPlacement;
  "aria-labelledby"?: string;
  "data-size"?: string;
  "data-split"?: string;
};

function Surface({
  open = true,
  placement,
  width,
  height,
  className,
  children,
  ...rest
}: SurfaceProps) {
  const reduced = useReducedMotion();

  return (
    <AnimatePresence>
      {open ? (
        <motion.section
          key="panel"
          {...rest}
          {...panelMotion(placement, reduced)}
          transition={panelTransition(reduced)}
          className={cx("mq-pp mq-pp-panel", className)}
          style={{
            ...(width === undefined ? {} : { width: u(width) }),
            ...(height === undefined ? {} : { height: u(height) }),
          }}
          role="dialog"
          data-placement={placement}
        >
          {children}
        </motion.section>
      ) : null}
    </AnimatePresence>
  );
}

function SidePanel({
  placement: _placement,
  title,
  subtitle,
  onClose,
  closeLabel = "Close",
  closeFocused,
  children,
  ...surface
}: SidePanelProps) {
  const titleId = useId();

  return (
    <Surface
      {...surface}
      placement="side"
      aria-labelledby={surface["aria-label"] ? undefined : titleId}
    >
      <header className="mq-pp-panel-head">
        <h2 id={titleId} className="mq-pp-panel-title">
          {title}
        </h2>
        {subtitle ? <p className="mq-pp-panel-subtitle">{subtitle}</p> : null}
        {onClose ? (
          <PpIconButton
            className="mq-pp-panel-close"
            size="M"
            icon="x"
            label={closeLabel}
            focused={closeFocused}
            onClick={onClose}
          />
        ) : null}
      </header>
      <div className="mq-pp-panel-body">{children}</div>
    </Surface>
  );
}

function FloatingPanel({
  placement: _placement,
  split = false,
  size = "default",
  ...surface
}: FloatingPanelProps) {
  return (
    <Surface
      {...surface}
      placement="floating"
      data-size={size}
      data-split={split ? "true" : undefined}
    />
  );
}

export type PanelColumnProps = {
  /** The column's head: `Subtitles`, `Audio`, `Playback`. */
  title?: string;
  /** Controls at the end of the head, such as the chapter steps. */
  actions?: ReactNode;
  /**
   * `rows` indents the head 12u from the rows, as over a list of options;
   * `text` lines head and body up, as over a column of statistics.
   */
  align?: "rows" | "text";
  children: ReactNode;
};

/** One column of a floating panel: a head and a list that scrolls under it. */
export function PanelColumn({ title, actions, align = "rows", children }: PanelColumnProps) {
  const titleId = useId();

  return (
    <div
      className="mq-pp-column"
      data-align={align}
      role={title ? "group" : undefined}
      aria-labelledby={title ? titleId : undefined}
    >
      {title || actions ? (
        <div className="mq-pp-column-head">
          {title ? (
            <h3 id={titleId} className="mq-pp-column-title">
              {title}
            </h3>
          ) : null}
          {actions ? <div className="mq-pp-column-actions">{actions}</div> : null}
        </div>
      ) : null}
      <div className="mq-pp-column-body">{children}</div>
    </div>
  );
}
