/**
 * Which tier box a Stream row draws (sheet `C5`): lavender for the 4K class,
 * the quiet surface for everything else. The label is whatever the client read
 * out of the Addon's words; this only says which of the two boxes it takes.
 */

export type StreamTierTone = "uhd" | "hd";

export function tierTone(label: string): StreamTierTone {
  return /^(4k|2160p|uhd)$/i.test(label.trim()) ? "uhd" : "hd";
}
