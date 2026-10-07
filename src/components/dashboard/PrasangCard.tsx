import { ArrowUpRight, Feather } from "lucide-react";
import {
  PRASANG_FORM_HINT,
  PRASANG_FORM_HINT_STANDALONE,
  PRASANG_FORM_URL,
  PRASANG_SUBTITLE,
  PRASANG_TITLE,
} from "@/lib/prasang";
import styles from "./dashboard.module.css";

/**
 * Home section for the reporting team's Prasang Submission Form, between the
 * hero and the tiles. A ruled journal page rather than another tile: the
 * feather sits in the margin, the entry to its right, and the button opens the
 * Microsoft Form in the same tab (see PrasangFormLink). The in-app page /prasang
 * (what announcements link to) reuses the pieces below, so both look the same.
 */
export function PrasangCard() {
  return (
    <section
      aria-labelledby="prasang-card-title"
      className="relative isolate mb-4 overflow-hidden rounded-[1.75rem] border border-sand-300/80 bg-sand-50 p-4 text-ink-900 shadow-[0_20px_40px_-24px_rgb(196_65_71/0.4)]"
    >
      {/* The margin line runs down the gap between the feather and the text column. */}
      <JournalPaper marginClassName="left-[calc(4.125rem_-_1.5px)]" />

      <div className="flex items-start gap-3">
        <InkFeather className="h-11 w-11 rounded-2xl" iconClassName="h-5 w-5" />
        <div className="min-w-0 flex-1">
          <h2 id="prasang-card-title" className="font-display text-[1.375rem] leading-tight text-ink-900">
            {PRASANG_TITLE}
          </h2>
          <p className="mt-1 text-sm leading-snug text-ink-800/85">{PRASANG_SUBTITLE}</p>
        </div>
      </div>

      {/* Indented to the text column (feather 2.75rem + gap 0.75rem). */}
      <div className="mt-3.5 pl-14">
        <PrasangFormLink hintId="prasang-card-hint" />
        <PrasangFormHint id="prasang-card-hint" className="mt-2 text-[11px] font-medium text-ink-500" />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Shared with src/app/(hub)/prasang/page.tsx
// ---------------------------------------------------------------------------

/**
 * Paper for a prasang card; put it first inside a `relative isolate
 * overflow-hidden` box. Brand sand with faint ink rules and a soft coral glow, plus
 * a notebook's double coral margin line when `marginClassName` places one (e.g. "left-8").
 */
export function JournalPaper({ marginClassName }: { marginClassName?: string }) {
  return (
    <>
      <span
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-gradient-to-br from-sand-50 via-sand-50 to-sand-200/80"
      />
      <span aria-hidden="true" className={`absolute inset-0 -z-10 ${styles.ruled}`} />
      {marginClassName && (
        <span
          aria-hidden="true"
          className={`absolute inset-y-0 -z-10 w-[3px] border-x border-coral-400/45 ${marginClassName}`}
        />
      )}
      <span
        aria-hidden="true"
        className="absolute -right-12 -top-16 -z-10 h-44 w-44 rounded-full bg-coral-300/30 blur-3xl"
      />
    </>
  );
}

/** The ink "ink well" with a coral feather that marks the form. Pass size and radius. */
export function InkFeather({ className, iconClassName }: { className: string; iconClassName: string }) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center bg-gradient-to-br from-ink-800 to-ink-950 text-coral-300 shadow-[0_8px_16px_-8px_rgb(20_42_51/0.7)] ring-1 ring-inset ring-coral-300/25 ${className}`}
    >
      <Feather className={iconClassName} />
    </span>
  );
}

const LINK_SIZE = {
  md: { box: "h-12 text-sm", icon: "h-4 w-4" },
  lg: { box: "h-14 text-base", icon: "h-5 w-5" },
} as const;

/**
 * "Open the form": navigates to the Microsoft Form in the same tab. Many guests
 * use the Hub inside Telegram's in-app browser, where a new tab takes them out
 * of the site and they have to reopen it; in the same tab, Back (or "Done" in an
 * iPhone home-screen install) returns to the Hub. `hintId` names the
 * PrasangFormHint saying so. The arrow-out
 * icon marks leaving the site (not a new window). `noreferrer` keeps our URL
 * from Microsoft. Bright coral with ink type (the guide's coral + ink pairing,
 * AA at any size; white on this coral would not be).
 */
export function PrasangFormLink({ hintId, size = "md" }: { hintId: string; size?: keyof typeof LINK_SIZE }) {
  const s = LINK_SIZE[size];
  return (
    <a
      href={PRASANG_FORM_URL}
      rel="noreferrer"
      aria-describedby={hintId}
      className={`flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-coral-400 to-coral-500 px-5 font-bold text-ink-950 shadow-glow transition hover:from-coral-300 hover:to-coral-400 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral-700 ${s.box}`}
    >
      Open the form
      <ArrowUpRight aria-hidden="true" className={`${s.icon} text-ink-950/75`} strokeWidth={2.4} />
    </a>
  );
}

/**
 * The line under PrasangFormLink (its aria-describedby target). Browser guests
 * read "Use Back"; a home-screen install (display-mode: standalone) reads "Tap
 * Done" instead. Pure CSS, so it works in server components and needs no client
 * detection; the hidden span is display:none, so it is left out of the link's
 * accessible description too.
 */
export function PrasangFormHint({ id, className }: { id: string; className: string }) {
  return (
    <p id={id} className={className}>
      <span className="[@media(display-mode:standalone)]:hidden">{PRASANG_FORM_HINT}</span>
      <span className="hidden [@media(display-mode:standalone)]:inline">{PRASANG_FORM_HINT_STANDALONE}</span>
    </p>
  );
}
