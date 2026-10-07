"use client";

import Link from "next/link";
import { useMemo, useRef, type ReactNode } from "react";
import { ChevronRight, Clock, MapPin } from "lucide-react";
import { HandsPraying } from "@/components/icons/HandsPraying";
import { useEventClock } from "@/components/dashboard/useEventClock";
import { eventDayAt, untilLabel } from "@/lib/dashboard";
import type { ProgrammeItem, ProgrammeList } from "./data";
import styles from "./santHome.module.css";

type Timed = ProgrammeItem & { s: number; e: number };

/**
 * What the card shows at `now`:
 *  - rows:      his items on now and the next one
 *  - done:      all of his items are over (the general schedule may still be on)
 *  - preparing: nothing has been entered for him yet
 * It never repeats the general programme: the hero right above already shows
 * the general now / next (or the countdown to its opening).
 */
type View = { mode: "rows"; current: Timed[]; next: Timed | null; first: boolean } | { mode: "done" | "preparing" };

const timed = (items: ProgrammeItem[]): Timed[] =>
  items.map((i) => ({ ...i, s: Date.parse(i.startsAt), e: Date.parse(i.endsAt) }));

function viewAt(now: number, mine: Timed[], personal: ProgrammeList): View {
  const current = mine.filter((i) => i.s <= now && now < i.e);
  const next = mine.find((i) => i.s > now) ?? null;
  if (current.length > 0 || next) {
    return { mode: "rows", current, next, first: personal.firstStart !== null && now < Date.parse(personal.firstStart) };
  }
  return { mode: personal.total > 0 ? "done" : "preparing" };
}

/** "25 min left", "1 h 5 min left". */
function leftLabel(ms: number): string {
  const mins = Math.max(1, Math.ceil(ms / 60_000));
  if (mins < 60) return `${mins} min left`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min left` : `${h} h left`;
}

/** "5:30 AM", "Tomorrow · 5:30 AM" or "Sat, Oct 10 · 5:30 AM", relative to the Santo day of `now`. */
function startsWhen(item: Timed, day: number): string {
  if (item.day > 0 && item.day === day) return item.startLabel;
  if (item.day > 0 && day > 0 && item.day === day + 1) return `Tomorrow · ${item.startLabel}`;
  return `${item.dateLabel} · ${item.startLabel}`;
}

/**
 * "Your programme" on the Santo home: what is on now and next in his own
 * programme (sant_schedule_items), with time, place and a progress bar. Once
 * nothing of his is on or ahead it says so and points to the General tab
 * rather than repeating the general programme, which the hero above shows.
 * Ticks with the hero clock (same useEventClock, so ?now= works and items
 * hand over on the minute); the whole card opens the matching schedule tab.
 */
export function SantProgramme({
  personal,
  dayStarts,
  programmeEnd,
  serverNow,
  traveling,
  personalHref,
  generalHref,
}: {
  personal: ProgrammeList;
  /** ClockData.dayStarts: midnight (EVENT_TZ) of each Santo day and the day after, ISO. */
  dayStarts: string[];
  /** ClockData.end: when the Santo general schedule ends, ISO. */
  programmeEnd: string;
  serverNow: string;
  traveling: boolean;
  /** /sant/schedule and its General tab, keeping ?now= while time-travelling. */
  personalHref: string;
  generalHref: string;
}) {
  const now = useEventClock(serverNow, traveling);
  const bounds = useMemo(() => dayStarts.map((d) => Date.parse(d)), [dayStarts]);
  const mine = useMemo(() => timed(personal.items), [personal.items]);

  const view = viewAt(now, mine, personal);
  const day = eventDayAt(now, bounds);
  // While the Santo general schedule is still ahead or on, the empty states lead to the General tab.
  const toGeneral = view.mode !== "rows" && now < Date.parse(programmeEnd);

  // Fade in a real hand-over (an item ending, the next starting), not the first paint.
  const key =
    view.mode === "rows" ? `rows:${view.current.map((i) => i.id).join(",")}:${view.next?.id ?? ""}` : view.mode;
  const firstKey = useRef(key);
  const animate = key !== firstKey.current;

  return (
    <section aria-labelledby="sant-programme-heading" className="mb-4">
      <Link
        href={toGeneral ? generalHref : personalHref}
        className="group relative isolate block overflow-hidden rounded-[1.75rem] border border-white/80 bg-white/90 shadow-[0_18px_40px_-24px_rgb(47_79_96/0.5)] backdrop-blur-sm transition hover:shadow-[0_22px_44px_-22px_rgb(47_79_96/0.6)] active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral-700"
      >
        {/* The brand's coral gradient as the card's top edge, deepening into ember. */}
        <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-coral-400 via-coral-700 to-ember-700" />
        <span aria-hidden="true" className="absolute -right-16 -top-20 -z-10 h-48 w-48 rounded-full bg-coral-300/25 blur-3xl" />
        <span aria-hidden="true" className="absolute -bottom-24 -left-16 -z-10 h-44 w-44 rounded-full bg-sand-200/70 blur-3xl" />

        <div className="flex items-center justify-between gap-3 px-4 pt-4">
          <h2 id="sant-programme-heading" className="text-[11px] font-bold uppercase tracking-[0.2em] text-coral-800">
            Your programme
          </h2>
          <span className="inline-flex shrink-0 items-center gap-0.5 text-xs font-semibold text-ink-500 transition group-hover:text-coral-800">
            {toGeneral ? "General schedule" : "Full schedule"}
            <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
          </span>
        </div>

        {view.mode === "rows" ? (
          <ol key={key} className={`px-4 pb-4 pt-3 ${animate ? styles.phaseIn : ""}`}>
            {view.current.map((item, idx) => (
              <NowRow key={item.id} item={item} now={now} rail={idx < view.current.length - 1 || view.next !== null} />
            ))}
            {view.next && (
              <NextRow item={view.next} now={now} day={day} first={view.first} primary={view.current.length === 0} />
            )}
          </ol>
        ) : (
          <div key={key} className={`flex items-center gap-3 px-4 pb-4 pt-3 ${animate ? styles.phaseIn : ""}`}>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-coral-700/[0.08] text-coral-700">
              <HandsPraying className="h-5 w-5" />
            </span>
            <span className="min-w-0">
              <span className="block font-semibold leading-snug text-ink-900">
                {view.mode === "done" ? "Your programme is complete" : "Your programme is being prepared"}
              </span>
              <span className="block text-xs leading-snug text-ink-600">
                {view.mode === "preparing"
                  ? "Timings arranged for you will appear here once they are ready."
                  : toGeneral
                    ? "Thank you. The general programme continues."
                    : "Your schedule stays here to look back on."}
              </span>
            </span>
          </div>
        )}
      </Link>
    </section>
  );
}

/** Left column of a row: its bead, and a thread down to the next row. */
function Rail({ thread, children }: { thread: boolean; children: ReactNode }) {
  return (
    <span aria-hidden="true" className="flex w-9 shrink-0 flex-col items-center">
      {children}
      {thread && <span className="mt-1.5 w-0.5 flex-1 rounded-full bg-gradient-to-b from-coral-700/30 to-coral-700/5" />}
    </span>
  );
}

function Meta({ time, location }: { time: string; location: string | null }) {
  return (
    <span className="mt-1 flex flex-wrap items-start gap-x-3 gap-y-0.5 text-xs leading-snug text-ink-600">
      <span className="inline-flex items-center gap-1">
        <Clock aria-hidden="true" className="h-3 w-3 shrink-0 text-coral-700/80" />
        {time}
      </span>
      {location && (
        <span className="flex min-w-0 items-start gap-1">
          <MapPin aria-hidden="true" className="mt-px h-3 w-3 shrink-0 text-coral-700/80" />
          <span className="min-w-0">{location}</span>
        </span>
      )}
    </span>
  );
}

function NowRow({ item, now, rail }: { item: Timed; now: number; rail: boolean }) {
  const pct = Math.min(100, Math.max(0, ((now - item.s) / (item.e - item.s)) * 100));
  return (
    <li className="flex gap-3">
      <Rail thread={rail}>
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-coral-400 to-coral-700 shadow-glow ring-4 ring-coral-400/15">
          <span className="h-2.5 w-2.5 rounded-full bg-white motion-safe:animate-pulse-soft" />
        </span>
      </Rail>
      <span className={`block min-w-0 flex-1 ${rail ? "pb-4" : ""}`}>
        <span className="block text-[11px] font-bold uppercase tracking-[0.14em] text-coral-700">
          Now
          <span className="font-semibold normal-case tracking-normal text-ink-500"> · {leftLabel(item.e - now)}</span>
        </span>
        <span className="mt-0.5 block font-display text-[1.35rem] leading-snug text-ink-900">{item.title}</span>
        <Meta time={`Until ${item.endLabel}`} location={item.location} />
        <span aria-hidden="true" className="mt-2.5 block h-1.5 overflow-hidden rounded-full bg-coral-700/10">
          <span
            className="block h-full rounded-full bg-gradient-to-r from-coral-400 to-coral-700 motion-safe:transition-[width] motion-safe:duration-1000 motion-safe:ease-linear"
            style={{ width: `${pct}%` }}
          />
        </span>
      </span>
    </li>
  );
}

function NextRow({
  item,
  now,
  day,
  first,
  primary,
}: {
  item: Timed;
  now: number;
  day: number;
  /** Nothing of this list has started yet: "First up". */
  first: boolean;
  /** No "Now" row above it, so it leads the card. */
  primary: boolean;
}) {
  return (
    <li className="flex gap-3">
      <Rail thread={false}>
        {/* An open bead: still ahead (the Now bead above is filled and glowing). */}
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-coral-700/[0.06] ring-1 ring-inset ring-coral-700/15">
          <span className="h-2.5 w-2.5 rounded-full ring-2 ring-coral-700/55" />
        </span>
      </Rail>
      <span className="block min-w-0 flex-1">
        <span className="block text-[11px] font-bold uppercase tracking-[0.14em] text-ember-600">
          {first ? "First up" : "Next"}
          <span className="font-semibold normal-case tracking-normal text-ink-500"> · {untilLabel(item.s - now)}</span>
        </span>
        <span
          className={`mt-0.5 block leading-snug text-ink-900 ${
            primary ? "font-display text-[1.35rem]" : "text-[15px] font-semibold"
          }`}
        >
          {item.title}
        </span>
        <Meta time={`${startsWhen(item, day)} – ${item.endLabel}`} location={item.location} />
        {item.description && (
          <span className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-ink-600">{item.description}</span>
        )}
      </span>
    </li>
  );
}
