import type { ReactNode } from "react";
import type { Metadata } from "next";
import { Clock, Plane, type LucideIcon } from "lucide-react";
import { requireGuest } from "@/lib/auth";
import { trackGender } from "@/lib/admin/announcements";
import { getDelegateLines, pickHelpContacts, type HelpContactView } from "@/lib/helpContacts";
import { getTransportFor, isTransportTableMissing } from "@/lib/transport";
import { pageNow, type SearchParams } from "@/lib/pageNow";
import { EVENT_NAME } from "@/lib/branding";
import { HubPageHeader } from "@/components/HubPageHeader";
import { TimeTravelBanner } from "@/components/TimeTravelBanner";
import { HelpContacts } from "@/components/help/HelpContacts";
import { TransportLegCard } from "@/components/transport/TransportLegCard";

export const metadata: Metadata = { title: "Transportation" };
export const dynamic = "force-dynamic";

/**
 * The delegate's own airport transport, from the organisers' transport
 * workbook (npm run transport:import): "Your arrival" and "Your departure"
 * cards, then who to contact: the delegates' help contacts about transport
 * for the guest's track (hotlines with role DELEGATE, topic TRANSPORT or
 * GENERAL, set with npm run hotlines; src/lib/helpContacts.ts). When there are
 * none the help block is left out and nothing asks the guest to get in touch.
 * Legs are matched by users.registration_id; ?now= decides which legs read as
 * done. Only this person's legs and their group's size are shown,
 * never who else is in the group. Before the transport_legs table exists
 * (schema not pushed yet) the page says the details aren't available yet
 * instead of failing.
 */
export default async function TransportationPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { now, traveling, label } = pageNow(sp);
  const guest = await requireGuest();
  const [transport, lines] = await Promise.all([
    getTransportFor(guest.registrationId).catch((err: unknown) => {
      if (isTransportTableMissing(err)) return null;
      throw err;
    }),
    getDelegateLines(),
  ]);
  const arrival = transport?.arrival ?? null;
  const departure = transport?.departure ?? null;
  // Their track from the requireGuest() object, so a mirror tester sees the mirrored delegate's contacts.
  const contacts = pickHelpContacts(lines, "TRANSPORT", trackGender(guest));
  const hasContact = contacts.length > 0;

  return (
    <div>
      {traveling && <TimeTravelBanner label={label} />}
      <HubPageHeader
        eyebrow={`${EVENT_NAME} · Getting around`}
        title="Transportation"
        subtitle="Your airport pickup and drop-off"
      />

      {arrival || departure ? (
        <div className="stagger space-y-4">
          <TransportLegCard direction="ARRIVAL" leg={arrival} now={now} hasContact={hasContact} />
          <TransportLegCard direction="DEPARTURE" leg={departure} now={now} hasContact={hasContact} />

          {hasContact && (
            <section aria-labelledby="transport-help" className="pt-3">
              <h2
                id="transport-help"
                className="mb-2.5 px-1 text-[11px] font-bold uppercase tracking-[0.22em] text-ink-500"
              >
                Need a change?
              </h2>
              <HelpContacts contacts={contacts} />
            </section>
          )}
        </div>
      ) : transport === null ? (
        <EmptyCard icon={Clock} title="Transport details aren’t available yet" contacts={contacts}>
          Your airport pickup and drop-off will show here once the transport team&rsquo;s list is loaded.
          {hasContact && " If you need one, please get in touch."}
        </EmptyCard>
      ) : (
        <EmptyCard icon={Plane} title="No airport pickup on file" contacts={contacts}>
          We don&rsquo;t have an arrival or departure for you.
          {hasContact && " If you need a pickup or drop-off, please get in touch."}
        </EmptyCard>
      )}
    </div>
  );
}

/**
 * The page's single card when there are no legs to show: a message, then who to contact
 * (just the message when the guest has no transport contact).
 */
function EmptyCard({
  icon: Icon,
  title,
  contacts,
  children,
}: {
  icon: LucideIcon;
  title: string;
  contacts: HelpContactView[];
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby="transport-none"
      className={`card stagger px-5 pt-8 ${contacts.length > 0 ? "pb-5" : "pb-8"}`}
    >
      <div className="flex flex-col items-center text-center">
        <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100 text-ink-700">
          <Icon aria-hidden="true" className="h-5 w-5" />
        </span>
        <h2 id="transport-none" className="font-display text-[1.375rem] leading-tight text-ink-900">
          {title}
        </h2>
        <p className="mt-1.5 max-w-xs text-sm leading-relaxed text-ink-500">{children}</p>
      </div>
      {contacts.length > 0 && (
        <div className="mt-5">
          <HelpContacts contacts={contacts} />
        </div>
      )}
    </section>
  );
}
