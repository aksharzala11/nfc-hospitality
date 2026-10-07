import { Phone, PhoneCall } from "lucide-react";
import type { HotlineView } from "@/lib/sant";
import { TelegramButton } from "./TelegramButton";

/**
 * One Santo contact as a compact white card with its own Call button: the
 * transport page's lines after the first, and the stay page's contacts. With a
 * Telegram username on file the card also offers "Message on Telegram": the two
 * buttons then share a row under the contact, so neither squeezes the number.
 */
export function SantContactRow({ line }: { line: HotlineView }) {
  const meta = [line.contactName, line.availability].filter(Boolean).join(" · ");
  const call = (className: string) => (
    <a
      href={line.telHref}
      className={`flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-2xl bg-gradient-to-br from-coral-700 to-ember-700 px-4 text-sm font-bold text-white shadow-glow transition hover:from-ember-600 hover:to-ember-700 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral-700 ${className}`}
    >
      <Phone className="h-4 w-4" strokeWidth={2.4} />
      Call
      <span className="sr-only">
        {" "}
        {line.label}, {line.phoneDisplay}
      </span>
    </a>
  );
  return (
    <li className="card p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ink-800 text-coral-300">
          <PhoneCall className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold leading-snug text-ink-900">{line.label}</h3>
          <p className="text-sm tabular-nums text-ink-600">{line.phoneDisplay}</p>
          {meta && <p className="mt-0.5 text-xs text-ink-500">{meta}</p>}
        </div>
        {!line.telegramHref && call("")}
      </div>
      {line.telegramHref && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {call("")}
          <TelegramButton href={line.telegramHref} who={line.contactName ?? line.label} className="h-11" />
        </div>
      )}
    </li>
  );
}
