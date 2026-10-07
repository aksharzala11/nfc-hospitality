/**
 * The email bounce tracker (/admin/bounces) from the terminal: list what is
 * open, and bring in the bounces that happened before the SNS endpoint
 * (/api/ses/events) was subscribed, from the SES account suppression list.
 *
 *   npm run ses:bounces -- --list
 *     Counts (addresses open, of them hard bounces, resolved; events), then
 *     per open address the BAPS ID(s) of the account(s) whose email it is now,
 *     what SES said, how often and when. An address no account has is shown
 *     masked. Never names, phones or anything from the emails.
 *
 *   npm run ses:bounces -- --backfill [--dry-run] [--profile <aws profile>]
 *     Reads the SES account suppression list (sesv2 ListSuppressedDestinations,
 *     then GetSuppressedDestination for the reason, time and message id) and
 *     stores the entries whose address is a Hub account's email as events
 *     with source "suppression-list" (a hard bounce, or a complaint). The AWS
 *     account is shared with other businesses: every other address is skipped
 *     unseen (never printed or stored; only their number is counted). Keyed like
 *     the SNS event that put the address there, so running it again, or after
 *     the endpoint stored that event, adds nothing twice; an address an admin
 *     resolved stays resolved. --dry-run prints what would be added.
 *     AWS credentials: the default chain (your AWS CLI profile / SSO session),
 *     or --profile <name>. They need ses:ListSuppressedDestinations and
 *     ses:GetSuppressedDestination; the app's send-only keys can't, so when a
 *     dotenv file sets AWS_ACCESS_KEY_ID, pass --profile (it wins over them).
 *     Region: AWS_REGION, else us-east-1.
 *
 *   --env <file>   take DATABASE_URL from another dotenv file (the :lightsail
 *                  script sets it through dotenv-cli instead).
 *   npm run ses:bounces:lightsail -- ...   the shared Lightsail database.
 *
 * Any unknown or misspelt option stops the script before anything is read.
 * The table needs `npm run db:push` (or `db:push:lightsail`) first.
 */
import type { PrismaClient } from "@prisma/client";
import { exitWith, fail, parseArgs, databaseLabel, loadEnvFile, refuse } from "./contact-cli";
import { wantsDryRun } from "./npm-flags";
import { rowFromSuppressedDestination, type EmailEventRow } from "../src/lib/emailEvents/ses";
import { eventLabel, groupEmailEvents, subTypeLabel, type StoredEmailEvent } from "../src/lib/emailEvents/view";
import { dayKey, formatDayShort, formatTime } from "../src/lib/time";

const USAGE = `Usage (see scripts/ses-bounces.ts for details):
  npm run ses:bounces[:lightsail] -- --list
  npm run ses:bounces[:lightsail] -- --backfill [--dry-run] [--profile <aws profile>]
  Add --env <file> to take DATABASE_URL from another dotenv file.`;

const VALUE_OPTIONS = new Set(["env", "profile"]);
const FLAG_OPTIONS = new Set(["list", "backfill", "dry-run", "help"]);

type Plan = { mode: "list" } | { mode: "backfill"; dryRun: boolean; profile: string | null };

function readPlan(values: Record<string, string>, flags: Set<string>): Plan {
  const modes = (["list", "backfill"] as const).filter((m) => flags.has(m));
  if (modes.length !== 1) fail("Give exactly one of --list or --backfill.");
  if (modes[0] === "list") {
    if (flags.has("dry-run")) fail("--dry-run is for --backfill (--list never writes).");
    if (values.profile !== undefined) fail("--profile is for --backfill (--list doesn't call AWS).");
    return { mode: "list" };
  }
  const profile = values.profile?.trim() ?? null;
  if (profile !== null && !/^[A-Za-z0-9_.+=@-]{1,64}$/.test(profile)) fail("--profile is not an AWS profile name.");
  return { mode: "backfill", dryRun: wantsDryRun(flags.has("dry-run") ? { "dry-run": "true" } : {}), profile };
}

/** "Thu, Oct 1 · 9:14 AM" (Eastern). */
const stamp = (d: Date) => `${formatDayShort(dayKey(d))} · ${formatTime(d)}`;

/** "ab•••@example.com": an address no account has is listed without its whole local part. */
function maskAddress(address: string): string {
  const [user, domain] = address.split("@");
  if (!domain) return "•••";
  return `${user.slice(0, Math.min(2, user.length))}•••@${domain}`;
}

/** BAPS IDs per Hub account email (lower-cased, trimmed). Exact lower() match, never ILIKE. */
async function bapsIdsByEmail(prisma: PrismaClient, addresses?: readonly string[]): Promise<Map<string, string[]>> {
  const rows = addresses
    ? await prisma.$queryRaw<{ email: string; bapsId: string }[]>`
        SELECT lower(btrim(email)) AS email, baps_id AS "bapsId" FROM users
        WHERE email IS NOT NULL AND lower(btrim(email)) = ANY(${[...addresses]}::text[]) ORDER BY baps_id`
    : await prisma.$queryRaw<{ email: string; bapsId: string }[]>`
        SELECT lower(btrim(email)) AS email, baps_id AS "bapsId" FROM users
        WHERE email IS NOT NULL AND btrim(email) <> '' ORDER BY baps_id`;
  const out = new Map<string, string[]>();
  for (const r of rows) {
    const list = out.get(r.email);
    if (list) list.push(r.bapsId);
    else out.set(r.email, [r.bapsId]);
  }
  return out;
}

async function list(prisma: PrismaClient): Promise<string[]> {
  const rows = await prisma.emailEvent.findMany({
    select: {
      id: true,
      kind: true,
      recipient: true,
      bounceType: true,
      bounceSubType: true,
      diagnostic: true,
      complaintType: true,
      occurredAt: true,
      source: true,
      resolvedAt: true,
      note: true,
    },
  });
  const events: StoredEmailEvent[] = rows.map((r) => ({ ...r, resolvedByName: null }));
  const groups = groupEmailEvents(events);
  const open = groups.filter((g) => g.open);
  const people = await bapsIdsByEmail(prisma, open.map((g) => g.recipient));
  const out = [
    `${groups.length} address${groups.length === 1 ? "" : "es"} on the tracker (${events.length} event${events.length === 1 ? "" : "s"}): ` +
      `${open.length} open (${open.filter((g) => g.hard).length} hard bounce${open.filter((g) => g.hard).length === 1 ? "" : "s"}), ` +
      `${groups.length - open.length} resolved.`,
  ];
  for (const g of open) {
    const ids = people.get(g.recipient);
    const who = ids ? ids.join(", ") : `(no account) ${maskAddress(g.recipient)}`;
    const what = [eventLabel(g.worst), subTypeLabel(g.worst)].filter(Boolean).join(": ");
    const when = g.events.length === 1 ? stamp(g.last) : `${g.events.length} times, last ${stamp(g.last)}`;
    const from = g.events.every((e) => e.source === "suppression-list") ? " (from the suppression list)" : "";
    out.push(`  ${who}  ${what}  ${when}${from}`);
  }
  return out;
}

async function backfill(prisma: PrismaClient, plan: Extract<Plan, { mode: "backfill" }>): Promise<string[]> {
  const region = process.env.AWS_REGION?.trim() || "us-east-1";
  const { SESv2Client, ListSuppressedDestinationsCommand, GetSuppressedDestinationCommand } = await import(
    "@aws-sdk/client-sesv2"
  );
  const ses = new SESv2Client({ region, ...(plan.profile ? { profile: plan.profile } : {}) });

  // Hub accounts first: nothing is asked of AWS when the database isn't reachable.
  const hub = await bapsIdsByEmail(prisma);

  let total = 0;
  const ours: string[] = [];
  let token: string | undefined;
  do {
    const page = await ses.send(new ListSuppressedDestinationsCommand({ PageSize: 1000, NextToken: token }));
    for (const s of page.SuppressedDestinationSummaries ?? []) {
      total++;
      const address = s.EmailAddress?.trim().toLowerCase();
      if (address && hub.has(address) && !ours.includes(address)) ours.push(address);
    }
    token = page.NextToken;
  } while (token);

  const rows: EmailEventRow[] = [];
  let unreadable = 0;
  for (const address of ours) {
    const { SuppressedDestination: d } = await ses.send(new GetSuppressedDestinationCommand({ EmailAddress: address }));
    const row =
      d &&
      rowFromSuppressedDestination({
        emailAddress: d.EmailAddress ?? address,
        reason: d.Reason,
        lastUpdateTime: d.LastUpdateTime,
        messageId: d.Attributes?.MessageId,
        feedbackId: d.Attributes?.FeedbackId,
      });
    if (row) rows.push(row);
    else unreadable++;
  }

  const existing = new Set(
    rows.length > 0
      ? (await prisma.emailEvent.findMany({ where: { id: { in: rows.map((r) => r.id) } }, select: { id: true } })).map(
          (r) => r.id,
        )
      : [],
  );
  const fresh = rows.filter((r) => !existing.has(r.id));

  const out = [
    `SES account suppression list (${region}): ${total} address${total === 1 ? "" : "es"}, ` +
      `${ours.length} of them a Hub account's email (the rest skipped, unseen).`,
  ];
  for (const r of rows) {
    const what = r.kind === "BOUNCE" ? "hard bounce" : "complaint";
    const state = existing.has(r.id) ? "already on the tracker" : plan.dryRun ? "would be added" : "added";
    out.push(`  ${(hub.get(r.recipient) ?? []).join(", ")}  ${what}, suppressed ${stamp(r.occurredAt)}  ${state}`);
  }
  if (unreadable > 0) out.push(`  ${unreadable} entr${unreadable === 1 ? "y" : "ies"} SES returned without a usable reason or time: skipped.`);

  if (plan.dryRun) {
    out.push(`Would add ${fresh.length} event${fresh.length === 1 ? "" : "s"}.`);
    return out;
  }
  const { count } = fresh.length > 0 ? await prisma.emailEvent.createMany({ data: fresh, skipDuplicates: true }) : { count: 0 };
  out.push(`Added ${count} event${count === 1 ? "" : "s"}.`);
  return out;
}

/** An AWS error's name, for the hints (never its message: it may quote an address). */
const awsName = (e: unknown) => (e as { name?: unknown })?.name;

async function main() {
  const { values, flags } = parseArgs(process.argv.slice(2), VALUE_OPTIONS, FLAG_OPTIONS);
  if (flags.has("help")) {
    console.log(USAGE);
    return;
  }
  const plan = readPlan(values, flags);
  // Only with --env: the :lightsail script sets DATABASE_URL through dotenv-cli,
  // which loading .env here would override.
  if (values.env) loadEnvFile(values.env);

  // Import after the env file is loaded so DATABASE_URL is picked up.
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    let lines: string[];
    try {
      lines = plan.mode === "list" ? await list(prisma) : await backfill(prisma, plan);
    } catch (e) {
      const name = awsName(e);
      if (name === "AccessDeniedException" || name === "AccessDenied") {
        refuse(
          "AWS refused the suppression list read (needs ses:ListSuppressedDestinations and ses:GetSuppressedDestination). " +
            "If a dotenv file set the app's send-only AWS keys, run again with --profile <your AWS CLI profile>. Nothing written.",
        );
      }
      if (name === "CredentialsProviderError" || name === "ExpiredTokenException" || name === "UnrecognizedClientException") {
        refuse(
          "No usable AWS credentials: sign in with the AWS CLI (aws configure / aws sso login) or pass --profile <name>. Nothing written.",
        );
      }
      throw e;
    }
    // Read after the first query: Prisma loads .env itself when DATABASE_URL isn't set.
    const dry = plan.mode === "backfill" && plan.dryRun;
    console.log(`${dry ? "Dry run, nothing written: " : ""}email bounces in ${databaseLabel()}`);
    for (const line of lines) console.log(`  ${line}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) =>
  exitWith(e, USAGE, (code) =>
    code === "P2021"
      ? "The email_events table isn't there yet: run `npm run db:push` (or `npm run db:push:lightsail`) first."
      : null,
  ),
);
