import { UsersRound } from "lucide-react";
import type { CompanionView } from "@/lib/sant";
import { HandsPraying } from "@/components/icons/HandsPraying";
import { nameInitial } from "@/components/sant/shell/identity";

/**
 * "Staying with you" on /sant/stay: the other santos placed at the same utaro
 * (AccommodationView.companions, already by santName and sorted), each with a
 * coral-on-ink initial avatar. While nobody else has been placed there yet it shows
 * a gentle note instead.
 */
export function StayCompanions({ companions }: { companions: CompanionView[] }) {
  return (
    <section aria-labelledby="stay-companions-heading" className="card mt-4 p-4">
      <h2
        id="stay-companions-heading"
        className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-ink-500"
      >
        <UsersRound className="h-3.5 w-3.5 text-coral-700" />
        Staying with you
      </h2>

      {companions.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {companions.map((c) => (
            <li
              key={c.id}
              className="flex items-center gap-3 rounded-2xl bg-sand-100/80 px-3 py-2.5 ring-1 ring-inset ring-sand-300/70"
            >
              {/* Coral initial on an ink disc, as in the brand's coral-on-ink type. */}
              <span
                aria-hidden="true"
                className="font-display flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink-800 text-lg text-coral-300 shadow-[0_6px_14px_-6px_rgb(20_42_51/0.6)]"
              >
                {nameInitial(c.name)}
              </span>
              <span className="min-w-0 break-words font-semibold leading-snug text-ink-900">{c.name}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-3 flex items-center gap-3 rounded-2xl border border-dashed border-coral-700/25 bg-sand-100/60 px-3.5 py-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-coral-700/10 text-coral-700">
            <HandsPraying className="h-5 w-5" />
          </span>
          <p className="text-sm leading-snug text-ink-600">
            The santos staying here with you will be listed once placements are confirmed.
          </p>
        </div>
      )}
    </section>
  );
}
