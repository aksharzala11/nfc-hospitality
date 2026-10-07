/**
 * Import the organisers' rooming workbook ("FINAL Rooming List v17.xlsx") into
 * `room_groups` (one row per room group and stay, whoever is in it) and
 * `room_assignments` (one row per person and stay: WED = the night of Wed,
 * Oct 7; MAIN = from Thu, Oct 8). The workbook is read at run time and never
 * copied into the repo: it holds personal details.
 *
 *   npm run rooming:import -- --file "<FINAL Rooming List.xlsx>" --plan [--out <plan.json>] [--master "<App DataSet.xlsx>"]
 *   npm run rooming:import -- --file ... --dry-run     # read the database, print every change
 *   npm run rooming:import -- --file ... --apply       # write, in one transaction
 *   npm run rooming:import:lightsail -- --file ... --dry-run|--apply   # the shared Lightsail database
 *
 * Exactly one mode is required, and any other or misspelt argument stops the
 * script before it reads anything, so a typo never writes:
 *   --plan          No database at all: print the plan summary; with --out, also write
 *                   the normalised plan (User Ids and room groups, no names) as JSON.
 *                   --out must be outside the repo. With --master (the master list the
 *                   delegates import reads), also check offline who would have an
 *                   account and which room groups mix Bhaio and Behno.
 *   --dry-run       Read the database and print exactly what would change; write nothing.
 *   --apply         Write the changes.
 *   --allow-deletes With --apply: go ahead even when the deletes would empty a whole
 *                   hotel for a stay (refused otherwise: that is almost always a tab
 *                   gone wrong, not everyone leaving). Check the --dry-run first.
 *   --env <file>    DATABASE_URL from another dotenv file.
 *
 * Every rule lives in src/lib/roomingImport.ts (planRooming, reconcileRooming,
 * reconcileRoomGroups, checkRoomingPeople). In short: only the five hotel tabs
 * of ROOMING_TABS are read, and each must be there and visible (else the plan
 * has errors and nothing is written); assignments are keyed by (User Id, stay)
 * and linked to users by users.registration_id, not by a foreign key, so people
 * not imported as users yet are stored too (and listed). --apply upserts every
 * planned room group and assignment and deletes those no longer in the
 * workbook (assignments of people skipped for conflicting rows are left
 * alone). The users table is only read (tracks for the mixed-room check),
 * never written.
 */
import { writeFileSync, readFileSync } from "node:fs";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { Workbook } from "exceljs";
import type { PrismaClient } from "@prisma/client";
import { idList, planDelegates, type SheetRows } from "../src/lib/delegateImport";
import { STAY_LABELS, hotelInfo, type Stay } from "../src/lib/hotels";
import {
  checkRoomingPeople,
  peopleCheckSummary,
  planRooming,
  planSummary,
  reconcileRoomGroups,
  reconcileRooming,
  type AssignmentRef,
  type ExistingAssignment,
  type ExistingRoomGroup,
  type PlannedAssignment,
  type PlannedRoom,
  type RoomGroupReconciliation,
  type RoomingPeopleCheck,
  type RoomingPlan,
  type RoomingReconciliation,
  type RoomingSheet,
} from "../src/lib/roomingImport";

const USAGE = [
  "Usage: npm run rooming:import -- --file <FINAL Rooming List.xlsx> [--env <file>]",
  "         (--plan [--out <plan.json>] [--master <App DataSet.xlsx>] | --dry-run | --apply [--allow-deletes])",
].join("\n");

class UsageError extends Error {}

type Mode = "plan" | "dry-run" | "apply";
const MODES: readonly string[] = ["plan", "dry-run", "apply"] satisfies Mode[];
/** Options that take one value. */
const VALUE_OPTIONS: readonly string[] = ["file", "out", "env", "master"];
/** Options without a value. */
const FLAG_OPTIONS: readonly string[] = ["allow-deletes"];

/**
 * The arguments, strictly: exactly one mode, only known options, every option
 * with its value, nothing else. A typo ("--dryrun", "--dry-run=true", "--plan
 * plan.json", a pasted en dash) is an error rather than a silent apply.
 */
function parseArgs(argv: string[]): { mode: Mode; args: Record<string, string>; flags: Set<string> } {
  const args: Record<string, string> = {};
  const flags = new Set<string>();
  const modes: Mode[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new UsageError(`Unexpected argument "${a}"`);
    const key = a.slice(2);
    if (MODES.includes(key)) {
      modes.push(key as Mode);
      continue;
    }
    if (FLAG_OPTIONS.includes(key)) {
      if (flags.has(key)) throw new UsageError(`${a} is given more than once`);
      flags.add(key);
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
  if (!args.file) throw new UsageError('Missing --file "<path to the rooming workbook>"');
  if (args.out && mode !== "plan") throw new UsageError("--out only goes with --plan");
  if (args.master && mode !== "plan") throw new UsageError("--master only goes with --plan (the database is the check otherwise)");
  if (args.env && mode === "plan") throw new UsageError("--env does nothing with --plan (no database)");
  if (flags.has("allow-deletes") && mode !== "apply") throw new UsageError("--allow-deletes only goes with --apply");
  return { mode, args, flags };
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
 * Every worksheet as rows of raw cell values (row 1 first), its merged ranges
 * and its state (visible / hidden): the planner reads only visible hotel tabs.
 */
async function readWorkbook(path: string): Promise<RoomingSheet[]> {
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

/**
 * The people the master-list import would create, offline: its own planner
 * (src/lib/delegateImport.ts) on the first sheet of --master, so the tracks
 * and the skipped User Ids are exactly the import's.
 */
async function masterListPeople(path: string) {
  const wb = new Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error(`${basename(path)} has no worksheet`);
  const rows: unknown[][] = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cells: unknown[] = [];
    for (let c = 1; c <= ws.columnCount; c++) cells.push(row.getCell(c).value);
    rows.push(cells);
  }
  const sheet: SheetRows = { name: ws.name, rows };
  const plan = planDelegates(sheet, null, null);
  const skipped = new Map(plan.skipped.map((s) => [s.registrationId, s.reason]));
  return { people: plan.delegates.map((d) => ({ registrationId: d.registrationId, gender: d.gender })), skipped };
}

/** The plan JSON holds User Ids and room groups: never inside the repo. */
function writePlanJson(plan: RoomingPlan, check: RoomingPeopleCheck | null, out: string, source: string) {
  const repo = resolve(__dirname, "..");
  const target = resolve(out);
  const rel = relative(repo, target);
  // Outside only when it climbs out ("..", "../x") or is on another drive; "..plan.json" is inside.
  if (!(rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))) {
    throw new Error(`--out ${out} is inside the repo; the plan holds personal data, write it somewhere else (e.g. a temp folder)`);
  }
  const json = { generatedAt: new Date().toISOString(), source: basename(source), ...plan, peopleCheck: check };
  writeFileSync(target, JSON.stringify(json, null, 2));
  console.log(`Plan written to ${target} (${plan.assignments.length} assignments; contains User Ids)`);
}

const ASSIGNMENT_SELECT = {
  id: true,
  registrationId: true,
  stay: true,
  hotel: true,
  roomNumber: true,
  bed: true,
  roomKey: true,
  roomCapacity: true,
  roomOpenBeds: true,
  sourceSheet: true,
} as const;

/** The columns of a planned assignment other than its key. */
function assignmentData(a: PlannedAssignment) {
  return {
    hotel: a.hotel,
    roomNumber: a.roomNumber,
    bed: a.bed,
    roomKey: a.roomKey,
    roomCapacity: a.roomCapacity,
    roomOpenBeds: a.roomOpenBeds,
    sourceSheet: a.sourceSheet,
  };
}

const ROOM_GROUP_SELECT = {
  roomKey: true,
  stay: true,
  hotel: true,
  roomNumber: true,
  capacity: true,
  openBeds: true,
  heldBeds: true,
  heldRegistrationIds: true,
  sourceSheet: true,
} as const;

/** The columns of a planned room group other than its key. */
function roomGroupData(room: PlannedRoom) {
  return {
    stay: room.stay,
    hotel: room.hotel,
    roomNumber: room.roomNumber,
    capacity: room.capacity,
    openBeds: room.openBeds,
    heldBeds: room.heldBeds,
    heldRegistrationIds: room.heldRegistrationIds,
    sourceSheet: room.sheet,
  };
}

type ApplyResult = {
  r: RoomingReconciliation;
  groups: RoomGroupReconciliation;
  check: RoomingPeopleCheck;
  /** --apply stopped before writing: the deletes would empty a hotel and --allow-deletes wasn't given. */
  refused: boolean;
};

async function applyPlan(
  prisma: PrismaClient,
  plan: RoomingPlan,
  { dryRun, allowDeletes }: { dryRun: boolean; allowDeletes: boolean },
): Promise<ApplyResult> {
  return prisma.$transaction(
    async (tx) => {
      const existing: ExistingAssignment[] = await tx.roomAssignment.findMany({ select: ASSIGNMENT_SELECT });
      const existingGroups: ExistingRoomGroup[] = await tx.roomGroup.findMany({ select: ROOM_GROUP_SELECT });
      // Read only: who has an account, and their track for the mixed-room check.
      const users = await tx.user.findMany({
        where: { registrationId: { not: null } },
        select: { registrationId: true, gender: true },
      });
      const r = reconcileRooming(plan, existing);
      const groups = reconcileRoomGroups(plan, existingGroups);
      const check = checkRoomingPeople(plan, users);
      if (dryRun) return { r, groups, check, refused: false };
      if (r.emptied.length > 0 && !allowDeletes) return { r, groups, check, refused: true };

      if (r.deletes.length > 0) {
        await tx.roomAssignment.deleteMany({ where: { id: { in: r.deletes.map((d) => d.id) } } });
      }
      if (groups.deletes.length > 0) {
        await tx.roomGroup.deleteMany({ where: { roomKey: { in: groups.deletes } } });
      }
      if (groups.creates.length > 0) {
        await tx.roomGroup.createMany({ data: groups.creates.map((room) => ({ roomKey: room.roomKey, ...roomGroupData(room) })) });
      }
      for (const u of groups.updates) {
        await tx.roomGroup.update({ where: { roomKey: u.room.roomKey }, data: roomGroupData(u.room) });
      }
      if (r.creates.length > 0) {
        await tx.roomAssignment.createMany({
          data: r.creates.map((a) => ({ id: a.id, registrationId: a.registrationId, stay: a.stay, ...assignmentData(a) })),
        });
      }
      // Upsert by (registration_id, stay); the row keeps its id.
      for (const u of r.updates) {
        await tx.roomAssignment.update({
          where: { registrationId_stay: { registrationId: u.assignment.registrationId, stay: u.assignment.stay } },
          data: assignmentData(u.assignment),
        });
      }
      return { r, groups, check, refused: false };
    },
    // ~150 room groups and ~500 rows over a remote connection: a createMany each plus an update per changed row.
    { maxWait: 20_000, timeout: 300_000 },
  );
}

function printReconciliation(r: RoomingReconciliation, groups: RoomGroupReconciliation, dryRun: boolean) {
  const would = (done: string, todo: string) => (dryRun ? todo : done);
  const refs = (list: readonly (AssignmentRef | PlannedAssignment)[]) => idList(list.map((a) => `${a.registrationId} ${a.stay}`), 30);
  console.log(
    `  Room groups: ${groups.creates.length} ${would("created", "to create")}, ${groups.updates.length} ${would("updated", "to update")}, ` +
      `${groups.unchanged} unchanged, ${groups.deletes.length} ${would("deleted", "to delete")}`,
  );
  if (groups.creates.length > 0) console.log(`    ${would("Created", "Would create")}: ${idList(groups.creates.map((g) => g.roomKey), 30)}`);
  if (groups.updates.length > 0) {
    console.log(`    ${would("Updated", "Would update")}:`);
    for (const u of groups.updates) console.log(`      ~ ${u.room.roomKey}: ${u.changes.join(", ")}`);
  }
  if (groups.deletes.length > 0) console.log(`    ${would("Deleted", "Would delete")} (no longer in the workbook): ${idList(groups.deletes, 30)}`);
  console.log(
    `  Assignments: ${r.creates.length} ${would("created", "to create")}, ${r.updates.length} ${would("updated", "to update")}, ` +
      `${r.unchanged} unchanged, ${r.deletes.length} ${would("deleted", "to delete")}`,
  );
  if (r.creates.length > 0) console.log(`    ${would("Created", "Would create")}: ${refs(r.creates)}`);
  if (r.updates.length > 0) {
    console.log(`    ${would("Updated", "Would update")}:`);
    for (const u of r.updates) console.log(`      ~ ${u.assignment.registrationId} ${u.assignment.stay}: ${u.changes.join(", ")}`);
  }
  if (r.deletes.length > 0) console.log(`    ${would("Deleted", "Would delete")} (no longer in the workbook): ${refs(r.deletes)}`);
  if (r.keptForConflicts.length > 0) {
    console.log(`    Left as they are (person skipped for conflicting rows): ${refs(r.keptForConflicts)}`);
  }
  for (const e of r.emptied) {
    console.log(
      `    ! Empties ${hotelInfo(e.hotel).name} ${e.stay} (${STAY_LABELS[e.stay]}): all ${e.rows} people there ${would("were", "would be")} deleted`,
    );
  }
}

async function main() {
  const { mode, args, flags } = parseArgs(process.argv.slice(2));
  const dryRun = mode === "dry-run";

  const plan = planRooming(await readWorkbook(args.file));
  for (const line of planSummary(plan)) console.log(line);

  if (mode === "plan") {
    let check: RoomingPeopleCheck | null = null;
    if (args.master) {
      const { people, skipped } = await masterListPeople(args.master);
      check = checkRoomingPeople(plan, people);
      for (const line of peopleCheckSummary(check, plan, `the master list ${basename(args.master)}, as the delegates import reads it`)) {
        console.log(line);
      }
      const why = check.notOnFile.map((id) => `${id}: ${skipped.get(id) ?? "not in the master list"}`);
      if (why.length > 0) console.log(`  Why not on file: ${idList(why, 60)}`);
    }
    if (args.out) writePlanJson(plan, check, args.out, args.file);
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
    const { r, groups, check, refused } = await applyPlan(prisma, plan, { dryRun, allowDeletes: flags.has("allow-deletes") });
    // Read after the first query: Prisma loads .env itself when DATABASE_URL isn't set.
    const host = (process.env.DATABASE_URL ?? "the .env database").replace(/\/\/.*@/, "//***@");
    console.log("");
    for (const line of peopleCheckSummary(check, plan, "users in the database")) console.log(line);
    console.log("");
    console.log(`${dryRun || refused ? "Nothing written: " : ""}rooming import into ${host}`);
    for (const stay of ["WED", "MAIN"] as Stay[]) {
      console.log(`  ${stay} = ${STAY_LABELS[stay]}`);
    }
    printReconciliation(r, groups, dryRun || refused);
    if (refused) {
      throw new Error(
        "Refused: these deletes would empty a whole hotel for a stay (above). Check the workbook's hotel tabs; " +
          "if everyone there really has left, run --apply again with --allow-deletes.",
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  if (e instanceof UsageError) console.error(USAGE);
  // P2021: room_assignments is missing.
  if ((e as { code?: string })?.code === "P2021") {
    console.error("The database schema is behind: run `npm run db:push` (or `npm run db:push:lightsail`) first.");
  }
  process.exit(1);
});
