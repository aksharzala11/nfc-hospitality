/**
 * Mirror test accounts ("personas"): tester delegate accounts TEST0101-TEST0110,
 * each showing the delegate hub exactly as one real delegate sees it, chosen to
 * cover different situations (Bhaio / Behno, early Hampton / other hotels / no
 * room, with and without airport transport, a seva with no team, ...). An
 * account mirrors through users.mirror_registration_id: requireGuest() in
 * src/lib/auth.ts swaps in that delegate's track, seva, goshthi group,
 * breakouts and registration_id (so their transport and stay), while sign-in,
 * the header name and the notification read state stay the tester's own.
 *
 *   npm run testers:personas -- --plan        # read only: who each persona would mirror, and why
 *   npm run testers:personas -- --apply       # create / refresh TEST0101-TEST0110, in one transaction
 *   npm run testers:personas -- --remove      # delete TEST0101-TEST0110
 *   npm run testers:personas:lightsail -- --plan|--apply|--remove   # the shared Lightsail database
 *
 * Exactly one mode is required; any other or misspelt argument stops the script
 * before it reads anything. `--env <file>` takes DATABASE_URL from another dotenv
 * file (the :lightsail script sets it through dotenv-cli instead).
 *
 * The choice is deterministic: among a persona's candidates (DELEGATE accounts
 * with a registration_id and no tester code), narrowed to those meeting the
 * persona's preference when it has one and any do, the lowest numeric User Id
 * that no earlier persona has taken (so the accounts show different people where
 * the data allows), else the lowest overall. A persona with no candidate is
 * skipped and said so. Output never includes anyone's name, email or phone:
 * people are shown by User Id only.
 *
 * --apply writes, in one transaction, only the rows with BAPS IDs TEST0101-TEST0110:
 * role DELEGATE, name "Test · <persona>", email test-<n>@example.invalid, codes
 * by EMAIL (never sent: a tester code suppresses the send), the chosen delegate's
 * gender, seva and region (the mirror shows those anyway; stored too so the admin
 * console's reach counts and seva filter count these accounts where the hub puts
 * them), mirror_registration_id = the chosen delegate, and a tester code of its OWN
 * per account (never TEST0001's, which the README publishes). The codes live in a
 * git-ignored local JSON file (--code-file, default .tester-personas.local; the script
 * refuses a path git doesn't ignore), created with random 6-digit codes on the first
 * --apply and reused after; they are never printed, not even in an error. --apply also
 * resets each account's lockout counters. Tester codes are rationed by verifyOtp(): 5
 * tries per 15 minutes, locked until reset after 3 lockouts. A skipped persona's
 * account from an earlier run is deleted, so it can't keep mirroring someone
 * who no longer fits. No other account is ever written: if one of these BAPS
 * IDs belongs to an account this script didn't make (a registration_id, another
 * role, or neither a "Test · " name nor an @example.invalid email), nothing is
 * written. --remove deletes only this script's accounts and reports any other.
 *
 * The hub only mirrors where the app runs with ALLOW_MIRROR_TESTERS=true (see
 * mirrorTestersEnabled() in src/lib/auth.ts); elsewhere these accounts see just
 * their own row. Remove them before the event (--remove), with the other tester
 * rows, and set ALLOW_MIRROR_TESTERS=false.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomInt } from "node:crypto";
import { execFileSync } from "node:child_process";
import type { Gender, PrismaClient } from "@prisma/client";
import { isTeamCode, teamCodesFor } from "../src/lib/teams";
import { sevaWingOf } from "../src/lib/sevaMapping";

const USAGE = "Usage: npm run testers:personas -- (--plan | --apply | --remove) [--env <file>] [--code-file <file>]";

class UsageError extends Error {}

type Mode = "plan" | "apply" | "remove";
const MODES: readonly string[] = ["plan", "apply", "remove"] satisfies Mode[];
const VALUE_OPTIONS: readonly string[] = ["env", "code-file"];

/** Git-ignored JSON file holding each persona's tester code (see the header). */
const DEFAULT_CODE_FILE = ".tester-personas.local";
const NAME_PREFIX = "Test · ";
const EMAIL_DOMAIN = "@example.invalid";

function parseArgs(argv: string[]): { mode: Mode; args: Record<string, string> } {
  const args: Record<string, string> = {};
  const modes: Mode[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new UsageError(`Unexpected argument "${a}"`);
    const key = a.slice(2);
    if (MODES.includes(key)) {
      modes.push(key as Mode);
      continue;
    }
    if (!VALUE_OPTIONS.includes(key)) throw new UsageError(`Unknown option "${a}"`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new UsageError(`${a} needs a value`);
    if (args[key] !== undefined) throw new UsageError(`${a} is given more than once`);
    args[key] = value;
    i++;
  }
  if (modes.length !== 1) {
    throw new UsageError(
      modes.length === 0
        ? "Choose a mode: --plan, --apply or --remove"
        : `Choose one mode, not ${modes.map((m) => `--${m}`).join(" and ")}`,
    );
  }
  return { mode: modes[0], args };
}

function loadEnvFile(path: string) {
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[m[1]] = value;
  }
}

// ---------------------------------------------------------------------------
// People, as the personas look at them
// ---------------------------------------------------------------------------

type Leg = {
  mode: string | null;
  needsService: boolean | null;
  groupNumber: number | null;
  localDate: string | null;
  airportCode: string | null;
};

type Room = { stay: "WED" | "MAIN"; hotel: string; roomNumber: number; roomKey: string };

type Person = {
  registrationId: string;
  /** Numeric User Id for ordering (non-numeric ids last). */
  order: number;
  gender: Gender | null;
  seva: string;
  region: string | null;
  sevaWing: string | null;
  goshthiGroup: string | null;
  accommodationPackage: string | null;
  arrival: Leg | null;
  departure: Leg | null;
  rooms: Room[];
};

/** Room groups (room_key) with both a MALE and a FEMALE occupant on file. */
type Context = { mixedRooms: ReadonlySet<string> };

const isBhaio = (p: Person) => p.gender === "MALE";
const isBehno = (p: Person) => p.gender === "FEMALE";
const hasTeamSeva = (p: Person) => teamCodesFor(p.seva).some(isTeamCode);
const hasGoshthi = (p: Person) => {
  const g = (p.goshthiGroup ?? "").trim();
  return g.length > 0 && !/^#?n\/?a$/i.test(g);
};
const hasLegs = (p: Person) => p.arrival !== null || p.departure !== null;
const hasRoom = (p: Person) => p.rooms.length > 0;
const hasGroup = (leg: Leg | null) => leg !== null && leg.groupNumber !== null;

// ---------------------------------------------------------------------------
// Personas
// ---------------------------------------------------------------------------

type Persona = {
  /** 1-10: account TEST01NN. */
  n: number;
  label: string;
  /** The criteria in words, for the plan. */
  wants: string;
  match: (p: Person, ctx: Context) => boolean;
  /** Tried first among the candidates, when any meet it. */
  prefer?: { wants: string; test: (p: Person, ctx: Context) => boolean };
};

const PERSONAS: readonly Persona[] = [
  {
    n: 1,
    label: "Bhaio · early Hampton",
    wants: "Bhaio, a Wednesday (early) Hampton room",
    match: (p) => isBhaio(p) && p.rooms.some((r) => r.stay === "WED" && r.hotel === "hampton"),
    // The early arrivals are mostly sevas with no breakout team, so the team seva isn't required.
    prefer: { wants: "an arrival leg", test: (p) => p.arrival !== null },
  },
  {
    n: 2,
    label: "Bhaio · Courtyard/DoubleTree",
    wants: "Bhaio, a Courtyard or DoubleTree room from Thursday only (no Wednesday room), arriving Fri Oct 9 with no group",
    match: (p) =>
      isBhaio(p) &&
      hasRoom(p) &&
      p.rooms.every((r) => r.stay === "MAIN") &&
      p.rooms.some((r) => r.hotel === "courtyard" || r.hotel === "doubletree") &&
      p.arrival !== null &&
      p.arrival.localDate === "2026-10-09" &&
      p.arrival.groupNumber === null,
  },
  {
    n: 3,
    label: "Behno · Hilton",
    wants: "Behno, a Hilton room, an arrival leg with a group number",
    match: (p) => isBehno(p) && p.rooms.some((r) => r.hotel === "hilton") && hasGroup(p.arrival),
  },
  {
    n: 4,
    label: "Behno · transport, no room",
    wants: "Behno, transport legs but no room assignment",
    match: (p) => isBehno(p) && hasLegs(p) && !hasRoom(p),
    prefer: {
      wants: 'accommodation package "No Accommodation"',
      test: (p) => /\bno accommodation\b/i.test(p.accommodationPackage ?? ""),
    },
  },
  {
    n: 5,
    label: "Bhaio · no room or transport",
    wants: "Bhaio, no room assignment and no transport legs",
    match: (p) => isBhaio(p) && !hasRoom(p) && !hasLegs(p),
  },
  {
    n: 6,
    label: "Behno · no room or transport",
    wants: "Behno, no room assignment and no transport legs",
    match: (p) => isBehno(p) && !hasRoom(p) && !hasLegs(p),
  },
  {
    n: 7,
    label: "Seva with no team",
    wants: 'a seva that is not a breakout team (e.g. "NC", "Sant Admin")',
    match: (p) => !hasTeamSeva(p),
    prefer: { wants: "a room assignment", test: hasRoom },
  },
  {
    n: 8,
    label: "IBKY liaison",
    wants: "seva wing IBKY and gender MALE",
    match: (p) => sevaWingOf(p.sevaWing) === "IBKY" && isBhaio(p),
  },
  {
    n: 9,
    label: "Mixed room group",
    wants: "in a room group with both a MALE and a FEMALE occupant (family / couple room)",
    match: (p, ctx) => p.rooms.some((r) => ctx.mixedRooms.has(r.roomKey)),
  },
  {
    n: 10,
    label: "Driving / no pickup",
    wants: "an arrival leg with mode DRIVING or no pickup needed",
    match: (p) => p.arrival !== null && (p.arrival.mode === "DRIVING" || p.arrival.needsService === false),
  },
];

const bapsIdFor = (n: number) => `TEST01${String(n).padStart(2, "0")}`;
const PERSONA_BAPS_IDS = PERSONAS.map((p) => bapsIdFor(p.n));

type Choice = {
  persona: Persona;
  bapsId: string;
  candidates: number;
  preferred: number | null;
  chosen: Person | null;
  /** Taken by an earlier persona too (every candidate already was). */
  sharedWith: string | null;
};

function numericOrder(id: string): number {
  return /^\d+$/.test(id) ? Number(id) : Number.POSITIVE_INFINITY;
}

function byUserId(a: Person, b: Person): number {
  return a.order - b.order || a.registrationId.localeCompare(b.registrationId);
}

/**
 * Deterministic: the preferred candidates if any (else all), then the lowest User Id no
 * earlier persona took, else the lowest User Id (shared with that earlier persona).
 */
function choose(people: readonly Person[], ctx: Context): Choice[] {
  const taken = new Map<string, string>(); // registrationId -> bapsId of the persona that took it
  return PERSONAS.map((persona) => {
    const bapsId = bapsIdFor(persona.n);
    const candidates = people.filter((p) => persona.match(p, ctx)).sort(byUserId);
    const preferredList = persona.prefer ? candidates.filter((p) => persona.prefer!.test(p, ctx)) : [];
    const pool = preferredList.length > 0 ? preferredList : candidates;
    const chosen = pool.find((p) => !taken.has(p.registrationId)) ?? pool[0] ?? null;
    const sharedWith = chosen ? (taken.get(chosen.registrationId) ?? null) : null;
    if (chosen && !sharedWith) taken.set(chosen.registrationId, bapsId);
    return {
      persona,
      bapsId,
      candidates: candidates.length,
      preferred: persona.prefer ? preferredList.length : null,
      chosen,
      sharedWith,
    };
  });
}

// ---------------------------------------------------------------------------
// Reading the database
// ---------------------------------------------------------------------------

async function loadPeople(prisma: PrismaClient): Promise<{ people: Person[]; ctx: Context; legs: number; rooms: number }> {
  const [users, legs, assignments] = await Promise.all([
    // Everyone with a User Id (for the room genders); candidates are narrowed below.
    prisma.user.findMany({
      where: { registrationId: { not: null } },
      select: {
        registrationId: true,
        role: true,
        testCode: true,
        gender: true,
        seva: true,
        region: true,
        sevaWing: true,
        goshthiGroup: true,
        accommodationPackage: true,
      },
    }),
    prisma.transportLeg.findMany({
      select: {
        registrationId: true,
        direction: true,
        mode: true,
        needsService: true,
        groupNumber: true,
        localDate: true,
        airportCode: true,
      },
    }),
    prisma.roomAssignment.findMany({ select: { registrationId: true, stay: true, hotel: true, roomNumber: true, roomKey: true } }),
  ]);

  const genderOf = new Map(users.map((u) => [u.registrationId!.trim(), u.gender]));
  const genders = new Map<string, Set<Gender>>();
  for (const a of assignments) {
    const g = genderOf.get(a.registrationId.trim());
    if (!g) continue;
    const set = genders.get(a.roomKey) ?? new Set<Gender>();
    set.add(g);
    genders.set(a.roomKey, set);
  }
  const mixedRooms = new Set([...genders].filter(([, s]) => s.has("MALE") && s.has("FEMALE")).map(([k]) => k));

  const legsOf = new Map<string, { arrival: Leg | null; departure: Leg | null }>();
  for (const l of legs) {
    const id = l.registrationId.trim();
    const entry = legsOf.get(id) ?? { arrival: null, departure: null };
    const leg: Leg = {
      mode: l.mode,
      needsService: l.needsService,
      groupNumber: l.groupNumber,
      localDate: l.localDate,
      airportCode: l.airportCode,
    };
    if (l.direction === "ARRIVAL") entry.arrival = leg;
    else entry.departure = leg;
    legsOf.set(id, entry);
  }
  const roomsOf = new Map<string, Room[]>();
  for (const a of assignments) {
    const id = a.registrationId.trim();
    roomsOf.set(id, [...(roomsOf.get(id) ?? []), { stay: a.stay, hotel: a.hotel, roomNumber: a.roomNumber, roomKey: a.roomKey }]);
  }

  // Candidates: delegates the mirror can show (requireGuest() needs a DELEGATE), never another tester.
  const people: Person[] = users
    .filter((u) => u.role === "DELEGATE" && u.testCode === null)
    .map((u) => {
      const id = u.registrationId!.trim();
      const l = legsOf.get(id);
      return {
        registrationId: id,
        order: numericOrder(id),
        gender: u.gender,
        seva: u.seva,
        region: u.region,
        sevaWing: u.sevaWing,
        goshthiGroup: u.goshthiGroup,
        accommodationPackage: u.accommodationPackage,
        arrival: l?.arrival ?? null,
        departure: l?.departure ?? null,
        rooms: (roomsOf.get(id) ?? []).sort((a, b) => (a.stay === b.stay ? 0 : a.stay === "WED" ? -1 : 1)),
      };
    })
    .sort(byUserId);

  return { people, ctx: { mixedRooms }, legs: legs.length, rooms: assignments.length };
}

// ---------------------------------------------------------------------------
// Printing (User Ids and facts only: never names, emails or phones)
// ---------------------------------------------------------------------------

function legText(label: string, leg: Leg | null): string {
  if (!leg) return `no ${label}`;
  const bits = [
    leg.airportCode ?? "airport ?",
    leg.localDate ?? "date ?",
    leg.groupNumber !== null ? `group ${leg.groupNumber}` : "no group",
    leg.mode ?? "mode ?",
    leg.needsService === null ? "service ?" : leg.needsService ? "service yes" : "service no",
  ];
  return `${label} ${bits.join(" ")}`;
}

function facts(p: Person, ctx: Context): string[] {
  const track = p.gender === "MALE" ? "Bhaio" : p.gender === "FEMALE" ? "Behno" : "no gender (both tracks)";
  const rooms = p.rooms.length
    ? p.rooms
        .map((r) => `${r.stay} ${r.hotel} group ${r.roomNumber}${ctx.mixedRooms.has(r.roomKey) ? " (mixed)" : ""}`)
        .join(", ")
    : "no room";
  return [
    `${track} · seva wing ${p.sevaWing ?? "-"} · seva "${p.seva}" (${hasTeamSeva(p) ? "team" : "no team"}) · ${
      hasGoshthi(p) ? `goshthi "${p.goshthiGroup}"` : "no goshthi group"
    }`,
    `${rooms} · package ${p.accommodationPackage ? `"${p.accommodationPackage}"` : "-"}`,
    `${legText("arrival", p.arrival)} · ${legText("departure", p.departure)}`,
  ];
}

function printPlan(choices: readonly Choice[], ctx: Context) {
  for (const c of choices) {
    console.log("");
    console.log(`  ${c.bapsId}  ${c.persona.label}`);
    console.log(`    wants: ${c.persona.wants}`);
    const pref =
      c.preferred !== null ? `, ${c.preferred} with ${c.persona.prefer!.wants}${c.preferred === 0 ? " (none: any candidate)" : ""}` : "";
    console.log(`    candidates: ${c.candidates}${pref}`);
    if (!c.chosen) {
      console.log("    -> SKIPPED: no candidate");
      continue;
    }
    const shared = c.sharedWith ? ` (also ${c.sharedWith}: every candidate was already taken)` : "";
    console.log(`    -> User Id ${c.chosen.registrationId}${shared}`);
    for (const line of facts(c.chosen, ctx)) console.log(`       ${line}`);
  }
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

type ExistingTester = {
  id: string;
  bapsId: string;
  name: string;
  email: string | null;
  role: string;
  registrationId: string | null;
};

/** An account this script made (so it may rewrite or delete it). */
function isOurs(u: ExistingTester): boolean {
  return (
    u.role === "DELEGATE" &&
    u.registrationId === null &&
    (u.name.startsWith(NAME_PREFIX) || (u.email ?? "").toLowerCase().endsWith(EMAIL_DOMAIN))
  );
}

const EXISTING_SELECT = { id: true, bapsId: true, name: true, email: true, role: true, registrationId: true } as const;

/**
 * Several sequential round trips to a remote database (Lightsail): Prisma's 5 s default
 * would close the transaction on a slow link, as in the other scripts that write there.
 */
const TX_OPTIONS = { maxWait: 20_000, timeout: 60_000 } as const;

/**
 * The personas' tester codes, redacted from anything main() prints (a Prisma error
 * message can quote a call's arguments).
 */
let personaCodes: string[] = [];

/** True when git ignores `path` (so the codes can't be committed or uploaded by deploy-vercel.mjs). */
function gitIgnores(path: string): boolean {
  try {
    execFileSync("git", ["check-ignore", "-q", path], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * One tester code per persona account, from the JSON file at `path` ({ "TEST0101": "123456", ... });
 * missing entries get a new random 6-digit code and the file is rewritten (owner-only
 * permissions where the OS supports them). Never printed.
 */
function loadOrCreateCodes(path: string, bapsIds: readonly string[]): { codes: Record<string, string>; created: string[] } {
  if (!gitIgnores(path)) {
    throw new Error(`${path} is not git-ignored, so the codes could be committed or deployed: nothing was written. Use the default (.tester-personas.local) or add the path to .gitignore.`);
  }
  let codes: Record<string, string> = {};
  if (existsSync(path)) {
    try {
      codes = JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
    } catch {
      throw new Error(`${path} isn't the persona code file (JSON): nothing was written.`);
    }
    for (const [id, code] of Object.entries(codes)) {
      if (!/^\d{6}$/.test(String(code))) throw new Error(`${path}: the entry for ${id} isn't a 6-digit code: nothing was written.`);
    }
  }
  const created: string[] = [];
  for (const id of bapsIds) {
    if (codes[id]) continue;
    codes[id] = String(randomInt(0, 1_000_000)).padStart(6, "0");
    created.push(id);
  }
  if (created.length > 0) writeFileSync(path, `${JSON.stringify(codes, null, 2)}\n`, { mode: 0o600 });
  return { codes, created };
}

async function apply(prisma: PrismaClient, choices: readonly Choice[], codes: Record<string, string>) {
  return prisma.$transaction(async (tx) => {

    const existing = new Map(
      (await tx.user.findMany({ where: { bapsId: { in: PERSONA_BAPS_IDS } }, select: EXISTING_SELECT })).map((u) => [u.bapsId, u]),
    );
    const foreign = [...existing.values()].filter((u) => !isOurs(u));
    if (foreign.length > 0) {
      throw new Error(
        `Refused: ${foreign.map((u) => `${u.bapsId} (${u.role})`).join(", ")} ` +
          "belong to accounts this script didn't make. Nothing was written.",
      );
    }

    const written: string[] = [];
    const deleted: string[] = [];
    for (const c of choices) {
      if (!c.chosen) {
        if (existing.has(c.bapsId)) {
          await tx.user.delete({ where: { bapsId: c.bapsId } });
          deleted.push(c.bapsId);
        }
        continue;
      }
      const data = {
        name: `${NAME_PREFIX}${c.persona.label}`,
        displayName: null,
        // As the mirror shows them, so admin counts (announcement reach, the seva filter)
        // place this account where the hub does. Re-run --apply after a re-import.
        seva: c.chosen.seva,
        email: `test-${c.bapsId.slice(4)}${EMAIL_DOMAIN}`,
        phone: null,
        gender: c.chosen.gender,
        region: c.chosen.region,
        breakoutSessions: [],
        preferredChannel: "EMAIL" as const,
        role: "DELEGATE" as const,
        testCode: codes[c.bapsId],
        // A fresh start for the lockout (verifyOtp()).
        testCodeFailures: 0,
        testCodeLockouts: 0,
        testCodeLockedUntil: null,
        mirrorRegistrationId: c.chosen.registrationId,
      };
      await tx.user.upsert({ where: { bapsId: c.bapsId }, create: { bapsId: c.bapsId, ...data }, update: data });
      written.push(`${c.bapsId} -> User Id ${c.chosen.registrationId}${existing.has(c.bapsId) ? " (updated)" : " (created)"}`);
    }
    return { written, deleted };
  }, TX_OPTIONS);
}

async function remove(prisma: PrismaClient) {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.user.findMany({ where: { bapsId: { in: PERSONA_BAPS_IDS } }, select: EXISTING_SELECT });
    const ours = rows.filter(isOurs);
    const others = rows.filter((u) => !isOurs(u));
    if (ours.length > 0) await tx.user.deleteMany({ where: { id: { in: ours.map((u) => u.id) } } });
    return { deleted: ours.map((u) => u.bapsId).sort(), leftAlone: others.map((u) => `${u.bapsId} (${u.role})`).sort() };
  }, TX_OPTIONS);
}

// ---------------------------------------------------------------------------

async function main() {
  const { mode, args } = parseArgs(process.argv.slice(2));
  // Only with --env: the :lightsail script sets DATABASE_URL through dotenv-cli,
  // which loading .env here would override.
  if (args.env) loadEnvFile(args.env);
  // Import after the env file is loaded so DATABASE_URL is picked up.
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    if (mode === "remove") {
      const r = await remove(prisma);
      const host = (process.env.DATABASE_URL ?? "the .env database").replace(/\/\/.*@/, "//***@");
      console.log(`Tester personas removed from ${host}`);
      console.log(`  Deleted: ${r.deleted.length ? r.deleted.join(", ") : "none"}`);
      if (r.leftAlone.length) console.log(`  Left alone (not made by this script): ${r.leftAlone.join(", ")}`);
      return;
    }

    const { people, ctx, legs, rooms } = await loadPeople(prisma);
    // Read after the first query: Prisma loads .env itself when DATABASE_URL isn't set.
    const host = (process.env.DATABASE_URL ?? "the .env database").replace(/\/\/.*@/, "//***@");
    const choices = choose(people, ctx);

    console.log(`Tester personas (${mode === "plan" ? "plan only, nothing written" : "apply"}): ${host}`);
    console.log(
      `  ${people.length} delegates with a User Id (testers excluded) · ${legs} transport legs · ` +
        `${rooms} room assignments · ${ctx.mixedRooms.size} mixed room groups`,
    );
    console.log(
      "  Choice: the lowest User Id among each persona's candidates (its preferred ones, when any), " +
        "skipping people an earlier persona took while others remain.",
    );
    printPlan(choices, ctx);

    const skipped = choices.filter((c) => !c.chosen);
    console.log("");
    console.log(
      `  ${choices.length - skipped.length} of ${choices.length} personas have a delegate` +
        (skipped.length ? `; skipped: ${skipped.map((c) => `${c.bapsId} ${c.persona.label}`).join(", ")}` : ""),
    );
    if (mode === "plan") return;

    const codeFile = args["code-file"] ?? DEFAULT_CODE_FILE;
    const { codes, created } = loadOrCreateCodes(codeFile, choices.filter((c) => c.chosen).map((c) => c.bapsId));
    personaCodes = Object.values(codes);
    const r = await apply(prisma, choices, codes);
    console.log("");
    console.log(`Written (each account's own tester code, in ${codeFile}${created.length ? `; new codes for ${created.join(", ")}` : ""}):`);
    for (const line of r.written) console.log(`  ${line}`);
    if (r.deleted.length) console.log(`Deleted (persona now has no candidate): ${r.deleted.join(", ")}`);
    console.log("");
    console.log(`Sign in with one of these BAPS IDs and its code from ${codeFile} (not shown here; keep the file private).`);
    console.log("The hub mirrors only where the app runs with ALLOW_MIRROR_TESTERS=true; set it back to false before the event.");
  } finally {
    await prisma.$disconnect();
  }
}

/** An error's message with the copied tester code blanked out. */
function safeMessage(e: unknown): string {
  // A validation error's message quotes the whole call, arguments and values included
  // (whatever the errorFormat), so print a fixed line instead.
  if (e instanceof Error && e.name === "PrismaClientValidationError") {
    return "Prisma rejected the query: the Prisma client is probably out of date. Run `npx prisma generate` and try again.";
  }
  const text = e instanceof Error ? e.message : String(e);
  return personaCodes.reduce((t, c) => t.split(c).join("******"), text);
}

main().catch((e) => {
  console.error(safeMessage(e));
  if (e instanceof UsageError) console.error(USAGE);
  const code = (e as { code?: string })?.code;
  // P2021: a table is missing; P2022: a column (users.mirror_registration_id) is.
  if (code === "P2021" || code === "P2022") {
    console.error("The database schema is behind: run `npm run db:push` (or `npm run db:push:lightsail`) first.");
  }
  process.exit(1);
});
