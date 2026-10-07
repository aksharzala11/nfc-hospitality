import type { Metadata } from "next";
import { annotateMeals, getMeals, menuRevealAll } from "@/lib/schedule";
import { EVENT_DAYS } from "@/lib/time";
import { pageNow, type SearchParams } from "@/lib/pageNow";
import { EVENT_NAME } from "@/lib/branding";
import { MenuView } from "@/components/MenuView";
import { TimeTravelBanner } from "@/components/TimeTravelBanner";
import { HubPageHeader } from "@/components/HubPageHeader";

export const metadata: Metadata = { title: "Menu" };
export const dynamic = "force-dynamic";

export default async function MenuPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { now, traveling, label, eventDay } = pageNow(sp);
  const meals = annotateMeals(await getMeals(), now);

  return (
    <div>
      {traveling && <TimeTravelBanner label={label} />}
      <HubPageHeader
        eyebrow={`${EVENT_NAME} · Delegate meals`}
        title="Menu"
        subtitle="Each menu is revealed one hour before the meal."
      />

      {menuRevealAll() && (
        <p className="mb-4 rounded-2xl border border-coral-300 bg-coral-50 px-3.5 py-2 text-xs font-medium text-coral-900">
          Audit mode: every menu is visible. Set <span className="font-mono">MENU_REVEAL_ALL=false</span> to restore
          timed reveals.
        </p>
      )}
      <MenuView meals={meals} initialDay={eventDay ?? EVENT_DAYS[0]} today={eventDay} nowIso={now.toISOString()} />
    </div>
  );
}
