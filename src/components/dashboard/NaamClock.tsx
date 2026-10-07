"use client";

import Link from "next/link";
import { useMemo, useRef } from "react";
import { ArrowUpRight, CalendarClock, ChevronRight, Clock, MapPin } from "lucide-react";
import { EVENT_DATES, EVENT_NAME, EVENT_PLACE } from "@/lib/branding";
import { HandsPraying } from "@/components/icons/HandsPraying";
import {
  eventDayAt,
  splitCountdown,
  spokenCountdown,
  untilLabel,
  type ClockData,
  type ClockItem,
} from "@/lib/dashboard";
import { useEventClock } from "./useEventClock";
import styles from "./dashboard.module.css";

type Phase = "before" | "live" | "after";

/**
 * The ticking part of the home hero:
 *  - before the first programme item: a days / hours / minutes / seconds countdown
 *  - during the programme: "Live · Day 2 of 4" with what's happening now and up next
 *  - after the last item: a thank-you note
 * Renders the server's "now" first (no hydration mismatch), then ticks every second.
 */
export function NaamClock({
  data,
  serverNow,
  traveling,
  scheduleHref,
}: {
  data: ClockData;
  /** now.toISOString() from pageNow(), so ?now= time travel carries through. */
  serverNow: string;
  traveling: boolean;
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
      {phase === "live" && <LiveNow now={now} data={data} href={scheduleHref} />}
      {phase === "after" && <ThankYou />}
    </div>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Shared look for the tappable panels inside the hero (display is set per use): flat,
 * translucent deep-ink panes, dark enough that small white text keeps AA contrast all the
 * way down the hero, coral horizon glow included. The focus ring is white: it is drawn on
 * the hero itself, where coral would not reach 3:1.
 */
const panelLink =
  "group rounded-2xl text-left ring-1 ring-inset transition active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";
const pane = "bg-ink-950/35 ring-white/10 hover:bg-ink-950/50";

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
      {/* Tracked caps between hairlines, the guide's "C O L O R S" heading at UI scale. */}
      <p className="flex items-center justify-center gap-2.5 text-[11px] font-bold uppercase tracking-[0.22em] text-coral-200">
        <span aria-hidden="true" className="h-px w-6 bg-gradient-to-r from-transparent to-coral-300/70" />
        {EVENT_NAME} begins in
        <span aria-hidden="true" className="h-px w-6 bg-gradient-to-l from-transparent to-coral-300/70" />
      </p>
      <p className="sr-only">
        {EVENT_NAME} begins in {spokenCountdown(parts)}.
      </p>

      {/* Crisp Just Sans digits (Enilas figures vary in width); the final minute turns coral.
          A spent unit (0 days, then 0 hours) dims its number only, so the small unit label
          under it keeps AA contrast. */}
      <div aria-hidden="true" className="mt-3 grid grid-cols-4 gap-2">
        {cells.map((c, i) => {
          const highlight = finalMinute && i === cells.length - 1;
          return (
            <div
              key={c.unit}
              className={`rounded-2xl px-1 pb-2 pt-2.5 ring-1 ring-inset transition-[box-shadow,background-color,color] duration-500 ${
                highlight
                  ? "bg-coral-400 text-ink-950 shadow-[0_0_28px_-6px_rgb(246_143_119/0.8)] ring-coral-300"
                  : "bg-ink-950/35 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.08)] ring-white/10"
              }`}
            >
              <span
                className={`block h-8 overflow-hidden text-[1.75rem] font-extrabold leading-8 tabular-nums transition-colors duration-500 ${
                  c.dim ? "text-white/55" : ""
                }`}
              >
                {/* Re-keyed on change so the new value rolls in (motion-safe only). */}
                <span key={c.value} className={`block ${styles.digit}`}>
                  {c.value}
                </span>
              </span>
              <span
                className={`mt-1 block text-[10px] font-bold uppercase tracking-[0.1em] ${
                  highlight ? "text-ink-950/80" : "text-white/80"
                }`}
              >
                {c.unit}
              </span>
            </div>
          );
        })}
      </div>

      <Link href={href} className={`${panelLink} ${pane} mt-3 flex min-h-11 items-center gap-3 px-3 py-2`}>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-coral-400 text-ink-950">
          <CalendarClock className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1 leading-snug">
          <span className="block truncate text-[13px] font-semibold text-white">{opening.title ?? `${EVENT_NAME} opens`}</span>
          <span className="block truncate text-xs text-white/80">
            {opening.when}
            {opening.location ? ` · ${opening.location}` : ""}
          </span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-white/60 transition group-hover:translate-x-0.5" />
      </Link>
    </>
  );
}

type TimedItem = ClockItem & { s: number; e: number };

function LiveNow({ now, data, href }: { now: number; data: ClockData; href: string }) {
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
      {/* Sand pill with a jade "live" dot: pops off the ink hero and keeps live = jade app-wide. */}
      <div className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-sand-50 px-3 py-1 text-[11px] font-bold uppercase tracking-caps text-ink-900 shadow-[0_6px_18px_-6px_rgb(20_42_51/0.6)]">
          <span className="h-1.5 w-1.5 rounded-full bg-jade-500 motion-safe:animate-pulse-soft" />
          Live{day ? ` · Day ${day} of ${data.dayLabels.length}` : ""}
        </span>
        {day > 0 && <span className="text-xs font-medium text-white/85">{data.dayLabels[day - 1]}</span>}
      </div>

      <Link href={href} className={`${panelLink} ${pane} mt-3 block p-4`}>
        {primary ? (
          <>
            <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-coral-200">
              <span className="relative flex h-2 w-2">
                <span className="absolute inset-0 rounded-full bg-jade-300 opacity-70 motion-safe:animate-ping" />
                <span className="relative h-2 w-2 rounded-full bg-jade-300" />
              </span>
              Happening now
              <ArrowUpRight className="ml-auto h-4 w-4 text-white/60 transition group-hover:text-white/85" />
            </p>
            <p className="mt-1.5 font-display text-[1.375rem] leading-snug">{primary.title}</p>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-white/80">
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Until {primary.endLabel}
              </span>
              {primary.location && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {primary.location}
                </span>
              )}
            </p>
            {/* Progress warms along the coral gradient, brightest at the leading edge. */}
            <span className="mt-3 block h-1.5 overflow-hidden rounded-full bg-white/15" aria-hidden="true">
              <span
                className="block h-full rounded-full bg-gradient-to-r from-coral-600 to-coral-300 motion-safe:transition-[width] motion-safe:duration-1000 motion-safe:ease-linear"
                style={{ width: `${pct}%` }}
              />
            </span>
            {also.length > 0 && (
              <p className="mt-2 text-xs text-white/80">Also now: {also.map((a) => a.title).join(" · ")}</p>
            )}
            {next && (
              <span className="mt-3.5 flex items-start gap-3 border-t border-white/10 pt-3">
                <span className="mt-0.5 w-9 shrink-0 text-[10px] font-bold uppercase tracking-caps text-white/75">Next</span>
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
              <ArrowUpRight className="ml-auto h-4 w-4 text-white/60 transition group-hover:text-white/85" />
            </p>
            <p className="mt-1.5 font-display text-[1.375rem] leading-snug">{next.title}</p>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-white/80">
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {when(next)} · {untilLabel(next.s - now)}
              </span>
              {next.location && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {next.location}
                </span>
              )}
            </p>
          </>
        ) : (
          <p className="flex items-center gap-2 text-sm font-semibold">
            Open the full schedule
            <ArrowUpRight className="ml-auto h-4 w-4 text-white/70" />
          </p>
        )}
      </Link>
    </>
  );
}

/** The closing note, on the same deep-ink pane as the countdown and live states. */
function ThankYou() {
  return (
    <div className="rounded-2xl bg-ink-950/35 px-4 py-4 ring-1 ring-inset ring-white/10">
      <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-coral-400/15 text-coral-300 ring-1 ring-inset ring-coral-300/35">
        <HandsPraying className="h-5 w-5" />
      </span>
      <p className="mt-3 font-display text-[1.625rem] leading-tight">Thank you for joining us</p>
      <p className="mx-auto mt-2 max-w-[17rem] text-sm leading-relaxed text-white/85">
        {EVENT_NAME} has concluded. Wishing you safe travels home.
      </p>
      <p className="mt-3.5 text-[11px] font-bold uppercase tracking-[0.2em] text-coral-200">
        {EVENT_DATES} · {EVENT_PLACE}
      </p>
    </div>
  );
}
