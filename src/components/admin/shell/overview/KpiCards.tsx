import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight, CalendarClock, ListFilter, LogIn, Megaphone, Users, type LucideIcon } from "lucide-react";
import type { AnnouncementSummary, PeopleSummary, ScheduleStatus, SevaScope } from "@/lib/admin/overview";
import { formatMinutes, scopeNoun, worstDrift } from "@/lib/admin/overview";
import { EVENT_DATES } from "@/lib/branding";
import { BADGE, DRIFT_TONE, FOCUS, ROLE_BADGE, TRACK_CHIP } from "@/components/admin/shell/ui";

const ROLES = ["DELEGATE", "SANT", "ADMIN"] as const;

/** Icon tiles: each card keeps its own brand tint so the four read apart at a glance. */
const ICON_TONE = {
  people: "bg-ink-800/8 text-ink-800",
  signedIn: "bg-jade-500/12 text-jade-700",
  announcements: "bg-coral-400/20 text-coral-800",
  neutral: "bg-sand-200 text-ink-700",
} as const;

/**
 * Four at-a-glance cards, each opening the console page behind it: people by
 * role, sign-ins, today's announcements and today's schedule status.
 * 2 × 2 on phones, a row of four on tablets, 2 × 2 again in the desktop side column.
 *
 * With the seva filter (`scope`), every card says what it counts under its
 * label: people and sign-ins "for BM RA" (or "for 3 sevas": the columns are
 * narrow, the full list is the caption's tooltip and the filter bar above),
 * announcements "reaching" them, and the schedule "all sevas" (the programme
 * isn't filtered), so the rows stay aligned.
 */
export function KpiCards({
  people,
  announcements,
  status,
  dayName,
  hrefs,
  scope = null,
  className = "",
}: {
  people: PeopleSummary;
  announcements: AnnouncementSummary;
  status: ScheduleStatus;
  /** Programme day, e.g. "Day 2"; null outside the event days. */
  dayName: string | null;
  hrefs: { delegates: string; announce: string; schedule: string };
  /** The seva filter (AdminOverview.scope); null = no filter. */
  scope?: SevaScope | null;
  className?: string;
}) {
  const notYet = people.total - people.signedIn;
  const schedule = scheduleKpi(status);
  // The whole list on hover when the caption only gives the count.
  const full = scope && scope.sevas.length > 1 ? scope.sevas.join(", ") : undefined;

  return (
    <section aria-label="At a glance" className={`grid grid-cols-2 gap-3 ${className}`}>
      <Kpi
        href={hrefs.delegates}
        icon={Users}
        label="People"
        iconTone={ICON_TONE.people}
        caption={
          scope && (
            <Scope filtered title={full && `for ${full}`}>
              for {scope.short}
            </Scope>
          )
        }
      >
        <Value>{people.total}</Value>
        <ul className="mt-2.5 space-y-1.5">
          {ROLES.map((role) => (
            <li key={role} className="flex items-center justify-between gap-2">
              <span className={`${BADGE} ${ROLE_BADGE[role].tone}`}>{ROLE_BADGE[role].label}</span>
              <span className="text-xs font-bold tabular-nums text-ink-900">{people.byRole[role]}</span>
            </li>
          ))}
        </ul>
      </Kpi>

      <Kpi
        href={hrefs.delegates}
        icon={LogIn}
        label="Signed in"
        iconTone={ICON_TONE.signedIn}
        caption={
          scope && (
            <Scope filtered title={full && `for ${full}`}>
              for {scope.short}
            </Scope>
          )
        }
      >
        <Value>
          {people.signedIn}
          <span className="ml-1 text-sm font-semibold tracking-normal text-ink-500">/ {people.total}</span>
        </Value>
        {/* The brand's teal gradient: signing in is the "good" direction. */}
        <span aria-hidden="true" className="mt-3 block h-1.5 overflow-hidden rounded-full bg-ink-800/8">
          <span
            className="block h-full rounded-full bg-gradient-to-r from-jade-500 to-ink-800"
            style={{ width: `${people.signedInPct}%` }}
          />
        </span>
        <Sub>
          <span className="font-semibold text-ink-900">{people.signedInPct}%</span>
          {" · "}
          {scope && people.total === 0
            ? `no one has ${scopeNoun(scope)} yet`
            : notYet
              ? `${notYet} yet to sign in`
              : "everyone has signed in"}
        </Sub>
      </Kpi>

      <Kpi
        href={hrefs.announce}
        icon={Megaphone}
        label="Announcements"
        iconTone={ICON_TONE.announcements}
        caption={
          scope && (
            <Scope filtered title={full && `reaching ${full}`}>
              reaching {scope.short}
            </Scope>
          )
        }
      >
        <Value>
          {announcements.today}
          <span className="ml-1.5 text-sm font-semibold tracking-normal text-ink-500">today</span>
        </Value>
        {announcements.scheduled > 0 && (
          <span className={`${BADGE} mt-2.5 self-start bg-coral-100 text-coral-800`}>
            {announcements.scheduled} scheduled
          </span>
        )}
        <Sub>{announcements.lastSent ? `Last sent ${announcements.lastSent}` : "None sent yet"}</Sub>
      </Kpi>

      <Kpi
        href={hrefs.schedule}
        icon={CalendarClock}
        label={dayName ? `Schedule · ${dayName}` : "Schedule"}
        iconTone={schedule.iconTone}
        caption={scope && <Scope>all sevas</Scope>}
      >
        <span className={`mt-1 block text-[1.3125rem] font-extrabold leading-tight tracking-tight ${schedule.tone}`}>
          {schedule.value}
        </span>
        <Sub>{schedule.sub}</Sub>
      </Kpi>
    </section>
  );
}

/** Late in coral, early / on time in jade, idle and finished days neutral. */
function scheduleKpi(status: ScheduleStatus): { value: string; sub: string; tone: string; iconTone: string } {
  if (status.state === "idle") {
    return { value: status.note, sub: `Programme: ${EVENT_DATES}`, tone: "text-ink-600", iconTone: ICON_TONE.neutral };
  }
  const moved = status.moved ? `${status.moved} of ${status.total} items moved` : `All ${status.total} items as printed`;
  if (status.state === "done") {
    return { value: "Day complete", sub: moved, tone: "text-ink-900", iconTone: ICON_TONE.neutral };
  }
  const worst = worstDrift(status.drifts);
  const sub = worst.track && worst.minutes !== 0 ? `${TRACK_CHIP[worst.track].label} track · ${moved}` : moved;
  if (worst.minutes > 0) {
    return { value: `${formatMinutes(worst.minutes)} late`, sub, tone: "text-coral-800", iconTone: DRIFT_TONE.late };
  }
  if (worst.minutes < 0) {
    return { value: `${formatMinutes(worst.minutes)} early`, sub, tone: "text-jade-700", iconTone: DRIFT_TONE.early };
  }
  return { value: "On time", sub, tone: "text-jade-700", iconTone: DRIFT_TONE.onTime };
}

function Kpi({
  href,
  icon: Icon,
  label,
  iconTone,
  caption,
  children,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  iconTone: string;
  /** One line under the label: what the card counts under the seva filter. */
  caption?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`card group flex min-w-0 flex-col p-4 transition hover:-translate-y-0.5 hover:shadow-card-lg active:scale-[0.99] motion-reduce:hover:translate-y-0 ${FOCUS}`}
    >
      <span className="flex items-start justify-between gap-2">
        <span className={`flex h-10 w-10 items-center justify-center rounded-2xl ${iconTone}`}>
          <Icon className="h-5 w-5" />
        </span>
        <ArrowUpRight className="h-4 w-4 text-ink-300 transition group-hover:text-ink-600" />
      </span>
      <span className="mt-3 block truncate text-[10px] font-bold uppercase tracking-[0.16em] text-ink-500">{label}</span>
      {caption}
      {children}
    </Link>
  );
}

/**
 * The card's scope under its label; `filtered` marks the ones the seva filter
 * narrows (filter icon). A long single seva name wraps to a second line rather
 * than being cut; `title` holds the full list when the caption only counts it.
 */
function Scope({
  filtered = false,
  title,
  children,
}: {
  filtered?: boolean;
  title?: string;
  children: ReactNode;
}) {
  return (
    <span
      title={title}
      className="mt-0.5 flex min-w-0 items-start gap-1 text-[11px] font-semibold leading-snug text-ink-600"
    >
      {filtered && <ListFilter aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0 text-coral-700" />}
      <span className="line-clamp-2 min-w-0 [overflow-wrap:anywhere]">{children}</span>
    </span>
  );
}

function Value({ children }: { children: ReactNode }) {
  return (
    <span className="mt-1 block text-[1.875rem] font-extrabold leading-none tracking-tight tabular-nums text-ink-900">
      {children}
    </span>
  );
}

/** Footnote pinned to the bottom of the card, so footers line up across a row. */
function Sub({ children }: { children: ReactNode }) {
  return <span className="mt-auto block pt-2.5 text-xs leading-snug text-ink-500">{children}</span>;
}
