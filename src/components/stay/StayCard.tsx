import type { ReactNode } from "react";
import { BedDouble, Check, Clock, KeyRound, MapPin, MoonStar, Navigation, Phone, type LucideIcon } from "lucide-react";
import type { StayLiaisonView } from "@/lib/hotelLiaisons";
import type { RoomStayView } from "@/lib/rooming";
import { formatPhone } from "@/lib/sant";
import { toE164 } from "@/lib/users";
import { StayLiaisons } from "./StayLiaisons";
import { StayRoommates } from "./StayRoommates";
import { directionsHref, hotelTimesLabel, type StayPhase } from "./stayView";

/**
 * One room group the delegate stays in, as a hotel key card: an ink band with
 * the hotel's name (plus its full name, address and phone once hotels.ts has
 * them; until the address is in, "Address and check-in time to follow") and
 * from which night ("From Wed, Oct 7"), then "Room group N" with the
 * note that the real room number comes at check-in, check-in / check-out times
 * and Directions / Call hotel when known, the roommates by name, and the
 * hotel's "Hotel Liaison(s)" for the guest's track (`liaisons`, already picked
 * with pickLiaisons(): every one of them, each with a Call button; nothing
 * when the hotel has none).
 *
 * `phase` (stayPhase(), which honours ?now=) adds a "Check-in today" chip on
 * the first night; a Wednesday-only room group whose night is over steps back
 * onto sand with a Done chip and drops its actions and liaison.
 */
export function StayCard({
  stay,
  phase,
  liaisons = [],
}: {
  stay: RoomStayView;
  phase: StayPhase;
  /** This hotel's liaisons for the guest's track (pickLiaisons()). */
  liaisons?: StayLiaisonView[];
}) {
  const over = phase === "over";
  const { hotel } = stay;
  const headingId = `stay-${stay.roomKey}`;
  const fullName = hotel.fullName?.trim() && hotel.fullName.trim() !== hotel.name ? hotel.fullName.trim() : null;
  const address = hotel.address?.trim() || null;
  const phone = hotel.phone?.trim() || null;
  const phoneDisplay = phone ? formatPhone(phone) : null;
  // Once the stay is over, the card is for reference only: no Directions or Call.
  const telHref = phone && !over ? `tel:${toE164(phone) ?? phone.replace(/[^\d+]/g, "")}` : null;
  const directions = over ? null : directionsHref(hotel);
  const times = over ? null : hotelTimesLabel(hotel);

  return (
    <section
      aria-labelledby={headingId}
      className={`overflow-hidden rounded-3xl ring-1 ring-inset ${
        over ? "bg-sand-50 ring-sand-200" : "bg-white shadow-card-lg ring-sand-200/60"
      }`}
    >
      {/* The key card's band: the brand's ink deepening into night, white text AA throughout;
          flat sand once the stay is over. */}
      <div
        className={`relative isolate overflow-hidden px-5 pb-5 pt-4 ${
          over ? "bg-sand-200 text-ink-900" : "bg-gradient-to-br from-ink-800 via-ink-900 to-ink-950 text-white"
        }`}
      >
        {!over && (
          <>
            <span aria-hidden="true" className="absolute -right-12 -top-16 -z-10 h-44 w-44 rounded-full bg-coral-400/25 blur-3xl" />
            <BedDouble
              aria-hidden="true"
              className="absolute -bottom-7 -right-5 -z-10 h-32 w-32 -rotate-6 text-white/[0.07]"
              strokeWidth={1.25}
            />
          </>
        )}

        <div className="flex items-center gap-2.5">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ${
              over ? "bg-white text-ink-600 ring-sand-300" : "bg-coral-400/15 text-coral-300 ring-coral-300/30"
            }`}
          >
            <BedDouble aria-hidden="true" className="h-[18px] w-[18px]" />
          </span>
          <p className={`text-[11px] font-bold uppercase tracking-[0.22em] ${over ? "text-ink-700" : "text-white"}`}>
            Your hotel
          </p>
          <PhaseChip phase={phase} />
        </div>

        <h2 id={headingId} className="font-display mt-3 text-balance text-[2rem] leading-tight">
          {hotel.name}
        </h2>
        {fullName && (
          <p className={`mt-0.5 text-sm leading-snug ${over ? "text-ink-700" : "text-white/85"}`}>{fullName}</p>
        )}

        <ul className={`mt-3 space-y-1.5 text-sm leading-snug ${over ? "text-ink-700" : "text-white"}`}>
          <BandLine icon={MoonStar} over={over}>
            <time dateTime={stay.firstNight} className="font-semibold">
              {stay.nightsLabel}
            </time>
          </BandLine>
          {address ? (
            <BandLine icon={MapPin} over={over}>
              <span className="break-words">{address}</span>
            </BandLine>
          ) : (
            // Until hotels.ts has the address: say it's coming, so nobody looks up the wrong property.
            !over && (
              <BandLine icon={MapPin} over={over}>
                <span className="text-white/85">
                  {times ? "Address to follow" : "Address and check-in time to follow"}
                </span>
              </BandLine>
            )
          )}
          {phoneDisplay && (
            <BandLine icon={Phone} over={over}>
              <span className="tabular-nums">{phoneDisplay}</span>
            </BandLine>
          )}
        </ul>
      </div>

      <div className="space-y-4 px-5 pb-5 pt-4">
        {/* "Room group N" is the organisers' assignment, not the hotel's room number. */}
        <div className="flex items-center gap-3">
          <span
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
              over
                ? "bg-sand-100 text-ink-500 ring-1 ring-inset ring-sand-200"
                : "bg-gradient-to-br from-coral-400 to-coral-700 text-white shadow-[0_8px_16px_-8px_rgb(196_65_71/0.8)]"
            }`}
          >
            <KeyRound aria-hidden="true" className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display text-[1.375rem] leading-tight text-ink-900">{stay.roomLabel}</p>
            {!over && (
              <p className="mt-0.5 text-sm leading-snug text-ink-600">Your actual room number is given at check-in.</p>
            )}
          </div>
        </div>

        {times && (
          <p className="flex items-center gap-3 rounded-2xl bg-sand-100 px-3.5 py-2.5 text-sm leading-snug text-ink-800">
            <Clock aria-hidden="true" className="h-4 w-4 shrink-0 text-coral-700" />
            <span className="min-w-0">{times}</span>
          </p>
        )}

        {(directions || telHref) && (
          <div className={`grid gap-2.5 ${directions && telHref ? "grid-cols-2" : "grid-cols-1"}`}>
            {directions && (
              <a
                href={directions}
                className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-white px-3 text-sm font-bold text-ink-900 shadow-card ring-1 ring-inset ring-sand-300 transition hover:bg-sand-50 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-800"
              >
                <Navigation aria-hidden="true" className="h-4 w-4 text-coral-700" strokeWidth={2.4} />
                Directions
                <span className="sr-only"> to {fullName ?? hotel.name}</span>
              </a>
            )}
            {telHref && (
              <a
                href={telHref}
                className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-coral-700 to-ember-700 px-3 text-sm font-bold text-white shadow-glow transition hover:from-ember-600 hover:to-ember-700 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral-700"
              >
                <Phone aria-hidden="true" className="h-4 w-4" strokeWidth={2.4} />
                Call hotel
                <span className="sr-only">
                  , {fullName ?? hotel.name}, {phoneDisplay}
                </span>
              </a>
            )}
          </div>
        )}

        <div className="border-t border-sand-200 pt-4">
          <StayRoommates
            roommates={stay.roommates}
            notInApp={stay.roommatesNotInApp}
            capacity={stay.capacity}
            headingId={`${headingId}-roommates`}
          />
        </div>

        {/* The hotel's point of contact, while the stay is on (a Wednesday-only room group that's
            over is for reference only). */}
        {!over && liaisons.length > 0 && (
          <div className="border-t border-sand-200 pt-4">
            <StayLiaisons liaisons={liaisons} hotelName={hotel.name} headingId={`${headingId}-liaison`} />
          </div>
        )}
      </div>
    </section>
  );
}

/** First night: a coral chip on the ink band; Done: jade (good) on sand. Nothing otherwise. */
function PhaseChip({ phase }: { phase: StayPhase }) {
  if (phase === "check-in") {
    return (
      <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full bg-coral-400 px-2.5 py-0.5 text-[11px] font-bold uppercase leading-4 tracking-caps text-ink-950">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current motion-safe:animate-pulse-soft" />
        Check-in today
      </span>
    );
  }
  if (phase === "over") {
    return (
      <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-white px-2.5 py-0.5 text-[11px] font-bold uppercase leading-4 tracking-caps text-jade-700 ring-1 ring-inset ring-jade-200">
        <Check aria-hidden="true" className="h-3 w-3" strokeWidth={2.8} />
        Done
      </span>
    );
  }
  return null;
}

function BandLine({ icon: Icon, over, children }: { icon: LucideIcon; over: boolean; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <Icon aria-hidden="true" className={`mt-0.5 h-4 w-4 shrink-0 ${over ? "text-ink-500" : "text-coral-300"}`} />
      <span className="min-w-0">{children}</span>
    </li>
  );
}
