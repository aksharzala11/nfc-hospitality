import type { ScheduleChangeAction } from "@prisma/client";
import {
  ArrowRightLeft,
  History,
  Hourglass,
  Megaphone,
  PencilLine,
  RotateCcw,
  Undo2,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import type { AnnouncementRow, AnnouncementSummary, ChangeRow, SevaScope } from "@/lib/admin/overview";
import { scopeNoun } from "@/lib/admin/overview";
import { KIND_META } from "@/components/admin/announcements/kinds";
import { BADGE, DRIFT_TONE } from "@/components/admin/shell/ui";
import { CardHeader, EmptyState } from "./parts";

/**
 * Changes in ink, resets and undos quiet on sand; icons as in the schedule page's
 * ChangeLog. Shifts and extends stay neutral: ChangeRow carries no direction, and
 * coral/jade mean later/earlier across the console (DRIFT_TONE).
 */
const ACTION: Record<ScheduleChangeAction, { icon: LucideIcon; tint: string; label: string }> = {
  SHIFT: { icon: ArrowRightLeft, tint: DRIFT_TONE.neutral, label: "Shift" },
  EXTEND: { icon: Hourglass, tint: DRIFT_TONE.neutral, label: "Extend" },
  EDIT: { icon: PencilLine, tint: DRIFT_TONE.neutral, label: "Edit" },
  RESET: { icon: RotateCcw, tint: "bg-sand-200 text-ink-600", label: "Reset" },
  UNDO: { icon: Undo2, tint: "bg-sand-200 text-ink-600", label: "Undo" },
};

/**
 * The latest announcements (scheduled ones first, marked), with sender, time and audience.
 * With the seva filter (`scope`), only the ones that reach someone with a picked seva.
 */
export function RecentAnnouncements({
  summary,
  href,
  newHref,
  scope = null,
  className = "",
}: {
  summary: AnnouncementSummary;
  /** /admin/announcements (with ?now= while time-travelling). */
  href: string;
  /** Where "New announcement" goes. */
  newHref: string;
  /** The seva filter (AdminOverview.scope); null = no filter. */
  scope?: SevaScope | null;
  className?: string;
}) {
  // One truncated line: the counts first, so a long scope is what gets cut.
  const subtitle = [
    `${summary.today} sent today`,
    summary.scheduled ? `${summary.scheduled} scheduled` : null,
    scope ? `reaching ${scope.label}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section aria-labelledby="recent-announcements" className={`card overflow-hidden ${className}`}>
      <CardHeader id="recent-announcements" title="Announcements" subtitle={subtitle} href={href} linkLabel="View all" />
      {summary.recent.length === 0 ? (
        scope ? (
          <EmptyState
            icon={Megaphone}
            title={`No announcements for ${scope.label}`}
            body={`Nothing sent or scheduled so far reaches anyone with ${scopeNoun(scope)}.`}
            action={{ href: newHref, label: "New announcement" }}
          />
        ) : (
          <EmptyState
            icon={Megaphone}
            title="No announcements yet"
            body="Messages you send show up in the bell for everyone you choose: all delegates, a track, a seva, a region or specific people."
            action={{ href: newHref, label: "New announcement" }}
          />
        )
      ) : (
        <ul className="divide-y divide-ink-800/8">
          {summary.recent.map((row) => (
            <AnnouncementItem key={row.id} row={row} />
          ))}
        </ul>
      )}
    </section>
  );
}

function AnnouncementItem({ row }: { row: AnnouncementRow }) {
  // Same icons and tints as the composer and the delegates' bell, so a kind reads the same everywhere.
  const kind = KIND_META[row.kind];
  const Icon = kind.icon;
  return (
    <li className={`flex items-start gap-3 px-4 py-3 ${row.scheduled ? "bg-coral-50/70" : ""}`}>
      <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${kind.tint}`}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[10px] font-bold uppercase tracking-[0.12em] text-ink-500">
          <span>{kind.label}</span>
          <span aria-hidden="true">·</span>
          <span className="font-semibold normal-case tracking-normal">{row.when}</span>
          {row.scheduled && <span className={`${BADGE} bg-coral-100 text-coral-800`}>Scheduled</span>}
        </p>
        <p className="mt-0.5 text-sm font-semibold leading-snug text-ink-900">{row.title}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-500">
          <span className="inline-flex items-center gap-1">
            <UsersRound className="h-3 w-3" aria-hidden="true" />
            {row.audience}
          </span>
          <span aria-hidden="true">·</span>
          <span>by {row.sender}</span>
        </p>
      </div>
    </li>
  );
}

/** The latest live schedule edits from the audit log, with who made them; undone ones struck through. */
export function RecentChanges({
  rows,
  href,
  className = "",
}: {
  rows: ChangeRow[];
  /** /admin/schedule (with ?now= while time-travelling). */
  href: string;
  className?: string;
}) {
  return (
    <section aria-labelledby="recent-changes" className={`card overflow-hidden ${className}`}>
      <CardHeader
        id="recent-changes"
        title="Schedule changes"
        subtitle="Live edits, newest first"
        href={href}
        linkLabel="View all"
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={History}
          title="No changes yet"
          body="Delays and adjustments made on the day are logged here, with who made them."
          action={{ href, label: "Adjust schedule" }}
        />
      ) : (
        <ul className="divide-y divide-ink-800/8">
          {rows.map((row) => (
            <ChangeItem key={row.id} row={row} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ChangeItem({ row }: { row: ChangeRow }) {
  const action = ACTION[row.action];
  const Icon = action.icon;
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <span
        className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${row.undone ? "bg-ink-800/5 text-ink-400" : action.tint}`}
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[10px] font-bold uppercase tracking-[0.12em] text-ink-500">
          <span>{action.label}</span>
          <span aria-hidden="true">·</span>
          <span className="font-semibold normal-case tracking-normal">{row.when}</span>
          {row.undone && <span className={`${BADGE} bg-ink-800/8 text-ink-600`}>Undone</span>}
        </p>
        <p
          className={`mt-0.5 text-sm font-semibold leading-snug ${
            row.undone ? "text-ink-500 line-through decoration-ink-400" : "text-ink-900"
          }`}
        >
          {row.summary}
        </p>
        <p className="mt-0.5 text-xs text-ink-500">
          {row.day} · by {row.by}
        </p>
      </div>
    </li>
  );
}
