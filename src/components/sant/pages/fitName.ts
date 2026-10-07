import type { CSSProperties } from "react";

/**
 * Enilas runs up to ~0.56em per letter on sant names ("Swayamprakashdas", "Ghanshyamcharandas"),
 * its 0.005em tracking included; 0.6 leaves a margin.
 */
const EM_PER_LETTER = 0.6;

/**
 * Inline font size that keeps a sant's name whole in Enilas: the design size, or smaller when
 * its longest word would not fit the nearest `@container` (so "Swayamprakashdas" never breaks
 * as "Swayamprakashda / s" on a 360px phone). Pair it with a `text-[…]` class of the same
 * design size and keep `break-words` as a last resort: a browser without container units drops
 * this declaration and falls back to the class.
 */
export function fitNameStyle(name: string, maxRem: number): CSSProperties {
  const longest = Math.max(1, ...name.split(/\s+/).map((word) => word.length));
  return { fontSize: `min(${maxRem}rem, ${(100 / (longest * EM_PER_LETTER)).toFixed(2)}cqw)` };
}
