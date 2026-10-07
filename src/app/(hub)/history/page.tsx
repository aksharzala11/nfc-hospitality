import type { Metadata } from "next";
import { requireGuest } from "@/lib/auth";
import { EVENT_PLACE } from "@/lib/branding";
import { historyYears } from "@/lib/history";
import { HubPageHeader } from "@/components/HubPageHeader";
import { HistoryOpening } from "@/components/history/HistoryOpening";
import { HistoryNav } from "@/components/history/HistoryNav";
import { HISTORY_TOP_ID, HistoryTimeline } from "@/components/history/HistoryTimeline";
import styles from "@/components/history/history.module.css";

export const metadata: Metadata = { title: "Edison Mandir History" };
export const dynamic = "force-dynamic";

/**
 * Edison Mandir History, "Through the years": a scroll story of the mandir from its first year
 * in the organisers' list to its last, one line running through large year numerals, with a
 * sticky strip of the years to jump between them and four events' photographs on white mats.
 * The content is src/lib/history.ts; the photographs are public/history/photos/ (signed-in
 * guests only: the middleware covers /history/*).
 *
 * The page root is NOT `.stagger`: that animation leaves a transform on every child, which
 * would break the strip's position: sticky and sit on top of the photographs. Only the header
 * and the opening card fade up. No time-dependent content, so no `pageNow()`.
 */
export default async function HistoryPage() {
  await requireGuest();

  return (
    <div>
      <div className="stagger">
        <HubPageHeader
          eyebrow={EVENT_PLACE}
          title="Edison Mandir History"
          // "Back to the start" lands at the top of the page and moves focus to the title.
          titleId={HISTORY_TOP_ID}
          subtitle={`BAPS Shri Swaminarayan Mandir · ${EVENT_PLACE}`}
        />
        <HistoryOpening />
      </div>

      <section data-history-root="" aria-label="Timeline" className={`mt-6 ${styles.root}`}>
        <HistoryNav years={historyYears()} />
        <HistoryTimeline />
      </section>
    </div>
  );
}
