/**
 * Sync the real team breakouts from prisma/breakouts-data.ts (the organisers'
 * breakout matrix) into the `breakouts` table: one row per team per track,
 * ids "bk-*". New sessions are created, changed ones rewritten and "bk-" rows
 * no longer in the data deleted, in one transaction. Mock rows and the Santo
 * sample rows ("sample-*") are never touched. See prisma/breakouts.ts.
 *
 *   npm run breakouts:sync                          # DATABASE_URL from the environment / .env (local)
 *   npm run breakouts:sync:lightsail                # the shared Lightsail database (.env.lightsail)
 *   npm run breakouts:sync -- --dry-run             # only print what would change
 *   npm run breakouts:sync -- --env <file>          # DATABASE_URL from another dotenv file
 *
 * Rows are compared on their printed times, so a row moved live from
 * /admin/schedule keeps its move (re-based on new printed times if the data
 * changed them) and counts as unchanged when only the move differs; unchanged
 * rows are left alone. (`npm run db:seed` resets live moves, as it does for the
 * schedule.) The Lightsail database needs the breakouts.audience column first:
 * `npm run db:push:lightsail`.
 */
import { readFileSync } from "node:fs";
import { syncBreakouts, syncSummary } from "../prisma/breakouts";

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
  const dryRun = args["dry-run"] === "true";

  // Import after the env file is loaded so DATABASE_URL is picked up.
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const result = await syncBreakouts(prisma, { dryRun });
    // Read after the first query: Prisma loads .env itself when DATABASE_URL isn't set.
    const host = (process.env.DATABASE_URL ?? "the .env database").replace(/\/\/.*@/, "//***@");
    console.log(`${dryRun ? "Dry run, nothing written: " : ""}team breakouts in ${host}`);
    for (const line of syncSummary(result)) console.log(`  ${line}`);
    if (result.deletedIds.length) {
      console.log(`  ${dryRun ? "Would delete" : "Deleted"}: ${result.deletedIds.join(", ")}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  // P2022: a column is missing, e.g. breakouts.audience before `prisma db push`.
  if ((e as { code?: string })?.code === "P2022") {
    console.error("The database schema is behind: run `npm run db:push` (or `npm run db:push:lightsail`) first.");
  }
  process.exit(1);
});
