"use client";

import { useId, useState, type ComponentType } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { BedDouble, Bus, CalendarDays, Feather, Home, LayoutGrid, MapIcon, Shirt, UserRound, UtensilsCrossed, Users } from "lucide-react";
import { MandirMark } from "@/components/Logo";
import { PRASANG_TITLE } from "@/lib/prasang";
import { MoreSheet, isCurrentPath, type MoreItem } from "@/components/MoreSheet";

/** A Lucide icon, or a Phosphor wrapper from src/components/icons/. */
export type NavIcon = ComponentType<{ className?: string; strokeWidth?: number }>;

export type NavItem = {
  /** Plain path, without a query string. */
  href: string;
  label: string;
  icon: NavIcon;
  /** Active on `href` only, not its sub-paths: for a home tab whose path prefixes the others (/sant). */
  exact?: boolean;
};

export type { MoreItem };

/**
 * Accent of the active tab: the brand's coral gradient for the delegate hub, its deep
 * coral-into-ember end ("bhagwa") for the Pujya Santo view, ink for the admin console.
 */
export type NavTone = "coral" | "bhagwa" | "console";

/**
 * `pill` is behind a white icon (non-text: 3:1 against the pill's middle), `text` is the
 * active label on the sand glass (AA for 11px text), `glow` the pill's tinted shadow.
 */
const CORAL = { text: "text-coral-800", pill: "from-coral-400 to-coral-700", glow: "shadow-glow" };
const TONES: Record<NavTone, { text: string; pill: string; glow: string }> = {
  coral: CORAL,
  bhagwa: {
    text: "text-ember-700",
    pill: "from-coral-600 to-ember-700",
    glow: "shadow-[0_10px_22px_-8px_rgb(196_65_71/0.6)]",
  },
  console: {
    text: "text-ink-900",
    pill: "from-ink-700 to-ink-950",
    glow: "shadow-[0_10px_22px_-8px_rgb(20_42_51/0.6)]",
  },
};

/** A volunteer account's tabs (src/lib/volunteer.ts): the programme, the menu, the map and History; no More. */
const VOLUNTEER_ITEMS: NavItem[] = [
  { href: "/schedule", label: "Schedule", icon: CalendarDays },
  { href: "/menu", label: "Menu", icon: UtensilsCrossed },
  { href: "/map", label: "Map", icon: MapIcon },
  { href: "/history", label: "History", icon: MandirMark },
];

/** The delegate hub's tabs (the default). */
const DELEGATE_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/schedule", label: "Schedule", icon: CalendarDays },
  { href: "/menu", label: "Menu", icon: UtensilsCrossed },
  { href: "/breakouts", label: "Breakouts", icon: Users },
];

/**
 * Everything else in the delegate hub, behind the More tab. Icon tiles echo the home
 * tiles: teal for Transportation, pale jade for Your stay, pale ink for the Venue map, sand for the Dress code,
 * coral for the Prasang form, the Edison mandir mark on ink for History, and the delegate avatar's coral for the profile.
 */
const DELEGATE_MORE: MoreItem[] = [
  {
    href: "/transportation",
    label: "Transportation",
    description: "Your arrival & departure",
    icon: Bus,
    tint: "bg-gradient-to-br from-jade-500 to-ink-800 text-white",
  },
  {
    href: "/stay",
    label: "Your stay",
    description: "Hotel, room group & roommates",
    icon: BedDouble,
    // jade-700 on jade-100: 5.7:1 for the icon.
    tint: "bg-jade-100 text-jade-700",
  },
  {
    href: "/map",
    label: "Venue map",
    description: "Find any room & get directions",
    icon: MapIcon,
    // ink-800 on ink-100: 7.4:1 for the icon.
    tint: "bg-ink-100 text-ink-800",
  },
  {
    href: "/dress-code",
    label: "Dress code",
    description: "What to wear each day",
    icon: Shirt,
    // ink-800 on sand-200: 6.6:1 for the icon.
    tint: "bg-sand-200 text-ink-800",
  },
  {
    href: "/prasang",
    label: PRASANG_TITLE,
    description: "Share your stories and prasangs",
    icon: Feather,
    tint: "bg-coral-100 text-coral-800",
  },
  {
    href: "/history",
    label: "Edison Mandir History",
    description: "The story of our mandir",
    icon: MandirMark,
    tint: "bg-gradient-to-br from-ink-800 to-ink-950 text-coral-300",
  },
  {
    href: "/profile",
    label: "Profile & sign out",
    description: "Your BAPS ID, seva, email & phone",
    icon: UserRound,
    tint: "bg-gradient-to-br from-coral-300 to-coral-500 text-ink-950",
    account: true,
  },
];

/** The shared look of a tab (link or the More button); `active` lights it in the view's accent. */
function tabClass(active: boolean, accentText: string) {
  return `group flex w-full cursor-pointer flex-col items-center gap-0.5 whitespace-nowrap rounded-2xl py-1.5 text-[11px] font-semibold transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink-800 ${
    active ? accentText : "text-ink-700 hover:text-ink-900"
  }`;
}

function TabIcon({ icon: Icon, active, accent }: { icon: NavIcon; active: boolean; accent: (typeof TONES)[NavTone] }) {
  return (
    <span
      className={`flex h-8 w-full max-w-14 items-center justify-center rounded-full transition-all duration-300 motion-reduce:transition-none ${
        active ? `bg-gradient-to-br ${accent.pill} text-white ${accent.glow}` : "group-hover:bg-white/70"
      }`}
    >
      <Icon className="h-[18px] w-[18px]" strokeWidth={active ? 2.4 : 2} />
    </span>
  );
}

/**
 * The query every tab link ends with: the demo "now" override, plus the values of any
 * `carry` params in the current URL (repeated params keep every value), e.g.
 * "?now=2026-10-09T13%3A45&seva=BM%20RA&seva=SA". Empty when there is nothing to keep.
 */
function carriedQuery(params: URLSearchParams, carry: readonly string[]): string {
  const now = params.get("now");
  const parts = now ? [`now=${encodeURIComponent(now)}`] : [];
  for (const key of carry) {
    if (key === "now") continue;
    for (const value of params.getAll(key)) parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  }
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

/**
 * Floating bottom navigation on sand glass. With no props it shows the delegate tabs
 * plus a fifth "More" tab that opens a sheet (src/components/MoreSheet.tsx) with every
 * other hub page, so the bar reaches the whole view. Other views pass their own `items`
 * (and optionally `more`), defined in a client module because icon components can't be
 * passed as props from a server component (see src/components/sant/shell/SantBottomNav.tsx).
 * The More tab lights up on any of its pages. ScheduleView measures
 * `nav[aria-label="Primary"] ul`, so keep that markup.
 *
 * Tabs keep the demo `?now=` override. `carry` names further query params the tabs keep
 * too (opt-in: the admin console carries its `seva` filter; the delegate and Santo bars
 * pass nothing and carry only `?now=`).
 *
 * `volunteer`: a volunteer account's bar, Schedule, Menu, Map and History only (src/lib/volunteer.ts).
 *
 * `solidOn`: path prefixes where the bar stands on an opaque sand band the full width of the
 * screen instead of floating as glass over the page (the History page: its photographs are
 * sacred images, and nothing may blur or tint one as it scrolls past; under the band a
 * photograph simply ends at a clean edge, as it does under the year strip).
 */
export function BottomNav(props: {
  items?: NavItem[];
  more?: MoreItem[];
  tone?: NavTone;
  carry?: readonly string[];
  solidOn?: readonly string[];
  volunteer?: boolean;
}) {
  const items = props.items ?? (props.volunteer ? VOLUNTEER_ITEMS : DELEGATE_ITEMS);
  const more = props.items ? props.more : props.volunteer ? undefined : DELEGATE_MORE;
  const tone = props.tone ?? "coral";
  const pathname = usePathname();
  const params = useSearchParams();
  // Keep the demo "now" override (and any `carry` params) while navigating between pages.
  const suffix = carriedQuery(params, props.carry ?? []);
  const accent = TONES[tone];

  // The sheet belongs to the page it was opened on, so any navigation (a link in it) closes
  // it; reset during render so it can't reopen on return. Back is handled in the sheet: it
  // pushes a same-URL history entry, so Back closes it without leaving the page.
  const [openOn, setOpenOn] = useState<string | null>(null);
  if (openOn !== null && openOn !== pathname) setOpenOn(null);
  const sheetOpen = openOn === pathname;
  const sheetId = useId();
  const moreActive = more?.some((m) => isCurrentPath(pathname, m.href)) ?? false;
  const solid = props.solidOn?.some((p) => pathname === p || pathname?.startsWith(`${p}/`)) ?? false;

  return (
    <nav
      aria-label="Primary"
      data-solid={solid ? "" : undefined}
      className={`fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] ${
        // Opaque, and it takes its own taps: nothing under the band is seen, so nothing under it is tapped.
        solid ? "border-t border-sand-300 bg-sand-100 pt-2" : "pointer-events-none"
      }`}
    >
      <ul className="glass-nav pointer-events-auto flex w-full max-w-md items-stretch justify-around rounded-[1.75rem] px-1.5 py-1.5">
        {items.map(({ href, label, icon, exact }) => {
          const active = isCurrentPath(pathname, href, exact);
          return (
            <li key={href} className="flex flex-1">
              <Link href={`${href}${suffix}`} aria-current={active ? "page" : undefined} className={tabClass(active, accent.text)}>
                <TabIcon icon={icon} active={active} accent={accent} />
                {label}
              </Link>
            </li>
          );
        })}
        {more && more.length > 0 && (
          <li className="flex flex-1">
            <button
              type="button"
              onClick={() => setOpenOn(pathname)}
              aria-haspopup="dialog"
              aria-expanded={sheetOpen}
              aria-controls={sheetOpen ? sheetId : undefined}
              // "true", not "page": the tab isn't a page, it holds the current one.
              aria-current={moreActive ? "true" : undefined}
              className={tabClass(moreActive, accent.text)}
            >
              <TabIcon icon={LayoutGrid} active={moreActive} accent={accent} />
              More
            </button>
          </li>
        )}
      </ul>
      {more && more.length > 0 && (
        <MoreSheet
          open={sheetOpen}
          onClose={() => setOpenOn(null)}
          id={sheetId}
          items={more}
          pathname={pathname}
          suffix={suffix}
          tone={tone}
        />
      )}
    </nav>
  );
}
