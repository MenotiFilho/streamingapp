import type { ReactNode } from "react";

import { explain, type ActionError } from "../core/errors";

/** The kinds of text a person pastes into the Host. */
export type FieldType = "text" | "search" | "password" | "url" | "email";

export type FieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: FieldType;
  placeholder?: string;
  autoComplete?: string;
  /** A control that belongs to this field, drawn at the end of its row. */
  trailing?: ReactNode;
  error?: ActionError | null;
  refusalTestId?: string;
  disabled?: boolean;
};

/**
 * The repertory form field: a mono caps label over a transparent input whose
 * only edge is a bottom hairline, an optional trailing control in the same row,
 * and the refusal under it.
 *
 * The field is controlled: the screen keeps the value, so a refused Action
 * leaves what was pasted in place to correct. A refusal is announced, names the
 * input it belongs to, and marks the input invalid — and only then.
 */
export function Field({
  id,
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  autoComplete,
  trailing,
  error = null,
  refusalTestId,
  disabled,
}: FieldProps) {
  const refusalId = `${id}-refusal`;

  return (
    <div className="rep-kit-field">
      <label className="rep-kit-field-label" htmlFor={id}>
        {label}
      </label>

      <div className="rep-kit-field-row">
        <input
          id={id}
          className="rep-kit-field-input"
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          disabled={disabled}
          data-focusable
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? refusalId : undefined}
        />
        {trailing ? (
          <span className="rep-kit-field-trailing">{trailing}</span>
        ) : null}
      </div>

      {error ? (
        <p
          id={refusalId}
          role="alert"
          className="rep-kit-field-refusal"
          data-testid={refusalTestId}
        >
          {explain(error)}
        </p>
      ) : null}
    </div>
  );
}
