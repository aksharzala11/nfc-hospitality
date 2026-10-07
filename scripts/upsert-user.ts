/**
 * Insert or update one row in the `users` table.
 *
 *   npm run user:upsert -- --env .env.lightsail --bapsId UN2998001 --name "Upsham Naik" \
 *     --seva Admin --email upshamgnaik@outlook.com --phone 8484829439 [--channel EMAIL|SMS] \
 *     [--displayName "Upshambhai"] [--gender MALE|FEMALE] [--region Atlanta] [--breakouts id1,id2]
 *     [--testCode 102026]   (tester accounts only: fixed code, no email/SMS sent)
 *     [--role DELEGATE|SANT|ADMIN]   (SANT = Pujya Sant, routed to /sant; ADMIN = organiser
 *                               with the /admin console. New rows default to DELEGATE;
 *                               when omitted, an existing row keeps its role.)
 *   Tester codes are ignored for ADMIN accounts: admins always get a real code.
 *
 * --env points at a dotenv file whose DATABASE_URL to use (defaults to .env).
 */
import { readFileSync } from "node:fs";
import { toE164 } from "../src/lib/users";

function parseArgs(argv: string[]) {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else out[key] = "true";
    }
  }
  return out;
}

function loadEnvFile(path: string) {
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[m[1]] = value;
  }
}

/** The --testCode value, redacted from anything printed on failure (Prisma errors quote arguments). */
let secret: string | null = null;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  secret = args.testCode ?? null;
  loadEnvFile(args.env ?? ".env");

  const required = ["bapsId", "name", "seva"] as const;
  for (const k of required) {
    if (!args[k]) {
      console.error(`Missing --${k}`);
      process.exit(1);
    }
  }
  if (!args.email && !args.phone && !args.testCode) {
    console.error("Provide at least one of --email or --phone (or --testCode for a tester account)");
    process.exit(1);
  }
  if (args.testCode && !/^\d{6}$/.test(args.testCode)) {
    console.error("--testCode must be exactly 6 digits");
    process.exit(1);
  }

  const phone = args.phone ? toE164(args.phone) : null;
  if (args.phone && !phone) {
    console.error(`Could not normalise phone "${args.phone}" to E.164`);
    process.exit(1);
  }

  const channel = (args.channel ?? (args.email ? "EMAIL" : "SMS")).toUpperCase();
  if (channel !== "EMAIL" && channel !== "SMS") {
    console.error("--channel must be EMAIL or SMS");
    process.exit(1);
  }
  const gender = args.gender ? args.gender.toUpperCase() : undefined;
  if (gender && gender !== "MALE" && gender !== "FEMALE") {
    console.error("--gender must be MALE or FEMALE");
    process.exit(1);
  }
  const role = args.role ? args.role.toUpperCase() : undefined;
  if (role !== undefined && role !== "DELEGATE" && role !== "SANT" && role !== "ADMIN") {
    console.error("--role must be DELEGATE, SANT or ADMIN");
    process.exit(1);
  }

  // Import after the env file is loaded so DATABASE_URL is picked up.
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const data = {
      name: args.name,
      displayName: args.displayName ?? null,
      seva: args.seva,
      email: args.email ?? null,
      phone,
      preferredChannel: channel as "EMAIL" | "SMS",
      gender: (gender as "MALE" | "FEMALE" | undefined) ?? null,
      region: args.region ?? null,
      breakoutSessions: args.breakouts ? args.breakouts.split(",").map((s) => s.trim()).filter(Boolean) : [],
      testCode: args.testCode ?? null,
      // A new or re-set tester code starts with a clean lockout (verifyOtp()).
      ...(args.testCode ? { testCodeFailures: 0, testCodeLockouts: 0, testCodeLockedUntil: null } : {}),
      // Only touch the role when --role is given, so re-running without it never demotes a sant.
      ...(role ? { role: role as "DELEGATE" | "SANT" | "ADMIN" } : {}),
    };
    const user = await prisma.user.upsert({
      where: { bapsId: args.bapsId.toUpperCase() },
      create: { bapsId: args.bapsId.toUpperCase(), ...data },
      update: data,
    });
    const host = (process.env.DATABASE_URL ?? "").replace(/\/\/.*@/, "//***@");
    console.log(`Upserted ${user.bapsId} (${user.name}, ${user.seva}) in ${host}`);
    console.log({ id: user.id, role: user.role, email: user.email, phone: user.phone, channel: user.preferredChannel, breakoutSessions: user.breakoutSessions, testCode: user.testCode ? "(set)" : null });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  const text = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  console.error(secret ? text.split(secret).join("******") : text);
  process.exit(1);
});
