"use client";

import Link from "next/link";
import { useMemo, useRef } from "react";
import { ArrowUpRight, CalendarDays, ChevronRight, Clock, MapPin } from "lucide-react";
import { EVENT_NAME } from "@/lib/branding";
import { HandsPraying } from "@/components/icons/HandsPraying";
import { useEventClock } from "@/components/dashboard/useEventClock";
import {
  eventDayAt,
  splitCountdown,
  spokenCountdown,
  untilLabel,
  type ClockData,
  type ClockItem,
} from "@/lib/dashboard";
import styles from "./santHome.module.css";

type Phase = "before" | "live" | "after";

/**
 * The ticking part of the Santo hero, on the Santo general schedule (Oct 5-15,
 * from santClockData() in ./data.ts):
 *  - before it: a days / hours / minutes / seconds countdown to its first item
 *  - during: "Live · Day 4 of 11" with what is on in it now and next
 *  - after: a note of gratitude
 * Renders the server's "now" first (no hydration mismatch), then ticks every
 * second with useEventClock(), which honours ?now= time travel and survives
 * the 60-second AutoRefresh.
 */
export function SantClock({
  data,
  serverNow,
  traveling,
  scheduleHref,
}: {
  data: ClockData;
  /** now.toISOString() from pageNow(). */
  serverNow: string;
  traveling: boolean;
  /** The General tab of /sant/schedule, keeping ?now= while time-travelling. */
  scheduleHref: string;
}) {
  const now = useEventClock(serverNow, traveling);
  const start = Date.parse(data.start);
  const end = Date.parse(data.end);
  const phase: Phase = now < start ? "before" : now < end ? "live" : "after";

  // Only animate a real change of phase (e.g. the countdown reaching zero), not the first paint.
  const firstPhase = useRef(phase);
  const animate = phase !== firstPhase.current;

  return (
    <div key={phase} className={animate ? styles.phaseIn : undefined}>
      {phase === "before" && <Countdown remaining={start - now} opening={data.opening} href={scheduleHref} />}
      {phase === "live" && <Live now={now} data={data} href={scheduleHref} />}
      {phase === "after" && <Gratitude />}
    </div>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");

function Countdown({ remaining, opening, href }: { remaining: number; opening: ClockData["opening"]; href: string }) {
  const parts = splitCountdown(remaining);
  const finalMinute = remaining <= 60_000;
  const cells = [
    { unit: "Days", value: String(parts.days), dim: parts.days === 0 },
    { unit: "Hours", value: pad(parts.hours), dim: parts.days === 0 && parts.hours === 0 },
    { unit: "Minutes", value: pad(parts.minutes), dim: false },
    { unit: "Seconds", value: pad(parts.seconds), dim: false },
  ];

  return (
    <>
      <p className="flex items-center justify-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-coral-300">
        <span aria-hidden="true" className="h-px w-6 bg-gradient-to-r from-transparent to-coral-300/70" />
        {/* The Santo programme starts days before NAAM itself, so not "NAAM 2026 begins in". */}
        Programme begins in
        <span aria-hidden="true" className="h-px w-6 bg-gradient-to-l from-transparent to-coral-300/70" />
      </p>
      <p className="sr-only">The programme begins in {spokenCountdown(parts)}.</p>

      <div aria-hidden="true" className="mt-3 grid grid-cols-4 gap-2">
        {cells.map((c, i) => {
          const highlight = finalMinute && i === cells.length - 1;
          // A spent unit (0 days, 0 hours) recedes through a quieter box and a softer digit
          // (a large bold number, still over 3:1), never whole-cell opacity: its label stays AA.
          return (
            <div
              key={c.unit}
              className={`rounded-2xl px-1 pb-2 pt-2.5 ring-1 ring-inset transition-[box-shadow,background-color] duration-500 ${
                highlight
                  ? "bg-coral-400/15 shadow-[0_0_28px_-6px_rgb(246_143_119/0.7)] ring-coral-300/60"
                  : c.dim
                    ? "bg-white/[0.035] ring-white/[0.08]"
                    : "bg-white/[0.07] shadow-[inset_0_1px_0_rgb(255_255_255/0.1)] ring-white/[0.12]"
              }`}
            >
              <span className="block h-8 overflow-hidden text-[1.75rem] font-extrabold leading-8 tabular-nums">
                {/* Re-keyed on change so the new value rolls in (motion-safe only). */}
                <span key={c.value} className={`block ${styles.digit} ${c.dim ? "text-white/60" : ""}`}>
                  {c.value}
                </span>
              </span>
              <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-white/80">{c.unit}</span>
            </div>
          );
        })}
      </div>

      <Link
        href={href}
        className="group mt-2 inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full px-3 text-xs font-medium text-white/85 transition hover:text-white focus-visible:outline-2 focus-visible:outline-coral-300"
      >
        <CalendarDays aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-coral-300" />
        <span className="truncate">
          Opens {opening.when}
          {opening.location ? ` · ${opening.location}` : ""}
        </span>
        <span className="sr-only">, see the general schedule</span>
        <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-white/60 transition group-hover:translate-x-0.5" />
      </Link>
    </>
  );
}

type TimedItem = ClockItem & { s: number; e: number };

function Live({ now, data, href }: { now: number; data: ClockData; href: string }) {
  const dayStarts = useMemo(() => data.dayStarts.map((d) => Date.parse(d)), [data.dayStarts]);
  const items = useMemo<TimedItem[]>(
    () => data.items.map((i) => ({ ...i, s: Date.parse(i.startsAt), e: Date.parse(i.endsAt) })),
    [data.items],
  );

  const day = eventDayAt(now, dayStarts);
  const current = items.filter((i) => i.s <= now && now < i.e);
  const next = items.find((i) => i.s > now) ?? null;
  const primary = current[0] ?? null;
  const also = current.slice(1);

  /** "6:30 AM", "Tomorrow · 6:30 AM" or "Sat · 6:30 AM". */
  const when = (item: TimedItem) => {
    if (!item.day || item.day === day) return item.startLabel;
    if (item.day === day + 1) return `Tomorrow · ${item.startLabel}`;
    return `${data.weekdays[item.day - 1] ?? ""} · ${item.startLabel}`;
  };

  const pct = primary ? Math.min(100, Math.max(0, ((now - primary.s) / (primary.e - primary.s)) * 100)) : 0;

  return (
    <>
      {/* Sand pill with a jade dot, as on the delegate NaamClock: live = jade app-wide. */}
      <div className="flex justify-center">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-sand-50 px-3 py-1 text-[11px] font-bold uppercase tracking-caps text-ink-900 shadow-[0_6px_18px_-6px_rgb(20_42_51/0.6)]">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-jade-500 motion-safe:animate-pulse-soft" />
          Live{day ? ` · Day ${day} of ${data.dayLabels.length}` : ""}
        </span>
      </div>

      <Link
        href={href}
        className="group mt-3 block rounded-2xl bg-white/[0.07] p-4 text-left ring-1 ring-inset ring-white/15 transition hover:bg-white/[0.11] active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral-300"
      >
        {primary ? (
          <>
            {/* Labels in the card are coral-200: AA on ink-800 + white/7 wherever the card lands. */}
            <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-coral-200">
              <span aria-hidden="true" className="relative flex h-2 w-2">
                <span className="absolute inset-0 rounded-full bg-jade-300 opacity-70 motion-safe:animate-ping" />
                <span className="relative h-2 w-2 rounded-full bg-jade-300" />
              </span>
              Happening now
              <ArrowUpRight aria-hidden="true" className="ml-auto h-4 w-4 text-white/60 transition group-hover:text-white/90" />
            </p>
            <p className="mt-1.5 font-display text-[1.4rem] leading-snug">{primary.title}</p>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-white/80">
              <span className="inline-flex items-center gap-1">
                <Clock aria-hidden="true" className="h-3 w-3" />
                Until {primary.endLabel}
              </span>
              {primary.location && (
                <span className="inline-flex items-center gap-1">
                  <MapPin aria-hidden="true" className="h-3 w-3" />
                  {primary.location}
                </span>
              )}
            </p>
            {/* The brand's coral gradient, bright at the leading edge. */}
            <span className="mt-3 block h-1.5 overflow-hidden rounded-full bg-white/15" aria-hidden="true">
              <span
                className="block h-full rounded-full bg-gradient-to-r from-coral-700 to-coral-400 motion-safe:transition-[width] motion-safe:duration-1000 motion-safe:ease-linear"
                style={{ width: `${pct}%` }}
              />
            </span>
            {also.length > 0 && (
              <p className="mt-2 text-xs text-white/80">Also now: {also.map((a) => a.title).join(" · ")}</p>
            )}
            {next && (
              <span className="mt-3.5 flex items-start gap-3 border-t border-white/10 pt-3">
                <span className="mt-0.5 w-9 shrink-0 text-[10px] font-bold uppercase tracking-[0.18em] text-coral-200">Next</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold leading-snug">{next.title}</span>
                  <span className="block text-xs text-white/80">
                    {when(next)} · {untilLabel(next.s - now)}
                  </span>
                </span>
              </span>
            )}
          </>
        ) : next ? (
          <>
            <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-coral-200">
              Up next
              <ArrowUpRight aria-hidden="true" className="ml-auto h-4 w-4 text-white/60 transition group-hover:text-white/90" />
            </p>
            <p className="mt-1.5 font-display text-[1.4rem] leading-snug">{next.title}</p>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-white/80">
              <span className="inline-flex items-center gap-1">
                <Clock aria-hidden="true" className="h-3 w-3" />
                {when(next)} · {untilLabel(next.s - now)}
              </span>
              {next.location && (
                <span className="inline-flex items-center gap-1">
                  <MapPin aria-hidden="true" className="h-3 w-3" />
                  {next.location}
                </span>
              )}
            </p>
          </>
        ) : (
          <p className="flex items-center gap-2 text-sm font-semibold">
            Open the general schedule
            <ArrowUpRight aria-hidden="true" className="ml-auto h-4 w-4 text-white/60" />
          </p>
        )}
      </Link>
    </>
  );
}

function Gratitude() {
  return (
    <div className="px-2 pb-1">
      <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-coral-400/15 text-coral-300 ring-1 ring-inset ring-coral-300/30">
        <HandsPraying className="h-5 w-5" />
      </span>
      <p className="mt-3 font-display text-[1.85rem] leading-tight">With gratitude</p>
      <p className="mx-auto mt-2 max-w-[17rem] text-sm leading-relaxed text-white/85">
        {EVENT_NAME} has concluded. Thank you for blessing us with your presence.
      </p>
    </div>
  );
}
