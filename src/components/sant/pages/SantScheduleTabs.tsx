"use client";

import { useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { CalendarDays, ChevronRight, UserRound } from "lucide-react";
import type { ScheduleItemView } from "@/lib/schedule";
import { SANT_DAYS } from "@/lib/time";
import { ScheduleView } from "@/components/ScheduleView";
import { SantDayChips } from "@/components/sant/pages/SantDayChips";
import { SantEmptyState } from "@/components/sant/pages/SantEmptyState";

type Tab = "personal" | "general";

const TABS = [
  { id: "personal", label: "My schedule", icon: UserRound },
  { id: "general", label: "General", icon: CalendarDays },
] as const;

function parseTab(value: string | null): Tab | null {
  return value === "personal" || value === "general" ? value : null;
}

const inList = (days: readonly string[], day: string | null): day is string => day !== null && days.includes(day);

/**
 * Breakout rows lead to /sant/breakouts (keeping ?now=), where santos pick a session to join:
 * they have no breakout sessions of their own, so not "View your breakout sessions". Neither list
 * has a BREAKOUT row since 2026-10-03 (the general schedule's old "Pujya Santo Session" slots now
 * hold the update sessions, SESSION in Yogi Hall, and the personal programmes leave out the sheet's
 * "Santo Breakout" rows), so no row links there for now; /sant/breakouts itself is unchanged.
 */
const BREAKOUTS_HREF = "/sant/breakouts";
const BREAKOUTS_LABEL = "See the sessions you can join";

/** SANT_DAYS plus any other day his own programme has something on, in order, so no item is out of reach. */
function daysWithItems(items: ScheduleItemView[]): string[] {
  return [...new Set([...SANT_DAYS, ...items.map((i) => i.day)])].sort();
}

/**
 * /sant/schedule body: a "My schedule | General" segmented control over the
 * shared <ScheduleView>. The tab lives in ?tab= so it can be linked to
 * (/sant/schedule?tab=general); switching is instant and rewrites the URL in
 * place, keeping ?now= and any other parameters.
 *
 * Both tabs run over the Santo days (SANT_DAYS, Oct 5-15), as the Santo home
 * does, picked with <SantDayChips>, a strip that scrolls sideways; ScheduleView's
 * own day tabs (the four NAAM days) are hidden. "My schedule" is his personal
 * programme, with any day it has outside SANT_DAYS added to its strip. "General"
 * is the Santo general schedule. A day picked on one tab is kept when switching
 * to the other if that tab has it.
 */
export function SantScheduleTabs({
  personal,
  general,
  personalInitialDay,
  generalInitialDay,
  today,
  nowIso,
}: {
  personal: ScheduleItemView[];
  general: ScheduleItemView[];
  /**
   * Day shown first on each tab until the sant picks one: a SANT_DAYS day (for My schedule, also
   * any other day his programme has something on).
   */
  personalInitialDay: string;
  generalInitialDay: string;
  /** Today (YYYY-MM-DD in EVENT_TZ) while it is a Santo day, else null. */
  today: string | null;
  nowIso: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlTab = parseTab(searchParams.get("tab"));
  const [tab, setTab] = useState<Tab>(urlTab ?? "personal");

  // Follow the address bar when it changes from outside this component (a
  // link to ?tab=general, the Schedule nav item, "back to real time").
  const [seenUrlTab, setSeenUrlTab] = useState(urlTab);
  if (urlTab !== seenUrlTab) {
    setSeenUrlTab(urlTab);
    setTab(urlTab ?? "personal");
  }

  const [pickedDay, setPickedDay] = useState<string | null>(null);

  const select = (next: Tab) => {
    if (next === tab) return;
    setTab(next);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", next);
    // Next.js syncs history.replaceState with useSearchParams; no server round trip,
    // and tab switches don't pile up in the back history.
    window.history.replaceState(null, "", `${pathname}?${params.toString()}`);
  };

  const listFor = (t: Tab) => (t === "personal" ? personal : general);
  const personalDays = useMemo(() => daysWithItems(personal), [personal]);
  const personalDay = inList(personalDays, pickedDay) ? pickedDay : personalInitialDay;
  const generalDay = inList(SANT_DAYS, pickedDay) ? pickedDay : generalInitialDay;

  return (
    <div>
      <div
        role="tablist"
        aria-label="Schedule"
        className="mb-4 grid grid-cols-2 gap-1 rounded-2xl border border-white/70 bg-white/60 p-1 shadow-card backdrop-blur-sm"
      >
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = id === tab;
          // Flag the other tab when something on it is happening right now.
          const liveThere = !active && listFor(id).some((i) => i.status === "now");
          return (
            <button
              key={id}
              type="button"
              role="tab"
              id={`sant-schedule-tab-${id}`}
              aria-selected={active}
              aria-controls="sant-schedule-panel"
              onClick={() => select(id)}
              className={`relative flex min-h-11 items-center justify-center gap-2 rounded-xl px-2 py-2.5 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral-700 ${
                active
                  ? "bg-gradient-to-br from-coral-700 to-ember-700 text-white shadow-glow"
                  : "text-ink-600 hover:bg-white/70 hover:text-ink-900"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" strokeWidth={active ? 2.4 : 2} />
              {label}
              {liveThere && (
                <>
                  <span
                    aria-hidden="true"
                    className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-coral-600 motion-safe:animate-pulse-soft"
                  />
                  <span className="sr-only">(happening now)</span>
                </>
              )}
            </button>
          );
        })}
      </div>

      <div id="sant-schedule-panel" role="tabpanel" aria-labelledby={`sant-schedule-tab-${tab}`}>
        {tab === "personal" && personal.length === 0 ? (
          <SantEmptyState
            icon={CalendarDays}
            title="Your personal programme will appear here"
            action={
              <button
                type="button"
                onClick={() => select("general")}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-coral-700/20 bg-coral-50 px-4 py-2 text-sm font-semibold text-coral-800 transition hover:bg-coral-100 active:scale-[0.98]"
              >
                See the general programme
                <ChevronRight className="h-4 w-4" />
              </button>
            }
          >
            Travel, puja and pravachan timings arranged for you will be listed here, day by day. Meanwhile, the
            General tab has the full programme.
          </SantEmptyState>
        ) : tab === "personal" ? (
          <>
            <SantDayChips days={personalDays} selected={personalDay} onSelect={setPickedDay} today={today} />
            {/* ScheduleView's own day tabs (its root's first child) only know the four NAAM days,
                so they are hidden; the chips above pick the day and remount the timeline on it
                (per tab and day, so its reveal and scroll effects start fresh). */}
            <div className="[&>div>[role=tablist]:first-child]:hidden">
              <ScheduleView
                key={`personal:${personalDay}`}
                items={personal}
                initialDay={personalDay}
                today={today}
                nowIso={nowIso}
                showAudience={false}
                breakoutsHref={BREAKOUTS_HREF}
                breakoutsLabel={BREAKOUTS_LABEL}
              />
            </div>
          </>
        ) : (
          <>
            <SantDayChips days={SANT_DAYS} selected={generalDay} onSelect={setPickedDay} today={today} />
            {/* As above: the chips pick the day, ScheduleView's own NAAM day tabs are hidden. */}
            <div className="[&>div>[role=tablist]:first-child]:hidden">
              <ScheduleView
                key={`general:${generalDay}`}
                items={general}
                initialDay={generalDay}
                today={today}
                nowIso={nowIso}
                showAudience={false}
                breakoutsHref={BREAKOUTS_HREF}
                breakoutsLabel={BREAKOUTS_LABEL}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
