import type { ReactNode } from "react";
import Link from "next/link";
import { Users } from "lucide-react";
import type { RoomingBoard, RoomingBoardHotel, RoomingMixedNote } from "@/lib/rooming";
import { CHIP, CHIP_OFF } from "@/components/admin/delegates/ui";
import { FOCUS, LABEL } from "@/components/admin/shell/ui";
import { roomAnchor, sizeBreakdown } from "./board";

/*
 * The rooming board's counts (server- and client-safe): four tiles for the
 * stay / hotel / seva shown, the per-hotel totals, and the room groups that
 * mix Bhaio and Behno.
 */

/**
 * People, room groups (by size), open beds and mixed rooms (Bhaio and Behno
 * together). 2 × 2 on phones, a row of four from md. Under the seva filter
 * "People" counts the matches; the other tiles count the room groups listed
 * (every occupant).
 */
export function RoomingSummary({
  totals,
  sizes,
  sevaFiltered,
  scope,
}: {
  totals: RoomingBoard["totals"];
  /** sizeBreakdown() of the room groups listed. */
  sizes: string;
  sevaFiltered: boolean;
  /** "From Thu, Oct 8", or with the hotel: "Hilton, from Thu, Oct 8". */
  scope: string;
}) {
  return (
    <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Tile
        label={sevaFiltered ? "With the seva" : "People"}
        value={sevaFiltered ? totals.inFilter : totals.people}
        sub={sevaFiltered ? `${totals.people} in these room groups` : scope}
      />
      <Tile label="Room groups" value={totals.rooms} sub={sizes || "None listed"} />
      <Tile
        label="Open beds"
        value={totals.openBeds}
        sub={
          <>
            {totals.openBeds === 0 && totals.heldBeds === 0 ? `All ${totals.capacity} beds filled` : `of ${totals.capacity} beds`}
            {totals.heldBeds > 0 && (
              <span className="font-semibold text-coral-800"> · {totals.heldBeds} held by a sheet conflict</span>
            )}
          </>
        }
      />
      {/* Counted by users.gender, so not the organisers' "Family Room" total (a family can
          share one track, and someone not in the app has none). */}
      <Tile
        label="Mixed rooms"
        value={totals.mixedRooms}
        sub={totals.mixedRooms > 0 ? "Bhaio and Behno together" : "No room mixes Bhaio and Behno"}
      />
    </dl>
  );
}

function Tile({ label, value, sub }: { label: string; value: ReactNode; sub: ReactNode }) {
  return (
    <div className="card flex min-w-0 flex-col p-4">
      <dt className={LABEL}>{label}</dt>
      <dd className="mt-1.5 text-[1.75rem] font-extrabold leading-none tracking-tight tabular-nums text-ink-900">{value}</dd>
      <dd className="mt-1.5 text-xs leading-snug text-ink-600">{sub}</dd>
    </div>
  );
}

/**
 * Totals per hotel for the stay (room groups, people, beds, open beds), with
 * a total row; each hotel links to the board narrowed to it. Room sizes show
 * from md (each hotel's section repeats them on phones).
 */
export function HotelTotals({
  hotels,
  hrefOf,
  scope,
}: {
  hotels: RoomingBoardHotel[];
  /** The board narrowed to a hotel key. */
  hrefOf: (hotel: string) => string;
  /** "From Thu, Oct 8" / "Night of Wed, Oct 7". */
  scope: string;
}) {
  const total = hotels.reduce(
    (t, h) => ({
      rooms: t.rooms + h.rooms.length,
      people: t.people + h.people,
      capacity: t.capacity + h.capacity,
      openBeds: t.openBeds + h.openBeds,
    }),
    { rooms: 0, people: 0, capacity: 0, openBeds: 0 },
  );
  const num = "px-1.5 py-2.5 text-right tabular-nums md:px-2";
  const head = `${LABEL} px-1.5 py-2 text-right font-bold md:px-2`;
  return (
    <section aria-labelledby="rooming-hotel-totals" className="card overflow-hidden">
      <header className="px-4 pb-2.5 pt-3.5">
        <h2 id="rooming-hotel-totals" className="font-display text-xl leading-tight text-ink-900">
          By hotel
        </h2>
        <p className="mt-0.5 text-xs text-ink-600">{scope}</p>
      </header>
      <div className="px-1 pb-1 md:px-2">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-y border-ink-800/8">
              <th scope="col" className={`${LABEL} px-1.5 py-2 text-left font-bold md:px-2`}>
                Hotel
              </th>
              <th scope="col" className={head}>
                <abbr title="Room groups" className="no-underline">
                  Groups
                </abbr>
              </th>
              <th scope="col" className={head}>
                People
              </th>
              <th scope="col" className={head}>
                Beds
              </th>
              <th scope="col" className={head}>
                Open
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-800/8">
            {hotels.map((h) => (
              <tr key={h.key}>
                <th scope="row" className="px-1.5 py-2.5 text-left font-normal md:px-2">
                  <Link
                    href={hrefOf(h.key)}
                    className={`rounded font-semibold text-ink-900 underline decoration-ink-800/25 underline-offset-2 hover:decoration-ink-800 ${FOCUS}`}
                  >
                    {h.name}
                  </Link>
                  <span className="mt-0.5 hidden text-xs text-ink-600 md:block">{sizeBreakdown(h.rooms)}</span>
                </th>
                <td className={`${num} text-ink-900`}>{h.rooms.length}</td>
                <td className={`${num} text-ink-900`}>{h.people}</td>
                <td className={`${num} text-ink-900`}>{h.capacity}</td>
                <td className={`${num} ${h.openBeds > 0 ? "font-bold text-ink-900" : "text-ink-600"}`}>{h.openBeds}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-ink-800/15 font-bold text-ink-900">
              <th scope="row" className="px-1.5 py-2.5 text-left md:px-2">
                Total
              </th>
              <td className={num}>{total.rooms}</td>
              <td className={num}>{total.people}</td>
              <td className={num}>{total.capacity}</td>
              <td className={num}>{total.openBeds}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

/**
 * The room groups that mix Bhaio and Behno (by users.gender): fine for a
 * family or a couple, so a note to check, never a fix. Each links to its card.
 */
export function FamilyRooms({ notes }: { notes: RoomingMixedNote[] }) {
  return (
    <section aria-labelledby="rooming-family-rooms" className="card p-4">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sand-200 text-ink-700"
        >
          <Users className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0">
          <h2 id="rooming-family-rooms" className="font-display text-xl leading-tight text-ink-900">
            Mixed rooms
          </h2>
          <p className="mt-0.5 text-xs leading-snug text-ink-600">
            Bhaio and Behno share these room groups. That&apos;s expected for a family or a couple room; they&apos;re
            listed so they can be checked, not changed here.
          </p>
        </div>
      </div>
      <ul className="mt-3 flex flex-wrap gap-2">
        {notes.map((n) => (
          <li key={n.roomKey}>
            <a href={`#${roomAnchor(n.roomKey)}`} className={`${CHIP} ${CHIP_OFF} inline-flex items-center`}>
              <span className="whitespace-nowrap">
                {n.hotelName} · {n.label}
              </span>
              <span className="ml-1.5 whitespace-nowrap text-ink-600">
                {n.bhaio} Bhaio, {n.behno} Behno
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
