import type { CSSProperties } from "react";

// Built by scripts/build-brand-assets.py from the same drawing as <MandirArt>.
const MARK = "url(/brand/edison-mark.webp)";

const MASK: CSSProperties = {
  WebkitMaskImage: MARK,
  maskImage: MARK,
  WebkitMaskSize: "contain",
  maskSize: "contain",
  WebkitMaskPosition: "center",
  maskPosition: "center",
  WebkitMaskRepeat: "no-repeat",
  maskRepeat: "no-repeat",
};

/**
 * The Edison mandir mark: the three central shikhars under their beaded arch,
 * cut from the organisers' line art with bolder strokes so it still reads at
 * icon sizes (16-44px; also fine as a large faint watermark). Nearly square; it
 * sits centred in whatever box `className` gives it, e.g. "h-6 w-6". Colour
 * follows `currentColor`. Decorative (aria-hidden).
 *
 * Since the Sāchu theme this is NOT the event logo (that's <SachuLogo>/<SachuMark>
 * in src/components/brand/Sachu.tsx). Use it only where the Edison mandir itself is
 * meant: the venue, the Akshardham schedule row, the History page.
 */
export function MandirMark({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" className={`block aspect-square shrink-0 bg-current ${className}`} style={MASK} />;
}
