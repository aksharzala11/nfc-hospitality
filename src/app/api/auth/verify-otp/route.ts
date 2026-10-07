import { NextResponse } from "next/server";
import { z } from "zod";
import { recordSignIn, verifyOtp, OTP_LENGTH } from "@/lib/otp";
import { createSessionToken, homePathFor, sessionCookieOptions, SESSION_COOKIE } from "@/lib/auth";
import { SPLASH_COOKIE, splashCookieOptions } from "@/lib/splash";

const bodySchema = z.object({
  bapsId: z.string().trim().min(3).max(32),
  code: z.string().trim().regex(new RegExp(`^\\d{${OTP_LENGTH}}$`)),
});

const MESSAGES: Record<string, string> = {
  NOT_FOUND: "We couldn't find that BAPS ID.",
  // Any unexpired code the guest was sent signs them in (a resend doesn't cancel the earlier
  // ones), so nothing here may say "use the newest code".
  NO_CODE: "There's no active code for this ID. Please request a new one.",
  // Only when every code they were sent has expired.
  EXPIRED: "That code has expired. Please request a new one.",
  // An older code of theirs, typed after its 10 minutes, while a later one is still good. (Not
  // "the newest": every later code that hasn't expired works.)
  EXPIRED_CODE: "That code has expired. A code we sent you later still works, or you can request a new one.",
  // Wrong tries count against every code they hold, so a new code is the way on.
  TOO_MANY_ATTEMPTS: "Too many incorrect attempts. The codes we sent no longer work. Please request a new one.",
  // Tester accounts (fixed code): requesting a new code doesn't help, so say to wait.
  LOCKED: "Too many incorrect attempts. Try again in 15 minutes.",
  LOCKED_UNTIL_RESET: "Too many incorrect attempts. This tester account is locked until an organiser resets it.",
  INVALID: "That code isn't right. Please check and try again.",
};

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: `Enter the ${OTP_LENGTH}-digit code.` }, { status: 400 });
  }

  let result: Awaited<ReturnType<typeof verifyOtp>>;
  try {
    result = await verifyOtp(parsed.data.bapsId.toUpperCase(), parsed.data.code);
  } catch (err) {
    // A database hiccup (a busy pool, a timeout). The code is still good: a retry normally works.
    console.error("verify-otp failed", err);
    return NextResponse.json(
      { ok: false, message: "We couldn't check your code just now. Please try again.", error: "UNAVAILABLE" },
      { status: 503 },
    );
  }
  if (!result.ok) {
    return NextResponse.json({ ok: false, message: MESSAGES[result.error], error: result.error }, { status: 401 });
  }

  const token = await createSessionToken(result.user);
  // Powers "last signed in" in the admin directory; never block sign-in on it: it skips a row
  // another transaction holds (an import in progress) instead of waiting, and a failure is only logged.
  await recordSignIn(result.user.id).catch((err) => console.error("Could not record sign-in time", err));
  const res = NextResponse.json({
    ok: true,
    name: result.user.displayName ?? result.user.name,
    home: homePathFor(result.user),
  });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  // One-shot: the first full load of home shows the Sāchu splash, then deletes this (src/lib/splash.ts).
  res.cookies.set(SPLASH_COOKIE, "1", splashCookieOptions());
  return res;
}
