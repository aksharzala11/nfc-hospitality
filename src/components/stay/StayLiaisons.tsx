import { ContactRound } from "lucide-react";
import type { StayLiaisonView } from "@/lib/hotelLiaisons";
import { CallButton } from "@/components/help/HelpContacts";

/**
 * "Hotel Liaison" inside a stay card ("Hotel Liaisons" when there are
 * several): the rooming team's points of contact at that hotel for the guest's
 * track (pickLiaisons(): every liaison of their track and any for everyone; a
 * guest with no gender on file sees both tracks', each marked "For Bhaio" /
 * "For Behno" via forTrack), each in the help-contact row look with its own
 * tap-to-call button. The card leaves it out when the hotel has none.
 */
export function StayLiaisons({
  liaisons,
  hotelName,
  headingId,
}: {
  liaisons: StayLiaisonView[];
  hotelName: string;
  headingId: string;
}) {
  return (
    <div role="group" aria-labelledby={headingId}>
      <h3
        id={headingId}
        className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-ink-500"
      >
        <ContactRound aria-hidden="true" className="h-3.5 w-3.5 text-coral-700" />
        {liaisons.length === 1 ? "Hotel Liaison" : "Hotel Liaisons"}
      </h3>
      <p className="mt-1 text-sm leading-snug text-ink-600">For anything you need at the {hotelName}.</p>

      <ul className="mt-2.5 space-y-2">
        {liaisons.map((l) => {
          return (
            <li
              key={l.id}
              className="flex items-center gap-3 rounded-2xl bg-white px-3.5 py-3 shadow-card ring-1 ring-inset ring-sand-200"
            >
              {/* Decorative: left out on narrow phones (under 400px) so a two-word name keeps to one line beside Call. */}
              <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ink-800 text-coral-300 min-[400px]:flex">
                <ContactRound aria-hidden="true" className="h-[18px] w-[18px]" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="break-words font-semibold leading-snug text-ink-900">{l.name}</p>
                <p className="text-sm tabular-nums text-ink-600">{l.phoneDisplay}</p>
                {l.forTrack && <p className="mt-0.5 text-xs text-ink-600">For {l.forTrack}</p>}
              </div>
              <CallButton href={l.telHref} srLabel={`Hotel Liaison, ${l.name}, ${l.phoneDisplay}`} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
