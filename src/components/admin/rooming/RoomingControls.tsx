import Link from "next/link";
import { BedDouble, MoonStar } from "lucide-react";
import type { Stay } from "@/lib/rooming";
import { CHIP, CHIP_OFF, CHIP_ON, chipCount } from "@/components/admin/delegates/ui";
import { STAY_WORDS } from "./board";

/*
 * The rooming board's two pickers, as links (the choice lives in the URL, so it
 * survives the console's auto-refresh and can be shared): the stay, then the
 * hotels. Server- and client-safe.
 */

/** In night order. */
const STAY_TABS: { value: Stay; icon: typeof BedDouble }[] = [
  { value: "WED", icon: MoonStar },
  { value: "MAIN", icon: BedDouble },
];

/**
 * Wednesday night / From Thursday as a two-part switch in the console's sand
 * well, the current one as a small ink panel (the transport board's Arrivals /
 * Departures), each with its date and head count.
 */
export function StaySwitch({
  stay,
  hrefs,
  counts,
}: {
  stay: Stay;
  hrefs: Record<Stay, string>;
  /** People per stay (under the seva filter). */
  counts: Record<Stay, number>;
}) {
  return (
    <nav aria-label="Stay">
      <ul className="grid grid-cols-2 gap-1 rounded-2xl bg-sand-200/80 p-1 ring-1 ring-inset ring-ink-900/[0.05]">
        {STAY_TABS.map(({ value, icon: Icon }) => {
          const active = value === stay;
          const words = STAY_WORDS[value];
          const count = counts[value];
          return (
            <li key={value} className="flex">
              <Link
                href={hrefs[value]}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-14 w-full items-center justify-center gap-2 rounded-xl px-2.5 py-2 text-left md:gap-2.5 md:px-3 transition focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-coral-700 motion-reduce:transition-none ${
                  active ? "bg-ink-800 text-white shadow-card" : "text-ink-800 hover:bg-white/60 hover:text-ink-900"
                }`}
              >
                <Icon aria-hidden="true" className={`h-4 w-4 shrink-0 ${active ? "text-coral-300" : "text-ink-500"}`} />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold leading-tight">{words.title}</span>
                  <span className={`block text-xs leading-tight ${active ? "text-white/80" : "text-ink-600"}`}>
                    {words.date}
                    {" · "}
                    <span className="tabular-nums">{count}</span> {count === 1 ? "person" : "people"}
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

export type HotelChip = {
  /** Hotel key, or null for "All hotels". */
  value: string | null;
  label: string;
  count: number;
  href: string;
};

/** "All hotels", then each hotel of the stay with its head count, as the console's filter chips. */
export function HotelChips({ chips, selected }: { chips: HotelChip[]; selected: string | null }) {
  return (
    <nav aria-label="Hotel">
      <ul className="flex flex-wrap gap-2">
        {chips.map((chip) => {
          const on = chip.value === selected;
          return (
            <li key={chip.value ?? "all"}>
              <Link
                href={chip.href}
                aria-current={on ? "page" : undefined}
                className={`${CHIP} ${on ? CHIP_ON : CHIP_OFF} inline-flex items-center`}
              >
                <span className="whitespace-nowrap">{chip.label}</span>
                <span className={chipCount(on)}>
                  {chip.count}
                  <span className="sr-only"> {chip.count === 1 ? "person" : "people"}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
