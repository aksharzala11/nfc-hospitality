/**
 * The schedule's travel, read from its titles and places (prisma/seed.ts). Pure and client-safe:
 * the schedule's icons (ScheduleView's iconFor()) and the breakouts page's "How to get there"
 * (previousPlaceFor() in src/lib/schedule.ts) read it the same way.
 */

/**
 * A TRAVEL item that is a bus ride (to or from the mandir, the utaro, an airport, Edison, DC or
 * Akshardham in Robbinsville: "Travel to Mandir", "Depart to Utaro", "Airport drop-offs"), not a
 * walk between rooms at the mandir (the 15-minute "Travel" between two sessions).
 */
export const RIDE_TITLE = /mandir|utaro|robbinsville|airport|edison|\bdc\b/i;

/** A schedule place away from the Edison mandir, so not on its venue map ("Akshardham, Robbinsville"). */
export const OFF_SITE_PLACE = /akshardham|robbinsville|utaro|hotel|airport/i;
