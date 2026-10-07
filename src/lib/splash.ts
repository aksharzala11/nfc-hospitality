/**
 * The sign-in splash: the organisers' Sāchu phone wallpaper, full screen, that blurs away to
 * reveal the home screen on the first page load after signing in (src/components/brand/
 * LoginSplash.tsx). Safe to import from server and client code alike.
 *
 * Flow: `POST /api/auth/verify-otp` sets the short-lived `hh_splash` cookie next to the session
 * cookie; LoginForm covers the login page with the wallpaper while the home page loads; the
 * middleware uses the cookie up on that first document request (deletes it and passes the
 * `x-hh-splash` request header on instead), so the destination layout ((hub), sant, admin)
 * renders the same wallpaper with a CSS-driven reveal exactly once: a reload, or a tap on a
 * link before the page has hydrated (a plain full load), never replays it, with or without JS.
 */

export const SPLASH_COOKIE = "hh_splash";

/**
 * Request header the middleware sets (and strips from incoming requests) on the one document
 * request that used the cookie up; <LoginSplash> reads it. A header, not the cookie: Next merges
 * the middleware's Set-Cookie into the request's cookie store, so a deleted cookie would be
 * hidden from the layout too.
 */
export const SPLASH_HEADER = "x-hh-splash";

/** Only has to last from the verify response to the home-page request that follows it. */
export const SPLASH_COOKIE_MAX_AGE_SECONDS = 120;

/**
 * The organisers' Sāchu wallpapers at phone size (750x1630 WebP, built by
 * scripts/build-sachu-assets.py). Never the full-size JPEG downloads in wallpapers/.
 */
export const SPLASH_WALLPAPER = {
  light: "/brand/sachu/wallpaper-light.webp",
  dark: "/brand/sachu/wallpaper-dark.webp",
} as const;

export const SPLASH_WALLPAPER_SIZE = { w: 750, h: 1630 } as const;

/** The splash follows the system appearance, like the phone's own wallpaper. */
export const SPLASH_DARK_QUERY = "(prefers-color-scheme: dark)";

/** For the route handler: readable by the page's JS (it deletes the cookie once shown). */
export function splashCookieOptions() {
  return {
    httpOnly: false,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SPLASH_COOKIE_MAX_AGE_SECONDS,
  };
}

/**
 * Browser only: deletes the cookie (same name and path it was set with). Belt and braces: the
 * middleware has normally used it up already.
 */
export function clearSplashCookie() {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${SPLASH_COOKIE}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; SameSite=Lax${secure}`;
}

// Held so the request isn't dropped with an unreferenced Image.
let preloaded: HTMLImageElement | null = null;

/**
 * Browser only: fetches the wallpaper the splash will show (the one <picture> picks for the
 * current colour scheme) into the cache, so it is ready the moment sign-in succeeds. Once per
 * page.
 */
export function preloadSplashWallpaper() {
  if (preloaded || typeof window === "undefined") return;
  const dark = typeof window.matchMedia === "function" && window.matchMedia(SPLASH_DARK_QUERY).matches;
  const img = new Image();
  img.decoding = "async";
  img.src = dark ? SPLASH_WALLPAPER.dark : SPLASH_WALLPAPER.light;
  preloaded = img;
}
