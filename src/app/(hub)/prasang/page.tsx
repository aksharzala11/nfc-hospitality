import type { Metadata } from "next";
import { requireGuest } from "@/lib/auth";
import { pageNow, type SearchParams } from "@/lib/pageNow";
import { PRASANG_SUBTITLE, PRASANG_TITLE } from "@/lib/prasang";
import { EVENT_NAME } from "@/lib/branding";
import { TimeTravelBanner } from "@/components/TimeTravelBanner";
import { HubPageHeader } from "@/components/HubPageHeader";
import { InkFeather, JournalPaper, PrasangFormHint, PrasangFormLink } from "@/components/dashboard/PrasangCard";

export const metadata: Metadata = { title: PRASANG_TITLE };
export const dynamic = "force-dynamic";

/**
 * The Prasang Submission Form as an in-app page, so announcements (which only
 * open in-app paths) can point at it: "/prasang" in the composer's link list
 * and its "Prasang form" template. The form itself is Microsoft Forms; the big
 * button opens it in the same tab (Telegram's in-app browser loses the Hub on a
 * new tab), and Back returns here. The same card sits on Home (PrasangCard).
 */
export default async function PrasangPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  // No internal links here (Home is in the bottom nav, which keeps ?now=); only the banner needs it.
  const { traveling, label } = pageNow(sp);
  await requireGuest();

  return (
    <div className="stagger">
      {traveling && <TimeTravelBanner label={label} />}

      <HubPageHeader eyebrow={`${EVENT_NAME} · Reporting team`} title={PRASANG_TITLE} subtitle={PRASANG_SUBTITLE} />

      {/* A journal page: sand paper, the ink well with its feather, and the form button. */}
      <section
        aria-labelledby="prasang-page-title"
        className="relative isolate overflow-hidden rounded-3xl border border-sand-300 bg-sand-50 px-5 pb-6 pt-8 text-center shadow-card"
      >
        <JournalPaper />

        <div className="relative mx-auto h-16 w-16">
          <span
            aria-hidden="true"
            className="absolute -inset-2.5 rounded-[1.6rem] bg-coral-300/30 motion-safe:animate-pulse-soft"
          />
          <InkFeather className="relative h-16 w-16 rounded-2xl" iconClassName="h-8 w-8" />
        </div>

        <h2 id="prasang-page-title" className="font-display mt-6 text-[1.75rem] leading-tight text-ink-900">
          Share your prasang
        </h2>
        <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-ink-600">
          Big or small, every prasang helps tell the story of NAAM.
        </p>

        <div className="mt-6">
          <PrasangFormLink hintId="prasang-page-hint" size="lg" />
        </div>
        <PrasangFormHint id="prasang-page-hint" className="mt-2.5 text-xs text-ink-500" />
      </section>

      <p className="mt-4 px-1 text-center text-xs text-ink-500">
        You&apos;ll also find this form on your Home screen.
      </p>
    </div>
  );
}
