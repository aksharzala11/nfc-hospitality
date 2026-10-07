import type { Metadata } from "next";
import { CarFront, ChevronDown, Clock, History, MapPin, Phone, PhoneCall, Plane } from "lucide-react";
import { requireSant } from "@/lib/auth";
import { annotatePersonalSchedule, getHotlines, getPersonalSchedule, santContactsFor, type HotlineView } from "@/lib/sant";
import type { ScheduleItemView } from "@/lib/schedule";
import { formatDayShort, formatRelative, formatTimeRange } from "@/lib/time";
import { pageNow, type SearchParams } from "@/lib/pageNow";
import { EVENT_NAME } from "@/lib/branding";
import { StatusBadge } from "@/components/StatusBadge";
import { TimeTravelBanner } from "@/components/TimeTravelBanner";
import { PhoneText } from "@/components/sant/pages/PhoneText";
import { SantContactRow } from "@/components/sant/pages/SantContactRow";
import { SantEmptyState } from "@/components/sant/pages/SantEmptyState";
import { SantPageHeader } from "@/components/sant/pages/SantPageHeader";
import { TelegramButton } from "@/components/sant/pages/TelegramButton";

export const metadata: Metadata = { title: "Transport" };
export const dynamic = "force-dynamic";

/** Airport runs get a plane; every other ride gets a car. */
const AIRPORT = /airport|flight|terminal|\b(?:EWR|JFK|LGA|PHL)\b/i;

/**
 * The first (lowest sortOrder) hotline: an ink panel (like the Transport tile on
 * the home) with the number big in white and an unmistakable coral Call button.
 */
function HotlineHero({ hotline }: { hotline: HotlineView }) {
  return (
    <div className="relative isolate overflow-hidden rounded-3xl bg-ink-900 p-5 text-white shadow-card-lg ring-1 ring-inset ring-white/10">
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-ink-700 via-ink-900 to-ink-950" aria-hidden="true" />
      <div
        className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_1px_1px,rgb(255_255_255/0.07)_1px,transparent_0)] bg-[length:16px_16px]"
        aria-hidden="true"
      />
      <div className="absolute -right-12 -top-16 -z-10 h-44 w-44 rounded-full bg-coral-400/25 blur-3xl" aria-hidden="true" />
      <div>
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-inset ring-white/15">
            <PhoneCall className="h-6 w-6 text-coral-300" />
          </span>
          <div className="min-w-0">
            <h3 className="text-[11px] font-bold uppercase tracking-[0.22em] text-coral-300">{hotline.label}</h3>
            {hotline.contactName && <p className="mt-0.5 text-sm leading-snug text-white/80">{hotline.contactName}</p>}
          </div>
        </div>

        <p className="mt-4 text-[1.9rem] font-extrabold leading-none tracking-tight tabular-nums">{hotline.phoneDisplay}</p>
        {hotline.availability && (
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-white/90 ring-1 ring-inset ring-white/10">
            <Clock className="h-3.5 w-3.5 text-coral-300" />
            {hotline.availability}
          </p>
        )}

        <a
          href={hotline.telHref}
          className="mt-5 flex h-14 w-full items-center justify-center gap-3 rounded-2xl bg-coral-400 text-base font-bold text-ink-950 shadow-[0_14px_30px_-12px_rgb(246_143_119/0.65)] transition hover:bg-coral-300 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral-300"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-950 text-coral-300">
            <Phone className="h-[18px] w-[18px]" strokeWidth={2.4} />
          </span>
          Call now
          <span className="sr-only">
            , {hotline.label}, {hotline.phoneDisplay}
          </span>
        </a>
        {hotline.telegramHref && (
          <TelegramButton
            href={hotline.telegramHref}
            who={hotline.contactName ?? hotline.label}
            tone="dark"
            size="base"
            label="Message on Telegram"
            className="mt-2.5 h-12 w-full"
          />
        )}
      </div>
    </div>
  );
}

function RideCard({ ride, now }: { ride: ScheduleItemView; now: Date }) {
  const start = new Date(ride.startsAt);
  const isNow = ride.status === "now";
  const isPast = ride.status === "past";
  const Icon = AIRPORT.test(`${ride.title} ${ride.location ?? ""}`) ? Plane : CarFront;
  // A past ride recedes through its surface (flat sand, no shadow) and its sand icon chip, never
  // opacity, so its text stays solid and AA. Not .card: that class is unlayered, so utilities
  // could not quiet its surface.
  const surface = isPast
    ? "rounded-3xl border border-sand-300/70 bg-sand-50"
    : `card ${isNow ? "border-coral-400/60 shadow-glow ring-1 ring-coral-400/40" : ""}`;
  return (
    <li className={`p-4 ${surface}`}>
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
            isNow
              ? "bg-gradient-to-br from-coral-600 to-ember-600 text-white shadow-glow"
              : isPast
                ? "bg-sand-200 text-ink-500"
                : "bg-ink-800 text-coral-300"
          }`}
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <time
              dateTime={ride.startsAt}
              className={`text-xs font-semibold tabular-nums ${isNow ? "text-coral-800" : "text-ink-500"}`}
            >
              {formatDayShort(ride.day)} · {formatTimeRange(start, new Date(ride.endsAt))}
            </time>
            <StatusBadge status={ride.status} />
          </div>
          <h3 className="mt-1 font-semibold leading-snug text-ink-900">{ride.title}</h3>
          {ride.location && (
            <p className="mt-1 flex items-start gap-1 text-xs text-ink-600">
              <MapPin className="mt-px h-3.5 w-3.5 shrink-0 text-coral-700" />
              <span className="min-w-0">{ride.location}</span>
            </p>
          )}
          {ride.description && (
            <p className="mt-1.5 text-sm text-ink-700">
              <PhoneText text={ride.description} />
            </p>
          )}
          {!isNow && !isPast && (
            <p className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-coral-800">
              <Clock className="h-3 w-3" />
              Starts {formatRelative(now, start)}
            </p>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * Pujya Santo transport: the transport contact(s) up top with tap-to-call (the TRANSPORT
 * lines, then the GENERAL ones: santContactsFor()), then his rides
 * (personal schedule items of kind TRAVEL), upcoming first and earlier ones
 * folded away.
 */
export default async function SantTransportPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { now, traveling, label } = pageNow(sp);
  const [guest, hotlines] = await Promise.all([requireSant(), getHotlines("SANT")]);
  // dataUserId: a Santo mirror test account shows the mirrored sant's rides.
  const personal = await getPersonalSchedule(guest.dataUserId);
  const rides = annotatePersonalSchedule(
    personal.filter((i) => i.kind === "TRAVEL"),
    now,
  );
  const upcoming = rides.filter((r) => r.status !== "past");
  const past = rides.filter((r) => r.status === "past");
  // The Transport line(s) first, then the general contact(s).
  const [primary, ...others] = santContactsFor(hotlines, "TRANSPORT");

  return (
    <div className="stagger">
      {traveling && <TimeTravelBanner label={label} />}
      <SantPageHeader title="Transport" subtitle="Transport hotline and your rides" />

      {primary ? (
        <section aria-labelledby="hotline-heading">
          <h2 id="hotline-heading" className="sr-only">
            Hotline
          </h2>
          <HotlineHero hotline={primary} />
          {others.length > 0 && (
            <ul className="mt-3 space-y-3">
              {others.map((h) => (
                <SantContactRow key={h.id} line={h} />
              ))}
            </ul>
          )}
        </section>
      ) : (
        <SantEmptyState size="sm" icon={PhoneCall} title="The transport hotline will appear here">
          The number to call about pickups and rides will be shared here before {EVENT_NAME} begins.
        </SantEmptyState>
      )}

      <section className="mt-7" aria-labelledby="rides-heading">
        <h2
          id="rides-heading"
          className="mb-3 flex items-center gap-2 px-1 text-[11px] font-bold uppercase tracking-[0.2em] text-ink-500"
        >
          <CarFront className="h-3.5 w-3.5 text-coral-700" />
          Your rides
        </h2>

        {rides.length === 0 ? (
          <SantEmptyState size="sm" headingLevel={3} icon={CarFront} title="Your rides will appear here">
            Airport pickups and drives arranged for you will be listed here with their times.
          </SantEmptyState>
        ) : (
          <>
            {upcoming.length > 0 ? (
              <ul className="space-y-3">
                {upcoming.map((r) => (
                  <RideCard key={r.id} ride={r} now={now} />
                ))}
              </ul>
            ) : (
              <p className="card px-4 py-3.5 text-sm text-ink-600">
                No more rides are scheduled.
                {primary ? " If you need a ride, please call the hotline above." : ""}
              </p>
            )}

            {past.length > 0 && (
              <details className="group mt-3" open={upcoming.length === 0}>
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-2xl px-1 py-2 text-sm font-semibold text-ink-600 transition hover:text-ink-900 [&::-webkit-details-marker]:hidden">
                  <History className="h-4 w-4" />
                  Earlier rides
                  <span className="rounded-full bg-sand-200 px-2 py-0.5 text-[11px] tabular-nums text-ink-700">{past.length}</span>
                  <ChevronDown className="ml-auto h-4 w-4 transition-transform group-open:rotate-180" />
                </summary>
                <ul className="mt-2 space-y-3">
                  {past.map((r) => (
                    <RideCard key={r.id} ride={r} now={now} />
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </section>
    </div>
  );
}
