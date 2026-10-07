import { toE164 } from "@/lib/users";

/** North American numbers as organisers type them: (732) 555-0123, 732-555-0123, +1 732 555 0123. */
const PHONE = /(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g;

/**
 * Free text (utaro notes, ride descriptions) with any phone numbers in it
 * turned into tap-to-call links. The root layout switches off the browser's
 * own number detection, so this is what makes them tappable.
 */
export function PhoneText({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(PHONE)) {
    const start = match.index ?? 0;
    // Part of a longer run of digits (a reference number, a code): leave it as text.
    if (start > 0 && /\d/.test(text[start - 1])) continue;
    const e164 = toE164(match[0]);
    if (!e164) continue;
    if (start > last) parts.push(text.slice(last, start));
    parts.push(
      <a
        key={start}
        href={`tel:${e164}`}
        className="whitespace-nowrap font-semibold text-coral-800 underline decoration-coral-700/40 underline-offset-2 hover:decoration-coral-700"
      >
        {match[0]}
      </a>,
    );
    last = start + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
