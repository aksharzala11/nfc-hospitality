/**
 * Pure presentation helpers for a delegate's own hotel stay (the /stay cards
 * and the home tile). No Prisma: the stays come from getStayFor() in
 * src/lib/rooming.ts as plain RoomStayView objects, the hotel details from
 * src/lib/hotels.ts (null until the organisers confirm them).
 *
 * Days are "YYYY-MM-DD" in the event's timezone: pass pageNow().today, so the
 * ?now= preview moves the check-in chips like everything else.
 */
import type { HotelInfo, RoomStayView, StayFor, StayRoommate } from "@/lib/rooming";
import { STAY_FIRST_NIGHT } from "@/lib/hotels";
import { formatDayShort } from "@/lib/time";

/**
 * Where a stay stands on `today`:
 *   "upcoming"  before its first night;
 *   "check-in"  on its first night (the day they check in);
 *   "staying"   after that (the rooming sheet gives no last night, so it stays here);
 *   "over"      a Wednesday-only room group once that night is over: from Thu, Oct 8
 *               the guest is in their Thursday room group instead.
 */
export type StayPhase = "upcoming" | "check-in" | "staying" | "over";

export function stayPhase(stay: Pick<RoomStayView, "stays" | "firstNight">, today: string): StayPhase {
  if (today < stay.firstNight) return "upcoming";
  if (today === stay.firstNight) return "check-in";
  return stay.stays.includes("MAIN") ? "staying" : "over";
}

/**
 * A maps search for the hotel (its full name, when known, then the address),
 * or null until hotels.ts has an address: the page shows Directions only then.
 * Opened in the same tab, like every off-site link in the Hub (see
 * src/lib/prasang.ts): Back returns to the Hub in Telegram's in-app browser.
 */
export function directionsHref(hotel: Pick<HotelInfo, "fullName" | "address">): string | null {
  const address = hotel.address?.trim();
  if (!address) return null;
  const name = hotel.fullName?.trim();
  const query = name ? `${name}, ${address}` : address;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** "Check-in from 3:00 PM · Check-out by 11:00 AM" (either half alone), or null for neither. */
export function hotelTimesLabel(hotel: Pick<HotelInfo, "checkInTime" | "checkOutTime">): string | null {
  const checkIn = hotel.checkInTime?.trim();
  const checkOut = hotel.checkOutTime?.trim();
  const parts = [checkIn && `Check-in from ${checkIn}`, checkOut && `Check-out by ${checkOut}`].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * For a room group that starts Wednesday and carries on: a roommate who shares
 * only part of it. "Wed, Oct 7 only" / "Joins Thu, Oct 8"; null when they share
 * every night.
 */
export function roommateNightsLabel(nights: StayRoommate["nights"]): string | null {
  if (nights === "WED") return `${formatDayShort(STAY_FIRST_NIGHT.WED)} only`;
  if (nights === "FROM_THU") return `Joins ${formatDayShort(STAY_FIRST_NIGHT.MAIN)}`;
  return null;
}

// ---------------------------------------------------------------------------
// The home tile
// ---------------------------------------------------------------------------

export type StayTileChip = { label: string; tone: "today" | "nights" };

/** What the home "Your stay" tile shows under its title. */
export type StayTileSummary = {
  /** e.g. "Hilton · Room group 12", or "No hotel room on file". */
  line: string;
  chip: StayTileChip | null;
  /**
   * No room on file (many delegates are local): the home page leaves the tile
   * out rather than showing that as an error; /stay stays reachable from More.
   */
  none: boolean;
};

/**
 * The tile's summary: the stay that isn't over yet (the Wednesday room group
 * until its night is over, then the Thursday one), else the last one, as
 * "Hilton · Room group 12" with its nights ("From Thu, Oct 8") or, on its
 * first night, "Check-in today".
 */
export function stayTileSummary(stay: StayFor, today: string): StayTileSummary {
  if (stay.stays.length === 0) return { line: "No hotel room on file", chip: null, none: true };
  const current = stay.stays.find((s) => stayPhase(s, today) !== "over") ?? stay.stays[stay.stays.length - 1];
  const checkIn = stayPhase(current, today) === "check-in";
  return {
    line: `${current.hotel.name} · ${current.roomLabel}`,
    chip: checkIn ? { label: "Check-in today", tone: "today" } : { label: current.nightsLabel, tone: "nights" },
    none: false,
  };
}
