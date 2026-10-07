# Hospitality Hub

Mobile web app for delegates attending NAAM 2026 in Edison, NJ (October 8–11, 2026).
Guests sign in with their BAPS ID, confirm a one-time code sent to their email or phone,
and land on a dashboard with their **Schedule**, the **Menu** (revealed as the event
progresses) and the **Breakout Sessions** for their seva, plus their own airport transport and
hotel stay.

- **Frontend:** Next.js 15 (App Router) · React 19 · Tailwind CSS 4 · lucide-react
- **Backend:** Next.js route handlers · Prisma 6 · PostgreSQL (Amazon Lightsail in production)
- **Auth:** BAPS ID + OTP (Amazon SES for email, Amazon SNS for SMS) · signed httpOnly session cookie (JWT via `jose`)
- **Look:** the organisers' NAAM 2026 "Sāchu" Karyakar theme: ink `#2f4f60`, coral `#f68f77`, sand
  `#e8e0d1`, the teal (`#3d9283 → #2f4f60`) and coral (`#f68f77 → #c44147`) gradients, Enilas +
  Just Sans, and the Sāchu logo. Rebuild the logos, murti/footer art, wallpapers, app icons and web
  fonts from the brand kit with `python scripts/build-sachu-assets.py "<Digital Assets folder>"`.
  The fonts are commercial (Enilas: TimelessType; Just Sans: Just Creative EULA); the organisers'
  licence must cover web embedding.

---

## Quick start

Prerequisites: Node 20+, Docker Desktop (for the local Postgres).

```bash
npm install
cp .env.example .env          # already done if .env exists
npm run db:up                 # starts Postgres in Docker (localhost:5432)
npm run db:setup              # pushes the schema and seeds mock data
npm run dev                   # http://localhost:3000
```

Sign in with any seeded BAPS ID (see below). With `OTP_PROVIDER=console` the code is printed
in the terminal running `npm run dev` (the checked-in `.env` currently uses `OTP_PROVIDER=aws`,
which sends real email through SES using your local AWS CLI credentials):

```
[OTP] Email to harshad.patel@example.com (Harshadbhai): your code is 123456
```

### Seeded demo users

Mock users and mock breakouts are only created when `SEED_MOCK_DATA=true` (the local default).
The real team breakouts are always seeded (see "Team breakouts" below).

| BAPS ID   | Name          | Seva                  | OTP channel |
| --------- | ------------- | --------------------- | ----------- |
| UN2998001 | Upsham Naik   | Admin                 | Email       |
| MT9901    | Munitilakdas  | Hospitality           | Email       |
| BK1001  | Harshadbhai   | Hospitality           | Email       |
| BK1002  | Nilamben      | Registration          | SMS         |
| BK1003  | Jaybhai       | Audio Visual          | Email       |
| BK1004  | Priyaben      | Hospitality           | Email       |
| BK1005  | Kunalbhai     | Logistics & Transport | SMS         |
| BK1006  | Rinaben       | Medical               | Email       |
| BK1007  | Vivekbhai     | Kitchen & Prasad      | Email       |
| BK1008  | Hetalben      | Audio Visual          | SMS         |
| BK1009  | Sanjaybhai    | Security & Parking    | Email       |
| BK1010  | Meeraben      | Kitchen & Prasad      | Email       |

UN2998001 is not part of the mock seed; it was added with the upsert script (see
"Adding users" below). To point MT9901 at a real inbox set `SEED_DEMO_EMAIL=you@example.com`
before running `npm run db:seed`.

### Adding users

```bash
npm run user:upsert -- --env .env.lightsail --bapsId UN2998001 --name "Upsham Naik" \
  --seva Admin --email upshamgnaik@outlook.com --phone 8484829439 --channel EMAIL
```

Optional flags: `--displayName`, `--gender MALE|FEMALE`, `--region`, and
`--breakouts id1,id2` to link rows from the `breakouts` table. Phone numbers are normalised
to E.164. Running it again for the same BAPS ID updates the row.

### Delegates from the master list

The delegates come from the organisers' master list ("App DataSet.xlsx") and their goshthi
groups ("NAAM Goshthi Group Allocations.xlsx"). Each person's "User Id" is stored as
`users.registration_id` (unique): the key that links a delegate to the organisers' other data
sources, and what the import matches people by. `scripts/import-delegates.ts` reads the workbooks
at run time; they hold personal details, so keep them outside the repo and never commit them.
Always go plan → dry-run → apply, with the same arguments each time:

```bash
npm run delegates:import:lightsail -- --master "<App DataSet.xlsx>" --goshthi "<NAAM Goshthi Group Allocations.xlsx>" [--baps-id <User Id>=<BAPS ID>]... --plan
npm run delegates:import:lightsail -- --master "<App DataSet.xlsx>" --goshthi "<NAAM Goshthi Group Allocations.xlsx>" [--baps-id <User Id>=<BAPS ID>]... --dry-run
npm run delegates:import:lightsail -- --master "<App DataSet.xlsx>" --goshthi "<NAAM Goshthi Group Allocations.xlsx>" [--baps-id <User Id>=<BAPS ID>]... --apply
```

- `--plan` reads only the workbooks and prints a summary (counts, User Ids and BAPS IDs; never
  names, emails or phones). `--out <file.json>` also writes the full plan, which holds personal
  data; the script refuses a path inside the repo. `--dry-run` reads the database and prints
  every change; `--apply` writes it in one transaction. Exactly one mode is required and any
  unknown argument (including the old `--emails`) stops the script before it reads anything.
  `npm run delegates:import` (no `:lightsail`) targets the local database; `--master-sheet
  <name>` picks a sheet other than the first, `--env <file>` another dotenv file.
- **`--baps-id <User Id>=<BAPS ID>`** (repeatable): a BAPS ID the organisers sent for a User Id,
  for a blank cell or to correct the sheet's; the given value wins and the plan prints each one
  with what the sheet had. A plan error: a User Id not in the list or given twice, a value that
  can't be a sign-in ID, or one another imported person has; `--dry-run` / `--apply` also refuse
  one another account already holds. An account matched by User Id gets the corrected BAPS ID.
- **Refunded** registrations are imported like anyone else (status stored as given) and listed,
  in case anything changes. A **User Id on two rows** (one with a Seva Wing and Seva, one blank)
  is imported once, from the row with the seva (phone from whichever row has one); differing
  statuses are listed. **Skipped** (and listed): rows of one User Id with different BAPS IDs or
  different sevas, no BAPS ID (or one that can't be a sign-in ID), a BAPS ID shared by several
  User Ids, no usable Seva Wing or Seva. The plan refuses to write while it has errors.
- **BAPS ID** is upper-cased (the sign-in form upper-cases it too); non-standard IDs such as
  "FIRST.LAST" are imported as given. The channel is email, and the phone is stored in E.164
  when the sheet has one (a blank or `#N/A` never clears a phone already on file). **Name** is
  "First Last" (no middle name).
- **Email** (organisers, 2026-09-27): every delegate gets exactly `<BAPS ID lower-case>@na.baps.id`
  (`defaultDelegateEmail()` in `src/lib/delegateEmail.ts`); the organisers' email list is no
  longer used. `--dry-run` counts the stored addresses that change, by their current domain. The
  admin console's "Add delegate" form suggests the same address. Santos keep the addresses from
  their own sheet (the import never touches them).
- **Track** (`gender`, `genderForPerson()`) comes from the Personal Wing when it names one (Bal,
  Kishore, Yuvak, Sanyukta → Bhaio; Balika, Kishori, Yuvati, Premvati → Behno), else from the
  Seva Wing (Bal, Kishore, Yuvak, EBKY → Bhaio; Balika, Kishori, Yuvati, IBKY → Behno), so men
  serving in IBKY liaison roles stay on the Bhaio track.
- **Seva**: `users.seva` is the breakout team code the (Seva Wing, Seva) pair maps to in
  `src/lib/sevaMapping.ts` (`teamForSeva()`, e.g. Kishori + "NA RA Lead" → `KM RA`), else the
  Seva text as given. Unmapped sevas ("Sant Admin", "NC", "NC Lead", "NCM", "NMS", "Sanyojak",
  the per-wing roles under EBKY / IBKY, any pair not in the table) match no team, so those
  delegates see "Sessions coming soon" until the organisers place them. The raw cells are kept
  in `seva_wing` and `seva_role`, along with `center`, `personal_wing` and
  `registration_status`.
- **Goshthi groups** (`src/lib/goshthiImport.ts`): each group meets in its own room during the
  Goshthi sessions. Only visible tabs are read (hidden tabs are the organisers' old copies; a
  summary tab is ignored; tabs are found by layout, so a renamed tab still reads): the Bhaio
  "Eside" list (User Id, Wing, Goshthi Group, Room) and the Behno "Iside" grid ("Group N" blocks, each with a "Moderator:" row, numbered members
  and a merged Location as the room). `goshthi_group` holds "Group 4" for Bhaio (or "eBKY Group
  3" when listed under another wing), shown with the wing ("Kishore Group 4"), and "Goshthi
  Group 12" for Behno, shown as given; `goshthi_room` the room as the organisers name it (only
  "Samp Sqaure" is corrected; a blank Room cell takes the room the rest of its group names, when those rows outnumber the blank ones);
  `goshthi_moderator` whether they moderate it (admin directory only, never shown in the hub).
  On the "Eside" list, whose group numbers run across the wings (Bal 1–15, Kishore 16–32, …), a
  number is one group: a blank or differing Wing, or a Room unlike the one the rest of the group
  names (when "Split?" is blank), takes the group's; a row sitting among another group's rows
  (moved without its number changed) takes that group only when the typed "Ppl in Group" counts
  match the blocks as laid out, and otherwise gets no group until the organisers say. Every such
  row is listed in the plan.
  The plan lists rooms filled from the group, remaining blank rooms, people listed under another wing or not imported, groups without exactly one
  moderator row and delegates no group lists. Set only for the tracks the `--goshthi` workbooks
  cover (and anyone they list); without `--goshthi` all three are left as they are.
- The import never changes SANT or ADMIN accounts or anyone not in the list (TEST0001, the
  admin, the santos), never deletes (people imported before who are now gone are only
  reported), and never writes `test_code`, `breakout_sessions` or `display_name`.

The database needs the new `users` columns first (`goshthi_room` and `goshthi_moderator` are the
latest): `npm run db:push:lightsail` once, before deploying the code that reads them (the import
says so if they're missing).

### Airport transport

Pickups and drop-offs come from the transport team's workbook ("Transportation Information
v3.xlsx"), read at run time by `scripts/import-transport.ts` (keep the file outside the repo).
Same modes as the delegate import (`--plan` touches no database and `--out <json>` must be
outside the repo; then `--dry-run`, then `--apply` in one transaction):

```bash
npm run transport:import:lightsail -- --file "<Transportation Information v3.xlsx>" --plan
npm run transport:import:lightsail -- --file "<Transportation Information v3.xlsx>" --dry-run
npm run transport:import:lightsail -- --file "<Transportation Information v3.xlsx>" --apply
```

- **Tabs**: the airport tabs ("Arrival PHL 8th Pickup", "Arrival PHL 7 & 9 Pickup", "Arrival EWR
  8th Pickup", "Arrival EWR 7th & 9th Pickup", "Arrival OTHER", "Departures - PHL", "Departures
  EWR", "Departures - Others") are the team's working lists and win for the group, airport,
  date, time, airline and flight. The full-record tabs ("Transport - With Accom", "Transport - No
  Accom") fill in everyone else, mode and need pickup / drop-off, and `users.accommodation_package`
  ("Fee Description"). "Non EWR-PHL Airports" is only cross-checked; "Sheet1" (an email list,
  no longer used) is ignored.
- **Rules** (`src/lib/transportImport.ts`): one `transport_legs` row per person and direction,
  linked by `registration_id` (no foreign key: User Ids not imported as users yet are stored and
  listed). Dates and times are the wall-clock at that airport as given, never converted
  (`sort_at` reads them as Eastern, for ordering only). Merged "PICKUP Group" / "Group #" cells
  apply to every row they span; group identity = direction + airport + local date + group
  number. Driver / Driver Phone # are read when filled (drivers are expected from another sheet
  later). Placeholder flights and airlines ("TBD", "Na", "x") are stored blank.
- **`--apply`** upserts every planned leg by (User Id, direction), deletes legs whose person no
  longer has that leg in the workbook (people skipped for conflicting rows keep theirs), and sets
  `accommodation_package` on existing users only (a blank Fee Description never clears one). No
  other `users` column is written. Run it after the delegate import, so the packages land;
  legs are stored either way and link to people by User Id once they are imported.
- **Reported, never fixed** (User Ids only): every field where a tab and the full record
  disagree, duplicate rows (identical ones count once; conflicting ones skip that person's
  transport), far or code-only airports, dates outside the event, placeholder or missing
  flights, blank Need Pickup / Dropoff, and people whose registration says Yes but who are on
  no airport tab.
- **Delegates** see only their own legs on `/transportation` (and the home tile): date and time
  at the airport, flight, and their pickup / drop-off group with its size (never who else is in
  it) and the driver once assigned. A leg reads as "booked" only when it is on the team's tabs;
  a registration Yes alone shows as "requested".
- **Admins** see the read-only board in the console's Transport tab (`/admin/transport`):
  arrivals or departures (it opens on departures from Sat, Oct 10) by day (today when anyone
  travels today, else every day), airport and group with the group's driver, "Not grouped yet"
  (with a "Not on the arrival tabs" note for people the team has to add to the sheet), "No
  pickup needed", a search (name, BAPS ID, flight or phone), the console seva filter and the
  sheet's oddities as warnings. The Overview ends with a summary card linking to it.
- **Delegates' transport contact**: `/transportation` ends with "Need a change?" and the
  delegate's transport contacts, each with a Call button: the `hotlines` rows with role
  **DELEGATE** and topic **TRANSPORT** (or GENERAL) for their track. Without one the page shows
  no contact and never asks the guest to get in touch, and the admin board flags it. Add them
  with `npm run hotlines` (see "Help contacts").

The database needs the `transport_legs` table and `users.accommodation_package` first:
`npm run db:push:lightsail` once.

### Hotel rooming

Hotel room groups come from the organisers' rooming workbook ("FINAL Rooming List v17.xlsx"),
read at run time by `scripts/import-rooming.ts` (keep the file outside the repo). Same modes as
the other imports (`--plan` touches no database and `--out <json>` must be outside the repo;
then `--dry-run`, then `--apply` in one transaction):

```bash
npm run rooming:import:lightsail -- --file "<FINAL Rooming List v17.xlsx>" --plan --master "<App DataSet.xlsx>"
npm run rooming:import:lightsail -- --file "<FINAL Rooming List v17.xlsx>" --dry-run
npm run rooming:import:lightsail -- --file "<FINAL Rooming List v17.xlsx>" --apply
```

- **Tabs**: only the visible hotel tabs listed in `ROOMING_TABS` (`src/lib/roomingImport.ts`)
  are read: "eBKY Hampton Wednesday" (stay **WED**, the night of Wed, Oct 7: early arrivals) and
  "eBKY Hampton Thursday", "eBKY Courtyard", "eBKY-iBKY DoubleTree", "iBKY Hilton" (stay
  **MAIN**, from Thu, Oct 8). Each must be there, visible and with beds, and no other visible tab
  may have a "Mock Room" header; otherwise the plan has errors and nothing is written (so a
  renamed or hidden tab never deletes a hotel's worth of rooms). Hidden tabs are the organisers'
  working sheets and are ignored; "Summary V2" is only a cross-check of rooms per hotel and size.
  A renamed or new tab goes in `ROOMING_TABS`, a new hotel in `src/lib/hotels.ts`.
- **Rules**: a room group is (stay, hotel, "Mock Room" number). That number is the organisers'
  room **assignment**, shown as "Room group N"; the hotel's real room numbers come at check-in.
  One `room_assignments` row per person and stay, linked by `registration_id` (no foreign key:
  User Ids not imported as users yet are stored and listed), and one `room_groups` row per room
  group, whoever is in it. Names are never read from the workbook. A User Id on more than one bed
  row in a stay is skipped for that stay and listed; its beds show as held. Someone in the same
  room group on both nights reads "From Wed, Oct 7".
- **`--plan --master`** checks offline, against the master list, who would have an account and
  which room groups mix Bhaio and Behno. `--dry-run` / `--apply` run the same check against
  `users` (read only, never written).
- **`--apply`** upserts every planned room group and assignment and deletes those no longer in
  the workbook (people skipped for conflicting rows keep theirs). If the deletes would empty a
  whole hotel for a stay it refuses; check the dry run, then add `--allow-deletes` only if
  everyone there really has left.
- **Reported, never fixed** (User Ids, room keys, sheet names and row numbers only): conflicts,
  rooms mixing Bhaio and Behno (fine only as family / couple rooms), a different Wednesday room
  or a Wednesday night with no Thursday room, placeholder User Ids, unreadable or repeated bed
  numbers, room groups nobody could be placed in, and summary totals that disagree.
- **Delegates** see their own stay on `/stay` ("Your stay" in More, and the Accommodation tile on the home
  page): the hotel, "Room group N", from which night, their roommates' names and centers only (roommates
  not in the app yet are counted, not named) and the hotel's Hotel Liaison(s) (below), then
  their accommodation contacts under "Questions about your room?" (see "Help contacts"; left out
  when there are none). Until the list is imported the page says the details aren't available yet.
- **Hotel details**: `src/lib/hotels.ts` has each hotel's name; its full name, address, phone
  and check-in / check-out times are `null` until the organisers confirm them. Fill them in
  there (a deploy): the page then shows them, with Directions and Call hotel buttons.
- **Admins** see the read-only board in the console's Logistics tab (`/admin/rooming`, next to
  Transport): Wednesday night or from Thursday, by hotel, every room group with its occupants,
  open beds, held beds and notes, a search and the console seva filter.

The database needs the `room_assignments` and `room_groups` tables first:
`npm run db:push:lightsail` once (the import says so if they're missing).

#### Hotel Liaisons

Each hotel has points of contact from the rooming team for delegates with a hotel issue; a
hotel can have several for one track. A delegate staying there sees every liaison of their track
as "Hotel Liaison" ("Hotel Liaisons" when there are several) on their `/stay` card: name, number
and a Call button each (Bhaio see the Bhaio ones, Behno the Behno ones, anyone with no gender on
file both, each marked; one added with `--track all` shows to everyone there), by sort order,
then name. A hotel's liaisons show once, on its first card still on (a Wednesday-only card drops
them once that night is over); a hotel with none shows nothing. Admins see them in each hotel's
header on `/admin/rooming`, with a coral note where guests have none for their track.

The names and numbers live only in the database (`hotel_liaisons`, one row per liaison, from
`src/lib/hotelLiaisons.ts`), never in the repo. Manage them with `scripts/hotel-liaisons.ts`;
every option is checked before the database is touched, and the output has the names and the
numbers masked to their last 4 digits:

```bash
npm run db:push:lightsail          # once: adds the hotel_liaisons table (and, since 2026-10-01, lets a hotel and track have several)
npm run hotel:liaisons:lightsail -- --list
npm run hotel:liaisons:lightsail -- --add --hotel doubletree --track behno --name "First Last" --phone "(732) 555-0142" [--sort <n>] [--dry-run]
npm run hotel:liaisons:lightsail -- --set --hotel hampton --track bhaio --name "First Last" --phone "+17325550142" [--dry-run]
npm run hotel:liaisons:lightsail -- --remove --hotel doubletree --track behno [--name "First Last"] [--dry-run]
```

`--hotel` is a `src/lib/hotels.ts` key (hampton, courtyard, doubletree, hilton; the rooming
list's spellings such as "Hampton Inn" work too) and `--track` is bhaio, behno or all. `--add`
adds one more liaison for that hotel and track (it refuses a name already there); `--set`
replaces **all** of that hotel and track's liaisons with the one given; `--remove` deletes the
one named with `--name`, or all of that hotel and track without it. `--phone` takes any
US/Canada form or E.164 (no extension).

#### Help contacts

The event has no staffed help desk, so the hub names people to call. `/stay` ends with "Questions
about your room?" and `/transportation` with "Need a change?", each listing the delegate's help
contacts as cards: what the contact is for (the stored label, e.g. "Accommodation"), the person's
name, the number, the hours when set, and a Call button. They are the `hotlines` rows with role
**DELEGATE**: a line shows on `/stay` when its topic is **STAY** or GENERAL and on
`/transportation` when it is **TRANSPORT** or GENERAL, to the delegates of its track (Bhaio,
Behno, or all = both; anyone with no gender on file sees both tracks', each marked). The page's
own topic comes first, then the general lines, each by sort order. A page with no matching
contact shows no help block, and nothing on it asks the guest to get in touch. The admin
Transport and Rooming boards carry a coral note while delegates of a track have no contact.
The rule is in `src/lib/helpContacts.ts`.

The names and numbers live only in the database, never in the repo. Manage them with
`scripts/hotlines.ts` (options checked before the database is touched; numbers print masked):

```bash
# 1. deploy this code   2. push   3. add the contacts (the order matters: see below)
npm run db:push:lightsail          # once: adds hotlines.topic and hotlines.audience
npm run hotlines:lightsail -- --list
npm run hotlines:lightsail -- --add --role delegate --topic stay --track bhaio --label "Accommodation" --name "First Last" --phone "(732) 555-0142" [--availability "8 AM – 10 PM"] [--sort <n>] [--dry-run]
npm run hotlines:lightsail -- --add --role delegate --topic transport --track all --label "Transportation" --name "First Last" --phone "732-555-0142"
npm run hotlines:lightsail -- --remove --id <id> [--dry-run]
```

`--list` prints each line's id (for `--remove`) and how many contacts a Bhaio and a Behno
delegate see on each page. `--add` refuses a number or a name that a line shown beside the new
one already has (the same page and track, counting general and all), since one person would show
twice; to correct a line, `--remove --id <id>` and add it again. `--role sant` adds a line to
the Pujya Santo view instead (no `--topic` / `--track`: the Santo pages show every sant line).

**Order: deploy, then push, then add.** Until the schema is pushed the app keeps working: every
DELEGATE line shows on both pages to both tracks, as it did before, and `--add` (of a sant line
too) says to push first. From the first page view after the push the new code keeps each line to
its page and track. The code from before 2026-10-01 never does: it shows every DELEGATE line on
both pages to everyone, so a Behno contact added while it is still deployed is shown to Bhaio
delegates as well (and the reverse). So: (1) deploy this code, (2) `npm run db:push:lightsail`,
(3) `hotlines:lightsail -- --list` and remove any line that is out of date (lines from before
the push read as general, for everyone), (4) add the contacts.

### Dress code

`/dress-code` ("Dress code" in More) shows what to wear each day, as the organisers give it: the
delegate's own track (Bhaio or Behno; both when no gender is on file), one row per day from Thu,
Oct 8 to Sun, Oct 11, with today's row marked and the days gone by quieter. The content is the
`DRESS_CODE` table in `src/lib/dressCode.ts`; change it there and redeploy.

### Edison Mandir History

`/history` ("Edison Mandir History" in More, and the History band on Home) tells the mandir's
story from 1974 to 2019 as one scroll: five parts, each year a large numeral with its events
under it, a coral line that draws down the page as you read, and a sticky strip of the 18 years
to jump between them. Four events carry photographs (the Cultural Festival of India, the 1996
Murti Pratishtha, the 2017 Ghanshyam Maharaj Murti Pratishtha and the 2019 New Mandir
Mahotsav): each sits whole on a white mat, and a tap opens it full screen, where the phone may
be turned sideways for a larger view. The photographs are sacred images: they are always shown
whole and unaltered (never cropped, tinted, overlaid or animated), and their files are behind
the same session-cookie check as the hub's pages. On this page the bottom navigation stands on
an opaque band instead of floating as glass, so a photograph scrolling past is never blurred or
tinted through it. With reduced motion the page is the same story, standing still; without
JavaScript too, except that the coral line (CSS only) still draws as you scroll.

The events are the `HISTORY` table in `src/lib/history.ts` (the organisers' list; change the
wording there and redeploy). The photographs' web copies (`public/history/photos/`) and their
manifest (`src/lib/historyPhotos.ts`) are built from the originals, full frame, with

```bash
python scripts/build-history-photos.py "<folder with the twelve originals>"
```

(needs Pillow; the originals are named `CFI-1..3`, `MP96-1..3`, `GM17-1..3`, `MM19-1..3`).

### Venue map

`/map` ("Venue map" in More) shows every public room of the Edison mandir on its floor
(Basement, First Floor, Second Floor and, on top, the Mezzanine, or all four stacked in a 3D
view) under the organisers' own name for it ("Ashro", "Nij Mandir", "Sahajanand Hall"), finds a
room by that name, by an event name the sheets use ("Main Hall", "Mezzanine Ladies Office 3") or
by its number, and gives walking directions across floors: by the stairs (an elevator only when
their side's stairs don't get there), or by elevators only with Step-free. Directions start at
the Main Foyer unless the guest picks another start.

**Stairs and elevators by track** (organisers, 2026-09-30). Bhaio (gents, gender MALE) are routed
only over the stairs and elevators on the right of the map, Behno (ladies, FEMALE) over those on
the left; the From list leaves out the other side's stairs, and the map draws them faded. The
track comes from the person's gender, whatever their role: admins follow their own gender like
everyone else, and only an account with no gender on file may use every stair and elevator. When
their side's stairs don't reach a room the sheet says so ("please ask a volunteer") rather than
sending them the other way. The rules live in `src/lib/venue/route.ts`:

- `TRACK_SIDE` (`{ BHAIO: "right", BEHNO: "left" }`) says which side each track uses.
- `ELEVATORS_FOLLOW_SIDE` (true) applies the same split to the elevators. Set it to false if the
  organisers say the elevators are shared (the stairs stay split) and redeploy; nothing else
  changes. While it is true, **Behno with Step-free on can't reach the Mezzanine**: the only
  elevator that stops there is on the right. The sheet names the floor ("The elevators on the left
  (for Behno) don't reach the Mezzanine, where ... is") and offers the stairs.
- Each stair's and elevator's side comes from the map itself (see step 1 below): `right` or `left`
  of the first floor's central hall, as the app draws the map, overridable with `--side`.

**No stair or elevator numbers** (organisers, 2026-10-01). The building has no stair signs, so a
guest never reads "Stair 5" or "Elevator 1": not in the steps, on the map, in the From list, in a
failure message or on `/breakouts`. Each one is named by where it is, its `place` in the map data:
"the foyer stairs" and "the foyer elevator" (beside the main foyer), "the side stairs" (off to the
side, in the front half of the building), "the back stairs" and "the back elevator" (the far
half). With a guest's side that names exactly one; a guest with no gender on file, who may use
both of a pair, is told "the foyer stairs on the left". Stairs are plural ("take them up to the
Second Floor"). The wording is `connectorPhrase()` in `src/lib/venue/view.ts`, used by
`steps.ts`; the map's own stair / elevator rooms are named `shaftRoomName()` ("Foyer Stairs").
`toClientVenue()` applies both whatever the stored map says, so a map imported before 2026-10-01
(numbered names, no `place`) shows no numbers either: its directions just say "the stairs" / "the
elevator". The ids (`stair-5`) keep the blueprint's numbers, for admins (the `--plan` printout
and the "Map id" line an admin sees on a stair's room sheet) and the extractor's arguments only.

**Never through a restroom.** Directions keep to corridors, foyers and open floor: walking across
a room that is neither the start nor the destination costs three times as much, so a route does
it only where that is the way (the Mezzanine's offices open off Mahant Hall), and a restroom is
never a short cut, even one the blueprint draws with two doors (`THROUGH_RESTROOM` in
`route.ts`: crossed only if nothing else reaches the room at all).

**Staff-only rooms** (organisers, 2026-10-01). Rooms the organisers' own floor plans hatch as
STAFF ONLY but that are worth showing (an office, a staging area, the freight elevator) are
`closed` in the map data: drawn and named, found in search, but with no directions to them, from
them or through them (their floor isn't walkable). On the map they are hatched, as on the
organisers' plans, with a muted label, and a key under the map says what the hatch means (and
that the faded stair and elevator markers are the other track's); search lists them after the
rooms with directions and, like the room's sheet, says "Staff only"; the sheet has no Directions
button, they are never in the From list, and a `?to=` / `?from=` link to one opens with a plain notice
("... is for staff only"). They keep the blueprint's name. The freight elevator is one of them
("Freight Elevator"): it is for food, never a way for delegates. A breakout session listed in a
staff-only room (none should be) reads on `/breakouts` like a room that isn't on the map: no
directions and no link. That is different from back-of-house and private-quarters rooms, which
are plain grey blocks with no name at all.

**Room names** (organisers, 2026-10-01). The map labels rooms with the organisers' names, taken
from their labelled floor plans, not the blueprint's descriptions: `VENUE_ROOM_NAMES` in
`src/lib/venue/aliasTable.ts` (map id -> name), applied on the server when the map is prepared
for the browser, so the map, search, the room's sheet, the steps and `/breakouts` all say the
same. A room named there shows without its room number; where two rooms on one floor share a
name they are told apart by where they are on the map, not by a number nobody can read off a
door: "Cry Room at the back" / "at the front" (the main foyer is the front), "Samp Square on the
left" / "on the right" in the From list, "At the back" or "Left side" on the line under the name
(`twinSpots()` in `directions.ts`; the room number is the fallback for three of a name in a row).
A room found by
another name the sheets use shows that name with its own under it ("Main Hall" over "Second
Floor · Sahajanand Hall"; Main Hall, Sabha Hall and Sahajanand Hall are one room). "Mezzanine" as
a room name is Mahant Hall, so the steps read "Take the back stairs up to the Mezzanine", then
"Walk to Mahant Hall". **Samp Square is two places, one per track**: Behno are sent to the one
on the left of the map, Bhaio to the one on the right; a guest with no gender on file is offered
both, the nearer first. Search offers a room once, under the best-matching of its names (its
own when that matches as well), and also finds the plan's spelling "Nischay" and the Main Foyer
as "Lobby". On a phone every label stays inside the map's frame, and at whole-floor zoom a name
far wider than its room (a row of small offices) waits until you zoom in.

The guest's own breakout and goshthi rooms come first as one-tap chips, and the room names on
`/breakouts` link to it.

**The Pujya Santo view's map, `/sant/map`** ("Venue map" in the Santo More), is the same map for
santos. They are on the Bhaio track (`santVenueTrack()` in `src/lib/sant.ts`): the right-side
stairs and elevators, and the Bhaio Samp Square. It has the same Programme chips, `?to=` /
`?from=` / `?stepFree=1` links and "isn't available yet" state (in the Santo page style), no
rooms of their own (santos have no sessions of their own) and no admin panel; the room names on
`/sant/breakouts` link to it, and `AutoRefresh` skips it as it skips `/map`. Santos also see the
sadhus' residence on it: the rooms the user named for them (`SANT_ROOM_NAMES`: "Sarvasva" and
the numbered Santo Rooms) are labelled, searchable, a start and a destination, with directions
to and from them over the residence's own corridors and the stair / elevator landings only santos
use. Those corridors read as plain floor, unlabelled (no grey under the route), and the rest of
the residence stays a grey outline. Delegates and admins never get any of it (their `/map` is
unchanged), and a trip that neither starts nor ends in the residence is routed for santos exactly
as for delegates. The default start stays the Main Foyer.

**How to get there, on `/breakouts`.** Tapping a breakout card (or its "How to get there" row)
opens directions inside the card: from where the guest was just before the session (their
previous breakout, or the schedule item before it, such as the keynote hall or their goshthi
room, even when it ran over its time; a 15-minute "Travel" walk is looked past) to the session's
room, with the same steps, stairs rules, Step-free switch and failure wording as `/map`, and a link
to the same route there (the room name on the card links to it too; `/map` names the start as the
link does, so its first step reads "Start at the Main Hall" like the card's). When that previous place
can't be a start (their first session of the day or a bus ride, no room listed, a goshthi room not
confirmed yet, a room not on the map yet, a staff-only room) the directions start at the Main
Foyer and say why; a split session offers each of its rooms. Room names are looked up for the
guest's track, so "Samp Square" is their own (for an account with no gender on file, the
session's track's). When the session is in the room they're already in, the
card says "You're already there", whether or not that room is on the map. When the session's room
isn't on the map yet, the card still says where they're coming from and that the room isn't on
the map yet. Turning Step-free on applies to every card on the page, is remembered on that phone
and opens `/map` with Step-free on (`?stepFree=1`). Everything is worked out on the server
(`src/lib/venue/breakoutDirections.ts`); rooms the alias table doesn't map yet show as "not on the
map yet", so fill in `aliasTable.ts` to make more of them routable.

The map is made from the organisers' blueprint (a vector CAD PDF). **The blueprint and everything
made from it (the JSON, the report, the preview PNGs) stay outside the repo and out of
`/public`**: the extractor, the import and the dev fallback refuse paths inside the repo, and
`.gitignore` ignores `*.pdf` and the extractor's output names. The app reads the map from the
`venue_maps` table and sends signed-in pages only the public rooms by name: back-of-house rooms
(electrical, IT, storage, kitchen, ...) and the private quarters (the sadhus' residence with its
own corridors, the deities' rooms, the altar) arrive as plain grey outlines with no name, number
or id, and are never searched or walked through, for delegates; the Pujya Santo view also shows
the sadhus' residence (see `/sant/map` above and "Santos' quarters" below).

1. **Extract** (Python with PyMuPDF, NumPy, SciPy and Pillow; about two minutes):

   ```bash
   python scripts/venue/extract.py --pdf "<blueprint.pdf>" --out "<folder outside the repo>" [--debug]
   ```

   It writes `venue-map.json`, `report.json` (counts, what was dropped, the rooms treated as
   private quarters under `private_quarters` / `private_quarters_circulation`, each stair's and
   elevator's side under `connector_sides` and place under `connector_places`, and what every
   argument did) and `preview-<level>.png` per floor (dark grey = hidden, pale grey with a name
   = staff only; the dashed line is the central axis the sides are measured from, sample routes
   drawn for Bhaio and Behno by the app's rules in `route.ts`). Look at the previews. Every
   argument below is optional and can be repeated (`--help` lists them; the top of the script
   explains each):

   | Argument | What it does |
   | --- | --- |
   | `--public <room id>` / `--private <room id>` | Moves one room across the public / hidden line (a storage room the organisers use as an event room; a room that should be a plain block) |
   | `--closed <room id>` | STAFF ONLY on the organisers' plans: the room stays drawn and named but gets `closed: true`, no entry, and its floor is not walkable |
   | `--merge <room id>+<room id>` | One room of two (a hall whose sliding partition stays open): the partition leaves the walls and the walkable grid; it keeps the first id |
   | `--partition <room id>+<room id>` | Two rooms of one hall a movable partition divides (drawn dashed, closed for the event): their shared floor is split along the partition, so neither outline reaches past it |
   | `--passage <room id>` | A room walked through (an alcove between two rooms): its kind becomes corridor, so routes cross it at no extra cost; it keeps its name |
   | `--landing <connector id>:<level>=<x>,<y>` | Where guests reach that stair / elevator on that level, only when the organisers' floor plans put it elsewhere than the extractor finds it (the walkable cell nearest the point); not to follow a flow drawing's arrowhead, which ends at the stair room's wall |
   | `--name <room id>=<name>` | The organisers' name for a room (`"B-999=Large Banquet Hall"`), stored in the map itself: what the app shows for a room `VENUE_ROOM_NAMES` doesn't name |
   | `--drop-connector <connector id>` | Not a stair / elevator for guests at all (a freight elevator): no connector, and its rooms become staff-only "Freight Elevator" rooms (`--private <room id>` hides one of them) |
   | `--drop-landing <connector id>:<level>` | That stair / elevator doesn't serve that level for guests (`stair-9:B`); its room there becomes a plain block |
   | `--side <connector id>=left\|right\|none` | Overrides a stair's or elevator's side (`none` = everyone) |
   | `--place <connector id>=foyer\|side\|back\|none` | Overrides where a stair or elevator is in the building, which is how guests are told which one to take |
   | `--route <from id>:<to id>` | Draws that route on the previews |
   | `--not-sant <room id>` | A residence room or stair / elevator shaft the Pujya Santo view keeps private too |
   | `--sant <room id>` | A private room of the residence the Pujya Santo view also uses |
   | `--sant-class <room id>=own\|shared\|way` | Sets a residence room's class for santos (`own` = shown and named, `way` / `shared` = walkable, never shown) |
   | `--sant-open <santo room id>:<room id>` / `--sant-seal …` | Keeps open / seals the opening between a residence room and a room delegates walk (by default only openings a door swing covers stay open) |

   An id that isn't on the map stops the script (for `--public`, `--private` and `--route` it is
   only listed). Keep those ids on the command line and in a note beside the output (the
   arguments used for the event are the organisers' decisions: the next extraction needs the
   same ones), never in the repo. A stair or elevator room on a floor it doesn't serve for
   guests (a kitchen-side landing) is a plain block, not drawn as stairs. A toilet room the
   blueprint doesn't label, only counts fixtures in ("N URINAL"), is named from that note.

   **Santos' quarters.** After the delegates' map is finished the extractor adds what only the
   Pujya Santo view uses, without changing anything delegates get (it compares everything before
   and after and stops on any difference): the sadhus' residence rooms santos may use, each with
   a class (`own`: a sadhu's own room, shown to santos by its `SANT_ROOM_NAMES` name; `way`: its
   corridors, common area, stair / elevator shafts and a room that is the only way into an own
   room; `shared`: any other; the last two walkable, never shown), the residence floor added to
   the level's walkable grid as a separate `santGrid` (an opening onto the delegates' floor stays
   open only where a door swing covers it, so a glazed partition is no way in), and a stair's or
   elevator's landing that only santos use (`santPoints`). Never the deities' rooms, the altar or
   back-of-house rooms. These four fields are optional (`version` stays 1), so older app builds
   ignore them. A residence room the sealing cuts off, or without an entry, stops the script and
   says which (`--sant-open` if the blueprint draws a door there, else `--not-sant`).
   `report.json`'s `sant` key lists the rooms by class, the openings kept and sealed, the landings,
   the rooms left private, any own room reached only through another and the extra cells; the
   previews draw santo rooms pale violet with a dashed outline and santo landings as hollow squares.
2. **Try it locally** without the database: set `VENUE_DATA_FILE` in `.env.local` to the JSON's
   absolute path (development only, ignored in production and when `venue_maps` has a row), run
   the dev server and open More -> Venue map.
3. **Import** (plan -> dry run -> apply, like the other imports):

   ```bash
   npm run db:push:lightsail          # once: adds the venue_maps table
   npm run venue:import -- --file "<venue-map.json>" --plan     # checks the file; no database
   npm run venue:import:lightsail -- --file "<venue-map.json>" --dry-run
   npm run venue:import:lightsail -- --file "<venue-map.json>" --apply
   ```

   `--compare "<another venue-map.json>"` (outside the repo; any mode) compares what delegates get
   with that file (e.g. the one imported last); `--dry-run` and `--apply` also compare with the
   stored map. Both say whether the map apart from the Santo extras is identical and whether the
   delegates' payload (what `/map` and `/breakouts` send) is identical apart from `generatedAt`,
   and list what differs. **A difference stops `--dry-run` and `--apply`** (nothing is written)
   unless `--delegates-change` says it is meant (a new extraction after the organisers changed
   their plans).

   `--plan` prints counts, map ids and names the Hub already shows (never the blueprint's
   room descriptions):

   - per floor: rooms, public, staff only, back-of-house;
   - every stair / elevator by its id with its floors, its place and what guests read for it
     ("the foyer stairs"), and its side (who may use it);
   - the team names (`VENUE_ROOM_NAMES`): how many rooms guests can go to carry one, and the ids
     of those that keep the blueprint's name. **A team name for an id that isn't a public room
     on this map (hidden, a stair, or not on the map) is an error and stops every mode**: fix
     the table or the extraction first (re-extracting can renumber the unnamed "Open Area N"
     rooms);
   - the event names (`VENUE_ALIASES`): mapped, tentative (with what is assumed, to confirm with
     the organisers) and not on the map; any mapped id that isn't a public room, or is a
     staff-only room (listed, not fatal: those names read "not on the map yet");
   - the room names the Hub uses, against the table and this map: the team breakouts
     (`prisma/breakouts-data.ts`, each looked up for its track) and the schedule's places
     (`prisma/seed.ts`); `--dry-run` and `--apply` also count the goshthi rooms
     (`users.goshthi_room`, read only, counts only). A name "missing from the table" needs an
     entry in `VENUE_ALIASES`;
   - with Santo extras: a "Pujya Santo view" section (the residence rooms by class and map id, how
     many have an entry, the santo-only cells and landings), `SANT_ROOM_NAMES` coverage, and the
     route check (`scripts/venue-route-check.ts`): santos' trips between public rooms are exactly
     the delegates', and every residence room routes to and from the Main Foyer, its nearest
     public rooms, each floor's largest room, Sahajanand Hall, the Sant Offices and every other
     residence room santos are shown (Bhaio, Step-free off and on) without crossing a hidden or
     staff-only room or another sadhu's own room. **A problem in the Santo extras (validation, a
     `SANT_ROOM_NAMES` mismatch, a route-check error) stops every mode.** In the app such a map
     still works: santos just get the delegates' map, and admins see a count-only note.

   It refuses a map whose levels aren't ordered B < 1 < 2 < M (one extracted before 2026-09-30,
   when the mezzanine was taken to be between the first and second floors), and one where a
   staff-only room has an entry or walkable floor: extract it again.

   **A map imported before 2026-09-30 must be extracted and imported again.** Until then the hub
   still serves it with the mezzanine between the first and second floors and no stair sides
   (every guest may use every stair); admins see a note saying so under the map. One imported
   before 2026-10-01 keeps working as it is (no staff-only rooms, and directions that say "the
   stairs" / "the elevator" without saying which: the admin note says so); the new fields are
   optional, and the older code only lists them as unknown, so the map and the code can go out
   in either order. With such a map the team names still apply to the rooms it shows, and event
   names for rooms it hides (the banquet halls, the multipurpose room) read "not on the map yet"
   until the new map is imported.

   **After the organisers change their plans** (a room opened to delegates, closed to them,
   renamed, a hall's partition): re-run the extractor with the recorded arguments plus the
   change, update `aliasTable.ts` if a name or an id changed, then `--plan`, `:lightsail --
   --dry-run` and `--apply` as above.

**Flow rules** (the organisers' flow maps, 2026-10-04). How guests are to walk, beyond what the
building allows, is data stored with the map (`flowRules`; `src/lib/venue/flowRules.ts`), kept in a
rules file **outside the repo** (`flow-rules.json`: a list of rules, or `{ "rules": [...] }`), since
the rules name rooms, doors and stairs by their map ids. Kinds:

| Kind | Says |
| --- | --- |
| `doors` | A room is left (`exits`) / entered (`entries`) only by some of its doors (door ids from the extraction: `report.json` lists every public room's `door_openings`) |
| `stairs` | Trips to or from some rooms arrive on / leave their floor only by some stairs / elevators |
| `avoid` | Rooms never walked through on the way elsewhere: stepping into one costs a large penalty once, so a route that must cross it takes the short way (a trip from or to a room that opens onto one still goes through it) |
| `passage` | Rooms walked through freely; the steps name them ("Walk through the X to ...") |
| `side` | Stairs / elevators on the other side a track may also use |
| `route` | A last resort: one trip (from a room to a room) by waypoints (doors, a stair between two floors, points), Step-free off |

Every rule has an `id`, a `track` (`BHAIO`, `BEHNO` or `ALL`), an optional `window`
(`{ "day": "YYYY-MM-DD", "from": "HH:MM", "to": "HH:MM" }`, Eastern, end excluded) and an optional
`note` (never sent to a browser). The router applies them as costs, never as walls, so no route that
existed disappears. `/breakouts` uses the rules in force at each session's printed start, and when a
rule with a window applies then its `/map` links carry that time (`?at=`). `/map` and `/sant/map`
use the rules at `?at=` (while on an event day and not more than an hour gone, with a line under the
steps when they differ from now's), else at the page's time (`?now=` honoured), and refresh the page
when a window opens or closes. A browser gets only that set, narrowed to the viewer's track (no
gender on file: the `ALL` rules, and either track's doors). A problem in the rules means none apply
(never no map); admins see a count under the map.

Writing rules: keep each as narrow as the drawings show (a track, a window, one trip for a `route`
rule), and start a window about 15 minutes before its session, so it covers the walk there (`/map`
shows the rules in force when it is opened). The windows follow the printed programme: if a session
moves a lot on `/admin/schedule`, move its windows in the rules file and import again. The rules
file also keeps the open questions for the organisers.

To change them: edit the rules file, then

```bash
npm run venue:import -- --file "<venue-map.json>" --plan --flows "<flows.json>" --compare "<the map imported last>"
npm run venue:import:lightsail -- --file "<venue-map.json>" --dry-run --delegates-change
npm run venue:import:lightsail -- --file "<venue-map.json>" --apply --delegates-change
```

`venue:import` merges `--rules "<file>"`, else `flow-rules.json` beside the map file or in its
parent folder (`--no-rules`: none; needed to import a map extracted before 2026-10-04, e.g. a
rollback, since it has no door ids), prints the rules by kind with the rooms, doors and stairs each
names, and **stops on any problem in them**. Door ids are numbered along each side of a room, so a
re-extraction that adds, splits or merges an opening renumbers the doors after it: the import
compares every door a rule names with the same id in `--compare` and the stored row, and one that
moved more than a grid cell or leads into another room stops `--dry-run` / `--apply` until the rule
is checked against `report.json`'s `door_openings` (then `--doors-checked`).

`--flows "<file>"` runs the flow check (`scripts/venue-flow-check.ts`, also runnable on its own with
`--map`, `--flows`, `--rules`, `--baseline`, `--details`, `--out`): each of the organisers' drawn
trips against the app's route for that track at that time, as MATCH / DOOR / PATH / CONNECTOR, with
counts per group, the ids of trips that don't match, against `--compare` the regressions, and the
trips whose result changes with the rules taken 10 minutes earlier (on the way there). The flows
file is the organisers' drawings matched onto one extraction's grid: it is kept beside the venue
files, **outside the repo**, and has to be matched again after new drawings or a re-extraction that
changes room ids. Without `--flows` the import says the rules weren't checked. New or changed rules
change delegates' routes, so `--dry-run` / `--apply` need `--delegates-change`.

**The name tables.** `src/lib/venue/aliasTable.ts` (server only: importing it into a client
component fails the build) holds three tables:

| Table | Maps | Used for |
| --- | --- | --- |
| `VENUE_ROOM_NAMES` | map id -> the organisers' name for the room | What the room is called everywhere. Public rooms only; never stairs or elevators; a room without an entry keeps the blueprint's name |
| `VENUE_ALIASES` | event room name -> map ids | Every other name the Hub shows for a room: the breakout sheet's, the goshthi sheets', the schedule's ("Main Hall", "Mezzanine Ladies Office 3", "Ladies Multipurpose Room") |
| `SANT_ROOM_NAMES` | map id -> the name santos read | The Pujya Santo view only: the residence rooms santos are shown ("Sarvasva", the numbered Santo Rooms). Every such room needs one, nothing else may have one, and it is never sent to anyone but santos |

A `VENUE_ALIASES` entry is `["<map id>"]` (several ids for a room made of several),
`{ BEHNO: ["<map id>"], BHAIO: ["<map id>"] }` for a place there are two of, one per track
("Samp Square"), or `null` = not on the map yet (still found in search as "not on the map yet",
with no map link). `VENUE_ALIAS_TENTATIVE` lists the mappings that are assumed, each with what
is assumed, until the organisers confirm them; `--plan` and the admin note under the map list
them. To fill one in, sign in as an admin, open the Venue map and tap the room: the sheet shows
its "Map id" (admins only). Add it, run `--plan` to check, and deploy. Keep the tables to name
<-> id pairs: no blueprint descriptions or other room inventory in the repo.

`SANT_ROOM_NAMES` works differently. Admins can't tap a residence room (it is a bare outline for
them) and santos never see map ids, so take the ids from the "own (shown, named)" list in the
"Pujya Santo view" section of `--plan`. **Renaming** a room is an edit to the table and a deploy,
with no re-import. **Showing or hiding** a room needs an extractor flag (`--sant` / `--not-sant` /
`--sant-class`, recorded in the arguments note outside the repo), a re-extract, the matching edit
to the table and a `--plan` check, then the deploy and the import back to back. Until the deployed
table and the stored map agree, santos get the delegates' map.

### Tester accounts (static code)

A user with `test_code` set signs in with that fixed 6-digit code instead of an emailed one:
no email or SMS is sent, the code never expires and is never consumed. Use it for organisers,
app reviewers or anyone testing without a verified inbox. Create one with:

```bash
npm run user:upsert -- --env .env.lightsail --bapsId TEST0001 --name "Test Delegate" \
  --displayName Tester --seva Hospitality --gender MALE --testCode 102026
```

`TEST0001 / 102026` exists in both the local and Lightsail databases. Remove tester rows
(or clear `test_code`) before the event.

### Mirror test accounts (see the hub as a real delegate)

A tester DELEGATE account with `users.mirror_registration_id` set shows the delegate hub with
the data of the delegate who has that User Id: their Bhaio/Behno schedule, seva, goshthi group,
breakouts, transport and stay (roommates' names included), with a "Test account · showing data
for …" band under the header. Sign-in, the header name and the notification read state stay the
tester's own; nothing is written to the real person's row. It is honoured only when the app runs
with `ALLOW_MIRROR_TESTERS=true` (off by default) and never for admin accounts. A tester sant
account can mirror a real sant the same way (user, 2026-10-02), by his BAPS ID: see "Santo
mirror" under the Pujya Santo view. The admin Delegates page marks these accounts "Test · mirrors
User Id N" ("Test · mirrors BAPS ID X" for the sant tester).

`scripts/tester-personas.ts` creates ten of them, TEST0101–TEST0110, each picked to cover a
different situation (early Hampton, Courtyard/DoubleTree, Hilton, transport but no room, no room
or transport for each track, a seva with no team, an IBKY liaison, a mixed room group, driving /
no pickup):

```bash
npm run db:push:lightsail                              # once: adds users.mirror_registration_id
npm run testers:personas:lightsail -- --plan           # read only: persona -> User Id and why
npm run testers:personas:lightsail -- --apply          # create / refresh TEST0101-TEST0110
npm run testers:personas:lightsail -- --remove         # delete them
```

(`npm run testers:personas` does the same against `.env`.) The pick is the lowest User Id among
each persona's candidates (one no earlier persona took, where possible); a persona with no
candidate is skipped and reported. Each account gets its own random tester code (never TEST0001's),
kept in the git-ignored `.tester-personas.local` (JSON: BAPS ID → code) and never printed; open
that file to sign in. Tester codes are rationed (5 tries per 15 minutes, locked until reset after 3 lockouts; `--apply` or
`user:upsert --testCode` resets them). The accounts still show real people's data: run `--remove`
and set `ALLOW_MIRROR_TESTERS=false` once testing is done, and certainly before the event.

### Admin console

Users with `role = ADMIN` land on `/admin` after signing in (they can also use the whole delegate
app via "Delegate view"). A **Seva** filter bar on the Overview, Announce and Schedule pages (and
the Delegates page's seva filter) narrows the console to one or more sevas and stays set when
switching tabs (`?seva=` in the URL; picker counts include delegates, santos and admins). The
console has:

- **Overview**: people by role, sign-in rate, today's programme status (running late/early),
  recent announcements and schedule changes, quick actions. With a seva filter: people counts and
  announcements for those sevas, and "Where they are" (each picked team's breakout now and next,
  per track).
- **Delegates** (`/admin/delegates`): everyone in `users`, with search (also by registration ID;
  an exact ID match comes first), filters (role, seva, region, registration status, gender,
  signed in, code channel), sorting, and add/edit forms. The registration ID and center are
  editable; the other master-list details (seva wing, seva role, personal wing, status, goshthi
  group, room and moderator) are shown read-only because the import owns them.
- **Announce** (`/admin/announcements`): post to the notification bell for everyone or a group
  (role, Bhaio/Behno track, sevas, regions) with a live "reaches N people" count; send now or
  schedule for later; history with delete. With a seva filter the history lists what reaches
  those sevas ("Reaches N of M"), and "Target these sevas" fills the audience.
  Or send it to **specific people**: under Audience, search by name, BAPS ID or the organisers'
  User Id (delegates, santos and admins), tap the people, and it goes to exactly those accounts
  and to nobody else (the role / track / seva / region filters are shown switched off while people
  are picked, and are not used). A template (Prasang form, Venue Wi-Fi) tapped after picking people
  keeps them: it then goes only to those people. An unsent draft for specific people comes back
  after a reload with the same people; if they can't be brought back, the composer says so and
  won't send until you pick again or accept the audience shown. The history then reads "To N
  people" with their names and how many of those accounts still exist, and a personal announcement
  stays in its recipient's bell however many newer ones come in. Admins see the bell on the
  delegate pages (Home), not in the console. From the terminal: `npm run notify -- --to <BAPS ID>
  [--to <BAPS ID>]... --title "…"`. A mirror test account never sees the personal announcements of
  the delegate it mirrors. The people are stored in `notifications.user_ids` (added 2026-10-02):
  run `npm run db:push:lightsail` once. Until then everything else keeps working (the bell, the
  history, announcements to everyone or by filter, schedule-change notices) and sending to
  specific people answers that the database needs the update first. Keep this order: (1) deploy
  this code everywhere, (2) `npm run db:push:lightsail`, (3) send to specific people. A deployment
  still running code from before 2026-10-02 (or one rolled back to it) doesn't know the column: it
  shows a personal announcement to no one, not even the people it is for (the row is stored under
  a seva and region nobody has, "(specific people)"), so nobody else can ever read it, but those
  people only get it once the new code is running. Don't run `db push` from an older checkout once
  personal announcements exist: that would drop the column.
- **Schedule** (`/admin/schedule`): move the live programme when it runs late or early (shift,
  extend, exact edit, per-track or everything-after scope), with a preview, optional guest
  notification, a change log with undo, and reset to the printed times. Guests' schedules, the
  home-page clock and menu reveals follow within a minute and show "Delayed N min" badges. With a
  seva filter each Team Breakouts slot lists the picked teams' sessions.
- **Logistics**: two read-only boards behind a Transport | Rooming switch. **Transport**
  (`/admin/transport`, where the tab leads): the airport pickup / drop-off board from the
  transport import (see "Airport transport"), with a slim summary card on the Overview.
  **Rooming** (`/admin/rooming`): the hotel room groups from the rooming import (see "Hotel
  rooming").
- **Email bounces** (`/admin/bounces`, no tab: from the Overview card "Email bounces · N open" or
  a person's "Email bounced" note in the directory): sign-in emails SES couldn't deliver, one card
  per address (see "Email bounces" below).

`UN2998001` is the admin. Make someone an admin with `--role ADMIN` on the upsert script (or the
Role field in the Delegates page). Tester codes never work for admin accounts: admins always get
a real code by email/SMS.

### Email bounces

SES reports every sign-in email it couldn't deliver (a bounce, a spam complaint, or a reject) to
the SNS topic `naam-ses-bounces-complaints` through the `naam-hospitality-hub` configuration set.
The Hub keeps them so the organisers can follow up: `/admin/bounces` lists one card per address,
open first, then resolved. A card names the account(s) whose email is that address now (linking
to their directory entry; "No account with this address" once the email was changed), what SES
said in plain words ("Hard bounce", "Soft bounce", "Complaint", "Rejected", and the subtype such as
"No such address"), the receiving server's reply, when and how often, and a **Mark resolved**
button (with an optional short note) or **Reopen**. A new bounce of a resolved address opens it
again. The Overview shows "Email bounces · N open" while any is open (one quiet row once all are
resolved), and the directory notes "Email bounced" under the email of anyone with an open one.

What to do: a **hard bounce** puts the address on the SES account suppression list, and SES then
sends nothing more to it (later sign-ins show up as a hard bounce "Not sent: the address is on the
SES suppression list"). If the address is wrong, correct the person's email in the directory: the
new address isn't suppressed, so their next code goes out. If the address is right and the mailbox
works again, remove it from the suppression list (SES console → Configuration: Suppression list,
or `aws sesv2 delete-suppressed-destination --email-address <address>`). Then mark it resolved.
A **soft bounce** (a full mailbox, a busy server) may clear by itself.

How it arrives: the topic is subscribed to `POST /api/ses/events` (`src/app/api/ses/events/route.ts`),
which checks that the message is a validly signed SNS message (SignatureVersion 1 or 2, the
certificate fetched only from an `sns.<region>.amazonaws.com` https URL) from exactly the topic in
`SES_EVENTS_TOPIC_ARN` (unset: the endpoint is off, 404), confirms the subscription itself, and
stores one `email_events` row per affected recipient (a redelivery is stored once). It keeps only
what is needed to fix the address: never the subject (it holds the sign-in code), the headers, the
sender or the other recipients; any 6-digit number in a server's reply is masked. Rules in
`src/lib/emailEvents/` and `src/lib/admin/emailEvents.ts`.

Setup (once; the subscription goes to one deployment, the one guests use):

```bash
npm run db:push:lightsail       # adds the email_events table (additive)
# Vercel → the project → Settings → Environment Variables (Production):
#   SES_EVENTS_TOPIC_ARN = arn:aws:sns:us-east-1:<account id>:naam-ses-bounces-complaints
# then redeploy (npm run deploy:vercel), and subscribe the endpoint (raw message delivery stays off):
aws sns subscribe --region us-east-1 \
  --topic-arn arn:aws:sns:us-east-1:<account id>:naam-ses-bounces-complaints \
  --protocol https --notification-endpoint https://naam-five.vercel.app/api/ses/events \
  --return-subscription-arn
aws sns list-subscriptions-by-topic --region us-east-1 \
  --topic-arn arn:aws:sns:us-east-1:<account id>:naam-ses-bounces-complaints   # confirmed: no "PendingConfirmation"
# Bounces from before the subscription: the suppression-list entries that are Hub accounts' emails
npm run ses:bounces:lightsail -- --backfill --dry-run --profile <your AWS CLI profile>
npm run ses:bounces:lightsail -- --backfill --profile <your AWS CLI profile>
npm run ses:bounces:lightsail -- --list      # counts, and per open address the BAPS ID
```

`--backfill` reads the account suppression list with your AWS CLI credentials (it needs
`ses:ListSuppressedDestinations` and `ses:GetSuppressedDestination`; the app's send-only keys
can't, so pass `--profile` when a dotenv file sets them). The AWS account is shared: only entries
whose address is a Hub account's email are stored or printed; the others are only counted. To test
the whole path, send one email through the configuration set to SES's bounce simulator
(`bounce@simulator.amazonses.com`): it shows up as a hard bounce with "No account with this
address" (mark it resolved afterwards).

### Pujya Santo view

Users with `role = SANT` get a separate view under `/sant` (the delegate hub redirects them
there): the Santo general schedule (Mon Oct 5 – Thu Oct 15, not the delegate programme) plus
their own personal programme (see "Santo personal programmes" below), their own menu (`/sant/menu`:
meals with `menu_for = SANT` from the kitchen team's Santo menu, every meal open from the
start, unlike the delegate menu; see "Santo menu" below), the breakout sessions they can join
(`/sant/breakouts`: santos have none of their own; every Bhaio team breakout that isn't held
together with Behno, in blocks such as "Friday afternoon"; see "Santo breakouts" below), the
venue map (`/sant/map`, see "Venue map"), their accommodation (utaro, with the other santos
staying there) and the transport hotline. Data lives in `sant_general_schedule_items`,
`sant_schedule_items`, `sant_accommodations` (an utaro shared by one or more santos via
`users.sant_accommodation_id`) and `hotlines` (helpers in `src/lib/sant.ts` and
`src/lib/santSchedule.ts`). Santos are shown by name only, e.g. "Nityavivekdas" (`santName()`
drops any "Pujya", "Sadhu" or "Swami"). The Santo home and both schedule tabs count their days
over the eleven Santo days ("Live · Day 4 of 11"), not the four NAAM days.

The santos' contacts are the `hotlines` rows with role SANT, each with a topic (the organisers'
"General Contact Info", 2026-10-04): TRANSPORT (the transport contact, the `transport-hotline`
row) on `/sant/transport` and the home's Transport tile, STAY (utaro / laundry) in `/sant/stay`'s
Contacts, GENERAL on both, lowest sort first. Names and numbers live only in the database: see
them (phones masked) with `npm run hotlines:lightsail -- --list`. To change one, edit the row in
Prisma Studio (`npm run db:studio:lightsail`), or `-- --remove --id <id>` and `-- --add --role sant
--topic <general|stay|transport> --label "…" --name "…" --phone "…"`; the pages pick it up at once.
Each utaro's host (name, phone) and notes (the Wi-Fi password, the organisers' introduction of
the host family) are set with `npm run sant:utaro -- --env .env.lightsail --id <utaro> --host "…"
--hostPhone "…" --notes "…"`, database only.

The tester sant `SANTO0001 / 604613` (Lightsail) comes with sample personal items and a sample
utaro shared with two sample santos (`SANTO0002`, `SANTO0003`, who cannot sign in; all ids
`sample-…`). The seeder only adds the sample hotline while no real one exists. It makes no menu:
the real Santo menu comes from `npm run sant:menu:sync` (a sample menu an older version left,
`sample-santo-meal-*`, is deleted by either). It makes no breakouts either: santos have none of
their own (sample Santo breakouts an older version left, `sample-santo-breakout-*`, are deleted
by a run and by `--remove`). Recreate the tester with:

```bash
npm run sant:demo -- --env .env.lightsail
```

Before the event remove all of it (the three sample santos, their items, the sample utaro and
every `sample-*` hotline, meal and breakout, and SANTO0001's mirror with him; never the real
Santo menu, `sm-*`) with:

```bash
npm run sant:demo -- --env .env.lightsail --remove
```

#### Santo mirror (see the Santo view as a real sant)

To see the Santo view as a real sant sees it (his personal programme, his rides, utaro and the
santos staying with him, his seva and region), make SANTO0001 mirror him by
his BAPS ID (user, 2026-10-02):

```bash
npm run sant:demo -- --env .env.lightsail --mirror AS1801   # SANTO0001 shows AS1801's data
npm run sant:demo -- --env .env.lightsail --mirror off      # back to his own sample data
```

`--mirror` sets only SANTO0001's `users.mirror_registration_id` (for a sant tester it holds the
mirrored sant's BAPS ID, matched case-insensitively; santos have no User Id). It refuses, writing
nothing, unless SANTO0001 is the sample sant and exactly one other sant has that BAPS ID, and it
prints the BAPS ID and the sant's plain name, never the code. It needs a SANTO0001 made by a
plain run first; a plain run keeps the mirror, `--remove` ends it with him, and `--mirror` with
`--remove` is an error. Like the delegate mirror accounts it works only while the app runs with
`ALLOW_MIRROR_TESTERS=true`: signing in as SANTO0001 then shows the Santo pages with that sant's
data under a "Test account · showing data for … (BAPS ID …)" band; the header name, the bell and
its read state, and announcements sent to specific people stay SANTO0001's own, and nothing is
written to the real sant's row. It shows a real sant's utaro and programme behind a static
code: run `--mirror off` (or `--remove`) and set `ALLOW_MIRROR_TESTERS=false` once testing is
done, and certainly before the event.

#### Real santos and utaros

The final list of santos comes from the organisers' "Pujya Santo Info" spreadsheet, and where
each stays from the "Updated Accomodations" tab of their Santo workbook ("TEJBHAI THIS IS
EVERYTHING BUDDY - Version 1 (1).xlsx", 2026-10-03, which replaced the "Santo Accommodations"
spreadsheet), in `prisma/santos-data.ts` (33 santos, 9 utaros). The 2026-10-03 tab moved four
santos (CM1801, NS2301, JT2101, AC1801); it also lists four santos with no BAPS ID on the list,
who are not added until the organisers send their account details, and leaves out GS0002, who
stays at the Premanand room on the user's word (the file's header has the details). Import them
with:

```bash
npm run santos:import:lightsail -- --dry-run   # only print what would change
npm run santos:import:lightsail                # the shared Lightsail database
npm run santos:import                          # local database
```

- **BAPS ID** is the part of the sant's BAPS ID email before "@", upper-cased (`NV0001`); the
  email is the whole address, lower-cased, and is where his sign-in code goes.
- **Name** is always `<Name>das`: "P."/"Pujya" and "Swami" dropped and "das" appended once
  ("Nityavivek Swami" → "Nityavivekdas").
- Every sant gets role SANT, gender MALE, seva "Pujya Santo" and the email channel, and is placed
  at his utaro. `test_code`, `display_name` and `breakout_sessions` are never changed, an ADMIN
  with one of these BAPS IDs is skipped (never demoted), and nothing is deleted: SANT accounts and
  utaros not in the data (the tester and its samples) are only listed.
- **Utaros** are named places only: one per haribhakta home ("Chaganbhai's home") and one per
  Mandir room ("Mandir · Nityanand room"), with stable ids (`utaro-*`), so a re-import updates
  them in place. The Santo view shows an utaro by name (with companions, host and notes); it never
  shows an address, and the imported utaros have none.

For one-off changes, add a sant with `--role SANT` on the upsert script, and place santos at an
utaro with:

```bash
npm run sant:utaro -- --env .env.lightsail --place "Patel residence" --host "…" --hostPhone 7325550100 --santos SANTO0001,SANTO0002
npm run sant:utaro -- --env .env.lightsail --list   # notes show as "set (N characters)"; --show-notes prints them
```

#### Santo general schedule

The "Master Schedule" tab of the organisers' Santo workbook (Oct 5–15; one event column a day,
headed "Pujya Santo" on Oct 8–10; 2026-10-03, replacing the "Santo Schedule" sheet) is generated
into `prisma/sant-schedule-data.ts` by a reader kept outside the repo (regenerate it rather than
editing by hand; its header lists how the tab is read). The update sessions where the earlier
sheet had "Pujya Santo Session" (Fri 11:00–12:30 and 15:00–16:30, Sat 11:00–12:30) are listed by
name in Yogi Hall, the place the santos' own sheets give, so no general item is a breakout and
none links to `/sant/breakouts` (which is unchanged).
`prisma/sant-schedule.ts` checks it (days, times, overlaps, no sheet shorthand) and syncs it into
`sant_general_schedule_items` (ids `ss-<day>-<HHMM>-<title>`). The sync owns the whole table, so
rows no longer in the data are deleted. `npm run db:seed` runs it too; on its own:

```bash
npm run sant:schedule:sync:lightsail -- --dry-run
npm run sant:schedule:sync:lightsail
npm run sant:schedule:sync                     # local database
```

It is the General tab of `/sant/schedule` and drives the Santo home's countdown / live clock and
General schedule tile. Moves made in `/admin/schedule` never touch it (no "Delayed" badges).
`SANT_DAYS` in `src/lib/time.ts` must list the same days as the data file; the sync refuses to
run otherwise. The table has to exist first: `npm run db:push:lightsail` once.

#### Santo menu

The kitchen team's Santo menu (Thursday dinner to Sunday breakfast; first their "BKY NAAM SANT
MENU" Google Sheet, since 2026-10-03 the "Menu" tab of the Santo workbook: one block per day, read
by position because every block's heading says "Thursday, Oct 8") is transcribed into
`prisma/sant-menu-data.ts`: only its Meal, Category and Item Name columns, never the
quantities, the people making or bringing a dish, follow-ups or statuses.
Each meal names the Santo general schedule item it is served in (`slot`, e.g. "Dinner & Dessert")
and takes that item's name, times and place, so the menu and the Santo schedule agree. The
category is the dish's course (the sheet's "(Option N)" / "(Dish N)" dropped), "Baked Goods" rows
(under the Meal "Sweets") join the meal above them (a dish that meal already lists is not repeated: the
sheet counts batches, the menu lists dishes), a dish the sheet marks TBD shows a "Tentative" tag,
and dish names are spelled as the kitchen spells them. The file's header lists every wording
change. `prisma/sant-menu.ts` checks it and syncs it into `meals` (menu_for = SANT, ids
`sm-<day>-<meal>`) and `menu_items`; the sync owns every SANT meal (others, such as an old sample
menu, are deleted) and never touches the delegate menu. `npm run db:seed` runs it too; on its own:

```bash
npm run sant:menu:sync:lightsail -- --dry-run
npm run sant:menu:sync:lightsail
npm run sant:menu:sync                         # local database
```

When the kitchen changes the sheet, edit `prisma/sant-menu-data.ts` and sync again; when a meal
moves in the Santo schedule, sync the menu after `sant:schedule:sync`. Moves made in
`/admin/schedule` never move the Santo menu. The Santo menu is never locked: every meal shows its
dishes from the start (a meal that is over shows as "Served"), the Santo home's Menu tile features
the meal on now or next, and the santos' bell has no "menu is out" releases (`menuIsTimed()` in
`src/lib/schedule.ts`; only the delegate menu is revealed meal by meal).

#### Santo personal programmes

Each sant's own programme ("My schedule" on `/sant/schedule`, and the Santo home's programme card
and My schedule tile) comes from the "Individual Schedule" tab of the Santo workbook, generated
into `prisma/sant-personal-data.ts` by scripts kept outside the repo (regenerate it rather than
editing by hand; its header lists how the tab is read and every wording change). On the user's
word (2026-10-03) the tab's "Santo Breakout" rows are left out (they repeat the general
schedule's update sessions in Yogi Hall), and so is "Pujya Yoganand Swami", who has no account;
17 santos have items. One reading is to confirm with the organisers: SY0702's "Morning Mandir
Aarti" on Oct 9 says 7:00 PM and is read as 7:00 AM. `prisma/sant-personal.ts` checks it (BAPS IDs
in `prisma/santos-data.ts`, Santo days, times in order without overlaps per sant, known kinds, no
sheet shorthand) and syncs it into `sant_schedule_items`, ids
`sp-<BAPS ID lower-case>-<day>-<HHMM>-<title slug>` (e.g.
`sp-vd2101-2026-10-08-1700-mukhpath-testing`), in one transaction:

```bash
npm run sant:personal:sync:lightsail -- --dry-run   # what would change, per sant (BAPS ID and name)
npm run sant:personal:sync:lightsail
npm run sant:personal:sync                          # local database
```

The santos must be imported first (`santos:import`): a BAPS ID without an account, or with an
account that isn't a sant, stops the sync before anything is written. The sync owns every `sp-`
row (new ones created, changed ones rewritten, those no longer in the data deleted) and never
touches the others: the tester SANTO0001's sample programme from `sant:demo` is only counted. A
run that would delete every `sp-` row of a sant (one dropped from the data) writes nothing unless
given `--allow-deletes`. The seed does not run it. The pages read the rows per account through
`dataUserId`, so the Santo mirror shows the mirrored sant's programme.

#### Santo breakouts

Santos have no breakout sessions of their own (user, 2026-10-02): they join whichever team
breakout they like, Bhaio sessions only, never a Behno one, and of the sessions both tracks hold
only the ones the organisers mark "Santo joining".
`/sant/breakouts` lists the real team breakouts (the `bk-*` rows of "Team breakouts" below, with
their live moves from `/admin/schedule`; never `users.breakout_sessions`, a seva match or the old
Santo sample rows), folded into sessions as the display API folds them
(`src/lib/breakoutSessions.ts`). Of the Bhaio sessions, a "combined" one (one a Behno session
shares, on the same day, at overlapping times and in at least one of the same rooms:
`isCombined()` in `src/lib/santBreakouts.ts`) is left out unless the organisers mark it "Santo
joining": the sheet's #fcddb5 cells on the Bhaiyo grid (the Data tab's Type "Santo joining"),
eight on 2026-10-02, recorded as `santos` on those entries in `prisma/breakouts-data.ts` (`true`
for the whole session, or the part santos join, e.g. FERA on Friday 11:45 AM – 12:00 PM). A marked
session shows at that time (it follows the session's live moves) with a "Santo joining" chip,
and its blocks, Now / Done and the home tile go by that time. Today's data gives 59 sessions.
They come in **blocks**: per day, sessions
that overlap or follow on without a gap are one block, named by its weekday and part of the day
("Friday morning" before noon, "Friday afternoon" before 5 PM, else "evening"). Today's data gives
Friday morning (11:00 AM – 12:30 PM, 22 sessions), Friday afternoon (3:00 – 4:30 PM, 15) and
Saturday morning (11:00 AM – 12:30 PM, 22).

Each block is a card (its date, time span, how many sessions, a Now / Up next / Done chip);
tapping it shows its sessions: the title, its own times when they differ from the block's, the
"Santo joining" chip on a marked one, the note ("Split amongst these rooms.") and the rooms, each opening `/sant/map` on that room when it
is on the venue map for the Bhaio track (else plain text, "Not on the map yet"). The block on now
opens by itself, else the next one; in it, a session already over is quieter and marked Done.
On the Santo schedules a Breakout row reads "See the sessions you can join" and leads here. The
Santo home's Breakouts tile shows the block on now ("Now ·
until 12:30 PM") or the next one, with its number of sessions, then "All breakout blocks are
over". Nothing to edit here: the blocks follow `prisma/breakouts-data.ts` and
`npm run breakouts:sync` (a change to a `santos` mark alone needs only a deploy: it is not stored
in the database).

### Previewing a moment during the event ("time travel")

With `ALLOW_TIME_TRAVEL=true` (default in `.env.example`), append `?now=` to any hub page to
render it as if it were that moment in Eastern time. The bottom navigation keeps the
parameter while you move between pages.

```
http://localhost:3000/dashboard?now=2026-10-09T13:45   # Breakout Session 4 in progress
http://localhost:3000/menu?now=2026-10-09T11:45        # lunch menu just revealed
http://localhost:3000/schedule?now=2026-10-08T09:50    # keynote in progress
http://localhost:3000/sant/schedule?tab=general&now=2026-10-06T10:00   # Santo general schedule, Tue Oct 6
http://localhost:3000/sant/menu?now=2026-10-09T12:00   # Santo menu (every meal open), Friday
http://localhost:3000/sant/breakouts?now=2026-10-09T15:30   # Friday afternoon block on now
```

Set `ALLOW_TIME_TRAVEL=false` in production.

---

## How it works

For the full stack rundown, request-by-request data flow, and production deployment
requirements, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

### Sign-in flow

1. `POST /api/auth/request-otp` looks up the BAPS ID. If found, it generates a 6-digit code,
   stores an HMAC of it (`OtpCode` table, 10-minute expiry, max 5 sends per 10 minutes),
   and sends it via the guest's preferred channel (email or SMS). A resend does not cancel the
   earlier codes: sign-in emails can reach some mailboxes late, so any unexpired code the guest
   was sent works. The limit is counted and the code stored under a per-user advisory lock
   (parallel requests can't store a sixth; lock waits in that transaction are capped at 2
   seconds, then a 503); a code whose delivery failed is removed again and doesn't count
   (unless a guess was already tried against it: then it is kept, ended, and counts). Past the
   send limit the answer is a 429 with `Retry-After`,
   `retryAfterSeconds`, `codesUsable` (can a code already sent still sign them in?) and a
   message saying how long to wait ("Too many codes requested. Please try again in about 7
   minutes." plus whether the codes already sent still work). The form's Resend button
   (available 60 seconds after a send) counts down to it; while a sent code is still usable the
   guest can go on entering it, otherwise the form says a new code is needed.
2. `POST /api/auth/verify-otp` checks the code against every live code of that guest: a try is
   claimed on each of them first (one `UPDATE … RETURNING` that locks the rows in id order and
   re-checks them, so parallel requests get no extra guesses and can't deadlock), then the code
   is compared with the ones it claimed. Each code allows 5 tries, so five wrong tries end every
   code the guest holds and a new one is needed (the fifth is answered "Too many incorrect
   attempts" itself). An older code typed after it expired, while a later one still works, is
   answered "That code has expired. A code we sent you later still works, or you can request a
   new one." Only codes created within the send limit are
   ever compared (the claim checks that itself, whatever wrote the rows), so the codes sent in
   any 10 minutes are worth at most 5 × 5 = 25 one-in-a-million guesses. A match
   ends all the guest's codes in one statement (the one that signed in is accepted again for 2
   minutes, for mobile autofill's double submit). A database error in either route is a JSON 503
   asking to try again. The sign-in time (`last_sign_in_at`) is recorded without ever waiting
   on the guest's row: while an import holds it, that sign-in is simply not recorded. It then
   issues a 7-day JWT in an httpOnly cookie, plus a
   2-minute `hh_splash` cookie. The login page
   is covered by the Sāchu wallpaper (light or dark, following the phone's appearance) while
   home loads; home opens on the same wallpaper, which blurs away to reveal the page. The
   middleware uses the cookie up on that first page request, so a reload (or a tap before the
   page's JavaScript has loaded) doesn't replay it (`src/lib/splash.ts`, `LoginSplash`).
3. `src/middleware.ts` guards the signed-in pages (`/dashboard`, `/schedule`, `/menu`,
   `/breakouts`, `/transportation`, `/stay`, `/map`, `/dress-code`, `/history`, `/profile`,
   `/sant`) and sends
   signed-in guests straight past the login page. Santos land on `/sant`.

Delivery providers live in `src/lib/otp/providers/`. Switch with `OTP_PROVIDER=console|aws`.

### Schedule, "happening now" and menu reveals

- The schedule and menus in `prisma/seed.ts` are transcribed from the organisers' files
  ("NAAM 2026 - Block Schedule" spreadsheet, its "2026 NAAM Schedule" tab, updated Sept 25
  2026, and the "BKY NAAM 2026 Menu Final v1" spreadsheet of Sept 26 2026). Items they mark as
  TBD are tagged "Tentative"; meals without a slot on the block schedule (Thursday breakfast,
  lunch and the welcome snack during check-in) carry placeholder times marked "Time to be
  confirmed". The Wednesday arrival dinner in the menu file is left out until the organisers
  say who it is for.
- Friday and Saturday have separate Bhaio/Behno tracks. Each item has an `audience`
  (ALL/BHAIO/BEHNO) and the app shows a guest the ALL items plus their gender's track; guests
  with no gender on file see both tracks with labels.
- Schedule items are stored in UTC and displayed in `EVENT_TZ` (default `America/New_York`).
- `annotateSchedule()` marks the item in progress as **Now** and, when nothing is in
  progress, the next item as **Up next**. Pages re-render every 60 s (`AutoRefresh`).
- A meal's menu is revealed at **max(previous meal ended, meal start − 1 hour)**. For
  example lunch at 12:30 is revealed at 11:30, as long as breakfast has ended. After a meal
  ends it collapses into a "Served" card that can still be expanded. See
  `revealTime()` in `src/lib/schedule.ts`. This is the delegate menu only: the Santo menu is
  open from the start (`menuIsTimed()`).
- A delegate's breakout sessions are their linked `breakout_sessions`, else the team breakouts
  for their seva on their track (see "Team breakouts"). Santos have none of their own: they join
  any Bhaio session that isn't combined (see "Santo breakouts").

Menus are vegetarian as supplied by the organisers.

### Venue Wi-Fi

The venue network, `BAPS_5G`, is open (no password), so there is no Wi-Fi page. Tell guests
with the **Venue Wi-Fi** template in the admin announcements composer
(`src/components/admin/announcements/templates.ts`). It has no link, so tapping it in the
bell opens the full-screen reader.

### Display API (TV screens)

The screens around the mandir are built by another developer from a small read-only JSON
API: `GET /api/display/schedule`, `/menu`, `/breakouts` and `/now`. It serves the same
data through the same rules as the delegate hub (live delays, menu reveals, breakouts per
track) and no personal data. It is off until `DISPLAY_API_KEYS` holds at least one key
(comma-separated, 24+ characters; one per screen developer or device group, so one can be
revoked alone):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Hand the key over privately. Everything the other developer needs (auth, parameters, every
response shape, polling guidance) is in [docs/DISPLAY_API.md](docs/DISPLAY_API.md); the code
is `src/lib/display.ts` and `src/app/api/display/`.

### Data model (`prisma/schema.prisma`)

| Table                 | Purpose                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------- |
| `users`               | `baps_id`, `name`, `seva`, `email`, `phone`, `gender`, `preferred_channel`, `breakout_sessions`; from the master list: `registration_id` (the organisers' "User Id", unique link key), `center`, `personal_wing`, `seva_wing`, `seva_role`, `registration_status`, `goshthi_group`, `goshthi_room`, `goshthi_moderator`; from the transport workbook: `accommodation_package` |
| `otp_codes`           | Hashed one-time codes with expiry and attempt counters                                    |
| `schedule_items`      | The shared event timeline (arti, sessions, breaks, meals, free)                           |
| `meals` / `menu_items` | Meals with their own times (optionally linked to a schedule slot), grouped by course; `menu_for` = DELEGATE or SANT (two separate menus) |
| `breakouts`           | Breakout sessions: one row per team per track (`seva` = canonical team code, `audience` = BHAIO / BEHNO / ALL), title, room(s), note (`description`), times |
| `notifications`       | Announcements for the header bell, with optional role/seva/region targeting, or `user_ids` = the specific accounts a personal announcement is for (menu releases are derived, not stored) |
| `schedule_changes`    | Audit log of live schedule adjustments (who, what, per-row snapshot for undo)             |
| `sant_schedule_items` | A Pujya Sant's personal programme (`users.role = SANT`); the real santos' rows (`sp-*`) only from `npm run sant:personal:sync` |
| `sant_general_schedule_items` | The Santo general schedule, Oct 5–15 (written only by the sync; never moved live)  |
| `sant_accommodations` | An utaro shared by one or more santos (`users.sant_accommodation_id`): place name, host, notes (`address` is never shown) |
| `hotlines`            | Phone lines per role: the santos' transport hotline (SANT) and the delegates' help contacts (DELEGATE, each with a `topic` GENERAL / STAY / TRANSPORT and an `audience` BHAIO / BEHNO / ALL), shown on `/stay` and `/transportation` (`npm run hotlines`) |
| `transport_legs`      | One airport arrival / departure per person (`registration_id`, no foreign key): mode, need pickup / drop-off, airport, wall-clock date and time, airline, flight, group, driver (`npm run transport:import`) |
| `room_assignments`    | One hotel room group per person and stay (WED / MAIN), keyed by (`registration_id`, `stay`), no foreign key: hotel, room group number, bed, `room_key`, capacity, open beds (`npm run rooming:import`) |
| `room_groups`         | Every room group per stay, whoever is in it: hotel, number, capacity, open beds, beds held by skipped User Ids (`npm run rooming:import`) |
| `hotel_liaisons`      | Each hotel's points of contact, several per track (`hotel` key, `audience` BHAIO / BEHNO / ALL, name, E.164 phone, `sort_order`), shown on `/stay` (`npm run hotel:liaisons`) |
| `venue_maps`          | The venue map (row "current"): floors, walls, rooms, stairs / elevators and walkable grids as JSON, from the blueprint via `scripts/venue/extract.py` (`npm run venue:import`) |

`users.breakout_sessions` is a `text[]` of `breakouts.id` values (delegates only: the Santo view
ignores it). Prisma cannot model a nullable array, so "not linked yet" is the empty array `{}`;
the delegates' Breakouts page then falls back to the team breakouts for the user's seva on their
track (next section). To pin a delegate to specific sessions instead, fill `breakout_sessions`
(`--breakouts` on the upsert script).

Event content lives in `prisma/seed.ts`; `npm run db:seed` rewrites `schedule_items` and the
delegate menu (`meals` with `menu_for = DELEGATE` and their `menu_items`), syncs the team
breakouts, the Santo general schedule and the Santo menu, and never touches
`users` unless `SEED_MOCK_DATA=true` (the real santos come from `npm run santos:import`, the
delegates from `npm run delegates:import`).

### Team breakouts

The organisers' live "NAAM_Breakout_Room_MASTER_synced" Google Sheet (the Bhaiyo and Behno room grids, as read 2026-10-01) is transcribed into
`prisma/breakouts-data.ts`: one entry per session with its track, day, times, title, teams
(canonical team codes) and rooms. `prisma/breakouts.ts` expands it into one `breakouts` row per
team per track (id `bk-<track>-<day>-<HHMM>-<team>`, e.g. `bk-bhaio-sat-1100-bm-ra`; `audience`
BHAIO or BEHNO) and syncs those rows. After editing the data file:

```bash
npm run breakouts:sync                     # local database
npm run breakouts:sync -- --dry-run        # only print what would change
npm run breakouts:sync:lightsail           # the shared Lightsail database
```

The sync creates, rewrites and deletes `bk-*` rows only (mock rows and the Santo `sample-*`
rows are never touched). Rows are compared on their printed times, so a session moved live from
`/admin/schedule` keeps its move (a full `db:seed` resets live moves, as it does for the
schedule). The Lightsail database needs the `breakouts.audience`
column first: run `npm run db:push:lightsail` once before the first sync there.

A guest sees the sessions whose team matches their seva (`teamCodesFor()` in
`src/lib/teams.ts`, which also accepts spellings such as "Satsang Admins" for SA, "Campus" for
CE, "BKRPC & RGCs", "BKSTL" for BSTL + KSTL or "RMC" for "RMCs + RMCAs") on their track: Bhaio
for men, Behno for women, both when no gender is on file. Santos instead see the Bhaio sessions
they can join (see "Santo breakouts"). In the sheet, the
lower-case prefixes are the organisers' shorthand for Kishore / Kishori: `e` = Bhaio, `i` =
Behno, `ei` = both; the app never shows them, nor headcounts or the sheet's room numbers, and
never calls a session "joint" (a session for both tracks is simply listed in each). A team split
across several rooms lists all of them with the note "Split amongst these rooms." until the
per-person split is final.

A delegate with a goshthi group sees it at the top of `/breakouts` with its room ("Your goshthi
group: Kishore Group 4 · <room>", "Your group: Goshthi Group 12 · <room>"; `goshthiFor()`,
`goshthiGroupLabel()`); moderators aren't shown in the hub. Each group meets in its own room
during the Goshthi sessions, not in the team breakout rooms, so the session cards don't repeat
it; instead `personalizeGoshthi()` gives their own "Goshthi 1" / "Goshthi 2" items on `/schedule`
and the home clock their group's room ("Room to be confirmed" while none is on file) and label.
The Santo, admin and display views keep the printed programme. A seva that maps to no team (see
"Delegates from the master list") gets a "Sessions coming soon" card instead of sessions.

### Project layout

```
prisma/               schema, seed, team breakouts (breakouts-data.ts + breakouts.ts sync),
                      santos + utaros (santos-data.ts), Santo general schedule
                      (sant-schedule-data.ts + sant-schedule.ts sync), Santo menu
                      (sant-menu-data.ts + sant-menu.ts sync), Santo personal
                      programmes (sant-personal-data.ts + sant-personal.ts sync)
src/app/
  page.tsx            login (BAPS ID → OTP)
  (hub)/              delegate area: layout with header + bottom nav
    dashboard/        dusk hero with countdown / live now-next, colour tiles
    schedule/         day tabs + timeline
    menu/             day tabs + reveal-gated menus
    breakouts/        team breakouts for the guest's seva and track
    transportation/   the delegate's own airport pickup and drop-off
    stay/             the delegate's own hotel, room group and roommates
    map/              venue map: find a room, directions across floors, 3D view
    history/          Edison Mandir history: a timeline of its years, with photographs
    prasang/          Prasang submission form (reporting team's Microsoft Form)
  sant/               Pujya Santo view: home, schedule, menu, breakouts (blocks of sessions
                      to join), venue map, stay, transport, profile
  admin/              admin console: overview, delegates, announcements, live schedule,
                      logistics (transport and rooming boards), email bounces
  api/auth/           request-otp, verify-otp, logout
  api/display/        read-only display API for the TV screens (docs/DISPLAY_API.md)
  api/ses/events/     Amazon SNS endpoint for the SES bounce / complaint / reject events
src/components/       UI (LoginForm, ScheduleView, MenuView, BottomNav, …)
  dashboard/          home page hero, countdown clock, tiles
  map/                venue map UI: 2D plan with pan / zoom, 3D stack, search, room sheet
  history/            the History timeline: opening card, year strip, photo mats, photo viewer
  sant/               sant shell + pages
src/lib/
  auth.ts             JWT session cookie helpers, requireGuest / requireSant
  otp/                OTP generation/verification + SES/SNS providers
  emailEvents/        SES events: SNS signature check (sns.ts), event -> rows (ses.ts), labels (view.ts)
  schedule.ts         now/next, menu reveal logic, getBreakoutsForUser()
  teams.ts            breakout team codes + teamCodesFor() (seva spellings -> team codes)
  sevaMapping.ts      master list (Seva Wing, Seva) -> team code + gender track
  delegateImport.ts   master-list import rules: plan, skips, reconcile with users
  goshthiImport.ts    the goshthi workbook's tabs (E-Side list, I-side grid): groups, rooms, moderators
  delegateEmail.ts    the delegates' email address: <baps id>@na.baps.id
  transportImport.ts  transport workbook import rules: plan, flags, reconcile with transport_legs
  transport.ts        a delegate's own legs (getTransportFor) and the admin board
  roomingImport.ts    rooming workbook import rules: tabs, plan, flags, reconcile with room_assignments / room_groups
  rooming.ts          a delegate's own stay (getStayFor) and the admin rooming board
  hotels.ts           the hotels (details to fill in), stays and "Room group N" labels
  hotelLiaisons.ts    each hotel's Hotel Liaisons per track (hotel_liaisons), for /stay and the rooming board
  helpContacts.ts     the delegates' help contacts by topic and track (hotlines), for /stay and /transportation
  dressCode.ts        the dress code by track and event day, for /dress-code
  history.ts          the Edison Mandir history: parts, years, events, photographs (for /history)
  historyPhotos.ts    generated by scripts/build-history-photos.py: the photographs' sizes and hashes
  venue/              venue map: types, validation, reader + client payload (data.ts), routing,
                      steps, event-name matching (aliases.ts) and the server-only alias table
  sant.ts             santos' personal schedule, utaro, the SANT hotlines
  santSchedule.ts     the Santo general schedule (sant_general_schedule_items)
  breakoutSessions.ts the team breakouts ("bk-" rows) folded into sessions (display API, santos)
  santBreakouts.ts    the breakouts santos can join: Bhaio, not combined, in blocks
  admin/              directory queries, announcement targeting, schedule engine, overview,
                      the email bounce tracker (emailEvents.ts)
  display.ts          display API: key check, CORS, query parsing, response types
  time.ts             timezone formatting and the ?now= override
src/middleware.ts     route protection
```

Useful scripts: `npm run typecheck`, `npm run db:studio` (browse the DB), `npm run db:migrate`
(create a migration once the schema stabilises; `db:push` is fine while prototyping).

### Working against the Lightsail database

The production database is the Lightsail managed PostgreSQL instance **naam-users**
(us-east-1, Small bundle, Postgres 18). Its connection string lives in `.env.lightsail`
(gitignored; regenerate it with
`aws lightsail get-relational-database-master-user-password --relational-database-name naam-users`).

```bash
npm run dev:lightsail        # dev server using the Lightsail DB
npm run db:push:lightsail    # apply schema changes
npm run db:seed:lightsail    # refresh schedule/menus + team breakouts (no mock users)
npm run breakouts:sync:lightsail  # refresh the team breakouts only
npm run sant:schedule:sync:lightsail  # refresh the Santo general schedule only
npm run sant:menu:sync:lightsail  # refresh the Santo menu only (add -- --dry-run to preview)
npm run santos:import:lightsail   # import / update the real santos and their utaros
npm run sant:personal:sync:lightsail  # the santos' personal programmes (after santos:import; -- --dry-run first)
npm run delegates:import:lightsail -- --master <xlsx> --goshthi <xlsx> [--baps-id <id>=<ID>]... --plan|--dry-run|--apply
npm run transport:import:lightsail -- --file <xlsx> --plan|--dry-run|--apply
npm run rooming:import:lightsail -- --file <xlsx> --plan|--dry-run|--apply
npm run hotel:liaisons:lightsail -- --list|--add ...|--set ...|--remove ...  # the Hotel Liaisons (see "Hotel Liaisons")
npm run hotlines:lightsail -- --list|--add ...|--remove --id <id>  # the delegates' help contacts (see "Help contacts")
npm run db:studio:lightsail  # browse the live tables
```

The database was switched to **public mode** so it can be reached from a laptop. Before the
event, either turn public mode off and run the app inside Lightsail, or leave it on and rely
on the strong master password plus `sslmode=require` (already in the URL).

---

## Production notes

### Amazon Lightsail database sizing

Expected load for ~800 guests over 3 days is light: the whole dataset is a few megabytes,
and traffic is bursty (meal reveals, session changes) but in the tens of requests per
second at most. Each page does 1–3 small indexed queries.

**Recommendation: Lightsail Managed PostgreSQL, "Small" bundle (1 vCPU, 2 GB RAM, 80 GB SSD),
Standard (single AZ), ~US$30/month.** The Micro bundle (1 GB, ~US$15/month) would also cope,
but Small doubles the connection headroom for very little money, and Lightsail bills hourly
so you can delete the database after the event. High availability is not needed for a
3-day event; take a manual snapshot before it starts instead.

What actually matters more than CPU is **connection count**:

- Host the Next.js app on a long-running server in the **same region** (a Lightsail
  container service or a small Lightsail/EC2 instance running `next start`) and set
  `connection_limit=10` on `DATABASE_URL`. Prisma then keeps one small pool.
- If you deploy to a serverless platform instead (e.g. Vercel), put a pooler in front of the
  database (PgBouncer, or Prisma Accelerate) so cold lambdas don't exhaust connections.
- Enable the Lightsail database's public mode only if the app runs outside Lightsail, and
  restrict access to the app's IP. Always add `sslmode=require` to the URL.

### OTP delivery

The app is wired for AWS out of the box (`OTP_PROVIDER=aws`). Current state of the AWS account:

- SES (us-east-1) has **production access** (granted 2026-09-27): up to 50,000 emails/day at 14
  per second, to any address, so delegates (`<BAPS ID>@na.baps.id`),
  santos (`na.baps.org`) and admins all get their codes. Bounces, complaints and rejects go to
  the SNS topic `naam-ses-bounces-complaints` through the `naam-hospitality-hub` configuration
  set, and from there (with `SES_EVENTS_TOPIC_ARN` set) to the console's bounce tracker (see
  "Email bounces").
- Emails are sent from `NAAM 2026 Hospitality Hub <noreply@sypramsoftware.com>` (the domain is
  DKIM-verified in SES), which is also the default when `SES_FROM_EMAIL` is unset. Change
  `SES_FROM_EMAIL` once a BAPS domain is verified. Optional: `SES_REPLY_TO` (comma-separated
  Reply-To; unset, replies go to the sender) and `SES_CONFIGURATION_SET` (sent as the SES
  configuration set for bounce/complaint events; keep open/click tracking off in it, and allow
  `ses:SendEmail` on that configuration set in the IAM policy).
- The sign-in email is plain transactional mail: the code and the inline Sāchu logo, no links or tracking, marked
  `Auto-Submitted: auto-generated` so out-of-office replies don't bounce back to the no-reply sender.
- For inbox placement add SPF (a custom MAIL FROM domain in SES) and a DMARC record for
  `sypramsoftware.com`; see the checklist in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
- SMS via SNS is wired but untested; it needs an origination number (see table).

| Channel | Service                     | Setup before the event                                                                                                  | Rough cost                |
| ------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Email   | **Amazon SES** (SESv2 API)  | Verify the sending domain (DKIM), request production access to leave the sandbox, set `SES_FROM_EMAIL`.                | ~US$0.10 per 1,000 emails |
| SMS     | **Amazon SNS**              | US SMS needs a registered origination number: request a **toll-free number** and verify it (allow 2–4 weeks), or register 10DLC. Raise the default US$1/month SMS spend limit via a support ticket. Set `SNS_ORIGINATION_NUMBER`. | ~US$0.0065–0.01 per SMS  |

At 800 guests and a few sign-ins each, total delivery cost is well under US$25.

Alternatives worth knowing:

- **AWS End User Messaging SMS** (the newer Pinpoint SMS v2 API) uses the same numbers and
  registration as SNS but gives more control (configuration sets, opt-out handling). Swap the
  `sendSms` implementation if you need that.
- **Twilio Verify** is a fully managed OTP service (generation, delivery, retries, fraud
  controls) that works within minutes and needs no 10DLC/toll-free paperwork for short-code
  traffic. If the event is close and the SMS number registration timeline is tight, use
  Twilio Verify for SMS and keep SES for email. Add a provider under `src/lib/otp/providers/`.
- **Amazon Cognito** can do passwordless OTP via custom auth triggers, but it wants to own the
  user directory, which doesn't fit the "BAPS ID from our own table" model.

Give the app permission to send by attaching an IAM role (or access keys) with
`ses:SendEmail` and `sns:Publish`.

### Environment variables

See `.env.example`. In production set a strong `AUTH_SECRET`, `OTP_PROVIDER=aws`,
`AWS_REGION`, `SES_FROM_EMAIL` (`NAAM 2026 Hospitality Hub <noreply@sypramsoftware.com>`, or leave
it unset for that default), `DATABASE_URL` (with `sslmode=require`),
`ALLOW_TIME_TRAVEL=false` and `ALLOW_MIRROR_TESTERS=false` (true only while testing with mirror
test accounts). `SES_REPLY_TO` and `SES_CONFIGURATION_SET` are optional. `SES_EVENTS_TOPIC_ARN`
turns on the SES events endpoint for the bounce tracker (see "Email bounces"); unset, it is off.
`DISPLAY_API_KEYS` turns on the display API for the TV screens (see "Display API (TV screens)");
leave it empty to keep it off.
`VENUE_DATA_FILE` is for local development only (see "Venue map") and is ignored in production.

### Deploy checklist

1. `npm run build` (runs `prisma generate` then `next build`).
2. `npx prisma migrate deploy` (or `prisma db push` for the first deploy; `db:push:lightsail`
   adds the master-list `users` columns) against the Lightsail database, then
   `npx prisma db seed` (content only), then `npm run santos:import:lightsail`,
   `npm run sant:schedule:sync:lightsail`, `npm run sant:menu:sync:lightsail`,
   `npm run sant:personal:sync:lightsail` (`-- --dry-run` first) and the delegates: `npm run delegates:import:lightsail`
   with `--plan`, then `--dry-run`, then `--apply` (see "Delegates from the master list"), then
   the same for `npm run transport:import:lightsail` (see "Airport transport") and
   `npm run rooming:import:lightsail` (see "Hotel rooming"), the Hotel Liaisons with
   `npm run hotel:liaisons:lightsail -- --add ...` (see "Hotel Liaisons") and the delegates' help
   contacts with `npm run hotlines:lightsail -- --add ...` (see "Help contacts": only once the
   code that reads their topic and track is deployed).
3. Start with `npm start` behind HTTPS (Lightsail container service or a reverse proxy).
4. Send yourself a code with `OTP_PROVIDER=aws` to confirm SES and SNS are out of the sandbox.
5. Bounce tracking: set `SES_EVENTS_TOPIC_ARN`, subscribe `https://<host>/api/ses/events` to the
   topic and run `npm run ses:bounces:lightsail -- --backfill` (see "Email bounces").
