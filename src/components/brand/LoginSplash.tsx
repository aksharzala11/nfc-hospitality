import { headers } from "next/headers";
import { SPLASH_HEADER } from "@/lib/splash";
import { SplashArt } from "./SplashArt";
import { SplashReveal } from "./SplashReveal";

/**
 * The sign-in splash for the signed-in layouts ((hub), sant, admin): on the first full page load
 * after `POST /api/auth/verify-otp` (which sets the short-lived `hh_splash` cookie; the
 * middleware uses it up on that request and passes the `x-hh-splash` header on), the Sāchu
 * wallpaper covers the screen, holds, then blurs away to reveal the home screen. Renders nothing
 * otherwise. Mount it as the first child of the layout's .app-shell (so it's parsed, and its
 * image requested, before any page content), outside <AppScroll>, like the other fixed layers;
 * layouts don't re-render on client navigation, so it can only ever appear on a full load.
 *
 * Server component (reads the header); <SplashArt> is shared markup, <SplashReveal> the small
 * client island that handles skip/unmount. See src/lib/splash.ts.
 */
export async function LoginSplash() {
  const requestHeaders = await headers();
  if (requestHeaders.get(SPLASH_HEADER) !== "1") return null;
  return (
    <SplashReveal>
      <SplashArt />
    </SplashReveal>
  );
}
