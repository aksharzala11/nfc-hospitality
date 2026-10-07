import type { TransportDirection } from "@/lib/transport";
import { LABEL } from "@/components/admin/shell/ui";
import { CardHeader } from "@/components/admin/shell/overview/parts";
import { WORDS, type BoardSummary } from "./board";

/**
 * The console home's line on airport transport: the board's direction and day
 * as it opens (arrivals today, departures from Sat...), with its four counts
 * and a link to /admin/transport. One slim row from md, 2 × 2 on phones.
 * Server- and client-safe.
 */
export function TransportGlance({
  summary,
  direction,
  when,
  scope,
  href,
  className = "",
}: {
  summary: BoardSummary;
  direction: TransportDirection;
  /** "today (Thu, Oct 8)" or "all days". */
  when: string;
  /** The seva filter's label, or null. */
  scope: string | null;
  href: string;
  className?: string;
}) {
  const words = WORDS[direction];
  const stats: { label: string; value: number; tone: string }[] = [
    { label: words.title, value: summary.people, tone: "text-ink-900" },
    { label: words.needService, value: summary.needService, tone: "text-ink-900" },
    { label: "Not grouped yet", value: summary.notGrouped, tone: summary.notGrouped > 0 ? "text-coral-800" : "text-ink-900" },
    { label: "Flagged", value: summary.flagged, tone: summary.flagged > 0 ? "text-coral-800" : "text-ink-900" },
  ];
  return (
    <section aria-labelledby="transport-glance" className={`card overflow-hidden ${className}`}>
      <CardHeader
        id="transport-glance"
        title="Airport transport"
        subtitle={`${words.title}, ${when}${scope ? ` · for ${scope}` : ""}`}
        href={href}
        linkLabel="Transport"
      />
      <dl className="grid grid-cols-2 gap-px bg-ink-800/8 md:grid-cols-4">
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
