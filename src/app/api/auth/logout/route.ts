import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";

export async function POST() {
  // A relative Location: the browser resolves it against the address it is on. `req.url` is the
  // server's own bind address behind a proxy (http://0.0.0.0:3000 in the Docker image), so an
  // absolute redirect built from it sends the guest there.
  const res = new NextResponse(null, { status: 303, headers: { Location: "/" } });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
