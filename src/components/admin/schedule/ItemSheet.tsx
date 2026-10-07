"use client";

import { useId, useMemo, useState } from "react";
import { ArrowRight, CircleStop, Play, RotateCcw, Users, UtensilsCrossed } from "lucide-react";
import type { Audience } from "@prisma/client";
import {
  MAX_SHIFT_MINUTES,
  formatSignedMinutes,
  planScheduleOp,
  trackLabel,
  type ChangeLogEntry,
  type ScheduleOp,
  type SchedulePlan,
  type ScheduleState,
  type Scope,
  type StateItem,
  type TimePair,
} from "@/lib/admin/schedule";
import { breakoutsInSlot, foldTeamSessions, type SevaView } from "@/lib/admin/scheduleTeams";
import { dayKey, formatDayShort, formatTime } from "@/lib/time";
import { ReviewPanel, type AppliedChange } from "./ReviewPanel";
import { Sheet, SheetBody, SheetFooter, SheetHeader } from "./Sheet";
import { TeamSessions } from "./TeamSessions";
import {
  OffsetBadge,
  btnDestructive,
  btnPrimary,
  btnSecondary,
  clockOf,
  dayOf,
  inputBase,
  inputCls,
  labelCls,
  plural,
  timeOf,
} from "./ui";

export type AdjustMode = "SHIFT" | "EXTEND" | "EDIT";
export type ItemDraft = { mode: AdjustMode; minutes: number; scope: Scope; start: string; end: string };

const MODES: { id: AdjustMode; label: string; hint: string }[] = [
  { id: "SHIFT", label: "Late / early", hint: "whole item moves" },
  { id: "EXTEND", label: "Change end", hint: "ran over / ended early" },
  { id: "EDIT", label: "Exact times", hint: "type new times" },
];

const PRESETS = [-30, -15, -10, -5, 5, 10, 15, 30];

/** Default cascade: own track + shared items for Bhaio/Behno items, everything after for shared ones. */
export function defaultScope(audience: Audience): Scope {
  return audience === "ALL" ? "ALL" : "TRACK";
}

export function newDraft(item: StateItem, preset: Partial<ItemDraft> = {}): ItemDraft {
  return {
    mode: "SHIFT",
    minutes: 0,
    scope: defaultScope(item.audience),
    start: clockOf(item.startsAt),
    end: clockOf(item.endsAt),
    ...preset,
  };
}

export function opFromDraft(itemId: string, d: ItemDraft): ScheduleOp | null {
  if (d.mode === "EDIT") return { kind: "EDIT", itemId, start: d.start, end: d.end };
  if (!d.minutes) return null;
  return { kind: d.mode, itemId, minutes: d.minutes, scope: d.scope };
}

/**
 * Whole minutes from the item's start (SHIFT: "Start now") or end (EXTEND:
 * "Finish now") to `nowMs`; null when that isn't sensible (another day, the
 * item already over / not started, nothing to move, or beyond the limit).
 */
export function minutesToNow(item: StateItem, nowMs: number, mode: "SHIFT" | "EXTEND"): number | null {
  if (dayOf(item.startsAt) !== dayKey(new Date(nowMs))) return null;
  const start = Date.parse(item.startsAt);
  const end = Date.parse(item.endsAt);
  if (mode === "SHIFT") {
    if (nowMs >= end) return null;
    const m = Math.round((nowMs - start) / 60_000);
    return m !== 0 && Math.abs(m) <= MAX_SHIFT_MINUTES ? m : null;
  }
  if (nowMs <= start) return null;
  const m = Math.round((nowMs - end) / 60_000);
  return m !== 0 && m <= MAX_SHIFT_MINUTES ? m : null;
}

/** Items on the same day at/after `from` that a cascade with `scope` would also move. */
function laterCount(state: ScheduleState, item: StateItem, from: string, scope: Scope) {
  const day = dayOf(item.startsAt);
  const threshold = Date.parse(from);
  return state.items.filter(
    (i) =>
      i.id !== item.id &&
      dayOf(i.startsAt) === day &&
      Date.parse(i.startsAt) >= threshold &&
      (scope === "ALL" || item.audience === "ALL" || i.audience === "ALL" || i.audience === item.audience),
  ).length;
}

function movesSentence(plan: SchedulePlan) {
  const parts = [plural(plan.counts.items, "item")];
  if (plan.counts.meals) parts.push(plural(plan.counts.meals, "meal"));
  if (plan.counts.breakouts) parts.push(plural(plan.counts.breakouts, "team breakout"));
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
  return `Moves ${list}.${plan.warnings.length ? " Heads-up: it creates an overlap (see the review)." : ""}`;
}

/**
 * Action sheet for one schedule item: late / early (shift), ran over / short
 * (extend, incl. Finish now), exact times, reset. "Review change" shows the
 * full preview before anything is saved. Quick actions from the Live panel
 * open it straight on the review step (`startInReview`). With the seva filter
 * on (`sevaView`), a "Team Breakouts" slot also lists the picked sevas'
 * sessions inside it.
 */
export function ItemSheet({
  item,
  state,
  changes,
  nowMs,
  initialDraft,
  startInReview,
  onClose,
  onApplied,
  sevaView = null,
}: {
  item: StateItem;
  state: ScheduleState;
  changes: ChangeLogEntry[];
  nowMs: number;
  initialDraft: ItemDraft;
  startInReview: boolean;
  onClose: () => void;
  onApplied: (change: AppliedChange) => void;
  sevaView?: SevaView | null;
}) {
  const headingId = useId();
  const [draft, setDraft] = useState(initialDraft);
  const [review, setReview] = useState<ScheduleOp | null>(() => (startInReview ? opFromDraft(item.id, initialDraft) : null));
  const [busy, setBusy] = useState(false);

  return (
    <Sheet onClose={onClose} labelledBy={headingId} busy={busy}>
      {review ? (
        <ReviewPanel
          op={review}
          state={state}
          changes={changes}
          nowMs={nowMs}
          headingId={headingId}
          onBack={() => setReview(null)}
          onClose={onClose}
          onApplied={onApplied}
          onBusyChange={setBusy}
        />
      ) : (
        <AdjustPanel
          item={item}
          state={state}
          changes={changes}
          nowMs={nowMs}
          draft={draft}
          onDraftChange={setDraft}
          headingId={headingId}
          onClose={onClose}
          onReview={setReview}
          sevaView={sevaView}
        />
      )}
    </Sheet>
  );
}

/** Step one of the item sheet: what happened, by how much, and what else moves (with a live summary). */
export function AdjustPanel({
  item,
  state,
  changes,
  nowMs,
  draft,
  onDraftChange: setDraft,
  headingId,
  onClose,
  onReview: setReview,
  sevaView = null,
}: {
  item: StateItem;
  state: ScheduleState;
  changes: ChangeLogEntry[];
  nowMs: number;
  draft: ItemDraft;
  onDraftChange: (draft: ItemDraft) => void;
  headingId: string;
  onClose: () => void;
  /** Go to the review step for this operation. */
  onReview: (op: ScheduleOp) => void;
  /** The console's seva filter, if on. */
  sevaView?: SevaView | null;
}) {
  // Direction for a typed-in number (kept while the field is empty).
  const [sign, setSign] = useState<1 | -1>(draft.minutes < 0 ? -1 : 1);
  // Until the admin picks a scope, "ended early" defaults to only this item
  // (later sessions usually keep their times rather than start early) and
  // "ran over" to the usual cascade. A draft coming back from the review step
  // with a different scope was chosen by hand, so keep it.
  const autoScope = (minutes: number): Scope => (minutes < 0 ? "ONLY" : defaultScope(item.audience));
  const [scopeTouched, setScopeTouched] = useState(
    () => draft.mode === "EXTEND" && draft.minutes !== 0 && draft.scope !== autoScope(draft.minutes),
  );
  const op = useMemo(() => opFromDraft(item.id, draft), [item.id, draft]);
  const plan = useMemo(() => (op ? planScheduleOp(state, op, { changes }) : null), [state, op, changes]);
  const resetOp = useMemo<ScheduleOp>(() => ({ kind: "RESET_ITEM", itemId: item.id }), [item.id]);
  const canReset = useMemo(() => planScheduleOp(state, resetOp).ok, [state, resetOp]);

  const track = trackLabel(item.audience);
  const meal = state.meals.find((m) => m.scheduleItemId === item.id);
  // Sessions of this slot's track (or shared) that start inside it.
  const breakoutCount = breakoutsInSlot(item, state.breakouts).length;
  // With the seva filter on: the picked sevas' sessions in this slot (both tracks), and the
  // times the change being drafted would give them.
  const teamSessions = useMemo(
    () => (sevaView && item.kind === "BREAKOUT" ? foldTeamSessions(breakoutsInSlot(item, sevaView.breakouts)) : null),
    [sevaView, item],
  );
  const plannedBreakouts = useMemo(
    () =>
      plan?.ok
        ? new Map<string, TimePair>(plan.plan.moves.filter((m) => m.table === "breakout").map((m) => [m.id, m.after]))
        : undefined,
    [plan],
  );
  const anchorMove = plan?.ok ? plan.plan.moves.find((m) => m.isAnchor) : undefined;
  const isMinutesMode = draft.mode !== "EDIT";
  const nowMinutes = isMinutesMode ? minutesToNow(item, nowMs, draft.mode as "SHIFT" | "EXTEND") : null;

  const setMode = (mode: AdjustMode) => {
    if (mode === draft.mode) return;
    setSign(1);
    setScopeTouched(false);
    setDraft({ ...draft, mode, minutes: 0, scope: defaultScope(item.audience) });
  };
  const withMinutes = (minutes: number): ItemDraft => ({
    ...draft,
    minutes,
    scope: !scopeTouched && draft.mode === "EXTEND" && minutes !== 0 ? autoScope(minutes) : draft.scope,
  });
  const setMinutes = (minutes: number) => {
    if (minutes) setSign(minutes < 0 ? -1 : 1);
    setDraft(withMinutes(minutes));
  };
  const flipSign = (next: 1 | -1) => {
    setSign(next);
    setDraft(withMinutes(Math.abs(draft.minutes) * next));
  };

  const threshold = draft.mode === "EXTEND" ? item.endsAt : item.startsAt;
  const scopeOptions: { id: Scope; label: string; hint: string }[] = [
    ...(track
      ? [
          {
            id: "TRACK" as const,
            label: `Later ${track} items too`,
            hint: `${plural(laterCount(state, item, threshold, "TRACK"), "item")} after it today: ${track} + shared`,
          },
        ]
      : []),
    {
      id: "ALL",
      label: "Everything after it",
      hint: `${plural(laterCount(state, item, threshold, "ALL"), "item")} after it today${track ? ", both tracks" : ""}`,
    },
    {
      id: "ONLY",
      label: "Only this item",
      hint: draft.mode === "SHIFT" ? "Nothing else moves" : "Later items keep their times",
    },
  ];

  const directionLabels = draft.mode === "SHIFT" ? { 1: "Later", [-1]: "Earlier" } : { 1: "Longer", [-1]: "Shorter" };

  return (
    <>
      <SheetHeader
        titleId={headingId}
        onClose={onClose}
        eyebrow={`${formatDayShort(dayOf(item.startsAt))} · ${track ? `${track} track` : "Shared, both tracks"}`}
        title={item.title}
        meta={
          <>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm tabular-nums text-ink-700">
              <span className="font-semibold">
                {timeOf(item.startsAt)} – {timeOf(item.endsAt)}
              </span>
              {item.originalStartsAt && item.originalEndsAt && (
                <span className="text-xs text-ink-500">
                  <span className="sr-only">Printed </span>
                  <s>
                    {timeOf(item.originalStartsAt)} – {timeOf(item.originalEndsAt)}
                  </s>
                </span>
              )}
              <OffsetBadge row={item} />
            </p>
            {(meal || breakoutCount > 0) && (
              <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-600">
                {meal && (
                  <span className="inline-flex items-center gap-1">
                    <UtensilsCrossed className="h-3.5 w-3.5 text-coral-700" />
                    {meal.name} menu moves with it
                  </span>
                )}
                {breakoutCount > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <Users className="h-3.5 w-3.5 text-ink-500" />
                    {plural(breakoutCount, "team breakout")} inside
                    {/* Rows (one per team per track) vs folded sessions: name the unit, as the card does. */}
                    {teamSessions &&
                      sevaView &&
                      `, ${teamSessions.length > 0 ? plural(teamSessions.length, "session") : "no sessions"} for ${sevaView.forText}`}
                  </span>
                )}
              </p>
            )}
          </>
        }
      />
      <SheetBody>
        <div role="group" aria-label="What happened" className="grid grid-cols-3 gap-1 rounded-2xl bg-sand-200/70 p-1">
          {MODES.map((m) => {
            const active = draft.mode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                aria-pressed={active}
                onClick={() => setMode(m.id)}
                className={`min-h-11 rounded-xl px-1 py-2 text-center transition focus-visible:outline-2 focus-visible:outline-coral-600 ${
                  active ? "bg-white text-ink-900 shadow-card" : "text-ink-600 hover:text-ink-900"
                }`}
              >
                <span className="block text-[13px] font-semibold leading-tight">{m.label}</span>
                <span className={`mt-0.5 block text-[10px] font-medium leading-tight ${active ? "text-ink-500" : ""}`}>{m.hint}</span>
              </button>
            );
          })}
        </div>

        {isMinutesMode ? (
          <>
            <div className="mt-5">
              <p className={labelCls}>{draft.mode === "SHIFT" ? "Move start and end by" : "Move the end by"}</p>
              <div className="mt-2 grid grid-cols-4 gap-1.5">
                {PRESETS.map((n) => {
                  const active = draft.minutes === n;
                  return (
                    <button
                      key={n}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setMinutes(n)}
                      className={`min-h-11 rounded-full border py-2 text-sm font-semibold tabular-nums transition active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral-600 ${
                        active
                          ? "border-ink-900 bg-ink-900 text-white"
                          : n > 0
                            ? "border-coral-300/70 bg-coral-50 text-coral-800 hover:bg-coral-100"
                            : "border-jade-300/60 bg-jade-50 text-jade-700 hover:bg-jade-100"
                      }`}
                    >
                      {formatSignedMinutes(n).replace(" min", "")}
                    </button>
                  );
                })}
              </div>
              <div className="mt-2.5 flex items-center gap-2">
                <div role="group" aria-label="Direction" className="flex shrink-0 rounded-full bg-sand-200/70 p-0.5">
                  {([1, -1] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={sign === s}
                      onClick={() => flipSign(s)}
                      className={`relative min-h-10 rounded-full px-3 py-1.5 text-xs font-semibold transition before:absolute before:inset-x-0 before:-inset-y-0.5 before:content-[''] focus-visible:outline-2 focus-visible:outline-coral-600 ${
                        sign === s ? "bg-white text-ink-900 shadow-card" : "text-ink-600 hover:text-ink-900"
                      }`}
                    >
                      {directionLabels[s]}
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  aria-label="Minutes"
                  placeholder="Other"
                  value={draft.minutes ? Math.abs(draft.minutes) : ""}
                  onChange={(e) => {
                    const n = Number.parseInt(e.target.value, 10);
                    setDraft(withMinutes(Number.isFinite(n) && n > 0 ? n * sign : 0));
                  }}
                  className={`${inputBase} w-20 min-w-0 text-center tabular-nums`}
                />
                <span className="text-sm text-ink-600">min</span>
              </div>
              {nowMinutes !== null && (
                <button
                  type="button"
                  onClick={() => {
                    setSign(nowMinutes < 0 ? -1 : 1);
                    // Starting / finishing early leaves later items alone unless a scope was picked.
                    setDraft({ ...draft, minutes: nowMinutes, scope: scopeTouched ? draft.scope : autoScope(nowMinutes) });
                  }}
                  className={`${btnSecondary} mt-2.5 w-full`}
                >
                  {draft.mode === "SHIFT" ? <Play className="h-4 w-4" /> : <CircleStop className="h-4 w-4" />}
                  {draft.mode === "SHIFT" ? "Start now" : "Finish now"}
                  <span className="text-xs font-medium text-ink-500">
                    ({draft.mode === "SHIFT" ? "starts" : "ends"} {formatTime(new Date(nowMs))},{" "}
                    {formatSignedMinutes(nowMinutes)})
                  </span>
                </button>
              )}
              {anchorMove && (
                <p className="mt-3 text-sm text-ink-700">
                  {draft.mode === "SHIFT" ? (
                    <>
                      Now <span className="font-semibold text-ink-900">{timeOf(anchorMove.after.start)}</span> –{" "}
                      {timeOf(anchorMove.after.end)}
                    </>
                  ) : (
                    <>
                      Ends <span className="font-semibold text-ink-900">{timeOf(anchorMove.after.end)}</span> instead of{" "}
                      {timeOf(anchorMove.before.end)}
                    </>
                  )}
                </p>
              )}
            </div>

            <fieldset className="mt-5">
              <legend className={labelCls}>What else moves</legend>
              <div className="mt-2 space-y-2">
                {scopeOptions.map((o) => {
                  const checked = draft.scope === o.id || (o.id === "ALL" && draft.scope === "TRACK" && !track);
                  return (
                    <label
                      key={o.id}
                      className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-3 transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-coral-600 ${
                        checked
                          ? "border-ink-900 bg-white shadow-card ring-1 ring-ink-900"
                          : "border-ink-800/12 bg-white/60 hover:border-ink-800/20 hover:bg-white"
                      }`}
                    >
                      <input
                        type="radio"
                        name={`scope-${headingId}`}
                        value={o.id}
                        checked={checked}
                        onChange={() => {
                          setScopeTouched(true);
                          setDraft({ ...draft, scope: o.id });
                        }}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-ink-900"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-ink-900">{o.label}</span>
                        <span className="block text-xs text-ink-600">{o.hint}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </>
        ) : (
          <div className="mt-5">
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className={labelCls}>Starts</span>
                <input
                  type="time"
                  value={draft.start}
                  onChange={(e) => setDraft({ ...draft, start: e.target.value })}
                  className={`${inputCls} mt-1.5 tabular-nums`}
                  required
                />
              </label>
              <label className="block">
                <span className={labelCls}>Ends</span>
                <input
                  type="time"
                  value={draft.end}
                  onChange={(e) => setDraft({ ...draft, end: e.target.value })}
                  className={`${inputCls} mt-1.5 tabular-nums`}
                  required
                />
              </label>
            </div>
            <p className="mt-2 text-xs text-ink-500">
              Only this item changes, with its menu and breakouts. To push later items along too, use Late / early.
            </p>
          </div>
        )}

        {plan &&
          (plan.ok ? (
            <p className="mt-4 text-xs text-ink-600">{movesSentence(plan.plan)}</p>
          ) : (
            <p role="alert" className="mt-4 rounded-xl bg-ember-500/8 px-3 py-2 text-xs font-medium text-ember-700">
              {plan.error}
            </p>
          ))}
        {/* Last, with the other "what this change does" output, so the controls stay first. */}
        {teamSessions && sevaView && (
          <TeamSessions
            sessions={teamSessions}
            forText={sevaView.forText}
            showTeams={sevaView.showTeams}
            nowMs={nowMs}
            variant="sheet"
            planned={plannedBreakouts}
          />
        )}
      </SheetBody>

      <SheetFooter>
        <div className="flex gap-2">
          {canReset && (
            <button type="button" onClick={() => setReview(resetOp)} className={btnDestructive}>
              <RotateCcw className="h-4 w-4" />
              Reset
              <span className="sr-only sm:not-sr-only"> to printed</span>
            </button>
          )}
          <button
            type="button"
            disabled={!op || !plan?.ok}
            onClick={() => op && setReview(op)}
            className={`${btnPrimary} flex-1`}
          >
            Review change
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </SheetFooter>
    </>
  );
}
