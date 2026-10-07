/**
 * Help contacts: who a delegate calls about their hotel room (/stay) or their
 * airport transport (/transportation). They are the `hotlines` rows with role
 * DELEGATE, each with a `topic` (STAY, TRANSPORT, or GENERAL = both pages) and
 * an `audience` (BHAIO / BEHNO, or ALL = both tracks). A page shows its
 * topic's lines and the GENERAL ones for the guest's track; when none match,
 * it shows no help block at all (there is no desk to send anyone to).
 *
 * The names and phone numbers are the organisers' contacts and live only in
 * the database: they are set with `npm run hotlines -- --add ...`
 * (scripts/hotlines.ts), never in code, data files or docs.
 *
 * `hotlines.topic` / `hotlines.audience` were added on 2026-10-01. Until the
 * schema is pushed to a database, reading them fails (Prisma P2022); the
 * lines are then read the old way: every DELEGATE line, for both pages and
 * both tracks, exactly as before. From the first read after the push on, the
 * columns are used (no deploy, no wait: see `schemaState`), so a contact added
 * for one track is never shown to the other by this code. Code deployed before
 * 2026-10-01 has no such rule: deploy this first, then push, then add contacts.
 * The Santo pages read their SANT lines through getHotlines() (src/lib/sant.ts),
 * which never reads the new columns.
 *
 * Server only (Prisma). What leaves this module is plain, serialisable data.
 */
import { cache } from "react";
import { Prisma, type Audience, type Gender, type HotlineTopic } from "@prisma/client";
import { prisma } from "@/lib/db";
import { tracksFor } from "@/lib/admin/announcements";
import { formatPhone, type HotlineView } from "@/lib/sant";
import { toE164 } from "@/lib/users";

/** The pages that list help contacts: /stay and /transportation. */
export type HelpTopic = Exclude<HotlineTopic, "GENERAL">;

/** A DELEGATE hotline with what decides who sees it where. */
export type DelegateLine = HotlineView & {
  /** STAY / TRANSPORT, or GENERAL (both pages). */
  topic: HotlineTopic;
  /** Whose contact: BHAIO, BEHNO or ALL (both tracks). */
  audience: Audience;
};

/**
 * A contact as a guest sees it. `forTrack` names the track ("Bhaio" / "Behno")
 * only for a guest with no gender on file, who sees both tracks' contacts;
 * null otherwise (their own track's, or one for everyone).
 */
export type HelpContactView = DelegateLine & { forTrack: "Bhaio" | "Behno" | null };

/** Which tracks have someone to call about a topic (ALL covers both). */
export type HelpCoverage = { bhaio: boolean; behno: boolean };

/** The columns `hotlines` has always had: safe to read before the schema is pushed. */
const BASE_SELECT = {
  id: true,
  label: true,
  contactName: true,
  phone: true,
  availability: true,
  sortOrder: true,
} satisfies Prisma.HotlineSelect;

/** ALL first, then Bhaio, then Behno (after sortOrder). */
const AUDIENCE_ORDER: readonly Audience[] = ["ALL", "BHAIO", "BEHNO"];

const prismaCode = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError ? err.code : null;

/**
 * True when this database doesn't have `hotlines.topic` / `.audience` yet
 * (P2022, a missing column: the schema not pushed since they were added).
 */
export function isHotlineSchemaBehind(err: unknown): boolean {
  return prismaCode(err) === "P2022";
}

/**
 * What is known (per server instance) about `hotlines.topic` / `.audience` in
 * this database. "behind" = a read found them missing: every later read then
 * asks the catalog first (a query that cannot fail, so an unpushed database
 * costs one failed query and one error line per instance, not one per page
 * view) and reads the old way only while they are still missing. The first
 * read after the push uses them, so there is no window in which a line added
 * for one track could still be read as "for everyone".
 */
let schemaState: "unknown" | "current" | "behind" = "unknown";

/** True when `hotlines` has both columns (false too when there is no such table). */
async function hasTopicColumns(): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n
    FROM pg_attribute
    WHERE attrelid = to_regclass('hotlines')
      AND attname IN ('topic', 'audience')
      AND NOT attisdropped`;
  return rows[0]?.n === 2;
}

type LineRow = Prisma.HotlineGetPayload<{ select: typeof BASE_SELECT }> & { topic: HotlineTopic; audience: Audience };

/** The old-way read: every DELEGATE line, as GENERAL and for everyone. */
async function readLegacyLines(): Promise<LineRow[]> {
  const rows = await prisma.hotline.findMany({ where: { role: "DELEGATE" }, select: BASE_SELECT });
  return rows.map((r) => ({ ...r, topic: "GENERAL", audience: "ALL" }));
}

async function readLines(): Promise<LineRow[]> {
  if (schemaState === "behind" && !(await hasTopicColumns())) return readLegacyLines();
  try {
    const rows = await prisma.hotline.findMany({
      where: { role: "DELEGATE" },
      select: { ...BASE_SELECT, topic: true, audience: true },
    });
    schemaState = "current";
    return rows;
  } catch (err) {
    if (!isHotlineSchemaBehind(err)) throw err;
    schemaState = "behind";
    return readLegacyLines();
  }
}

/**
 * Every DELEGATE hotline, lowest sortOrder first (then ALL / Bhaio / Behno,
 * label, name). Before the schema push each line reads as GENERAL and ALL
 * (see the header); empty when there is no hotlines table at all (P2021).
 * Cached per request.
 */
export const getDelegateLines = cache(async (): Promise<DelegateLine[]> => {
  let rows: LineRow[];
  try {
    rows = await readLines();
  } catch (err) {
    if (prismaCode(err) === "P2021") return [];
    throw err;
  }
  return rows
    .sort(
      (a, b) =>
        a.sortOrder - b.sortOrder ||
        AUDIENCE_ORDER.indexOf(a.audience) - AUDIENCE_ORDER.indexOf(b.audience) ||
        a.label.localeCompare(b.label) ||
        (a.contactName ?? "").localeCompare(b.contactName ?? ""),
    )
    .map((h) => ({
      id: h.id,
      label: h.label,
      contactName: h.contactName,
      phone: h.phone,
      phoneDisplay: formatPhone(h.phone),
      telHref: `tel:${toE164(h.phone) ?? h.phone.replace(/[^\d+]/g, "")}`,
      availability: h.availability,
      // Telegram buttons are for the Santo contacts only (user, 2026-10-06).
      telegramHref: null,
      topic: h.topic,
      audience: h.audience,
    }));
});

/**
 * The contacts a guest sees on the page for `topic`, out of `lines`
 * (getDelegateLines()): that topic's lines first, then the GENERAL ones, each
 * group in the order given; only those for everyone (ALL) or for the guest's
 * track. `track` is the guest's trackGender() (src/lib/admin/announcements.ts):
 * MALE -> Bhaio, FEMALE -> Behno, null (no gender on file) -> both, like every
 * other track rule, each then marked with its track (forTrack).
 */
export function pickHelpContacts(
  lines: readonly DelegateLine[],
  topic: HelpTopic,
  track: Gender | null,
): HelpContactView[] {
  const audiences = tracksFor(track);
  const mine = lines.filter((l) => audiences.includes(l.audience));
  return [...mine.filter((l) => l.topic === topic), ...mine.filter((l) => l.topic === "GENERAL")].map((l) => ({
    ...l,
    forTrack: track !== null || l.audience === "ALL" ? null : l.audience === "BHAIO" ? "Bhaio" : "Behno",
  }));
}

/** The contacts a guest of `track` (trackGender()) sees on the page for `topic`. */
export async function helpContactsFor(topic: HelpTopic, track: Gender | null): Promise<HelpContactView[]> {
  return pickHelpContacts(await getDelegateLines(), topic, track);
}

/**
 * Which tracks have a contact on the page for `topic` (that topic's lines or
 * a GENERAL one): for the admin boards' "delegates see no contact" notes.
 */
export function helpCoverage(lines: readonly DelegateLine[], topic: HelpTopic): HelpCoverage {
  const covers = (track: Gender) => pickHelpContacts(lines, topic, track).length > 0;
  return { bhaio: covers("MALE"), behno: covers("FEMALE") };
}

/** helpCoverage() over the database's lines. Admin callers. */
export async function getHelpCoverage(topic: HelpTopic): Promise<HelpCoverage> {
  return helpCoverage(await getDelegateLines(), topic);
}
