import { explain, type ActionError } from "../host-client";

/**
 * A refusal, beside the control or list that raised it.
 *
 * Screens that take Actions with `ask` own their refusals: one failed reorder
 * must not take the whole screen with it, and a confirmation that the Host
 * refused stays open to say why. `explain` is still the one place the Host's
 * vocabulary becomes a sentence.
 */
export function Refusal({
  error,
  testId,
}: {
  error: ActionError | null;
  testId?: string;
}) {
  if (!error) {
    return null;
  }
  return (
    <p role="alert" className="shell-inline-refusal" data-testid={testId}>
      {explain(error)}
    </p>
  );
}
