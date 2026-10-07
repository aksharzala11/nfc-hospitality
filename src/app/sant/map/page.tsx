import type { Metadata } from "next";
import { MapPinned } from "lucide-react";
import { requireSant } from "@/lib/auth";
import { santName, santVenueTrack } from "@/lib/sant";
import { pageNow, type SearchParams } from "@/lib/pageNow";
import { HERE_PLACE_RE } from "@/lib/here";
import { formatTime } from "@/lib/time";
import { getVenueForPages } from "@/lib/venue/data";
import { aliasEntriesFor } from "@/lib/venue/aliases";
import { mapDeepLink, mapHereLink, mapRules, programmePlaces } from "@/lib/venue/mapPage";
import { TimeTravelBanner } from "@/components/TimeTravelBanner";
import { VenueMap } from "@/components/map/VenueMap";
import { SantEmptyState } from "@/components/sant/pages/SantEmptyState";
import { SantPageHeader } from "@/components/sant/pages/SantPageHeader";

export const metadata: Metadata = { title: "Venue map" };
export const dynamic = "force-dynamic";

const queryText = (value: string | string[] | undefined, max = 160) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

/**
 * The venue map for the Pujya Santo view: the delegate /map (src/app/(hub)/map/page.tsx) for
 * santos. Every public room of the Edison mandir on its floor under the organisers' name for it,
 * search, and walking directions across floors (stairs, or elevators only when step-free), in 2D
 * or as a 3D stack of floors; staff-only rooms are drawn and named but have no directions.
 *
 * Santos are on the Bhaio track (santVenueTrack(): santGender()), so directions use only the
 * right-side stairs / elevators, and a place with one room per track is the Bhaio one. ?to= and
 * ?from= deep links (the room links on /sant/breakouts open ?to=) are resolved with that track,
 * ?stepFree=1 opens with Step-free on, and the Programme places are /map's (src/lib/venue/
 * mapPage.ts) but for "Dining Hall" (the delegates' dining rooms). No rooms of his own are offered (santos have no breakout sessions of their own)
 * and no admin coverage panel. AutoRefresh skips this page (src/app/sant/layout.tsx). Until a map
 * is imported the page says it isn't available yet, in the Santo page style.
 *
 * The sadhus' residence is shown here, and only here (and checked by the /sant/breakouts room
 * links), never on /map: getVenueForPages(sant) gives a viewer with role SANT the Pujya Santo
 * payload (toSantClientVenue(), src/lib/venue/clientVenue.ts): the residence rooms santos are shown
 * under the names the user gave them (SANT_ROOM_NAMES), searchable, a start and a destination, with
 * directions to and from them over the residence's own corridors (route.ts: trips that neither
 * start nor end there are the delegates' routes exactly); those corridors read as plain floor,
 * unlabelled, and its other rooms stay bare outlines. When
 * the map's santo extras have any problem santos get the delegates' map (fail closed). The default
 * start stays the Main Foyer. The browser gets only those props, the alias list
 * aliasEntriesFor() narrows to the track, and the organisers' flow rules for the Bhaio track taken
 * as /map takes them (mapRules(): at ?at=, else at the page's time, ?now= honoured; the page
 * refreshes when they change): a trip outside the residence is the delegates' Bhaio route.
 */
export default async function SantMapPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { now, traveling, label } = pageNow(sp);
  const sant = await requireSant();
  // Role SANT: the Pujya Santo payload (the sadhus' residence too). Never pass a viewer elsewhere.
  const map = await getVenueForPages(sant);

  const nfc = typeof sp.here === "string" && HERE_PLACE_RE.test(sp.here);
  const destination = queryText(sp.to);
  const programme = queryText(sp.programme);
  const starts = queryText(sp.starts, 40);
  const startsAt = starts ? new Date(starts) : null;
  const routeSummary = destination
    ? programme
      ? sp.active === "1"
        ? `${programme} is happening now in ${destination}.`
        : startsAt && Number.isFinite(startsAt.getTime())
          ? `${programme} starts at ${formatTime(startsAt)} in ${destination}.`
          : `Your next stop is ${programme} in ${destination}.`
      : `Follow the route to ${destination}.`
    : "You are here. Choose any destination below.";

  const header = (
    <>
      {traveling && <TimeTravelBanner label={label} />}
      <SantPageHeader
        title={nfc ? "Your route" : "Venue map"}
        subtitle={
          nfc ? (
            <>
              Jay Swāminārāyan, {santName(sant)}. {routeSummary}
            </>
          ) : (
            "Edison mandir · Find any room and get directions between floors"
          )
        }
      />
    </>
  );

  if (!map) {
    return (
      <div className="stagger">
        {header}
        <SantEmptyState icon={MapPinned} title="The venue map isn’t available yet">
          The mandir&rsquo;s floor plans will show here soon, with directions to every room.
        </SantEmptyState>
      </div>
    );
  }

  const { venue, index } = map;
  // The Bhaio side's stairs / elevators (santGender()); also which room a per-track place means.
  const track = santVenueTrack(sant);
  // The organisers' flow rules (Bhaio's), as /map takes them: at ?at=, else now; refreshed when they change.
  const rules = mapRules(map, sp.at, now, traveling, track);

  return (
    <div>
      {header}
      <VenueMap
        venue={venue}
        track={track}
        aliases={aliasEntriesFor(index, track)}
        quick={[]}
        // Not "Dining Hall": it leads to the Bhaio delegates' dining room, and the Santo schedule
        // gives santos' meals no room.
        places={programmePlaces(index, track, ["Dining Hall"])}
        initialTo={mapDeepLink(sp.to, index, track)}
        initialFrom={mapDeepLink(sp.from, index, track)}
        // An NFC tag's place (/here/<place> sends santos here): "You are here".
        initialHere={mapHereLink(sp.here, index)}
        initialStepFree={sp.stepFree === "1"}
        coverage={null}
        rules={rules.rules}
        rulesUntil={rules.until}
        rulesNote={rules.note}
      />
    </div>
  );
}
