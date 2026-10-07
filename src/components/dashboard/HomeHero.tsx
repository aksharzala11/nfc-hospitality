import type { ReactNode } from "react";
import { SachuMark } from "@/components/brand/Sachu";
import { SachuFlurry } from "@/components/brand/SachuFlurry";
import { APP_TITLE, EVENT_NAME } from "@/lib/branding";
import styles from "./dashboard.module.css";

/** "Hospitality Hub": APP_TITLE without the event name, for the brand row's second line. */
const HUB_NAME = APP_TITLE.replace(EVENT_NAME, "").replace(/^[\s:·–-]+/, "");

/**
 * Home hero in the Sāchu brand, and the first thing on the page: the guide's ink panel with
 * coral display type, ending in a flurry of "SĀCHU" rising out of coral light, as the logo
 * stacks the word. Ink + coral keeps the delegate home apart from the admin console's
 * ink → jade hero. Server-rendered; the ticking clock (countdown / live / thank-you)
 * comes in as `children`.
 */
export function HomeHero({ name, children }: { name: string; children: ReactNode }) {
  return (
    <section
      aria-labelledby="home-greeting"
      className={`relative isolate mb-4 overflow-hidden rounded-[2rem] text-white shadow-[0_28px_50px_-26px_rgb(20_42_51/0.7)] ${styles.hero}`}
    >
      <div className="px-5 pb-2 pt-5 text-center">
        {/* Brand row: the white mark with the app's name as tracked caps, like the guide's labels. */}
        <p className="flex items-center justify-center gap-2.5">
          <SachuMark variant="white" className="h-9" priority />
          <span className="sr-only">{APP_TITLE}</span>
          <span
            aria-hidden="true"
            className="text-left text-[10px] font-bold uppercase leading-[1.4] tracking-[0.24em]"
          >
            <span className="block text-coral-200">{EVENT_NAME}</span>
            <span className="block text-white/85">{HUB_NAME}</span>
          </span>
        </p>

        {/* Coral display type on ink, as in the guide. 24px keeps coral-300 in "large text" territory. */}
        <h1 id="home-greeting" className="mt-5">
          <span className="block font-display text-2xl leading-tight text-coral-300">Jay Swāminārāyan,</span>
          <span className="mt-0.5 block break-words font-display text-[2.125rem] leading-[1.12]">{name}</span>
        </h1>
        <div className="mt-5">{children}</div>
      </div>

      {/* The Sāchu flurry along the bottom of the card, in coral and sand over coral light. It
          sits below the clock (never behind it) and fades out towards it; the band clips its
          words to the card's rounded corners. */}
      <div className="relative">
        <div aria-hidden="true" className={`pointer-events-none absolute inset-x-0 -top-16 bottom-0 -z-10 ${styles.glow}`} />
        <SachuFlurry tone="coral" className="rounded-b-[2rem]" />
      </div>

      {/* Hairline edge drawn above the full-bleed art. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[2rem] ring-1 ring-inset ring-white/10" />
    </section>
  );
}
