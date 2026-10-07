/**
 * The admin bounce tracker (/admin/bounces, the Overview card, the directory's
 * "Email bounced" note): the email_events rows that the SNS endpoint
 * (/api/ses/events) and `npm run ses:bounces -- --backfill` store, folded per
 * address (src/lib/emailEvents/view.ts) and matched to the accounts whose
 * email is that address now (case-insensitive). An address no account has any
 * more (the email was changed since) shows as "No account with this address".
 *
 * Server only (Prisma). Callers have checked requireAdmin() / getAdmin(): the
 * tracker lists names, BAPS IDs and addresses. What leaves is plain data
 * (formatted strings): never the SES message id.
 *
 * Until the database has the email_events table (`npm run db:push`), every
 * read returns null / nothing ("not set up yet") instead of failing.
 */
import { Prisma, type PrismaClient, type UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normaliseAddress } from "@/lib/emailEvents/ses";
import {
  bounceCounts,
  eventLabel,
  eventTone,
  groupEmailEvents,
  subTypeLabel,
  tidyNote,
  type BounceCounts,
  type EventTone,
  type RecipientGroup,
  type StoredEmailEvent,
} from "@/lib/emailEvents/view";
import { santName } from "@/lib/santName";
import { sevaLabel } from "@/lib/teams";
import { dayKey, formatDayShort, formatTime } from "@/lib/time";
import { greetingName } from "@/lib/users";

/** P2021: the email_events table isn't in this database yet. */
export function isEmailEventsTableMissing(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2021";
}

/** "Thu, Oct 1 · 9:14 AM" (Eastern). */
function stamp(d: Date): string {
  return `${formatDayShort(dayKey(d))} · ${formatTime(d)}`;
}

/** Every stored event, as the grouping reads it; null when the table is missing. */
async function readEvents(): Promise<StoredEmailEvent[] | null> {
  try {
    const rows = await prisma.emailEvent.findMany({
      select: {
        id: true,
        kind: true,
        recipient: true,
        bounceType: true,
        bounceSubType: true,
        diagnostic: true,
        complaintType: true,
        occurredAt: true,
        source: true,
        resolvedAt: true,
        note: true,
        resolvedBy: { select: { name: true, displayName: true } },
      },
      orderBy: { occurredAt: "desc" },
    });
    return rows.map(({ resolvedBy, ...r }) => ({ ...r, resolvedByName: resolvedBy ? greetingName(resolvedBy) : null }));
  } catch (err) {
    if (isEmailEventsTableMissing(err)) return null;
    throw err;
  }
}

/** One account whose email is the bounced address now. */
export type BouncePerson = {
  id: string;
  bapsId: string;
  /** greetingName(); a sant's santName(). */
  name: string;
  role: UserRole;
  /** sevaLabel(). */
  seva: string;
};

/**
 * The accounts per address (lower-cased), for the given addresses. Matched
 * with lower() = in SQL: Prisma's case-insensitive equals may become ILIKE,
 * where the "_" many addresses have matches any character.
 */
async function peopleByAddress(addresses: readonly string[]): Promise<Map<string, BouncePerson[]>> {
  const out = new Map<string, BouncePerson[]>();
  if (addresses.length === 0) return out;
  const users = await prisma.$queryRaw<
    { id: string; bapsId: string; name: string; displayName: string | null; role: UserRole; seva: string; email: string }[]
  >`
    SELECT id, baps_id AS "bapsId", name, display_name AS "displayName", role::text AS role, seva,
           lower(btrim(email)) AS email
    FROM users
    WHERE email IS NOT NULL AND lower(btrim(email)) = ANY(${[...addresses]}::text[])
    ORDER BY name, baps_id`;
  for (const u of users) {
    const key = u.email;
    if (!key) continue;
    const person: BouncePerson = {
      id: u.id,
      bapsId: u.bapsId,
      name: u.role === "SANT" ? santName(u) : greetingName(u),
      role: u.role,
      seva: sevaLabel(u.seva),
    };
    const list = out.get(key);
    if (list) list.push(person);
    else out.set(key, [person]);
  }
  return out;
}

/** One event of an entry, as the page lists it. */
export type BounceEventView = {
  id: string;
  label: string;
  tone: EventTone;
  subType: string | null;
  diagnostic: string | null;
  /** "Thu, Oct 1 · 9:14 AM". */
  at: string;
  fromSuppressionList: boolean;
};

/** One address on the tracker. Plain and serialisable. */
export type BounceEntryView = {
  recipient: string;
  /** Accounts whose email is this address now (usually one; none = the email was changed or never was an account's). */
  people: BouncePerson[];
  open: boolean;
  /** The worst event's label ("Hard bounce", "Soft bounce", "Bounce", "Complaint", "Rejected"), tone and subtype. */
  label: string;
  tone: EventTone;
  subType: string | null;
  /** The latest server reply on file (the worst event's when it has one). */
  diagnostic: string | null;
  /** Events on file. */
  count: number;
  /** The other kinds besides the worst one, e.g. ["Soft bounce"]. */
  otherLabels: string[];
  firstAt: string;
  lastAt: string;
  /** A hard bounce: SES won't send to the address until it is off the suppression list. */
  hard: boolean;
  complaint: boolean;
  resolvedAt: string | null;
  resolvedBy: string | null;
  note: string | null;
  /** Newest first, at most EVENTS_SHOWN. */
  events: BounceEventView[];
};

export type BounceTracker = { entries: BounceEntryView[]; counts: BounceCounts };

const EVENTS_SHOWN = 6;

function eventView(e: StoredEmailEvent): BounceEventView {
  return {
    id: e.id,
    label: eventLabel(e),
    tone: eventTone(e),
    subType: subTypeLabel(e),
    diagnostic: e.diagnostic,
    at: stamp(e.occurredAt),
    fromSuppressionList: e.source === "suppression-list",
  };
}

function entryView(g: RecipientGroup, people: BouncePerson[]): BounceEntryView {
  const label = eventLabel(g.worst);
  const otherLabels = [...new Set(g.events.map(eventLabel))].filter((l) => l !== label);
  return {
    recipient: g.recipient,
    people,
    open: g.open,
    label,
    tone: eventTone(g.worst),
    subType: subTypeLabel(g.worst),
    diagnostic: g.worst.diagnostic ?? g.events.find((e) => e.diagnostic)?.diagnostic ?? null,
    count: g.events.length,
    otherLabels,
    firstAt: stamp(g.first),
    lastAt: stamp(g.last),
    hard: g.hard,
    complaint: g.complaint,
    resolvedAt: g.resolvedAt ? stamp(g.resolvedAt) : null,
    resolvedBy: g.resolvedByName,
    note: g.note,
    events: g.events.slice(0, EVENTS_SHOWN).map(eventView),
  };
}

/**
 * Every bounced address, open first (latest event first), then resolved ones,
 * with the accounts that have the address now; plus the counts. Null while
 * the email_events table doesn't exist ("not set up yet").
 */
export async function getEmailBounceTracker(): Promise<BounceTracker | null> {
  const events = await readEvents();
  if (!events) return null;
  const groups = groupEmailEvents(events);
  const people = await peopleByAddress(groups.map((g) => g.recipient));
  return {
    entries: groups.map((g) => entryView(g, people.get(g.recipient) ?? [])),
    counts: bounceCounts(groups),
  };
}

/** The Overview card's counts; null while the table doesn't exist. */
export async function getBounceCounts(): Promise<(BounceCounts & { total: number }) | null> {
  const events = await readEvents();
  if (!events) return null;
  const groups = groupEmailEvents(events);
  return { ...bounceCounts(groups), total: groups.length };
}

/** What the directory says under an account's email while that address has an open bounce. */
export type OpenBounceNote = {
  /** The worst open event's label, e.g. "Hard bounce". */
  label: string;
  /** Its latest event, "Thu, Oct 1 · 9:14 AM". */
  lastAt: string;
  hard: boolean;
};

/**
 * Open bounces by address (lower-cased), only for addresses an account has
 * now (the directory matches them against each person's email). Empty while
 * the table doesn't exist.
 */
export async function getOpenBounceNotes(): Promise<Record<string, OpenBounceNote>> {
  const events = await readEvents();
  if (!events) return {};
  const open = groupEmailEvents(events).filter((g) => g.open);
  const people = await peopleByAddress(open.map((g) => g.recipient));
  const notes: Record<string, OpenBounceNote> = {};
  for (const g of open) {
    if (!people.has(g.recipient)) continue;
    notes[g.recipient] = { label: eventLabel(g.worst), lastAt: stamp(g.last), hard: g.hard };
  }
  return notes;
}

// ---------------------------------------------------------------------------
// Resolve / reopen (the server actions in src/app/admin/bounces/actions.ts
// call these after getAdmin())
// ---------------------------------------------------------------------------

export type BounceActionResult = { ok: true } | { ok: false; error: string };

type Db = PrismaClient | Prisma.TransactionClient;

const NOT_SET_UP: BounceActionResult = {
  ok: false,
  error: "Bounce tracking isn't set up in this database yet (run npm run db:push).",
};

/** The address as stored (lower-cased, bare), or null when the value isn't one. */
function readRecipient(raw: unknown): string | null {
  const address = normaliseAddress(raw);
  return address && address === raw ? address : null;
}

/** Marks every open event of the address resolved, by `adminId`, with the note (blank = none). */
export async function resolveBounceRecord(db: Db, adminId: string, rawRecipient: unknown, rawNote: unknown): Promise<BounceActionResult> {
  const recipient = readRecipient(rawRecipient);
  if (!recipient) return { ok: false, error: "That isn't an address on the tracker." };
  try {
    const { count } = await db.emailEvent.updateMany({
      where: { recipient, resolvedAt: null },
      data: { resolvedAt: new Date(), resolvedById: adminId, note: tidyNote(rawNote) },
    });
    return count > 0 ? { ok: true } : { ok: false, error: "Nothing open for this address: it may have just been resolved." };
  } catch (err) {
    if (isEmailEventsTableMissing(err)) return NOT_SET_UP;
    throw err;
  }
}

/** Opens the address again (every event unresolved; the note stays). */
export async function reopenBounceRecord(db: Db, rawRecipient: unknown): Promise<BounceActionResult> {
  const recipient = readRecipient(rawRecipient);
  if (!recipient) return { ok: false, error: "That isn't an address on the tracker." };
  try {
    const { count } = await db.emailEvent.updateMany({
      where: { recipient, resolvedAt: { not: null } },
      data: { resolvedAt: null, resolvedById: null },
    });
    return count > 0 ? { ok: true } : { ok: false, error: "This address is already open." };
  } catch (err) {
    if (isEmailEventsTableMissing(err)) return NOT_SET_UP;
    throw err;
  }
}
