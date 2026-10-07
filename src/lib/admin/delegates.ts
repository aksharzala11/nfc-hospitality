/**
 * The admin delegate directory (/admin/delegates): the query that loads
 * everyone for the page, the add/edit validation (zod) and the create/update
 * logic behind the server actions in src/app/admin/delegates/actions.ts.
 *
 * Server only (Prisma). Client components may `import type` from here but
 * never import values. What leaves this module is plain data (ISO strings):
 * test codes are reduced to `hasTestCode`, breakout links to a count, and an
 * update never touches `testCode`, `breakoutSessions`, `mirrorRegistrationId`
 * or the BAPS ID.
 *
 * Master-list fields: the registration ID (the organisers' "User Id", unique)
 * and center can be set from the form; personal wing, seva wing and role,
 * registration status and goshthi group (with its room and moderator flag) are
 * shown read-only (the master-list import owns them). All are null (moderator
 * false) for accounts not from the master list.
 *
 * createPersonRecord() / updatePersonRecord() take the Prisma client (or a
 * transaction client) as a parameter so they can be exercised inside a
 * rolled-back transaction; the server actions pass `prisma` after checking
 * getAdmin().
 */
import { z } from "zod";
import type { Gender, OtpChannel, Prisma, UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { goshthiGroupLabel } from "@/lib/schedule";
import { toE164 } from "@/lib/users";

// ---------------------------------------------------------------------------
// Directory rows
// ---------------------------------------------------------------------------

/** One person as the directory shows them. Plain and serialisable. */
export type DirectoryPerson = {
  id: string;
  bapsId: string;
  name: string;
  /** Greeting name ("Jay Swaminarayan {displayName}"); null = the full name is used. */
  displayName: string | null;
  seva: string;
  email: string | null;
  /** E.164, e.g. +18484829439. */
  phone: string | null;
  /** Picks the schedule track: MALE = Bhaio, FEMALE = Behno, null = both tracks. */
  gender: Gender | null;
  region: string | null;
  /** The organisers' registration "User Id" (unique): links them to the master list and other data. */
  registrationId: string | null;
  /** Master list "Center". */
  center: string | null;
  /** Master list "Personal Wing" (informational). */
  personalWing: string | null;
  /** Master list "Seva Wing" as given (Bal ... IBKY); decided their track on import. */
  sevaWing: string | null;
  /** Master list "Seva" as given, e.g. "NA RC Lead"; `seva` holds the team it maps to. */
  sevaRole: string | null;
  /** Master list "Registration Status", e.g. "Registered". */
  registrationStatus: string | null;
  /**
   * Goshthi group as imported: Bhaio "Group 4" (shown with the seva wing), Behno "Goshthi Group 12"
   * (numbered across Behno). Each group meets in its own room during the Goshthi sessions.
   */
  goshthiGroup: string | null;
  /**
   * The goshthi group as the delegate's breakouts page names it (goshthiGroupLabel()), e.g.
   * "Kishore Group 4" or "Goshthi Group 12".
   */
  goshthiLabel: string | null;
  /** Room their goshthi group meets in, as the organisers name it (import-only); null = none given. */
  goshthiRoom: string | null;
  /** They moderate their goshthi group (import-only). */
  goshthiModerator: boolean;
  role: UserRole;
  /** Where sign-in codes are sent. */
  preferredChannel: OtpChannel;
  /** Linked breakout sessions (0 = not linked; the hub then matches by seva). */
  breakoutCount: number;
  /** A tester code is set. The code itself never leaves the server. */
  hasTestCode: boolean;
  /**
   * Mirror test accounts: the registration ID of the delegate whose data the hub shows them,
   * or for a sant tester the BAPS ID of the sant whose data the Santo view shows him
   * (users.mirror_registration_id; honoured only for tester DELEGATE and SANT accounts, see
   * requireGuest()). Null for everyone else. Set by `npm run testers:personas` (delegates) or
   * `npm run sant:demo -- --mirror` (SANTO0001), not the form.
   */
  mirrorRegistrationId: string | null;
  /** ISO; null = never signed in. */
  lastSignInAt: string | null;
  /** ISO. */
  createdAt: string;
};

const DIRECTORY_SELECT = {
  id: true,
  bapsId: true,
  name: true,
  displayName: true,
  seva: true,
  email: true,
  phone: true,
  gender: true,
  region: true,
  registrationId: true,
  center: true,
  personalWing: true,
  sevaWing: true,
  sevaRole: true,
  registrationStatus: true,
  goshthiGroup: true,
  goshthiRoom: true,
  goshthiModerator: true,
  role: true,
  preferredChannel: true,
  breakoutSessions: true,
  // Read only to compute hasTestCode below; never copied into a DirectoryPerson.
  testCode: true,
  mirrorRegistrationId: true,
  lastSignInAt: true,
  createdAt: true,
} as const satisfies Prisma.UserSelect;

type DirectoryRecord = Prisma.UserGetPayload<{ select: typeof DIRECTORY_SELECT }>;

/** Explicit field-by-field copy, so nothing else (least of all testCode) can slip through. */
function toDirectoryPerson(row: DirectoryRecord): DirectoryPerson {
  return {
    id: row.id,
    bapsId: row.bapsId,
    name: row.name,
    displayName: row.displayName,
    seva: row.seva,
    email: row.email,
    phone: row.phone,
    gender: row.gender,
    region: row.region,
    registrationId: row.registrationId,
    center: row.center,
    personalWing: row.personalWing,
    sevaWing: row.sevaWing,
    sevaRole: row.sevaRole,
    registrationStatus: row.registrationStatus,
    goshthiGroup: row.goshthiGroup,
    goshthiLabel: goshthiGroupLabel(row.goshthiGroup, row.sevaWing),
    goshthiRoom: row.goshthiRoom?.trim() || null,
    goshthiModerator: row.goshthiModerator,
    role: row.role,
    preferredChannel: row.preferredChannel,
    breakoutCount: row.breakoutSessions.length,
    hasTestCode: row.testCode !== null,
    mirrorRegistrationId: row.mirrorRegistrationId?.trim() || null,
    lastSignInAt: row.lastSignInAt ? row.lastSignInAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Everyone who can sign in (delegates, santos and admins), by name. */
export async function getDirectoryPeople(): Promise<DirectoryPerson[]> {
  const rows = await prisma.user.findMany({
    select: DIRECTORY_SELECT,
    orderBy: [{ name: "asc" }, { bapsId: "asc" }],
  });
  return rows.map(toDirectoryPerson);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * BAPS IDs as stored: 3-32 capital letters and digits, e.g. BK1001. Inner dots
 * are allowed because the master list has a few name-style IDs
 * ("FIRST.LAST"), which the import keeps as given and sign-in accepts.
 */
export const BAPS_ID_PATTERN = /^[A-Z0-9](?:[A-Z0-9.]{1,30})[A-Z0-9]$/;

/** Registration IDs (the master list's "User Id", e.g. 12345): 1-32 letters and digits. */
export const REGISTRATION_ID_PATTERN = /^[A-Za-z0-9]{1,32}$/;

export const LIMITS = {
  name: 100,
  displayName: 60,
  seva: 60,
  region: 60,
  center: 80,
  email: 254,
  registrationId: 32,
} as const;

/** What the add/edit form sends. Every field is re-validated on the server. */
export type PersonFormValues = {
  /** Ignored on update: a BAPS ID can't be changed from the form. */
  bapsId: string;
  /**
   * The master list's "User Id"; "" = none. The server also accepts a payload
   * without it: on update a missing value leaves the stored one alone (only ""
   * clears it), so the import's link key is never dropped by accident.
   */
  registrationId: string;
  name: string;
  displayName: string;
  seva: string;
  email: string;
  phone: string;
  preferredChannel: OtpChannel;
  /** "" = not set. */
  gender: Gender | "";
  region: string;
  /** Master list "Center"; "" = not set. A missing value is left alone on update, like registrationId. */
  center: string;
  role: UserRole;
};

/**
 * What the form actually sends: the edit form leaves registrationId and center
 * out when the admin didn't change them, so a form opened before the import
 * linked someone can't unlink them (or overwrite their center) on save.
 */
export type PersonPayload = Omit<PersonFormValues, "registrationId" | "center"> &
  Partial<Pick<PersonFormValues, "registrationId" | "center">>;

/** Form fields that can carry an error; "contact" is the email-or-phone rule. */
export type PersonField = keyof PersonFormValues | "contact";
export type PersonFieldErrors = Partial<Record<PersonField, string>>;

export type SavePersonResult =
  | { ok: true; person: DirectoryPerson }
  | { ok: false; error?: string; fieldErrors?: PersonFieldErrors };

/** Trim and collapse runs of whitespace: "  Upsham   Naik " -> "Upsham Naik". */
export function tidyText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Accepts a string, null or undefined (missing optional fields) as "". */
const looseString = z.union([z.string(), z.null(), z.undefined()]).transform((v) => v ?? "");

const requiredText = (label: string, max: number) =>
  looseString
    .transform(tidyText)
    .refine((v) => v.length > 0, `${label} is required.`)
    .refine((v) => v.length <= max, `${label} can be at most ${max} characters.`);

const optionalText = (label: string, max: number) =>
  looseString
    .transform(tidyText)
    .refine((v) => v.length <= max, `${label} can be at most ${max} characters.`)
    .transform((v) => v || null);

const bapsIdField = looseString
  .transform((v) => v.trim().toUpperCase())
  .refine((v) => v.length > 0, "BAPS ID is required.")
  .refine((v) => v.length === 0 || BAPS_ID_PATTERN.test(v), "Use 3–32 letters and digits, e.g. BK1001.");

/**
 * Registration ID: trimmed, "" -> null (clears it). `.optional()` lets an
 * absent value through as undefined, which an update reads as "leave it":
 * this is the key the master-list import matches people by, so a payload
 * without the field must never unlink anyone.
 */
const registrationIdField = z
  .union([z.string(), z.null()])
  .transform((v) => (v ?? "").trim())
  .refine(
    (v) => v.length <= LIMITS.registrationId,
    `A registration ID can be at most ${LIMITS.registrationId} characters.`,
  )
  .refine((v) => v === "" || REGISTRATION_ID_PATTERN.test(v), "Use letters and digits only, e.g. 12345.")
  .transform((v) => v || null)
  .optional();

const emailFormat = z.string().email();
const emailField = looseString
  .transform((v) => v.trim().toLowerCase())
  .refine((v) => v.length <= LIMITS.email, "That email address is too long.")
  .refine((v) => v === "" || emailFormat.safeParse(v).success, "Enter a valid email address, e.g. name@example.com.")
  .transform((v) => v || null);

const phoneField = looseString.transform((v, ctx) => {
  const raw = v.trim();
  if (!raw) return null;
  const e164 = toE164(raw);
  // E.164 allows at most 15 digits after the "+".
  if (!e164 || e164.length > 16) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Enter a 10-digit US/Canada number, or an international number starting with +.",
    });
    return z.NEVER;
  }
  return e164;
});

const channelField = z.enum(["EMAIL", "SMS"], {
  errorMap: () => ({ message: "Choose where sign-in codes are sent." }),
});

const genderField = z
  .preprocess(
    (v) => (v === null || v === undefined ? "" : v),
    z.enum(["MALE", "FEMALE", ""], { errorMap: () => ({ message: "Choose Male, Female or Not set." }) }),
  )
  .transform((v) => (v === "" ? null : v));

const roleField = z.preprocess(
  (v) => (v === null || v === undefined || v === "" ? "DELEGATE" : v),
  z.enum(["DELEGATE", "SANT", "ADMIN"], { errorMap: () => ({ message: "Choose Delegate, Sant or Admin." }) }),
);

/**
 * Everything an edit may change (the BAPS ID is fixed once created).
 * registrationId and center are optional: absent = leave as is (see
 * registrationIdField); the other master-list fields are import-only.
 */
const editableFields = z.object({
  registrationId: registrationIdField,
  name: requiredText("Full name", LIMITS.name),
  displayName: optionalText("Display name", LIMITS.displayName),
  seva: requiredText("Seva", LIMITS.seva),
  email: emailField,
  phone: phoneField,
  preferredChannel: channelField,
  gender: genderField,
  region: optionalText("Region", LIMITS.region),
  center: optionalText("Center", LIMITS.center).optional(),
  role: roleField,
});

type ContactFields = { email: string | null; phone: string | null; preferredChannel: OtpChannel; role: UserRole };

/**
 * Sign-in needs somewhere to send the code: an email or a phone, and the
 * chosen channel must have its contact. Tester accounts sign in with their
 * fixed code instead, except admins, who always get a real code (see
 * requestOtp in src/lib/otp), so they are exempt only while not ADMIN.
 */
function contactRule(isTester: boolean) {
  return (data: ContactFields, ctx: z.RefinementCtx) => {
    if (isTester && data.role !== "ADMIN") return;
    if (!data.email && !data.phone) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["contact"],
        message: "Add an email or a phone number: sign-in codes are sent there.",
      });
      return;
    }
    if (data.preferredChannel === "EMAIL" && !data.email) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["email"],
        message: "Add an email address, or send codes by SMS instead.",
      });
    }
    if (data.preferredChannel === "SMS" && !data.phone) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["phone"],
        message: "Add a phone number, or send codes by email instead.",
      });
    }
  };
}

/** Validates the add form. Output is normalised (trimmed, BAPS ID upper-case, phone E.164, blanks -> null). */
export const newPersonSchema = editableFields.extend({ bapsId: bapsIdField }).superRefine(contactRule(false));

/** Validates the edit form. `isTester`: the account has a tester code (relaxes the contact rule unless ADMIN). */
export function editPersonSchema(isTester: boolean) {
  return editableFields.superRefine(contactRule(isTester));
}

export type NewPersonData = z.output<typeof newPersonSchema>;
export type PersonUpdateData = z.output<ReturnType<typeof editPersonSchema>>;

const FIELD_NAMES: readonly PersonField[] = [
  "bapsId",
  "registrationId",
  "name",
  "displayName",
  "seva",
  "email",
  "phone",
  "preferredChannel",
  "gender",
  "region",
  "center",
  "role",
  "contact",
];

/** First message per field, in the shape the form shows. */
export function fieldErrorsFrom(error: z.ZodError): PersonFieldErrors {
  const out: PersonFieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && (FIELD_NAMES as readonly string[]).includes(key)) {
      const field = key as PersonField;
      if (!out[field]) out[field] = issue.message;
    }
  }
  return out;
}

function invalid(error: z.ZodError): SavePersonResult {
  const fieldErrors = fieldErrorsFrom(error);
  return Object.keys(fieldErrors).length
    ? { ok: false, fieldErrors }
    : { ok: false, error: "Some details look wrong. Check the form and try again." };
}

// ---------------------------------------------------------------------------
// Seva / region / center spelling
// ---------------------------------------------------------------------------

/**
 * The spelling already in use for a seva, region or center, so "hospitality"
 * joins the existing "Hospitality" group (filters and announcement targeting
 * match these values exactly). An exact match keeps `value`; otherwise the most
 * common case-insensitive variant wins (ties: alphabetical); no match keeps
 * `value`.
 */
export function canonicalLabel(value: string, existing: readonly string[]): string {
  const key = tidyText(value).toLowerCase();
  const counts = new Map<string, number>();
  for (const label of existing) {
    if (label === value) return value;
    if (tidyText(label).toLowerCase() === key) counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [label, n] of counts) {
    if (n > bestCount || (n === bestCount && best !== null && label < best)) {
      best = label;
      bestCount = n;
    }
  }
  return best ?? value;
}

/** Client (or transaction client) used by the record functions. */
type Db = Pick<Prisma.TransactionClient, "user">;

/**
 * Seva, region and center in their existing spelling. `excludeId`: the person
 * being edited (their own row doesn't count). A center of undefined (not sent)
 * stays undefined, so the update leaves it alone.
 */
async function canonicalLabels(
  db: Db,
  data: { seva: string; region: string | null; center?: string | null },
  excludeId: string | null,
) {
  const others = await db.user.findMany({
    where: excludeId ? { id: { not: excludeId } } : undefined,
    select: { seva: true, region: true, center: true },
  });
  const regions = others.flatMap((o) => (o.region ? [o.region] : []));
  const centers = others.flatMap((o) => (o.center ? [o.center] : []));
  return {
    seva: canonicalLabel(data.seva, others.map((o) => o.seva)),
    region: data.region === null ? null : canonicalLabel(data.region, regions),
    center: data.center === null || data.center === undefined ? data.center : canonicalLabel(data.center, centers),
  };
}

// ---------------------------------------------------------------------------
// Create / update
// ---------------------------------------------------------------------------

/** Prisma's error code (P2002 unique violation, P2025 record not found...), if any. */
function prismaErrorCode(err: unknown): string | null {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = (err as { code: unknown }).code;
    return typeof code === "string" ? code : null;
  }
  return null;
}

/**
 * Which unique field a P2002 violation hit, from Prisma's meta.target (field
 * or column names, or the index name, depending on the engine).
 */
function uniqueViolation(err: unknown): "registrationId" | "bapsId" | null {
  if (prismaErrorCode(err) !== "P2002") return null;
  const target = (err as { meta?: { target?: unknown } }).meta?.target;
  const text = (Array.isArray(target) ? target.join(" ") : String(target ?? "")).toLowerCase();
  return text.includes("registration") ? "registrationId" : "bapsId";
}

const GONE = "This person is no longer in the directory. Close this and refresh the page.";

/** Someone other than `excludeId` who already has this registration ID. */
async function registrationHolder(db: Db, registrationId: string, excludeId: string | null) {
  const holder = await db.user.findUnique({
    where: { registrationId },
    select: { id: true, name: true, bapsId: true },
  });
  return holder && holder.id !== excludeId ? holder : null;
}

function registrationTaken(registrationId: string, holder: { name: string; bapsId: string }): SavePersonResult {
  return {
    ok: false,
    fieldErrors: {
      registrationId: `Registration ID ${registrationId} already belongs to ${holder.name} (${holder.bapsId}).`,
    },
  };
}

function registrationRace(registrationId: string): SavePersonResult {
  return {
    ok: false,
    fieldErrors: {
      registrationId: `Registration ID ${registrationId} was just given to someone else. Search for it to see who.`,
    },
  };
}

/** Adds one person. Returns field errors for bad input or a BAPS ID or registration ID that's taken. */
export async function createPersonRecord(db: Db, input: unknown): Promise<SavePersonResult> {
  const parsed = newPersonSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const data = parsed.data;
  const registrationId = data.registrationId ?? null;

  const taken = await db.user.findUnique({ where: { bapsId: data.bapsId }, select: { name: true } });
  if (taken) {
    return { ok: false, fieldErrors: { bapsId: `${data.bapsId} already belongs to ${taken.name}.` } };
  }
  if (registrationId) {
    const holder = await registrationHolder(db, registrationId, null);
    if (holder) return registrationTaken(registrationId, holder);
  }

  const labels = await canonicalLabels(db, data, null);
  try {
    const row = await db.user.create({
      data: {
        bapsId: data.bapsId,
        registrationId,
        name: data.name,
        displayName: data.displayName,
        seva: labels.seva,
        email: data.email,
        phone: data.phone,
        preferredChannel: data.preferredChannel,
        gender: data.gender,
        region: labels.region,
        center: labels.center ?? null,
        role: data.role,
      },
      select: DIRECTORY_SELECT,
    });
    return { ok: true, person: toDirectoryPerson(row) };
  } catch (err) {
    // Someone else took the same BAPS ID or registration ID between the checks above and the insert.
    const clash = uniqueViolation(err);
    if (clash === "registrationId" && registrationId) return registrationRace(registrationId);
    if (clash) {
      return { ok: false, fieldErrors: { bapsId: `${data.bapsId} was just added by someone else. Search for it instead.` } };
    }
    throw err;
  }
}

/**
 * Saves the editable fields of one person. `actorId` is the signed-in admin:
 * they can't take away their own ADMIN role (so the console can't lock them
 * out). BAPS ID, test code, breakout links and the import-only master-list
 * fields (wings, seva role, status, goshthi group, room and moderator) are
 * left as they are; the registration ID and center only change when the
 * payload carries them.
 */
export async function updatePersonRecord(db: Db, actorId: string, id: unknown, input: unknown): Promise<SavePersonResult> {
  if (typeof id !== "string" || id.length === 0 || id.length > 64) return { ok: false, error: GONE };

  const existing = await db.user.findUnique({ where: { id }, select: { id: true, testCode: true } });
  if (!existing) return { ok: false, error: GONE };

  const parsed = editPersonSchema(existing.testCode !== null).safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const data = parsed.data;

  if (existing.id === actorId && data.role !== "ADMIN") {
    return {
      ok: false,
      fieldErrors: { role: "You can't remove your own admin access. Ask another admin if it needs to change." },
    };
  }

  if (data.registrationId) {
    const holder = await registrationHolder(db, data.registrationId, existing.id);
    if (holder) return registrationTaken(data.registrationId, holder);
  }

  const labels = await canonicalLabels(db, data, existing.id);
  try {
    const row = await db.user.update({
      where: { id: existing.id },
      data: {
        // undefined (not sent) leaves the stored value; null clears it.
        registrationId: data.registrationId,
        name: data.name,
        displayName: data.displayName,
        seva: labels.seva,
        email: data.email,
        phone: data.phone,
        preferredChannel: data.preferredChannel,
        gender: data.gender,
        region: labels.region,
        center: labels.center,
        role: data.role,
      },
      select: DIRECTORY_SELECT,
    });
    return { ok: true, person: toDirectoryPerson(row) };
  } catch (err) {
    // Deleted between the lookup above and the update.
    if (prismaErrorCode(err) === "P2025") return { ok: false, error: GONE };
    // The registration ID was given to someone else between the check above and the update.
    if (uniqueViolation(err) && data.registrationId) return registrationRace(data.registrationId);
    throw err;
  }
}
