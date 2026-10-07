/** Admin UI kit classes for the announcements page; buttons, badges and labels come from the console's shared kit. */
import { BADGE as KIT_BADGE, BUTTON, FOCUS, LABEL as KIT_LABEL } from "@/components/admin/shell/ui";

export const BTN_PRIMARY = BUTTON.primary;
export const BTN_SECONDARY = BUTTON.secondary;
export const BTN_DESTRUCTIVE = BUTTON.destructive;
/** Coral call to action on the ink send panel. */
export const BTN_ACCENT = BUTTON.accent;
export const BADGE = KIT_BADGE;

/** Compact variants for row actions (still a 44px tap target). */
export const BTN_SMALL_SECONDARY = `inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-ink-800/12 bg-white/85 px-3 py-2 text-xs font-semibold text-ink-900 transition hover:border-ink-800/20 hover:bg-white active:scale-[0.98] disabled:opacity-50 ${FOCUS}`;
export const BTN_SMALL_DESTRUCTIVE = `inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-ember-500/25 bg-white/80 px-3 py-2 text-xs font-semibold text-ember-600 transition hover:border-ember-500/40 hover:bg-ember-500/5 active:scale-[0.98] disabled:opacity-50 ${FOCUS}`;

/**
 * Text input / select / textarea. Built whole rather than patched with extra
 * classes: Tailwind orders conflicting utilities by its stylesheet, not by
 * their order in `className`, so overrides can't be appended.
 */
export function inputClass({ invalid = false, padding = "px-3.5 py-2.5" }: { invalid?: boolean; padding?: string } = {}) {
  return `w-full rounded-xl border bg-white ${padding} text-base text-ink-900 outline-none transition placeholder:text-ink-400 focus:ring-2 md:text-sm ${
    invalid
      ? "border-ember-500/60 focus:border-ember-500 focus:ring-ember-500/20"
      : "border-ink-800/15 hover:border-ink-800/25 focus:border-coral-500 focus:ring-coral-400/35"
  }`;
}
export const LABEL = KIT_LABEL;
/** Card titles in Enilas (20px: its swash capitals want room). */
export const CARD_TITLE = "font-display text-xl leading-tight text-ink-900";
export const FIELD_ERROR = "mt-1.5 text-xs font-medium text-ember-600";
export const HINT = "mt-1.5 text-[11px] leading-snug text-ink-500";
export const HINT_WARN = "mt-1.5 text-[11px] font-semibold leading-snug text-coral-800";

/** Option tile (category, send now / schedule): a single-choice toggle button. */
export function tileClass(on: boolean) {
  return `rounded-2xl border text-left transition active:scale-[0.98] ${FOCUS} ${
    on
      ? "border-ink-900 bg-white text-ink-900 shadow-card ring-1 ring-ink-900"
      : "border-ink-800/12 bg-white/70 text-ink-700 hover:border-ink-800/20 hover:bg-white"
  }`;
}

/**
 * Filter / facet chip. `before:` widens the hit area to 44px tall without
 * making the pill itself bulky (rows of chips wrap with a small gap).
 */
export const CHIP = `relative min-h-9 rounded-full border px-3 py-1.5 text-xs font-semibold transition before:absolute before:inset-x-0 before:-inset-y-1 before:content-[''] ${FOCUS}`;
export const CHIP_ON = "border-ink-900 bg-ink-900 text-white";
export const CHIP_OFF = "border-ink-800/12 bg-white/85 text-ink-700 hover:border-ink-800/25 hover:bg-white";
/**
 * Use instead of CHIP_OFF (not with it) for an unpicked value that reaches nobody:
 * dashed and muted in solid ink-500 (AA on white), still tappable.
 */
export const CHIP_EMPTY = "border-dashed border-ink-800/20 bg-white/60 text-ink-500 hover:border-ink-800/30 hover:bg-white";
/** Count inside a chip. */
export const chipCount = (on: boolean) => `ml-1.5 font-medium tabular-nums ${on ? "text-white/70" : "text-ink-500"}`;
