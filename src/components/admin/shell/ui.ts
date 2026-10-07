import type { Audience, UserRole } from "@prisma/client";

/**
 * The admin console's UI kit as class strings, so every console page reads as
 * one product in the NAAM 2026 "Sāchu" brand: ink is the primary colour, coral
 * the accent (focus rings, highlights, calls to action on ink panels) and ember
 * the destructive tone, on the sand canvas with white `.card` surfaces. Safe to
 * import from server and client components alike.
 *
 * Text colours are solid ink steps (ink-500 for muted text, 600/700 for
 * secondary, 900 for strong), not translucent ink: the brand ink is light
 * enough that ink-800/50 on white falls below WCAG AA. ink-400 and lighter are
 * for icons and decoration only.
 */

/** Coral focus outline for the console's controls (3:1 against white and sand). */
export const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral-600";

const BTN = `inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm transition active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 ${FOCUS}`;

// No font weight in BTN: Tailwind emits .font-semibold after .font-bold, so a
// shared weight would override the accent's bold. Each variant sets its own.
export const BUTTON = {
  primary: `${BTN} font-semibold bg-ink-900 text-white shadow-card hover:bg-ink-800`,
  secondary: `${BTN} font-semibold border border-ink-800/12 bg-white/85 text-ink-900 shadow-card hover:border-ink-800/20 hover:bg-white`,
  destructive: `${BTN} font-semibold border border-ember-500/25 bg-white/80 text-ember-600 hover:border-ember-500/40 hover:bg-ember-500/5`,
  /** The brand's coral call to action, for ink panels. Ink text: white on coral-400 fails AA. */
  accent: `${BTN} font-bold bg-coral-400 text-ink-950 shadow-glow hover:bg-coral-300`,
} as const;

/** Small uppercase pill; combine with a tone, e.g. `${BADGE} ${ROLE_BADGE.SANT.tone}`. */
export const BADGE = "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em]";

/** Field, column and legend label: the brand guide's wide-set Just Sans caps. */
export const LABEL = "text-[11px] font-bold uppercase tracking-[0.14em] text-ink-500";

/** Tracked-caps line above an Enilas page or card title (on the sand canvas or white). */
export const EYEBROW = "text-[10px] font-bold uppercase tracking-[0.24em] text-coral-800";

/** Delegates quiet (sand), santos warm (coral), admins in the console's ink. */
export const ROLE_BADGE: Record<UserRole, { label: string; tone: string }> = {
  DELEGATE: { label: "Delegate", tone: "bg-sand-200 text-ink-700" },
  SANT: { label: "Sant", tone: "bg-coral-100 text-coral-800" },
  ADMIN: { label: "Admin", tone: "bg-ink-800 text-white" },
};

/**
 * Schedule track chips: shared items, the Bhaio (gents) and the Behno (ladies)
 * track. Both tracks are ink (solid and pale), never coral: coral means "late"
 * (DRIFT_TONE) and these sit right beside the drift badges.
 */
export const TRACK_CHIP: Record<Audience, { label: string; tone: string }> = {
  ALL: { label: "All", tone: "bg-sand-200 text-ink-600" },
  BHAIO: { label: "Bhaio", tone: "bg-ink-800 text-white" },
  BEHNO: { label: "Behno", tone: "bg-ink-800/10 text-ink-800" },
};

/**
 * How the programme compares with the printed times, on light surfaces:
 * late is coral, early and on time are jade (the teal gradient's light end).
 */
export const DRIFT_TONE = {
  late: "bg-coral-100 text-coral-800",
  early: "bg-jade-100 text-jade-700",
  onTime: "bg-jade-100 text-jade-700",
  neutral: "bg-ink-800/8 text-ink-700",
} as const;
