/**
 * The planning half of the master-list import (scripts/import-delegates.ts).
 * Turns the organisers' master list ("App DataSet") and their goshthi group
 * workbooks into the delegates to upsert, applies every organiser decision,
 * and says what was skipped and why. reconcile() then compares that plan with
 * the `users` rows already in the database.
 *
 * Pure: no database, no file access. The script reads the workbooks (exceljs)
 * and passes each sheet in as rows of raw cell values; nothing from the
 * spreadsheets lives in the repo.
 *
 * Decisions (the organisers'):
 * - "User Id" is the key that links a delegate to the other data sources:
 *   users.registration_id. The import upserts by it, else by BAPS ID.
 * - users.baps_id = BAPS ID upper-cased (the sign-in form upper-cases it too);
 *   preferred channel EMAIL; phone in E.164 when the sheet has a usable one.
 *   Non-standard IDs ("first.last") are imported as given.
 * - The organisers send some BAPS IDs by message (the script's --baps-id
 *   <User Id>=<BAPS ID>): for a blank cell, or to correct the sheet's (rows
 *   whose BAPS ID and email disagreed). The given value wins over the cell,
 *   blank or not, and is upper-cased and checked like the sheet's. A plan
 *   error: one for a User Id not in the list, the same User Id twice, one
 *   that can't be a sign-in ID, or one another imported person has.
 * - email = "<baps id lower-case>@na.baps.id" for everyone (2026-09-27; the
 *   organisers' email list is no longer used): src/lib/delegateEmail.ts.
 * - Refunded registrations are imported like anyone else, status as given
 *   (2026-09-27, "in case anything changes"), and listed.
 * - A User Id on two rows (today: one with a Seva Wing and Seva and one blank
 *   "#N/A" row, same BAPS ID) is imported once, from the row with a usable
 *   Seva Wing and Seva (gender, seva, wings, role, name and status from it;
 *   phone from whichever row has one); differing statuses are listed.
 * - Skipped and listed (genuinely unusable): rows of one User Id with
 *   different BAPS IDs (even with a --baps-id value: it can't say which row
 *   is theirs), or with different usable sevas; no BAPS ID, or one that can't
 *   be a sign-in ID; a BAPS ID shared by several User Ids; no usable Seva
 *   Wing or Seva.
 * - Gender track from the Personal Wing when it names one (Sanyukta = men,
 *   Premvati = women), else the Seva Wing: genderForPerson(). Men in IBKY
 *   liaison roles stay on the Bhaio track.
 * - name = "First Last" (no middle name).
 * - users.seva = the breakout team code for (Seva Wing, Seva), teamForSeva(),
 *   else the Seva text as given, which matches no team, so those delegates
 *   see no breakout sessions until the organisers place them. The raw cells go
 *   to users.seva_wing / users.seva_role.
 * - Goshthi groups (src/lib/goshthiImport.ts reads the workbooks): each group
 *   meets in its own room during the Goshthi sessions. users.goshthi_group =
 *   the person's group (Bhaio "Group 4", or "eBKY Group 1" when listed under
 *   another wing than their own, since a bare number is read against their own
 *   seva wing; Behno "Goshthi Group 12"), users.goshthi_room = its room,
 *   users.goshthi_moderator = whether they moderate it. Someone in several
 *   groups (or on both sides) gets none and is listed. The import writes the
 *   three only with a goshthi workbook, and only for the tracks it covers (plus
 *   anyone it lists): a delegate on a covered track whom no group lists gets
 *   none, and running with a Bhaio-only file never clears Behno groups.
 * - Phone is written only when the sheet has a usable one: a blank or "#N/A"
 *   cell never clears a number already on file (an admin may have added it).
 */
import { DELEGATE_EMAIL_DOMAIN, defaultDelegateEmail, emailDomain, isValidEmail } from "./delegateEmail";
import { assignGoshthi, fillMergedCells, wingLabel, type GoshthiPlan, type GoshthiTextWorkbook } from "./goshthiImport";
import { genderForPerson, sevaWingOf, sheetKey, teamForSeva, type SevaWing } from "./sevaMapping";
import { TEAM_CODES, type TeamCode } from "./teams";
import { toE164 } from "./users";

export type { GoshthiPlan, GoshthiTabInfo } from "./goshthiImport";

/**
 * One worksheet as read from the workbook: rows[0] is the header row (for the
 * goshthi tabs, the first row), plus its merged ranges ("G7:G15") and exceljs
 * state ("visible", "hidden", ...; missing = visible) where the reader gives them.
 */
export type SheetRows = { name: string; rows: unknown[][]; merges?: readonly string[]; state?: string };
/** A goshthi workbook: its file name (for messages) and every worksheet. */
export type GoshthiWorkbook = { file: string; sheets: SheetRows[] };
/** A BAPS ID the organisers sent for a master-list User Id (--baps-id): fills or corrects the sheet's. */
export type BapsIdOverride = { registrationId: string; bapsId: string };
export type PlanOptions = {
  /** --baps-id values, as given (upper-cased and checked by the plan). */
  bapsIds?: readonly BapsIdOverride[];
};

export type Track = "MALE" | "FEMALE";

export type PlannedDelegate = {
  /** Master list "User Id", trimmed (numbers as plain digits). */
  registrationId: string;
  /** BAPS ID upper-cased. */
  bapsId: string;
  /** The BAPS ID came from --baps-id rather than the sheet. */
  bapsIdGiven: boolean;
  /** The sheet's BAPS ID cell(s), upper-cased (null = blank); "A / B" when two rows differ. */
  sheetBapsId: string | null;
  name: string;
  /** "<baps id lower-case>@na.baps.id". */
  email: string;
  /** E.164, or null when the sheet has no usable number. */
  phone: string | null;
  gender: Track;
  /** Breakout team code, or the Seva text when it maps to no team. */
  seva: string;
  team: TeamCode | null;
  sevaWing: SevaWing;
  sevaRole: string;
  personalWing: string | null;
  region: string | null;
  center: string | null;
  registrationStatus: string | null;
  goshthiGroup: string | null;
  /** The room the goshthi group meets in (null = none given). */
  goshthiRoom: string | null;
  /** They moderate their goshthi group. */
  goshthiModerator: boolean;
  /** Goshthi tab the group came from, "<file> / <tab>" (null = no group). */
  goshthiSource: string | null;
  /**
   * Whether this import sets the goshthi columns for this person: a goshthi
   * workbook covers their track, or lists them. False leaves them as they are.
   */
  goshthiOwned: boolean;
  /** 1-based row in the master sheet (for a User Id on two rows, the row imported). */
  row: number;
};

export type SkipReason =
  | "conflicting-rows"
  | "no-baps-id"
  | "invalid-baps-id"
  | "shared-baps-id"
  | "no-seva-wing"
  | "no-seva";

export const SKIP_LABELS: Record<SkipReason, string> = {
  "conflicting-rows": "User Id on several rows that disagree (different BAPS IDs or sevas)",
  "no-baps-id": "No BAPS ID",
  "invalid-baps-id": "BAPS ID can't be used to sign in",
  "shared-baps-id": "BAPS ID shared by several User Ids",
  "no-seva-wing": "Seva Wing is not one of the eight wings",
  "no-seva": "No Seva",
};

export type SkippedEntry = {
  registrationId: string;
  reason: SkipReason;
  /** 1-based master sheet rows. */
  rows: number[];
  /** Non-personal context: statuses, the other User Ids, the cell value. */
  detail?: string;
};

/** A User Id on two master rows, imported once from the row with a usable Seva Wing and Seva. */
export type MergedRows = {
  registrationId: string;
  /** 1-based rows; the imported one first. */
  rows: number[];
  /** The imported row's status, and the other row's when it differs (else null). */
  status: string | null;
  otherStatus: string | null;
  statusesDiffer: boolean;
  /** The phone came from the other row. */
  phoneFromOtherRow: boolean;
};

export type DelegatePlan = {
  masterSheet: string;
  /** Data rows below the header. */
  masterRows: number;
  /** Rows without a User Id, name or BAPS ID (dropped). */
  emptyRows: number;
  /** Rows with data but no User Id (skipped), 1-based. */
  rowsWithoutUserId: number[];
  /** Distinct User Ids in the master list. */
  userIds: number;
  delegates: PlannedDelegate[];
  skipped: SkippedEntry[];
  /** Every --baps-id value: what the sheet had, and whether the User Id is imported. */
  bapsIdsGiven: { registrationId: string; bapsId: string; sheet: string | null; imported: boolean }[];
  /** Imported with Registration Status "Refunded" (User Ids). */
  refunded: string[];
  /** User Ids on two rows, imported once. */
  mergedRows: MergedRows[];
  /** Imported with a BAPS ID outside the usual two letters + seven digits. */
  nonStandardBapsIds: { registrationId: string; bapsId: string }[];
  /** No phone written (a phone on file is kept) because the cell isn't a usable number. */
  unusablePhones: string[];
  goshthi: GoshthiPlan | null;
  counts: {
    byStatus: Record<string, number>;
    byTrack: Record<Track, number>;
    /** Delegates per team code, in TEAM_CODES order (teams with nobody left out). */
    byTeam: Partial<Record<TeamCode, number>>;
    /** Delegates whose seva maps to no team, by Seva text and wing. */
    noTeam: { seva: string; total: number; byWing: Partial<Record<SevaWing, number>> }[];
    withPhone: number;
  };
  /** Invariant failures: the import refuses to write while there are any. */
  errors: string[];
};

// ---------------------------------------------------------------------------
// Cells

const EXCEL_ERROR = /^#(?:N\/A|REF!|VALUE!|NAME\?|DIV\/0!|NULL!|NUM!|SPILL!|CALC!|GETTING_DATA)$/i;

/**
 * A raw cell value (exceljs: string, number, Date, rich text, hyperlink,
 * formula with a cached result, error) as trimmed text with whitespace runs
 * collapsed, or null when blank or an Excel error such as "#N/A".
 */
export function cellText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const s = value.replace(/\s+/g, " ").trim();
    return s === "" || EXCEL_ERROR.test(s) ? null : s;
  }
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value === "boolean") return String(value);
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    if ("error" in o) return null;
    if ("result" in o) return cellText(o.result);
    if (Array.isArray(o.richText)) {
      return cellText(o.richText.map((t) => (t as { text?: unknown })?.text ?? "").join(""));
    }
    if ("text" in o) return cellText(o.text);
  }
  return null;
}

/** Column index per field, found by header text (case and spacing ignored). */
function findColumns<K extends string>(
  sheet: SheetRows,
  wanted: Record<K, readonly string[]>,
  required: readonly K[],
): Record<K, number> | { missing: K[] } {
  const header = (sheet.rows[0] ?? []).map((v) => sheetKey(cellText(v)));
  const cols = {} as Record<K, number>;
  const missing: K[] = [];
  for (const key of Object.keys(wanted) as K[]) {
    const idx = header.findIndex((h) => wanted[key].some((name) => sheetKey(name) === h));
    cols[key] = idx;
    if (idx < 0 && required.includes(key)) missing.push(key);
  }
  return missing.length > 0 ? { missing } : cols;
}

const MASTER_COLUMNS = {
  userId: ["User Id", "UserId", "User ID"],
  firstName: ["First Name"],
  lastName: ["Last Name"],
  personalWing: ["Personal Wing"],
  phone: ["Phone Number", "Phone"],
  region: ["Region"],
  center: ["Center", "Centre"],
  sevaWing: ["Seva Wing", "What Is Your Seva Wing"],
  seva: ["Seva", "Select Your Seva"],
  status: ["Registration Status", "Status"],
  bapsId: ["BAPS ID", "BAPSID"],
} as const;
type MasterKey = keyof typeof MASTER_COLUMNS;
const MASTER_REQUIRED: readonly MasterKey[] = ["userId", "firstName", "lastName", "sevaWing", "seva", "status", "bapsId"];

/** A goshthi worksheet as text, merged ranges filled with their top-left value. */
function goshthiTextWorkbook(wb: GoshthiWorkbook): GoshthiTextWorkbook {
  return {
    file: wb.file,
    sheets: wb.sheets.map((s) => ({
      name: s.name,
      state: s.state ?? "visible",
      cells: fillMergedCells(
        s.rows.map((r) => (r ?? []).map(cellText)),
        s.merges ?? [],
      ),
    })),
  };
}

/** The usual BAPS ID shape: two letters and seven digits ("AB1234567"). */
const STANDARD_BAPS_ID = /^[A-Z]{2}\d{7}$/;
/** What the sign-in form accepts (3–32 characters) and an email local part can hold. */
const USABLE_BAPS_ID = /^[A-Z0-9][A-Z0-9._-]{2,31}$/;

// ---------------------------------------------------------------------------
// Planning

type MasterRow = {
  row: number;
  registrationId: string;
  firstName: string | null;
  lastName: string | null;
  personalWing: string | null;
  phone: string | null;
  region: string | null;
  center: string | null;
  sevaWing: string | null;
  seva: string | null;
  status: string | null;
  bapsId: string | null;
};

function countBy<T>(items: readonly T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const k = key(item);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/** The distinct BAPS ID cells of a User Id's rows, upper-cased (blank cells left out). */
const sheetIdsOf = (rows: readonly MasterRow[]) =>
  [...new Set(rows.map((x) => x.bapsId?.toUpperCase()).filter((v): v is string => !!v))];
const hasSeva = (r: MasterRow) => !!sevaWingOf(r.sevaWing) && !!r.seva;
const sevaKey = (r: MasterRow) => JSON.stringify([sevaWingOf(r.sevaWing), sheetKey(r.seva)]);
const rowNote = (r: MasterRow) => `row ${r.row}: ${r.sevaWing ?? "no wing"} / ${r.seva ?? "no seva"}, ${r.status ?? "no status"}`;

/**
 * The --baps-id values as a map (User Id -> BAPS ID upper-cased), with the
 * plan errors: a User Id given twice, not in the list, or a BAPS ID that
 * can't be a sign-in ID.
 */
function readOverrides(
  overrides: readonly BapsIdOverride[],
  inList: ReadonlySet<string>,
): { byUserId: Map<string, string>; errors: string[] } {
  const byUserId = new Map<string, string>();
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const o of overrides) {
    const registrationId = o.registrationId.trim();
    const bapsId = o.bapsId.trim().toUpperCase();
    const arg = `--baps-id ${registrationId}=${bapsId}`;
    if (seen.has(registrationId)) {
      errors.push(`${arg}: User Id ${registrationId} is given more than once`);
      byUserId.delete(registrationId);
      continue;
    }
    seen.add(registrationId);
    if (!inList.has(registrationId)) errors.push(`${arg}: User Id ${registrationId} is not in the master list`);
    else if (!USABLE_BAPS_ID.test(bapsId)) errors.push(`${arg}: "${bapsId}" can't be a BAPS ID (sign-in ID)`);
    else byUserId.set(registrationId, bapsId);
  }
  return { byUserId, errors };
}

/**
 * The import plan for a master-list sheet, any goshthi workbooks (null =
 * none given: goshthi columns are then left as they are) and the --baps-id
 * values. Throws when the master sheet lacks a required column.
 */
export function planDelegates(
  master: SheetRows,
  goshthi: GoshthiWorkbook[] | null,
  options: PlanOptions | null = null,
): DelegatePlan {
  const cols = findColumns(master, MASTER_COLUMNS, MASTER_REQUIRED);
  if ("missing" in cols) {
    const found = (master.rows[0] ?? []).map((v) => cellText(v)).filter(Boolean);
    throw new Error(
      `Master sheet "${master.name}" has no ${cols.missing.map((k) => `"${MASTER_COLUMNS[k][0]}"`).join(", ")} column ` +
        `(found: ${found.join(", ")})`,
    );
  }
  const cell = (r: unknown[], key: MasterKey) => (cols[key] >= 0 ? cellText(r[cols[key]]) : null);

  let emptyRows = 0;
  const rowsWithoutUserId: number[] = [];
  const byUserId = new Map<string, MasterRow[]>();
  const dataRows = master.rows.slice(1);
  dataRows.forEach((r, i) => {
    const row = i + 2; // header is row 1
    const registrationId = cell(r, "userId");
    const firstName = cell(r, "firstName");
    const lastName = cell(r, "lastName");
    const bapsId = cell(r, "bapsId");
    if (!registrationId) {
      // The sheet ends in rows holding only a "#N/A" / 0 phone lookup.
      if (!firstName && !lastName && !bapsId) emptyRows++;
      else rowsWithoutUserId.push(row);
      return;
    }
    const entry: MasterRow = {
      row,
      registrationId,
      firstName,
      lastName,
      personalWing: cell(r, "personalWing"),
      phone: cell(r, "phone"),
      region: cell(r, "region"),
      center: cell(r, "center"),
      sevaWing: cell(r, "sevaWing"),
      seva: cell(r, "seva"),
      status: cell(r, "status"),
      bapsId,
    };
    byUserId.set(registrationId, [...(byUserId.get(registrationId) ?? []), entry]);
  });

  const overrides = readOverrides(options?.bapsIds ?? [], new Set(byUserId.keys()));
  const errors: string[] = [...overrides.errors];

  const skipped: SkippedEntry[] = [];
  const mergedRows: MergedRows[] = [];
  /** One row per User Id, with its BAPS ID (given or the sheet's) and phone. */
  type Candidate = { r: MasterRow; bapsId: string; given: boolean; sheetBapsId: string | null; phone: string | null };
  const candidates: Candidate[] = [];
  for (const [registrationId, rows] of byUserId) {
    const skip = (reason: SkipReason, detail?: string, at: MasterRow[] = rows) =>
      skipped.push({ registrationId, reason, rows: at.map((x) => x.row), ...(detail ? { detail } : {}) });
    const given = overrides.byUserId.get(registrationId) ?? null;
    const sheetIds = sheetIdsOf(rows);
    const sheetBapsId = sheetIds.length > 0 ? sheetIds.join(" / ") : null;

    // A User Id on several rows: one account, from the row with a usable seva.
    let r = rows[0];
    if (rows.length > 1) {
      const withSeva = rows.filter(hasSeva);
      // Rows with different BAPS IDs may be two people: a --baps-id value can't say which row is theirs.
      if (sheetIds.length > 1) {
        skip("conflicting-rows", `different BAPS IDs ${sheetIds.join(", ")}${given ? ` (--baps-id ${given} given)` : ""}`);
        continue;
      }
      if (new Set(withSeva.map(sevaKey)).size > 1) {
        skip("conflicting-rows", `different sevas: ${withSeva.map(rowNote).join("; ")}`);
        continue;
      }
      r = withSeva[0] ?? rows[0];
      const others = rows.filter((x) => x !== r);
      const otherStatus = others.map((x) => x.status).find((s) => sheetKey(s) !== sheetKey(r.status)) ?? null;
      const ownPhone = toE164(r.phone);
      const otherPhone = others.map((x) => toE164(x.phone)).find(Boolean) ?? null;
      mergedRows.push({
        registrationId,
        rows: [r.row, ...others.map((x) => x.row)],
        status: r.status,
        otherStatus,
        statusesDiffer: others.some((x) => sheetKey(x.status) !== sheetKey(r.status)),
        phoneFromOtherRow: !ownPhone && !!otherPhone,
      });
      // Region and center aren't about the seva: a blank one takes the other row's.
      r = {
        ...r,
        bapsId: r.bapsId ?? sheetIds[0] ?? null,
        phone: ownPhone ? r.phone : (otherPhone ?? r.phone),
        region: r.region ?? others.map((x) => x.region).find(Boolean) ?? null,
        center: r.center ?? others.map((x) => x.center).find(Boolean) ?? null,
      };
    }
    const bapsId = given ?? r.bapsId?.toUpperCase() ?? null;
    if (!bapsId) skip("no-baps-id", undefined, [r]);
    else if (!USABLE_BAPS_ID.test(bapsId)) skip("invalid-baps-id", r.bapsId ?? bapsId, [r]);
    else if (!sevaWingOf(r.sevaWing)) skip("no-seva-wing", r.sevaWing ?? "blank", [r]);
    else if (!r.seva) skip("no-seva", undefined, [r]);
    else candidates.push({ r, bapsId, given: given !== null, sheetBapsId, phone: toE164(r.phone) });
  }

  // A BAPS ID can sign in to one account only.
  const byBapsId = new Map<string, Candidate[]>();
  for (const c of candidates) byBapsId.set(c.bapsId, [...(byBapsId.get(c.bapsId) ?? []), c]);
  const delegates: PlannedDelegate[] = [];
  const unusablePhones: string[] = [];
  for (const c of candidates) {
    const { r, bapsId } = c;
    const sharing = byBapsId.get(bapsId)!;
    if (sharing.length > 1) {
      const others = sharing.filter((s) => s !== c).map((s) => s.r.registrationId);
      if (c.given) errors.push(`--baps-id ${r.registrationId}=${bapsId}: BAPS ID ${bapsId} is also User Id ${others.join(", ")}'s`);
      skipped.push({
        registrationId: r.registrationId,
        reason: "shared-baps-id",
        rows: [r.row],
        detail: `also User Id ${others.join(", ")}`,
      });
      continue;
    }
    const sevaWing = sevaWingOf(r.sevaWing)!;
    if (r.phone && !c.phone) unusablePhones.push(r.registrationId);
    const team = teamForSeva(sevaWing, r.seva);
    delegates.push({
      registrationId: r.registrationId,
      bapsId,
      bapsIdGiven: c.given,
      sheetBapsId: c.sheetBapsId,
      name: [r.firstName, r.lastName].filter(Boolean).join(" "),
      email: defaultDelegateEmail(bapsId),
      phone: c.phone,
      gender: genderForPerson(r.personalWing, sevaWing)!,
      seva: team ?? r.seva!,
      team,
      sevaWing,
      sevaRole: r.seva!,
      personalWing: r.personalWing,
      region: r.region,
      center: r.center,
      registrationStatus: r.status,
      goshthiGroup: null,
      goshthiRoom: null,
      goshthiModerator: false,
      goshthiSource: null,
      goshthiOwned: false,
      row: r.row,
    });
  }
  delegates.sort((a, b) => a.row - b.row);
  skipped.sort((a, b) => a.rows[0] - b.rows[0]);
  mergedRows.sort((a, b) => a.rows[0] - b.rows[0]);

  const planned = new Set(delegates.map((d) => d.registrationId));
  const bapsIdsGiven = [...overrides.byUserId].map(([registrationId, bapsId]) => ({
    registrationId,
    bapsId,
    sheet: sheetIdsOf(byUserId.get(registrationId) ?? []).join(" / ") || null,
    imported: planned.has(registrationId),
  }));

  const skipById = new Map(skipped.map((s) => [s.registrationId, s]));
  const goshthiPlan = goshthi
    ? assignGoshthi(delegates, goshthi.map(goshthiTextWorkbook), (id) => {
        const skip = skipById.get(id);
        return skip ? SKIP_LABELS[skip.reason] : "not in the master list";
      })
    : null;

  const noTeam = new Map<string, { seva: string; total: number; byWing: Partial<Record<SevaWing, number>> }>();
  for (const d of delegates) {
    if (d.team) continue;
    const entry = noTeam.get(d.seva) ?? { seva: d.seva, total: 0, byWing: {} };
    entry.total++;
    entry.byWing[d.sevaWing] = (entry.byWing[d.sevaWing] ?? 0) + 1;
    noTeam.set(d.seva, entry);
  }
  const teamCounts = countBy(
    delegates.filter((d) => d.team),
    (d) => d.team!,
  );
  const byTeam: Partial<Record<TeamCode, number>> = {};
  for (const code of TEAM_CODES) if (teamCounts[code]) byTeam[code] = teamCounts[code];

  const plan: DelegatePlan = {
    masterSheet: master.name,
    masterRows: dataRows.length,
    emptyRows,
    rowsWithoutUserId,
    userIds: byUserId.size,
    delegates,
    skipped,
    bapsIdsGiven,
    refunded: delegates.filter((d) => sheetKey(d.registrationStatus) === "refunded").map((d) => d.registrationId),
    mergedRows,
    nonStandardBapsIds: delegates
      .filter((d) => !STANDARD_BAPS_ID.test(d.bapsId))
      .map((d) => ({ registrationId: d.registrationId, bapsId: d.bapsId })),
    unusablePhones,
    goshthi: goshthiPlan,
    counts: {
      byStatus: countBy(delegates, (d) => d.registrationStatus ?? "(blank)"),
      byTrack: { MALE: 0, FEMALE: 0, ...countBy(delegates, (d) => d.gender) },
      byTeam,
      noTeam: [...noTeam.values()].sort((a, b) => b.total - a.total || a.seva.localeCompare(b.seva)),
      withPhone: delegates.filter((d) => d.phone).length,
    },
    errors,
  };
  plan.errors = [...errors, ...(goshthiPlan?.errors ?? []), ...validatePlan(plan)];
  return plan;
}

/** Checks the invariants the database relies on; every problem found. */
function validatePlan(plan: DelegatePlan): string[] {
  const problems: string[] = [];
  const dupes = (values: string[]) => [...new Set(values.filter((v, i) => values.indexOf(v) !== i))];
  const ds = plan.delegates;
  for (const v of dupes(ds.map((d) => d.registrationId))) problems.push(`User Id ${v} is planned more than once`);
  for (const v of dupes(ds.map((d) => d.bapsId))) problems.push(`BAPS ID ${v} is planned more than once`);
  // Addresses are personal: report the User Ids, never the address.
  for (const v of dupes(ds.map((d) => d.email))) {
    const ids = ds.filter((d) => d.email === v).map((d) => d.registrationId);
    problems.push(`One email address is planned for several delegates: User Id ${ids.join(", ")}`);
  }
  for (const d of ds) {
    const who = `User Id ${d.registrationId} (${d.bapsId})`;
    if (!/^\S{1,64}$/.test(d.registrationId)) problems.push(`${who}: User Id must be one word`);
    if (!USABLE_BAPS_ID.test(d.bapsId)) problems.push(`${who}: BAPS ID can't be used to sign in`);
    if (!isValidEmail(d.email)) problems.push(`${who}: the email "${d.email}" is not a valid address`);
    if (d.phone !== null && !/^\+\d{8,15}$/.test(d.phone)) problems.push(`${who}: phone is not E.164`);
    if (!d.name.trim()) problems.push(`${who}: no name`);
    if (!d.seva.trim()) problems.push(`${who}: no seva`);
    if (d.gender !== "MALE" && d.gender !== "FEMALE") problems.push(`${who}: no gender track`);
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Summary

/** A list of ids on one line, cut short after `max`. */
export function idList(ids: readonly string[], max = 40): string {
  if (ids.length <= max) return ids.join(", ");
  return `${ids.slice(0, max).join(", ")} … and ${ids.length - max} more`;
}

const TRACK_LABEL: Record<Track, string> = { MALE: "Bhaio", FEMALE: "Behno" };

/** Every id, `perLine` to a line (for lists the organisers follow up in full). */
function idLines(ids: readonly string[], indent: string, perLine = 25): string[] {
  const lines: string[] = [];
  for (let i = 0; i < ids.length; i += perLine) lines.push(`${indent}User Id ${ids.slice(i, i + perLine).join(", ")}`);
  return lines;
}

/** The goshthi section: tabs, groups, rooms, and everyone the organisers may want to look at. */
function goshthiSummary(g: GoshthiPlan, delegates: readonly PlannedDelegate[]): string[] {
  const lines: string[] = [];
  const side = (t: Track | null) => (t ? TRACK_LABEL[t] : "no side");
  const tracks = g.coveredTracks.map((t) => TRACK_LABEL[t]).join(" + ") || "no track";
  lines.push(`Goshthi groups: ${g.tabs.length} tabs read, covering ${tracks}`);
  for (const s of g.inferredSides) {
    lines.push(`  Side of ${s.source} taken from the people it lists (its name gives none): ${TRACK_LABEL[s.track]}, ${s.onTrack} of ${s.matched}`);
  }
  for (const s of g.unknownSides) {
    lines.push(`  Side of ${s} unknown (name gives none, people mixed or too few): its track's coverage is not assumed`);
  }
  for (const t of g.tabs) {
    // Rows without a User Id are ignored; a group's summary row (only Wing / Ppl in Group / Room) is said to be one.
    const summaryRows = t.summaryRows;
    const otherRows = t.rowsWithoutUserId.filter((r) => !summaryRows.includes(r));
    const noUserId =
      t.rowsWithoutUserId.length === 0
        ? ""
        : otherRows.length === 0
          ? `, rows with data but no User Id (ignored; they look like group summary rows: only Wing / Ppl in Group / Room): ${idList(summaryRows.map(String))}`
          : `, rows with data but no User Id (ignored): ${idList(t.rowsWithoutUserId.map(String))}` +
            (summaryRows.length > 0
              ? `; of them ${idList(summaryRows.map(String))} look like group summary rows (only Wing / Ppl in Group / Room)`
              : "");
    lines.push(
      `  ${t.source} (${t.format}, ${side(t.track)}${t.wing ? `, wing ${t.wing}` : ""}` +
        `${t.groupsByNumber ? ", group numbers unique across wings" : ""}): ${t.people} people` +
        `${t.statedPeople !== null ? ` (title says ${t.statedPeople})` : ""}, ${t.groups} groups, ${t.rooms} rooms, ` +
        `${t.moderators} moderator rows, ${t.blankRooms} rows without a room` +
        noUserId,
    );
  }
  for (const t of g.ignoredTabs) lines.push(`  Ignored tab: ${t}`);
  lines.push(
    `  Assigned: ${g.assigned} delegates (Bhaio ${g.assignedByTrack.MALE}, Behno ${g.assignedByTrack.FEMALE}), ` +
      `${g.moderators.length} of them moderators; tracks not covered are left as they are`,
  );
  for (const t of ["MALE", "FEMALE"] as const) {
    const rooms = g.rooms.filter((r) => r.track === t);
    if (rooms.length === 0) continue;
    const groups = g.groups.filter((x) => x.track === t).length;
    lines.push(`  ${TRACK_LABEL[t]} rooms (${rooms.length} rooms, ${groups} groups; groups / people as listed):`);
    lines.push(`    ${rooms.map((r) => `${r.room} ${r.groups}/${r.people}`).join("; ")}`);
  }
  // A grid group has one "Moderator:" row; any other count is the organisers' to confirm
  // (every row so labelled is marked moderator, as the workbook has it).
  const gridSources = new Set(g.tabs.filter((t) => t.format === "grid").map((t) => t.source));
  const oddModerators = g.groups.filter((x) => gridSources.has(x.source) && x.moderators !== 1);
  if (oddModerators.length > 0) {
    lines.push(`  Groups without exactly one "Moderator:" row (all marked as given; confirm with the organisers): ${oddModerators.length}`);
    for (const x of oddModerators) {
      const who = x.moderatorRows.map((m) => `User Id ${m.registrationId} (row ${m.row})`).join(", ");
      lines.push(`    ${x.group} (${x.source}): ${x.moderators === 0 ? "no moderator row" : `${x.moderators} moderator rows, ${who}`}`);
    }
  }
  const noRoomGroups = g.groups.filter((x) => !x.room);
  if (noRoomGroups.length > 0) {
    lines.push(`  Groups without a room: ${noRoomGroups.map((x) => `${x.group} (${side(x.track)}, ${x.people} people)`).join("; ")}`);
  }
  // Other Location values in a group (e.g. a moderator row's floor): reported, never the room.
  const extra = new Map<string, string[]>();
  for (const x of g.groups) for (const l of x.otherLocations) extra.set(l, [...(extra.get(l) ?? []), x.group]);
  if (extra.size > 0) {
    lines.push("  Other Location values in a group (e.g. a moderator row's floor; the group's room is used for everyone):");
    for (const [l, groups] of extra) lines.push(`    "${l}": ${groups.length} groups (${groups.join(", ")})`);
  }
  for (const c of g.roomCorrections) lines.push(`  Room spelling corrected: "${c.from}" -> "${c.to}" (${c.rows} rows, ${c.source})`);
  if (g.movedRows.length > 0) {
    // Tabs numbering their groups across wings: a row among another group's rows follows them
    // when the typed "Ppl in Group" counts match the blocks as laid out, else gets no group.
    lines.push(
      `  Rows among another group's rows than their Goshthi Group names (group numbers are unique across wings on the tab; ` +
        `for the organisers to confirm): ${g.movedRows.length}`,
    );
    for (const m of g.movedRows) {
      const counts = m.counts
        .map((c) => `${c.group}: Ppl in Group ${c.stated ?? "not given"}, ${c.inBlock} rows in its block, ${c.labelled} naming it`)
        .join("; ");
      const outcome =
        m.outcome === "block"
          ? `takes ${m.among} (the counts match the rows as laid out)`
          : "no group set (the counts don't tell which is meant)";
      lines.push(
        `    User Id ${m.registrationId} (${m.source} row ${m.row}): Goshthi Group says ${m.labelled}, among ${m.among}'s rows; ${counts} -> ${outcome}`,
      );
    }
  }
  if (g.groupFixes.length > 0) {
    // Tabs numbering their groups across wings: a group is its number, so a row's blank or
    // differing Wing, or a Room unlike the rest of its group's, gives way to the group's.
    lines.push(
      `  Rows given their group's wing / room (group numbers are unique across wings on the tab; ` +
        `for the organisers to confirm): ${g.groupFixes.length}`,
    );
    for (const f of g.groupFixes) {
      const says = [f.wing?.given ? wingLabel(f.wing.given) : null, f.room ? `"${f.room.given}"` : null].filter(Boolean);
      const given = [f.wing && !f.wing.given ? "Wing blank" : null, says.length > 0 ? `row says ${says.join(", ")}` : null];
      const is = [f.wing ? wingLabel(f.wing.used) : null, f.room ? `in "${f.room.used}"` : null].filter(Boolean);
      const number = f.group.replace(/^.*?(Group\b.*)$/, "$1");
      lines.push(
        `    User Id ${f.registrationId} (${f.source} row ${f.row}): ${given.filter(Boolean).join(", ")}; ${number} is ${is.join(", ")}`,
      );
    }
  }
  if (g.roomFilled.length > 0) {
    lines.push(`  Room filled from the rest of the group (blank Room cell; the group's other rows name one room and outnumber the blanks): ${g.roomFilled.length}`);
    for (const f of g.roomFilled) lines.push(`    User Id ${f.registrationId} (${f.source}, ${f.group}) -> "${f.room}"`);
  }
  if (g.blankRoom.length > 0) {
    lines.push(`  Assigned without a room (group set, room left empty): ${g.blankRoom.length}`);
    const byGroup = new Map<string, { ids: string[]; groupRooms: string[] }>();
    for (const b of g.blankRoom) {
      const key = b.group ?? "no group";
      const entry = byGroup.get(key) ?? { ids: [], groupRooms: b.groupRooms };
      entry.ids.push(b.registrationId);
      byGroup.set(key, entry);
    }
    for (const [group, { ids, groupRooms }] of byGroup) {
      const rest =
        groupRooms.length === 0
          ? " (no row of the group names a room)"
          : ` (Room blank on their rows; the rest of the group names ${groupRooms.map((r) => `"${r}"`).join(", ")})`;
      lines.push(`    ${group}: User Id ${idList(ids)}${rest}`);
    }
  }
  if (g.splits.length > 0) {
    lines.push(`  "Split?" filled in (carried as given): ${g.splits.map((s) => `${s.registrationId} "${s.split}"`).join("; ")}`);
  }
  if (g.notImported.length > 0) {
    lines.push(`  Goshthi rows whose User Id is not imported: ${g.notImported.length}`);
    for (const n of g.notImported) lines.push(`    User Id ${n.registrationId} (${n.source}): ${n.why}`);
  }
  if (g.tabMismatch.length > 0) {
    lines.push(`  Listed under another wing than their seva wing (stored with that wing): ${g.tabMismatch.length}`);
    for (const m of g.tabMismatch) lines.push(`    User Id ${m.registrationId}: seva wing ${m.sevaWing}, stored "${m.group}"`);
  }
  if (g.otherSide.length > 0) {
    lines.push(`  Listed on the other side than their track (assigned as listed): ${g.otherSide.length}`);
    for (const o of g.otherSide) lines.push(`    User Id ${o.registrationId}: ${TRACK_LABEL[o.track]}, listed in ${o.source}`);
  }
  if (g.listedTwice.length > 0) {
    lines.push(`  Listed twice in the same group (counted once): User Id ${idList(g.listedTwice.map((x) => x.registrationId))}`);
  }
  if (g.blankGroup.length > 0) {
    lines.push(`  Rows with a User Id but no group (none set): User Id ${idList(g.blankGroup.map((b) => b.registrationId))}`);
  }
  if (g.conflicts.length > 0) {
    lines.push(`  In several groups, on both sides, or among another group's rows with nothing to tell which (none set): ${g.conflicts.length}`);
    for (const x of g.conflicts) lines.push(`    User Id ${x.registrationId}: ${x.sources.join("; ")}`);
  }
  if (g.withoutGroup.length > 0) {
    lines.push(`  Delegates on a covered track whom no group lists (group and room cleared): ${g.withoutGroup.length}`);
    const byId = new Map(delegates.map((d) => [d.registrationId, d]));
    for (const t of ["MALE", "FEMALE"] as const) {
      const list = g.withoutGroup.filter((w) => w.track === t);
      if (list.length === 0) continue;
      lines.push(`    ${TRACK_LABEL[t]}: ${list.length}`);
      const bySeva = new Map<string, string[]>();
      for (const w of list) {
        const status = byId.get(w.registrationId)?.registrationStatus;
        const id = sheetKey(status) === "refunded" ? `${w.registrationId} (Refunded)` : w.registrationId;
        bySeva.set(w.seva, [...(bySeva.get(w.seva) ?? []), id]);
      }
      for (const [seva, ids] of [...bySeva].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) {
        lines.push(`      ${seva} (${ids.length}): User Id ${ids.join(", ")}`);
      }
    }
  }
  return lines;
}

/**
 * The plan as report lines: counts, User Ids and BAPS IDs only (no names,
 * emails or phones), so it is safe to print.
 */
export function planSummary(plan: DelegatePlan): string[] {
  const lines: string[] = [];
  const c = plan.counts;
  const fmt = (rec: Record<string, number>) =>
    Object.entries(rec)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([k, n]) => `${k} ${n}`)
      .join(", ");

  lines.push(
    `Master list "${plan.masterSheet}": ${plan.masterRows} rows, ${plan.emptyRows} empty, ` +
      `${plan.masterRows - plan.emptyRows - plan.rowsWithoutUserId.length} with a User Id (${plan.userIds} distinct)`,
  );
  lines.push(
    `  To import: ${plan.delegates.length} delegates (Bhaio ${c.byTrack.MALE}, Behno ${c.byTrack.FEMALE}), ` +
      `${c.withPhone} with a phone`,
  );
  lines.push(`    Registration status: ${fmt(c.byStatus)}`);
  if (plan.refunded.length > 0) {
    lines.push(`    Imported although Refunded (organisers, 2026-09-27: in case anything changes): ${plan.refunded.length}`);
    lines.push(...idLines(plan.refunded, "      "));
  }
  if (plan.mergedRows.length > 0) {
    lines.push(`    User Id on two rows, imported once from the row with a Seva Wing and Seva: ${plan.mergedRows.length}`);
    for (const m of plan.mergedRows) {
      lines.push(
        `      User Id ${m.registrationId} (rows ${m.rows.join(", ")})` +
          (m.statusesDiffer ? `: statuses differ, stored ${m.status ?? "blank"} (other row ${m.otherStatus ?? "blank"})` : "") +
          (m.phoneFromOtherRow ? `${m.statusesDiffer ? ";" : ":"} phone from the other row` : ""),
      );
    }
  }
  if (plan.bapsIdsGiven.length > 0) {
    lines.push(`    BAPS IDs given with --baps-id: ${plan.bapsIdsGiven.length}`);
    for (const b of plan.bapsIdsGiven) {
      lines.push(
        `      ${b.registrationId} -> ${b.bapsId} (given with --baps-id; sheet had ${b.sheet ?? "blank"}` +
          `${b.sheet === b.bapsId ? ", the same" : ""})${b.imported ? "" : " - NOT IMPORTED, see Skipped"}`,
      );
    }
  }
  lines.push(`    Teams: ${fmt(c.byTeam as Record<string, number>)}`);
  if (c.noTeam.length > 0) {
    const total = c.noTeam.reduce((n, t) => n + t.total, 0);
    lines.push(`    No breakout team (seva kept as given, no sessions until the organisers place them): ${total}`);
    for (const t of c.noTeam) lines.push(`      ${t.seva}: ${t.total} (${fmt(t.byWing as Record<string, number>)})`);
  }
  if (plan.nonStandardBapsIds.length > 0) {
    lines.push(
      `    Non-standard BAPS IDs, imported as given: ` +
        plan.nonStandardBapsIds.map((b) => `${b.bapsId} (User Id ${b.registrationId})`).join(", "),
    );
  }
  if (plan.unusablePhones.length > 0) {
    lines.push(`    Phone cell not a usable number (no phone written): User Id ${idList(plan.unusablePhones)}`);
  }

  if (plan.skipped.length > 0 || plan.rowsWithoutUserId.length > 0) {
    lines.push(`  Skipped: ${plan.skipped.length} User Ids`);
    for (const reason of Object.keys(SKIP_LABELS) as SkipReason[]) {
      const list = plan.skipped.filter((s) => s.reason === reason);
      if (list.length === 0) continue;
      lines.push(`    ${SKIP_LABELS[reason]}: ${list.length}`);
      for (const s of list) {
        lines.push(`      User Id ${s.registrationId} (row ${s.rows.join(", ")})${s.detail ? `: ${s.detail}` : ""}`);
      }
    }
    if (plan.rowsWithoutUserId.length > 0) {
      lines.push(`    Rows with data but no User Id: rows ${idList(plan.rowsWithoutUserId.map(String))}`);
    }
  } else {
    lines.push("  Skipped: none");
  }

  lines.push(
    `Emails: all ${plan.delegates.length} delegates get <BAPS ID>@${DELEGATE_EMAIL_DOMAIN} (the organisers' email list is ` +
      `no longer used); --dry-run counts the stored addresses that change, by their current domain`,
  );

  if (!plan.goshthi) lines.push("Goshthi groups: no workbook given, goshthi group / room / moderator are left as they are");
  else lines.push(...goshthiSummary(plan.goshthi, plan.delegates));

  lines.push(plan.errors.length > 0 ? `Errors (nothing can be written): ${plan.errors.length}` : "Checks: no errors");
  for (const e of plan.errors) lines.push(`  ${e}`);
  return lines;
}

// ---------------------------------------------------------------------------
// Reconciling with the database

type Role = "DELEGATE" | "SANT" | "ADMIN";

/** The users columns the import writes. */
export type DelegateFields = {
  registrationId: string;
  bapsId: string;
  name: string;
  email: string;
  /** Only when the sheet has a usable number: a missing one never clears a phone on file. */
  phone?: string;
  gender: Track;
  seva: string;
  region: string | null;
  center: string | null;
  personalWing: string | null;
  sevaWing: string;
  sevaRole: string;
  registrationStatus: string | null;
  preferredChannel: "EMAIL";
  /** The three goshthi columns: only when a goshthi workbook owns the person. */
  goshthiGroup?: string | null;
  goshthiRoom?: string | null;
  goshthiModerator?: boolean;
};

/** A users row as the import reads it. */
export type ExistingUser = {
  id: string;
  role: Role;
  registrationId: string | null;
  bapsId: string;
  name: string;
  email: string | null;
  phone: string | null;
  gender: Track | null;
  seva: string;
  region: string | null;
  center: string | null;
  personalWing: string | null;
  sevaWing: string | null;
  sevaRole: string | null;
  registrationStatus: string | null;
  preferredChannel: "EMAIL" | "SMS";
  goshthiGroup: string | null;
  goshthiRoom: string | null;
  goshthiModerator: boolean;
  breakoutSessions: string[];
};

/** Report labels; personal values (name, email, phone) are never printed. */
const FIELD_LABELS: Record<keyof DelegateFields, string> = {
  registrationId: "User Id",
  bapsId: "BAPS ID",
  name: "name",
  email: "email",
  phone: "phone",
  gender: "gender",
  seva: "seva",
  region: "region",
  center: "center",
  personalWing: "personal wing",
  sevaWing: "seva wing",
  sevaRole: "seva role",
  registrationStatus: "status",
  preferredChannel: "channel",
  goshthiGroup: "goshthi group",
  goshthiRoom: "goshthi room",
  goshthiModerator: "goshthi moderator",
};
const PRIVATE_FIELDS: ReadonlySet<keyof DelegateFields> = new Set(["name", "email", "phone"]);

/** Fields the import writes for a planned delegate. */
export function delegateFields(d: PlannedDelegate): DelegateFields {
  return {
    registrationId: d.registrationId,
    bapsId: d.bapsId,
    name: d.name,
    email: d.email,
    ...(d.phone ? { phone: d.phone } : {}),
    gender: d.gender,
    seva: d.seva,
    region: d.region,
    center: d.center,
    personalWing: d.personalWing,
    sevaWing: d.sevaWing,
    sevaRole: d.sevaRole,
    registrationStatus: d.registrationStatus,
    preferredChannel: "EMAIL",
    ...(d.goshthiOwned
      ? { goshthiGroup: d.goshthiGroup, goshthiRoom: d.goshthiRoom, goshthiModerator: d.goshthiModerator }
      : {}),
  };
}

/** Groups for counting changed addresses by their current domain (never the address itself). */
export const EMAIL_CHANGE_GROUPS = ["na.baps.id", "na.baps.org", "edu.na.baps.org", "other domains", "none on file"] as const;
export type EmailChangeGroup = (typeof EMAIL_CHANGE_GROUPS)[number];

function emailChangeGroup(email: string | null): EmailChangeGroup {
  if (!email?.trim()) return "none on file";
  const domain = emailDomain(email);
  return (EMAIL_CHANGE_GROUPS as readonly string[]).includes(domain) ? (domain as EmailChangeGroup) : "other domains";
}

export type Reconciliation = {
  creates: { delegate: PlannedDelegate; data: DelegateFields }[];
  updates: { id: string; delegate: PlannedDelegate; data: Partial<DelegateFields>; changes: string[] }[];
  unchanged: number;
  /** Planned people whose account is SANT or ADMIN: never touched. */
  protectedAccounts: string[];
  /** Planned people whose User Id and BAPS ID point at different accounts. */
  conflicts: string[];
  /** Accounts imported before (User Id set) that this plan no longer imports: left as they are. */
  noLongerImported: string[];
  /** Other accounts not in the plan (testers, admins, santos, mock data), left as they are. */
  others: { role: Role; bapsIds: string[] }[];
  /** Matched accounts with breakout_sessions linked by hand: kept, they override the team matching. */
  linkedBreakouts: string[];
  /** Updated delegates whose stored email changes to <BAPS ID>@na.baps.id, by the current address's domain. */
  emailChanges: Record<EmailChangeGroup, number>;
  /** Updated delegates whose BAPS ID changes (--baps-id corrections): "User Id OLD -> NEW". */
  bapsIdChanges: string[];
  /** A --baps-id value that the database can't take (another account has it): --apply refuses. */
  errors: string[];
};

const show = (v: unknown) => (v === null || v === undefined || v === "" ? "none" : `"${String(v)}"`);

/**
 * What applying the plan to these users rows would do. Rows are matched by
 * registration_id, else by BAPS ID (the User Id is then set). SANT and ADMIN
 * rows are never changed, and a new row is the only place role DELEGATE is
 * set. Columns the import doesn't own (test_code, breakout_sessions,
 * display_name, notifications_seen_at, last_sign_in_at, sant_accommodation_id)
 * are never written, and phone only when the sheet has one.
 *
 * baps_id is unique. A row's BAPS ID only changes to one no other row holds:
 * a planned BAPS ID held by another account is a conflict (an error for a
 * --baps-id value), so no update or create can collide, whatever the order.
 */
export function reconcile(plan: DelegatePlan, existing: readonly ExistingUser[]): Reconciliation {
  const result: Reconciliation = {
    creates: [],
    updates: [],
    unchanged: 0,
    protectedAccounts: [],
    conflicts: [],
    noLongerImported: [],
    others: [],
    linkedBreakouts: [],
    emailChanges: Object.fromEntries(EMAIL_CHANGE_GROUPS.map((g) => [g, 0])) as Record<EmailChangeGroup, number>,
    bapsIdChanges: [],
    errors: [],
  };
  const byReg = new Map(existing.filter((u) => u.registrationId).map((u) => [u.registrationId!, u]));
  const byBaps = new Map(existing.map((u) => [u.bapsId, u]));
  const claimed = new Set<string>();

  for (const d of plan.delegates) {
    const who = `${d.registrationId} ${d.bapsId}`;
    // A conflict for a BAPS ID the organisers gave by hand is an error: --apply refuses.
    const conflict = (why: string) =>
      d.bapsIdGiven ? result.errors.push(`--baps-id ${d.registrationId}=${d.bapsId}: ${why}`) : result.conflicts.push(`${who}: ${why}`);
    const want = delegateFields(d);
    const regRow = byReg.get(d.registrationId);
    const bapsRow = byBaps.get(d.bapsId);
    if (regRow && bapsRow && regRow.id !== bapsRow.id) {
      conflict(`User Id is on account ${regRow.bapsId}, but BAPS ID ${d.bapsId} is another account (${bapsRow.role}${bapsRow.registrationId ? `, User Id ${bapsRow.registrationId}` : ""})`);
      continue;
    }
    const db = regRow ?? bapsRow;
    if (!db) {
      result.creates.push({ delegate: d, data: want });
      continue;
    }
    if (!regRow && db.registrationId && db.registrationId !== d.registrationId) {
      conflict(`account ${db.bapsId} is already linked to User Id ${db.registrationId}`);
      continue;
    }
    if (claimed.has(db.id)) {
      conflict(`account ${db.bapsId} already matched another delegate`);
      continue;
    }
    claimed.add(db.id);
    if (db.role !== "DELEGATE") {
      result.protectedAccounts.push(`${who}: ${db.role} account ${db.bapsId} (left unchanged)`);
      continue;
    }
    if (db.breakoutSessions.length > 0) {
      result.linkedBreakouts.push(`${who} (${db.breakoutSessions.length} sessions)`);
    }
    const changed = (Object.keys(want) as (keyof DelegateFields)[]).filter((k) => db[k] !== want[k]);
    if (changed.length === 0) {
      result.unchanged++;
      continue;
    }
    if (changed.includes("email")) result.emailChanges[emailChangeGroup(db.email)]++;
    if (changed.includes("bapsId")) result.bapsIdChanges.push(`User Id ${d.registrationId} ${db.bapsId} -> ${d.bapsId}`);
    result.updates.push({
      id: db.id,
      delegate: d,
      data: Object.fromEntries(changed.map((k) => [k, want[k]])) as Partial<DelegateFields>,
      changes: changed.map((k) =>
        PRIVATE_FIELDS.has(k) ? FIELD_LABELS[k] : `${FIELD_LABELS[k]} ${show(db[k])} -> ${show(want[k])}`,
      ),
    });
  }

  const planned = new Set(plan.delegates.map((d) => d.registrationId));
  const skipById = new Map(plan.skipped.map((s) => [s.registrationId, s]));
  const others = new Map<Role, string[]>();
  for (const u of existing) {
    if (claimed.has(u.id)) continue;
    if (u.registrationId && !planned.has(u.registrationId)) {
      const skip = skipById.get(u.registrationId);
      result.noLongerImported.push(
        `${u.registrationId} ${u.bapsId} (${u.role}, status ${show(u.registrationStatus)}): ` +
          (skip ? SKIP_LABELS[skip.reason] : "no longer in the master list"),
      );
      continue;
    }
    // Planned but unmatched rows are conflicts (reported above); the rest are other accounts.
    if (u.registrationId && planned.has(u.registrationId)) continue;
    others.set(u.role, [...(others.get(u.role) ?? []), u.bapsId]);
  }
  for (const role of ["ADMIN", "SANT", "DELEGATE"] as const) {
    const ids = others.get(role);
    if (ids) result.others.push({ role, bapsIds: ids.sort() });
  }
  return result;
}
