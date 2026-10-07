/**
 * Manage the santos' utaros (sant_accommodations) until there is an admin
 * screen for it. An utaro is shared: every sant placed there has
 * users.sant_accommodation_id pointing at it, and each one sees the others
 * under "Staying with you" on /sant/stay. Santos are hosted for the whole
 * stay, so an utaro has no room or check-in/out.
 *
 *   npm run sant:utaro -- --env .env.lightsail --list
 *     Every utaro with its santos, then the santos not placed anywhere yet.
 *
 *   npm run sant:utaro -- --env .env.lightsail --place "Patel residence" \
 *     --address "12 Oak Tree Rd, Edison, NJ 08820" --host "Rajeshbhai Patel" \
 *     --hostPhone 7325550117 --notes "Puja room upstairs" --santos SANTO0001,SANTO0002
 *     Creates an utaro, prints its id and places those santos there.
 *
 *   npm run sant:utaro -- --env .env.lightsail --id <id> [--place ...] [--address ...]
 *     [--host ...] [--hostPhone ...] [--notes ...] [--clear notes,address] [--santos ...]
 *     Updates that utaro: only the options given change. If no utaro has that
 *     id yet it is created with it (--place required). --clear empties
 *     address, host, hostPhone and/or notes. --id alone shows the utaro.
 *
 *   --hostTelegram <username>  The host's Telegram (any form the organisers write: "@name",
 *                  "t.me/name" or a phone number; src/lib/telegram.ts): /sant/stay then shows a
 *                  Telegram button beside "Call host" (user, 2026-10-06). --clear hostTelegram
 *                  removes it. Needs the host_telegram column (db:push, 2026-10-06 schema).
 *   --santos A,B   BAPS IDs of santos (users.role = SANT) to place at the utaro.
 *                  A sant is at one utaro at a time, so this moves them from any
 *                  other; santos already placed there stay.
 *   --unassign A,B Takes santos out of their utaro (placed nowhere).
 *   --delete --id <id>  Deletes the utaro; its santos are left unplaced.
 *
 * --address is stored (sant_accommodations.address) for the organisers' own
 * records and printed by --list / --id, but the app no longer reads or shows
 * it: /sant/stay and the home's Utaro tile show the place name, companions,
 * host and notes only.
 *
 * Notes can hold what only the santos there should read (a Wi-Fi password), so
 * --list / --id and the summary after a change print "Notes: set (N characters)"
 * rather than the notes; add --show-notes to print them in full. (A value given
 * with --notes is still on the command line: shell history, terminal logs.)
 *
 * Every mode reads whole utaro rows, so it needs the 2026-10-06 schema (host_telegram) pushed:
 * on a database without it the script stops before doing anything and says to run db:push.
 *
 * --env points at a dotenv file whose DATABASE_URL to use (defaults to .env).
 * Add a sant first with `npm run user:upsert -- ... --role SANT`.
 */
import { readFileSync } from "node:fs";
import type { Prisma, PrismaClient, SantAccommodation, UserRole } from "@prisma/client";
import { toE164 } from "../src/lib/users";
import { normalizeTelegram } from "../src/lib/telegram";

const USAGE = `Usage (see scripts/sant-utaro.ts for details):
  npm run sant:utaro -- [--env .env.lightsail] --list [--show-notes]
  npm run sant:utaro -- [--env ...] --place "Name" [--address ...] [--host ...] [--hostPhone ...] [--notes ...] [--santos A,B]
  npm run sant:utaro -- [--env ...] --id <id> [--place ...] [--address ...] [--host ...] [--hostPhone ...] [--hostTelegram ...]
                        [--notes ...] [--clear address,host,hostPhone,hostTelegram,notes] [--santos A,B]
  npm run sant:utaro -- [--env ...] --unassign A,B
  npm run sant:utaro -- [--env ...] --delete --id <id>`;

const VALUE_OPTIONS = new Set(["env", "id", "place", "address", "host", "hostPhone", "hostTelegram", "notes", "clear", "santos", "unassign"]);
const FLAG_OPTIONS = new Set(["list", "delete", "help", "show-notes"]);
/** --clear names -> columns that may be emptied (placeName is required). */
const CLEARABLE = {
  address: "address",
  host: "hostName",
  hostPhone: "hostPhone",
  hostTelegram: "hostTelegram",
  notes: "notes",
} as const;

type Fields = {
  placeName?: string;
  address?: string | null;
  hostName?: string | null;
  hostPhone?: string | null;
  hostTelegram?: string | null;
  notes?: string | null;
};
type SantRow = { bapsId: string; name: string; role: UserRole };

/** Bad input: printed without a stack trace. */
class UsageError extends Error {}
function fail(message: string): never {
  throw new UsageError(message);
}

function parseArgs(argv: string[]) {
  const values: Record<string, string> = {};
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) fail(`Unexpected argument "${arg}".`);
    const key = arg.slice(2);
    if (FLAG_OPTIONS.has(key)) flags.add(key);
    else if (!VALUE_OPTIONS.has(key)) fail(`Unknown option --${key}.`);
    else if (argv[i + 1] === undefined || argv[i + 1].startsWith("--")) {
      fail(`--${key} needs a value${key in CLEARABLE ? ` (to empty it, use --clear ${key})` : ""}.`);
    } else values[key] = argv[++i];
  }
  return { values, flags };
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

/** "santo0001, SANTO0002" -> ["SANTO0001", "SANTO0002"] */
function bapsIds(value: string | undefined): string[] {
  if (!value) return [];
  return [...new Set(value.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean))];
}

function readFields(values: Record<string, string>): Fields {
  const fields: Fields = {};
  const text = (v: string) => v.trim() || null;
  if (values.place !== undefined) fields.placeName = values.place.trim() || fail("--place cannot be empty.");
  if (values.address !== undefined) fields.address = text(values.address);
  if (values.host !== undefined) fields.hostName = text(values.host);
  if (values.notes !== undefined) fields.notes = text(values.notes);
  if (values.hostPhone !== undefined) {
    fields.hostPhone = values.hostPhone.trim()
      ? (toE164(values.hostPhone) ?? fail(`Could not read --hostPhone "${values.hostPhone}" as a phone number.`))
      : null;
  }
  if (values.hostTelegram !== undefined) {
    fields.hostTelegram =
      normalizeTelegram(values.hostTelegram) ??
      fail(`--hostTelegram "${values.hostTelegram}" is not a Telegram username (5-32 letters, digits or _) or a phone number.`);
  }
  for (const name of (values.clear ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    if (!(name in CLEARABLE)) fail(`--clear takes ${Object.keys(CLEARABLE).join(", ")} (got "${name}").`);
    if (values[name] !== undefined) fail(`--${name} and --clear ${name} contradict each other.`);
    fields[CLEARABLE[name as keyof typeof CLEARABLE]] = null;
  }
  return fields;
}

const describeSant = (s: SantRow) => `${s.bapsId} ${s.name}${s.role === "SANT" ? "" : ` [${s.role}]`}`;

/** Print the notes in full (--show-notes); otherwise only that there are some. */
let showNotes = false;

function printUtaro(u: SantAccommodation & { santos: SantRow[] }) {
  console.log(`\n${u.placeName}  [id ${u.id}]`);
  if (u.address) console.log(`  Address: ${u.address}`);
  if (u.hostName || u.hostPhone || u.hostTelegram) {
    console.log(`  Host:    ${[u.hostName, u.hostPhone, u.hostTelegram && `Telegram ${u.hostTelegram}`].filter(Boolean).join(", ")}`);
  }
  if (u.notes) {
    console.log(
      showNotes
        ? `  Notes:   ${u.notes.replace(/\s*\n\s*/g, " / ")}`
        : `  Notes:   set (${u.notes.length} characters; --show-notes prints them)`,
    );
  }
  console.log(`  Santos:  ${u.santos.length > 0 ? u.santos.map(describeSant).join(", ") : "(none yet)"}`);
}

const withSantos = {
  santos: { select: { bapsId: true, name: true, role: true }, orderBy: { bapsId: "asc" } },
} satisfies Prisma.SantAccommodationInclude;

async function showUtaro(prisma: PrismaClient, id: string) {
  const utaro = await prisma.santAccommodation.findUnique({ where: { id }, include: withSantos });
  if (!utaro) fail(`No utaro with id "${id}" (see --list).`);
  printUtaro(utaro);
}

async function list(prisma: PrismaClient) {
  const utaros = await prisma.santAccommodation.findMany({ orderBy: { placeName: "asc" }, include: withSantos });
  console.log(utaros.length === 0 ? "No utaros yet." : `${utaros.length} utaro(s):`);
  for (const u of utaros) printUtaro(u);
  const unplaced = await prisma.user.findMany({
    where: { role: "SANT", santAccommodationId: null },
    select: { bapsId: true, name: true, role: true },
    orderBy: { bapsId: "asc" },
  });
  console.log(
    unplaced.length === 0
      ? "\nEvery sant is placed at an utaro."
      : `\nNot placed yet (${unplaced.length}): ${unplaced.map(describeSant).join(", ")}`,
  );
}

async function remove(prisma: PrismaClient, id: string) {
  const utaro = await prisma.santAccommodation.findUnique({ where: { id }, include: withSantos });
  if (!utaro) fail(`No utaro with id "${id}" (see --list).`);
  await prisma.santAccommodation.delete({ where: { id } });
  console.log(`Deleted ${utaro.placeName} [id ${id}].`);
  if (utaro.santos.length > 0) console.log(`No longer placed: ${utaro.santos.map(describeSant).join(", ")}`);
}

/** Creates/updates the utaro and moves santos in and out, all in one transaction. */
async function apply(
  prisma: PrismaClient,
  { id, fields, assign, unassign }: { id?: string; fields: Fields; assign: string[]; unassign: string[] },
) {
  const { utaroId, unplaced } = await prisma.$transaction(async (tx) => {
    // Check every BAPS ID before changing anything.
    const wanted = [...assign, ...unassign];
    const users = await tx.user.findMany({
      where: { bapsId: { in: wanted } },
      select: { bapsId: true, name: true, role: true },
    });
    const missing = wanted.filter((b) => !users.some((u) => u.bapsId === b));
    if (missing.length > 0) fail(`No user with BAPS ID ${missing.join(", ")}.`);
    const notSant = users.filter((u) => assign.includes(u.bapsId) && u.role !== "SANT");
    if (notSant.length > 0) {
      fail(`Only santos can be placed at an utaro: ${notSant.map(describeSant).join(", ")}. Use --role SANT on npm run user:upsert first.`);
    }

    let utaroId = id;
    if (id) {
      const exists = await tx.santAccommodation.findUnique({ where: { id }, select: { id: true } });
      if (exists) {
        if (Object.keys(fields).length > 0) await tx.santAccommodation.update({ where: { id }, data: fields });
      } else {
        const placeName = fields.placeName ?? fail(`No utaro with id "${id}". To create one with that id, add --place.`);
        await tx.santAccommodation.create({ data: { ...fields, id, placeName } });
      }
    } else if (fields.placeName !== undefined) {
      utaroId = (await tx.santAccommodation.create({ data: { ...fields, placeName: fields.placeName } })).id;
    }

    if (assign.length > 0) {
      await tx.user.updateMany({ where: { bapsId: { in: assign } }, data: { santAccommodationId: utaroId } });
    }
    if (unassign.length > 0) {
      await tx.user.updateMany({ where: { bapsId: { in: unassign } }, data: { santAccommodationId: null } });
    }
    return { utaroId, unplaced: users.filter((u) => unassign.includes(u.bapsId)) };
  });

  if (utaroId) await showUtaro(prisma, utaroId);
  if (unplaced.length > 0) console.log(`\nNo longer placed at any utaro: ${unplaced.map(describeSant).join(", ")}`);
}

async function main() {
  const { values, flags } = parseArgs(process.argv.slice(2));
  if (flags.has("help")) {
    console.log(USAGE);
    return;
  }
  showNotes = flags.has("show-notes");
  const envFile = values.env ?? ".env";
  loadEnvFile(envFile);
  if (!process.env.DATABASE_URL) fail(`DATABASE_URL is not set in ${envFile}.`);

  const id = values.id?.trim() || undefined;
  if (values.id !== undefined && !id) fail("--id cannot be empty.");
  const fields = readFields(values);
  const assign = bapsIds(values.santos);
  const unassign = bapsIds(values.unassign);
  const changes = Object.keys(fields).length > 0 || assign.length > 0 || unassign.length > 0;

  if (flags.has("delete")) {
    if (!id) fail("--delete needs --id <id> (see --list).");
    if (changes) fail("--delete cannot be combined with other changes.");
  } else if (!changes && !id && !flags.has("list")) {
    fail(USAGE);
  }
  if (Object.keys(fields).length > 0 && !id && fields.placeName === undefined) {
    fail("A new utaro needs --place. To change an existing one, pass its --id (see --list).");
  }
  if (assign.length > 0 && !id && fields.placeName === undefined) {
    fail("--santos needs the utaro: its --id (see --list), or --place to create a new one.");
  }
  const both = assign.filter((b) => unassign.includes(b));
  if (both.length > 0) fail(`${both.join(", ")} cannot be in both --santos and --unassign.`);

  // Import after the env file is loaded so DATABASE_URL is picked up.
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    console.log(`Target: DATABASE_URL from ${envFile}`);
    // Checked first, so nothing is changed and then reported as a failure.
    const [{ n }] = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_attribute
      WHERE attrelid = to_regclass('sant_accommodations') AND attname = 'host_telegram' AND NOT attisdropped`;
    if (n !== 1) {
      fail(
        "This database has no sant_accommodations.host_telegram column yet (2026-10-06 schema): run `npm run db:push` " +
          "(or `npm run db:push:lightsail`) first. Nothing was changed.",
      );
    }
    if (flags.has("delete")) await remove(prisma, id!);
    else if (changes) await apply(prisma, { id, fields, assign, unassign });
    else if (id && !flags.has("list")) await showUtaro(prisma, id);
    if (flags.has("list")) await list(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  if (e instanceof UsageError) console.error(e.message);
  else console.error(e);
  process.exit(1);
});
