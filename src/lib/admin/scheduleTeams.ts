/**
 * Read-only helpers for the console's seva filter on the live schedule
 * (/admin/schedule): which breakout rows sit inside a "Team Breakouts" slot,
 * and the picked teams' rows folded into sessions for display.
 *
 * Display only: nothing here feeds the planner, so a change to a slot still
 * moves every breakout in it, whatever the filter shows. Pure and isomorphic
 * (the engine is imported for types and its client-safe sharesAudience()), so
 * the server page and the client console share it.
 */
import type { Audience } from "@prisma/client";
import { sharesAudience, type StateBreakout, type StateItem } from "@/lib/admin/schedule";
import { sevaFilterLabel } from "@/lib/admin/sevaFilter";

/** The seva filter as the live schedule uses it. No filter = no prop (null). */
export type ScheduleSevaFilter = {
  /** The picked sevas as the picker labels them (option values, see sevaOptionValue()), in URL order. */
  labels: string[];
  /** Breakout rows of the picked teams: breakouts.seva in expandSevaSelection().teamCodes, in time order. */
  breakouts: StateBreakout[];
};

/** The rows whose breakouts.seva is one of `teamCodes` (expandSevaSelection().teamCodes); none for an empty list. */
export function sevaBreakouts(breakouts: readonly StateBreakout[], teamCodes: readonly string[]): StateBreakout[] {
  if (teamCodes.length === 0) return [];
  const codes = new Set(teamCodes);
  return breakouts.filter((b) => b.seva !== null && codes.has(b.seva));
}

/**
 * The breakout rows inside a BREAKOUT slot: starting within the slot's times,
 * on its track or a shared one. The rule behind the console's "N team
 * breakouts" counts; other kinds of item hold none.
 */
export function breakoutsInSlot<T extends Pick<StateBreakout, "startsAt" | "audience">>(
  slot: Pick<StateItem, "kind" | "audience" | "startsAt" | "endsAt">,
  breakouts: readonly T[],
): T[] {
  if (slot.kind !== "BREAKOUT") return [];
  const start = Date.parse(slot.startsAt);
  const end = Date.parse(slot.endsAt);
  return breakouts.filter((b) => {
    const s = Date.parse(b.startsAt);
    return s >= start && s < end && sharesAudience(slot.audience, b.audience);
  });
}

/**
 * One session of the picked teams: their rows with the same times, title and
 * room(s) folded together (breakouts holds one row per team per track, so a
 * "BKY RAs" session for BM RA and KM RA is two rows, or four across tracks).
 */
export type TeamSession = {
  key: string;
  /** breakouts.id of every folded row. */
  ids: string[];
  title: string;
  /** Every room, e.g. "Niyam · Atma · Gnan" for a team split amongst them. */
  room: string;
  startsAt: string;
  endsAt: string;
  /** The rows' track; ALL when both tracks' rows fold together (or the rows are shared). */
  audience: Audience;
  /** breakouts.seva of the folded rows (team codes), de-duplicated and sorted. */
  teams: string[];
};

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
const TRACK_ORDER: Record<Audience, number> = { ALL: 0, BHAIO: 1, BEHNO: 2 };

/** `rows` folded into sessions (see TeamSession), by start, end, title, then track (Bhaio before Behno). */
export function foldTeamSessions(rows: readonly StateBreakout[]): TeamSession[] {
  const byKey = new Map<string, TeamSession>();
  for (const b of rows) {
    const key = [b.startsAt, b.endsAt, b.title, b.room].join("\n");
    const session = byKey.get(key);
    if (!session) {
      byKey.set(key, {
        key,
        ids: [b.id],
        title: b.title,
        room: b.room,
        startsAt: b.startsAt,
        endsAt: b.endsAt,
        audience: b.audience,
        teams: b.seva ? [b.seva] : [],
      });
      continue;
    }
    session.ids.push(b.id);
    if (session.audience !== b.audience) session.audience = "ALL";
    if (b.seva && !session.teams.includes(b.seva)) session.teams.push(b.seva);
  }
  const sessions = [...byKey.values()];
  for (const s of sessions) s.teams.sort(collator.compare);
  return sessions.sort(
    (a, b) =>
      Date.parse(a.startsAt) - Date.parse(b.startsAt) ||
      Date.parse(a.endsAt) - Date.parse(b.endsAt) ||
      collator.compare(a.title, b.title) ||
      TRACK_ORDER[a.audience] - TRACK_ORDER[b.audience] ||
      collator.compare(a.room, b.room),
  );
}

/**
 * "BM RA", "BM RA, SA", "BM RA, SA, KM RA", then "BM RA, SA +2 more", for
 * "2 sessions for …": how every console view names the filter (sevaFilterLabel()).
 */
export function sevaFilterText(labels: readonly string[]): string {
  return sevaFilterLabel(labels);
}

/** What the console's list and item sheet need from the filter. */
export type SevaView = {
  /** The picked teams' breakout rows (ScheduleSevaFilter.breakouts). */
  breakouts: StateBreakout[];
  /** e.g. "BM RA" (sevaFilterText()). */
  forText: string;
  /** Name each session's teams: the rows cover more than one team. */
  showTeams: boolean;
};

/** The filter as the console's views use it; null for no filter. */
export function sevaViewOf(filter: ScheduleSevaFilter | null | undefined): SevaView | null {
  if (!filter || filter.labels.length === 0) return null;
  return {
    breakouts: filter.breakouts,
    forText: sevaFilterText(filter.labels),
    showTeams: new Set(filter.breakouts.map((b) => b.seva)).size > 1,
  };
}
