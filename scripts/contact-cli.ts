/**
 * What scripts/hotel-liaisons.ts and scripts/hotlines.ts share: strict option
 * parsing (anything unknown or misspelt stops the script before the database
 * is touched), the --track / --phone / --name / --sort readers, phone masking
 * for the output, and the --env loader. No database access here.
 */
import { readFileSync } from "node:fs";
import type { Audience } from "@prisma/client";
import { toE164 } from "../src/lib/users";

/** Bad input: printed without a stack trace, followed by the usage text. */
export class UsageError extends Error {}
export function fail(message: string): never {
  throw new UsageError(message);
}

/** A request the data refuses (a duplicate, nothing to remove by that id): printed alone, exit 1. */
export class RefusedError extends Error {}
export function refuse(message: string): never {
  throw new RefusedError(message);
}

/**
 * `--key value` and `--flag` arguments. An option not in either set, a value
 * option given twice or without a value, and a bare word are usage errors.
 */
export function parseArgs(argv: string[], valueOptions: ReadonlySet<string>, flagOptions: ReadonlySet<string>) {
  const values: Record<string, string> = {};
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) fail(`Unexpected argument "${arg}".`);
    const key = arg.slice(2);
    if (flagOptions.has(key)) flags.add(key);
    else if (!valueOptions.has(key)) fail(`Unknown option --${key}.`);
    else if (values[key] !== undefined) fail(`--${key} given twice.`);
    else if (argv[i + 1] === undefined || argv[i + 1].startsWith("--")) fail(`--${key} needs a value.`);
    else values[key] = argv[++i];
  }
  return { values, flags };
}

/** KEY=value lines of a dotenv file into process.env (for --env <file>). */
export function loadEnvFile(path: string) {
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

/** --track values (and the organisers' spellings) -> an `audience`. */
const TRACKS: Record<string, Audience> = {
  bhaio: "BHAIO",
  bhaiyo: "BHAIO",
  behno: "BEHNO",
  baheno: "BEHNO",
  all: "ALL",
};
export const TRACK_LABEL: Record<Audience, string> = { ALL: "Everyone", BHAIO: "Bhaio", BEHNO: "Behno" };
export const AUDIENCE_ORDER: readonly Audience[] = ["ALL", "BHAIO", "BEHNO"];

export function readTrack(value: string | undefined): Audience {
  if (value === undefined) fail("--track is required (bhaio, behno or all).");
  return TRACKS[value.trim().toLowerCase()] ?? fail(`--track "${value}" must be bhaio, behno or all.`);
}

/**
 * --phone as E.164: toE164() (src/lib/users.ts: "(732) 555-0142", "732-555-0142",
 * "+1 732 555 0142" all become "+17325550142"), then stricter than it, since a
 * mistyped contact would only show up as a wrong tel: link (and the output masks
 * all but the last 4 digits): no letters (an extension), at most 15 digits, and a
 * +1 number must be a North American one (area code and exchange each 3 digits,
 * neither starting with 0 or 1).
 */
export function readPhone(value: string | undefined): string {
  if (value === undefined) fail('--phone is required, e.g. --phone "+17325550142".');
  if (/\p{L}/u.test(value)) fail("--phone has letters in it (an extension?): give the number only.");
  const phone = toE164(value) ?? fail("--phone is not a phone number I can read (US/Canada or +E.164).");
  const digits = phone.slice(1);
  if (digits.length > 15) fail("--phone has more than 15 digits (E.164 allows 15).");
  if (digits.startsWith("1") && !/^1[2-9]\d\d[2-9]\d{6}$/.test(digits)) {
    fail("--phone is not a US/Canada number: +1, a 3-digit area code, then 7 digits (area code and exchange don't start with 0 or 1).");
  }
  return phone;
}

/** A person's name: single spaces, letters in it, at most 80 characters. */
export function readName(value: string | undefined, required: true): string;
export function readName(value: string | undefined, required: false): string | null;
export function readName(value: string | undefined, required: boolean): string | null {
  if (value === undefined) {
    if (required) fail('--name is required, e.g. --name "First Last".');
    return null;
  }
  const name = value.replace(/\s+/g, " ").trim();
  if (!/\p{L}/u.test(name)) fail("--name needs a name (letters).");
  if (name.length > 80) fail("--name is longer than 80 characters.");
  return name;
}

/** Names compare without case or extra spaces. */
export const nameKey = (name: string) => name.replace(/\s+/g, " ").trim().toLowerCase();

/** --sort as a whole number, or null when left out. */
export function readSort(value: string | undefined): number | null {
  if (value === undefined) return null;
  if (!/^-?\d{1,4}$/.test(value.trim())) fail("--sort must be a whole number.");
  return Number(value.trim());
}

/** "+17325550142" -> "***-***-0142": organiser contacts are listed without their whole number. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 4 ? `***-***-${digits.slice(-4)}` : "****";
}

/** The database the script ran against, without its credentials. */
export function databaseLabel(): string {
  return (process.env.DATABASE_URL ?? "the .env database").replace(/\/\/.*@/, "//***@");
}

/** The catch of main(): usage errors with the usage text, refusals alone, anything else by message. */
export function exitWith(e: unknown, usage: string, hint: (code: string | undefined) => string | null): never {
  if (e instanceof UsageError) {
    console.error(e.message);
    console.error(usage);
    process.exit(2);
  }
  console.error(e instanceof Error ? e.message : e);
  if (!(e instanceof RefusedError)) {
    const more = hint((e as { code?: string })?.code);
    if (more) console.error(more);
  }
  process.exit(1);
}
