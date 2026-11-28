import { useRef } from "react";

import { cx } from "./cx";
import { FormsIconButton } from "./FormsButton";
import { Icon } from "./icons";

export type SearchFieldProps = {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  /** The accessible name; the placeholder when omitted. */
  label?: string;
  autoFocus?: boolean;
  /** Draw it focused, for a caller that holds the focus itself. */
  focused?: boolean;
  className?: string;
};

/**
 * The search pill: a leading glass, the query, and a clear control while there
 * is a query. Focused, it inverts to white with ink content.
 */
export function SearchField({
  value,
  onChange,
  placeholder = "Search movies and series",
  label,
  autoFocus,
  focused,
  className,
}: SearchFieldProps) {
  const input = useRef<HTMLInputElement>(null);

  return (
    <div
      className={cx("mq-c7-search", className)}
      data-focused={focused || undefined}
      onClick={() => input.current?.focus()}
    >
      <Icon name="search" size="calc(var(--mq-u) * 26)" className="mq-c7-search-icon" />
      <input
        ref={input}
        type="search"
        className="mq-c7-search-input"
        aria-label={label ?? placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
        data-focusable
      />
      {value ? (
        <FormsIconButton
          label="Clear search"
          icon="x"
          className="mq-c7-search-clear"
          onClick={() => {
            // The control leaves with the query, so the focus goes to the box first.
            input.current?.focus();
            onChange("");
          }}
        />
      ) : null}
    </div>
  );
}
