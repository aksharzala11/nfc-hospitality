import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, BadgeCheck, LogOut, Mail, MapPin, Phone, Users, type LucideIcon } from "lucide-react";
import { requireSant } from "@/lib/auth";
import { formatPhone, santName } from "@/lib/sant";
import { WallpaperCard } from "@/components/brand/WallpaperCard";
import { santInitial } from "@/components/sant/shell/identity";
import { fitNameStyle } from "@/components/sant/pages/fitName";

export const metadata: Metadata = { title: "Your profile" };
export const dynamic = "force-dynamic";

/**
 * Pujya Santo profile: his name on an ink card (coral "Jay Swāminārāyan" over
 * the name in Enilas, as in the brand's coral-on-ink type), the details on
 * file, the official Sāchu wallpapers, and sign-out.
 */
export default async function SantProfilePage() {
  const sant = await requireSant();
  const name = santName(sant);

  // Email and phone only when on file; shown as plain text, not links.
  const rows: { icon: LucideIcon; label: string; value: string }[] = [
    { icon: BadgeCheck, label: "BAPS ID", value: sant.bapsId },
    { icon: Users, label: "Seva", value: sant.seva },
    { icon: MapPin, label: "Region", value: sant.region ?? "—" },
  ];
  if (sant.email) rows.push({ icon: Mail, label: "Email", value: sant.email });
  if (sant.phone) rows.push({ icon: Phone, label: "Phone", value: formatPhone(sant.phone) });

  // Where sign-in codes go, when that detail is on file.
  const codesTo = sant.preferredChannel === "SMS" ? (sant.phone ? "phone number" : null) : sant.email ? "email" : null;

  return (
    <div className="stagger">
      <Link
        href="/sant"
        className="-ml-1 mb-3 inline-flex min-h-11 items-center gap-1.5 rounded-full px-1 text-sm font-semibold text-ink-600 transition hover:text-ink-900 focus-visible:outline-2 focus-visible:outline-coral-700"
      >
        <ArrowLeft className="h-4 w-4" />
        Home
      </Link>

      <section className="relative isolate mb-4 flex items-center gap-4 overflow-hidden rounded-3xl bg-ink-900 p-5 text-white shadow-card-lg ring-1 ring-inset ring-white/10">
        <span aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-br from-ink-700 via-ink-900 to-ink-950" />
        <span aria-hidden="true" className="absolute -right-14 -top-16 -z-10 h-44 w-44 rounded-full bg-coral-700/40 blur-3xl" />
        <span className="font-display flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-coral-600 to-ember-700 text-[1.9rem] text-white shadow-glow ring-1 ring-inset ring-white/20">
          {santInitial(sant)}
        </span>
        {/* flex-1 gives the column the row's width (not its content's), so it can be the
            container the name fits to: long names step down from 1.75rem, never break mid-word. */}
        <div className="@container min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-coral-300">Jay Swāminārāyan</p>
          <h1 className="mt-0.5 break-words font-display text-[1.75rem] leading-tight" style={fitNameStyle(name, 1.75)}>
            {name}
          </h1>
        </div>
      </section>

      <section className="card divide-y divide-ink-800/[0.07] overflow-hidden">
        {rows.map(({ icon: Icon, label, value }) => (
          <div key={label} className="flex items-center gap-3 px-4 py-3.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-coral-700/10 text-coral-700">
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-ink-500">{label}</p>
              <p className="truncate text-sm font-medium text-ink-900">{value}</p>
            </div>
          </div>
        ))}
      </section>

      {codesTo && <p className="mt-4 px-1 text-xs text-ink-600">Sign-in codes are sent to the {codesTo} above.</p>}

      <WallpaperCard className="mt-6" />

      <form action="/api/auth/logout" method="post" className="mt-6">
        <button
          type="submit"
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-coral-700/25 bg-white/80 px-5 py-3 text-sm font-semibold text-ember-700 transition hover:bg-coral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral-700"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </form>
    </div>
  );
}
