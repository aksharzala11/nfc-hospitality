/**
 * Team breakout sessions, transcribed from the organisers' live "NAAM_Breakout_Room_MASTER_synced"
 * Google Sheet ("NAAM 2026 · Breakout Room Schedule") as it read on 2026-10-01 (it replaces the
 * "NAAM 2026 Breakout Locations" workbook of 2026-09-27): the Bhaiyo and Behno grids only (the
 * "Setup" tab is the rooms' floors and capacities, the "Data" tab a flat copy of the grids; neither
 * is used, except the Data tab's Type column as a cross-check of the "Santo joining" marks, read
 * 2026-10-02: see `santos` below). Each grid has one column per room and one row per quarter
 * hour; a cell (merged over the quarter hours it spans) names the team(s) in that room.
 * Consecutive quarter hours of one team in one room make one session, and the tab gives its
 * track. Each tab is complete for its
 * own track, so a session held for both tracks appears once per track. Grey cells ("not used",
 * "Used by Behno" / "Used by Bhaiyo") hold no session. The Behno tab's Friday Breakout 2 block
 * says "No Behno rooms listed for this breakout in the source sheet.": all Behno are in the Main
 * Hall then (the schedule's Mahila Program), so there are no Behno sessions for it here (also not
 * for FERA, which the Bhaiyo grid marks "ei" in that block: see the comment on that entry).
 *
 * Conventions from the organisers:
 *  - The sheet's lower-case prefixes are short for Kishore / Kishori: "e" = Bhaio, "i" = Behno,
 *    "ei" = both. They are dropped from titles, and the app never labels a session as joint.
 *  - "Split" sessions list every room with SPLIT_NOTE until the per-person split is final (the
 *    2026-10-01 sheet has none).
 *  - Headcounts and table counts ("27 people · 5 tables") and the grid's fill colours (single
 *    team / i/e combined) are planning data and are not shown to guests. The one fill the app
 *    reads is "Santo joining" (#fcddb5 on the Bhaiyo grid; the Data tab's Type "Santo joining"),
 *    read 2026-10-02 and recorded as `santos` on those Bhaio entries (eight cells, every one a
 *    session both tracks hold): the Pujya Santo view offers those sessions besides the Bhaio
 *    ones no Behno session shares, at the marked time (user, 2026-10-02; src/lib/santBreakouts.ts).
 *    Delegates and the display API never see the mark.
 *  - `teams` are canonical team codes (see TEAM_ALIASES in src/lib/teams.ts for the spellings
 *    users.seva may use).
 *  - Rooms are named as the grid's header names them, except where the Behno grid is not
 *    consistent with the rest of the sheet (see the comments on the entries): Saturday's "Ladies
 *    Storage Room" header is the Ladies Multipurpose Room (user, 2026-10-01), and the Premvati
 *    column, FERA's room in the 2026-09-27 workbook, is read as a leftover (FERA: Green Room 2).
 *
 * To change a session, edit it here and run `npm run breakouts:sync` (or the :lightsail
 * variant); ids are derived from track, day, start and team, so links in
 * users.breakout_sessions survive re-syncs as long as those stay the same.
 */

export type BreakoutTrack = "BHAIO" | "BEHNO";

export type BreakoutSessionData = {
  track: BreakoutTrack;
  day: "FRI" | "SAT";
  /** Eastern wall clock, "HH:MM". */
  start: string;
  end: string;
  title: string;
  /** Canonical team codes this session is for. */
  teams: string[];
  /** One room, or several when the team is split amongst them. */
  rooms: string[];
  note?: string;
  /**
   * The organisers' "Santo joining" mark (the sheet's #fcddb5 fill on the Bhaiyo grid, the Data
   * tab's Type "Santo joining", read 2026-10-02): the Pujya Santos join this session, so the
   * Santo view offers it even though both tracks hold it. `true` = the whole session; a window =
   * only that part of it (Eastern "HH:MM", inside the session's start and end). BHAIO entries
   * only. Checked by breakoutRows(); santoJoiningByRowId() in prisma/breakouts.ts turns it into
   * offsets for the rows. No column: nothing is written to the database for it.
   */
  santos?: true | { start: string; end: string };
};

export const SPLIT_NOTE = "Split amongst these rooms.";

export const BREAKOUT_SESSIONS: BreakoutSessionData[] = [
  // ---- Bhaio · Friday Breakout 1 ----------------------------------------
  { track: "BHAIO", day: "FRI", start: "11:00", end: "11:45", title: "BKY RCTLs", teams: ["BKY RCTLs"], rooms: ["Mezzanine"] },
  { track: "BHAIO", day: "FRI", start: "11:00", end: "12:30", title: "BM NDC", teams: ["BM NDC"], rooms: ["Divyabhav"] },
  { track: "BHAIO", day: "FRI", start: "11:00", end: "12:30", title: "KM NDC", teams: ["KM NDC"], rooms: ["Mahima"] },
  { track: "BHAIO", day: "FRI", start: "11:00", end: "11:45", title: "YM NDC", teams: ["YM NDC"], rooms: ["Nishchay"] },
  { track: "BHAIO", day: "FRI", start: "11:00", end: "11:30", title: "BM RA", teams: ["BM RA"], rooms: ["Niyam"] },
  { track: "BHAIO", day: "FRI", start: "11:00", end: "11:30", title: "KM RA", teams: ["KM RA"], rooms: ["Atma"] },
  { track: "BHAIO", day: "FRI", start: "11:00", end: "11:30", title: "YM RA", teams: ["YM RA"], rooms: ["Gnan"] },
  { track: "BHAIO", day: "FRI", start: "11:00", end: "12:30", title: "BM RC", teams: ["BM RC"], rooms: ["Pramukh Hall"] },
  { track: "BHAIO", day: "FRI", start: "11:00", end: "12:30", title: "KM RC", teams: ["KM RC"], rooms: ["Men's Gym"] },
  { track: "BHAIO", day: "FRI", start: "11:00", end: "12:30", title: "YM RC", teams: ["YM RC"], rooms: ["Large Banquet Hall"] },
  { track: "BHAIO", day: "FRI", start: "11:00", end: "12:30", title: "SA", teams: ["SA"], rooms: ["Paksh"] },
  { track: "BHAIO", day: "FRI", start: "11:00", end: "12:30", title: "MM", teams: ["MM"], rooms: ["Seva"] },
  { track: "BHAIO", day: "FRI", start: "11:00", end: "12:30", title: "BKSTL", teams: ["BSTL", "KSTL"], rooms: ["Mezzanine Men's Office 2"] },
  { track: "BHAIO", day: "FRI", start: "11:00", end: "11:30", title: "CE", teams: ["CE"], rooms: ["Men's Guest Room"], santos: true },
  { track: "BHAIO", day: "FRI", start: "11:00", end: "12:30", title: "BK RPCs & RGCs", teams: ["BK RPCs & RGCs"], rooms: ["Small Banquet Hall"] },
  { track: "BHAIO", day: "FRI", start: "11:00", end: "12:30", title: "FERA", teams: ["FERA"], rooms: ["Green Room 2"], santos: { start: "11:45", end: "12:00" } },
  { track: "BHAIO", day: "FRI", start: "11:30", end: "12:00", title: "BKY RAs", teams: ["BM RA", "KM RA", "YM RA"], rooms: ["Main Hall"], santos: true },
  { track: "BHAIO", day: "FRI", start: "11:30", end: "12:30", title: "CE", teams: ["CE"], rooms: ["Men's Guest Room"] },
  { track: "BHAIO", day: "FRI", start: "12:00", end: "12:30", title: "BKY RCTLs", teams: ["BKY RCTLs"], rooms: ["Mezzanine"], santos: true },
  { track: "BHAIO", day: "FRI", start: "12:00", end: "12:30", title: "YM NDC", teams: ["YM NDC"], rooms: ["Ladies Guest Room"], santos: true },
  { track: "BHAIO", day: "FRI", start: "12:00", end: "12:30", title: "BM RA", teams: ["BM RA"], rooms: ["Niyam"] },
  { track: "BHAIO", day: "FRI", start: "12:00", end: "12:30", title: "KM RA", teams: ["KM RA"], rooms: ["Atma"] },
  { track: "BHAIO", day: "FRI", start: "12:00", end: "12:30", title: "YM RA", teams: ["YM RA"], rooms: ["Gnan"] },
  // ---- Bhaio · Friday Breakout 2 ----------------------------------------
  { track: "BHAIO", day: "FRI", start: "15:00", end: "15:45", title: "BKY RCTLs + BKY NDC", teams: ["BKY RCTLs", "BM NDC", "KM NDC", "YM NDC"], rooms: ["Mezzanine"] },
  { track: "BHAIO", day: "FRI", start: "15:00", end: "16:30", title: "BKY RAs", teams: ["BM RA", "KM RA", "YM RA"], rooms: ["Men's Gym"] },
  { track: "BHAIO", day: "FRI", start: "15:00", end: "16:30", title: "BM RC", teams: ["BM RC"], rooms: ["Pramukh Hall"] },
  { track: "BHAIO", day: "FRI", start: "15:00", end: "16:30", title: "KM RC", teams: ["KM RC"], rooms: ["Large Banquet Hall"] },
  { track: "BHAIO", day: "FRI", start: "15:00", end: "16:00", title: "YM RC", teams: ["YM RC"], rooms: ["Ladies Multipurpose Room"] },
  { track: "BHAIO", day: "FRI", start: "15:00", end: "16:30", title: "SA + BK RPCs & RGCs", teams: ["SA", "BK RPCs & RGCs"], rooms: ["Small Banquet Hall"] },
  { track: "BHAIO", day: "FRI", start: "15:00", end: "16:30", title: "MM", teams: ["MM"], rooms: ["Seva"] },
  { track: "BHAIO", day: "FRI", start: "15:00", end: "16:30", title: "BKSTL", teams: ["BSTL", "KSTL"], rooms: ["Mezzanine Men's Office 2"] },
  { track: "BHAIO", day: "FRI", start: "15:00", end: "16:30", title: "CE", teams: ["CE"], rooms: ["Divyabhav"] },
  { track: "BHAIO", day: "FRI", start: "15:00", end: "16:30", title: "FERA", teams: ["FERA"], rooms: ["Green Room 2"] },  // Grid: "eiFERA" (both tracks), but the Behno tab lists no rooms for this block and the schedule has the Mahila Program for Behno then: Bhaio only until the organisers say whether Behno FERA come here.
  { track: "BHAIO", day: "FRI", start: "15:45", end: "16:30", title: "BKY RCTLs", teams: ["BKY RCTLs"], rooms: ["Mezzanine"] },
  { track: "BHAIO", day: "FRI", start: "15:45", end: "16:30", title: "BM NDC", teams: ["BM NDC"], rooms: ["Mezzanine Ladies Office 1"] },
  { track: "BHAIO", day: "FRI", start: "15:45", end: "16:30", title: "KM NDC", teams: ["KM NDC"], rooms: ["Mezzanine Ladies Office 3"] },
  { track: "BHAIO", day: "FRI", start: "15:45", end: "16:00", title: "YM NDC", teams: ["YM NDC"], rooms: ["Mezzanine Ladies Office 2"] },
  { track: "BHAIO", day: "FRI", start: "16:00", end: "16:30", title: "YM NDC + YM RC", teams: ["YM NDC", "YM RC"], rooms: ["Ladies Multipurpose Room"] },
  // ---- Bhaio · Saturday Breakout 3 ----------------------------------------
  { track: "BHAIO", day: "SAT", start: "11:00", end: "12:30", title: "BKY RCTLs", teams: ["BKY RCTLs"], rooms: ["Mezzanine"] },
  { track: "BHAIO", day: "SAT", start: "11:00", end: "11:45", title: "BM NDC", teams: ["BM NDC"], rooms: ["Ladies Guest Room"] },
  { track: "BHAIO", day: "SAT", start: "11:00", end: "12:30", title: "KM NDC", teams: ["KM NDC"], rooms: ["Mahima"] },
  { track: "BHAIO", day: "SAT", start: "11:00", end: "11:30", title: "YM NDC", teams: ["YM NDC"], rooms: ["Nishchay"] },
  { track: "BHAIO", day: "SAT", start: "11:00", end: "12:30", title: "BM RA", teams: ["BM RA"], rooms: ["Niyam"] },
  { track: "BHAIO", day: "SAT", start: "11:00", end: "12:30", title: "KM RA", teams: ["KM RA"], rooms: ["Atma"] },
  { track: "BHAIO", day: "SAT", start: "11:00", end: "12:30", title: "YM RA", teams: ["YM RA"], rooms: ["Gnan"] },
  { track: "BHAIO", day: "SAT", start: "11:00", end: "11:45", title: "BKY RC + SA", teams: ["BM RC", "KM RC", "YM RC", "SA"], rooms: ["Main Hall"], santos: { start: "11:00", end: "11:30" } },
  { track: "BHAIO", day: "SAT", start: "11:00", end: "12:30", title: "MM", teams: ["MM"], rooms: ["Seva"] },
  { track: "BHAIO", day: "SAT", start: "11:00", end: "11:30", title: "BSTL", teams: ["BSTL"], rooms: ["Green Room 3"] },
  { track: "BHAIO", day: "SAT", start: "11:00", end: "11:30", title: "KSTL", teams: ["KSTL"], rooms: ["Men's Swagat Room"] },
  { track: "BHAIO", day: "SAT", start: "11:00", end: "12:30", title: "CE", teams: ["CE"], rooms: ["Divyabhav"] },
  { track: "BHAIO", day: "SAT", start: "11:00", end: "12:00", title: "BK RPCs & RGCs", teams: ["BK RPCs & RGCs"], rooms: ["Small Banquet Hall"] },
  { track: "BHAIO", day: "SAT", start: "11:00", end: "12:30", title: "FERA", teams: ["FERA"], rooms: ["Green Room 2"] },
  { track: "BHAIO", day: "SAT", start: "11:00", end: "12:30", title: "RMCs + RMCAs", teams: ["RMCs + RMCAs"], rooms: ["Men's Gym"] },
  { track: "BHAIO", day: "SAT", start: "11:30", end: "12:00", title: "BKSTL", teams: ["BSTL", "KSTL"], rooms: ["Men's Guest Room"], santos: true },
  { track: "BHAIO", day: "SAT", start: "11:45", end: "12:30", title: "BM NDC", teams: ["BM NDC"], rooms: ["Mezzanine Men's Office 2"] },
  { track: "BHAIO", day: "SAT", start: "11:45", end: "12:30", title: "YM NDC", teams: ["YM NDC"], rooms: ["Nishchay"] },
  { track: "BHAIO", day: "SAT", start: "12:00", end: "12:30", title: "BM RC", teams: ["BM RC"], rooms: ["Pramukh Hall"] },
  { track: "BHAIO", day: "SAT", start: "12:00", end: "12:30", title: "KM RC", teams: ["KM RC"], rooms: ["Large Banquet Hall"] },
  { track: "BHAIO", day: "SAT", start: "12:00", end: "12:30", title: "YM RC", teams: ["YM RC"], rooms: ["Small Banquet Hall"] },
  { track: "BHAIO", day: "SAT", start: "12:00", end: "12:30", title: "SA", teams: ["SA"], rooms: ["Paksh"] },
  { track: "BHAIO", day: "SAT", start: "12:00", end: "12:30", title: "BSTL", teams: ["BSTL"], rooms: ["Green Room 3"] },
  { track: "BHAIO", day: "SAT", start: "12:00", end: "12:30", title: "KSTL", teams: ["KSTL"], rooms: ["Men's Swagat Room"] },
  { track: "BHAIO", day: "SAT", start: "12:00", end: "12:30", title: "BK RPCs & RGCs", teams: ["BK RPCs & RGCs"], rooms: ["Main Hall"], santos: true },
  // ---- Behno · Friday Breakout 1 ----------------------------------------
  { track: "BEHNO", day: "FRI", start: "11:00", end: "12:00", title: "BKY RCTLs", teams: ["BKY RCTLs"], rooms: ["Mezzanine Ladies Office 3"] },
  { track: "BEHNO", day: "FRI", start: "11:00", end: "12:00", title: "BKY NDC", teams: ["BM NDC", "KM NDC", "YM NDC"], rooms: ["Ruchi"] },
  { track: "BEHNO", day: "FRI", start: "11:00", end: "11:30", title: "BM RA", teams: ["BM RA"], rooms: ["Yagnapurush Hall"] },
  { track: "BEHNO", day: "FRI", start: "11:00", end: "11:30", title: "KM RA", teams: ["KM RA"], rooms: ["Ashro"] },
  { track: "BEHNO", day: "FRI", start: "11:00", end: "11:30", title: "YM RA", teams: ["YM RA"], rooms: ["Ladies Dance Room 2"] },
  { track: "BEHNO", day: "FRI", start: "11:00", end: "12:30", title: "BM RC", teams: ["BM RC"], rooms: ["Ladies Multipurpose Room"] },
  { track: "BEHNO", day: "FRI", start: "11:00", end: "12:30", title: "KM RC", teams: ["KM RC"], rooms: ["Samarpan"] },
  { track: "BEHNO", day: "FRI", start: "11:00", end: "12:30", title: "YM RC", teams: ["YM RC"], rooms: ["Prapti"] },
  { track: "BEHNO", day: "FRI", start: "11:00", end: "12:30", title: "SA", teams: ["SA"], rooms: ["Pratigna"] },
  { track: "BEHNO", day: "FRI", start: "11:00", end: "12:30", title: "BKSTL", teams: ["BSTL", "KSTL"], rooms: ["Mezzanine Ladies Office 2"] },
  { track: "BEHNO", day: "FRI", start: "11:00", end: "12:30", title: "IT", teams: ["IT"], rooms: ["Ladies Swagat Room"] },
  { track: "BEHNO", day: "FRI", start: "11:00", end: "11:30", title: "CE", teams: ["CE"], rooms: ["Men's Guest Room"] },
  { track: "BEHNO", day: "FRI", start: "11:00", end: "12:30", title: "BM PC", teams: ["BM PC"], rooms: ["Upasana"] },
  { track: "BEHNO", day: "FRI", start: "11:00", end: "12:30", title: "KM PC", teams: ["KM PC"], rooms: ["Pragati"] },
  { track: "BEHNO", day: "FRI", start: "11:00", end: "12:30", title: "BM RGC", teams: ["BM RGC"], rooms: ["Jodan"] },
  { track: "BEHNO", day: "FRI", start: "11:00", end: "12:30", title: "FERA", teams: ["FERA"], rooms: ["Green Room 2"] },  // Behno grid (2026-10-01): "eiFERA" in Green Room 2 and also in its Premvati column. One session for both tracks, and the Bhaiyo grid has it in Green Room 2 only (Premvati is not in its columns or the Setup tab), so Premvati is read as a leftover: to confirm with the organisers.
  { track: "BEHNO", day: "FRI", start: "11:30", end: "12:00", title: "BKY RAs", teams: ["BM RA", "KM RA", "YM RA"], rooms: ["Main Hall"] },
  { track: "BEHNO", day: "FRI", start: "11:30", end: "12:30", title: "CE", teams: ["CE"], rooms: ["Suradhbhav"] },
  { track: "BEHNO", day: "FRI", start: "12:00", end: "12:30", title: "BKY RCTLs", teams: ["BKY RCTLs"], rooms: ["Mezzanine"] },
  { track: "BEHNO", day: "FRI", start: "12:00", end: "12:30", title: "BK NDC", teams: ["BM NDC", "KM NDC"], rooms: ["Ruchi"] },
  { track: "BEHNO", day: "FRI", start: "12:00", end: "12:30", title: "YM NDC", teams: ["YM NDC"], rooms: ["Ladies Guest Room"] },
  { track: "BEHNO", day: "FRI", start: "12:00", end: "12:30", title: "BM RA", teams: ["BM RA"], rooms: ["Yagnapurush Hall"] },
  { track: "BEHNO", day: "FRI", start: "12:00", end: "12:30", title: "KM RA", teams: ["KM RA"], rooms: ["Ashro"] },
  { track: "BEHNO", day: "FRI", start: "12:00", end: "12:30", title: "YM RA", teams: ["YM RA"], rooms: ["Ladies Dance Room 2"] },
  // ---- Behno · Saturday Breakout 3 ----------------------------------------
  { track: "BEHNO", day: "SAT", start: "11:00", end: "12:30", title: "BKY RCTLs", teams: ["BKY RCTLs"], rooms: ["Mezzanine Ladies Office 3"] },
  { track: "BEHNO", day: "SAT", start: "11:00", end: "11:45", title: "BM NDC", teams: ["BM NDC"], rooms: ["Ladies Guest Room"] },
  { track: "BEHNO", day: "SAT", start: "11:00", end: "12:30", title: "KM NDC", teams: ["KM NDC"], rooms: ["Ruchi"] },
  { track: "BEHNO", day: "SAT", start: "11:00", end: "12:30", title: "YM NDC", teams: ["YM NDC"], rooms: ["Mezzanine Ladies Office 2"] },
  { track: "BEHNO", day: "SAT", start: "11:00", end: "12:30", title: "BM RA", teams: ["BM RA"], rooms: ["Yagnapurush Hall"] },
  { track: "BEHNO", day: "SAT", start: "11:00", end: "12:30", title: "KM RA", teams: ["KM RA"], rooms: ["Ashro"] },
  { track: "BEHNO", day: "SAT", start: "11:00", end: "11:30", title: "YM RA", teams: ["YM RA"], rooms: ["Ladies Dance Room 2"] },  // Grid: the room is "not used" from 11:30; YM RA is next named at 11:45 ("YM RC + RA").
  { track: "BEHNO", day: "SAT", start: "11:00", end: "11:45", title: "BKY RC + SA", teams: ["BM RC", "KM RC", "YM RC", "SA"], rooms: ["Main Hall"] },
  { track: "BEHNO", day: "SAT", start: "11:00", end: "12:30", title: "BKSTL", teams: ["BSTL", "KSTL"], rooms: ["Men's Guest Room"] },
  { track: "BEHNO", day: "SAT", start: "11:00", end: "12:30", title: "IT", teams: ["IT"], rooms: ["Ladies Swagat Room"] },
  { track: "BEHNO", day: "SAT", start: "11:00", end: "12:30", title: "CE", teams: ["CE"], rooms: ["Suradhbhav"] },
  { track: "BEHNO", day: "SAT", start: "11:00", end: "12:00", title: "BM PC", teams: ["BM PC"], rooms: ["Upasana"] },
  { track: "BEHNO", day: "SAT", start: "11:00", end: "12:00", title: "KM PC", teams: ["KM PC"], rooms: ["Pragati"] },
  { track: "BEHNO", day: "SAT", start: "11:00", end: "12:00", title: "BM RGC", teams: ["BM RGC"], rooms: ["Jodan"] },
  { track: "BEHNO", day: "SAT", start: "11:00", end: "12:30", title: "FERA", teams: ["FERA"], rooms: ["Green Room 2"] },  // Behno grid (2026-10-01): "eiFERA" in Green Room 2 (11:00-12:30) and also in its Premvati column (11:00-11:45, 12:00-12:30); Premvati read as a leftover, as on Friday.
  { track: "BEHNO", day: "SAT", start: "11:00", end: "12:30", title: "RMCs + RMCAs", teams: ["RMCs + RMCAs"], rooms: ["Men's Gym"] },
  { track: "BEHNO", day: "SAT", start: "11:45", end: "12:30", title: "BM NDC", teams: ["BM NDC"], rooms: ["Mezzanine Ladies Office 1"] },
  { track: "BEHNO", day: "SAT", start: "11:45", end: "12:30", title: "YM RC + YM RA", teams: ["YM RC", "YM RA"], rooms: ["Ladies Guest Room"] },  // Grid: "YM RC + RA" (YM RC + YM RA; written out like the Bhaiyo grid's "YM NDC + YM RC"). Prapti is "not used" on Saturday now.
  { track: "BEHNO", day: "SAT", start: "11:45", end: "12:30", title: "BM RC", teams: ["BM RC"], rooms: ["Ladies Multipurpose Room"] },  // Saturday's header still reads "Ladies Storage Room" for this column: the same room as Friday's "Ladies Multipurpose Room" (user, 2026-10-01; the Bhaiyo grid marks Ladies Multipurpose Room "Used by Behno" for exactly this time).
  { track: "BEHNO", day: "SAT", start: "11:45", end: "12:30", title: "KM RC", teams: ["KM RC"], rooms: ["Samarpan"] },
  { track: "BEHNO", day: "SAT", start: "11:45", end: "12:30", title: "SA", teams: ["SA"], rooms: ["Pratigna"] },
  { track: "BEHNO", day: "SAT", start: "12:00", end: "12:30", title: "BK RPCs & RGCs", teams: ["BM PC", "KM PC", "BM RGC"], rooms: ["Main Hall"] },
];
