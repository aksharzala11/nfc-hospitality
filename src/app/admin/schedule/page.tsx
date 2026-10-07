import type { Metadata } from "next";
import Link from "next/link";
import { Eye } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { loadChangeLog, loadScheduleState } from "@/lib/admin/schedule";
import { sevaBreakouts, sevaFilterText, type ScheduleSevaFilter } from "@/lib/admin/scheduleTeams";
import { expandSevaSelection, readSevaFilter, sevaOptionValue } from "@/lib/admin/sevaFilter";
import { getSevaOptions, getUserSevas } from "@/lib/admin/sevaFilterData";
import { EVENT_DAYS, dayKey, formatDayShort } from "@/lib/time";
import { pageNow, type SearchParams } from "@/lib/pageNow";
import { TimeTravelBanner } from "@/components/TimeTravelBanner";
import { ScheduleConsole } from "@/components/admin/schedule/ScheduleConsole";
import { PageHeader } from "@/components/admin/shell/PageHeader";
import { SevaFilter } from "@/components/admin/shell/SevaFilter";
import { FOCUS } from "@/components/admin/shell/ui";

export const metadata: Metadata = { title: "Live schedule" };
export const dynamic = "force-dynamic";

/**
 * Live schedule control: shift / extend / edit / reset items when programmes
 * run late or early, with undo and an audit log. Changes are written to the
 * shared tables, so every guest page (schedule, home clock, menu reveals,
 * breakouts) picks them up on its next refresh.
 *
 * The console's seva filter (?seva=, repeated) only changes what is shown:
 * each "Team Breakouts" slot also lists the picked sevas' sessions. Changes
 * still move every breakout in a slot, whatever the filter.
 */
export default async function AdminSchedulePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  await requireAdmin();
  const { now, traveling, label, eventDay } = pageNow(sp);
  const selectedSevas = readSevaFilter(sp);
  const [state, changes, sevaOptions, userSevas] = await Promise.all([
    loadScheduleState(prisma),
    loadChangeLog(prisma),
    getSevaOptions(),
    getUserSevas(),
  ]);

  // The picked teams' breakout rows, from the rows the console already has (one snapshot).
  const sevaLabels = [...new Set(selectedSevas.map(sevaOptionValue).filter(Boolean))];
  const sevaFilter: ScheduleSevaFilter | null =
    sevaLabels.length > 0
      ? {
          labels: sevaLabels,
          breakouts: sevaBreakouts(state.breakouts, expandSevaSelection(selectedSevas, userSevas).teamCodes),
        }
      : null;

  // Where the filter shows anything: the days with a "Team Breakouts" slot ("Fri, Oct 9 and Sat, Oct 10").
  const breakoutDays = [
    ...new Set(state.items.filter((i) => i.kind === "BREAKOUT").map((i) => dayKey(new Date(i.startsAt)))),
  ]
    .sort()
    .map(formatDayShort);
  const breakoutDaysText =
    breakoutDays.length > 1 ? `${breakoutDays.slice(0, -1).join("; ")} and ${breakoutDays[breakoutDays.length - 1]}` : breakoutDays[0];

  const dayParam = typeof sp.day === "string" && (EVENT_DAYS as readonly string[]).includes(sp.day) ? sp.day : null;
  const nowParam = traveling && typeof sp.now === "string" ? sp.now : null;
  const guestHref = nowParam ? `/schedule?now=${encodeURIComponent(nowParam)}` : "/schedule";

  return (
    <div>
      {traveling && <TimeTravelBanner label={label} />}
      <PageHeader
        title="Live schedule"
        className="mb-4"
        description={
          <>
            Programme running late or early? Move the times here. Guests&apos; schedules, home clock and menu reveals follow
            within a minute.
          </>
        }
        action={
          <Link
            href={guestHref}
            className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border border-ink-800/12 bg-white/85 px-3.5 text-xs font-semibold text-ink-700 shadow-card transition hover:bg-white hover:text-ink-900 ${FOCUS}`}
          >
            <Eye className="h-3.5 w-3.5" />
            Guest view
          </Link>
        }
      />
      <div className="mb-5 flex flex-col gap-2">
        <SevaFilter options={sevaOptions} selected={selectedSevas} />
        {sevaFilter && (
          <p className="text-xs leading-snug text-ink-600">
            Team Breakouts{breakoutDaysText ? ` (${breakoutDaysText})` : ""} list the sessions for{" "}
            {sevaFilterText(sevaFilter.labels)}. Everything else shows for everyone, and a change still moves every
            team&apos;s sessions.
          </p>
        )}
      </div>
      <ScheduleConsole
        state={state}
        changes={changes}
        nowIso={now.toISOString()}
        traveling={traveling}
        today={eventDay}
        initialDay={dayParam ?? eventDay ?? EVENT_DAYS[0]}
        sevaFilter={sevaFilter}
      />
    </div>
  );
}
