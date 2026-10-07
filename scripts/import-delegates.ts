/**
 * Import the delegates from the organisers' master list ("App DataSet.xlsx")
 * and their goshthi groups ("eNAAM Goshthi Group Allocations.xlsx": the Bhaio
 * "E-Side" list and the Behno "I-side Groups" grid; the older one-tab-per-wing
 * "eNAAM Goshthi Groups.xlsx" still reads) into `users`. The workbooks are
 * read at run time and never copied into the repo: they hold personal details.
 *
 *   npm run delegates:import -- --master "<App DataSet.xlsx>" --goshthi "<Goshthi Group Allocations.xlsx>" [--baps-id <User Id>=<BAPS ID>]... --plan [--out <plan.json>]
 *   npm run delegates:import -- --master ... --goshthi ... --baps-id ... --dry-run     # read the database, print every change
 *   npm run delegates:import -- --master ... --goshthi ... --baps-id ... --apply       # write, in one transaction
 *   npm run delegates:import:lightsail -- --master ... --goshthi ... --baps-id ... --dry-run|--apply   # the shared Lightsail database
 *
 * Exactly one mode is required, and any other or misspelt argument stops the
 * script before it reads anything, so a typo never writes:
 *   --plan              No database at all: print the plan summary; with --out, also
 *                       write the normalised plan (personal data) as JSON. --out must
 *                       be outside the repo.
 *   --dry-run           Read the database and print exactly what would change; write nothing.
 *   --apply             Write the changes.
 *   --goshthi <file>    Repeatable. Only visible tabs are read. Without any, goshthi group,
 *                       room and moderator are left as they are.
 *   --baps-id <id>=<ID> Repeatable: the BAPS ID the organisers sent for master-list User Id
 *                       <id>, for a blank cell or to correct the sheet's (the given value
 *                       wins). Pass the same values on every run (plan, dry-run, apply).
 *   --master-sheet <n>  Master worksheet name (default: the first sheet).
 *   --env <file>        DATABASE_URL from another dotenv file.
 *
 * Every rule lives in src/lib/delegateImport.ts (planDelegates, reconcile) and
 * src/lib/goshthiImport.ts (the goshthi tabs). In short: rows are matched by
 * users.registration_id (the master list "User Id"), else by BAPS ID, which
 * then gets the User Id. The import owns registration_id, baps_id, name, email
 * (always <baps id>@na.baps.id), phone (only when the sheet has one; a missing
 * number never clears a phone on file), gender, seva, region, center,
 * personal_wing, seva_wing, seva_role, registration_status, preferred_channel
 * (EMAIL) and goshthi_group / goshthi_room / goshthi_moderator (only for the
 * tracks a goshthi workbook covers, and anyone it lists). Refunded
 * registrations are imported too, and a User Id on two rows once. test_code,
 * breakout_sessions, display_name, notifications_seen_at, last_sign_in_at and
 * sant_accommodation_id are never written; role is DELEGATE on new rows and
 * never changed on existing ones. SANT and ADMIN accounts are never touched,
 * and nothing is deleted: accounts imported before that are now gone are only
 * reported.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename, relative, resolve, isAbsolute, sep } from "node:path";
import { Workbook } from "exceljs";
import type { PrismaClient } from "@prisma/client";
import {
  EMAIL_CHANGE_GROUPS,
  idList,
  planDelegates,
  planSummary,
  reconcile,
  type BapsIdOverride,
  type DelegatePlan,
  type ExistingUser,
  type GoshthiWorkbook,
  type Reconciliation,
  type SheetRows,
} from "../src/lib/delegateImport";

const USAGE = [
  "Usage: npm run delegates:import -- --master <App DataSet.xlsx> [--goshthi <file>]... [--master-sheet <name>]",
  "         [--baps-id <User Id>=<BAPS ID>]... [--env <file>]",
  "         (--plan [--out <plan.json>] | --dry-run | --apply)",
].join("\n");

class UsageError extends Error {}

type Mode = "plan" | "dry-run" | "apply";
const MODES: readonly string[] = ["plan", "dry-run", "apply"] satisfies Mode[];
/** Options that take one value. */
const VALUE_OPTIONS: readonly string[] = ["master", "goshthi", "baps-id", "master-sheet", "out", "env"];
/** Options that may be given more than once. */
const REPEATABLE: readonly string[] = ["goshthi", "baps-id"];

/**
 * The arguments, strictly: exactly one mode, only known options, every option
 * with its value, nothing else. A typo ("--dryrun", "--dry-run=true", "--plan
 * plan.json", a pasted en dash) is an error rather than a silent apply.
 */
function parseArgs(argv: string[]): { mode: Mode; args: Record<string, string[]> } {
  const args: Record<string, string[]> = {};
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
    if (args[key] && !REPEATABLE.includes(key)) throw new UsageError(`${a} is given more than once`);
    (args[key] ??= []).push(value);
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
  if (!args.master) throw new UsageError('Missing --master "<path to App DataSet.xlsx>"');
  if (args.out && mode !== "plan") throw new UsageError("--out only goes with --plan");
  bapsIdOverrides(args); // a malformed --baps-id stops here, before anything is read
  return { mode, args };
}

/**
 * The --baps-id values as given ("<User Id>=<BAPS ID>"). Only the shape is
 * checked here; a User Id given twice, not in the list, or a BAPS ID that
 * can't sign in is a plan error (planDelegates()).
 */
function bapsIdOverrides(args: Record<string, string[]>): BapsIdOverride[] {
  return (args["baps-id"] ?? []).map((value) => {
    const m = value.match(/^\s*([^=\s]+)\s*=\s*([^=\s]+)\s*$/);
    if (!m) throw new UsageError(`--baps-id "${value}" must be <User Id>=<BAPS ID>, e.g. --baps-id 10107=AB1234567`);
    return { registrationId: m[1], bapsId: m[2] };
  });
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
 * Every worksheet of an .xlsx as rows of raw cell values (row 1 first), with
 * its merged ranges and state (visible / hidden): the goshthi tabs need both.
 */
async function readWorkbook(path: string): Promise<SheetRows[]> {
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
    return { name: ws.name, rows, merges, state: ws.state ?? "visible" };
  });
}

async function buildPlan(args: Record<string, string[]>): Promise<DelegatePlan> {
  const masterPath = args.master[0];
  const sheets = await readWorkbook(masterPath);
  const wanted = args["master-sheet"]?.[0];
  const master = wanted ? sheets.find((s) => s.name === wanted) : sheets[0];
  if (!master) {
    throw new Error(`${basename(masterPath)} has no sheet ${wanted ? `"${wanted}"` : ""} (sheets: ${sheets.map((s) => s.name).join(", ")})`);
  }
  const goshthiPaths = args.goshthi ?? [];
  const goshthi: GoshthiWorkbook[] | null =
    goshthiPaths.length > 0
      ? await Promise.all(goshthiPaths.map(async (p) => ({ file: basename(p), sheets: await readWorkbook(p) })))
      : null;
  return planDelegates(master, goshthi, { bapsIds: bapsIdOverrides(args) });
}

/** The plan JSON holds names, emails and phones: never inside the repo. */
function writePlanJson(plan: DelegatePlan, out: string, sources: string[]) {
  const repo = resolve(__dirname, "..");
  const target = resolve(out);
  const rel = relative(repo, target);
  // Outside only when it climbs out ("..", "../x") or is on another drive; "..plan.json" is inside.
  if (!(rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))) {
    throw new Error(`--out ${out} is inside the repo; the plan holds personal data, write it somewhere else (e.g. a temp folder)`);
  }
  const json = { generatedAt: new Date().toISOString(), sources: sources.map((s) => basename(s)), ...plan };
  writeFileSync(target, JSON.stringify(json, null, 2));
  console.log(`Plan written to ${target} (${plan.delegates.length} delegates; contains personal data)`);
}

const USER_SELECT = {
  id: true,
  role: true,
  registrationId: true,
  bapsId: true,
  name: true,
  email: true,
  phone: true,
  gender: true,
  seva: true,
  region: true,
  center: true,
  personalWing: true,
  sevaWing: true,
  sevaRole: true,
  registrationStatus: true,
  preferredChannel: true,
  goshthiGroup: true,
  goshthiRoom: true,
  goshthiModerator: true,
  breakoutSessions: true,
} as const;

async function applyPlan(prisma: PrismaClient, plan: DelegatePlan, dryRun: boolean): Promise<Reconciliation> {
  return prisma.$transaction(
    async (tx) => {
      const existing: ExistingUser[] = await tx.user.findMany({ select: USER_SELECT, orderBy: { bapsId: "asc" } });
      const r = reconcile(plan, existing);
      if (dryRun) return r;
      if (r.errors.length > 0) {
        for (const e of r.errors) console.error(`  ${e}`);
        throw new Error("A --baps-id value is already another account's (above): nothing was written.");
      }
      // Updates first, then creates. baps_id is unique, and reconcile() never plans a
      // BAPS ID another row holds (that is a conflict), so no write can collide.
      for (const u of r.updates) await tx.user.update({ where: { id: u.id }, data: u.data });
      if (r.creates.length > 0) {
        // Same columns on every row; a new row's phone and goshthi columns are empty unless the sheets set them.
        await tx.user.createMany({
          data: r.creates.map((c) => ({
            ...c.data,
            phone: c.data.phone ?? null,
            goshthiGroup: c.data.goshthiGroup ?? null,
            goshthiRoom: c.data.goshthiRoom ?? null,
            goshthiModerator: c.data.goshthiModerator ?? false,
            role: "DELEGATE" as const,
          })),
        });
      }
      return r;
    },
    // ~800 rows over a remote connection: one createMany plus an update per changed row.
    { maxWait: 20_000, timeout: 300_000 },
  );
}

function printReconciliation(r: Reconciliation, plan: DelegatePlan, dryRun: boolean) {
  const would = (done: string, todo: string) => (dryRun ? todo : done);
  const skipped = r.protectedAccounts.length + r.conflicts.length;
  console.log(
    `  Delegates: ${r.creates.length} ${would("created", "to create")}, ${r.updates.length} ${would("updated", "to update")}, ` +
      `${r.unchanged} unchanged, ${skipped} skipped here (+ ${plan.skipped.length} User Ids skipped by the plan, above)`,
  );
  if (r.errors.length > 0) {
    console.log(`  Errors, --apply refuses (a --baps-id value is already another account's): ${r.errors.length}`);
    for (const line of r.errors) console.log(`    ${line}`);
  }
  if (r.creates.length > 0) {
    console.log(`  ${would("Created", "Would create")} (User Id, BAPS ID, seva, goshthi group / room):`);
    for (const c of r.creates) {
      const d = c.delegate;
      const goshthi = [d.goshthiGroup, d.goshthiRoom, d.goshthiModerator ? "moderator" : null].filter(Boolean).join(" / ");
      console.log(`    + ${d.registrationId} ${d.bapsId} ${d.seva}${goshthi ? `, ${goshthi}` : ""}`);
    }
  }
  if (r.updates.length > 0) {
    console.log(`  ${would("Updated", "Would update")} (name, email and phone values are not printed):`);
    for (const u of r.updates) console.log(`    ~ ${u.delegate.registrationId} ${u.delegate.bapsId}: ${u.changes.join(", ")}`);
  }
  const emailChanges = EMAIL_CHANGE_GROUPS.reduce((n, g) => n + r.emailChanges[g], 0);
  console.log(
    `  Stored emails ${would("changed", "that change")} to <BAPS ID>@na.baps.id: ${emailChanges}` +
      (emailChanges > 0
        ? ` (currently ${EMAIL_CHANGE_GROUPS.filter((g) => r.emailChanges[g] > 0).map((g) => `${g} ${r.emailChanges[g]}`).join(", ")})`
        : ""),
  );
  if (r.bapsIdChanges.length > 0) {
    console.log(`  BAPS IDs ${would("changed", "that change")} (--baps-id corrections): ${r.bapsIdChanges.length}`);
    for (const line of r.bapsIdChanges) console.log(`    ${line}`);
  }
  if (r.protectedAccounts.length > 0) {
    console.log(`  Skipped, SANT and ADMIN accounts are never changed: ${r.protectedAccounts.length}`);
    for (const line of r.protectedAccounts) console.log(`    ${line}`);
  }
  if (r.conflicts.length > 0) {
    console.log(`  Skipped, User Id and BAPS ID disagree with the database: ${r.conflicts.length}`);
    for (const line of r.conflicts) console.log(`    ${line}`);
  }
  if (r.linkedBreakouts.length > 0) {
    console.log(
      `  Note: breakout_sessions linked by hand (kept; they override the team matching): ${r.linkedBreakouts.length}`,
    );
    for (const line of r.linkedBreakouts) console.log(`    ${line}`);
  }
  if (r.noLongerImported.length > 0) {
    console.log(`  Imported before but not in this plan (left as they are, not deleted): ${r.noLongerImported.length}`);
    for (const line of r.noLongerImported) console.log(`    ${line}`);
  }
  if (r.others.length > 0) {
    console.log("  Other accounts, not in the master list (left unchanged):");
    for (const o of r.others) console.log(`    ${o.role} ${o.bapsIds.length}: ${idList(o.bapsIds, 25)}`);
  }
}

async function main() {
  const { mode, args } = parseArgs(process.argv.slice(2));
  const dryRun = mode === "dry-run";

  const plan = await buildPlan(args);
  for (const line of planSummary(plan)) console.log(line);

  if (mode === "plan") {
    const out = args.out?.[0];
    if (out) writePlanJson(plan, out, [args.master[0], ...(args.goshthi ?? [])]);
    if (plan.errors.length > 0) process.exit(1);
    return;
  }
  if (plan.errors.length > 0) throw new Error("The plan has errors (above): nothing was written.");

  // Only with --env: the :lightsail script sets DATABASE_URL through dotenv-cli,
  // which loading .env here would override.
  const env = args.env?.[0];
  if (env) loadEnvFile(env);
  // Import after the env file is loaded so DATABASE_URL is picked up.
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const r = await applyPlan(prisma, plan, dryRun);
    // Read after the first query: Prisma loads .env itself when DATABASE_URL isn't set.
    const host = (process.env.DATABASE_URL ?? "the .env database").replace(/\/\/.*@/, "//***@");
    console.log("");
    console.log(`${dryRun ? "Dry run, nothing written: " : ""}delegate import into ${host}`);
    printReconciliation(r, plan, dryRun);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  if (e instanceof UsageError) console.error(USAGE);
  const code = (e as { code?: string })?.code;
  // P2022: a column is missing, e.g. users.registration_id before `prisma db push`.
  if (code === "P2022") {
    console.error("The database schema is behind: run `npm run db:push` (or `npm run db:push:lightsail`) first.");
  }
  if (code === "P2002") console.error("A unique value (BAPS ID or User Id) is already taken: nothing was written.");
  process.exit(1);
});
