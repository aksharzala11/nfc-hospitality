import { DRESS_TRACK_LABEL, dressCodeFor, type DressTrack } from "@/lib/dressCode";
import { formatDayLong, formatDayShort } from "@/lib/time";

/**
 * One track's dress code on /dress-code: the track's name, then a card with a
 * row per event day (src/lib/dressCode.ts): the date as a small calendar tile
 * and in full, what to wear, and what goes with it. `today` is the event-time
 * day ("YYYY-MM-DD", from pageNow(), so ?now= moves it): that day's row is
 * marked "Today" on pale coral, and the days before it step back (sand tile,
 * quieter text). ISO day strings compare as dates.
 */
export function DressCodeCard({ track, today }: { track: DressTrack; today: string }) {
  const headingId = `dress-${track.toLowerCase()}`;
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="mb-2.5 px-1 text-[11px] font-bold uppercase tracking-[0.22em] text-ink-500">
        {DRESS_TRACK_LABEL[track]}
      </h2>
      <ol className="card divide-y divide-sand-200 overflow-hidden">
        {dressCodeFor(track).map(({ day, wear, note }) => {
          const isToday = day === today;
          const past = day < today;
          // "Thu, Oct 8" -> the tile's "Thu" over "8".
          const weekday = formatDayShort(day).split(",")[0];
          return (
            <li
              key={day}
              aria-current={isToday ? "date" : undefined}
              className={`flex items-center gap-3.5 px-4 py-3.5 ${isToday ? "bg-coral-50" : ""}`}
            >
              {/* Ink for today, pale ink for the days ahead, sand once gone by (all AA for the text inside). */}
              <span
                aria-hidden="true"
                className={`flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-2xl ${
                  isToday
                    ? "bg-ink-800 text-white"
                    : past
                      ? "bg-sand-100 text-ink-500 ring-1 ring-inset ring-sand-200"
                      : "bg-ink-100 text-ink-800"
                }`}
              >
                <span
                  className={`text-[10px] font-bold uppercase leading-none tracking-caps ${isToday ? "text-coral-200" : ""}`}
                >
                  {weekday}
                </span>
                <span className="mt-1 text-lg font-bold leading-none tabular-nums">{Number(day.slice(8))}</span>
              </span>

              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500">
                  <time dateTime={day}>{formatDayLong(day)}</time>
                  {isToday && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-coral-400 px-2 py-0.5 text-[10px] font-bold uppercase leading-4 tracking-caps text-ink-950">
                      <span
                        aria-hidden="true"
                        className="h-1.5 w-1.5 rounded-full bg-current motion-safe:animate-pulse-soft"
                      />
                      Today
                    </span>
                  )}
                </p>
                <p
                  className={`mt-0.5 break-words text-[1.0625rem] leading-snug ${
                    past ? "font-medium text-ink-600" : "font-semibold text-ink-900"
                  }`}
                >
                  {wear}
                </p>
                {note && <p className="mt-0.5 break-words text-sm leading-snug text-ink-600">{note}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
