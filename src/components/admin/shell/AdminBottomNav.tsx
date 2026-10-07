"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import { CalendarClock, LayoutDashboard, Luggage, Megaphone, Users } from "lucide-react";
import { BottomNav, type NavItem } from "@/components/BottomNav";
import { isCurrentPath } from "@/components/MoreSheet";
import { SEVA_PARAM } from "@/lib/admin/sevaFilter";

/** The Logistics tab's boards: airport transport (where the tab leads) and hotel rooming. */
const TRANSPORT_HREF = "/admin/transport";
const ROOMING_HREF = "/admin/rooming";

/**
 * Tabs of the admin console. Defined here, in a client module, because icon
 * components can't be passed as props from the server layout.
 * Overview is `exact` so it doesn't light up on every /admin/* page.
 *
 * No More tab (unlike the delegate and Santo bars): these five cover every console page,
 * and the header already carries the rest (the profile chip and "Delegate view").
 * Logistics holds the airport transport board and the hotel rooming board, with a
 * Transport | Rooming switch at the top of each (LogisticsSwitch); the luggage icon
 * covers both (the bus stays with airport rides inside it).
 */
const ADMIN_NAV: NavItem[] = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/admin/delegates", label: "Delegates", icon: Users },
  { href: "/admin/announcements", label: "Announce", icon: Megaphone },
  { href: "/admin/schedule", label: "Schedule", icon: CalendarClock },
  { href: TRANSPORT_HREF, label: "Logistics", icon: Luggage },
];

/** Query params the tabs keep besides ?now=: the console-wide seva filter (see SevaFilter). */
const CARRY = [SEVA_PARAM] as const;

/**
 * Bottom navigation for /admin. Uses useSearchParams, so render it inside <Suspense>.
 * Switching tabs keeps the seva filter (?seva=...), like the demo ?now=.
 *
 * BottomNav lights a tab on its own path (and sub-paths), so on the rooming board the
 * Logistics tab points at /admin/rooming: it lights up there too, and tapping it stays
 * on the board you're on. Everywhere else it leads to the transport board.
 */
export function AdminBottomNav() {
  const pathname = usePathname() ?? "";
  const onRooming = isCurrentPath(pathname, ROOMING_HREF);
  const items = useMemo(
    () => (onRooming ? ADMIN_NAV.map((item) => (item.href === TRANSPORT_HREF ? { ...item, href: ROOMING_HREF } : item)) : ADMIN_NAV),
    [onRooming],
  );
  return <BottomNav items={items} tone="console" carry={CARRY} />;
}
