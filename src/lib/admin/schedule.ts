/**
 * Live schedule control for /admin/schedule: the planner, the snapshot format
 * stored in `schedule_changes.snapshot`, and the database executor.
 *
 * Operations (see ScheduleOp):
 *  - SHIFT       start and end move by ±N min ("started late" / "brought forward").
 *  - EXTEND      only the end moves ("ran over" / "finished early"; "Finish now").
 *  - EDIT        exact new start/end for one item (Eastern wall-clock "HH:mm").
 *  - RESET_ITEM  one item back to its printed times; RESET_DAY: a whole day.
 *  - UNDO        reverse one earlier change by subtracting each row's own
 *                before -> after deltas, so it composes with later changes.
 *
 * Scope (SHIFT / EXTEND): ONLY the item; TRACK = later items in the item's own
 * track plus shared (ALL) ones; ALL = every later item that day. "Later" means
 * the same event day, starting at/after the anchor's old start (SHIFT) or old
 * end (EXTEND), the anchor itself excluded.
 *
 * Followers: a linked meal (meals.schedule_item_id) always moves with its slot.
 * A breakout moves with the slot it sits in: the BREAKOUT-kind item whose time
 * contains the breakout's start, else a shared item containing it. A follower
 * takes its slot's start delta; its end takes the slot's end delta when it
 * ended with the slot, otherwise the start delta (so "ran over" stretches
 * sessions that ran to the end of the slot, and nothing else). Meals without a
 * slot (Fri/Sat breakfast, Fri snacks) and breakouts outside every slot move
 * only with ALL-scope cascades. Breakouts are every row in `breakouts`, the
 * santos' (seva "Pujya Santo") included, and keep to their gender track
 * (breakouts.audience): a Bhaio or Behno breakout only ever sits in a slot of
 * its own track or a shared one, and always moves with that slot, so a
 * track-scoped change that moves a shared slot (e.g. the shared "Team
 * Breakouts") moves both tracks' sessions in it, while a Bhaio-only slot only
 * ever carries Bhaio sessions. Meals are the delegate menu only
 * (meals.menu_for = DELEGATE): the Pujya Santo menu is never loaded, planned
 * or written here, so moving the programme never moves it.
 *
 * Printed times: the first move of a row stores its printed times in
 * original_starts_at / original_ends_at; they are cleared again whenever the
 * row lands exactly back on them (see writeMoves()).
 *
 * Guard rails: at most MAX_SHIFT_MINUTES per change for any start, or added to
 * any end (shortening a single item is exempt, e.g. "Finish now" on a long
 * block); an end never at/before its start; rows never leave their event day.
 * RESET and UNDO only restore earlier states, so the limit doesn't apply.
 *
 * Runtime imports are client-safe on purpose (Prisma is `import type` only;
 * database functions take a client/transaction from the caller), so the admin
 * sheet runs the same planner for its live preview. The server re-plans from
 * fresh data inside the transaction and refuses when the result differs from
 * what the admin confirmed (SchedulePlan.fingerprint).
 */
import type { Audience, Prisma, ScheduleChangeAction, ScheduleKind } from "@prisma/client";
import { EVENT_DAYS, dayKey, formatDayLong, formatDayShort, formatTime, formatTimeRange, parseInEventTz } from "@/lib/time";
import { greetingName } from "@/lib/users";

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/** Largest move, in minutes, one change may apply to a start time or add to an end time. */
export const MAX_SHIFT_MINUTES = 180;
/** Shortening a single item is exempt from MAX_SHIFT_MINUTES, up to a day. */
const MAX_SHORTEN_MINUTES = 24 * 60;
const MINUTE_MS = 60_000;
/** pg_advisory_xact_lock key: schedule changes from different admins run one at a time. */
const SCHEDULE_LOCK_KEY = 726_100_801;

// ---------------------------------------------------------------------------
// State (plain, serialisable: what the page hands to the admin console)
// ---------------------------------------------------------------------------

/** Current and printed times as ISO strings (UTC). Printed = null while never moved. */
export type TimedRow = {
  startsAt: string;
  endsAt: string;
  originalStartsAt: string | null;
  originalEndsAt: string | null;
};

export type StateItem = TimedRow & {
  id: string;
  title: string;
  kind: ScheduleKind;
  audience: Audience;
  location: string | null;
  sortOrder: number;
};

export type StateMeal = TimedRow & {
  id: string;
  name: string;
  location: string | null;
  /** The timeline slot this meal is served in, if any. */
  scheduleItemId: string | null;
};

export type StateBreakout = TimedRow & {
  id: string;
  title: string;
  seva: string | null;
  /** Gender track: BHAIO / BEHNO sessions, or ALL (mock and Santo sample rows). */
  audience: Audience;
  room: string;
};

export type ScheduleState = { items: StateItem[]; meals: StateMeal[]; breakouts: StateBreakout[] };

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export type Scope = "ONLY" | "TRACK" | "ALL";

export type ScheduleOp =
  | { kind: "SHIFT"; itemId: string; minutes: number; scope: Scope }
  | { kind: "EXTEND"; itemId: string; minutes: number; scope: Scope }
  /** start / end: "HH:mm" Eastern wall-clock on the item's own day. */
  | { kind: "EDIT"; itemId: string; start: string; end: string }
  | { kind: "RESET_ITEM"; itemId: string }
  | { kind: "RESET_DAY"; day: string }
  | { kind: "UNDO"; changeId: string };

export type RowTable = "item" | "meal" | "breakout";
export type TimePair = { start: string; end: string };
export type AnchorRef = { id: string; title: string; audience: Audience };

// ---------------------------------------------------------------------------
// Snapshot (schedule_changes.snapshot)
// ---------------------------------------------------------------------------

/** One row a change moved, with its times immediately before and after (ISO, UTC). */
export type SnapshotRow = {
  table: RowTable;
  id: string;
  /** Title / meal name / "Seva: breakout title" at the time of the change. */
  label: string;
  before: TimePair;
  after: TimePair;
};

/**
 * JSON stored in schedule_changes.snapshot for every change. UNDO subtracts
 * each row's own (after - before) start and end deltas from the row's current
 * times, so it composes with changes made since and also reverses EDIT/RESET.
 */
export type ScheduleChangeSnapshot = {
  version: 1;
  /** The request as made. */
  op: ScheduleOp;
  /** The item the admin acted on; null for a day reset. */
  anchor: AnchorRef | null;
  /** SHIFT / EXTEND only. */
  scope: Scope | null;
  /** Every row the change moved: schedule items, meals and breakouts. */
  rows: SnapshotRow[];
  /** UNDO only: id of the change that was reversed. */
  undoOf: string | null;
};

/** What the planner needs to know about an earlier change to undo it. */
export type UndoableChange = {
  id: string;
  action: ScheduleChangeAction;
  day: string;
  summary: string;
  deltaMinutes: number | null;
  undoneAt: string | null;
  snapshot: ScheduleChangeSnapshot | null;
};

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

export type PlannedMove = {
  table: RowTable;
  id: string;
  label: string;
  /** Items only. */
  audience: Audience | null;
  kind: ScheduleKind | null;
  /** The item the admin acted on. */
  isAnchor: boolean;
  before: TimePair;
  after: TimePair;
  /** Printed times (what the guests were first told). */
  printed: TimePair;
};

export type SchedulePlan = {
  op: ScheduleOp;
  action: ScheduleChangeAction;
  /** Event day (YYYY-MM-DD, EVENT_TZ) the change applies to. */
  day: string;
  anchor: AnchorRef | null;
  scope: Scope | null;
  /** SHIFT / EXTEND: the minutes; EDIT: start delta; UNDO: minus the original's; RESET: null. */
  deltaMinutes: number | null;
  /** Items (in time order), then meals, then breakouts. */
  moves: PlannedMove[];
  counts: { items: number; laterItems: number; meals: number; breakouts: number };
  /** For the change log, e.g. "Keynote Program 2 + 6 later items: +15 min (now 5:30 PM)". */
  summary: string;
  /** Suggested guest notification (published only when the admin keeps "Notify guests" on). */
  notice: { title: string; body: string; audience: Audience };
  /** Heads-ups shown before confirming, e.g. new overlaps. */
  warnings: string[];
  /** Stable hash of every row's before/after times; the server refuses a stale confirmation. */
  fingerprint: string;
  undoOf: string | null;
};

export type PlanResult = { ok: true; plan: SchedulePlan } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Planner (pure)
// ---------------------------------------------------------------------------

class PlanError extends Error {}

function fail(message: string): never {
  throw new PlanError(message);
}

type Row = {
  table: RowTable;
  id: string;
  label: string;
  day: string;
  start: number;
  end: number;
  origStart: number | null;
  origEnd: number | null;
  audience: Audience | null;
  kind: ScheduleKind | null;
  sortOrder: number;
  /** Meals: linked schedule item. */
  slotId: string | null;
};

type Index = { items: Row[]; meals: Row[]; breakouts: Row[]; byKey: Map<string, Row> };

type Delta = { row: Row; dS: number; dE: number; anchor: boolean };

const rowKey = (table: RowTable, id: string) => `${table}:${id}`;
const iso = (ms: number) => new Date(ms).toISOString();
const msOrNull = (value: string | null) => (value === null ? null : Date.parse(value));

function timed(r: TimedRow) {
  const start = Date.parse(r.startsAt);
  return {
    start,
    end: Date.parse(r.endsAt),
    origStart: msOrNull(r.originalStartsAt),
    origEnd: msOrNull(r.originalEndsAt),
    day: dayKey(new Date(start)),
  };
}

function indexState(state: ScheduleState): Index {
  const items: Row[] = state.items.map((i) => ({
    ...timed(i),
    table: "item",
    id: i.id,
    label: i.title,
    audience: i.audience,
    kind: i.kind,
    sortOrder: i.sortOrder,
    slotId: null,
  }));
  const meals: Row[] = state.meals.map((m) => ({
    ...timed(m),
    table: "meal",
    id: m.id,
    label: m.name,
    audience: null,
    kind: null,
    sortOrder: 0,
    slotId: m.scheduleItemId,
  }));
  const breakouts: Row[] = state.breakouts.map((b) => ({
    ...timed(b),
    table: "breakout",
    id: b.id,
    label: titleWithTrack({ title: b.seva ? `${b.seva}: ${b.title}` : b.title, audience: b.audience }),
    // Decides which slots can own the breakout (breakoutOwners()); not passed
    // on to PlannedMove.audience (items only).
    audience: b.audience,
    kind: null,
    sortOrder: 0,
    slotId: null,
  }));
  const byKey = new Map<string, Row>();
  for (const r of [...items, ...meals, ...breakouts]) byKey.set(rowKey(r.table, r.id), r);
  return { items, meals, breakouts, byKey };
}

class MoveSet {
  private map = new Map<string, Delta>();

  add(row: Row, dS: number, dE: number, anchor = false) {
    if (dS === 0 && dE === 0) return;
    const k = rowKey(row.table, row.id);
    if (!this.map.has(k)) this.map.set(k, { row, dS, dE, anchor });
  }

  get(table: RowTable, id: string) {
    return this.map.get(rowKey(table, id));
  }

  has(table: RowTable, id: string) {
    return this.map.has(rowKey(table, id));
  }

  get size() {
    return this.map.size;
  }

  values() {
    return [...this.map.values()];
  }
}

function isEventDay(day: string) {
  return (EVENT_DAYS as readonly string[]).includes(day);
}

function getItem(ix: Index, id: string): Row {
  const row = ix.byKey.get(rowKey("item", id));
  if (!row) fail("That schedule item no longer exists. Refresh and try again.");
  if (!isEventDay(row.day)) fail("Only items on the event days can be adjusted.");
  return row;
}

const TRACK_LABEL: Record<Audience, string | null> = { ALL: null, BHAIO: "Bhaio", BEHNO: "Behno" };

/** "Bhaio" / "Behno", or null for shared items. */
export function trackLabel(audience: Audience): string | null {
  return TRACK_LABEL[audience];
}

/** "Mandir Arti (Behno)"; shared items keep their plain title. */
export function titleWithTrack(item: { title: string; audience: Audience }): string {
  const track = TRACK_LABEL[item.audience];
  return track ? `${item.title} (${track})` : item.title;
}

/** "+15 min", "−10 min" (true minus sign). */
export function formatSignedMinutes(minutes: number): string {
  const sign = minutes > 0 ? "+" : minutes < 0 ? "−" : "±";
  return `${sign}${Math.abs(minutes)} min`;
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * The slot each breakout on `day` moves with: the BREAKOUT-kind item whose
 * [start, end) contains the breakout's start (latest-starting first), else a
 * shared item containing it; null when it sits outside every such item. Only
 * items the breakout shares a track with count (a Behno session is never owned
 * by a Bhaio-only slot).
 */
function breakoutOwners(ix: Index, day: string): Map<string, string | null> {
  const dayItems = ix.items.filter((i) => i.day === day);
  const pick = (list: Row[]) =>
    list.sort((a, b) => b.start - a.start || a.sortOrder - b.sortOrder)[0]?.id ?? null;
  const owners = new Map<string, string | null>();
  for (const b of ix.breakouts) {
    if (b.day !== day) continue;
    const containing = dayItems.filter(
      (i) => i.start <= b.start && b.start < i.end && sharesAudience(i.audience, b.audience),
    );
    owners.set(
      b.id,
      pick(containing.filter((i) => i.kind === "BREAKOUT")) ?? pick(containing.filter((i) => i.audience === "ALL")),
    );
  }
  return owners;
}

/** Moves `row` along with its slot's move (see the header comment). */
function follow(moves: MoveSet, row: Row, slot: Delta) {
  const dE = row.end === slot.row.end ? slot.dE : slot.dS;
  moves.add(row, slot.dS, dE);
}

/**
 * Adds linked meals and breakouts of the moved items. With `cascade` (an
 * ALL-scope cascade), meals without a slot and breakouts outside every slot
 * that start at/after the threshold move by the cascade delta too. A breakout
 * always follows its owner slot (breakoutOwners() already keeps the tracks
 * apart), so it never drifts from the slot guests see it under.
 */
function addFollowers(ix: Index, day: string, moves: MoveSet, cascade: { threshold: number; delta: number } | null) {
  for (const meal of ix.meals) {
    if (meal.day !== day) continue;
    if (meal.slotId) {
      const slot = moves.get("item", meal.slotId);
      if (slot) follow(moves, meal, slot);
    } else if (cascade && meal.start >= cascade.threshold) {
      moves.add(meal, cascade.delta, cascade.delta);
    }
  }
  const owners = breakoutOwners(ix, day);
  for (const b of ix.breakouts) {
    if (b.day !== day) continue;
    const owner = owners.get(b.id) ?? null;
    const slot = owner ? moves.get("item", owner) : undefined;
    if (slot) follow(moves, b, slot);
    else if (!owner && cascade && b.start >= cascade.threshold) moves.add(b, cascade.delta, cascade.delta);
  }
}

/** Moves a row back to its printed times (no-op when it was never moved). */
function restore(moves: MoveSet, row: Row, anchor = false) {
  if (row.origStart === null || row.origEnd === null) return;
  moves.add(row, row.origStart - row.start, row.origEnd - row.end, anchor);
}

function checkMinutes(op: { kind: "SHIFT" | "EXTEND"; minutes: number; scope: Scope }) {
  const m = op.minutes;
  if (!Number.isInteger(m) || m === 0) fail("Choose how many minutes to move it by.");
  const shortenOnly = op.kind === "EXTEND" && op.scope === "ONLY" && m < 0;
  const limit = shortenOnly ? MAX_SHORTEN_MINUTES : MAX_SHIFT_MINUTES;
  if (Math.abs(m) > limit) fail(`A single change can move times by at most ${limit / 60} hours.`);
}

function parseClock(day: string, hhmm: string): number | null {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm)) return null;
  const d = parseInEventTz(`${day}T${hhmm}`);
  return d && !Number.isNaN(d.getTime()) ? d.getTime() : null;
}

type Draft = {
  action: ScheduleChangeAction;
  day: string;
  anchor: Row | null;
  anchorRef?: AnchorRef | null;
  scope: Scope | null;
  deltaMinutes: number | null;
  moves: MoveSet;
  warnings?: string[];
  undo?: UndoableChange;
};

function planShiftOrExtend(ix: Index, op: Extract<ScheduleOp, { kind: "SHIFT" | "EXTEND" }>): Draft {
  const anchor = getItem(ix, op.itemId);
  checkMinutes(op);
  const delta = op.minutes * MINUTE_MS;
  const moves = new MoveSet();
  if (op.kind === "SHIFT") moves.add(anchor, delta, delta, true);
  else moves.add(anchor, 0, delta, true);

  let cascade: { threshold: number; delta: number } | null = null;
  if (op.scope !== "ONLY") {
    const threshold = op.kind === "SHIFT" ? anchor.start : anchor.end;
    const trackOnly = op.scope === "TRACK" && anchor.audience !== "ALL";
    for (const item of ix.items) {
      if (item.id === anchor.id || item.day !== anchor.day || item.start < threshold) continue;
      if (trackOnly && item.audience !== "ALL" && item.audience !== anchor.audience) continue;
      moves.add(item, delta, delta);
    }
    if (!trackOnly) cascade = { threshold, delta };
  }
  addFollowers(ix, anchor.day, moves, cascade);
  const scope: Scope = op.scope === "TRACK" && anchor.audience === "ALL" ? "ALL" : op.scope;
  return { action: op.kind, day: anchor.day, anchor, scope, deltaMinutes: op.minutes, moves };
}

function planEdit(ix: Index, op: Extract<ScheduleOp, { kind: "EDIT" }>): Draft {
  const anchor = getItem(ix, op.itemId);
  const start = parseClock(anchor.day, op.start);
  const end = parseClock(anchor.day, op.end);
  if (start === null || end === null) fail("Enter a start and an end time.");
  if (end <= start) fail("The end time must be after the start time.");
  const dS = start - anchor.start;
  const dE = end - anchor.end;
  if (dS === 0 && dE === 0) fail("Those are already its times.");
  const limit = MAX_SHIFT_MINUTES * MINUTE_MS;
  if (Math.abs(dS) > limit || dE > limit) fail(`A single change can move times by at most ${MAX_SHIFT_MINUTES / 60} hours.`);
  const moves = new MoveSet();
  moves.add(anchor, dS, dE, true);
  addFollowers(ix, anchor.day, moves, null);
  return { action: "EDIT", day: anchor.day, anchor, scope: null, deltaMinutes: Math.round(dS / MINUTE_MS), moves };
}

function planResetItem(ix: Index, op: Extract<ScheduleOp, { kind: "RESET_ITEM" }>): Draft {
  const anchor = getItem(ix, op.itemId);
  const moves = new MoveSet();
  restore(moves, anchor, true);
  for (const meal of ix.meals) if (meal.slotId === anchor.id) restore(moves, meal);
  const owners = breakoutOwners(ix, anchor.day);
  for (const b of ix.breakouts) if (owners.get(b.id) === anchor.id) restore(moves, b);
  if (moves.size === 0) fail(`${anchor.label} is already on its printed times.`);
  return { action: "RESET", day: anchor.day, anchor, scope: null, deltaMinutes: null, moves };
}

function planResetDay(ix: Index, op: Extract<ScheduleOp, { kind: "RESET_DAY" }>): Draft {
  if (!isEventDay(op.day)) fail("Choose one of the event days.");
  const moves = new MoveSet();
  for (const row of [...ix.items, ...ix.meals, ...ix.breakouts]) if (row.day === op.day) restore(moves, row);
  if (moves.size === 0) fail(`${formatDayShort(op.day)} is already on the printed schedule.`);
  return { action: "RESET", day: op.day, anchor: null, scope: null, deltaMinutes: null, moves };
}

function planUndo(ix: Index, op: Extract<ScheduleOp, { kind: "UNDO" }>, changes: UndoableChange[]): Draft {
  const change = changes.find((c) => c.id === op.changeId);
  if (!change) fail("That change no longer exists.");
  if (change.action === "UNDO") fail("An undo can't itself be undone. Make the change again instead.");
  if (change.undoneAt) fail("That change has already been undone.");
  const snap = change.snapshot;
  if (!snap || snap.rows.length === 0) fail("This change can't be undone: there is no record of what it moved.");

  const moves = new MoveSet();
  const warnings: string[] = [];
  for (const r of snap.rows) {
    const row = ix.byKey.get(rowKey(r.table, r.id));
    if (!row) {
      warnings.push(`${r.label} no longer exists and is skipped.`);
      continue;
    }
    const dS = Date.parse(r.after.start) - Date.parse(r.before.start);
    const dE = Date.parse(r.after.end) - Date.parse(r.before.end);
    moves.add(row, -dS, -dE, r.table === "item" && r.id === snap.anchor?.id);
  }
  if (moves.size === 0) fail("Nothing is left to undo: the rows this change moved no longer exist.");
  const anchor = snap.anchor ? (ix.byKey.get(rowKey("item", snap.anchor.id)) ?? null) : null;
  return {
    action: "UNDO",
    day: change.day,
    anchor,
    anchorRef: snap.anchor,
    scope: snap.scope,
    deltaMinutes: change.deltaMinutes === null ? null : -change.deltaMinutes,
    moves,
    warnings,
    undo: change,
  };
}

/** Plans `op` against `state` without writing anything. `changes` is needed for UNDO. */
export function planScheduleOp(
  state: ScheduleState,
  op: ScheduleOp,
  ctx: { changes?: UndoableChange[] } = {},
): PlanResult {
  try {
    const ix = indexState(state);
    let draft: Draft;
    switch (op.kind) {
      case "SHIFT":
      case "EXTEND":
        draft = planShiftOrExtend(ix, op);
        break;
      case "EDIT":
        draft = planEdit(ix, op);
        break;
      case "RESET_ITEM":
        draft = planResetItem(ix, op);
        break;
      case "RESET_DAY":
        draft = planResetDay(ix, op);
        break;
      case "UNDO":
        draft = planUndo(ix, op, ctx.changes ?? []);
        break;
      default:
        fail("Unknown schedule change.");
    }
    return { ok: true, plan: finishPlan(ix, op, draft) };
  } catch (e) {
    if (e instanceof PlanError) return { ok: false, error: e.message };
    throw e;
  }
}

function toPlanned(d: Delta): PlannedMove {
  const r = d.row;
  return {
    table: r.table,
    id: r.id,
    label: r.label,
    audience: r.table === "item" ? r.audience : null,
    kind: r.kind,
    isAnchor: d.anchor,
    before: { start: iso(r.start), end: iso(r.end) },
    after: { start: iso(r.start + d.dS), end: iso(r.end + d.dE) },
    printed: { start: iso(r.origStart ?? r.start), end: iso(r.origEnd ?? r.end) },
  };
}

const TABLE_ORDER: Record<RowTable, number> = { item: 0, meal: 1, breakout: 2 };

function finishPlan(ix: Index, op: ScheduleOp, draft: Draft): SchedulePlan {
  const deltas = draft.moves.values();
  for (const d of deltas) {
    const start = d.row.start + d.dS;
    const end = d.row.end + d.dE;
    if (end <= start) fail(`${d.row.label} would end before it starts.`);
    if (dayKey(new Date(start)) !== d.row.day) fail(`${d.row.label} would move to another day.`);
  }
  deltas.sort(
    (a, b) =>
      TABLE_ORDER[a.row.table] - TABLE_ORDER[b.row.table] ||
      a.row.start + a.dS - (b.row.start + b.dS) ||
      a.row.sortOrder - b.row.sortOrder ||
      a.row.label.localeCompare(b.row.label),
  );
  const moves = deltas.map(toPlanned);
  const itemCount = moves.filter((m) => m.table === "item").length;
  const counts = {
    items: itemCount,
    laterItems: itemCount - moves.filter((m) => m.table === "item" && m.isAnchor).length,
    meals: moves.filter((m) => m.table === "meal").length,
    breakouts: moves.filter((m) => m.table === "breakout").length,
  };
  const anchorRef: AnchorRef | null =
    draft.anchorRef !== undefined
      ? draft.anchorRef
      : draft.anchor
        ? { id: draft.anchor.id, title: draft.anchor.label, audience: draft.anchor.audience ?? "ALL" }
        : null;
  const anchorMove = moves.find((m) => m.isAnchor) ?? null;
  const warnings = [...(draft.warnings ?? [])];
  if (draft.action !== "RESET" && draft.action !== "UNDO") warnings.push(...overlapWarnings(ix, draft.day, deltas, draft.moves));

  const plan: Omit<SchedulePlan, "summary" | "notice" | "fingerprint"> = {
    op,
    action: draft.action,
    day: draft.day,
    anchor: anchorRef,
    scope: draft.scope,
    deltaMinutes: draft.deltaMinutes,
    moves,
    counts,
    warnings,
    undoOf: draft.undo?.id ?? null,
  };
  return {
    ...plan,
    summary: summarize(plan, anchorMove, draft.undo),
    notice: noticeFor(plan, anchorMove),
    fingerprint: planFingerprint(moves),
  };
}

function overlaps(a0: number, a1: number, b0: number, b1: number) {
  return a0 < b1 && b0 < a1;
}

/** Whether two rows' tracks meet: either is shared (ALL), or both are the same track. */
export function sharesAudience(a: Audience | null, b: Audience | null) {
  return a === "ALL" || b === "ALL" || a === b;
}

/** New overlaps between moved items and items that stay put (same day, same or shared track). */
function overlapWarnings(ix: Index, day: string, deltas: Delta[], moves: MoveSet): string[] {
  const still = ix.items.filter((i) => i.day === day && !moves.has("item", i.id));
  const out: string[] = [];
  for (const d of deltas) {
    if (d.row.table !== "item") continue;
    const s = d.row.start + d.dS;
    const e = d.row.end + d.dE;
    const hits = still.filter(
      (o) =>
        sharesAudience(d.row.audience, o.audience) &&
        overlaps(s, e, o.start, o.end) &&
        !overlaps(d.row.start, d.row.end, o.start, o.end),
    );
    if (hits.length === 0) continue;
    const names = hits
      .slice(0, 2)
      .map((h) => `${titleWithTrack({ title: h.label, audience: h.audience ?? "ALL" })} at ${formatTime(new Date(h.start))}`);
    const more = hits.length > 2 ? ` and ${hits.length - 2} more` : "";
    out.push(`${titleWithTrack({ title: d.row.label, audience: d.row.audience ?? "ALL" })} will overlap ${names.join(" and ")}${more}.`);
  }
  return out;
}

type PlanCore = Omit<SchedulePlan, "summary" | "notice" | "fingerprint">;

function laterPart(n: number) {
  return n > 0 ? ` + ${plural(n, "later item")}` : "";
}

function summarize(plan: PlanCore, anchorMove: PlannedMove | null, undo?: UndoableChange): string {
  const { anchor, counts } = plan;
  const name = anchor ? titleWithTrack(anchor) : "";
  switch (plan.op.kind) {
    case "SHIFT": {
      const at = anchorMove ? ` (now ${formatTime(new Date(anchorMove.after.start))})` : "";
      return `${name}${laterPart(counts.laterItems)}: ${formatSignedMinutes(plan.op.minutes)}${at}`;
    }
    case "EXTEND": {
      const m = plan.op.minutes;
      const at = anchorMove ? ` (${formatTime(new Date(anchorMove.after.end))})` : "";
      const what = m > 0 ? `ends ${m} min later` : `ends ${-m} min early`;
      return `${name}${laterPart(counts.laterItems)}: ${what}${at}`;
    }
    case "EDIT": {
      if (!anchorMove) return `${name}: times edited`;
      const now = formatTimeRange(new Date(anchorMove.after.start), new Date(anchorMove.after.end));
      const was = formatTimeRange(new Date(anchorMove.before.start), new Date(anchorMove.before.end));
      return `${name}: now ${now} (was ${was})`;
    }
    case "RESET_ITEM": {
      const printed = anchorMove ?? plan.moves[0];
      return printed
        ? `${name}: back to printed ${formatTimeRange(new Date(printed.printed.start), new Date(printed.printed.end))}`
        : `${name}: back to printed times`;
    }
    case "RESET_DAY":
      return `${formatDayShort(plan.day)}: back to the printed schedule (${plural(counts.items, "item")})`;
    case "UNDO":
      return `Undid: ${undo?.summary ?? "an earlier change"}`;
  }
}

/** Minutes between two ISO instants (b - a). */
function minutesFrom(a: string, b: string) {
  return Math.round((Date.parse(b) - Date.parse(a)) / MINUTE_MS);
}

function offsetSentence(minutes: number, subject: "start" | "end") {
  if (subject === "start") {
    if (minutes > 0) return `${minutes} min later than planned.`;
    if (minutes < 0) return `${-minutes} min earlier than planned.`;
    return "Back on the planned time.";
  }
  if (minutes > 0) return `Ends ${minutes} min later than planned.`;
  if (minutes < 0) return `Ends ${-minutes} min earlier than planned.`;
  return "Ends at the planned time.";
}

function noticeFor(plan: PlanCore, anchorMove: PlannedMove | null): SchedulePlan["notice"] {
  const audience: Audience = plan.anchor?.audience ?? "ALL";
  const title = plan.anchor?.title ?? "";
  const later = plan.counts.laterItems > 0 ? " Later sessions moved too." : "";
  const time = (value: string) => formatTime(new Date(value));
  const range = (p: TimePair) => formatTimeRange(new Date(p.start), new Date(p.end));

  if (anchorMove) {
    switch (plan.op.kind) {
      case "SHIFT":
        return {
          title: `Schedule update: ${title} now at ${time(anchorMove.after.start)}`,
          body: `${offsetSentence(minutesFrom(anchorMove.printed.start, anchorMove.after.start), "start")}${later}`,
          audience,
        };
      case "EXTEND":
        return {
          title: `Schedule update: ${title} now ends at ${time(anchorMove.after.end)}`,
          body: `${offsetSentence(minutesFrom(anchorMove.printed.end, anchorMove.after.end), "end")}${later}`,
          audience,
        };
      case "EDIT": {
        const back = anchorMove.after.start === anchorMove.printed.start && anchorMove.after.end === anchorMove.printed.end;
        return {
          title: `Schedule update: ${title} now ${range(anchorMove.after)}`,
          body: back ? "Back on the planned time." : `Originally planned for ${range(anchorMove.printed)}.`,
          audience,
        };
      }
      case "RESET_ITEM":
        return {
          title: `Schedule update: ${title} back to ${time(anchorMove.after.start)}`,
          body: "Back on the printed schedule.",
          audience,
        };
      case "UNDO":
        // Say whichever time the reversal changed for the item itself.
        return anchorMove.after.start !== anchorMove.before.start
          ? {
              title: `Schedule update: ${title} now at ${time(anchorMove.after.start)}`,
              body: `${offsetSentence(minutesFrom(anchorMove.printed.start, anchorMove.after.start), "start")}${later}`,
              audience,
            }
          : {
              title: `Schedule update: ${title} now ends at ${time(anchorMove.after.end)}`,
              body: `${offsetSentence(minutesFrom(anchorMove.printed.end, anchorMove.after.end), "end")}${later}`,
              audience,
            };
      default:
        break;
    }
  }
  if (plan.op.kind === "RESET_DAY") {
    return {
      title: `Schedule update: ${formatDayShort(plan.day)} is back on the printed schedule`,
      body: `All times for ${formatDayLong(plan.day)} are as originally planned.`,
      audience: "ALL",
    };
  }
  return {
    title: `Schedule update for ${formatDayShort(plan.day)}`,
    body: "Some times have changed. Check the schedule for details.",
    audience,
  };
}

/** 53-bit string hash (cyrb53); stable across server and browser. */
function hash53(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Identifies exactly which rows move from which times to which. */
export function planFingerprint(moves: Pick<PlannedMove, "table" | "id" | "before" | "after">[]): string {
  const parts = moves
    .map((m) => `${m.table}:${m.id}:${m.before.start}>${m.after.start}:${m.before.end}>${m.after.end}`)
    .sort();
  return hash53(parts.join("|"));
}

/**
 * `state` after `plan`, with printed times captured / cleared exactly as
 * writeMoves() does in the database. Pure; for tests and optimistic UI.
 */
export function applyPlanToState(state: ScheduleState, plan: SchedulePlan): ScheduleState {
  const byKey = new Map(plan.moves.map((m) => [rowKey(m.table, m.id), m]));
  const same = (a: string, b: string) => Date.parse(a) === Date.parse(b);
  function apply<T extends TimedRow & { id: string }>(table: RowTable, rows: T[]): T[] {
    return rows.map((r) => {
      const m = byKey.get(rowKey(table, r.id));
      if (!m) return r;
      const printedStart = r.originalStartsAt ?? r.startsAt;
      const printedEnd = r.originalEndsAt ?? r.endsAt;
      const back = same(m.after.start, printedStart) && same(m.after.end, printedEnd);
      return {
        ...r,
        startsAt: m.after.start,
        endsAt: m.after.end,
        originalStartsAt: back ? null : printedStart,
        originalEndsAt: back ? null : printedEnd,
      };
    });
  }
  return { items: apply("item", state.items), meals: apply("meal", state.meals), breakouts: apply("breakout", state.breakouts) };
}

// ---------------------------------------------------------------------------
// Small helpers for the console
// ---------------------------------------------------------------------------

/** Start / end offsets from the printed times in minutes, or null when the row was never moved. */
export function offsetFromPrinted(row: TimedRow): { start: number; end: number } | null {
  if (!row.originalStartsAt || !row.originalEndsAt) return null;
  return { start: minutesFrom(row.originalStartsAt, row.startsAt), end: minutesFrom(row.originalEndsAt, row.endsAt) };
}

/** Rows on `day` that are currently off their printed times. */
export function movedCountOnDay(state: ScheduleState, day: string): { items: number; meals: number; breakouts: number } {
  const on = (r: TimedRow) => r.originalStartsAt !== null && dayKey(new Date(r.startsAt)) === day;
  return {
    items: state.items.filter(on).length,
    meals: state.meals.filter(on).length,
    breakouts: state.breakouts.filter(on).length,
  };
}

// ---------------------------------------------------------------------------
// Snapshot parsing
// ---------------------------------------------------------------------------

const TABLES: readonly RowTable[] = ["item", "meal", "breakout"];
const SCOPES: readonly Scope[] = ["ONLY", "TRACK", "ALL"];
const AUDIENCES: readonly Audience[] = ["ALL", "BHAIO", "BEHNO"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isIsoInstant(v: unknown): v is string {
  return typeof v === "string" && !Number.isNaN(Date.parse(v));
}

function isTimePair(v: unknown): v is TimePair {
  return isRecord(v) && isIsoInstant(v.start) && isIsoInstant(v.end);
}

function isSnapshotRow(v: unknown): v is SnapshotRow {
  return (
    isRecord(v) &&
    TABLES.includes(v.table as RowTable) &&
    typeof v.id === "string" &&
    typeof v.label === "string" &&
    isTimePair(v.before) &&
    isTimePair(v.after)
  );
}

/** Validates schedule_changes.snapshot; null when it is missing or malformed. */
export function parseSnapshot(json: unknown): ScheduleChangeSnapshot | null {
  if (!isRecord(json) || json.version !== 1 || !Array.isArray(json.rows)) return null;
  if (!json.rows.every(isSnapshotRow)) return null;
  const a = json.anchor;
  const anchor =
    isRecord(a) && typeof a.id === "string" && typeof a.title === "string" && AUDIENCES.includes(a.audience as Audience)
      ? { id: a.id, title: a.title, audience: a.audience as Audience }
      : null;
  return {
    version: 1,
    op: json.op as ScheduleOp,
    anchor,
    scope: SCOPES.includes(json.scope as Scope) ? (json.scope as Scope) : null,
    rows: json.rows as SnapshotRow[],
    undoOf: typeof json.undoOf === "string" ? json.undoOf : null,
  };
}

// ---------------------------------------------------------------------------
// Database (server only: pass `prisma` or a transaction client)
// ---------------------------------------------------------------------------

type Db = Prisma.TransactionClient;

/**
 * Every schedule item, delegate-menu meal and breakout, in time order. The
 * Santo menu's meals (menu_for = SANT) are left out: the live schedule never
 * moves them (writeMoves() refuses them too).
 */
export async function loadScheduleState(db: Db): Promise<ScheduleState> {
  const [items, meals, breakouts] = await Promise.all([
    db.scheduleItem.findMany({ orderBy: [{ startsAt: "asc" }, { sortOrder: "asc" }] }),
    db.meal.findMany({
      where: { menuFor: "DELEGATE" },
      orderBy: { startsAt: "asc" },
      select: {
        id: true,
        name: true,
        location: true,
        scheduleItemId: true,
        startsAt: true,
        endsAt: true,
        originalStartsAt: true,
        originalEndsAt: true,
      },
    }),
    db.breakout.findMany({
      orderBy: [{ startsAt: "asc" }, { title: "asc" }],
      select: {
        id: true,
        title: true,
        seva: true,
        audience: true,
        room: true,
        startsAt: true,
        endsAt: true,
        originalStartsAt: true,
        originalEndsAt: true,
      },
    }),
  ]);
  const times = (r: { startsAt: Date; endsAt: Date; originalStartsAt: Date | null; originalEndsAt: Date | null }) => ({
    startsAt: r.startsAt.toISOString(),
    endsAt: r.endsAt.toISOString(),
    originalStartsAt: r.originalStartsAt?.toISOString() ?? null,
    originalEndsAt: r.originalEndsAt?.toISOString() ?? null,
  });
  return {
    items: items.map((i) => ({
      id: i.id,
      title: i.title,
      kind: i.kind,
      audience: i.audience,
      location: i.location,
      sortOrder: i.sortOrder,
      ...times(i),
    })),
    meals: meals.map((m) => ({ id: m.id, name: m.name, location: m.location, scheduleItemId: m.scheduleItemId, ...times(m) })),
    breakouts: breakouts.map((b) => ({ id: b.id, title: b.title, seva: b.seva, audience: b.audience, room: b.room, ...times(b) })),
  };
}

/** A change-log row for the console. `snapshot` is kept only while the change can still be undone. */
export type ChangeLogEntry = UndoableChange & {
  createdAt: string;
  adminName: string | null;
  anchorId: string | null;
};

/** Newest first. */
export async function loadChangeLog(db: Db, take = 300): Promise<ChangeLogEntry[]> {
  const rows = await db.scheduleChange.findMany({
    orderBy: { createdAt: "desc" },
    take,
    include: { user: { select: { name: true, displayName: true } } },
  });
  return rows.map((c) => {
    const snapshot = parseSnapshot(c.snapshot);
    const undoable = c.action !== "UNDO" && !c.undoneAt;
    return {
      id: c.id,
      action: c.action,
      day: c.day,
      summary: c.summary,
      deltaMinutes: c.deltaMinutes,
      undoneAt: c.undoneAt?.toISOString() ?? null,
      snapshot: undoable ? snapshot : null,
      createdAt: c.createdAt.toISOString(),
      adminName: c.user ? greetingName(c.user) : null,
      anchorId: snapshot?.anchor?.id ?? null,
    };
  });
}

/** A refusal to show the admin as-is (nothing was written). */
export class ScheduleOpError extends Error {}

/** The schedule changed between the admin's preview and the confirmation. */
export class ScheduleConflictError extends ScheduleOpError {
  constructor(readonly plan: SchedulePlan) {
    super("The schedule changed while you were reviewing. Check the updated preview and confirm again.");
  }
}

/** Waits for any other schedule change to commit, then holds the lock until this transaction ends. */
export async function lockSchedule(tx: Db) {
  await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${SCHEDULE_LOCK_KEY})`);
}

const TABLE_NAME: Record<RowTable, string> = { item: "schedule_items", meal: "meals", breakout: "breakouts" };
/**
 * Extra WHERE condition per table. Only the delegate menu's meals may move; a
 * Santo-menu meal id is not updated, so writeMoves() rejects the whole change.
 */
const TABLE_SCOPE: Record<RowTable, string> = { item: "", meal: " AND t.menu_for = 'DELEGATE'", breakout: "" };

/**
 * Relative update for one table: every row moves by its own start/end delta
 * (ms). Printed times are captured on the first move and cleared when the row
 * lands exactly back on them; Postgres evaluates every right-hand side against
 * the old row, so this is one statement per table.
 */
function moveSql(table: RowTable) {
  const newStart = "t.starts_at + v.ds * interval '1 millisecond'";
  const newEnd = "t.ends_at + v.de * interval '1 millisecond'";
  const printedStart = "COALESCE(t.original_starts_at, t.starts_at)";
  const printedEnd = "COALESCE(t.original_ends_at, t.ends_at)";
  const backToPrinted = `(${newStart} = ${printedStart} AND ${newEnd} = ${printedEnd})`;
  return `UPDATE "${TABLE_NAME[table]}" AS t SET
      starts_at = ${newStart},
      ends_at = ${newEnd},
      original_starts_at = CASE WHEN ${backToPrinted} THEN NULL ELSE ${printedStart} END,
      original_ends_at = CASE WHEN ${backToPrinted} THEN NULL ELSE ${printedEnd} END
    FROM jsonb_to_recordset($1::jsonb) AS v(id text, ds bigint, de bigint)
    WHERE t.id = v.id${TABLE_SCOPE[table]}
    RETURNING t.id, t.starts_at, t.ends_at`;
}

/** Applies the plan's moves and checks every row landed where the plan said. */
async function writeMoves(tx: Db, moves: PlannedMove[]) {
  for (const table of TABLES) {
    const list = moves.filter((m) => m.table === table);
    if (list.length === 0) continue;
    const payload = JSON.stringify(
      list.map((m) => ({
        id: m.id,
        ds: Date.parse(m.after.start) - Date.parse(m.before.start),
        de: Date.parse(m.after.end) - Date.parse(m.before.end),
      })),
    );
    const rows = await tx.$queryRawUnsafe<{ id: string; starts_at: Date; ends_at: Date }[]>(moveSql(table), payload);
    const got = new Map(rows.map((r) => [r.id, r]));
    for (const m of list) {
      const r = got.get(m.id);
      if (!r || r.starts_at.getTime() !== Date.parse(m.after.start) || r.ends_at.getTime() !== Date.parse(m.after.end)) {
        throw new ScheduleOpError("The schedule changed while saving, so nothing was changed. Please try again.");
      }
    }
  }
}

async function loadUndoable(tx: Db, id: string): Promise<UndoableChange[]> {
  const c = await tx.scheduleChange.findUnique({ where: { id } });
  if (!c) return [];
  return [
    {
      id: c.id,
      action: c.action,
      day: c.day,
      summary: c.summary,
      deltaMinutes: c.deltaMinutes,
      undoneAt: c.undoneAt?.toISOString() ?? null,
      snapshot: parseSnapshot(c.snapshot),
    },
  ];
}

export type ExecuteInput = {
  op: ScheduleOp;
  /** Admin making the change (schedule_changes.user_id / notifications.created_by_id). */
  adminId: string;
  /** Fingerprint of the preview the admin confirmed; the change is refused if the fresh plan differs. */
  expectedFingerprint?: string | null;
  /** Also publish a SCHEDULE notification with the plan's suggested text. */
  notify: boolean;
  /**
   * Stores that notification: pass createNotification() from
   * src/lib/notificationPeople.ts. It is server only (it also inserts on a
   * database that doesn't have notifications.user_ids yet, without a failing
   * query that would abort this transaction), so the caller hands it in and
   * this module stays client-safe.
   */
  publishNotice: (tx: Db, notice: ScheduleNotice) => Promise<{ id: string }>;
};

/** The SCHEDULE notification a change publishes: for everyone on the notice's track. */
export type ScheduleNotice = {
  kind: "SCHEDULE";
  title: string;
  body: string;
  href: "/schedule";
  audience: Audience;
  roles: [];
  sevas: [];
  regions: [];
  /** The admin making the change. */
  createdById: string;
};

export type ExecuteResult = { changeId: string; plan: SchedulePlan; notificationId: string | null };

/**
 * Runs one schedule operation. Call inside prisma.$transaction(); throws
 * ScheduleOpError / ScheduleConflictError (the caller's transaction then rolls
 * back) for anything the admin should see.
 */
export async function executeScheduleOp(tx: Db, input: ExecuteInput): Promise<ExecuteResult> {
  await lockSchedule(tx);
  const state = await loadScheduleState(tx);
  const changes = input.op.kind === "UNDO" ? await loadUndoable(tx, input.op.changeId) : [];
  const result = planScheduleOp(state, input.op, { changes });
  if (!result.ok) throw new ScheduleOpError(result.error);
  const { plan } = result;
  if (input.expectedFingerprint && input.expectedFingerprint !== plan.fingerprint) {
    throw new ScheduleConflictError(plan);
  }

  if (plan.undoOf) {
    const marked = await tx.scheduleChange.updateMany({
      where: { id: plan.undoOf, undoneAt: null },
      data: { undoneAt: new Date() },
    });
    if (marked.count !== 1) throw new ScheduleOpError("That change has already been undone.");
  }

  await writeMoves(tx, plan.moves);

  const snapshot: ScheduleChangeSnapshot = {
    version: 1,
    op: plan.op,
    anchor: plan.anchor,
    scope: plan.scope,
    rows: plan.moves.map((m) => ({ table: m.table, id: m.id, label: m.label, before: m.before, after: m.after })),
    undoOf: plan.undoOf,
  };
  const idsOf = (table: RowTable) => plan.moves.filter((m) => m.table === table).map((m) => m.id);
  const change = await tx.scheduleChange.create({
    data: {
      userId: input.adminId,
      action: plan.action,
      day: plan.day,
      summary: plan.summary,
      deltaMinutes: plan.deltaMinutes,
      itemIds: idsOf("item"),
      mealIds: idsOf("meal"),
      breakoutIds: idsOf("breakout"),
      snapshot: snapshot as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  });

  let notificationId: string | null = null;
  if (input.notify) {
    const n = await input.publishNotice(tx, {
      kind: "SCHEDULE",
      title: plan.notice.title,
      body: plan.notice.body,
      href: "/schedule",
      audience: plan.notice.audience,
      roles: [],
      sevas: [],
      regions: [],
      createdById: input.adminId,
    });
    notificationId = n.id;
  }

  return { changeId: change.id, plan, notificationId };
}
