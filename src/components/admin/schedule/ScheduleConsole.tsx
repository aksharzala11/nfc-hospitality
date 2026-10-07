"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  movedCountOnDay,
  sharesAudience,
  trackLabel,
  type ChangeLogEntry,
  type ScheduleOp,
  type ScheduleState,
  type StateItem,
} from "@/lib/admin/schedule";
import { breakoutsInSlot, foldTeamSessions, sevaViewOf, type ScheduleSevaFilter } from "@/lib/admin/scheduleTeams";
import type { ItemStatus } from "@/lib/schedule";
import { EVENT_DAYS, formatDayLong } from "@/lib/time";
import { DayTabs } from "@/components/DayTabs";
import { ChangeLog } from "./ChangeLog";
import { ItemSheet, newDraft, type ItemDraft } from "./ItemSheet";
import { LivePanel } from "./LivePanel";
import { ReviewPanel, type AppliedChange } from "./ReviewPanel";
import { ScheduleList, type ListRow } from "./ScheduleList";
import { Sheet } from "./Sheet";
import { Toast } from "./Toast";
import { chipCls, chipOff, chipOn, dayOf, labelCls, plural } from "./ui";

type TrackFilter = "ALL" | "BHAIO" | "BEHNO";

const TRACKS: { id: TrackFilter; label: string }[] = [
  { id: "ALL", label: "All tracks" },
  { id: "BHAIO", label: "Bhaio" },
  { id: "BEHNO", label: "Behno" },
];

const TOAST_TITLE: Record<AppliedChange["action"], string> = {
  SHIFT: "Schedule updated",
  EXTEND: "Schedule updated",
  EDIT: "Schedule updated",
  RESET: "Back on the printed times",
  UNDO: "Change undone",
};

type SheetState =
  | { kind: "item"; key: number; itemId: string; fallback: StateItem; draft: ItemDraft; review: boolean }
  | { kind: "op"; key: number; op: ScheduleOp };

type ToastState = { key: number; changeId: string; title: string; detail: string; undoable: boolean };

/** "Now" for the console: the page's ?now= while time-travelling, else the device clock, ticking. */
function useConsoleNow(nowIso: string, traveling: boolean) {
  const [now, setNow] = useState(() => Date.parse(nowIso));
  useEffect(() => {
    if (traveling) {
      setNow(Date.parse(nowIso));
      return;
    }
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [nowIso, traveling]);
  return now;
}

const byTime = (a: StateItem, b: StateItem) =>
  Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.sortOrder - b.sortOrder;

/**
 * /admin/schedule client island: Live panel, day tabs + track filter, the
 * day's items, the change log and the action / review sheets. All state
 * (open sheet, chosen day) survives the layout's 60-second refresh, which
 * swaps in fresh `state` / `changes` so previews always use current times.
 * With the console's seva filter on (`sevaFilter`), "Team Breakouts" slots
 * in the list and their sheets also show the picked sevas' sessions; the
 * changes themselves still move every breakout.
 */
export function ScheduleConsole({
  state,
  changes,
  nowIso,
  traveling,
  today,
  initialDay,
  sevaFilter = null,
}: {
  state: ScheduleState;
  /** Newest first. */
  changes: ChangeLogEntry[];
  nowIso: string;
  traveling: boolean;
  /** Event day containing "now", or null outside the event. */
  today: string | null;
  initialDay: string;
  /** The console's seva filter (see src/lib/admin/scheduleTeams.ts); null = no filter. */
  sevaFilter?: ScheduleSevaFilter | null;
}) {
  const nowMs = useConsoleNow(nowIso, traveling);
  const sevaView = useMemo(() => sevaViewOf(sevaFilter), [sevaFilter]);
  const pathname = usePathname();
  const [day, setDay] = useState(initialDay);
  const [track, setTrack] = useState<TrackFilter>("ALL");
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const seq = useRef(0);
  const nextKey = () => ++seq.current;

  const itemsByDay = useMemo(() => {
    const map = new Map<string, StateItem[]>();
    for (const item of state.items) {
      const d = dayOf(item.startsAt);
      map.set(d, [...(map.get(d) ?? []), item]);
    }
    for (const list of map.values()) list.sort(byTime);
    return map;
  }, [state.items]);

  const mealBySlot = useMemo(
    () => new Map(state.meals.filter((m) => m.scheduleItemId).map((m) => [m.scheduleItemId as string, m])),
    [state.meals],
  );

  // Live panel: today's items across both tracks.
  const todays = today ? (itemsByDay.get(today) ?? []) : [];
  const live = todays.filter((i) => Date.parse(i.startsAt) <= nowMs && nowMs < Date.parse(i.endsAt));
  const upcomingToday = todays.filter((i) => Date.parse(i.startsAt) > nowMs);
  const nextStart = upcomingToday.length ? Math.min(...upcomingToday.map((i) => Date.parse(i.startsAt))) : null;
  const next = live.length === 0 && nextStart !== null ? upcomingToday.filter((i) => Date.parse(i.startsAt) === nextStart) : [];

  // The selected day's list.
  const dayItems = (itemsByDay.get(day) ?? []).filter((i) => track === "ALL" || i.audience === "ALL" || i.audience === track);
  const listNextStart =
    day === today
      ? Math.min(...dayItems.map((i) => Date.parse(i.startsAt)).filter((s) => s > nowMs), Number.POSITIVE_INFINITY)
      : null;
  const rows: ListRow[] = dayItems.map((item) => {
    const start = Date.parse(item.startsAt);
    const end = Date.parse(item.endsAt);
    let status: ItemStatus = "upcoming";
    if (start <= nowMs && nowMs < end) status = "now";
    else if (end <= nowMs) status = "past";
    else if (start === listNextStart) status = "next";
    // Sessions of this slot's track (or shared) that start inside it.
    const breakouts = breakoutsInSlot(item, state.breakouts).length;
    // The picked sevas' sessions in a "Team Breakouts" slot, on the chosen track.
    const teamSessions =
      sevaView && item.kind === "BREAKOUT"
        ? foldTeamSessions(
            breakoutsInSlot(item, sevaView.breakouts).filter((b) => track === "ALL" || sharesAudience(track, b.audience)),
          )
        : null;
    return { item, status, meal: mealBySlot.get(item.id) ?? null, breakouts, teamSessions };
  });
  const moved = movedCountOnDay(state, day);

  const selectDay = (d: string) => {
    setDay(d);
    // Keep ?now= (time travel) and remember the day across reloads, without a server round trip.
    const params = new URLSearchParams(window.location.search);
    params.set("day", d);
    window.history.replaceState(null, "", `${pathname}?${params.toString()}`);
  };

  const openItem = (item: StateItem, preset: Partial<ItemDraft> = {}, review = false) => {
    setToast(null);
    setSheet({ kind: "item", key: nextKey(), itemId: item.id, fallback: item, draft: newDraft(item, preset), review });
  };
  const openOp = (op: ScheduleOp) => {
    setToast(null);
    setSheet({ kind: "op", key: nextKey(), op });
  };
  const closeSheet = () => setSheet(null);
  const applied = (change: AppliedChange) => {
    setSheet(null);
    setToast({
      key: nextKey(),
      changeId: change.changeId,
      title: TOAST_TITLE[change.action],
      detail: change.notified ? `${change.summary} · Guests notified` : change.summary,
      undoable: change.action !== "UNDO",
    });
  };
  // The new change reaches `changes` with the refreshed page data a moment after saving.
  const toastUndoReady = toast ? changes.some((c) => c.id === toast.changeId && c.snapshot) : false;

  return (
    <>
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start lg:gap-6">
        <div className="stagger min-w-0 space-y-5">
          <LivePanel
            live={live}
            next={next}
            nowMs={nowMs}
            onOpen={(item) => openItem(item)}
            onQuick={(item, preset) => openItem(item, preset, true)}
          />

          <section aria-label="Schedule by day">
            <DayTabs days={EVENT_DAYS} selected={day} onSelect={selectDay} today={today} />
            <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className={labelCls}>{formatDayLong(day)}</p>
                {moved.items > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-coral-100 px-2.5 py-0.5 text-[11px] font-semibold text-coral-800">
                    <span className="h-1.5 w-1.5 rounded-full bg-coral-600" aria-hidden="true" />
                    {plural(moved.items, "item")} moved
                  </span>
                )}
              </div>
              <div role="group" aria-label="Track" className="flex gap-1.5">
                {TRACKS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={track === t.id}
                    onClick={() => setTrack(t.id)}
                    className={`${chipCls} ${track === t.id ? chipOn : chipOff}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <ScheduleList
              rows={rows}
              emptyText={track === "ALL" ? "Nothing scheduled for this day." : "Nothing scheduled for this track on this day."}
              onOpen={(item) => openItem(item)}
              sevaView={sevaView}
              nowMs={nowMs}
              track={trackLabel(track)}
            />
            {/* What the seva filter does is said under the filter itself (the page). */}
            <p className="mt-2 px-1 text-[11px] text-ink-500">
              Tap an item to delay it, bring it forward, change its end or set exact times.
            </p>
          </section>
        </div>

        <aside className="stagger mt-5 lg:sticky lg:top-4 lg:mt-0 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:pb-2">
          <ChangeLog
            day={day}
            changes={changes}
            moved={moved}
            onUndo={(changeId) => openOp({ kind: "UNDO", changeId })}
            onResetDay={() => openOp({ kind: "RESET_DAY", day })}
            onSelectDay={selectDay}
          />
        </aside>
      </div>

      {sheet?.kind === "item" && (
        <ItemSheet
          key={sheet.key}
          item={state.items.find((i) => i.id === sheet.itemId) ?? sheet.fallback}
          state={state}
          changes={changes}
          nowMs={nowMs}
          initialDraft={sheet.draft}
          startInReview={sheet.review}
          sevaView={sevaView}
          onClose={closeSheet}
          onApplied={applied}
        />
      )}
      {sheet?.kind === "op" && (
        <OpSheet
          key={sheet.key}
          op={sheet.op}
          state={state}
          changes={changes}
          nowMs={nowMs}
          onClose={closeSheet}
          onApplied={applied}
        />
      )}

      {toast && (
        <Toast
          key={toast.key}
          title={toast.title}
          detail={toast.detail}
          onClose={() => setToast(null)}
          action={
            toast.undoable
              ? { label: "Undo", disabled: !toastUndoReady, onClick: () => openOp({ kind: "UNDO", changeId: toast.changeId }) }
              : undefined
          }
        />
      )}
    </>
  );
}

/** Review-only sheet for day resets and undos. */
function OpSheet({
  op,
  state,
  changes,
  nowMs,
  onClose,
  onApplied,
}: {
  op: ScheduleOp;
  state: ScheduleState;
  changes: ChangeLogEntry[];
  nowMs: number;
  onClose: () => void;
  onApplied: (change: AppliedChange) => void;
}) {
  const headingId = useId();
  const [busy, setBusy] = useState(false);
  return (
    <Sheet onClose={onClose} labelledBy={headingId} busy={busy}>
      <ReviewPanel
        op={op}
        state={state}
        changes={changes}
        nowMs={nowMs}
        headingId={headingId}
        onClose={onClose}
        onApplied={onApplied}
        onBusyChange={setBusy}
      />
    </Sheet>
  );
}
