import type { Metadata } from "next";
import { MailCheck, MailX, TriangleAlert } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { getEmailBounceTracker } from "@/lib/admin/emailEvents";
import { pageNow, type SearchParams } from "@/lib/pageNow";
import { TimeTravelBanner } from "@/components/TimeTravelBanner";
import { PageHeader } from "@/components/admin/shell/PageHeader";
import { BounceEntryCard, BounceSummary } from "@/components/admin/bounces/BounceTracker";
import { directoryHref } from "@/components/admin/transport/board";

export const metadata: Metadata = { title: "Email bounces" };
export const dynamic = "force-dynamic";

/**
 * The email bounce tracker: sign-in emails Amazon SES couldn't deliver (hard
 * and soft bounces, spam complaints, rejects), one card per address, open
 * first, then resolved. Each names the account(s) whose email is that address
 * now (linking to their directory entry), what SES said, when and how often,
 * and offers Mark resolved (with a short note) / Reopen. A hard-bounced
 * address is on the SES suppression list: SES sends nothing more to it until
 * it is removed there, while a corrected address in the directory works at once.
 *
 * Fed by the SNS endpoint /api/ses/events (SES_EVENTS_TOPIC_ARN) and `npm run
 * ses:bounces -- --backfill` (the suppression list). Reached from the Overview
 * card and the directory's "Email bounced" note; no tab of its own.
 * Honours ?now= on its links while time-travelling (the tracker itself doesn't
 * change with the time).
 */
export default async function AdminBouncesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  // The layout checks too, but layouts don't re-run on every navigation.
  await requireAdmin();
  const { traveling, label } = pageNow(sp);
  const keep = { now: traveling && typeof sp.now === "string" ? sp.now : null, sevas: [] as string[] };
  const personHref = (bapsId: string) => directoryHref(bapsId, keep);

  const tracker = await getEmailBounceTracker();
  const live = Boolean(process.env.SES_EVENTS_TOPIC_ARN?.trim());

  const header = (
    <PageHeader
      title="Email bounces"
      description={
        <>
          Sign-in emails SES couldn&apos;t deliver, by address. Fix the address (or the mailbox), then mark it resolved; a
          new bounce opens it again.
        </>
      }
    />
  );

  const liveNote = !live && (
    <p className="mb-4 flex items-start gap-2 rounded-2xl bg-coral-100 px-3 py-2 text-xs font-semibold leading-snug text-coral-800">
      <TriangleAlert aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
      <span>
        New bounces don&apos;t arrive on this server: SES_EVENTS_TOPIC_ARN isn&apos;t set here (see the README, &quot;Email
        bounces&quot;).
      </span>
    </p>
  );

  if (!tracker) {
    return (
      <div>
        {traveling && <TimeTravelBanner label={label} />}
        {header}
        <div className="card px-6 py-10 text-center">
          <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-sand-200 text-ink-600">
            <MailX aria-hidden="true" className="h-6 w-6" />
          </span>
          <p className="font-semibold text-ink-900">Bounce tracking isn&apos;t set up yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-ink-600">
            This database has no bounce table yet. Once it does (
            <code className="rounded bg-sand-100 px-1 text-xs text-ink-800">npm run db:push</code>), bounces SES reports
            show here.
          </p>
        </div>
      </div>
    );
  }

  const open = tracker.entries.filter((e) => e.open);
  const resolved = tracker.entries.filter((e) => !e.open);

  return (
    <div>
      {traveling && <TimeTravelBanner label={label} />}
      {header}
      {liveNote}

      {tracker.entries.length === 0 ? (
        <div className="card px-6 py-10 text-center">
          <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-jade-100 text-jade-700">
            <MailCheck aria-hidden="true" className="h-6 w-6" />
          </span>
          <p className="font-semibold text-ink-900">No bounces</p>
          <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-ink-600">
            SES hasn&apos;t reported a bounced, rejected or complained-about sign-in email.
          </p>
        </div>
      ) : (
        <div className="stagger space-y-6">
          <BounceSummary counts={tracker.counts} />

          <section aria-labelledby="bounces-open">
            <h2 id="bounces-open" className="mb-2 px-1 font-display text-xl leading-tight text-ink-900">
              Open <span className="font-sans text-sm font-semibold tabular-nums text-ink-600">{open.length}</span>
            </h2>
            {open.length === 0 ? (
              <p className="card px-4 py-4 text-sm text-ink-700">Nothing open: every bounced address is resolved.</p>
            ) : (
              <ul className="grid items-start gap-3 lg:grid-cols-2">
                {open.map((entry) => (
                  <BounceEntryCard key={entry.recipient} entry={entry} personHref={personHref} />
                ))}
              </ul>
            )}
          </section>

          {resolved.length > 0 && (
            <section aria-labelledby="bounces-resolved">
              <h2 id="bounces-resolved" className="mb-2 px-1 font-display text-xl leading-tight text-ink-900">
                Resolved <span className="font-sans text-sm font-semibold tabular-nums text-ink-600">{resolved.length}</span>
              </h2>
              <ul className="grid items-start gap-3 lg:grid-cols-2">
                {resolved.map((entry) => (
                  <BounceEntryCard key={entry.recipient} entry={entry} personHref={personHref} />
                ))}
              </ul>
            </section>
          )}

          <p className="px-1 text-xs leading-snug text-ink-600">
            Hard bounce: the receiving server said the address doesn&apos;t work, and SES puts it on the account&apos;s
            suppression list. Soft bounce: a passing problem (a full mailbox, a busy server) that outlasted SES&apos;s retries; the next
            code may get through. Times are Eastern.
          </p>
        </div>
      )}
    </div>
  );
}
