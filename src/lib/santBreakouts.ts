/**
 * The breakout sessions a Pujya Santo can join (/sant/breakouts and the Santo home's Breakouts
 * tile). Santos have no breakout sessions of their own (user, 2026-10-02): they join whichever
 * team breakout they like, Bhaio sessions only, never a Behno one; of the sessions the two
 * tracks hold together, only those the organisers mark "Santo joining" (user, 2026-10-02: the
 * `santos` mark in prisma/breakouts-data.ts, eight sessions on the 2026-10-02 sheet), and those
 * at the marked time. So this never reads users.breakout_sessions or getBreakoutsForUser(), and
 * never the Santo sample rows: only the real team breakouts (the "bk-" rows, with their live
 * moves from /admin/schedule), folded into sessions as the display API folds them
 * (foldSessions() in src/lib/breakoutSessions.ts).
 *
 *  - santBreakoutSessions(): the audience BHAIO sessions that are not "combined" (isCombined():
 *    a Behno session shares its day, time and a room), plus every one whose rows carry the
 *    "Santo joining" mark (passed in: santoJoiningByRowId() in prisma/breakouts.ts), which shows
 *    the marked window as its time (santoWindow(), from the live row, so it follows live moves)
 *    and is flagged `santoJoining`;
 *  - breakoutBlocks(): those sessions per event day, in blocks of overlapping or touching
 *    sessions, each named by its weekday and part of the day ("Friday afternoon");
 *  - blockStatuses(): now / next / upcoming / past at a moment;
 *  - santBlockViews(): the plain, serialisable rows the page and the tile take, every label
 *    formatted here (EVENT_TZ, through src/lib/time.ts).
 *
 * A session's times are the ones santos see everywhere here: the Santo-joining window for a
 * marked one, so blocks, statuses, "Done", ordering and the home tile all go by the window.
 *
 * Everything but getSantBreakouts() is pure. Server only through getSantBreakouts() (Prisma):
 * client code may only `import type` from here. No headcounts, facilitators, team prefixes or
 * the sheet's room numbers: a session shows its title, times, rooms and note only (and the
 * "Santo joining" chip; never the word "joint").
 */
import {
  BREAKOUT_ID_PREFIX,
  foldSessions,
  getTeamBreakoutRows,
  sessionCollator,
  type BreakoutSession,
  type TeamBreakoutRow,
} from "@/lib/breakoutSessions";
import { santoJoiningByRowId, type SantoJoining } from "../../prisma/breakouts";
import { normalizeVenueName, splitVenueNames } from "@/lib/venue/aliases";
import { dayKey, formatMonthDay, formatTimeRange, formatWeekday, toEventLocalInput } from "@/lib/time";

/** The "Santo joining" marks by `breakouts` row id (santoJoiningByRowId()). */
export type SantoJoiningMarks = ReadonlyMap<string, SantoJoining>;

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/**
 * A session a sant can join: a Bhaio team breakout that no Behno session shares, or one the
 * organisers mark "Santo joining".
 */
export type SantSession = {
  /** The folded session's id (its first team row's). */
  id: string;
  /** As stored ("BKY RAs"). */
  title: string;
  /** Every room, as stored; several when the team is split amongst them. */
  rooms: string[];
  /** The organisers' note, e.g. SPLIT_NOTE "Split amongst these rooms."; null if none. */
  note: string | null;
  /** When santos join it: the live session, or for a marked one its Santo-joining window (santoWindow()). */
  startsAt: Date;
  endsAt: Date;
  /** YYYY-MM-DD of the start in EVENT_TZ. */
  day: string;
  /** The organisers mark it "Santo joining" (the card says so); its times are the marked window. */
  santoJoining: boolean;
};

type Shared = Pick<BreakoutSession, "startsAt" | "endsAt" | "room">;

/** Room names of a session as compared: split on " · " (splitVenueNames()), then normalizeVenueName(). */
function roomKeys(room: string): Set<string> {
  return new Set(splitVenueNames(room).map(normalizeVenueName).filter(Boolean));
}

/**
 * Whether two sessions of different tracks are one session both hold (a "combined" one): the
 * same event day (EVENT_TZ), times that overlap (a.start < b.end and b.start < a.end; sessions
 * that only touch don't), and at least one room in common (each room string split on " · " with
 * splitVenueNames(), names compared by normalizeVenueName()).
 */
export function sharesSession(a: Shared, b: Shared): boolean {
  if (dayKey(a.startsAt) !== dayKey(b.startsAt)) return false;
  if (!(a.startsAt.getTime() < b.endsAt.getTime() && b.startsAt.getTime() < a.endsAt.getTime())) return false;
  const theirs = roomKeys(b.room);
  for (const key of roomKeys(a.room)) if (theirs.has(key)) return true;
  return false;
}

/** Whether a Bhaio session is a combined one: a Behno session (`behno`) shares it (sharesSession()). */
export function isCombined(session: Shared, behno: readonly Shared[]): boolean {
  return behno.some((b) => sharesSession(session, b));
}

/** By start, then title (numeric: "Room 2" before "Room 10"). */
const bySession = (a: SantSession, b: SantSession) =>
  a.startsAt.getTime() - b.startsAt.getTime() || sessionCollator.compare(a.title, b.title);

/** The mark a session carries: that of the first of its folded rows (`ids`, sorted) that has one; null if none does. */
export function santoMarkOf(session: Pick<BreakoutSession, "ids">, marks: SantoJoiningMarks): SantoJoining | null {
  for (const id of session.ids) {
    const mark = marks.get(id);
    if (mark) return mark;
  }
  return null;
}

/**
 * A marked session's Santo-joining window at its live times: the live start plus the mark's
 * offsets, the end at most the live end (`endMs` null = the live end), so a session moved or run
 * over from /admin/schedule takes its window with it. When a live change has left nothing of the
 * window (it would start at or after the session's live end), the live session itself.
 */
export function santoWindow(session: Pick<BreakoutSession, "startsAt" | "endsAt">, mark: SantoJoining): { startsAt: Date; endsAt: Date } {
  const start = session.startsAt.getTime();
  const end = session.endsAt.getTime();
  const from = start + mark.startMs;
  const to = mark.endMs === null ? end : Math.min(start + mark.endMs, end);
  if (!(from < to)) return { startsAt: session.startsAt, endsAt: session.endsAt };
  return { startsAt: new Date(from), endsAt: new Date(to) };
}

function santSessionOf(s: BreakoutSession, mark: SantoJoining | null): SantSession {
  const { startsAt, endsAt } = mark ? santoWindow(s, mark) : s;
  return {
    id: s.id,
    title: s.title,
    rooms: splitVenueNames(s.room),
    note: s.description?.trim() || null,
    startsAt,
    endsAt,
    day: dayKey(startsAt),
    santoJoining: mark !== null,
  };
}

/**
 * The sessions santos can join, from the team breakout rows (getTeamBreakoutRows(); any row
 * whose id doesn't start with "bk-", such as a Santo sample row, is left out here too) and the
 * "Santo joining" marks (santoJoiningByRowId(), by row id): the rows folded into sessions
 * (foldSessions()), the audience BHAIO ones kept: every one any of whose rows carries a mark (at
 * its window, santoWindow(), flagged `santoJoining`), and the others less every combined one
 * (isCombined() against every BEHNO session), which come back as `combined`. Both by start (the
 * window's for a marked one), then title.
 */
export function santBreakoutSessions(
  rows: readonly TeamBreakoutRow[],
  marks: SantoJoiningMarks,
): { sessions: SantSession[]; combined: SantSession[] } {
  const all = foldSessions(rows.filter((r) => r.id.startsWith(BREAKOUT_ID_PREFIX)));
  const behno = all.filter((s) => s.audience === "BEHNO");
  const sessions: SantSession[] = [];
  const combined: SantSession[] = [];
  for (const s of all) {
    if (s.audience !== "BHAIO") continue;
    const mark = santoMarkOf(s, marks);
    if (mark) sessions.push(santSessionOf(s, mark));
    else (isCombined(s, behno) ? combined : sessions).push(santSessionOf(s, null));
  }
  return { sessions: sessions.sort(bySession), combined: combined.sort(bySession) };
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

/** A run of sessions on one event day that overlap or touch: what a sant picks from. */
export type SantBlock = {
  /** "blk-<YYYY-MM-DD>-<HHMM>" of its start (Eastern): stable while its first session keeps its start. */
  id: string;
  /** YYYY-MM-DD in EVENT_TZ. */
  day: string;
  startsAt: Date;
  /** The latest end of its sessions. */
  endsAt: Date;
  /** "Friday morning" (starts before 12:00 Eastern), "Friday afternoon" (before 17:00), else "Friday evening". */
  label: string;
  /** By start, then title. */
  sessions: SantSession[];
};

/** "HH:MM" of an instant in EVENT_TZ. */
const clockOf = (d: Date) => toEventLocalInput(d).slice(11);

/** "Friday afternoon": the weekday, then morning (before 12:00 Eastern), afternoon (before 17:00) or evening. */
export function blockLabel(day: string, start: Date): string {
  const hour = Number(clockOf(start).slice(0, 2));
  const part = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  return `${formatWeekday(day)} ${part}`;
}

/**
 * The sessions in blocks: per event day (EVENT_TZ), sorted by start, a session that starts at or
 * before the running block's end joins it (so overlapping and back-to-back sessions are one
 * block), otherwise it starts the next one. Blocks in time order.
 */
export function breakoutBlocks(sessions: readonly SantSession[]): SantBlock[] {
  const blocks: SantBlock[] = [];
  let current: SantBlock | null = null;
  for (const s of [...sessions].sort(bySession)) {
    if (current && current.day === s.day && s.startsAt.getTime() <= current.endsAt.getTime()) {
      current.sessions.push(s);
      if (s.endsAt.getTime() > current.endsAt.getTime()) current.endsAt = s.endsAt;
      continue;
    }
    current = {
      id: `blk-${s.day}-${clockOf(s.startsAt).replace(":", "")}`,
      day: s.day,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      label: blockLabel(s.day, s.startsAt),
      sessions: [s],
    };
    blocks.push(current);
  }
  return blocks;
}

/** now: under way; next: the first block still to start (even while another is on); upcoming: later ones; past: over. */
export type BlockStatus = "now" | "next" | "upcoming" | "past";

/** Each block's status at `now` (blocks in time order, as breakoutBlocks() gives them). */
export function blockStatuses(blocks: readonly Pick<SantBlock, "startsAt" | "endsAt">[], now: Date): BlockStatus[] {
  const t = now.getTime();
  const next = blocks.findIndex((b) => b.startsAt.getTime() > t);
  return blocks.map((b, i) => {
    if (b.startsAt.getTime() <= t && t < b.endsAt.getTime()) return "now";
    if (b.endsAt.getTime() <= t) return "past";
    return i === next ? "next" : "upcoming";
  });
}

/**
 * santoJoiningByRowId() of the data this build carries, worked out once per server instance.
 * The data is fixed per build, so a failure is too: kept as no marks (and logged once).
 */
let santoMarks: SantoJoiningMarks | null = null;

/**
 * The "Santo joining" marks, or none when the data fails santoJoiningByRowId()'s checks (it runs
 * breakoutRows() over the whole matrix, which only `breakouts:sync` and the seed check before a
 * deploy): the Santo pages then still show, the marked sessions left out as combined, rather
 * than failing on every request.
 */
function santoJoiningMarks(): SantoJoiningMarks {
  if (santoMarks) return santoMarks;
  try {
    santoMarks = santoJoiningByRowId();
  } catch (err) {
    console.error("[santo breakouts] Santo joining marks left out:", err instanceof Error ? err.message : err);
    santoMarks = new Map();
  }
  return santoMarks;
}

/**
 * The Santo breakout blocks from the database (the "Santo joining" marks from
 * prisma/breakouts-data.ts, santoJoiningMarks()), plus the Bhaio sessions left out as combined
 * (no mark).
 */
export async function getSantBreakouts(): Promise<{ blocks: SantBlock[]; combined: SantSession[] }> {
  const { sessions, combined } = santBreakoutSessions(await getTeamBreakoutRows(), santoJoiningMarks());
  return { blocks: breakoutBlocks(sessions), combined };
}

// ---------------------------------------------------------------------------
// Views (plain, serialisable)
// ---------------------------------------------------------------------------

/** A room of a session: a /sant/map link when it is on the map for the sant's track. */
export type SantRoomView = {
  name: string;
  /** "/sant/map?to=<room>" (keeping ?now=), or null: plain text. */
  href: string | null;
  /** There is a venue map, and this room isn't on it for him (or is staff only): "not on the map yet". */
  offMap: boolean;
};

export type SantSessionView = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  /** Its own "11:00 AM – 11:45 AM", only when that differs from the block's span; else null. */
  timeLabel: string | null;
  /** It has ended at `now` (in a block still on, it is shown quieter, marked Done). */
  over: boolean;
  /** Marked "Santo joining" by the organisers (a chip on the card); its times are the marked window. */
  santoJoining: boolean;
  note: string | null;
  rooms: SantRoomView[];
};

export type SantBlockView = {
  id: string;
  day: string;
  startsAt: string;
  endsAt: string;
  /** "Friday afternoon" */
  label: string;
  /** "October 9" */
  dateLabel: string;
  /** "3:00 PM – 4:30 PM" */
  timeLabel: string;
  /** How many sessions it offers. */
  count: number;
  status: BlockStatus;
  sessions: SantSessionView[];
};

/**
 * The blocks as the page and the home tile take them, with their status at `now`. `roomHref`:
 * a room's /sant/map link, or null when it isn't on the map (or is staff only); pass null when
 * there is no venue map at all (every room is then plain text, unmarked).
 */
export function santBlockViews(
  blocks: readonly SantBlock[],
  now: Date,
  roomHref: ((room: string) => string | null) | null,
): SantBlockView[] {
  const statuses = blockStatuses(blocks, now);
  return blocks.map((b, i) => {
    const span = formatTimeRange(b.startsAt, b.endsAt);
    return {
      id: b.id,
      day: b.day,
      startsAt: b.startsAt.toISOString(),
      endsAt: b.endsAt.toISOString(),
      label: b.label,
      dateLabel: formatMonthDay(b.day),
      timeLabel: span,
      count: b.sessions.length,
      status: statuses[i],
      sessions: b.sessions.map((s) => {
        const own = formatTimeRange(s.startsAt, s.endsAt);
        return {
          id: s.id,
          title: s.title,
          startsAt: s.startsAt.toISOString(),
          endsAt: s.endsAt.toISOString(),
          timeLabel: own === span ? null : own,
          over: s.endsAt.getTime() <= now.getTime(),
          santoJoining: s.santoJoining,
          note: s.note,
          rooms: s.rooms.map((name) => {
            const href = roomHref ? roomHref(name) : null;
            return { name, href, offMap: roomHref !== null && href === null };
          }),
        };
      }),
    };
  });
}

/**
 * Which block opens first on /sant/breakouts: the one on now, else the next one; null (all
 * closed) when every block is past.
 */
export function defaultOpenBlock(views: readonly Pick<SantBlockView, "id" | "status">[]): string | null {
  return (views.find((v) => v.status === "now") ?? views.find((v) => v.status === "next"))?.id ?? null;
}
