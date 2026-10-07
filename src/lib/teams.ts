/**
 * Team codes of the organisers' breakout matrix, and the one rule that turns a
 * users.seva value into the team(s) it means, so a delegate finds their team
 * breakouts (breakouts.seva holds one canonical code per row, see
 * prisma/breakouts.ts) however the master list spells the team.
 *
 * Pure and isomorphic: no database access, safe in client components.
 */

/** Canonical team codes, exactly as prisma/breakouts-data.ts uses them in `teams`. */
export const TEAM_CODES = [
  "BKY RCTLs",
  "BM NDC",
  "KM NDC",
  "YM NDC",
  "BM RA",
  "KM RA",
  "YM RA",
  "BM RC",
  "KM RC",
  "YM RC",
  "BM PC",
  "KM PC",
  "BM RGC",
  "BK RPCs & RGCs",
  "BSTL",
  "KSTL",
  "SA",
  "MM",
  "CE",
  "IT",
  "FERA",
  "RMCs + RMCAs",
] as const;

export type TeamCode = (typeof TEAM_CODES)[number];

/**
 * Other spellings of a team, and names that stand for several teams, mapped to
 * the canonical codes they mean. Lookups go through teamKey(), so case, spaces,
 * punctuation, "&" / "+" / "and" and simple plurals don't need their own entry
 * ("Satsang Admins", "BK RPC and RGC" and "BKRPC & RGCs" all match below).
 *
 * The Bhaio matrix meets the RPCs and RGCs as one team ("BK RPCs & RGCs") while
 * the Behno matrix splits them into BM PC, KM PC and BM RGC, so each of those
 * names includes the other side's code: the viewer's track decides which rows
 * actually show.
 */
export const TEAM_ALIASES: Record<string, readonly TeamCode[]> = {
  "Satsang Admin": ["SA"],
  Campus: ["CE"],
  RCTL: ["BKY RCTLs"],
  "BK RPCs & RGCs": ["BK RPCs & RGCs", "BM PC", "KM PC", "BM RGC"],
  "BK RPC": ["BK RPCs & RGCs", "BM PC", "KM PC"],
  "BK RGC": ["BK RPCs & RGCs", "BM RGC"],
  RPC: ["BK RPCs & RGCs", "BM PC", "KM PC"],
  RGC: ["BK RPCs & RGCs", "BM RGC"],
  "BM PC": ["BM PC", "BK RPCs & RGCs"],
  "BM RPC": ["BM PC", "BK RPCs & RGCs"],
  "KM PC": ["KM PC", "BK RPCs & RGCs"],
  "KM RPC": ["KM PC", "BK RPCs & RGCs"],
  "BM RGC": ["BM RGC", "BK RPCs & RGCs"],
  BKSTL: ["BSTL", "KSTL"],
  "BKY RA": ["BM RA", "KM RA", "YM RA"],
  "BKY RC": ["BM RC", "KM RC", "YM RC"],
  "BKY NDC": ["BM NDC", "KM NDC", "YM NDC"],
  "BK NDC": ["BM NDC", "KM NDC"],
  RMC: ["RMCs + RMCAs"],
  RMCA: ["RMCs + RMCAs"],
  "RMCA & RMC": ["RMCs + RMCAs"],
};

/**
 * Comparison key for a team name: lower case, "&" / "+" / "/" / "," read as
 * "and", other punctuation and all spaces dropped, and a plural "s" taken off
 * each word. "BK RPCs & RGCs", "bk rpc and rgc" and "BKRPC & RGCs" share a key.
 */
export function teamKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[&+/,]/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) => (w.length > 2 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .join("");
}

/** Canonical codes by key: each code itself, then the aliases (merged, never replaced). */
const BY_KEY: ReadonlyMap<string, readonly TeamCode[]> = (() => {
  const map = new Map<string, TeamCode[]>();
  const add = (name: string, codes: readonly TeamCode[]) => {
    const key = teamKey(name);
    const list = map.get(key) ?? [];
    for (const c of codes) if (!list.includes(c)) list.push(c);
    map.set(key, list);
  };
  for (const code of TEAM_CODES) add(code, [code]);
  for (const [name, codes] of Object.entries(TEAM_ALIASES)) add(name, codes);
  return map;
})();

export function isTeamCode(value: string): value is TeamCode {
  return (TEAM_CODES as readonly string[]).includes(value);
}

/** The sheet's lower-case track prefix on a team name ("eBM RA", "iSA", "eiBKY RA"). */
const TRACK_PREFIX = /^(?:ei|e|i)(?=[A-Z])/;

/**
 * A users.seva value as guests may see it: trimmed, without the sheet's
 * e/i/ei track prefix ("eBM RA" -> "BM RA"). Use it wherever a seva is shown.
 */
export function sevaLabel(seva: string | null | undefined): string {
  return (seva ?? "").trim().replace(TRACK_PREFIX, "");
}

/**
 * The breakouts.seva values a users.seva value matches: the canonical team
 * code(s) it means, plus the trimmed seva itself, so sevas that aren't matrix
 * teams (mock data, the santos' "Pujya Santo") still match their rows exactly.
 * The matrix's lower-case track prefix ("e" = Bhaio, "i" = Behno, "ei" = both,
 * from Kishore / Kishori) is ignored: "eBM RA" means BM RA. Blank -> [].
 *
 *   teamCodesFor("Satsang Admins")  -> ["SA", "Satsang Admins"]
 *   teamCodesFor("BKSTL")           -> ["BSTL", "KSTL", "BKSTL"]
 *   teamCodesFor("BM RA")           -> ["BM RA"]
 *   teamCodesFor("Hospitality")     -> ["Hospitality"]
 */
export function teamCodesFor(seva: string | null | undefined): string[] {
  const raw = (seva ?? "").trim();
  if (!raw) return [];
  const codes: string[] = [...(BY_KEY.get(teamKey(sevaLabel(raw))) ?? [])];
  if (!codes.includes(raw)) codes.push(raw);
  return codes;
}
