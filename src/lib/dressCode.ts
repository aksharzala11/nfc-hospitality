/**
 * The dress code ("What to wear"), as the organisers give it: what each track
 * wears on each event day. Shown on /dress-code ("Dress code" in More) for the
 * guest's own track; a guest with no gender on file sees both, Bhaio first.
 *
 * Content only, no personal data. Pure and client-safe. When the organisers
 * change it, edit DRESS_CODE here (a deploy); every event day (EVENT_DAYS in
 * src/lib/time.ts) must have an entry for both tracks, which the type enforces.
 * The organisers' sheet spells the first track "Bhaiyo"; the hub says "Bhaio".
 */
import type { Gender } from "@prisma/client";
import { EVENT_DAYS, type EventDay } from "@/lib/time";

export type DressTrack = "BHAIO" | "BEHNO";

export type DressCodeEntry = {
  /** What to wear that day, e.g. "Akshardham shirt". */
  wear: string;
  /** Anything that goes with it, e.g. "With closed-toe shoes". */
  note?: string;
};

export const DRESS_TRACK_LABEL: Record<DressTrack, string> = { BHAIO: "Bhaio", BEHNO: "Behno" };

export const DRESS_CODE: Record<DressTrack, Record<EventDay, DressCodeEntry>> = {
  BHAIO: {
    "2026-10-08": { wear: "Akshardham shirt" },
    "2026-10-09": { wear: "Jabho lengho" },
    "2026-10-10": { wear: "NC27 t-shirt or hoodie" },
    "2026-10-11": { wear: "Festive Indian traditional", note: "With closed-toe shoes" },
  },
  BEHNO: {
    "2026-10-08": { wear: "Akshardham shirt" },
    "2026-10-09": { wear: "Crimson uniform" },
    "2026-10-10": { wear: "Blue uniform" },
    "2026-10-11": { wear: "Festive Indian attire", note: "With closed-toe shoes" },
  },
};

/**
 * The tracks whose dress code a guest sees, from their trackGender()
 * (src/lib/admin/announcements.ts): MALE -> Bhaio, FEMALE -> Behno, null (no
 * gender on file) -> both, Bhaio then Behno, like every other track rule.
 */
export function dressTracksFor(track: Gender | null): DressTrack[] {
  if (track === "MALE") return ["BHAIO"];
  if (track === "FEMALE") return ["BEHNO"];
  return ["BHAIO", "BEHNO"];
}

/** A track's dress code, one entry per event day in order. */
export function dressCodeFor(track: DressTrack): Array<DressCodeEntry & { day: EventDay }> {
  return EVENT_DAYS.map((day) => ({ day, ...DRESS_CODE[track][day] }));
}
