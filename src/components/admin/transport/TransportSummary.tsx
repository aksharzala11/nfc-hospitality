import type { ReactNode } from "react";
import type { TransportDirection } from "@/lib/transport";
import { LABEL } from "@/components/admin/shell/ui";
import { WORDS, plural, type BoardSummary } from "./board";

/**
 * The board's counts for the day(s) shown: people, how many need a pickup /
 * drop-off, how many who need one (or didn't say) still have no group, with
 * how many of those aren't on the team's tabs at all (coral while any are
 * left, jade once everyone is grouped), and drivers per group. 2 × 2 on
 * phones, a row of four from md. Server- and client-safe.
 */
export function TransportSummary({
  summary,
  direction,
  scope,
}: {
  summary: BoardSummary;
  direction: TransportDirection;
  /** "Thu, Oct 8" or "all days". */
  scope: string;
}) {
  const words = WORDS[direction];
  const waiting = summary.notGrouped;
  return (
    <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Tile label={words.title} value={summary.people} sub={scope} />
      <Tile
        label={words.needService}
        value={summary.needService}
        sub={summary.groups > 0 ? `${summary.grouped} in ${plural(summary.groups, "group")}` : "No groups yet"}
      />
      <Tile
        label="Not grouped yet"
        value={waiting}
        tone={waiting > 0 ? "text-coral-800" : summary.needService > 0 ? "text-jade-700" : "text-ink-900"}
        sub={
          waiting > 0
            ? summary.notOnTab > 0
              ? `${summary.notOnTab} not on the ${words.tabs} yet`
              : `need a ${words.service}, or didn't say`
            : summary.needService > 0
              ? "Everyone is grouped"
              : "—"
        }
      />
      <Tile
        label="Drivers"
        value={
          <>
            {summary.groupsWithDriver}
            <span className="ml-1 text-sm font-semibold tracking-normal text-ink-500">/ {summary.groups}</span>
          </>
        }
        sub={summary.groups === 0 ? "No groups yet" : summary.groupsWithDriver === 0 ? "None assigned yet" : "groups with a driver"}
      />
    </dl>
  );
}

function Tile({ label, value, sub, tone = "text-ink-900" }: { label: string; value: ReactNode; sub: string; tone?: string }) {
  return (
    <div className="card flex min-w-0 flex-col p-4">
      <dt className={LABEL}>{label}</dt>
      <dd className={`mt-1.5 text-[1.75rem] font-extrabold leading-none tracking-tight tabular-nums ${tone}`}>{value}</dd>
      <dd className="mt-1.5 text-xs leading-snug text-ink-600">{sub}</dd>
    </div>
  );
}
