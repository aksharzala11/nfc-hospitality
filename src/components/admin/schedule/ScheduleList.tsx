"use client";

import { ChevronRight, MapPin, Users, UtensilsCrossed } from "lucide-react";
import type { StateItem, StateMeal } from "@/lib/admin/schedule";
import type { SevaView, TeamSession } from "@/lib/admin/scheduleTeams";
import type { ItemStatus } from "@/lib/schedule";
import { StatusBadge } from "@/components/StatusBadge";
import { TeamSessions } from "./TeamSessions";
import { OffsetBadge, TrackChip, plural, timeOf } from "./ui";

export type ListRow = {
  item: StateItem;
  status: ItemStatus;
  /** Linked meal (its menu reveal moves with the slot). */
  meal: StateMeal | null;
  /** Breakout sessions inside a BREAKOUT slot. */
  breakouts: number;
  /**
   * With the seva filter on, a BREAKOUT slot's sessions for the picked sevas
   * (shown nested under the row, possibly none); otherwise null.
   */
  teamSessions: TeamSession[] | null;
};

/**
 * The selected day's items (all tracks, time order); tapping one opens its
 * action sheet. With the seva filter on (`sevaView`), each "Team Breakouts"
 * slot also lists the picked sevas' sessions inside it.
 */
export function ScheduleList({
  rows,
  emptyText,
  onOpen,
  sevaView = null,
  nowMs,
  track = null,
}: {
  rows: ListRow[];
  emptyText: string;
  onOpen: (item: StateItem) => void;
  sevaView?: SevaView | null;
  nowMs: number;
  /** The track the rows' team sessions are narrowed to ("Bhaio" / "Behno"); null = both tracks. */
  track?: string | null;
}) {
  if (rows.length === 0) return <p className="card p-6 text-center text-sm text-ink-600">{emptyText}</p>;
  return (
    <ol className="card divide-y divide-ink-800/8 overflow-hidden">
      {rows.map((row) => (
        <Row key={row.item.id} row={row} onOpen={onOpen} sevaView={sevaView} nowMs={nowMs} track={track} />
      ))}
    </ol>
  );
}

function Row({
  row,
  onOpen,
  sevaView,
  nowMs,
  track,
}: {
  row: ListRow;
  onOpen: (item: StateItem) => void;
  sevaView: SevaView | null;
  nowMs: number;
  track: string | null;
}) {
  const { item, status, meal, breakouts, teamSessions } = row;
  const isNow = status === "now";
  const isPast = status === "past";
  const startMoved = item.originalStartsAt !== null && item.originalStartsAt !== item.startsAt;
  // Row tint, hover and the "now" bar sit on the <li>, so a nested session list reads as part of the row.
  return (
    <li
      className={`group/row relative transition hover:bg-sand-50 has-[:focus-visible]:bg-sand-50 ${isNow ? "bg-coral-50" : ""}`}
    >
      {isNow && <span className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-coral-600" aria-hidden="true" />}
      <button
        type="button"
        onClick={() => onOpen(item)}
        className="relative flex w-full items-start gap-3 px-3.5 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-coral-600"
      >
        <div className="w-[4.25rem] shrink-0 pt-px text-right tabular-nums">
          <p className={`text-sm font-bold ${isNow ? "text-coral-800" : isPast ? "text-ink-500" : "text-ink-900"}`}>
            {timeOf(item.startsAt)}
          </p>
          {startMoved && (
            <p className="text-[11px] text-ink-500">
              <span className="sr-only">printed </span>
              <s>{timeOf(item.originalStartsAt!)}</s>
            </p>
          )}
        </div>
        {/* Past rows are quieter in solid ink steps (not opacity, which fails AA); badges keep full strength. */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className={`font-semibold leading-snug ${isPast ? "text-ink-600" : "text-ink-900"}`}>{item.title}</h3>
            <TrackChip audience={item.audience} />
            <StatusBadge status={status} />
          </div>
          <p className={`mt-0.5 text-xs tabular-nums ${isPast ? "text-ink-500" : "text-ink-600"}`}>
            {timeOf(item.startsAt)} – {timeOf(item.endsAt)}
            {item.location && (
              <>
                <span className="mx-1.5">·</span>
                <MapPin className="mr-0.5 inline h-3 w-3 align-[-1px]" />
                {item.location}
              </>
            )}
          </p>
          {(item.originalStartsAt || meal || breakouts > 0) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <OffsetBadge row={item} />
              {/* Sand and ink, so these don't read as the coral "late" badge beside them. */}
              {meal && (
                <span className="inline-flex items-center gap-1 rounded-full bg-sand-200 px-2 py-0.5 text-[11px] font-semibold text-ink-700">
                  <UtensilsCrossed className="h-3 w-3 text-coral-700" />
                  Menu
                </span>
              )}
              {breakouts > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-ink-800/8 px-2 py-0.5 text-[11px] font-semibold text-ink-700">
                  <Users className="h-3 w-3" />
                  {plural(breakouts, "team breakout")}
                </span>
              )}
            </div>
          )}
        </div>
        <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-ink-300 transition group-hover/row:translate-x-0.5 group-hover/row:text-ink-500" />
      </button>
      {teamSessions && sevaView && (
        // Lined up under the title column. A tap here opens the slot too (the button above is the keyboard route).
        <div onClick={() => onOpen(item)} className="-mt-1 cursor-pointer pb-3 pl-[5.875rem] pr-3.5">
          <TeamSessions
            sessions={teamSessions}
            forText={sevaView.forText}
            showTeams={sevaView.showTeams}
            nowMs={nowMs}
            variant="row"
            quiet={isPast}
            track={track}
          />
        </div>
      )}
    </li>
  );
}
