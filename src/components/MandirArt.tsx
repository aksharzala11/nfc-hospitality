import type { CSSProperties } from "react";

/**
 * Where the drawing stops at the bottom:
 * - "ground" (default): the whole art, down to the solid ground strip
 * - "band": no ground strip; ends under the dashed band
 * - "floor": ends at the floor line, with no band or strip
 */
export type MandirBase = "ground" | "band" | "floor";

// Crop heights in the 2000 x 996 drawing. Every variant uses the same image:
// the cropped ones scale it to the element's width and clip the bottom.
const ASPECT: Record<MandirBase, string> = {
  ground: "aspect-[2000/996]",
  band: "aspect-[2000/893]",
  floor: "aspect-[2000/855]",
};

const IMAGE = "url(/brand/edison-mandir.webp)";

function maskStyle(base: MandirBase): CSSProperties {
  const size = base === "ground" ? "contain" : "100% auto";
  const position = base === "ground" ? "center" : "center top";
  return {
    WebkitMaskImage: IMAGE,
    maskImage: IMAGE,
    WebkitMaskSize: size,
    maskSize: size,
    WebkitMaskPosition: position,
    maskPosition: position,
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
  };
}

/**
 * The organisers' line art of BAPS Shri Swaminarayan Mandir, Edison NJ: the
 * full panorama (about 2:1) with its beaded arch, shikhars, domes and chhatris.
 * Since the Sāchu theme it is the venue skyline, not the event logo (that's
 * <SachuLogo>), so use it only where the Edison mandir itself is meant.
 * It is a CSS mask over the element's background, which is `currentColor`, so
 * tint it with a brand text-* class; a brand gradient also works:
 *   <MandirArt className="w-full text-ink-800/15" />
 *   <MandirArt base="band" className="w-72 bg-gradient-to-b from-jade-500 to-ink-800" />
 * Size it by width or by height, not both: the aspect ratio is built in.
 * Decorative (aria-hidden).
 */
export function MandirArt({ className = "", base = "ground" }: { className?: string; base?: MandirBase }) {
  return <span aria-hidden="true" className={`block bg-current ${ASPECT[base]} ${className}`} style={maskStyle(base)} />;
}
