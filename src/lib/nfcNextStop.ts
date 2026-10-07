import type { VenueIndex } from "@/lib/venue/aliases";
import { mapDeepLink } from "@/lib/venue/mapPage";
import type { VenueTrack } from "@/lib/venue/types";
import type { ClientVenue } from "@/lib/venue/view";

type TimedPlace = {
  title: string;
  location: string | null;
  startsAt: Date | string;
  endsAt: Date | string;
  /** Lower wins when two active items overlap or two future items start together. */
  nfcPriority?: number;
};

export type NfcNextStop = {
  title: string;
  location: string;
  startsAt: Date;
  active: boolean;
};

const dateOf = (value: Date | string) => (value instanceof Date ? value : new Date(value));

/**
 * A personalised breakout slot can read "Niyam, then Main Hall" or
 * "Niyam / Men's Gym". The NFC route starts with the first step/room; ordinary
 * locations (including the map's supported "A · B" groups) are tried intact.
 */
function locationOptions(value: string): string[] {
  const firstStep = value.trim().split(/\s*,\s*then\s+/i)[0]?.trim() ?? "";
  if (!firstStep) return [];
  const options = [firstStep];
  for (const part of firstStep.split(/\s+\/\s+/)) {
    const room = part.trim();
    if (room && !options.includes(room)) options.push(room);
  }
  return options;
}

/**
 * Chooses what the signed-in person should go to from an NFC scan. An event in
 * progress wins (the most recently started one when timings overlap), otherwise
 * the earliest future event wins. Locations that are not on the map, staff-only,
 * or not routable are skipped so a scan never opens a dead route.
 */
export function findNfcNextStop(
  items: readonly TimedPlace[],
  now: Date,
  index: VenueIndex,
  venue: ClientVenue,
  track: VenueTrack | null,
): NfcNextStop | null {
  const t = now.getTime();
  const ordered = items
    .map((item, order) => ({ item, order, priority: item.nfcPriority ?? 0, start: dateOf(item.startsAt), end: dateOf(item.endsAt) }))
    .filter(({ start, end }) => Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) && end.getTime() > t)
    .sort((a, b) => {
      const aActive = a.start.getTime() <= t;
      const bActive = b.start.getTime() <= t;
      if (aActive !== bActive) return aActive ? -1 : 1;
      if (aActive) return a.priority - b.priority || b.start.getTime() - a.start.getTime() || a.order - b.order;
      return a.start.getTime() - b.start.getTime() || a.priority - b.priority || a.order - b.order;
    });

  const routable = new Set(
    venue.levels.flatMap((level) => level.rooms.filter((room) => room.entry && !room.closed).map((room) => room.id)),
  );

  for (const { item, start, end } of ordered) {
    if (!item.location) continue;
    for (const location of locationOptions(item.location)) {
      const link = mapDeepLink(location, index, track);
      if (!link?.roomIds.some((id) => routable.has(id))) continue;
      return { title: item.title, location, startsAt: start, active: start.getTime() <= t && t < end.getTime() };
    }
  }
  return null;
}
