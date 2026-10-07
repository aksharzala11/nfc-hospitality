/**
 * Volunteer accounts (user, 2026-10-05): a shared sign-in for the event's volunteers that sees
 * only the programme, the menu, the venue map and the Edison Mandir History. An account is one
 * by its BAPS ID (no database column, so a build from before this simply treats it as a
 * delegate): role DELEGATE, no gender on file (the
 * schedule shows both tracks), no seva / goshthi group / User Id, signing in with a tester code
 * (`npm run user:upsert -- --testCode`).
 *
 * `requireGuest()` (src/lib/auth.ts) sends a volunteer anywhere else in the hub to the schedule,
 * reading the path the middleware passes on (`PATH_HEADER`); the hub layout gives them only the
 * Schedule, Menu, Map and History tabs; the profile stays open so a shared phone can sign out.
 * Pure: client-safe.
 */

/** BAPS IDs of the volunteer accounts (upper case, as `users.baps_id` stores them). */
export const VOLUNTEER_BAPS_IDS: ReadonlySet<string> = new Set(["VOLUNTEER"]);

/** Where a volunteer lands after sign-in, and where any other hub page sends them. */
export const VOLUNTEER_HOME = "/schedule";

/** The hub pages a volunteer may open (each with its sub-paths); /here = an NFC tag's link to the map. */
export const VOLUNTEER_PATHS: readonly string[] = ["/schedule", "/menu", "/map", "/history", "/profile", "/here"];

/**
 * The request header the middleware sets to the requested path on every page it protects (a
 * client-sent copy is always replaced), so server code can tell which page is being rendered.
 */
export const PATH_HEADER = "x-hh-path";

export function isVolunteer(user: { role: string; bapsId: string }): boolean {
  return user.role === "DELEGATE" && VOLUNTEER_BAPS_IDS.has(user.bapsId.trim().toUpperCase());
}

/** True when a volunteer may open `pathname` (a page path without its query). */
export function volunteerMayOpen(pathname: string): boolean {
  return VOLUNTEER_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
