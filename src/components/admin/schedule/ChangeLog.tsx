"use client";

import { ArrowRightLeft, History, Hourglass, PencilLine, RotateCcw, Undo2, type LucideIcon } from "lucide-react";
import type { ScheduleChangeAction } from "@prisma/client";
import type { ChangeLogEntry } from "@/lib/admin/schedule";
import { EVENT_DAYS, dayKey, formatDayShort, formatTime } from "@/lib/time";
import { DRIFT_TONE, FOCUS } from "@/components/admin/shell/ui";
import { btnDestructive, plural } from "./ui";

const ICON: Record<ScheduleChangeAction, LucideIcon> = {
  SHIFT: ArrowRightLeft,
  EXTEND: Hourglass,
  EDIT: PencilLine,
  RESET: RotateCcw,
  UNDO: Undo2,
};

/** Later in coral, earlier in jade, everything else in ink. */
function tint(c: ChangeLogEntry) {
  if (c.undoneAt) return "bg-ink-800/5 text-ink-400";
  if ((c.action === "SHIFT" || c.action === "EXTEND" || c.action === "EDIT") && c.deltaMinutes) {
    return c.deltaMinutes > 0 ? DRIFT_TONE.late : DRIFT_TONE.early;
  }
  return DRIFT_TONE.neutral;
}

/** "5:32 PM", or "Wed, Sep 23, 10:40 PM" when made on another day than it applies to. */
function when(iso: string, day: string) {
  const d = new Date(iso);
  const k = dayKey(d);
  return k === day ? formatTime(d) : `${formatDayShort(k)}, ${formatTime(d)}`;
}

/**
 * Change log for the selected day (newest first) with Undo for changes that
 * haven't been undone, then "Reset day to printed schedule". Both open the
 * review sheet; nothing changes without a confirmation.
 */
export function ChangeLog({
  day,
  changes,
  moved,
  onUndo,
  onResetDay,
  onSelectDay,
}: {
  day: string;
  changes: ChangeLogEntry[];
  /** Rows on `day` currently off their printed times. */
  moved: { items: number; meals: number; breakouts: number };
  onUndo: (changeId: string) => void;
  onResetDay: () => void;
  onSelectDay: (day: string) => void;
}) {
  const list = changes.filter((c) => c.day === day);
  const movedTotal = moved.items + moved.meals + moved.breakouts;
  const movedParts = [
    moved.items ? plural(moved.items, "item") : "",
    moved.meals ? plural(moved.meals, "meal") : "",
    moved.breakouts ? plural(moved.breakouts, "team breakout") : "",
  ]
    .filter(Boolean)
    .join(", ");
  const otherDays = EVENT_DAYS.filter((d) => d !== day)
    .map((d) => ({ day: d, count: changes.filter((c) => c.day === d).length }))
    .filter((d) => d.count > 0);

  return (
    <section aria-labelledby="change-log-heading" className="card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="change-log-heading" className="flex items-center gap-2 font-display text-xl leading-tight text-ink-900">
          <History className="h-4 w-4 shrink-0 text-coral-700" />
          Change log
        </h2>
        <span className="text-xs font-semibold text-ink-500">{formatDayShort(day)}</span>
      </div>

      {list.length === 0 ? (
        <p className="mt-2 text-sm text-ink-600">No changes for this day yet.</p>
      ) : (
        <ol className="mt-2 divide-y divide-ink-800/8">
          {list.map((c) => {
            const Icon = ICON[c.action];
            return (
              <li key={c.id} className="flex items-start gap-3 py-3">
                <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${tint(c)}`}>
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-sm font-semibold leading-snug ${c.undoneAt ? "text-ink-500 line-through decoration-ink-400" : "text-ink-900"}`}
                  >
                    {c.summary}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-500">
                    {when(c.createdAt, day)} · {c.adminName ?? "Former admin"}
                    {c.undoneAt && <> · undone {when(c.undoneAt, day)}</>}
                  </p>
                </div>
                {c.snapshot && (
                  <button
                    type="button"
                    onClick={() => onUndo(c.id)}
                    className={`inline-flex min-h-11 shrink-0 items-center gap-1 rounded-xl border border-ink-800/12 bg-white/85 px-3 text-xs font-semibold text-ink-900 transition hover:border-ink-800/20 hover:bg-white active:scale-[0.97] ${FOCUS}`}
                  >
                    <Undo2 className="h-3.5 w-3.5" />
                    Undo
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {otherDays.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-ink-500">
          <span>Other days:</span>
          {otherDays.map((d) => (
            <button
              key={d.day}
              type="button"
              onClick={() => onSelectDay(d.day)}
              className={`relative min-h-8 rounded-full border border-ink-800/12 bg-white/85 px-2.5 py-1 text-xs font-semibold text-ink-700 transition before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-[''] hover:border-ink-800/25 hover:bg-white ${FOCUS}`}
            >
              {formatDayShort(d.day)} · {d.count}
            </button>
          ))}
        </div>
      )}

      <div className="mt-4 border-t border-ink-800/8 pt-4">
        <button type="button" onClick={onResetDay} disabled={movedTotal === 0} className={`${btnDestructive} w-full`}>
          <RotateCcw className="h-4 w-4" />
          Reset day to printed schedule
        </button>
        <p className="mt-1.5 text-center text-[11px] text-ink-500">
          {movedTotal === 0 ? `Everything on ${formatDayShort(day)} is on its printed times.` : `Off the printed times: ${movedParts}.`}
        </p>
      </div>
    </section>
  );
}
