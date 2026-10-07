/**
 * Manage the Hotel Liaisons: each hotel's points of contact from the rooming
 * team, shown as "Hotel Liaison" ("Hotel Liaisons" when several) on /stay to
 * the delegates staying at that hotel (every liaison of their track, plus any
 * for everyone, each with a Call button) and on the admin rooming board. A
 * hotel can have several liaisons for one track (hotel_liaisons, one row
 * each). The names and numbers live only in the database: never put them in
 * code, data files or docs.
 *
 *   npm run hotel:liaisons -- --list
 *     Every liaison by hotel and track (phones masked to the last 4 digits),
 *     then the hotels with none.
 *
 *   npm run hotel:liaisons -- --add --hotel doubletree --track behno --name "First Last" --phone "(732) 555-0142"
 *     Adds one liaison for that hotel and track, beside any already there.
 *     Refuses a name that hotel and track already has. --hotel is a
 *     src/lib/hotels.ts key (hampton | courtyard | doubletree | hilton; the
 *     rooming list's spellings, e.g. "Hampton Inn", work too), --track is
 *     bhaio | behno | all (all = everyone at the hotel, whatever their track),
 *     --phone any US/Canada form or E.164 (stored as E.164; no extension, and a
 *     +1 number must be a valid North American one). Optional --sort <n>
 *     (lower first, default 0; liaisons with the same sort read by name).
 *
 *   npm run hotel:liaisons -- --set --hotel hampton --track bhaio --name "First Last" --phone "+17325550142"
 *     Replaces ALL liaisons of that hotel and track with this one (creates it
 *     when there is none). Same options as --add; --sort left out keeps the
 *     sort of the one liaison being replaced.
 *
 *   npm run hotel:liaisons -- --remove --hotel doubletree --track behno [--name "First Last"]
 *     Deletes that hotel's liaison of that name for that track, or, without
 *     --name, every liaison of that hotel and track.
 *
 *   --dry-run      with --add / --set / --remove: print what would change, write nothing.
 *   --env <file>   take DATABASE_URL from another dotenv file (the :lightsail
 *                  scripts set it through dotenv-cli instead).
 *   npm run hotel:liaisons:lightsail -- ...   the shared Lightsail database.
 *
 * Any unknown or misspelt option stops the script before it touches the
 * database. The output has the liaisons' names (needed to manage the list) and
 * masked phones, nothing else. A database needs `npm run db:push` (or
 * `db:push:lightsail`) for the hotel_liaisons table, and again after
 * 2026-10-01 before a hotel and track can have a second liaison (until then
 * the old one-per-hotel-and-track rule is still in the database and --add says
 * so, with --dry-run too).
 */
import type { Audience, HotelLiaison, PrismaClient } from "@prisma/client";
import { HOTEL_KEYS, compareHotels, hotelInfo, hotelKeyFor, type HotelKey } from "../src/lib/hotels";
import {
  AUDIENCE_ORDER,
  TRACK_LABEL,
  databaseLabel,
  exitWith,
  fail,
  loadEnvFile,
  maskPhone,
  nameKey,
  parseArgs,
  readName,
  readPhone,
  readSort,
  readTrack,
  refuse,
} from "./contact-cli";

const USAGE = `Usage (see scripts/hotel-liaisons.ts for details):
  npm run hotel:liaisons[:lightsail] -- --list
  npm run hotel:liaisons[:lightsail] -- --add --hotel <${HOTEL_KEYS.join("|")}> --track <bhaio|behno|all>
                                        --name "<Name>" --phone "<+1...>" [--sort <n>] [--dry-run]
  npm run hotel:liaisons[:lightsail] -- --set  (same options: replaces every liaison of that hotel and track)
  npm run hotel:liaisons[:lightsail] -- --remove --hotel <key> --track <bhaio|behno|all> [--name "<Name>"] [--dry-run]
  Add --env <file> to take DATABASE_URL from another dotenv file.`;

const VALUE_OPTIONS = new Set(["env", "hotel", "track", "name", "phone", "sort"]);
const FLAG_OPTIONS = new Set(["list", "add", "set", "remove", "dry-run", "help"]);
const MODES = ["list", "add", "set", "remove"] as const;
type Mode = (typeof MODES)[number];

type Plan =
  | { mode: "list" }
  | { mode: "add" | "set"; hotel: HotelKey; audience: Audience; name: string; phone: string; sortOrder: number | null }
  | { mode: "remove"; hotel: HotelKey; audience: Audience; name: string | null };

function readHotel(value: string | undefined): HotelKey {
  if (value === undefined) fail(`--hotel is required (${HOTEL_KEYS.join(", ")}).`);
  return hotelKeyFor(value) ?? fail(`--hotel "${value}" is not a hotel: use ${HOTEL_KEYS.join(", ")}.`);
}

/** Validates everything before the database is touched. */
function readPlan(values: Record<string, string>, flags: Set<string>): Plan {
  const modes = MODES.filter((m) => flags.has(m));
  if (modes.length !== 1) fail("Give exactly one of --list, --add, --set or --remove.");
  const mode: Mode = modes[0];
  const allowed: Record<Mode, readonly string[]> = {
    list: [],
    add: ["hotel", "track", "name", "phone", "sort"],
    set: ["hotel", "track", "name", "phone", "sort"],
    remove: ["hotel", "track", "name"],
  };
  for (const key of Object.keys(values)) {
    if (key !== "env" && !allowed[mode].includes(key)) fail(`--${key} doesn't go with --${mode}.`);
  }
  if (mode === "list") {
    if (flags.has("dry-run")) fail("--dry-run is for --add, --set and --remove (--list never writes).");
    return { mode };
  }
  const hotel = readHotel(values.hotel);
  const audience = readTrack(values.track);
  if (mode === "remove") return { mode, hotel, audience, name: readName(values.name, false) };

  const name = readName(values.name, true);
  const phone = readPhone(values.phone);
  return { mode, hotel, audience, name, phone, sortOrder: readSort(values.sort) };
}

const where = (hotel: string, audience: Audience) => `${hotelInfo(hotel).name} · ${TRACK_LABEL[audience]}`;
const person = (r: Pick<HotelLiaison, "name" | "phone">) => `${r.name}, ${maskPhone(r.phone)}`;
const liaisons = (n: number) => (n === 1 ? "1 liaison" : `${n} liaisons`);

/** That hotel and track's liaisons, as the app lists them: by sort, then name. */
async function current(prisma: PrismaClient, hotel: HotelKey, audience: Audience): Promise<HotelLiaison[]> {
  const rows = await prisma.hotelLiaison.findMany({ where: { hotel, audience } });
  return rows.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

async function list(prisma: PrismaClient): Promise<string[]> {
  const out: string[] = [];
  const rows = await prisma.hotelLiaison.findMany();
  rows.sort(
    (a, b) =>
      compareHotels(a.hotel, b.hotel) ||
      AUDIENCE_ORDER.indexOf(a.audience) - AUDIENCE_ORDER.indexOf(b.audience) ||
      a.sortOrder - b.sortOrder ||
      a.name.localeCompare(b.name),
  );
  if (rows.length === 0) out.push("No hotel liaisons yet.");
  for (const r of rows) {
    const sort = r.sortOrder !== 0 ? ` (sort ${r.sortOrder})` : "";
    out.push(`${where(r.hotel, r.audience)}: ${person(r)}${sort}`);
  }
  const none = HOTEL_KEYS.filter((h) => !rows.some((r) => r.hotel === h));
  if (none.length > 0) out.push(`No liaison at all: ${none.map((h) => hotelInfo(h).name).join(", ")}`);
  const unknown = [...new Set(rows.map((r) => r.hotel).filter((h) => !(HOTEL_KEYS as readonly string[]).includes(h)))];
  if (unknown.length > 0) out.push(`Not a hotel in src/lib/hotels.ts (shown to nobody): ${unknown.join(", ")}`);
  return out;
}

type Write = Extract<Plan, { mode: "add" | "set" }>;

const ONE_PER_TRACK =
  "This database still allows only one liaison per hotel and track: run `npm run db:push` " +
  "(or `npm run db:push:lightsail`) first, then add again. Nothing was written.";

/**
 * True while the unique index on (hotel, audience) the schema had until
 * 2026-10-01 is still in this database (not pushed since): a second liaison
 * for a hotel and track can't be stored yet.
 */
async function onePerTrackOnly(prisma: PrismaClient): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n
    FROM pg_index i
    WHERE i.indrelid = to_regclass('hotel_liaisons')
      AND i.indisunique
      AND NOT i.indisprimary
      AND (SELECT array_agg(a.attname::text ORDER BY a.attname::text)
           FROM pg_attribute a
           WHERE a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey::int2[])) = ARRAY['audience', 'hotel']`;
  return (rows[0]?.n ?? 0) > 0;
}

async function add(prisma: PrismaClient, plan: Write, dryRun: boolean): Promise<string[]> {
  const existing = await current(prisma, plan.hotel, plan.audience);
  const same = existing.find((r) => nameKey(r.name) === nameKey(plan.name));
  if (same) {
    refuse(
      `${where(plan.hotel, plan.audience)} already has a liaison of that name (${person(same)}). ` +
        `Nothing written. To change the number: --remove --name "${same.name}", then --add again.`,
    );
  }
  const sortOrder = plan.sortOrder ?? 0;
  const label = `${where(plan.hotel, plan.audience)}: ${plan.name}, ${maskPhone(plan.phone)}${sortOrder !== 0 ? ` (sort ${sortOrder})` : ""}`;
  const beside = existing.length > 0 ? ` (beside ${existing.map((r) => r.name).join(", ")})` : "";
  // Asked before a dry run too, so "Would add" is never said of an add the database would refuse.
  if (existing.length > 0 && (await onePerTrackOnly(prisma))) refuse(ONE_PER_TRACK);
  if (dryRun) return [`Would add: ${label}${beside}`];
  try {
    await prisma.hotelLiaison.create({
      data: { hotel: plan.hotel, audience: plan.audience, name: plan.name, phone: plan.phone, sortOrder },
      select: { id: true },
    });
  } catch (e) {
    // The unique index on (hotel, audience) the schema had until 2026-10-01 is still in this database.
    if ((e as { code?: string })?.code === "P2002") refuse(ONE_PER_TRACK);
    throw e;
  }
  return [`Added: ${label}${beside}`];
}

async function set(prisma: PrismaClient, plan: Write, dryRun: boolean): Promise<string[]> {
  const existing = await current(prisma, plan.hotel, plan.audience);
  const only = existing.length === 1 ? existing[0] : null;
  const sortOrder = plan.sortOrder ?? only?.sortOrder ?? 0;
  const label = `${where(plan.hotel, plan.audience)}: ${plan.name}, ${maskPhone(plan.phone)}${sortOrder !== 0 ? ` (sort ${sortOrder})` : ""}`;
  if (only && only.name === plan.name && only.phone === plan.phone && only.sortOrder === sortOrder) {
    return [`Unchanged: ${label}`];
  }
  const was =
    existing.length === 0
      ? ""
      : ` (replacing ${liaisons(existing.length)}: ${existing.map(person).join("; ")})`;
  if (dryRun) return [`Would ${existing.length === 0 ? "create" : "set"}: ${label}${was}`];
  await prisma.$transaction(async (tx) => {
    if (only) {
      await tx.hotelLiaison.update({
        where: { id: only.id },
        data: { name: plan.name, phone: plan.phone, sortOrder },
        select: { id: true },
      });
      return;
    }
    await tx.hotelLiaison.deleteMany({ where: { hotel: plan.hotel, audience: plan.audience } });
    await tx.hotelLiaison.create({
      data: { hotel: plan.hotel, audience: plan.audience, name: plan.name, phone: plan.phone, sortOrder },
      select: { id: true },
    });
  });
  return [`${existing.length === 0 ? "Created" : "Set"}: ${label}${was}`];
}

async function remove(prisma: PrismaClient, plan: Extract<Plan, { mode: "remove" }>, dryRun: boolean): Promise<string[]> {
  const existing = await current(prisma, plan.hotel, plan.audience);
  if (existing.length === 0) {
    return [`No liaison for ${where(plan.hotel, plan.audience)}: nothing to remove.`];
  }
  const name = plan.name;
  const going = name === null ? existing : existing.filter((r) => nameKey(r.name) === nameKey(name));
  if (going.length === 0) {
    return [
      `No liaison named "${name}" for ${where(plan.hotel, plan.audience)}: nothing to remove.`,
      `There: ${existing.map((r) => r.name).join(", ")}`,
    ];
  }
  const staying = existing.filter((r) => !going.includes(r));
  const lines = going.map((r) => `${dryRun ? "Would remove" : "Removed"}: ${where(r.hotel, r.audience)}: ${person(r)}`);
  lines.push(
    staying.length > 0
      ? `${dryRun ? "Would stay" : "Still there"}: ${staying.map((r) => r.name).join(", ")}`
      : `${where(plan.hotel, plan.audience)} ${dryRun ? "would have" : "now has"} no liaison.`,
  );
  if (!dryRun) await prisma.hotelLiaison.deleteMany({ where: { id: { in: going.map((r) => r.id) } } });
  return lines;
}

async function main() {
  const { values, flags } = parseArgs(process.argv.slice(2), VALUE_OPTIONS, FLAG_OPTIONS);
  if (flags.has("help")) {
    console.log(USAGE);
    return;
  }
  const plan = readPlan(values, flags);
  const dryRun = flags.has("dry-run");
  // Only with --env: the :lightsail script sets DATABASE_URL through dotenv-cli,
  // which loading .env here would override.
  if (values.env) loadEnvFile(values.env);

  // Import after the env file is loaded so DATABASE_URL is picked up.
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const lines =
      plan.mode === "list"
        ? await list(prisma)
        : plan.mode === "remove"
          ? await remove(prisma, plan, dryRun)
          : plan.mode === "add"
            ? await add(prisma, plan, dryRun)
            : await set(prisma, plan, dryRun);
    // Read after the first query: Prisma loads .env itself when DATABASE_URL isn't set.
    console.log(`${dryRun ? "Dry run, nothing written: " : ""}hotel liaisons in ${databaseLabel()}`);
    for (const line of lines) console.log(`  ${line}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) =>
  exitWith(e, USAGE, (code) =>
    code === "P2021"
      ? // No hotel_liaisons table in this database yet.
        "The hotel_liaisons table isn't there yet: run `npm run db:push` (or `npm run db:push:lightsail`) first."
      : null,
  ),
);
