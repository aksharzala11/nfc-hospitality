/**
 * Appends the demo `?now=` override to an internal link while time-travelling,
 * keeping any query the link already has:
 *   withNow("/sant/schedule?tab=general", "2026-10-09T13:45")
 *     -> "/sant/schedule?tab=general&now=2026-10-09T13%3A45"
 * Pass null (not time-travelling) to get the link back unchanged.
 */
export function withNow(href: string, now: string | null | undefined): string {
  if (!now) return href;
  return `${href}${href.includes("?") ? "&" : "?"}now=${encodeURIComponent(now)}`;
}
