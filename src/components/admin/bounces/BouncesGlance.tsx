import Link from "next/link";
import { ChevronRight, MailCheck } from "lucide-react";
import type { BounceCounts } from "@/lib/emailEvents/view";
import { FOCUS, LABEL } from "@/components/admin/shell/ui";
import { CardHeader } from "@/components/admin/shell/overview/parts";

/**
 * The console home's line on email bounces (/admin/bounces): with addresses
 * open, a card "Email bounces · N open" with the open / hard / resolved
 * counts; with none open, one quiet link row. The page leaves it out while
 * nothing has ever bounced or the table isn't there. Server- and client-safe.
 */
export function BouncesGlance({ counts, href, className = "" }: { counts: BounceCounts; href: string; className?: string }) {
  if (counts.open === 0) {
    return (
      <Link
        href={href}
        className={`card flex min-h-11 items-center gap-2 px-4 py-2.5 text-sm text-ink-700 transition hover:bg-white ${FOCUS} ${className}`}
      >
        <MailCheck aria-hidden="true" className="h-4 w-4 shrink-0 text-jade-700" />
        <span className="min-w-0 flex-1">
          <span className="font-semibold text-ink-900">Email bounces</span> · none open
          <span className="text-ink-600"> ({counts.resolved} resolved)</span>
        </span>
        <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-500" />
      </Link>
    );
  }
  const stats: { label: string; value: number; tone: string }[] = [
    { label: "Open", value: counts.open, tone: "text-coral-800" },
    { label: "Open, hard", value: counts.openHard, tone: counts.openHard > 0 ? "text-ember-700" : "text-ink-900" },
    { label: "Resolved", value: counts.resolved, tone: "text-ink-900" },
  ];
  return (
    <section aria-labelledby="bounces-glance" className={`card overflow-hidden ${className}`}>
      <CardHeader
        id="bounces-glance"
        title={`Email bounces · ${counts.open} open`}
        subtitle="Sign-in emails SES couldn't deliver"
        href={href}
        linkLabel="Bounces"
      />
      <dl className="grid grid-cols-3 gap-px bg-ink-800/8">
        {stats.map((s) => (
          <div key={s.label} className="bg-white px-4 py-3">
            <dt className={LABEL}>{s.label}</dt>
            <dd className={`mt-1 text-2xl font-extrabold leading-none tracking-tight tabular-nums ${s.tone}`}>{s.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
