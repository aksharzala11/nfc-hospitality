"use client";

import { ChevronRight, CircleStop, Play, Plus, SlidersHorizontal } from "lucide-react";
import type { StateItem } from "@/lib/admin/schedule";
import { formatRelative, formatTime } from "@/lib/time";
import { defaultScope, minutesToNow, type ItemDraft } from "./ItemSheet";
import { OffsetBadge, TrackChip, timeOf } from "./ui";

const quickBtn =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-2 py-2.5 text-sm font-semibold ring-1 ring-inset transition active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-40 disabled:active:scale-100";

/** Late fixes in coral, "now" fixes (start / finish now, usually early) in jade, the rest neutral. */
const QUICK_TONE = {
  late: "bg-coral-400/15 text-coral-100 ring-coral-300/30 hover:bg-coral-400/25",
  now: "bg-jade-400/15 text-jade-100 ring-jade-300/30 hover:bg-jade-400/25",
  neutral: "bg-white/10 text-white ring-white/15 hover:bg-white/15",
} as const;

/**
 * What is happening right now (or, between items, what's next) across both
 * tracks, with one-tap fixes. Every button opens the review sheet first;
 * nothing changes until the admin confirms.
 */
export function LivePanel({
  live,
  next,
  nowMs,
  onQuick,
  onOpen,
}: {
  live: StateItem[];
  next: StateItem[];
  nowMs: number;
  /** Open the item's sheet on the review step with these settings. */
  onQuick: (item: StateItem, preset: Partial<ItemDraft>) => void;
  /** Open the item's sheet on the adjust step. */
  onOpen: (item: StateItem) => void;
}) {
  const isLive = live.length > 0;
  const shown = isLive ? live : next;
  if (shown.length === 0) return null;
  return (
    <section
      aria-labelledby="live-heading"
      className="relative isolate overflow-hidden rounded-3xl bg-gradient-to-br from-ink-800 via-ink-900 to-ink-950 p-4 text-white shadow-card-lg ring-1 ring-inset ring-white/10 sm:p-5"
    >
      <div className="absolute -bottom-20 -left-10 -z-10 h-44 w-44 rounded-full bg-jade-500/20 blur-3xl" aria-hidden="true" />
      <div className="relative">
        <div className="flex items-center justify-between gap-3">
          <h2 id="live-heading" className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.24em] text-coral-200">
            <span className={`h-2 w-2 rounded-full ${isLive ? "bg-coral-400 motion-safe:animate-pulse-soft" : "bg-coral-200/70"}`} />
            {isLive ? "Live now" : "Up next"}
          </h2>
          <span className="text-xs font-semibold tabular-nums text-white/85">{formatTime(new Date(nowMs))}</span>
        </div>
        <ul className={`mt-3 grid gap-3 ${shown.length > 1 ? "md:grid-cols-2" : ""}`}>
          {shown.map((item) => (
            <LiveCard key={item.id} item={item} live={isLive} nowMs={nowMs} onQuick={onQuick} onOpen={onOpen} />
          ))}
        </ul>
      </div>
    </section>
  );
}

function LiveCard({
  item,
  live,
  nowMs,
  onQuick,
  onOpen,
}: {
  item: StateItem;
  live: boolean;
  nowMs: number;
  onQuick: (item: StateItem, preset: Partial<ItemDraft>) => void;
  onOpen: (item: StateItem) => void;
}) {
  const start = Date.parse(item.startsAt);
  const end = Date.parse(item.endsAt);
  const progress = live ? Math.min(100, Math.max(0, ((nowMs - start) / (end - start)) * 100)) : 0;
  const finish = live ? minutesToNow(item, nowMs, "EXTEND") : null;
  const startNow = live ? null : minutesToNow(item, nowMs, "SHIFT");
  const scope = defaultScope(item.audience);
  const now = new Date(nowMs);

  return (
    <li className="rounded-2xl bg-white/[0.07] p-3.5 ring-1 ring-white/10">
      <button
        type="button"
        onClick={() => onOpen(item)}
        className="group -m-1 flex w-[calc(100%+0.5rem)] items-start justify-between gap-3 rounded-xl p-1 text-left focus-visible:outline-2 focus-visible:outline-white"
      >
        <div className="min-w-0">
          <p className="font-display text-xl leading-snug">{item.title}</p>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs tabular-nums text-white/85">
            <span>
              {timeOf(item.startsAt)} – {timeOf(item.endsAt)}
            </span>
            <TrackChip audience={item.audience} tone="dark" />
            <OffsetBadge row={item} tone="dark" />
          </p>
        </div>
        <span className="shrink-0 pt-1 text-right text-xs text-white/85">
          {live ? `ends ${formatRelative(now, new Date(end))}` : `starts ${formatRelative(now, new Date(start))}`}
          <span className="mt-1 flex items-center justify-end gap-0.5 text-[11px] font-bold text-coral-100">
            Adjust
            <ChevronRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
          </span>
        </span>
      </button>

      {live && (
        <div
          className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10"
          role="progressbar"
          aria-label={`${item.title} progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
        >
          <div className="h-full rounded-full bg-gradient-to-r from-coral-700 to-coral-400" style={{ width: `${progress}%` }} />
        </div>
      )}

      <p className="mt-3 text-[10px] font-bold uppercase tracking-[0.16em] text-white/80">
        {live ? "Running late" : "Starting late"}
      </p>
      <div className="mt-1.5 grid grid-cols-3 gap-1.5">
        {[5, 10, 15].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onQuick(item, { mode: "SHIFT", minutes: n, scope })}
            className={`${quickBtn} ${QUICK_TONE.late}`}
          >
            +{n} min
          </button>
        ))}
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
        {live ? (
          <>
            <button
              type="button"
              onClick={() => onQuick(item, { mode: "EXTEND", minutes: 5, scope })}
              className={`${quickBtn} ${QUICK_TONE.neutral}`}
            >
              <Plus className="h-4 w-4" />
              Extend 5 min
            </button>
            <button
              type="button"
              disabled={finish === null}
              onClick={() => finish !== null && onQuick(item, { mode: "EXTEND", minutes: finish, scope: finish > 0 ? scope : "ONLY" })}
              className={`${quickBtn} ${QUICK_TONE.now}`}
            >
              <CircleStop className="h-4 w-4" />
              Finish now
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={startNow === null}
              onClick={() => startNow !== null && onQuick(item, { mode: "SHIFT", minutes: startNow, scope: startNow > 0 ? scope : "ONLY" })}
              className={`${quickBtn} ${QUICK_TONE.now}`}
            >
              <Play className="h-4 w-4" />
              Start now
            </button>
            <button
              type="button"
              onClick={() => onOpen(item)}
              className={`${quickBtn} ${QUICK_TONE.neutral}`}
            >
              <SlidersHorizontal className="h-4 w-4" />
              More options
            </button>
          </>
        )}
      </div>
    </li>
  );
}
