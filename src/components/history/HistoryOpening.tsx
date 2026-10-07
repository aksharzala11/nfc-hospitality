import { MandirArt } from "@/components/MandirArt";
import { historyCounts, historyCountsLabel, historyYears, yearAnchor } from "@/lib/history";
import { HistoryJump } from "./HistoryJump";

/**
 * The History page's opening card: the Edison mandir's line art in coral on an ink dusk, then
 * the span of the story (its first and last year), how much there is, and a way in.
 */
export function HistoryOpening() {
  const years = historyYears();
  const first = years[0].year;
  const last = years[years.length - 1].year;

  return (
    <section aria-label="Through the years" className="card overflow-hidden text-center">
      {/* The Edison mandir's line art in the brand's coral, rising on an ink dusk. */}
      <div className="relative isolate overflow-hidden bg-gradient-to-b from-ink-950 via-ink-900 to-ink-800 px-6 pt-10">
        <div
          aria-hidden="true"
          className="absolute left-1/2 top-8 -z-10 h-36 w-64 -translate-x-1/2 rounded-full bg-coral-400/30 blur-3xl"
        />
        <div aria-hidden="true" className="absolute -bottom-12 -left-12 -z-10 h-32 w-44 rounded-full bg-jade-500/25 blur-3xl" />
        <MandirArt className="mx-auto w-full max-w-sm bg-gradient-to-b from-coral-200 to-coral-500" />
      </div>
      <span aria-hidden="true" className="block h-1 bg-gradient-to-r from-coral-400 to-coral-700" />

      <div className="px-6 pb-7 pt-6">
        <p className="text-[11px] font-bold uppercase tracking-caps text-coral-800">Through the years</p>
        <p className="font-display mt-3 flex items-center justify-center gap-4 text-[2.5rem] leading-none text-ink-900">
          <span>{first}</span>
          <span aria-hidden="true" className="h-0.5 w-12 shrink-0 rounded-full bg-gradient-to-r from-coral-400 to-coral-700" />
          <span className="sr-only">to</span>
          <span>{last}</span>
        </p>
        <p className="mt-3 text-sm text-ink-600">{historyCountsLabel(historyCounts())}</p>
        <HistoryJump
          to={yearAnchor(first)}
          className="mt-5 inline-flex min-h-12 items-center justify-center rounded-full bg-gradient-to-br from-ink-800 to-ink-950 px-7 text-[15px] font-semibold text-sand-50 shadow-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-800"
        >
          Begin at {first}
        </HistoryJump>
      </div>
    </section>
  );
}
