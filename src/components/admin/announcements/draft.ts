/**
 * The composer's working copy. Kept in React state (so the layout's periodic
 * router.refresh() never touches it) and mirrored to localStorage per admin,
 * so a reload or a closed tab doesn't lose a half-written announcement either.
 *
 * The people picked under "Specific people" are kept in state with their names
 * (for the chips), but only their account ids go to localStorage: no name or
 * BAPS ID is left behind on the admin's phone, and a restored draft looks the
 * people up again (lookUpAnnouncementPeople()), which also drops accounts that
 * have been deleted since. While people a draft was for can't be brought back
 * (accounts gone, or the look-up failed), their ids stay in storage
 * (`heldPeopleIds`), so every later visit asks about them again: the draft is
 * never quietly saved as one for everyone.
 */
import type { Audience, NotificationKind, UserRole } from "@prisma/client";
import {
  BODY_MAX,
  KINDS,
  LINK_HREFS,
  PEOPLE_MAX,
  ROLES,
  TITLE_MAX,
  TRACKS,
  toLinkOption,
  type AnnouncementView,
  type LinkHref,
  type PersonPick,
} from "@/lib/admin/announcements";
import { isHotelKey } from "@/lib/hotels";

export type Draft = {
  title: string;
  body: string;
  kind: NotificationKind;
  /** "" = no link. */
  href: LinkHref | "";
  audience: Audience;
  roles: UserRole[];
  sevas: string[];
  /** Not used while hotels are picked (kept, so clearing the hotels brings them back). */
  regions: string[];
  /** Hotel keys (src/lib/hotels.ts). */
  hotels: string[];
  /**
   * Specific people. While any are picked the announcement goes to exactly
   * them: the audience fields above are kept as they were (so clearing the
   * people brings them back) but not used, and are stored empty when it is sent.
   */
  people: PersonPick[];
  mode: "now" | "schedule";
  /** Eastern wall clock "YYYY-MM-DDTHH:mm" for mode "schedule"; "" = not picked yet. */
  at: string;
};

export const EMPTY_DRAFT: Draft = {
  title: "",
  body: "",
  kind: "GENERAL",
  href: "",
  audience: "ALL",
  roles: [],
  sevas: [],
  regions: [],
  hotels: [],
  people: [],
  mode: "now",
  at: "",
};

const LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** True when the admin has typed something worth keeping. */
export function hasWords(d: Draft): boolean {
  return d.title.trim() !== "" || d.body.trim() !== "";
}

/** True when nothing differs from a fresh composer. */
export function isPristine(d: Draft): boolean {
  return JSON.stringify(d) === JSON.stringify(EMPTY_DRAFT);
}

/**
 * Composer contents for "Send again": same message and audience, sent now.
 * A personal announcement comes back with the people it lists who still have
 * an account and no filters (its stored seva and region are only
 * PERSONAL_MARK). The caller must not offer it when none of them do: a personal
 * row is then copied as stored, mark and all, which reaches no one.
 */
export function draftFromAnnouncement(a: AnnouncementView): Draft {
  const people = a.people.slice(0, PEOPLE_MAX).map((p) => ({ ...p }));
  const personal = people.length > 0;
  return {
    title: a.title.slice(0, TITLE_MAX),
    body: (a.body ?? "").slice(0, BODY_MAX),
    kind: a.kind,
    href: toLinkOption(a.href) ?? "",
    audience: personal ? "ALL" : a.audience,
    roles: personal ? [] : [...a.roles],
    sevas: personal ? [] : [...a.sevas],
    regions: personal ? [] : [...a.regions],
    hotels: personal ? [] : a.hotels.filter(isHotelKey),
    people,
    mode: "now",
    at: "",
  };
}

export function draftStorageKey(adminId: string) {
  return `hh-admin-announcement-draft:${adminId}`;
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

/**
 * Saved draft for this key, or null. Tolerates anything (old shapes, blocked
 * storage). `peopleIds` are the accounts it had picked: `draft.people` comes
 * back empty, and the composer fills it by looking those ids up.
 */
export function loadDraft(key: string): { draft: Draft; peopleIds: string[] } | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (!v || typeof v !== "object") return null;
    const draft: Draft = {
      title: typeof v.title === "string" ? v.title.slice(0, TITLE_MAX) : "",
      body: typeof v.body === "string" ? v.body.slice(0, BODY_MAX) : "",
      kind: oneOf(v.kind, KINDS, "GENERAL"),
      href: oneOf<LinkHref | "">(v.href, ["", ...LINK_HREFS], ""),
      audience: oneOf(v.audience, TRACKS, "ALL"),
      roles: strings(v.roles).filter((r): r is UserRole => (ROLES as readonly string[]).includes(r)),
      sevas: strings(v.sevas),
      regions: strings(v.regions),
      hotels: strings(v.hotels).filter(isHotelKey),
      people: [],
      mode: v.mode === "schedule" ? "schedule" : "now",
      at: typeof v.at === "string" && LOCAL_DATETIME.test(v.at) ? v.at : "",
    };
    const peopleIds = [...new Set(strings(v.peopleIds).filter((id) => id !== "" && id.length <= 64))];
    return { draft, peopleIds: peopleIds.slice(0, PEOPLE_MAX) };
  } catch {
    return null;
  }
}

/**
 * Mirrors the draft to storage (people as account ids only); a pristine draft
 * clears it. `heldPeopleIds` are the ids of people the draft was for who
 * couldn't be brought back and whose notice the admin hasn't answered yet:
 * while the draft has no people picked they are kept as its `peopleIds`, so the
 * next restore looks them up, and asks, again.
 */
export function saveDraft(key: string, d: Draft, heldPeopleIds: readonly string[] = []) {
  try {
    const { people, ...rest } = d;
    const peopleIds = people.length > 0 ? people.map((p) => p.id) : [...heldPeopleIds];
    if (isPristine(d) && peopleIds.length === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify({ ...rest, peopleIds }));
  } catch {
    // Storage full or blocked (private mode): the in-memory draft still survives refreshes.
  }
}

export function clearDraft(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}
