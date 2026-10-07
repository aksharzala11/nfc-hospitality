import type { MenuFor, NotificationKind, Prisma, User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { notificationsVisibleTo } from "@/lib/admin/announcements";
import { getHotelsOf } from "@/lib/hotelGuests";
import { withPeopleColumn } from "@/lib/notificationPeople";
import { getMeals, menuIsTimed, revealTime } from "@/lib/schedule";
import { formatDayShort, formatTime, dayKey } from "@/lib/time";

/**
 * The menu a view's bell announces releases for: which meals (meals.menu_for)
 * and the page the notices open.
 */
export type MenuFeed = { for: MenuFor; href: string };

/** The delegate hub's menu (admins use it too): getNotificationsFor()'s default. */
export const DELEGATE_MENU_FEED: MenuFeed = { for: "DELEGATE", href: "/menu" };

export type NotificationView = {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string | null;
  href: string | null;
  createdAt: string; // ISO
  unread: boolean;
};

const MAX_ITEMS = 25;
/**
 * Personal announcements (sent to this account by name) kept in the bell even
 * once MAX_ITEMS newer items have come in: a message meant for one person must
 * not scroll out unseen behind three days of broadcasts and menu releases.
 */
const MAX_PERSONAL_ITEMS = 25;

/** What a bell row shows. Never `userIds`: who else a personal announcement went to stays with the admins. */
const BELL_SELECT = { id: true, kind: true, title: true, body: true, href: true, createdAt: true } as const;

/**
 * Notifications for the header bell, newest first. Two sources:
 *  - rows in `notifications` (organiser announcements: schedule changes,
 *    transportation updates, general notices) that reach this guest: their
 *    track, plus any role / seva / hotel / region targeting, published by `now`
 *    (the rule lives in src/lib/admin/announcements.ts; their hotels are those
 *    of their room groups, found by `registrationId`, none without one); and the personal
 *    announcements that list this account. `user.id` must be the signed-in
 *    account's own id: requireGuest() keeps it for a mirror test account, so a
 *    tester sees the mirrored delegate's track / seva / region announcements
 *    but never that delegate's personal ones (and does get their own);
 *  - menu releases of the viewer's own menu (`menu`), derived from each meal's
 *    reveal time so they appear the moment a menu opens without anyone having
 *    to publish them. The default is the delegate menu, opening /menu; the
 *    Pujya Santo view passes its own ({ for: "SANT", href: "/sant/menu" }),
 *    which is open from the start (menuIsTimed()), so it has none.
 *    Reveal times chain within that one menu (see getMeals()).
 * An item is unread if it is newer than the last time the guest opened the bell.
 * The bell holds the MAX_ITEMS newest items, plus any older personal
 * announcements for this account (up to MAX_PERSONAL_ITEMS), in date order.
 *
 * `menu: false` is for a view without a Menu page: both the derived menu
 * releases and stored MENU announcements are left out.
 */
export async function getNotificationsFor(
  user: Pick<User, "id" | "role" | "gender" | "seva" | "region" | "notificationsSeenAt"> &
    Partial<Pick<User, "registrationId">>,
  now: Date,
  { menu = DELEGATE_MENU_FEED }: { menu?: MenuFeed | false } = {},
): Promise<{ items: NotificationView[]; unread: number }> {
  const kinds: Prisma.NotificationWhereInput = menu ? {} : { kind: { not: "MENU" } };
  const hotels = await getHotelsOf(user.registrationId);
  const recipient = { ...user, hotels };
  const [[rows, own], meals] = await Promise.all([
    // Before notifications.user_ids is pushed: the same read without the column (no personal ones exist).
    withPeopleColumn((people) =>
      Promise.all([
        prisma.notification.findMany({
          where: { AND: [notificationsVisibleTo(recipient, now, { people }), kinds] },
          orderBy: { createdAt: "desc" },
          take: MAX_ITEMS,
          select: BELL_SELECT,
        }),
        // The personal ones for this account, read on their own so newer broadcasts never push them out.
        people
          ? prisma.notification.findMany({
              where: { AND: [{ createdAt: { lte: now }, userIds: { has: user.id } }, kinds] },
              orderBy: { createdAt: "desc" },
              take: MAX_PERSONAL_ITEMS,
              select: BELL_SELECT,
            })
          : [],
      ]),
    ),
    // An untimed menu (the Santo one, open from the start) has no releases to announce.
    menu && menuIsTimed(menu.for) ? getMeals(menu.for) : Promise.resolve<Awaited<ReturnType<typeof getMeals>>>([]),
  ]);
  const menuHref = menu ? menu.href : null;

  const seenAt = user.notificationsSeenAt?.getTime() ?? 0;

  const ownIds = new Set(own.map((n) => n.id));
  const inNewest = new Set(rows.map((n) => n.id));
  const announcements: NotificationView[] = [...rows, ...own.filter((n) => !inNewest.has(n.id))].map((n) => ({
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    href: n.href,
    createdAt: n.createdAt.toISOString(),
    unread: n.createdAt.getTime() > seenAt,
  }));

  const menuReleases: NotificationView[] = meals
    .map((meal, i) => ({ meal, at: revealTime(meal, i > 0 ? meals[i - 1] : null) }))
    .filter(({ at }) => at.getTime() <= now.getTime())
    .map(({ meal, at }) => ({
      id: `menu:${meal.id}`,
      kind: "MENU" as const,
      title: `${meal.name} menu is out`,
      body: `${formatDayShort(dayKey(meal.startsAt))} · ${formatTime(meal.startsAt)} – ${formatTime(meal.endsAt)}`,
      href: menuHref,
      createdAt: at.toISOString(),
      unread: at.getTime() > seenAt,
    }));

  // The newest MAX_ITEMS, and past them only this account's personal announcements.
  const items = [...announcements, ...menuReleases]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .filter((item, i) => i < MAX_ITEMS || ownIds.has(item.id));

  return { items, unread: items.filter((i) => i.unread).length };
}
