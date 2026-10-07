"use client";

import { useState } from "react";
import { CheckCircle2, Clock, Lock, MapPin, Vegan } from "lucide-react";
import type { MealView } from "@/lib/schedule";
import { formatDayLong, formatRelative, formatTime } from "@/lib/time";
import { DayTabs } from "@/components/DayTabs";

/**
 * Dish tags, by meaning: allergens ("Contains …") in ember, "Tentative" as a
 * coral caution with a dashed edge, dietary notes in ink, anything else on sand.
 * Vegan tags render as their own jade badge (below).
 */
const TAG_STYLE: Record<string, string> = {
  "Gluten-free": "bg-ink-50 text-ink-700 ring-1 ring-inset ring-ink-800/15",
  "Jain-friendly": "bg-ink-50 text-ink-700 ring-1 ring-inset ring-ink-800/15",
  Tentative: "border border-dashed border-coral-500/70 bg-coral-50 text-coral-900",
};

/** Allergen tags ("Contains almonds", "Contains peanuts", …) share one style. */
function tagStyle(tag: string) {
  if (/^contains /i.test(tag)) return "bg-ember-500/10 text-ember-700 ring-1 ring-inset ring-ember-500/25";
  return TAG_STYLE[tag] ?? "bg-sand-100 text-ink-600 ring-1 ring-inset ring-ink-800/10";
}

/** Short pill label: "Delegate Breakfast" -> "Breakfast", "Snacks & Travel" -> "Snacks". */
function shortName(name: string) {
  if (/breakfast/i.test(name)) return "Breakfast";
  if (/lunch/i.test(name)) return "Lunch";
  if (/snack/i.test(name)) return "Snacks";
  if (/dinner/i.test(name)) return "Dinner";
  return name;
}

/** The meal a guest most likely wants: the first one that hasn't finished yet. */
function pickDefault(meals: MealView[], now: Date) {
  return (meals.find((m) => new Date(m.endsAt) > now) ?? meals[meals.length - 1])?.id ?? null;
}

/**
 * Accent of the selected meal pill and the menu board. "coral" is the delegate
 * hub: a coral pill over an ink menu board, the brand guide's coral-on-ink.
 * "bhagwa" is the Pujya Santo view: the deeper coral into ember, on a warm
 * ember board. (The names predate the Sāchu theme; callers pass them as-is.)
 */
export type MenuTone = "coral" | "bhagwa";

type Tone = {
  /** Selected meal pill, its time label and its live dot. */
  pill: string;
  pillTime: string;
  pillDot: string;
  /** Menu-board header: background, soft glow, the brand strip along its foot. */
  board: string;
  boardGlow: string;
  boardStrip: string;
  /** Board text: the tracked day label, and the time / place / note lines. */
  eyebrow: string;
  meta: string;
  /** "Serving now" pill on the board, and the quieter "Served" pill. */
  serving: string;
  servingDot: string;
  served: string;
  /** Course headings and their hairline. */
  course: string;
  courseRule: string;
  /** Locked-menu icon tile. */
  lock: string;
};

// Every small text here clears WCAG AA on its own background (e.g. ink-950 on
// coral-400 is 6.5:1; white on coral-400 would only be 2.3:1).
const TONES: Record<MenuTone, Tone> = {
  coral: {
    pill: "bg-coral-400 text-ink-950 shadow-glow",
    pillTime: "text-ink-900",
    pillDot: "bg-ink-950",
    board: "bg-gradient-to-br from-ink-800 via-ink-800 to-ink-950",
    boardGlow: "bg-coral-400/25",
    boardStrip: "from-coral-400 to-coral-700",
    eyebrow: "text-coral-300",
    meta: "text-white/75",
    serving: "bg-coral-400 text-ink-950",
    servingDot: "bg-ink-950",
    served: "bg-white/15 text-white",
    course: "text-coral-800",
    courseRule: "from-coral-400/60",
    lock: "bg-ink-800 text-coral-300 shadow-card",
  },
  bhagwa: {
    pill: "bg-gradient-to-br from-coral-700 to-ember-600 text-white shadow-glow",
    pillTime: "text-white",
    pillDot: "bg-white",
    board: "bg-gradient-to-br from-ember-700 via-ember-600 to-coral-700",
    boardGlow: "bg-coral-400/35",
    boardStrip: "from-coral-300 to-coral-500",
    eyebrow: "text-coral-100",
    meta: "text-white",
    serving: "bg-white text-ember-700",
    servingDot: "bg-ember-600",
    // Solid deep ember, not white/15: over the board's coral-700 end and glow that
    // would drop white 11px text below AA. The white rim keeps it visible on ember-700.
    served: "bg-ember-700 text-white ring-1 ring-inset ring-white/25",
    course: "text-ember-600",
    courseRule: "from-ember-500/40",
    lock: "bg-ember-500/10 text-ember-600",
  },
};

export function MenuView({
  meals,
  initialDay,
  today,
  nowIso,
  tone = "coral",
}: {
  meals: MealView[];
  initialDay: string;
  today: string | null;
  nowIso: string;
  /** "bhagwa" in the Pujya Santo view (/sant/menu). */
  tone?: MenuTone;
}) {
  const accent = TONES[tone];
  const days = [...new Set(meals.map((m) => m.day))].sort();
  const startDay = days.includes(initialDay) ? initialDay : (days[0] ?? initialDay);
  const now = new Date(nowIso);
  const [day, setDay] = useState(startDay);
  const [mealId, setMealId] = useState<string | null>(() => pickDefault(meals.filter((m) => m.day === startDay), now));

  const dayMeals = meals.filter((m) => m.day === day);
  const meal = dayMeals.find((m) => m.id === mealId) ?? dayMeals[0];

  const selectDay = (d: string) => {
    setDay(d);
    setMealId(pickDefault(meals.filter((m) => m.day === d), now));
  };

  return (
    <div>
      <DayTabs days={days} selected={day} onSelect={selectDay} today={today} />

      {/* Meal selector */}
      <div className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {dayMeals.map((m) => {
          const active = m.id === meal?.id;
          const start = new Date(m.startsAt);
          const end = new Date(m.endsAt);
          const live = m.status === "revealed" && now >= start && now < end;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setMealId(m.id)}
              aria-pressed={active}
              className={`flex h-11 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-bold transition active:scale-[0.97] ${
                active ? accent.pill : "bg-white/85 text-ink-700 shadow-card ring-1 ring-inset ring-ink-800/5 hover:text-ink-900"
              }`}
            >
              {m.status === "locked" && <Lock className="h-3.5 w-3.5 opacity-70" />}
              {m.status === "served" && <CheckCircle2 className="h-3.5 w-3.5 opacity-70" />}
              {live && (
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 rounded-full motion-safe:animate-pulse-soft ${active ? accent.pillDot : "bg-coral-600"}`}
                />
              )}
              {shortName(m.name)}
              <span className={`text-[11px] font-medium tabular-nums ${active ? accent.pillTime : "text-ink-500"}`}>
                {formatTime(start)}
              </span>
            </button>
          );
        })}
      </div>

      {meal ? <MealPanel key={meal.id} meal={meal} now={now} day={day} tone={tone} /> : (
        <p className="card p-6 text-center text-sm text-ink-500">No meals listed for {formatDayLong(day)}.</p>
      )}
    </div>
  );
}

function MealPanel({ meal, now, day, tone }: { meal: MealView; now: Date; day: string; tone: MenuTone }) {
  const start = new Date(meal.startsAt);
  const end = new Date(meal.endsAt);
  const revealsAt = new Date(meal.revealsAt);
  const live = now >= start && now < end;
  const accent = TONES[tone];

  return (
    <section className="card overflow-hidden">
      {/* Menu-board header */}
      <header className={`relative overflow-hidden px-5 pb-5 pt-4 text-white ${accent.board}`}>
        <div className={`absolute -right-8 -top-10 h-32 w-32 rounded-full ${accent.boardGlow} blur-2xl`} aria-hidden="true" />
        <div className="relative">
          <p className={`text-[11px] font-bold uppercase tracking-[0.24em] ${accent.eyebrow}`}>{formatDayLong(day)}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <h2 className="font-display text-[1.875rem] leading-[1.1]">{meal.name}</h2>
            {live && meal.status === "revealed" && (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.14em] ${accent.serving}`}
              >
                <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full motion-safe:animate-pulse-soft ${accent.servingDot}`} />
                Serving now
              </span>
            )}
            {meal.status === "served" && (
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.14em] ${accent.served}`}>
                Served
              </span>
            )}
          </div>
          <p className={`mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs font-medium ${accent.meta}`}>
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Clock className="h-3 w-3" />
              {formatTime(start)} – {formatTime(end)}
            </span>
            {meal.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {meal.location}
              </span>
            )}
          </p>
          {meal.note && <p className={`mt-1 text-xs ${accent.meta}`}>{meal.note}</p>}
        </div>
        {/* The brand gradient as a thin strip along the board's foot. */}
        <span aria-hidden="true" className={`absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r ${accent.boardStrip}`} />
      </header>

      {meal.status === "locked" ? (
        <div className="flex flex-col items-center px-6 py-10 text-center">
          <span className={`mb-4 flex h-12 w-12 items-center justify-center rounded-2xl ${accent.lock}`}>
            <Lock className="h-5 w-5" />
          </span>
          <p className="font-display text-[1.375rem] leading-tight text-ink-900">Menu not yet revealed</p>
          <p className="mt-1.5 text-sm text-ink-500">
            Opens at <span className="font-bold tabular-nums text-ink-800">{formatTime(revealsAt)}</span> ·{" "}
            {formatRelative(now, revealsAt)}
          </p>
        </div>
      ) : (
        <div className="px-4 pb-5 pt-5">
          {meal.courses.map((course) => (
            <div key={course.course} className="mb-5 last:mb-0">
              <div className="mb-2.5 flex items-center gap-3">
                <h3 className={`shrink-0 text-[11px] font-bold uppercase tracking-[0.22em] ${accent.course}`}>{course.course}</h3>
                <span className={`h-px flex-1 bg-gradient-to-r ${accent.courseRule} to-transparent`} aria-hidden="true" />
              </div>
              <ul className="grid grid-cols-2 gap-2">
                {course.items.map((item) => {
                  const wide = (item.description?.length ?? 0) > 36 || item.name.length > 26;
                  return (
                    <li
                      key={item.id}
                      className={`rounded-2xl border border-sand-200 bg-sand-50 px-3 py-2.5 ${wide ? "col-span-2" : ""}`}
                    >
                      <p className="text-sm font-semibold leading-snug text-ink-900">{item.name}</p>
                      {item.description && <p className="mt-0.5 text-xs leading-snug text-ink-500">{item.description}</p>}
                      {item.tags.length > 0 && (
                        <p className="mt-1.5 flex flex-wrap gap-1">
                          {item.tags.map((tag) =>
                            /^vegan/i.test(tag) ? (
                              <span
                                key={tag}
                                title={tag}
                                aria-label={tag}
                                className="inline-flex items-center gap-1 rounded-full bg-jade-50 py-0.5 pl-0.5 pr-1.5 text-[10px] font-bold text-jade-700 ring-1 ring-inset ring-jade-500/30"
                              >
                                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-jade-600 text-white">
                                  <Vegan className="h-3 w-3" strokeWidth={2.4} />
                                </span>
                                {/option/i.test(tag) ? "option" : null}
                              </span>
                            ) : (
                            <span
                              key={tag}
                              className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${tagStyle(tag)}`}
                            >
                              {tag}
                            </span>
                            ),
                          )}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
