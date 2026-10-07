import Link from "next/link";
import { BedDouble, Bus } from "lucide-react";
import { withSevaFilter } from "@/lib/admin/sevaFilter";
import { withNow } from "@/components/sant/shell/links";

/*
 * The console's Logistics tab holds two boards: airport transport
 * (/admin/transport) and hotel rooming (/admin/rooming). This switch sits at
 * the top of both, as links (the choice is the page), keeping the demo ?now=
 * while time-travelling and the console's seva filter; each board's own
 * params (?dir=, ?day= / ?stay=, ?hotel=) are left behind. Server- and
 * client-safe.
 *
 * A white pill on an ink-tinted well, so it reads as the section's own tabs
 * rather than the boards' ink-panel pickers (Arrivals / Departures, the stays)
 * right under it.
 */

export type LogisticsSection = "transport" | "rooming";

const SECTIONS: { value: LogisticsSection; label: string; path: string; icon: typeof Bus }[] = [
  // Bus: airport rides, as in the delegate hub's Transportation.
  { value: "transport", label: "Transport", path: "/admin/transport", icon: Bus },
  { value: "rooming", label: "Rooming", path: "/admin/rooming", icon: BedDouble },
];

export function LogisticsSwitch({
  current,
  keep,
  className = "mb-4",
}: {
  current: LogisticsSection;
  /** ?now= while time-travelling (else null) and the seva filter. */
  keep: { now: string | null; sevas: readonly string[] };
  className?: string;
}) {
  return (
    <nav aria-label="Logistics" className={className}>
      <ul className="grid w-full grid-cols-2 gap-1 rounded-full bg-ink-800/[0.07] p-1 ring-1 ring-inset ring-ink-900/[0.05] md:inline-grid md:w-auto">
        {SECTIONS.map(({ value, label, path, icon: Icon }) => {
          const active = value === current;
          return (
            <li key={value} className="flex">
              <Link
                href={withSevaFilter(withNow(path, keep.now), keep.sevas)}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-11 w-full items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold transition focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-coral-700 motion-reduce:transition-none ${
                  active ? "bg-white text-ink-900 shadow-card" : "text-ink-700 hover:bg-white/55 hover:text-ink-900"
                }`}
              >
                <Icon aria-hidden="true" className={`h-4 w-4 ${active ? "text-coral-700" : "text-ink-500"}`} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
