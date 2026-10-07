import { EVENT_DAYS, EVENT_TZ, dayKey, resolveNow, timeTravelAllowed, type EventDay } from "@/lib/time";

export type SearchParams = Record<string, string | string[] | undefined>;

/** Resolves "now" for a page, plus demo-preview metadata. */
export function pageNow(sp: SearchParams) {
  const now = resolveNow(sp.now);
  const traveling = timeTravelAllowed() && typeof sp.now === "string" && sp.now.length > 0;
  const today = dayKey(now);
  const eventDay = (EVENT_DAYS as readonly string[]).includes(today) ? (today as EventDay) : null;
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone: EVENT_TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(now);
  return { now, traveling, today, eventDay, label };
}
