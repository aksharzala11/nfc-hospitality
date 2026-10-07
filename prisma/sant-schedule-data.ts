/**
 * The Pujya Santo general schedule (Mon Oct 5 - Thu Oct 15, 2026), generated on 2026-10-03 from
 * the "Master Schedule" tab ("2026 NAAM + DC Schedule | October 05-15, 2026") of the organisers'
 * workbook "TEJBHAI THIS IS EVERYTHING BUDDY - Version 1 (1).xlsx" by a Python/openpyxl script
 * kept outside the repo. Not typed by hand; regenerate rather than edit. It replaces the "General
 * Schedule" sheet of "Santo Schedule Tejbhai.xlsx" (read on 2026-09-25); the same text and kind
 * rules read that sheet back to this file's earlier version exactly.
 *
 * How the tab was read:
 *  - Row 2 holds each day's date (Oct 9-11 as formulas, read as their values). Every day has three
 *    columns: hour, minute and one event column (C, F, I, ... AG); on Oct 8-10 that column is
 *    headed "Pujya Santo" (row 4). The tab has no Bhaio Delegates column any more.
 *  - Rows 5..66 are 15-minute rows: row 5 = 6:15 AM ... row 66 = 9:30 PM (the hours are 12-hour;
 *    each row was cross-checked against the day's hour/minute columns; Oct 15's hour cell for
 *    4 PM is unreadable, inside "Departure All Day", and not needed). A cell's merged row span is
 *    its duration (an unmerged cell = 15 minutes); a merge's value is its top-left cell. Empty
 *    cells (unscheduled time) are skipped. "Arrival All Day" / "Departure All Day" span exactly
 *    what their merges span.
 *  - Text: title = the cell's first line, further lines -> description (joined with "; "), a
 *    trailing "(Place)" -> location. "Akshardham / Smruti Sabha" is one title (its line break is
 *    only word-wrap); a trailing "/" on a line is dropped ("Lunch/", "Rest at Utaaro/"). Sheet
 *    notes the app must not show are removed: "[i/eBKY Combined]", "[Common Session]" and
 *    "[Split BKY Session]" (main session, 2026-10-03); any other bracketed note, or an e/i/ei
 *    track prefix, stops the generator (there are none). Spelling fix: "Utaaro" -> "Utaro".
 *  - Oct 6's three agenda cells are bulleted lists with no heading line: each is titled "BKY Santo
 *    Meeting" (the earlier sheet's name for these meetings), its bullets joined with "; " as the
 *    description, with no location (the earlier sheet's "(NAHQ)" is gone) (main session,
 *    2026-10-03). "Travel to NAHQ" has a second line, "Satsang Pravrutti Library", read by the
 *    rule above as its description.
 *  - The update sessions in the earlier sheet's "Pujya Santo Session" slots (Fri Oct 9 11:00-12:30
 *    and 15:00-16:30, Sat Oct 10 11:00-12:30) take the place the santos' own sheets ("Individual
 *    Schedule" tab, their "Santo Breakout" rows) give those slots: "Yogi Hall" (user, 2026-10-03).
 *    The Breaks inside those slots have no location.
 *  - kind: ARTI for arti/darshan/abhishek (and Chesta), MEAL for breakfast/lunch/dinner/snacks/
 *    dessert/refreshments, TRAVEL for travel/depart/transit, BREAK for rest/break (and Seating),
 *    BREAKOUT for "Pujya Santo Session" (the earlier sheet's slots: unused now, so no item here is
 *    a BREAKOUT and the General tab links none to /sant/breakouts), FREE for arrival/departure
 *    markers (and Group Photo), else SESSION.
 *
 * Times are Eastern wall clock ("HH:MM", 24 h); convert to UTC when writing to the database.
 */

import type { ScheduleKind } from "@prisma/client";

export const SANT_SCHEDULE_DAYS: readonly string[] = [
  "2026-10-05",
  "2026-10-06",
  "2026-10-07",
  "2026-10-08",
  "2026-10-09",
  "2026-10-10",
  "2026-10-11",
  "2026-10-12",
  "2026-10-13",
  "2026-10-14",
  "2026-10-15",
];

export type SantGeneralItemData = {
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

/** Sorted by day, then start. */
export const SANT_GENERAL_SCHEDULE: SantGeneralItemData[] = [
  // ---- Mon Oct 5 ---------------------------------------------------
  { day: "2026-10-05", start: "06:15", end: "19:00", title: "Arrival All Day", kind: "FREE" },
  { day: "2026-10-05", start: "19:00", end: "19:30", title: "Arti", kind: "ARTI" },
  { day: "2026-10-05", start: "19:30", end: "20:30", title: "Dinner", kind: "MEAL" },
  { day: "2026-10-05", start: "20:30", end: "21:00", title: "Chesta", kind: "ARTI" },
  // ---- Tue Oct 6 ---------------------------------------------------
  { day: "2026-10-06", start: "07:30", end: "08:00", title: "Arti", kind: "ARTI" },
  { day: "2026-10-06", start: "08:00", end: "09:00", title: "Breakfast", kind: "MEAL" },
  { day: "2026-10-06", start: "09:00", end: "09:30", title: "Katha", kind: "SESSION" },
  { day: "2026-10-06", start: "09:30", end: "10:00", title: "Travel to NAHQ", description: "Satsang Pravrutti Library", kind: "TRAVEL" },
  { day: "2026-10-06", start: "10:00", end: "12:00", title: "BKY Santo Meeting", description: "Creative Academy; Yuva Podcast; Satsang Melodies; Satsang Diksha Visharad; Bal Sabha Books; Campus and Real Estate; Santo Pravrutti Assignments", kind: "SESSION" },
  { day: "2026-10-06", start: "12:00", end: "13:00", title: "Lunch", kind: "MEAL" },
  { day: "2026-10-06", start: "13:00", end: "16:00", title: "Rest", kind: "BREAK" },
  { day: "2026-10-06", start: "16:00", end: "16:30", title: "Refreshments", kind: "MEAL" },
  { day: "2026-10-06", start: "16:30", end: "17:45", title: "BKY Santo Meeting", description: "Satsang AI Policy; IT/MS 365/Storage Updates; NC27 Hub; Bal NC27 Programming; Kishore NC27 Programming; Yuvak NC27 Programming", kind: "SESSION" },
  { day: "2026-10-06", start: "17:45", end: "18:00", title: "Break", kind: "BREAK" },
  { day: "2026-10-06", start: "18:00", end: "19:00", title: "BKY Santo Meeting", description: "PreNC27 Marketing / NC27 Mukhpath / NC27 Corner; Santo NC27 Assignments; Calendar", kind: "SESSION" },
  { day: "2026-10-06", start: "19:00", end: "19:30", title: "Arti", kind: "ARTI" },
  { day: "2026-10-06", start: "19:30", end: "20:30", title: "Dinner", kind: "MEAL" },
  { day: "2026-10-06", start: "20:30", end: "21:00", title: "Chesta", kind: "ARTI" },
  // ---- Wed Oct 7 ---------------------------------------------------
  { day: "2026-10-07", start: "07:30", end: "08:00", title: "Arti", kind: "ARTI" },
  { day: "2026-10-07", start: "08:00", end: "09:00", title: "Breakfast", kind: "MEAL" },
  { day: "2026-10-07", start: "09:00", end: "09:30", title: "Katha", kind: "SESSION" },
  { day: "2026-10-07", start: "09:30", end: "10:00", title: "Travel to Staff Briefing Room", kind: "TRAVEL" },
  { day: "2026-10-07", start: "10:00", end: "11:00", title: "AI Awareness", kind: "SESSION" },
  { day: "2026-10-07", start: "11:00", end: "12:00", title: "CA", kind: "SESSION" },
  { day: "2026-10-07", start: "12:00", end: "13:00", title: "Lunch", kind: "MEAL" },
  { day: "2026-10-07", start: "13:00", end: "16:00", title: "Rest", kind: "BREAK" },
  { day: "2026-10-07", start: "16:00", end: "16:30", title: "Refreshments", kind: "MEAL" },
  { day: "2026-10-07", start: "16:30", end: "17:15", title: "Calendar 2027", kind: "SESSION" },
  { day: "2026-10-07", start: "17:15", end: "17:30", title: "Yuva 75", kind: "SESSION" },
  { day: "2026-10-07", start: "17:30", end: "17:45", title: "Break", kind: "BREAK" },
  { day: "2026-10-07", start: "17:45", end: "18:30", title: "Sanyukt Pravrutti", kind: "SESSION" },
  { day: "2026-10-07", start: "18:30", end: "19:00", title: "FERA", kind: "SESSION" },
  { day: "2026-10-07", start: "19:00", end: "19:30", title: "Arti", kind: "ARTI" },
  { day: "2026-10-07", start: "19:30", end: "20:30", title: "Dinner", kind: "MEAL" },
  { day: "2026-10-07", start: "20:30", end: "21:00", title: "Chesta", kind: "ARTI" },
  // ---- Thu Oct 8 ---------------------------------------------------
  { day: "2026-10-08", start: "07:30", end: "08:00", title: "Arti", kind: "ARTI" },
  { day: "2026-10-08", start: "08:00", end: "10:00", title: "Santo Exhibition Tour", kind: "SESSION" },
  { day: "2026-10-08", start: "10:00", end: "11:30", title: "Akshardham Smruti Sabha", kind: "SESSION" },
  { day: "2026-10-08", start: "11:30", end: "13:00", title: "Lunch", kind: "MEAL" },
  { day: "2026-10-08", start: "13:00", end: "14:00", title: "Travel to Edison", kind: "TRAVEL" },
  { day: "2026-10-08", start: "14:00", end: "17:00", title: "Rest at Utaro", description: "Meet NAAM Delegates", kind: "BREAK" },
  { day: "2026-10-08", start: "17:00", end: "19:00", title: "Arrival & Check-In", description: "Mukhpath Testing", kind: "FREE" },
  { day: "2026-10-08", start: "19:00", end: "19:30", title: "Arti", kind: "ARTI" },
  { day: "2026-10-08", start: "19:30", end: "21:00", title: "Dinner & Dessert", description: "Ongoing Arrival & Check-in; Mukhpath Testing 8-9PM", kind: "MEAL" },
  { day: "2026-10-08", start: "21:00", end: "21:45", title: "Depart to Utaro", kind: "TRAVEL" },
  // ---- Fri Oct 9 ---------------------------------------------------
  { day: "2026-10-09", start: "06:45", end: "07:00", title: "Travel to Mandir", kind: "TRAVEL" },
  { day: "2026-10-09", start: "07:00", end: "07:45", title: "Arti, Darshan, Abhishek", kind: "ARTI" },
  { day: "2026-10-09", start: "07:45", end: "09:00", title: "Breakfast", kind: "MEAL" },
  { day: "2026-10-09", start: "09:00", end: "09:15", title: "Seating", kind: "BREAK" },
  { day: "2026-10-09", start: "09:15", end: "10:45", title: "Keynote Program 1", kind: "SESSION" },
  { day: "2026-10-09", start: "10:45", end: "11:00", title: "Travel", kind: "TRAVEL" },
  { day: "2026-10-09", start: "11:00", end: "11:30", title: "BKY RC Updates", location: "Yogi Hall", kind: "SESSION" },
  { day: "2026-10-09", start: "11:30", end: "12:00", title: "BKY RCTL Updates", location: "Yogi Hall", kind: "SESSION" },
  { day: "2026-10-09", start: "12:00", end: "12:30", title: "BKY RA Updates", location: "Yogi Hall", kind: "SESSION" },
  { day: "2026-10-09", start: "12:30", end: "14:00", title: "Lunch", description: "Mukhpath Testing", kind: "MEAL" },
  { day: "2026-10-09", start: "14:00", end: "14:45", title: "Goshthi 1", kind: "SESSION" },
  { day: "2026-10-09", start: "14:45", end: "15:00", title: "Travel", kind: "TRAVEL" },
  { day: "2026-10-09", start: "15:00", end: "15:30", title: "NC27 Samp Camp", location: "Yogi Hall", kind: "SESSION" },
  { day: "2026-10-09", start: "15:30", end: "16:00", title: "Campus and Education Updates", location: "Yogi Hall", kind: "SESSION" },
  { day: "2026-10-09", start: "16:00", end: "16:30", title: "Break", kind: "BREAK" },
  { day: "2026-10-09", start: "16:30", end: "16:45", title: "Group Photo", kind: "FREE" },
  { day: "2026-10-09", start: "16:45", end: "17:00", title: "Snacks", kind: "MEAL" },
  { day: "2026-10-09", start: "17:00", end: "17:15", title: "Seating", kind: "BREAK" },
  { day: "2026-10-09", start: "17:15", end: "18:45", title: "Keynote Program 2", kind: "SESSION" },
  { day: "2026-10-09", start: "18:45", end: "19:15", title: "Sabha Hall Arti", kind: "ARTI" },
  { day: "2026-10-09", start: "19:15", end: "19:30", title: "Travel", kind: "TRAVEL" },
  { day: "2026-10-09", start: "19:30", end: "21:00", title: "Dinner & Dessert", kind: "MEAL" },
  { day: "2026-10-09", start: "21:00", end: "21:45", title: "Depart to Utaro", kind: "TRAVEL" },
  // ---- Sat Oct 10 --------------------------------------------------
  { day: "2026-10-10", start: "06:45", end: "07:00", title: "Travel to Mandir", kind: "TRAVEL" },
  { day: "2026-10-10", start: "07:00", end: "07:45", title: "Arti, Darshan, Abhishek", kind: "ARTI" },
  { day: "2026-10-10", start: "07:45", end: "09:00", title: "Breakfast", kind: "MEAL" },
  { day: "2026-10-10", start: "09:00", end: "09:15", title: "Seating", kind: "BREAK" },
  { day: "2026-10-10", start: "09:15", end: "10:45", title: "Keynote Program 3", kind: "SESSION" },
  { day: "2026-10-10", start: "10:45", end: "11:00", title: "Travel", kind: "TRAVEL" },
  { day: "2026-10-10", start: "11:00", end: "11:30", title: "BK PCs/GCs Updates", location: "Yogi Hall", kind: "SESSION" },
  { day: "2026-10-10", start: "11:30", end: "12:00", title: "BST/KST Updates", location: "Yogi Hall", kind: "SESSION" },
  { day: "2026-10-10", start: "12:00", end: "12:30", title: "Break", kind: "BREAK" },
  { day: "2026-10-10", start: "12:30", end: "14:00", title: "Lunch", description: "Mukhpath Testing", kind: "MEAL" },
  { day: "2026-10-10", start: "14:00", end: "14:45", title: "Goshthi 2", kind: "SESSION" },
  { day: "2026-10-10", start: "14:45", end: "15:00", title: "Travel", kind: "TRAVEL" },
  { day: "2026-10-10", start: "15:00", end: "16:30", title: "Regional Review", kind: "SESSION" },
  { day: "2026-10-10", start: "16:30", end: "17:00", title: "Snacks & Travel", kind: "MEAL" },
  { day: "2026-10-10", start: "17:00", end: "17:15", title: "Seating", kind: "BREAK" },
  { day: "2026-10-10", start: "17:15", end: "18:45", title: "Keynote Program 4", kind: "SESSION" },
  { day: "2026-10-10", start: "18:45", end: "19:00", title: "Travel", kind: "TRAVEL" },
  { day: "2026-10-10", start: "19:00", end: "19:30", title: "Mandir Arti", kind: "ARTI" },
  { day: "2026-10-10", start: "19:30", end: "21:00", title: "Dinner & Dessert", kind: "MEAL" },
  { day: "2026-10-10", start: "21:00", end: "21:45", title: "Depart to Utaro", kind: "TRAVEL" },
  // ---- Sun Oct 11 --------------------------------------------------
  { day: "2026-10-11", start: "07:00", end: "07:30", title: "Arti, Darshan, Abhishek", kind: "ARTI" },
  { day: "2026-10-11", start: "07:30", end: "08:00", title: "Breakfast", location: "Edison", kind: "MEAL" },
  { day: "2026-10-11", start: "08:00", end: "09:00", title: "Travel to Robbinsville", kind: "TRAVEL" },
  { day: "2026-10-11", start: "09:00", end: "09:30", title: "Darshan/Breakfast", location: "Robbinsville", kind: "ARTI" },
  { day: "2026-10-11", start: "09:30", end: "12:30", title: "Museum Special Dedication Ceremony", kind: "SESSION" },
  { day: "2026-10-11", start: "12:30", end: "14:00", title: "Lunch", kind: "MEAL" },
  { day: "2026-10-11", start: "14:00", end: "16:30", title: "Travel to DC", kind: "TRAVEL" },
  { day: "2026-10-11", start: "16:30", end: "19:00", title: "DC Bhumi Pujan", kind: "SESSION" },
  { day: "2026-10-11", start: "19:00", end: "19:30", title: "Arti", kind: "ARTI" },
  { day: "2026-10-11", start: "19:30", end: "20:30", title: "Dinner", kind: "MEAL" },
  { day: "2026-10-11", start: "20:30", end: "21:00", title: "Chesta", kind: "ARTI" },
  // ---- Mon Oct 12 --------------------------------------------------
  { day: "2026-10-12", start: "07:00", end: "07:30", title: "Arti, Darshan, Abhishek", kind: "ARTI" },
  { day: "2026-10-12", start: "07:30", end: "08:30", title: "Breakfast", kind: "MEAL" },
  { day: "2026-10-12", start: "08:30", end: "09:30", title: "Sant Katha", kind: "SESSION" },
  { day: "2026-10-12", start: "09:30", end: "10:00", title: "Break/Transit", kind: "TRAVEL" },
  { day: "2026-10-12", start: "10:00", end: "10:45", title: "Corporate Affairs / Compliance", kind: "SESSION" },
  { day: "2026-10-12", start: "10:45", end: "11:15", title: "Public Affairs", kind: "SESSION" },
  { day: "2026-10-12", start: "11:15", end: "11:45", title: "Break/Transit", kind: "TRAVEL" },
  { day: "2026-10-12", start: "11:45", end: "12:30", title: "Bhumi Pujan Session 2", kind: "SESSION" },
  { day: "2026-10-12", start: "12:30", end: "12:45", title: "Transit", kind: "TRAVEL" },
  { day: "2026-10-12", start: "12:45", end: "13:45", title: "Lunch", kind: "MEAL" },
  { day: "2026-10-12", start: "13:45", end: "16:00", title: "Rest", kind: "BREAK" },
  { day: "2026-10-12", start: "16:00", end: "16:30", title: "Refreshments", kind: "MEAL" },
  { day: "2026-10-12", start: "16:30", end: "17:15", title: "Data Governance", kind: "SESSION" },
  { day: "2026-10-12", start: "17:15", end: "17:30", title: "Akshardham", kind: "SESSION" },
  { day: "2026-10-12", start: "17:30", end: "19:30", title: "Local Sabha", kind: "SESSION" },
  { day: "2026-10-12", start: "19:30", end: "20:30", title: "Dinner", kind: "MEAL" },
  { day: "2026-10-12", start: "20:30", end: "21:00", title: "Chesta", kind: "ARTI" },
  // ---- Tue Oct 13 --------------------------------------------------
  { day: "2026-10-13", start: "07:00", end: "07:30", title: "Arti, Darshan, Abhishek", kind: "ARTI" },
  { day: "2026-10-13", start: "07:30", end: "08:30", title: "Breakfast", kind: "MEAL" },
  { day: "2026-10-13", start: "08:30", end: "15:30", title: "Sant Milan", kind: "SESSION" },
  { day: "2026-10-13", start: "15:30", end: "17:00", title: "Travel to Mandir", kind: "TRAVEL" },
  { day: "2026-10-13", start: "17:00", end: "17:30", title: "Break/Clean up", kind: "BREAK" },
  { day: "2026-10-13", start: "17:30", end: "19:30", title: "Local Sabha", kind: "SESSION" },
  { day: "2026-10-13", start: "19:30", end: "20:30", title: "Dinner", kind: "MEAL" },
  { day: "2026-10-13", start: "20:30", end: "21:00", title: "Chesta", kind: "ARTI" },
  // ---- Wed Oct 14 --------------------------------------------------
  { day: "2026-10-14", start: "07:00", end: "07:30", title: "Arti, Darshan, Abhishek", kind: "ARTI" },
  { day: "2026-10-14", start: "07:30", end: "08:30", title: "Breakfast", kind: "MEAL" },
  { day: "2026-10-14", start: "08:30", end: "09:30", title: "Sant Katha", kind: "SESSION" },
  { day: "2026-10-14", start: "09:30", end: "10:00", title: "Break/Transit", kind: "TRAVEL" },
  { day: "2026-10-14", start: "10:00", end: "11:15", title: "IT", kind: "SESSION" },
  { day: "2026-10-14", start: "11:15", end: "12:00", title: "Aksharpith", kind: "SESSION" },
  { day: "2026-10-14", start: "12:00", end: "13:00", title: "Lunch", kind: "MEAL" },
  { day: "2026-10-14", start: "13:00", end: "15:30", title: "Rest", kind: "BREAK" },
  { day: "2026-10-14", start: "15:30", end: "16:00", title: "Refreshments", kind: "MEAL" },
  { day: "2026-10-14", start: "16:00", end: "16:45", title: "Communications", kind: "SESSION" },
  { day: "2026-10-14", start: "16:45", end: "17:30", title: "Publications", kind: "SESSION" },
  { day: "2026-10-14", start: "17:30", end: "18:00", title: "Break", kind: "BREAK" },
  { day: "2026-10-14", start: "18:00", end: "20:00", title: "Sant Sabha", kind: "SESSION" },
  { day: "2026-10-14", start: "20:00", end: "21:00", title: "Dinner", kind: "MEAL" },
  { day: "2026-10-14", start: "21:00", end: "21:30", title: "Chesta", kind: "ARTI" },
  // ---- Thu Oct 15 --------------------------------------------------
  { day: "2026-10-15", start: "06:15", end: "21:45", title: "Departure All Day", kind: "FREE" },
];
