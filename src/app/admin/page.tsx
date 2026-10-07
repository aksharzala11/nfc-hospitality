import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { dayTitle, getAdminOverview, scopeNoun } from "@/lib/admin/overview";
import { readSevaFilter, withSevaFilter } from "@/lib/admin/sevaFilter";
import { getSevaOptions } from "@/lib/admin/sevaFilterData";
import { pageNow, type SearchParams } from "@/lib/pageNow";
import { DAY_LABELS, formatDayShort, formatTime } from "@/lib/time";
import { EVENT_NAME } from "@/lib/branding";
import { greetingName } from "@/lib/users";
import { TimeTravelBanner } from "@/components/TimeTravelBanner";
import { withNow } from "@/components/sant/shell/links";
import { SevaFilter } from "@/components/admin/shell/SevaFilter";
import { OverviewHero } from "@/components/admin/shell/overview/OverviewHero";
import { LiveProgramme } from "@/components/admin/shell/overview/LiveProgramme";
import { KpiCards } from "@/components/admin/shell/overview/KpiCards";
import { RecentAnnouncements, RecentChanges } from "@/components/admin/shell/overview/RecentActivity";
import { WhereTheyAre } from "@/components/admin/shell/overview/WhereTheyAre";
import { TransportGlance } from "@/components/admin/transport/TransportGlance";
import { BouncesGlance } from "@/components/admin/bounces/BouncesGlance";
import { getBounceCounts } from "@/lib/admin/emailEvents";
import { defaultDirection, summarize } from "@/components/admin/transport/board";
import { loadTransportBoard } from "./transport/data";

export const metadata: Metadata = { title: "Admin console" };
export const dynamic = "force-dynamic";

/**
 * Console home: today at a glance, with the event-day operations one tap away.
 *
 *   phone         hero + quick actions, seva filter, live programme, KPIs 2×2, announcements, changes
 *   tablet (md)   hero · seva filter · live programme · KPIs in a row of four · announcements | changes
 *   desktop (lg)  hero · seva filter · live programme (2 cols) | KPIs 2×2 · announcements (2 cols) | changes
 *
 * With the seva filter (?seva=..., kept on every link like ?now=), the people
 * KPIs and announcements narrow to the picked sevas, and "Where they are" (the
 * teams' breakouts now and next) opens under the filter, full width. The live
 * programme and schedule changes always cover everyone.
 *
 * Once transport has been imported, a slim "Airport transport" card closes the
 * page: the transport board's counts as it opens (arrivals today, departures
 * from Sat; every day before the event), under the seva filter too.
 *
 * Once anything has bounced (src/lib/admin/emailEvents.ts), an "Email bounces ·
 * N open" card (one quiet row when none is open) leads to /admin/bounces. It
 * covers everyone (no seva filter) and is left out until the table exists.
 */
export default async function AdminOverviewPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { now, traveling, label, today, eventDay } = pageNow(sp);
  const sevas = readSevaFilter(sp);
  // Keep the demo "now" (while time-travelling) and the seva filter on every internal link.
  const link = (href: string) => {
    const withDemoNow = withNow(href, traveling ? String(sp.now) : null);
    return sevas.length > 0 ? withSevaFilter(withDemoNow, sevas) : withDemoNow;
  };

  const admin = await requireAdmin();
  const transportDirection = defaultDirection(today);
  const [{ people, announcements, changes, programme, scope, whereabouts }, sevaOptions, transportBoard, bounces] =
    await Promise.all([
      getAdminOverview(now, admin.id, sevas),
      getSevaOptions(),
      loadTransportBoard(transportDirection, sevas),
      getBounceCounts(),
    ]);
  // The board's own default day: today when anyone travels today, else every day.
  const transportToday = transportBoard?.days.filter((d) => d.day === today) ?? [];
  const transport =
    transportBoard && transportBoard.days.length > 0
      ? transportToday.length > 0
        ? { summary: summarize(transportToday, transportDirection), when: `today (${formatDayShort(today)})` }
        : { summary: summarize(transportBoard.days, transportDirection), when: "all days" }
      : null;

  const day = dayTitle(today);
  const time = formatTime(now);
  const note =
    programme.phase === "before" && programme.startsIn
      ? `${EVENT_NAME} starts ${programme.startsIn}`
      : programme.phase === "after"
        ? `${EVENT_NAME} has concluded`
        : null;
  const hrefs = {
    // The delegates page opens its add form for ?new=1.
    addDelegate: link("/admin/delegates?new=1"),
    delegates: link("/admin/delegates"),
    announce: link("/admin/announcements"),
    schedule: link("/admin/schedule"),
    transport: link("/admin/transport"),
    bounces: link("/admin/bounces"),
  };

  return (
    <>
      {traveling && <TimeTravelBanner label={label} />}

      <div className="stagger grid items-start gap-4 md:grid-cols-2 lg:grid-cols-3">
        <OverviewHero
          className="md:col-span-2 lg:col-span-3"
          name={greetingName(admin)}
          day={day}
          note={note}
          actions={{ addDelegate: hrefs.addDelegate, announce: hrefs.announce, schedule: hrefs.schedule }}
        />

        <div className="flex flex-col gap-2 md:col-span-2 lg:col-span-3">
          <SevaFilter options={sevaOptions} selected={sevas} />
          {scope && (
            <p className="text-xs leading-snug text-ink-600">
              People, announcements and breakouts show {scopeNoun(scope)} only. The live programme and schedule
              changes cover everyone.
            </p>
          )}
        </div>

        {scope && whereabouts && (
          <WhereTheyAre
            className="md:col-span-2 lg:col-span-3"
            whereabouts={whereabouts}
            scope={scope.label}
            href={hrefs.schedule}
          />
        )}

        <LiveProgramme
          className="md:col-span-2"
          programme={programme}
          day={day}
          updated={time}
          scheduleHref={hrefs.schedule}
        />

        <KpiCards
          className="md:col-span-2 md:grid-cols-4 lg:col-span-1 lg:grid-cols-2"
          people={people}
          announcements={announcements}
          status={programme.status}
          dayName={eventDay ? DAY_LABELS[eventDay] : null}
          hrefs={hrefs}
          scope={scope}
        />

        <RecentAnnouncements
          className="lg:col-span-2"
          summary={announcements}
          href={hrefs.announce}
          newHref={hrefs.announce}
          scope={scope}
        />

        <RecentChanges rows={changes} href={hrefs.schedule} />

        {bounces && bounces.total > 0 && (
          <BouncesGlance className="md:col-span-2 lg:col-span-3" counts={bounces} href={hrefs.bounces} />
        )}

        {transport && (
          <TransportGlance
            className="md:col-span-2 lg:col-span-3"
            summary={transport.summary}
            direction={transportDirection}
            when={transport.when}
            scope={scope?.label ?? null}
            href={hrefs.transport}
          />
        )}
      </div>
    </>
  );
}
