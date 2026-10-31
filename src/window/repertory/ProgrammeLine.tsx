/**
 * A screen's programme line: the destination in brass mono on the left, then
 * the hairline to the right edge (design record §8). It is the only head a
 * base screen prints; a screen's own name is not repeated above its content.
 */
export function ProgrammeLine({ name, testId }: { name: string; testId?: string }) {
  return (
    <p className="rep-programme-line" data-testid={testId}>
      <span className="rep-programme-line-name">{name}</span>
      <span className="rep-rule" aria-hidden="true" />
    </p>
  );
}
