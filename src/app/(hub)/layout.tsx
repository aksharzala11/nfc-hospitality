import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireGuest } from "@/lib/auth";
import { HubHeader } from "@/components/HubHeader";
import { BottomNav } from "@/components/BottomNav";
import { AutoRefresh } from "@/components/AutoRefresh";
import { ScrollTopButton } from "@/components/ScrollTopButton";
import { AppScroll } from "@/components/AppScroll";
import { LoginSplash } from "@/components/brand/LoginSplash";
import { getNotificationsFor } from "@/lib/notifications";
import { isVolunteer, VOLUNTEER_HOME } from "@/lib/volunteer";

export default async function HubLayout({ children }: { children: React.ReactNode }) {
  const guest = await requireGuest();
  // Pujya Santos have their own view; the delegate hub stays delegate-only.
  if (guest.role === "SANT") redirect("/sant");
  // A mirror test account is targeted as the delegate it mirrors (their track, seva and
  // region), with its own read state.
  const notifications = await getNotificationsFor(guest, new Date());
  // A volunteer account sees the schedule, the menu, the map and History only (requireGuest() keeps them there).
  const volunteer = isVolunteer(guest);

  return (
    // The app shell (globals.css): the header sits at the top and only <AppScroll> scrolls, so
    // nothing can scroll up past the header (into Telegram's floating browser controls).
    <div className="app-shell">
      {/* First load after sign-in only: the Sāchu wallpaper blurs away to reveal this screen.
          First in the markup (it's fixed, so order changes nothing on screen) so it's parsed
          before any of the page can paint. */}
      <LoginSplash />
      <HubHeader
        guest={guest}
        notifications={notifications}
        // Organisers can switch to the admin console from anywhere in the hub.
        adminHref={guest.role === "ADMIN" ? "/admin" : undefined}
        homeHref={volunteer ? VOLUNTEER_HOME : undefined}
        // A mirror test account: whose data the hub is showing (requireGuest()).
        mirrorOf={guest.mirrorOf}
      />
      <AppScroll>
        {/* Bottom padding clears the floating nav and back-to-top button, including the safe
            area they sit above, so the page's end (the BAPS footer) is never under them. */}
        <main className="mx-auto w-full max-w-lg px-4 pb-[calc(7rem_+_env(safe-area-inset-bottom))] pt-5">
          {children}
        </main>
      </AppScroll>
      <Suspense fallback={null}>
        {/* On the History page the bar stands on an opaque band: no photograph shows through it. */}
        <BottomNav solidOn={["/history"]} volunteer={volunteer} />
      </Suspense>
      {/* Not on the History page: it has its own year strip and "Back to the start". */}
      <ScrollTopButton skip={["/history"]} />
      {/* Not on the venue map: its floor plans are large and nothing on it changes by the minute. */}
      <AutoRefresh skip={["/map"]} />
    </div>
  );
}
