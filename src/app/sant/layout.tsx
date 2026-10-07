import { Suspense } from "react";
import { requireSant } from "@/lib/auth";
import { santName } from "@/lib/sant";
import { HubHeader } from "@/components/HubHeader";
import { AutoRefresh } from "@/components/AutoRefresh";
import { ScrollTopButton } from "@/components/ScrollTopButton";
import { AppScroll } from "@/components/AppScroll";
import { LoginSplash } from "@/components/brand/LoginSplash";
import { SantBottomNav } from "@/components/sant/shell/SantBottomNav";
import { getSantNotifications } from "@/components/sant/shell/santNotifications";
import { santInitial } from "@/components/sant/shell/identity";

/**
 * Shell of the Pujya Santo view (/sant/*): the hub's header, container and
 * floating nav, with the sant's tabs and the deeper "bhagwa" accent (the coral
 * gradient's deep end, running into ember) on a warmer sand canvas.
 *
 * Lives outside the (hub) route group on purpose: the hub layout sends santos
 * here, so a sant page inside (hub) would loop. requireSant() sends delegates
 * who open a /sant URL to /dashboard. Pages must still call requireSant()
 * themselves (layouts are not re-run on every client navigation).
 */
export default async function SantLayout({ children }: { children: React.ReactNode }) {
  const sant = await requireSant();
  const notifications = await getSantNotifications(sant, new Date());

  return (
    // The app shell (globals.css): the header sits at the top and only <AppScroll> scrolls.
    <div className="app-shell">
      {/* First load after sign-in only: the Sāchu wallpaper blurs away to reveal this screen.
          First in the markup (it's fixed, so order changes nothing on screen) so it's parsed
          before any of the page can paint. */}
      <LoginSplash />
      {/* The Santo canvas (coral into ember from the top, ink at the foot; .canvas-sant in
          globals.css), under everything, in place of the delegate hub's body glow. */}
      <div aria-hidden="true" className="canvas-sant pointer-events-none fixed inset-0 -z-50" />
      <HubHeader
        guest={sant}
        displayName={santName(sant)}
        avatarText={santInitial(sant)}
        profileHref="/sant/profile"
        homeHref="/sant"
        tone="bhagwa"
        notifications={notifications}
        // A Santo mirror test account: whose programme and utaro the pages are showing (requireGuest()).
        mirrorOf={sant.mirrorOf}
      />
      <AppScroll>
        {/* Bottom padding clears the floating nav and back-to-top button, including the safe
            area they sit above, so the page's end (the BAPS footer) is never under them. */}
        <main className="mx-auto w-full max-w-lg px-4 pb-[calc(7rem_+_env(safe-area-inset-bottom))] pt-5">
          {children}
        </main>
      </AppScroll>
      <Suspense fallback={null}>
        <SantBottomNav />
      </Suspense>
      <ScrollTopButton />
      {/* Not on the venue map: nothing time-dependent there would justify re-sending its floor plans every minute. */}
      <AutoRefresh skip={["/sant/map"]} />
    </div>
  );
}
