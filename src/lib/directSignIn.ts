/**
 * EMERGENCY direct sign-in (user, 2026-10-05): while DELEGATE_DIRECT_SIGN_IN is "true", a
 * delegate who enters their BAPS ID or email on the login page is signed in at once, with no
 * one-time code. Admins, santos and accounts with a fixed tester code (the volunteer account,
 * the test sant) still sign in with a code. Off unless the variable is exactly "true".
 *
 * What it gives up: anyone who knows a delegate's BAPS ID (their email is
 * `<BAPS ID>@na.baps.id`) can sign in as them and see what the hub shows that delegate. Turn
 * it off (unset the variable and redeploy) as soon as codes are reaching guests again; that
 * doesn't end the sessions it started (SESSION_TTL_SECONDS in src/lib/auth.ts).
 *
 * Server only (Prisma).
 */
import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";

export function directSignInEnabled(): boolean {
  return process.env.DELEGATE_DIRECT_SIGN_IN === "true";
}

/** True when this account may sign in without a code right now. */
export function canSignInDirectly(user: Pick<User, "role" | "testCode">): boolean {
  return directSignInEnabled() && user.role === "DELEGATE" && !user.testCode;
}

/**
 * The one account whose email is this address (case-insensitive, compared with lower() in SQL,
 * never ILIKE, where "_" is a wildcard), or null when none or several have it.
 */
export async function findUserByEmail(email: string): Promise<User | null> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM users WHERE lower(email) = lower(${email.trim()}) LIMIT 2`;
  if (rows.length !== 1) return null;
  return prisma.user.findUnique({ where: { id: rows[0].id } });
}
