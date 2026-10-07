/**
 * Real team breakouts: expands prisma/breakouts-data.ts (the organisers' matrix)
 * into `breakouts` rows and syncs them into the database. Used by
 * prisma/seed.ts (always, like the schedule) and `npm run breakouts:sync`.
 *
 * One row per team per session: a session for several teams (e.g. "BKY RAs" for
 * BM RA, KM RA and YM RA) becomes one row per team, each with that team's
 * canonical code as `seva`, so the fallback match in getBreakoutsForUser() is a
 * plain `seva IN teamCodesFor(user.seva)`. `audience` is the matrix tab's track
 * (BHAIO / BEHNO), `room` lists every room ("Niyam · Atma · Gnan") and
 * `description` carries the session's note or null; a session with several
 * rooms and no note gets SPLIT_NOTE, so a room list never comes unexplained.
 * Back-to-back sessions of one team with the same title, rooms and note (the
 * sheet splits them where a shared cell starts) become one row.
 *
 * Ids are stable, "bk-<track>-<day>-<HHMM>-<team slug>" (e.g.
 * "bk-bhaio-sat-1100-bm-ra"), so users.breakout_sessions links survive a
 * re-sync while those stay the same. The sync owns every "bk-" row and nothing
 * else: mock rows (cuid ids) and the Santo sample rows ("sample-*") are never
 * touched.
 *
 * The organisers' "Santo joining" mark (`santos` on a Bhaio entry) is checked
 * here with the rest of the data but is not a column: santoJoiningByRowId()
 * gives the Santo view (src/lib/santBreakouts.ts) each marked row's window as
 * offsets from the row's start, so it follows the row's live moves.
 */
import type { Audience, Breakout, PrismaClient } from "@prisma/client";
import { BREAKOUT_SESSIONS, SPLIT_NOTE, type BreakoutSessionData, type BreakoutTrack } from "./breakouts-data";
import { isTeamCode } from "../src/lib/teams";

/** Every row the sync owns has an id starting with this. */
export const BREAKOUT_ID_PREFIX = "bk-";

/** Event dates of the matrix's days. */
const DAY_DATE: Record<BreakoutSessionData["day"], string> = { FRI: "2026-10-09", SAT: "2026-10-10" };

// October is EDT (UTC-4) in New Jersey, exactly as prisma/seed.ts builds the
// printed schedule, so breakouts line up with their "Team Breakouts" slots.
const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00-04:00`);

/** Lower case, anything other than a letter or digit -> "-", runs collapsed, no leading/trailing "-". */
export function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function breakoutId(track: BreakoutTrack, day: BreakoutSessionData["day"], start: string, team: string): string {
  return `${BREAKOUT_ID_PREFIX}${slug(track)}-${slug(day)}-${start.replace(":", "")}-${slug(team)}`;
}

/** One `breakouts` row as the sync writes it (every column). */
export type BreakoutRow = {
  id: string;
  seva: string;
  /** The matrix tab the session comes from. */
  audience: BreakoutTrack;
  title: string;
  description: string | null;
  room: string;
  facilitator: null;
  startsAt: Date;
  endsAt: Date;
  originalStartsAt: null;
  originalEndsAt: null;
};

/**
 * Words guests must never see: the matrix's "joint" wording and its lower-case
 * track prefixes ("eBKY", "iSA", "eiBKY"; the organisers' shorthand for Kishore
 * / Kishori). breakouts-data.ts already drops them; this keeps it that way.
 */
function guestTextProblem(text: string): string | null {
  if (/\bjoint\b/i.test(text)) return 'says "joint"';
  if (/(?:^|[\s(+&/,])(?:ei|e|i)(?=[A-Z]{2})/.test(text)) return "has an e/i/ei track prefix";
  return null;
}

/**
 * What is wrong with a session's "Santo joining" mark (BreakoutSessionData.santos), or null when
 * it has none or it is fine: only on a BHAIO entry, `true` or a window of "HH:MM" times that
 * starts before it ends and lies inside the session (start >= the session's, end <= its end).
 */
function santosMarkProblem(s: BreakoutSessionData, clock: RegExp): string | null {
  const mark = s.santos;
  if (mark === undefined) return null;
  if (s.track !== "BHAIO") return "is for Bhaio entries only";
  if (mark === true) return null;
  if (typeof mark !== "object" || mark === null) return 'must be true or { start: "HH:MM", end: "HH:MM" }';
  if (!clock.test(mark.start) || !clock.test(mark.end)) return 'needs "HH:MM" times';
  if (mark.end <= mark.start) return "must start before it ends";
  if (mark.start < s.start || mark.end > s.end) return `must lie inside the session (${s.start}-${s.end})`;
  return null;
}

/**
 * BREAKOUT_SESSIONS as `breakouts` rows, in data order. Throws on data the app
 * can't show correctly (bad times, unknown team codes, duplicate ids, guest-
 * facing text with "joint" or a track prefix, a number in a title, a "Santo
 * joining" mark on a Behno entry or outside its session), so a bad edit fails
 * the seed or sync instead of reaching guests. The mark itself is not a column:
 * santoJoiningByRowId() reads it.
 */
export function breakoutRows(sessions: readonly BreakoutSessionData[] = BREAKOUT_SESSIONS): BreakoutRow[] {
  const rows: BreakoutRow[] = [];
  const seen = new Map<string, string>();
  for (const s of sessions) {
    const where = `${s.track} ${s.day} ${s.start} "${s.title}"`;
    if (s.track !== "BHAIO" && s.track !== "BEHNO") throw new Error(`Breakout ${where}: unknown track.`);
    const date = DAY_DATE[s.day];
    if (!date) throw new Error(`Breakout ${where}: unknown day.`);
    const clock = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!clock.test(s.start) || !clock.test(s.end) || s.end <= s.start) {
      throw new Error(`Breakout ${where}: times must be "HH:MM" with the end after the start.`);
    }
    if (!s.title.trim()) throw new Error(`Breakout ${where}: missing title.`);
    // The sheet's cells carry headcounts ("eBKY RA 74"); a title is team names only.
    if (/\b\d+\b/.test(s.title)) throw new Error(`Breakout ${where}: the title has a number (a headcount?).`);
    const rooms = s.rooms.map((r) => r.trim()).filter(Boolean);
    if (rooms.length === 0) throw new Error(`Breakout ${where}: no room.`);
    if (s.teams.length === 0) throw new Error(`Breakout ${where}: no teams.`);
    for (const text of [s.title, ...rooms, s.note ?? ""]) {
      const problem = guestTextProblem(text);
      if (problem) throw new Error(`Breakout ${where}: "${text}" ${problem}.`);
    }
    const santosProblem = santosMarkProblem(s, clock);
    if (santosProblem) throw new Error(`Breakout ${where}: the "Santo joining" mark ${santosProblem}.`);

    for (const team of s.teams) {
      if (!isTeamCode(team)) {
        throw new Error(`Breakout ${where}: unknown team "${team}". Add it to TEAM_CODES in src/lib/teams.ts.`);
      }
      const id = breakoutId(s.track, s.day, s.start, team);
      const clash = seen.get(id);
      if (clash) throw new Error(`Breakout ${where}: team ${team} already has a session at that time (${clash}).`);
      seen.set(id, where);
      rows.push({
        id,
        seva: team,
        audience: s.track,
        title: s.title.trim(),
        description: s.note?.trim() || (rooms.length > 1 ? SPLIT_NOTE : null),
        room: rooms.join(" · "),
        facilitator: null,
        startsAt: at(date, s.start),
        endsAt: at(date, s.end),
        originalStartsAt: null,
        originalEndsAt: null,
      });
    }
  }
  return mergeBackToBack(rows);
}

/**
 * Joins a team's back-to-back rows that read the same (track, title, rooms and
 * note), so a guest sees one continuous session rather than repeated cards:
 * the first row's id and start, the last row's end. Only drops rows, so ids
 * stay unique. Keeps the data order of the rows that remain.
 */
function mergeBackToBack(rows: BreakoutRow[]): BreakoutRow[] {
  const byStart = [...rows].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const last = new Map<string, BreakoutRow>();
  const dropped = new Set<string>();
  for (const row of byStart) {
    const key = [row.audience, row.seva, row.title, row.room, row.description ?? ""].join("|");
    const prev = last.get(key);
    if (prev && prev.endsAt.getTime() === row.startsAt.getTime()) {
      prev.endsAt = row.endsAt;
      dropped.add(row.id);
    } else {
      last.set(key, row);
    }
  }
  return rows.filter((r) => !dropped.has(r.id));
}

/**
 * A "Santo joining" window (BreakoutSessionData.santos) as offsets (ms) from its row's printed
 * start, so it moves with the row: a live move from /admin/schedule shifts the row's times, and
 * the window is read from the live start (startsAt + startMs). `endMs` null = to the row's end,
 * whatever that is live (the mark runs to the row's printed end, so a session that runs over
 * keeps the santos to its new end); otherwise startsAt + endMs.
 */
export type SantoJoining = { startMs: number; endMs: number | null };

/**
 * The "Santo joining" marks by `breakouts` row id: every row of a marked entry (breakoutId() of
 * each of its teams) -> the window as offsets from the entry's printed start (`true` = the whole
 * entry). When mergeBackToBack() joined the entry to the same team's row just before it (so its
 * own id is gone), the row that took it in carries the window instead, with offsets from that
 * row's start, so the window stays the entry's part of the longer row; likewise a row that runs
 * on past a marked entry gets a window ending at the entry's end. When two marked entries end
 * up in one row (both halves of a merged session marked), the row carries their union if the
 * windows touch or overlap; one row can't carry two separate windows, so that throws. Pure
 * (static data, no database); throws, as breakoutRows() does, on a bad mark. Nothing here is
 * stored.
 */
export function santoJoiningByRowId(sessions: readonly BreakoutSessionData[] = BREAKOUT_SESSIONS): Map<string, SantoJoining> {
  const rows = breakoutRows(sessions);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out = new Map<string, SantoJoining>();
  for (const s of sessions) {
    if (!s.santos) continue;
    const date = DAY_DATE[s.day];
    const window = s.santos === true ? { start: s.start, end: s.end } : s.santos;
    const from = at(date, window.start).getTime();
    const to = at(date, window.end).getTime();
    const entryStart = at(date, s.start).getTime();
    const entryEnd = at(date, s.end).getTime();
    const room = s.rooms.map((r) => r.trim()).filter(Boolean).join(" · ");
    for (const team of s.teams) {
      const row =
        byId.get(breakoutId(s.track, s.day, s.start, team)) ??
        rows.find(
          (r) =>
            r.audience === s.track &&
            r.seva === team &&
            r.title === s.title.trim() &&
            r.room === room &&
            r.startsAt.getTime() <= entryStart &&
            r.endsAt.getTime() >= entryEnd,
        );
      if (!row) throw new Error(`Breakout ${s.track} ${s.day} ${s.start} "${s.title}": no row for team ${team} to carry the "Santo joining" mark.`);
      const start = row.startsAt.getTime();
      const length = row.endsAt.getTime() - start;
      let startMs = from - start;
      let endMs = to - start;
      const prev = out.get(row.id);
      if (prev) {
        // Another marked entry already put a window on this row (mergeBackToBack() joined them).
        const prevEnd = prev.endMs ?? length;
        if (!(prev.startMs <= endMs && startMs <= prevEnd)) {
          throw new Error(
            `Breakout ${s.track} ${s.day} ${s.start} "${s.title}": two "Santo joining" windows on one row (${row.id}) ` +
              "that don't touch; one row can carry only one window.",
          );
        }
        startMs = Math.min(startMs, prev.startMs);
        endMs = Math.max(endMs, prevEnd);
      }
      out.set(row.id, { startMs, endMs: endMs >= length ? null : endMs });
    }
  }
  return out;
}

type Counts = { created: number; updated: number; unchanged: number; deleted: number };

export type BreakoutSyncResult = {
  /** Per track (the rows' audience). */
  byTrack: Record<BreakoutTrack, Counts>;
  /** Both tracks, plus any "bk-" row with another audience that was deleted. */
  total: Counts;
  /** Ids of the "bk-" rows deleted because they are no longer in the data. */
  deletedIds: string[];
  /** BAPS IDs of users whose breakout_sessions still list a deleted row (not changed here). */
  stillLinked: string[];
  dryRun: boolean;
};

const zero = (): Counts => ({ created: 0, updated: 0, unchanged: 0, deleted: 0 });
const isTrack = (audience: Audience): audience is BreakoutTrack => audience === "BHAIO" || audience === "BEHNO";
const sameTime = (a: Date | null, b: Date | null) => (a === null || b === null ? a === b : a.getTime() === b.getTime());

type BreakoutWrite = Omit<BreakoutRow, "id" | "originalStartsAt" | "originalEndsAt"> & {
  originalStartsAt: Date | null;
  originalEndsAt: Date | null;
};

/**
 * What to write to an existing row so it matches the data, or null when it
 * already does. Compared on the row's printed times (original_* once moved from
 * /admin/schedule), so a live move alone is not a change. A moved row keeps its
 * live offset, re-based on the data's printed times, so it stays with the slot
 * it moved with and Undo still lands it on its printed times; with
 * `resetMoves` (the seed, which recreates the schedule at its printed times) it
 * goes back to its printed times instead.
 */
function writeFor(db: Breakout, row: BreakoutRow, resetMoves: boolean): BreakoutWrite | null {
  const { id: _id, ...printed } = row;
  const moved = db.originalStartsAt !== null && db.originalEndsAt !== null;
  const printedStart = db.originalStartsAt ?? db.startsAt;
  const printedEnd = db.originalEndsAt ?? db.endsAt;
  const same =
    db.seva === row.seva &&
    db.audience === row.audience &&
    db.title === row.title &&
    db.description === row.description &&
    db.room === row.room &&
    db.facilitator === row.facilitator &&
    sameTime(printedStart, row.startsAt) &&
    sameTime(printedEnd, row.endsAt);
  if (same && !(moved && resetMoves)) return null;
  if (!moved || resetMoves) return printed;
  return {
    ...printed,
    startsAt: new Date(row.startsAt.getTime() + (db.startsAt.getTime() - printedStart.getTime())),
    endsAt: new Date(row.endsAt.getTime() + (db.endsAt.getTime() - printedEnd.getTime())),
    originalStartsAt: row.startsAt,
    originalEndsAt: row.endsAt,
  };
}

/**
 * Makes the "bk-" rows of `breakouts` match breakouts-data.ts, in one
 * transaction: new rows are created, changed rows are rewritten (content and
 * printed times) and "bk-" rows no longer in the data are deleted. Other rows
 * are never touched. A row moved live from /admin/schedule keeps its move (and
 * counts as unchanged when only the move differs from the data), unless
 * `resetMoves` puts every "bk-" row back on its printed times (the seed). With
 * `dryRun`, only counts what it would do.
 */
export async function syncBreakouts(
  prisma: PrismaClient,
  opts: { dryRun?: boolean; resetMoves?: boolean } = {},
): Promise<BreakoutSyncResult> {
  const rows = breakoutRows();
  const dryRun = opts.dryRun === true;
  const resetMoves = opts.resetMoves === true;

  return prisma.$transaction(
    async (tx) => {
      const existing = await tx.breakout.findMany({ where: { id: { startsWith: BREAKOUT_ID_PREFIX } } });
      const byId = new Map(existing.map((b) => [b.id, b]));
      const wanted = new Set(rows.map((r) => r.id));
      const byTrack: Record<BreakoutTrack, Counts> = { BHAIO: zero(), BEHNO: zero() };
      const total = zero();

      const creates: BreakoutRow[] = [];
      const updates: { id: string; data: BreakoutWrite }[] = [];
      for (const row of rows) {
        const db = byId.get(row.id);
        const data = db ? writeFor(db, row, resetMoves) : null;
        const outcome = !db ? "created" : data ? "updated" : "unchanged";
        byTrack[row.audience][outcome]++;
        total[outcome]++;
        if (!db) creates.push(row);
        else if (data) updates.push({ id: row.id, data });
      }
      const stale = existing.filter((b) => !wanted.has(b.id));
      for (const b of stale) {
        if (isTrack(b.audience)) byTrack[b.audience].deleted++;
        total.deleted++;
      }
      const deletedIds = stale.map((b) => b.id);

      if (!dryRun) {
        for (const row of creates) await tx.breakout.create({ data: row });
        for (const { id, data } of updates) await tx.breakout.update({ where: { id }, data });
        if (deletedIds.length) await tx.breakout.deleteMany({ where: { id: { in: deletedIds } } });
      }
      const stillLinked = deletedIds.length
        ? (
            await tx.user.findMany({
              where: { breakoutSessions: { hasSome: deletedIds } },
              select: { bapsId: true },
              orderBy: { bapsId: "asc" },
            })
          ).map((u) => u.bapsId)
        : [];

      return { byTrack, total, deletedIds, stillLinked, dryRun };
    },
    // ~200 rows over a remote connection: well past the 5 s default.
    { maxWait: 15_000, timeout: 120_000 },
  );
}

const TRACK_NAME: Record<BreakoutTrack, string> = { BHAIO: "Bhaio", BEHNO: "Behno" };

/** Console lines for a sync result, e.g. "Bhaio: 104 rows (104 created, 0 updated, 0 unchanged), 0 deleted". */
export function syncSummary(r: BreakoutSyncResult): string[] {
  const line = (name: string, c: Counts) =>
    `${name}: ${c.created + c.updated + c.unchanged} rows (${c.created} created, ${c.updated} updated, ` +
    `${c.unchanged} unchanged), ${c.deleted} deleted`;
  const lines = (Object.keys(TRACK_NAME) as BreakoutTrack[]).map((t) => line(TRACK_NAME[t], r.byTrack[t]));
  const other = r.total.deleted - r.byTrack.BHAIO.deleted - r.byTrack.BEHNO.deleted;
  if (other > 0) lines.push(`Other: ${other} "${BREAKOUT_ID_PREFIX}" row(s) with audience ALL deleted`);
  if (r.stillLinked.length) {
    lines.push(`Note: ${r.dryRun ? "rows to delete are" : "deleted rows are"} still in the breakout_sessions of ${r.stillLinked.join(", ")}.`);
  }
  return lines;
}
