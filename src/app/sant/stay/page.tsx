import type { Metadata } from "next";
import { BedDouble, House, NotebookText, Phone, PhoneCall, UserRound } from "lucide-react";
import { requireSant } from "@/lib/auth";
import { getAccommodation, getHotlines, santContactsFor, type HotlineView } from "@/lib/sant";
import { pageNow, type SearchParams } from "@/lib/pageNow";
import { EVENT_NAME } from "@/lib/branding";
import { TimeTravelBanner } from "@/components/TimeTravelBanner";
import { PhoneText } from "@/components/sant/pages/PhoneText";
import { SantContactRow } from "@/components/sant/pages/SantContactRow";
import { SantEmptyState } from "@/components/sant/pages/SantEmptyState";
import { SantPageHeader } from "@/components/sant/pages/SantPageHeader";
import { StayCompanions } from "@/components/sant/pages/StayCompanions";
import { TelegramButton } from "@/components/sant/pages/TelegramButton";

export const metadata: Metadata = { title: "Accommodation" };
export const dynamic = "force-dynamic";

/** The Santo contacts for utaro matters (utaro / laundry, then general), each with a Call button. */
function StayContacts({ lines }: { lines: HotlineView[] }) {
  if (lines.length === 0) return null;
  return (
    <section className="mt-6" aria-labelledby="stay-contacts-heading">
      <h2
        id="stay-contacts-heading"
        className="mb-3 flex items-center gap-2 px-1 text-[11px] font-bold uppercase tracking-[0.2em] text-ink-500"
      >
        <PhoneCall className="h-3.5 w-3.5 text-coral-700" />
        Contacts
      </h2>
      <ul className="space-y-3">
        {lines.map((l) => (
          <SantContactRow key={l.id} line={l} />
        ))}
      </ul>
    </section>
  );
}

/**
 * Pujya Santo accommodation: his utaro (by name), the santos staying there with
 * him (when there are any), his host (tap to call), notes (Wi-Fi, the organisers' introduction of
 * the host family) and the contacts for utaro matters (STAY lines, then GENERAL ones:
 * santContactsFor()), also when no utaro is set yet. No address or
 * directions: the Santo view doesn't show them (sant_accommodations.address is
 * not read). Santos are hosted for the whole stay, so there is no room or
 * check-in/out here.
 */
export default async function SantStayPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { traveling, label } = pageNow(sp);
  const guest = await requireSant();
  // dataUserId: a Santo mirror test account shows the mirrored sant's utaro.
  const [stay, lines] = await Promise.all([getAccommodation(guest.dataUserId), getHotlines("SANT")]);
  const contacts = santContactsFor(lines, "STAY");

  if (!stay) {
    return (
      <div className="stagger">
        {traveling && <TimeTravelBanner label={label} />}
        <SantPageHeader title="Accommodation" subtitle={`Your utaro during ${EVENT_NAME}`} />
        <SantEmptyState icon={BedDouble} title="Your accommodation details will appear here">
          Your utaro, your host and the santos staying with you will be shared here once they are confirmed.
        </SantEmptyState>
        <StayContacts lines={contacts} />
      </div>
    );
  }

  const hasHost = Boolean(stay.hostName || stay.hostTelHref || stay.hostTelegramHref);

  return (
    <div className="stagger">
      {traveling && <TimeTravelBanner label={label} />}
      <SantPageHeader title="Accommodation" subtitle={`Your utaro during ${EVENT_NAME}`} />

      {/* The utaro in the view's bhagwa: the brand's coral gradient taken deep into ember,
          so every line of white text on it stays AA. */}
      <section className="relative isolate overflow-hidden rounded-3xl bg-gradient-to-br from-coral-700 via-ember-600 to-ember-700 px-5 pb-5 pt-4 text-white shadow-[0_22px_44px_-22px_rgb(196_65_71/0.8)] ring-1 ring-inset ring-white/10">
        <div
          className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_1px_1px,rgb(255_255_255/0.1)_1px,transparent_0)] bg-[length:16px_16px]"
          aria-hidden="true"
        />
        <div className="absolute -right-12 -top-14 -z-10 h-40 w-40 rounded-full bg-coral-400/40 blur-3xl" aria-hidden="true" />
        <House
          className="absolute -bottom-6 -right-6 -z-10 h-32 w-32 text-white/[0.08]"
          strokeWidth={1.25}
          aria-hidden="true"
        />
        <div>
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.22em] text-white">
            <House className="h-3.5 w-3.5" />
            Utaro
          </p>
          <h2 className="mt-1.5 font-display text-[1.85rem] leading-tight">{stay.placeName}</h2>
        </div>
      </section>

      {/* Placements are final, so a sant alone in his room gets no "Staying with you" card
          (its empty state would suggest companions are still to come). */}
      {stay.companions.length > 0 && <StayCompanions companions={stay.companions} />}

      {hasHost && (
        <section className="card mt-4 p-4">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-ink-800 text-coral-300">
              <UserRound className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-[11px] font-bold uppercase tracking-[0.18em] text-ink-500">Your host</h2>
              <p className="font-semibold leading-snug text-ink-900">{stay.hostName ?? "Host"}</p>
              {stay.hostPhoneDisplay && <p className="text-sm tabular-nums text-ink-600">{stay.hostPhoneDisplay}</p>}
            </div>
          </div>
          {(stay.hostTelHref || stay.hostTelegramHref) && (
            // Call and, with a Telegram username on file, Telegram side by side.
            <div className={`mt-4 grid gap-2 ${stay.hostTelHref && stay.hostTelegramHref ? "grid-cols-2" : "grid-cols-1"}`}>
              {stay.hostTelHref && (
                <a
                  href={stay.hostTelHref}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-coral-700 to-ember-700 text-base font-bold text-white shadow-glow transition hover:from-ember-600 hover:to-ember-700 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral-700"
                >
                  <Phone className="h-[18px] w-[18px]" strokeWidth={2.4} />
                  Call host
                  <span className="sr-only">
                    {stay.hostName ? `, ${stay.hostName}` : ""}, {stay.hostPhoneDisplay}
                  </span>
                </a>
              )}
              {stay.hostTelegramHref && (
                <TelegramButton
                  href={stay.hostTelegramHref}
                  who={stay.hostName ? `your host ${stay.hostName}` : "your host"}
                  size="base"
                  label={stay.hostTelHref ? "Telegram" : "Message on Telegram"}
                  className="h-12 w-full"
                />
              )}
            </div>
          )}
        </section>
      )}

      {stay.notes && (
        <section className="card mt-4 p-4">
          <h2 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-ink-500">
            <NotebookText className="h-3.5 w-3.5 text-coral-700" />
            Notes
          </h2>
          <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-ink-800">
            <PhoneText text={stay.notes} />
          </p>
        </section>
      )}

      <StayContacts lines={contacts} />
    </div>
  );
}
