"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Clock, X } from "lucide-react";

/** Shown when the page is rendered for a demo "now" instead of the real time. */
export function TimeTravelBanner({ label }: { label: string }) {
  const pathname = usePathname();
  // Drop only ?now=, keeping anything else (e.g. the sant schedule's ?tab=).
  const rest = new URLSearchParams(useSearchParams().toString());
  rest.delete("now");
  const query = rest.toString();
  const href = query ? `${pathname}?${query}` : pathname;
  return (
    // A preview is a caution state, so coral: pale coral surface, coral-800 label, ink text.
    <div className="mb-4 flex items-center gap-2.5 rounded-2xl border border-coral-200 bg-coral-50 py-1.5 pl-3.5 pr-1.5 text-xs text-ink-800">
      <Clock className="h-4 w-4 shrink-0 text-coral-700" aria-hidden="true" />
      <span className="min-w-0 flex-1 leading-snug">
        <span className="mr-0.5 text-[10px] font-bold uppercase tracking-caps text-coral-800">Previewing</span>{" "}
        <span className="font-semibold text-ink-900">{label}</span>
      </span>
      <Link
        href={href}
        aria-label="Back to real time"
        // 32px circle with an invisible 44px hit area.
        className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-700 transition after:absolute after:-inset-1.5 after:content-[''] hover:bg-white/80 hover:text-ink-900"
      >
        <X className="h-4 w-4" />
      </Link>
    </div>
  );
}
