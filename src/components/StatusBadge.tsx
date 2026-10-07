import type { ItemStatus } from "@/lib/schedule";

/**
 * "Now" / "Up next" pill beside a schedule, breakout or ride title. Tracked caps in the
 * brand style. "Now" is solid deep coral (coral-700: white text passes AA, which the
 * lighter coral would not) with the coral glow, matching the coral ring on "now" cards;
 * "Up next" is a quiet ink outline on sand.
 */
export function StatusBadge({ status }: { status: ItemStatus }) {
  if (status === "now") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-coral-700 px-2.5 py-0.5 text-[11px] font-bold uppercase leading-4 tracking-caps text-white shadow-glow">
        <span className="h-1.5 w-1.5 rounded-full bg-white motion-safe:animate-pulse-soft" aria-hidden="true" />
        Now
      </span>
    );
  }
  if (status === "next") {
    return (
      <span className="inline-flex items-center rounded-full border border-ink-800/25 bg-sand-50 px-2.5 py-0.5 text-[11px] font-bold uppercase leading-4 tracking-caps text-ink-800">
        Up next
      </span>
    );
  }
  return null;
}
