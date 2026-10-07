/**
 * Who an organiser announcement (a `notifications` row) reaches. This is the
 * one targeting rule behind the header bell (getNotificationsFor), the admin
 * composer's live "Reaches N people" count, the announcement history's reach
 * column and `npm run notify`.
 *
 * A personal announcement (`userIds` not empty) goes to EXACTLY the accounts
 * it lists and to nobody else: none of the dimensions below is looked at. It is
 * matched on the signed-in account's own id, so a mirror test account never
 * reads the personal announcements of the delegate it mirrors. It is stored
 * with PERSONAL_MARK as its only seva and region (normaliseTargeting()), which
 * no account has: anything that reads the row without `userIds` (a build from
 * before 2026-10-02 after a rollback, an old deployment on the same database,
 * a database the column was dropped from) then shows it to no one, never to
 * everyone.
 *
 * Any other notification reaches a user when ALL of these hold:
 *  - track:  `audience` is ALL, BHAIO for men or BEHNO for women. Users with no
 *            gender on file see both tracks; a sant with none follows the Bhaio
 *            track, as his schedule does (santGender() in src/lib/sant.ts).
 *  - role:   `roles` contains the user's role or, when it is empty (no role
 *            restriction), the user's role is one the kind reaches by default
 *            (defaultRoles()): every role, except that a MENU notice with no
 *            roles is about the delegate menu (/menu) and reaches delegates
 *            and admins only. Santos have their own menu (/sant/menu), so a
 *            MENU notice reaches them only when `roles` includes SANT.
 *  - seva:   `sevas` is empty or contains the user's seva.
 *  - hotel:  `hotels` is empty or names a hotel the user has a room group at
 *            (room_assignments by their User Id, either stay: src/lib/hotelGuests.ts),
 *            so someone with no hotel room on file only gets announcements
 *            that don't pick hotels.
 *  - region: `regions` is empty or contains the user's region, so a user with
 *            no region on file only gets announcements that don't pick regions.
 *            Not used when hotels are picked (the two don't combine:
 *            normaliseTargeting() drops the regions).
 * It shows in the bell from `createdAt` on (a future createdAt schedules it).
 *
 * A hotel announcement has no column of its own: it stores its hotels in
 * `regions`, as "hotel:<key>" values (storedRegions(); hotelRegion()), and
 * fromStored() reads them back out. No account has such a region, so code that
 * doesn't know about hotels (a build from before 2026-10-05: an old deployment
 * on the same database, or a rollback) shows a hotel announcement to no one,
 * never to everyone. Every row read from the database goes through fromStored()
 * before this rule sees it (Targeting requires `hotels`, so a raw row doesn't
 * type-check here).
 *
 * Client-safe on purpose: no database access and only type imports from
 * Prisma, so the composer runs exactly this rule in the browser.
 */
import type { Audience, Gender, NotificationKind, Prisma, UserRole } from "@prisma/client";
import { compareHotels, hotelInfo } from "@/lib/hotels";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export const ROLES = ["DELEGATE", "SANT", "ADMIN"] as const satisfies readonly UserRole[];
export const TRACKS = ["ALL", "BHAIO", "BEHNO"] as const satisfies readonly Audience[];
/** Composer order. */
export const KINDS = ["GENERAL", "SCHEDULE", "TRANSPORT", "MENU"] as const satisfies readonly NotificationKind[];

export const TITLE_MAX = 80;
export const BODY_MAX = 500;
/** Most accounts one personal announcement may list. */
export const PEOPLE_MAX = 100;
/**
 * What a personal announcement stores as its only seva and its only region. No
 * account has it as either, so by the ordinary rule the row reaches nobody:
 * that is what code that doesn't know `notifications.user_ids` sees (see the
 * header). The rule here never looks at it (people come first). Never a real
 * seva or region: don't give an account this value.
 */
export const PERSONAL_MARK = "(specific people)";

/**
 * How a hotel announcement stores each hotel in `regions`: "hotel:hampton".
 * No account has such a region (a real region starting with it is refused),
 * so to code that doesn't know about hotels the row reaches no one.
 */
export const HOTEL_REGION_PREFIX = "hotel:";

/** "hampton" -> "hotel:hampton", the stored form of a picked hotel. */
export function hotelRegion(key: string): string {
  return `${HOTEL_REGION_PREFIX}${key}`;
}

/** True for a stored `regions` value that is a hotel, not a region. */
export function isHotelRegion(value: string): boolean {
  return value.startsWith(HOTEL_REGION_PREFIX);
}

export const ROLE_LABELS: Record<UserRole, { many: string; one: string }> = {
  DELEGATE: { many: "Delegates", one: "delegate" },
  SANT: { many: "Santos", one: "sant" },
  ADMIN: { many: "Admins", one: "admin" },
};

export const TRACK_LABELS: Record<Audience, string> = { ALL: "All", BHAIO: "Bhaio", BEHNO: "Behno" };

/**
 * Pages an announcement may open, in the delegate hub. The Pujya Santo view
 * maps most to its own pages (Menu to the Santo menu, Breakout Sessions to the
 * santos' breakouts, ...) and drops the rest (santHref() in
 * src/components/sant/shell/santNotifications.ts): Edison Mandir History and
 * /prasang have no sant page.
 */
export const LINK_OPTIONS = [
  { href: "/dashboard", label: "Home" },
  { href: "/schedule", label: "Schedule" },
  { href: "/menu", label: "Menu" },
  { href: "/breakouts", label: "Breakout Sessions" },
  { href: "/transportation", label: "Transportation" },
  { href: "/history", label: "Edison Mandir History" },
  { href: "/prasang", label: "Prasang submission form" },
] as const;
export type LinkHref = (typeof LINK_OPTIONS)[number]["href"];
export const LINK_HREFS = LINK_OPTIONS.map((l) => l.href) as [LinkHref, ...LinkHref[]];

export function linkLabel(href: string | null): string | null {
  if (!href) return null;
  return LINK_OPTIONS.find((l) => l.href === href)?.label ?? href;
}

/** The composer option matching a stored link (query and hash ignored), or null. */
export function toLinkOption(href: string | null): LinkHref | null {
  if (!href) return null;
  const path = href.split(/[?#]/, 1)[0].replace(/\/+$/, "") || "/";
  return LINK_HREFS.find((h) => h === path) ?? null;
}

// ---------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------

/** What a notification is aimed at: its kind plus the targeting columns. */
export type Targeting = {
  kind: NotificationKind;
  audience: Audience;
  roles: readonly UserRole[];
  sevas: readonly string[];
  /** Real regions only: never the stored "hotel:" values (fromStored() takes those out). */
  regions: readonly string[];
  /** Hotel keys (src/lib/hotels.ts); empty = any hotel, or none. Picked hotels make `regions` unused. */
  hotels: readonly string[];
  /**
   * Personal announcement: the accounts (users.id) it is for; then nothing else
   * above is looked at. Absent or empty = not personal (also how a row reads on
   * a database that doesn't have notifications.user_ids yet).
   */
  userIds?: readonly string[];
};

/**
 * The fields of a user the rule looks at. `id` is the account's own id (for a
 * mirror test account, the tester's, never the mirrored delegate's); without
 * it (the anonymous facet groups) no personal announcement matches. `hotels`:
 * the hotel keys of their room groups (either stay), sorted; absent or empty =
 * no hotel room on file.
 */
export type Recipient = {
  id?: string;
  role: UserRole;
  gender: Gender | null;
  seva: string;
  region: string | null;
  hotels?: readonly string[];
};

/** Anonymous facets: how many users share one role/gender/seva/region combination. */
export type FacetGroup = Omit<Recipient, "id"> & { count: number };

/** A person as the composer's "Specific people" picker and the history show them (admin only). */
export type PersonPick = {
  /** users.id: what the announcement stores. */
  id: string;
  /** greetingName(); a sant's santName(). */
  name: string;
  bapsId: string;
  role: UserRole;
  /** sevaLabel() of their seva. */
  seva: string;
};

/** True for a personal announcement: it lists the accounts it is for. */
export function isPersonal(t: Pick<Targeting, "userIds">): boolean {
  return (t.userIds?.length ?? 0) > 0;
}

/** Gender that decides a user's track (null = sees both tracks). */
export function trackGender(user: Pick<Recipient, "role" | "gender">): Gender | null {
  if (user.role === "SANT") return user.gender ?? "MALE";
  return user.gender;
}

/** Tracks (`audience` values) whose notifications someone of this gender sees. */
export function tracksFor(gender: Gender | null): Audience[] {
  if (gender === "MALE") return ["ALL", "BHAIO"];
  if (gender === "FEMALE") return ["ALL", "BEHNO"];
  return ["ALL", "BHAIO", "BEHNO"];
}

/** Who reads the delegate menu (/menu): delegates, and admins, who use the delegate hub. */
const DELEGATE_MENU_ROLES = ["DELEGATE", "ADMIN"] as const satisfies readonly UserRole[];

/**
 * Roles a notification of this kind reaches when `roles` is empty (no role
 * restriction). Every role, except for MENU: delegates and admins share the
 * delegate menu, while santos have their own (/sant/menu), so an unrestricted
 * MENU notice is about the delegate menu. Naming SANT in `roles` is how a
 * MENU notice reaches santos (about the Santo menu).
 */
export function defaultRoles(kind: NotificationKind): readonly UserRole[] {
  return kind === "MENU" ? DELEGATE_MENU_ROLES : ROLES;
}

/** The roles a notification actually reaches: `roles`, or defaultRoles(kind) when it names none. */
export function effectiveRoles(t: Pick<Targeting, "kind" | "roles">): readonly UserRole[] {
  return t.roles.length > 0 ? t.roles : defaultRoles(t.kind);
}

/** The rule itself: does this notification reach this user? */
export function reaches(t: Targeting, user: Recipient): boolean {
  // Personal: exactly the listed accounts, whatever their role, track, seva or region.
  if (isPersonal(t)) return user.id !== undefined && t.userIds!.includes(user.id);
  return (
    effectiveRoles(t).includes(user.role) &&
    tracksFor(trackGender(user)).includes(t.audience) &&
    (t.sevas.length === 0 || t.sevas.includes(user.seva)) &&
    (t.hotels.length > 0
      ? (user.hotels ?? []).some((h) => t.hotels.includes(h))
      : t.regions.length === 0 || (user.region !== null && t.regions.includes(user.region)))
  );
}

/**
 * How many users the targeting reaches, summed over facet groups. The groups
 * are anonymous, so a personal announcement counts 0 here: its reach is the
 * listed accounts that exist (usersReachedBy(), or the people looked up by id).
 */
export function countReach(t: Targeting, groups: readonly FacetGroup[]): number {
  let n = 0;
  for (const g of groups) if (reaches(t, g)) n += g.count;
  return n;
}

/**
 * Prisma filter for the notifications `user` sees in the bell at `now`: the
 * rule above, read from the user's side. Used by getNotificationsFor().
 *
 * `people: false` is for a database that doesn't have notifications.user_ids
 * yet (no personal announcement can exist there): the filter then never names
 * the column and is exactly the one from before personal announcements.
 *
 * Hotels and regions share the stored `regions` column: a hotel row holds only
 * "hotel:" values (never a real region, never empty), so it matches through
 * the user's hotels alone, and an ordinary row never through them.
 */
export function notificationsVisibleTo(
  user: Recipient & { id: string },
  now: Date,
  { people = true }: { people?: boolean } = {},
): Prisma.NotificationWhereInput {
  // Kinds whose unrestricted notices skip this user's role (MENU, for santos).
  const notByDefault = KINDS.filter((k) => !defaultRoles(k).includes(user.role));
  const unrestricted: Prisma.NotificationWhereInput = notByDefault.length
    ? { roles: { isEmpty: true }, kind: { notIn: notByDefault } }
    : { roles: { isEmpty: true } };
  const hotels = (user.hotels ?? []).map(hotelRegion);
  const place: Prisma.NotificationWhereInput[] = [
    { regions: { isEmpty: true } },
    ...(user.region === null ? [] : [{ regions: { has: user.region } }]),
    ...(hotels.length > 0 ? [{ regions: { hasSome: hotels } }] : []),
  ];
  const targeted: Prisma.NotificationWhereInput = {
    audience: { in: tracksFor(trackGender(user)) },
    AND: [
      { OR: [unrestricted, { roles: { has: user.role } }] },
      { OR: [{ sevas: { isEmpty: true } }, { sevas: { has: user.seva } }] },
      place.length === 1 ? place[0] : { OR: place },
    ],
  };
  if (!people) return { createdAt: { lte: now }, ...targeted };
  return {
    createdAt: { lte: now },
    // Personal ones that list this account, or the others by the rule (never both for one row).
    OR: [{ userIds: { has: user.id } }, { userIds: { isEmpty: true }, ...targeted }],
  };
}

/**
 * Prisma filter for the users a targeting reaches: the rule above, read from
 * the notification's side. Used for the authoritative count when publishing.
 * Room assignments link to users by User Id without a relation, so a hotel
 * targeting needs `atHotels`: the User Ids with a room group at its hotels
 * (registrationIdsAtHotels() in src/lib/hotelGuests.ts).
 */
export function usersReachedBy(
  t: Targeting,
  { atHotels }: { atHotels?: readonly string[] } = {},
): Prisma.UserWhereInput {
  // Personal: the listed accounts that (still) exist.
  if (isPersonal(t)) return { id: { in: [...t.userIds!] } };
  const and: Prisma.UserWhereInput[] = [];
  // The picked roles, or the kind's default (an unrestricted MENU notice: delegates and admins).
  const picked = effectiveRoles(t);
  const roles = ROLES.filter((r) => picked.includes(r));
  if (roles.length < ROLES.length) and.push({ role: { in: roles } });
  // Mirrors tracksFor(trackGender(user)): no gender on file sees both tracks,
  // except santos, who follow the Bhaio track.
  if (t.audience === "BHAIO") and.push({ OR: [{ gender: "MALE" }, { gender: null }] });
  if (t.audience === "BEHNO") and.push({ OR: [{ gender: "FEMALE" }, { gender: null, role: { not: "SANT" } }] });
  if (t.sevas.length) and.push({ seva: { in: [...t.sevas] } });
  if (t.hotels.length) {
    if (!atHotels) throw new Error("usersReachedBy: a hotel targeting needs the User Ids at its hotels (atHotels)");
    and.push({ registrationId: { in: [...atHotels] } });
  } else if (t.regions.length) {
    // SQL IN never matches NULL, so users without a region are left out here.
    and.push({ region: { in: [...t.regions] } });
  }
  return { AND: and };
}

/**
 * A stored row's targeting as the rule reads it: the "hotel:" values of
 * `regions` taken out into `hotels`. Every row read from `notifications` goes
 * through this before reaches(), countReach(), describeAudience() or a draft.
 */
export function fromStored<T extends { regions: readonly string[] }>(
  row: T,
): Omit<T, "regions"> & { regions: string[]; hotels: string[] } {
  const hotels = row.regions.filter(isHotelRegion).map((r) => r.slice(HOTEL_REGION_PREFIX.length));
  return { ...row, regions: row.regions.filter((r) => !isHotelRegion(r)), hotels };
}

/**
 * `regions` as a row stores it: the picked hotels as "hotel:" values when there
 * are any (the regions are then not used), else the regions. Give it a
 * normalised targeting (normaliseTargeting()).
 */
export function storedRegions(t: Pick<Targeting, "regions" | "hotels">): string[] {
  return t.hotels.length > 0 ? t.hotels.map(hotelRegion) : [...t.regions];
}

// ---------------------------------------------------------------------------
// Normalising and describing
// ---------------------------------------------------------------------------

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

/**
 * Canonical targeting for storage: duplicates and blank values dropped, roles
 * in a fixed order, and picking exactly the roles the kind reaches anyway
 * (defaultRoles(): every role; for MENU, delegates and admins) stored as "no
 * role restriction". A MENU notice picking every role keeps its roles, since
 * without them it would skip santos. Seva/region values are kept verbatim
 * (they must equal the users' values). Hotels are kept in hotels.ts order, and
 * picking any clears the regions (the two don't combine; the stored row holds
 * the hotels in `regions`: storedRegions()).
 *
 * A personal announcement (people listed) keeps only its people: the track,
 * roles and hotels are cleared, since none of the filters applies to it, and
 * the sevas and regions hold just PERSONAL_MARK, so a reader that doesn't know
 * about the people shows the row to no one. A list of only blank ids is not
 * personal: callers that were given people must refuse then
 * (publishAnnouncement() does), or the announcement would go out by its filters.
 */
export function normaliseTargeting<T extends Targeting>(t: T): T & { userIds: string[]; hotels: string[] } {
  const userIds = unique((t.userIds ?? []).filter((id) => id.trim() !== ""));
  if (userIds.length > 0) {
    return {
      ...t,
      audience: "ALL",
      roles: [],
      sevas: [PERSONAL_MARK],
      regions: [PERSONAL_MARK],
      hotels: [],
      userIds,
    };
  }
  const roles = ROLES.filter((r) => t.roles.includes(r));
  const byDefault = ROLES.filter((r) => defaultRoles(t.kind).includes(r));
  const sameAsDefault = roles.length === byDefault.length && roles.every((r, i) => r === byDefault[i]);
  const hotels = unique(t.hotels.filter((h) => h.trim() !== "")).sort(compareHotels);
  return {
    ...t,
    roles: sameAsDefault ? [] : roles,
    sevas: unique(t.sevas.filter((s) => s.trim() !== "")),
    regions: hotels.length > 0 ? [] : unique(t.regions.filter((r) => r.trim() !== "")),
    hotels,
    userIds,
  };
}

/**
 * True when the admin narrowed nothing (no people, track, role, seva, hotel or
 * region picked), i.e. the kind's default audience: everyone, or for MENU
 * delegates and admins.
 */
export function isEveryone(
  t: Pick<Targeting, "audience" | "roles" | "sevas" | "regions" | "hotels" | "userIds">,
): boolean {
  return (
    !isPersonal(t) &&
    t.audience === "ALL" &&
    t.roles.length === 0 &&
    t.sevas.length === 0 &&
    t.hotels.length === 0 &&
    t.regions.length === 0
  );
}

/** "Hampton", "Hampton & Hilton", "Hampton, Courtyard & Hilton": picked hotels by name. */
export function hotelNames(keys: readonly string[]): string {
  const names = keys.map((k) => hotelInfo(k).name);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}` : names.join("");
}

type AudienceFields = Pick<Targeting, "audience" | "roles" | "sevas" | "regions" | "hotels" | "userIds"> & {
  /** When given, no roles is described as the kind's default (an unrestricted MENU notice: "Delegates & Admins"). */
  kind?: NotificationKind;
};
/** `maxItems`: longer seva / hotel / region lists are counted instead ("4 sevas", "at 2 hotels", "from 3 regions"). */
type DescribeOptions = { maxItems?: number };

/**
 * The narrowing dimensions in words, e.g. ["Delegates", "Bhaio",
 * "Hospitality, Kitchen & Prasad", "from Atlanta, Houston"] or [..., "at
 * Hampton & Hilton"]; [] = everyone.
 * Roles are the ones it reaches when `kind` is given, so a MENU notice with no
 * roles reads ["Delegates & Admins"]. A personal announcement is just
 * ["3 specific people"] (the accounts it lists; names are the history's job).
 */
export function audienceParts(t: AudienceFields, { maxItems = Infinity }: DescribeOptions = {}): string[] {
  if (isPersonal(t)) {
    const n = t.userIds!.length;
    return [n === 1 ? "1 specific person" : `${n.toLocaleString("en-US")} specific people`];
  }
  const parts: string[] = [];
  const picked = t.kind ? effectiveRoles({ kind: t.kind, roles: t.roles }) : t.roles;
  const roles = ROLES.filter((r) => picked.includes(r));
  if (roles.length && roles.length < ROLES.length) {
    const names = roles.map((r) => ROLE_LABELS[r].many);
    parts.push(names.length === 2 ? `${names[0]} & ${names[1]}` : names.join(", "));
  }
  if (t.audience !== "ALL") parts.push(TRACK_LABELS[t.audience]);
  if (t.sevas.length) parts.push(t.sevas.length > maxItems ? `${t.sevas.length} sevas` : t.sevas.join(", "));
  if (t.hotels.length) {
    parts.push(t.hotels.length > maxItems ? `at ${t.hotels.length} hotels` : `at ${hotelNames(t.hotels)}`);
  } else if (t.regions.length) {
    parts.push(t.regions.length > maxItems ? `from ${t.regions.length} regions` : `from ${t.regions.join(", ")}`);
  }
  return parts;
}

/**
 * e.g. "Delegates · Bhaio · Hospitality, Kitchen & Prasad", or "Everyone".
 * With { maxItems: 1 }: "Delegates · Bhaio · 2 sevas" for tight spots.
 */
export function describeAudience(t: AudienceFields, options?: DescribeOptions): string {
  const parts = audienceParts(t, options);
  return parts.length ? parts.join(" · ") : "Everyone";
}

/**
 * The people's names for a list an admin reads. A name two of them share gets
 * its BAPS ID, "Same Name (AB1234)", so they can be told apart on a phone
 * (no hover there).
 */
export function listNames(people: readonly Pick<PersonPick, "name" | "bapsId">[]): string[] {
  const key = (name: string) => name.trim().toLowerCase();
  const count = new Map<string, number>();
  for (const p of people) count.set(key(p.name), (count.get(key(p.name)) ?? 0) + 1);
  return people.map((p) => ((count.get(key(p.name)) ?? 0) > 1 ? `${p.name} (${p.bapsId})` : p.name));
}

/** "1 person", "312 people", "no one". */
export function peopleLabel(n: number): string {
  if (n === 0) return "no one";
  return n === 1 ? "1 person" : `${n.toLocaleString("en-US")} people`;
}

/** What publishing to specific people answers on a database without notifications.user_ids. */
export const PEOPLE_NEED_PUSH =
  "Sending to specific people needs a database update first: run npm run db:push (for Lightsail: " +
  "npm run db:push:lightsail), then send it again. Announcements to everyone or by filter still work.";

// ---------------------------------------------------------------------------
// View shapes for the admin page (plain, serialisable)
// ---------------------------------------------------------------------------

/** One row of the announcement history. */
export type AnnouncementView = {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string | null;
  href: string | null;
  /**
   * As stored (fromStored(): the hotels taken out of `regions`). A personal row's
   * sevas and regions hold only PERSONAL_MARK: never show or copy them.
   */
  audience: Audience;
  roles: UserRole[];
  sevas: string[];
  regions: string[];
  /** Hotel keys it is for (empty = any hotel, or none). */
  hotels: string[];
  /** Publish time (ISO). */
  createdAt: string;
  /** "scheduled" while createdAt is after the page's now. */
  status: "scheduled" | "sent";
  /** e.g. "Fri, Oct 9 · 12:30 PM" (EVENT_TZ). */
  whenLabel: string;
  /** e.g. "in 2 h 10 min" for scheduled rows, else null. */
  relativeLabel: string | null;
  /** Sender's name; null for rows from `npm run notify` or the system. */
  sender: string | null;
  /** Published by the admin viewing the page. */
  mine: boolean;
  /**
   * Users it reaches with today's accounts. For a personal announcement: how
   * many of the accounts it lists still exist (`people.length`).
   */
  reach: number;
  /** describeAudience() of the row. */
  audienceLabel: string;
  /** Personal announcement: how many accounts it lists (0 = not personal). */
  listed: number;
  /** Personal announcement: the listed accounts that still exist, in the order listed. */
  people: PersonPick[];
};
