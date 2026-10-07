/**
 * How a row of the organisers' master list ("App DataSet") becomes a users row:
 * the (Seva Wing, Seva) pair -> the breakout team code stored in users.seva, and
 * the Seva Wing -> the gender track (users.gender). The master-list import and
 * anything that re-derives a delegate's team use these two functions; the raw
 * cells are kept in users.seva_wing / users.seva_role.
 *
 * Pure and isomorphic: no database access, safe in client components.
 *
 * Wing letter used by the per-wing teams: Bal/Balika -> BM, Kishore/Kishori -> KM,
 * Yuvak/Yuvati -> YM (EBKY and IBKY have none).
 *
 *   Seva (or its "NA ... Lead")                  Seva Wing              Team code
 *   -------------------------------------------  ---------------------  ----------------
 *   RA, RC, NDC / NA RA|RC|NDC Lead              Bal..Yuvati            <BM|KM|YM> RA|RC|NDC
 *   RCTL / NA RCTL Lead                          any                    BKY RCTLs
 *   Campus & Education / NA C&E Lead             Kishore, Kishori       CE
 *   Regional Parent Coordinator / NA PC Lead     Bal, Kishore           BK RPCs & RGCs
 *                                                Balika                 BM PC
 *                                                Kishori                KM PC
 *   Regional Gujarati Lead / NA Gujarati Co Lead Bal, Kishore, EBKY     BK RPCs & RGCs
 *                                                Balika                 BM RGC
 *   Regional BST Lead / NA BST Lead              any                    BSTL
 *   Regional KST Lead / NA KST Lead              any                    KSTL
 *   Satsang Admin                                any                    SA
 *   Multimedia / NA Multimedia Lead              any                    MM
 *   IT / NA IT Lead                              any                    IT
 *   FERA / NA FERA Lead                          any                    FERA
 *   RMC, RMCA                                    any                    RMCs + RMCAs
 *
 * Anything else has no team (null): "Sant Admin", "NC", "NC Lead", "NCM", "NMS",
 * "Sanyojak", the per-wing roles under EBKY / IBKY (e.g. IBKY RA, IBKY NDC, IBKY
 * Regional Parent Coordinator) and any pair not in the table. The import then
 * stores the raw Seva text in users.seva, so those people get no breakout
 * sessions until the organisers say where they go.
 */
import { isTeamCode, type TeamCode } from "./teams";

/** Seva wings on the Bhaio (gents) track. */
export const BHAIO_WINGS = ["Bal", "Kishore", "Yuvak", "EBKY"] as const;
/** Seva wings on the Behno (ladies) track. */
export const BEHNO_WINGS = ["Balika", "Kishori", "Yuvati", "IBKY"] as const;

export type SevaWing = (typeof BHAIO_WINGS)[number] | (typeof BEHNO_WINGS)[number];

export const SEVA_WINGS: readonly SevaWing[] = [...BHAIO_WINGS, ...BEHNO_WINGS];

/**
 * Comparison key for a spreadsheet cell: trimmed, lower case, runs of
 * whitespace collapsed ("NA  IT Lead" and "na it lead" share a key).
 */
export function sheetKey(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

const WING_BY_KEY: ReadonlyMap<string, SevaWing> = new Map(
  SEVA_WINGS.map((w) => [sheetKey(w), w] as const),
);

/**
 * The canonical spelling of a seva wing cell ("eBKY", " kishori " -> "EBKY",
 * "Kishori"), or null when it is not one of the eight wings (blank, "#N/A").
 */
export function sevaWingOf(value: string | null | undefined): SevaWing | null {
  return WING_BY_KEY.get(sheetKey(value)) ?? null;
}

/**
 * Gender track for a seva wing: Bal, Kishore, Yuvak, EBKY -> MALE (Bhaio);
 * Balika, Kishori, Yuvati, IBKY -> FEMALE (Behno); anything else -> null. Only a
 * fallback: a person's track comes from their personal wing first
 * (genderForPerson()), because some men serve under IBKY as liaisons between
 * the two sides and stay on the Bhaio track.
 */
export function genderForSevaWing(sevaWing: string | null | undefined): "MALE" | "FEMALE" | null {
  const wing = sevaWingOf(sevaWing);
  if (!wing) return null;
  return (BHAIO_WINGS as readonly string[]).includes(wing) ? "MALE" : "FEMALE";
}

/** Personal wings (the master list's "Personal Wing") that fix the track. Sanyukta = married men, Premvati = married women. */
const PERSONAL_BHAIO = ["bal", "kishore", "yuvak", "sanyukta"];
const PERSONAL_BEHNO = ["balika", "kishori", "yuvati", "premvati"];

/**
 * A delegate's gender track (organisers, 2026-09-26): the personal wing when it
 * names one (Kishore, Yuvak, Sanyukta -> MALE; Kishori, Yuvati, Premvati ->
 * FEMALE), else the seva wing (genderForSevaWing()). Men holding IBKY roles as
 * liaisons are Sanyukta/Yuvak, so they stay on the Bhaio track.
 */
export function genderForPerson(
  personalWing: string | null | undefined,
  sevaWing: string | null | undefined,
): "MALE" | "FEMALE" | null {
  const key = sheetKey(personalWing);
  if (PERSONAL_BHAIO.includes(key)) return "MALE";
  if (PERSONAL_BEHNO.includes(key)) return "FEMALE";
  return genderForSevaWing(sevaWing);
}

/** Team code per seva wing for one seva; a missing wing means no team. */
type WingTeams = Partial<Record<SevaWing, TeamCode>>;

/** The same team whatever the wing. */
function anyWing(code: TeamCode): WingTeams {
  return Object.fromEntries(SEVA_WINGS.map((w) => [w, code]));
}

/** The per-wing RA / RC / NDC teams (none under EBKY / IBKY). */
function perWing(role: "RA" | "RC" | "NDC"): WingTeams {
  return {
    Bal: `BM ${role}`,
    Balika: `BM ${role}`,
    Kishore: `KM ${role}`,
    Kishori: `KM ${role}`,
    Yuvak: `YM ${role}`,
    Yuvati: `YM ${role}`,
  };
}

/** [Seva spellings, team per wing], exactly the table in the header comment. */
const RULES: ReadonlyArray<readonly [sevas: readonly string[], teams: WingTeams]> = [
  // The matrix's Saturday RA split is literally "BKY RALs split BKY RAs": the
  // NA leads sit with their wing's team.
  [["RA", "NA RA Lead"], perWing("RA")],
  [["RC", "NA RC Lead"], perWing("RC")],
  [["NDC", "NA NDC Lead"], perWing("NDC")],
  [["RCTL", "NA RCTL Lead"], anyWing("BKY RCTLs")],
  [["Campus & Education", "NA Campus & Education Lead"], { Kishore: "CE", Kishori: "CE" }],
  [
    ["Regional Parent Coordinator", "NA PC Lead"],
    { Bal: "BK RPCs & RGCs", Kishore: "BK RPCs & RGCs", Balika: "BM PC", Kishori: "KM PC" },
  ],
  [
    ["Regional Gujarati Lead", "NA Gujarati Co Lead"],
    { Bal: "BK RPCs & RGCs", Kishore: "BK RPCs & RGCs", EBKY: "BK RPCs & RGCs", Balika: "BM RGC" },
  ],
  [["Regional BST Lead", "NA BST Lead"], anyWing("BSTL")],
  [["Regional KST Lead", "NA KST Lead"], anyWing("KSTL")],
  [["Satsang Admin"], anyWing("SA")],
  [["Multimedia", "NA Multimedia Lead"], anyWing("MM")],
  [["IT", "NA IT Lead"], anyWing("IT")],
  [["FERA", "NA FERA Lead"], anyWing("FERA")],
  [["RMC", "RMCA"], anyWing("RMCs + RMCAs")],
];

const TEAMS_BY_SEVA: ReadonlyMap<string, WingTeams> = (() => {
  const map = new Map<string, WingTeams>();
  for (const [sevas, teams] of RULES) {
    for (const seva of sevas) {
      const key = sheetKey(seva);
      if (map.has(key)) throw new Error(`sevaMapping: "${seva}" is listed twice`);
      map.set(key, teams);
    }
  }
  return map;
})();

/**
 * The breakout team code (one of TEAM_CODES) for a master-list (Seva Wing, Seva)
 * pair, or null when the pair has no team (see the table above). Whitespace and
 * case are ignored in both cells.
 *
 *   teamForSeva("Kishori", "NA RA Lead")                 -> "KM RA"
 *   teamForSeva("EBKY", "NA  IT Lead")                   -> "IT"
 *   teamForSeva("Balika", "Regional Parent Coordinator") -> "BM PC"
 *   teamForSeva("IBKY", "RA")                            -> null
 *   teamForSeva("EBKY", "Sant Admin")                    -> null
 */
export function teamForSeva(
  sevaWing: string | null | undefined,
  seva: string | null | undefined,
): TeamCode | null {
  const wing = sevaWingOf(sevaWing);
  if (!wing) return null;
  const code = TEAMS_BY_SEVA.get(sheetKey(seva))?.[wing];
  return code && isTeamCode(code) ? code : null;
}
