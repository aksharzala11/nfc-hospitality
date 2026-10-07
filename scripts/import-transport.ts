/**
 * Import the organisers' transport workbook ("Transportation Information.xlsx")
 * into `transport_legs` (one arrival and one departure per person) and
 * users.accommodation_package. The workbook is read at run time and never
 * copied into the repo: it holds personal details.
 *
 *   npm run transport:import -- --file "<Transportation Information.xlsx>" --plan [--out <plan.json>]
 *   npm run transport:import -- --file ... --dry-run     # read the database, print every change
 *   npm run transport:import -- --file ... --apply       # write, in one transaction
 *   npm run transport:import:lightsail -- --file ... --dry-run|--apply   # the shared Lightsail database
 *
 * Exactly one mode is required, and any other or misspelt argument stops the
 * script before it reads anything, so a typo never writes:
 *   --plan          No database at all: print the plan summary; with --out, also write
 *                   the normalised plan (flights, drivers and the disagreeing values)
 *                   as JSON. --out must be outside the repo.
 *   --dry-run       Read the database and print exactly what would change; write nothing.
 *   --apply         Write the changes.
 *   --env <file>    DATABASE_URL from another dotenv file.
 *
 * Every rule lives in src/lib/transportImport.ts (planTransport,
 * reconcileTransport). In short: legs are keyed by (User Id, direction) and
 * linked to users by users.registration_id, not by a foreign key, so people
 * not imported as users yet are stored too (and listed). --apply upserts every
 * planned leg, deletes legs whose person no longer has that leg in the
 * workbook (legs of people skipped for conflicting rows are left alone), and
 * sets users.accommodation_package for existing users from "Fee Description"
 * (a blank cell never clears it). No other users column is written.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { Workbook } from "exceljs";
import type { PrismaClient } from "@prisma/client";
import { idList } from "../src/lib/delegateImport";
import {
  planSummary,
  planTransport,
  reconcileTransport,
  type Direction,
  type ExistingLeg,
  type PlannedLeg,
  type TransportPlan,
  type TransportReconciliation,
  type TransportSheet,
} from "../src/lib/transportImport";

const USAGE = [
  "Usage: npm run transport:import -- --file <Transportation Information.xlsx> [--env <file>]",
  "         (--plan [--out <plan.json>] | --dry-run | --apply)",
].join("\n");

class UsageError extends Error {}

type Mode = "plan" | "dry-run" | "apply";
const MODES: readonly string[] = ["plan", "dry-run", "apply"] satisfies Mode[];
/** Options that take one value. */
const VALUE_OPTIONS: readonly string[] = ["file", "out", "env"];

/**
 * The arguments, strictly: exactly one mode, only known options, every option
 * with its value, nothing else. A typo ("--dryrun", "--dry-run=true", "--plan
 * plan.json", a pasted en dash) is an error rather than a silent apply.
 */
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
        ? "Choose a mode: --plan, --dry-run or --apply"
        : `Choose one mode, not ${modes.map((m) => `--${m}`).join(" and ")}`,
    );
  }
  const [mode] = modes;
  if (!args.file) throw new UsageError('Missing --file "<path to the transport workbook>"');
  if (args.out && mode !== "plan") throw new UsageError("--out only goes with --plan");
  return { mode, args };
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
 * Every worksheet as rows of raw cell values (row 1 = header) plus its merged
 * ranges. exceljs already returns a merged range's value from each of its
 * cells; the planner fills merges itself too, so it never depends on that.
 */
async function readWorkbook(path: string): Promise<TransportSheet[]> {
  const wb = new Workbook();
  await wb.xlsx.readFile(path);
  return wb.worksheets.map((ws) => {
    const rows: unknown[][] = [];
    for (let r = 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const cells: unknown[] = [];
      for (let c = 1; c <= ws.columnCount; c++) cells.push(row.getCell(c).value);
      rows.push(cells);
    }
    const merges: string[] = (ws.model as { merges?: string[] }).merges ?? [];
    return { name: ws.name, rows, merges };
  });
}

/** The plan JSON holds flights, drivers and the disagreeing values: never inside the repo. */
function writePlanJson(plan: TransportPlan, out: string, source: string) {
  const repo = resolve(__dirname, "..");
  const target = resolve(out);
  const rel = relative(repo, target);
  // Outside only when it climbs out ("..", "../x") or is on another drive; "..plan.json" is inside.
  if (!(rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))) {
    throw new Error(`--out ${out} is inside the repo; the plan holds personal data, write it somewhere else (e.g. a temp folder)`);
  }
  const json = { generatedAt: new Date().toISOString(), source: basename(source), ...plan };
  writeFileSync(target, JSON.stringify(json, null, 2));
  console.log(`Plan written to ${target} (${plan.legs.length} legs; contains personal data)`);
}

const LEG_SELECT = {
  id: true,
  registrationId: true,
  direction: true,
  mode: true,
  needsService: true,
  airportCode: true,
  airportName: true,
  localDate: true,
  localTime: true,
  sortAt: true,
  airline: true,
  flight: true,
  groupNumber: true,
  groupKey: true,
  driverName: true,
  driverPhone: true,
  sourceSheet: true,
} as const;

/** The columns of a planned leg, for Prisma (sortAt as a Date). */
function legData(l: PlannedLeg) {
  return {
    mode: l.mode,
    needsService: l.needsService,
    airportCode: l.airportCode,
    airportName: l.airportName,
    localDate: l.localDate,
    localTime: l.localTime,
    sortAt: l.sortAt ? new Date(l.sortAt) : null,
    airline: l.airline,
    flight: l.flight,
    groupNumber: l.groupNumber,
    groupKey: l.groupKey,
    driverName: l.driverName,
    driverPhone: l.driverPhone,
    sourceSheet: l.sourceSheet,
  };
}

async function applyPlan(prisma: PrismaClient, plan: TransportPlan, dryRun: boolean): Promise<TransportReconciliation> {
  return prisma.$transaction(
    async (tx) => {
      const existing: ExistingLeg[] = await tx.transportLeg.findMany({ select: LEG_SELECT });
      const users = await tx.user.findMany({
        where: { registrationId: { not: null } },
        select: { id: true, registrationId: true, accommodationPackage: true },
      });
      const r = reconcileTransport(plan, existing, users);
      if (dryRun) return r;
      if (r.deletes.length > 0) {
        await tx.transportLeg.deleteMany({ where: { id: { in: r.deletes.map((d) => d.id) } } });
      }
      if (r.creates.length > 0) {
        await tx.transportLeg.createMany({
          data: r.creates.map((l) => ({ id: l.id, registrationId: l.registrationId, direction: l.direction, ...legData(l) })),
        });
      }
      // Upsert by (registration_id, direction); the row keeps its id.
      for (const u of r.updates) {
        await tx.transportLeg.update({
          where: { registrationId_direction: { registrationId: u.leg.registrationId, direction: u.leg.direction } },
          data: legData(u.leg),
        });
      }
      // Only accommodation_package (Prisma also bumps updated_at).
      for (const p of r.packageUpdates) {
        await tx.user.update({ where: { id: p.userId }, data: { accommodationPackage: p.to } });
      }
      return r;
    },
    // ~500 legs over a remote connection: one createMany plus an update per changed leg.
    { maxWait: 20_000, timeout: 300_000 },
  );
}

const DIRECTION_WORD: Record<Direction, string> = { ARRIVAL: "arrival", DEPARTURE: "departure" };

function printReconciliation(r: TransportReconciliation, dryRun: boolean) {
  const would = (done: string, todo: string) => (dryRun ? todo : done);
  const legIds = (list: { registrationId: string; direction: Direction }[]) =>
    idList(list.map((l) => `${l.registrationId} ${DIRECTION_WORD[l.direction]}`), 30);
  console.log(
    `  Legs: ${r.creates.length} ${would("created", "to create")}, ${r.updates.length} ${would("updated", "to update")}, ` +
      `${r.unchanged} unchanged, ${r.deletes.length} ${would("deleted", "to delete")}`,
  );
  if (r.creates.length > 0) console.log(`    ${would("Created", "Would create")}: ${legIds(r.creates)}`);
  if (r.updates.length > 0) {
    console.log(`    ${would("Updated", "Would update")} (fields only, values not printed):`);
    for (const u of r.updates) console.log(`      ~ ${u.leg.registrationId} ${DIRECTION_WORD[u.leg.direction]}: ${u.changes.join(", ")}`);
  }
  if (r.deletes.length > 0) console.log(`    ${would("Deleted", "Would delete")} (no longer in the workbook): ${legIds(r.deletes)}`);
  if (r.keptForConflicts.length > 0) {
    console.log(`    Left as they are (person skipped for conflicting rows): ${legIds(r.keptForConflicts)}`);
  }
  console.log(
    `  Accommodation packages: ${r.packageUpdates.length} ${would("set", "to set")}, ${r.packagesUnchanged} unchanged`,
  );
  if (r.packageUpdates.length > 0) {
    console.log(`    ${would("Set", "Would set")} for User Id ${idList(r.packageUpdates.map((p) => p.registrationId))}`);
  }
  if (r.packagesKept.length > 0) {
    console.log(
      `    Kept (a package on file; Fee Description blank or not in the full record): User Id ${idList(r.packagesKept)}`,
    );
  }
  if (r.notUsers.length > 0) {
    console.log(
      `  People with legs but no users row yet (stored anyway; they link by User Id once imported): ${r.notUsers.length}`,
    );
    console.log(`    User Id ${idList(r.notUsers)}`);
  }
}

async function main() {
  const { mode, args } = parseArgs(process.argv.slice(2));
  const dryRun = mode === "dry-run";

  const plan = planTransport(await readWorkbook(args.file));
  for (const line of planSummary(plan)) console.log(line);

  if (mode === "plan") {
    if (args.out) writePlanJson(plan, args.out, args.file);
    if (plan.errors.length > 0) process.exit(1);
    return;
  }
  if (plan.errors.length > 0) throw new Error("The plan has errors (above): nothing was written.");

  // Only with --env: the :lightsail script sets DATABASE_URL through dotenv-cli,
  // which loading .env here would override.
  if (args.env) loadEnvFile(args.env);
  // Import after the env file is loaded so DATABASE_URL is picked up.
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const r = await applyPlan(prisma, plan, dryRun);
    // Read after the first query: Prisma loads .env itself when DATABASE_URL isn't set.
    const host = (process.env.DATABASE_URL ?? "the .env database").replace(/\/\/.*@/, "//***@");
    console.log("");
    console.log(`${dryRun ? "Dry run, nothing written: " : ""}transport import into ${host}`);
    printReconciliation(r, dryRun);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  if (e instanceof UsageError) console.error(USAGE);
  const code = (e as { code?: string })?.code;
  // P2021: transport_legs is missing; P2022: users.accommodation_package is missing.
  if (code === "P2021" || code === "P2022") {
    console.error("The database schema is behind: run `npm run db:push` (or `npm run db:push:lightsail`) first.");
  }
  process.exit(1);
});
