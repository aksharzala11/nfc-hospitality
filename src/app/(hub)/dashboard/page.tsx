import type { Metadata } from "next";
import { requireGuest } from "@/lib/auth";
import {
  annotateMeals,
  forAudience,
  getBreakoutsForUser,
  getMeals,
  getScheduleItems,
  goshthiGroupLabel,
  personalizeBreakouts,
  personalizeGoshthi,
} from "@/lib/schedule";
import { EVENT_DAYS } from "@/lib/time";
import { pageNow, type SearchParams } from "@/lib/pageNow";
import { EVENT_NAME, EVENT_PLACE } from "@/lib/branding";
import { welcomeName } from "@/lib/users";
import { sevaLabel } from "@/lib/teams";
import { buildClockData, buildDayStrip, menuSummary } from "@/lib/dashboard";
import { getTransportFor } from "@/lib/transport";
import { getStayFor, isRoomingTableMissing } from "@/lib/rooming";
import { BapsFooter, SachuLogo } from "@/components/brand/Sachu";
import { TimeTravelBanner } from "@/components/TimeTravelBanner";
import { HomeHero } from "@/components/dashboard/HomeHero";
import { HomeTiles } from "@/components/dashboard/HomeTiles";
import { NaamClock } from "@/components/dashboard/NaamClock";
import { PrasangCard } from "@/components/dashboard/PrasangCard";
import { transportTileSummary } from "@/components/transport/transportView";
import { stayTileSummary } from "@/components/stay/stayView";

export const metadata: Metadata = { title: "Home" };
export const dynamic = "force-dynamic";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { now, traveling, label, today, eventDay } = pageNow(sp);
  const suffix = traveling ? `?now=${encodeURIComponent(String(sp.now))}` : "";

  const [guest, allItems, meals, sessions, transport, stay] = await Promise.all([
    requireGuest(),
    getScheduleItems(),
    getMeals(),
    // Their own team breakouts, for the Team Breakouts slots in the hero. A failure only leaves
    // the slots' printed placeholder, never the home page.
    requireGuest().then((g) =>
      getBreakoutsForUser(g).catch((err: unknown) => {
        console.error("[dashboard] breakout rooms unavailable:", err);
        return [];
      }),
    ),
    // The Transportation tile's next leg. A failure here (e.g. the transport_legs table not
    // pushed yet) only costs the tile its summary, never the home page.
    requireGuest().then((g) =>
      getTransportFor(g.registrationId).catch((err: unknown) => {
        console.error("[dashboard] transport summary unavailable:", err);
        return null;
      }),
    ),
    // The Your stay tile's room group, on the same terms (quietly, before room_assignments
    // is pushed).
    requireGuest().then((g) =>
      getStayFor(g.registrationId).catch((err: unknown) => {
        if (!isRoomingTableMissing(err)) console.error("[dashboard] stay summary unavailable:", err);
        return null;
      }),
    ),
  ]);
  // Their track, with their own Goshthi sessions in their group's room (personalizeGoshthi())
  // and their Team Breakouts slots in their own rooms (personalizeBreakouts(), from the room they
  // should be in now while a slot is under way), so the hero's now / next names those rooms.
  const items = personalizeBreakouts(personalizeGoshthi(forAudience(allItems, guest.gender), guest), sessions, now);
  const dayIndex = eventDay ? EVENT_DAYS.indexOf(eventDay) + 1 : 0;

  return (
    <div>
      {traveling && <TimeTravelBanner label={label} />}

      {/* The page opens on the hero and its countdown (the murti stays on the sign-in page). */}
      <div className="stagger">
        <HomeHero name={welcomeName(guest)}>
          <NaamClock
            data={buildClockData(items, now)}
            serverNow={now.toISOString()}
            traveling={traveling}
            scheduleHref={`/schedule${suffix}`}
          />
        </HomeHero>

        <PrasangCard />

        <HomeTiles
          suffix={suffix}
          scheduleSubtitle={dayIndex ? `Day ${dayIndex} of ${EVENT_DAYS.length}` : `Oct 8–11 · ${EVENT_PLACE}`}
          days={buildDayStrip(items, now, today)}
          menu={menuSummary(annotateMeals(meals, now), now, today)}
          seva={sevaLabel(guest.seva)}
          group={goshthiGroupLabel(guest.goshthiGroup, guest.sevaWing)}
          transport={transport && transportTileSummary(transport, now)}
          stay={stay && stayTileSummary(stay, today)}
        />
      </div>

      {/* Sign-off on the brand's ink: the white Sāchu lock-up, then the standard BAPS footer
          with room around it. Also outside .stagger, so the footer art never animates. */}
      <footer className="mt-8 rounded-[1.75rem] bg-ink-800 px-3 pb-6 pt-8 text-center shadow-card-lg">
        <SachuLogo variant="white" className="mx-auto w-36" />
        <p className="mt-4 text-[10px] font-bold uppercase tracking-[0.24em] text-coral-200">
          {EVENT_NAME} · {EVENT_PLACE}
        </p>
        <span aria-hidden="true" className="mx-auto mt-7 block h-px w-16 bg-white/15" />
        <BapsFooter className="mt-7 w-full" />
      </footer>
    </div>
  );
}
