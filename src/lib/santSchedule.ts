/**
 * The Pujya Santo general schedule (Mon Oct 5 - Thu Oct 15): the "General" tab
 * of /sant/schedule and the general programme on the Santo home (hero clock,
 * General schedule tile). Rows live in `sant_general_schedule_items`, written
 * only by the sync from prisma/sant-schedule-data.ts (`npm run
 * sant:schedule:sync`, also run by the seed). The delegate `schedule_items`
 * are never shown in the Santo view.
 *
 * The admin live-schedule engine never moves these rows, so the views carry no
 * printed times (originalStartsAt/EndsAt null) and ScheduleView shows no
 * "Delayed N min" badges on them.
 *
 * Server-only: this module imports Prisma. Client code may `import type` from here.
 */
import type { SantGeneralScheduleItem, ScheduleItem } from "@prisma/client";
import { prisma } from "@/lib/db";
import { annotateSchedule, type ScheduleItemView } from "@/lib/schedule";

/** The Santo general schedule's rows, in time order (the order the annotate helpers expect). */
export async function getSantGeneralItems(): Promise<SantGeneralScheduleItem[]> {
  return prisma.santGeneralScheduleItem.findMany({ orderBy: [{ startsAt: "asc" }, { sortOrder: "asc" }] });
}

/**
 * Adapts Santo general rows to the `ScheduleItem` shape (audience ALL, never
 * moved), so they go through the helpers in src/lib/schedule.ts.
 */
export function santGeneralAsScheduleItems(items: SantGeneralScheduleItem[]): ScheduleItem[] {
  return items.map(
    (i): ScheduleItem => ({
      id: i.id,
      title: i.title,
      description: i.description,
      location: i.location,
      kind: i.kind,
      audience: "ALL",
      startsAt: i.startsAt,
      endsAt: i.endsAt,
      sortOrder: i.sortOrder,
      // Not moved from /admin/schedule: no printed-time record, so no delay badges.
      originalStartsAt: null,
      originalEndsAt: null,
    }),
  );
}

/**
 * The Santo general schedule as `ScheduleItemView`, exactly what
 * annotateSchedule() returns (audience "ALL"; status past / now / next /
 * upcoming relative to `now`, so pass pageNow()'s `now` for ?now= time travel),
 * ready for <ScheduleView items={...}>.
 */
export async function getSantGeneralSchedule(now: Date): Promise<ScheduleItemView[]> {
  return annotateSchedule(santGeneralAsScheduleItems(await getSantGeneralItems()), now);
}
