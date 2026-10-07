"use client";

import { useEffect, useId, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, CalendarDays, LoaderCircle, TriangleAlert } from "lucide-react";
import {
  planScheduleOp,
  type ChangeLogEntry,
  type PlannedMove,
  type PlanResult,
  type ScheduleOp,
  type SchedulePlan,
  type ScheduleState,
} from "@/lib/admin/schedule";
import { applyScheduleChange } from "@/app/admin/schedule/actions";
import { formatDayShort } from "@/lib/time";
import { SheetBody, SheetFooter, SheetHeader } from "./Sheet";
import { TrackChip, audienceText, btnPrimary, btnSecondary, labelCls, plural, timeOf } from "./ui";

export type AppliedChange = { changeId: string; summary: string; notified: boolean; action: SchedulePlan["action"] };

const HEADINGS: Record<ScheduleOp["kind"], string> = {
  SHIFT: "Review change",
  EXTEND: "Review change",
  EDIT: "Review change",
  RESET_ITEM: "Back to printed times",
  RESET_DAY: "Reset the day",
  UNDO: "Undo a change",
};

const CONFIRM: Record<ScheduleOp["kind"], string> = {
  SHIFT: "Confirm change",
  EXTEND: "Confirm change",
  EDIT: "Confirm change",
  RESET_ITEM: "Confirm reset",
  RESET_DAY: "Confirm reset",
  UNDO: "Confirm undo",
};

/**
 * Step two of every schedule change: exactly which rows move (old -> new, with
 * meals and breakouts), heads-ups, the "Notify guests" toggle with the text
 * guests will get, and the confirm button. The plan is recomputed from the
 * latest page data on every refresh; the server re-plans and refuses if its
 * result differs from what is shown here.
 */
export function ReviewPanel({
  op,
  state,
  changes,
  nowMs,
  headingId,
  onBack,
  onClose,
  onApplied,
  onBusyChange,
}: {
  op: ScheduleOp;
  state: ScheduleState;
  changes: ChangeLogEntry[];
  /** Console "now" (time travel aware), for the notify default. */
  nowMs: number;
  headingId: string;
  /** Back to the adjust step (item sheet only). */
  onBack?: () => void;
  onClose: () => void;
  onApplied: (change: AppliedChange) => void;
  /** Told while a save is in flight, so the sheet can't be dismissed mid-save. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const router = useRouter();
  const live = useMemo(() => planScheduleOp(state, op, { changes }), [state, op, changes]);
  // While saving, keep showing the plan that was confirmed: the saved change can
  // arrive with the refreshed page data a moment before the sheet closes.
  const [pinned, setPinned] = useState<PlanResult | null>(null);
  const result = pinned ?? live;
  // On for delays / early starts / edits; off for resets and undos, and for
  // corrections to items that are already over (guests don't need a bell).
  const [notify, setNotify] = useState(() => {
    if (op.kind !== "SHIFT" && op.kind !== "EXTEND" && op.kind !== "EDIT") return false;
    if (!result.ok) return true;
    const items = result.plan.moves.filter((m) => m.table === "item");
    return !items.every((m) => Date.parse(m.before.end) <= nowMs && Date.parse(m.after.end) <= nowMs);
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [refreshing, startRefresh] = useTransition();

  useEffect(() => {
    onBusyChange?.(saving);
  }, [saving, onBusyChange]);

  async function confirm() {
    if (!live.ok || saving) return;
    const plan = live.plan;
    setSaving(true);
    setPinned(live);
    setError(null);
    setConflict(false);
    try {
      const res = await applyScheduleChange({ op, expected: plan.fingerprint, notify });
      if (res.ok) {
        onApplied({ changeId: res.changeId, summary: res.summary, notified: res.notified, action: plan.action });
        return;
      }
      setPinned(null);
      setError(res.error);
      if (res.conflict) {
        setConflict(true);
        startRefresh(() => router.refresh());
      }
    } catch {
      setPinned(null);
      setError("Couldn't reach the server, so nothing was changed. Check the connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const plan = result.ok ? result.plan : null;

  return (
    <>
      <SheetHeader
        titleId={headingId}
        onClose={onClose}
        busy={saving}
        leading={
          onBack ? (
            <button
              type="button"
              onClick={onBack}
              disabled={saving}
              aria-label="Back to the options"
              className="-ml-2.5 -mt-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-600 transition hover:bg-ink-800/5 hover:text-ink-900 focus-visible:outline-2 focus-visible:outline-coral-600 disabled:opacity-40"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          ) : undefined
        }
        eyebrow={`${HEADINGS[op.kind]}${plan ? ` · ${formatDayShort(plan.day)}` : ""}`}
        title={plan ? plan.summary : "This change can't be made"}
        meta={
          op.kind === "UNDO" && plan ? (
            <p className="mt-1 text-xs text-ink-600">
              Takes this change&apos;s own shift back out. Changes made since then stay in place.
            </p>
          ) : op.kind === "RESET_DAY" && plan ? (
            <p className="mt-1 text-xs text-ink-600">
              Every item, meal and breakout on {formatDayShort(plan.day)} goes back to its printed time.
            </p>
          ) : undefined
        }
      />
      <SheetBody>
        {conflict && (
          <p role="status" className="mb-4 rounded-2xl border border-coral-300/70 bg-coral-50 px-3 py-2.5 text-xs font-medium text-coral-900">
            The schedule changed while you were reviewing. The preview below is up to date. Check it and confirm again.
          </p>
        )}

        {!result.ok ? (
          <p role="alert" className="rounded-2xl bg-ember-500/8 px-3.5 py-3 text-sm font-medium text-ember-700">
            {result.error}
          </p>
        ) : (
          <>
            <MoveList plan={result.plan} />

            {result.plan.warnings.length > 0 && (
              <div className="mt-4 flex gap-2.5 rounded-2xl border border-coral-300/70 bg-coral-50 px-3.5 py-3 text-xs text-coral-900">
                <TriangleAlert className="mt-px h-4 w-4 shrink-0 text-coral-700" />
                <ul className="space-y-1">
                  {result.plan.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            <NotifyCard plan={result.plan} notify={notify} onChange={setNotify} />
          </>
        )}
      </SheetBody>

      <SheetFooter>
        {error && !conflict && (
          <p role="alert" className="mb-2.5 rounded-xl bg-ember-500/8 px-3 py-2 text-xs font-medium text-ember-700">
            {error}
          </p>
        )}
        {result.ok ? (
          <>
            <button type="button" onClick={confirm} disabled={saving || refreshing} className={`${btnPrimary} w-full`}>
              {saving ? (
                <>
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                CONFIRM[op.kind]
              )}
            </button>
            <p className="mt-2 text-center text-[11px] text-ink-500">
              Guests&apos; schedules, home clock and menus update within a minute.
            </p>
          </>
        ) : (
          <button type="button" onClick={onBack ?? onClose} className={`${btnSecondary} w-full`}>
            {onBack ? "Back" : "Close"}
          </button>
        )}
      </SheetFooter>
    </>
  );
}

/** Minutes a move shifts its start (or, if the start stays, its end); for the coral (later) / jade (earlier) tint. */
function moveDirection(m: PlannedMove) {
  const dS = Date.parse(m.after.start) - Date.parse(m.before.start);
  return dS !== 0 ? dS : Date.parse(m.after.end) - Date.parse(m.before.end);
}

function MoveTimes({ move }: { move: PlannedMove }) {
  const dS = Date.parse(move.after.start) - Date.parse(move.before.start);
  const dE = Date.parse(move.after.end) - Date.parse(move.before.end);
  const tone = moveDirection(move) > 0 ? "text-coral-800" : "text-jade-700";
  const pair = (before: string, after: string) => (
    <>
      <span className="text-ink-500 line-through decoration-ink-400">{timeOf(before)}</span>
      <span aria-hidden="true" className="mx-1 text-ink-400">
        →
      </span>
      <span className="sr-only"> to </span>
      <span className={`font-semibold ${tone}`}>{timeOf(after)}</span>
    </>
  );
  return (
    <div className="shrink-0 text-right text-xs tabular-nums leading-5">
      {dS !== 0 && <p>{pair(move.before.start, move.after.start)}</p>}
      {(dS === 0 || dE !== dS) && (
        <p className={dS !== 0 ? "text-ink-500" : ""}>
          <span className="mr-1 text-ink-500">ends</span>
          {pair(move.before.end, move.after.end)}
        </p>
      )}
    </div>
  );
}

function MoveRow({ move, label }: { move: PlannedMove; label?: string }) {
  return (
    <li className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className={`text-sm leading-5 text-ink-900 ${move.isAnchor ? "font-bold" : "font-medium"}`}>{label ?? move.label}</p>
        {move.audience && move.audience !== "ALL" && (
          <span className="mt-0.5 inline-block">
            <TrackChip audience={move.audience} />
          </span>
        )}
      </div>
      <MoveTimes move={move} />
    </li>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4 first:mt-0">
      <h3 className={labelCls}>{title}</h3>
      <ul className="mt-1.5 divide-y divide-ink-800/8 rounded-2xl bg-white px-3.5 ring-1 ring-ink-800/8">{children}</ul>
    </section>
  );
}

/** Every row the change moves; identical breakout moves are folded into one line. */
function MoveList({ plan }: { plan: SchedulePlan }) {
  const items = plan.moves.filter((m) => m.table === "item");
  const meals = plan.moves.filter((m) => m.table === "meal");
  const groups = new Map<string, { move: PlannedMove; count: number }>();
  for (const m of plan.moves) {
    if (m.table !== "breakout") continue;
    const key = `${m.before.start}|${m.before.end}|${m.after.start}|${m.after.end}`;
    const g = groups.get(key);
    if (g) g.count++;
    else groups.set(key, { move: m, count: 1 });
  }
  return (
    <>
      {items.length > 0 && (
        <Section title={`Schedule · ${plural(items.length, "item")}`}>
          {items.map((m) => (
            <MoveRow key={m.id} move={m} />
          ))}
        </Section>
      )}
      {meals.length > 0 && (
        <Section title={`Meals & menu reveals · ${meals.length}`}>
          {meals.map((m) => (
            <MoveRow key={m.id} move={m} />
          ))}
        </Section>
      )}
      {groups.size > 0 && (
        <Section title={`Team breakouts · ${plan.counts.breakouts}`}>
          {[...groups.values()].map(({ move, count }) => (
            <MoveRow key={move.id} move={move} label={count > 1 ? plural(count, "team breakout") : move.label} />
          ))}
        </Section>
      )}
    </>
  );
}

function NotifyCard({ plan, notify, onChange }: { plan: SchedulePlan; notify: boolean; onChange: (next: boolean) => void }) {
  const labelId = useId();
  return (
    <div className="mt-4 rounded-2xl border border-ink-800/12 bg-white p-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p id={labelId} className="text-sm font-semibold text-ink-900">
            Notify guests
          </p>
          <p className="text-xs text-ink-500">
            {notify ? `Bell notification for ${audienceText(plan.notice.audience)}` : "Schedules still update; no bell notification."}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={notify}
          aria-labelledby={labelId}
          onClick={() => onChange(!notify)}
          className={`relative h-7 w-12 shrink-0 rounded-full transition before:absolute before:-inset-2 before:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral-600 ${notify ? "bg-coral-600" : "bg-ink-400"}`}
        >
          <span
            className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow-card transition-transform ${
              notify ? "translate-x-5" : ""
            }`}
          />
        </button>
      </div>
      {notify && (
        <div className="mt-3 flex items-start gap-3 rounded-xl bg-sand-50 p-3 ring-1 ring-ink-800/8">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-ink-800/8 text-ink-800">
            <CalendarDays className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-snug text-ink-900">{plan.notice.title}</p>
            <p className="mt-0.5 text-xs leading-snug text-ink-600">{plan.notice.body}</p>
          </div>
        </div>
      )}
    </div>
  );
}
