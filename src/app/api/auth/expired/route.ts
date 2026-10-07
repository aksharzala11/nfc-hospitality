import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";
import { hereNextPath } from "@/lib/here";

/**
 * Clears a session cookie whose user no longer exists (e.g. after switching
 * databases) and sends the visitor back to the login page. Server components
 * cannot delete cookies themselves, so `requireGuest()` redirects here. An NFC
 * tag's page (/here/<place>) passes itself as `next`, so sign-in returns there
 * (hereNextPath(): a /here path or nothing).
 */
export async function GET(req: NextRequest) {
  const next = hereNextPath(req.nextUrl.searchParams.get("next"));
  const location = next ? `/?reason=expired&next=${encodeURIComponent(next)}` : "/?reason=expired";
  // A relative Location, as in the logout route: `req.url` is the server's bind address behind
  // a proxy, not the site's.
  const res = new NextResponse(null, { status: 303, headers: { Location: location } });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
