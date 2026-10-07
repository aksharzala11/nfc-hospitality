/**
 * Server only (reads the database): the real team breakouts as sessions, shared by the display
 * API (src/lib/display.ts) and the Pujya Santo breakouts (src/lib/santBreakouts.ts).
 *
 * `breakouts` holds one row per team per track (prisma/breakouts.ts expands the organisers'
 * matrix that way); getTeamBreakoutRows() reads the "bk-" rows that sync writes (never mock or
 * Santo sample rows), with their live moves from /admin/schedule, and foldSessions() folds the
 * rows of one session back together: a session for several teams ("BKY RAs" for BM RA, KM RA and
 * YM RA) is one session with every team. Rows fold only within a track: a session both tracks
 * hold stays one session per track (never "joint").
 *
 * Only what a screen may show is read: no facilitator (a person), no headcount.
 */
import type { Audience, Breakout } from "@prisma/client";
import { prisma } from "@/lib/db";
import { TEAM_CODES, sevaLabel } from "@/lib/teams";
import { BREAKOUT_ID_PREFIX } from "../../prisma/breakouts";

/** Every real team breakout row's id starts with this ("bk-"); mock and Santo sample rows don't. */
export { BREAKOUT_ID_PREFIX };

/** The columns read: no facilitator (a person) and nothing else about anyone. */
const BREAKOUT_SELECT = {
  id: true,
  seva: true,
  audience: true,
  title: true,
  description: true,
  room: true,
  startsAt: true,
  endsAt: true,
  originalStartsAt: true,
  originalEndsAt: true,
} as const;

/** One `breakouts` row as read here: one team's row of a session. */
export type TeamBreakoutRow = Pick<Breakout, keyof typeof BREAKOUT_SELECT>;

/** The real team breakouts: the "bk-" rows prisma/breakouts.ts syncs from the organisers' matrix. */
export async function getTeamBreakoutRows(): Promise<TeamBreakoutRow[]> {
  return prisma.breakout.findMany({
    where: { id: { startsWith: BREAKOUT_ID_PREFIX } },
    select: BREAKOUT_SELECT,
    orderBy: [{ startsAt: "asc" }, { endsAt: "asc" }, { title: "asc" }],
  });
}

/**
 * One session of the matrix: its teams' rows folded together. `id` is the first of `ids` (stable
 * while the session keeps its track, day, start and teams); `teams` as the app names them
 * (sevaLabel()), in matrix order.
 */
export type BreakoutSession = TeamBreakoutRow & { ids: string[]; teams: string[] };

/** Titles and rooms in a human order: case-insensitive, "Room 2" before "Room 10". */
export const sessionCollator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

/** Bhaio first, then Behno (then any ALL row). */
export const TRACK_ORDER: Record<Audience, number> = { BHAIO: 0, BEHNO: 1, ALL: 2 };

const teamOrder = (label: string) => {
  const i = (TEAM_CODES as readonly string[]).indexOf(label);
  return i === -1 ? TEAM_CODES.length : i;
};

/**
 * The rows of one session (same track, start, end, title, room and note) folded into one, its
 * teams merged; sessions by start, end, track (Bhaio first), title, room.
 */
export function foldSessions(rows: readonly TeamBreakoutRow[]): BreakoutSession[] {
  const byKey = new Map<string, BreakoutSession>();
  for (const b of rows) {
    const key = [b.audience, b.startsAt.toISOString(), b.endsAt.toISOString(), b.title, b.room, b.description ?? ""].join("\n");
    const team = sevaLabel(b.seva);
    const s = byKey.get(key);
    if (!s) {
      byKey.set(key, { ...b, ids: [b.id], teams: team ? [team] : [] });
      continue;
    }
    s.ids.push(b.id);
    if (team && !s.teams.includes(team)) s.teams.push(team);
  }
  const sessions = [...byKey.values()];
  for (const s of sessions) {
    s.ids.sort();
    s.id = s.ids[0];
    s.teams.sort((a, b) => teamOrder(a) - teamOrder(b) || sessionCollator.compare(a, b));
  }
  return sessions.sort(
    (a, b) =>
      a.startsAt.getTime() - b.startsAt.getTime() ||
      a.endsAt.getTime() - b.endsAt.getTime() ||
      TRACK_ORDER[a.audience] - TRACK_ORDER[b.audience] ||
      sessionCollator.compare(a.title, b.title) ||
      sessionCollator.compare(a.room, b.room),
  );
}
