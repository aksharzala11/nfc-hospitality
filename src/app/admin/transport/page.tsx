import type { Metadata } from "next";
import { Bus, SearchX } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { readSevaFilter, sevaFilterLabel, sevaOptionValue } from "@/lib/admin/sevaFilter";
import { getSevaOptions } from "@/lib/admin/sevaFilterData";
import type { TransportBoardDay, TransportDirection } from "@/lib/transport";
import { formatDayShort } from "@/lib/time";
import { pageNow, type SearchParams } from "@/lib/pageNow";
import { TimeTravelBanner } from "@/components/TimeTravelBanner";
import { HelpContactNote } from "@/components/admin/shell/HelpContactNote";
import { PageHeader } from "@/components/admin/shell/PageHeader";
import { SevaFilter } from "@/components/admin/shell/SevaFilter";
import { DayChips, DirectionSwitch, type DayChip } from "@/components/admin/transport/TransportControls";
import { TransportSummary } from "@/components/admin/transport/TransportSummary";
import { TransportBoardView } from "@/components/admin/transport/TransportBoardView";
import { LogisticsSwitch } from "@/components/admin/transport/LogisticsSwitch";
import {
  ALL_DAYS,
  DAY_PARAM,
  DIRECTION_PARAM,
  NO_DATE,
  WORDS,
  dayWarning,
  readDay,
  readDirection,
  summarize,
  transportHref,
} from "@/components/admin/transport/board";
import { loadTransportBoard, transportHelpCoverage } from "./data";

export const metadata: Metadata = { title: "Transport" };
export const dynamic = "force-dynamic";

/**
 * The transport board (read-only): airport pickups and drop-offs from the
 * transport team's workbook (`npm run transport:import`). Arrivals /
 * Departures, the days, then per airport the numbered groups with their
 * driver, "Not grouped yet" and "No pickup needed", with the sheet's oddities
 * as small warnings. Nothing is edited here: the next import replaces it.
 *
 *   ?dir=arrivals|departures   default: arrivals until Sat, Oct 10, then departures
 *   ?day=YYYY-MM-DD|all|none   default: today when anyone travels today, else all days
 *   ?seva=...                  the console's seva filter (people without an account can't match it)
 *
 * Dates and times are the wall-clock at each airport, exactly as the sheet
 * gives them. Honours ?now= (the default direction and day, "today").
 */
export default async function AdminTransportPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  // The layout checks too, but layouts don't re-run on every navigation.
  await requireAdmin();
  const { traveling, label, today } = pageNow(sp);
  const sevas = readSevaFilter(sp);
  const direction = readDirection(sp[DIRECTION_PARAM], today);
  const words = WORDS[direction];

  const [board, sevaOptions, helpCoverage] = await Promise.all([
    loadTransportBoard(direction, sevas),
    getSevaOptions(),
    transportHelpCoverage(),
  ]);

  const keep = { now: traveling && typeof sp.now === "string" ? sp.now : null, sevas };
  const href = (dir: TransportDirection, day: string | null) => transportHref(dir, day, keep);
  const sevaLabels = [...new Set(sevas.map(sevaOptionValue).filter(Boolean))];
  const sevaText = sevaLabels.length > 0 ? sevaFilterLabel(sevaLabels) : null;

  const header = (
    <>
      <LogisticsSwitch current="transport" keep={keep} />
      <PageHeader
        title="Transport"
        className="mb-4"
        description={
          <>
            Airport pickups and drop-offs from the transport team&apos;s sheet. Read-only: the next import updates it.
            Times are local to each airport.
          </>
        }
      />
    </>
  );

  // Delegates' /transportation lists their track's transport (or general) contacts; a track
  // without one sees nobody to call there.
  const hotlineNote = <HelpContactNote topic="TRANSPORT" coverage={helpCoverage} />;

  // No transport_legs table yet, or nothing imported: say so, and nothing else.
  if (!board || (board.days.length === 0 && !board.sevaFiltered)) {
    return (
      <div>
        {traveling && <TimeTravelBanner label={label} />}
        {header}
        {hotlineNote}
        <div className="card px-6 py-10 text-center">
          <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-sand-200 text-ink-600">
            <Bus aria-hidden="true" className="h-6 w-6" />
          </span>
          <p className="font-semibold text-ink-900">No transport data yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-ink-600">
            The transport team&apos;s sheet hasn&apos;t been imported. Once it is (
            <code className="rounded bg-sand-100 px-1 text-xs text-ink-800">npm run transport:import</code>), arrivals
            and departures show here.
          </p>
        </div>
      </div>
    );
  }

  // The day: ?day=, else today when anyone travels today, else every day.
  const asked = readDay(sp[DAY_PARAM]);
  const selected = asked ?? (board.days.some((d) => d.day === today) ? today : ALL_DAYS);
  const shownDays: TransportBoardDay[] =
    selected === ALL_DAYS
      ? board.days
      : board.days.filter((d) => (selected === NO_DATE ? d.day === null : d.day === selected));

  const dayName = (day: string | null) =>
    day === null ? "No date" : day === today ? `Today, ${formatDayShort(day).split(", ")[1]}` : formatDayShort(day);
  const chips: DayChip[] = [
    { value: ALL_DAYS, label: "All days", count: board.totals.people, href: href(direction, ALL_DAYS), warning: null },
    ...board.days.map((d) => ({
      value: d.day ?? NO_DATE,
      label: dayName(d.day),
      count: d.people,
      href: href(direction, d.day ?? NO_DATE),
      warning: dayWarning(d.day),
    })),
  ];
  // A picked day nobody (under the seva filter) travels on stays visible, with 0.
  if (!chips.some((c) => c.value === selected)) {
    const day = selected === NO_DATE ? null : selected;
    chips.push({ value: selected, label: dayName(day), count: 0, href: href(direction, selected), warning: dayWarning(day) });
    chips.sort((a, b) => order(a.value) - order(b.value) || a.value.localeCompare(b.value));
  }

  const summary = summarize(shownDays, direction);
  const scope = selected === ALL_DAYS ? "all days" : selected === NO_DATE ? "no date given" : formatDayShort(selected);

  return (
    <div>
      {traveling && <TimeTravelBanner label={label} />}
      {header}
      {hotlineNote}

      <div className="mb-5 flex flex-col gap-2">
        <SevaFilter options={sevaOptions} selected={sevas} />
        {sevaText && (
          <p className="text-xs leading-snug text-ink-600">
            Showing people with {sevaText} only. Group sizes still count everyone, and people who aren&apos;t in the app
            yet can&apos;t match a seva.
          </p>
        )}
      </div>

      <div className="stagger space-y-5">
        <div className="space-y-3">
          <DirectionSwitch
            direction={direction}
            hrefs={{ ARRIVAL: href("ARRIVAL", null), DEPARTURE: href("DEPARTURE", null) }}
          />
          <DayChips
            chips={chips}
            selected={selected}
            noun={{ one: words.people.replace(/s$/, ""), many: words.people }}
          />
        </div>

        <section aria-label="Counts" className="space-y-2">
          <TransportSummary summary={summary} direction={direction} scope={scope} />
          {(summary.flagged > 0 || summary.notInApp > 0) && (
            <p className="px-1 text-xs leading-snug text-ink-600">
              {[
                summary.flagged > 0 &&
                  `${summary.flagged} flagged: the coral notes are oddities in the sheet, shown as they are`,
                summary.notInApp > 0 && `${summary.notInApp} not in the app yet (shown by User Id)`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
        </section>

        {shownDays.length === 0 ? (
          <div className="card px-6 py-8 text-center">
            <span className="mx-auto mb-2.5 flex h-11 w-11 items-center justify-center rounded-2xl bg-sand-200 text-ink-500">
              <SearchX aria-hidden="true" className="h-5 w-5" />
            </span>
            <p className="text-sm font-semibold text-ink-900">
              {[`No ${words.people}`, selected === ALL_DAYS ? null : selected === NO_DATE ? "without a date" : `on ${scope}`, sevaText && `for ${sevaText}`]
                .filter(Boolean)
                .join(" ")}
            </p>
            <p className="mx-auto mt-0.5 max-w-xs text-xs leading-snug text-ink-600">
              {sevaText ? "Try another day, or clear the seva filter." : "Try another day."}
            </p>
          </div>
        ) : (
          <TransportBoardView
            // A new day or direction starts with a clear search.
            key={`${direction}|${selected}`}
            direction={direction}
            days={shownDays}
            byDay={shownDays.length > 1}
            keep={keep}
          />
        )}
      </div>
    </div>
  );
}

/** Chip order: "All days", the dates in order, "No date" last. */
function order(value: string): number {
  return value === ALL_DAYS ? 0 : value === NO_DATE ? 2 : 1;
}
