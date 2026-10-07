import { NextResponse } from "next/server";
import { z } from "zod";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { recordSignIn, requestOtp } from "@/lib/otp";
import { createSessionToken, homePathFor, sessionCookieOptions, SESSION_COOKIE } from "@/lib/auth";
import { canSignInDirectly, directSignInEnabled, findUserByEmail } from "@/lib/directSignIn";
import { SPLASH_COOKIE, splashCookieOptions } from "@/lib/splash";

// A BAPS ID, or (while direct sign-in is on) an email address.
const bodySchema = z.object({
  bapsId: z.string().trim().min(3).max(254),
});

/**
 * EMERGENCY direct sign-in (src/lib/directSignIn.ts): the session verify-otp would start, with
 * no code. Logged by account id only.
 */
async function signInDirectly(user: User) {
  const token = await createSessionToken(user);
  await recordSignIn(user.id).catch((err) => console.error("Could not record sign-in time", err));
  console.info("direct sign-in (DELEGATE_DIRECT_SIGN_IN)", user.id);
  const res = NextResponse.json({
    ok: true,
    signedIn: true,
    name: user.displayName ?? user.name,
    home: homePathFor(user),
  });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  res.cookies.set(SPLASH_COOKIE, "1", splashCookieOptions());
  return res;
}

const MESSAGES: Record<string, string> = {
  NOT_FOUND: "We couldn't find that BAPS ID. Please check it and try again.",
  NO_CONTACT: "We don't have an email or phone number on file for this ID.",
  SEND_FAILED: "We couldn't send your code right now. Please try again shortly.",
};

/** "a minute" up to 60 s, else whole minutes rounded up ("7 minutes"). */
function waitInWords(seconds: number) {
  return seconds <= 60 ? "a minute" : `${Math.ceil(seconds / 60)} minutes`;
}

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Please enter a valid BAPS ID." }, { status: 400 });
  }

  const entered = parsed.data.bapsId;
  // An email address: only for direct sign-in (a code is always asked for by BAPS ID).
  if (entered.includes("@")) {
    if (!directSignInEnabled()) {
      return NextResponse.json({ ok: false, message: "Please enter your BAPS ID." }, { status: 400 });
    }
    let user: User | null;
    try {
      user = await findUserByEmail(entered);
    } catch (err) {
      console.error("direct sign-in lookup failed", err);
      return NextResponse.json(
        { ok: false, message: "We couldn't sign you in just now. Please try again in a moment." },
        { status: 503 },
      );
    }
    if (!user) {
      return NextResponse.json(
        { ok: false, message: "We couldn't find that email. Please check it, or enter your BAPS ID." },
        { status: 404 },
      );
    }
    if (!canSignInDirectly(user)) {
      return NextResponse.json(
        { ok: false, message: "Please enter your BAPS ID to get a sign-in code." },
        { status: 400 },
      );
    }
    return signInDirectly(user);
  }

  if (entered.length > 32) {
    return NextResponse.json({ ok: false, message: "Please enter a valid BAPS ID." }, { status: 400 });
  }
  const bapsId = entered.toUpperCase();
  if (directSignInEnabled()) {
    let user: User | null;
    try {
      user = await prisma.user.findUnique({ where: { bapsId } });
    } catch (err) {
      console.error("direct sign-in lookup failed", err);
      return NextResponse.json(
        { ok: false, message: "We couldn't sign you in just now. Please try again in a moment." },
        { status: 503 },
      );
    }
    if (user && canSignInDirectly(user)) return signInDirectly(user);
  }

  let result: Awaited<ReturnType<typeof requestOtp>>;
  try {
    result = await requestOtp(bapsId);
  } catch (err) {
    // A database hiccup (a busy pool, a timeout): nothing was sent, and a retry normally works.
    console.error("request-otp failed", err);
    return NextResponse.json(
      { ok: false, message: "We couldn't send your code just now. Please try again in a moment." },
      { status: 503 },
    );
  }

  if (!result.ok) {
    if (result.error === "RATE_LIMITED") {
      // The wait is until the oldest counted code leaves the window. `codesUsable` says whether
      // a code sent earlier can still sign the guest in; when one can, the form also gets where
      // the codes went (what a successful request returns) and lets the guest enter it.
      const { retryAfterSeconds, codesUsable, channel, destination } = result;
      const wait = `Too many codes requested. Please try again in about ${waitInWords(retryAfterSeconds)}.`;
      return NextResponse.json(
        {
          ok: false,
          error: result.error,
          message: codesUsable
            ? `${wait} Any code we've already sent you still works until it expires.`
            : `${wait} The codes we've already sent can no longer be used.`,
          retryAfterSeconds,
          codesUsable,
          channel,
          destination,
        },
        { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
      );
    }
    const status = result.error === "SEND_FAILED" ? 502 : 404;
    return NextResponse.json({ ok: false, message: MESSAGES[result.error] }, { status });
  }

  return NextResponse.json({
    ok: true,
    channel: result.channel,
    destination: result.destination,
    staticCode: result.staticCode ?? false,
  });
}
