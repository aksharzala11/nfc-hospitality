import type { Metadata } from "next";
import { requireGuest } from "@/lib/auth";
import { isVolunteer } from "@/lib/volunteer";
import {
  annotateSchedule,
  forAudience,
  getBreakoutsForUser,
  getScheduleItems,
  personalizeBreakouts,
  personalizeGoshthi,
} from "@/lib/schedule";
import { EVENT_DAYS } from "@/lib/time";
import { pageNow, type SearchParams } from "@/lib/pageNow";
import { EVENT_DATES, EVENT_NAME, EVENT_PLACE } from "@/lib/branding";
import { ScheduleView } from "@/components/ScheduleView";
import { TimeTravelBanner } from "@/components/TimeTravelBanner";
import { ParallaxHeader } from "@/components/ParallaxHeader";
import { HubPageHeader } from "@/components/HubPageHeader";

export const metadata: Metadata = { title: "Schedule" };
export const dynamic = "force-dynamic";

export default async function SchedulePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { now, traveling, label, eventDay } = pageNow(sp);
  const [guest, all, sessions] = await Promise.all([
    requireGuest(),
    getScheduleItems(),
    // Their own team breakouts, for the Team Breakouts slots. A failure only leaves the slots'
    // printed placeholder, never the page.
    requireGuest().then((g) =>
      getBreakoutsForUser(g).catch((err: unknown) => {
        console.error("[schedule] breakout rooms unavailable:", err);
        return [];
      }),
    ),
  ]);
  // Their own Goshthi sessions carry their group's room and label (personalizeGoshthi()), their
  // Team Breakouts slots their own rooms and sessions, from where they should be now while a
  // slot is under way (personalizeBreakouts()).
  const items = annotateSchedule(
    personalizeBreakouts(personalizeGoshthi(forAudience(all, guest.gender), guest), sessions, now),
    now,
  );

  return (
    <div>
      {traveling && <TimeTravelBanner label={label} />}
      <ParallaxHeader>
        <HubPageHeader
          eyebrow={`${EVENT_NAME} · ${EVENT_PLACE}`}
          title="Schedule"
          subtitle={`${EVENT_DATES} · All times Eastern`}
        />
      </ParallaxHeader>
      <ScheduleView
        items={items}
        initialDay={eventDay ?? EVENT_DAYS[0]}
        today={eventDay}
        nowIso={now.toISOString()}
        showAudience={guest.gender === null}
        // A volunteer account can't open the breakouts page (src/lib/volunteer.ts).
        linkBreakouts={!isVolunteer(guest)}
      />
    </div>
  );
}
