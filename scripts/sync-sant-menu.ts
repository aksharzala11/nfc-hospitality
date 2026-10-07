/**
 * Sync the Pujya Santo menu from prisma/sant-menu-data.ts (the kitchen team's menu, now the
 * "Menu" tab of the organisers' Santo workbook) into `meals` (menu_for = SANT, ids "sm-*") and their
 * `menu_items`. New meals and dishes are created, changed ones rewritten, and SANT meals and
 * dishes no longer in the data deleted, in one transaction; DELEGATE meals are never touched.
 * See prisma/sant-menu.ts.
 *
 *   npm run sant:menu:sync                      # DATABASE_URL from the environment / .env (local)
 *   npm run sant:menu:sync:lightsail            # the shared Lightsail database (.env.lightsail)
 *   npm run sant:menu:sync -- --dry-run         # only print what would change
 *   npm run sant:menu:sync -- --env <file>      # DATABASE_URL from another dotenv file
 *
 * `npm run db:seed` runs the same sync. Each meal takes its times from the Santo general
 * schedule (prisma/sant-schedule-data.ts): after a change to a meal's time there, run this too.
 */
import { readFileSync } from "node:fs";
import { santMenuSummary, syncSantMenu } from "../prisma/sant-menu";
import { wantsDryRun } from "./npm-flags";
import { formatDayShort, formatTime, dayKey } from "../src/lib/time";

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
    const result = await syncSantMenu(prisma, { dryRun });
    // Read after the first query: Prisma loads .env itself when DATABASE_URL isn't set.
    const host = (process.env.DATABASE_URL ?? "the .env database").replace(/\/\/.*@/, "//***@");
    console.log(`${dryRun ? "Dry run, nothing written: " : ""}Santo menu in ${host}`);
    for (const line of santMenuSummary(result)) console.log(`  ${line}`);
    const verb = { create: dryRun ? "create" : "created", update: dryRun ? "update" : "updated", unchanged: "unchanged" };
    for (const c of result.changes) {
      const when = `${formatDayShort(dayKey(c.startsAt))} ${formatTime(c.startsAt)} – ${formatTime(c.endsAt)}`;
      console.log(`    ${verb[c.action].padEnd(9)} ${c.id}  ${when}  ${c.name} (${c.dishes} dishes)`);
    }
    for (const m of result.deletedMeals) {
      console.log(`    ${(dryRun ? "delete" : "deleted").padEnd(9)} ${m.id}  ${m.name} (${m.dishes} dishes)`);
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
