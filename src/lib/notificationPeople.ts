/**
 * `notifications.user_ids` (the accounts a personal announcement is for) was
 * added on 2026-10-02. Until the schema is pushed to a database, any Prisma
 * query that names the column fails (P2022), and Prisma names it in every
 * `notification.create()`, given or not (it fills in the `[]` default itself).
 * So until the push:
 *  - everything that reads the table goes through withPeopleColumn(), which
 *    reads it the old way: without the column, every row an ordinary (not
 *    personal) announcement, exactly as before;
 *  - everything that adds a row goes through createNotification(), which
 *    inserts it without the column (plain SQL), so ordinary announcements and
 *    the schedule engine's notices still go out;
 *  - publishing to specific people asks hasPeopleColumn() first and refuses
 *    with PEOPLE_NEED_PUSH (src/lib/admin/announcements.ts).
 * From the first query after the push on, the column is used (no deploy, no
 * wait: see `schemaState`).
 *
 * Code deployed before 2026-10-02 has no such column in its Prisma client. A
 * personal announcement is therefore stored with PERSONAL_MARK as its only
 * seva and region (normaliseTargeting() in src/lib/admin/announcements.ts): to
 * that code it is a row aimed at a seva and a region nobody has, so it shows
 * it to no one (not to its recipients either), never to everyone. That covers
 * a rollback, an old deployment on the same database and a scheduled personal
 * row coming due under old code. Still deploy this code everywhere first, then
 * push, then send to specific people, so the people it is for do get it.
 *
 * The same pattern as `hotlines.topic` / `.audience` in src/lib/helpContacts.ts.
 * Server only (Prisma).
 */
import { randomBytes } from "node:crypto";
import { Prisma, type Audience, type NotificationKind, type UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";

/** The app's Prisma client, or a transaction of it. */
type Db = Prisma.TransactionClient;

/**
 * What is known (per server instance) about `notifications.user_ids` in this
 * database. "behind" = a query found it missing: every later one then asks the
 * catalog first (a query that cannot fail, so an unpushed database costs one
 * failed query and one error line per instance, not one per page view) and
 * goes the old way only while it is still missing.
 */
let schemaState: "unknown" | "current" | "behind" = "unknown";

/** True for Prisma's "column does not exist" (the schema not pushed since the column was added). */
function isMissingColumn(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2022";
}

/**
 * True when this database's `notifications` has `user_ids` (false too when
 * there is no such table). Asks the catalog, so it never fails a transaction.
 */
export async function hasPeopleColumn(db: Db = prisma): Promise<boolean> {
  const rows = await db.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n
    FROM pg_attribute
    WHERE attrelid = to_regclass('notifications')
      AND attname = 'user_ids'
      AND NOT attisdropped`;
  const has = rows[0]?.n === 1;
  schemaState = has ? "current" : "behind";
  return has;
}

/**
 * Runs a read of `notifications` that may name `user_ids`: `read(true)` on a
 * database that has the column, `read(false)` (the same read without it) on
 * one that doesn't. `read` must not write anything (it can run twice) and must
 * not run inside a transaction (a failed query would abort it).
 */
export async function withPeopleColumn<T>(read: (people: boolean) => Promise<T>): Promise<T> {
  if (schemaState === "behind" && !(await hasPeopleColumn())) return read(false);
  try {
    const out = await read(true);
    schemaState = "current";
    return out;
  } catch (err) {
    if (!isMissingColumn(err)) throw err;
    schemaState = "behind";
    return read(false);
  }
}

/** A new `notifications` row. `userIds` (not empty) makes it a personal announcement. */
export type NewNotification = {
  kind: NotificationKind;
  title: string;
  body: string | null;
  href: string | null;
  audience: Audience;
  roles: readonly UserRole[];
  sevas: readonly string[];
  regions: readonly string[];
  userIds?: readonly string[];
  /** The admin publishing it; null for `npm run notify`. */
  createdById: string | null;
  /** Publish time (a future one schedules it); default now. */
  createdAt?: Date;
};

/** Thrown by createNotification() for a personal announcement on a database without the column. */
export class PeopleColumnMissingError extends Error {
  constructor() {
    super("notifications.user_ids does not exist in this database yet (run prisma db push)");
    this.name = "PeopleColumnMissingError";
  }
}

/**
 * Adds a `notifications` row: the one way the app creates them. On a database
 * with `user_ids` this is a plain Prisma create. On one without it yet, the
 * row is inserted by SQL that doesn't name the column (a Prisma create would
 * fail there); a personal announcement can't be stored then and throws
 * PeopleColumnMissingError (callers refuse before getting here). Safe inside a
 * transaction: the column is looked up in the catalog first, never by a
 * failing query.
 */
export async function createNotification(db: Db, data: NewNotification): Promise<{ id: string; createdAt: Date }> {
  const userIds = [...(data.userIds ?? [])];
  const createdAt = data.createdAt ?? new Date();
  if (schemaState === "current" || (await hasPeopleColumn(db))) {
    return db.notification.create({
      data: {
        kind: data.kind,
        title: data.title,
        body: data.body,
        href: data.href,
        audience: data.audience,
        roles: [...data.roles],
        sevas: [...data.sevas],
        regions: [...data.regions],
        userIds,
        createdById: data.createdById,
        createdAt,
      },
      select: { id: true, createdAt: true },
    });
  }
  if (userIds.length > 0) throw new PeopleColumnMissingError();

  // Same shape as Prisma's ids (a "c" and 24 characters); any unique string does.
  const id = `c${randomBytes(12).toString("hex")}`;
  // Lists travel as JSON text (an empty array parameter has no element type to infer), and the
  // time as timestamptz turned into the UTC wall clock the `timestamp` column holds.
  const list = (values: readonly string[]) =>
    Prisma.sql`ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(values)}::jsonb))`;
  await db.$executeRaw`
    INSERT INTO notifications (id, kind, title, body, href, audience, roles, sevas, regions, created_by_id, created_at)
    VALUES (
      ${id}, ${data.kind}::"NotificationKind", ${data.title}, ${data.body}, ${data.href},
      ${data.audience}::"Audience", ${list(data.roles)}::"UserRole"[], ${list(data.sevas)}, ${list(data.regions)},
      ${data.createdById}, (${createdAt}::timestamptz AT TIME ZONE 'UTC')
    )`;
  return { id, createdAt };
}
