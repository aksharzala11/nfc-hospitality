import type { Metadata } from "next";
import { UtensilsCrossed } from "lucide-react";
import { requireSant } from "@/lib/auth";
import { annotateMeals, getMeals } from "@/lib/schedule";
import { EVENT_DAYS } from "@/lib/time";
import { pageNow, type SearchParams } from "@/lib/pageNow";
import { EVENT_NAME } from "@/lib/branding";
import { MenuView } from "@/components/MenuView";
import { TimeTravelBanner } from "@/components/TimeTravelBanner";
import { SantEmptyState } from "@/components/sant/pages/SantEmptyState";
import { SantPageHeader } from "@/components/sant/pages/SantPageHeader";

export const metadata: Metadata = { title: "Menu" };
export const dynamic = "force-dynamic";

/**
 * Pujya Santo menu: the santos' own meals (meals.menu_for = SANT, never the
 * delegate menu), shown like the delegate /menu (day tabs, meal pills and a
 * menu board) in the view's bhagwa accent (coral deepening into ember). Every menu is open from the
 * start, with its dishes (menuIsTimed() in src/lib/schedule.ts); a meal that is over shows as Served.
 */
export default async function SantMenuPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { now, traveling, label, eventDay } = pageNow(sp);
  const [, rows] = await Promise.all([requireSant(), getMeals("SANT")]);
  const meals = annotateMeals(rows, now);

  return (
    <div className="stagger">
      {traveling && <TimeTravelBanner label={label} />}
      <SantPageHeader title="Menu" subtitle={`${EVENT_NAME} · Every meal prepared for you, day by day.`} />

      {meals.length === 0 ? (
        <SantEmptyState icon={UtensilsCrossed} title="Your menu will appear here">
          The meals prepared for you will be listed here, day by day.
        </SantEmptyState>
      ) : (
        <MenuView
          meals={meals}
          initialDay={eventDay ?? EVENT_DAYS[0]}
          today={eventDay}
          nowIso={now.toISOString()}
          tone="bhagwa"
        />
      )}
    </div>
  );
}
