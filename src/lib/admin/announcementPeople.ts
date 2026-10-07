/**
 * The people behind a personal announcement (notifications.user_ids): the
 * composer's "Specific people" search, and the look-up of listed accounts for
 * the history, the overview and a restored draft.
 *
 * Server only (Prisma), admin callers only: the server actions in
 * src/app/admin/announcements/actions.ts check getAdmin() before calling in.
 * What leaves is a PersonPick: the account id, the name (greetingName(); a
 * sant's santName()), BAPS ID, role and seva (sevaLabel()), which is all the
 * picker and the history show. Never an email, a phone or anything else of the
 * `users` row.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { PersonPick } from "@/lib/admin/announcements";
import { santName } from "@/lib/sant";
import { sevaLabel } from "@/lib/teams";
import { greetingName } from "@/lib/users";

/** Most matches one search returns. */
export const PEOPLE_SEARCH_LIMIT = 20;
/** Longest query looked at, and the most words in it. */
export const PEOPLE_QUERY_MAX = 80;
const QUERY_WORDS_MAX = 5;

const PICK_SELECT = {
  id: true,
  name: true,
  displayName: true,
  bapsId: true,
  role: true,
  seva: true,
} satisfies Prisma.UserSelect;
type PickRow = Prisma.UserGetPayload<{ select: typeof PICK_SELECT }>;

/** A listed account with the stored seva too (users.seva as it is), for the seva filter's counts. */
export type ListedPerson = PersonPick & { rawSeva: string };

function toListed(u: PickRow): ListedPerson {
  // A sant goes by santName() everywhere (plain name: no "Pujya", "Sadhu" or "Swami").
  const name = u.role === "SANT" ? santName(u) : greetingName(u);
  return { id: u.id, name, bapsId: u.bapsId, role: u.role, seva: sevaLabel(u.seva), rawSeva: u.seva };
}

/**
 * A search word as a literal for Prisma's `contains` / `startsWith` /
 * insensitive `equals`, which hand it to LIKE as it is: without this "_" and
 * "%" are wildcards ("__" would list everyone). Backslash is LIKE's escape.
 */
function literal(word: string): string {
  return word.replace(/[\\%_]/g, "\\$&");
}

/** What the browser gets: no stored seva spelling (it may carry the sheet's track prefix). */
export function toPersonPick(p: ListedPerson): PersonPick {
  return { id: p.id, name: p.name, bapsId: p.bapsId, role: p.role, seva: p.seva };
}

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

/**
 * Accounts of every role (delegates, santos, admins) matching `query`: each
 * word must be part of the name, the greeting name or the BAPS ID, or start
 * the organisers' User Id (registration_id). At most PEOPLE_SEARCH_LIMIT,
 * an exact BAPS ID or User Id first, then by name; `more` says there were
 * others. A query under 2 characters matches no one. Control characters are
 * dropped (Postgres refuses a NUL byte), and "%" / "_" match only themselves.
 */
export async function searchPeople(query: string): Promise<{ people: PersonPick[]; more: boolean }> {
  const q = query
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
    .trim()
    .slice(0, PEOPLE_QUERY_MAX);
  if (q.length < 2) return { people: [], more: false };
  const words = q.split(/\s+/).filter(Boolean).slice(0, QUERY_WORDS_MAX).map(literal);

  const [exact, rows] = await Promise.all([
    prisma.user.findMany({
      where: { OR: [{ bapsId: { equals: literal(q), mode: "insensitive" } }, { registrationId: q }] },
      take: PEOPLE_SEARCH_LIMIT,
      select: PICK_SELECT,
    }),
    prisma.user.findMany({
      where: {
        AND: words.map((w) => ({
          OR: [
            { name: { contains: w, mode: "insensitive" as const } },
            { displayName: { contains: w, mode: "insensitive" as const } },
            { bapsId: { contains: w, mode: "insensitive" as const } },
            { registrationId: { startsWith: w } },
          ],
        })),
      },
      orderBy: [{ name: "asc" }, { bapsId: "asc" }],
      take: PEOPLE_SEARCH_LIMIT + 1,
      select: PICK_SELECT,
    }),
  ]);

  const seen = new Set(exact.map((u) => u.id));
  const rest = rows
    .filter((u) => !seen.has(u.id))
    .map(toListed)
    .sort((a, b) => collator.compare(a.name, b.name) || collator.compare(a.bapsId, b.bapsId));
  const all = [...exact.map(toListed), ...rest];
  return {
    people: all.slice(0, PEOPLE_SEARCH_LIMIT).map(toPersonPick),
    more: all.length > PEOPLE_SEARCH_LIMIT || rows.length > PEOPLE_SEARCH_LIMIT,
  };
}

/**
 * The accounts with these ids that exist, by id. Ids whose account was deleted
 * are simply absent (a personal announcement reaches no one through them).
 */
export async function getPeopleByIds(ids: readonly string[]): Promise<Map<string, ListedPerson>> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return new Map();
  const rows = await prisma.user.findMany({ where: { id: { in: wanted } }, select: PICK_SELECT });
  return new Map(rows.map((u) => [u.id, toListed(u)]));
}
