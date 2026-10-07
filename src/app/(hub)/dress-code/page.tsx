import type { Metadata } from "next";
import { requireGuest } from "@/lib/auth";
import { trackGender } from "@/lib/admin/announcements";
import { dressTracksFor } from "@/lib/dressCode";
import { pageNow, type SearchParams } from "@/lib/pageNow";
import { EVENT_DAYS, formatDayRange } from "@/lib/time";
import { EVENT_NAME } from "@/lib/branding";
import { HubPageHeader } from "@/components/HubPageHeader";
import { TimeTravelBanner } from "@/components/TimeTravelBanner";
import { DressCodeCard } from "@/components/dress/DressCodeCard";

export const metadata: Metadata = { title: "Dress code" };
export const dynamic = "force-dynamic";

/**
 * What to wear each day, as the organisers give it (src/lib/dressCode.ts):
 * the guest's own track, one row per event day with its date. Today's row is
 * marked and the days gone by step back (?now= moves both). The track comes
 * from the requireGuest() object, so a mirror tester sees the mirrored
 * delegate's; a guest with no gender on file sees both, Bhaio then Behno.
 * Santos never reach it: the hub layout sends them to /sant.
 */
export default async function DressCodePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { today, traveling, label } = pageNow(sp);
  const guest = await requireGuest();
  const tracks = dressTracksFor(trackGender(guest));

  return (
    <div>
      {traveling && <TimeTravelBanner label={label} />}
      <HubPageHeader
        eyebrow="What to wear"
        title="Dress code"
        subtitle={`Each day of ${EVENT_NAME}, ${formatDayRange(EVENT_DAYS)}`}
      />

      <div className="stagger space-y-6">
        {tracks.map((track) => (
          <DressCodeCard key={track} track={track} today={today} />
        ))}
      </div>
    </div>
  );
}
