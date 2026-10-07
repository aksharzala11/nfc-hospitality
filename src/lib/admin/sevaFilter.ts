/**
 * The admin console's seva filter: which sevas every console page narrows to,
 * kept in the URL as repeated `seva` params (the delegate directory's format),
 * e.g. /admin?seva=BM%20RA&seva=SA. No `seva` param = no filter.
 *
 * Options fold the many spellings of a team in `users.seva` ("eBM RA",
 * "BM RA", "Satsang Admins"...) into the canonical team code of the breakout
 * matrix (src/lib/teams.ts), so the picker lists each team once. A filter
 * value is always an option value: a team code, an umbrella name such as
 * "BKY RA" (several teams), or a plain seva ("Hospitality", "Pujya Santo").
 * A seva's option value is also its label (sevaLabel() spelling).
 *
 * Pure and isomorphic: no database access, safe in client components. The
 * server half (the option list with counts) is src/lib/admin/sevaFilterData.ts.
 */
import { TEAM_ALIASES, TEAM_CODES, isTeamCode, sevaLabel, teamCodesFor, type TeamCode } from "@/lib/teams";

/** The query parameter, repeated once per seva. */
export const SEVA_PARAM = "seva";

/** At most this many sevas are read from a URL, each at most this long (users.seva allows 60). */
const MAX_VALUES = 25;
const MAX_LENGTH = 80;

/** How many sevas one filter can hold (the picker stops offering more). */
export const MAX_SEVA_FILTER = MAX_VALUES;

type ParamRecord = Record<string, string | string[] | undefined>;

/** Trimmed, blanks dropped, each capped at MAX_LENGTH, de-duplicated, at most MAX_VALUES. */
function normalize(values: Iterable<string>): string[] {
  const out: string[] = [];
  for (const value of values) {
    const v = String(value).trim().slice(0, MAX_LENGTH).trim();
    if (!v || out.includes(v)) continue;
    out.push(v);
    if (out.length === MAX_VALUES) break;
  }
  return out;
}

/**
 * The sevas picked in a query: a page's awaited `searchParams`, or
 * URLSearchParams (useSearchParams() on the client). Values come back as
 * written (trimmed, de-duplicated, blanks dropped, capped), not folded into
 * option values: expandSevaSelection() and sevaOptionValue() do that.
 */
export function readSevaFilter(sp: ParamRecord | URLSearchParams): string[] {
  if (typeof (sp as URLSearchParams).getAll === "function") return normalize((sp as URLSearchParams).getAll(SEVA_PARAM));
  const raw = (sp as ParamRecord)[SEVA_PARAM];
  return normalize(raw === undefined ? [] : Array.isArray(raw) ? raw : [raw]);
}

/** A query segment's decoded parameter name ("seva=BM%20RA" -> "seva"). */
function paramName(segment: string): string {
  const eq = segment.indexOf("=");
  const key = (eq === -1 ? segment : segment.slice(0, eq)).replace(/\+/g, " ");
  try {
    return decodeURIComponent(key);
  } catch {
    return key;
  }
}

/**
 * `href` with its `seva` params replaced by `sevas` (none = the filter
 * cleared). Every other param (?now=, the directory's ?q=...) keeps its place
 * and spelling, and a #hash stays at the end:
 *   withSevaFilter("/admin/schedule?now=2026-10-09T13:45#day-2", ["BM RA", "SA"])
 *     -> "/admin/schedule?now=2026-10-09T13:45&seva=BM%20RA&seva=SA#day-2"
 */
export function withSevaFilter(href: string, sevas: readonly string[]): string {
  const hashAt = href.indexOf("#");
  const hash = hashAt === -1 ? "" : href.slice(hashAt);
  const beforeHash = hashAt === -1 ? href : href.slice(0, hashAt);
  const queryAt = beforeHash.indexOf("?");
  const path = queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt);
  const query = queryAt === -1 ? "" : beforeHash.slice(queryAt + 1);

  const kept = query.split("&").filter((segment) => segment !== "" && paramName(segment) !== SEVA_PARAM);
  const added = normalize(sevas).map((s) => `${SEVA_PARAM}=${encodeURIComponent(s)}`);
  const all = [...kept, ...added];
  return `${path}${all.length > 0 ? `?${all.join("&")}` : ""}${hash}`;
}

/**
 * How every console view names an active filter in its copy, from the picked
 * option values (sevaOptionValue()): up to three by name, then the first two
 * and how many more.
 *   ["BM RA"]                      -> "BM RA"
 *   ["BM RA", "SA", "KM RA"]       -> "BM RA, SA, KM RA"
 *   ["BM RA", "SA", "KM RA", "CE"] -> "BM RA, SA +2 more"
 */
export function sevaFilterLabel(labels: readonly string[]): string {
  return labels.length <= 3 ? labels.join(", ") : `${labels.slice(0, 2).join(", ")} +${labels.length - 2} more`;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/**
 * One choice in the seva picker. `value` is what goes in the URL and equals
 * `label`; `count` is how many accounts (any role) have a seva that folds into
 * it; `isTeam` marks the breakout matrix's team codes (listed even when
 * nobody has them yet).
 */
export type SevaOption = { value: string; label: string; count: number; isTeam: boolean };

/** The breakout-matrix codes a name stands for (teamCodesFor() without the name itself). */
function teamSet(value: string): TeamCode[] {
  return teamCodesFor(value).filter(isTeamCode);
}

const setKey = (codes: readonly string[]) => [...codes].sort().join("\n");

/**
 * Each team code by the set of codes its own name stands for. Usually just
 * itself, but "BM PC" also means the Bhaio matrix's "BK RPCs & RGCs" (see
 * TEAM_ALIASES), so "BM RPC" (the same pair) folds into BM PC.
 */
const CODE_BY_SET: ReadonlyMap<string, TeamCode> = new Map(TEAM_CODES.map((code) => [setKey(teamSet(code)), code]));

/**
 * Umbrella names (several teams, e.g. "BKY RA", "BKSTL") by the set of codes
 * they stand for: the first TEAM_ALIASES name for each set, so "bky ra" joins
 * "BKY RA" and "RPC" joins "BK RPC" (the same three teams).
 */
const UMBRELLA_BY_SET: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const name of Object.keys(TEAM_ALIASES)) {
    const codes = teamSet(name);
    const key = setKey(codes);
    if (codes.length > 1 && !CODE_BY_SET.has(key) && !map.has(key)) map.set(key, name);
  }
  return map;
})();

/** The team code a seva spelling folds into, or null (an umbrella name or not a matrix team). */
function foldedTeam(raw: string): TeamCode | null {
  const codes = teamSet(raw);
  if (codes.length === 0) return null;
  if (codes.length === 1) return codes[0];
  return CODE_BY_SET.get(setKey(codes)) ?? null;
}

/**
 * The picker option a users.seva value (or a value from a URL) belongs to:
 *   "eBM RA", "BM RA", "bm ra"  -> "BM RA"   (team code)
 *   "Satsang Admins"            -> "SA"
 *   "BM RPC"                    -> "BM PC"   (same teams as BM PC)
 *   "bky ra", "eBKY RA"         -> "BKY RA"  (umbrella: BM, KM and YM RA)
 *   " Hospitality "             -> "Hospitality"
 * Blank -> "". Spellings that mean the same breakout teams share an option,
 * which is why a filter on it shows the same breakouts to all of them.
 */
export function sevaOptionValue(raw: string | null | undefined): string {
  const key = raw ?? "";
  let value = optionMemo.get(key);
  if (value === undefined) {
    value = computeOptionValue(key);
    // A few dozen distinct sevas in practice; the cap only guards against unbounded input.
    if (optionMemo.size >= 1000) optionMemo.clear();
    optionMemo.set(key, value);
  }
  return value;
}

/** sevaOptionValue() is called per person per filter pass in the directory (~800 people). */
const optionMemo = new Map<string, string>();

function computeOptionValue(raw: string): string {
  const label = sevaLabel(raw);
  if (!label) return "";
  const team = foldedTeam(label);
  if (team) return team;
  const codes = teamSet(label);
  if (codes.length > 1) return UMBRELLA_BY_SET.get(setKey(codes)) ?? label;
  return label;
}

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

/**
 * Picker options from the distinct users.seva values with their counts: one
 * option per folded seva (see sevaOptionValue(); spellings of one team add up
 * under its code) plus every team code of the breakout matrix (count 0 if
 * nobody has it yet), sorted by label. Blank sevas are left out.
 */
export function buildSevaOptions(userSevas: { seva: string; count: number }[]): SevaOption[] {
  const byValue = new Map<string, SevaOption>();
  for (const code of TEAM_CODES) byValue.set(code, { value: code, label: code, count: 0, isTeam: true });
  for (const { seva, count } of userSevas) {
    const value = sevaOptionValue(seva);
    if (!value) continue;
    const option = byValue.get(value);
    if (option) option.count += count;
    else byValue.set(value, { value, label: value, count, isTeam: false });
  }
  return [...byValue.values()].sort(
    (a, b) => collator.compare(a.label, b.label) || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0),
  );
}

/**
 * What a selection covers, for Prisma `in` filters:
 *  - `userSevas`: the users.seva values (exactly as stored, from `userSevas`)
 *    that fold into a picked option, plus the picked values themselves, for
 *    `users.seva in [...]`. The same people the picker's counts add up.
 *  - `teamCodes`: every breakouts.seva value those people match by seva
 *    (teamCodesFor() of each picked option and each covered spelling, as
 *    getBreakoutsForUser() does): canonical team codes, plus plain sevas for
 *    rows that aren't matrix teams (mock data, the Santo sample breakouts).
 * An empty selection gives two empty lists: callers treat that as "no filter"
 * rather than as `in []`.
 *
 *   expandSevaSelection(["BM RA"], ["eBM RA", "BM RA", "SA"])
 *     -> { userSevas: ["BM RA", "eBM RA"], teamCodes: ["BM RA", "eBM RA"] }
 */
export function expandSevaSelection(
  selected: readonly string[],
  userSevas: readonly string[],
): { userSevas: string[]; teamCodes: string[] } {
  const picked = normalize(selected);
  const targets = new Set(picked.map(sevaOptionValue).filter(Boolean));
  if (targets.size === 0) return { userSevas: [], teamCodes: [] };

  const users = new Set<string>(picked);
  for (const seva of userSevas) if (targets.has(sevaOptionValue(seva))) users.add(seva);

  const codes = new Set<string>();
  for (const value of [...targets, ...users]) for (const code of teamCodesFor(value)) codes.add(code);
  return { userSevas: [...users], teamCodes: [...codes] };
}
