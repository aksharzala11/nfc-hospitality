import { CircleCheck, CircleDashed, Clock, MapPin, Route, type LucideIcon } from "lucide-react";
import type { BreakoutSlot, TeamState, TeamWhereabouts, Whereabouts } from "@/lib/admin/overview";
import { BADGE, TRACK_CHIP } from "@/components/admin/shell/ui";
import { CardHeader, EmptyState, ShiftBadge } from "./parts";

/** What a team is doing when no session is in progress: neutral while more is to come, jade once done. */
const STATE: Record<Exclude<TeamState, "now">, { icon: LucideIcon; label: string; tone: string }> = {
  between: { icon: CircleDashed, label: "No breakout now", tone: "bg-ink-800/6 text-ink-500" },
  notToday: { icon: CircleDashed, label: "No breakouts today", tone: "bg-ink-800/6 text-ink-500" },
  doneToday: { icon: CircleCheck, label: "Done for today", tone: "bg-jade-100 text-jade-700" },
  complete: { icon: CircleCheck, label: "All breakouts done", tone: "bg-jade-100 text-jade-700" },
};

/**
 * With the seva filter: where the picked teams are, as one tile per team and
 * track with its breakout in progress (or why there is none: "No breakout
 * now", "Done for today"...) and the next one. Honours ?now= (the page's now).
 * Phones stack the tiles; tablets and desktops lay them two and three across.
 */
export function WhereTheyAre({
  whereabouts,
  scope,
  href,
  className = "",
}: {
  whereabouts: Whereabouts;
  /** The seva filter's label (SevaScope.label), e.g. "BM RA, SA". */
  scope: string;
  /** /admin/schedule, with ?now= and the seva filter. */
  href: string;
  className?: string;
}) {
  const { teams, noSessions } = whereabouts;

  return (
    <section aria-labelledby="where-they-are" className={`card overflow-hidden ${className}`}>
      <CardHeader
        id="where-they-are"
        title="Where they are"
        subtitle={`Team breakouts for ${scope}`}
        href={href}
        linkLabel="Schedule"
      />
      {teams.length === 0 ? (
        <EmptyState
          icon={Route}
          title="No team breakouts"
          body={`None of the breakout sessions are for ${noSessions.length ? noSessions.join(", ") : scope}.`}
        />
      ) : (
        <>
          <ul className="grid gap-3 p-4 md:grid-cols-2 lg:grid-cols-3">
            {teams.map((team) => (
              <TeamTile key={team.key} team={team} />
            ))}
          </ul>
          {noSessions.length > 0 && (
            <p className="border-t border-ink-800/8 px-4 py-3 text-xs leading-snug text-ink-600">
              No breakout sessions for {noSessions.join(", ")}.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function TeamTile({ team }: { team: TeamWhereabouts }) {
  const track = TRACK_CHIP[team.track];
  return (
    <li className="min-w-0 rounded-2xl border border-ink-800/8 bg-sand-50/80 p-3.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 className="break-words font-semibold leading-snug text-ink-900">{team.team}</h3>
        <span className={`${BADGE} ${track.tone}`}>{track.label}</span>
        {team.via.length > 0 && <span className="text-[11px] text-ink-500">for {team.via.join(", ")}</span>}
      </div>
      {team.state === "now" ? (
        team.now.map((slot) => <Slot key={slot.id} slot={slot} mode="now" />)
      ) : (
        <StateLine state={team.state} />
      )}
      {team.next && <Slot slot={team.next} mode="next" />}
    </li>
  );
}

function StateLine({ state }: { state: Exclude<TeamState, "now"> }) {
  const { icon: Icon, label, tone } = STATE[state];
  return (
    <p className="mt-3 flex items-center gap-2.5 text-sm font-semibold text-ink-700">
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${tone}`}>
        <Icon aria-hidden="true" className="h-3.5 w-3.5" />
      </span>
      {label}
    </p>
  );
}

function Slot({ slot, mode }: { slot: BreakoutSlot; mode: "now" | "next" }) {
  const isNow = mode === "now";
  return (
    <div className="mt-3 flex items-start gap-2.5">
      {isNow ? (
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-jade-500 to-ink-800">
          <span className="h-1.5 w-1.5 rounded-full bg-coral-400 motion-safe:animate-pulse-soft" />
        </span>
      ) : (
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sand-200 text-ink-500">
          <Clock aria-hidden="true" className="h-3.5 w-3.5" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className={`text-[10px] font-bold uppercase tracking-[0.14em] ${isNow ? "text-coral-800" : "text-ink-500"}`}>
          {isNow ? "Now" : "Up next"}
          <span className="text-[11px] font-semibold normal-case tracking-normal text-ink-500"> · {slot.relative}</span>
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="break-words text-sm font-semibold leading-snug text-ink-900">{slot.title}</p>
          <ShiftBadge item={slot} />
        </div>
        <p className="mt-0.5 text-xs leading-snug text-ink-600">
          <MapPin aria-hidden="true" className="mr-0.5 inline h-3 w-3 align-[-1px]" />
          {slot.room}
        </p>
        {slot.note && <p className="text-[11px] leading-snug text-ink-500">{slot.note}</p>}
        <p className="text-xs tabular-nums text-ink-600">{slot.time}</p>
        {slot.printed && (
          <p className="mt-0.5 text-[11px] text-ink-500">
            Printed <s>{slot.printed}</s>
          </p>
        )}
      </div>
    </div>
  );
}
