import { cx } from "./cx";

export type ScreenTitleProps = {
  /** The destination's name. */
  title: string;
  /** Where its Titles come from: *From TMDB*. */
  subtitle?: string;
  className?: string;
};

/** The head of a destination: its name, and optionally where its Titles come from. */
export function ScreenTitle({ title, subtitle, className }: ScreenTitleProps) {
  return (
    <header className={cx("mq-c7-screen-title", className)}>
      <h1>{title}</h1>
      {subtitle ? <p>{subtitle}</p> : null}
    </header>
  );
}
