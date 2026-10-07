/**
 * The display API (docs/DISPLAY_API.md): read-only JSON for the TV screens around the
 * mandir during the event, under /api/display/ (schedule, menu, breakouts, now). The route
 * handlers stay thin; everything they share lives here: the shared-key check, CORS and
 * no-store headers, query parsing, and the serialisers behind the exported response types.
 *
 * It reads the same rows through the same rules as the delegate hub, never a copy of them:
 *  - schedule: `schedule_items` via getScheduleItems() + annotateSchedule() (never the Santo
 *    general schedule), with the live moves from /admin/schedule as delay minutes;
 *  - menu: the DELEGATE menu via getMeals() + annotateMeals(), so the reveal rule
 *    (revealTime(), MENU_REVEAL_ALL) is the app's: a meal not yet revealed has no dishes;
 *  - breakouts: the real team breakouts only (the "bk-" rows prisma/breakouts.ts syncs, never
 *    mock or Santo sample rows), one entry per session per track (never "joint"), teams named
 *    through sevaLabel(), grouped under the "Team Breakouts" slot they move with; read and
 *    folded by src/lib/breakoutSessions.ts, which the Pujya Santo breakouts share.
 *
 * No personal data, ever: no users, codes, names, emails, phones, rooming, transport or
 * notifications, and no breakout facilitator or headcount. Keys are never logged.
 *
 * Auth: DISPLAY_API_KEYS (comma-separated shared secrets). Unset or empty = the API is off
 * (404). A key comes as `Authorization: Bearer <key>` or `?key=<key>` (a TV browser may
 * only manage a URL) and is compared in constant time.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { MenuFor, type Audience, type Meal, type ScheduleKind } from "@prisma/client";
import {
  annotateMeals,
  annotateSchedule,
  getMeals,
  getScheduleItems,
  menuRevealAll,
  type ItemStatus,
  type MealStatus,
  type MealView,
  type ScheduleItemView,
} from "@/lib/schedule";
import { pageNow } from "@/lib/pageNow";
import {
  EVENT_DAYS,
  EVENT_TZ,
  dayLabel,
  dayKey,
  formatDayShort,
  formatTime,
  formatTimeRange,
  parseInEventTz,
  timeTravelAllowed,
} from "@/lib/time";
import { offsetFromPrinted, type TimedRow } from "@/lib/admin/schedule";
import { breakoutsInSlot } from "@/lib/admin/scheduleTeams";
import {
  TRACK_ORDER,
  foldSessions,
  getTeamBreakoutRows,
  sessionCollator as collator,
  type BreakoutSession as Session,
} from "@/lib/breakoutSessions";

// ---------------------------------------------------------------------------
// Response types (stable: the other developer builds against these)
// ---------------------------------------------------------------------------

/** A gender track as the API names it. Bhaio = gents, Behno = ladies. */
export type DisplayTrackName = "bhaio" | "behno";
/** The `track` query parameter: one track, or both (the default). */
export type DisplayTrack = DisplayTrackName | "all";

/** Every response starts with these. */
export type DisplayMeta = {
  /** The server's clock when the response was built, ISO 8601 UTC. */
  generatedAt: string;
  /** The moment the response describes (statuses, reveals), ISO 8601 UTC. Exactly generatedAt (one clock read) unless timeTravel. */
  now: string;
  /** True when `?now=` moved "now" (only honoured where ALLOW_TIME_TRAVEL=true, never in production). */
  timeTravel: boolean;
  /** IANA zone of every label and `day` ("America/New_York"). */
  timeZone: string;
  /** YYYY-MM-DD of `now` in timeZone. */
  today: string;
  /** `today` when it is an event day (Oct 8–11), else null. */
  eventDay: string | null;
};

/** When something happens: UTC instants plus the Eastern labels the app shows. */
export type DisplayTimes = {
  /** YYYY-MM-DD (Eastern) of the start. */
  day: string;
  /** "Arrival", "Day 2", "Day 3", "Departure" (the printed schedule's names), else "Wed, Oct 7". */
  dayLabel: string;
  /** "Fri, Oct 9". */
  dayTitle: string;
  /** ISO 8601 UTC. */
  startsAt: string;
  endsAt: string;
  /** "9:15 AM" (Eastern). */
  startLabel: string;
  endLabel: string;
  /** "9:15 AM – 10:45 AM" (en dash). */
  timeLabel: string;
};

/** How far the organisers moved it from the printed schedule (/admin/schedule). */
export type DisplayShift = {
  /** Minutes the start moved: + later, − earlier, 0 on its printed time. */
  delayMinutes: number;
  /** Minutes the end moved, the same way. */
  endDelayMinutes: number;
  /** The app's badge: "Delayed 15 min", "Earlier by 10 min", "Ends 10 min later", "Ends 5 min early"; null when on time. */
  changeLabel: string | null;
  /** The printed times when it has moved, else null. */
  original: Pick<DisplayTimes, "startsAt" | "endsAt" | "startLabel" | "endLabel" | "timeLabel"> | null;
};

/**
 * past, now (in progress), next, upcoming. On the schedule, "next" is the first item to
 * start and only while nothing is in progress (as the app shows it). On breakouts it is
 * every session, and every slot, starting at the earliest upcoming start on its track, even
 * while others run: a slot for both tracks counts on each track it holds sessions for, so
 * `track=bhaio` or `behno` has one next slot time, and `track=all` one per track.
 */
export type DisplayStatus = ItemStatus;

export type DisplayScheduleItem = DisplayTimes &
  DisplayShift & {
    id: string;
    title: string;
    kind: ScheduleKind;
    /** ALL (both tracks), BHAIO or BEHNO. */
    audience: Audience;
    /** The tracks it is on: both for ALL. */
    tracks: DisplayTrackName[];
    location: string | null;
    description: string | null;
    status: DisplayStatus;
  };

export type DisplayDish = {
  name: string;
  description: string | null;
  /** The organisers' own notes from the menu ("Contains almonds", "Vegan", "Tentative"), as given. */
  tags: string[];
};

export type DisplayMeal = DisplayTimes &
  DisplayShift & {
    id: string;
    name: string;
    note: string | null;
    location: string | null;
    /** locked (not revealed yet: no dishes), revealed, served (over; dishes still listed). */
    status: MealStatus;
    /** status !== "locked". */
    revealed: boolean;
    /** When the menu is revealed, ISO 8601 UTC, and as "11:30 AM". */
    revealsAt: string;
    revealLabel: string;
    /** By course, in menu order. Empty while locked. */
    courses: { course: string; dishes: DisplayDish[] }[];
  };

export type DisplayBreakoutSession = DisplayTimes &
  DisplayShift & {
    /** Stable while the organisers' matrix entry keeps its track, day, start and teams. */
    id: string;
    /** BHAIO or BEHNO: a session held for both tracks is one entry per track. */
    audience: Audience;
    tracks: DisplayTrackName[];
    /** As the app shows it, e.g. "BKY RAs", "SA + BK RPCs & RGCs". */
    title: string;
    /** The teams meeting, as the app names them, in matrix order, e.g. ["BM RA", "KM RA", "YM RA"]. */
    teams: string[];
    /** Every room; several when the team is split amongst them. */
    rooms: string[];
    /** rooms joined with " · ". */
    room: string;
    /** The organisers' note, e.g. "Split amongst these rooms."; null if none. */
    note: string | null;
    /** More than one room. */
    split: boolean;
    status: DisplayStatus;
  };

/** A "Team Breakouts" block of the schedule and the sessions held in it. */
export type DisplayBreakoutSlot = DisplayTimes &
  DisplayShift & {
    /** The schedule item's id, or "unscheduled-<day>-<track>" for sessions outside every slot. */
    id: string;
    scheduleItemId: string | null;
    title: string;
    location: string | null;
    audience: Audience;
    tracks: DisplayTrackName[];
    /** Board status: "next" when it is the next slot on the requested track (on either track for track=all). */
    status: DisplayStatus;
    /** By start, end, track (Bhaio first), title. */
    sessions: DisplayBreakoutSession[];
  };

export type DisplayBreakoutDay = {
  day: string;
  dayLabel: string;
  dayTitle: string;
  slots: DisplayBreakoutSlot[];
};

export type DisplayScheduleResponse = DisplayMeta & {
  /** The day shown (YYYY-MM-DD), or null for every day. */
  day: string | null;
  track: DisplayTrack;
  /** In time order. */
  items: DisplayScheduleItem[];
};

export type DisplayMenuResponse = DisplayMeta & {
  day: string | null;
  /** MENU_REVEAL_ALL is on (content audit): every menu shows. Off during the event. */
  revealAll: boolean;
  /** In time order. */
  meals: DisplayMeal[];
};

export type DisplayBreakoutsResponse = DisplayMeta & {
  day: string | null;
  track: DisplayTrack;
  /** Days with at least one session, in date order. */
  days: DisplayBreakoutDay[];
};

export type DisplayTrackNow = {
  schedule: {
    /** In progress (usually one item; several when items overlap). */
    now: DisplayScheduleItem[];
    /** The next item to start, even while something is in progress; null after the last. */
    next: DisplayScheduleItem | null;
  };
  breakouts: {
    /** Sessions in progress. */
    now: DisplayBreakoutSession[];
    /** Every session at the next breakout start time (possibly on a later day). */
    next: DisplayBreakoutSession[];
  };
};

export type DisplayNowResponse = DisplayMeta & {
  /** "Day 2" on an event day, else null. */
  dayLabel: string | null;
  tracks: Record<DisplayTrackName, DisplayTrackNow>;
  /** The delegate meal in progress and the next one; dishes only once revealed. */
  meal: { now: DisplayMeal | null; next: DisplayMeal | null };
};

/** GET /api/display: what the base URL offers, so a first request there isn't a bare 404. */
export type DisplayIndexResponse = DisplayMeta & {
  endpoints: { path: string; description: string; params: string[] }[];
  docs: string;
};

/** Every error: { error, message }. */
export type DisplayErrorResponse = {
  error: "bad_request" | "unauthorized" | "not_found" | "server_error";
  message: string;
};

// ---------------------------------------------------------------------------
// Auth, headers, errors
// ---------------------------------------------------------------------------

/** Shorter keys are ignored (a guessable key would open the API to anyone). */
export const DISPLAY_KEY_MIN_LENGTH = 24;

let warnedShortKeys = false;

/** The configured keys (DISPLAY_API_KEYS, comma-separated); [] = the API is off. */
export function displayApiKeys(): string[] {
  const all = (process.env.DISPLAY_API_KEYS ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  const keys = all.filter((k) => k.length >= DISPLAY_KEY_MIN_LENGTH);
  if (keys.length < all.length && !warnedShortKeys) {
    warnedShortKeys = true;
    // Counts only: a key never reaches the logs.
    console.warn(
      `[display] DISPLAY_API_KEYS: ${all.length - keys.length} key(s) shorter than ${DISPLAY_KEY_MIN_LENGTH} characters ignored.`,
    );
  }
  return keys;
}

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();

/**
 * Whether `given` is one of `keys`, in constant time: both sides are hashed to one length
 * (so a key's length leaks nothing) and compared with timingSafeEqual, as src/lib/otp
 * compares codes, and every key is compared (no early exit on a match).
 */
export function isDisplayKey(given: string, keys: readonly string[]): boolean {
  const g = digest(given);
  let ok = false;
  for (const k of keys) ok = timingSafeEqual(g, digest(k)) || ok;
  return ok;
}

/**
 * `Authorization: Bearer <key>`, else `?key=`; null when neither is given. A repeated
 * `?key=` (a signage player appending it twice) is a 400 that says so, header or not, like
 * every other repeated parameter, rather than a 401 that suggests the key is wrong.
 */
function presentedKey(req: Request, params: URLSearchParams): string | null {
  const q = single(params, "key");
  const bearer = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.get("authorization") ?? "");
  if (bearer) return bearer[1];
  return q || null;
}

/**
 * On every response. Any origin may read it (the screens can be served from anywhere; the
 * key, not the origin, is the gate, and no cookie is ever involved), and nothing may cache
 * it: a CDN or browser cache must never replay a keyed response.
 */
const BASE_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization",
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex",
};

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return NextResponse.json(body, { status, headers: { ...BASE_HEADERS, ...extra } });
}

function errorResponse(
  status: number,
  error: DisplayErrorResponse["error"],
  message: string,
  extra?: Record<string, string>,
): Response {
  return json(status, { error, message } satisfies DisplayErrorResponse, extra);
}

/** A query parameter the endpoint can't use: answered with 400. */
class DisplayQueryError extends Error {}

/** OPTIONS: the CORS preflight (204), or 404 while the API is off. */
export function displayOptions(): Response {
  if (displayApiKeys().length === 0) return errorResponse(404, "not_found", "Not found.");
  return new NextResponse(null, { status: 204, headers: { ...BASE_HEADERS, "Access-Control-Max-Age": "600" } });
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

export type DisplayQuery = {
  now: Date;
  meta: DisplayMeta;
  /** The resolved `day`: YYYY-MM-DD, or null for every day. */
  day: string | null;
  track: DisplayTrack;
};

type QueryOptions = {
  /** What a missing `day` means ("all" days, or "today"'s event day); omit when the endpoint takes no `day`. */
  day?: "all" | "today";
  /** The endpoint takes `track`. */
  track?: boolean;
};

/** One value for `name`, or null; a repeated parameter is a 400. */
function single(params: URLSearchParams, name: string): string | null {
  const values = params.getAll(name);
  if (values.length > 1) throw new DisplayQueryError(`Give "${name}" once.`);
  return values.length === 1 ? values[0].trim() : null;
}

function parseQuery(params: URLSearchParams, opts: QueryOptions): DisplayQuery {
  // "now" through the hub pages' own helpers, and only where ALLOW_TIME_TRAVEL=true:
  // elsewhere it is ignored altogether, however often it is given. Where it is honoured, a
  // value the pages would silently ignore is a 400 here, so a test isn't misread.
  const rawNow = timeTravelAllowed() ? single(params, "now") : null;
  if (rawNow) {
    const parsed = parseInEventTz(rawNow);
    if (!parsed || Number.isNaN(parsed.getTime())) {
      throw new DisplayQueryError(`"now" must look like 2026-10-09T11:15 (Eastern) or a full ISO 8601 instant.`);
    }
  }
  const { now, traveling, today, eventDay } = pageNow({ now: rawNow || undefined });
  const meta: DisplayMeta = {
    // One clock read: unless time travel moved it, `now` is the server's clock itself.
    generatedAt: traveling ? new Date().toISOString() : now.toISOString(),
    now: now.toISOString(),
    timeTravel: traveling,
    timeZone: EVENT_TZ,
    today,
    eventDay,
  };

  let day: string | null = null;
  if (opts.day) {
    const raw = (single(params, "day") || opts.day).toLowerCase();
    if (raw === "today") day = eventDay;
    else if (raw === "all") day = null;
    else if ((EVENT_DAYS as readonly string[]).includes(raw)) day = raw;
    else throw new DisplayQueryError(`"day" must be one of ${EVENT_DAYS.join(", ")}, "today" or "all".`);
  }

  let track: DisplayTrack = "all";
  if (opts.track) {
    const raw = (single(params, "track") || "all").toLowerCase();
    if (raw !== "bhaio" && raw !== "behno" && raw !== "all") {
      throw new DisplayQueryError(`"track" must be "bhaio", "behno" or "all".`);
    }
    track = raw;
  }

  return { now, meta, day, track };
}

/** `parse()`'s value, or the 400 for the DisplayQueryError it threw. */
function parsedOr400<T>(parse: () => T): T | Response {
  try {
    return parse();
  } catch (err) {
    if (err instanceof DisplayQueryError) return errorResponse(400, "bad_request", err.message);
    throw err;
  }
}

/**
 * A GET on a display endpoint: 404 while the API is off, 400 for a repeated `?key=`, 401
 * without a valid key, 400 for a bad query, else `build`'s body as JSON (500 if it throws).
 * Every response carries the CORS and no-store headers.
 */
export async function displayGet<T extends DisplayMeta>(
  req: Request,
  endpoint: string,
  opts: QueryOptions,
  build: (q: DisplayQuery) => Promise<T>,
): Promise<Response> {
  const keys = displayApiKeys();
  if (keys.length === 0) return errorResponse(404, "not_found", "Not found.");

  const params = new URL(req.url).searchParams;
  const given = parsedOr400(() => presentedKey(req, params));
  if (given instanceof Response) return given;
  if (!given || !isDisplayKey(given, keys)) {
    return errorResponse(401, "unauthorized", "A valid display API key is required.", {
      "WWW-Authenticate": 'Bearer realm="display"',
    });
  }

  const query = parsedOr400(() => parseQuery(params, opts));
  if (query instanceof Response) return query;

  try {
    return json(200, await build(query));
  } catch (err) {
    // The endpoint name only: the request URL may carry ?key=.
    console.error(`[display] ${endpoint} failed:`, err);
    return errorResponse(500, "server_error", "Something went wrong. Try again shortly.");
  }
}

// ---------------------------------------------------------------------------
// Serialisers
// ---------------------------------------------------------------------------

/** formatTime()'s "9:15 AM" with a plain space (newer ICU puts a narrow no-break space before AM/PM). */
const plain = (label: string) => label.replace(/[  ]/g, " ");
const clock = (d: Date) => plain(formatTime(d));

function timesOf(startsAt: string, endsAt: string): DisplayTimes {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const day = dayKey(start);
  return {
    day,
    dayLabel: dayLabel(day),
    dayTitle: formatDayShort(day),
    startsAt,
    endsAt,
    startLabel: clock(start),
    endLabel: clock(end),
    timeLabel: plain(formatTimeRange(start, end)),
  };
}

/** The app's shift badge wording (ScheduleView's ShiftBadge): the start if it moved, else the end. */
function changeLabel(start: number, end: number): string | null {
  if (start > 0) return `Delayed ${start} min`;
  if (start < 0) return `Earlier by ${-start} min`;
  if (end > 0) return `Ends ${end} min later`;
  if (end < 0) return `Ends ${-end} min early`;
  return null;
}

function shiftOf(row: TimedRow): DisplayShift {
  const off = offsetFromPrinted(row);
  if (!off || (off.start === 0 && off.end === 0) || !row.originalStartsAt || !row.originalEndsAt) {
    return { delayMinutes: 0, endDelayMinutes: 0, changeLabel: null, original: null };
  }
  const { startsAt, endsAt, startLabel, endLabel, timeLabel } = timesOf(row.originalStartsAt, row.originalEndsAt);
  return {
    delayMinutes: off.start,
    endDelayMinutes: off.end,
    changeLabel: changeLabel(off.start, off.end),
    original: { startsAt, endsAt, startLabel, endLabel, timeLabel },
  };
}

type DateTimed = { startsAt: Date; endsAt: Date; originalStartsAt: Date | null; originalEndsAt: Date | null };

const isoTimed = (r: DateTimed): TimedRow => ({
  startsAt: r.startsAt.toISOString(),
  endsAt: r.endsAt.toISOString(),
  originalStartsAt: r.originalStartsAt?.toISOString() ?? null,
  originalEndsAt: r.originalEndsAt?.toISOString() ?? null,
});

function tracksOf(audience: Audience): DisplayTrackName[] {
  if (audience === "BHAIO") return ["bhaio"];
  if (audience === "BEHNO") return ["behno"];
  return ["bhaio", "behno"];
}

/** Whether something for `audience` shows on `track` (an ALL item is on both). */
function onTrack(audience: Audience, track: DisplayTrack): boolean {
  return track === "all" || audience === "ALL" || audience === track.toUpperCase();
}

function scheduleItemOut(v: ScheduleItemView, status: DisplayStatus = v.status): DisplayScheduleItem {
  return {
    id: v.id,
    ...timesOf(v.startsAt, v.endsAt),
    ...shiftOf({
      startsAt: v.startsAt,
      endsAt: v.endsAt,
      originalStartsAt: v.originalStartsAt ?? null,
      originalEndsAt: v.originalEndsAt ?? null,
    }),
    title: v.title,
    kind: v.kind,
    audience: v.audience,
    tracks: tracksOf(v.audience),
    location: v.location,
    description: v.description,
    status,
  };
}

function mealOut(v: MealView, row: Meal): DisplayMeal {
  return {
    id: v.id,
    ...timesOf(v.startsAt, v.endsAt),
    ...shiftOf(isoTimed(row)),
    name: v.name,
    note: v.note,
    location: v.location,
    status: v.status,
    revealed: v.status !== "locked",
    revealsAt: v.revealsAt,
    revealLabel: clock(new Date(v.revealsAt)),
    // annotateMeals() leaves a locked meal's courses empty: dishes never leave before the reveal.
    courses: v.courses.map((c) => ({
      course: c.course,
      dishes: c.items.map((d) => ({ name: d.name, description: d.description, tags: d.tags })),
    })),
  };
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

/** The delegate meals (never the Pujya Santo menu), annotated with the app's reveal rule. */
async function delegateMeals(now: Date): Promise<DisplayMeal[]> {
  const rows = await getMeals(MenuFor.DELEGATE);
  // annotateMeals() maps row for row, so index i is rows[i].
  return annotateMeals(rows, now).map((v, i) => mealOut(v, rows[i]));
}

// The team breakouts (the "bk-" rows, never mock or Santo sample rows) and their fold into
// sessions, one per session per track with its teams merged (getTeamBreakoutRows() and
// foldSessions() in src/lib/breakoutSessions.ts, which the Pujya Santo breakouts share).

/**
 * Board statuses for a board of `track`: now / past by the clock; "next" for each row
 * starting at the earliest upcoming start of a track it counts on, else "upcoming". A row
 * counts on each of its `tracks` that the board shows (both for "all"), so a row for both
 * tracks is weighed within each track, never as a third track of its own: a one-track board
 * has one "next" start, an "all" board one per track. Unlike a guest's list, a board shows
 * what's next even while other rows run.
 */
function boardStatuses<T>(
  rows: readonly T[],
  now: Date,
  track: DisplayTrack,
  get: (r: T) => { start: number; end: number; tracks: readonly DisplayTrackName[] },
): DisplayStatus[] {
  const t = now.getTime();
  const shown = (tracks: readonly DisplayTrackName[]) => tracks.filter((tr) => track === "all" || tr === track);
  const firstUpcoming = new Map<DisplayTrackName, number>();
  for (const r of rows) {
    const { start, tracks } = get(r);
    if (start <= t) continue;
    for (const tr of shown(tracks)) {
      if (start < (firstUpcoming.get(tr) ?? Infinity)) firstUpcoming.set(tr, start);
    }
  }
  return rows.map((r) => {
    const { start, end, tracks } = get(r);
    if (start <= t && t < end) return "now";
    if (end <= t) return "past";
    return shown(tracks).some((tr) => firstUpcoming.get(tr) === start) ? "next" : "upcoming";
  });
}

function sessionOut(s: Session, status: DisplayStatus): DisplayBreakoutSession {
  const timed = isoTimed(s);
  const rooms = s.room
    .split(" · ")
    .map((r) => r.trim())
    .filter(Boolean);
  return {
    id: s.id,
    ...timesOf(timed.startsAt, timed.endsAt),
    ...shiftOf(timed),
    audience: s.audience,
    tracks: tracksOf(s.audience),
    title: s.title,
    teams: s.teams,
    rooms,
    room: rooms.join(" · "),
    note: s.description,
    split: rooms.length > 1,
    status,
  };
}

/** Every team breakout session (both tracks, every day), serialised with the statuses of a `track` board. */
async function breakoutSessions(now: Date, track: DisplayTrack): Promise<DisplayBreakoutSession[]> {
  const sessions = foldSessions(await getTeamBreakoutRows());
  const statuses = boardStatuses(sessions, now, track, (s) => ({
    start: s.startsAt.getTime(),
    end: s.endsAt.getTime(),
    tracks: tracksOf(s.audience),
  }));
  return sessions.map((s, i) => sessionOut(s, statuses[i]));
}

/**
 * The BREAKOUT slot a session sits in, by the schedule engine's rule (a slot of its own
 * track or a shared one whose times contain the session's start; the latest-starting one
 * first), so a session is listed under the slot it moves with. Null outside every slot.
 */
function slotFor(session: DisplayBreakoutSession, slots: readonly ScheduleItemView[]): ScheduleItemView | null {
  const containing = slots.filter((slot) => breakoutsInSlot(slot, [session]).length > 0);
  containing.sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
  return containing[0] ?? null;
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

/** The endpoint list for GET /api/display (same gate as the rest: 404 while off, 401 without a key). */
export async function buildIndexResponse(q: DisplayQuery): Promise<DisplayIndexResponse> {
  return {
    ...q.meta,
    endpoints: [
      { path: "/api/display/now", description: "What's on now and next per track, the current and next meal, breakouts now and next.", params: [] },
      { path: "/api/display/schedule", description: "The delegate schedule with statuses and delays.", params: ["day", "track"] },
      { path: "/api/display/menu", description: "The delegate menu; dishes only once a meal is revealed.", params: ["day"] },
      { path: "/api/display/breakouts", description: "Team breakout sessions by day and time slot.", params: ["day", "track"] },
    ],
    docs: "docs/DISPLAY_API.md in the Hospitality Hub repository",
  };
}

/** GET /api/display/schedule */
export async function buildScheduleResponse(q: DisplayQuery): Promise<DisplayScheduleResponse> {
  const rows = (await getScheduleItems()).filter((i) => onTrack(i.audience, q.track));
  // Annotated over the whole track (as a guest on that track sees it), then cut to the day,
  // so "next" can point past the end of the day.
  const items = annotateSchedule(rows, q.now)
    .filter((v) => q.day === null || v.day === q.day)
    .map((v) => scheduleItemOut(v));
  return { ...q.meta, day: q.day, track: q.track, items };
}

/** GET /api/display/menu */
export async function buildMenuResponse(q: DisplayQuery): Promise<DisplayMenuResponse> {
  const meals = (await delegateMeals(q.now)).filter((m) => q.day === null || m.day === q.day);
  return { ...q.meta, day: q.day, revealAll: menuRevealAll(), meals };
}

/** GET /api/display/breakouts */
export async function buildBreakoutsResponse(q: DisplayQuery): Promise<DisplayBreakoutsResponse> {
  const [items, all] = await Promise.all([getScheduleItems(), breakoutSessions(q.now, q.track)]);
  const slotViews = annotateSchedule(
    items.filter((i) => i.kind === "BREAKOUT"),
    q.now,
  );

  // Every block of the board's track(s) on every day first, each with the tracks of the
  // sessions it holds: the statuses are weighed across all of them (so "next" can point past
  // the day asked for), and only then is the day cut.
  const blocks = new Map<string, { slot: DisplayBreakoutSlot; tracks: Set<DisplayTrackName> }>();
  for (const s of all) {
    if (!onTrack(s.audience, q.track)) continue;
    const owner = slotFor(s, slotViews);
    const id = owner ? owner.id : `unscheduled-${s.day}-${s.tracks.join("-")}`;
    let block = blocks.get(id);
    if (!block) {
      block = { slot: owner ? slotOut(owner) : unscheduledSlot(id, s), tracks: new Set() };
      blocks.set(id, block);
    }
    block.slot.sessions.push(s);
    for (const t of s.tracks) block.tracks.add(t);
    if (!block.slot.scheduleItemId) widenUnscheduled(block.slot, s);
  }

  // A slot counts on the tracks it holds sessions for: an ALL "Team Breakouts" slot is weighed
  // within each track (never as a track of its own), so a one-track board has one next slot.
  const list = [...blocks.values()];
  const statuses = boardStatuses(list, q.now, q.track, ({ slot, tracks }) => ({
    start: Date.parse(slot.startsAt),
    end: Date.parse(slot.endsAt),
    tracks: [...tracks],
  }));
  list.forEach(({ slot }, i) => (slot.status = statuses[i]));

  const days = new Map<string, DisplayBreakoutDay>();
  const ordered = list
    .map(({ slot }) => (q.day === null ? slot : { ...slot, sessions: slot.sessions.filter((s) => s.day === q.day) }))
    .filter((slot) => slot.sessions.length > 0)
    .sort(
      (a, b) =>
        Date.parse(a.startsAt) - Date.parse(b.startsAt) ||
        TRACK_ORDER[a.audience] - TRACK_ORDER[b.audience] ||
        collator.compare(a.title, b.title),
    );
  for (const slot of ordered) {
    let d = days.get(slot.day);
    if (!d) {
      d = { day: slot.day, dayLabel: slot.dayLabel, dayTitle: slot.dayTitle, slots: [] };
      days.set(slot.day, d);
    }
    d.slots.push(slot);
  }
  return { ...q.meta, day: q.day, track: q.track, days: [...days.values()] };
}

/** A "Team Breakouts" schedule item as a slot (its sessions and board status set by the caller). */
function slotOut(v: ScheduleItemView): DisplayBreakoutSlot {
  const item = scheduleItemOut(v);
  return {
    id: item.id,
    scheduleItemId: item.id,
    ...timesOf(item.startsAt, item.endsAt),
    delayMinutes: item.delayMinutes,
    endDelayMinutes: item.endDelayMinutes,
    changeLabel: item.changeLabel,
    original: item.original,
    title: item.title,
    location: item.location,
    audience: item.audience,
    tracks: item.tracks,
    status: item.status,
    sessions: [],
  };
}

/**
 * A block for sessions outside every "Team Breakouts" slot (the schedule and the matrix
 * disagree): still listed, spanning them (its sessions and board status set by the caller).
 */
function unscheduledSlot(id: string, s: DisplayBreakoutSession): DisplayBreakoutSlot {
  return {
    id,
    scheduleItemId: null,
    ...timesOf(s.startsAt, s.endsAt),
    ...shiftOf({ startsAt: s.startsAt, endsAt: s.endsAt, originalStartsAt: null, originalEndsAt: null }),
    title: "Team Breakouts",
    location: null,
    audience: s.audience,
    tracks: s.tracks,
    status: s.status,
    sessions: [],
  };
}

/** Stretches an unscheduled block over one more of its sessions. */
function widenUnscheduled(slot: DisplayBreakoutSlot, s: DisplayBreakoutSession) {
  const start = Math.min(Date.parse(slot.startsAt), Date.parse(s.startsAt));
  const end = Math.max(Date.parse(slot.endsAt), Date.parse(s.endsAt));
  Object.assign(slot, timesOf(new Date(start).toISOString(), new Date(end).toISOString()));
}

/** GET /api/display/now */
export async function buildNowResponse(q: DisplayQuery): Promise<DisplayNowResponse> {
  // Both tracks' statuses: each track's list below keeps only its own sessions.
  const [items, meals, sessions] = await Promise.all([
    getScheduleItems(),
    delegateMeals(q.now),
    breakoutSessions(q.now, "all"),
  ]);
  const t = q.now.getTime();

  const trackNow = (track: DisplayTrackName): DisplayTrackNow => {
    const rows = items.filter((i) => onTrack(i.audience, track));
    const views = annotateSchedule(rows, q.now);
    const current = views.filter((v) => v.status === "now");
    const upcoming = views.find((v) => Date.parse(v.startsAt) > t) ?? null;

    const mine = sessions.filter((s) => onTrack(s.audience, track));
    const nextStart = Math.min(...mine.map((s) => Date.parse(s.startsAt)).filter((start) => start > t));
    return {
      schedule: {
        now: current.map((v) => scheduleItemOut(v)),
        next: upcoming ? scheduleItemOut(upcoming, "next") : null,
      },
      breakouts: {
        now: mine.filter((s) => s.status === "now"),
        next: Number.isFinite(nextStart)
          ? mine.filter((s) => Date.parse(s.startsAt) === nextStart).map((s) => ({ ...s, status: "next" as const }))
          : [],
      },
    };
  };

  const mealNow = meals.find((m) => Date.parse(m.startsAt) <= t && t < Date.parse(m.endsAt)) ?? null;
  const mealNext = meals.find((m) => Date.parse(m.startsAt) > t) ?? null;
  return {
    ...q.meta,
    dayLabel: q.meta.eventDay ? dayLabel(q.meta.eventDay) : null,
    tracks: { bhaio: trackNow("bhaio"), behno: trackNow("behno") },
    meal: { now: mealNow, next: mealNext },
  };
}
