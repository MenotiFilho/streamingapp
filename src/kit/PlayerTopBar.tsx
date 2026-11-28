/**
 * The player's top band (sheet `C6`, 1920×200): back, the Title and the
 * episode, what the Stream plays, and close, over a scrim from the top.
 */

import { PpBadge, PpIconButton } from "./ppParts";

export type PlayerTopBarControl = "back" | "close";

export type PlayerTopBarProps = {
  title: string;
  /** The episode: `S2 E3 · Who Is Alive?`. */
  subtitle?: string | null;
  /** The Stream's marks, such as resolution, HDR and audio, verbatim. */
  facts?: ReadonlyArray<string>;
  onBack: () => void;
  onClose: () => void;
  backLabel?: string;
  closeLabel?: string;
  /** Draw this control focused, whatever the input modality. */
  focused?: PlayerTopBarControl;
};

export function PlayerTopBar({
  title,
  subtitle,
  facts = [],
  onBack,
  onClose,
  backLabel = "Back",
  closeLabel = "Close",
  focused,
}: PlayerTopBarProps) {
  return (
    <header className="mq-pp mq-pp-topbar">
      <PpIconButton
        icon="arrow-left"
        label={backLabel}
        focused={focused === "back"}
        onClick={onBack}
      />
      <div className="mq-pp-topbar-copy">
        <h1 className="mq-pp-topbar-title">{title}</h1>
        {subtitle ? <p className="mq-pp-topbar-subtitle">{subtitle}</p> : null}
      </div>
      {facts.length > 0 ? (
        <ul className="mq-pp-topbar-facts" aria-label="Stream">
          {facts.map((fact, index) => (
            <li key={`${index}:${fact}`}>
              <PpBadge>{fact}</PpBadge>
            </li>
          ))}
        </ul>
      ) : null}
      <PpIconButton
        icon="x"
        label={closeLabel}
        focused={focused === "close"}
        onClick={onClose}
      />
    </header>
  );
}
