import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { OtpChannel, Prisma, type UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getOtpProvider } from "@/lib/otp/providers";
import { greetingName } from "@/lib/users";
import { santName } from "@/lib/sant";

import {
  OTP_LENGTH,
  OTP_TTL_MINUTES,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_SENDS_PER_WINDOW,
  OTP_REPLAY_GRACE_MS,
  TESTER_LOCK_MINUTES,
  TESTER_MAX_ATTEMPTS,
  TESTER_MAX_LOCKOUTS,
} from "@/lib/otp/constants";

/** A lock that only an explicit reset lifts (persona --apply, or user:upsert --testCode). */
const HARD_LOCK_MS = 10 * 365 * 24 * 60 * 60 * 1000;
export { OTP_LENGTH, OTP_TTL_MINUTES, OTP_MAX_ATTEMPTS, OTP_MAX_SENDS_PER_WINDOW };

export function generateCode() {
  return randomInt(0, 10 ** OTP_LENGTH).toString().padStart(OTP_LENGTH, "0");
}

/** HMAC the code with the guest id so a leaked DB row can't be replayed. */
export function hashCode(code: string, guestId: string) {
  const secret = process.env.AUTH_SECRET ?? "";
  return createHmac("sha256", secret).update(`${guestId}:${code}`).digest("hex");
}

function safeEqual(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function maskEmail(email: string) {
  const [user, domain] = email.split("@");
  if (!domain) return "•••";
  const visible = user.slice(0, Math.min(2, user.length));
  return `${visible}${"•".repeat(Math.max(3, user.length - visible.length))}@${domain}`;
}

export function maskPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return `•••-•••-${digits.slice(-4)}`;
}

const WINDOW_MS = OTP_TTL_MINUTES * 60 * 1000;
/** How many of a guest's latest expired codes a wrong guess is checked against (for the message only). */
const EXPIRED_CODES_CHECKED = 20;
/** First key of the per-user advisory lock that serialises one user's code requests. */
const OTP_LOCK_NAMESPACE = 726_100_802;

/** Prisma's code for "the server has closed the connection". */
const CONNECTION_CLOSED = "P1017";
/** How many dead pooled connections the guest lookup works through (production pools hold 5). */
const STALE_CONNECTION_RETRIES = 5;

/**
 * The guest's row, the first query of both sign-in steps. A pooled connection can die between
 * requests (a database restart, a network drop), which Prisma only finds out by using it: the
 * query fails at once (P1017) and that connection is dropped, one per failed query. (Only when
 * the connection had run the statement before, which this lookup has on any connection that
 * served a sign-in; the pool itself re-checks connections that sat idle for a while.) So the
 * lookup is repeated until it gets a working connection, and the rest of the request then finds
 * the dead ones gone, instead of the guest having to press the button once per dead connection.
 * Nothing has been stored or claimed yet, so repeating it is safe; any other error (the database
 * can't be reached at all) is thrown straight away.
 */
async function findGuest(bapsId: string) {
  for (let retries = 0; ; retries++) {
    try {
      return await prisma.user.findUnique({ where: { bapsId } });
    } catch (err) {
      const closed = (err as { code?: unknown } | null)?.code === CONNECTION_CLOSED;
      if (!closed || retries >= STALE_CONNECTION_RETRIES) throw err;
    }
  }
}

export type RequestOtpResult =
  | { ok: true; channel: OtpChannel; destination: string; staticCode?: boolean }
  | { ok: false; error: "NOT_FOUND" | "NO_CONTACT" | "SEND_FAILED" }
  /**
   * Too many codes in the window. `retryAfterSeconds`: until the oldest counted code leaves it.
   * `codesUsable`: a code sent earlier can still sign the guest in (unused, unexpired, tries
   * left). `channel` / `destination`: where the earlier codes went.
   */
  | {
      ok: false;
      error: "RATE_LIMITED";
      retryAfterSeconds: number;
      codesUsable: boolean;
      channel: OtpChannel;
      destination: string;
    };

/**
 * Seconds until this user may be sent another code, or null when there is room now. A code
 * counts from the moment it is stored, whether or not it is still usable. (One whose delivery
 * failed is removed again, see requestOtp(), so an outage doesn't use the guest's sends up.)
 */
async function sendWait(db: Prisma.TransactionClient, userId: string, now: Date): Promise<number | null> {
  const recent = await db.otpCode.findMany({
    where: { userId, createdAt: { gt: new Date(now.getTime() - WINDOW_MS) } },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  if (recent.length < OTP_MAX_SENDS_PER_WINDOW) return null;
  // There is room again once the oldest counted code has left the window.
  const leavesAt = recent[recent.length - OTP_MAX_SENDS_PER_WINDOW].createdAt.getTime() + WINDOW_MS;
  // Never more than the window: a code a parallel request stored a moment after this one's `now`
  // would otherwise read as 601 s ("about 11 minutes").
  return Math.min(WINDOW_MS / 1000, Math.max(1, Math.ceil((leavesAt - now.getTime()) / 1000)));
}

export async function requestOtp(bapsId: string): Promise<RequestOtpResult> {
  const guest = await findGuest(bapsId);
  if (!guest) return { ok: false, error: "NOT_FOUND" };

  // Tester accounts use a fixed code and never trigger a send. Never for admins:
  // a static code has no attempt limit, so it must not guard the admin console.
  if (guest.testCode && guest.role !== "ADMIN") {
    return { ok: true, channel: guest.preferredChannel, destination: "your tester code", staticCode: true };
  }

  // Pick the delivery channel: preferred channel if we have that contact,
  // otherwise fall back to whichever we do have.
  let channel = guest.preferredChannel;
  if (channel === OtpChannel.SMS && !guest.phone) channel = OtpChannel.EMAIL;
  if (channel === OtpChannel.EMAIL && !guest.email) channel = OtpChannel.SMS;
  const to = channel === OtpChannel.EMAIL ? guest.email : guest.phone;
  if (!to) return { ok: false, error: "NO_CONTACT" };

  const code = generateCode();
  const destination = channel === OtpChannel.EMAIL ? maskEmail(to) : maskPhone(to);

  // Earlier codes are NOT cancelled: an email that arrives late must still sign the guest in
  // after a resend, so every code stays valid until it expires or one of them is used. The send
  // limit is therefore half of what bounds guessing (see verifyOtp).
  //
  // A plain look first: once the limit is reached, a flood of requests for one ID costs one read
  // each and never queues on the lock below.
  let wait = await sendWait(prisma, guest.id, new Date());
  let codeId: string | null = null;
  if (wait === null) {
    // Count again and store the code under a per-user advisory lock, so parallel requests can't
    // create more than OTP_MAX_SENDS_PER_WINDOW codes per window between them. (An advisory lock,
    // not the `users` row: an import transaction that has updated that row must not block this.
    // The INSERT's foreign-key check still waits for one that changed the row's BAPS ID or
    // User Id, until it commits.)
    const stored = await prisma.$transaction(
      async (tx) => {
        // Postgres must bound the lock waits itself: Prisma's `timeout` can't interrupt a
        // statement that is waiting on a lock, and a few requests stuck behind a stalled holder
        // would take every connection this instance has, for every guest. On expiry the
        // statement fails (55P03), nothing is stored, and the route answers "try again".
        await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${OTP_LOCK_NAMESPACE}::int, hashtext(${guest.id}))`;
        const now = new Date();
        const stillWait = await sendWait(tx, guest.id, now);
        if (stillWait !== null) return { wait: stillWait, id: null };
        const row = await tx.otpCode.create({
          data: {
            userId: guest.id,
            codeHash: hashCode(code, guest.id),
            channel,
            destination,
            createdAt: now,
            expiresAt: new Date(now.getTime() + WINDOW_MS),
          },
          select: { id: true },
        });
        return { wait: null, id: row.id };
      },
      { maxWait: 5_000, timeout: 10_000 },
    );
    wait = stored.wait;
    codeId = stored.id;
  }
  if (wait !== null) {
    const usable = await prisma.otpCode.count({
      where: {
        userId: guest.id,
        consumedAt: null,
        expiresAt: { gt: new Date() },
        attempts: { lt: OTP_MAX_ATTEMPTS },
      },
    });
    return { ok: false, error: "RATE_LIMITED", retryAfterSeconds: wait, codesUsable: usable > 0, channel, destination };
  }

  try {
    const provider = getOtpProvider();
    if (channel === OtpChannel.EMAIL) {
      // Santos are addressed by name only (santName(): no "Pujya"/"Swami"), everyone else as in the app.
      const name = guest.role === "SANT" ? santName(guest) : greetingName(guest);
      await provider.sendEmail({ to, code, name });
    } else {
      await provider.sendSms({ to, code });
    }
  } catch (err) {
    console.error("OTP delivery failed", err);
    // The guest is told it wasn't sent, so this code is not one they hold. Remove it, so a mail
    // or SMS outage doesn't use up their sends (five taps on "Send code" would otherwise keep
    // them out for the rest of the window, with nothing ever sent). Only while no guess has been
    // tried against it (`attempts: 0`, re-checked by Postgres under the row lock): a code that
    // was ever compared stays, ended, and keeps counting, so the guessing bound in verifyOtp()
    // is untouched. (If this fails too, the code stays live and counted.)
    if (codeId) {
      const id = codeId;
      await prisma.otpCode
        .deleteMany({ where: { id, consumedAt: null, attempts: 0 } })
        .then(async (removed) => {
          if (removed.count > 0) return;
          await prisma.otpCode.updateMany({
            where: { id, consumedAt: null },
            data: { consumedAt: new Date(), attempts: OTP_MAX_ATTEMPTS },
          });
        })
        .catch((e) => console.error("Could not remove the undelivered code", e));
    }
    return { ok: false, error: "SEND_FAILED" };
  }

  return { ok: true, channel, destination };
}

/** A code a guess has claimed a try on; `attempts` is its count after that claim. */
type ClaimedCode = { id: string; codeHash: string; attempts: number };

/**
 * A moment as raw SQL to compare with the `timestamp` columns (which hold UTC). Never pass a
 * Date to raw SQL any other way: it arrives as timestamptz, and a plain cast to timestamp
 * would shift it by the database session's time zone.
 */
const utc = (moment: Date) => Prisma.sql`(${moment}::timestamptz AT TIME ZONE 'UTC')`;

/**
 * SQL condition on a code `c`: it was created within the send limit, i.e. fewer than
 * OTP_MAX_SENDS_PER_WINDOW codes of that user were created in the OTP_TTL_MINUTES before it
 * (the rule requestOtp() stores codes by, so every code it stores passes). Only such codes are
 * ever compared with a guess, and any OTP_TTL_MINUTES holds the creation of at most
 * OTP_MAX_SENDS_PER_WINDOW of them, whoever wrote the rows.
 */
const WITHIN_SEND_LIMIT = Prisma.sql`(
  SELECT count(*)
  FROM otp_codes AS p
  WHERE p.user_id = c.user_id
    AND p.created_at > c.created_at - ${OTP_TTL_MINUTES}::int * interval '1 minute'
    AND (p.created_at < c.created_at OR (p.created_at = c.created_at AND p.id < c.id))
) < ${OTP_MAX_SENDS_PER_WINDOW}::int`;

export type VerifyOtpResult =
  | { ok: true; user: { id: string; bapsId: string; name: string; displayName: string | null; role: UserRole } }
  | {
      ok: false;
      error:
        | "NOT_FOUND"
        | "NO_CODE"
        | "EXPIRED"
        /** The code typed is one of theirs that has expired, while a later one still works. */
        | "EXPIRED_CODE"
        | "TOO_MANY_ATTEMPTS"
        | "LOCKED"
        | "LOCKED_UNTIL_RESET"
        | "INVALID";
    };

export async function verifyOtp(bapsId: string, code: string): Promise<VerifyOtpResult> {
  const guest = await findGuest(bapsId);
  if (!guest) return { ok: false, error: "NOT_FOUND" };

  const user = { id: guest.id, bapsId: guest.bapsId, name: guest.name, displayName: guest.displayName, role: guest.role };

  // Tester accounts: the fixed code never expires (and some testers mirror real
  // delegates' data), so guesses are rationed: TESTER_MAX_ATTEMPTS tries per window, then
  // a TESTER_LOCK_MINUTES lock; after TESTER_MAX_LOCKOUTS locks in a row the account stays
  // locked until reset. Each try is claimed BEFORE the code is compared, with a conditional
  // UPDATE that Postgres re-checks under the row lock, so a burst of parallel requests
  // still gets at most TESTER_MAX_ATTEMPTS tries per window. A correct code resets it all.
  // Admin accounts ignore test codes (see requestOtp) and fall through to real codes.
  if (guest.testCode && guest.role !== "ADMIN") {
    const now = new Date();
    // An expired lock opens a fresh window.
    await prisma.user.updateMany({
      where: { id: guest.id, testCodeLockedUntil: { lte: now } },
      data: { testCodeFailures: 0, testCodeLockedUntil: null },
    });
    const claimed = await prisma.user.updateMany({
      where: { id: guest.id, testCodeLockedUntil: null, testCodeFailures: { lt: TESTER_MAX_ATTEMPTS } },
      data: { testCodeFailures: { increment: 1 } },
    });
    if (claimed.count === 0) return { ok: false, error: await lockTester(guest.id, now) };
    if (safeEqual(guest.testCode, code)) {
      await prisma.user.update({
        where: { id: guest.id },
        data: { testCodeFailures: 0, testCodeLockouts: 0, testCodeLockedUntil: null },
      });
      return { ok: true, user };
    }
    // This wrong try may have used up the window: lock now rather than on the next request.
    const spent = await prisma.user.count({ where: { id: guest.id, testCodeFailures: { gte: TESTER_MAX_ATTEMPTS } } });
    if (spent > 0) return { ok: false, error: await lockTester(guest.id, now) };
    return { ok: false, error: "INVALID" };
  }

  // Email / SMS codes. Every code the guest was sent stays valid until it expires or one of
  // them signs in, so a guess could match any live code. The bound that keeps this safe:
  //  - One guess claims a try on EVERY live code (unconsumed, unexpired, tries left) in a single
  //    UPDATE ... RETURNING that locks the rows first and re-checks them under the lock, BEFORE
  //    anything is compared, and is then compared only with the codes it claimed. So each code is
  //    compared with at most OTP_MAX_ATTEMPTS wrong guesses for as long as it can sign anyone in
  //    (the replay grace below spends the same counter), however many requests run in parallel.
  //  - Only codes created within the send limit are ever claimed (WITHIN_SEND_LIMIT): at most
  //    OTP_MAX_SENDS_PER_WINDOW per OTP_TTL_MINUTES. requestOtp() never stores more, and the
  //    check holds for rows written some other way too (an older deployment on the same
  //    database, whose request path could be raced into storing many).
  // So without the mailbox, the codes of one window are worth at most sends x attempts wrong
  // guesses, each a 1-in-10^OTP_LENGTH chance: 5 x 5 = 25 in a million per 10 minutes of sends.
  // (A guess against k live codes has k chances but spends a try on all k, so it is no cheaper.)
  //
  // Every multi-row statement here locks its rows in id order (ORDER BY ... FOR NO KEY UPDATE)
  // before updating them, so parallel requests for one user can't deadlock.
  const now = new Date();
  const hash = hashCode(code, guest.id);
  const claimed = await prisma.$queryRaw<ClaimedCode[]>`
    UPDATE otp_codes AS t
    SET attempts = t.attempts + 1
    FROM (
      SELECT c.id
      FROM otp_codes AS c
      WHERE c.user_id = ${guest.id}
        AND c.consumed_at IS NULL
        AND c.expires_at > ${utc(now)}
        AND c.attempts < ${OTP_MAX_ATTEMPTS}::int
        AND ${WITHIN_SEND_LIMIT}
      ORDER BY c.id
      FOR NO KEY UPDATE OF c
    ) AS live
    WHERE t.id = live.id
    RETURNING t.id, t.code_hash AS "codeHash", t.attempts`;
  const match = matching(claimed, hash);
  if (match) {
    // Signing in ends every code the guest holds, in one statement (the other emails' codes die
    // here). The successful try doesn't count, so the replay grace below still accepts a
    // duplicate submit of this code; maxing out `attempts` on the others keeps them out of it.
    // The try is given back only while it is still there to give: when a parallel sign-in with
    // ANOTHER of the guest's codes has already ended this one (used, tries maxed out), it stays
    // ended, so only one code is ever left in the replay grace. (Used and at the maximum is also
    // what this code looks like for a moment while duplicate submits hold replay tries on it, with
    // five or more requests in flight; this request's try then stays spent too. That only leaves
    // the grace with fewer tries, never more: the first sign-in always gives its own back.)
    await prisma.$executeRaw`
      UPDATE otp_codes AS t
      SET consumed_at = COALESCE(t.consumed_at, ${utc(now)}),
          attempts = CASE
            WHEN t.id <> ${match.id} THEN ${OTP_MAX_ATTEMPTS}::int
            WHEN t.consumed_at IS NULL OR t.attempts < ${OTP_MAX_ATTEMPTS}::int THEN GREATEST(t.attempts - 1, 0)
            ELSE t.attempts
          END
      FROM (
        SELECT c.id
        FROM otp_codes AS c
        WHERE c.user_id = ${guest.id}
          AND (c.consumed_at IS NULL OR c.id = ${match.id})
        ORDER BY c.id
        FOR NO KEY UPDATE OF c
      ) AS held
      WHERE t.id = held.id`;
    return { ok: true, user };
  }

  // Not a live code. It may be a duplicate submit of the code that signed in moments ago (iOS
  // autofill fires the auto-verify and then the form submit, in parallel or one after the
  // other): that is the same sign-in, not an error. Its try is claimed first too, so the grace
  // window can't be used to guess without limit, and a match gives the try back.
  const replayable = await prisma.$queryRaw<ClaimedCode[]>`
    UPDATE otp_codes AS t
    SET attempts = t.attempts + 1
    FROM (
      SELECT c.id
      FROM otp_codes AS c
      WHERE c.user_id = ${guest.id}
        AND c.consumed_at >= ${utc(new Date(now.getTime() - OTP_REPLAY_GRACE_MS))}
        AND c.attempts < ${OTP_MAX_ATTEMPTS}::int
        AND ${WITHIN_SEND_LIMIT}
      ORDER BY c.id
      FOR NO KEY UPDATE OF c
    ) AS used
    WHERE t.id = used.id
    RETURNING t.id, t.code_hash AS "codeHash", t.attempts`;
  const replayed = matching(replayable, hash);
  if (replayed) {
    await prisma.otpCode.update({ where: { id: replayed.id }, data: { attempts: { decrement: 1 } } });
    return { ok: true, user };
  }

  if (claimed.length > 0) {
    // That wrong try was the last one on every code it was compared with: say so now (as the
    // tester path does), rather than "check and try again" followed by a refusal of the right code.
    if (claimed.every((c) => c.attempts >= OTP_MAX_ATTEMPTS)) return { ok: false, error: "TOO_MANY_ATTEMPTS" };
    // The late-email case: they typed an older code of theirs that has run out of time while a
    // later one still works. "That code isn't right" would have them retype it until the live
    // codes run out of tries. (The try above is spent all the same. Comparing with expired codes
    // gives nothing away: an expired code can never sign anyone in.)
    const expired = await prisma.otpCode.findMany({
      where: { userId: guest.id, consumedAt: null, expiresAt: { lte: now } },
      orderBy: { createdAt: "desc" },
      take: EXPIRED_CODES_CHECKED,
      select: { codeHash: true },
    });
    return { ok: false, error: matching(expired, hash) ? "EXPIRED_CODE" : "INVALID" };
  }

  // There was no live code with a try left to compare with: say why.
  const latest = await prisma.otpCode.findFirst({
    where: { userId: guest.id, consumedAt: null },
    orderBy: { expiresAt: "desc" },
    select: { expiresAt: true },
  });
  if (!latest) return { ok: false, error: "NO_CODE" };
  // Still within its time, so its tries are used up (as are those of every other live code).
  if (latest.expiresAt > now) return { ok: false, error: "TOO_MANY_ATTEMPTS" };
  return { ok: false, error: "EXPIRED" };
}

/**
 * Records when the guest signed in (the admin console's "last signed in"), and never waits to do
 * it: when another transaction holds their `users` row (an import that has updated it and not
 * committed yet), the row is skipped and false is returned, i.e. that sign-in goes unrecorded
 * rather than the guest waiting for their session until the import ends.
 */
export async function recordSignIn(userId: string, at = new Date()): Promise<boolean> {
  const updated = await prisma.$executeRaw`
    UPDATE users AS t
    SET last_sign_in_at = ${utc(at)}, updated_at = ${utc(at)}
    FROM (
      SELECT u.id
      FROM users AS u
      WHERE u.id = ${userId}
      FOR NO KEY UPDATE OF u SKIP LOCKED
    ) AS free
    WHERE t.id = free.id`;
  return updated > 0;
}

/**
 * The claimed code the guess matches, if any. Every row is compared (no early exit), each in
 * constant time.
 */
function matching<T extends { codeHash: string }>(rows: T[], hash: string): T | undefined {
  let found: T | undefined;
  for (const row of rows) {
    if (safeEqual(row.codeHash, hash) && !found) found = row;
  }
  return found;
}

/**
 * Starts a tester lockout: TESTER_LOCK_MINUTES, or a hard lock (until reset) on the
 * TESTER_MAX_LOCKOUTS-th in a row. Only while the window is spent and no lock is set,
 * both re-checked by Postgres under the row lock, so it never re-locks an account that
 * was just unlocked or reset, and parallel requests start one lock between them.
 * Returns which lock the account is under, for the sign-in message.
 */
async function lockTester(userId: string, now: Date): Promise<"LOCKED" | "LOCKED_UNTIL_RESET"> {
  const spent = { id: userId, testCodeLockedUntil: null, testCodeFailures: { gte: TESTER_MAX_ATTEMPTS } };
  const hard = await prisma.user.updateMany({
    where: { ...spent, testCodeLockouts: { gte: TESTER_MAX_LOCKOUTS - 1 } },
    data: { testCodeLockedUntil: new Date(now.getTime() + HARD_LOCK_MS), testCodeLockouts: { increment: 1 } },
  });
  if (hard.count === 0) {
    await prisma.user.updateMany({
      where: { ...spent, testCodeLockouts: { lt: TESTER_MAX_LOCKOUTS - 1 } },
      data: {
        testCodeLockedUntil: new Date(now.getTime() + TESTER_LOCK_MINUTES * 60_000),
        testCodeLockouts: { increment: 1 },
      },
    });
  }
  const row = await prisma.user.findUnique({ where: { id: userId }, select: { testCodeLockouts: true } });
  return (row?.testCodeLockouts ?? 0) >= TESTER_MAX_LOCKOUTS ? "LOCKED_UNTIL_RESET" : "LOCKED";
}
