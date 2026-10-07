import type { Metadata } from "next";
import { requireSant } from "@/lib/auth";
import { getSantSchedules } from "@/lib/sant";
import type { ScheduleItemView } from "@/lib/schedule";
import { SANT_DAYS, santDayOf } from "@/lib/time";
import { pageNow, type SearchParams } from "@/lib/pageNow";
import { EVENT_NAME, EVENT_PLACE } from "@/lib/branding";
import { ParallaxHeader } from "@/components/ParallaxHeader";
import { TimeTravelBanner } from "@/components/TimeTravelBanner";
import { SantPageHeader } from "@/components/sant/pages/SantPageHeader";
import { SantScheduleTabs } from "@/components/sant/pages/SantScheduleTabs";

export const metadata: Metadata = { title: "Schedule" };
export const dynamic = "force-dynamic";

/**
 * My schedule: today while it is a Santo day; otherwise the first Santo day his programme has
 * anything on, else his first item's day (the tab's strip adds days outside SANT_DAYS that have
 * items), else the first Santo day.
 */
function personalStartDay(items: ScheduleItemView[], santDay: string | null): string {
  if (santDay) return santDay;
  return items.find((i) => SANT_DAYS.includes(i.day))?.day ?? items[0]?.day ?? SANT_DAYS[0];
}

/**
 * Pujya Santo schedule: "My schedule" (sant_schedule_items, the default) and
 * "General" (the Santo general schedule, Oct 5-15, from
 * sant_general_schedule_items), chosen with ?tab=personal|general. Both run
 * over the Santo days (SANT_DAYS), like the Santo home, and each list carries
 * its own Now / Up next. Both open on today while it is a Santo day; otherwise
 * My schedule opens on his first day with anything on and General on the first
 * Santo day.
 */
export default async function SantSchedulePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { now, traveling, label } = pageNow(sp);
  const santDay = santDayOf(now);
  const guest = await requireSant();
  // dataUserId: a Santo mirror test account shows the mirrored sant's programme.
  const { personal, general } = await getSantSchedules(guest.dataUserId, now);

  return (
    <div>
      {traveling && <TimeTravelBanner label={label} />}
      <ParallaxHeader>
        <SantPageHeader title="Schedule" subtitle={`${EVENT_NAME} · ${EVENT_PLACE}`} />
      </ParallaxHeader>
      <SantScheduleTabs
        personal={personal}
        general={general}
        personalInitialDay={personalStartDay(personal, santDay)}
        generalInitialDay={santDay ?? SANT_DAYS[0]}
        today={santDay}
        nowIso={now.toISOString()}
      />
    </div>
  );
}
