/**
 * Data helpers for the Pujya Santo view (/sant).
 *
 * Santos are `users` rows with role = SANT. They have:
 *   - sant_general_schedule_items  the Santo general schedule, Oct 5-15, shared by
 *                           every sant (src/lib/santSchedule.ts; never the delegates'
 *                           `schedule_items`)
 *   - sant_schedule_items   their personal programme (pickups, puja, pravachans...):
 *                           the real santos' rows ("sp-*") come only from
 *                           `npm run sant:personal:sync` (prisma/sant-personal.ts,
 *                           from prisma/sant-personal-data.ts); the tester
 *                           SANTO0001's from `npm run sant:demo`
 *   - sant_accommodations   utaros, each shared by the santos placed there
 *                           (users.sant_accommodation_id; `npm run sant:utaro`)
 *   - hotlines              phone lines per role, e.g. the transport hotline
 *                           (the delegates' own are read in src/lib/helpContacts.ts)
 *
 * Server-only: this module imports Prisma. Call it from server components or
 * route handlers and pass the returned view objects (plain data, ISO date
 * strings) to client components; client code may `import type` from here.
 *
 * Per-person reads (getSantSchedules(), getPersonalSchedule(), getAccommodation())
 * take the requireSant() object's `dataUserId`, never its `id`: for a Santo
 * mirror test account (withMirror() in src/lib/auth.ts) that is the mirrored
 * sant's users.id, so the pages show his programme and utaro; for everyone else
 * it is their own id. Writes and the bell stay on the session's own `id`.
 */
import { Prisma, type Gender, type HotlineTopic, type SantAccommodation, type SantScheduleItem, type ScheduleItem, type User, type UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { tracksFor } from "@/lib/admin/announcements";
import { annotateSchedule, type ScheduleItemView } from "@/lib/schedule";
import { venueTrackOf } from "@/lib/venue/route";
import type { VenueTrack } from "@/lib/venue/types";
import { getSantGeneralSchedule } from "@/lib/santSchedule";
import { santName } from "@/lib/santName";
import { telegramHref } from "@/lib/telegram";
import { toE164 } from "@/lib/users";

// ---------------------------------------------------------------------------
// Roles and names
// ---------------------------------------------------------------------------

/** Home route of the Pujya Santo view. */
export const SANT_HOME = "/sant";

/** True when the user is a Pujya Sant (users.role = SANT). */
export function isSant(user: Pick<User, "role"> | null | undefined): boolean {
  return user?.role === "SANT";
}

/**
 * A sant's name as shown in the Santo view: no honorifics, e.g. "Munitilakdas"
 * ("Sadhu Munitilakdas" -> "Munitilakdas", "Pujya Test Swami" -> "Test"). Lives in
 * src/lib/santName.ts (pure, so src/lib/auth.ts and scripts can use it too).
 */
export { santName };

/** @deprecated use santName (kept so existing callers compile; returns the same plain name). */
export const santTitle: typeof santName = santName;

/**
 * A sant's track where the delegate content's Bhaio / Behno split applies (the
 * announcements in his bell): the recorded gender, or MALE when none is on
 * file, so santos get the shared items plus the Bhaio track, never both. (The
 * Santo general schedule has no tracks.)
 */
export function santGender(user: Pick<User, "gender">): Gender {
  return user.gender ?? "MALE";
}

/**
 * A sant's track on the venue map (src/lib/venue/route.ts): by santGender(), so the Bhaio side's
 * stairs and elevators, and the Bhaio room of a place with one room per track ("Samp Square").
 * /sant/map and the room links on /sant/breakouts both use it, so a link opens the room it was
 * checked against.
 */
export function santVenueTrack(user: Pick<User, "gender">): VenueTrack | null {
  return venueTrackOf(tracksFor(santGender(user)));
}

// ---------------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------------

/**
 * A sant's personal programme, in time order (the order the annotate helpers expect). `userId`:
 * the requireSant() object's `dataUserId` (a Santo mirror's mirrored sant).
 */
export async function getPersonalSchedule(userId: string): Promise<SantScheduleItem[]> {
  return prisma.santScheduleItem.findMany({
    where: { userId },
    orderBy: [{ startsAt: "asc" }, { sortOrder: "asc" }],
  });
}

/**
 * Adapts personal rows to the general `ScheduleItem` shape (audience ALL), so
 * they can go through the helpers in src/lib/schedule.ts, e.g.
 * `currentAndNext(personalAsScheduleItems(rows), now)`.
 */
export function personalAsScheduleItems(items: SantScheduleItem[]): ScheduleItem[] {
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
      // Personal items aren't moved from /admin/schedule, so they have no printed-time record.
      originalStartsAt: null,
      originalEndsAt: null,
    }),
  );
}

/**
 * Personal items as `ScheduleItemView`, exactly what annotateSchedule() returns
 * (audience "ALL"; status past / now / next / upcoming relative to `now`), so
 * <ScheduleView items={...}> renders a personal timeline unchanged.
 * Pass rows in time order, as returned by getPersonalSchedule().
 */
export function annotatePersonalSchedule(items: SantScheduleItem[], now: Date): ScheduleItemView[] {
  return annotateSchedule(personalAsScheduleItems(items), now);
}

/**
 * Both timelines for /sant/schedule and the Santo home, annotated against
 * `now` separately (each list gets its own "Now" / "Up next"):
 *  - general:  the Santo general schedule, Oct 5-15 (getSantGeneralSchedule();
 *              never moved live, so no delay badges)
 *  - personal: this sant's own programme (`userId`: the requireSant() object's
 *              `dataUserId`, so a Santo mirror shows the mirrored sant's)
 */
export async function getSantSchedules(
  userId: string,
  now: Date,
): Promise<{ general: ScheduleItemView[]; personal: ScheduleItemView[] }> {
  const [general, personal] = await Promise.all([getSantGeneralSchedule(now), getPersonalSchedule(userId)]);
  return { general, personal: annotatePersonalSchedule(personal, now) };
}

// ---------------------------------------------------------------------------
// Accommodation (utaro)
// ---------------------------------------------------------------------------

/** A sant placed at the same utaro, by santName(). */
export type CompanionView = { id: string; name: string };

/**
 * An utaro as the Santo view shows it. No address: the view doesn't show one
 * (sant_accommodations.address is kept for the organisers' records only and is
 * never read here).
 */
export type AccommodationView = {
  id: string;
  /** Residence or place name. */
  placeName: string;
  hostName: string | null;
  /** E.164, for building links; prefer hostTelHref / hostPhoneDisplay in the UI. */
  hostPhone: string | null;
  /** e.g. "(732) 555-0117" */
  hostPhoneDisplay: string | null;
  /** e.g. "tel:+17325550117" */
  hostTelHref: string | null;
  /** The host's Telegram chat, e.g. "https://t.me/example_host" (src/lib/telegram.ts); null when none on file. */
  hostTelegramHref: string | null;
  notes: string | null;
  /** The other santos placed at the same accommodation (never the viewer), by santName, sorted. */
  companions: CompanionView[];
};

/** The sant_accommodations columns the Santo view reads (never the address). */
const ACCOMMODATION_FIELDS = { id: true, placeName: true, hostName: true, hostPhone: true, notes: true } as const;
/** `hostTelegram` absent: read from a database without the column yet (see withTelegramColumns()). */
type AccommodationRow = Pick<SantAccommodation, keyof typeof ACCOMMODATION_FIELDS> & { hostTelegram?: string | null };

// ---------------------------------------------------------------------------
// Telegram columns (hotlines.telegram, sant_accommodations.host_telegram)
// ---------------------------------------------------------------------------

/**
 * Both columns were added on 2026-10-06 (one schema push adds both). Until a database has them,
 * Prisma fails any query naming them (P2022): the Santo reads then go without them (no Telegram
 * buttons, everything else as before). Once a read has found them missing, each later one asks
 * the catalog first (a query that can't fail), so an unpushed database costs one failed query
 * per server instance, and the first read after the push uses them. As in src/lib/helpContacts.ts.
 */
let telegramColumns: "unknown" | "current" | "behind" = "unknown";

async function hasTelegramColumns(): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n
    FROM pg_attribute
    WHERE NOT attisdropped
      AND ((attrelid = to_regclass('hotlines') AND attname = 'telegram')
        OR (attrelid = to_regclass('sant_accommodations') AND attname = 'host_telegram'))`;
  const has = rows[0]?.n === 2;
  telegramColumns = has ? "current" : "behind";
  return has;
}

/** Runs a read that names the Telegram columns (`read(true)`), or the same read without them. */
async function withTelegramColumns<T>(read: (telegram: boolean) => Promise<T>): Promise<T> {
  if (telegramColumns === "behind" && !(await hasTelegramColumns())) return read(false);
  try {
    const out = await read(true);
    telegramColumns = "current";
    return out;
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2022")) throw err;
    telegramColumns = "behind";
    return read(false);
  }
}

/**
 * Serialisable view of a sant_accommodations row. `companions` are the other
 * santos placed there (the caller leaves out the viewer); they are shown by
 * santName() and sorted by it.
 */
export function toAccommodationView(
  row: AccommodationRow,
  companions: Pick<User, "id" | "name" | "displayName">[] = [],
): AccommodationView {
  return {
    id: row.id,
    placeName: row.placeName,
    hostName: row.hostName,
    hostPhone: row.hostPhone,
    hostPhoneDisplay: row.hostPhone ? formatPhone(row.hostPhone) : null,
    hostTelHref: row.hostPhone ? telHref(row.hostPhone) : null,
    hostTelegramHref: telegramHref(row.hostTelegram),
    notes: row.notes,
    companions: companions
      .map((s) => ({ id: s.id, name: santName(s) }))
      .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || a.id.localeCompare(b.id)),
  };
}

/**
 * The utaro this sant is placed at (users.sant_accommodation_id), with the
 * other santos placed there (never `userId` himself), or null when none has
 * been assigned yet. `userId`: the requireSant() object's `dataUserId`, so a
 * Santo mirror shows the mirrored sant's utaro and companions.
 */
export async function getAccommodation(userId: string): Promise<AccommodationView | null> {
  const row = await withTelegramColumns(async (telegram) => {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        santAccommodation: {
          select: {
            ...ACCOMMODATION_FIELDS,
            ...(telegram ? { hostTelegram: true } : {}),
            santos: {
              where: { role: "SANT", id: { not: userId } },
              select: { id: true, name: true, displayName: true },
            },
          },
        },
      },
    });
    return user?.santAccommodation ?? null;
  });
  return row ? toAccommodationView(row, row.santos) : null;
}

// ---------------------------------------------------------------------------
// Hotlines
// ---------------------------------------------------------------------------

export type HotlineView = {
  id: string;
  /** e.g. "Transport hotline" */
  label: string;
  contactName: string | null;
  /** As stored (E.164). */
  phone: string;
  /** e.g. "(732) 555-0142" */
  phoneDisplay: string;
  /** e.g. "tel:+17325550142" */
  telHref: string;
  /** e.g. "24/7 during NAAM" */
  availability: string | null;
  /** The line's Telegram chat, e.g. "https://t.me/example_name" (src/lib/telegram.ts); null when none on file. */
  telegramHref: string | null;
};

/** A Santo contact line: which page shows it (`topic`: TRANSPORT, STAY, or GENERAL = both). */
export type SantLine = HotlineView & { topic: HotlineTopic };

const LINE_FIELDS = { id: true, label: true, contactName: true, phone: true, availability: true } as const;

/**
 * Hotlines shown to `role` (default SANT), lowest sortOrder first. Empty array
 * when none. This is the Santo pages' read, with each line's `topic` (organisers'
 * "General Contact Info", 2026-10-04: General, Utaro / Laundry = STAY, Transport);
 * `audience` is ignored (santos are all on one side). On a database the
 * 2026-10-01 schema hasn't been pushed to (no `topic` column, P2022) every line
 * reads as GENERAL, so it shows on both pages as before. The delegates' pages
 * read their lines by topic and track through src/lib/helpContacts.ts instead. Each line's
 * Telegram username (2026-10-06) is read once the schema with it is pushed (withTelegramColumns()).
 */
export async function getHotlines(role: UserRole = "SANT"): Promise<SantLine[]> {
  const orderBy = [{ sortOrder: "asc" as const }, { label: "asc" as const }];
  type Row = {
    id: string;
    label: string;
    contactName: string | null;
    phone: string;
    availability: string | null;
    topic: HotlineTopic;
    telegram: string | null;
  };
  const rows = await withTelegramColumns(async (telegram): Promise<Row[]> => {
    // A missing Telegram column has to reach withTelegramColumns() (it retries without it).
    if (telegram) {
      return prisma.hotline.findMany({ where: { role }, orderBy, select: { ...LINE_FIELDS, topic: true, telegram: true } });
    }
    try {
      const pushed = await prisma.hotline.findMany({ where: { role }, orderBy, select: { ...LINE_FIELDS, topic: true } });
      return pushed.map((h) => ({ ...h, telegram: null }));
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2022")) throw err;
      const legacy = await prisma.hotline.findMany({ where: { role }, orderBy, select: LINE_FIELDS });
      return legacy.map((h) => ({ ...h, topic: "GENERAL" as const, telegram: null }));
    }
  });
  return rows.map((h) => ({
    id: h.id,
    label: h.label,
    contactName: h.contactName,
    phone: h.phone,
    phoneDisplay: formatPhone(h.phone),
    telHref: telHref(h.phone),
    availability: h.availability,
    telegramHref: telegramHref(h.telegram),
    topic: h.topic,
  }));
}

/**
 * The Santo contacts a page shows: the lines of its topic first, then the
 * GENERAL ones, each group in its stored order (`getHotlines()` order). The
 * transport page and the home's Transport tile take TRANSPORT, the stay page STAY.
 */
export function santContactsFor<T extends { topic: HotlineTopic }>(lines: readonly T[], topic: Exclude<HotlineTopic, "GENERAL">): T[] {
  return [...lines.filter((l) => l.topic === topic), ...lines.filter((l) => l.topic === "GENERAL")];
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** "+17325550142" -> "(732) 555-0142". Non-North-American numbers are returned unchanged. */
export function formatPhone(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return phone;
}

function telHref(phone: string): string {
  return `tel:${toE164(phone) ?? phone.replace(/[^\d+]/g, "")}`;
}
