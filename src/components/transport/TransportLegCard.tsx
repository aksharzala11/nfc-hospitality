import type { ReactNode } from "react";
import { CarFront, Check, Clock, Info, MapPin, PlaneLanding, PlaneTakeoff, UserRound, Users, type LucideIcon } from "lucide-react";
import type { TransportDirection, TransportLegView } from "@/lib/transport";
import { formatPhone } from "@/lib/sant";
import { CallButton } from "@/components/help/HelpContacts";
import {
  flightLabel,
  isDriving,
  legDateTimeAttr,
  legPhase,
  legWhenLabel,
  modeLabel,
  serviceNoun,
  type LegPhase,
} from "./transportView";

const TITLE: Record<TransportDirection, string> = { ARRIVAL: "Your arrival", DEPARTURE: "Your departure" };

/**
 * One of the delegate's two legs ("Your arrival" / "Your departure") as a
 * boarding-pass card: a teal band with the date and time as the sheet gives
 * them at that airport ("Thu, Oct 8 · 5:26 AM at PHL") and the airport's name,
 * then the flight, how they travel, and their pickup / drop-off: the group and
 * its size (never who else is in it) and the driver with tap-to-call once
 * assigned. A leg that is over (legPhase(), which honours ?now=) steps back
 * onto sand with a Done chip and drops the driver line. `leg` null is the
 * compact "No pickup / drop-off on file" card. `hasContact`: the page lists a
 * transport contact to call below the cards; without one, no row asks the
 * guest to get in touch (there would be nobody to point to).
 */
export function TransportLegCard({
  direction,
  leg,
  now,
  hasContact,
}: {
  direction: TransportDirection;
  leg: TransportLegView | null;
  now: Date;
  hasContact: boolean;
}) {
  const headingId = `transport-${direction.toLowerCase()}`;
  if (!leg) return <MissingLegCard direction={direction} headingId={headingId} hasContact={hasContact} />;

  const phase = legPhase(leg, now);
  const done = phase === "done";
  const driving = isDriving(leg);
  const when = legWhenLabel(leg);
  const where = !driving ? leg.airportCode : null;
  const Icon = driving ? CarFront : direction === "ARRIVAL" ? PlaneLanding : PlaneTakeoff;
  const flight = flightLabel(leg);
  const mode = modeLabel(leg.mode);

  return (
    <section
      aria-labelledby={headingId}
      className={`overflow-hidden rounded-3xl ring-1 ring-inset ${
        done ? "bg-sand-50 ring-sand-200" : "bg-white shadow-card-lg ring-sand-200/60"
      }`}
    >
      {/* The pass's band: the brand teal, started at jade-600 so the small white text keeps AA
          throughout; flat sand once the leg is over. */}
      <div
        className={`relative isolate overflow-hidden px-5 pb-5 pt-4 ${
          done ? "bg-sand-200 text-ink-900" : "bg-gradient-to-br from-jade-600 to-ink-800 text-white"
        }`}
      >
        {!done && (
          <>
            <span aria-hidden="true" className="absolute -bottom-16 -right-10 -z-10 h-40 w-40 rounded-full bg-coral-400/20 blur-3xl" />
            <Icon aria-hidden="true" className="absolute -bottom-6 -right-4 -z-10 h-28 w-28 -rotate-6 text-white/[0.08]" strokeWidth={1.25} />
          </>
        )}

        <div className="flex items-center gap-2.5">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ${
              done ? "bg-white text-ink-600 ring-sand-300" : "bg-white/15 text-white ring-white/25"
            }`}
          >
            <Icon aria-hidden="true" className="h-[18px] w-[18px]" />
          </span>
          <h2 id={headingId} className={`text-[11px] font-bold uppercase tracking-[0.22em] ${done ? "text-ink-700" : "text-white"}`}>
            {TITLE[direction]}
          </h2>
          <PhaseChip phase={phase} />
        </div>

        {/* "Thu, Oct 8 · 5:26 AM at PHL": the time and place stay on one line when it wraps. */}
        <p className="font-display mt-3 text-balance text-[1.5rem] leading-tight">
          {when ? (
            <>
              <time dateTime={legDateTimeAttr(leg)}>
                {leg.dateLabel}
                {leg.dateLabel && leg.timeLabel && " · "}
                {leg.timeLabel && <span className="whitespace-nowrap">{leg.timeLabel}</span>}
              </time>
              {where && <span className="whitespace-nowrap"> at {where}</span>}
            </>
          ) : where ? (
            <>At {where} · date to be confirmed</>
          ) : (
            "Date to be confirmed"
          )}
        </p>
        {!driving && leg.airportName && (
          <p className={`mt-1.5 flex items-start gap-1.5 text-sm leading-snug ${done ? "text-ink-700" : "text-white"}`}>
            <MapPin aria-hidden="true" className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${done ? "text-ink-500" : "text-coral-200"}`} />
            <span className="min-w-0 break-words">{leg.airportName}</span>
          </p>
        )}
      </div>

      <div className="space-y-4 px-5 pb-5 pt-4">
        {/* Driving legs say so in the service row below, so the flight line is for flyers only. */}
        {!driving && (
          <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-5">
            <div className="min-w-0">
              <dt className="text-[10px] font-bold uppercase tracking-caps text-ink-500">Flight</dt>
              <dd className={`mt-0.5 break-words text-sm font-semibold ${flight ? "text-ink-900" : "text-ink-600"}`}>
                {flight ?? "To be confirmed"}
              </dd>
            </div>
            {mode && (
              <div className="text-right">
                <dt className="text-[10px] font-bold uppercase tracking-caps text-ink-500">Travelling</dt>
                <dd className="mt-0.5 text-sm font-semibold text-ink-900">{mode}</dd>
              </div>
            )}
          </dl>
        )}

        <div className={`space-y-3 ${driving ? "" : "border-t border-sand-200 pt-4"}`}>
          <Service leg={leg} done={done} driving={driving} hasContact={hasContact} />
        </div>
      </div>
    </section>
  );
}

/** Today: a coral chip on the teal band; Done: jade (good) on sand. Nothing while it's further ahead. */
function PhaseChip({ phase }: { phase: LegPhase }) {
  if (phase === "today") {
    return (
      <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full bg-coral-400 px-2.5 py-0.5 text-[11px] font-bold uppercase leading-4 tracking-caps text-ink-950">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current motion-safe:animate-pulse-soft" />
        Today
      </span>
    );
  }
  if (phase === "done") {
    return (
      <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-white px-2.5 py-0.5 text-[11px] font-bold uppercase leading-4 tracking-caps text-jade-700 ring-1 ring-inset ring-jade-200">
        <Check aria-hidden="true" className="h-3 w-3" strokeWidth={2.8} />
        Done
      </span>
    );
  }
  return null;
}

/** How to reach someone: the transport contact(s) the page lists below the cards. */
const CONTACT_LINE = "get in touch using the contact details below";

/**
 * The pickup / drop-off itself. The transport team's airport tabs (their
 * working lists, `onTeamList`) are the source of truth: a group there wins
 * over the registration's "need a pickup" answer, and being listed there
 * without a group yet reads as booked unless the answer was No. A Yes in the
 * registration alone is only "requested": the team hasn't listed them yet, so
 * nothing is promised (no driver line) and the contact is pointed out when the
 * page has one.
 */
function Service({
  leg,
  done,
  driving,
  hasContact,
}: {
  leg: TransportLegView;
  done: boolean;
  driving: boolean;
  hasContact: boolean;
}) {
  const noun = serviceNoun(leg);
  const lower = noun.toLowerCase();
  const arrival = leg.direction === "ARRIVAL";

  if (driving) {
    return (
      <Row icon={CarFront} tone="ink">
        <span className="font-semibold text-ink-900">Driving</span>
        <span className="block text-ink-600">
          You&rsquo;re making your own way {arrival ? "in" : "home"}, so there&rsquo;s no airport {lower}.
        </span>
      </Row>
    );
  }

  const grouped = leg.groupNumber !== null && leg.groupKey !== null;
  if (grouped) {
    const size = leg.groupSize ?? 1;
    return (
      <>
        <Row icon={Users} tone={done ? "quiet" : "coral"}>
          <span className="font-bold text-ink-900">
            {noun} group {leg.groupNumber}
          </span>
          <span className="text-ink-600">
            {" "}
            · {size} {size === 1 ? "person" : "people"}
          </span>
        </Row>
        {!done && <Driver leg={leg} />}
      </>
    );
  }

  if (leg.needsService === false) {
    return (
      <Row icon={Info} tone="ink">
        <span className="text-ink-700">
          No {lower} booked &mdash; you said you don&rsquo;t need one
        </span>
      </Row>
    );
  }

  // On the transport team's list (and neither they nor the registration said No).
  if (leg.onTeamList) {
    return (
      <>
        <Row icon={Users} tone={done ? "quiet" : "coral"}>
          <span className="font-bold text-ink-900">{noun} booked</span>
          <span className="text-ink-600"> · group to be assigned</span>
        </Row>
        {!done && <Driver leg={leg} />}
      </>
    );
  }

  // The registration asked for one, but the transport team hasn't listed them yet.
  if (leg.needsService === true) {
    return (
      <Row icon={Info} tone={done ? "quiet" : "ink"}>
        <span className="font-semibold text-ink-900">{noun} requested</span>
        {!done && (
          <>
            <span className="text-ink-600"> · the transport team will confirm</span>
            {hasContact && <span className="block text-ink-600">Questions? Please {CONTACT_LINE}.</span>}
          </>
        )}
      </Row>
    );
  }

  // The registration left "need a pickup / drop-off" blank.
  return (
    <Row icon={Info} tone="ink">
      <span className="font-semibold text-ink-900">{noun} not confirmed</span>
      {hasContact && <span className="block text-ink-600">If you need one, please {CONTACT_LINE}.</span>}
    </Row>
  );
}

function Driver({ leg }: { leg: TransportLegView }) {
  if (!leg.driverName && !leg.driverPhone) {
    return (
      <Row icon={Clock} tone="quiet">
        <span className="text-ink-600">Driver details will be shared closer to the day</span>
      </Row>
    );
  }
  const name = leg.driverName?.trim() || "Your driver";
  const phone = leg.driverPhone?.trim() || null;
  const phoneDisplay = phone ? formatPhone(phone) : null;
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-sand-50 p-3 ring-1 ring-inset ring-sand-200">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ink-800 text-coral-300">
        <UserRound aria-hidden="true" className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-caps text-ink-500">Your driver</p>
        <p className="break-words font-semibold leading-snug text-ink-900">{name}</p>
        {phoneDisplay && <p className="text-sm tabular-nums text-ink-600">{phoneDisplay}</p>}
      </div>
      {phone && <CallButton href={`tel:${phone.replace(/[^\d+]/g, "")}`} srLabel={`driver ${name}, ${phoneDisplay}`} />}
    </div>
  );
}

const ROW_TONE = {
  coral: "bg-gradient-to-br from-coral-400 to-coral-700 text-white",
  ink: "bg-ink-50 text-ink-700 ring-1 ring-inset ring-ink-100",
  quiet: "bg-sand-100 text-ink-500 ring-1 ring-inset ring-sand-200",
} as const;

function Row({ icon: Icon, tone, children }: { icon: LucideIcon; tone: keyof typeof ROW_TONE; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${ROW_TONE[tone]}`}>
        <Icon aria-hidden="true" className="h-[18px] w-[18px]" />
      </span>
      <p className="min-w-0 flex-1 text-sm leading-snug">{children}</p>
    </div>
  );
}

function MissingLegCard({
  direction,
  headingId,
  hasContact,
}: {
  direction: TransportDirection;
  headingId: string;
  hasContact: boolean;
}) {
  const Icon = direction === "ARRIVAL" ? PlaneLanding : PlaneTakeoff;
  const noun = direction === "ARRIVAL" ? "pickup" : "drop-off";
  return (
    <section aria-labelledby={headingId} className="card flex items-start gap-3 p-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sand-200 text-ink-600">
        <Icon aria-hidden="true" className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0">
        <h2 id={headingId} className="text-[11px] font-bold uppercase tracking-[0.22em] text-ink-500">
          {TITLE[direction]}
        </h2>
        <p className="mt-0.5 font-semibold text-ink-900">No {noun} on file</p>
        {hasContact && (
          <p className="mt-0.5 text-sm leading-snug text-ink-600">If you need one, please {CONTACT_LINE}.</p>
        )}
      </div>
    </section>
  );
}
