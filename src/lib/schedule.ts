import type { ScheduleItem, Meal, MenuFor, MenuItem, Breakout, User, Gender } from "@prisma/client";
import { prisma } from "@/lib/db";
import { dayKey } from "@/lib/time";
import { isTeamCode, teamCodesFor } from "@/lib/teams";
import { sevaWingOf, type SevaWing } from "@/lib/sevaMapping";
import { trackGender, tracksFor } from "@/lib/admin/announcements";
import { sharesAudience } from "@/lib/admin/schedule";
import { OFF_SITE_PLACE, RIDE_TITLE } from "@/lib/travel";

/**
 * Items a guest should see: everything for ALL plus their gender's track.
 * Guests without a recorded gender see both tracks (labelled in the UI).
 */
export function forAudience<T extends { audience: ScheduleItem["audience"] }>(items: T[], gender: Gender | null): T[] {
  if (gender === "MALE") return items.filter((i) => i.audience !== "BEHNO");
  if (gender === "FEMALE") return items.filter((i) => i.audience !== "BHAIO");
  return items;
}

/** How long before a meal its menu becomes visible. */
export const MENU_REVEAL_LEAD_MS = 60 * 60 * 1000;

export type ItemStatus = "past" | "now" | "next" | "upcoming";

export type ScheduleItemView = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  kind: ScheduleItem["kind"];
  audience: ScheduleItem["audience"];
  startsAt: string; // ISO
  endsAt: string; // ISO
  day: string; // YYYY-MM-DD in EVENT_TZ
  status: ItemStatus;
  /**
   * Printed times (ISO) when an admin has moved the item from /admin/schedule;
   * null (or absent) when it is on its printed times. Drives the guests'
   * "Delayed 15 min" / "Earlier by 10 min" badge.
   */
  originalStartsAt?: string | null;
  originalEndsAt?: string | null;
};

export async function getScheduleItems() {
  return prisma.scheduleItem.findMany({ orderBy: [{ startsAt: "asc" }, { sortOrder: "asc" }] });
}

/**
 * Annotates each item with its status relative to `now`:
 *  - now:      in progress
 *  - next:     the first item that hasn't started yet (only when nothing is in progress)
 *  - past / upcoming otherwise
 */
export function annotateSchedule(items: ScheduleItem[], now: Date): ScheduleItemView[] {
  const t = now.getTime();
  const anyInProgress = items.some((i) => i.startsAt.getTime() <= t && t < i.endsAt.getTime());
  let nextMarked = false;

  return items.map((i) => {
    const start = i.startsAt.getTime();
    const end = i.endsAt.getTime();
    let status: ItemStatus;
    if (start <= t && t < end) status = "now";
    else if (end <= t) status = "past";
    else if (!anyInProgress && !nextMarked) {
      status = "next";
      nextMarked = true;
    } else status = "upcoming";

    return {
      id: i.id,
      title: i.title,
      description: i.description,
      location: i.location,
      kind: i.kind,
      audience: i.audience,
      startsAt: i.startsAt.toISOString(),
      endsAt: i.endsAt.toISOString(),
      day: dayKey(i.startsAt),
      status,
      originalStartsAt: i.originalStartsAt?.toISOString() ?? null,
      originalEndsAt: i.originalEndsAt?.toISOString() ?? null,
    };
  });
}

/** The item(s) happening now and the next one up, for the dashboard banner. */
export function currentAndNext(items: ScheduleItem[], now: Date) {
  const t = now.getTime();
  const current = items.filter((i) => i.startsAt.getTime() <= t && t < i.endsAt.getTime());
  const next = items.find((i) => i.startsAt.getTime() > t) ?? null;
  return { current, next };
}

// ---------------------------------------------------------------------------
// Menu reveal logic
// ---------------------------------------------------------------------------

export type MealStatus = "locked" | "revealed" | "served";

export type MealView = {
  id: string;
  name: string;
  note: string | null;
  location: string | null;
  startsAt: string;
  endsAt: string;
  day: string;
  /** When the menu opens (revealTime()); never used for an untimed menu (menuIsTimed()), which is never locked. */
  revealsAt: string;
  status: MealStatus;
  /** Grouped by course, in menu order. Empty while locked. */
  courses: { course: string; items: { id: string; name: string; description: string | null; tags: string[] }[] }[];
};

type MealWithItems = Meal & { items: MenuItem[] };

/**
 * One view's meals in time order: the delegate menu by default, or the Pujya
 * Santo menu with "SANT". Reveal times chain within the list you pass on, so
 * never mix the two.
 */
export async function getMeals(menuFor: MenuFor = "DELEGATE"): Promise<MealWithItems[]> {
  return prisma.meal.findMany({
    where: { menuFor },
    include: { items: { orderBy: { sortOrder: "asc" } } },
    orderBy: { startsAt: "asc" },
  });
}

/**
 * A meal's menu is revealed once the previous meal has finished AND it is
 * within MENU_REVEAL_LEAD_MS of the meal starting, whichever is later.
 * Example: lunch (12:30) is revealed at 11:30, provided breakfast ended by then.
 */
export function revealTime(meal: MealWithItems, previous: MealWithItems | null): Date {
  const lead = meal.startsAt.getTime() - MENU_REVEAL_LEAD_MS;
  const afterPrevious = previous ? previous.endsAt.getTime() : 0;
  return new Date(Math.max(lead, afterPrevious));
}

/** MENU_REVEAL_ALL=true shows every delegate menu regardless of time (for auditing content). */
export function menuRevealAll() {
  return process.env.MENU_REVEAL_ALL === "true";
}

/**
 * Whether a menu is revealed meal by meal. Only the delegate menu is: the Pujya
 * Santo menu is open from the start, every meal with its dishes (user,
 * 2026-10-02), so it never locks and has no menu releases in the bell.
 */
export function menuIsTimed(menuFor: MenuFor) {
  return menuFor !== "SANT";
}

export function annotateMeals(meals: MealWithItems[], now: Date): MealView[] {
  const t = now.getTime();
  const revealAll = menuRevealAll();
  return meals.map((meal, idx) => {
    const previous = idx > 0 ? meals[idx - 1] : null;
    const revealsAt = revealTime(meal, previous);
    let status: MealStatus;
    // Audit mode is for the timed (delegate) menu; an untimed one is open anyway and keeps "Served".
    if (revealAll && menuIsTimed(meal.menuFor)) status = "revealed";
    else if (t >= meal.endsAt.getTime()) status = "served";
    else if (!menuIsTimed(meal.menuFor) || t >= revealsAt.getTime()) status = "revealed";
    else status = "locked";

    const courses: MealView["courses"] = [];
    if (status !== "locked") {
      for (const item of meal.items) {
        let group = courses.find((c) => c.course === item.course);
        if (!group) {
          group = { course: item.course, items: [] };
          courses.push(group);
        }
        group.items.push({ id: item.id, name: item.name, description: item.description, tags: item.tags });
      }
    }

    return {
      id: meal.id,
      name: meal.name,
      note: meal.note,
      location: meal.location,
      startsAt: meal.startsAt.toISOString(),
      endsAt: meal.endsAt.toISOString(),
      day: dayKey(meal.startsAt),
      revealsAt: revealsAt.toISOString(),
      status,
      courses,
    };
  });
}

// ---------------------------------------------------------------------------
// Breakouts
// ---------------------------------------------------------------------------

export type BreakoutView = {
  id: string;
  title: string;
  /** The session's note, e.g. "Split amongst these rooms." for a team split across several rooms. */
  description: string | null;
  /** One room, or several joined with " · ". */
  room: string;
  facilitator: string | null;
  /** Gender track (BHAIO / BEHNO), or ALL. */
  audience: Breakout["audience"];
  startsAt: string;
  endsAt: string;
  day: string;
  status: ItemStatus;
};

/**
 * The user's breakout sessions, in time order: the ones explicitly linked to
 * them (users.breakout_sessions) when set, otherwise every breakout for the
 * team(s) their seva means (teamCodesFor(): canonical team codes plus the seva
 * itself) on their track (tracksFor(trackGender()): men Bhaio, women Behno,
 * no gender on file both; ALL rows show to everyone). The delegate hub's: santos
 * have no breakout sessions of their own and never come here (they pick from
 * every Bhaio session: src/lib/santBreakouts.ts).
 *
 * The real breakouts hold one row per team per track, so a session several of
 * the user's teams share (e.g. "BKSTL" means BSTL and KSTL) is listed once, and
 * so is one both tracks hold in the same room at the same time (for a user who
 * sees both tracks), then with audience ALL so it carries no Bhaio/Behno label.
 */
export async function getBreakoutsForUser(user: Pick<User, "seva" | "breakoutSessions" | "gender" | "role">) {
  const where =
    user.breakoutSessions.length > 0
      ? { id: { in: user.breakoutSessions } }
      : { seva: { in: teamCodesFor(user.seva) }, audience: { in: tracksFor(trackGender(user)) } };
  const rows = await prisma.breakout.findMany({ where, orderBy: [{ startsAt: "asc" }, { endsAt: "asc" }, { title: "asc" }] });
  const out: Breakout[] = [];
  const kept = new Map<string, number>(); // key -> index in out
  for (const b of rows) {
    const key = [b.startsAt.toISOString(), b.endsAt.toISOString(), b.title, b.room, b.description, b.facilitator].join("|");
    const at = kept.get(key);
    if (at === undefined) {
      kept.set(key, out.length);
      out.push(b);
    } else if (out[at].audience !== b.audience) {
      out[at] = { ...out[at], audience: "ALL" };
    }
  }
  return out;
}

/**
 * Whether a users.seva value names at least one team of the breakout matrix
 * (teamCodesFor() finds a canonical team code). False for the sevas the
 * master-list import keeps as raw text because they map to no team ("Sant
 * Admin", "NC Lead", ...; see src/lib/sevaMapping.ts): those delegates have no
 * team breakouts until the organisers say where they go.
 */
export function sevaHasTeam(seva: string | null | undefined): boolean {
  return teamCodesFor(seva).some(isTeamCode);
}

/** A seva wing as guests see it: the organisers' "eBKY" / "iBKY" for EBKY / IBKY. */
const WING_LABEL: Partial<Record<SevaWing, string>> = { EBKY: "eBKY", IBKY: "iBKY" };

/**
 * A Bhaio users.goshthi_group value as a (wing, number) pair, or null when none
 * is assigned or it is not a group number. The wing is the one written in the
 * value ("eBKY Group 3", "Bal 10"), which is how someone listed under another
 * wing is recorded, else their own users.seva_wing. (The first workbook
 * restarted the numbers per wing; the current E-Side numbers them across all
 * of Bhaio, and the wing stays in the label either way.)
 */
function parseGoshthiGroup(
  value: string | null | undefined,
  sevaWing: string | null | undefined,
): { wing: SevaWing | null; n: number } | null {
  const v = (value ?? "").trim().replace(/\s+/g, " ");
  const m = /^(.*?)\s*(?:\bgroup\s*)?(\d+)$/i.exec(v);
  if (!m) return null;
  const prefix = m[1].replace(/[^a-z0-9]+$/i, "");
  const wing = prefix ? sevaWingOf(prefix) : sevaWingOf(sevaWing);
  if (prefix && !wing) return null;
  return { wing, n: Number(m[2]) };
}

/**
 * A Behno goshthi group as the import stores it: "Goshthi Group 12". The Behno
 * file numbers its groups 1–36 across all of Behno (not per seva wing), so the
 * value names the group on its own and never takes a wing.
 */
const BEHNO_GOSHTHI_GROUP = /^goshthi group (\d+)$/i;

/**
 * A users.goshthi_group value as guests see it. Bhaio groups are qualified by
 * their seva wing: "Kishore Group 4" (a bare "4" or "Group 4" takes the
 * delegate's seva wing; "eBKY Group 3" keeps the wing it names), plain
 * "Group 4" when no wing is on file. Behno groups ("Goshthi Group 12",
 * numbered across all of Behno) show exactly as stored, never with a wing.
 * Other text shows as given (tidied); null when none is assigned.
 */
export function goshthiGroupLabel(
  value: string | null | undefined,
  sevaWing: string | null | undefined,
): string | null {
  const v = (value ?? "").trim().replace(/\s+/g, " ");
  if (!v || /^#?n\/?a$/i.test(v)) return null;
  const behno = BEHNO_GOSHTHI_GROUP.exec(v);
  if (behno) return `Goshthi Group ${Number(behno[1])}`;
  const g = parseGoshthiGroup(v, sevaWing);
  if (!g) return v;
  return g.wing ? `${WING_LABEL[g.wing] ?? g.wing} Group ${g.n}` : `Group ${g.n}`;
}

/**
 * Whether a goshthiGroupLabel() value says "Goshthi" itself (Behno "Goshthi Group 12").
 * A Bhaio label ("Kishore Group 4") doesn't, so the UI names it a goshthi group, lest it
 * read as a team breakout room.
 */
export function labelSaysGoshthi(label: string): boolean {
  return /\bgoshthi\b/i.test(label);
}

/** The goshthi fields of a guest (a requireGuest() object, so mirror testers get the mirrored delegate's). */
export type GoshthiGuest = Pick<User, "goshthiGroup" | "sevaWing" | "goshthiRoom">;

/**
 * A delegate's goshthi group as the hub shows it: the label (goshthiGroupLabel()),
 * the room the group meets in during the Goshthi sessions (users.goshthi_room as
 * the organisers name it; null = none given). Null when they have no group; a room
 * without a group shows nothing. Each group meets in its own room (organisers,
 * 2026-09-27), not inside the team breakout rooms. Moderators (users.goshthi_moderator)
 * are not shown in the hub (organisers, 2026-09-27); the flag is admin-only.
 */
export function goshthiFor(guest: GoshthiGuest): { label: string; room: string | null } | null {
  const label = goshthiGroupLabel(guest.goshthiGroup, guest.sevaWing);
  if (!label) return null;
  const room = guest.goshthiRoom?.trim().replace(/\s+/g, " ") || null;
  return { label, room };
}

/** Schedule items that are the Goshthi sessions ("Goshthi 1", "Goshthi 2" in prisma/seed.ts). */
const GOSHTHI_ITEM = /^goshthi\b/i;

/**
 * Where a delegate's Goshthi session is while their group has no room on file: each
 * group meets in its own room, so the printed hall would send them to the wrong place.
 */
export const GOSHTHI_ROOM_TBC = "Room to be confirmed";

/**
 * A delegate's own schedule with their goshthi group filled in: each Goshthi
 * session (title matching /^goshthi\b/i) takes their group's room as its
 * location ("Room to be confirmed" when none is given) and their group label as
 * its description (ahead of any printed description). Items come back unchanged when they have no group.
 *
 * Only for the delegate hub's own views (/schedule, the home clock and tiles),
 * applied on the server to the audience-filtered rows before they are annotated
 * or serialised. Never for the Santo schedule, the admin live schedule or the
 * display API (src/lib/display.ts), which show the general programme.
 */
export function personalizeGoshthi<T extends Pick<ScheduleItem, "title" | "location" | "description">>(
  items: T[],
  guest: GoshthiGuest,
): T[] {
  const g = goshthiFor(guest);
  if (!g) return items;
  const line = g.label;
  return items.map((i) =>
    GOSHTHI_ITEM.test(i.title.trim())
      ? { ...i, location: g.room ?? GOSHTHI_ROOM_TBC, description: i.description ? `${line} · ${i.description}` : line }
      : i,
  );
}

// ---------------------------------------------------------------------------
// Team Breakouts slots, personalised
// ---------------------------------------------------------------------------

/** A breakout session as personalizeBreakouts() reads it: a getBreakoutsForUser() row. */
export type SlotSession = Pick<Breakout, "startsAt" | "endsAt" | "audience" | "title" | "room" | "description">;

/** How many steps (rooms in turn) a slot's location and label name before "+N more". */
const SLOT_STEPS_SHOWN = 3;

/** The rooms of a breakouts.room value, split as the breakouts page splits them ("Niyam · Atma · Gnan"). */
function roomsOf(room: string): string[] {
  return room
    .split(" · ")
    .map((r) => r.trim())
    .filter(Boolean);
}

/**
 * The BREAKOUT item of `items` a session moves with (its index; -1 when none): the
 * latest-starting BREAKOUT item of the session's track or a shared one whose [start, end)
 * holds the session's start. The rule of the schedule engine (breakoutOwners() in
 * src/lib/admin/schedule.ts) and the display API (slotFor() in src/lib/display.ts), read on
 * the live times, so a slot moved from /admin/schedule keeps its sessions (they move with it).
 * On equal starts the first item wins (items come by start, then sort order, like the engine).
 */
function slotIndexOf(
  items: readonly Pick<ScheduleItem, "kind" | "audience" | "startsAt" | "endsAt">[],
  s: Pick<Breakout, "startsAt" | "audience">,
): number {
  const at = s.startsAt.getTime();
  let best = -1;
  items.forEach((i, idx) => {
    if (i.kind !== "BREAKOUT" || !sharesAudience(i.audience, s.audience)) return;
    const start = i.startsAt.getTime();
    if (start <= at && at < i.endsAt.getTime() && (best < 0 || start > items[best].startsAt.getTime())) best = idx;
  });
  return best;
}

/**
 * One step of a slot: where the guest is for a while (several rooms when they meet at once),
 * with the organisers' notes of its sessions (breakouts.description, e.g. SPLIT_NOTE "Split
 * amongst these rooms.") and when it ends.
 */
type SlotStep = { rooms: string[]; titles: string[]; notes: string[]; end: number };

/**
 * A slot's sessions as steps in time order: sessions that overlap in time make one step (a
 * team split amongst rooms, or the several teams an umbrella seva such as "BKSTL" means,
 * meeting at once), a session starting as the previous ones end starts the next.
 */
function stepsOf(sessions: readonly SlotSession[]): SlotStep[] {
  // By start (the steps need it), then title, so the rooms of one step read in team order.
  const sorted = [...sessions].sort(
    (a, b) =>
      a.startsAt.getTime() - b.startsAt.getTime() ||
      a.title.localeCompare(b.title, "en", { numeric: true }) ||
      a.endsAt.getTime() - b.endsAt.getTime(),
  );
  const steps: SlotStep[] = [];
  for (const s of sorted) {
    const rooms = roomsOf(s.room);
    const note = s.description?.trim().replace(/\s+/g, " ") || null;
    const last = steps[steps.length - 1];
    if (!last || s.startsAt.getTime() >= last.end) {
      steps.push({ rooms: [...new Set(rooms)], titles: [s.title], notes: note ? [note] : [], end: s.endsAt.getTime() });
      continue;
    }
    for (const r of rooms) if (!last.rooms.includes(r)) last.rooms.push(r);
    if (!last.titles.includes(s.title)) last.titles.push(s.title);
    if (note && !last.notes.includes(note)) last.notes.push(note);
    last.end = Math.max(last.end, s.endsAt.getTime());
  }
  return steps;
}

/** "A, then B, then C", consecutive repeats collapsed; past SLOT_STEPS_SHOWN: "A, then B, then C +2 more". */
function inTurn(parts: readonly string[]): string {
  const collapsed = parts.filter((p, i) => i === 0 || p !== parts[i - 1]);
  const shown = collapsed.slice(0, SLOT_STEPS_SHOWN).join(", then ");
  const more = collapsed.length - SLOT_STEPS_SHOWN;
  return more > 0 ? `${shown} +${more} more` : shown;
}

/** The steps whose rooms inTurn() names in the location (not those behind "+N more"). */
function namedSteps(steps: readonly SlotStep[]): SlotStep[] {
  let named = 0;
  return steps.filter((st, i) => {
    if (i === 0 || st.rooms.join(" / ") !== steps[i - 1].rooms.join(" / ")) named++;
    return named <= SLOT_STEPS_SHOWN;
  });
}

/**
 * A delegate's own schedule with their team breakouts filled in: each BREAKOUT item ("Team
 * Breakouts") holding any of their `sessions` (getBreakoutsForUser(guest), by the rule of
 * slotIndexOf(), so live moves keep working) takes their rooms as its location and their
 * session title(s) as its description, ahead of any printed description, in the words the
 * breakouts page uses (rooms, titles and notes exactly as the session cards show them):
 *  - one room: "Niyam"; the team moving rooms within the slot: "Niyam, then Main Hall, then
 *    Niyam" (consecutive repeats collapsed; at most three, then "+N more"), with the titles
 *    in the same turn: "BM RA, then BKY RAs, then BM RA";
 *  - several rooms at once: "Niyam / Men's Gym" for a team split amongst rooms, its
 *    note after the titles as the organisers wrote it ("YM RC · Split amongst these rooms."),
 *    or "Upasana / Jodan / Pragati" (titles "BM PC / BM RGC / KM PC") for the teams an umbrella
 *    seva ("BK RPCs & RGCs") means, meeting at once; every room is named. A step of several
 *    teams carries no note: there one team's note (a split) would read as the whole list's,
 *    and the breakouts page shows it on that team's card.
 * While the slot is under way at `now` (pageNow()), the steps already over are left out, so
 * the location starts with where they should be now (or next, between two steps): at 11:40
 * "Main Hall, then Niyam" rather than "Niyam, then Main Hall, then Niyam". Before and after
 * the slot, and once all their steps are over, every step is named. The hub pages re-render
 * each minute (AutoRefresh), so this keeps up.
 * A slot with none of their sessions keeps its printed placeholder ("By team – see Breakout
 * Sessions"), and so does one holding sessions of both tracks (a guest with no gender on file:
 * no one room is theirs; their breakouts page labels each track). Title and kind stay, so the
 * item keeps its icon and its link to the breakouts page. The location is display text ("A,
 * then B"), never a room key: the breakouts page links rooms from the sessions themselves.
 *
 * Same terms as personalizeGoshthi(): only for the delegate hub's own views (/schedule, the
 * home clock and tiles), applied on the server to the audience-filtered rows of a
 * requireGuest() guest (so mirror testers see the mirrored delegate's rooms). Never for the
 * Santo schedule, the admin live schedule or the display API, which show the general programme.
 */
export function personalizeBreakouts<
  T extends Pick<ScheduleItem, "kind" | "audience" | "startsAt" | "endsAt" | "location" | "description">,
>(items: T[], sessions: readonly SlotSession[], now: Date): T[] {
  const bySlot = new Map<number, SlotSession[]>();
  for (const s of sessions) {
    const at = slotIndexOf(items, s);
    if (at >= 0) bySlot.set(at, [...(bySlot.get(at) ?? []), s]);
  }
  if (bySlot.size === 0) return items;
  const t = now.getTime();
  return items.map((item, idx) => {
    const own = bySlot.get(idx);
    if (!own) return item;
    if (new Set(own.map((s) => s.audience).filter((a) => a !== "ALL")).size > 1) return item;
    const steps = stepsOf(own);
    const underWay = item.startsAt.getTime() <= t && t < item.endsAt.getTime();
    const ahead = underWay ? steps.filter((st) => st.end > t) : steps;
    const shown = ahead.length > 0 ? ahead : steps;
    const location = inTurn(shown.map((st) => st.rooms.join(" / ")));
    const notes = [...new Set(namedSteps(shown).filter((st) => st.titles.length === 1).flatMap((st) => st.notes))];
    const line = [inTurn(shown.map((st) => st.titles.join(" / "))), ...notes].join(" · ");
    return { ...item, location, description: item.description ? `${line} · ${item.description}` : line };
  });
}

// ---------------------------------------------------------------------------
// Where a guest comes from to a breakout session ("How to get there")
// ---------------------------------------------------------------------------

/** A breakout session as previousPlaceFor() reads it: a getBreakoutsForUser() row. */
export type PlaceSession = Pick<Breakout, "id" | "startsAt" | "endsAt" | "audience" | "title" | "room">;
/** A schedule item as previousPlaceFor() reads it. */
export type PlaceItem = Pick<ScheduleItem, "title" | "kind" | "audience" | "startsAt" | "endsAt" | "location">;

/**
 * What a guest was at just before a breakout session, and where (previousPlaceFor()):
 *  - "room": a place at the mandir: the location as the schedule or the session gives it (several
 *    rooms joined with " · ", as a split session lists them), with the item's or session's title;
 *    `own` = one of their own breakout sessions;
 *  - "arriving": they come in from outside: nothing earlier that day (their first session), a bus
 *    ride ("Travel to Mandir") or a place away from the mandir ("Akshardham, Robbinsville");
 *  - "unknown": the item before has no room for them: none listed ("Group Photo", a Team
 *    Breakouts slot with none of their sessions), their goshthi room isn't confirmed yet, or
 *    ("tracks") a session both tracks hold, for a guest who sees both (no gender on file), comes
 *    after different places on the Bhaio and the Behno day.
 */
export type PreviousPlace =
  | { kind: "room"; title: string; location: string; own: boolean }
  | { kind: "arriving"; title: string | null; offSite: string | null }
  | { kind: "unknown"; title: string; reason: "no-room" | "tbc" | "tracks" };

/**
 * Where a guest is just before `target` (one of their breakout sessions), for the breakouts page's
 * "How to get there": the latest thing on their day before the session starts, from their other
 * breakout sessions (`sessions`, getBreakoutsForUser(guest)) and their schedule (`items`: their
 * track's schedule_items (forAudience()) with their goshthi room filled in (personalizeGoshthi()),
 * from the requireGuest() object so mirror testers get the mirrored delegate's). Only the same
 * event day (EVENT_TZ) and the session's own track (or shared items) count.
 *  - "Before" = ends at or before the session starts, or (an item run over its time, e.g. extended
 *    from /admin/schedule without moving what follows) a schedule item still running then that
 *    began once everything else before it was over: the guest leaves it for the session. An item
 *    that began earlier (running in the background of others) doesn't count while it runs.
 *  - Never "before": a Team Breakouts slot around the session (or any slot still running then), an
 *    own session still running then (another team of theirs meeting at the same time), and a Team
 *    Breakouts slot holding any of their sessions, which stands aside for those sessions (by the
 *    slot rule of personalizeBreakouts()).
 *  - The latest wins (by end, one still running counting as ending at the session's start); on a
 *    tie their own session wins, then the later start (where they were last), then the schedule's
 *    order. Own sessions ending together in several rooms (the teams an umbrella seva means) come
 *    back as one place with every room, titles in team order.
 *  - A walk between rooms (a TRAVEL item that isn't a ride and has no place: the 15-minute
 *    "Travel" between two sessions) isn't a place: the item before it is.
 *  - A session both tracks hold (audience ALL, merged by getBreakoutsForUser() for a guest with no
 *    gender on file, who has both tracks' sessions and schedule): each track's day is read on its
 *    own; the same place on both is the answer, different places are "unknown" ("tracks"), never
 *    one track's rooms mixed with the other's.
 * Pure: no database, no venue map (the map lookup is src/lib/venue/breakoutDirections.ts).
 */
export function previousPlaceFor(
  target: PlaceSession,
  sessions: readonly PlaceSession[],
  items: readonly PlaceItem[],
): PreviousPlace {
  if (target.audience === "ALL") {
    const tracks = new Set([...sessions, ...items].map((x) => x.audience).filter((a) => a !== "ALL"));
    if (tracks.size > 1) {
      const bhaio = placeBefore(target, "BHAIO", sessions, items);
      const behno = placeBefore(target, "BEHNO", sessions, items);
      return JSON.stringify(bhaio) === JSON.stringify(behno) ? bhaio : { kind: "unknown", title: target.title, reason: "tracks" };
    }
  }
  return placeBefore(target, target.audience, sessions, items);
}

/** A walk between rooms at the mandir (the 15-minute "Travel"): not a place, and not a ride. */
function isWalk(item: PlaceItem): boolean {
  return item.kind === "TRAVEL" && !RIDE_TITLE.test(item.title.trim()) && !item.location?.trim();
}

/** previousPlaceFor() on one track's day (`track`: the target's audience, or one track of a shared session). */
function placeBefore(
  target: PlaceSession,
  track: PlaceSession["audience"],
  sessions: readonly PlaceSession[],
  items: readonly PlaceItem[],
): PreviousPlace {
  const day = dayKey(target.startsAt);
  const at = target.startsAt.getTime();
  const sameDay = (x: { startsAt: Date }) => dayKey(x.startsAt) === day;
  const own = sessions.filter((s) => s.id !== target.id && sharesAudience(s.audience, track) && sameDay(s));
  const held = new Set(own.map((s) => slotIndexOf(items, s)).filter((i) => i >= 0));
  const mine = items.map((i, idx) => ({ i, idx })).filter(({ i, idx }) => !held.has(idx) && sharesAudience(i.audience, track) && sameDay(i));

  type Candidate = { end: number; start: number; seq: number; session: PlaceSession | null; item: PlaceItem | null };
  const candidates: Candidate[] = [];
  for (const s of own) {
    if (s.endsAt.getTime() <= at) candidates.push({ end: s.endsAt.getTime(), start: s.startsAt.getTime(), seq: -1, session: s, item: null });
  }
  for (const { i, idx } of mine) {
    if (i.endsAt.getTime() <= at) candidates.push({ end: i.endsAt.getTime(), start: i.startsAt.getTime(), seq: idx, session: null, item: i });
  }
  // When everything that ended before the session (walks aside) was over: an item still running at
  // its start counts only if it began by then (it ran over), not one running behind the others.
  const settled = Math.max(-Infinity, ...candidates.filter((c) => !(c.item && isWalk(c.item))).map((c) => c.end));
  for (const { i, idx } of mine) {
    const start = i.startsAt.getTime();
    if (i.kind === "BREAKOUT" || start >= at || i.endsAt.getTime() <= at || start < settled) continue;
    candidates.push({ end: at, start, seq: idx, session: null, item: i });
  }
  candidates.sort(
    (a, b) => b.end - a.end || Number(Boolean(b.session)) - Number(Boolean(a.session)) || b.start - a.start || a.seq - b.seq,
  );

  for (const c of candidates) {
    if (c.session) {
      // Every own session ending then (several teams meeting at once), in team order.
      const together = candidates
        .filter((o) => o.session && o.end === c.end)
        .map((o) => o.session!)
        .sort((a, b) => a.title.localeCompare(b.title, "en", { numeric: true }));
      const rooms = [...new Set(together.flatMap((s) => roomsOf(s.room)))];
      const titles = [...new Set(together.map((s) => s.title))];
      return { kind: "room", title: titles.join(" / "), location: rooms.join(" · "), own: true };
    }
    const item = c.item!;
    const title = item.title.trim();
    const location = item.location?.trim().replace(/\s+/g, " ") || null;
    if (isWalk(item)) continue;
    if (item.kind === "TRAVEL" && RIDE_TITLE.test(title)) return { kind: "arriving", title, offSite: null };
    if (item.kind === "BREAKOUT" || !location) return { kind: "unknown", title, reason: "no-room" };
    if (location === GOSHTHI_ROOM_TBC) return { kind: "unknown", title, reason: "tbc" };
    if (OFF_SITE_PLACE.test(location)) return { kind: "arriving", title, offSite: location };
    return { kind: "room", title, location, own: false };
  }
  return { kind: "arriving", title: null, offSite: null };
}

export function annotateBreakouts(sessions: Breakout[], now: Date): BreakoutView[] {
  const t = now.getTime();
  const anyInProgress = sessions.some((s) => s.startsAt.getTime() <= t && t < s.endsAt.getTime());
  let nextMarked = false;
  return sessions.map((s) => {
    const start = s.startsAt.getTime();
    const end = s.endsAt.getTime();
    let status: ItemStatus;
    if (start <= t && t < end) status = "now";
    else if (end <= t) status = "past";
    else if (!anyInProgress && !nextMarked) {
      status = "next";
      nextMarked = true;
    } else status = "upcoming";
    return {
      id: s.id,
      title: s.title,
      description: s.description,
      room: s.room,
      facilitator: s.facilitator,
      audience: s.audience,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      day: dayKey(s.startsAt),
      status,
    };
  });
}
