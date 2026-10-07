"use client";

import { useEffect, useRef } from "react";
import { formatDayShort } from "@/lib/time";

/**
 * Day picker for both tabs of /sant/schedule: the Santo days (SANT_DAYS, Mon
 * Oct 5 - Thu Oct 15) as chips in one row that scrolls sideways, since eleven
 * days can't share a 375px screen the way DayTabs' four NAAM days do. Same
 * look as DayTabs: a sand well, the picked day as a small ink panel with a
 * coral weekday over a white date, and a short coral bar under today. The
 * picked chip is kept in view (centred when it can be), on first paint too.
 */
export function SantDayChips({
  days,
  selected,
  onSelect,
  today,
}: {
  /** YYYY-MM-DD keys, in order. */
  days: readonly string[];
  selected: string;
  onSelect: (day: string) => void;
  /** YYYY-MM-DD of today in the event timezone, when it is one of `days`. */
  today: string | null;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const firstPaint = useRef(true);

  // Scroll only the strip itself (never scrollIntoView, which would also move the page).
  useEffect(() => {
    const row = rowRef.current;
    const chip = row?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!row || !chip) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const left = chip.offsetLeft - (row.clientWidth - chip.offsetWidth) / 2;
    row.scrollTo({ left: Math.max(0, left), behavior: firstPaint.current || reduce ? "auto" : "smooth" });
    firstPaint.current = false;
  }, [selected]);

  return (
    <div className="mb-5 overflow-hidden rounded-2xl bg-sand-200/80 ring-1 ring-inset ring-ink-900/[0.05]">
      {/* The well's padding sits on the scrolling row, so the picked chip's shadow isn't clipped.
          `relative` makes the row the chips' offsetParent, for the centring maths above. */}
      <div
        ref={rowRef}
        role="tablist"
        aria-label="Day"
        className="relative flex gap-1 overflow-x-auto p-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {days.map((day) => {
          const active = day === selected;
          const [weekday, date] = formatDayShort(day).split(", ");
          return (
            <button
              key={day}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(day)}
              className={`relative w-[3.75rem] shrink-0 rounded-xl px-1 pb-2.5 pt-2 text-center transition focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-coral-700 motion-reduce:transition-none ${
                active ? "bg-ink-800 text-white shadow-card" : "text-ink-800 hover:bg-white/60 hover:text-ink-900"
              }`}
            >
              <span
                className={`block text-[10px] font-bold uppercase tracking-[0.08em] ${active ? "text-coral-300" : "text-ink-600"}`}
              >
                {weekday}
              </span>
              <span className="block whitespace-nowrap text-xs font-semibold tabular-nums">{date}</span>
              {/* Today: a short coral bar under the date (coral-400 on ink, coral-700 on sand: both
                  clear 3:1 as a non-text indicator), announced through role="img". */}
              {today === day && (
                <span
                  role="img"
                  aria-label="Today"
                  className={`absolute bottom-1 left-1/2 h-1 w-4 -translate-x-1/2 rounded-full ${active ? "bg-coral-400" : "bg-coral-700"}`}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
