/**
 * Server-only data for the console's seva filter (imports Prisma; never import
 * this from a client component). The pure half is src/lib/admin/sevaFilter.ts.
 */
import { cache } from "react";
import { prisma } from "@/lib/db";
import { buildSevaOptions, type SevaOption } from "@/lib/admin/sevaFilter";

/**
 * Every distinct users.seva value with how many accounts hold it. All roles
 * count: delegates, santos ("Pujya Santo" and their teams) and admins alike,
 * the same people the delegate directory lists. Anonymous (no names), so safe
 * to send to the browser. Cached per request: a page that shows the picker and
 * filters by it runs the query once.
 */
const userSevaCounts = cache(async (): Promise<{ seva: string; count: number }[]> => {
  const rows = await prisma.user.groupBy({ by: ["seva"], _count: { _all: true } });
  return rows.map((r) => ({ seva: r.seva, count: r._count._all }));
});

/**
 * The picker's options: each folded seva with its account count (delegates,
 * santos and admins together, see userSevaCounts) plus every breakout-matrix
 * team code, sorted by label. Render with
 * <SevaFilter options={await getSevaOptions()} selected={readSevaFilter(sp)} />.
 */
export async function getSevaOptions(): Promise<SevaOption[]> {
  return buildSevaOptions(await userSevaCounts());
}

/**
 * The distinct users.seva values, exactly as stored: the second argument of
 * expandSevaSelection() when a page filters by the picked sevas, e.g.
 *   const { userSevas, teamCodes } = expandSevaSelection(selected, await getUserSevas());
 */
export async function getUserSevas(): Promise<string[]> {
  return (await userSevaCounts()).map((r) => r.seva);
}
