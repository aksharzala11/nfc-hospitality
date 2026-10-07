import type { Metadata } from "next";
import { BedDouble, Clock } from "lucide-react";
import { requireGuest } from "@/lib/auth";
import { trackGender } from "@/lib/admin/announcements";
import { getDelegateLines, pickHelpContacts } from "@/lib/helpContacts";
import { getHotelLiaisons, pickLiaisons } from "@/lib/hotelLiaisons";
import { getStayFor, isRoomingTableMissing } from "@/lib/rooming";
import { pageNow, type SearchParams } from "@/lib/pageNow";
import { EVENT_NAME } from "@/lib/branding";
import { HubPageHeader } from "@/components/HubPageHeader";
import { TimeTravelBanner } from "@/components/TimeTravelBanner";
import { HelpContacts } from "@/components/help/HelpContacts";
import { StayCard } from "@/components/stay/StayCard";
import { StayEmptyCard } from "@/components/stay/StayEmptyCard";
import { stayPhase } from "@/components/stay/stayView";

export const metadata: Metadata = { title: "Your stay" };
export const dynamic = "force-dynamic";

/**
 * The delegate's own hotel stay, from the organisers' rooming workbook (npm run
 * rooming:import, matched by users.registration_id): the hotel, "Room group N"
 * (an assignment; the real room number comes at check-in), from which night,
 * and the roommates' names only. Normally one card; two when the Wednesday
 * night is in a different room group from the Thursday one. Then who to
 * contact: the delegates' help contacts about a stay for the guest's track
 * (hotlines with role DELEGATE, topic STAY or GENERAL, set with npm run
 * hotlines; src/lib/helpContacts.ts); when there are none the help block is
 * left out and nothing asks the guest to get in touch. ?now= moves the
 * "Check-in today" chip. Until the rooming list is imported (the
 * room_assignments table missing or still empty) the page says the details
 * aren't available yet, rather than failing or telling everyone they have no
 * room. Each card shows its own hotel's "Hotel Liaison(s)" for the guest's
 * track (hotel_liaisons, set with npm run hotel:liaisons; every liaison the
 * hotel has for that track), so a Wednesday room at one hotel and a Thursday
 * room at another each show their own; a hotel's liaisons show once, on its
 * first card still on; nothing when a hotel has none. Santos never reach it: the hub layout sends them to /sant (their utaro
 * is /sant/stay).
 */
export default async function StayPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { today, traveling, label } = pageNow(sp);
  const guest = await requireGuest();
  const [stay, lines, liaisons] = await Promise.all([
    getStayFor(guest.registrationId).catch((err: unknown) => {
      if (isRoomingTableMissing(err)) return null;
      throw err;
    }),
    getDelegateLines(),
    getHotelLiaisons(),
  ]);
  const stays = stay?.stays ?? [];
  // Their track from the requireGuest() object, so a mirror tester sees the mirrored delegate's
  // liaisons and contacts.
  const track = trackGender(guest);
  // Who to call about a stay: their track's accommodation contacts, then any general ones.
  const contacts = pickHelpContacts(lines, "STAY", track);
  const canAsk = contacts.length > 0;
  // Each hotel's liaison once: on its first card still on (a Wednesday room group and a
  // different Thursday one at the same hotel would otherwise repeat it until Wednesday is over).
  const withLiaison = new Set<string>();
  const cards = stays.map((s) => {
    const phase = stayPhase(s, today);
    const own = phase !== "over" && !withLiaison.has(s.hotel.key) ? pickLiaisons(liaisons, s.hotel.key, track) : [];
    if (own.length > 0) withLiaison.add(s.hotel.key);
    return { stay: s, phase, liaisons: own };
  });

  return (
    <div>
      {traveling && <TimeTravelBanner label={label} />}
      <HubPageHeader
        eyebrow={`${EVENT_NAME} · Accommodation`}
        title="Your stay"
        subtitle="Your hotel, room group and roommates"
      />

      {stays.length > 0 ? (
        <div className="stagger space-y-4">
          {cards.map((c) => (
            <StayCard key={c.stay.roomKey} stay={c.stay} phase={c.phase} liaisons={c.liaisons} />
          ))}

          {canAsk && (
            <section aria-labelledby="stay-help" className="pt-3">
              <h2 id="stay-help" className="mb-2.5 px-1 text-[11px] font-bold uppercase tracking-[0.22em] text-ink-500">
                Questions about your room?
              </h2>
              <HelpContacts contacts={contacts} />
            </section>
          )}
        </div>
      ) : stay === null ? (
        <StayEmptyCard icon={Clock} title="Hotel details aren’t available yet" contacts={contacts}>
          Your hotel and roommates will show here once the rooming list is loaded.
          {canAsk && " If you need a room, please get in touch."}
        </StayEmptyCard>
      ) : (
        <StayEmptyCard icon={BedDouble} title="No hotel room on file" contacts={contacts}>
          We don&rsquo;t have a hotel room for you.{canAsk && " If you need one, please get in touch."}
        </StayEmptyCard>
      )}
    </div>
  );
}
