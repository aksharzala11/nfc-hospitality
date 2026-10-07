import { TriangleAlert } from "lucide-react";
import type { HelpCoverage, HelpTopic } from "@/lib/helpContacts";

const WORDS: Record<HelpTopic, { about: string; page: string; flag: string }> = {
  TRANSPORT: { about: "transport questions", page: "Transportation", flag: "transport" },
  STAY: { about: "hotel room questions", page: "Your stay", flag: "stay" },
};

/**
 * The coral note on the admin Transport and Rooming boards while delegates of
 * a track have nobody to call on the matching hub page: /transportation and
 * /stay list the DELEGATE hotlines of that topic (or GENERAL) for the guest's
 * track (src/lib/helpContacts.ts), and show no help block when there are none.
 * Nothing when both tracks are covered.
 */
export function HelpContactNote({ topic, coverage }: { topic: HelpTopic; coverage: HelpCoverage }) {
  if (coverage.bhaio && coverage.behno) return null;
  const { about, page, flag } = WORDS[topic];
  const who = !coverage.bhaio && !coverage.behno ? "Delegates" : coverage.bhaio ? "Behno delegates" : "Bhaio delegates";
  const track = !coverage.bhaio && !coverage.behno ? "bhaio|behno|all" : coverage.bhaio ? "behno" : "bhaio";
  return (
    <p className="mb-4 flex items-start gap-2 rounded-2xl bg-coral-100 px-3 py-2 text-xs font-semibold leading-snug text-coral-800">
      <TriangleAlert aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
      <span>
        {who} see no contact for {about}: their {page} page has no one to call. Add one with{" "}
        <code className="break-words rounded bg-white/70 px-1">
          npm run hotlines -- --add --role delegate --topic {flag} --track {track} …
        </code>{" "}
        (see the README) and it shows there with a Call button.
      </span>
    </p>
  );
}
