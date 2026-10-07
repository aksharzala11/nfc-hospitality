/**
 * The official "Sāchu" 2027 Karyakar theme artwork, NAAM 2026's branding (organisers' brand kit, built into
 * public/brand/sachu/ by scripts/build-sachu-assets.py). Plain <img>s: they're small static
 * WebPs, and the standalone Docker image has no image optimiser.
 *
 * Usage rules, from the brand guide:
 *  - Logos are never recoloured, stretched, cropped further, outlined or put behind text.
 *    Pick the variant for the background: "full" / "flat" on white or sand, "single" on sand,
 *    "white" on ink or coral.
 *  - The murti (Bhagwan Swaminarayan with Aksharbrahman Gunatitanand Swami) and the standard
 *    BAPS footer (Pramukh Swami Maharaj, Mahant Swami Maharaj) are sacred images: show them
 *    whole, unaltered, never tinted, blurred, masked, animated, overlapped or used as a
 *    background, at most once per screen, murti near the top as in the guide.
 *
 * Sizing: give ONE dimension (e.g. "w-48" or "h-8"); the other follows the artwork's aspect
 * (the `.brand-art` base rule in globals.css). If both are given, the art is contained inside
 * that box, never stretched.
 */

/** Base classes of every brand image: aspect-true sizing, never stretched, not selectable. */
const ART = "brand-art select-none object-contain";

export type SachuVariant = "full" | "flat" | "single" | "white";

const LOCKUP = { w: 960, h: 503 };
const MARK = { w: 566, h: 640 };

/**
 * The full lock-up: the chhatri mark with "SĀCHU" three times. About 1.9:1, so size it by
 * width (or height) only.
 */
export function SachuLogo({
  variant = "full",
  className = "",
  priority = false,
}: {
  variant?: SachuVariant;
  className?: string;
  /** Eager-load when it's above the fold (login, home hero). */
  priority?: boolean;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/brand/sachu/logo-${variant}.webp`}
      width={LOCKUP.w}
      height={LOCKUP.h}
      alt="Sāchu, the 2027 Karyakar theme"
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      className={`${ART} ${className}`}
      draggable={false}
    />
  );
}

/**
 * The mark alone (the chhatri with the seated figures), about 0.88:1. For small brand spots:
 * headers, tiles, footers, icons. Decorative by default; pass `label` when it stands alone.
 */
export function SachuMark({
  variant = "full",
  className = "",
  label,
  priority = false,
}: {
  variant?: SachuVariant;
  className?: string;
  label?: string;
  priority?: boolean;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/brand/sachu/mark-${variant}.webp`}
      width={MARK.w}
      height={MARK.h}
      alt={label ?? ""}
      aria-hidden={label ? undefined : true}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      className={`${ART} ${className}`}
      draggable={false}
    />
  );
}

/**
 * Murti art of Bhagwan Swaminarayan and Aksharbrahman Gunatitanand Swami (1000x680,
 * transparent). Sacred: whole and unaltered, never overlapped; at most once per screen.
 */
export function Murti({ className = "", priority = false }: { className?: string; priority?: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand/sachu/apm.webp"
      width={1000}
      height={680}
      alt="Bhagwan Swaminarayan and Aksharbrahman Gunatitanand Swami"
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      className={`${ART} ${className}`}
      draggable={false}
    />
  );
}

/**
 * The standard BAPS footer (white artwork): Brahmaswarup Pramukh Swami Maharaj, the BAPS
 * logo and Pragat Brahmaswarup Mahant Swami Maharaj, with "BAPS Swaminarayan Sanstha |
 * www.BAPS.org". Only on an ink (or darker) background. Sacred: never cropped or tinted.
 */
export function BapsFooter({ className = "" }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand/sachu/baps-footer-white.webp"
      width={1400}
      height={255}
      alt="Brahmaswarup Pramukh Swami Maharaj and Pragat Brahmaswarup Mahant Swami Maharaj. BAPS Swaminarayan Sanstha, www.BAPS.org"
      loading="lazy"
      decoding="async"
      className={`${ART} ${className}`}
      draggable={false}
    />
  );
}
