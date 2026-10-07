import type { Metadata } from "next";
import Link from "next/link";
import { Armchair, CalendarClock, Users } from "lucide-react";
import { requireGuest } from "@/lib/auth";
import { trackGender, tracksFor } from "@/lib/admin/announcements";
import {
  GOSHTHI_ROOM_TBC,
  annotateBreakouts,
  forAudience,
  getBreakoutsForUser,
  getScheduleItems,
  goshthiFor,
  labelSaysGoshthi,
  personalizeGoshthi,
  sevaHasTeam,
} from "@/lib/schedule";
import { sevaLabel } from "@/lib/teams";
import { pageNow, type SearchParams } from "@/lib/pageNow";
import { formatDayShort, formatTime } from "@/lib/time";
import { EVENT_NAME } from "@/lib/branding";
import { BreakoutList } from "@/components/BreakoutList";
import { BreakoutHowTo } from "@/components/BreakoutHowTo";
import { TimeTravelBanner } from "@/components/TimeTravelBanner";
import { HubPageHeader } from "@/components/HubPageHeader";
import { getVenueForPages, venueHref } from "@/lib/venue/data";
import { venueTrackOf } from "@/lib/venue/route";
import { breakoutWays, type BreakoutWay } from "@/lib/venue/breakoutDirections";

export const metadata: Metadata = { title: "Breakout Sessions" };
export const dynamic = "force-dynamic";

export default async function BreakoutsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { now, traveling, label } = pageNow(sp);
  const guest = await requireGuest();
  const rows = await getBreakoutsForUser(guest);
  const sessions = annotateBreakouts(rows, now);
  const seva = sevaLabel(guest.seva);
  // Their goshthi group ("Kishore Group 4" for Bhaio, "Goshthi Group 12" for Behno), the
  // room it meets in during the Goshthi sessions; null without a group (moderators
  // aren't shown in the hub). Each group has its own room, so it shows in the header only, not
  // on the team session cards (the Goshthi sessions on /schedule carry the room too).
  const goshthi = goshthiFor(guest);
  // "Kishore Group 4" alone, over the team session cards, reads like their breakout room.
  const groupLead = goshthi && labelSaysGoshthi(goshthi.label) ? "Your group: " : "Your goshthi group: ";

  // Rooms on the venue map link to their directions (/map?to=...); the rest stay plain text. A
  // venue map problem never stops this page.
  const [venue, schedule] = await Promise.all([
    getVenueForPages().catch((err: unknown) => {
      console.error("[venue] /breakouts couldn't read the venue map:", err instanceof Error ? err.message : err);
      return null;
    }),
    // Their day, for where each session's directions start (only with sessions to direct them to).
    rows.length > 0
      ? getScheduleItems().catch((err: unknown) => {
          console.error("[venue] /breakouts couldn't read the schedule:", err instanceof Error ? err.message : err);
          return null;
        })
      : null,
  ]);
  const nowParam = traveling && typeof sp.now === "string" ? sp.now : undefined;
  // "How to get there" on each card: from the place before the session (their other sessions and
  // their own schedule: their track, their goshthi room) to its room(s), with their side's stairs
  // (venueTrackOf(): by gender, so mirror testers get the mirrored delegate's; no gender = any),
  // worked out here so the browser gets text only. Without a map (or on any failure) the cards
  // stay as they are.
  // Their track also decides which room a place with one per track means ("Samp Square").
  const track = venueTrackOf(tracksFor(trackGender(guest)));
  let ways: Record<string, BreakoutWay> | undefined;
  if (venue && schedule) {
    try {
      ways = breakoutWays({
        venue: venue.venue,
        index: venue.index,
        sessions: rows,
        items: personalizeGoshthi(forAudience(schedule, guest.gender), guest),
        track,
        now: nowParam,
        // The organisers' flow rules in force at each session's printed start, for their track.
        rulesAt: (at) => venue.rulesAt(at, track),
      });
    } catch (err) {
      console.error("[venue] /breakouts couldn't work out directions:", err instanceof Error ? err.message : err);
    }
  }
  // A room on a card links to the route its "How to get there" shows (from the place before), else
  // to the room alone (/map?to=); a room not on the map (or a staff-only one) stays plain text.
  const roomHref = venue
    ? (s: { id: string }, name: string) =>
        ways?.[s.id]?.rooms.find((r) => r.room === name)?.mapHref ?? venueHref(name, venue.index, { now: nowParam, track })
    : undefined;
  const goshthiHref = venue && goshthi?.room ? venueHref(goshthi.room, venue.index, { now: nowParam, track }) : null;

  return (
    <div>
      {traveling && <TimeTravelBanner label={label} />}
      <HubPageHeader eyebrow={`${EVENT_NAME} · Team breakouts`} title="Breakout Sessions">
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {/* The guest's seva as an ink badge: the brand's coral-on-ink. A long seva name
              wraps rather than truncating (rounded-2xl still reads as a pill on one line). */}
          <p className="inline-flex max-w-full items-center gap-2 rounded-2xl bg-ink-800 py-1.5 pl-1.5 pr-3.5 text-xs text-white shadow-card">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-coral-400 text-ink-950">
              <Users aria-hidden="true" className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 break-words">
              <span className="text-white/70">Your seva: </span>
              <span className="font-bold">{seva || "Not set"}</span>
            </span>
          </p>
          {/* Their goshthi group and its room, the light counterpart of the seva badge
              ("Your goshthi group: Kishore Group 4 · <room>", "Your group: Goshthi Group 12 ·
              <room>"; "Room to be confirmed" while none is given, as on /schedule). */}
          {goshthi && (
            <p className="inline-flex max-w-full items-center gap-2 rounded-2xl bg-white py-1.5 pl-1.5 pr-3.5 text-xs text-ink-900 shadow-card ring-1 ring-inset ring-sand-300">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-coral-400 to-coral-700 text-white">
                <Armchair aria-hidden="true" className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0 break-words">
                <span className="text-ink-600">{groupLead}</span>
                <span className="font-bold">{goshthi.label}</span>
                <span aria-hidden="true" className="text-ink-600">
                  {" · "}
                </span>
                <span className="sr-only">, meets during the Goshthi sessions in: </span>
                {goshthiHref ? (
                  <Link
                    href={goshthiHref}
                    className="font-semibold underline decoration-coral-400 decoration-2 underline-offset-2 hover:text-coral-800"
                  >
                    {goshthi.room}
                    <span className="sr-only"> (directions on the venue map)</span>
                  </Link>
                ) : (
                  <span className="font-semibold">{goshthi.room ?? GOSHTHI_ROOM_TBC}</span>
                )}
              </span>
            </p>
          )}
        </div>
      </HubPageHeader>

      {sessions.length > 0 ? (
        <BreakoutList
          sessions={sessions}
          roomHref={roomHref}
          howTo={
            ways
              ? (s, card) => {
                  const way = ways[s.id];
                  if (!way) return card;
                  // Told apart for screen readers: a team can have several sessions of one title.
                  const label = `${s.title}, ${formatDayShort(s.day)}, ${formatTime(new Date(s.startsAt))}`;
                  return (
                    <BreakoutHowTo way={way} label={label} past={s.status === "past"}>
                      {card}
                    </BreakoutHowTo>
                  );
                }
              : undefined
          }
        />
      ) : sevaHasTeam(guest.seva) ? (
        <div className="card flex flex-col items-center px-6 py-10 text-center">
          <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-coral-100 text-coral-800">
            <Users aria-hidden="true" className="h-5 w-5" />
          </span>
          <p className="font-display text-[1.375rem] leading-tight text-ink-900">No team breakouts listed</p>
          <p className="mt-1.5 max-w-xs text-sm text-ink-500">
            There are no team breakouts listed for {seva}. If you expected one, check with your team coordinator.
          </p>
        </div>
      ) : (
        // A seva the breakout matrix has no team for (the master list's "Sant Admin",
        // "NC Lead", ...): the organisers haven't placed these sevas yet.
        <div className="card flex flex-col items-center px-6 py-10 text-center">
          <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100 text-ink-700">
            <CalendarClock aria-hidden="true" className="h-5 w-5" />
          </span>
          <p className="font-display text-[1.375rem] leading-tight text-ink-900">Sessions coming soon</p>
          <p className="mt-1.5 max-w-xs text-sm text-ink-500">
            {seva ? (
              <>
                Breakout sessions for <span className="font-semibold text-ink-700">{seva}</span> will be shared soon.
              </>
            ) : (
              "Your breakout sessions will be shared soon."
            )}{" "}
            Check back here for your rooms and times.
          </p>
        </div>
      )}
    </div>
  );
}
