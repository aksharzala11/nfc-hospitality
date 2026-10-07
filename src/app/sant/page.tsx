import type { Metadata } from "next";
import { requireSant } from "@/lib/auth";
import { getAccommodation, getHotlines, getSantSchedules, santContactsFor, santName } from "@/lib/sant";
import { annotateMeals, getMeals } from "@/lib/schedule";
import { getSantBreakouts, santBlockViews } from "@/lib/santBreakouts";
import { SANT_DAYS, formatDayLong, formatDayRange, santDayOf } from "@/lib/time";
import { pageNow, type SearchParams } from "@/lib/pageNow";
import { EVENT_NAME, EVENT_PLACE } from "@/lib/branding";
import { BapsFooter, SachuLogo } from "@/components/brand/Sachu";
import { TimeTravelBanner } from "@/components/TimeTravelBanner";
import { withNow } from "@/components/sant/shell/links";
import { nameInitial } from "@/components/sant/shell/identity";
import { SantHero } from "@/components/sant/home/SantHero";
import { SantClock } from "@/components/sant/home/SantClock";
import { SantProgramme } from "@/components/sant/home/SantProgramme";
import { SantTiles } from "@/components/sant/home/SantTiles";
import {
  blockRows,
  companionsLine,
  mealRows,
  programmeList,
  santClockData,
  scheduleRows,
  tileDays,
  type SantTilesData,
} from "@/components/sant/home/data";

export const metadata: Metadata = { title: "Home" };
export const dynamic = "force-dynamic";

/**
 * Pujya Santo home, in the Sāchu brand: it opens on an ink-and-ember sandhya
 * hero with the countdown to the Santo general schedule (Oct 5-15; then its
 * live now / next), "Your programme" now / next from his own schedule, tiles
 * for his schedule, utaro, transport, the Santo menu, the breakout blocks he can
 * join and the general schedule, and the Sāchu lock-up with the BAPS footer on a closing ink
 * band. Days count over the Santo days (SANT_DAYS), never the delegate
 * programme. The hero clock, the programme card and the tiles are client
 * islands that tick from pageNow(), so ?now= time travel works; the data
 * behind them refreshes with AutoRefresh.
 */
export default async function SantHomePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { now, traveling, label } = pageNow(sp);
  const santDay = santDayOf(now);
  // Keep the demo "now" on every link while time-travelling.
  const link = (href: string) => withNow(href, traveling ? String(sp.now) : null);

  const sant = await requireSant();
  const [{ general, personal }, stay, hotlines, meals, breakouts] = await Promise.all([
    // Per-person reads by dataUserId: a Santo mirror test account shows the mirrored sant's.
    getSantSchedules(sant.dataUserId, now),
    getAccommodation(sant.dataUserId),
    getHotlines("SANT"),
    getMeals("SANT"),
    getSantBreakouts(),
  ]);

  const clock = santClockData(general, now, SANT_DAYS);
  const serverNow = now.toISOString();
  // The Transport tile calls the transport contact (else a general one): santContactsFor().
  const hotline = santContactsFor(hotlines, "TRANSPORT")[0] ?? null;
  const hrefs = {
    mine: link("/sant/schedule"),
    general: link("/sant/schedule?tab=general"),
    stay: link("/sant/stay"),
    transport: link("/sant/transport"),
    menu: link("/sant/menu"),
    breakouts: link("/sant/breakouts"),
  };

  // Plain data only (the tiles are a client island): never the users row itself.
  const tiles: SantTilesData = {
    dayStarts: clock.dayStarts,
    days: tileDays(general, SANT_DAYS),
    generalSubtitle: formatDayRange(SANT_DAYS),
    mine: scheduleRows(personal, clock.dayStarts),
    stay: stay && {
      placeName: stay.placeName,
      withLine: companionsLine(stay.companions),
      avatars: stay.companions.slice(0, 2).map((c) => ({ id: c.id, initial: nameInitial(c.name) })),
    },
    transport: {
      hotline: hotline && {
        label: hotline.label,
        contactName: hotline.contactName,
        phoneDisplay: hotline.phoneDisplay,
        telHref: hotline.telHref,
        telegramHref: hotline.telegramHref,
      },
      rides: scheduleRows(
        personal.filter((i) => i.kind === "TRAVEL"),
        clock.dayStarts,
      ),
      fallback: hotline?.availability ?? "Hotline and your rides",
    },
    // The Santo menu is open from the start (no reveals): the tile features the meal on now or next.
    menu: { meals: mealRows(annotateMeals(meals, now), clock.dayStarts) },
    // Santos have no breakout sessions of their own: the tile follows the blocks of sessions they can join.
    breakouts: { blocks: blockRows(santBlockViews(breakouts.blocks, now, null), clock.dayStarts) },
  };

  return (
    <div>
      {traveling && <TimeTravelBanner label={label} />}

      {/* The page opens on the hero and its countdown (the murti stays on the sign-in page). */}
      <div className="stagger">
        <SantHero name={santName(sant)} dayLabel={santDay ? formatDayLong(santDay) : `${formatDayRange(SANT_DAYS)} · ${EVENT_PLACE}`}>
          <SantClock data={clock} serverNow={serverNow} traveling={traveling} scheduleHref={hrefs.general} />
        </SantHero>

        <SantProgramme
          personal={programmeList(personal, now, clock.dayStarts)}
          dayStarts={clock.dayStarts}
          programmeEnd={clock.end}
          serverNow={serverNow}
          traveling={traveling}
          personalHref={hrefs.mine}
          generalHref={hrefs.general}
        />

        <SantTiles data={tiles} hrefs={hrefs} serverNow={serverNow} traveling={traveling} />
      </div>

      {/* Closing ink band: the white Sāchu lock-up, then the standard BAPS footer with room to
          breathe. Static (outside .stagger): the footer art is never animated or overlapped.
          The layout's bottom padding already includes the safe area; pb-8 keeps the art ~14px
          clear of the back-to-top button when the page is scrolled to the end. */}
      <footer className="mt-10 rounded-[2rem] bg-ink-900 px-4 pb-8 pt-8 text-center shadow-card-lg">
        <SachuLogo variant="white" className="mx-auto w-36" />
        <p className="mt-4 text-[10px] font-bold uppercase tracking-[0.24em] text-coral-300">
          {EVENT_NAME} · {EVENT_PLACE}
        </p>
        <span aria-hidden="true" className="mx-auto my-6 block h-px w-16 bg-coral-300/40" />
        <BapsFooter className="mx-auto w-full" />
      </footer>
    </div>
  );
}
