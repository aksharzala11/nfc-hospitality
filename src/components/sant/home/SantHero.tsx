import type { ReactNode } from "react";
import { CalendarDays } from "lucide-react";
import { SachuMark } from "@/components/brand/Sachu";
import { SachuFlurry } from "@/components/brand/SachuFlurry";
import { APP_TITLE } from "@/lib/branding";
import { fitNameStyle } from "@/components/sant/pages/fitName";
import styles from "./santHome.module.css";

/** Hand-placed stars (percent of the upper sky) so every render is identical. */
const STARS = [
  { left: 7, top: 14, size: 1.5, delay: 0.4 },
  { left: 16, top: 42, size: 1, delay: 2.2 },
  { left: 26, top: 9, size: 2, delay: 1.1 },
  { left: 38, top: 30, size: 1, delay: 3.1 },
  { left: 61, top: 11, size: 1.5, delay: 1.8 },
  { left: 72, top: 36, size: 1, delay: 0.9 },
  { left: 81, top: 7, size: 2, delay: 2.7 },
  { left: 93, top: 24, size: 1.5, delay: 1.4 },
  { left: 88, top: 55, size: 1, delay: 3.4 },
  { left: 3, top: 62, size: 1, delay: 2.5 },
];

/**
 * Home hero of the Pujya Santo view, in the Sāchu brand, and the first thing on
 * the page: an ink night falling into a coral → ember sandhya, with a flurry of
 * "SĀCHU" in coral and sand rising from the horizon, under the white Sāchu mark,
 * "Jay Swāminārāyan" in coral Enilas and the sant's name in white.
 * Server-rendered; the ticking clock (countdown / live / gratitude) comes in as
 * `children`.
 */
export function SantHero({ name, dayLabel, children }: { name: string; dayLabel: string; children: ReactNode }) {
  return (
    <section
      aria-labelledby="sant-greeting"
      className={`relative isolate mb-4 overflow-hidden rounded-[2rem] text-white shadow-[0_28px_50px_-26px_rgb(20_42_51/0.85)] ${styles.sky}`}
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[44%]">
        {STARS.map((s) => (
          <span
            key={`${s.left}-${s.top}`}
            className={styles.star}
            style={{ left: `${s.left}%`, top: `${s.top}%`, width: s.size, height: s.size, animationDelay: `${s.delay}s` }}
          />
        ))}
      </div>

      <div className="px-5 pb-2 pt-5 text-center">
        {/* Brand row: the white Sāchu mark (the variant for ink) beside the app title in tracked caps. */}
        <p className="mx-auto flex max-w-full items-center justify-center gap-2.5 text-[10px] font-bold uppercase tracking-[0.22em] text-coral-300">
          <SachuMark variant="white" className="h-8 w-auto shrink-0" priority />
          <span className="min-w-0">{APP_TITLE}</span>
        </p>

        {/* The h1 is the container the name fits to: long names step down from 2.35rem so
            they never break mid-word on a 360px phone. */}
        <h1 id="sant-greeting" className="@container mt-5">
          <span className="block font-display text-[1.35rem] leading-tight text-coral-300">Jay Swāminārāyan,</span>
          <span
            className="mt-1 block break-words font-display text-[2.35rem] leading-[1.08] [text-shadow:0_2px_14px_rgb(20_42_51/0.5)]"
            style={fitNameStyle(name, 2.35)}
          >
            {name}
          </span>
        </h1>

        <p className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold text-white/90 ring-1 ring-inset ring-white/15">
          <CalendarDays aria-hidden="true" className="h-3.5 w-3.5 text-coral-300" />
          {dayLabel}
        </p>

        <div className="mt-5">{children}</div>
      </div>

      {/* The Sāchu flurry on the horizon, in the warmer "ember" palette, over the
          rays and coral light of the sandhya. It sits below the clock (never
          behind it), fades out towards it, and clips to the card's corners. */}
      <div className="relative">
        <div aria-hidden="true" className={`pointer-events-none absolute inset-x-[-15%] bottom-[30%] -z-10 h-[170%] ${styles.rays}`} />
        <div aria-hidden="true" className={`pointer-events-none absolute inset-x-0 -top-16 bottom-0 -z-10 ${styles.glow}`} />
        <SachuFlurry tone="ember" className="rounded-b-[2rem]" />
      </div>

      {/* Hairline edge drawn above the full-bleed art. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[2rem] ring-1 ring-inset ring-white/10" />
    </section>
  );
}
