import { MapPin, Users } from "lucide-react";
import type { TimePair } from "@/lib/admin/schedule";
import type { TeamSession } from "@/lib/admin/scheduleTeams";
import { TrackChip, plural, timeOf } from "./ui";

/**
 * The seva filter's view of a "Team Breakouts" slot: the picked teams'
 * sessions inside it (title, track, time, room(s)), as a compact nested list
 * under the slot's row (`variant="row"`) or a card in its action sheet
 * (`variant="sheet"`, which can also show the times a previewed change would
 * give them). Display only; server- and client-safe.
 */
export function TeamSessions({
  sessions,
  forText,
  showTeams,
  nowMs,
  variant,
  quiet = false,
  planned,
  track = null,
}: {
  sessions: TeamSession[];
  /** Who they are for, e.g. "BM RA" (see sevaFilterText()). */
  forText: string;
  /** Name each session's teams (the filter covers several). */
  showTeams: boolean;
  nowMs: number;
  variant: "row" | "sheet";
  /** A past row: quieter text, as ScheduleList's past rows. */
  quiet?: boolean;
  /** Sheet: planned times by breakout id, from the change being previewed. */
  planned?: ReadonlyMap<string, TimePair>;
  /** Row: the track the list is narrowed to ("Bhaio" / "Behno"); null = both tracks. */
  track?: string | null;
}) {
  const unit = track ? `${track} session` : "session";
  const heading =
    sessions.length > 0 ? `${plural(sessions.length, unit)} for ${forText}` : `No ${unit}s for ${forText} in this slot`;
  const list = sessions.length > 0 && (
    <ul className={variant === "sheet" ? "mt-2 divide-y divide-ink-800/8" : "mt-1 space-y-1.5"}>
      {sessions.map((s) => (
        <Session key={s.key} session={s} showTeams={showTeams} nowMs={nowMs} quiet={quiet} planned={planned} padded={variant === "sheet"} />
      ))}
    </ul>
  );

  if (variant === "sheet") {
    return (
      <section aria-label={`Team breakouts for ${forText}`} className="mt-5 rounded-2xl border border-ink-800/10 bg-white px-3.5 py-3">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink-900">
          <Users aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-500" />
          {heading}
        </h3>
        {list}
      </section>
    );
  }
  return (
    <div className="border-l-2 border-ink-800/12 pl-3">
      <p className={`flex items-center gap-1.5 text-[11px] font-semibold ${quiet ? "text-ink-500" : "text-ink-600"}`}>
        <Users aria-hidden="true" className="h-3 w-3 shrink-0" />
        {heading}
      </p>
      {list}
    </div>
  );
}

function Session({
  session: s,
  showTeams,
  nowMs,
  quiet,
  planned,
  padded,
}: {
  session: TeamSession;
  showTeams: boolean;
  nowMs: number;
  quiet: boolean;
  planned?: ReadonlyMap<string, TimePair>;
  padded: boolean;
}) {
  const start = Date.parse(s.startsAt);
  const end = Date.parse(s.endsAt);
  const isNow = start <= nowMs && nowMs < end;
  const muted = quiet || end <= nowMs;
  // Folded rows share their times, so one planned move stands for all of them.
  const next = planned?.get(s.ids[0]);
  const moves = next !== undefined && (next.start !== s.startsAt || next.end !== s.endsAt);
  const teams = showTeams && !(s.teams.length === 1 && s.teams[0] === s.title) ? s.teams : [];

  return (
    <li className={padded ? "py-2 first:pt-1 last:pb-0" : ""}>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <span className={`text-[13px] font-semibold leading-snug [overflow-wrap:anywhere] ${muted ? "text-ink-600" : "text-ink-900"}`}>
          {s.title}
        </span>
        <TrackChip audience={s.audience} />
        {isNow && (
          <span className="rounded-full bg-coral-700 px-1.5 text-[10px] font-bold uppercase leading-4 tracking-[0.12em] text-white">
            Now
          </span>
        )}
      </div>
      <p className={`mt-0.5 text-xs tabular-nums [overflow-wrap:anywhere] ${muted ? "text-ink-500" : "text-ink-600"}`}>
        {moves ? (
          <>
            <span className="sr-only">New time </span>
            <span className="font-semibold text-ink-900">
              {timeOf(next.start)} – {timeOf(next.end)}
            </span>{" "}
            <span className="sr-only">, currently </span>
            <s>
              {timeOf(s.startsAt)} – {timeOf(s.endsAt)}
            </s>
          </>
        ) : (
          <>
            {timeOf(s.startsAt)} – {timeOf(s.endsAt)}
          </>
        )}
        <span className="mx-1.5" aria-hidden="true">
          ·
        </span>
        <MapPin aria-hidden="true" className="mr-0.5 inline h-3 w-3 align-[-1px]" />
        <span className="sr-only">Room: </span>
        {s.room}
      </p>
      {teams.length > 0 && (
        <p className="mt-0.5 text-[11px] text-ink-500">
          <span className="sr-only">Teams: </span>
          {teams.join(" · ")}
        </p>
      )}
    </li>
  );
}
