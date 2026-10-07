/**
 * Publish, list or delete organiser notifications (the header bell).
 *
 *   npm run notify -- --env .env.lightsail --kind SCHEDULE \
 *     --title "Keynote 2 moved to 5:30 PM" --body "Seating starts at 5:15." --href /schedule
 *   npm run notify -- --env .env.lightsail --kind TRANSPORT --roles DELEGATE \
 *     --sevas "Hospitality,Kitchen & Prasad" --regions Atlanta --at 2026-10-09T12:30 \
 *     --title "Atlanta shuttle leaves at 1 PM"
 *   npm run notify -- --env .env.lightsail --kind TRANSPORT --hotels Hampton,Courtyard \
 *     --title "Shuttle to the mandir leaves at 7:30 AM"
 *   npm run notify -- --env .env.lightsail --to AB1234 --to CD5678 \
 *     --title "Please come to the registration room"
 *   npm run notify -- --env .env.lightsail --list
 *   npm run notify -- --env .env.lightsail --delete <id>
 *
 * --kind      MENU | SCHEDULE | TRANSPORT | GENERAL   (default GENERAL)
 * --audience  ALL | BHAIO | BEHNO                      (default ALL)
 * --roles     comma-separated DELEGATE, SANT, ADMIN    (default: every role; for --kind MENU
 *             the default is delegates + admins, since santos have their own menu: add SANT)
 * --sevas     comma-separated seva names, exactly as on the accounts (default: every seva)
 * --regions   comma-separated regions; accounts with no region are left out (default: every region)
 * --hotels    comma-separated hotels (hampton, courtyard, doubletree, hilton, or their names):
 *             only people with a room group there, either stay (default: any hotel or none).
 *             Not with --regions. Stored in the regions column as "hotel:<key>", which no
 *             account has: code from before 2026-10-05 shows it to no one.
 * --to        a BAPS ID (repeat the flag, or separate several with commas): a personal
 *             announcement, for exactly those accounts and nobody else. Not with --audience,
 *             --roles, --sevas, --hotels or --regions (none of them applies to it). Needs the
 *             notifications.user_ids column: run `npm run db:push` (or db:push:lightsail) first.
 *             The row is stored with "(specific people)" as its seva and region, which no
 *             account has: code that doesn't know the column then shows it to no one.
 * --at        "YYYY-MM-DDTHH:mm" Eastern: schedule it for later instead of now
 * --href      in-app path opened when the notification is tapped (optional)
 * --force     publish even when the targeting matches no account
 * --env       dotenv file whose DATABASE_URL to use     (default .env)
 *
 * Who a notification reaches is decided by src/lib/admin/announcements.ts (the
 * same rule as the bell and /admin/announcements). Menu releases are generated
 * automatically from meal times; you only need this for announcements.
 */
import { readFileSync } from "node:fs";

/** Flags that may be given more than once: every value is kept (comma-joined). */
const REPEATABLE = new Set(["to"]);

function parseArgs(argv: string[]) {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const name = a.slice(2);
    const next = argv[i + 1];
    let value = "true";
    if (next !== undefined && !next.startsWith("--")) {
      value = next;
      i++;
    }
    out[name] = REPEATABLE.has(name) && out[name] !== undefined ? `${out[name]},${value}` : value;
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

const KINDS = ["MENU", "SCHEDULE", "TRANSPORT", "GENERAL"] as const;
const AUDIENCES = ["ALL", "BHAIO", "BEHNO"] as const;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** Comma-separated flag value -> trimmed, non-empty, de-duplicated items ([] when the flag is absent). */
function listFlag(args: Record<string, string>, name: string): string[] {
  const raw = args[name];
  if (raw === undefined) return [];
  const items = [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
  if (raw === "true" || items.length === 0) fail(`--${name} needs a comma-separated list of values`);
  return items;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnvFile(args.env ?? ".env");
  const { PrismaClient } = await import("@prisma/client");
  // Imported after the env file so its EVENT_TZ (if any) applies (announcements reads it through hotels.ts).
  const { dayKey, formatDayShort, formatTime, parseInEventTz } = await import("../src/lib/time");
  const {
    HOTEL_REGION_PREFIX,
    PEOPLE_MAX,
    ROLES,
    describeAudience,
    fromStored,
    normaliseTargeting,
    peopleLabel,
    storedRegions,
    usersReachedBy,
  } = await import("../src/lib/admin/announcements");
  const { HOTEL_KEYS, hotelKeyFor } = await import("../src/lib/hotels");
  const prisma = new PrismaClient();
  const host = (process.env.DATABASE_URL ?? "").replace(/\/\/.*@/, "//***@").replace(/\?.*/, "");
  const when = (d: Date) => `${formatDayShort(dayKey(d))} · ${formatTime(d)}`;

  try {
    // notifications.user_ids (personal announcements) may not be pushed to this database yet:
    // then nothing below names the column (createNotification() inserts without it), and --to refuses.
    const { createNotification, hasPeopleColumn } = await import("../src/lib/notificationPeople");
    const { registrationIdsAtHotels } = await import("../src/lib/hotelGuests");
    const hasPeople = await hasPeopleColumn(prisma);

    if (args.list) {
      const select = {
        id: true,
        kind: true,
        title: true,
        audience: true,
        roles: true,
        sevas: true,
        regions: true,
        createdAt: true,
      } as const;
      const rows = hasPeople
        ? await prisma.notification.findMany({
            orderBy: { createdAt: "desc" },
            take: 50,
            select: { ...select, userIds: true },
          })
        : (await prisma.notification.findMany({ orderBy: { createdAt: "desc" }, take: 50, select })).map((r) => ({
            ...r,
            userIds: [] as string[],
          }));
      const now = Date.now();
      console.log(`${rows.length} notification(s) in ${host}`);
      for (const stored of rows) {
        const n = fromStored(stored);
        const targeted =
          n.userIds.length || n.roles.length || n.sevas.length || n.hotels.length || n.regions.length
            ? `  {${describeAudience(n)}}`
            : "";
        const scheduled = n.createdAt.getTime() > now ? `  (scheduled: ${when(n.createdAt)} Eastern)` : "";
        console.log(`${n.id}  ${n.createdAt.toISOString()}  [${n.kind}/${n.audience}]  ${n.title}${targeted}${scheduled}`);
      }
      return;
    }

    if (args.delete) {
      const { count } = await prisma.notification.deleteMany({ where: { id: args.delete } });
      if (count === 0) fail(`No notification ${args.delete} in ${host}`);
      console.log(`Deleted ${args.delete} from ${host}`);
      return;
    }

    if (!args.title) {
      console.error("Missing --title (or use --list / --delete <id>)");
      process.exit(1);
    }
    const kind = (args.kind ?? "GENERAL").toUpperCase();
    const audience = (args.audience ?? "ALL").toUpperCase();
    if (!KINDS.includes(kind as (typeof KINDS)[number])) {
      console.error(`--kind must be one of ${KINDS.join(", ")}`);
      process.exit(1);
    }
    if (!AUDIENCES.includes(audience as (typeof AUDIENCES)[number])) {
      console.error(`--audience must be one of ${AUDIENCES.join(", ")}`);
      process.exit(1);
    }
    if (args.href && !args.href.startsWith("/")) {
      console.error("--href must be an in-app path starting with /");
      process.exit(1);
    }

    const roles = listFlag(args, "roles").map((r) => r.toUpperCase());
    const badRole = roles.find((r) => !(ROLES as readonly string[]).includes(r));
    if (badRole) fail(`--roles: "${badRole}" is not one of ${ROLES.join(", ")}`);
    const sevas = listFlag(args, "sevas");
    const regions = listFlag(args, "regions");
    const badRegion = regions.find((r) => r.startsWith(HOTEL_REGION_PREFIX));
    if (badRegion) fail(`--regions: "${badRegion}" isn't a region (use --hotels for a hotel)`);
    const hotels = listFlag(args, "hotels").map((h) => {
      const key = hotelKeyFor(h);
      if (!key) fail(`--hotels: "${h}" is not one of ${HOTEL_KEYS.join(", ")}`);
      return key;
    });
    if (hotels.length > 0 && regions.length > 0) {
      fail("--hotels and --regions don't combine: a hotel announcement goes to everyone with a room there");
    }

    // --to: a personal announcement, for exactly these accounts.
    const to = listFlag(args, "to").map((id) => id.toUpperCase());
    let userIds: string[] = [];
    if (to.length > 0) {
      const mixed = ["audience", "roles", "sevas", "hotels", "regions"].filter((f) => args[f] !== undefined);
      if (mixed.length) {
        fail(`--to sends to exactly those accounts, so --${mixed.join(", --")} can't be used with it`);
      }
      if (to.length > PEOPLE_MAX) fail(`--to: at most ${PEOPLE_MAX} accounts for one announcement`);
      if (!hasPeople) {
        fail(
          `--to needs the notifications.user_ids column, which ${host} doesn't have yet: run \`npm run db:push\` (Lightsail: \`npm run db:push:lightsail\`) first`,
        );
      }
      const found = await prisma.user.findMany({
        where: { bapsId: { in: to, mode: "insensitive" } },
        select: { id: true, bapsId: true },
      });
      const unknown = to.filter((id) => !found.some((u) => u.bapsId.toUpperCase() === id));
      if (unknown.length) fail(`--to: no account has the BAPS ID ${unknown.join(", ")} in ${host}; nothing published`);
      userIds = found.map((u) => u.id);
    }

    let publishAt: Date | undefined;
    if (args.at !== undefined) {
      const at = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(args.at) ? parseInEventTz(args.at) : null;
      if (!at || Number.isNaN(at.getTime())) fail('--at must be "YYYY-MM-DDTHH:mm" (Eastern), e.g. 2026-10-09T12:30');
      if (at.getTime() <= Date.now()) fail(`--at ${args.at} (Eastern) is not in the future`);
      publishAt = at;
    }

    const targeting = normaliseTargeting({
      kind: kind as (typeof KINDS)[number],
      audience: audience as (typeof AUDIENCES)[number],
      roles: roles as (typeof ROLES)[number][],
      sevas,
      regions,
      hotels,
      userIds,
    });
    const personal = targeting.userIds.length > 0;
    // --to was given but no account came of it: never fall back to publishing by the other flags.
    if (to.length > 0 && !personal) fail("--to: none of those accounts could be used; nothing published");

    // Catch typos: values no account has (not for --to: its seva and region are only the personal mark).
    const warnUnknown = (flag: string, values: readonly string[], found: (string | null)[]) => {
      const unknown = values.filter((v) => !found.includes(v));
      if (unknown.length) console.warn(`warning: no account has ${unknown.map((v) => `"${v}"`).join(", ")} (--${flag})`);
    };
    if (!personal && targeting.sevas.length) {
      const found = await prisma.user.findMany({
        where: { seva: { in: [...targeting.sevas] } },
        distinct: ["seva"],
        select: { seva: true },
      });
      warnUnknown("sevas", targeting.sevas, found.map((u) => u.seva));
    }
    if (!personal && targeting.regions.length) {
      const found = await prisma.user.findMany({
        where: { region: { in: [...targeting.regions] } },
        distinct: ["region"],
        select: { region: true },
      });
      warnUnknown("regions", targeting.regions, found.map((u) => u.region));
    }

    const atHotels = targeting.hotels.length > 0 ? await registrationIdsAtHotels(targeting.hotels, prisma) : undefined;
    const reach = await prisma.user.count({ where: usersReachedBy(targeting, { atHotels }) });
    const narrowed =
      personal ||
      targeting.roles.length > 0 ||
      targeting.sevas.length > 0 ||
      targeting.hotels.length > 0 ||
      targeting.regions.length > 0;
    if (reach === 0 && narrowed && !args.force) {
      const why =
        targeting.kind === "MENU" && targeting.roles.length === 0
          ? " (a Menu notice without --roles reaches delegates and admins only; add --roles SANT for the Santo menu)"
          : "";
      fail(
        `"${describeAudience(targeting)}" reaches no account in ${host}${why}; nothing published (use --force to publish anyway)`,
      );
    }

    const created = await createNotification(prisma, {
      kind: targeting.kind,
      audience: targeting.audience,
      roles: targeting.roles,
      sevas: targeting.sevas,
      // The hotels, when given, as "hotel:" values (storedRegions()).
      regions: storedRegions(targeting),
      userIds: targeting.userIds,
      title: args.title,
      body: args.body ?? null,
      href: args.href ?? null,
      createdById: null,
      createdAt: publishAt,
    });
    console.log(`Published ${created.id} [${targeting.kind}/${targeting.audience}] "${args.title}" to ${host}`);
    console.log(
      personal
        ? `  audience: only ${to.join(", ")} (${peopleLabel(reach)})`
        : `  audience: ${describeAudience(targeting)} (reaches ${peopleLabel(reach)} now)`,
    );
    if (publishAt) console.log(`  scheduled: appears in bells at ${when(publishAt)} Eastern`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
