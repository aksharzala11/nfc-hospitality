import Link from "next/link";
import { PlaneLanding, PlaneTakeoff, TriangleAlert } from "lucide-react";
import type { TransportDirection } from "@/lib/transport";
import { CHIP, CHIP_OFF, CHIP_ON, chipCount } from "@/components/admin/delegates/ui";
import { WORDS } from "./board";

/*
 * The board's two pickers, as links (the choice lives in the URL, so it
 * survives the console's auto-refresh and can be shared): Arrivals /
 * Departures, then the days. Server- and client-safe.
 */

const DIRECTIONS: { value: TransportDirection; icon: typeof PlaneLanding }[] = [
  { value: "ARRIVAL", icon: PlaneLanding },
  { value: "DEPARTURE", icon: PlaneTakeoff },
];

/**
 * Arrivals / Departures as a two-part switch in the console's sand well, the
 * current one as a small ink panel (the look of the schedule's DayTabs).
 */
export function DirectionSwitch({
  direction,
  hrefs,
}: {
  direction: TransportDirection;
  hrefs: Record<TransportDirection, string>;
}) {
  return (
    <nav aria-label="Arrivals or departures">
      <ul className="grid grid-cols-2 gap-1 rounded-2xl bg-sand-200/80 p-1 ring-1 ring-inset ring-ink-900/[0.05]">
        {DIRECTIONS.map(({ value, icon: Icon }) => {
          const active = value === direction;
          return (
            <li key={value} className="flex">
              <Link
                href={hrefs[value]}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-coral-700 motion-reduce:transition-none ${
                  active ? "bg-ink-800 text-white shadow-card" : "text-ink-800 hover:bg-white/60 hover:text-ink-900"
                }`}
              >
                <Icon aria-hidden="true" className={`h-4 w-4 ${active ? "text-coral-300" : "text-ink-500"}`} />
                {WORDS[value].title}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export type DayChip = {
  /** ?day= value: "all", "none" or a "YYYY-MM-DD" date. */
  value: string;
  label: string;
  count: number;
  href: string;
  /** Why the day looks wrong (outside the event dates), or null. */
  warning: string | null;
};

/**
 * "All days", then each day with its head count, as the console's filter
 * chips (they wrap: departures can span a week). A day outside the event dates
 * carries a small warning mark.
 */
export function DayChips({
  chips,
  selected,
  noun,
}: {
  chips: DayChip[];
  selected: string;
  /** For screen readers after each count: "arrival" / "arrivals". */
  noun: { one: string; many: string };
}) {
  return (
    <nav aria-label="Day">
      <ul className="flex flex-wrap gap-2">
        {chips.map((chip) => {
          const on = chip.value === selected;
          return (
            <li key={chip.value}>
              <Link
                href={chip.href}
                aria-current={on ? "page" : undefined}
                title={chip.warning ?? undefined}
                className={`${CHIP} ${on ? CHIP_ON : CHIP_OFF} inline-flex items-center`}
              >
                {chip.warning && (
                  <TriangleAlert
                    aria-hidden="true"
                    className={`mr-1 h-3.5 w-3.5 shrink-0 ${on ? "text-coral-300" : "text-coral-700"}`}
                  />
                )}
                <span className="whitespace-nowrap">{chip.label}</span>
                <span className={chipCount(on)}>
                  {chip.count}
                  <span className="sr-only">
                    {" "}
                    {chip.count === 1 ? noun.one : noun.many}
                    {chip.warning ? `. ${chip.warning}` : ""}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
