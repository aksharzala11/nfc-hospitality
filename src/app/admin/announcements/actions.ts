"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Audience, NotificationKind, UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getAdmin } from "@/lib/auth";
import {
  BODY_MAX,
  HOTEL_REGION_PREFIX,
  KINDS,
  LINK_HREFS,
  PEOPLE_MAX,
  PEOPLE_NEED_PUSH,
  ROLES,
  TITLE_MAX,
  TRACKS,
  normaliseTargeting,
  storedRegions,
  usersReachedBy,
  type PersonPick,
} from "@/lib/admin/announcements";
import { PEOPLE_QUERY_MAX, getPeopleByIds, searchPeople, toPersonPick } from "@/lib/admin/announcementPeople";
import { registrationIdsAtHotels } from "@/lib/hotelGuests";
import { HOTEL_KEYS } from "@/lib/hotels";
import { createNotification, hasPeopleColumn, withPeopleColumn } from "@/lib/notificationPeople";
import { parseInEventTz } from "@/lib/time";

const NOT_ADMIN = "Your admin session has ended. Sign in again to send announcements.";
const LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const MAX_LEAD_MS = 366 * 24 * 60 * 60 * 1000;
/** Same announcement from the same admin within this window is treated as a double submit. */
const DUPLICATE_WINDOW_MS = 60 * 1000;
const PEOPLE_UNREADABLE = "The people you picked couldn't be read, so nothing was sent. Pick them again.";

export type PublishAnnouncementInput = {
  title: string;
  body: string;
  kind: NotificationKind;
  href: string | null;
  audience: Audience;
  roles: UserRole[];
  sevas: string[];
  regions: string[];
  /**
   * Hotel keys: it goes to the people with a room group at one of them (who also
   * match the role, track and seva). `regions` is then not used. Absent = [].
   */
  hotels?: string[];
  /**
   * Specific people (users.id). When any are given it goes to exactly those
   * accounts: audience, roles, sevas, hotels and regions are then ignored (the
   * row is stored without them, marked personal: normaliseTargeting()).
   */
  userIds?: string[];
  mode: "now" | "schedule";
  /** Eastern wall clock "YYYY-MM-DDTHH:mm" when mode is "schedule". */
  at: string;
};

export type AnnouncementFieldErrors = Partial<Record<"title" | "body" | "kind" | "href" | "audience" | "at", string>>;

export type PublishAnnouncementResult =
  | {
      ok: true;
      id: string;
      /** Accounts it reaches right now. */
      reach: number;
      scheduled: boolean;
      /** Publish time (ISO). */
      at: string;
      /** An identical announcement was just published; nothing new was created. */
      duplicate: boolean;
    }
  | {
      ok: false;
      error?: string;
      fieldErrors?: AnnouncementFieldErrors;
      /** Picked people whose account no longer exists (nothing was sent): take them off the list. */
      gonePeople?: string[];
    };

/** The "Specific people" search: at most 20 matches; `more` = there were others. */
export type SearchPeopleResult = { ok: true; people: PersonPick[]; more: boolean } | { ok: false; error: string };

/** The accounts behind stored ids (a restored draft); ids without an account are left out. */
export type LookUpPeopleResult = { ok: true; people: PersonPick[] } | { ok: false; error: string };

export type DeleteAnnouncementResult = { ok: true; alreadyRemoved: boolean } | { ok: false; error: string };

// Seva / region values are matched exactly against users' values, so they are not trimmed.
const facetValue = z
  .string()
  .max(120)
  .refine((s) => s.trim() !== "", "Empty value.");

// A region named like a stored hotel ("hotel:hampton") would read back as one: never a real region.
const regionValue = facetValue.refine((s) => !s.startsWith(HOTEL_REGION_PREFIX), "That isn't a region.");

// An account id (users.id). A blank one is refused, never dropped: a people list
// that came to nothing would otherwise go out by the filters, to everyone.
const accountId = z
  .string()
  .min(1)
  .max(64)
  .refine((s) => s.trim() !== "", PEOPLE_UNREADABLE);

const PublishSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Add a title.")
    .max(TITLE_MAX, `Keep the title to ${TITLE_MAX} characters.`),
  body: z.string().trim().max(BODY_MAX, `Keep the message to ${BODY_MAX} characters.`),
  kind: z.enum(KINDS, { message: "Pick a category." }),
  href: z.enum(LINK_HREFS, { message: "Pick a page from the list." }).nullable(),
  audience: z.enum(TRACKS),
  roles: z.array(z.enum(ROLES)).max(ROLES.length * 2),
  sevas: z.array(facetValue).max(500),
  regions: z.array(regionValue).max(500),
  hotels: z
    .array(z.enum(HOTEL_KEYS, { message: "Pick hotels from the list." }))
    .max(HOTEL_KEYS.length * 2)
    .default([]),
  userIds: z
    .array(accountId)
    .max(PEOPLE_MAX, `Pick at most ${PEOPLE_MAX} people for one announcement.`)
    .default([]),
  mode: z.enum(["now", "schedule"]),
  at: z.string().max(40),
});

const FIELD_FOR: Record<string, keyof AnnouncementFieldErrors> = {
  title: "title",
  body: "body",
  kind: "kind",
  href: "href",
  audience: "audience",
  roles: "audience",
  sevas: "audience",
  regions: "audience",
  hotels: "audience",
  userIds: "audience",
  mode: "at",
  at: "at",
};

function refreshPages() {
  revalidatePath("/admin/announcements");
  revalidatePath("/admin");
}

/**
 * "Specific people" in the composer: accounts of every role matching the
 * query by name, BAPS ID or the organisers' User Id. Admins only (checked
 * here, not by the page); the answer holds only what the picker shows.
 */
export async function searchAnnouncementPeople(query: string): Promise<SearchPeopleResult> {
  const admin = await getAdmin();
  if (!admin) return { ok: false, error: NOT_ADMIN };
  const parsed = z.string().max(PEOPLE_QUERY_MAX * 4).safeParse(query);
  if (!parsed.success) return { ok: true, people: [], more: false };
  return { ok: true, ...(await searchPeople(parsed.data)) };
}

/**
 * The people a saved draft lists (the browser keeps only their account ids),
 * in the order given; ids whose account is gone are left out. Admins only.
 */
export async function lookUpAnnouncementPeople(ids: string[]): Promise<LookUpPeopleResult> {
  const admin = await getAdmin();
  if (!admin) return { ok: false, error: NOT_ADMIN };
  const parsed = z.array(z.string().min(1).max(64)).max(PEOPLE_MAX).safeParse(ids);
  if (!parsed.success) return { ok: true, people: [] };
  const byId = await getPeopleByIds(parsed.data);
  const wanted = [...new Set(parsed.data)];
  return { ok: true, people: wanted.flatMap((id) => byId.get(id) ?? []).map(toPersonPick) };
}

/**
 * Publishes an organiser announcement to the header bell of everyone it
 * targets (rule: src/lib/admin/announcements.ts), now or at a scheduled
 * Eastern time. Refuses an audience that reaches no one.
 *
 * With hotels picked it goes to the people with a room group at one of them
 * (who match the role, track and seva too); the row stores the hotels in
 * `regions` (storedRegions()), so code that doesn't know about hotels shows it
 * to no one.
 *
 * With specific people picked it goes to exactly those accounts (the other
 * audience fields are cleared). That needs notifications.user_ids: on a
 * database the schema hasn't been pushed to, it refuses and says so. It also
 * refuses when a picked account no longer exists, naming them in `gonePeople`.
 */
export async function publishAnnouncement(input: PublishAnnouncementInput): Promise<PublishAnnouncementResult> {
  const admin = await getAdmin();
  if (!admin) return { ok: false, error: NOT_ADMIN };

  const parsed = PublishSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: AnnouncementFieldErrors = {};
    for (const issue of parsed.error.issues) {
      const field = FIELD_FOR[String(issue.path[0])];
      if (field && !fieldErrors[field]) fieldErrors[field] = issue.message;
    }
    return { ok: false, error: Object.values(fieldErrors)[0] ?? "Check the form and try again.", fieldErrors };
  }
  const data = parsed.data;

  const now = new Date();
  let publishAt = now;
  if (data.mode === "schedule") {
    const at = LOCAL_DATETIME.test(data.at) ? parseInEventTz(data.at) : null;
    if (!at || Number.isNaN(at.getTime())) {
      return { ok: false, error: "Pick a date and time.", fieldErrors: { at: "Pick a date and time." } };
    }
    if (at.getTime() <= now.getTime()) {
      return {
        ok: false,
        error: "That time has already passed. Pick a later one.",
        fieldErrors: { at: "Pick a time in the future." },
      };
    }
    if (at.getTime() - now.getTime() > MAX_LEAD_MS) {
      return { ok: false, error: "Pick a time within the next year.", fieldErrors: { at: "Pick a time within the next year." } };
    }
    publishAt = at;
  }

  const targeting = normaliseTargeting({
    kind: data.kind,
    audience: data.audience,
    roles: data.roles,
    sevas: data.sevas,
    regions: data.regions,
    hotels: data.hotels,
    userIds: data.userIds,
  });
  const personal = targeting.userIds.length > 0;
  // People were given but none is left after normalising: refuse rather than fall back to the filters.
  if (data.userIds.length > 0 && !personal) {
    return { ok: false, error: PEOPLE_UNREADABLE, fieldErrors: { audience: PEOPLE_UNREADABLE } };
  }
  if (personal) {
    if (!(await hasPeopleColumn())) {
      return { ok: false, error: PEOPLE_NEED_PUSH, fieldErrors: { audience: PEOPLE_NEED_PUSH } };
    }
    const found = await getPeopleByIds(targeting.userIds);
    const gonePeople = targeting.userIds.filter((id) => !found.has(id));
    if (gonePeople.length > 0) {
      const n = gonePeople.length;
      const message =
        n === targeting.userIds.length
          ? "The people you picked no longer have an account, so there's no one to send it to."
          : `${n} of the people you picked no longer ${n === 1 ? "has" : "have"} an account. Nothing was sent: check who is left, then send again.`;
      return { ok: false, error: message, fieldErrors: { audience: message }, gonePeople };
    }
  }
  const atHotels = targeting.hotels.length > 0 ? await registrationIdsAtHotels(targeting.hotels) : undefined;
  const reach = await prisma.user.count({ where: usersReachedBy(targeting, { atHotels }) });
  if (reach === 0) {
    return {
      ok: false,
      error: "No one matches this audience, so there's no one to send it to.",
      fieldErrors: { audience: "No one matches this audience. Widen it to send." },
    };
  }

  const body = data.body === "" ? null : data.body;
  const fields = {
    kind: targeting.kind,
    title: data.title,
    body,
    href: data.href,
    audience: targeting.audience,
    roles: [...targeting.roles],
    sevas: [...targeting.sevas],
    // The hotels, when picked, as "hotel:" values (storedRegions()).
    regions: storedRegions(targeting),
  };

  // A double tap or a retried request shouldn't put the same notice in 800 bells twice.
  // (Same people too; a database without notifications.user_ids has no personal ones to tell apart.)
  const duplicate = await withPeopleColumn((people) =>
    prisma.notification.findFirst({
      where: {
        createdById: admin.id,
        kind: fields.kind,
        title: fields.title,
        body: fields.body,
        href: fields.href,
        audience: fields.audience,
        roles: { equals: fields.roles },
        sevas: { equals: fields.sevas },
        regions: { equals: fields.regions },
        ...(people ? { userIds: { equals: targeting.userIds } } : {}),
        createdAt:
          data.mode === "now"
            ? { gte: new Date(now.getTime() - DUPLICATE_WINDOW_MS), lte: now }
            : { equals: publishAt },
      },
      select: { id: true, createdAt: true },
    }),
  );
  if (duplicate) {
    return {
      ok: true,
      id: duplicate.id,
      reach,
      scheduled: data.mode === "schedule",
      at: duplicate.createdAt.toISOString(),
      duplicate: true,
    };
  }

  // createNotification(): an ordinary announcement still publishes on a database
  // that doesn't have notifications.user_ids yet (a personal one was refused above).
  const created = await createNotification(prisma, {
    ...fields,
    userIds: targeting.userIds,
    createdById: admin.id,
    createdAt: publishAt,
  });
  refreshPages();
  return {
    ok: true,
    id: created.id,
    reach,
    scheduled: data.mode === "schedule",
    at: created.createdAt.toISOString(),
    duplicate: false,
  };
}

/**
 * Deletes an announcement (sent or scheduled), which removes it from every
 * bell. Works for rows from `npm run notify` and automatic notices too.
 */
export async function deleteAnnouncement(id: string): Promise<DeleteAnnouncementResult> {
  const admin = await getAdmin();
  if (!admin) return { ok: false, error: NOT_ADMIN };

  const parsed = z.string().min(1).max(64).safeParse(id);
  if (!parsed.success) return { ok: false, error: "That announcement couldn't be found." };

  const { count } = await prisma.notification.deleteMany({ where: { id: parsed.data } });
  refreshPages();
  return { ok: true, alreadyRemoved: count === 0 };
}
