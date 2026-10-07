import { NextResponse, type NextRequest } from "next/server";
import { SPLASH_COOKIE, SPLASH_HEADER, splashCookieOptions } from "@/lib/splash";
import { PATH_HEADER } from "@/lib/volunteer";
import { hereNextPath } from "@/lib/here";

/**
 * Cheap routing guard. It only checks whether a session cookie is present;
 * the signature is verified in `requireGuest()` (Node runtime), which sends
 * bad or stale cookies through /api/auth/expired to be cleared. Keeping the
 * secret out of the Edge runtime avoids a class of "verified but bounced back
 * to login" bugs when Edge and Node see different environment variables.
 */
const SESSION_COOKIE = "hh_session";
const PROTECTED = [
  "/dashboard",
  "/schedule",
  "/menu",
  "/breakouts",
  "/profile",
  "/transportation",
  "/stay",
  "/map",
  "/dress-code",
  "/history",
  "/prasang",
  "/sant",
  "/admin",
  // An NFC tag's link (src/lib/here.ts): signed out, the login page returns here after sign-in.
  "/here",
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasCookie = Boolean(req.cookies.get(SESSION_COOKIE)?.value);

  if (PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    if (!hasCookie) {
      const url = req.nextUrl.clone();
      url.pathname = "/";
      url.search = "";
      // A tag's /here/<place>: sign-in comes back to it (the only page `next` may name).
      const next = hereNextPath(pathname);
      if (next) url.searchParams.set("next", next);
      const res = NextResponse.redirect(url);
      // Never kept: next.config.ts gives the History photographs (/history/photos/*) a
      // year-long Cache-Control by path, and it would otherwise ride on this redirect too,
      // leaving a signed-out browser with "this photo is the login page" for good.
      res.headers.set("Cache-Control", "no-store");
      return res;
    }
    // /here only redirects to the map: the sign-in splash is left for the map's own request.
    return nextWithPageHeaders(req, !pathname.startsWith("/here/"));
  }

  if (pathname === "/" && hasCookie && !req.nextUrl.searchParams.has("reason")) {
    const url = req.nextUrl.clone();
    // Already signed in on a tag's login link: straight to the tag's place.
    const next = hereNextPath(req.nextUrl.searchParams.get("next"));
    url.pathname = next ?? "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

/**
 * The request headers a protected page gets from here (a client-sent copy of either is always
 * replaced or dropped):
 *  - `x-hh-path` (PATH_HEADER, src/lib/volunteer.ts): the requested path, so `requireGuest()`
 *    can keep a volunteer account to the schedule and the menu;
 *  - the sign-in splash cue. The splash is one-shot (src/lib/splash.ts): the first document
 *    request that carries the `hh_splash` cookie uses it up here, on the server, before the page
 *    could hydrate, and tells the layout through the `x-hh-splash` request header. Only a document
 *    load takes it (a browser navigation asks for text/html; Next's RSC fetches and server actions
 *    don't, and Next hides their `RSC` header from middleware anyway), never a prefetch.
 */
function nextWithPageHeaders(req: NextRequest, splash = true) {
  const cue =
    splash &&
    req.cookies.get(SPLASH_COOKIE)?.value === "1" &&
    req.method === "GET" &&
    (req.headers.get("accept") ?? "").includes("text/html") &&
    !/prefetch/i.test(req.headers.get("sec-purpose") ?? req.headers.get("purpose") ?? "");

  const headers = new Headers(req.headers);
  headers.set(PATH_HEADER, req.nextUrl.pathname);
  headers.delete(SPLASH_HEADER);
  if (cue) headers.set(SPLASH_HEADER, "1");
  const res = NextResponse.next({ request: { headers } });
  if (cue) res.cookies.set(SPLASH_COOKIE, "", { ...splashCookieOptions(), maxAge: 0 });
  return res;
}

// Pages only: /api/* is never matched, so route handlers check their own callers. That is
// what lets the TV screens' display API (/api/display/*, src/lib/display.ts) through
// without a session: it takes a DISPLAY_API_KEYS key instead, and nothing else is opened.
export const config = {
  matcher: [
    "/",
    "/dashboard/:path*",
    "/schedule/:path*",
    "/menu/:path*",
    "/breakouts/:path*",
    "/profile/:path*",
    "/transportation/:path*",
    "/stay/:path*",
    "/map/:path*",
    "/dress-code/:path*",
    "/history/:path*",
    "/prasang/:path*",
    "/sant/:path*",
    "/admin/:path*",
    "/here/:path*",
  ],
};
