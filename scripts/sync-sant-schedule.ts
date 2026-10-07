/**
 * Sync the Pujya Santo general schedule from prisma/sant-schedule-data.ts
 * (generated from the "Master Schedule" tab of the organisers' Santo workbook)
 * into the `sant_general_schedule_items` table, ids "ss-*". New items are created,
 * changed ones rewritten and rows no longer in the data deleted, in one
 * transaction. See prisma/sant-schedule.ts.
 *
 *   npm run sant:schedule:sync                      # DATABASE_URL from the environment / .env (local)
 *   npm run sant:schedule:sync:lightsail            # the shared Lightsail database (.env.lightsail)
 *   npm run sant:schedule:sync -- --dry-run         # only print what would change
 *   npm run sant:schedule:sync -- --env <file>      # DATABASE_URL from another dotenv file
 *
 * `npm run db:seed` runs the same sync. The table has to exist first:
 * `npm run db:push` (or `npm run db:push:lightsail`).
 */
import { readFileSync } from "node:fs";
import { santScheduleSummary, syncSantSchedule } from "../prisma/sant-schedule";
import { wantsDryRun } from "./npm-flags";

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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // Only with --env: the :lightsail script sets DATABASE_URL through dotenv-cli,
  // which loading .env here would override.
  if (args.env) loadEnvFile(args.env);
  const dryRun = wantsDryRun(args);

  // Import after the env file is loaded so DATABASE_URL is picked up.
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const result = await syncSantSchedule(prisma, { dryRun });
    // Read after the first query: Prisma loads .env itself when DATABASE_URL isn't set.
    const host = (process.env.DATABASE_URL ?? "the .env database").replace(/\/\/.*@/, "//***@");
    console.log(`${dryRun ? "Dry run, nothing written: " : ""}Santo general schedule in ${host}`);
    for (const line of santScheduleSummary(result)) console.log(`  ${line}`);
    if (result.deletedIds.length) {
      console.log(`  ${dryRun ? "Would delete" : "Deleted"}: ${result.deletedIds.join(", ")}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  // P2021: the table doesn't exist yet (before `prisma db push`).
  const code = (e as { code?: string })?.code;
  if (code === "P2021" || code === "P2022") {
    console.error("The database schema is behind: run `npm run db:push` (or `npm run db:push:lightsail`) first.");
  }
  process.exit(1);
});
