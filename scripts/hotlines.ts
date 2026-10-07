/**
 * Manage the hotlines: the phone lines the app shows to one kind of account.
 *
 *   - role delegate: the delegates' help contacts. A line shows on /stay
 *     ("Questions about your room?") when its topic is stay or general, and on
 *     /transportation ("Need a change?") when it is transport or general, to
 *     the delegates of its track (bhaio / behno, or all = both). The card
 *     reads: the label (e.g. "Accommodation"), the person's name, the number,
 *     the availability when set, and a Call button. A page with no matching
 *     line shows no help block at all. Rules: src/lib/helpContacts.ts.
 *   - role sant: the Pujya Santo view's lines, lowest sort first: /sant/transport
 *     and the home's Transport tile show the transport lines, then the general
 *     ones; /sant/stay ("Contacts") the stay lines (utaro / laundry), then the
 *     general ones (src/lib/sant.ts santContactsFor()). --topic is optional for
 *     a sant line (default general); track doesn't apply there: leave it out.
 *
 * The names and numbers live only in the database: never put them in code,
 * data files or docs.
 *
 *   npm run hotlines -- --list
 *     Every line with its id, role, topic, track, label, name, phone (masked to
 *     the last 4 digits), availability and sort, then how many contacts a
 *     Bhaio and a Behno delegate see on each page.
 *
 *   npm run hotlines -- --add --role delegate --topic stay --track bhaio --label "Accommodation"
 *                       --name "First Last" --phone "(732) 555-0142" [--availability "8 AM – 10 PM"] [--sort <n>]
 *     Adds one line. --role delegate | sant; --topic general | stay |
 *     transport and --track bhaio | behno | all (both required for a delegate
 *     line; a sant one takes an optional --topic, default general, and no
 *     --track); --label what the card is headed;
 *     --name the person (may be left out: the card then shows the label
 *     alone); --phone any US/Canada form, e.g. "(732) 555-0142" or
 *     "732-555-0142", or E.164 (stored as E.164; no extension, and a +1 number
 *     must be a valid North American one); --sort lower first (default 0).
 *     Refuses a number or a name that a line shown beside this one already has
 *     (same role; for delegate lines the same page, i.e. the same topic or
 *     either one general, and the same track or either one all): one person
 *     would show twice. To correct a line: --remove --id <id>, then --add again.
 *
 *   npm run hotlines -- --remove --id <id>
 *     Deletes the line with that id (as --list prints it).
 *
 *   npm run hotlines -- --update --id <id> --telegram <username | none>
 *     Sets (or, with none, clears) a line's Telegram username: the Santo pages
 *     then show "Message on Telegram" beside its Call button (user, 2026-10-06;
 *     the delegates' pages don't). Any form the organisers write works: "@name",
 *     "name", "t.me/name", or a phone number (src/lib/telegram.ts). --add takes
 *     --telegram too. Needs the telegram column (db:push, 2026-10-06 schema).
 *
 *   --dry-run      with --add / --remove / --update: print what would change, write nothing.
 *   --env <file>   take DATABASE_URL from another dotenv file (the :lightsail
 *                  script sets it through dotenv-cli instead).
 *   npm run hotlines:lightsail -- ...   the shared Lightsail database.
 *
 * Any unknown or misspelt option stops the script before it touches the
 * database. The output has the lines' labels and names (needed to manage the
 * list) and masked phones, nothing else. A database needs `npm run db:push`
 * (or `db:push:lightsail`) once for the topic and track columns (added
 * 2026-10-01): until then --list shows the lines without them, --remove works,
 * and --add says to push first (for a sant line too: every new row writes
 * those columns).
 *
 * ORDER, for a deployed hub: (1) deploy the code that reads topic and track
 * (2026-10-01 on), (2) push the schema, (3) add the delegate lines. The code
 * before that shows every delegate line on both pages to both tracks, so a
 * line added for one track while it is still live is shown to the other too.
 */
import type { Audience, HotlineTopic, PrismaClient, UserRole } from "@prisma/client";
import { normalizeTelegram } from "../src/lib/telegram";
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

const USAGE = `Usage (see scripts/hotlines.ts for details):
  npm run hotlines[:lightsail] -- --list
  npm run hotlines[:lightsail] -- --add --role <delegate|sant> --topic <general|stay|transport> --track <bhaio|behno|all>
                                  --label "<Label>" --name "<Name>" --phone "<+1...>"
                                  [--availability "<hours>"] [--sort <n>] [--telegram "<username>"] [--dry-run]
                                  (both required for a delegate line; a sant one takes only an optional --topic, default general)
  npm run hotlines[:lightsail] -- --remove --id <id> [--dry-run]
  npm run hotlines[:lightsail] -- --update --id <id> --telegram "<username | none>" [--dry-run]
  Add --env <file> to take DATABASE_URL from another dotenv file.
  --add (a sant line too) needs the topic / track columns: run db:push first, with the hub code of 2026-10-01 or later deployed.`;

const VALUE_OPTIONS = new Set(["env", "role", "topic", "track", "label", "name", "phone", "availability", "sort", "id", "telegram"]);
const FLAG_OPTIONS = new Set(["list", "add", "remove", "update", "dry-run", "help"]);
const MODES = ["list", "add", "remove", "update"] as const;
type Mode = (typeof MODES)[number];

const ROLES: Record<string, Extract<UserRole, "DELEGATE" | "SANT">> = { delegate: "DELEGATE", sant: "SANT" };
const TOPICS: Record<string, HotlineTopic> = { general: "GENERAL", stay: "STAY", transport: "TRANSPORT" };
const ROLE_LABEL: Record<UserRole, string> = { DELEGATE: "Delegate", SANT: "Sant", ADMIN: "Admin" };
const TOPIC_LABEL: Record<HotlineTopic, string> = { GENERAL: "General", STAY: "Stay", TRANSPORT: "Transport" };
const ROLE_ORDER: readonly UserRole[] = ["DELEGATE", "SANT", "ADMIN"];
const TOPIC_ORDER: readonly HotlineTopic[] = ["STAY", "TRANSPORT", "GENERAL"];

type Plan =
  | { mode: "list" }
  | {
      mode: "add";
      role: "DELEGATE" | "SANT";
      topic: HotlineTopic;
      audience: Audience;
      label: string;
      name: string | null;
      phone: string;
      availability: string | null;
      sortOrder: number;
      telegram: string | null;
    }
  | { mode: "remove"; id: string }
  | { mode: "update"; id: string; telegram: string | null };

/** A short free-text option: single spaces, not empty, at most `max` characters. */
function readText(key: string, value: string | undefined, max: number, required: true): string;
function readText(key: string, value: string | undefined, max: number, required: false): string | null;
function readText(key: string, value: string | undefined, max: number, required: boolean): string | null {
  if (value === undefined) {
    if (required) fail(`--${key} is required.`);
    return null;
  }
  const text = value.replace(/\s+/g, " ").trim();
  if (text === "") fail(`--${key} is empty.`);
  if (text.length > max) fail(`--${key} is longer than ${max} characters.`);
  return text;
}

/** --telegram: a username or phone in any form the organisers write; "none" (with --update) clears it. */
function readTelegram(value: string | undefined, allowNone: boolean): string | null {
  if (value === undefined) return null;
  if (allowNone && value.trim().toLowerCase() === "none") return null;
  return normalizeTelegram(value) ?? fail(`--telegram "${value}" is not a Telegram username (5-32 letters, digits or _) or a phone number.`);
}

/** Validates everything before the database is touched. */
function readPlan(values: Record<string, string>, flags: Set<string>): Plan {
  const modes = MODES.filter((m) => flags.has(m));
  if (modes.length !== 1) fail("Give exactly one of --list, --add, --remove or --update.");
  const mode: Mode = modes[0];
  const allowed: Record<Mode, readonly string[]> = {
    list: [],
    add: ["role", "topic", "track", "label", "name", "phone", "availability", "sort", "telegram"],
    remove: ["id"],
    update: ["id", "telegram"],
  };
  for (const key of Object.keys(values)) {
    if (key !== "env" && !allowed[mode].includes(key)) fail(`--${key} doesn't go with --${mode}.`);
  }
  if (mode === "list") {
    if (flags.has("dry-run")) fail("--dry-run is for --add, --remove and --update (--list never writes).");
    return { mode };
  }
  if (mode === "remove" || mode === "update") {
    const id = values.id?.trim();
    if (!id) fail("--id is required (the id --list prints).");
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) fail("--id is not an id --list prints.");
    if (mode === "remove") return { mode, id };
    if (values.telegram === undefined) fail("--update needs --telegram <username | none> (the only field it changes).");
    return { mode, id, telegram: readTelegram(values.telegram, true) };
  }

  if (values.role === undefined) fail("--role is required (delegate or sant).");
  const role = ROLES[values.role.trim().toLowerCase()] ?? fail(`--role "${values.role}" must be delegate or sant.`);
  let topic: HotlineTopic = "GENERAL";
  let audience: Audience = "ALL";
  if (role === "DELEGATE") {
    if (values.topic === undefined) fail("--topic is required for a delegate line (general, stay or transport).");
    topic = TOPICS[values.topic.trim().toLowerCase()] ?? fail(`--topic "${values.topic}" must be general, stay or transport.`);
    audience = readTrack(values.track);
  } else {
    // The Santo pages place a sant line by its topic (src/lib/sant.ts santContactsFor()); track means nothing there.
    if (values.track !== undefined) fail("--track is for delegate lines: leave it out with --role sant.");
    if (values.topic !== undefined) {
      topic = TOPICS[values.topic.trim().toLowerCase()] ?? fail(`--topic "${values.topic}" must be general, stay or transport.`);
    }
  }
  return {
    mode,
    role,
    topic,
    audience,
    label: readText("label", values.label, 40, true),
    name: readName(values.name, false),
    phone: readPhone(values.phone),
    availability: readText("availability", values.availability, 80, false),
    sortOrder: readSort(values.sort) ?? 0,
    telegram: readTelegram(values.telegram, false),
  };
}

/** The columns `hotlines` has always had. */
const BASE = { id: true, label: true, contactName: true, phone: true, availability: true, role: true, sortOrder: true } as const;

type Row = {
  id: string;
  label: string;
  contactName: string | null;
  phone: string;
  availability: string | null;
  role: UserRole;
  sortOrder: number;
  /** null: this database has no topic / track columns yet. */
  topic: HotlineTopic | null;
  audience: Audience | null;
  /** undefined: this database has no telegram column yet (2026-10-06). */
  telegram?: string | null;
};

const isColumnMissing = (e: unknown) => (e as { code?: string })?.code === "P2022";
const PUSH_FIRST =
  "This database has no topic / track columns on hotlines yet, and every new line (a sant one too) writes them: " +
  "run `npm run db:push` (or `npm run db:push:lightsail`) first. Nothing was written.";

/** Printed with a delegate line kept to one page or one track: only the code that reads the columns keeps it there. */
const DEPLOY_NOTE =
  "Note: only the hub code of 2026-10-01 or later keeps a line to its page and track. " +
  "While older code is deployed, every delegate line shows on both pages to both tracks: deploy first, then add.";

const TELEGRAM_PUSH_FIRST =
  "This database has no telegram column on hotlines yet: run `npm run db:push` (or `npm run db:push:lightsail`) first. " +
  "Nothing was written.";

/**
 * Every hotline; `pushed` false when the topic / track columns aren't in this database yet,
 * `telegramPushed` false when the telegram column (2026-10-06) isn't.
 */
async function readAll(prisma: PrismaClient): Promise<{ rows: Row[]; pushed: boolean; telegramPushed: boolean }> {
  try {
    const rows = await prisma.hotline.findMany({ select: { ...BASE, topic: true, audience: true, telegram: true } });
    return { rows, pushed: true, telegramPushed: true };
  } catch (e) {
    if (!isColumnMissing(e)) throw e;
  }
  try {
    const rows = await prisma.hotline.findMany({ select: { ...BASE, topic: true, audience: true } });
    return { rows, pushed: true, telegramPushed: false };
  } catch (e) {
    if (!isColumnMissing(e)) throw e;
    const rows = await prisma.hotline.findMany({ select: BASE });
    return { rows: rows.map((r) => ({ ...r, topic: null, audience: null })), pushed: false, telegramPushed: false };
  }
}

function describe(r: Omit<Row, "id">): string {
  const scope =
    r.role === "DELEGATE" && r.topic !== null && r.audience !== null
      ? `${ROLE_LABEL[r.role]} · ${TOPIC_LABEL[r.topic]} · ${TRACK_LABEL[r.audience]}`
      : r.role === "SANT" && r.topic !== null
        ? `${ROLE_LABEL[r.role]} · ${TOPIC_LABEL[r.topic]}`
        : ROLE_LABEL[r.role];
  // A Telegram value can be a phone number ("+1..."): masked like the phone.
  const telegram = r.telegram ? `Telegram ${r.telegram.startsWith("+") ? maskPhone(r.telegram) : r.telegram}` : null;
  const parts = [`"${r.label}"`, r.contactName, maskPhone(r.phone), r.availability, telegram].filter(Boolean);
  return `${scope}: ${parts.join(", ")}${r.sortOrder !== 0 ? ` (sort ${r.sortOrder})` : ""}`;
}

async function list(prisma: PrismaClient): Promise<string[]> {
  const { rows, pushed } = await readAll(prisma);
  const rank = <T,>(order: readonly T[], value: T | null) => (value === null ? 0 : order.indexOf(value));
  rows.sort(
    (a, b) =>
      rank(ROLE_ORDER, a.role) - rank(ROLE_ORDER, b.role) ||
      rank(TOPIC_ORDER, a.topic) - rank(TOPIC_ORDER, b.topic) ||
      rank(AUDIENCE_ORDER, a.audience) - rank(AUDIENCE_ORDER, b.audience) ||
      a.sortOrder - b.sortOrder ||
      a.label.localeCompare(b.label),
  );
  const out: string[] = [];
  if (rows.length === 0) out.push("No hotlines yet.");
  for (const r of rows) out.push(`${r.id}  ${describe(r)}`);
  if (!pushed) {
    out.push(
      "No topic / track columns in this database yet (run `npm run db:push`): every delegate line shows on both pages, to both tracks.",
    );
    return out;
  }
  // What a delegate sees (the rule of pickHelpContacts() in src/lib/helpContacts.ts): the page's
  // topic and GENERAL, for their track and ALL.
  const delegate = rows.filter((r) => r.role === "DELEGATE");
  for (const [page, topic] of [["/stay", "STAY"], ["/transportation", "TRANSPORT"]] as const) {
    const count = (track: Audience) =>
      delegate.filter((r) => (r.topic === topic || r.topic === "GENERAL") && (r.audience === track || r.audience === "ALL")).length;
    const [bhaio, behno] = [count("BHAIO"), count("BEHNO")];
    out.push(
      `Delegates on ${page}: Bhaio see ${bhaio}, Behno see ${behno}` +
        (bhaio === 0 || behno === 0 ? " (0 = no help block on that page)" : ""),
    );
  }
  return out;
}

async function add(prisma: PrismaClient, plan: Extract<Plan, { mode: "add" }>, dryRun: boolean): Promise<string[]> {
  const { rows, pushed, telegramPushed } = await readAll(prisma);
  if (!pushed) refuse(PUSH_FIRST);
  if (plan.telegram !== null && !telegramPushed) refuse(TELEGRAM_PUSH_FIRST);
  const row = {
    label: plan.label,
    contactName: plan.name,
    phone: plan.phone,
    availability: plan.availability,
    role: plan.role,
    topic: plan.topic,
    audience: plan.audience,
    sortOrder: plan.sortOrder,
    // Only named when given, so an unpushed database can still take a line without it.
    ...(plan.telegram !== null ? { telegram: plan.telegram } : {}),
  };
  // The lines someone would see beside the new one: a sant sees every sant line; a delegate the
  // lines of one page (its topic and GENERAL) for their track and ALL (pickHelpContacts()).
  const overlaps = <T,>(a: T | null, b: T, any: T) => a === null || a === b || a === any || b === any;
  const beside = rows.filter(
    (r) =>
      r.role === plan.role &&
      (plan.role !== "DELEGATE" ||
        (overlaps<HotlineTopic>(r.topic, plan.topic, "GENERAL") && overlaps<Audience>(r.audience, plan.audience, "ALL"))),
  );
  const sameNumber = beside.find((r) => r.phone === plan.phone);
  const name = plan.name;
  const sameName =
    name === null ? undefined : beside.find((r) => r.contactName !== null && nameKey(r.contactName) === nameKey(name));
  const same = sameNumber ?? sameName;
  if (same) {
    refuse(
      `${sameNumber ? "That number" : "That name"} is already on a line shown beside this one (${same.id}  ${describe(same)}): ` +
        `the same person would show twice. Nothing written. To change that line: --remove --id ${same.id}, then --add again.`,
    );
  }
  const note = plan.role === "DELEGATE" && (plan.topic !== "GENERAL" || plan.audience !== "ALL") ? [DEPLOY_NOTE] : [];
  if (dryRun) return [`Would add: ${describe(row)}`, ...note];
  const created = await prisma.hotline.create({ data: row, select: { id: true } });
  return [`Added: ${created.id}  ${describe(row)}`, ...note];
}

async function remove(prisma: PrismaClient, plan: Extract<Plan, { mode: "remove" }>, dryRun: boolean): Promise<string[]> {
  const { rows } = await readAll(prisma);
  const row = rows.find((r) => r.id === plan.id);
  if (!row) refuse(`No hotline with id "${plan.id}": nothing removed. --list prints the ids.`);
  if (dryRun) return [`Would remove: ${row.id}  ${describe(row)}`];
  // deleteMany: returns a count, so it never reads the columns an unpushed database lacks.
  await prisma.hotline.deleteMany({ where: { id: row.id } });
  return [`Removed: ${row.id}  ${describe(row)}`];
}

async function update(prisma: PrismaClient, plan: Extract<Plan, { mode: "update" }>, dryRun: boolean): Promise<string[]> {
  const { rows, telegramPushed } = await readAll(prisma);
  if (!telegramPushed) refuse(TELEGRAM_PUSH_FIRST);
  const row = rows.find((r) => r.id === plan.id);
  if (!row) refuse(`No hotline with id "${plan.id}": nothing changed. --list prints the ids.`);
  if ((row.telegram ?? null) === plan.telegram) return [`Unchanged: ${row.id}  ${describe(row)}`];
  const after = { ...row, telegram: plan.telegram };
  const note = row.role === "DELEGATE" ? ["Note: the delegates' pages don't show Telegram (Santo contacts only)."] : [];
  if (dryRun) return [`Would update: ${row.id}  ${describe(after)}`, ...note];
  await prisma.hotline.update({ where: { id: row.id }, data: { telegram: plan.telegram }, select: { id: true } });
  return [`Updated: ${row.id}  ${describe(after)}`, ...note];
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
        : plan.mode === "add"
          ? await add(prisma, plan, dryRun)
          : plan.mode === "update"
            ? await update(prisma, plan, dryRun)
            : await remove(prisma, plan, dryRun);
    // Read after the first query: Prisma loads .env itself when DATABASE_URL isn't set.
    console.log(`${dryRun ? "Dry run, nothing written: " : ""}hotlines in ${databaseLabel()}`);
    for (const line of lines) console.log(`  ${line}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) =>
  exitWith(e, USAGE, (code) =>
    code === "P2021"
      ? "The hotlines table isn't there yet: run `npm run db:push` (or `npm run db:push:lightsail`) first."
      : code === "P2022"
        ? PUSH_FIRST
        : null,
  ),
);
