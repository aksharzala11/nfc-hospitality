/**
 * Import the real Pujya Santo accounts and their utaros from prisma/santos-data.ts
 * (generated from the organisers' santo spreadsheets) in one transaction.
 *
 *   npm run santos:import                         # DATABASE_URL from the environment / .env (local)
 *   npm run santos:import:lightsail               # the shared Lightsail database (.env.lightsail)
 *   npm run santos:import -- --dry-run            # only print what would change
 *   npm run santos:import -- --env <file>         # DATABASE_URL from another dotenv file
 *
 * Users are upserted by BAPS ID with role SANT, name, email, phone, region,
 * gender MALE, seva "Pujya Santo" and preferred channel EMAIL, and placed at their
 * utaro (users.sant_accommodation_id). Nothing else on an existing row changes:
 * test_code, breakout_sessions, notifications_seen_at, last_sign_in_at and
 * display_name are left as they are. An ADMIN account with one of these BAPS IDs
 * is never demoted: it is skipped (not updated, not placed) and reported.
 *
 * Utaros (sant_accommodations) are upserted by their stable ids. A new one gets
 * the place name and no address, host or notes; an existing one only has its
 * place name brought in line, so details added later with `npm run sant:utaro --
 * --id <id> --address ...` survive a re-import.
 *
 * A pending account (prisma/santos-data.ts, "Pending accounts": a placeholder BAPS ID starting
 * PENDING_PREFIX, no email, no phone) is created like any other, so it can't sign in. A santo
 * with `formerBapsId` (his real BAPS ID has arrived) takes over the account with that id: it is
 * renamed in place, never duplicated.
 *
 * Nothing is ever deleted. SANT accounts and utaros that are not in the data
 * (the tester SANTO0001 and its sample companions and utaro, for instance) are
 * listed and left unchanged; remove the samples with `npm run sant:demo -- --remove`.
 */
import { readFileSync } from "node:fs";
import type { Gender, OtpChannel, PrismaClient, UserRole } from "@prisma/client";
import { PENDING_PREFIX, SANTOS, UTAROS } from "../prisma/santos-data";
import { wantsDryRun } from "./npm-flags";

/** Same seva as the sample santos (scripts/seed-sant-demo.ts); their breakouts match it. */
const SANT_SEVA = "Pujya Santo";

function parseArgs(argv: string[]) {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[a.slice(2)] = next;
      i++;
    } else out[a.slice(2)] = "true";
  }
  return out;
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

/**
 * Checks santos-data.ts before touching the database and returns each sant's
 * utaro id. Throws with every problem found.
 */
function checkData(): Map<string, string> {
  const problems: string[] = [];
  const dupes = (values: string[]) => [...new Set(values.filter((v, i) => values.indexOf(v) !== i))];

  for (const s of SANTOS) {
    const who = `${s.bapsId} ${s.name}`;
    if (s.bapsId.startsWith(PENDING_PREFIX)) {
      // A pending account: no way to reach him, so no sign-in until his details arrive.
      if (!/^PENDING-[A-Z]+$/.test(s.bapsId)) problems.push(`${who}: a placeholder BAPS ID is "PENDING-<NAME>"`);
      if (s.email !== null || s.phone !== null) {
        problems.push(`${who}: a pending account has no email or phone (give him his real BAPS ID with them)`);
      }
    } else {
      if (!/^[A-Z0-9]+$/.test(s.bapsId)) problems.push(`${who}: BAPS ID must be upper-case letters and digits`);
      if (s.email === null || s.email !== s.email.toLowerCase() || !/^[^@\s]+@[^@\s]+\.[a-z]+$/.test(s.email)) {
        problems.push(`${who}: email "${s.email}" must be a lower-case address`);
      }
      // No phone: email sign-in only (the organisers gave none).
      if (s.phone !== null && !/^\+\d{8,15}$/.test(s.phone)) problems.push(`${who}: phone "${s.phone}" is not E.164`);
    }
    if (s.registrationId !== undefined && !/^\d{1,10}$/.test(s.registrationId)) {
      problems.push(`${who}: registrationId "${s.registrationId}" must be the organisers' numeric User Id`);
    }
    if (s.formerBapsId !== undefined) {
      if (!s.formerBapsId.startsWith(PENDING_PREFIX)) problems.push(`${who}: formerBapsId must be a PENDING- placeholder`);
      if (s.bapsId.startsWith(PENDING_PREFIX)) problems.push(`${who}: only a real BAPS ID replaces a placeholder`);
    }
    if (!s.name.endsWith("das") || /swami|\s/i.test(s.name)) problems.push(`${who}: name must be "<Name>das"`);
    if (!s.region.trim()) problems.push(`${who}: region is empty`);
  }
  for (const d of dupes(SANTOS.map((s) => s.bapsId))) problems.push(`BAPS ID ${d} appears more than once`);
  for (const d of dupes(SANTOS.flatMap((s) => (s.email === null ? [] : [s.email])))) {
    problems.push(`Email ${d} appears more than once`);
  }
  const allIds = SANTOS.flatMap((s) => [s.bapsId, ...(s.formerBapsId ? [s.formerBapsId] : [])]);
  for (const d of dupes(allIds)) problems.push(`BAPS ID ${d} is used twice (as a BAPS ID or a formerBapsId)`);
  for (const d of dupes(SANTOS.flatMap((s) => (s.registrationId ? [s.registrationId] : [])))) {
    problems.push(`User Id ${d} appears more than once`);
  }

  const utaroOf = new Map<string, string>();
  for (const u of UTAROS) {
    if (!u.id.trim() || !u.placeName.trim()) problems.push(`Utaro "${u.id}" needs an id and a place name`);
    if (u.santos.length === 0) problems.push(`Utaro ${u.id} has no santos`);
    for (const b of u.santos) {
      if (!SANTOS.some((s) => s.bapsId === b)) problems.push(`Utaro ${u.id} lists ${b}, who is not in SANTOS`);
      const other = utaroOf.get(b);
      if (other) problems.push(`${b} is placed at both ${other} and ${u.id}`);
      else utaroOf.set(b, u.id);
    }
  }
  for (const d of dupes(UTAROS.map((u) => u.id))) problems.push(`Utaro id ${d} appears more than once`);
  for (const s of SANTOS) if (!utaroOf.has(s.bapsId)) problems.push(`${s.bapsId} ${s.name} is not placed at any utaro`);

  if (problems.length > 0) {
    throw new Error(`prisma/santos-data.ts has problems, nothing was written:\n  ${problems.join("\n  ")}`);
  }
  return utaroOf;
}

type Counts = { created: number; updated: number; unchanged: number };
const zero = (): Counts => ({ created: 0, updated: 0, unchanged: 0 });

type ImportResult = {
  users: Counts;
  utaros: Counts;
  /** "NV0001 Nityavivekdas: email, utaro" */
  userChanges: string[];
  /** Pending accounts renamed to their real BAPS ID. */
  renamed: string[];
  utaroChanges: string[];
  /** ADMIN accounts in the data: left unchanged. */
  skippedAdmins: string[];
  /** Existing rows whose display_name would show instead of the imported name. */
  displayNames: string[];
  /** SANT accounts not in the data (left unchanged). */
  otherSantos: string[];
  /** Utaros not in the data, with who stays there after the import (left unchanged). */
  otherUtaros: string[];
};

/** Fields the import owns on a users row, in the order they are reported. */
type SantFields = {
  role: UserRole;
  name: string;
  email: string | null;
  phone: string | null;
  region: string;
  gender: Gender;
  seva: string;
  preferredChannel: OtpChannel;
  santAccommodationId: string;
  /** Only when the data gives one: an account's User Id is otherwise left as it is. */
  registrationId?: string;
};
const FIELD_LABELS: Record<keyof SantFields, string> = {
  role: "role",
  name: "name",
  email: "email",
  phone: "phone",
  region: "region",
  gender: "gender",
  seva: "seva",
  preferredChannel: "channel",
  santAccommodationId: "utaro",
  registrationId: "User Id",
};

async function importSantos(prisma: PrismaClient, utaroOf: Map<string, string>, dryRun: boolean): Promise<ImportResult> {
  return prisma.$transaction(
    async (tx) => {
      const result: ImportResult = {
        users: zero(),
        utaros: zero(),
        userChanges: [],
        renamed: [],
        utaroChanges: [],
        skippedAdmins: [],
        displayNames: [],
        otherSantos: [],
        otherUtaros: [],
      };
      const bapsIds = SANTOS.map((s) => s.bapsId);
      const utaroIds = UTAROS.map((u) => u.id);

      // A pending account whose real BAPS ID has arrived: rename it first, so it is updated
      // below as the same account (its id, sign-in history and bell read state kept). Anything
      // that would leave him with two accounts stops the import instead (nothing written).
      /** The placeholder ids renamed in this run (a dry run reads them under the old id). */
      const renamedFrom: string[] = [];
      for (const s of SANTOS) {
        if (!s.formerBapsId) continue;
        const [current, former] = await Promise.all([
          tx.user.findUnique({ where: { bapsId: s.bapsId }, select: { id: true } }),
          tx.user.findUnique({ where: { bapsId: s.formerBapsId }, select: { id: true, role: true } }),
        ]);
        if (former && current) {
          throw new Error(
            `${s.formerBapsId} and ${s.bapsId} are both accounts: two accounts for ${s.name}. Merge them by hand ` +
              `(keep one, move his utaro and programme to it), then run the import again. Nothing was written.`,
          );
        }
        if (!former) {
          // Already renamed (current exists), or never created. But a pending account under
          // another placeholder with his name means formerBapsId is mistyped: renaming nothing and
          // creating a second account would be the duplicate this field is there to prevent.
          const lookalike = current
            ? null
            : await tx.user.findFirst({
                where: { role: "SANT", name: s.name, bapsId: { startsWith: PENDING_PREFIX } },
                select: { bapsId: true },
              });
          if (lookalike) {
            throw new Error(
              `${s.name}: formerBapsId is ${s.formerBapsId}, but his pending account is ${lookalike.bapsId}. ` +
                `Fix formerBapsId in prisma/santos-data.ts. Nothing was written.`,
            );
          }
          continue;
        }
        if (former.role !== "SANT") throw new Error(`${s.formerBapsId} is a ${former.role} account, not a sant: nothing written`);
        result.renamed.push(`${s.formerBapsId} -> ${s.bapsId} ${s.name}`);
        renamedFrom.push(s.formerBapsId);
        if (!dryRun) await tx.user.update({ where: { id: former.id }, data: { bapsId: s.bapsId } });
      }

      // Utaros first: users.sant_accommodation_id points at them.
      const existingUtaros = new Map(
        (
          await tx.santAccommodation.findMany({ where: { id: { in: utaroIds } }, select: { id: true, placeName: true } })
        ).map((u) => [u.id, u]),
      );
      for (const u of UTAROS) {
        const db = existingUtaros.get(u.id);
        if (!db) {
          result.utaros.created++;
          result.utaroChanges.push(`+ ${u.id} "${u.placeName}"`);
          if (!dryRun) {
            await tx.santAccommodation.create({
              data: { id: u.id, placeName: u.placeName, address: null, hostName: null, hostPhone: null, notes: null },
              select: { id: true },
            });
          }
        } else if (db.placeName !== u.placeName) {
          result.utaros.updated++;
          result.utaroChanges.push(`~ ${u.id} "${db.placeName}" -> "${u.placeName}"`);
          if (!dryRun) {
            await tx.santAccommodation.update({ where: { id: u.id }, data: { placeName: u.placeName }, select: { id: true } });
          }
        } else result.utaros.unchanged++;
      }

      const existingUsers = new Map(
        (
          await tx.user.findMany({
            // In a dry run the renames above weren't written: their accounts still have the old id.
            where: { bapsId: { in: [...bapsIds, ...SANTOS.flatMap((s) => (s.formerBapsId ? [s.formerBapsId] : []))] } },
            select: {
              bapsId: true,
              displayName: true,
              role: true,
              name: true,
              email: true,
              phone: true,
              region: true,
              gender: true,
              seva: true,
              preferredChannel: true,
              santAccommodationId: true,
              registrationId: true,
            },
          })
        ).map((u) => [u.bapsId, u]),
      );
      for (const s of SANTOS) {
        const want: SantFields = {
          role: "SANT",
          name: s.name,
          email: s.email,
          phone: s.phone,
          region: s.region,
          gender: "MALE",
          seva: SANT_SEVA,
          preferredChannel: "EMAIL",
          santAccommodationId: utaroOf.get(s.bapsId)!,
          ...(s.registrationId !== undefined ? { registrationId: s.registrationId } : {}),
        };
        const db = existingUsers.get(s.bapsId) ?? (s.formerBapsId ? existingUsers.get(s.formerBapsId) : undefined);
        // users.registration_id is unique: another account with this User Id stops the import.
        if (s.registrationId !== undefined) {
          const holder = await tx.user.findFirst({
            where: { registrationId: s.registrationId, bapsId: { notIn: [s.bapsId, ...(s.formerBapsId ? [s.formerBapsId] : [])] } },
            select: { bapsId: true, role: true },
          });
          if (holder) {
            throw new Error(`User Id ${s.registrationId} (${s.bapsId} ${s.name}) already belongs to ${holder.bapsId} (${holder.role}): nothing written`);
          }
        }
        if (!db) {
          result.users.created++;
          result.userChanges.push(`+ ${s.bapsId} ${s.name}`);
          if (!dryRun) await tx.user.create({ data: { bapsId: s.bapsId, ...want } });
          continue;
        }
        if (db.role === "ADMIN") {
          result.skippedAdmins.push(`${s.bapsId} ${db.name} (would be ${s.name})`);
          continue;
        }
        const changed = (Object.keys(want) as (keyof SantFields)[]).filter((k) => db[k] !== want[k]);
        if (db.displayName && db.displayName !== s.name) {
          result.displayNames.push(`${s.bapsId}: display_name "${db.displayName}" is shown instead of "${s.name}"`);
        }
        if (changed.length === 0) {
          result.users.unchanged++;
          continue;
        }
        result.users.updated++;
        const labels = changed.map((k) => (k === "role" ? `role ${db.role} -> SANT` : FIELD_LABELS[k]));
        result.userChanges.push(`~ ${s.bapsId} ${s.name}: ${labels.join(", ")}`);
        if (!dryRun) {
          const data = Object.fromEntries(changed.map((k) => [k, want[k]])) as Partial<SantFields>;
          await tx.user.update({ where: { bapsId: s.bapsId }, data });
        }
      }

      // Reported only. Santos from the data count as moved out of other utaros
      // (also in a dry run), except skipped admins, who stay where they are.
      // A dry run hasn't written its renames: those accounts still have their placeholder id.
      const ownIds = [...bapsIds, ...renamedFrom];
      const moving = new Set(ownIds.filter((b) => existingUsers.get(b)?.role !== "ADMIN"));
      const otherSantos = await tx.user.findMany({
        where: { role: "SANT", bapsId: { notIn: ownIds } },
        select: { bapsId: true, name: true, santAccommodation: { select: { placeName: true } } },
        orderBy: { bapsId: "asc" },
      });
      result.otherSantos = otherSantos.map(
        (u) => `${u.bapsId} ${u.name} (${u.santAccommodation ? `at ${u.santAccommodation.placeName}` : "not placed"})`,
      );
      const otherUtaros = await tx.santAccommodation.findMany({
        where: { id: { notIn: utaroIds } },
        select: { id: true, placeName: true, santos: { select: { bapsId: true } } },
        orderBy: { placeName: "asc" },
      });
      for (const u of otherUtaros) {
        const staying = u.santos.filter((s) => !moving.has(s.bapsId)).map((s) => s.bapsId);
        const leaving = u.santos.length - staying.length;
        result.otherUtaros.push(
          `${u.id} "${u.placeName}": ${staying.length > 0 ? staying.join(", ") : "no santos"}` +
            (leaving > 0 ? ` (${leaving} ${dryRun ? "would move" : "moved"} to their utaro from the data)` : ""),
        );
      }
      return result;
    },
    // ~45 statements over a remote connection: well past the 5 s default.
    { maxWait: 15_000, timeout: 120_000 },
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // Only with --env: the :lightsail script sets DATABASE_URL through dotenv-cli,
  // which loading .env here would override.
  if (args.env) loadEnvFile(args.env);
  const dryRun = wantsDryRun(args);
  const utaroOf = checkData();

  // Import after the env file is loaded so DATABASE_URL is picked up.
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const r = await importSantos(prisma, utaroOf, dryRun);
    // Read after the first query: Prisma loads .env itself when DATABASE_URL isn't set.
    const host = (process.env.DATABASE_URL ?? "the .env database").replace(/\/\/.*@/, "//***@");
    const count = (c: Counts) => `${c.created} created, ${c.updated} updated, ${c.unchanged} unchanged`;
    const would = (done: string, todo: string) => (dryRun ? todo : done);
    console.log(`${dryRun ? "Dry run, nothing written: " : ""}Pujya Santo import into ${host}`);
    console.log(
      `  Santos: ${SANTOS.length} in the data (${count(r.users)}` +
        `${r.skippedAdmins.length > 0 ? `, ${r.skippedAdmins.length} skipped` : ""})`,
    );
    console.log(`  Utaros: ${UTAROS.length} in the data (${count(r.utaros)})`);
    for (const line of r.renamed) console.log(`    ${would("renamed", "would rename")} ${line}`);
    const pending = SANTOS.filter((s) => s.bapsId.startsWith(PENDING_PREFIX));
    if (pending.length > 0) {
      console.log(`  Pending accounts (no email or phone, so no sign-in yet): ${pending.map((s) => `${s.bapsId} ${s.name}`).join(", ")}`);
    }
    for (const line of [...r.utaroChanges, ...r.userChanges]) console.log(`    ${line}`);
    if (r.skippedAdmins.length > 0) {
      console.log(`  Skipped, ADMIN accounts are never demoted (not ${would("updated", "to be updated")} or placed):`);
      for (const line of r.skippedAdmins) console.log(`    ${line}`);
    }
    if (r.displayNames.length > 0) {
      console.log("  Note: a display name overrides the imported name in the app (left unchanged):");
      for (const line of r.displayNames) console.log(`    ${line}`);
    }
    console.log(
      r.otherSantos.length > 0
        ? `  SANT accounts not in prisma/santos-data.ts (left unchanged): ${r.otherSantos.length}`
        : "  No other SANT accounts.",
    );
    for (const line of r.otherSantos) console.log(`    ${line}`);
    if (r.otherUtaros.length > 0) {
      console.log(`  Utaros not in prisma/santos-data.ts (left unchanged): ${r.otherUtaros.length}`);
      for (const line of r.otherUtaros) console.log(`    ${line}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  // P2022: a column is missing, e.g. users.sant_accommodation_id before `prisma db push`.
  if ((e as { code?: string })?.code === "P2022") {
    console.error("The database schema is behind: run `npm run db:push` (or `npm run db:push:lightsail`) first.");
  }
  process.exit(1);
});
