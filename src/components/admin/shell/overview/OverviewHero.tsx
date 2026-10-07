import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { CalendarClock, CalendarDays, Hourglass, Megaphone, UserPlus, type LucideIcon } from "lucide-react";
import { EVENT_NAME } from "@/lib/branding";
import { SachuMark } from "@/components/brand/Sachu";

/** Faint dot grid over the gradient (white only, so it takes the brand colour beneath). */
const DOTS: CSSProperties = {
  backgroundImage: "radial-gradient(circle at 1px 1px, rgb(255 255 255 / 0.07) 1px, transparent 0)",
  backgroundSize: "16px 16px",
};

/**
 * Dark glass for chips and action tiles. It keeps small white text above AA
 * wherever it lands on the gradient, including the light jade corner.
 */
const GLASS = "bg-ink-950/30 ring-1 ring-inset ring-white/15";

/**
 * Top of the console home: the Sāchu mark with the greeting, today's date /
 * programme day, and the three event-day actions one tap away. The panel is
 * the brand's teal gradient laid the way the mark itself fades: ink at the top
 * left, jade toward the bottom right, with coral for the actions. On tablets
 * and desktops the actions sit to the right of the greeting.
 */
export function OverviewHero({
  name,
  day,
  note,
  actions,
  className = "",
}: {
  /** greetingName() of the signed-in admin. */
  name: string;
  /** "Day 2 · Fri, Oct 9" or, outside the event, "Wed, Sep 23". */
  day: string;
  /** Event-level note beside the day, e.g. "NAAM 2026 starts in 15 days"; null during the event. */
  note: string | null;
  /** Hrefs of the quick actions (already carrying ?now= while time-travelling). */
  actions: { addDelegate: string; announce: string; schedule: string };
  className?: string;
}) {
  return (
    <section
      aria-labelledby="admin-greeting"
      className={`relative isolate overflow-hidden rounded-[2rem] bg-ink-800 p-5 text-white shadow-[0_28px_50px_-26px_rgb(20_42_51/0.8)] md:p-6 ${className}`}
    >
      {/* Ink holds through the first third so the eyebrow and greeting stay on ink (AA for small text). */}
      <span aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-br from-ink-800 from-35% to-jade-500" />
      <span aria-hidden="true" className="absolute inset-0 -z-10" style={DOTS} />
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[2rem] ring-1 ring-inset ring-white/10" />

      <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between md:gap-8">
        <div className="min-w-0">
          <div className="flex items-center gap-3.5 md:gap-4">
            <SachuMark variant="white" priority className="h-[4.25rem] w-auto shrink-0 md:h-20" />
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase leading-relaxed tracking-[0.24em] text-coral-200">
                {EVENT_NAME} · Admin console
              </p>
              <h1 id="admin-greeting" className="mt-1">
                <span className="block text-sm font-medium text-white/80">Jay Swāminārāyan,</span>
                <span className="mt-0.5 block break-words font-display text-[1.875rem] leading-tight md:text-[2.25rem]">
                  {name}
                </span>
              </h1>
            </div>
          </div>
          <p className="mt-4 flex flex-wrap gap-2">
            <Chip icon={CalendarDays}>{day}</Chip>
            {note && <Chip icon={Hourglass}>{note}</Chip>}
          </p>
        </div>

        <nav aria-label="Quick actions" className="grid grid-cols-3 gap-2 md:w-[25rem] md:shrink-0">
          <Action href={actions.addDelegate} icon={UserPlus} label="Add delegate" />
          <Action href={actions.announce} icon={Megaphone} label="New announcement" />
          <Action href={actions.schedule} icon={CalendarClock} label="Adjust schedule" />
        </nav>
      </div>
    </section>
  );
}

function Chip({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold text-white/90 ${GLASS}`}>
      <Icon className="h-3.5 w-3.5 text-coral-200" />
      {children}
    </span>
  );
}

function Action({ href, icon: Icon, label }: { href: string; icon: LucideIcon; label: string }) {
  return (
    <Link
      href={href}
      className={`group flex min-h-[5.5rem] flex-col items-center justify-center gap-2 rounded-2xl px-2 py-3 text-center transition hover:bg-ink-950/45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:scale-[0.97] ${GLASS}`}
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-coral-400 to-coral-700 text-white shadow-glow transition duration-300 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100">
        <Icon className="h-5 w-5" strokeWidth={2.2} />
      </span>
      <span className="text-xs font-semibold leading-tight text-white">{label}</span>
    </Link>
  );
}
