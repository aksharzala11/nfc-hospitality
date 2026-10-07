/**
 * Data for the admin console home (/admin): head counts and sign-ins, the live
 * programme (what's on, what's next, running late or early), announcements
 * and the schedule audit log.
 *
 * With the console's seva filter (?seva=..., src/lib/admin/sevaFilter.ts) the
 * people counts and the announcements narrow to the picked sevas, and the
 * page adds where those teams are (their breakout now and next). The live
 * programme and the audit log always cover everyone.
 *
 * Server only (Prisma). Every query selects just the columns it needs, and
 * what leaves this module is plain data: ids, ISO strings and labels already
 * formatted in EVENT_TZ through src/lib/time.ts. Never a whole `users` row
 * (it holds test_code).
 */
import type { Audience, NotificationKind, Prisma, ScheduleChangeAction, UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { greetingName } from "@/lib/users";
import { sevaLabel } from "@/lib/teams";
import { describeAudience, fromStored, reaches } from "@/lib/admin/announcements";
import { getFacetGroups } from "@/lib/admin/announcementFacets";
import { expandSevaSelection, sevaFilterLabel, sevaOptionValue } from "@/lib/admin/sevaFilter";
import { getUserSevas } from "@/lib/admin/sevaFilterData";
import { withPeopleColumn } from "@/lib/notificationPeople";
import {
  DAY_LABELS,
  dayKey,
  formatDayShort,
  formatRelative,
  formatTime,
  formatTimeRange,
  minutesBetween,
  parseInEventTz,
} from "@/lib/time";

// ---------------------------------------------------------------------------
// Formatting helpers (pure)
// ---------------------------------------------------------------------------

/** "Day 2 · Fri, Oct 9" on programme days, otherwise just "Wed, Sep 23". */
export function dayTitle(day: string): string {
  const label = DAY_LABELS[day];
  return label ? `${label} · ${formatDayShort(day)}` : formatDayShort(day);
}

/** 15 -> "15 min", 75 -> "1 h 15 min", 120 -> "2 h". The sign is ignored. */
export function formatMinutes(minutes: number): string {
  const n = Math.abs(minutes);
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/**
 * When something happened, the way an organiser reads it: "just now",
 * "12 min ago", "11:32 AM" (earlier today) or "Thu, Oct 8 · 7:05 PM". A future
 * instant (a scheduled announcement) gets its time, or its day and time.
 * Lowercase so it can follow other words ("Last sent just now").
 */
export function whenLabel(at: Date, now: Date): string {
  const ago = minutesBetween(at, now);
  if (ago === 0) return "just now";
  if (ago > 0 && ago < 60) return `${ago} min ago`;
  const time = formatTime(at);
  return dayKey(at) === dayKey(now) ? time : `${formatDayShort(dayKey(at))} · ${time}`;
}

/** Who did something, to follow "by": "you", the admin's greetingName(), or `fallback` when there is no account. */
function byLine(
  user: { name: string; displayName: string | null } | null,
  userId: string | null,
  viewerId: string,
  fallback: string,
): string {
  if (userId && userId === viewerId) return "you";
  return user ? greetingName(user) : fallback;
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export type RoleCounts = Record<UserRole, number>;

export type PeopleSummary = {
  total: number;
  byRole: RoleCounts;
  /** Accounts that have signed in at least once (users.last_sign_in_at is set). */
  signedIn: number;
  /** signedIn as a whole percentage of total, rounded down (100 only when everyone has). */
  signedInPct: number;
};

function peopleSummary(byRole: RoleCounts, signedIn: number): PeopleSummary {
  const total = byRole.DELEGATE + byRole.SANT + byRole.ADMIN;
  return { total, byRole, signedIn, signedInPct: total ? Math.floor((signedIn / total) * 100) : 0 };
}

// ---------------------------------------------------------------------------
// Seva filter
// ---------------------------------------------------------------------------

/** The console's seva filter as the overview applies it (null in AdminOverview = no filter). */
export type SevaScope = {
  /** The picked options (sevaOptionValue() spellings), e.g. ["BM RA", "SA"]. */
  sevas: string[];
  /** For captions after "for": "BM RA", "BM RA, SA", "BM RA, SA, CE" or "BM RA, SA +3 more". */
  label: string;
  /** For the narrow KPI captions: the one pick by name ("BM RA"), otherwise how many ("3 sevas"). */
  short: string;
};

/** Up to three sevas by name, otherwise the first two and how many more (sevaFilterLabel(), as every console view). */
export function scopeLabel(sevas: readonly string[]): string {
  return sevaFilterLabel(sevas);
}

/** One pick by name, otherwise the count: "BM RA", "2 sevas". */
export function scopeShort(sevas: readonly string[]): string {
  return sevas.length === 1 ? sevas[0] : `${sevas.length} sevas`;
}

/** "this seva" for one pick, "these sevas" for more: copy that refers back to the filter. */
export function scopeNoun(scope: Pick<SevaScope, "sevas">): string {
  return scope.sevas.length === 1 ? "this seva" : "these sevas";
}

// ---------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------

/**
 * Who an announcement goes to, in the announcements page's words (compact form):
 * "Everyone", "Behno", "Santos · Hospitality", "Bhaio · 3 sevas". Passing `kind`
 * matters: a Menu notice with no roles reads "Delegates & Admins", not "Everyone".
 * A personal announcement reads "3 specific people" (never their names here).
 */
export function audienceLabel(n: {
  kind?: NotificationKind;
  audience: Audience;
  roles: UserRole[];
  sevas: string[];
  regions: string[];
  hotels: string[];
  userIds?: string[];
}): string {
  return describeAudience(n, { maxItems: 1 });
}

const ANNOUNCEMENT_SELECT = {
  id: true,
  kind: true,
  title: true,
  audience: true,
  roles: true,
  sevas: true,
  regions: true,
  createdAt: true,
  createdById: true,
  createdBy: { select: { name: true, displayName: true } },
} satisfies Prisma.NotificationSelect;

/** With the accounts a personal announcement lists (a column an unpushed database doesn't have yet). */
const ANNOUNCEMENT_SELECT_PEOPLE = { ...ANNOUNCEMENT_SELECT, userIds: true } satisfies Prisma.NotificationSelect;

/** A row as the rule reads it: its hotels out of `regions` (fromStored()). */
type AnnouncementRecord = ReturnType<
  typeof fromStored<Prisma.NotificationGetPayload<{ select: typeof ANNOUNCEMENT_SELECT_PEOPLE }>>
>;

/**
 * Announcements for the overview, their hotels taken out of `regions`. On a
 * database without notifications.user_ids yet the column isn't read and every
 * row is an ordinary one (withPeopleColumn()).
 */
function findAnnouncements(
  args: Pick<Prisma.NotificationFindManyArgs, "where" | "orderBy" | "take">,
): Promise<AnnouncementRecord[]> {
  return withPeopleColumn(async (people): Promise<AnnouncementRecord[]> => {
    if (people) {
      return (await prisma.notification.findMany({ ...args, select: ANNOUNCEMENT_SELECT_PEOPLE })).map(fromStored);
    }
    const rows = await prisma.notification.findMany({ ...args, select: ANNOUNCEMENT_SELECT });
    return rows.map((r) => fromStored({ ...r, userIds: [] }));
  });
}

export type AnnouncementRow = {
  id: string;
  kind: NotificationKind;
  title: string;
  /** Follows "by": "you", the sender's name, or "the organisers" for `npm run notify` rows. */
  sender: string;
  /** Publish time, e.g. "12 min ago" or "Fri, Oct 9 · 5:00 PM". */
  when: string;
  /** Publish time still ahead, so no bell shows it yet. */
  scheduled: boolean;
  /** See audienceLabel(). */
  audience: string;
};

export type AnnouncementSummary = {
  /** Published today (EVENT_TZ) up to now. */
  today: number;
  /** Publish time still ahead. */
  scheduled: number;
  /** When the latest published one went out, or null if none has. */
  lastSent: string | null;
  /** Up to five: the next scheduled ones (soonest first), then the latest published. */
  recent: AnnouncementRow[];
};

function toAnnouncementRow(n: AnnouncementRecord, now: Date, viewerId: string): AnnouncementRow {
  return {
    id: n.id,
    kind: n.kind,
    title: n.title,
    sender: byLine(n.createdBy, n.createdById, viewerId, "the organisers"),
    when: whenLabel(n.createdAt, now),
    scheduled: n.createdAt.getTime() > now.getTime(),
    audience: audienceLabel(n),
  };
}

/**
 * The summary from the counts and rows: `upcoming` soonest first (the first
 * two are listed), `published` newest first.
 */
function announcementSummary(
  a: { today: number; scheduled: number; upcoming: AnnouncementRecord[]; published: AnnouncementRecord[] },
  now: Date,
  viewerId: string,
): AnnouncementSummary {
  return {
    today: a.today,
    scheduled: a.scheduled,
    lastSent: a.published[0] ? whenLabel(a.published[0].createdAt, now) : null,
    recent: [...a.upcoming.slice(0, 2), ...a.published]
      .slice(0, 5)
      .map((n) => toAnnouncementRow(n, now, viewerId)),
  };
}

// ---------------------------------------------------------------------------
// Schedule audit log
// ---------------------------------------------------------------------------

const CHANGE_SELECT = {
  id: true,
  action: true,
  day: true,
  summary: true,
  createdAt: true,
  undoneAt: true,
  userId: true,
  user: { select: { name: true, displayName: true } },
} satisfies Prisma.ScheduleChangeSelect;

export type ChangeRow = {
  id: string;
  action: ScheduleChangeAction;
  /** e.g. "Keynote Program 2 + 6 later items: +15 min". */
  summary: string;
  /** Follows "by": "you" or the admin's name. */
  by: string;
  when: string;
  /** Programme day it changed, e.g. "Day 2 · Fri, Oct 9". */
  day: string;
  undone: boolean;
};

// ---------------------------------------------------------------------------
// Live programme
// ---------------------------------------------------------------------------

const ITEM_SELECT = {
  id: true,
  title: true,
  location: true,
  audience: true,
  startsAt: true,
  endsAt: true,
  originalStartsAt: true,
  originalEndsAt: true,
} satisfies Prisma.ScheduleItemSelect;

type ItemRecord = Prisma.ScheduleItemGetPayload<{ select: typeof ITEM_SELECT }>;

/** The two gender tracks. ALL items belong to both. */
export type Track = "BHAIO" | "BEHNO";
const TRACKS: Track[] = ["BHAIO", "BEHNO"];

function onTrack(item: { audience: Audience }, track: Track) {
  return item.audience === "ALL" || item.audience === track;
}

/** A schedule item or breakout with its printed times (null = never moved). */
type Timed = { startsAt: Date; endsAt: Date; originalStartsAt: Date | null; originalEndsAt: Date | null };

/** Minutes the start moved from the printed time (+ later, − earlier); 0 if never moved. */
function startShift(i: Timed) {
  return i.originalStartsAt ? minutesBetween(i.originalStartsAt, i.startsAt) : 0;
}

/** Minutes the end moved from the printed time (+ later, − earlier); 0 if never moved. */
function endShift(i: Timed) {
  return i.originalEndsAt ? minutesBetween(i.originalEndsAt, i.endsAt) : 0;
}

function byStart(a: ItemRecord, b: ItemRecord) {
  return a.startsAt.getTime() - b.startsAt.getTime() || a.audience.localeCompare(b.audience);
}

export type LiveItem = {
  id: string;
  title: string;
  location: string | null;
  audience: Audience;
  /** "5:30 PM – 7:00 PM", with the day in front when it isn't today. */
  time: string;
  /** "until 7:00 PM" for an item in progress, "in 25 min" for one coming up. */
  relative: string;
  /** Minutes the start / end moved from the printed schedule (+ later). */
  startShift: number;
  endShift: number;
  /** The printed times when the item has moved, e.g. "5:15 PM – 6:45 PM". */
  printed: string | null;
};

/** How far one track (or the whole programme) is off the printed schedule right now. */
export type Drift = {
  /** null: both tracks agree, so this is the whole programme. */
  track: Track | null;
  /** Minutes behind (+) or ahead (−) of the printed schedule. */
  minutes: number;
  /** First item of the current run of moved items, e.g. "Keynote Program 2". */
  since: string | null;
  /** Whether `since` has started ("since Keynote Program 2" vs "from Keynote Program 2"). */
  sinceStarted: boolean;
};

/** Today's programme against the printed schedule. */
export type ScheduleStatus =
  /** Nothing scheduled today: "Starts in 15 days", "Concluded", "No programme today". */
  | { state: "idle"; note: string }
  /** Every item today has ended. */
  | { state: "done"; moved: number; total: number }
  | {
      state: "running";
      /** One entry for the whole programme, or one per track when they differ. */
      drifts: Drift[];
      /** Items today whose times differ from the printed schedule. */
      moved: number;
      total: number;
      /** The next moved item today that hasn't started, e.g. a delay already entered for later. */
      nextMove: { title: string; minutes: number; time: string; printed: string } | null;
    };

export type ProgrammeView = {
  /** Where the event as a whole stands. */
  phase: "empty" | "before" | "during" | "after";
  /** "in 15 days" until the first item starts (phase "before"), else null. */
  startsIn: string | null;
  status: ScheduleStatus;
  /** Everything in progress, all tracks. */
  now: LiveItem[];
  /** The next item for each track; a single row when both tracks share it. */
  next: LiveItem[];
};

/** The drift with the largest magnitude (ties keep the first). */
export function worstDrift(drifts: Drift[]): Drift {
  return drifts.reduce((worst, d) => (Math.abs(d.minutes) > Math.abs(worst.minutes) ? d : worst));
}

/** "Running 15 min late since Keynote Program 2", "Running 10 min early", "On time". */
export function driftSentence(d: Drift): string {
  if (d.minutes === 0) return "On time";
  const base = `Running ${formatMinutes(d.minutes)} ${d.minutes > 0 ? "late" : "early"}`;
  return d.since ? `${base} ${d.sinceStarted ? "since" : "from"} ${d.since}` : base;
}

function toLiveItem(i: ItemRecord, now: Date, mode: "now" | "next"): LiveItem {
  const range = formatTimeRange(i.startsAt, i.endsAt);
  const day = dayKey(i.startsAt);
  const s = startShift(i);
  const e = endShift(i);
  return {
    id: i.id,
    title: i.title,
    location: i.location,
    audience: i.audience,
    time: day === dayKey(now) ? range : `${formatDayShort(day)} · ${range}`,
    relative: mode === "now" ? `until ${formatTime(i.endsAt)}` : formatRelative(now, i.startsAt),
    startShift: s,
    endShift: e,
    printed: s || e ? formatTimeRange(i.originalStartsAt ?? i.startsAt, i.originalEndsAt ?? i.endsAt) : null,
  };
}

/**
 * One track's drift. The reference is the item in progress (how late it will
 * end) or, between items, the next one (how late it will start). "Since" walks
 * back over the earlier items that are off by the same amount, so a delay
 * entered as "Keynote Program 2 and everything after it +15 min" reads
 * "since Keynote Program 2" for the rest of the day.
 */
function trackDrift(list: ItemRecord[], t: number): Omit<Drift, "track"> {
  const onTime = { minutes: 0, since: null, sinceStarted: false };
  let ref = -1;
  for (let k = list.length - 1; k >= 0; k--) {
    if (list[k].startsAt.getTime() <= t && t < list[k].endsAt.getTime()) {
      ref = k;
      break;
    }
  }
  let minutes: number;
  if (ref >= 0) minutes = endShift(list[ref]);
  else {
    ref = list.findIndex((i) => i.startsAt.getTime() > t);
    if (ref < 0) return onTime;
    minutes = startShift(list[ref]);
  }
  if (minutes === 0) return onTime;

  let from = ref;
  while (from > 0 && endShift(list[from - 1]) === minutes) from--;
  const since = list[from];
  return { minutes, since: since.title, sinceStarted: since.startsAt.getTime() <= t };
}

function scheduleStatus(items: ItemRecord[], now: Date, phase: ProgrammeView["phase"], startsIn: string | null): ScheduleStatus {
  const t = now.getTime();
  const today = dayKey(now);
  const dayItems = items.filter((i) => dayKey(i.startsAt) === today);
  if (dayItems.length === 0) {
    const note =
      phase === "before" && startsIn
        ? `Starts ${startsIn}`
        : phase === "after"
          ? "Concluded"
          : phase === "empty"
            ? "No schedule yet"
            : "No programme today";
    return { state: "idle", note };
  }

  const moved = dayItems.filter((i) => startShift(i) !== 0 || endShift(i) !== 0).length;
  const total = dayItems.length;
  if (dayItems.every((i) => i.endsAt.getTime() <= t)) return { state: "done", moved, total };

  const perTrack = TRACKS.map((track) => ({ track, ...trackDrift(dayItems.filter((i) => onTrack(i, track)), t) }));
  const [a, b] = perTrack;
  const drifts: Drift[] =
    a.minutes === b.minutes && a.since === b.since ? [{ ...a, track: null }] : perTrack;

  const upcoming = dayItems.find((i) => i.startsAt.getTime() > t && startShift(i) !== 0);
  const nextMove =
    upcoming && upcoming.originalStartsAt
      ? {
          title: upcoming.title,
          minutes: startShift(upcoming),
          time: formatTime(upcoming.startsAt),
          printed: formatTime(upcoming.originalStartsAt),
        }
      : null;

  return { state: "running", drifts, moved, total, nextMove };
}

/** Pure: the live-programme view of `items` (all tracks, in start order) at `now`. */
export function buildProgramme(items: ItemRecord[], now: Date): ProgrammeView {
  const t = now.getTime();
  const first = items[0];
  const lastEnd = items.reduce((max, i) => Math.max(max, i.endsAt.getTime()), 0);
  const phase: ProgrammeView["phase"] = !first
    ? "empty"
    : t < first.startsAt.getTime()
      ? "before"
      : t >= lastEnd
        ? "after"
        : "during";
  const startsIn = phase === "before" ? formatRelative(now, first.startsAt) : null;

  const current = items.filter((i) => i.startsAt.getTime() <= t && t < i.endsAt.getTime()).sort(byStart);
  const upNext = new Map<string, ItemRecord>();
  for (const track of TRACKS) {
    const n = items.find((i) => onTrack(i, track) && i.startsAt.getTime() > t);
    if (n) upNext.set(n.id, n);
  }

  return {
    phase,
    startsIn,
    status: scheduleStatus(items, now, phase, startsIn),
    now: current.map((i) => toLiveItem(i, now, "now")),
    next: [...upNext.values()].sort(byStart).map((i) => toLiveItem(i, now, "next")),
  };
}

// ---------------------------------------------------------------------------
// Where the filtered teams are (their breakouts)
// ---------------------------------------------------------------------------

const BREAKOUT_SELECT = {
  id: true,
  seva: true,
  audience: true,
  title: true,
  description: true,
  room: true,
  startsAt: true,
  endsAt: true,
  originalStartsAt: true,
  originalEndsAt: true,
} satisfies Prisma.BreakoutSelect;

type BreakoutRecord = Prisma.BreakoutGetPayload<{ select: typeof BREAKOUT_SELECT }>;

/** One breakout session of a team, as the overview shows it. */
export type BreakoutSlot = {
  id: string;
  title: string;
  /** One room, or several joined with " · ". */
  room: string;
  /** The session's note, e.g. "Split amongst these rooms."; null if none. */
  note: string | null;
  /** "11:00 AM – 11:30 AM", with the day in front when it isn't today. */
  time: string;
  /** "until 11:30 AM" for a session in progress, "in 25 min" for one coming up. */
  relative: string;
  /** Minutes the start / end moved from the printed times (+ later), as on LiveItem. */
  startShift: number;
  endShift: number;
  /** The printed times when the session has moved, e.g. "11:00 AM – 11:30 AM". */
  printed: string | null;
};

/**
 * Where a team stands at `now`:
 *   now        a session is in progress
 *   between    nothing now, another later today   ("No breakout now")
 *   doneToday  today's are over, more on a later day ("Done for today")
 *   notToday   none today, more on a later day      ("No breakouts today")
 *   complete   every session is over
 */
export type TeamState = "now" | "between" | "doneToday" | "notToday" | "complete";

/** One team on one track: its breakout now and its next one. */
export type TeamWhereabouts = {
  key: string;
  /** The team as breakouts.seva names it (without an e/i track prefix), e.g. "BM RA". */
  team: string;
  track: Audience;
  /**
   * Picked sevas this team is shown for when it isn't picked itself, e.g.
   * ["BM PC"] for "BK RPCs & RGCs" (the Bhaio side of the same team). Empty
   * when the team itself is picked.
   */
  via: string[];
  state: TeamState;
  /** In progress: normally one session. */
  now: BreakoutSlot[];
  /** The next session to start, today or on a later day. */
  next: BreakoutSlot | null;
};

export type Whereabouts = {
  /** By team name, then Bhaio, Behno, All. */
  teams: TeamWhereabouts[];
  /** Picked sevas no breakout session is for (e.g. "Hospitality"). */
  noSessions: string[];
};

const TRACK_ORDER: Record<Audience, number> = { BHAIO: 0, BEHNO: 1, ALL: 2 };
const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

function toSlot(b: BreakoutRecord, now: Date, mode: "now" | "next"): BreakoutSlot {
  const range = formatTimeRange(b.startsAt, b.endsAt);
  const day = dayKey(b.startsAt);
  const s = startShift(b);
  const e = endShift(b);
  return {
    id: b.id,
    title: b.title,
    room: b.room,
    note: b.description,
    time: day === dayKey(now) ? range : `${formatDayShort(day)} · ${range}`,
    relative: mode === "now" ? `until ${formatTime(b.endsAt)}` : formatRelative(now, b.startsAt),
    startShift: s,
    endShift: e,
    printed: s || e ? formatTimeRange(b.originalStartsAt ?? b.startsAt, b.originalEndsAt ?? b.endsAt) : null,
  };
}

/**
 * Pure: per team (breakouts.seva) and track, the session in progress at `now`
 * and the next one. `rows` are the breakouts of the picked sevas, in start
 * order; `codesByPick` maps each picked option to the breakouts.seva values
 * it covers (expandSevaSelection() of that option alone).
 */
export function buildWhereabouts(
  rows: readonly BreakoutRecord[],
  now: Date,
  picked: readonly string[],
  codesByPick: ReadonlyMap<string, readonly string[]>,
): Whereabouts {
  const t = now.getTime();
  const today = dayKey(now);

  const groups = new Map<string, BreakoutRecord[]>();
  for (const b of rows) {
    const key = `${b.seva ?? ""}\n${b.audience}`;
    const list = groups.get(key);
    if (list) list.push(b);
    else groups.set(key, [b]);
  }

  const pickedSet = new Set(picked);
  const teams: TeamWhereabouts[] = [];
  for (const [key, list] of groups) {
    const seva = list[0].seva ?? "";
    const current = list.filter((b) => b.startsAt.getTime() <= t && t < b.endsAt.getTime());
    const next = list.find((b) => b.startsAt.getTime() > t) ?? null;
    const state: TeamState =
      current.length > 0
        ? "now"
        : !next
          ? "complete"
          : dayKey(next.startsAt) === today
            ? "between"
            : list.some((b) => dayKey(b.startsAt) === today && b.endsAt.getTime() <= t)
              ? "doneToday"
              : "notToday";
    teams.push({
      key,
      team: sevaLabel(seva) || seva,
      track: list[0].audience,
      via: pickedSet.has(sevaOptionValue(seva)) ? [] : picked.filter((p) => codesByPick.get(p)?.includes(seva)),
      state,
      now: current.map((b) => toSlot(b, now, "now")),
      next: next ? toSlot(next, now, "next") : null,
    });
  }
  teams.sort((a, b) => collator.compare(a.team, b.team) || TRACK_ORDER[a.track] - TRACK_ORDER[b.track]);

  const withRows = new Set(rows.map((b) => b.seva ?? ""));
  const noSessions = picked.filter((p) => !(codesByPick.get(p) ?? []).some((code) => withRows.has(code)));
  return { teams, noSessions };
}

// ---------------------------------------------------------------------------
// Everything for the overview
// ---------------------------------------------------------------------------

export type AdminOverview = {
  /** Everyone, or only the picked sevas (see `scope`). */
  people: PeopleSummary;
  /** Everything, or only announcements that reach someone with a picked seva. */
  announcements: AnnouncementSummary;
  /** Latest five live schedule edits, newest first (undone ones included). Never filtered. */
  changes: ChangeRow[];
  /** Never filtered: the programme is the same for every seva. */
  programme: ProgrammeView;
  /** The seva filter applied, or null (no filter: everything as without one). */
  scope: SevaScope | null;
  /** With a filter: where the picked teams are. Null without one. */
  whereabouts: Whereabouts | null;
};

type Scoped = Pick<AdminOverview, "people" | "announcements" | "scope" | "whereabouts">;

/** People and announcements for everyone (no seva filter). */
async function forEveryone(now: Date, viewerId: string): Promise<Scoped> {
  const startOfToday = parseInEventTz(dayKey(now)) ?? now;

  const [roleRows, signedIn, sentToday, scheduledCount, upcoming, published] = await Promise.all([
    prisma.user.groupBy({ by: ["role"], _count: { _all: true } }),
    prisma.user.count({ where: { lastSignInAt: { not: null } } }),
    prisma.notification.count({ where: { createdAt: { gte: startOfToday, lte: now } } }),
    prisma.notification.count({ where: { createdAt: { gt: now } } }),
    findAnnouncements({ where: { createdAt: { gt: now } }, orderBy: { createdAt: "asc" }, take: 2 }),
    findAnnouncements({ where: { createdAt: { lte: now } }, orderBy: { createdAt: "desc" }, take: 5 }),
  ]);

  const byRole: RoleCounts = { DELEGATE: 0, SANT: 0, ADMIN: 0 };
  for (const row of roleRows) byRole[row.role] = row._count._all;

  return {
    people: peopleSummary(byRole, signedIn),
    announcements: announcementSummary(
      { today: sentToday, scheduled: scheduledCount, upcoming, published },
      now,
      viewerId,
    ),
    scope: null,
    whereabouts: null,
  };
}

/**
 * People, announcements and breakouts for the picked sevas. `sevas` is the
 * filter as read from the URL (readSevaFilter()), `picked` the same folded
 * into option values (non-empty).
 *
 * People are the accounts of every role whose users.seva folds into a picked
 * option (expandSevaSelection().userSevas). An announcement counts when it
 * reaches at least one of them, by the bell's own rule (reaches() over their
 * anonymous role / gender / seva / region / hotel groups; a personal announcement when
 * it lists one of them). Breakouts are the rows for
 * the teams those sevas mean (expandSevaSelection().teamCodes), matched by seva
 * as getBreakoutsForUser() does; sessions linked to individual people through
 * users.breakout_sessions are not looked at.
 */
async function forSevas(now: Date, viewerId: string, sevas: readonly string[], picked: string[]): Promise<Scoped> {
  const startOfToday = parseInEventTz(dayKey(now)) ?? now;
  const everySeva = await getUserSevas();
  const { userSevas, teamCodes } = expandSevaSelection(sevas, everySeva);

  const [groups, signedIn, notices, breakouts] = await Promise.all([
    getFacetGroups({ seva: { in: userSevas } }),
    prisma.user.count({ where: { seva: { in: userSevas }, lastSignInAt: { not: null } } }),
    // Every announcement: which ones reach these people is decided below, by reaches().
    findAnnouncements({ orderBy: [{ createdAt: "desc" }, { id: "desc" }] }),
    prisma.breakout.findMany({
      where: { seva: { in: teamCodes } },
      orderBy: [{ startsAt: "asc" }, { endsAt: "asc" }, { title: "asc" }],
      select: BREAKOUT_SELECT,
    }),
  ]);

  const byRole: RoleCounts = { DELEGATE: 0, SANT: 0, ADMIN: 0 };
  for (const g of groups) byRole[g.role] += g.count;

  // The people personal announcements list who have one of these sevas (the groups are anonymous).
  const listedIds = [...new Set(notices.flatMap((n) => n.userIds))];
  const listedInScope = new Set(
    listedIds.length > 0
      ? (
          await prisma.user.findMany({
            where: { id: { in: listedIds }, seva: { in: userSevas } },
            select: { id: true },
          })
        ).map((u) => u.id)
      : [],
  );

  const t = now.getTime();
  const reaching = notices.filter((n) =>
    n.userIds.length > 0 ? n.userIds.some((id) => listedInScope.has(id)) : groups.some((g) => reaches(n, g)),
  );
  const published = reaching.filter((n) => n.createdAt.getTime() <= t);
  const upcoming = reaching.filter((n) => n.createdAt.getTime() > t).reverse();
  const today = published.filter((n) => n.createdAt.getTime() >= startOfToday.getTime()).length;

  const codesByPick = new Map(picked.map((p) => [p, expandSevaSelection([p], everySeva).teamCodes]));

  return {
    people: peopleSummary(byRole, signedIn),
    announcements: announcementSummary({ today, scheduled: upcoming.length, upcoming, published }, now, viewerId),
    scope: { sevas: picked, label: scopeLabel(picked), short: scopeShort(picked) },
    whereabouts: buildWhereabouts(breakouts, now, picked, codesByPick),
  };
}

/**
 * Everything /admin shows, for `now` (which may be a ?now= preview).
 * `viewerId` is the signed-in admin, so their own actions read "by you".
 * `sevas` is the console's seva filter (readSevaFilter() of the page's
 * params); none = everything, exactly as without the filter.
 */
export async function getAdminOverview(
  now: Date,
  viewerId: string,
  sevas: readonly string[] = [],
): Promise<AdminOverview> {
  const picked = [...new Set(sevas.map(sevaOptionValue).filter(Boolean))];

  const [scoped, changes, items] = await Promise.all([
    picked.length > 0 ? forSevas(now, viewerId, sevas, picked) : forEveryone(now, viewerId),
    prisma.scheduleChange.findMany({ orderBy: { createdAt: "desc" }, take: 5, select: CHANGE_SELECT }),
    prisma.scheduleItem.findMany({ orderBy: [{ startsAt: "asc" }, { sortOrder: "asc" }], select: ITEM_SELECT }),
  ]);

  return {
    ...scoped,
    changes: changes.map((c) => ({
      id: c.id,
      action: c.action,
      summary: c.summary,
      by: byLine(c.user, c.userId, viewerId, "a removed account"),
      when: whenLabel(c.createdAt, now),
      day: dayTitle(c.day),
      undone: c.undoneAt !== null,
    })),
    programme: buildProgramme(items, now),
  };
}
