import { cx } from "./cx";

/** How many characters a Pairing code is (`host-core`'s `PAIRING_CODE_LEN`). */
export const PAIRING_CELLS = 6;

/**
 * A Pairing code as six cells. Case, spaces and hyphens are how somebody wrote
 * it and not part of it, as the Host reads one; a short code leaves its last
 * cells empty, and nothing past the sixth character is drawn.
 */
export function pairingCells(code: string): string[] {
  const spelled = Array.from(code.replace(/[\s-]/g, "").toUpperCase());
  return Array.from({ length: PAIRING_CELLS }, (_, index) => spelled[index] ?? "");
}

export type PairingCodeProps = {
  /** The code the Host is showing. */
  code: string;
  /** The Host's address on the network, as it says it; null when it serves none. */
  address: string | null;
  className?: string;
};

/** What a phone needs to pair: the Host's address and the single-use code. */
export function PairingCode({ code, address, className }: PairingCodeProps) {
  const cells = pairingCells(code);

  return (
    <div className={cx("mq-c7-pairing", className)}>
      <div className="mq-c7-pairing-code">
        <span className="mq-c7-pairing-overline">Pairing code</span>
        <div
          className="mq-c7-pairing-cells"
          role="img"
          aria-label={`Pairing code ${cells.filter(Boolean).join(" ")}`}
        >
          {cells.map((character, index) => (
            <span key={index} className="mq-c7-pairing-cell">
              {character}
            </span>
          ))}
        </div>
      </div>
      <div className="mq-c7-pairing-where">
        {address === null ? (
          <span className="mq-c7-pairing-hint">This Host is not serving the network.</span>
        ) : (
          <>
            <span className="mq-c7-pairing-hint">On the phone, open</span>
            <span className="mq-c7-pairing-address">{address}</span>
            <span className="mq-c7-pairing-note">
              and type this code. It works once, then changes.
            </span>
          </>
        )}
      </div>
    </div>
  );
}
