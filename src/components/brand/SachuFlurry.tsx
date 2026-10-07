import type { CSSProperties } from "react";
import styles from "./sachuFlurry.module.css";

/**
 * Palette: "coral" (coral-400 and sand on ink, the delegate home) or "ember" (coral-200 and
 * sand, lifted for the Santo hero's coral → ember sandhya).
 */
export type SachuFlurryTone = "coral" | "ember";

type Word = {
  /** Centre of the word, as % of the box's width / height. */
  x: number;
  y: number;
  /** Font size as % of the box's width (cqw). "SĀCHU" is about 3.2 em wide. */
  size: number;
  opacity: number;
  /** Outlined like the logo's inline lettering (else a solid fill). */
  line?: boolean;
  /** Sand instead of the coral accent. */
  light?: boolean;
  /** Degrees. */
  rotate?: number;
};

/**
 * The flurry, hand-placed for a 9:4 box (a fixed table, never random, so the server and
 * client render the same thing). Back to front: faint small words high up where the band
 * fades into the hero, a middle tier, then three big words across the bottom edge, the
 * centre one outlined like the logo, the two coral ones bleeding off the sides.
 */
const WORDS: readonly Word[] = [
  // High and small: mostly lost in the top fade, like the last flakes of the flurry.
  { x: 9, y: 8, size: 2.4, opacity: 0.3, light: true },
  { x: 29, y: 17, size: 2.2, opacity: 0.45 },
  { x: 49, y: 6, size: 2.6, opacity: 0.3, light: true },
  { x: 70, y: 15, size: 2.2, opacity: 0.4 },
  { x: 91, y: 5, size: 2.6, opacity: 0.35, light: true },
  { x: 13, y: 29, size: 3, opacity: 0.45 },
  { x: 40, y: 33, size: 2.6, opacity: 0.4, light: true },
  { x: 61, y: 25, size: 3.4, opacity: 0.3, light: true, rotate: -4 },
  { x: 83, y: 31, size: 3, opacity: 0.45 },
  // Middle tier.
  { x: 4, y: 47, size: 5, opacity: 0.5, line: true, light: true, rotate: -9 },
  { x: 29, y: 51, size: 6.5, opacity: 0.8, line: true },
  { x: 53, y: 42, size: 3.8, opacity: 0.6 },
  { x: 76, y: 51, size: 7.5, opacity: 0.25, light: true, rotate: 3 },
  { x: 97, y: 38, size: 5.5, opacity: 0.55, line: true, rotate: 8 },
  { x: 16, y: 67, size: 3.2, opacity: 0.55 },
  { x: 45, y: 63, size: 3.4, opacity: 0.5, light: true },
  { x: 62, y: 69, size: 2.8, opacity: 0.6 },
  { x: 88, y: 66, size: 3.8, opacity: 0.45, light: true },
  // The big three along the bottom edge.
  { x: 3, y: 83, size: 10.5, opacity: 0.5, rotate: -6 },
  { x: 50, y: 88, size: 17, opacity: 0.62, line: true, light: true },
  { x: 97, y: 91, size: 12, opacity: 0.5 },
];

const DRIFT = [styles.driftA, styles.driftB, styles.driftC];

/**
 * "SĀCHU" (with the macron, as in the logo) repeated across a band in the Enilas display
 * face: small to large, faint to bold, solid and outlined, a few words tilted. Decorative
 * (aria-hidden, no pointer events, not selectable): the home heroes use it where the Edison
 * mandir drawing used to sit, under the greeting and clock. It clips to its own box (give it
 * the parent's corner radius, e.g. `rounded-b-[2rem]`) and fades out towards the top so it
 * never competes with the text above. A slow drift runs only with motion allowed.
 *
 *   <SachuFlurry tone="coral" className="rounded-b-[2rem]" />
 *
 * The box is 9:4 by default; size it by width (it fills its container).
 */
export function SachuFlurry({ tone = "coral", className = "" }: { tone?: SachuFlurryTone; className?: string }) {
  return (
    <div aria-hidden="true" className={`${styles.root} ${styles[tone]} ${className}`}>
      {WORDS.map((w, i) => {
        const period = 9 + ((i * 5) % 7);
        const style = {
          left: `${w.x}%`,
          top: `${w.y}%`,
          opacity: w.opacity,
          transform: `translate(-50%, -50%)${w.rotate ? ` rotate(${w.rotate}deg)` : ""}`,
          "--s": w.size,
          "--t": `${period}s`,
          // Negative delays start every word mid-drift, each at its own phase.
          "--d": `-${((i * 2.3) % period).toFixed(1)}s`,
        } as CSSProperties;
        const kind = `${w.line ? styles.line : ""} ${w.light ? styles.light : ""}`;
        return <span key={i} className={`${styles.word} ${kind} ${DRIFT[i % DRIFT.length]}`} style={style} />;
      })}
    </div>
  );
}
