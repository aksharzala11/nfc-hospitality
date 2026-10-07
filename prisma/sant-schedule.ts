/**
 * The Pujya Santo general schedule: turns prisma/sant-schedule-data.ts (generated
 * from the "Master Schedule" tab of the organisers' Santo workbook) into
 * `sant_general_schedule_items` rows and syncs them into the database. Used by
 * prisma/seed.ts (always, like the team breakouts) and `npm run sant:schedule:sync`.
 *
 * Ids are stable, "ss-<day>-<HHMM>-<title slug>" (e.g.
 * "ss-2026-10-09-0915-keynote-program-1"), so a re-sync only rewrites what
 * changed. The sync owns the whole table: rows no longer in the data are
 * deleted. The admin live-schedule engine never moves these rows, so there are
 * no printed times to keep.
 */
import type { PrismaClient, SantGeneralScheduleItem, ScheduleKind } from "@prisma/client";
import { SANT_GENERAL_SCHEDULE, SANT_SCHEDULE_DAYS, type SantGeneralItemData } from "./sant-schedule-data";
import { SANT_DAYS } from "../src/lib/time";

/** Every row id starts with this. */
export const SANT_SCHEDULE_ID_PREFIX = "ss-";

/**
 * Lower case, anything other than a letter or digit -> "-", runs collapsed, no leading/trailing "-"
 * (as in prisma/breakouts.ts). Also the title part of the personal programme's ids
 * (prisma/sant-personal.ts).
 */
export function santSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// October is EDT (UTC-4) in New Jersey for the whole Santo programme (Oct 5-15;
// DST ends Nov 1), exactly as prisma/seed.ts and prisma/breakouts.ts build times.
const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00-04:00`);

/** The kinds a Santo schedule item may have (the general schedule and the personal programmes). */
export const SANT_KINDS: readonly ScheduleKind[] = ["ARTI", "SESSION", "BREAKOUT", "MEAL", "BREAK", "TRAVEL", "FREE"];

export function santScheduleId(item: Pick<SantGeneralItemData, "day" | "start" | "title">): string {
  return `${SANT_SCHEDULE_ID_PREFIX}${item.day}-${item.start.replace(":", "")}-${santSlug(item.title)}`;
}

/** One `sant_general_schedule_items` row as the sync writes it (every column). */
export type SantScheduleRow = Pick<
  SantGeneralScheduleItem,
  "id" | "title" | "description" | "location" | "kind" | "startsAt" | "endsAt" | "sortOrder"
>;

/**
 * Sheet shorthand guests must never see: the "[i/eBKY Combined]" note and the
 * lower-case track prefixes ("eBKY", "iSA", "eiBKY"). The generators already
 * drop them; this keeps it that way. Shared with the personal programmes
 * (prisma/sant-personal.ts). Null when the text is fine.
 */
export function guestTextProblem(text: string): string | null {
  if (/combined\]/i.test(text) || /\[\s*[ei]\s*\/\s*[ei]/i.test(text)) return 'has the "[i/eBKY Combined]" note';
  if (/(?:^|[\s(+&/,])(?:ei|e|i)(?=[A-Z]{2})/.test(text)) return "has an e/i/ei track prefix";
  return null;
}

/**
 * SANT_GENERAL_SCHEDULE as rows, in data order. Throws on data the app can't
 * show correctly (a day outside SANT_DAYS, bad or overlapping times, an unknown
 * kind, empty titles, sheet shorthand, duplicate ids), so a bad regeneration
 * fails the seed or sync instead of reaching the santos.
 */
export function santScheduleRows(items: readonly SantGeneralItemData[] = SANT_GENERAL_SCHEDULE): SantScheduleRow[] {
  if (SANT_SCHEDULE_DAYS.join() !== SANT_DAYS.join()) {
    throw new Error(
      "SANT_SCHEDULE_DAYS in prisma/sant-schedule-data.ts no longer matches SANT_DAYS in src/lib/time.ts " +
        `(${SANT_SCHEDULE_DAYS.join(", ")} vs ${SANT_DAYS.join(", ")}). Update SANT_DAYS to the new days.`,
    );
  }
  const clock = /^([01]\d|2[0-3]):[0-5]\d$/;
  const rows: SantScheduleRow[] = [];
  const seen = new Set<string>();
  const lastEnd = new Map<string, string>(); // day -> end of its previous item
  for (const [i, item] of items.entries()) {
    const where = `${item.day} ${item.start} "${item.title}"`;
    if (!SANT_DAYS.includes(item.day)) throw new Error(`Santo schedule ${where}: the day is not in SANT_DAYS.`);
    if (!clock.test(item.start) || !clock.test(item.end) || item.end <= item.start) {
      throw new Error(`Santo schedule ${where}: times must be "HH:MM" with the end after the start.`);
    }
    const prevEnd = lastEnd.get(item.day);
    if (prevEnd !== undefined && item.start < prevEnd) {
      throw new Error(`Santo schedule ${where}: out of order or overlapping the item before it (ends ${prevEnd}).`);
    }
    lastEnd.set(item.day, item.end);
    if (!SANT_KINDS.includes(item.kind)) throw new Error(`Santo schedule ${where}: unknown kind "${item.kind}".`);
    const title = item.title.replace(/\s+/g, " ").trim();
    if (!title) throw new Error(`Santo schedule ${where}: missing title.`);
    const description = item.description?.replace(/\s+/g, " ").trim() || null;
    const location = item.location?.replace(/\s+/g, " ").trim() || null;
    for (const text of [title, description ?? "", location ?? ""]) {
      const problem = guestTextProblem(text);
      if (problem) throw new Error(`Santo schedule ${where}: "${text}" ${problem}.`);
    }
    const id = santScheduleId({ ...item, title });
    if (seen.has(id)) throw new Error(`Santo schedule ${where}: duplicate id ${id}.`);
    seen.add(id);
    rows.push({
      id,
      title,
      description,
      location,
      kind: item.kind,
      startsAt: at(item.day, item.start),
      endsAt: at(item.day, item.end),
      sortOrder: i,
    });
  }
  return rows;
}

export type SantScheduleSyncResult = {
  created: number;
  updated: number;
  unchanged: number;
  deleted: number;
  /** Ids of rows deleted because they are no longer in the data. */
  deletedIds: string[];
  dryRun: boolean;
};

const sameRow = (db: SantGeneralScheduleItem, row: SantScheduleRow) =>
  db.title === row.title &&
  db.description === row.description &&
  db.location === row.location &&
  db.kind === row.kind &&
  db.startsAt.getTime() === row.startsAt.getTime() &&
  db.endsAt.getTime() === row.endsAt.getTime() &&
  db.sortOrder === row.sortOrder;

/**
 * Makes `sant_general_schedule_items` match sant-schedule-data.ts, in one
 * transaction: new rows are created, changed rows rewritten and rows no longer
 * in the data deleted. With `dryRun`, only counts what it would do.
 */
export async function syncSantSchedule(
  prisma: PrismaClient,
  opts: { dryRun?: boolean } = {},
): Promise<SantScheduleSyncResult> {
  const rows = santScheduleRows();
  const dryRun = opts.dryRun === true;

  return prisma.$transaction(
    async (tx) => {
      const existing = await tx.santGeneralScheduleItem.findMany();
      const byId = new Map(existing.map((r) => [r.id, r]));
      const wanted = new Set(rows.map((r) => r.id));

      const creates: SantScheduleRow[] = [];
      const updates: SantScheduleRow[] = [];
      let unchanged = 0;
      for (const row of rows) {
        const db = byId.get(row.id);
        if (!db) creates.push(row);
        else if (!sameRow(db, row)) updates.push(row);
        else unchanged++;
      }
      const deletedIds = existing.filter((r) => !wanted.has(r.id)).map((r) => r.id);

      if (!dryRun) {
        if (deletedIds.length) await tx.santGeneralScheduleItem.deleteMany({ where: { id: { in: deletedIds } } });
        if (creates.length) await tx.santGeneralScheduleItem.createMany({ data: creates });
        for (const { id, ...data } of updates) await tx.santGeneralScheduleItem.update({ where: { id }, data });
      }

      return { created: creates.length, updated: updates.length, unchanged, deleted: deletedIds.length, deletedIds, dryRun };
    },
    // ~120 rows over a remote connection: well past the 5 s default.
    { maxWait: 15_000, timeout: 120_000 },
  );
}

/** Console lines for a sync result, e.g. "Santo general schedule: 122 rows (122 created, 0 updated, 0 unchanged), 0 deleted". */
export function santScheduleSummary(r: SantScheduleSyncResult): string[] {
  const total = r.created + r.updated + r.unchanged;
  return [
    `Santo general schedule: ${total} rows (${r.created} created, ${r.updated} updated, ${r.unchanged} unchanged), ` +
      `${r.deleted} deleted`,
  ];
}
