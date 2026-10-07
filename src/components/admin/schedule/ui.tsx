import type { Audience } from "@prisma/client";
import { formatSignedMinutes, offsetFromPrinted, trackLabel, type TimedRow } from "@/lib/admin/schedule";
import { dayKey, formatTime, toEventLocalInput } from "@/lib/time";
import { BUTTON, DRIFT_TONE, FOCUS, LABEL, TRACK_CHIP } from "@/components/admin/shell/ui";

// Admin UI kit: buttons and labels come from the console's shared kit (src/components/admin/shell/ui.ts).
export const btnPrimary = BUTTON.primary;
export const btnSecondary = BUTTON.secondary;
export const btnDestructive = BUTTON.destructive;
/** Text input without a width, so callers can size it. */
export const inputBase =
  "min-h-11 rounded-xl border border-ink-800/15 bg-white px-3.5 py-2.5 text-base text-ink-900 outline-none transition placeholder:text-ink-400 hover:border-ink-800/25 focus:border-coral-500 focus:ring-2 focus:ring-coral-400/35 md:text-sm";
export const inputCls = `w-full ${inputBase}`;
export const labelCls = LABEL;
/**
 * Filter chip. `before:` widens the hit area to 44px tall without making the
 * pill itself bulky.
 */
export const chipCls = `relative min-h-9 rounded-full border px-3 py-1.5 text-xs font-semibold transition before:absolute before:inset-x-0 before:-inset-y-1 before:content-[''] ${FOCUS}`;
export const chipOn = "border-ink-900 bg-ink-900 text-white";
export const chipOff = "border-ink-800/12 bg-white/85 text-ink-700 hover:border-ink-800/25 hover:bg-white";

/** "5:30 PM" for an ISO instant, in the event timezone. */
export const timeOf = (iso: string) => formatTime(new Date(iso));
/** YYYY-MM-DD (event timezone) of an ISO instant. */
export const dayOf = (iso: string) => dayKey(new Date(iso));
/** "HH:mm" (event timezone) of an ISO instant, for <input type="time">. */
export const clockOf = (iso: string) => toEventLocalInput(new Date(iso)).slice(11);

export function plural(n: number, word: string, pluralWord = `${word}s`) {
  return `${n} ${n === 1 ? word : pluralWord}`;
}

/** Who a notification with this audience reaches. */
export function audienceText(audience: Audience) {
  if (audience === "BHAIO") return "Bhaio (gents)";
  if (audience === "BEHNO") return "Behno (ladies)";
  return "everyone";
}

/** Bhaio / Behno pill (the console's TRACK_CHIP tones); nothing for shared items. */
export function TrackChip({ audience, tone = "light" }: { audience: Audience | null; tone?: "light" | "dark" }) {
  const label = audience ? trackLabel(audience) : null;
  if (!audience || !label) return null;
  const cls = tone === "dark" ? "bg-white/12 text-white/90" : TRACK_CHIP[audience].tone;
  return (
    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${cls}`}>
      {label}
    </span>
  );
}

/** Coral for late, jade for early: tints for a signed number of minutes. */
export function lateEarlyTone(minutes: number, tone: "light" | "dark" = "light") {
  if (tone === "dark") {
    // The lightest tints, as LivePanel's QUICK_TONE: 11px text on the ink panel needs them for AA.
    return minutes > 0 ? "bg-coral-400/15 text-coral-100 ring-coral-300/30" : "bg-jade-400/15 text-jade-100 ring-jade-300/30";
  }
  return minutes > 0 ? `${DRIFT_TONE.late} ring-coral-400/35` : `${DRIFT_TONE.early} ring-jade-500/25`;
}

/** "+15 min" / "−10 min" / "ends +10 min" against the printed times; nothing when on time. */
export function OffsetBadge({ row, tone = "light" }: { row: TimedRow; tone?: "light" | "dark" }) {
  const off = offsetFromPrinted(row);
  if (!off) return null;
  const startMoved = off.start !== 0;
  const minutes = startMoved ? off.start : off.end;
  if (minutes === 0) return null;
  const text = startMoved ? formatSignedMinutes(minutes) : `ends ${formatSignedMinutes(minutes)}`;
  const sr = startMoved
    ? minutes > 0
      ? `${minutes} minutes later than printed`
      : `${-minutes} minutes earlier than printed`
    : minutes > 0
      ? `ends ${minutes} minutes later than printed`
      : `ends ${-minutes} minutes earlier than printed`;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ring-1 ring-inset ${lateEarlyTone(minutes, tone)}`}
    >
      <span aria-hidden="true">{text}</span>
      <span className="sr-only">{sr}</span>
    </span>
  );
}
