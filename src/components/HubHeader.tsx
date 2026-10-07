import Link from "next/link";
import { ChevronRight, Eye, FlaskConical, Shield, type LucideIcon } from "lucide-react";
import type { User } from "@prisma/client";
import type { MirrorOf } from "@/lib/auth";
import type { NotificationView } from "@/lib/notifications";
import { SachuMark } from "@/components/brand/Sachu";
import { NotificationBell } from "@/components/NotificationBell";
import { greetingName, initials as initialsOf } from "@/lib/users";

/**
 * Which view the header belongs to; it sets the avatar. "coral" for the delegate hub, a
 * deeper coral-into-ember "bhagwa" for the Pujya Santo view, ink for the admin console.
 */
export type HeaderTone = "coral" | "bhagwa" | "console";

/**
 * Avatar discs. Each passes AA for its initials: white on coral-400 would not, so the
 * delegate disc runs the light half of the coral gradient with ink initials, while the
 * Santo disc runs the deep half (coral-700 into ember) with a white Enilas initial.
 */
const CORAL_AVATAR = "from-coral-300 to-coral-500 text-[11px] font-extrabold text-ink-950";
const AVATAR: Record<HeaderTone, string> = {
  coral: CORAL_AVATAR,
  bhagwa: "from-coral-700 to-ember-700 font-display text-[17px] leading-none text-white",
  console: "from-ink-700 to-ink-950 text-[11px] font-extrabold text-white ring-2 ring-coral-400/80",
};

/** Invisible hit area around a 36px control so it reaches 44px. */
const HIT = "after:absolute after:-inset-1 after:content-['']";

/**
 * App header on sand: profile chip on the left; the Sāchu mark (home) and the
 * notification bell on the right. With only `guest` and `notifications` it renders
 * the delegate header; the optional props adapt it for the Pujya Santo view
 * (src/app/sant/layout.tsx) and the admin console (src/app/admin/layout.tsx), and add
 * the switch between the delegate hub and the console for admins.
 *
 * It sits in flow at the top of the app shell, above the one scroll container
 * (<AppScroll>, see `.app-shell` in globals.css), so it never moves and nothing scrolls
 * under or above it: page content is clipped at its bottom edge, which keeps it out
 * from behind Telegram's floating in-app browser controls.
 */
export function HubHeader({
  guest,
  notifications,
  displayName,
  avatarText,
  profileHref = "/profile",
  homeHref = "/dashboard",
  tone = "coral",
  wide = false,
  adminHref,
  delegateHref,
  mirrorOf,
}: {
  guest: Pick<User, "name" | "displayName" | "bapsId">;
  /** Items for the bell. Leave out to render the header without a bell. */
  notifications?: { items: NotificationView[]; unread: number };
  /** Name in the profile chip. Default: greetingName(guest). */
  displayName?: string;
  /** Text in the avatar circle. Default: the guest's initials. */
  avatarText?: string;
  profileHref?: string;
  homeHref?: string;
  tone?: HeaderTone;
  /** Widen the inner row to the admin console's container (md:max-w-3xl lg:max-w-5xl). */
  wide?: boolean;
  /** Admins in the delegate hub: a compact "Admin" button to the console. */
  adminHref?: string;
  /** The admin console: a "Delegate view" button to the delegate hub. */
  delegateHref?: string;
  /**
   * A mirror test account (requireGuest() in src/lib/auth.ts): the real delegate (or, in the
   * Santo view, the sant) whose data the pages are showing, named in a band under the header
   * row on every page.
   */
  mirrorOf?: MirrorOf | null;
}) {
  const initials = avatarText ?? initialsOf(guest);
  // With a switch button in the row, phones give its room to the name instead of the mark.
  const hasSwitch = Boolean(adminHref || delegateHref);

  return (
    // z-30 keeps the bell's panel above the page content it drops over. Nearly opaque sand:
    // only the view's canvas is behind it now, never scrolling content, so no blur is needed.
    <header className="relative z-30 shrink-0 border-b border-ink-900/[0.07] bg-sand-50/95">
      <div
        className={`mx-auto flex max-w-lg items-center justify-between gap-3 px-4 py-2.5${wide ? " md:max-w-3xl lg:max-w-5xl" : ""}`}
      >
        {/* Sign out lives on the profile page. A long name truncates rather than widening the row. */}
        <Link
          href={profileHref}
          aria-label="Your profile"
          className={`group relative flex min-w-0 items-center gap-2.5 rounded-full border border-white bg-white/85 py-1 pl-1 pr-2.5 shadow-card transition hover:bg-white active:scale-[0.98] ${HIT}`}
        >
          <span
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${AVATAR[tone]}`}
          >
            {initials}
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-sm font-semibold text-ink-900">{displayName ?? greetingName(guest)}</span>
            <span className="block truncate text-[10px] font-semibold uppercase tracking-caps text-ink-500">
              {guest.bapsId}
            </span>
          </span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-400 transition group-hover:text-ink-700" />
        </Link>

        <div className="flex shrink-0 items-center gap-2">
          {adminHref && <SwitchButton href={adminHref} icon={Shield} label="Admin" tone="console" />}
          {delegateHref && <SwitchButton href={delegateHref} icon={Eye} label="Delegate view" tone="coral" />}
          {/* The event mark, full colour on the sand glass; it takes you home. */}
          <Link
            href={homeHref}
            aria-label="Home"
            className={`relative h-9 w-9 items-center justify-center transition active:scale-95 ${HIT} ${
              hasSwitch ? "hidden sm:flex" : "flex"
            }`}
          >
            <SachuMark variant="full" priority className="h-8" />
          </Link>
          {notifications && <NotificationBell items={notifications.items} unread={notifications.unread} />}
        </div>
      </div>
      {mirrorOf && <MirrorBand mirrorOf={mirrorOf} />}
    </header>
  );
}

/**
 * Full-width ink band under the header row while a mirror test account is signed in, so it
 * is never mistaken for the real person's own sign-in. Part of the header, so it stays in
 * view on every hub page. Ink is the brand's info tone: white (8.8:1) and coral-200 (6:1)
 * on ink-800 both pass AA at this size. The name wraps rather than truncates. A delegate is
 * named with their User Id, a sant (santName(), the Santo view's) with his BAPS ID.
 */
function MirrorBand({ mirrorOf }: { mirrorOf: MirrorOf }) {
  const id = mirrorOf.kind === "SANT" ? `BAPS ID ${mirrorOf.bapsId}` : `User Id ${mirrorOf.registrationId}`;
  return (
    <div className="bg-ink-800 text-white">
      <p className="mx-auto flex max-w-lg items-start gap-2 px-4 py-1.5 text-xs leading-snug">
        <FlaskConical aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0 text-coral-200" />
        <span className="min-w-0 break-words">
          <span className="font-bold text-coral-200">Test account</span>
          <span className="text-white/80"> · showing data for </span>
          <span className="font-semibold">{mirrorOf.name}</span>
          <span className="text-white/80"> ({id})</span>
        </span>
      </p>
    </div>
  );
}

/**
 * Compact pill that switches an admin between the delegate hub and the
 * console. Its icon disc previews where it goes: the console's ink avatar or
 * the hub's coral one. As tall as the bell (36px) with an invisible 44px hit area.
 */
function SwitchButton({
  href,
  icon: Icon,
  label,
  tone,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  tone: "console" | "coral";
}) {
  return (
    <Link
      href={href}
      title={tone === "console" ? "Open the admin console" : "See the app as delegates do"}
      className={`relative flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-white bg-white/85 py-1 pl-1 pr-3 text-xs font-semibold text-ink-900 shadow-card transition hover:bg-white active:scale-[0.98] ${HIT}`}
    >
      <span
        className={`flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br ${
          tone === "console" ? "from-ink-700 to-ink-950 text-white" : "from-coral-300 to-coral-500 text-ink-950"
        }`}
      >
        <Icon className="h-3.5 w-3.5" strokeWidth={2.4} />
      </span>
      {label}
    </Link>
  );
}
