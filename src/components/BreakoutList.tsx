import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import { MapPin, UserRound } from "lucide-react";
import type { BreakoutView } from "@/lib/schedule";
import { formatDayLong, formatTime } from "@/lib/time";
import { StatusBadge } from "@/components/StatusBadge";

// The list's coral accent. `.card` (globals.css) is unlayered, so it beats plain utilities:
// the border and shadow overrides below need Tailwind's trailing `!` to show at all.
const ACCENT = {
  icon: "text-coral-700",
  nowCard: "border-coral-400/60! shadow-glow! ring-1 ring-coral-400/40",
  nowTime: "text-coral-800",
  dayRule: "from-coral-400/60",
};

/** The rooms / facilitator chips; rounded-2xl so a wrapped chip still reads as one box. */
const CHIP = "inline-flex min-w-0 max-w-full items-start gap-1.5 rounded-2xl px-2.5 py-1";

/**
 * Finished sessions sit back on a flat sand surface with quiet icons. The text
 * keeps its colours (no opacity fade), so it still clears WCAG AA.
 */
const PAST_CARD = "border-sand-200/80! bg-sand-50/60! shadow-none!";

const TRACK_LABEL = { ALL: null, BHAIO: "Bhaio", BEHNO: "Behno" } as const;

/**
 * Breakout sessions grouped by event day: time, Now / Up next badge, title,
 * room(s) and facilitator, then the description (for the real sessions, the
 * note under the rooms, e.g. "Split amongst these rooms."); the session in
 * progress glows and finished ones step back. Several rooms come as one
 * " · "-joined string and wrap inside their chip at phone width. A Bhaio / Behno label shows only when the list
 * mixes both tracks (a guest with no gender on file). The delegate /breakouts
 * page's list (the Pujya Santo view has its own breakout blocks, with no
 * sessions of their own: src/components/sant/pages/SantBreakoutBlocks.tsx); it
 * renders its own empty state, so pass a non-empty list (from annotateBreakouts(), in
 * time order). The viewer's goshthi group is not on the cards: each group meets
 * in its own room during the Goshthi sessions, so the delegate page shows it
 * (with that room) in its header instead.
 *
 * `roomHref` (a session's room -> its /map link, null for a room not on the venue map) links
 * each such room to its directions; rooms not on the map stay plain text. `howTo` wraps a card's
 * content, e.g. in <BreakoutHowTo> (its "How to get there" section); the page does the
 * wrapping, so this list never loads that client island. Without them (no venue map) the cards
 * are plain.
 */
export function BreakoutList({
  sessions,
  roomHref,
  howTo,
}: {
  sessions: BreakoutView[];
  roomHref?: (session: BreakoutView, room: string) => string | null;
  howTo?: (session: BreakoutView, card: ReactNode) => ReactNode;
}) {
  const byDay = new Map<string, BreakoutView[]>();
  for (const s of sessions) byDay.set(s.day, [...(byDay.get(s.day) ?? []), s]);
  const accent = ACCENT;
  const showTrack = sessions.some((s) => s.audience === "BHAIO") && sessions.some((s) => s.audience === "BEHNO");

  return (
    <div className="space-y-8">
      {[...byDay.entries()].map(([day, list]) => (
        <section key={day}>
          <div className="mb-3 flex items-center gap-3">
            <h2 className="font-display shrink-0 text-[1.625rem] leading-tight text-ink-900">{formatDayLong(day)}</h2>
            <span aria-hidden="true" className={`h-px flex-1 bg-gradient-to-r ${accent.dayRule} to-transparent`} />
          </div>
          <ul className="space-y-3 stagger">
            {list.map((s) => {
              const isNow = s.status === "now";
              const isPast = s.status === "past";
              const icon = isPast ? "text-ink-400" : accent.icon;
              const body = (
                <>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <time
                      dateTime={s.startsAt}
                      className={`text-xs font-bold tabular-nums ${isNow ? accent.nowTime : "text-ink-500"}`}
                    >
                      {formatTime(new Date(s.startsAt))} – {formatTime(new Date(s.endsAt))}
                    </time>
                    {showTrack && TRACK_LABEL[s.audience] && (
                      <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-ink-700">
                        {TRACK_LABEL[s.audience]}
                      </span>
                    )}
                    <StatusBadge status={s.status} />
                  </div>
                  <h3 className={`font-display mt-1.5 text-[1.375rem] leading-tight ${isPast ? "text-ink-700" : "text-ink-900"}`}>
                    {s.title}
                  </h3>
                  {/* rounded-2xl rather than -full: still a pill on one line, a rounded
                      box when several rooms wrap onto a second line. */}
                  <div className="mt-2.5 flex flex-wrap gap-2 text-xs font-semibold leading-4 text-ink-700">
                    <span className={`${CHIP} bg-sand-100`}>
                      <MapPin aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 translate-y-px ${icon}`} />
                      <span className="min-w-0 break-words">
                        <span className="sr-only">{s.room.includes(" · ") ? "Rooms: " : "Room: "}</span>
                        {roomHref
                          ? s.room.split(" · ").map((name, i) => {
                              const href = roomHref(s, name.trim());
                              return (
                                <Fragment key={i}>
                                  {i > 0 && " · "}
                                  {href ? (
                                    <Link
                                      href={href}
                                      className="underline decoration-coral-400 decoration-2 underline-offset-2 hover:text-coral-800"
                                    >
                                      {name}
                                      <span className="sr-only"> (directions on the venue map)</span>
                                    </Link>
                                  ) : (
                                    name
                                  )}
                                </Fragment>
                              );
                            })
                          : s.room}
                      </span>
                    </span>
                    {s.facilitator && (
                      <span className={`${CHIP} bg-sand-100`}>
                        <UserRound aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 translate-y-px ${icon}`} />
                        <span className="min-w-0 break-words">{s.facilitator}</span>
                      </span>
                    )}
                  </div>
                  {s.description && <p className="mt-2 text-sm leading-snug text-ink-600">{s.description}</p>}
                </>
              );
              return (
                <li key={s.id} className={`card p-4 ${isPast ? PAST_CARD : ""} ${isNow ? accent.nowCard : ""}`}>
                  {howTo ? howTo(s, body) : body}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
