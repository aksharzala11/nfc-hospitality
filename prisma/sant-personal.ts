/**
 * The Pujya Santos' personal programmes: turns prisma/sant-personal-data.ts (generated from the
 * "Individual Schedule" tab of the organisers' Santo workbook) into `sant_schedule_items` rows and
 * syncs them into the database. Run by `npm run sant:personal:sync` only, never by the seed (the
 * rows belong to the real santo accounts, which come from `npm run santos:import`).
 *
 * Ids are stable, "sp-<BAPS ID lower-case>-<day>-<HHMM>-<title slug>" (e.g.
 * "sp-vd2101-2026-10-08-1700-mukhpath-testing"), so a re-sync only rewrites what changed. The
 * sync owns every "sp-" row: new ones are created, changed ones rewritten and those no longer in
 * the data deleted. Every other row of the table (the tester SANTO0001's sample programme from
 * `npm run sant:demo`, say) is never written, only counted.
 *
 * Santos are found by BAPS ID: a listed BAPS ID without an account, or held by an account that
 * isn't a SANT, stops the sync before anything is written. So does a sync whose deletes would
 * take every "sp-" row from a santo (one dropped from the data: almost always a regeneration
 * gone wrong), unless `allowDeletes`. The Santo pages read the rows per account
 * (getPersonalSchedule() in src/lib/sant.ts, by the requireSant() object's `dataUserId`, so a
 * Santo mirror shows the mirrored sant's programme).
 */
import type { PrismaClient, SantScheduleItem } from "@prisma/client";
import { SANT_PERSONAL, type SantPersonalData, type SantPersonalItemData } from "./sant-personal-data";
import { SANTOS, type SantoData } from "./santos-data";
import { SANT_KINDS, guestTextProblem, santSlug } from "./sant-schedule";
import { SANT_DAYS } from "../src/lib/time";
import { santName } from "../src/lib/santName";

/** Every row id this sync owns starts with this. */
export const SANT_PERSONAL_ID_PREFIX = "sp-";

// October is EDT (UTC-4) in New Jersey for the whole Santo programme (Oct 5-15; DST ends Nov 1),
// exactly as prisma/sant-schedule.ts and prisma/seed.ts build times.
const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00-04:00`);

export function santPersonalId(bapsId: string, item: Pick<SantPersonalItemData, "day" | "start" | "title">): string {
  return `${SANT_PERSONAL_ID_PREFIX}${bapsId.toLowerCase()}-${item.day}-${item.start.replace(":", "")}-${santSlug(item.title)}`;
}

/** One `sant_schedule_items` row as the sync writes it, with its santo's BAPS ID in place of the users.id. */
export type SantPersonalRow = Pick<
  SantScheduleItem,
  "id" | "title" | "description" | "location" | "kind" | "startsAt" | "endsAt" | "sortOrder"
> & { bapsId: string };

/**
 * SANT_PERSONAL as rows, santo by santo in data order, each santo's items in time order
 * (sortOrder = the item's place in his list). Throws on data the app can't show correctly: a
 * BAPS ID not in SANTOS or listed twice, a santo with no items, a day outside SANT_DAYS, bad,
 * unsorted or overlapping times within one santo, an unknown kind, an empty title, sheet
 * shorthand (the general schedule's checks), duplicate ids. So a bad regeneration fails the sync
 * before it reaches the database.
 */
export function santPersonalRows(
  data: readonly SantPersonalData[] = SANT_PERSONAL,
  santos: readonly Pick<SantoData, "bapsId">[] = SANTOS,
): SantPersonalRow[] {
  const known = new Set(santos.map((s) => s.bapsId));
  const clock = /^([01]\d|2[0-3]):[0-5]\d$/;
  const rows: SantPersonalRow[] = [];
  const listed = new Set<string>();
  const ids = new Set<string>();
  for (const santo of data) {
    const who = `Santo personal programme ${santo.bapsId}`;
    if (!known.has(santo.bapsId)) throw new Error(`${who}: the BAPS ID is not in SANTOS (prisma/santos-data.ts).`);
    if (listed.has(santo.bapsId)) throw new Error(`${who}: listed twice.`);
    listed.add(santo.bapsId);
    if (santo.items.length === 0) throw new Error(`${who}: no items (leave him out instead).`);
    let prev: SantPersonalItemData | null = null;
    for (const [i, item] of santo.items.entries()) {
      const where = `${who} ${item.day} ${item.start} "${item.title}"`;
      if (!SANT_DAYS.includes(item.day)) throw new Error(`${where}: the day is not in SANT_DAYS.`);
      if (!clock.test(item.start) || !clock.test(item.end) || item.end <= item.start) {
        throw new Error(`${where}: times must be "HH:MM" with the end after the start.`);
      }
      if (prev && (item.day < prev.day || (item.day === prev.day && item.start < prev.end))) {
        throw new Error(`${where}: out of order or overlapping his item before it (${prev.day} ${prev.start}-${prev.end}).`);
      }
      prev = item;
      if (!SANT_KINDS.includes(item.kind)) throw new Error(`${where}: unknown kind "${item.kind}".`);
      const title = item.title.replace(/\s+/g, " ").trim();
      if (!title) throw new Error(`${where}: missing title.`);
      const description = item.description?.replace(/\s+/g, " ").trim() || null;
      const location = item.location?.replace(/\s+/g, " ").trim() || null;
      for (const text of [title, description ?? "", location ?? ""]) {
        const problem = guestTextProblem(text);
        if (problem) throw new Error(`${where}: "${text}" ${problem}.`);
      }
      const id = santPersonalId(santo.bapsId, { ...item, title });
      if (ids.has(id)) throw new Error(`${where}: duplicate id ${id}.`);
      ids.add(id);
      rows.push({
        id,
        bapsId: santo.bapsId,
        title,
        description,
        location,
        kind: item.kind,
        startsAt: at(item.day, item.start),
        endsAt: at(item.day, item.end),
        sortOrder: i,
      });
    }
  }
  return rows;
}

type Counts = { created: number; updated: number; unchanged: number; deleted: number };
const zero = (): Counts => ({ created: 0, updated: 0, unchanged: 0, deleted: 0 });

/** What the sync did (or would do) to one santo's "sp-" rows. */
export type SantPersonalChange = Counts & {
  bapsId: string;
  /** santName() of his account. */
  name: string;
  /** In the data (false: only stale "sp-" rows of his are left to delete). */
  listed: boolean;
};

export type SantPersonalSyncResult = {
  totals: Counts;
  /** The listed santos in data order, then any other santo with "sp-" rows to delete. */
  santos: SantPersonalChange[];
  /** Ids of the "sp-" rows deleted (or, dry run, to delete) because they are no longer in the data. */
  deletedIds: string[];
  /** Santos whose every "sp-" row the deletes take (refused without allowDeletes). */
  emptied: { bapsId: string; name: string; rows: number }[];
  /** A real run stopped before writing: `emptied` isn't empty and allowDeletes wasn't given. */
  refused: boolean;
  allowDeletes: boolean;
  /** Rows of the table this sync doesn't own (id not "sp-"), per account: left alone. */
  others: { bapsId: string; name: string; rows: number }[];
  dryRun: boolean;
};

type DbRow = SantScheduleItem;

const sameRow = (db: DbRow, row: SantPersonalRow, userId: string) =>
  db.userId === userId &&
  db.title === row.title &&
  db.description === row.description &&
  db.location === row.location &&
  db.kind === row.kind &&
  db.startsAt.getTime() === row.startsAt.getTime() &&
  db.endsAt.getTime() === row.endsAt.getTime() &&
  db.sortOrder === row.sortOrder;

const ACCOUNT = { id: true, bapsId: true, role: true, name: true, displayName: true } as const;

/**
 * Makes the "sp-" rows of `sant_schedule_items` match sant-personal-data.ts, in one transaction:
 * new rows are created, changed rows rewritten and "sp-" rows no longer in the data deleted;
 * other rows are only counted. Throws (nothing written) when a listed BAPS ID has no account or
 * belongs to an account that isn't a SANT. With `dryRun`, only works out what it would do; a
 * real run whose deletes would empty a santo's whole programme writes nothing and comes back
 * `refused` unless `allowDeletes`.
 */
export async function syncSantPersonal(
  prisma: PrismaClient,
  opts: { dryRun?: boolean; allowDeletes?: boolean } = {},
): Promise<SantPersonalSyncResult> {
  const rows = santPersonalRows();
  const dryRun = opts.dryRun === true;
  const allowDeletes = opts.allowDeletes === true;
  const bapsIds = [...new Set(rows.map((r) => r.bapsId))];

  return prisma.$transaction(
    async (tx) => {
      const accounts = await tx.user.findMany({ where: { bapsId: { in: bapsIds } }, select: ACCOUNT });
      const byBapsId = new Map(accounts.map((u) => [u.bapsId, u]));
      const problems: string[] = [];
      for (const b of bapsIds) {
        const u = byBapsId.get(b);
        if (!u) problems.push(`${b}: no account with this BAPS ID (run \`npm run santos:import\` first)`);
        else if (u.role !== "SANT") problems.push(`${b}: the account's role is ${u.role}, not SANT`);
      }
      if (problems.length) {
        throw new Error(`Santo personal programmes not synced, nothing written:\n  ${problems.join("\n  ")}`);
      }
      const userIdOf = (bapsId: string) => byBapsId.get(bapsId)!.id;

      const existing = await tx.santScheduleItem.findMany({
        where: { id: { startsWith: SANT_PERSONAL_ID_PREFIX } },
        include: { user: { select: ACCOUNT } },
      });
      const byId = new Map(existing.map((r) => [r.id, r]));
      const wanted = new Set(rows.map((r) => r.id));

      const santos = new Map<string, SantPersonalChange>(); // users.id -> change
      const changeFor = (u: { id: string; bapsId: string; name: string; displayName: string | null }, listed: boolean) => {
        let c = santos.get(u.id);
        if (!c) {
          c = { ...zero(), bapsId: u.bapsId, name: santName(u), listed };
          santos.set(u.id, c);
        }
        return c;
      };
      for (const b of bapsIds) changeFor(byBapsId.get(b)!, true);

      const creates: (SantPersonalRow & { userId: string })[] = [];
      const updates: (SantPersonalRow & { userId: string })[] = [];
      const totals = zero();
      for (const row of rows) {
        const userId = userIdOf(row.bapsId);
        const c = changeFor(byBapsId.get(row.bapsId)!, true);
        const db = byId.get(row.id);
        if (!db) {
          creates.push({ ...row, userId });
          c.created++;
        } else if (!sameRow(db, row, userId)) {
          updates.push({ ...row, userId });
          c.updated++;
        } else c.unchanged++;
      }
      const stale = existing.filter((r) => !wanted.has(r.id));
      for (const r of stale) changeFor(r.user, false).deleted++;
      for (const c of santos.values()) {
        totals.created += c.created;
        totals.updated += c.updated;
        totals.unchanged += c.unchanged;
        totals.deleted += c.deleted;
      }

      // A santo who has "sp-" rows now and would have none after the sync (every listed santo
      // keeps his rows: santPersonalRows() refuses one with no items).
      const keeps = new Set(rows.map((r) => userIdOf(r.bapsId)));
      const emptied = [...santos.entries()]
        .filter(([userId, c]) => c.deleted > 0 && !keeps.has(userId))
        .map(([, c]) => ({ bapsId: c.bapsId, name: c.name, rows: c.deleted }));

      const otherRows = await tx.santScheduleItem.findMany({
        where: { NOT: { id: { startsWith: SANT_PERSONAL_ID_PREFIX } } },
        select: { userId: true, user: { select: ACCOUNT } },
      });
      const others = new Map<string, { bapsId: string; name: string; rows: number }>();
      for (const r of otherRows) {
        const o = others.get(r.userId) ?? { bapsId: r.user.bapsId, name: santName(r.user), rows: 0 };
        o.rows++;
        others.set(r.userId, o);
      }

      const refused = !dryRun && emptied.length > 0 && !allowDeletes;
      if (!dryRun && !refused) {
        if (stale.length) await tx.santScheduleItem.deleteMany({ where: { id: { in: stale.map((r) => r.id) } } });
        if (creates.length) {
          await tx.santScheduleItem.createMany({
            data: creates.map(({ bapsId: _bapsId, ...row }) => row),
          });
        }
        for (const { id, bapsId: _bapsId, ...data } of updates) await tx.santScheduleItem.update({ where: { id }, data });
      }

      return {
        totals,
        santos: [...santos.values()].sort((a, b) => Number(b.listed) - Number(a.listed)),
        deletedIds: stale.map((r) => r.id).sort(),
        emptied,
        refused,
        allowDeletes,
        others: [...others.values()].sort((a, b) => a.bapsId.localeCompare(b.bapsId)),
        dryRun,
      };
    },
    // ~50 rows over a remote connection: well past the 5 s default.
    { maxWait: 15_000, timeout: 120_000 },
  );
}

const counts = (c: Counts) => {
  const n = c.created + c.updated + c.unchanged;
  return `${n} item${n === 1 ? "" : "s"} (${c.created} created, ${c.updated} updated, ${c.unchanged} unchanged), ${c.deleted} deleted`;
};

/** Console lines for a sync result: the totals, then one line per santo ("VD2101 Viraldarshandas: 4 items (...)"). */
export function santPersonalSummary(r: SantPersonalSyncResult): string[] {
  const listed = r.santos.filter((s) => s.listed).length;
  const lines = [`Santo personal programmes: ${listed} santos, ${counts(r.totals)}`];
  for (const s of r.santos) {
    lines.push(`  ${s.bapsId} ${s.name}: ${s.listed ? counts(s) : `not in the data, ${s.deleted} deleted`}`);
  }
  if (r.emptied.length) {
    const who = r.emptied.map((e) => `${e.bapsId} ${e.name} (${e.rows})`).join(", ");
    const verdict = r.dryRun
      ? r.allowDeletes
        ? "A real run with --allow-deletes would go ahead"
        : "A real run would refuse (nothing written) unless --allow-deletes"
      : r.refused
        ? "Refused, nothing written"
        : "Went ahead (--allow-deletes)";
    lines.push(`${verdict}: the deletes take every "sp-" row of ${who}`);
  }
  lines.push(
    r.others.length
      ? `Other rows of the table, not this sync's (left alone): ${r.others.map((o) => `${o.bapsId} ${o.name} ${o.rows}`).join(", ")}`
      : "No other rows in the table.",
  );
  return lines;
}
