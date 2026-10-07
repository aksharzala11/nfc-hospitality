"use client";

import { dayLabel, formatDayShort } from "@/lib/time";

export function DayTabs({
  days,
  selected,
  onSelect,
  today,
}: {
  /** YYYY-MM-DD keys to show, in order. */
  days: readonly string[];
  selected: string;
  onSelect: (day: string) => void;
  /** YYYY-MM-DD of the current day in the event timezone, if during the event. */
  today?: string | null;
}) {
  // A sand-200 well (the brand sand) with the selected day as a small ink panel: coral
  // tracked-caps label over a white date, as the brand guide sets coral type on ink.
  return (
    <div
      role="tablist"
      aria-label="Event day"
      className="mb-5 grid gap-1 rounded-2xl bg-sand-200/80 p-1 ring-1 ring-inset ring-ink-900/[0.05]"
      style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
    >
      {days.map((day) => {
        const active = day === selected;
        return (
          <button
            key={day}
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(day)}
            className={`relative rounded-xl px-1 pb-2.5 pt-2 text-center transition motion-reduce:transition-none ${
              active ? "bg-ink-800 text-white shadow-card" : "text-ink-800 hover:bg-white/60 hover:text-ink-900"
            }`}
          >
            {/* Tracking stays at 0.08em so "Departure" fits a quarter of a 360px screen. */}
            <span
              className={`block text-[10px] font-bold uppercase tracking-[0.08em] ${active ? "text-coral-300" : "text-ink-600"}`}
            >
              {dayLabel(day)}
            </span>
            <span className="block text-xs font-semibold sm:text-sm">{formatDayShort(day)}</span>
            {/* Today: a short coral bar under the date, clear of the label. Coral-400 on the ink
                panel, coral-700 on the sand well: both clear 3:1 as a non-text indicator.
                role="img" so its "Today" label is announced (a role-less span's label isn't). */}
            {today === day && (
              <span
                role="img"
                className={`absolute bottom-1 left-1/2 h-1 w-4 -translate-x-1/2 rounded-full ${active ? "bg-coral-400" : "bg-coral-700"}`}
                aria-label="Today"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
