/**
 * The Pujya Santos' personal programmes ("My schedule" on /sant/schedule and the Santo home),
 * generated on 2026-10-04 from the "Individual Schedule" tab of the organisers' workbook
 * "TEJBHAI THIS IS EVERYTHING BUDDY - Version 2.xlsx" (Version 1 of 2026-10-03 plus the items'
 * locations) by scripts kept outside the repo (an exceljs reader and a Python writer). Not typed
 * by hand; regenerate rather than edit.
 * prisma/sant-personal.ts checks it and syncs it into `sant_schedule_items`
 * (`npm run sant:personal:sync`).
 *
 * How the tab was read:
 *  - One block per santo, in bands side by side: a name cell "Pujya <Name> Swami", below it a
 *    header row "Date | Time | Event | Location" (the name's column, +2, +4 and +8), then his rows
 *    down to the next name cell in that column. Empty rows are skipped; no cell outside the
 *    blocks holds anything.
 *  - Date "Oct 8th" -> 2026-10-08, Time "5:00 PM-7:00 PM" -> 17:00-19:00 (Eastern), Event ->
 *    title, Location as given (blank = none). No descriptions.
 *  - Blocks are matched to SANTOS (prisma/santos-data.ts) by its name rule ("Pujya" and "Swami"
 *    dropped, "das" appended): 17 match exactly, listed here in SANTOS order (each with a comment
 *    naming his block as the tab writes it). "Pujya Yoganand Swami" has no account and his block
 *    (4 rows) is left out (user, 2026-10-03: "he wont have an account skip him"); the nearest
 *    name, Yagnananddas, is another santo.
 *  - Every "Santo Breakout" row (50 in these 17 programmes; Yoganand's block has 3 more) is left
 *    out (user, 2026-10-03): each repeats a slot of the Santo general schedule (Fri Oct 9
 *    11:00-12:30 and 15:00-16:30, Sat Oct 10 11:00-12:30, Yogi Hall), which now lists the update
 *    sessions held there, in Yogi Hall.
 *  - kind (main session, 2026-10-03): ARTI for the artis, MEAL for "Dessert Serving", SESSION
 *    for "Mukhpath Testing", "Keynote Program 3", "PC Track Breakout" and "PCs Breakout" (and
 *    "Katha", only in the left-out block), as the tab gives them. A title the generator has no
 *    kind for stops it.
 *  - Each santo's items are in time order (the tab lists some out of order); none of them overlap
 *    once the "Santo Breakout" rows are out.
 *
 * Wording and corrections:
 *  - "Aarti" -> "Arti" (10 items), as the app spells it everywhere: "Evening Mandir Arti",
 *    "Morning Mandir Arti", "Sabha Hall Arti". A trailing space dropped (1 item).
 *  - To confirm with the organisers: Saralyogidas's (SY0702) "Morning Mandir Aarti" on Oct 9 reads
 *    "7:00 PM-7:30 PM"; a morning arti at 7 PM can't be meant, so it is read as 7:00-7:30 AM.
 *
 * Times are Eastern wall clock ("HH:MM", 24 h); convert to UTC when writing to the database.
 */

import type { ScheduleKind } from "@prisma/client";

export type SantPersonalItemData = {
  /** YYYY-MM-DD (Eastern). */
  day: string;
  /** Eastern wall clock, "HH:MM" (24 h). */
  start: string;
  end: string;
  title: string;
  description?: string;
  location?: string;
  kind: ScheduleKind;
};

export type SantPersonalData = {
  /** Upper-case BAPS ID, as in SANTOS (prisma/santos-data.ts). */
  bapsId: string;
  /** Sorted by day, then start. */
  items: SantPersonalItemData[];
};

/** In SANTOS order; only the santos the tab gives a programme (44 items for 17 santos). */
export const SANT_PERSONAL: SantPersonalData[] = [
  // "Pujya Nityavivek Swami" (C30, rows 33-41)
  {
    bapsId: "NV0001",
    items: [
      { day: "2026-10-10", start: "07:00", end: "07:30", title: "Morning Mandir Arti", location: "Nij Mandir", kind: "ARTI" },
    ],
  },
  // "Pujya Viraldarshan Swami" (C6, rows 9-17)
  {
    bapsId: "VD2101",
    items: [
      { day: "2026-10-08", start: "17:00", end: "19:00", title: "Mukhpath Testing", location: "BK Wing", kind: "SESSION" },
      { day: "2026-10-08", start: "19:30", end: "21:00", title: "Mukhpath Testing", location: "BK Wing", kind: "SESSION" },
      { day: "2026-10-09", start: "12:30", end: "14:00", title: "Mukhpath Testing", location: "BK Wing", kind: "SESSION" },
      { day: "2026-10-10", start: "12:30", end: "14:00", title: "Mukhpath Testing", location: "BK Wing", kind: "SESSION" },
    ],
  },
  // "Pujya Vatsalmurti Swami" (AY6, rows 9-17)
  {
    bapsId: "VM1301",
    items: [
      { day: "2026-10-08", start: "17:00", end: "19:00", title: "Mukhpath Testing", location: "BK Wing", kind: "SESSION" },
      { day: "2026-10-08", start: "19:30", end: "21:00", title: "Mukhpath Testing", location: "BK Wing", kind: "SESSION" },
      { day: "2026-10-09", start: "12:30", end: "14:00", title: "Mukhpath Testing", location: "BK Wing", kind: "SESSION" },
      { day: "2026-10-10", start: "12:30", end: "14:00", title: "Mukhpath Testing", location: "BK Wing", kind: "SESSION" },
      { day: "2026-10-11", start: "07:00", end: "07:30", title: "Morning Mandir Arti", location: "Nij Mandir", kind: "ARTI" },
    ],
  },
  // "Pujya Uttamshlok Swami" (O30, rows 33-41)
  {
    bapsId: "US0501",
    items: [
      { day: "2026-10-10", start: "07:00", end: "07:30", title: "Morning Mandir Arti", location: "Nij Mandir", kind: "ARTI" },
    ],
  },
  // "Pujya Anantmangal Swami" (AA30, rows 33-41)
  {
    bapsId: "AM0501",
    items: [
      { day: "2026-10-10", start: "09:15", end: "10:45", title: "Keynote Program 3", location: "Sahajanand Hall", kind: "SESSION" },
    ],
  },
  // "Pujya Narayantirth Swami" (AA18, rows 21-29)
  {
    bapsId: "NT2101",
    items: [
      { day: "2026-10-08", start: "20:00", end: "20:30", title: "Dessert Serving", location: "Banquet Hall", kind: "MEAL" },
      { day: "2026-10-10", start: "11:00", end: "11:30", title: "PC Track Breakout", kind: "SESSION" },
    ],
  },
  // "Pujya Aniketmuni Swami" (O6, rows 9-17)
  {
    bapsId: "AM1502",
    items: [
      { day: "2026-10-08", start: "17:00", end: "19:00", title: "Mukhpath Testing", location: "BK Wing", kind: "SESSION" },
      { day: "2026-10-08", start: "19:30", end: "21:00", title: "Mukhpath Testing", location: "BK Wing", kind: "SESSION" },
      { day: "2026-10-09", start: "12:30", end: "14:00", title: "Mukhpath Testing", location: "BK Wing", kind: "SESSION" },
      { day: "2026-10-10", start: "12:30", end: "14:00", title: "Mukhpath Testing", location: "BK Wing", kind: "SESSION" },
    ],
  },
  // "Pujya Paramniket Swami" (O18, rows 21-29)
  {
    bapsId: "PN2102",
    items: [
      { day: "2026-10-08", start: "20:00", end: "20:30", title: "Dessert Serving", location: "Banquet Hall", kind: "MEAL" },
    ],
  },
  // "Pujya Shantipriya Swami" (AY30, rows 33-41)
  {
    bapsId: "SP2102",
    items: [
      { day: "2026-10-10", start: "11:00", end: "11:30", title: "PC Track Breakout", kind: "SESSION" },
      { day: "2026-10-10", start: "20:00", end: "20:30", title: "Dessert Serving", location: "Banquet Hall", kind: "MEAL" },
    ],
  },
  // "Pujya Saralyogi Swami" (AM19, rows 22-30)
  {
    bapsId: "SY0702",
    items: [
      { day: "2026-10-09", start: "07:00", end: "07:30", title: "Morning Mandir Arti", location: "Nij Mandir", kind: "ARTI" },
    ],
  },
  // "Pujya Nirdoshswarup Swami" (BK30, rows 33-41)
  {
    bapsId: "NS0501",
    items: [
      { day: "2026-10-11", start: "07:00", end: "07:30", title: "Morning Mandir Arti", location: "Nij Mandir", kind: "ARTI" },
    ],
  },
  // "Pujya Achalniket Swami" (AA6, rows 9-17)
  {
    bapsId: "AN2101",
    items: [
      { day: "2026-10-08", start: "17:00", end: "19:00", title: "Mukhpath Testing", location: "BK Wing", kind: "SESSION" },
      { day: "2026-10-08", start: "19:30", end: "21:00", title: "Mukhpath Testing", location: "BK Wing", kind: "SESSION" },
      { day: "2026-10-09", start: "12:30", end: "14:00", title: "Mukhpath Testing", location: "BK Wing", kind: "SESSION" },
      { day: "2026-10-10", start: "12:30", end: "14:00", title: "Mukhpath Testing", location: "BK Wing", kind: "SESSION" },
      { day: "2026-10-10", start: "20:00", end: "20:30", title: "Dessert Serving", location: "Banquet Hall", kind: "MEAL" },
    ],
  },
  // "Pujya Brahmatilak Swami" (AM31, rows 34-41)
  {
    bapsId: "BT0901",
    items: [
      { day: "2026-10-10", start: "19:00", end: "19:30", title: "Evening Mandir Arti", location: "Nij Mandir", kind: "ARTI" },
    ],
  },
  // "Pujya Narayansankalp Swami" (C18, rows 21-29)
  {
    bapsId: "NS2301",
    items: [
      { day: "2026-10-08", start: "19:00", end: "19:30", title: "Evening Mandir Arti", location: "Nij Mandir", kind: "ARTI" },
      { day: "2026-10-09", start: "20:00", end: "20:30", title: "Dessert Serving", location: "Banquet Hall", kind: "MEAL" },
    ],
  },
  // "Pujya Achalnayan Swami" (AM6, rows 9-18)
  {
    bapsId: "AN2103",
    items: [
      { day: "2026-10-08", start: "17:00", end: "19:00", title: "Mukhpath Testing", location: "BK Wing", kind: "SESSION" },
      { day: "2026-10-08", start: "19:00", end: "19:30", title: "Evening Mandir Arti", location: "Nij Mandir", kind: "ARTI" },
      { day: "2026-10-08", start: "19:30", end: "21:00", title: "Mukhpath Testing", location: "BK Wing", kind: "SESSION" },
      { day: "2026-10-09", start: "12:30", end: "14:00", title: "Mukhpath Testing", location: "BK Wing", kind: "SESSION" },
      { day: "2026-10-09", start: "20:00", end: "20:30", title: "Dessert Serving", location: "Banquet Hall", kind: "MEAL" },
      { day: "2026-10-10", start: "11:00", end: "12:30", title: "PCs Breakout", location: "Yogi Hall", kind: "SESSION" },
      { day: "2026-10-10", start: "12:30", end: "14:00", title: "Mukhpath Testing", location: "BK Wing", kind: "SESSION" },
    ],
  },
  // "Pujya Akhandanand Swami" (BK6, rows 9-17)
  {
    bapsId: "AA1601",
    items: [
      { day: "2026-10-08", start: "17:00", end: "19:00", title: "Mukhpath Testing", location: "BK Wing", kind: "SESSION" },
      { day: "2026-10-08", start: "19:30", end: "21:00", title: "Mukhpath Testing", location: "BK Wing", kind: "SESSION" },
      { day: "2026-10-09", start: "12:30", end: "14:00", title: "Mukhpath Testing", location: "BK Wing", kind: "SESSION" },
      { day: "2026-10-10", start: "12:30", end: "14:00", title: "Mukhpath Testing", location: "BK Wing", kind: "SESSION" },
      { day: "2026-10-10", start: "19:00", end: "19:30", title: "Evening Mandir Arti", location: "Nij Mandir", kind: "ARTI" },
    ],
  },
  // "Pujya Sarangkirtan Swami" (BK18, rows 21-29)
  {
    bapsId: "SK1501",
    items: [
      { day: "2026-10-09", start: "18:45", end: "19:15", title: "Sabha Hall Arti", location: "Sahajanand Hall", kind: "ARTI" },
    ],
  },
];
