import { Phone, PhoneCall } from "lucide-react";
import type { HelpContactView } from "@/lib/helpContacts";

/**
 * Who to call, on /stay ("Questions about your room?") and /transportation
 * ("Need a change?"): the delegate's help contacts for that page and their
 * track (pickHelpContacts() in src/lib/helpContacts.ts), one card each with
 * what it is for (the stored label, e.g. "Accommodation"), the person's name,
 * the number, the hours when set, and a tap-to-call button. A guest with no
 * gender on file sees both tracks' contacts, each marked "For Bhaio" / "For
 * Behno" (forTrack).
 *
 * Renders nothing when there are no contacts: the pages then leave the whole
 * help block out (heading included), since there is nobody else to point to.
 */
export function HelpContacts({ contacts }: { contacts: HelpContactView[] }) {
  if (contacts.length === 0) return null;
  return (
    <ul className="space-y-2.5">
      {contacts.map((c) => (
        <ContactRow key={c.id} contact={c} />
      ))}
    </ul>
  );
}

function ContactRow({ contact }: { contact: HelpContactView }) {
  const name = contact.contactName?.trim() || null;
  const meta = [contact.forTrack && `For ${contact.forTrack}`, contact.availability?.trim()].filter(Boolean).join(" · ");
  return (
    <li className="flex items-center gap-3 rounded-2xl bg-white px-3.5 py-3 shadow-card ring-1 ring-inset ring-sand-200">
      {/* Decorative: left out on narrow phones (under 400px) so a two-word name keeps to one line beside Call. */}
      <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ink-800 text-coral-300 min-[400px]:flex">
        <PhoneCall aria-hidden="true" className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        {name ? (
          <>
            <p className="break-words text-[10px] font-bold uppercase tracking-caps text-ink-500">{contact.label}</p>
            <p className="break-words font-semibold leading-snug text-ink-900">{name}</p>
          </>
        ) : (
          <p className="break-words font-semibold leading-snug text-ink-900">{contact.label}</p>
        )}
        <p className="text-sm tabular-nums text-ink-600">{contact.phoneDisplay}</p>
        {meta && <p className="mt-0.5 text-xs text-ink-600">{meta}</p>}
      </div>
      <CallButton
        href={contact.telHref}
        srLabel={[contact.label, name, contact.phoneDisplay].filter(Boolean).join(", ")}
      />
    </li>
  );
}

/** The coral "Call" button: 44px tall, the number and who it reaches in its accessible name. */
export function CallButton({ href, srLabel }: { href: string; srLabel: string }) {
  return (
    <a
      href={href}
      className="flex h-11 shrink-0 items-center gap-1.5 rounded-2xl bg-gradient-to-br from-coral-700 to-ember-700 px-4 text-sm font-bold text-white shadow-glow transition hover:from-ember-600 hover:to-ember-700 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral-700"
    >
      <Phone aria-hidden="true" className="h-4 w-4" strokeWidth={2.4} />
      Call
      <span className="sr-only"> {srLabel}</span>
    </a>
  );
}
