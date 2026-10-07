import { MandirArt } from "@/components/MandirArt";
import {
  HISTORY,
  historyCounts,
  historyCountsLabel,
  historyYears,
  splitQuote,
  yearAnchor,
  type HistoryEntry,
  type HistoryYear,
  type HistoryYearInfo,
} from "@/lib/history";
import { HistoryJump } from "./HistoryJump";
import { PhotoPlate } from "./PhotoPlate";
import styles from "./history.module.css";

/** The id of the page's title (its h1), which the ending's "Back to the start" jumps to. */
export const HISTORY_TOP_ID = "history-top";

/**
 * The History timeline: five parts, each an ink "gate" (its years) and a rail of its years;
 * every year a large Enilas numeral with its events under it, an event's photographs on a
 * white mat (PhotoPlate) under its sentence; then the ending.
 *
 * Server-rendered and complete as HTML: headings (h2 per part, h3 per year) and nested ordered
 * lists read in order without CSS or script. The rail, dots, nodes and ticks are decoration
 * (aria-hidden). The hooks HistoryNav's observers look for are data-history-year (a year's
 * block), its h3, and data-history-entry; nothing here that contains a photograph is ever
 * transformed, faded, filtered, clipped or animated (see history.module.css).
 */
export function HistoryTimeline() {
  const info = new Map(historyYears().map((y) => [y.year, y]));
  const first = HISTORY[0].years[0].year;
  const lastPart = HISTORY[HISTORY.length - 1];
  const last = lastPart.years[lastPart.years.length - 1].year;

  return (
    <>
      {HISTORY.map((part, p) => {
        const from = part.years[0].year;
        const to = part.years[part.years.length - 1].year;
        return (
          <div key={part.id} className={p === 0 ? "pt-5" : "pt-8"}>
            {/* The gate: the part's years only; the parts have no names. */}
            <div className="rounded-3xl bg-gradient-to-br from-ink-900 to-ink-800 px-5 py-5">
              {/* The heading's top clears the sticky year strip when it is jumped to. */}
              <h2 id={part.id} className="scroll-mt-16">
                <span className="block text-[11px] font-bold uppercase tracking-caps text-coral-300">
                  Part {p + 1} of {HISTORY.length}
                  <span className="sr-only">: </span>
                </span>
                <span className="font-display mt-1 block text-[2rem] leading-tight text-sand-50">
                  {from} – {to}
                </span>
              </h2>
              <p className="mt-0.5 text-sm text-ink-200">{historyCountsLabel(historyCounts([part]))}</p>
            </div>

            <div className="relative pb-6">
              {/* First, so everything after it (the dots, the nodes, the photo mats) paints over it. */}
              <div aria-hidden="true" className={styles.rail}>
                <div className={styles.tip} />
              </div>
              <ol>
                {part.years.map((y) => (
                  <YearBlock key={y.year} year={y} info={info.get(y.year)} />
                ))}
              </ol>
            </div>
          </div>
        );
      })}

      {/* The ending: the line stops at a filled node. */}
      <div className={`relative pl-7 ${styles.ending}`}>
        <span aria-hidden="true" className="absolute left-[3px] top-0 h-3.5 w-3.5 rounded-full bg-ink-800" />
        <div className="pt-7">
          <MandirArt className="w-36 text-ink-800/30" />
          <p className="font-display mt-3 text-[1.75rem] leading-tight text-ink-900">
            {first} – {last}
          </p>
          <HistoryJump
            to={HISTORY_TOP_ID}
            className="mt-4 inline-flex min-h-11 items-center rounded-full border border-ink-800/25 bg-white px-5 text-sm font-semibold text-ink-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-800"
          >
            Back to the start
          </HistoryJump>
        </div>
      </div>
    </>
  );
}

function YearBlock({ year, info }: { year: HistoryYear; info: HistoryYearInfo | undefined }) {
  const skipped = info?.skipped ?? 0;
  return (
    <li data-history-year={year.year} className={`relative pl-7 ${skipped > 0 ? "pt-5" : "pt-10"}`}>
      {/* One tick on the line for every year since the last one that has no event. */}
      {skipped > 0 && (
        <div aria-hidden="true" className="relative -ml-[22px] mb-5 flex w-2 flex-col gap-2">
          {Array.from({ length: skipped }, (_, i) => (
            <span key={i} data-history-tick="" className="block h-0.5 w-2 rounded-full bg-sand-400" />
          ))}
        </div>
      )}

      {/* tabIndex -1: a jump from the year strip moves focus here; its ring (after a keyboard
          jump only) is .yearHead's in history.module.css. */}
      <h3 id={yearAnchor(year.year)} tabIndex={-1} className={`relative scroll-mt-16 rounded-sm ${styles.yearHead}`}>
        <span
          aria-hidden="true"
          className="absolute -left-[25px] top-[25px] h-3.5 w-3.5 rounded-full border-2 border-ink-800 bg-sand-100"
        />
        <time dateTime={String(year.year)} className={`font-display ${styles.numeral}`}>
          {year.year}
        </time>
      </h3>

      <ol className="mt-3 flex flex-col gap-5">
        {year.entries.map((entry) => (
          <li key={entry.id} data-history-entry="" className={`relative ${styles.entry}`}>
            <span aria-hidden="true" className={styles.dot} />
            <EntryText entry={entry} />
            {entry.photos && <PhotoPlate caption={entry.photos.caption} items={entry.photos.items} />}
          </li>
        ))}
      </ol>
    </li>
  );
}

/** The entry's sentence; a quotation in it is set apart in the display face, in the same paragraph. */
function EntryText({ entry }: { entry: HistoryEntry }) {
  const { before, quote, after } = splitQuote(entry);
  return (
    <p className="text-base leading-[1.6] text-ink-800">
      {before}
      {quote && (
        <>
          {" "}
          <span
            lang={entry.quote?.lang}
            className={`font-display mt-1.5 block leading-snug text-ink-900 ${
              entry.quote?.lang ? "text-[1.375rem]" : "text-2xl"
            }`}
          >
            {quote}
          </span>
        </>
      )}
      {after && <> {after}</>}
    </p>
  );
}
