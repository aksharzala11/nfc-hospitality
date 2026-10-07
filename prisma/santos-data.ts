/**
 * The Pujya Santo accounts and their utaros for NAAM 2026, from the organisers' spreadsheets
 * (Tejbhai):
 *   - "Pujya Santo Info Tejbhai.xlsx" (tab "Santo Info", read 2026-09-25): the list of 33 santos,
 *     in its order, with their BAPS IDs, emails, phones and regions.
 *   - "TEJBHAI THIS IS EVERYTHING BUDDY - Version 1 (1).xlsx" (tab "Updated Accomodations", read
 *     2026-10-03): who stays where. It replaces "Santo Accommodations - Tejbhai.xlsx" (read
 *     2026-09-25) and moved four santos: Chaitanyamunidas (CM1801) to Chaganbhai's home,
 *     Narayansankalpdas (NS2301) and Jitendriyadas (JT2101) to Akashbhai's home, and
 *     Anandchintandas (AC1801) to the Mandir's Nityanand room. Its regions agree with the list.
 *     The workbook's other tabs (schedules, menu, haribhakto details) give nothing here; no
 *     address or other detail of a home is read into this file.
 * First generated from the cells by a small Python/openpyxl script kept outside the repo (not
 * typed by hand); the 2026-10-03 placements were applied by hand from a read of that tab. Edit
 * this file directly for small corrections and re-run the import.
 *
 * Rules applied (from the organisers):
 *  - bapsId = the "BAPS ID" address before "@", upper-cased (the app upper-cases BAPS IDs);
 *    email = the whole address, lower-cased. Phones in E.164, region as in the sheet.
 *  - name = "<Name>das": "P."/"Pujya" and "Swami" dropped, stray spaces trimmed, "das"
 *    appended once, e.g. "Nityavivek Swami" -> "Nityavivekdas" (santName() shows it as is).
 *  - Every account is role SANT, gender MALE, seva "Pujya Santo", preferred channel EMAIL
 *    (set by scripts/import-santos.ts). The sheet's Telegram IDs have no field and are left out.
 *  - Names are matched across sheets on a normalised key (no "P.", no "Swami", no spaces or
 *    case). "Yagnanad Swami" on the list is spelt "Yagnanand" by the accommodations sheets and
 *    his Telegram ID, so that spelling is used. "Shantilay Swami" in "Updated Accomodations"
 *    (Akashbhai's home, region Canada, where he already stayed) is Shantnilaydas (SN1801): one
 *    letter off, and no other santo comes close.
 *  - Utaros: one per haribhakta home, named from the tab's Accommodation column ("Chaganbhai
 *    House" -> "Chaganbhai's home") and holding everyone in any of its rooms (Room column: bed or
 *    bedding); one per named Mandir room (Accommodation "Mandir", named from the Room column).
 *    Each lists its santos in the sheet's order. No addresses or hosts are kept here.
 *  - Santos in "Updated Accomodations" without a BAPS ID on the list are not added and have no
 *    account yet (waiting for their account details from the organisers): Nirmalhriday Swami
 *    (Akashbhai's home), Anandswarup Swami (Mandir Sarvasva room, so that room has no utaro) and
 *    Bhaktiswarup Swami (Mandir Premanand room).
 *  - Pending accounts (user, 2026-10-06): a santo the organisers want in the app before his
 *    account details arrive is listed with a placeholder BAPS ID ("PENDING-<NAME>", PENDING_PREFIX)
 *    and no email or phone, so nobody can sign in as him (a code has nowhere to go), while he is
 *    placed at his utaro (his companions see him there) and any programme of his can be synced.
 *    When his BAPS ID arrives, put it in `bapsId`, the old placeholder in `formerBapsId`, and his
 *    email and phone; the import renames the account in place (no second account), and the
 *    personal-schedule sync rewrites his `sp-` rows under the new id. Shilvatsal Swami (Akashbhai's
 *    home, region Canada as on the tab) was the first; neither Santo workbook has a programme for him.
 *    His details came on 2026-10-06 (user): BAPS ID SV2102 and the organisers' User Id 66512
 *    (`registrationId`); no phone was given, and his email is the one every santo's BAPS ID comes
 *    from, sv2102@na.baps.org (to be confirmed with the organisers).
 *  - Ghanshyamsevadas (GS0002) is not on "Updated Accomodations" (Bhaktiswarup Swami has his
 *    Premanand room there); he stays on the list, at the Premanand room, on the user's word
 *    (2026-10-03: "keep").
 *  - Every santo is in exactly one utaro. Ids are stable: "utaro-<host>" and
 *    "utaro-mandir-<room>", so re-running the import updates rows in place.
 *
 * Import with `npm run santos:import` (local) or `npm run santos:import:lightsail`; add
 * `-- --dry-run` to only print what would change. See scripts/import-santos.ts.
 */

/** How a pending account's placeholder BAPS ID starts (see "Pending accounts" above). */
export const PENDING_PREFIX = "PENDING-";

export type SantoData = {
  /** Upper-case BAPS ID, e.g. "NV0001"; a pending account's placeholder, "PENDING-SHILVATSAL". */
  bapsId: string;
  /** Lower-case email address (OTP destination); null only for a pending account. */
  email: string | null;
  /** "<Name>das", e.g. "Nityavivekdas". */
  name: string;
  region: string;
  /** E.164, e.g. +16479957991; null only for a pending account. */
  phone: string | null;
  /** The placeholder BAPS ID this account had while pending: the import renames that account. */
  formerBapsId?: string;
  /** The organisers' User Id (users.registration_id), when they give one for a santo. */
  registrationId?: string;
};

export type UtaroData = {
  /** Stable sant_accommodations.id. */
  id: string;
  placeName: string;
  /** BAPS IDs of the santos staying here. */
  santos: string[];
};

export const SANTOS: SantoData[] = [
  { bapsId: "NV0001", email: "nv0001@na.baps.org", name: "Nityavivekdas", region: "Canada", phone: "+16479957991" },
  { bapsId: "SN1801", email: "sn1801@na.baps.org", name: "Shantnilaydas", region: "Canada", phone: "+16476157661" },
  { bapsId: "VD2101", email: "vd2101@na.baps.org", name: "Viraldarshandas", region: "Canada", phone: "+16476144016" },
  { bapsId: "VM1301", email: "vm1301@na.baps.org", name: "Vatsalmurtidas", region: "Midwest", phone: "+12819001761" },
  { bapsId: "US0501", email: "us0501@na.baps.org", name: "Uttamshlokdas", region: "Midwest", phone: "+16304232900" },
  { bapsId: "CM1801", email: "cm1801@na.baps.org", name: "Chaitanyamunidas", region: "Midwest", phone: "+18564846681" },
  { bapsId: "YV1801", email: "yv1801@na.baps.org", name: "Yogvardhandas", region: "Midwest", phone: "+18564846683" },
  { bapsId: "NC1401", email: "nc1401@na.baps.org", name: "Nirdoshcharitdas", region: "Northeast", phone: "+18564846741" },
  { bapsId: "AM0501", email: "am0501@na.baps.org", name: "Anantmangaldas", region: "Northeast", phone: "+17329866392" },
  { bapsId: "GM1401", email: "gm1401@na.baps.org", name: "Gnanmanandas", region: "Northeast", phone: "+18564846727" },
  { bapsId: "AT1801", email: "at1801@na.baps.org", name: "Abhaytilakdas", region: "Northeast", phone: "+18564846670" },
  { bapsId: "GS0002", email: "gs0002@na.baps.org", name: "Ghanshyamsevadas", region: "Northeast", phone: "+14438785302" },
  { bapsId: "JT2101", email: "jt2101@na.baps.org", name: "Jitendriyadas", region: "Northeast", phone: "+18564846697" },
  { bapsId: "AM1801", email: "am1801@na.baps.org", name: "Aksharmanandas", region: "Northeast", phone: "+18564846720" },
  { bapsId: "AS1801", email: "as1801@na.baps.org", name: "Achalswarupdas", region: "Northeast", phone: "+18564846721" },
  { bapsId: "NT2101", email: "nt2101@na.baps.org", name: "Narayantirthdas", region: "Northeast", phone: "+18564846675" },
  { bapsId: "AM1502", email: "am1502@na.baps.org", name: "Aniketmunidas", region: "Northeast", phone: "+18564846743" },
  { bapsId: "PN2102", email: "pn2102@na.baps.org", name: "Paramniketdas", region: "Northeast", phone: "+18564846694" },
  { bapsId: "SP2102", email: "sp2102@na.baps.org", name: "Shantipriyadas", region: "Northeast", phone: "+18564846696" },
  { bapsId: "SY0702", email: "sy0702@na.baps.org", name: "Saralyogidas", region: "Southeast", phone: "+19255195385" },
  { bapsId: "NS0501", email: "ns0501@na.baps.org", name: "Nirdoshswarupdas", region: "Southeast", phone: "+16785235364" },
  { bapsId: "NP0701", email: "np0701@na.baps.org", name: "Nirmalpremdas", region: "Southeast", phone: "+16305386769" },
  { bapsId: "YA1301", email: "ya1301@na.baps.org", name: "Yagnananddas", region: "Southeast", phone: "+18564846701" },
  { bapsId: "AS1201", email: "as1201@na.baps.org", name: "Anandsetudas", region: "Southeast", phone: "+19098936509" },
  { bapsId: "AN2101", email: "an2101@na.baps.org", name: "Achalniketdas", region: "Southeast", phone: "+18564846717" },
  { bapsId: "BT0901", email: "bt0901@na.baps.org", name: "Brahmatilakdas", region: "Southwest", phone: "+18328416848" },
  { bapsId: "SM0701", email: "sm0701@na.baps.org", name: "Sahajmunidas", region: "Southwest", phone: "+19259976204" },
  { bapsId: "NS2301", email: "ns2301@na.baps.org", name: "Narayansankalpdas", region: "Southwest", phone: "+18564846680" },
  { bapsId: "AN2103", email: "an2103@na.baps.org", name: "Achalnayandas", region: "Southwest", phone: "+18564846719" },
  { bapsId: "AA1601", email: "aa1601@na.baps.org", name: "Akhandananddas", region: "West", phone: "+18564934905" },
  { bapsId: "SK1501", email: "sk1501@na.baps.org", name: "Sarangkirtandas", region: "West", phone: "+18564846745" },
  { bapsId: "AM1701", email: "am1701@na.baps.org", name: "Anandmanandas", region: "West", phone: "+18564934907" },
  { bapsId: "AC1801", email: "ac1801@na.baps.org", name: "Anandchintandas", region: "West", phone: "+18564846671" },
  // Pending from 2026-10-06 until his details came the same day (user): renamed from the placeholder.
  {
    bapsId: "SV2102",
    formerBapsId: "PENDING-SHILVATSAL",
    email: "sv2102@na.baps.org",
    name: "Shilvatsaldas",
    region: "Canada",
    phone: null,
    registrationId: "66512",
  },
];

export const UTAROS: UtaroData[] = [
  {
    id: "utaro-chaganbhai",
    placeName: "Chaganbhai's home",
    // Nirdoshswarupdas, Anandsetudas, Uttamshlokdas, Chaitanyamunidas (from Akashbhai's home, 2026-10-03),
    // Sahajmunidas, Yogvardhandas, Vatsalmurtidas, Gnanmanandas
    santos: ["NS0501", "AS1201", "US0501", "CM1801", "SM0701", "YV1801", "VM1301", "GM1401"],
  },
  {
    id: "utaro-mukundbhai",
    placeName: "Mukundbhai's home",
    // Sarangkirtandas, Akhandananddas, Anandmanandas, Aniketmunidas, Aksharmanandas, Yagnananddas
    santos: ["SK1501", "AA1601", "AM1701", "AM1502", "AM1801", "YA1301"],
  },
  {
    id: "utaro-akashbhai",
    placeName: "Akashbhai's home",
    // Abhaytilakdas, Jitendriyadas (from the Nityanand room, 2026-10-03), Shantnilaydas ("Shantilay"
    // on the sheet), Achalniketdas, Viraldarshandas, Shantipriyadas, Achalnayandas, Narayansankalpdas
    // (from Chaganbhai's home, 2026-10-03), Shilvatsaldas (2026-10-06). Also on
    // the sheet here, without an account yet: Nirmalhriday Swami.
    santos: ["AT1801", "JT2101", "SN1801", "AN2101", "VD2101", "SP2102", "AN2103", "NS2301", "SV2102"],
  },
  {
    id: "utaro-mandir-muktanand",
    placeName: "Mandir · Muktanand room",
    // Anantmangaldas
    santos: ["AM0501"],
  },
  {
    id: "utaro-mandir-premanand",
    placeName: "Mandir · Premanand room",
    // Ghanshyamsevadas: kept here on the user's word (2026-10-03); "Updated Accomodations" lists
    // Bhaktiswarup Swami in this room instead, who has no account yet.
    santos: ["GS0002"],
  },
  {
    id: "utaro-mandir-swarupanand",
    placeName: "Mandir · Swarupanand room",
    // Brahmatilakdas
    santos: ["BT0901"],
  },
  {
    id: "utaro-mandir-shukanand",
    placeName: "Mandir · Shukanand room",
    // Saralyogidas, Nirmalpremdas
    santos: ["SY0702", "NP0701"],
  },
  {
    id: "utaro-mandir-nishkulanand",
    placeName: "Mandir · Nishkulanand room",
    // Achalswarupdas, Nirdoshcharitdas
    santos: ["AS1801", "NC1401"],
  },
  {
    id: "utaro-mandir-nityanand",
    placeName: "Mandir · Nityanand room",
    // Narayantirthdas, Anandchintandas (from Akashbhai's home, 2026-10-03), Paramniketdas, Nityavivekdas
    santos: ["NT2101", "AC1801", "PN2102", "NV0001"],
  },
];
