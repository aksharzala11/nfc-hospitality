import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { HubHeader } from "@/components/HubHeader";
import { AutoRefresh } from "@/components/AutoRefresh";
import { ScrollTopButton } from "@/components/ScrollTopButton";
import { AppScroll } from "@/components/AppScroll";
import { LoginSplash } from "@/components/brand/LoginSplash";
import { AdminBottomNav } from "@/components/admin/shell/AdminBottomNav";

/**
 * Shell of the admin console (/admin/*): the hub's header with an ink avatar,
 * a "Delegate view" switch and no bell; a container that widens on tablets and
 * desktops; the console's floating nav; all on an ink-washed sand canvas.
 *
 * Lives outside the (hub) route group so the delegate header and tabs don't
 * wrap it. requireAdmin() sends everyone else to their own home. Pages must
 * still call requireAdmin() themselves, and server actions / route handlers
 * getAdmin(): layouts are not re-run on every client navigation.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();

  return (
    // The app shell (globals.css): the header sits at the top and only <AppScroll> scrolls.
    <div className="app-shell">
      {/* First load after sign-in only: the Sāchu wallpaper blurs away to reveal this screen.
          First in the markup (it's fixed, so order changes nothing on screen) so it's parsed
          before any of the page can paint. */}
      <LoginSplash />
      {/* The console canvas (ink wash from the top, jade at the foot; .canvas-console in
          globals.css), under everything, in place of the delegate hub's coral body glow. */}
      <div aria-hidden="true" className="canvas-console pointer-events-none fixed inset-0 -z-50" />
      <HubHeader
        // Only what the header shows: the full row also holds test_code.
        guest={{ name: admin.name, displayName: admin.displayName, bapsId: admin.bapsId }}
        tone="console"
        wide
        homeHref="/admin"
        delegateHref="/dashboard"
      />
      <AppScroll>
        {/* Bottom padding clears the floating nav and back-to-top button, safe area included. */}
        <main className="mx-auto w-full max-w-lg px-4 pb-[calc(7rem_+_env(safe-area-inset-bottom))] pt-5 md:max-w-3xl lg:max-w-5xl">
          {children}
        </main>
      </AppScroll>
      <Suspense fallback={null}>
        <AdminBottomNav />
      </Suspense>
      <ScrollTopButton />
      <AutoRefresh />
    </div>
  );
}
