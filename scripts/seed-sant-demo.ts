/**
 * Create or refresh the tester Pujya Sant account SANTO0001 with clearly-sample
 * data, so the /sant view can be tried end to end:
 *   - users row: role SANT, gender MALE, name "Sadhu Testdas" (the Santo view
 *     shows "Testdas"), fixed tester code (always accepted, nothing is emailed
 *     or texted; works exactly like TEST0001's)
 *   - a personal schedule, Thu Oct 8 – Sun Oct 11, around the general programme
 *   - a shared sample utaro (sant_accommodations row "sample-utaro") where he
 *     is placed together with two sample santos, SANTO0002 "Sadhu Sampledas"
 *     and SANTO0003 "Sadhu Demodas". They have no tester code, email or phone,
 *     so nobody can sign in as them; they only fill "Staying with you".
 *   - the placeholder transport hotline (hotlines row "sample-transport-hotline")
 *
 * No Santo menu: the real one is synced from prisma/sant-menu-data.ts
 * (`npm run sant:menu:sync`, and the seed). Older versions of this script made a
 * sample menu (meals "sample-santo-meal-*"); a run now deletes any left over and
 * never touches the real meals ("sm-*").
 *
 * No Santo breakouts: santos have no breakout sessions of their own (user,
 * 2026-10-02); /sant/breakouts lists the real Bhaio team breakouts they can join
 * (src/lib/santBreakouts.ts). Older versions of this script made sample Santo
 * breakouts (ids "sample-santo-breakout-*"); a run now deletes any left over and
 * never touches the real team breakouts ("bk-*").
 *
 * Safe to run repeatedly: SANTO0001's personal schedule, the sample santos, the
 * sample utaro and the "sample-*" hotline rows are replaced each time (as are
 * sample utaros left by older versions of this script: "(sample)" in the name).
 * Placeholders never sit next to real data: the hotline is only added while no
 * real SANT hotline exists.
 *
 *   npm run sant:demo                                    # DATABASE_URL from .env (local)
 *   npm run sant:demo -- --env .env.lightsail            # shared Lightsail database
 *   npm run sant:demo -- --env .env.lightsail --remove   # delete all of it
 *   npm run sant:demo -- --env .env.lightsail --mirror <BAPS ID>   # SANTO0001 mirrors that sant
 *   npm run sant:demo -- --env .env.lightsail --mirror off         # ... and stops
 *
 * --mirror <BAPS ID> (user, 2026-10-02) makes SANTO0001 a Santo mirror test
 * account: it sets only his users.mirror_registration_id, to the BAPS ID of a
 * real Pujya Sant (case-insensitive; refused, with nothing written, unless
 * exactly one other SANT has it and SANTO0001 is this script's sample sant).
 * While the server has ALLOW_MIRROR_TESTERS=true, signing in as SANTO0001 then
 * shows the Santo view with that sant's personal programme, rides, utaro (and
 * companions), seva and region, under a band naming him (withMirror() in
 * src/lib/auth.ts); his own name, sign-in, bell and read state stay SANTO0001's.
 * Nothing else is touched (no demo rows, no tester code change). `--mirror off`
 * clears it; --mirror can't be combined with --remove. A plain run keeps the
 * mirror as it is (and says so). Like the delegate mirror testers, it shows a
 * real sant's utaro and programme behind a static code: clear it (or --remove)
 * and switch ALLOW_MIRROR_TESTERS off after testing, before the event.
 *
 * Sign in with BAPS ID SANTO0001 and code 604613.
 *
 * Before the event, run it with --remove. That deletes SANTO0001–SANTO0003
 * (their personal schedules go with them, and SANTO0001's mirror with him),
 * the sample utaro, and every
 * "sample-*" hotline, meal (a sample menu left by an older version, with its
 * menu items) and breakout row (sample Santo breakouts left by an older version,
 * "sample-santo-breakout-*"), and prints what it removed. Nothing else is
 * deleted: an account using one of those BAPS IDs that isn't this script's
 * sample sant (another role or name) is left alone and reported, hotline, meal
 * and breakout rows whose id does not start with "sample-" (such as the real
 * "transport-hotline" and the real Santo menu, "sm-*") are never touched, and
 * neither are real utaros (made with `npm run sant:utaro`).
 */
import { readFileSync } from "node:fs";
import type { Prisma, PrismaClient, ScheduleKind } from "@prisma/client";
import { santName } from "../src/lib/santName";

const BAPS_ID = "SANTO0001";
/** The options this script takes; anything else is refused (a typo would otherwise run the whole demo). */
const OPTIONS = new Set(["env", "remove", "mirror"]);
/** A BAPS ID's shape once upper-cased, as BAPS_ID_PATTERN in src/lib/admin/delegates.ts checks it. */
const BAPS_ID_SHAPE = /^[A-Z0-9](?:[A-Z0-9.]{1,30})[A-Z0-9]$/;
const TEST_CODE = "604613";
const SAMPLE_ID_PREFIX = "sample-";
/** Seva of the sample santos, as scripts/import-santos.ts gives the real ones. */
const SANT_SEVA = "Pujya Santo";

// October is EDT (UTC-4) in New Jersey, as in prisma/seed.ts.
const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00-04:00`);
const THU = "2026-10-08";
const FRI = "2026-10-09";
const SAT = "2026-10-10";
const SUN = "2026-10-11";

const santUser = {
  role: "SANT",
  name: "Sadhu Testdas",
  // No display name: the Santo view shows santName(), i.e. "Testdas".
  displayName: null,
  seva: SANT_SEVA,
  gender: "MALE",
  email: null,
  phone: null,
  preferredChannel: "EMAIL",
  region: null,
  breakoutSessions: [],
  testCode: TEST_CODE,
  // A fresh start for the tester lockout (verifyOtp()).
  testCodeFailures: 0,
  testCodeLockouts: 0,
  testCodeLockedUntil: null,
} satisfies Omit<Prisma.UserCreateInput, "bapsId">;

/**
 * Sample santos placed at the same utaro as SANTO0001. No tester code, email
 * or phone, so the login page answers "no contact on file" for them.
 */
const companionSantos = [
  { bapsId: "SANTO0002", name: "Sadhu Sampledas" },
  { bapsId: "SANTO0003", name: "Sadhu Demodas" },
] as const;

const companionUser = {
  role: "SANT",
  displayName: null,
  seva: SANT_SEVA,
  gender: "MALE",
  email: null,
  phone: null,
  preferredChannel: "EMAIL",
  region: null,
  breakoutSessions: [],
  testCode: null,
} satisfies Omit<Prisma.UserCreateInput, "bapsId" | "name">;

type PersonalSeed = { day: string; start: string; end: string; title: string; kind: ScheduleKind; location?: string; description?: string };

// Interleaves with the general programme in prisma/seed.ts (arrival Thursday
// evening, keynotes Fri/Sat, Akshardham Robbinsville on Sunday).
const personalSchedule: PersonalSeed[] = [
  // ---- Thursday, Oct 8 (arrival) ----
  { day: THU, start: "13:30", end: "14:15", title: "Airport pickup to utaro", kind: "TRAVEL", location: "Newark Airport (EWR), Terminal C", description: "Sample entry. Your driver meets you at arrivals; call the transport hotline if your flight changes." },
  { day: THU, start: "14:15", end: "16:15", title: "Rest at utaro", kind: "BREAK", location: "Utaro", description: "Sample entry." },
  { day: THU, start: "16:15", end: "16:45", title: "Drive to mandir", kind: "TRAVEL", location: "Utaro → Mandir", description: "Sample entry." },
  { day: THU, start: "17:00", end: "17:45", title: "Meeting with the organising team", kind: "SESSION", location: "Mandir office", description: "Sample entry. Welcome and a walk-through of the NAAM programme." },

  // ---- Friday, Oct 9 ----
  { day: FRI, start: "05:30", end: "06:15", title: "Thakorji puja", kind: "ARTI", location: "Utaro", description: "Sample entry. Morning puja before leaving for the mandir." },
  { day: FRI, start: "11:00", end: "12:00", title: "Meeting with regional coordinators", kind: "SESSION", location: "Mandir, Conference Room 2", description: "Sample entry. During the Team Breakouts." },
  { day: FRI, start: "15:00", end: "16:15", title: "Rest", kind: "BREAK", location: "Sant ashram, mandir", description: "Sample entry." },
  { day: FRI, start: "17:45", end: "18:15", title: "Pravachan in Keynote Program 2", kind: "SESSION", location: "Main Hall, stage", description: "Sample entry. 30-minute pravachan; please be backstage by 5:30 PM." },

  // ---- Saturday, Oct 10 ----
  { day: SAT, start: "05:30", end: "06:15", title: "Thakorji puja", kind: "ARTI", location: "Utaro", description: "Sample entry." },
  { day: SAT, start: "09:30", end: "10:15", title: "Pravachan in Keynote Program 3", kind: "SESSION", location: "Main Hall, stage", description: "Sample entry. 45-minute pravachan; please be backstage by 9:15 AM." },
  { day: SAT, start: "12:30", end: "13:30", title: "Lunch with the santos", kind: "MEAL", location: "Sant ashram, mandir", description: "Sample entry." },
  { day: SAT, start: "15:30", end: "16:15", title: "Review with the organising team", kind: "SESSION", location: "Mandir office", description: "Sample entry. Feedback on the first two days." },

  // ---- Sunday, Oct 11 (departures) ----
  { day: SUN, start: "05:30", end: "06:15", title: "Thakorji puja", kind: "ARTI", location: "Utaro", description: "Sample entry. Departure from the utaro after puja." },
  { day: SUN, start: "11:30", end: "12:30", title: "Lunch with the santos", kind: "MEAL", location: "Akshardham, Robbinsville", description: "Sample entry." },
  { day: SUN, start: "13:30", end: "14:45", title: "Drive to Newark airport (EWR)", kind: "TRAVEL", location: "Akshardham, Robbinsville → EWR", description: "Sample entry. Driver collects you at the main entrance at 1:30 PM for a 4:30 PM flight." },
];

const SAMPLE_UTARO_ID = `${SAMPLE_ID_PREFIX}utaro`;

const sampleUtaro = {
  placeName: "Patel residence (sample)",
  address: "(sample) 12 Example Lane, Edison, NJ 08817",
  hostName: "Rajeshbhai Patel (sample)",
  hostPhone: "+17325550117",
  notes: "Sample data for testing. Thakorji puja is set up in the front room. Utaro sevak Mihirbhai is on call 5 AM – 11 PM at (732) 555-0123.",
} satisfies Omit<Prisma.SantAccommodationCreateInput, "id" | "santos">;

const sampleHotline = {
  id: `${SAMPLE_ID_PREFIX}transport-hotline`,
  label: "Transport hotline",
  contactName: "Transport team (placeholder number)",
  phone: "+17325550142",
  availability: "24/7 during NAAM",
  role: "SANT",
  sortOrder: 0,
} satisfies Prisma.HotlineCreateInput;

// The sample Santo menu older versions of this script made (meals.menu_for = SANT).
// The real menu ("sm-*" ids) comes from `npm run sant:menu:sync`.
const SAMPLE_MEAL_PREFIX = `${SAMPLE_ID_PREFIX}santo-meal-`;

// The sample Santo breakouts older versions of this script made (santos now have no sessions of
// their own). The real team breakouts ("bk-*" ids) come from `npm run breakouts:sync`.
const SAMPLE_BREAKOUT_PREFIX = `${SAMPLE_ID_PREFIX}santo-breakout-`;

/**
 * `--name value` / `--name` (= "true") pairs, plus every argument that is neither an option nor
 * the value after one (`stray`: "-mirror", or a lone "AS1801" when npm took the flag because the
 * `--` separator was left out), which main() refuses like an unknown option.
 */
function parseArgs(argv: string[]) {
  const options: Record<string, string> = {};
  const stray: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--") || a.length === 2) {
      stray.push(a);
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      options[a.slice(2)] = next;
      i++;
    } else options[a.slice(2)] = "true";
  }
  return { options, stray };
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

type Tx = Prisma.TransactionClient;

/**
 * Deletes a sample Santo menu left by an older version of this script (meals "sample-santo-meal-*"
 * and, on delete cascade, their dishes), and counts the real Santo meals. Never creates one.
 */
async function removeLeftoverSampleMenu(tx: Tx) {
  const removed = await tx.meal.deleteMany({ where: { id: { startsWith: SAMPLE_MEAL_PREFIX }, menuFor: "SANT" } });
  const real = await tx.meal.count({ where: { menuFor: "SANT" } });
  return { real, removed: removed.count };
}

/**
 * Deletes the sample Santo breakouts an older version of this script made ("sample-santo-breakout-*").
 * Never creates any: santos have no breakout sessions of their own.
 */
async function removeLeftoverSampleBreakouts(tx: Tx) {
  const removed = await tx.breakout.deleteMany({ where: { id: { startsWith: SAMPLE_BREAKOUT_PREFIX } } });
  return { removed: removed.count };
}

/** --remove: deletes all of the demo data this script creates, and nothing else. */
async function removeDemo(prisma: PrismaClient) {
  const sampleNames = new Map<string, string>([
    [BAPS_ID, santUser.name],
    ...companionSantos.map((c): [string, string] => [c.bapsId, c.name]),
  ]);
  const r = await prisma.$transaction(
    async (tx) => {
      // The sample santos: their BAPS ID with role SANT and the sample name. An
      // account that uses one of those BAPS IDs otherwise is real: left alone.
      const found = await tx.user.findMany({
        where: { bapsId: { in: [...sampleNames.keys()] } },
        select: { id: true, bapsId: true, name: true, role: true, mirrorRegistrationId: true },
        orderBy: { bapsId: "asc" },
      });
      const santos = found.filter((u) => u.role === "SANT" && u.name === sampleNames.get(u.bapsId));
      const skipped = found.filter((u) => !santos.includes(u));
      const santoIds = santos.map((u) => u.id);
      const personalItems = await tx.santScheduleItem.count({ where: { userId: { in: santoIds } } });
      // Their personal schedules and sign-in codes go with them (on delete cascade).
      await tx.user.deleteMany({ where: { id: { in: santoIds } } });

      // The sample utaro and any left by older versions of this script. Read
      // after the santos are gone: anyone still placed there ends up unplaced.
      const utaros = await tx.santAccommodation.findMany({
        where: { OR: [{ id: { startsWith: SAMPLE_ID_PREFIX } }, { placeName: { contains: "(sample)" } }] },
        select: { id: true, placeName: true, santos: { select: { bapsId: true, name: true } } },
      });
      await tx.santAccommodation.deleteMany({ where: { id: { in: utaros.map((u) => u.id) } } });

      // Their menu items go with them (on delete cascade).
      const meals = await tx.meal.findMany({
        where: { id: { startsWith: SAMPLE_ID_PREFIX } },
        select: { id: true, _count: { select: { items: true } } },
      });
      await tx.meal.deleteMany({ where: { id: { in: meals.map((m) => m.id) } } });

      const breakoutIds = (
        await tx.breakout.findMany({ where: { id: { startsWith: SAMPLE_ID_PREFIX } }, select: { id: true } })
      ).map((b) => b.id);
      await tx.breakout.deleteMany({ where: { id: { in: breakoutIds } } });
      // Accounts still listing a removed session in breakout_sessions (not changed here).
      const stillLinked = breakoutIds.length
        ? await tx.user.findMany({ where: { breakoutSessions: { hasSome: breakoutIds } }, select: { bapsId: true } })
        : [];

      const hotlineIds = (
        await tx.hotline.findMany({ where: { id: { startsWith: SAMPLE_ID_PREFIX } }, select: { id: true } })
      ).map((h) => h.id);
      await tx.hotline.deleteMany({ where: { id: { in: hotlineIds } } });

      return { santos, skipped, personalItems, utaros, meals, breakoutIds, stillLinked, hotlineIds };
    },
    { timeout: 60_000 },
  );

  const list = (items: string[]) => (items.length ? items.join(", ") : "none");
  const dishes = r.meals.reduce((n, m) => n + m._count.items, 0);
  console.log("Removed the demo data:");
  console.log(
    `  Santos: ${list(r.santos.map((u) => `${u.bapsId} ${u.name}`))}` +
      (r.santos.length ? `, with ${r.personalItems} personal schedule item(s)` : ""),
  );
  const mirrored = r.santos.find((u) => u.bapsId === BAPS_ID)?.mirrorRegistrationId?.trim();
  if (mirrored) console.log(`  Mirror: ${BAPS_ID} mirrored ${mirrored}; that ends with him.`);
  console.log(`  Utaros: ${list(r.utaros.map((u) => `${u.id} "${u.placeName}"`))}`);
  console.log(`  Meals: ${r.meals.length} sample meal(s) with ${dishes} menu item(s)`);
  console.log(`  Breakouts: ${r.breakoutIds.length} sample session(s)`);
  console.log(`  Hotlines: ${list(r.hotlineIds)}`);
  for (const u of r.skipped) {
    console.log(`Left alone: ${u.bapsId} "${u.name}" (role ${u.role}) is not a sample sant made by this script.`);
  }
  const unplaced = r.utaros.flatMap((u) => u.santos.map((s) => `${s.bapsId} ${s.name}`));
  if (unplaced.length) console.log(`Note: placed at a sample utaro, so now at none: ${list(unplaced)}.`);
  if (r.stillLinked.length) {
    console.log(`Note: removed sample breakouts are still in the breakout_sessions of ${list(r.stillLinked.map((u) => u.bapsId))}.`);
  }
}

/** The default: creates or refreshes all of the demo data. */
async function createDemo(prisma: PrismaClient) {
  const result = await prisma.$transaction(
    async (tx) => {
      // Never overwrite a real account that happens to use a sample BAPS ID.
      const clash = await tx.user.findMany({
        where: { OR: companionSantos.map((c) => ({ bapsId: c.bapsId, NOT: { name: c.name } })) },
        select: { bapsId: true, name: true },
      });
      if (clash.length > 0) {
        const who = clash.map((u) => `${u.bapsId} ("${u.name}")`).join(", ");
        throw new Error(`Refusing to overwrite ${who}: not a sample sant created by this script.`);
      }

      // One shared sample utaro. Sample utaros from older versions of this
      // script (one per sant, cuid ids) are removed; real ones are left alone.
      const leftovers = await tx.santAccommodation.deleteMany({
        where: {
          id: { not: SAMPLE_UTARO_ID },
          OR: [{ id: { startsWith: SAMPLE_ID_PREFIX } }, { placeName: { contains: "(sample)" } }],
        },
      });
      const utaro = await tx.santAccommodation.upsert({
        where: { id: SAMPLE_UTARO_ID },
        create: { id: SAMPLE_UTARO_ID, ...sampleUtaro },
        update: sampleUtaro,
        // Only the id: a whole row would name columns a database may not have yet (host_telegram).
        select: { id: true },
      });
      const placed = { santAccommodation: { connect: { id: utaro.id } } };

      const user = await tx.user.upsert({
        where: { bapsId: BAPS_ID },
        create: { bapsId: BAPS_ID, ...santUser, ...placed },
        update: { ...santUser, ...placed },
      });
      for (const c of companionSantos) {
        const data = { ...companionUser, name: c.name, ...placed };
        await tx.user.upsert({ where: { bapsId: c.bapsId }, create: { bapsId: c.bapsId, ...data }, update: data });
      }

      const removed = await tx.santScheduleItem.deleteMany({ where: { userId: user.id } });
      const created = await tx.santScheduleItem.createMany({
        data: personalSchedule.map((s, i) => ({
          userId: user.id,
          title: s.title,
          description: s.description ?? null,
          location: s.location ?? null,
          kind: s.kind,
          startsAt: at(s.day, s.start),
          endsAt: at(s.day, s.end),
          sortOrder: i,
        })),
      });

      // Replace only our own placeholder rows; leave real hotlines alone.
      const realHotlines = await tx.hotline.count({
        where: { role: "SANT", NOT: { id: { startsWith: SAMPLE_ID_PREFIX } } },
      });
      await tx.hotline.deleteMany({ where: { id: { startsWith: SAMPLE_ID_PREFIX } } });
      // A new hotlines row writes the topic / track columns (their defaults), so a database not
      // pushed since 2026-10-01 refuses this insert (P2022: main() then says to run db:push).
      if (realHotlines === 0) await tx.hotline.create({ data: sampleHotline, select: { id: true } });

      const menu = await removeLeftoverSampleMenu(tx);
      const breakouts = await removeLeftoverSampleBreakouts(tx);

      const santosThere = await tx.user.findMany({
        where: { santAccommodationId: utaro.id },
        select: { bapsId: true, name: true },
        orderBy: { bapsId: "asc" },
      });

      return {
        user,
        removed: removed.count,
        created: created.count,
        realHotlines,
        leftovers: leftovers.count,
        santosThere,
        menu,
        breakouts,
      };
    },
    { timeout: 60_000 },
  );

  const { user, menu, breakouts } = result;
  console.log(`${user.bapsId} ready: ${user.name}, role ${user.role}, seva ${user.seva}.`);
  console.log(`Sign in with BAPS ID ${user.bapsId} and tester code ${TEST_CODE} (nothing is sent).`);
  console.log(`Personal schedule: removed ${result.removed}, created ${result.created} items.`);
  console.log(
    `Utaro: ${sampleUtaro.placeName} (id ${SAMPLE_UTARO_ID}) with ` +
      result.santosThere.map((s) => `${s.bapsId} ${s.name}`).join(", ") +
      `. ${companionSantos.map((c) => c.bapsId).join(" and ")} cannot sign in (no code, email or phone).`,
  );
  if (result.leftovers > 0) console.log(`Removed ${result.leftovers} older sample utaro row(s).`);
  console.log(
    result.realHotlines === 0
      ? `Hotline: placeholder "${sampleHotline.label}" ${sampleHotline.phone} (id ${sampleHotline.id}).`
      : `Hotline: ${result.realHotlines} real SANT hotline row(s) exist, so no placeholder was added.`,
  );
  console.log(
    `Santo menu: not part of the demo; ${menu.real} SANT meal(s) in the database ` +
      `(the real menu comes from \`npm run sant:menu:sync\`).` +
      (menu.removed > 0 ? ` Removed ${menu.removed} leftover sample meal(s) (${SAMPLE_MEAL_PREFIX}*).` : ""),
  );
  console.log(
    "Santo breakouts: not part of the demo (santos join the real Bhaio team breakouts on /sant/breakouts)." +
      (breakouts.removed > 0 ? ` Removed ${breakouts.removed} leftover sample session(s) (${SAMPLE_BREAKOUT_PREFIX}*).` : ""),
  );
  // A plain run never touches the mirror (santUser has no mirror_registration_id): say where it stands.
  const mirrored = user.mirrorRegistrationId?.trim();
  console.log(
    mirrored
      ? `Mirror: ${BAPS_ID} still mirrors ${mirrored} (clear it with --mirror off).`
      : `Mirror: none (set one with --mirror <BAPS ID>).`,
  );
}

/**
 * --mirror <BAPS ID> | off: sets (or clears) SANTO0001's users.mirror_registration_id and nothing
 * else, in one transaction. Refuses, writing nothing, unless SANTO0001 is this script's sample
 * sant and, for a BAPS ID, exactly one other SANT has it (case-insensitive; stored as he has it).
 * Prints the BAPS ID and the sant's plain name (santName()); never the tester code.
 */
async function setMirror(prisma: PrismaClient, bapsId: string | null) {
  const r = await prisma.$transaction(
    async (tx) => {
      const tester = await tx.user.findUnique({
        where: { bapsId: BAPS_ID },
        select: { id: true, name: true, role: true, mirrorRegistrationId: true },
      });
      if (!tester) throw new Error(`${BAPS_ID} doesn't exist here: run \`npm run sant:demo\` (same --env) first. Nothing was written.`);
      if (tester.role !== "SANT" || tester.name !== santUser.name) {
        throw new Error(`Refusing: ${BAPS_ID} ("${tester.name}", role ${tester.role}) is not the sample sant this script makes. Nothing was written.`);
      }
      const before = tester.mirrorRegistrationId?.trim() || null;

      let target: { bapsId: string; name: string; displayName: string | null } | null = null;
      if (bapsId !== null) {
        const matches = await tx.user.findMany({
          where: { bapsId: { equals: bapsId, mode: "insensitive" }, id: { not: tester.id } },
          select: { bapsId: true, name: true, displayName: true, role: true },
          orderBy: { bapsId: "asc" },
        });
        const santos = matches.filter((u) => u.role === "SANT");
        if (santos.length === 0) {
          const other = matches[0];
          throw new Error(
            other
              ? `${other.bapsId} is not a sant (role ${other.role}): a Santo mirror shows a sant. Nothing was written.`
              : `No one else here has BAPS ID ${bapsId}. Nothing was written.`,
          );
        }
        if (santos.length > 1) {
          throw new Error(`BAPS ID ${bapsId} matches ${santos.map((u) => u.bapsId).join(", ")}: give it as stored. Nothing was written.`);
        }
        target = santos[0];
      }

      await tx.user.update({
        where: { id: tester.id },
        data: { mirrorRegistrationId: target?.bapsId ?? null },
        select: { id: true },
      });
      // Whether a tester code is set (the code itself is never read): a mirror needs one.
      const hasCode = (await tx.user.count({ where: { id: tester.id, testCode: { not: null } } })) > 0;
      return { before, target, hasCode };
    },
    { timeout: 60_000 },
  );

  if (r.target && !r.hasCode) {
    console.log(`Note: ${BAPS_ID} has no tester code, so the mirror is not in effect until a plain \`npm run sant:demo\` sets it.`);
  }
  const was = r.before ? ` (was ${r.before})` : "";
  if (!r.target) {
    console.log(`${BAPS_ID} now mirrors no one${was}: signing in as ${BAPS_ID} shows his own sample data.`);
    return;
  }
  console.log(`${BAPS_ID} now mirrors ${r.target.bapsId} (${santName(r.target)})${was}.`);
  console.log(
    `With ALLOW_MIRROR_TESTERS=true on the server, signing in as ${BAPS_ID} shows the Santo view with his ` +
      "personal programme, rides, utaro, seva and region, under a band naming him; the name, bell and read state stay " +
      `${BAPS_ID}'s. Clear it with --mirror off (or --remove) before the event.`,
  );
}

/** --mirror's value: null for "off", else the BAPS ID as given (trimmed). Exits on anything else. */
function mirrorOption(value: string): string | null {
  if (value === "true") {
    console.error('--mirror needs a value: a sant\'s BAPS ID (e.g. --mirror AS1801) or "off".');
    process.exit(1);
  }
  const v = value.trim();
  if (v.toLowerCase() === "off") return null;
  if (!BAPS_ID_SHAPE.test(v.toUpperCase())) {
    console.error(`--mirror "${value}" is not a BAPS ID (3-32 letters and digits) or "off".`);
    process.exit(1);
  }
  if (v.toUpperCase() === BAPS_ID) {
    console.error(`--mirror ${v}: ${BAPS_ID} can't mirror himself.`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const { options: args, stray } = parseArgs(process.argv.slice(2));
  const unknown = [...Object.keys(args).filter((k) => !OPTIONS.has(k)).map((k) => `--${k}`), ...stray.map((a) => `"${a}"`)];
  if (unknown.length) {
    console.error(
      `Unknown option(s): ${unknown.join(", ")}. This script takes --env <file>, --remove and --mirror <BAPS ID | off> ` +
        "(after npm's `--`: npm run sant:demo -- --mirror <BAPS ID>). Nothing was written.",
    );
    process.exit(1);
  }
  if (args.remove !== undefined && args.remove !== "true") {
    console.error(`--remove takes no value (got "${args.remove}"); pick the database with --env.`);
    process.exit(1);
  }
  const mirror = args.mirror === undefined ? undefined : mirrorOption(args.mirror);
  if (mirror !== undefined && args.remove) {
    console.error("--mirror can't be combined with --remove (which deletes SANTO0001, and his mirror with him).");
    process.exit(1);
  }
  const envFile = args.env ?? ".env";
  loadEnvFile(envFile);
  if (!process.env.DATABASE_URL) {
    console.error(`DATABASE_URL is not set in ${envFile}`);
    process.exit(1);
  }

  // Import after the env file is loaded so DATABASE_URL is picked up.
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    console.log(`Target: DATABASE_URL from ${envFile}`);
    if (args.remove) await removeDemo(prisma);
    else if (mirror !== undefined) await setMirror(prisma, mirror);
    else await createDemo(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  if ((e as { code?: string })?.code === "P2022") {
    // A column of the current schema isn't in this database (e.g. hotlines.topic, added 2026-10-01).
    console.error(
      "This database is behind the schema (a column is missing): run `npm run db:push` " +
        "(or `npm run db:push:lightsail`) first, then run this again. Nothing was written.",
    );
    process.exit(1);
  }
  console.error(e);
  process.exit(1);
});
