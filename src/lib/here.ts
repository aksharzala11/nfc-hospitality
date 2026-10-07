/**
 * NFC tags around the mandir (user, 2026-10-06): each holds a link to `/here/<place>`, and scanning
 * it opens the venue map with that place as "You are here" (src/app/here/[place]/page.tsx sends a
 * delegate, an admin or a volunteer to `/map?here=<place>`, a sant to `/sant/map?here=<place>`).
 * `<place>` is a room's name as a slug ("main-foyer", "sahajanand-hall", an event name such as
 * "main-hall") or its map id; the map resolves it with no track, since where a tag is doesn't
 * depend on who scans it (mapHereLink(), src/lib/venue/mapPage.ts).
 *
 * A phone opens a tag in its default browser, which may not be signed in (many guests signed in
 * inside Telegram's): the middleware then sends them to the login page with `?next=/here/<place>`,
 * and signing in returns them there. `next` is only ever a /here path (hereNextPath()), so it
 * can't send anyone off the site or to another page. Pure: safe in the middleware and the browser.
 */

/** A tag's place: a slug or a map id (letters, digits, "-", "_", "."), first character a letter or digit. */
export const HERE_PLACE_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;

/**
 * The site a tag's link names (the Hub's production address; baps-bky.org redirects there,
 * next.config.ts): what an admin copies for a tag, whichever address they are looking at.
 */
export const TAG_SITE = "https://naam-five.vercel.app";

/**
 * A map id rather than a slug: it starts with a level ("B", "1", "2", "M") and "-" ("1-123",
 * "M-elev-3"). Slugs are lower case and never start with a digit and "-". One no longer on the map
 * finds no room (never read as words, where "2-123" could match room "2123").
 */
export const MAP_ID_LIKE_RE = /^(?:[BM]|\d)-/;

/** The tag link's path for a place. */
export function herePath(place: string): string {
  return `/here/${place}`;
}

/** `value` when it is a /here/<place> path (the only page sign-in returns to), else null. */
export function hereNextPath(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/here/")) return null;
  return HERE_PLACE_RE.test(value.slice("/here/".length)) ? value : null;
}

/** A room's title as a tag's place: "Ladies' Gym" -> "ladies-gym", "Green Room 2" -> "green-room-2". */
export function hereSlug(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’‘`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
