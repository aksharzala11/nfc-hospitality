import { cache } from "react";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Prisma, User, UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { greetingName } from "@/lib/users";
import { santName } from "@/lib/santName";
import { PATH_HEADER, VOLUNTEER_HOME, isVolunteer, volunteerMayOpen } from "@/lib/volunteer";

export const SESSION_COOKIE = "hh_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days covers the 3-day event

export type SessionPayload = JWTPayload & {
  sub: string; // guest id
  bapsId: string;
  name: string;
};

function secretKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("AUTH_SECRET is missing or too short. See .env.example.");
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(user: { id: string; bapsId: string; name: string; displayName: string | null }) {
  return new SignJWT({ bapsId: user.bapsId, name: user.displayName ?? user.name })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    if (!payload.sub) return null;
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

/** Reads the session cookie. Returns null when not signed in. */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

/**
 * The real person a mirror tester account is showing (for the header's band): a delegate by
 * their User Id (registration_id), or a Pujya Sant by his BAPS ID, named by santName().
 */
export type MirrorOf =
  | { kind: "DELEGATE"; registrationId: string; name: string }
  | { kind: "SANT"; bapsId: string; name: string };

/**
 * The signed-in account as the hub reads it: the `users` row, with a mirror
 * tester's view fields replaced by the mirrored person's (see withMirror()).
 * `mirrorOf` is null for everyone else. `dataUserId` is the users.id the Santo
 * pages' per-person reads use (personal schedule, utaro: src/lib/sant.ts): the
 * mirrored sant's for a Santo mirror, else the account's own id (a delegate
 * mirror's data is found by registrationId instead). `id` is always the
 * account's own: every write and the bell use it.
 */
export type Guest = User & { mirrorOf: MirrorOf | null; dataUserId: string };

/**
 * What a mirror tester account takes from the delegate it mirrors: everything
 * the hub picks per-person data by (track, seva and team, goshthi group with
 * its room and moderator flag, breakout links, and registration_id, which finds
 * their transport legs and room assignments), plus the master-list details
 * shown alongside them.
 */
const MIRRORED_FIELDS = {
  gender: true,
  seva: true,
  sevaWing: true,
  sevaRole: true,
  personalWing: true,
  region: true,
  center: true,
  goshthiGroup: true,
  goshthiRoom: true,
  goshthiModerator: true,
  registrationId: true,
  registrationStatus: true,
  accommodationPackage: true,
  breakoutSessions: true,
} as const satisfies Prisma.UserSelect;

/**
 * Whether this server honours mirror test accounts (ALLOW_MIRROR_TESTERS=true,
 * like ALLOW_TIME_TRAVEL). Off by default: a mirror account shows a real
 * delegate's transport and stay, or a real sant's programme and utaro, behind a fixed
 * tester code (rationed by verifyOtp(), but still a static secret), so turn it on only
 * while organisers are testing with them.
 */
export function mirrorTestersEnabled(): boolean {
  return process.env.ALLOW_MIRROR_TESTERS === "true";
}

/**
 * What a Santo mirror test account takes from the sant it mirrors: everything the Santo pages
 * pick per-person data by (gender for his track and the bell, seva, region and center, and his
 * utaro), plus his users.id, which the per-person Santo reads use (Guest.dataUserId: his personal
 * programme, rides and utaro companions).
 */
const SANT_MIRRORED_FIELDS = {
  id: true,
  gender: true,
  seva: true,
  region: true,
  center: true,
  santAccommodationId: true,
} as const satisfies Prisma.UserSelect;

/**
 * Mirror test accounts: a tester (test_code set) account with
 * users.mirror_registration_id set sees the app with another person's data, so
 * organisers can check it exactly as that person sees it:
 *  - a DELEGATE tester: the delegate hub with the data of the DELEGATE whose
 *    registration_id ("User Id") that is (the fields in MIRRORED_FIELDS);
 *  - a SANT tester (user, 2026-10-02): the Santo view with the data of the SANT
 *    whose BAPS ID that is (case-insensitive; santos have no registration_id, so
 *    for a SANT tester the column holds the mirrored sant's BAPS ID): the fields
 *    in SANT_MIRRORED_FIELDS, and `dataUserId` = his users.id for the per-person
 *    Santo reads (src/lib/sant.ts). Set with `npm run sant:demo -- --mirror`.
 * The id, BAPS ID, name, contact details, role, test code, notification read
 * state and sign-in time stay the tester's own, so anything the app writes
 * (notifications seen, last sign-in; both keyed by the session's user id) lands
 * on the tester's row, never the real person's, and personal announcements are
 * matched on the tester's own id. Nothing happens unless the server allows it
 * (mirrorTestersEnabled()), never for ADMIN accounts, nor for accounts without a
 * test code, or when no person of the tester's own role has that User Id / BAPS
 * ID: the account then behaves normally.
 */
async function withMirror(user: User): Promise<Guest> {
  const own: Guest = { ...user, mirrorOf: null, dataUserId: user.id };
  const mirrorId = user.mirrorRegistrationId?.trim();
  if (!mirrorId || !user.testCode || !mirrorTestersEnabled()) return own;
  if (user.role === "SANT") return withSantMirror(user, mirrorId, own);
  if (user.role !== "DELEGATE") return own;
  const target = await prisma.user.findUnique({
    where: { registrationId: mirrorId },
    select: { ...MIRRORED_FIELDS, role: true, name: true, displayName: true },
  });
  if (!target || target.role !== "DELEGATE" || !target.registrationId) return own;
  return {
    ...own,
    gender: target.gender,
    seva: target.seva,
    sevaWing: target.sevaWing,
    sevaRole: target.sevaRole,
    personalWing: target.personalWing,
    region: target.region,
    center: target.center,
    goshthiGroup: target.goshthiGroup,
    goshthiRoom: target.goshthiRoom,
    goshthiModerator: target.goshthiModerator,
    registrationId: target.registrationId,
    registrationStatus: target.registrationStatus,
    accommodationPackage: target.accommodationPackage,
    breakoutSessions: target.breakoutSessions,
    // Named as their own hub greets them.
    mirrorOf: { kind: "DELEGATE", registrationId: target.registrationId, name: greetingName(target) },
  };
}

/**
 * A SANT tester's mirror (see withMirror()): the SANT whose BAPS ID `bapsId` is, matched
 * case-insensitively; `own` (no mirror) when there is none.
 */
async function withSantMirror(user: User, bapsId: string, own: Guest): Promise<Guest> {
  const target = await prisma.user.findFirst({
    where: { bapsId: { equals: bapsId, mode: "insensitive" }, role: "SANT", id: { not: user.id } },
    select: { ...SANT_MIRRORED_FIELDS, bapsId: true, name: true, displayName: true },
    orderBy: { bapsId: "asc" },
  });
  if (!target) return own;
  return {
    ...own,
    gender: target.gender,
    seva: target.seva,
    region: target.region,
    center: target.center,
    santAccommodationId: target.santAccommodationId,
    dataUserId: target.id,
    // Named as the Santo view names him.
    mirrorOf: { kind: "SANT", bapsId: target.bapsId, name: santName(target) },
  };
}

/**
 * Loads the signed-in guest, redirecting to the login page if there isn't one.
 * Wrapped in React cache() so the layout and page share one lookup per request.
 * A mirror tester account comes back with the mirrored person's view fields
 * (withMirror()), so every hub (or Santo) page shows that person's data: pages
 * must read per-person data from this object (the Santo pages by its
 * `dataUserId`), never from a fresh `users` lookup.
 * A volunteer account (src/lib/volunteer.ts) on any page but the schedule, the
 * menu and the profile is sent to the schedule (the page's path comes from the
 * middleware's PATH_HEADER; every page requireSant() / requireAdmin() guards
 * comes through here too).
 */
export const requireGuest = cache(async (): Promise<Guest> => {
  const session = await getSession();
  if (!session) redirect("/");
  const user = await prisma.user.findUnique({ where: { id: session.sub } });
  // The cookie is valid but the user is gone (different DB, deleted row):
  // go through a route handler that can clear the cookie, otherwise the
  // middleware would bounce "/" straight back to /dashboard forever.
  if (!user) redirect("/api/auth/expired");
  if (isVolunteer(user)) {
    const path = (await headers()).get(PATH_HEADER);
    // No path (a server action or a page the middleware doesn't cover): only the allowed pages
    // call this without one, so let it be.
    if (path !== null && !volunteerMayOpen(path)) redirect(VOLUNTEER_HOME);
  }
  return withMirror(user);
});

/**
 * Loads the signed-in Pujya Sant for the /sant pages. Not signed in -> login
 * (via requireGuest()); signed in as a delegate -> /dashboard. Cached per
 * request like requireGuest(), whose lookup it reuses. Per-person Santo reads
 * take its `dataUserId` (a Santo mirror tester's mirrored sant), writes its `id`.
 */
export const requireSant = cache(async () => {
  const user = await requireGuest();
  if (user.role !== "SANT") redirect("/dashboard");
  return user;
});

/**
 * Loads the signed-in admin for the /admin pages and layout. Not signed in ->
 * login; signed in without the ADMIN role -> their own home. Cached per request.
 */
export const requireAdmin = cache(async () => {
  const user = await requireGuest();
  if (user.role !== "ADMIN") redirect(homePathFor(user));
  return user;
});

/**
 * The signed-in admin, or null. For server actions and route handlers, which
 * should answer "forbidden" rather than redirect. Every admin mutation must
 * call this (or requireAdmin()) itself; never rely on the page having checked.
 */
export async function getAdmin() {
  const session = await getSession();
  if (!session) return null;
  const user = await prisma.user.findUnique({ where: { id: session.sub } });
  return user?.role === "ADMIN" ? user : null;
}

export type HomePath = "/admin" | "/sant" | "/dashboard" | typeof VOLUNTEER_HOME;

/**
 * Landing page after sign-in: "/admin" for admins, "/sant" for Pujya Santos, "/dashboard" for
 * delegates, the schedule for a volunteer account (src/lib/volunteer.ts).
 */
export function homePathFor(user: { role: UserRole; bapsId?: string }): HomePath {
  if (user.role === "ADMIN") return "/admin";
  if (user.role === "SANT") return "/sant";
  return user.bapsId !== undefined && isVolunteer({ role: user.role, bapsId: user.bapsId }) ? VOLUNTEER_HOME : "/dashboard";
}
