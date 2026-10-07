export const OTP_LENGTH = 6;
export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
/** Tester accounts (fixed test_code): wrong tries per window, and how long the lockout lasts. */
export const TESTER_MAX_ATTEMPTS = 5;
export const TESTER_LOCK_MINUTES = 15;
/** After this many lockouts in a row (15 wrong tries) the account stays locked until reset. */
export const TESTER_MAX_LOCKOUTS = 3;
/**
 * Max codes a guest may request within OTP_TTL_MINUTES (a code whose delivery failed is removed
 * and not counted, unless a guess was already tried against it). Earlier codes stay valid after
 * a resend, so with OTP_MAX_ATTEMPTS this is what bounds guessing (sends x attempts
 * one-in-a-million chances per window): see verifyOtp(), which also refuses to compare a code
 * created beyond this limit. Raise either only with that product in mind.
 */
export const OTP_MAX_SENDS_PER_WINDOW = 5;
/**
 * After a code is verified, the same code is accepted again for this long.
 * Mobile autofill can submit the verify request twice; without this the
 * second request would fail with NO_CODE even though the first signed in.
 */
export const OTP_REPLAY_GRACE_MS = 2 * 60 * 1000;
