import Link from "next/link";
import type { ReactNode } from "react";
import { Armchair, ArrowUpRight, BedDouble, Bus, CalendarDays, Check, Lock, UtensilsCrossed, Users } from "lucide-react";
import type { StayTileChip, StayTileSummary } from "@/components/stay/stayView";
import type { TransportTileChip, TransportTileSummary } from "@/components/transport/transportView";
import { MandirMark } from "@/components/Logo";
import type { DayChip, MenuSummary } from "@/lib/dashboard";
import styles from "./dashboard.module.css";

/**
 * Home bento in the Sāchu palette: every destination gets its own brand colour, light and
 * dark tiles alternating so neighbours never blend. Ink bookends the grid; coral is the
 * accent throughout.
 *
 *   [ Schedule · ink, with the four-day strip ................ ]
 *   [ Menu · coral gradient → ember ] [ Breakouts · sand            ]
 *   [ Transportation · teal         ] [ Accommodation · pale jade   ]
 *   [ Mandir history · deep ink, a full-width band ........... ]
 *
 * Four small tiles of one size between the two ink bands (user, 2026-10-01: accommodation on
 * the home page, the Menu tile no taller than its neighbours, so the grid fits one screen).
 * Dark and light sit on the diagonals. Transportation shows the guest's next airport leg and
 * Accommodation their hotel and room group; a guest with no hotel room on file (many are
 * local) still gets the tile, reading "No hotel room on file", so the 2 x 2 keeps its shape.
 *
 * Venue Wi-Fi is an open network announced from the admin console, so it has no tile.
 */
export function HomeTiles({
  suffix,
  scheduleSubtitle,
  days,
  menu,
  seva,
  group = null,
  transport = null,
  stay = null,
}: {
  /** "?now=…" while time travelling, otherwise "". */
  suffix: string;
  scheduleSubtitle: string;
  days: DayChip[];
  menu: MenuSummary;
  seva: string;
  /**
   * The guest's goshthi group label (goshthiGroupLabel(goshthiGroup, sevaWing), e.g.
   * "Kishore Group 4" for Bhaio, "Goshthi Group 12" for Behno), or null for none.
   */
  group?: string | null;
  /**
   * The guest's next airport leg (transportTileSummary(getTransportFor(...), now)),
   * or null when it couldn't be loaded (the tile then keeps its generic line).
   */
  transport?: TransportTileSummary | null;
  /**
   * The guest's hotel room group (stayTileSummary(getStayFor(...), today)), or null when
   * it couldn't be loaded or isn't imported yet (the tile then keeps its generic line).
   * `none` (no room on file) shows as "No hotel room on file".
   */
  stay?: StayTileSummary | null;
}) {
  return (
    <nav aria-label="Explore">
      <ul className="stagger grid grid-cols-2 gap-3">
        <li className="col-span-2">
          <ScheduleTile href={`/schedule${suffix}`} subtitle={scheduleSubtitle} days={days} />
        </li>
        <li>
          <MenuTile href={`/menu${suffix}`} menu={menu} />
        </li>
        <li>
          <BreakoutsTile href={`/breakouts${suffix}`} seva={seva} group={group} />
        </li>
        <li>
          <TransportTile href={`/transportation${suffix}`} summary={transport} />
        </li>
        <li>
          <StayTile href={`/stay${suffix}`} summary={stay} />
        </li>
        <li className="col-span-2">
          <HistoryTile href={`/history${suffix}`} />
        </li>
      </ul>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

function Tile({ href, className, children }: { href: string; className: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className={`group relative isolate flex h-full flex-col overflow-hidden rounded-[1.75rem] p-4 transition duration-300 motion-safe:hover:-translate-y-0.5 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral-700 ${className}`}
    >
      {children}
    </Link>
  );
}

/** Round "open" affordance in each tile's top-right corner. */
function Go({ className }: { className: string }) {
  return (
    <span
      aria-hidden="true"
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 ${className}`}
    >
      <ArrowUpRight className="h-4 w-4" strokeWidth={2.4} />
    </span>
  );
}

/** Small tiles: icon + arrow on top, title block pinned to the bottom. */
const SMALL = "min-h-[8.5rem]";

/**
 * Enilas title for the small tiles: 18px, easing down on narrow phones so a single word
 * like "Transportation" still fits a half-width tile at 360px.
 */
const SMALL_TITLE = "block font-display text-[clamp(1rem,4.8vw,1.125rem)] leading-tight";

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------

function ScheduleTile({ href, subtitle, days }: { href: string; subtitle: string; days: DayChip[] }) {
  return (
    <Tile href={href} className="bg-ink-900 text-white shadow-[0_20px_40px_-22px_rgb(20_42_51/0.8)]">
      <span aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-br from-ink-800 via-ink-900 to-ink-950" />
      <span aria-hidden="true" className={`absolute inset-0 -z-10 ${styles.dots}`} />
      <span aria-hidden="true" className="absolute -right-12 -top-16 -z-10 h-44 w-44 rounded-full bg-coral-400/25 blur-3xl" />

      <span className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-coral-400/15 text-coral-300 ring-1 ring-inset ring-coral-300/30">
          <CalendarDays className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-2xl leading-tight">Schedule</span>
          <span className="mt-0.5 block truncate text-xs font-medium text-white/75">{subtitle}</span>
        </span>
        <Go className="bg-white/10 text-white" />
      </span>

      {/* The four event days; today is coral with a bar for how much of its programme is done. */}
      <span aria-hidden="true" className="mt-4 grid grid-cols-4 gap-1.5">
        {days.map((d) => (
          <DayPill key={d.day} chip={d} />
        ))}
      </span>
    </Tile>
  );
}

const DAY_TONE: Record<DayChip["state"], string> = {
  today: "bg-coral-400 text-ink-950 shadow-[0_8px_18px_-8px_rgb(246_143_119/0.9)]",
  past: "bg-white/[0.05] text-white/75",
  future: "bg-white/[0.08] text-white/90 ring-1 ring-inset ring-white/10",
};

function DayPill({ chip }: { chip: DayChip }) {
  return (
    <span className={`relative flex flex-col items-center overflow-hidden rounded-xl px-1 pb-2 pt-1.5 ${DAY_TONE[chip.state]}`}>
      {chip.state === "past" && <Check className="absolute right-1 top-1 h-3 w-3" strokeWidth={2.6} />}
      <span className="text-[10px] font-bold uppercase tracking-caps opacity-85">{chip.weekday}</span>
      <span className="text-lg font-extrabold leading-tight tabular-nums">{chip.date}</span>
      <span className="max-w-full truncate text-[10px] font-medium opacity-90">{chip.label}</span>
      {chip.state === "today" && (
        <span className="absolute inset-x-2.5 bottom-1 h-[3px] overflow-hidden rounded-full bg-ink-950/15">
          <span className="block h-full rounded-full bg-ink-900" style={{ width: `${Math.round(chip.progress * 100)}%` }} />
        </span>
      )}
    </span>
  );
}

// Chips sit where the tile has deepened to coral-700, so the quiet states use an ink pane.
const MENU_CHIP: Record<MenuSummary["state"], { label: string; tone: string }> = {
  serving: { label: "Serving now", tone: "bg-white text-ember-600" },
  out: { label: "Menu out", tone: "bg-white text-coral-800" },
  locked: { label: "Up next", tone: "bg-ink-950/30 text-white ring-1 ring-inset ring-white/25" },
  served: { label: "Complete", tone: "bg-ink-950/30 text-white ring-1 ring-inset ring-white/25" },
};

function MenuTile({ href, menu }: { href: string; menu: MenuSummary }) {
  const chip = MENU_CHIP[menu.state];
  const fresh = menu.state === "serving" || menu.state === "out";
  return (
    <Tile
      href={href}
      className={`${SMALL} bg-coral-700 text-white shadow-[0_20px_40px_-22px_rgb(196_65_71/0.9)] ${fresh ? styles.sheen : ""}`}
    >
      {/* The CORAL gradient at the top, deepening into ember where the text sits. */}
      <span
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-gradient-to-b from-coral-400 via-coral-700 via-45% to-ember-600"
      />
      <span aria-hidden="true" className="absolute -right-10 -top-12 -z-10 h-32 w-32 rounded-full bg-coral-200/45 blur-3xl" />
      <UtensilsCrossed
        aria-hidden="true"
        className="absolute -bottom-6 -right-6 -z-10 h-28 w-28 -rotate-12 text-white/[0.14]"
        strokeWidth={1.25}
      />

      <span className="flex items-start justify-between">
        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-coral-700 shadow-[0_8px_16px_-8px_rgb(196_65_71/0.8)]">
          <UtensilsCrossed className="h-5 w-5" />
        </span>
        <Go className="bg-ink-950/15 text-ink-950" />
      </span>

      <span className="mt-auto block pt-3">
        <span className={SMALL_TITLE}>Menu</span>
        {/* "Dinner menu is out" / "Lunch reveals in 25 min" / "All meals served". */}
        <span className="mt-0.5 line-clamp-2 text-xs font-semibold leading-snug text-white">{menu.subtitle}</span>
        <span className={`mt-2 inline-flex max-w-full items-center gap-1 rounded-xl px-2 py-0.5 text-[10px] font-bold uppercase tracking-caps ${chip.tone}`}>
          {fresh ? (
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current motion-safe:animate-pulse-soft" />
          ) : menu.state === "locked" ? (
            <Lock aria-hidden="true" className="h-3 w-3" strokeWidth={2.6} />
          ) : (
            <Check aria-hidden="true" className="h-3 w-3" strokeWidth={2.6} />
          )}
          {chip.label}
        </span>
      </span>
    </Tile>
  );
}

function BreakoutsTile({ href, seva, group }: { href: string; seva: string; group: string | null }) {
  return (
    <Tile href={href} className={`${SMALL} border border-sand-300/80 bg-sand-100 text-ink-900 shadow-card`}>
      <span aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-br from-sand-50 via-sand-100 to-sand-200" />
      <Users aria-hidden="true" className="absolute -bottom-5 -right-5 -z-10 h-28 w-28 text-coral-400/20" strokeWidth={1.5} />

      <span className="flex items-start justify-between">
        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-coral-400 to-coral-700 text-white shadow-[0_8px_16px_-8px_rgb(196_65_71/0.8)]">
          <Users className="h-5 w-5" />
        </span>
        <Go className="bg-coral-700/10 text-coral-800" />
      </span>

      <span className="mt-auto block pt-3">
        <span className={SMALL_TITLE}>Breakout Sessions</span>
        <span className="mt-1 line-clamp-2 text-xs font-semibold leading-snug text-coral-800">{seva}</span>
        {/* Their goshthi group (its room is on /breakouts) on a white pill, so the
            small text keeps AA contrast over the sand gradient and the watermark. A Bhaio
            label ("Kishore Group 17") gets "Goshthi:" ahead of it, so it can't read as their
            breakout room (Behno labels say "Goshthi Group 12" already). It wraps rather than
            truncates, so the number always shows; rounded-xl still reads as a pill on one line. */}
        {group && (
          <span className="mt-1.5 inline-flex max-w-full items-start gap-1 rounded-xl bg-white/90 px-2 py-0.5 text-[11px] font-bold leading-4 text-ink-800 ring-1 ring-inset ring-sand-300">
            <Armchair aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0 text-coral-700" strokeWidth={2.4} />
            <span className="min-w-0 break-words">
              {!/\bgoshthi\b/i.test(group) && <span className="font-semibold text-ink-600">Goshthi: </span>}
              {group}
            </span>
          </span>
        )}
      </span>
    </Tile>
  );
}

// Chips on the teal: coral for today (the brand's accent), white for the rest, with jade
// ("good") for a finished trip. All dark-on-light, so the 10px caps keep AA.
const TRANSPORT_CHIP: Record<TransportTileChip["tone"], string> = {
  today: "bg-coral-400 text-ink-950",
  group: "bg-white text-ink-800",
  done: "bg-white text-jade-700",
};

function TransportTile({ href, summary }: { href: string; summary: TransportTileSummary | null }) {
  return (
    <Tile href={href} className={`${SMALL} bg-ink-800 text-white shadow-[0_20px_40px_-22px_rgb(20_42_51/0.85)]`}>
      {/* The brand's TEAL gradient. */}
      <span aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-br from-jade-500 to-ink-800" />
      {/* A dashed shuttle route drifting across the tile. */}
      <svg
        aria-hidden="true"
        viewBox="0 0 160 64"
        preserveAspectRatio="none"
        className="absolute inset-x-0 top-9 -z-10 h-16 w-full text-white/[0.18]"
      >
        <path
          d="M-6 54 C 30 54, 46 20, 86 24 S 142 44, 168 6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="5 6"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      <span className="flex items-start justify-between">
        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-inset ring-white/25">
          <Bus className="h-5 w-5" />
        </span>
        <Go className="bg-white/10 text-white" />
      </span>

      <span className="mt-auto block pt-3">
        <span className={SMALL_TITLE}>Transportation</span>
        {/* The next leg, e.g. "Arrive PHL · Thu 5:26 AM", or "No pickup on file". */}
        <span className="mt-0.5 line-clamp-2 text-xs font-semibold leading-snug text-white">
          {summary ? summary.line : "Airport pickups & drop-offs"}
        </span>
        {/* rounded-xl reads as a pill on one line and still holds a wrapped "Drop-off group 12"
            at 360px (like the Breakouts tile's goshthi pill). */}
        {summary?.chip && (
          <span
            className={`mt-2 inline-flex max-w-full items-center gap-1 rounded-xl px-2 py-0.5 text-[10px] font-bold uppercase tracking-caps ${TRANSPORT_CHIP[summary.chip.tone]}`}
          >
            {summary.chip.tone === "done" && <Check aria-hidden="true" className="h-3 w-3" strokeWidth={2.6} />}
            {summary.chip.tone === "today" && (
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current motion-safe:animate-pulse-soft" />
            )}
            {summary.chip.label}
          </span>
        )}
      </span>
    </Tile>
  );
}

// Chips on the pale jade: coral for the check-in day (the brand's accent, as on the Transportation
// tile), white with jade for the nights. Dark on light, so the 10px caps keep AA.
const STAY_CHIP: Record<StayTileChip["tone"], string> = {
  today: "bg-coral-400 text-ink-950",
  nights: "bg-white text-jade-700 ring-1 ring-inset ring-jade-200",
};

function StayTile({ href, summary }: { href: string; summary: StayTileSummary | null }) {
  return (
    <Tile href={href} className={`${SMALL} border border-jade-200/80 bg-jade-50 text-ink-900 shadow-card`}>
      <span aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-br from-white via-jade-50 to-jade-100" />
      <BedDouble
        aria-hidden="true"
        className="absolute -bottom-5 -right-5 -z-10 h-28 w-28 -rotate-6 text-jade-500/15"
        strokeWidth={1.5}
      />

      {/* The icon is the /stay key card's coral on ink. */}
      <span className="flex items-start justify-between">
        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-ink-800 text-coral-300 shadow-[0_8px_16px_-8px_rgb(20_42_51/0.7)]">
          <BedDouble className="h-5 w-5" />
        </span>
        <Go className="bg-jade-700/10 text-jade-700" />
      </span>

      <span className="mt-auto block pt-3">
        <span className={SMALL_TITLE}>Accommodation</span>
        {/* "Hilton · Room group 12", "No hotel room on file", or the generic line until the
            rooming list is loaded. */}
        <span className="mt-0.5 line-clamp-2 text-xs font-semibold leading-snug text-ink-700">
          {summary ? summary.line : "Hotel, room group & roommates"}
        </span>
        {summary?.chip && (
          <span
            className={`mt-2 inline-flex max-w-full items-center gap-1 rounded-xl px-2 py-0.5 text-[10px] font-bold uppercase tracking-caps ${STAY_CHIP[summary.chip.tone]}`}
          >
            {summary.chip.tone === "today" && (
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current motion-safe:animate-pulse-soft" />
            )}
            {summary.chip.label}
          </span>
        )}
      </span>
    </Tile>
  );
}

function HistoryTile({ href }: { href: string }) {
  return (
    <Tile href={href} className="bg-ink-950 text-white shadow-[0_20px_40px_-22px_rgb(20_42_51/0.85)]">
      <span aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-br from-ink-900 to-ink-950" />
      <span aria-hidden="true" className={`absolute inset-0 -z-10 ${styles.jali}`} />
      {/* The Edison mandir mark (this tile is about the mandir itself, not the event brand),
          in coral on ink like the guide's display type. Opacity on the wrapper so any detail
          strokes in the mark fade with it. */}
      <span aria-hidden="true" className="absolute -bottom-4 right-10 -z-10 text-coral-400 opacity-20">
        <MandirMark className="h-24 w-24" />
      </span>

      {/* A full-width band closing the grid, laid out like the Schedule tile's header row. */}
      <span className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-coral-400/15 text-coral-300 ring-1 ring-inset ring-coral-300/30">
          <MandirMark className="h-6 w-6" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-[1.375rem] leading-tight">Edison Mandir History</span>
          <span className="mt-0.5 block text-xs leading-snug text-white/80">The story of our mandir</span>
        </span>
        <Go className="bg-white/10 text-white" />
      </span>
    </Tile>
  );
}
