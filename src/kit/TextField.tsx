import { useId, type InputHTMLAttributes, type Ref } from "react";

import { cx } from "./cx";

export type TextFieldProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type" | "className"
> & {
  /** Sits above the field. */
  label: string;
  value: string;
  onChange: (next: string) => void;
  type?: "text" | "password" | "url" | "email";
  /** A secret: drawn as dots, and kept from spelling aids. */
  masked?: boolean;
  /** Why what was typed was refused, in the Host's words. */
  error?: string | null;
  /** Draw it focused, for a caller that holds the focus itself. */
  focused?: boolean;
  ref?: Ref<HTMLInputElement>;
  className?: string;
};

/**
 * A labelled input: a manifest URL, the TMDB key. The caller keeps the value,
 * so a refused Action leaves what was pasted in place to correct.
 */
export function TextField({
  label,
  value,
  onChange,
  type = "text",
  masked = false,
  error,
  focused,
  id,
  className,
  ...rest
}: TextFieldProps) {
  const generated = useId();
  const inputId = id ?? generated;
  const errorId = `${inputId}-error`;

  return (
    <div className={cx("mq-c7-field", className)} data-focused={(focused && !rest.disabled) || undefined}>
      <label className="mq-c7-field-label" htmlFor={inputId}>
        {label}
      </label>
      <input
        autoComplete="off"
        {...rest}
        id={inputId}
        className="mq-c7-field-input"
        type={masked ? "password" : type}
        spellCheck={masked ? false : rest.spellCheck}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        data-focusable
      />
      {error ? (
        <p id={errorId} role="alert" className="mq-c7-field-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
