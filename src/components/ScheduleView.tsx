"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Armchair,
  Bus,
  Camera,
  ChevronRight,
  ClipboardCheck,
  Clock,
  Flame,
  Footprints,
  MapPin,
  Presentation,
  Sparkles,
  Users,
  UtensilsCrossed,
  type LucideProps,
} from "lucide-react";
import type { ScheduleItemView } from "@/lib/schedule";
import { EVENT_DAYS, formatDayLong, formatTime, minutesBetween } from "@/lib/time";
import { RIDE_TITLE } from "@/lib/travel";
import { DayTabs } from "@/components/DayTabs";
import { getScroller, onAppScroll } from "@/lib/scroll";
import { StatusBadge } from "@/components/StatusBadge";
import { MandirMark } from "@/components/Logo";
import { HandWaving } from "@/components/icons/HandWaving";
import { HandsPraying } from "@/components/icons/HandsPraying";

type IconComponent = (props: LucideProps) => React.ReactNode;

/** Longer journeys (to the mandir, the utaro, the airport, Edison, DC) get a bus; hops between rooms get footsteps. */
const RIDE = RIDE_TITLE;

/**
 * Icon tiles, one brand colour per family so the day reads at a glance:
 * ink for the programme, the coral gradient for meals, pale coral for team time,
 * solid deep ember for arti and darshan (so it never reads as the pale team tile),
 * jade for arrivals, photos and farewells, the teal gradient for the Akshardham
 * visit, and quiet sand for travel and breaks.
 */
const TINT = {
  programme: "bg-ink-800 text-sand-50",
  meal: "bg-gradient-to-br from-coral-400 to-coral-700 text-white",
  team: "bg-coral-100 text-coral-800",
  devotion: "bg-ember-600 text-white",
  people: "bg-jade-100 text-jade-700",
  mandir: "bg-gradient-to-br from-jade-500 to-ink-800 text-white",
  quiet: "bg-sand-200 text-ink-600",
} as const;

function iconFor(item: ScheduleItemView): { Icon: IconComponent; tint: string } {
  const t = item.title;
  if (/group photo/i.test(t)) return { Icon: Camera, tint: TINT.people };
  // The mandir mark is a detailed silhouette, so it gets a little more room than a line icon.
  if (/akshardham/i.test(t)) return { Icon: () => <MandirMark className="h-[22px] w-[22px]" />, tint: TINT.mandir };
  if (/departure/i.test(t)) return { Icon: (p) => <HandWaving className={p.className} />, tint: TINT.people };
  if (/arrival|check-in/i.test(t)) return { Icon: ClipboardCheck, tint: TINT.people };
  // Darshan / Abhishek / Charansparsh get folded hands; plain Arti keeps the flame below.
  if (/darshan|abhishek|charansparsh/i.test(t)) return { Icon: (p) => <HandsPraying className={p.className} />, tint: TINT.devotion };
  switch (item.kind) {
    case "ARTI":
      return { Icon: Flame, tint: TINT.devotion };
    case "SESSION":
      return { Icon: Presentation, tint: TINT.programme };
    case "BREAKOUT":
      return { Icon: Users, tint: TINT.team };
    case "MEAL":
      return { Icon: UtensilsCrossed, tint: TINT.meal };
    case "BREAK":
      return { Icon: Armchair, tint: TINT.quiet };
    case "TRAVEL":
      return { Icon: RIDE.test(t) ? Bus : Footprints, tint: TINT.quiet };
    default:
      return { Icon: Sparkles, tint: TINT.quiet };
  }
}

const AUDIENCE_LABEL = { ALL: null, BHAIO: "Bhaio", BEHNO: "Behno" } as const;

type Shift = { minutes: number; which: "start" | "end" };

/**
 * How far an organiser moved the item from its printed time (/admin/schedule):
 * the start if it moved, else the end. Null when it is on its printed times.
 */
function shiftFromPrinted(item: ScheduleItemView): Shift | null {
  if (!item.originalStartsAt || !item.originalEndsAt) return null;
  const start = minutesBetween(new Date(item.originalStartsAt), new Date(item.startsAt));
  if (start !== 0) return { minutes: start, which: "start" };
  const end = minutesBetween(new Date(item.originalEndsAt), new Date(item.endsAt));
  return end !== 0 ? { minutes: end, which: "end" } : null;
}

/** "Delayed 15 min" (coral) / "Earlier by 10 min" (jade); end-only moves say when it now ends. */
function ShiftBadge({ shift }: { shift: Shift }) {
  const late = shift.minutes > 0;
  const n = Math.abs(shift.minutes);
  const text =
    shift.which === "start"
      ? late
        ? `Delayed ${n} min`
        : `Earlier by ${n} min`
      : late
        ? `Ends ${n} min later`
        : `Ends ${n} min early`;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ring-inset ${
        late ? "bg-coral-100 text-coral-900 ring-coral-500/30" : "bg-jade-50 text-jade-700 ring-jade-500/30"
      }`}
    >
      <Clock className="h-3 w-3" aria-hidden="true" />
      {text}
    </span>
  );
}

/** A schedule card; becomes a link when the row leads somewhere (e.g. Team Breakouts). */
function CardShell({ href, className, children }: { href?: string; className: string; children: React.ReactNode }) {
  if (!href) return <div className={className}>{children}</div>;
  return (
    <Link href={href} className={`${className} transition hover:shadow-card-lg! active:scale-[0.99]`}>
      {children}
    </Link>
  );
}

export function ScheduleView({
  items,
  initialDay,
  today,
  nowIso,
  showAudience = false,
  linkBreakouts = true,
  breakoutsHref = "/breakouts",
  breakoutsLabel = "View your breakout sessions",
  onDayChange,
}: {
  items: ScheduleItemView[];
  initialDay: string;
  today: string | null;
  nowIso: string;
  /** Label Bhaio/Behno items (only when the guest's gender is unknown). */
  showAudience?: boolean;
  /** Link BREAKOUT rows to the breakouts page (`breakoutsHref`). */
  linkBreakouts?: boolean;
  /** Where BREAKOUT rows lead: the delegate /breakouts page, or /sant/breakouts in the Pujya Santo view. */
  breakoutsHref?: string;
  /** The line under a BREAKOUT row: the delegates' own sessions by default; santos have none of their own. */
  breakoutsLabel?: string;
  /** Called when another day tab is picked, e.g. to keep the day across schedule tabs. */
  onDayChange?: (day: string) => void;
}) {
  const [day, setDay] = useState(initialDay);
  const selectDay = (d: string) => {
    setDay(d);
    onDayChange?.(d);
  };
  // Keep the demo "now" override when jumping to the breakouts page.
  const nowParam = useSearchParams().get("now");
  const breakoutsLink = nowParam
    ? `${breakoutsHref}${breakoutsHref.includes("?") ? "&" : "?"}now=${encodeURIComponent(nowParam)}`
    : breakoutsHref;
  const nowRef = useRef<HTMLLIElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const dayItems = items.filter((i) => i.day === day);

  // Bring the current (or next) item into view on first render. Browsers don't turn smooth
  // scrolling off for reduced motion themselves, so jump there instead.
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    nowRef.current?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reveal each row as it scrolls into view. Rows already scrolled past the top
  // of the app's scroll container (e.g. after auto-scrolling to "now") are shown
  // immediately so scrolling back up never finds blanks. Times and cards stay
  // locked together.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const rows = Array.from(list.children) as HTMLElement[];
    if (!("IntersectionObserver" in window)) {
      rows.forEach((r) => r.classList.add("is-visible"));
      return;
    }
    // Trigger line: a little above the floating nav, measured from the nav itself
    // so it stays correct with safe-area insets. Close enough that the next row
    // is always peeking in (no dead gap that reads as "end of list"), but never
    // so low that the animation starts hidden behind the bar.
    const nav = document.querySelector<HTMLElement>("nav[aria-label=\"Primary\"] ul");
    const navTop = nav?.getBoundingClientRect().top;
    // Only trust the measurement when the bar sits in the lower half of the
    // viewport; if styles haven't applied yet it can be anywhere, and a wild
    // inset would keep every row hidden.
    const navHeight =
      navTop !== undefined && navTop > window.innerHeight / 2 && navTop <= window.innerHeight
        ? window.innerHeight - navTop
        : 96;
    // The observer measures the row in its hidden state, which sits 8px lower than
    // where it will rest (.reveal's translateY in globals.css). Aim at the resting
    // spot: fire when the row will settle with ~36px showing above the nav.
    const HIDDEN_OFFSET = 8;
    const RESTING_PEEK = 36;
    const triggerInset = Math.max(0, Math.round(navHeight + RESTING_PEEK - HIDDEN_OFFSET));
    // The observer watches the viewport (root: null), which is fine inside #app-scroll: a row
    // counts as visible only where the container doesn't clip it, and the container runs to
    // the bottom of the viewport, under the floating nav, so the inset above still applies.
    // Its top edge is the header's bottom edge: a row above that has scrolled past.
    const scrollerTop = () => getScroller()?.getBoundingClientRect().top ?? 0;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting || entry.boundingClientRect.top < scrollerTop()) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0, rootMargin: `0px 0px -${triggerInset}px 0px` },
    );
    rows.forEach((r) => observer.observe(r));
    return () => observer.disconnect();
  }, [day]);

  // Mirror of the entrance: as a row scrolls up towards the header (the top edge
  // of the app's scroll container, where it gets clipped) it progressively blurs,
  // fades and lifts, tied directly to scroll position so it reverses smoothly
  // when scrolling back down. Applied to an inner layer so it never fights the
  // entrance transition on the <li>.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const EXIT_INSET = 32; // px below the scroll container's top edge (the header's bottom)
    const EXIT_RANGE = 130; // distance over which the row fully dissolves
    let frame = 0;
    const update = () => {
      frame = 0;
      const list = listRef.current;
      if (!list) return;
      const EXIT_START = (getScroller()?.getBoundingClientRect().top ?? 0) + EXIT_INSET;
      for (const li of Array.from(list.children) as HTMLElement[]) {
        const layer = li.firstElementChild as HTMLElement | null;
        if (!layer) continue;
        const p = Math.min(1, Math.max(0, (EXIT_START - li.getBoundingClientRect().top) / EXIT_RANGE));
        if (p === 0) {
          if (layer.style.opacity) layer.style.cssText = "";
          continue;
        }
        layer.style.opacity = String(1 - p);
        layer.style.filter = `blur(${(p * 8).toFixed(1)}px)`;
        layer.style.transform = `translate3d(0, ${(-p * 22).toFixed(1)}px, 0) scale(${(1 - p * 0.08).toFixed(3)})`;
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    const unsubscribe = onAppScroll(onScroll);
    window.addEventListener("resize", onScroll);
    return () => {
      unsubscribe();
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [day]);

  return (
    <div>
      <DayTabs days={EVENT_DAYS} selected={day} onSelect={selectDay} today={today} />
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-[1.625rem] leading-tight text-ink-900">{formatDayLong(day)}</h2>
        {today === day && (
          <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.24em] text-coral-800">Today</span>
        )}
      </div>

      {dayItems.length === 0 ? (
        <p className="card p-6 text-center text-sm text-ink-500">Nothing scheduled for this day yet.</p>
      ) : (
        <ol key={day} ref={listRef} className="relative ml-[4.25rem] border-l border-ink-800/15 pb-2">
          {dayItems.map((item) => {
            const { Icon, tint } = iconFor(item);
            const isNow = item.status === "now";
            const isNext = item.status === "next";
            const isPast = item.status === "past";
            const highlight = item.status === "now" || item.status === "next";
            const toBreakouts = linkBreakouts && item.kind === "BREAKOUT";
            const shift = shiftFromPrinted(item);
            return (
              <li
                key={item.id}
                ref={highlight && !nowRef.current ? nowRef : undefined}
                // Past state is a data attribute, not a class: the reveal effect adds
                // `is-visible` imperatively, and a changing className (an item turning
                // past on auto-refresh) would make React overwrite it and hide the row.
                className="reveal relative mb-3"
                data-past={isPast || undefined}
              >
                {/* exit layer: scroll-linked blur-out near the top (see effect above) */}
                <div className="parallax-layer relative origin-top pl-5">
                {/* time gutter */}
                <time
                  dateTime={item.startsAt}
                  className={`absolute -left-[4.25rem] top-3 w-[3.6rem] text-right text-xs font-bold tabular-nums ${
                    isNow ? "text-coral-800" : "text-ink-500"
                  }`}
                >
                  {formatTime(new Date(item.startsAt))}
                </time>
                {/* timeline dot: solid coral now, a coral ring for up next, ink otherwise */}
                <span
                  className={`absolute -left-[5px] top-4 h-2.5 w-2.5 rounded-full border-2 ${
                    isNow
                      ? "border-sand-50 bg-coral-600 ring-4 ring-coral-400/30"
                      : isNext
                        ? "border-coral-600 bg-sand-50"
                        : isPast
                          ? "border-sand-100 bg-ink-300"
                          : "border-sand-100 bg-ink-500"
                  }`}
                  aria-hidden="true"
                />

                <CardShell
                  href={toBreakouts ? breakoutsLink : undefined}
                  // `!` because `.card` is unlayered and would otherwise win over the border and glow.
                  className={`card block p-3.5 ${
                    isNow ? "border-coral-400/60! shadow-glow! ring-1 ring-coral-400/40" : ""
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${tint}`}>
                      <Icon className="h-[18px] w-[18px]" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <h3 className="font-semibold leading-snug text-ink-900">{item.title}</h3>
                        {showAudience && AUDIENCE_LABEL[item.audience] && (
                          <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-ink-700">
                            {AUDIENCE_LABEL[item.audience]}
                          </span>
                        )}
                        <StatusBadge status={item.status} />
                        {shift && <ShiftBadge shift={shift} />}
                      </div>
                      <p className="mt-0.5 text-xs tabular-nums text-ink-500">
                        {shift?.which === "start" && item.originalStartsAt && (
                          <s className="mr-1.5 decoration-coral-600">
                            <span className="sr-only">Originally </span>
                            {formatTime(new Date(item.originalStartsAt))}
                          </s>
                        )}
                        {formatTime(new Date(item.startsAt))} –{" "}
                        {shift?.which === "end" && item.originalEndsAt && (
                          <s className="mr-1 decoration-coral-600">
                            <span className="sr-only">originally </span>
                            {formatTime(new Date(item.originalEndsAt))}
                          </s>
                        )}
                        {formatTime(new Date(item.endsAt))}
                        {item.location && (
                          <>
                            <span className="mx-1.5">·</span>
                            <MapPin className="mr-0.5 inline h-3 w-3 align-[-1px]" />
                            {item.location}
                          </>
                        )}
                      </p>
                      {item.description && <p className="mt-1.5 text-sm text-ink-600">{item.description}</p>}
                      {toBreakouts && (
                        <p className="mt-1.5 text-xs font-bold text-coral-800">{breakoutsLabel}</p>
                      )}
                    </div>
                    {toBreakouts && <ChevronRight className="h-5 w-5 shrink-0 self-center text-coral-600" />}
                  </div>
                </CardShell>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <p className="mt-6 text-center text-[11px] tabular-nums text-ink-500">
        Updated {formatTime(new Date(nowIso))} · refreshes automatically
      </p>
    </div>
  );
}
