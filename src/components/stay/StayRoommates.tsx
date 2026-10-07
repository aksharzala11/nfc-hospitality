import { UsersRound } from "lucide-react";
import type { StayRoommate } from "@/lib/rooming";
import { initials } from "@/lib/users";
import { roommateNightsLabel } from "./stayView";

/**
 * "Your roommates" inside a stay card: the people sharing the room group, by
 * name and center only (RoomStayView.roommates, already greetingName()d and sorted), each
 * with a coral-on-ink initials disc, their center under the name when one is on file
 * (user, 2026-10-01) and, when they share only part of a stay
 * that starts Wednesday, which nights ("Joins Thu, Oct 8"). Roommates who
 * aren't in the app yet are counted, never named: "+1 more roommate · Not in
 * the app yet". With nobody
 * listed it says so gently (a room group can still be filled later).
 */
export function StayRoommates({
  roommates,
  notInApp,
  capacity,
  headingId,
}: {
  roommates: StayRoommate[];
  notInApp: number;
  capacity: number;
  headingId: string;
}) {
  const nobody = roommates.length === 0 && notInApp === 0;
  return (
    <div role="group" aria-labelledby={headingId}>
      <h3
        id={headingId}
        className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-ink-500"
      >
        <UsersRound aria-hidden="true" className="h-3.5 w-3.5 text-coral-700" />
        Your roommates
      </h3>

      {nobody ? (
        <p className="mt-2.5 rounded-2xl border border-dashed border-sand-400 bg-sand-50 px-3.5 py-3 text-sm leading-snug text-ink-600">
          {capacity <= 1 ? "This room group is just for you." : "No roommates are listed with you yet."}
        </p>
      ) : (
        <ul className="mt-2.5 space-y-2">
          {roommates.map((r, i) => {
            const nights = roommateNightsLabel(r.nights);
            return (
              <li
                key={`${r.name}-${i}`}
                className="flex items-center gap-3 rounded-2xl bg-sand-100/80 px-3 py-2.5 ring-1 ring-inset ring-sand-300/70"
              >
                {/* Coral on ink, as in the brand's coral-on-ink type. */}
                <span
                  aria-hidden="true"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink-800 text-sm font-bold tracking-wide text-coral-300 shadow-[0_6px_14px_-6px_rgb(20_42_51/0.6)]"
                >
                  {initials({ name: r.name })}
                </span>
                <span className="min-w-0">
                  <span className="block break-words font-semibold leading-snug text-ink-900">{r.name}</span>
                  {r.center && (
                    <span className="block break-words text-xs font-medium text-ink-600">
                      <span className="sr-only">Center: </span>
                      {r.center}
                    </span>
                  )}
                  {nights && <span className="block text-xs font-medium text-ink-600">{nights}</span>}
                </span>
              </li>
            );
          })}
          {notInApp > 0 && (
            <li className="flex items-center gap-3 rounded-2xl border border-dashed border-sand-400 px-3 py-2.5">
              <span
                aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sand-200 text-ink-700"
              >
                <UsersRound className="h-[18px] w-[18px]" />
              </span>
              <span className="min-w-0">
                <span className="block font-semibold leading-snug text-ink-700">
                  +{notInApp} more {notInApp === 1 ? "roommate" : "roommates"}
                </span>
                <span className="block text-xs font-medium text-ink-600">Not in the app yet</span>
              </span>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
