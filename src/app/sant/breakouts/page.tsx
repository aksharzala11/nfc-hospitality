import type { Metadata } from "next";
import { Users } from "lucide-react";
import { requireSant } from "@/lib/auth";
import { santVenueTrack } from "@/lib/sant";
import { defaultOpenBlock, getSantBreakouts, santBlockViews } from "@/lib/santBreakouts";
import { pageNow, type SearchParams } from "@/lib/pageNow";
import { getVenueForPages, venueHref } from "@/lib/venue/data";
import { TimeTravelBanner } from "@/components/TimeTravelBanner";
import { SantBreakoutBlocks } from "@/components/sant/pages/SantBreakoutBlocks";
import { SantEmptyState } from "@/components/sant/pages/SantEmptyState";
import { SantPageHeader } from "@/components/sant/pages/SantPageHeader";

export const metadata: Metadata = { title: "Breakout Sessions" };
export const dynamic = "force-dynamic";

/**
 * Pujya Santo breakout sessions. Santos have no sessions of their own (user, 2026-10-02): they
 * join whichever team breakout they like, Bhaio sessions only, never a Behno one, and of those
 * both tracks hold only the ones the organisers mark "Santo joining", at the marked time
 * (src/lib/santBreakouts.ts: the real "bk-" team breakouts with their live moves, never
 * users.breakout_sessions or the Santo sample rows). The page lists them in blocks
 * ("Friday afternoon"), each a card that opens on a tap to the sessions in it: title, times when
 * they differ from the block's, a "Santo joining" chip on a marked one, the note, and the rooms,
 * each opening /sant/map (keeping ?now=)
 * when it is on the venue map for the Bhaio track (santVenueTrack()) and not staff only. The
 * block on now is open, else the next one; with every block over, all are closed. The schedule's
 * breakout rows link here. A venue map problem never stops the page: the rooms are then plain.
 */
export default async function SantBreakoutsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { now, traveling, label } = pageNow(sp);
  const sant = await requireSant();
  const [{ blocks }, venue] = await Promise.all([
    getSantBreakouts(),
    // The Pujya Santo payload, so a room link is checked against the map /sant/map opens.
    getVenueForPages(sant).catch((err: unknown) => {
      console.error("[venue] /sant/breakouts couldn't read the venue map:", err instanceof Error ? err.message : err);
      return null;
    }),
  ]);

  const nowParam = traveling && typeof sp.now === "string" ? sp.now : undefined;
  const track = santVenueTrack(sant);
  const views = santBlockViews(
    blocks,
    now,
    venue ? (room) => venueHref(room, venue.index, { now: nowParam, track, base: "/sant/map" }) : null,
  );

  return (
    <div className="stagger">
      {traveling && <TimeTravelBanner label={label} />}
      <SantPageHeader title="Breakout Sessions" subtitle="Join any session you like. Tap a block to see its sessions and rooms." />

      {views.length === 0 ? (
        <SantEmptyState icon={Users} title="Breakout sessions will appear here">
          The sessions you can join will be listed here, with their rooms and times, once they are published.
        </SantEmptyState>
      ) : (
        <SantBreakoutBlocks blocks={views} openId={defaultOpenBlock(views)} />
      )}
    </div>
  );
}
