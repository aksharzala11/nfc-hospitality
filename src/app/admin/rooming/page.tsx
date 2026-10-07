import type { Metadata } from "next";
import { BedDouble, SearchX } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { readSevaFilter, sevaFilterLabel, sevaOptionValue } from "@/lib/admin/sevaFilter";
import { getSevaOptions } from "@/lib/admin/sevaFilterData";
import type { Stay } from "@/lib/rooming";
import { compareHotels, hotelInfo } from "@/lib/hotels";
import { getHotelLiaisons } from "@/lib/hotelLiaisons";
import { pageNow, type SearchParams } from "@/lib/pageNow";
import { TimeTravelBanner } from "@/components/TimeTravelBanner";
import { HelpContactNote } from "@/components/admin/shell/HelpContactNote";
import { PageHeader } from "@/components/admin/shell/PageHeader";
import { SevaFilter } from "@/components/admin/shell/SevaFilter";
import { LogisticsSwitch } from "@/components/admin/transport/LogisticsSwitch";
import { HotelChips, StaySwitch, type HotelChip } from "@/components/admin/rooming/RoomingControls";
import { FamilyRooms, HotelTotals, RoomingSummary } from "@/components/admin/rooming/RoomingSummary";
import { RoomingBoardView } from "@/components/admin/rooming/RoomingBoardView";
import {
  HOTEL_PARAM,
  STAY_PARAM,
  STAY_WORDS,
  readHotel,
  readStay,
  roomingHref,
  sizeBreakdown,
} from "@/components/admin/rooming/board";
import { plural } from "@/components/admin/transport/board";
import { loadRoomingBoard, stayHelpCoverage } from "./data";

export const metadata: Metadata = { title: "Rooming" };
export const dynamic = "force-dynamic";

/**
 * The rooming board (read-only): hotel room groups from the organisers'
 * rooming list (`npm run rooming:import`). The stay (Wednesday night / from
 * Thursday), the hotels, then per hotel every room group the organisers booked
 * (room_groups, even one nobody could be placed in) with its occupants, open
 * beds and notes (rooms mixing Bhaio and Behno, fine as family / couple rooms;
 * beds held by a sheet conflict; people not in the app yet), and in each hotel's
 * header its Hotel Liaison(s) per track (set with `npm run hotel:liaisons`).
 * A coral note up top says when delegates of a track have no accommodation
 * contact on /stay (a DELEGATE hotline with topic STAY or GENERAL, set with
 * `npm run hotlines`).
 * Nothing is edited here: the next import replaces it. Room group numbers are
 * the organisers' assignments, not hotel room numbers (those come at check-in).
 *
 *   ?stay=main|wed        default: main (from Thu, Oct 8)
 *   ?hotel=<key>          one hotel (src/lib/hotels.ts); default: every hotel
 *   ?seva=...             the console's seva filter: room groups with anyone of those sevas
 *
 * Honours ?now= (kept on every link while time-travelling; the board itself
 * doesn't change with the time).
 */
export default async function AdminRoomingPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  // The layout checks too, but layouts don't re-run on every navigation.
  await requireAdmin();
  const { traveling, label } = pageNow(sp);
  const sevas = readSevaFilter(sp);
  const stay = readStay(sp[STAY_PARAM]);
  const hotel = readHotel(sp[HOTEL_PARAM]);

  const [board, sevaOptions, liaisons, helpCoverage] = await Promise.all([
    loadRoomingBoard({ stay, hotel, sevas }),
    getSevaOptions(),
    getHotelLiaisons(),
    stayHelpCoverage(),
  ]);
  // Delegates' /stay lists their track's accommodation (or general) contacts; a track without
  // one sees nobody to call there.
  const helpNote = <HelpContactNote topic="STAY" coverage={helpCoverage} />;

  const keep = { now: traveling && typeof sp.now === "string" ? sp.now : null, sevas };
  const href = (s: Stay, h: string | null) => roomingHref(s, h, keep);
  const sevaLabels = [...new Set(sevas.map(sevaOptionValue).filter(Boolean))];
  const sevaText = sevaLabels.length > 0 ? sevaFilterLabel(sevaLabels) : null;

  const header = (
    <>
      <LogisticsSwitch current="rooming" keep={keep} />
      <PageHeader
        title="Rooming"
        className="mb-4"
        description={
          <>
            Hotel room groups from the organisers&apos; rooming list. Read-only: the next import updates it. Room group
            numbers are assignments; the hotel&apos;s room numbers come at check-in.
          </>
        }
      />
    </>
  );

  // No room_assignments table yet, or nothing imported: say so, and nothing else.
  if (!board || (!board.sevaFiltered && board.stayOptions.every((o) => o.count === 0))) {
    return (
      <div>
        {traveling && <TimeTravelBanner label={label} />}
        {header}
        {helpNote}
        <div className="card px-6 py-10 text-center">
          <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-sand-200 text-ink-600">
            <BedDouble aria-hidden="true" className="h-6 w-6" />
          </span>
          <p className="font-semibold text-ink-900">No rooming data yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-ink-600">
            The organisers&apos; rooming list hasn&apos;t been imported. Once it is (
            <code className="rounded bg-sand-100 px-1 text-xs text-ink-800">npm run rooming:import</code>), the hotels
            and room groups show here.
          </p>
        </div>
      </div>
    );
  }

  const stayCount = (s: Stay) => board.stayOptions.find((o) => o.value === s)?.count ?? 0;
  const hotelChips: HotelChip[] = [
    {
      value: null,
      label: "All hotels",
      count: board.hotelOptions.reduce((n, o) => n + o.count, 0),
      href: href(stay, null),
    },
    ...board.hotelOptions.map((o) => ({ value: o.value, label: o.label, count: o.count, href: href(stay, o.value) })),
  ];
  // A picked hotel nobody (in this stay, under the seva filter) is at stays visible, with 0.
  if (hotel && !hotelChips.some((c) => c.value === hotel)) {
    hotelChips.push({ value: hotel, label: hotelInfo(hotel).name, count: 0, href: href(stay, hotel) });
    hotelChips.sort((a, b) => (a.value === null ? -1 : b.value === null ? 1 : compareHotels(a.value, b.value)));
  }

  const words = STAY_WORDS[stay];
  const hotelName = hotel ? hotelInfo(hotel).name : null;
  const scope = hotelName ? `${hotelName} · ${words.long}` : words.long;
  const rooms = board.hotels.flatMap((h) => h.rooms);
  const occupants = rooms.flatMap((r) => r.occupants);
  const carried = occupants.filter((o) => o.otherStay === "SAME_ROOM").length;
  const footnote = [
    carried > 0 &&
      (stay === "MAIN"
        ? `${plural(carried, "person", "people")} here since Wednesday night, in the same room group`
        : `${plural(carried, "person", "people")} ${carried === 1 ? "stays" : "stay"} on in the same room group from Thursday`),
    board.totals.notInApp > 0 && `${board.totals.notInApp} not in the app yet (shown by User Id)`,
  ].filter(Boolean);
  const both = board.hotels.length > 1 && board.mixedTrackNotes.length > 0;

  return (
    <div>
      {traveling && <TimeTravelBanner label={label} />}
      {header}
      {helpNote}

      <div className="mb-5 flex flex-col gap-2">
        <SevaFilter options={sevaOptions} selected={sevas} />
        {sevaText && (
          <p className="text-xs leading-snug text-ink-600">
            Showing room groups with anyone of {sevaText}, with everyone in them. People who aren&apos;t in the app yet
            can&apos;t match a seva.
          </p>
        )}
      </div>

      <div className="stagger space-y-5">
        <div className="space-y-3">
          <StaySwitch
            stay={stay}
            // Every hotel: the Wednesday night is at Hampton only, so a picked hotel may not be in the other stay.
            hrefs={{ WED: href("WED", null), MAIN: href("MAIN", null) }}
            counts={{ WED: stayCount("WED"), MAIN: stayCount("MAIN") }}
          />
          <HotelChips chips={hotelChips} selected={hotel} />
        </div>

        <section aria-label="Counts" className="space-y-2">
          <RoomingSummary
            totals={board.totals}
            sizes={sizeBreakdown(rooms)}
            sevaFiltered={board.sevaFiltered}
            scope={scope}
          />
          {footnote.length > 0 && <p className="px-1 text-xs leading-snug text-ink-600">{footnote.join(" · ")}</p>}
        </section>

        {(board.hotels.length > 1 || board.mixedTrackNotes.length > 0) && (
          <div className={`grid items-start gap-3 ${both ? "md:grid-cols-2" : ""}`}>
            {board.hotels.length > 1 && (
              <HotelTotals hotels={board.hotels} hrefOf={(key) => href(stay, key)} scope={words.long} />
            )}
            {board.mixedTrackNotes.length > 0 && <FamilyRooms notes={board.mixedTrackNotes} />}
          </div>
        )}

        {board.hotels.length === 0 ? (
          <div className="card px-6 py-8 text-center">
            <span className="mx-auto mb-2.5 flex h-11 w-11 items-center justify-center rounded-2xl bg-sand-200 text-ink-500">
              <SearchX aria-hidden="true" className="h-5 w-5" />
            </span>
            <p className="text-sm font-semibold text-ink-900">
              {["No room groups", hotelName && `at ${hotelName}`, stay === "WED" ? "on Wednesday night" : "from Thursday", sevaText && `for ${sevaText}`]
                .filter(Boolean)
                .join(" ")}
            </p>
            <p className="mx-auto mt-0.5 max-w-xs text-xs leading-snug text-ink-600">
              {sevaText ? "Try another hotel or stay, or clear the seva filter." : "Try another hotel or stay."}
            </p>
          </div>
        ) : (
          <RoomingBoardView
            // A new stay or hotel starts with a clear search.
            key={`${stay}|${hotel ?? "all"}`}
            hotels={board.hotels}
            liaisons={liaisons}
            stay={stay}
            sevaFiltered={board.sevaFiltered}
            keep={keep}
          />
        )}

        <p className="px-1 text-xs leading-snug text-ink-600">
          Someone on more than one row of the sheet (a conflict) isn&apos;t placed until the sheet is fixed: their beds
          show as held, by User Id.
        </p>
      </div>
    </div>
  );
}
