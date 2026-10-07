"use client";

import { BedDouble, CalendarDays, CarFront, Home, MapPinned, UserRound, Users, UtensilsCrossed } from "lucide-react";
import { BottomNav, type MoreItem, type NavItem } from "@/components/BottomNav";

/**
 * Tabs of the Pujya Santo view. Defined here, in a client module, because icon
 * components can't be passed as props from the server layout.
 * Home is `exact` so it doesn't light up on every /sant/* page.
 *
 * Four tabs plus More (five is the most that fit at 375px). The tabs are what a sant
 * opens again and again through the day: his schedule, the Santo menu before each meal
 * and Transport before each ride (with the hotlines to call). The utaro is looked up on
 * arrival, breakouts are also on the home tile and the schedule's Breakout rows, the venue
 * map opens from the breakout rooms too, and the profile is in the header chip, so those
 * four live in More.
 */
const SANT_NAV: NavItem[] = [
  { href: "/sant", label: "Home", icon: Home, exact: true },
  { href: "/sant/schedule", label: "Schedule", icon: CalendarDays },
  { href: "/sant/menu", label: "Menu", icon: UtensilsCrossed },
  { href: "/sant/transport", label: "Transport", icon: CarFront },
];

/** Behind the More tab; icon tiles echo the Santo home tiles (utaro bhagwa, sabha teal). */
const SANT_MORE: MoreItem[] = [
  {
    href: "/sant/stay",
    label: "Accommodation",
    description: "Your utaro and companions",
    icon: BedDouble,
    tint: "bg-gradient-to-br from-coral-600 to-ember-600 text-white",
  },
  {
    href: "/sant/breakouts",
    label: "Breakout Sessions",
    description: "Sessions you can join",
    icon: Users,
    tint: "bg-gradient-to-br from-jade-500 to-ink-800 text-white",
  },
  {
    href: "/sant/map",
    label: "Venue map",
    description: "Find any room & get directions",
    icon: MapPinned,
    // ink-800 on sand-200: 6.6:1 for the icon.
    tint: "bg-sand-200 text-ink-800",
  },
  {
    href: "/sant/profile",
    label: "Profile & sign out",
    description: "Your BAPS ID, seva, email & phone",
    icon: UserRound,
    tint: "bg-ink-100 text-ink-800",
    account: true,
  },
];

/** Bottom navigation for /sant. Uses useSearchParams, so render it inside <Suspense>. */
export function SantBottomNav() {
  return <BottomNav items={SANT_NAV} more={SANT_MORE} tone="bhagwa" />;
}
