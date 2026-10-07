import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import type { HelpContactView } from "@/lib/helpContacts";
import { HelpContacts } from "@/components/help/HelpContacts";

/**
 * The /stay page's single card when there is no room group to show (none on
 * file, or the rooming list not loaded yet): a message, then who to contact
 * (the guest's accommodation contacts; just the message when there are none).
 * The same shape as the Transportation page's empty state.
 */
export function StayEmptyCard({
  icon: Icon,
  title,
  contacts,
  children,
}: {
  icon: LucideIcon;
  title: string;
  /** The guest's help contacts for their stay (pickHelpContacts()); may be empty. */
  contacts: HelpContactView[];
  /** One or two sentences of plain text. */
  children: ReactNode;
}) {
  return (
    <section aria-labelledby="stay-none" className={`card stagger px-5 pt-8 ${contacts.length > 0 ? "pb-5" : "pb-8"}`}>
      <div className="flex flex-col items-center text-center">
        <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100 text-ink-700">
          <Icon aria-hidden="true" className="h-5 w-5" />
        </span>
        <h2 id="stay-none" className="font-display text-[1.375rem] leading-tight text-ink-900">
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
