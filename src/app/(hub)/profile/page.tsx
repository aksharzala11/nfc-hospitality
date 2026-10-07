import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, BadgeCheck, Landmark, LogOut, Mail, MapPin, Users } from "lucide-react";
import { homePathFor, requireGuest } from "@/lib/auth";
import { isVolunteer } from "@/lib/volunteer";
import { initials as initialsOf } from "@/lib/users";
import { sevaLabel } from "@/lib/teams";
import { APP_TITLE } from "@/lib/branding";
import { SachuLogo } from "@/components/brand/Sachu";
import { WallpaperCard } from "@/components/brand/WallpaperCard";

export const metadata: Metadata = { title: "Your profile" };
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const guest = await requireGuest();
  const rows = [
    { icon: BadgeCheck, label: "BAPS ID", value: guest.bapsId },
    { icon: Users, label: "Seva", value: sevaLabel(guest.seva) },
    { icon: Mail, label: "Email", value: guest.email ?? "—" },
    // Their center (from the master list) where the phone number used to be (user, 2026-10-01).
    { icon: Landmark, label: "Center", value: guest.center?.trim() || "—" },
    { icon: MapPin, label: "Region", value: guest.region ?? "—" },
  ];

  return (
    <div className="stagger">
      {/* Admins reach this page from the console header, so "back" returns them there. */}
      <Link
        href={homePathFor(guest)}
        className="-ml-1 mb-2 inline-flex h-11 items-center gap-1.5 px-1 text-sm font-semibold text-ink-500 hover:text-ink-900"
      >
        <ArrowLeft className="h-4 w-4" />
        {guest.role === "ADMIN" ? "Admin console" : isVolunteer(guest) ? "Schedule" : "Home"}
      </Link>

      {/* Identity: the brand's teal gradient, deepened to ink behind the text. */}
      <section className="relative isolate mb-4 overflow-hidden rounded-3xl bg-gradient-to-tl from-jade-500 to-ink-800 to-70% p-5 text-white shadow-card-lg">
        <span aria-hidden="true" className="absolute -right-10 -top-14 -z-10 h-36 w-36 rounded-full bg-coral-400/25 blur-2xl" />
        <div className="flex items-center gap-4">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-coral-400 text-xl font-extrabold tracking-wide text-ink-950 shadow-glow">
            {initialsOf(guest)}
          </span>
          <div className="min-w-0">
            {/* coral-100: the kicker's right end runs toward the gradient's lighter jade end and the glow. */}
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-coral-100">Jay Swāminārāyan</p>
            <h1 className="font-display mt-1 line-clamp-2 break-words text-[1.75rem] leading-[1.15]">{guest.name}</h1>
          </div>
        </div>
      </section>

      <section className="card divide-y divide-sand-200 overflow-hidden">
        {rows.map(({ icon: Icon, label, value }) => (
          <div key={label} className="flex items-center gap-3 px-4 py-3.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-coral-100 text-coral-800">
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-ink-500">{label}</p>
              <p className="truncate text-sm font-semibold text-ink-900">{value}</p>
            </div>
          </div>
        ))}
      </section>

      <p className="mt-4 px-1 text-xs leading-relaxed text-ink-500">
        {guest.preferredChannel === "SMS"
          ? "Sign-in codes are sent by text to the phone number we have on file."
          : "Sign-in codes are sent to the email above."}
      </p>

      <WallpaperCard className="mt-6" />

      <form action="/api/auth/logout" method="post" className="mt-6">
        <button
          type="submit"
          className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-ember-500/25 bg-white/80 px-5 text-sm font-bold text-ember-700 transition hover:bg-ember-500/5 active:scale-[0.98]"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </form>

      {/* Brand sign-off: the Sāchu lock-up (full colour, on the sand canvas). */}
      <footer className="mt-10 flex flex-col items-center gap-3 pb-2 text-center">
        <SachuLogo variant="full" className="w-40" />
        <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-ink-500">{APP_TITLE}</p>
      </footer>
    </div>
  );
}
