import Link from "next/link";
import { MailWarning, ShieldAlert, UserRoundX } from "lucide-react";
import type { BounceEntryView, BounceEventView } from "@/lib/admin/emailEvents";
import type { BounceCounts, EventTone } from "@/lib/emailEvents/view";
import { BADGE, FOCUS, LABEL, ROLE_BADGE } from "@/components/admin/shell/ui";
import { BounceResolve } from "./BounceResolve";

/**
 * The bounce tracker's parts (/admin/bounces): the counts and one card per
 * address. Server components (the Mark resolved / Reopen island aside); all
 * props are plain strings from src/lib/admin/emailEvents.ts.
 */

/** Hard bounces, complaints and rejects in ember (error); soft and undetermined bounces in coral (warning). */
export const TONE: Record<EventTone, string> = {
  error: "bg-ember-500/10 text-ember-700",
  warn: "bg-coral-100 text-coral-800",
};

const times = (n: number) => (n === 1 ? "once" : `${n} times`);

/** Open addresses, of them hard bounces, and resolved ones. */
export function BounceSummary({ counts }: { counts: BounceCounts }) {
  const stats: { label: string; value: number; tone: string }[] = [
    { label: "Open", value: counts.open, tone: counts.open > 0 ? "text-coral-800" : "text-ink-900" },
    { label: "Open, hard", value: counts.openHard, tone: counts.openHard > 0 ? "text-ember-700" : "text-ink-900" },
    { label: "Resolved", value: counts.resolved, tone: "text-ink-900" },
  ];
  return (
    <dl className="card grid grid-cols-3 gap-px overflow-hidden bg-ink-800/8">
      {stats.map((s) => (
        <div key={s.label} className="bg-white px-4 py-3">
          <dt className={LABEL}>{s.label}</dt>
          <dd className={`mt-1 text-2xl font-extrabold leading-none tracking-tight tabular-nums ${s.tone}`}>{s.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Who has the address now: each account (name to their directory entry, role, BAPS ID, seva), or none. */
function People({ entry, personHref }: { entry: BounceEntryView; personHref: (bapsId: string) => string }) {
  if (entry.people.length === 0) {
    return (
      <p className="flex items-start gap-1.5 text-sm font-semibold text-ink-700">
        <UserRoundX aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-ink-500" />
        <span>
          No account with this address
          <span className="block text-xs font-normal text-ink-600">
            Nobody&apos;s email is this address now: it may have been corrected since.
          </span>
        </span>
      </p>
    );
  }
  return (
    <ul className="space-y-1">
      {entry.people.map((p) => (
        <li key={p.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            href={personHref(p.bapsId)}
            className={`break-words rounded font-semibold leading-snug text-ink-900 underline-offset-2 hover:underline ${FOCUS}`}
          >
            {p.name}
          </Link>
          <span className={`${BADGE} ${ROLE_BADGE[p.role].tone}`}>{ROLE_BADGE[p.role].label}</span>
          <span className="text-xs text-ink-600">
            <span className="tabular-nums">{p.bapsId}</span>
            {p.seva && (
              <>
                <span aria-hidden="true"> · </span>
                {p.seva}
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function EventLine({ event }: { event: BounceEventView }) {
  return (
    <li className="py-2">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className={`${BADGE} ${TONE[event.tone]}`}>{event.label}</span>
        <span className="text-ink-700">{event.at}</span>
        {event.subType && <span className="text-ink-600">{event.subType}</span>}
        {event.fromSuppressionList && <span className="text-ink-600">From the SES suppression list</span>}
      </p>
      {event.diagnostic && (
        <p className="mt-1 break-words text-xs leading-snug text-ink-600 [overflow-wrap:anywhere]">{event.diagnostic}</p>
      )}
    </li>
  );
}

/** One address: who has it, what SES said, when, what to do, and its status. */
export function BounceEntryCard({
  entry,
  personHref,
}: {
  entry: BounceEntryView;
  personHref: (bapsId: string) => string;
}) {
  return (
    <li className="card px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <People entry={entry} personHref={personHref} />
          <p className="break-all text-sm text-ink-800">{entry.recipient}</p>
        </div>
        <span className={`${BADGE} shrink-0 ${entry.open ? "bg-coral-100 text-coral-800" : "bg-jade-100 text-jade-700"}`}>
          {entry.open ? "Open" : "Resolved"}
        </span>
      </div>

      <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className={`${BADGE} ${TONE[entry.tone]}`}>{entry.label}</span>
        {entry.subType && <span className="text-ink-800">{entry.subType}</span>}
        {entry.otherLabels.length > 0 && <span className="text-xs text-ink-600">also {entry.otherLabels.join(", ").toLowerCase()}</span>}
      </p>
      {entry.diagnostic && (
        <p title={entry.diagnostic} className="mt-1.5 line-clamp-2 break-words text-xs leading-snug text-ink-600 [overflow-wrap:anywhere]">
          {entry.diagnostic}
        </p>
      )}
      <p className="mt-1.5 text-xs text-ink-600">
        {entry.count === 1 ? (
          <>{entry.lastAt}</>
        ) : (
          <>
            {times(entry.count)} · first {entry.firstAt} · last {entry.lastAt}
          </>
        )}
      </p>

      {entry.open && entry.hard && (
        <p className="mt-3 flex items-start gap-2 rounded-2xl bg-ember-500/8 px-3 py-2 text-xs leading-snug text-ember-700">
          <ShieldAlert aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>
            <span className="font-semibold">SES won&apos;t send to this address any more</span> (it is on the account&apos;s
            suppression list), so no sign-in code reaches it. If the address is wrong, correct the person&apos;s email in
            the directory: a new address isn&apos;t suppressed. If it is right and the mailbox works again, remove it
            from the SES suppression list. Then mark it resolved.
          </span>
        </p>
      )}
      {entry.open && !entry.hard && entry.complaint && (
        <p className="mt-3 flex items-start gap-2 rounded-2xl bg-coral-100 px-3 py-2 text-xs leading-snug text-coral-800">
          <MailWarning aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>
            The recipient (or their mail provider) reported a sign-in email as spam. SES may stop sending to the address:
            check that they can still sign in, or use another address.
          </span>
        </p>
      )}

      {(entry.resolvedAt || entry.note) && (
        <p className="mt-3 text-xs leading-snug text-ink-700">
          {entry.resolvedAt && (
            <span className="font-semibold text-jade-700">
              Resolved {entry.resolvedAt}
              {entry.resolvedBy ? ` by ${entry.resolvedBy}` : ""}
            </span>
          )}
          {entry.resolvedAt && entry.note && <span aria-hidden="true"> · </span>}
          {entry.note && (
            <span>
              <span className="sr-only">Note: </span>“{entry.note}”
            </span>
          )}
        </p>
      )}

      {entry.count > 1 && (
        <details className="group mt-3 rounded-2xl bg-sand-100 px-3">
          <summary className={`flex min-h-11 cursor-pointer items-center text-xs font-semibold text-ink-700 ${FOCUS}`}>
            {entry.events.length < entry.count
              ? `Latest ${entry.events.length} of ${entry.count} events`
              : `All ${entry.count} events`}
          </summary>
          <ul className="divide-y divide-ink-800/8 pb-1">
            {entry.events.map((e) => (
              <EventLine key={e.id} event={e} />
            ))}
          </ul>
        </details>
      )}

      <div className="mt-3">
        <BounceResolve recipient={entry.recipient} open={entry.open} note={entry.note} />
      </div>
    </li>
  );
}
