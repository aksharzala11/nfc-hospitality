"use client";

import Link from "next/link";
import { memo, useMemo, type ReactNode } from "react";
import {
  ArrowUpRight,
  CalendarClock,
  CalendarDays,
  CarFront,
  Check,
  Clock,
  House,
  MapPin,
  Phone,
  UserRound,
  Users,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";
import { useEventClock } from "@/components/dashboard/useEventClock";
import { TelegramButton } from "@/components/sant/pages/TelegramButton";
import type { SantTilesData } from "./data";
import {
  STRIP_DAYS,
  parseTiles,
  tilesAt,
  type Bead,
  type BeadDay,
  type BreakoutsTileView,
  type MenuTileView,
  type MineChip,
  type StripDay,
} from "./tiles";
import styles from "./santHome.module.css";

/** Where each tile leads, already carrying ?now= while time-travelling. */
export type SantTileHrefs = {
  mine: string;
  general: string;
  stay: string;
  transport: string;
  menu: string;
  breakouts: string;
};

/**
 * Santo home bento: each destination has its own surface, all from the Sāchu
 * palette, with the view's deeper coral → ember warmth leading:
 *
 *   [ My schedule · coral→ember ] [ Utaro · sand             ]
 *   [   (tall, a bead per       ] [ Transport · ink, Call     ]
 *   [    item per day)          ]
 *   [ Menu · light coral thali  ] [ Breakouts · teal sabha    ]
 *   [ General schedule · white, with a week of Santo days ... ]
 *
 * A client island on the hero's clock (useEventClock), so the chips, beads,
 * the featured meal and breakout block turn over on the minute, also under ?now= time
 * travel, instead of waiting for the next AutoRefresh. data.ts formats every
 * label on the server; tiles.ts works out what each tile shows at a moment.
 * The Transport tile carries a tap-to-call button for the first hotline; the
 * tile itself is a stretched link so the two never nest.
 */
export function SantTiles({
  data,
  hrefs,
  serverNow,
  traveling,
}: {
  data: SantTilesData;
  hrefs: SantTileHrefs;
  /** now.toISOString() from pageNow(). */
  serverNow: string;
  traveling: boolean;
}) {
  const now = useEventClock(serverNow, traveling);
  // Items, meals and sessions start and end on whole minutes, so the bento
  // only re-renders when the minute turns, not on every tick of the clock.
  return <Bento data={data} hrefs={hrefs} now={now - (now % 60_000)} />;
}

const Bento = memo(function Bento({ data, hrefs, now }: { data: SantTilesData; hrefs: SantTileHrefs; now: number }) {
  const parsed = useMemo(() => parseTiles(data), [data]);
  const view = tilesAt(parsed, now);

  return (
    <nav aria-label="Explore">
      <ul className="stagger grid grid-cols-2 gap-3">
        <li className="row-span-2">
          <MyScheduleTile href={hrefs.mine} chip={view.mine.chip} days={view.mine.days} />
        </li>
        <li>
          <UtaroTile href={hrefs.stay} stay={data.stay} />
        </li>
        <li>
          <TransportTile href={hrefs.transport} hotline={data.transport.hotline} line={view.ride} />
        </li>
        <li>
          <MenuTile href={hrefs.menu} menu={view.menu} />
        </li>
        <li>
          <BreakoutsTile href={hrefs.breakouts} breakouts={view.breakouts} />
        </li>
        <li className="col-span-2">
          <GeneralTile href={hrefs.general} subtitle={view.general.subtitle} days={view.general.days} />
        </li>
      </ul>
    </nav>
  );
});

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

const TILE =
  "group relative isolate flex h-full flex-col overflow-hidden rounded-[1.75rem] p-4 transition duration-300 motion-safe:hover:-translate-y-0.5 active:scale-[0.98]";

function Tile({ href, className, children }: { href: string; className: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className={`${TILE} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral-700 ${className}`}
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

/** Small-tile heading: the destination in tracked caps, with an optional status mark after it. */
function Label({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.2em] ${className}`}>
      {children}
    </span>
  );
}

/** A detail line with a small leading icon (time, place). */
function Meta({ icon: Icon, className, children }: { icon: LucideIcon; className: string; children: ReactNode }) {
  return (
    <span className="flex items-start gap-1 text-xs leading-snug">
      <Icon aria-hidden="true" className={`mt-0.5 h-3 w-3 shrink-0 ${className}`} />
      <span className="min-w-0 break-words">{children}</span>
    </span>
  );
}

/** Pulsing "on now" dot for the small tiles' labels. */
function LiveDot({ className }: { className: string }) {
  return (
    <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full motion-safe:animate-pulse-soft ${className}`} />
  );
}

// ---------------------------------------------------------------------------
// My schedule: coral deepening into ember, a string of beads per day
// ---------------------------------------------------------------------------

const CHIP_TONE: Record<MineChip["tone"], string> = {
  live: "bg-white text-coral-700",
  bright: "bg-white text-ember-600",
  quiet: "bg-ink-950/20 text-white ring-1 ring-inset ring-white/30",
};

const BEAD: Record<Bead, string> = {
  done: "h-2 w-2 bg-coral-200",
  now: "h-2.5 w-2.5 bg-white shadow-[0_0_10px_rgb(255_255_255/0.85)] motion-safe:animate-pulse-soft",
  ahead: "h-2 w-2 ring-1 ring-inset ring-white/70",
};

const DAY_TEXT: Record<BeadDay["state"], string> = {
  past: "text-white/85",
  today: "text-white",
  future: "text-white",
};

function MyScheduleTile({ href, chip, days }: { href: string; chip: MineChip; days: BeadDay[] }) {
  const hasBeads = days.some((d) => d.beads.length > 0);
  return (
    <Tile href={href} className="bg-coral-700 text-white shadow-[0_20px_40px_-22px_rgb(196_65_71/0.95)]">
      {/* Coral at the top deepening to ember where the text sits (white text stays AA). */}
      <span
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-gradient-to-b from-coral-600 via-coral-700 via-45% to-ember-700"
      />
      <span aria-hidden="true" className={`absolute inset-0 -z-10 ${styles.jali}`} />
      <span aria-hidden="true" className="absolute -right-16 top-1/4 -z-10 h-40 w-40 rounded-full bg-coral-300/25 blur-3xl" />
      <CalendarClock
        aria-hidden="true"
        className="absolute -right-9 top-14 -z-10 h-36 w-36 -rotate-12 text-white/[0.1]"
        strokeWidth={1.25}
      />

      <span className="flex items-start justify-between">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-ink-950/15 ring-1 ring-inset ring-white/30">
          <UserRound className="h-5 w-5" />
        </span>
        <Go className="bg-ink-950/15 text-white" />
      </span>

      <span className="mt-auto block pt-6">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${CHIP_TONE[chip.tone]}`}
        >
          {chip.tone === "live" && <span className="h-1.5 w-1.5 rounded-full bg-current motion-safe:animate-pulse-soft" />}
          {chip.check && <Check className="h-3 w-3" strokeWidth={2.6} />}
          {chip.label}
        </span>
        {/* Enilas runs wide: ~124px at this size, inside the ~133px a 375px screen gives this tile. */}
        <span className="mt-2.5 block font-display text-[1.45rem] leading-[1.05] [text-shadow:0_1px_2px_rgb(20_42_51/0.3)]">
          My schedule
        </span>

        {/* A bead per item of his own programme: filled once done, glowing while on, open while ahead. */}
        {hasBeads ? (
          <span aria-hidden="true" className="mt-3.5 block space-y-1">
            {days.map((d) => (
              <span
                key={d.day}
                className={`flex items-center gap-2 rounded-xl px-2 py-1 ${
                  d.state === "today" ? "bg-ink-950/20 ring-1 ring-inset ring-white/25" : ""
                }`}
              >
                <span
                  className={`w-12 shrink-0 whitespace-nowrap text-[10px] font-bold uppercase tracking-wider ${DAY_TEXT[d.state]}`}
                >
                  {d.weekday} {d.date}
                </span>
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                  {d.beads.length > 0 ? (
                    d.beads.map((b, i) => <span key={i} className={`shrink-0 rounded-full ${BEAD[b]}`} />)
                  ) : (
                    <span className="h-px w-3 rounded-full bg-white/40" />
                  )}
                </span>
              </span>
            ))}
          </span>
        ) : (
          <span className="mt-2 block text-xs leading-snug text-white/90">Puja, pravachans and travel, day by day</span>
        )}
      </span>
    </Tile>
  );
}

// ---------------------------------------------------------------------------
// Utaro: warm sand, with the santos staying there
// ---------------------------------------------------------------------------

function UtaroTile({ href, stay }: { href: string; stay: SantTilesData["stay"] }) {
  return (
    <Tile href={href} className={`${SMALL} border border-sand-300/80 bg-sand-100 text-ink-900 shadow-card`}>
      <span aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-br from-sand-50 via-sand-100 to-sand-200" />
      <House aria-hidden="true" className="absolute -bottom-5 -right-5 -z-10 h-28 w-28 text-coral-400/20" strokeWidth={1.5} />

      <span className="flex items-start justify-between">
        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-coral-600 to-ember-600 text-white shadow-[0_8px_16px_-8px_rgb(196_65_71/0.8)]">
          <House className="h-5 w-5" />
        </span>
        <Go className="bg-coral-700/10 text-coral-800" />
      </span>

      <span className="mt-auto block pt-3">
        <Label className="text-coral-800">Utaro</Label>
        {/* Three lines: "Mandir · Nishkulanand room" needs them at 375px (there is no address line). */}
        <span className="mt-0.5 line-clamp-3 break-words text-[15px] font-bold leading-tight">
          {stay ? stay.placeName : "Your utaro"}
        </span>
        {/* No address line: the Santo view doesn't show utaro addresses. */}
        {!stay ? (
          <span className="mt-1 block text-xs leading-snug text-ink-600">Details to follow</span>
        ) : stay.withLine ? (
          <span className="mt-1.5 flex items-start gap-1.5">
            {/* The santos staying with him: coral initials on ink discs. */}
            <span aria-hidden="true" className="flex shrink-0 -space-x-1.5">
              {stay.avatars.map((c) => (
                <span
                  key={c.id}
                  className="flex h-5 w-5 items-center justify-center rounded-full bg-ink-800 text-[10px] font-bold text-coral-200 ring-2 ring-sand-100"
                >
                  {c.initial}
                </span>
              ))}
            </span>
            <span className="line-clamp-3 min-w-0 break-words text-xs font-semibold leading-snug text-coral-800">
              {stay.withLine}
            </span>
          </span>
        ) : null}
      </span>
    </Tile>
  );
}

// ---------------------------------------------------------------------------
// Transport: an ink panel with a coral route and a coral Call button
// ---------------------------------------------------------------------------

function TransportTile({
  href,
  hotline,
  line,
}: {
  href: string;
  hotline: SantTilesData["transport"]["hotline"];
  line: string;
}) {
  return (
    <div className={`${TILE} ${SMALL} bg-ink-900 text-white shadow-[0_20px_40px_-22px_rgb(20_42_51/0.9)]`}>
      {/* Stretched link under the content: the text lets taps through, the Call button sits above it. */}
      <Link
        href={href}
        className="absolute inset-0 z-0 rounded-[inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-coral-300"
      >
        <span className="sr-only">Transport: {line}</span>
      </Link>

      <span aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-br from-ink-700 via-ink-900 to-ink-950" />
      <span aria-hidden="true" className="absolute -right-12 -top-14 -z-10 h-36 w-36 rounded-full bg-coral-400/20 blur-3xl" />
      {/* A dashed coral route drifting across the tile. */}
      <svg
        aria-hidden="true"
        viewBox="0 0 160 64"
        preserveAspectRatio="none"
        className="absolute inset-x-0 top-9 -z-10 h-16 w-full text-coral-300/30"
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

      <span aria-hidden="true" className="pointer-events-none relative flex items-start justify-between">
        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10 text-coral-300 ring-1 ring-inset ring-white/15">
          <CarFront className="h-5 w-5" />
        </span>
        <Go className="bg-white/10 text-white" />
      </span>

      <span aria-hidden="true" className="pointer-events-none relative mt-auto block pt-3">
        <span className="block text-[10px] font-bold uppercase tracking-[0.2em] text-coral-300">Transport</span>
        <span className="mt-0.5 block break-words text-[15px] font-bold leading-tight">{line}</span>
      </span>

      {hotline ? (
        // With a Telegram username on file, a square Telegram button sits beside Call (above the tile's link, like Call).
        <span className="relative z-10 mt-2.5 flex gap-2">
          <a
            href={hotline.telHref}
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl bg-coral-400 text-sm font-bold text-ink-950 shadow-[0_10px_20px_-10px_rgb(246_143_119/0.7)] transition hover:bg-coral-300 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral-300"
          >
            <Phone aria-hidden="true" className="h-4 w-4" strokeWidth={2.4} />
            Call
            <span className="sr-only">
              {" "}
              {hotline.label}, {hotline.phoneDisplay}
            </span>
          </a>
          {hotline.telegramHref && (
            <TelegramButton
              href={hotline.telegramHref}
              who={hotline.contactName ?? hotline.label}
              tone="dark"
              iconOnly
              className="h-11"
            />
          )}
        </span>
      ) : (
        <span className="pointer-events-none relative mt-2 inline-flex self-start rounded-full bg-coral-400 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ink-950">
          Number to follow
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Menu: light coral, a thali seen from above
// ---------------------------------------------------------------------------

/**
 * Centres of the thali's five katoris (radius 25 round the middle, a fifth of
 * a turn apart), written out rather than computed so the server and every
 * browser print identical coordinates.
 */
const KATORIS = [
  [50, 25],
  [73.78, 42.27],
  [64.69, 70.23],
  [35.31, 70.23],
  [26.22, 42.27],
] as const;

/** A thali from above: rim, a beaded inner ring, five katoris and the centre. */
function Thali({ className }: { className: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 100 100" fill="none" stroke="currentColor" className={className}>
      <circle cx="50" cy="50" r="47" strokeWidth="2.2" />
      {/* 60 beads round the inner ring. */}
      <circle cx="50" cy="50" r="41.5" strokeWidth="2" strokeLinecap="round" strokeDasharray="0 4.3459" />
      {KATORIS.map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <circle cx={x} cy={y} r="8.5" strokeWidth="1.6" />
          <circle cx={x} cy={y} r="5.25" strokeWidth="0.9" />
        </g>
      ))}
      <circle cx="50" cy="50" r="7" strokeWidth="1.4" />
    </svg>
  );
}

function MenuTile({ href, menu }: { href: string; menu: MenuTileView }) {
  const fresh = menu.state === "serving";
  return (
    <Tile
      href={href}
      className={`${SMALL} bg-coral-400 text-ink-900 shadow-[0_20px_40px_-22px_rgb(196_65_71/0.8)] ${fresh ? styles.sheen : ""}`}
    >
      {/* Brand coral, lighter at the top; ink text stays AA on every part of it. */}
      <span aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-br from-coral-300 via-coral-400 to-coral-400" />
      <span aria-hidden="true" className="absolute -left-12 -top-14 -z-10 h-40 w-40 rounded-full bg-white/35 blur-3xl" />
      <Thali className="absolute -right-12 top-7 -z-10 h-36 w-36 text-white/55" />

      <span className="flex items-start justify-between">
        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-coral-700 shadow-[0_8px_16px_-8px_rgb(196_65_71/0.7)]">
          <UtensilsCrossed className="h-5 w-5" />
        </span>
        <Go className="bg-ink-900/10 text-ink-900" />
      </span>

      <span className="mt-auto block pt-3">
        <Label className="text-ink-900">
          Menu
          {fresh && <LiveDot className="bg-ember-600" />}
          {menu.state === "served" && <Check aria-hidden="true" className="h-3 w-3" strokeWidth={2.6} />}
        </Label>
        <span className="mt-0.5 block break-words text-[15px] font-bold leading-tight text-ink-950">{menu.headline}</span>
        {(menu.when || menu.place) && (
          <span className="mt-1.5 block space-y-0.5 text-ink-900">
            {menu.when && (
              <Meta icon={Clock} className="text-ink-900/75">
                {menu.when}
              </Meta>
            )}
            {menu.place && (
              <Meta icon={MapPin} className="text-ink-900/75">
                {menu.place}
              </Meta>
            )}
          </span>
        )}
      </span>
    </Tile>
  );
}

// ---------------------------------------------------------------------------
// Breakouts: the teal gradient as a sabha, rows of seats round the arrow
// ---------------------------------------------------------------------------

/**
 * Rows of seats (dotted arcs) centred on the tile's arrow, like a sabha round
 * its stage. Sized so the centre lands on the arrow; styles.seats fades the
 * outer rows.
 */
function Seats({ className }: { className: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 176 176"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeDasharray="0 7"
      className={className}
    >
      {[34, 47, 60, 73, 86].map((r) => (
        <circle key={r} cx="88" cy="88" r={r} />
      ))}
    </svg>
  );
}

function BreakoutsTile({ href, breakouts }: { href: string; breakouts: BreakoutsTileView }) {
  const live = breakouts.state === "now";
  return (
    <Tile
      href={href}
      className={`${SMALL} text-white shadow-[0_20px_40px_-22px_rgb(47_79_96/0.9)] ${styles.sabha} ${
        live ? "ring-1 ring-inset ring-coral-300/50" : ""
      }`}
    >
      {/* 176px box centred on the arrow (32px in from the top and right). */}
      <Seats className={`absolute -right-14 -top-14 -z-10 h-44 w-44 text-white/45 ${styles.seats}`} />

      <span className="flex items-start justify-between">
        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-ink-950/15 text-white ring-1 ring-inset ring-white/25">
          <Users className="h-5 w-5" />
        </span>
        <Go className="bg-ink-950/20 text-white" />
      </span>

      <span className="mt-auto block pt-3">
        <Label className="text-jade-100">
          Breakouts
          {live && <LiveDot className="bg-coral-300 shadow-[0_0_8px_rgb(246_143_119/0.9)]" />}
          {breakouts.state === "done" && <Check aria-hidden="true" className="h-3 w-3" strokeWidth={2.6} />}
        </Label>
        {breakouts.state === "now" || breakouts.state === "next" ? (
          <>
            <span className="mt-0.5 line-clamp-2 break-words text-[15px] font-bold leading-tight">{breakouts.label}</span>
            <span className="mt-1.5 block space-y-0.5 text-white/90">
              <Meta icon={Clock} className="text-coral-200">
                {breakouts.when}
              </Meta>
              <Meta icon={Users} className="text-coral-200">
                {breakouts.sessions}
              </Meta>
            </span>
          </>
        ) : breakouts.state === "done" ? (
          <span className="mt-0.5 block text-[15px] font-bold leading-tight">All breakout blocks are over</span>
        ) : (
          <>
            <span className="mt-0.5 block text-[15px] font-bold leading-tight">Breakout sessions coming soon</span>
            <span className="mt-1 block text-xs leading-snug text-white/85">Details to follow</span>
          </>
        )}
      </span>
    </Tile>
  );
}

// ---------------------------------------------------------------------------
// General schedule: a white card with a week of the Santo days
// ---------------------------------------------------------------------------

/** Each day chip's surface and its secondary text (weekday), all AA on their own surface. */
const DAY_TONE: Record<StripDay["state"], { chip: string; sub: string }> = {
  today: { chip: "bg-ink-900 text-white shadow-[0_8px_18px_-8px_rgb(20_42_51/0.8)]", sub: "text-white/80" },
  past: { chip: "bg-sand-100 text-ink-500", sub: "text-ink-500" },
  future: { chip: "bg-sand-50 text-ink-900 ring-1 ring-inset ring-ink-800/10", sub: "text-ink-500" },
};

function GeneralTile({ href, subtitle, days }: { href: string; subtitle: string; days: StripDay[] }) {
  return (
    <Tile href={href} className="border border-white/80 bg-white/90 text-ink-900 shadow-card">
      <span aria-hidden="true" className="pattern-mandala absolute inset-0 -z-10 opacity-60" />
      <span aria-hidden="true" className="absolute -right-12 -top-16 -z-10 h-44 w-44 rounded-full bg-coral-300/25 blur-3xl" />

      <span className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-ink-900 text-coral-300 shadow-[0_8px_16px_-8px_rgb(20_42_51/0.7)]">
          <CalendarDays className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-[1.4rem] leading-tight">General schedule</span>
          <span className="mt-0.5 block truncate text-xs font-medium text-ink-500">{subtitle}</span>
        </span>
        <Go className="bg-ink-900/[0.06] text-ink-900" />
      </span>

      {/* A week of the Santo days (tiles.ts picks which); today is ink with a coral bar for how much
          of its programme is done. Seven columns fit the tile on a 375px screen. */}
      <span
        aria-hidden="true"
        className="mt-4 grid gap-1"
        style={{ gridTemplateColumns: `repeat(${Math.min(days.length, STRIP_DAYS)}, minmax(0, 1fr))` }}
      >
        {days.map((d) => {
          const tone = DAY_TONE[d.state];
          return (
            <span
              key={d.day}
              className={`relative flex flex-col items-center overflow-hidden rounded-xl px-0.5 pb-2.5 pt-1.5 ${tone.chip}`}
            >
              <span className={`text-[10px] font-semibold uppercase tracking-wide ${tone.sub}`}>{d.weekday}</span>
              <span className="text-lg font-bold leading-tight tabular-nums">{d.date}</span>
              {/* Done: a small check where today's progress bar sits. */}
              {d.state === "past" && (
                <Check className="absolute bottom-0.5 left-1/2 h-2.5 w-2.5 -translate-x-1/2" strokeWidth={3} />
              )}
              {d.state === "today" && (
                <span className="absolute inset-x-2.5 bottom-1 h-[3px] overflow-hidden rounded-full bg-white/15">
                  <span
                    className="block h-full rounded-full bg-gradient-to-r from-coral-700 to-coral-400"
                    style={{ width: `${Math.round(d.progress * 100)}%` }}
                  />
                </span>
              )}
            </span>
          );
        })}
      </span>
    </Tile>
  );
}
