/**
 * The overline that heads the Streams one Addon answered with (sheet `C5`).
 * The name is given as the Addon spells it; the sheet sets it in capitals.
 */
export function GroupLabel({ children, id }: { children: string; id?: string }) {
  return (
    <h3 id={id} className="mq-pp mq-pp-group-label">
      {children}
    </h3>
  );
}
