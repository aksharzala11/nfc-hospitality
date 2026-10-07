/**
 * Sync the Pujya Santos' personal programmes from prisma/sant-personal-data.ts (generated from
 * the "Individual Schedule" tab of the organisers' Santo workbook) into `sant_schedule_items`,
 * ids "sp-*". New items are created, changed ones rewritten and "sp-" rows no longer in the data
 * deleted, in one transaction; every other row (the tester SANTO0001's sample programme) is left
 * alone and only counted. See prisma/sant-personal.ts.
 *
 *   npm run sant:personal:sync                      # DATABASE_URL from the environment / .env (local)
 *   npm run sant:personal:sync:lightsail            # the shared Lightsail database (.env.lightsail)
 *   npm run sant:personal:sync -- --dry-run         # only print what would change
 *   npm run sant:personal:sync -- --allow-deletes   # go ahead even when a santo loses every "sp-" row
 *   npm run sant:personal:sync -- --env <file>      # DATABASE_URL from another dotenv file
 *
 * The santos must exist first (`npm run santos:import`): a listed BAPS ID without an account, or
 * held by an account that isn't a SANT, stops the sync with nothing written. A run whose deletes
 * would take every "sp-" row from a santo (one dropped from the data) writes nothing unless
 * --allow-deletes: check the --dry-run first. Not run by the seed.
 */
import { readFileSync } from "node:fs";
import { santPersonalSummary, syncSantPersonal } from "../prisma/sant-personal";
import { npmTook, wantsDryRun } from "./npm-flags";

/**
 * Options that take a value, and flags. Anything else is refused (a typo would otherwise write).
 * A --dry-run npm swallowed (no "--" before it) still makes a dry run: see ./npm-flags.ts.
 */
const VALUE_OPTIONS = new Set(["env"]);
const FLAG_OPTIONS = new Set(["dry-run", "allow-deletes"]);

function parseArgs(argv: string[]) {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new Error(`Unexpected argument "${a}".`);
    const name = a.slice(2);
    if (VALUE_OPTIONS.has(name)) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) throw new Error(`--${name} needs a value.`);
      out[name] = next;
      i++;
    } else if (FLAG_OPTIONS.has(name)) out[name] = "true";
    else throw new Error(`Unknown option --${name} (known: --dry-run, --allow-deletes, --env <file>).`);
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
  const allowDeletes = args["allow-deletes"] === "true";

  // Import after the env file is loaded so DATABASE_URL is picked up.
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const result = await syncSantPersonal(prisma, { dryRun, allowDeletes });
    // Read after the first query: Prisma loads .env itself when DATABASE_URL isn't set.
    const host = (process.env.DATABASE_URL ?? "the .env database").replace(/\/\/.*@/, "//***@");
    const written = !dryRun && !result.refused;
    const lead = dryRun ? "Dry run, nothing written: " : result.refused ? "Refused, nothing written: " : "";
    console.log(`${lead}Santo personal programmes in ${host}`);
    for (const line of santPersonalSummary(result)) console.log(`  ${line}`);
    if (result.deletedIds.length) {
      console.log(`  ${written ? "Deleted" : "Would delete"}: ${result.deletedIds.join(", ")}`);
    }
    if (result.refused) {
      throw new Error(
        'Refused: these deletes would take every "sp-" row from a santo (above). Check prisma/sant-personal-data.ts; ' +
          "if his programme really is gone, run again with --allow-deletes." +
          (npmTook("allow-deletes") ? ' npm took this run\'s --allow-deletes as its own option: put "--" before it.' : ""),
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  // P2021 / P2022: the table or a column doesn't exist yet (before `prisma db push`).
  const code = (e as { code?: string })?.code;
  if (code === "P2021" || code === "P2022") {
    console.error("The database schema is behind: run `npm run db:push` (or `npm run db:push:lightsail`) first.");
  }
  process.exit(1);
});
