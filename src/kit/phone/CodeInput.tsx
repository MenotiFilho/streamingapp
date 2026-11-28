import { useState } from "react";

import { normalizePairingEntry, pairingCells, PAIRING_CODE_LENGTH } from "./pairingEntry";

export type CodeInputProps = {
  /** What the cells hold. */
  value: string;
  onChange: (code: string) => void;
  /** Called when an entry reaches six characters. */
  onComplete?: (code: string) => void;
  /** The accessible name. */
  label?: string;
  autoFocus?: boolean;
  disabled?: boolean;
};

/**
 * The six-character Pairing code, typed once (sheet `C8`, "Code input · phone").
 * One real field over six drawn cells, so the phone's keyboard, paste and the
 * one-time-code autofill work as they do on any field.
 */
export function CodeInput({
  value,
  onChange,
  onComplete,
  label = "Pairing code",
  autoFocus = false,
  disabled = false,
}: CodeInputProps) {
  const [focused, setFocused] = useState(false);
  const entry = normalizePairingEntry(value);

  const take = (next: string) => {
    if (next === entry) {
      return;
    }
    onChange(next);
    if (next.length === PAIRING_CODE_LENGTH) {
      onComplete?.(next);
    }
  };
  const toEnd = (field: HTMLInputElement) => {
    const end = field.value.length;
    if (field.selectionStart !== end || field.selectionEnd !== end) {
      field.setSelectionRange(end, end);
    }
  };

  return (
    <div className="mq-ph-code" data-disabled={disabled || undefined}>
      <input
        className="mq-ph mq-ph-code-field"
        data-focusable
        type="text"
        aria-label={label}
        value={entry}
        inputMode="text"
        autoComplete="one-time-code"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        autoFocus={autoFocus}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onSelect={(event) => {
          // Editing is at the end only: the cells draw no cursor elsewhere.
          if (event.currentTarget.selectionStart === event.currentTarget.selectionEnd) {
            toEnd(event.currentTarget);
          }
        }}
        onChange={(event) => take(normalizePairingEntry(event.target.value))}
        onPaste={(event) => {
          // A pasted whole code replaces what was typed rather than joining it.
          const pasted = normalizePairingEntry(event.clipboardData.getData("text"));
          if (pasted.length === PAIRING_CODE_LENGTH) {
            event.preventDefault();
            take(pasted);
          }
        }}
      />
      {pairingCells(entry, focused).map((cell, index) => (
        <span
          key={index}
          className="mq-ph-code-cell"
          data-active={cell.active || undefined}
          aria-hidden="true"
        >
          {cell.char}
          {cell.active ? <span className="mq-ph-code-caret" /> : null}
        </span>
      ))}
    </div>
  );
}
