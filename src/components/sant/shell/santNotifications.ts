/**
 * Bell contents for the Pujya Santo view (server-only: reads the database).
 *
 * Santos get the organiser announcements for their track (santGender(): the
 * shared items plus Bhaio), because a change to the general programme, such
 * as a keynote moving, affects their own pravachans. Announcements aimed at
 * other roles, sevas or regions are filtered out by getNotificationsFor()
 * (rule in src/lib/admin/announcements.ts), and a personal announcement shows
 * only for the santos it lists; a Menu announcement reaches santos
 * only when it names them (its roles include SANT), since one with no roles is
 * about the delegate menu. The santos' own menu (meals.menu_for = SANT) is
 * open from the start (menuIsTimed() in src/lib/schedule.ts), so it brings no
 * "menu is out" releases to the bell. Links to delegate pages are
 * rewritten to their /sant counterparts, or dropped when there is none; a
 * /map link keeps its query (?to= / ?from= / ?stepFree=) as a /sant/map link.
 */
import type { User } from "@prisma/client";
import { getNotificationsFor, type MenuFeed, type NotificationView } from "@/lib/notifications";
import { santGender } from "@/lib/sant";

/** The Santo menu, so Menu announcements stay in the santos' bell (it has no timed releases of its own). */
const SANT_MENU_FEED: MenuFeed = { for: "SANT", href: "/sant/menu" };

/** Delegate paths with a /sant counterpart. Others (/history, /prasang, ...) lose their link. */
const SANT_PATHS: Record<string, string> = {
  "/dashboard": "/sant",
  "/schedule": "/sant/schedule?tab=general",
  "/menu": "/sant/menu",
  "/breakouts": "/sant/breakouts",
  "/map": "/sant/map",
  "/transportation": "/sant/transport",
  "/profile": "/sant/profile",
};

/**
 * Delegate paths whose link keeps its query and hash on the way over: /sant/map reads the same
 * ?to= / ?from= / ?stepFree= as /map, so "/map?to=Main%20Hall" opens that room for santos too.
 * The others drop it (/schedule's counterpart sets its own ?tab=general).
 */
const KEEPS_QUERY = new Set(["/map"]);

/** Maps a notification's in-app link to a page santos can open, or null. */
export function santHref(href: string | null): string | null {
  if (!href) return null;
  const path = href.split(/[?#]/, 1)[0].replace(/\/+$/, "") || "/";
  if (path === "/sant" || path.startsWith("/sant/")) return href;
  const target = SANT_PATHS[path];
  if (!target) return null;
  if (!KEEPS_QUERY.has(path)) return target;
  const cut = href.search(/[?#]/);
  return cut === -1 ? target : target + href.slice(cut);
}

export async function getSantNotifications(
  user: Pick<User, "id" | "role" | "gender" | "seva" | "region" | "notificationsSeenAt">,
  now: Date,
): Promise<{ items: NotificationView[]; unread: number }> {
  const { items, unread } = await getNotificationsFor({ ...user, gender: santGender(user) }, now, {
    menu: SANT_MENU_FEED,
  });
  return { items: items.map((n) => ({ ...n, href: santHref(n.href) })), unread };
}
