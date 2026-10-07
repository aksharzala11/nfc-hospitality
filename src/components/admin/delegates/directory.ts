/**
 * Logic behind the admin delegate directory (/admin/delegates): search,
 * filters with facet counts, sorting, the URL query format and display
 * helpers. Pure and client-safe (only type imports from the server lib), so
 * the whole directory runs in memory in the browser (~800 people).
 */
import type { Gender, OtpChannel, UserRole } from "@prisma/client";
import type { DirectoryPerson } from "@/lib/admin/delegates";
import { readSevaFilter, sevaOptionValue } from "@/lib/admin/sevaFilter";
import { defaultDelegateEmail } from "@/lib/delegateEmail";
import { genderForSevaWing } from "@/lib/sevaMapping";
import { isTeamCode, teamCodesFor } from "@/lib/teams";
import { dayKey, formatDayShort, formatTime } from "@/lib/time";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export const ROLE_ORDER: readonly UserRole[] = ["DELEGATE", "SANT", "ADMIN"];
export const ROLE_LABEL: Record<UserRole, string> = { DELEGATE: "Delegate", SANT: "Sant", ADMIN: "Admin" };

/** Gender filter values; NONE = no gender on file. */
export type GenderFilter = Gender | "NONE";
export const GENDER_ORDER: readonly GenderFilter[] = ["MALE", "FEMALE", "NONE"];
export const GENDER_LABEL: Record<GenderFilter, string> = {
  MALE: "Male · Bhaio",
  FEMALE: "Female · Behno",
  NONE: "Not set",
};

export type SignInFilter = "yes" | "never";
export const SIGN_IN_ORDER: readonly SignInFilter[] = ["yes", "never"];
export const SIGN_IN_LABEL: Record<SignInFilter, string> = { yes: "Signed in", never: "Never signed in" };

export const CHANNEL_ORDER: readonly OtpChannel[] = ["EMAIL", "SMS"];
export const CHANNEL_LABEL: Record<OtpChannel, string> = { EMAIL: "Email", SMS: "SMS" };

/** Region filter value for people with no region on file. */
export const NO_REGION = "";

/** Registration status filter value for people with none (not from the master list). */
export const NO_STATUS = "";

export const PAGE_SIZE = 50;

/** Accounts that sign in with a fixed tester code (admins never do; see requestOtp). */
export function isTester(p: Pick<DirectoryPerson, "hasTestCode" | "role">): boolean {
  return p.hasTestCode && p.role !== "ADMIN";
}

/**
 * What users.mirror_registration_id names for an account of this role: a sant tester holds the
 * mirrored sant's BAPS ID there (santos have no User Id), everyone else a User Id.
 */
export function mirrorIdLabel(role: UserRole): "BAPS ID" | "User Id" {
  return role === "SANT" ? "BAPS ID" : "User Id";
}

/**
 * A mirror test account's mirror, as requireGuest() (src/lib/auth.ts) decides it: in effect
 * only for a DELEGATE with a tester code whose mirrored registration ID belongs to a
 * DELEGATE, or a SANT with a tester code whose mirrored value is the BAPS ID of another SANT
 * (case-insensitive; user, 2026-10-02), on a server that allows mirroring (`enabled`:
 * mirrorTestersEnabled(), the ALLOW_MIRROR_TESTERS env); never for an admin. `idLabel` says
 * which the value is ("User Id" / "BAPS ID"), `reason` why it is not in effect, for the detail
 * sheet. Null for accounts that mirror no one.
 */
export type MirrorStatus = {
  registrationId: string;
  idLabel: "BAPS ID" | "User Id";
  target: DirectoryPerson | null;
  active: boolean;
  reason: string | null;
};

export function mirrorStatus(
  p: Pick<DirectoryPerson, "id" | "mirrorRegistrationId" | "hasTestCode" | "role">,
  findByRegistrationId: (id: string) => DirectoryPerson | undefined,
  enabled: boolean,
  findByBapsId: (bapsId: string) => DirectoryPerson | undefined = () => undefined,
): MirrorStatus | null {
  const registrationId = p.mirrorRegistrationId;
  if (!registrationId) return null;
  const idLabel = mirrorIdLabel(p.role);
  const sant = p.role === "SANT";
  const found = sant
    ? (findByBapsId(registrationId) ?? findByBapsId(registrationId.toUpperCase()))
    : findByRegistrationId(registrationId);
  // A sant tester never mirrors himself (requireGuest() skips his own row).
  const target = found && !(sant && found.id === p.id) ? found : null;
  const wanted = sant ? "SANT" : "DELEGATE";
  let reason: string | null = null;
  if (!p.hasTestCode) reason = "Not in effect: this account has no tester code.";
  else if (p.role === "ADMIN") reason = "Not in effect: admin accounts never mirror.";
  else if (!target) reason = `Not in effect: no one ${sant ? "else " : ""}here has ${idLabel} ${registrationId}.`;
  else if (target.role !== wanted) {
    reason = `Not in effect: ${idLabel} ${registrationId} is not a ${sant ? "sant" : "delegate"} (${ROLE_LABEL[target.role]}).`;
  } else if (!enabled) {
    reason = "Not in effect: mirroring is switched off on this server (ALLOW_MIRROR_TESTERS), so this account sees only its own details.";
  }
  return { registrationId, idLabel, target, active: reason === null, reason };
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export type Filters = {
  /** Free-text search (see parseQuery). */
  q: string;
  roles: UserRole[];
  /**
   * Seva picker options (sevaOptionValue(): spellings of one team fold into its code,
   * "eBM RA" -> "BM RA"), the same values as the console-wide seva filter.
   */
  sevas: string[];
  /** NO_REGION ("") selects people without a region. */
  regions: string[];
  /** Master-list registration statuses as stored; NO_STATUS ("") selects people without one. */
  statuses: string[];
  genders: GenderFilter[];
  signedIn: SignInFilter | null;
  channel: OtpChannel | null;
};

export const EMPTY_FILTERS: Filters = {
  q: "",
  roles: [],
  sevas: [],
  regions: [],
  statuses: [],
  genders: [],
  signedIn: null,
  channel: null,
};

/** Every filter off, keeping the search. */
export function clearFilters(f: Filters): Filters {
  return { ...EMPTY_FILTERS, q: f.q };
}

/** The filterable dimensions. Values within one are OR-ed; dimensions are AND-ed. */
export type Dimension = "role" | "seva" | "region" | "status" | "gender" | "signedIn" | "channel";
export const DIMENSIONS: readonly Dimension[] = ["role", "seva", "region", "status", "gender", "signedIn", "channel"];

/** A person's value on one dimension, as filters store it. */
export function valueOf(p: DirectoryPerson, d: Dimension): string {
  switch (d) {
    case "role":
      return p.role;
    case "seva":
      return sevaOptionValue(p.seva);
    case "region":
      return p.region ?? NO_REGION;
    case "status":
      return p.registrationStatus ?? NO_STATUS;
    case "gender":
      return p.gender ?? "NONE";
    case "signedIn":
      return p.lastSignInAt ? "yes" : "never";
    case "channel":
      return p.preferredChannel;
  }
}

/** Values selected on one dimension ([] = no restriction). */
export function selectedValues(f: Filters, d: Dimension): readonly string[] {
  switch (d) {
    case "role":
      return f.roles;
    case "seva":
      return f.sevas;
    case "region":
      return f.regions;
    case "status":
      return f.statuses;
    case "gender":
      return f.genders;
    case "signedIn":
      return f.signedIn ? [f.signedIn] : [];
    case "channel":
      return f.channel ? [f.channel] : [];
  }
}

/** Selects or deselects one value. Sign-in and channel hold a single value, so picking one replaces the other. */
export function toggleValue(f: Filters, d: Dimension, value: string): Filters {
  const flip = <T extends string>(list: readonly T[]): T[] =>
    list.includes(value as T) ? list.filter((v) => v !== value) : [...list, value as T];
  switch (d) {
    case "role": {
      const roles = flip(f.roles);
      return { ...f, roles: ROLE_ORDER.filter((r) => roles.includes(r)) };
    }
    case "seva":
      return { ...f, sevas: flip(f.sevas) };
    case "region":
      return { ...f, regions: flip(f.regions) };
    case "status":
      return { ...f, statuses: flip(f.statuses) };
    case "gender": {
      const genders = flip(f.genders);
      return { ...f, genders: GENDER_ORDER.filter((g) => genders.includes(g)) };
    }
    case "signedIn":
      return { ...f, signedIn: f.signedIn === value ? null : (value as SignInFilter) };
    case "channel":
      return { ...f, channel: f.channel === value ? null : (value as OtpChannel) };
  }
}

/** Clears one dimension. */
export function clearDimension(f: Filters, d: Dimension): Filters {
  switch (d) {
    case "role":
      return { ...f, roles: [] };
    case "seva":
      return { ...f, sevas: [] };
    case "region":
      return { ...f, regions: [] };
    case "status":
      return { ...f, statuses: [] };
    case "gender":
      return { ...f, genders: [] };
    case "signedIn":
      return { ...f, signedIn: null };
    case "channel":
      return { ...f, channel: null };
  }
}

/** How many filter values are selected (search not included). */
export function activeFilterCount(f: Filters): number {
  return DIMENSIONS.reduce((n, d) => n + selectedValues(f, d).length, 0);
}

/** True when a search or any filter narrows the list. */
export function isNarrowed(f: Filters): boolean {
  return f.q.trim() !== "" || activeFilterCount(f) > 0;
}

/** Label for one selected value, e.g. "Never signed in", "No region", "Hospitality", "Registered". */
export function valueLabel(d: Dimension, value: string): string {
  switch (d) {
    case "role":
      return ROLE_LABEL[value as UserRole] ?? value;
    case "gender":
      return GENDER_LABEL[value as GenderFilter] ?? value;
    case "signedIn":
      return SIGN_IN_LABEL[value as SignInFilter] ?? value;
    case "channel":
      return `Codes by ${CHANNEL_LABEL[value as OtpChannel] ?? value}`;
    case "region":
      return value === NO_REGION ? "No region" : value;
    case "status":
      return value === NO_STATUS ? "No registration status" : value;
    case "seva":
      return value;
  }
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/** Lower-case with accents removed, so "swaminarayan" finds "Swāminārāyan". */
export function fold(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** A person with their search text precomputed. */
export type Entry = {
  person: DirectoryPerson;
  /** Folded name, display name, BAPS ID, registration ID, email, phone, seva (and raw seva role), region and center. */
  text: string;
  /** Phone digits, e.g. "18484829439". */
  digits: string;
};

export function indexPeople(people: readonly DirectoryPerson[]): Entry[] {
  return people.map((person) => ({
    person,
    text: fold(
      [
        person.name,
        person.displayName,
        person.bapsId,
        person.registrationId,
        person.email,
        person.phone,
        person.phone ? formatPhone(person.phone) : null,
        person.seva,
        person.sevaRole,
        person.region,
        person.center,
      ]
        .filter((v): v is string => Boolean(v))
        .join("\n"),
    ),
    digits: person.phone ? person.phone.replace(/\D/g, "") : "",
  }));
}

type QueryToken = { text: string; digits: string | null };
export type Query = { tokens: QueryToken[]; digits: string | null } | null;

/** Only digits and phone punctuation, e.g. "(848) 482-9439", "848.482", "+1 848". */
const PHONE_LIKE = /^[\d\s().+-]+$/;

function phoneDigits(s: string): string | null {
  const digits = s.replace(/\D/g, "");
  return PHONE_LIKE.test(s) && digits.length >= 3 ? digits : null;
}

/**
 * Every word must appear somewhere (name, BAPS ID, registration ID, email,
 * seva, center...), in any order. Number-only words (3+ digits) also match inside phone numbers
 * whatever the punctuation, and so does a query that is one whole number.
 */
export function parseQuery(q: string): Query {
  const folded = fold(q).trim();
  if (!folded) return null;
  return {
    tokens: folded.split(/\s+/).map((text) => ({ text, digits: phoneDigits(text) })),
    digits: phoneDigits(folded),
  };
}

export function matchesQuery(e: Entry, query: Query): boolean {
  if (!query) return true;
  if (query.digits && e.digits.includes(query.digits)) return true;
  return query.tokens.every((t) => e.text.includes(t.text) || (t.digits !== null && e.digits.includes(t.digits)));
}

function passesFilters(p: DirectoryPerson, f: Filters, except: Dimension | null): boolean {
  for (const d of DIMENSIONS) {
    if (d === except) continue;
    const selected = selectedValues(f, d);
    if (selected.length > 0 && !selected.includes(valueOf(p, d))) return false;
  }
  return true;
}

/** A one-word search, lower-cased, that may be someone's exact registration ID or BAPS ID. */
function exactIdQuery(q: string): string | null {
  const v = q.trim().toLowerCase();
  return v && !/\s/.test(v) ? v : null;
}

function isExactId(p: DirectoryPerson, id: string): boolean {
  return p.registrationId?.toLowerCase() === id || p.bapsId.toLowerCase() === id;
}

/**
 * Entries matching the search and every filter, in their current order, except
 * that an exact registration ID or BAPS ID match comes first: a number like
 * "12345" also matches inside other people's phones and IDs.
 */
export function filterEntries(entries: readonly Entry[], f: Filters): Entry[] {
  const query = parseQuery(f.q);
  const out = entries.filter((e) => matchesQuery(e, query) && passesFilters(e.person, f, null));
  const id = exactIdQuery(f.q);
  if (!id || out.length < 2) return out;
  const exact = out.filter((e) => isExactId(e.person, id));
  if (exact.length === 0 || exact.length === out.length) return out;
  return [...exact, ...out.filter((e) => !isExactId(e.person, id))];
}

/** Whether the search is (partly) looking for this person's registration ID, so the list shows it. */
export function searchHitsRegistrationId(p: Pick<DirectoryPerson, "registrationId">, q: string): boolean {
  const id = p.registrationId?.toLowerCase();
  if (!id) return false;
  return fold(q)
    .trim()
    .split(/\s+/)
    .some((t) => t !== "" && id.includes(t));
}

/** Whether one person shows under these filters (e.g. someone just saved). */
export function personMatches(person: DirectoryPerson, f: Filters): boolean {
  return filterEntries(indexPeople([person]), f).length === 1;
}

/**
 * How many people each value of dimension `d` would show, given the search
 * and the other dimensions' filters (the dimension's own selection is
 * ignored, so the counts answer "what if I pick this?").
 */
export function facetCounts(entries: readonly Entry[], f: Filters, d: Dimension): Map<string, number> {
  const query = parseQuery(f.q);
  const counts = new Map<string, number>();
  for (const e of entries) {
    if (!matchesQuery(e, query) || !passesFilters(e.person, f, d)) continue;
    const v = valueOf(e.person, d);
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

export type SortKey = "name" | "bapsId" | "seva" | "region" | "added" | "signin";
export type SortDir = "asc" | "desc";
export type Sort = { key: SortKey; dir: SortDir };

/** Direction a column sorts in when first picked: text A–Z, dates newest first. */
export const FIRST_DIR: Record<SortKey, SortDir> = {
  name: "asc",
  bapsId: "asc",
  seva: "asc",
  region: "asc",
  added: "desc",
  signin: "desc",
};

export const DEFAULT_SORT: Sort = { key: "name", dir: "asc" };

/** The sort menu. Column headers can also reverse any of these. */
export const SORT_OPTIONS: readonly { sort: Sort; label: string }[] = [
  { sort: { key: "name", dir: "asc" }, label: "Name A–Z" },
  { sort: { key: "name", dir: "desc" }, label: "Name Z–A" },
  { sort: { key: "bapsId", dir: "asc" }, label: "BAPS ID" },
  { sort: { key: "seva", dir: "asc" }, label: "Seva" },
  { sort: { key: "region", dir: "asc" }, label: "Region" },
  { sort: { key: "added", dir: "desc" }, label: "Newest added" },
  { sort: { key: "signin", dir: "desc" }, label: "Last signed in" },
];

const REVERSED_LABEL: Record<SortKey, string> = {
  name: "Name Z–A",
  bapsId: "BAPS ID (Z–A)",
  seva: "Seva (Z–A)",
  region: "Region (Z–A)",
  added: "Oldest added",
  signin: "Earliest sign-in",
};

export function sameSort(a: Sort, b: Sort): boolean {
  return a.key === b.key && a.dir === b.dir;
}

export function sortLabel(sort: Sort): string {
  return SORT_OPTIONS.find((o) => sameSort(o.sort, sort))?.label ?? REVERSED_LABEL[sort.key];
}

/** Clicking a column header: the same column flips direction, another starts in its natural direction. */
export function nextSort(current: Sort, key: SortKey): Sort {
  if (current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: FIRST_DIR[key] };
}

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

function byName(a: DirectoryPerson, b: DirectoryPerson): number {
  return collator.compare(a.name, b.name) || collator.compare(a.bapsId, b.bapsId);
}

/** Blank values (no region, never signed in) go last whichever way the column is sorted. */
function blanksLast(a: string | null, b: string | null, compare: (x: string, y: string) => number): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  return compare(a, b);
}

function byTime(a: string, b: string): number {
  return Date.parse(a) - Date.parse(b);
}

export function comparePeople(sort: Sort): (a: DirectoryPerson, b: DirectoryPerson) => number {
  const sign = sort.dir === "asc" ? 1 : -1;
  return (a, b) => {
    switch (sort.key) {
      case "name":
        return sign * byName(a, b);
      case "bapsId":
        return sign * collator.compare(a.bapsId, b.bapsId);
      case "seva":
        return sign * collator.compare(a.seva, b.seva) || byName(a, b);
      case "region":
        return blanksLast(a.region, b.region, (x, y) => sign * collator.compare(x, y)) || byName(a, b);
      case "added":
        return sign * byTime(a.createdAt, b.createdAt) || byName(a, b);
      case "signin":
        return blanksLast(a.lastSignInAt, b.lastSignInAt, (x, y) => sign * byTime(x, y)) || byName(a, b);
    }
  };
}

export function sortEntries(entries: readonly Entry[], sort: Sort): Entry[] {
  const compare = comparePeople(sort);
  return [...entries].sort((x, y) => compare(x.person, y.person));
}

/** Distinct values, sorted for menus and datalists. */
export function distinctSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0));
}

// ---------------------------------------------------------------------------
// URL query
// ---------------------------------------------------------------------------

/**
 * Search, filters, sort and the open sheet live in the query string so a
 * refresh or a shared link shows the same view, e.g.
 * ?q=naik&role=sant&seva=Hospitality&region=&status=Registered&gender=none&signin=never&channel=sms&sort=-added
 * (`region=` = no region, `status=` = no registration status). ?new=1 opens
 * the add form; ?person=BK1001 opens that person's details. Lists repeat the
 * key (seva, region and status values are written as stored); role and gender
 * also accept commas (role=sant,admin).
 */
export type OpenSheet = { kind: "new" } | { kind: "person"; bapsId: string } | null;
export type UrlState = { filters: Filters; sort: Sort; open: OpenSheet };

const OWN_KEYS = new Set([
  "q",
  "role",
  "seva",
  "region",
  "status",
  "gender",
  "signin",
  "channel",
  "sort",
  "new",
  "person",
]);

const ROLE_PARAM: Record<UserRole, string> = { DELEGATE: "delegate", SANT: "sant", ADMIN: "admin" };
const GENDER_PARAM: Record<GenderFilter, string> = { MALE: "male", FEMALE: "female", NONE: "none" };
const CHANNEL_PARAM: Record<OtpChannel, string> = { EMAIL: "email", SMS: "sms" };
const SORT_PARAM: Record<SortKey, string> = {
  name: "name",
  bapsId: "id",
  seva: "seva",
  region: "region",
  added: "added",
  signin: "signin",
};

/** "-added" = newest first; a bare key sorts ascending. */
export function sortParam(sort: Sort): string {
  return `${sort.dir === "desc" ? "-" : ""}${SORT_PARAM[sort.key]}`;
}

export function parseSortParam(raw: string | null): Sort {
  if (!raw) return DEFAULT_SORT;
  const value = raw.trim().toLowerCase();
  const dir: SortDir = value.startsWith("-") ? "desc" : "asc";
  const name = value.replace(/^[-+]/, "");
  const key = (Object.keys(SORT_PARAM) as SortKey[]).find((k) => SORT_PARAM[k] === name);
  return key ? { key, dir } : DEFAULT_SORT;
}

const MAX_Q = 100;

export function readUrlState(params: URLSearchParams): UrlState {
  const words = (key: string) =>
    params
      .getAll(key)
      .flatMap((v) => v.split(","))
      .map((v) => v.trim().toLowerCase());
  const roleWords = words("role");
  const genderWords = words("gender");
  const signin = params.get("signin");
  const channel = (params.get("channel") ?? "").trim().toLowerCase();
  const person = (params.get("person") ?? "").trim().toUpperCase();

  const filters: Filters = {
    q: (params.get("q") ?? "").slice(0, MAX_Q),
    roles: ROLE_ORDER.filter((r) => roleWords.includes(ROLE_PARAM[r])),
    // Shared with the console-wide seva filter; old links' raw spellings fold into their option.
    sevas: [...new Set(readSevaFilter(params).map(sevaOptionValue).filter(Boolean))],
    regions: [...new Set(params.getAll("region").map((s) => s.trim()))],
    statuses: [...new Set(params.getAll("status").map((s) => s.trim()))],
    genders: GENDER_ORDER.filter((g) => genderWords.includes(GENDER_PARAM[g])),
    signedIn: signin === "yes" || signin === "never" ? signin : null,
    channel: channel === "email" ? "EMAIL" : channel === "sms" ? "SMS" : null,
  };
  const open: OpenSheet =
    params.get("new") === "1" ? { kind: "new" } : person ? { kind: "person", bapsId: person } : null;
  return { filters, sort: parseSortParam(params.get("sort")), open };
}

/** The query string for `state`, keeping any parameters that aren't the directory's (e.g. ?now=). */
export function writeUrlState(current: URLSearchParams, state: UrlState): URLSearchParams {
  const out = new URLSearchParams();
  for (const [key, value] of current) if (!OWN_KEYS.has(key)) out.append(key, value);
  const f = state.filters;
  const q = f.q.trim();
  if (q) out.set("q", q);
  for (const r of f.roles) out.append("role", ROLE_PARAM[r]);
  for (const s of f.sevas) out.append("seva", s);
  for (const r of f.regions) out.append("region", r);
  for (const s of f.statuses) out.append("status", s);
  for (const g of f.genders) out.append("gender", GENDER_PARAM[g]);
  if (f.signedIn) out.set("signin", f.signedIn);
  if (f.channel) out.set("channel", CHANNEL_PARAM[f.channel]);
  if (!sameSort(state.sort, DEFAULT_SORT)) out.set("sort", sortParam(state.sort));
  if (state.open?.kind === "new") out.set("new", "1");
  else if (state.open?.kind === "person") out.set("person", state.open.bapsId);
  return out;
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

/** The shape of a BAPS ID, as BAPS_ID_PATTERN in src/lib/admin/delegates.ts (server only) checks it. */
const BAPS_ID_SHAPE = /^[A-Z0-9](?:[A-Z0-9.]{1,30})[A-Z0-9]$/;

/** Whether an upper-case value has the shape of a BAPS ID (see BAPS_ID_SHAPE). */
export function hasBapsIdShape(value: string): boolean {
  return BAPS_ID_SHAPE.test(value);
}

/**
 * "BK1001" -> "bk1001@na.baps.id": the delegates' default address, the same one the
 * master-list import gives anyone without a usable listed "BAPS Email"
 * (defaultDelegateEmail in src/lib/delegateEmail.ts). null until the value looks like a BAPS ID.
 */
export function bapsEmail(bapsId: string): string | null {
  const id = bapsId.trim().toUpperCase();
  return BAPS_ID_SHAPE.test(id) ? defaultDelegateEmail(id) : null;
}

/** "+18484829439" -> "(848) 482-9439"; other countries stay in E.164. */
export function formatPhone(e164: string): string {
  const d = e164.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return e164;
}

/** "Just now", "12 min ago", "3 h ago", "Yesterday", "4 days ago", then the date. */
export function timeAgo(iso: string, now: number): string {
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return formatDate(iso);
}

/** "Signed in 12 min ago", "Signed in yesterday", "Signed in on Thu, Oct 8" or "Never signed in". */
export function signedInLabel(iso: string | null, now: number): string {
  if (!iso) return "Never signed in";
  const ago = timeAgo(iso, now);
  if (ago === "Just now" || ago === "Yesterday") return `Signed in ${ago.toLowerCase()}`;
  return /^\d/.test(ago) ? `Signed in ${ago}` : `Signed in on ${ago}`;
}

/** "Thu, Oct 8" in the event's timezone. */
export function formatDate(iso: string): string {
  return formatDayShort(dayKey(new Date(iso)));
}

/** "Thu, Oct 8 · 7:45 PM" in the event's timezone. */
export function formatStamp(iso: string): string {
  const d = new Date(iso);
  return `${formatDayShort(dayKey(d))} · ${formatTime(d)}`;
}

/** "1 person", "312 people". */
export function peopleCount(n: number): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? "person" : "people"}`;
}

/**
 * The master list's raw seva when it says more than the team code shown
 * beside it: "NA RC Lead" next to YM RC, "Regional Parent Coordinator" next
 * to BM PC. Null when there is none, when it is the seva itself (the import
 * stores sevas with no team, such as "NC Lead", as given) or when it is just
 * one word of the code ("RC" next to BM RC).
 */
export function sevaRoleNote(p: Pick<DirectoryPerson, "seva" | "sevaRole">): string | null {
  const role = (p.sevaRole ?? "").replace(/\s+/g, " ").trim();
  const key = role.toLowerCase();
  if (!key || key === "#n/a") return null;
  const seva = p.seva.replace(/\s+/g, " ").trim().toLowerCase();
  if (key === seva || seva.split(" ").includes(key)) return null;
  return role;
}

/** Whether a seva names at least one team of the breakout matrix (so seva-matched breakouts exist for it). */
export function sevaIsTeam(seva: string): boolean {
  return teamCodesFor(seva).some(isTeamCode);
}

/** Anything from the organisers' master list on file (the import sets these; the form sets the first two). */
export function hasRegistration(
  p: Pick<
    DirectoryPerson,
    | "registrationId"
    | "center"
    | "personalWing"
    | "sevaWing"
    | "sevaRole"
    | "registrationStatus"
    | "goshthiGroup"
    | "goshthiRoom"
    | "goshthiModerator"
  >,
): boolean {
  return Boolean(
    p.registrationId ||
      p.center ||
      p.personalWing ||
      p.sevaWing ||
      p.sevaRole ||
      p.registrationStatus ||
      p.goshthiGroup ||
      p.goshthiRoom ||
      p.goshthiModerator,
  );
}

/**
 * When the gender on file puts someone on a different track from their
 * master-list seva wing (the import sets it from the wing, so only a later
 * edit does this): the wing's track name, else null.
 */
export function trackMismatch(p: Pick<DirectoryPerson, "gender" | "sevaWing">): "Bhaio" | "Behno" | null {
  const expected = genderForSevaWing(p.sevaWing);
  if (!expected || expected === p.gender) return null;
  return expected === "MALE" ? "Bhaio" : "Behno";
}

/** Schedule track in words, e.g. "Male · Bhaio track". */
export function trackLabel(p: Pick<DirectoryPerson, "gender" | "role">): string {
  if (p.gender === "MALE") return "Male · Bhaio track";
  if (p.gender === "FEMALE") return "Female · Behno track";
  // Santos with no gender follow the Bhaio track (santGender() in src/lib/sant.ts).
  return p.role === "SANT" ? "Not set · follows the Bhaio track" : "Not set · sees both tracks";
}
