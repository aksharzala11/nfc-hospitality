import Link from "next/link";
import type { ReactNode } from "react";
import { CalendarClock, CircleCheck, Clock, ClockAlert, Flag, MapPin, Timer, type LucideIcon } from "lucide-react";
import type { LiveItem, ProgrammeView, ScheduleStatus } from "@/lib/admin/overview";
import { driftSentence, formatMinutes, worstDrift } from "@/lib/admin/overview";
import { EVENT_NAME } from "@/lib/branding";
import { HandsPraying } from "@/components/icons/HandsPraying";
import { BADGE, DRIFT_TONE, FOCUS, TRACK_CHIP } from "@/components/admin/shell/ui";
import { ShiftBadge, signed } from "./parts";

/**
 * The general programme right now, across both tracks: whether it's running
 * to the printed times, what's on and what's next, and the big "Adjust
 * schedule" button for the likely case that it isn't.
 */
export function LiveProgramme({
  programme,
  day,
  updated,
  scheduleHref,
  className = "",
}: {
  programme: ProgrammeView;
  /** "Day 2 · Fri, Oct 9" */
  day: string;
  /** Time of this render, e.g. "1:45 PM". */
  updated: string;
  scheduleHref: string;
  className?: string;
}) {
  const { status, now, next, phase } = programme;
  const pill = statusPill(status);

  return (
    <section aria-labelledby="live-programme" className={`card overflow-hidden ${className}`}>
      <div className="flex items-start justify-between gap-3 px-4 pb-3 pt-4">
        <div className="min-w-0">
          <h2 id="live-programme" className="font-display text-[1.375rem] leading-tight text-ink-900">
            Live programme
          </h2>
          <p className="mt-0.5 text-xs text-ink-500">{day} · all tracks</p>
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] ${pill.tone}`}
        >
          {pill.live && <span className="h-1.5 w-1.5 rounded-full bg-current motion-safe:animate-pulse-soft" />}
          {pill.label}
        </span>
      </div>

      <StatusBanner status={status} />

      {now.length + next.length > 0 ? (
        <ol className="divide-y divide-ink-800/8 border-t border-ink-800/8">
          {now.map((item) => (
            <Row key={item.id} item={item} mode="now" />
          ))}
          {next.map((item) => (
            <Row key={item.id} item={item} mode={phase === "before" ? "first" : "next"} />
          ))}
        </ol>
      ) : (
        <div className="flex items-center gap-3 border-t border-ink-800/8 px-4 py-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-coral-100 text-coral-700">
            <HandsPraying className="h-[18px] w-[18px]" />
          </span>
          <div>
            <p className="font-semibold text-ink-900">
              {phase === "empty" ? "The programme hasn't been loaded yet" : `${EVENT_NAME} has concluded`}
            </p>
            <p className="text-xs text-ink-600">
              {phase === "empty" ? "Items will show here once the schedule is in." : "Thank you for your seva."}
            </p>
          </div>
        </div>
      )}

      <div className="border-t border-ink-800/8 bg-sand-100/60 p-4">
        <Link
          href={scheduleHref}
          className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-ink-900 px-4 py-3.5 text-[15px] font-semibold text-white shadow-card transition hover:bg-ink-800 active:scale-[0.98] ${FOCUS}`}
        >
          <CalendarClock className="h-5 w-5" />
          Adjust schedule
        </Link>
        <p className="mt-2.5 text-center text-[11px] text-ink-500">Updated {updated} · refreshes automatically</p>
      </div>
    </section>
  );
}

function statusPill(status: ScheduleStatus): { label: string; tone: string; live?: boolean } {
  if (status.state === "idle") return { label: status.note, tone: "bg-sand-200 text-ink-600" };
  if (status.state === "done") return { label: "Day complete", tone: DRIFT_TONE.neutral };
  const worst = worstDrift(status.drifts);
  if (worst.minutes > 0) {
    return { label: `${formatMinutes(worst.minutes)} late`, tone: DRIFT_TONE.late, live: true };
  }
  if (worst.minutes < 0) {
    return { label: `${formatMinutes(worst.minutes)} early`, tone: DRIFT_TONE.early, live: true };
  }
  return { label: "On time", tone: DRIFT_TONE.onTime, live: true };
}

/** Late in coral, early and on time in jade (the teal gradient's light end), otherwise ink. */
const BANNER_TONE = {
  good: "bg-jade-50 text-jade-700 ring-1 ring-inset ring-jade-500/15",
  late: "bg-coral-50 text-coral-900 ring-1 ring-inset ring-coral-400/25",
  early: "bg-jade-50 text-jade-700 ring-1 ring-inset ring-jade-500/15",
  neutral: "bg-ink-800/5 text-ink-800",
} as const;

function Banner({ tone, icon: Icon, children }: { tone: keyof typeof BANNER_TONE; icon: LucideIcon; children: ReactNode }) {
  return (
    <div className={`mx-4 mb-4 flex items-start gap-3 rounded-2xl px-3.5 py-3 text-sm ${BANNER_TONE[tone]}`}>
      <Icon className="mt-0.5 h-[18px] w-[18px] shrink-0" />
      <div className="min-w-0 space-y-1">{children}</div>
    </div>
  );
}

/** One line on how today compares with the printed schedule (per track when the tracks differ). */
function StatusBanner({ status }: { status: ScheduleStatus }) {
  if (status.state === "idle") return null;

  if (status.state === "done") {
    return (
      <Banner tone="neutral" icon={Flag}>
        <p className="font-semibold">Today&apos;s programme is complete</p>
        <p className="text-xs text-ink-600">
          {status.moved ? `${status.moved} of ${status.total} items were moved` : "It ran to the printed schedule"}
        </p>
      </Banner>
    );
  }

  const worst = worstDrift(status.drifts);
  if (worst.minutes === 0) {
    const { nextMove } = status;
    return (
      <Banner tone="good" icon={CircleCheck}>
        <p className="font-semibold">On time</p>
        <p className="text-xs">
          {nextMove
            ? `Coming up: ${nextMove.title} moved to ${nextMove.time} (${signed(nextMove.minutes)}, printed ${nextMove.printed})`
            : status.moved
              ? `${status.moved} of ${status.total} items adjusted today`
              : "Running to the printed schedule"}
        </p>
      </Banner>
    );
  }

  return (
    <Banner tone={worst.minutes > 0 ? "late" : "early"} icon={worst.minutes > 0 ? ClockAlert : Timer}>
      {status.drifts.map((d) => (
        <p key={d.track ?? "all"} className="font-semibold">
          {d.track && (
            <span className={`${BADGE} mr-1.5 inline-block align-[1px] ${TRACK_CHIP[d.track].tone}`}>
              {TRACK_CHIP[d.track].label}
            </span>
          )}
          {driftSentence(d)}
        </p>
      ))}
      <p className="text-xs">
        {status.moved} of {status.total} items moved today
      </p>
    </Banner>
  );
}

function Row({ item, mode }: { item: LiveItem; mode: "now" | "next" | "first" }) {
  const isNow = mode === "now";
  return (
    <li className="flex items-start gap-3 px-4 py-3.5">
      {isNow ? (
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-jade-500 to-ink-800 shadow-[0_8px_18px_-8px_rgb(20_42_51/0.7)]">
          <span className="h-2 w-2 rounded-full bg-coral-400 motion-safe:animate-pulse-soft" />
        </span>
      ) : (
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sand-200 text-ink-500">
          <Clock className="h-4 w-4" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className={`text-[10px] font-bold uppercase tracking-[0.14em] ${isNow ? "text-coral-700" : "text-ink-500"}`}>
          {isNow ? "Happening now" : mode === "first" ? "First up" : "Up next"}
          <span className="text-[11px] font-semibold normal-case tracking-normal text-ink-500"> · {item.relative}</span>
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="font-semibold leading-snug text-ink-900">{item.title}</p>
          <span className={`${BADGE} ${TRACK_CHIP[item.audience].tone}`}>{TRACK_CHIP[item.audience].label}</span>
          <ShiftBadge item={item} />
        </div>
        <p className="mt-0.5 text-xs text-ink-600">
          <span className="tabular-nums">{item.time}</span>
          {item.location && (
            <>
              <span className="mx-1.5" aria-hidden="true">
                ·
              </span>
              <MapPin className="mr-0.5 inline h-3 w-3 align-[-1px]" />
              {item.location}
            </>
          )}
        </p>
        {item.printed && (
          <p className="mt-0.5 text-[11px] text-ink-500">
            Printed <s>{item.printed}</s>
          </p>
        )}
      </div>
    </li>
  );
}
