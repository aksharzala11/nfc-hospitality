# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

"Hospitality Hub": a mobile-first web app for delegates of NAAM 2026 (Edison, NJ; Thu Oct 8
arrival evening through Sun Oct 11 departures, Eastern time). Guests sign in with a BAPS ID +
one-time code and see the schedule, reveal-gated menus, breakout sessions for their seva,
their own airport pickup / drop-off and their hotel room group.
Schedule and menus are transcribed from the organisers' files (block schedule and menu
spreadsheets) into prisma/seed.ts; the printed
schedule has separate Bhaio (gents) / Behno (ladies) tracks on Fri and Sat, modelled with
ScheduleItem.audience and filtered by User.gender. See README.md for the
full walkthrough, Lightsail sizing and OTP provider notes.

## Commands

```bash
npm run dev          # Next.js dev server on :3000
npm run typecheck    # tsc --noEmit
npm run build        # prisma generate + next build
npm run db:up        # local Postgres via docker compose
npm run db:setup     # prisma db push + seed (mock data)
npm run db:seed      # re-seed only (wipes and recreates content tables)
npm run db:studio    # Prisma Studio
```

There is no test suite yet. Verify changes with `npm run typecheck` and by loading pages in
the dev server; use `?now=2026-10-09T13:45` on hub pages to preview event-time behaviour
(requires `ALLOW_TIME_TRAVEL=true`).

## Stack

Next.js 15 App Router, React 19, TypeScript, Tailwind CSS 4 (`@theme` brand tokens in
`src/app/globals.css`; see "Theme" below), Prisma 6 on PostgreSQL, `jose` for session JWTs,
`lucide-react` icons.
OTP delivery: Amazon SES (email) + SNS (SMS), or a console logger for development.

## Structure

- `prisma/schema.prisma` — User (`users`, with `role` DELEGATE | SANT | ADMIN), OtpCode,
  ScheduleItem, Meal, MenuItem, Breakout (`breakouts`, with a gender `audience`), Notification,
  ScheduleChange, SantScheduleItem, SantGeneralScheduleItem (`sant_general_schedule_items`),
  SantAccommodation (shared utaro), Hotline (`hotlines`: per `role`; a DELEGATE line also has a
  `topic` GENERAL | STAY | TRANSPORT and a gender `audience`), TransportLeg (`transport_legs`),
  RoomAssignment (`room_assignments`), RoomGroup (`room_groups`), HotelLiaison (`hotel_liaisons`,
  several per hotel and track), VenueMap (`venue_maps`), EmailEvent (`email_events`, the bounce
  tracker). Tables/columns are snake_case via @@map/@map.
  `users` also holds the master-list columns: `registration_id` (the
  organisers' "User Id", unique: the key that links a delegate to their other data sources),
  `center`, `personal_wing`, `seva_wing`, `seva_role`, `registration_status`, `goshthi_group`,
  `goshthi_room` (null for accounts not from the master list), `goshthi_moderator` (false), and
  `accommodation_package` (the transport workbook's "Fee Description", written only by the
  transport import). `mirror_registration_id`
  is for tester accounts only (see `scripts/tester-personas.ts`; a SANT tester holds a sant's
  BAPS ID there instead, `sant:demo --mirror`); no import writes it.
- `prisma/seed.ts` — real schedule + delegate menu (from the PDFs), the team breakouts
  (`syncBreakouts()`), the Santo general schedule (`syncSantSchedule()`) and the Santo menu
  (`syncSantMenu()`) always; mock users/breakouts only when `SEED_MOCK_DATA=true`.
  `scripts/upsert-user.ts` adds/updates one `users` row.
- `prisma/breakouts-data.ts` — the organisers' breakout room schedule (the live
  "NAAM_Breakout_Room_MASTER_synced" Google Sheet as read 2026-10-01: the Bhaiyo and Behno grids;
  its Setup and Data tabs are cross-checks only; the file's header lists where it departs from the grids) as data: per session track, day, times, title, teams (canonical codes), rooms, note,
  and `santos` on the eight Bhaio entries the organisers mark "Santo joining" (the Bhaiyo grid's
  #fcddb5 fill, the Data tab's Type, read 2026-10-02; `true` = the whole entry, or a `{ start, end }`
  window inside it; Bhaio only, checked by `breakoutRows()`; not a column: `santoJoiningByRowId()`
  maps each marked entry's row ids to the window as offsets from the row's printed start, so it
  follows live moves; only the Santo view reads it).
  `prisma/breakouts.ts` expands it to one `breakouts` row per team per track (id
  `bk-<track>-<day>-<HHMM>-<team>`) and syncs the `bk-*` rows (`npm run breakouts:sync`,
  `breakouts:sync:lightsail`, `-- --dry-run`); it never touches other rows. `src/lib/teams.ts`:
  `TEAM_CODES`, `TEAM_ALIASES`, `teamCodesFor(seva)`.
- `prisma/santos-data.ts` — the real Pujya Santo list (`SANTOS`, 33) and their utaros (`UTAROS`),
  from the organisers' "Pujya Santo Info" sheet (BAPS IDs, emails, phones, regions) and, for who
  stays where, the "Updated Accomodations" tab of their Santo workbook ("TEJBHAI THIS IS
  EVERYTHING BUDDY - Version 1 (1).xlsx", 2026-10-03; it replaced the "Santo Accommodations"
  sheet). Its header lists the four santos that tab moved, "Shantilay" read as Shantnilaydas
  (SN1801), the four santos on it without a BAPS ID (not added until the organisers send their
  account details; no utaro for the Mandir Sarvasva room) and GS0002 (not on it, kept at the
  Premanand room on the user's word). `scripts/import-santos.ts` (`npm run santos:import`,
  `santos:import:lightsail`, `-- --dry-run`) upserts them by BAPS ID in one transaction (role
  SANT, gender MALE, seva "Pujya Santo", channel EMAIL; `test_code`, `display_name`,
  `breakout_sessions` untouched) and places each at his utaro.
  It never deletes, never demotes an ADMIN, and only lists SANT rows/utaros not in the data.
  Pending accounts (user, 2026-10-06): a santo wanted in the app before his account details
  arrive is listed with a placeholder BAPS ID `PENDING-<NAME>` (`PENDING_PREFIX`) and no email or
  phone, so nobody can sign in as him (a code has nowhere to go: NO_CONTACT), while he is placed
  at his utaro and any programme of his can be synced. When the real BAPS ID comes, set it as
  `bapsId` with the placeholder in `formerBapsId` (plus email, and phone when given: a santo may
  have none, then he signs in by email only): the import renames the account in place. A santo
  may also carry the organisers' User Id (`registrationId`, written only when given). Shilvatsaldas
  was pending (`PENDING-SHILVATSAL`) and became SV2102, User Id 66512, on 2026-10-06.
  Rules: `bapsId` = the BAPS ID email's local part upper-cased, `email` lower-cased, `name` =
  `<Name>das` ("P."/"Pujya" and "Swami" dropped, "das" appended once: "Nityavivek Swami" ->
  "Nityavivekdas"). Utaros are named places only (a haribhakta's home, e.g. "Chaganbhai's
  home", or a Mandir room, e.g. "Mandir · Nityanand room"), stable ids `utaro-*`; no addresses.
- `prisma/sant-schedule-data.ts` — the Santo general schedule (`SANT_GENERAL_SCHEDULE`, Mon Oct 5 –
  Thu Oct 15), generated from the "Master Schedule" tab of the Santo workbook (one event column a
  day, "Pujya Santo" on Oct 8–10; 2026-10-03, replacing the "Santo Schedule" sheet) by a reader
  kept outside the repo; regenerate rather than hand-edit. Its header lists the reading rules:
  sheet notes ("[i/eBKY Combined]", "[Common Session]", "[Split BKY Session]") dropped, Oct 6's
  heading-less bulleted agenda cells titled "BKY Santo Meeting" with the bullets as the
  description, "Refreshments" MEAL, and the update sessions in the old "Pujya Santo Session" slots
  (Fri 11:00–12:30 and 15:00–16:30, Sat 11:00–12:30) in "Yogi Hall", the place the santos' own
  sheets give (user, 2026-10-03), their Breaks with none. So no item is a BREAKOUT and none links
  to /sant/breakouts (unchanged). `prisma/sant-schedule.ts` validates it (days must equal
  `SANT_DAYS`, no overlaps, no sheet shorthand) and syncs `sant_general_schedule_items` (ids
  `ss-<day>-<HHMM>-<title slug>`; the sync owns the whole table, so rows not in the data are
  deleted): `npm run sant:schedule:sync`, `sant:schedule:sync:lightsail`, `-- --dry-run`, and the seed.
- `prisma/sant-menu-data.ts` — the Pujya Santo menu (`SANT_MENU`, Thu Oct 8 dinner – Sun Oct 11
  breakfast), transcribed by hand from the kitchen team's menu: first their "BKY NAAM SANT MENU"
  Google Sheet, since 2026-10-03 the "Menu" tab of the Santo workbook (a block per day, read by
  position since every heading says "Thursday, Oct 8"; columns Meal, Category, Item Name); its
  header lists how it was read and every wording change. Only the Meal / Category / Item Name
  columns: never the Google Sheet's quantities, people, follow-ups or statuses. Per
  meal: `day`, `meal` (breakfast / lunch / dinner), `slot` = the title of that day's item in the
  Santo general schedule that the meal is served in (a MEAL item, or one whose title names a
  meal: Sunday's ARTI "Darshan/Breakfast"), and the dishes in sheet order (course = the category,
  "(Option N)" / "(Dish N)" dropped; "Baked Goods" rows (Meal "Sweets") join the meal above
  them; a dish the meal already lists is not repeated: the sheet tracks batches; TBD -> the tag
  "Tentative"; a person's name in an Item Name is left out; Gujarati spellings as given).
  `prisma/sant-menu.ts` takes each meal's name, times and place from its `slot` (so the menu
  follows the Santo schedule: after moving a meal there, sync the menu too), validates
  (`santMenuRows()`: one slot found, time order, no dish twice in a meal, no TBD / sheet
  numbering / sant's names, only the "Tentative" tag) and syncs: it owns every SANT meal and
  its dishes (ids `sm-<day>-<meal>`,
  dishes `<meal id>-NN`; SANT meals not in the data, such as an old `sant:demo` sample menu, are
  deleted; DELEGATE meals are never read or written; SANT meals stay unlinked and never moved):
  `npm run sant:menu:sync`, `sant:menu:sync:lightsail`, `-- --dry-run`, and the seed.
- `prisma/sant-personal-data.ts` — the santos' personal programmes ("My schedule"; `SANT_PERSONAL`:
  per santo `bapsId` and `items` `{ day, start, end, title, description?, location?, kind }`,
  in SANTOS order, items by time, a comment naming his block as the tab writes it), generated on
  2026-10-03 from the "Individual Schedule" tab of the Santo workbook by scripts kept outside the
  repo; regenerate rather than hand-edit. Its header lists how the tab was read and the
  decisions (user / main session, 2026-10-03): every "Santo Breakout" row left out (it repeats
  the general schedule's Yogi Hall update sessions), "Pujya Yoganand Swami" left out (no
  account), "Aarti" -> "Arti", kinds by title, SY0702's "Morning Mandir Aarti" at 7:00 PM on
  Oct 9 read as 7:00 AM (to confirm). `prisma/sant-personal.ts` validates it (`santPersonalRows()`:
  BAPS ID in `SANTOS` and listed once, at least one item, days in `SANT_DAYS`, "HH:MM" with the
  end after the start, time order and no overlap within one santo, a known kind, the general
  schedule's guest-text checks (`guestTextProblem()`, exported by `sant-schedule.ts`), unique
  ids) and syncs `sant_schedule_items` (`syncSantPersonal(prisma, { dryRun, allowDeletes })`):
  ids `sp-<BAPS ID lower-case>-<day>-<HHMM>-<title slug>`, Eastern -> UTC, one transaction;
  santos found by BAPS ID (no account, or not a SANT: an error, nothing written); it owns every
  `sp-` row (creates, rewrites, deletes those no longer in the data) and never writes another
  (SANTO0001's `sant:demo` sample programme is only counted); a run whose deletes would take
  every `sp-` row from a santo writes nothing unless `--allow-deletes`. `npm run
  sant:personal:sync`, `sant:personal:sync:lightsail`, `-- --dry-run` (prints each santo by BAPS
  ID and `santName()`); not run by the seed (the santos come from `santos:import`). The Santo
  pages read it per account through `dataUserId` (`getSantSchedules()`, `getPersonalSchedule()`).
  npm swallows a flag given without `--` before it (`npm run x --dry-run` runs WITHOUT it): the
  three Santo syncs and `santos:import` read `--dry-run` through `wantsDryRun()`
  (`scripts/npm-flags.ts`), so that slip is still a dry run (the plan / dry-run / apply imports
  need a mode, so it stops them; `breakouts:sync`, `hotlines` and `hotel:liaisons` don't check yet).
- `scripts/import-delegates.ts` — the delegates from the organisers' master list ("App
  DataSet.xlsx") and goshthi groups ("NAAM Goshthi Group Allocations.xlsx"), read with `exceljs`
  at run time: `npm run delegates:import[:lightsail] -- --master <xlsx> [--goshthi <xlsx>]...
  [--baps-id <User Id>=<BAPS ID>]... (--plan [--out <json>] | --dry-run | --apply)`. Run plan →
  dry-run → apply with the same arguments. `--plan` touches no database; `--apply` writes in one
  transaction and refuses while the plan has errors. `--baps-id` (the organisers' values sent by
  message) fills a blank BAPS ID or corrects the sheet's; the given value wins, each is printed
  as "User Id -> BAPS ID (given with --baps-id; sheet had …)", and a User Id not in the list or
  given twice, a malformed value, or one another person / non-matching account holds is an
  error; an account matched by User Id gets the corrected BAPS ID. The rules are in
  `src/lib/delegateImport.ts` (`planDelegates()`, `reconcile()`), the goshthi tabs in
  `src/lib/goshthiImport.ts` (only visible tabs, found by layout, not name: the Bhaio list — "Eside" / "E-Side" — and
  the Behno grid — "Iside" / "I-side Groups" — of "Group N" blocks with a "Moderator:" row and a
  merged Location; hidden tabs and summaries ignored; a tab's side comes from its wings or name,
  else from the people it lists when ≥ 90% are on one track, and is printed in the plan), the email in `src/lib/delegateEmail.ts`, the seva → team table in
  `src/lib/sevaMapping.ts` (`teamForSeva()`, `genderForPerson()`). Matches `users` by
  `registration_id`, else BAPS ID; never changes
  SANT/ADMIN rows or accounts not in the list (testers, santos), never deletes, never writes
  `test_code`/`breakout_sessions`/`display_name`, and a blank phone never clears one on file.
- `scripts/import-transport.ts` — airport pickups / drop-offs from the transport team's workbook
  ("Transportation Information v3.xlsx"), read with `exceljs` at run time:
  `npm run transport:import[:lightsail] -- --file <xlsx> (--plan [--out <json>] | --dry-run |
  --apply)`, same modes and safeguards as the delegate import (plan → dry-run → apply). Rules in
  `src/lib/transportImport.ts` (`planTransport()`, `reconcileTransport()`). `--apply` upserts one
  `transport_legs` row per (User Id, direction), deletes legs no longer in the workbook (not for
  people skipped for conflicting rows), and sets `users.accommodation_package` on existing users;
  no other `users` column is written.
- Breakouts "How to get there" (`/breakouts` only): tapping a card (outside its room links) or its
  "How to get there" button opens a section inside it (`<BreakoutHowTo>`, a client island the page
  wraps each card in through `BreakoutList`'s `howTo` prop; `BreakoutList` is the delegate
  page's only: `/sant/breakouts` has its own blocks, see the Santo breakouts bullet).
  START = `previousPlaceFor()` (`src/lib/schedule.ts`, pure): the latest thing before the session
  starts, same event day and the session's track, from the guest's other sessions and their
  schedule (`forAudience()` + `personalizeGoshthi()`, requireGuest() data so mirrors work). "Before"
  = ends by the start, or a schedule item still running then that began once everything else was
  over (run over its time, e.g. EXTEND ONLY; a background item doesn't count); never a Team
  Breakouts slot around the session, an own session still running, or a slot holding their
  sessions (it stands aside for them). Latest end wins (still running = the session's start), own
  session wins a tie, then the later start; a walk "Travel" (not a ride, `RIDE_TITLE` in
  `src/lib/travel.ts`) is skipped. A session both tracks hold (audience ALL, a no-gender guest)
  reads each track's day: different places = "unknown" (reason "tracks"), never mixed. Rides / the
  day's first session / off-site places start at the Main Foyer (/map's default start, the "lobby"
  in code) "as you arrive" or "after Travel to Mandir"; no room, "Room to be confirmed", "tracks",
  a name not on the map or a room without directions (staff only included) start at the Main Foyer
  with a note saying why; a split place starts at its first room found and says so. The start is named as the schedule names it when that name maps to the room
  (`destTitleOf()`, passed to `directionsFor()` as `startTitle`), so the From line and step 1 agree;
  /map keeps the name its `?from=` link carries the same way (`startName` in `VenueMap`), so its
  step 1 and From list read as the card's.
  DESTINATION = each room of the session (chips when split); a room the place before names (mapped
  or not, by `normalizeVenueName()`), or its real map start, reads "You're already there" (a split
  place: "If you were in X for T, stay there"; one room under two names says so), with a
  `/map?from=X&to=X` link; the Main Foyer fallback never counts. A room not on the map says so, no
  link, and so does a staff-only room (no session should be in one). Names are resolved with the
  guest's track (`resolveVenueRoom(name, index, track)`): a place with one room per track ("Samp
  Square") is theirs; with no gender on file it is the session's track's (`nameTrack`), and the
  /map link then names that room by its map id so /map opens the same one. A room listed by its
  floor's name ("Mezzanine" = Mahant Hall) shows "Mezzanine · Mahant Hall" on the To line and goes
  by its own name everywhere else: "From Mahant Hall", "Walk to Mahant Hall", "stay in Mahant
  Hall" (`titleBesideFloor()`).
  Each room carries its own From: over directions the start (and why it's the Main Foyer); with only
  a message, where they really are (never "so directions start at the Main Foyer"). `breakoutWays()`
  (`src/lib/venue/breakoutDirections.ts`) works it all out on the server over `toClientVenue()`
  with `directionsFor()` (the guest's track, Step-free off and on; the toggle shows only when they
  differ; when they don't, `stepFreeNote` is the note /map shows with Step-free on, for a viewer
  whose choice is on; the flow rules in force at the session's printed start, `originalStartsAt`
  else `startsAt`, for the guest's track, `rulesAt` from `getVenueForPages()`, see "Flow rules"
  below; the note under the steps then says "for this session also ...") and sends text only (labels, floor names, steps, /map's failure wording, a `/map?from=&to=`
  link carrying `?now=`, and `?at=` = that printed start, event-local, when a rule with a window
  applies then, so /map opens the card's route at any hour); the card's room links use the same link. Route texts are also cached
  per set of flow rules in force (`RouteRules.key`). The Step-free choice is one per
  page and kept per viewer (`useStepFreePreference()`, localStorage, try/catch) and adds
  `stepFree=1` to the /map link (/map opens with Step-free on). The router is cached per
  `generatedAt`, route texts per (map, track, step-free, start + its name, room), so a page costs
  well under 1 ms warm (a new route 10-70 ms, the router ~60 ms once per server instance). No map /
  any failure = the cards as before.
- `src/lib/transport.ts` — reads for the UI: `getTransportFor(registrationId)` (a person's own
  arrival + departure, with their group's size) and `getTransportBoard(direction, filters)` (the
  admin board: days → airports → groups → people; names and phones, so admin callers only).
  `isTransportTableMissing()` (P2021) lets pages show "no data yet" before the schema is pushed.
- `scripts/import-rooming.ts` — hotel room groups from the organisers' rooming workbook ("FINAL
  Rooming List v17.xlsx"), read with `exceljs` at run time: `npm run rooming:import[:lightsail] --
  --file <xlsx> (--plan [--out <json>] [--master <App DataSet.xlsx>] | --dry-run | --apply
  [--allow-deletes])`, plan → dry-run → apply like the other imports. Rules in
  `src/lib/roomingImport.ts` (`planRooming()`, `reconcileRooming()`, `reconcileRoomGroups()`,
  `checkRoomingPeople()`). `--plan --master` checks offline who has an account and which room
  groups mix Bhaio and Behno. `--apply` upserts one `room_groups` row per room group and stay and
  one `room_assignments` row per (User Id, stay), deletes those no longer in the workbook (not for
  people skipped for conflicting rows), and refuses when the deletes would empty a whole hotel for
  a stay unless `--allow-deletes`. `users` is only read, never written.
- `src/lib/rooming.ts` — reads for the UI: `getStayFor(registrationId)` (a person's own room
  group(s), roommates by name and center only; null while nothing is imported) and `getRoomingBoard(filters)`
  (the admin board: hotels → room groups → occupants; names and BAPS IDs, so admin callers only).
  `isRoomingTableMissing()` (P2021) lets pages show "no data yet" before the schema is pushed.
- `src/lib/hotels.ts` — the hotels (`HOTEL_KEYS`: hampton, courtyard, doubletree, hilton), their
  workbook spellings (`sheetNames`, read by `hotelKeyFor()`), the stays (`STAYS`,
  `STAY_FIRST_NIGHT`, `STAY_LABELS`), `roomGroupLabel()` ("Room group N") and `roomKeyFor()`. Pure
  config, client-safe. Each hotel's `fullName`, `address`, `phone`, `checkInTime` and
  `checkOutTime` are null until the organisers confirm them: fill them in here; the UI shows only
  what is set (Directions once there is an address, Call hotel once there is a phone).
- `src/lib/hotelLiaisons.ts` — the Hotel Liaisons (the rooming team's points of contact at each
  hotel): `hotel_liaisons`, one row per liaison: a hotel key, an `audience` (BHAIO / BEHNO / ALL =
  everyone there), name + E.164 phone, `sort_order`; a hotel can have several for one track (no
  unique on hotel + audience since 2026-10-01, only an index). `getHotelLiaisons()` (empty on
  P2021, before the table is pushed), `pickLiaisons(liaisons, hotelKey, trackGender(guest))`
  (every liaison of their track + ALL, by `sort_order`, then ALL / Bhaio / Behno, then name; no
  gender on file sees both tracks', each marked "For Bhaio" / "For Behno"), `liaisonsFor()`. Set
  only with `scripts/hotel-liaisons.ts`: `npm run hotel:liaisons[:lightsail] -- --list`, `-- --add
  --hotel <key> --track <bhaio|behno|all> --name "…" --phone "…" [--sort <n>]` (one more liaison;
  refuses a name that hotel and track already has), `-- --set …` (same options: replaces ALL
  liaisons of that hotel and track with this one), `-- --remove --hotel <key> --track <…>
  [--name "…"]` (that one, or all of that hotel and track), `--dry-run` on every write (every
  option checked before the database is touched; names printed, phones masked to the last 4
  digits). The names and numbers live only in the database: never in code, data files or docs.
  The table needs `db:push[:lightsail]` first, and again after 2026-10-01 before a hotel and track
  can take a second liaison (`--add` says so until then, with `--dry-run` too).
- `src/lib/helpContacts.ts` — the delegates' help contacts on /stay and /transportation: the
  `hotlines` rows with role DELEGATE, each with a `topic` (STAY, TRANSPORT, or GENERAL = both
  pages) and an `audience` (BHAIO / BEHNO / ALL). `getDelegateLines()`,
  `pickHelpContacts(lines, "STAY" | "TRANSPORT", trackGender(guest))` (the page's topic first,
  then GENERAL, each by `sort_order`; their track's + ALL; no gender on file sees both tracks',
  each marked "For Bhaio" / "For Behno"), `helpCoverage()` / `getHelpCoverage()` (which tracks have
  a contact: the admin boards' notes). UI: `<HelpContacts>` (`src/components/help/`: the stored
  label, the person's name, the number, availability when set, a `CallButton`). The event has no
  staffed help desk (user, 2026-10-01): never send a guest to a desk, anywhere in the app; a page
  with no matching contact shows no help block and no "get in touch" sentence. Until a database
  has the `topic` / `audience` columns (P2022) the lines are read the old way (every DELEGATE
  line, both pages, both tracks), so the app works before `db:push`; once a read has found them
  missing, each later one asks the catalog first (`schemaState`, `hasTopicColumns()`), so the
  first read after the push uses them and no line is ever shown to the wrong track by this code.
  Code from before 2026-10-01 shows every DELEGATE line to everyone: deploy, then push, then add
  contacts, in that order. The Santo pages read
  `getHotlines("SANT")` (`src/lib/sant.ts`): each sant line's `topic` (no `audience`; without the
  column every line reads GENERAL), placed by `santContactsFor(lines, "TRANSPORT" | "STAY")` (that
  topic's lines, then GENERAL ones): `/sant/transport` and the home's Transport tile take
  TRANSPORT, `/sant/stay`'s Contacts STAY (the organisers' "General Contact Info", 2026-10-04:
  General, Utaro / Laundry = STAY, Transport). Telegram (user, 2026-10-06): a sant line's
  `telegram` and an utaro's `host_telegram` (a username, no "@", or "+" and an E.164 number;
  `normalizeTelegram()` / `telegramHref()` in `src/lib/telegram.ts`) put a "Message on Telegram"
  button (`<TelegramButton>`, `src/components/sant/pages/`, a t.me link in the same tab) beside
  each Santo Call button: the contact rows, the transport page's first line, the home's Transport
  tile and "Call host"; the delegates' contacts never show one (`telegramHref` null). Until a
  database has the two columns (P2022) `src/lib/sant.ts` reads without them
  (`withTelegramColumns()`, the `schemaState` pattern), so deploy first, then push, then set the
  handles with `hotlines -- --update --id <id> --telegram <handle>` / `sant:utaro -- --id <id>
  --hostTelegram <handle>`. Handles live only in the database, like names and numbers. Set only with
  `scripts/hotlines.ts`: `npm run hotlines[:lightsail] -- --list` (ids, masked phones, and how
  many contacts each track sees per page), `-- --add --role <delegate|sant> --topic
  <general|stay|transport> --track <bhaio|behno|all> --label "…" --name "…" --phone "…"
  [--availability "…"] [--sort <n>]` (topic and track required for a delegate line; a sant line
  takes an optional topic, default general, and no track; refuses a number
  or a name that a line shown beside it already has: same role and, for delegate lines, an
  overlapping topic and track; needs the pushed columns, for a sant line too), `-- --remove --id
  <id>`, `--dry-run` on every write.
  Names and numbers live only in the database. `scripts/contact-cli.ts` is what the two scripts
  share (strict options, phone → E.164, masking).
- Dress code (`/dress-code`, "Dress code" in More; delegates only): `src/lib/dressCode.ts`
  (`DRESS_CODE` by track and event day, as the organisers give it; `dressTracksFor(trackGender(guest))`,
  `dressCodeFor(track)`) + `src/app/(hub)/dress-code/page.tsx`: the guest's own track (no gender
  on file: both, Bhaio then Behno), one row per day with its date, today's row marked and past
  days quieter (`?now=`). Content changes are an edit to `DRESS_CODE` (a deploy).
- Edison Mandir History (`/history`, "Edison Mandir History" in More and the home's History band;
  delegates only): "Through the years", a scroll story from 1974 to 2019. `src/lib/history.ts`
  (pure data: `HISTORY`, 5 parts named by their years only, 19 years, 39 entries: the organisers'
  history list of 2026-10-02 and their additions of 2026-10-06 (one entry per paragraph, with the
  photographs that show it; they replace the list's 1994 summary and its 1988 and July 9, 1990 lines), tidied for spelling and
  grammar; never add a fact they don't give;
  an entry is `text`, an optional `quote` (an exact substring, shown in Enilas) and optional
  `photos`; `historyYears()`, `historyCounts()`, `splitQuote()`, `historyPhotoSources()`).
  Content changes are an edit there (a deploy). `src/app/(hub)/history/page.tsx`
  (`requireGuest()`; the page root is NOT `.stagger`, only the header and the opening card are:
  that animation leaves a transform, which would break the sticky strip and sit over the
  photographs) + `src/components/history/`: `HistoryOpening` (the ink `MandirArt` card, first and
  last year, the counts, "Begin at 1974"), `HistoryTimeline` (server: per part an ink gate, h2,
  and a rail; per year an h3 Enilas numeral, a tick per year without an event, the entries; the
  ending), `HistoryNav` (client: the sticky year strip of `#year-…` links, and the page's only
  timeline script), `HistoryJump` (`<a href="#id">` that jumps at once through `scrollAppTo` and
  moves focus: a year's h3, or the page's h1 for "Back to the start", which `HubPageHeader`'s
  `titleId` makes focusable), `PhotoPlate` (an event's photographs on a white mat), `PhotoViewer` +
  `useBackToClose` (full screen, one at a time; MoreSheet's Back bookkeeping),
  `history.module.css`. Motion: the coral line is CSS only (a `position: sticky` tip in each
  rail, clipped by the rail: no script, no scroll listener; delete `.tip` if sticky misbehaves
  in an in-app browser); `HistoryNav` runs three IntersectionObservers on `#app-scroll`
  (an entry's dot is lit while it is above the reading line, half a screen down: `data-passed`,
  which follows the coral line both ways, so scrolling back up puts out the dots the line has
  left; a numeral settles, once, when it comes into view clear of the bottom nav: `data-seen`;
  the year under the strip is `aria-current` and the strip re-centres with its own `scrollTo`).
  The base CSS is the finished state (what shows with reduced motion, and without JavaScript,
  where only the CSS line still draws); the unlit look applies only under `data-live`,
  set after everything already above the line is marked; the flags are set by hand, so they
  survive AutoRefresh. Never `animation-timeline`, a window scroll listener, a scroll-into-view
  call, vertical scroll-snap or `next/image` here. A jump's target (a year's h3, the h1) shows
  its focus ring only after a jump made from the keyboard: `jumpToId(id, keyboard)` sets
  `data-keyboard-focus` on it (a click with `detail` 0), since a focus moved by script matches
  `:focus-visible` in some browsers after a tap too; and in Tailwind 4 `outline-none` switches
  off a `focus-visible:outline-2` ring unless `outline-solid` is given with it.
  The photographs are sacred images (the gurus and the murtis): each is a plain `<img>` of its
  WHOLE frame at its own aspect ratio (`width` / `height` from the manifest, the button sized
  from `--photo-ratio`, so the page never shifts), never cropped (`object-fit: cover`), rounded,
  tinted, overlaid, masked or animated, and nothing that contains one (up to `#app-scroll`, or
  the viewer) may have a transform, opacity, filter, mask, clip-path, animation or transition,
  nor, on the page, a clipping overflow; the mat is `position: relative` only to paint over the
  line. Nothing translucent floats over one either: on `/history` the hub's bottom nav stands on
  an opaque sand band the width of the screen (`<BottomNav solidOn={["/history"]}>` in the hub
  layout; everywhere else it is glass over the page), so a photograph scrolling past ends at a
  clean edge, as under the year strip, never blurred or tinted through the glass. The viewer
  keeps every control outside the photograph, appears at once, moves by the browser's own scroll
  of a snap strip (its stage is the one scroll container a photograph sits in: each is whole in
  its own slide, and the slides off screen are `inert`; no gestures in script, no pinch zoom: a
  zoomed photograph is a partial one), returns focus to the photograph's button it was opened
  from (handed over by the click: Safari doesn't focus a tapped button), and sets
  `data-photo-viewer` on `<html>`, which hides the rotate guard (`globals.css`): the
  one place a phone may be turned sideways. Alt text says what is visible and names no one
  (never identify a person from a face). The files: `public/history/photos/<key>-960 | -1280 |
  -full.webp` (keys `cfi-1..3`, `mp96-1..3`, `gm17-1..3`, `mm19-1..3`, and from 2026-10-06 `ia88`, `wb90`, `tr90`, `cp90`, `cc91`, `ep91`,
  `eh94`, `dg94`, `ek94`, `ms95`, `ny96`) and the generated
  `src/lib/historyPhotos.ts` (sizes + a content hash `v`), both built by
  `python scripts/build-history-photos.py "<folder with the originals>" [--keep-built]` (EXIF
  orientation, embedded profile -> sRGB, Lanczos, WebP q86 / q88, no crop, no metadata, never
  larger than the original: the 2026-10-06 originals are the organisers' small exports, so their
  copies are their own size and the page lists one srcset width; .webp originals accepted;
  `--keep-built` keeps a photo whose original isn't in the folder, only while its three files
  still match the recorded hash, which is how photos are added without the earlier scans at hand;
  writes nothing when an original is missing or a copy's aspect ratio or fidelity is off):
  regenerate, never hand-edit. URLs carry `?v=<hash>` and `next.config.ts` serves `/history/photos/*` as
  `private, max-age=31536000, immutable`; being under `/history/`, the middleware turns away a
  request without a session cookie (its usual cheap check: the cookie's presence, not its
  signature) with a redirect it marks `no-store`, so that year-long header never sticks to a
  redirect. The hub's back-to-top button skips `/history` (`ScrollTopButton`'s `skip`). The 2019
  "New Mandir Mahotsav" sentence is a placeholder until the organisers word it, and "Cultural
  Festival of India" (the list says only "C.F.I") is spelled out in a sentence and the 1991 CFI
  plate's caption, as the banner in the 1994 Expo Hall photograph (eh94-1) gives it. Two photo
  placements of 2026-10-06 are to be confirmed with them (code comments: cc91-1, ek94-1).
- Venue map (`/map`, "Venue map" in More): `src/lib/venue/` — `types.ts` (VenueMapData: levels
  B / 1 / 2 / M bottom to top by `order` 0-3 (the mezzanine is the TOP floor, above the second;
  organisers 2026-09-30) in one shared frame, rooms with `public` and an optional `closed`
  (STAFF ONLY on the organisers' plans, 2026-10-01: drawn and named, entry null, no walkable
  floor), stairs / elevators with an optional `side` ("left" / "right" of the map) and an optional
  `place` ("foyer" / "side" / "back": how guests are told which one), walkable grids;
  optional fields only, never change the meaning of one), `validate.ts` (shape checks; unknown
  fields are warnings; a `closed` room with an entry or walkable cells is a routing error),
  `data.ts` (server: `getVenueMap()` reads `venue_maps` row "current", else
  in development only the JSON named by `VENUE_DATA_FILE` (refused inside the repo);
  `getVenueForPages(viewer?)` (the client payload + the name index; plus, for the admin note, why
  a stored map needs re-importing: old level order, no sides, no places, a count of problems in
  the Pujya Santo extras; only the Santo pages pass a viewer: role SANT gets the Pujya Santo
  payload when the map's santo extras are valid, everyone else the delegates'), `venueHref(name, index,
  { now, track, base })` for `/breakouts` room links (`base` "/map", the default) and the
  `/sant/breakouts` ones (`base: "/sant/map"`): null when the name isn't on the map or is only a
  staff-only room), `mapPage.ts` (server: what `/map` and `/sant/map` share: `MAP_PLACES`,
  `mapDeepLink()`, `mapPlace()`, `programmePlaces()` (its `except` leaves names out), `mapRules()`: the flow rules
  a map page sends, see "Flow rules" below), `clientVenue.ts` (server only, no database, so `venue:import` builds the same
  payload: `toClientVenue()` rebuilds every object field by field, sends back-of-house rooms as
  bare outlines, every public room under the organisers' team name when `VENUE_ROOM_NAMES` has
  one (`ClientRoom.named`), a `closed` room by name without an entry, and every stair / elevator
  by kind and place, never the stored name (`connectorLabel()` "Stairs" / "Elevator", its rooms
  `shaftRoomName()` "Foyer Stairs"); re-exported by data.ts; `toSantClientVenue()`, the Pujya Santo
  payload (see "Santos' quarters" below), is not re-exported and only data.ts and the import
  scripts call it; `hasSantExtras()`, `santNameProblems()`), `route.ts` (A* over
  every level's grid, storeys = `order`; stepFree = elevators only, otherwise stairs only, with
  elevators added only when the side's stairs don't get there (`ClimbMode`); `track` limits it to
  that side's connectors (organisers 2026-09-30): `TRACK_SIDE` Bhaio right / Behno left,
  `ELEVATORS_FOLLOW_SIDE` (true: elevators split the same way; flip to false only on the
  organisers' word that the elevators are shared), `connectorUsable()`; `route()` returns a
  `RouteResult`, reason "side" when only the other side's connectors reach it, never routing
  through them; with the elevators split, step-free Behno can't reach the Mezzanine (only a
  right-side elevator stops there) and `routeProblem()` names that floor, start or
  destination; a `closed` room is never started from, ended in or crossed: `blockClosed()` blocks
  any cell inside one whatever the stored grid says; crossing a room that is neither the start nor
  the destination costs `THROUGH_ROOM` times more, and a restroom is never a way through
  (`THROUGH_RESTROOM`: one with two doors is no short cut; crossed only when nothing else gets
  there at all); with the Pujya Santo payload `createVenueRouter()` is two searches: one over
  exactly the delegates' inputs (`guestGrid`, the public rooms, the shared landings) for every
  trip that neither starts nor ends in the sadhus' residence, so those are the delegates' routes
  cell for cell, and one over the santos' floor for residence trips, where a sadhu's own room that
  is neither end costs `THROUGH_QUARTERS` (= `THROUGH_RESTROOM`); a climb carries the connector's `place` and,
  only for a guest who may use both of a pair (or one a flow rule lets them use on the other side,
  `exception`), a `sideHint`; `RouteOptions.rules` = the flow rules in force, see "Flow rules"
  below), `steps.ts` (plain-English steps;
  stairs / elevators by place through `connectorPhrase()` in view.ts, never by number: "the foyer
  stairs", "the side stairs", "the back stairs", "the foyer elevator", "the back elevator", plain
  "the stairs" / "the elevator" on a map without `place`, "on the left" / "on the right" added
  for a guest with no gender on file; stairs are "them"; `noLine` = "Walk to X" where no line is
  drawn; step 1 keeps one pair of brackets: "Start at Mahant Hall (Mezz)", not "(Mezz) (Mezzanine)";
  a room a flow rule makes a passage is named in the walk that crosses it by its shown name, "Walk
  through the Ladies' Gym to the side stairs" (`StepContext.placeOf`, `RouteWalk.through`); a door
  is never named),
  `directions.ts` (pure, client-safe: /map's wording shared with /breakouts: `defaultStart()` (the
  Main Foyer; "lobby" in code), `pickRoom()`, `listedRooms()`, room titles (`roomTitleOf()`: the
  team name, else the first event name, else the blueprint's with its number when that repeats;
  `isGenericTitle()` / `placeTextOf()`: only a blueprint description takes "the", a team name
  reads as a proper name; `titleBesideFloor()`: a room found by its floor's name, "Mezzanine",
  goes by its own, "Mahant Hall", in steps and messages; `twinSpots()`: what tells apart two
  rooms the organisers gave one name on one floor, by where they are on the map, "left" / "right"
  or "back" / "front" (the main foyer is the front), never the blueprint's number), `routeStartPoint()`,
  `directionsProblem()` / `routeProblem()`, `routeNoteFor()`; `createVenueGuide()` +
  `directionsFor()` for server use; a `closed` room is listed and tappable but is never a start
  or a destination ("… is for staff only"); change /map's directions wording here, never in a
  copy), `breakoutDirections.ts` (server only: the breakouts page's "How to get there", see its
  bullet), `view.ts` (client payload types and helpers; `withArticle()`: no article before a
  numbered room, "Green Room 2"), `aliases.ts` (client-safe matching of event names, room names,
  numbers and map ids; every function takes the alias list as an argument;
  `resolveVenueRoom(name, index, track)`: an alias with `byTrack` (one room per track) is the
  guest's track's room, without a track both as alternatives (`either`, spread "same-name": the
  nearer opens, the other is offered); `aliasEntriesFor(index, track)` = the list the browser
  gets, already narrowed to the track) and `aliasTable.ts` (`import "server-only"`, so a client
  import fails the build; scripts load it through `scripts/tsconfig.server-only.json`; three tables:
  `SANT_ROOM_NAMES` (the Pujya Santo view only: map id -> the name santos read for a residence
  room they are shown, "Sarvasva" and the numbered "Santo Room"s; every such room needs one and
  nothing else may have one; its ids are the "own" list in `venue:import --plan`'s Pujya Santo
  view section, since admins can't tap a residence room on /map; renaming = an edit + a deploy,
  no re-import; showing or hiding a room = an extractor flag in the arguments note, re-extract,
  the table edit, `--plan`, then deploy and import back to back: until the deployed table and the
  stored map agree, santos get the delegates' map), `VENUE_ROOM_NAMES`, map id -> the organisers' name for the room as their labelled floor plans
  give it ("Ashro", "Nij Mandir", "Sahajanand Hall", "Main Foyer"; public rooms only, never stairs;
  a room without one keeps the blueprint's name, as the staff-only rooms do), and `VENUE_ALIASES`,
  event room name -> map ids, `{ BEHNO: [...], BHAIO: [...] }` for a place with one room per track
  ("Samp Square") or null = not on the map yet; `VENUE_ALIAS_TENTATIVE` = the mappings still to
  be confirmed with the organisers, each with what is assumed). `src/app/(hub)/map/page.tsx`
  (requireGuest(); the guest's track `venueTrackOf(tracksFor(trackGender(guest)))`, so mirror
  testers get the mirrored delegate's; no gender on file = every connector; admins follow their
  gender (user decision 2026-09-30: no exemption by role anywhere); the guest's goshthi / breakout
  rooms as chips; `?to=` / `?from=` deep links, resolved with the guest's track (a `?from=` at the
  other side's stair or a staff-only room starts at the Main Foyer; a `?to=` at a staff-only room
  opens it with a notice and no directions), `?stepFree=1` (opens with Step-free on); the alias
  list filtered to rooms on the map and to the track; one Programme chip per room ("Main Hall",
  not also "Sabha Hall"); admins also get each room's map id, alias coverage, how many rooms carry
  a team name, the tentative mappings and the re-import note), `src/app/sant/map/page.tsx` (the
  same map for santos: requireSant(); track `santVenueTrack(sant)` = Bhaio, so the right-side
  stairs / elevators and the Bhaio room of a per-track place; the same Programme chips but "Dining
  Hall" (the delegates' dining room; santos' meals have no room), deep links
  and `?stepFree=1`; no rooms of their own, no admin coverage; "isn't available yet" as a
  `SantEmptyState` under `SantPageHeader`; More -> "Venue map", `santHref()` sends `/map` here
  with its query, so an announcement's `?to=` still opens the room; `getVenueForPages(sant)`:
  the sadhus' residence rooms santos are shown are on this map, named, searchable, a start and a
  destination, with directions to and from them, and `/sant/breakouts` checks its room links on
  the same payload; the default start stays the Main Foyer) and
  `src/components/map/` (`VenueMap`, `MapCanvas` 2D plan with `usePanZoom`, `Map3D` CSS 3D stack,
  `MapSearch`, `RoomSheet`). In the UI a room shows under its team name with no number (two of one
  name on a floor are told apart by where they are, `twinSpots()`: "Cry Room at the back" /
  "Samp Square on the left" in the From list, "At the back" / "Left side" on the line under the
  name, "(left)" on a chip; the room number only where that wouldn't tell them apart);
  the room an event name leads to shows that name with the team name under it ("Main Hall" /
  "Second Floor · Sahajanand Hall"); a staff-only room is hatched (as on the organisers' plans; a
  key under the map says so, and that the faded stair / elevator markers are the other track's)
  with a muted label, says "Staff only" in search, the peek and its sheet, offers no Directions and
  is never in the From list; search lists rooms with directions before staff-only ones, offers a
  room once (the best-matching of its names: "Main Hall", not also "Sabha Hall"; its own name when
  that matches as well: "Mahant Hall", not "Mahant Hall (Mezz)") and never the other track's room
  of the same name; stairs and elevators are "Foyer Stairs" etc., with "Left side" / "Right side" under them
  and "on the left" / "on the right" in the From list of a guest who may use both. The From list
  has one line per name (`StartOption.key`): the start goes by the name it was picked by (the
  `?from=` link's, or the line's: "Main Hall" under Programme, "Sahajanand Hall" under its floor)
  in the list and in step 1. `MapCanvas` keeps every label inside the plan's frame (a room at the
  building's edge isn't cut off by the map's), lets an event room's or the guest's own room's
  label move up or down inside the room to clear another, and skips an event name more than
  `EVENT_LABEL_MAX_SPILL` times wider than its room until zoomed in; `usePanZoom` holds the middle
  of what you can see (between the controls and the room sheet, its `insets`) over the building,
  so a thin floor (the Mezzanine) shows above an open sheet. The hub's
  AutoRefresh skips `/map`, the Santo layout's `/sant/map`. The table is `venue_maps`
  (VenueMap, one row "current", needs `db:push`), written by `scripts/import-venue.ts`
  (`npm run venue:import[:lightsail] -- --file <json> [--rules <json> | --no-rules] [--flows <json>]
  [--compare <json>] [--delegates-change] (--plan | --dry-run | --apply)`; refuses a file inside the repo; prints counts, map ids and
  names the Hub already shows, never blueprint descriptions: team-name coverage (a team name for
  an id that isn't a public room on the map is an error and stops every mode), the event names
  mapped / tentative / null, ids in the alias table that aren't public rooms or are staff only,
  and the room names `prisma/breakouts-data.ts` (each for its track) and the seed's schedule use
  that the table lacks or that aren't on the map; with a database, a count of the goshthi rooms
  likewise. With santo extras: a "Pujya Santo view" section (residence rooms by class and map id,
  entries, santo-only cells and landings), SANT_ROOM_NAMES coverage, and the route check
  (`scripts/venue-route-check.ts`, `checkSantoRoutes()`: santos' public trips equal the delegates',
  every residence room routes to and from the Main Foyer, its nearest public rooms, each floor's
  largest, Sahajanand Hall, the Sant Offices and every other shown residence room, Bhaio, Step-free
  off and on, never crossing a private or staff-only room or another sadhu's own room); a
  santError, a SANT_ROOM_NAMES mismatch or a route-check error stops every mode. What delegates
  get is compared with `--compare <json>` (any mode) and, with --dry-run / --apply, the stored
  row: the map apart from the santo extras and the `toClientVenue()` payload apart from
  generatedAt; a difference stops --dry-run / --apply unless `--delegates-change`). The JSON comes from `scripts/venue/extract.py`
  (Python: PyMuPDF, NumPy, SciPy, Pillow; `--pdf <blueprint> --out <dir outside the repo>`
  `[--public <id>] [--private <id>] [--closed <id>] [--merge <id>+<id>] [--name <id>=<name>]`
  `[--drop-connector <connector id>] [--drop-landing <connector id>:<level>]`
  `[--side <connector id>=left|right|none] [--place <connector id>=foyer|side|back|none]`
  `[--sant <id>] [--not-sant <id>] [--sant-class <id>=own|shared|way]`
  `[--sant-open <santo id>:<id>] [--sant-seal <santo id>:<id>]`
  `[--partition <id>+<id>] [--passage <id>] [--landing <connector id>:<level>=<x>,<y>]`
  `[--route <a>:<b>] [--debug]`, all repeatable; refuses paths in the repo; writes venue-map.json,
  report.json and preview PNGs; a connector's side = its landings' mean x against the middle of
  the first floor's largest public hall, its place = "foyer" near that axis, else "side" in the
  half of the building the main lobby is in, "back" in the far half, both listed in the report;
  the previews' sample routes read `TRACK_SIDE` / `ELEVATORS_FOLLOW_SIDE` from route.ts).
  `--closed` = staff only (shown, named, no entry, floor not walkable); `--merge` = one room of
  two, the partition between them out of the walls and the grid, the first id kept; `--name` =
  the organisers' name for a room; `--drop-connector` = not for guests at all (the freight
  elevator): no connector, its rooms closed rooms named "Freight Elevator"; `--drop-landing` =
  that level off a connector, its room there private; `--partition` = two rooms of one hall a
  movable partition (drawn dashed, closed for the event) divides: their shared floor is split along
  it, so neither outline reaches past it; `--passage` = a room walked through (an alcove): kind
  "corridor", no through-room cost, name kept; `--landing` = where guests reach a stair / elevator on
  one level (the walkable cell nearest the point), only when the organisers' floor plans put it
  elsewhere than the extractor finds it (never to follow a flow drawing's arrowhead: those end at a
  stair room's wall, and the landing belongs inside it, by its door). Every public room guests can go to also gets its door openings (`doors`:
  `room_doors()`, the walkable cells just outside its outline that touch walkable cells inside it,
  8-connected, each with an id "<room id>:<side><n>" (n / e / s / w of its box, numbered west to
  east / north to south), its middle `at`, `width` and the room `to` on the other side; report.json
  lists them under `door_openings` for writing rules). A connector's `name` is "Stairs" /
  "Elevator" (the ids keep the blueprint's numbers, for the terminal only); a shaft room on a
  level its connector doesn't serve for guests is private (a plain block, not drawn as stairs);
  a toilet room the blueprint only counts fixtures in ("N URINAL") is named from that note
  (`FIXTURE_NOTES`). `validate.ts` refuses (routing error) levels not ordered
  B < 1 < 2 < M, and `venue:import --plan` prints each connector's floors, place, side and who
  may use it, and each floor's staff-only count.
  A map imported before 2026-09-30 must be extracted and imported again (plan -> dry-run -> apply);
  one from before 2026-10-01 still works (no `closed`, no `place`: "the stairs"; team names apply
  to the rooms it has as public, and event names for rooms it keeps private read "not on the map
  yet"), and a new map works with the older code (the new fields are optional). After a change to
  the organisers' plans: re-run the extractor with the recorded arguments, `venue:import --plan`,
  then `:lightsail -- --dry-run` and `--apply`.
  The extractor makes back-of-house
  (BACK_OF_HOUSE) and private quarters (PRIVATE_QUARTERS: the sadhus' residence, the deities'
  rooms, the altar, their en-suite baths, and via `residence_zone()` the residence's own
  corridors / common area plus rooms reached only through them) `public: false`, and drops a
  stair / elevator landing that only opens into them.
  Santos' quarters (the Pujya Santo view, user 2026-10-02/03): after the delegates' map is done,
  `settle_sant()` (with `classify_sant()`) marks the sadhus' residence rooms santos may use with
  `sant` = "own" (a sadhu's own room: shown to santos under its SANT_ROOM_NAMES name, a start and
  a destination), "way" (the residence's corridors and common area, its stair / elevator shafts,
  and a room that is the only way into an own room: walkable, never named or shown) or "shared"
  (walkable, never named); they stay `public: false` with `entry` null, plus `santEntry` (the entry
  on the santos' floor), a level's `santGrid` (exactly `grid`'s frame, the residence floor added,
  every opening between it and the delegates' floor that no door swing covers sealed, so a glazed
  partition is no door) and a connector's `santPoints` (a landing only santos use, on a level its
  `points` lack). Never the deities' rooms, the altar or a back-of-house room; `--not-sant` keeps a
  room or shaft private for santos too, `--sant` adds a private room, `--sant-class` sets a class,
  `--sant-open` / `--sant-seal` keep or seal a pair's opening; a residence room cut off or without
  an entry stops the extractor and says which, and a drift guard exits if anything delegates get
  would change. All four fields are optional, `version` stays 1, and older builds ignore them (the
  residence stays outlines there). `validate.ts` puts their problems in `santErrors` /
  `santWarnings` only (plus one id-free routing error if the delegates' grid reaches into a room
  only santos are shown); at run time a santError or a SANT_ROOM_NAMES mismatch only gives santos
  the delegates' map, with a count-only admin note. `breakoutWays()` refuses the santo payload
  (returns nothing), and its caches are per payload object.
  Flow rules (the organisers' flow maps, user 2026-10-04): how guests are to walk beyond what the
  building allows, as data (`VenueMapData.flowRules`, types.ts; `src/lib/venue/flowRules.ts`).
  Kinds: `doors` (a room is left / entered only by some of its `doors` ids), `stairs` (trips to or
  from some rooms arrive on / leave their floor only by some connectors), `avoid` (rooms never
  walked through on the way elsewhere: a trip from or to a room that opens onto one still goes
  through it), `passage` (rooms walked through freely, named in the steps), `side` (stairs on the
  other side a track may use) and, as a last resort, `route` (waypoints for one trip: doors,
  connectors between two floors, points; Step-free off). Each has an `id`, a `track` (BHAIO / BEHNO /
  ALL), an optional `window` ({ day "YYYY-MM-DD", from / to "HH:MM" Eastern, end excluded }) and an
  optional `note` (never sent). The router applies them as costs, never walls (`RULE_PENALTY` x the
  building's long side for a ruled-out door or stair, and once per entry for stepping into an
  avoided room: its cells cost what they always do, so a route that must cross it takes the short
  way across and no other room becomes a cheaper way round), so
  every route that existed still exists and the failure messages stay true; a door rule is a cost
  on the move out of / into the room through an opening it rules out, except a ruled-out door
  straight into another enclosed room that no allowed door reaches when that room is the trip's
  other end (`RouteRules.doors` `beyond`: the Main Hall and its cry room); a trip from a room left
  by its door (`startsAtDoor()`) starts at its allowed exits (`RouteEnd.fromDoors`; `routeBetween()`
  passes both rooms' ids; /map's start pin, 2D and 3D, is the line's first point). A route that
  takes the other side's stairs (`exception`) names the side of every climb that has a twin
  ("the side stairs on the right"). Rules are compiled once per router per set (`RouteRules.key`).
  Keep each rule as narrow as the drawings show (a track, a window, one trip for a route rule) and
  check the all-pairs effect: a passage or avoid rule for ALL, always, changes thousands of trips.
  `routeRulesFor(data, rules, at, track)` narrows the stored rules to those in force at a time for
  a track, resolved for the router (door middles, ids, waypoint points): what a browser gets, never
  the stored rules; a guest with no gender on file gets the ALL rules, and for a room both tracks'
  door rules restrict, either track's doors. `getVenueForPages()` returns `rulesAt(at, track)`
  (memoised per set in force) and `nextRulesChange(after, track)`: `/map` and `/sant/map` (santos
  as Bhaio) take them through `mapRules()` (`src/lib/venue/mapPage.ts`): at `?at=` (a /breakouts
  card's link: its session's printed start, used while on an event day and not more than an hour
  gone, with a line under the steps when those rules differ from now's), else at the page's now
  (`?now=` honoured), and refresh the page (`router.refresh()`, `rulesUntil`) when a window opens
  or closes, since AutoRefresh skips them; the stair markers and the From list count a `side`
  rule's stairs as the guest's. `/breakouts` takes each session's printed start. A window must
  cover the walk to its session (start it about 15 minutes before), not only the session; a large
  live shift of a session (/admin/schedule) needs its windows moved in the rules file and
  re-imported. `validate.ts` checks the rules and the
  doors they name (`ruleErrors` / `ruleWarnings`; `rules` null on any error): an unknown kind, a
  room that isn't one guests can go to, a door that isn't one of the room's (or isn't an opening on
  the grid), a stair or level the map doesn't have; at run time any error means no rule applies
  (never no map), with a count in the admin note. The rules live OUTSIDE the repo in a rules file
  (`flow-rules.json`, a list or `{ "rules": [...] }`): `venue:import` merges it into the stored
  map (`--rules <file>`, else `flow-rules.json` beside the map file or in its parent folder;
  `--no-rules`: needed to import a map extracted before 2026-10-04, e.g. a rollback, since it has no
  door ids), prints the rules by kind with the rooms, doors and stairs they name, and stops on
  any rule error; it compares the doors the rules name with the same ids in `--compare` and the
  stored row (a re-extraction renumbers a room's doors when an opening on that side is added, split
  or merged): one that moved more than a grid cell or leads into another room stops `--dry-run` /
  `--apply` unless `--doors-checked`; `--flows <file>` (the organisers' trips matched onto one
  extraction's grid: kept beside the venue files, outside the repo, and matched again after new
  drawings or a re-extraction that changes room ids; without it a line says the rules weren't checked)
  runs the flow check, `scripts/venue-flow-check.ts` (`checkFlows()`, also on its own: `--map`,
  `--flows`, `[--rules]`, `[--baseline <earlier map>]`, `[--details]`, `[--out <json outside the
  repo>]`): per trip the app's route (the trip's track, Step-free off, the rules in force at its
  time: a breakout's start, else the start of what it leads to) against the drawing, classed
  MATCH / DOOR / PATH / CONNECTOR / UNRESOLVED / NO_WALK (the end rooms and the last ~5 m before a
  stair the trip takes aren't compared: the drawings end their arrows at the stair's wall); it prints counts per class and group and
  the ids of trips that don't match (never coordinates), the regressions against --compare /
  --baseline, and the trips whose class differs with the rules taken `WALK_LEAD_MIN` (10) minutes
  earlier (what /map shows on the way: a window that starts with its session). `scripts/venue-route-check.ts` runs once per set of Bhaio rules the map can have in
  force (no time, and a time in each window), both santo routers given the same rules. To change a
  rule: edit the rules file, `venue:import -- --file <map> --plan --flows <flows> --compare <the
  map imported last>`, then `:lightsail -- --dry-run` and `--apply` (with `--delegates-change`:
  rules change delegates' routes). The rules file keeps the organisers' open questions beside the rules.
- `.env.lightsail` (gitignored) holds the Lightsail `naam-users` DATABASE_URL; use the
  `*:lightsail` npm scripts to run against it. Never seed mock users into Lightsail.
- `src/app/page.tsx` — login. `src/app/(hub)/*` — delegate pages sharing a layout with
  header + bottom nav (the layout redirects santos to `/sant`). `src/app/sant/*` — the Pujya
  Santo view (home, schedule with My/General tabs, menu, breakouts (blocks of the sessions they
  can join), venue map, stay, transport, profile; `requireSant()`).
  `src/app/api/auth/*` — request-otp, verify-otp, logout.
- Santo breakouts (`/sant/breakouts` + the Santo home's Breakouts tile; user, 2026-10-02): santos
  have no breakout sessions of their own; they join whichever team breakout they like, Bhaio only,
  never a Behno one, and of the combined ones (both tracks hold them) only those the organisers
  mark "Santo joining" (user, 2026-10-02: `santos` in `prisma/breakouts-data.ts`, 8 sessions; with
  the 2026-10-02 data 59 sessions: Friday morning 22, afternoon 15, Saturday morning 22), shown at
  the marked time with a "Santo joining" chip. `src/lib/santBreakouts.ts`: `getSantBreakouts()` reads the
  real team breakouts (`getTeamBreakoutRows()`: the `bk-` rows, with their live moves; never
  `users.breakout_sessions`, `getBreakoutsForUser()` or the Santo sample rows), folds them with
  the display API's `foldSessions()` (`src/lib/breakoutSessions.ts`, shared: one session per
  track + start + end + title + room + note, teams merged), `santBreakoutSessions(rows, marks)`
  (pure; `marks` = `santoJoiningByRowId()`, worked out once per server instance) keeps the BHAIO
  ones any of whose rows carries the mark (`santoMarkOf()`), at the window (`santoWindow()`: the
  live start plus the offsets, the end at most the live end; nothing left of it = the live
  session) and flagged `santoJoining`, and the other BHAIO ones less every combined one
  (`isCombined()` / `sharesSession()`: a BEHNO session on the
  same event day, times overlapping (touching isn't), and a room in common: `splitVenueNames()`,
  compared by `normalizeVenueName()`); a marked session's times are the window everywhere
  (blocks, statuses, Done, order, the home tile). `breakoutBlocks()` groups them per event day into blocks
  of overlapping or touching sessions (id `blk-<day>-<HHMM>`, `blockLabel()` "Friday morning" /
  "afternoon" (before 17:00 Eastern) / "evening"), `blockStatuses()` (now; next = the first block
  still to start, even while one is on; upcoming; past) and `santBlockViews()` (plain props:
  sessions by start then title, a session's own time only when it differs from the block's,
  `santoJoining` (the card's "Santo joining" chip: ember-700 on coral-100, sand when the session
  is over), its note, each room `{ name, href, offMap }`). The page (`SantPageHeader`, then
  `<SantBreakoutBlocks>` in `src/components/sant/pages/`: a card per block whose header is the
  `<SantBlockToggle>` button, the island's only state being open / closed; several may be open;
  the block on now opens, else the next one, `defaultOpenBlock()`; past ones quieter, and so is a
  session already over in a block still on, marked Done: the view's `over`) links a room
  on the map for the Bhaio track and not staff only to `/sant/map?to=` (`venueHref(…, { base:
  "/sant/map", track: santVenueTrack(sant), now })`), else plain text with "Not on the map yet";
  with no venue map at all, plain. Never headcounts, facilitators, team prefixes, the sheet's room
  numbers or "joint". The home tile (`blockRows()` in `data.ts`, `breakoutsTile()` in
  `tiles.ts`): the block on now ("Now · until …", "N sessions"), else the next one (a countdown
  within the hour, else `startsWhen()`), else "All breakout blocks are over"; none: "Breakout
  sessions coming soon".
- `src/app/(hub)/dashboard/page.tsx` + `src/components/dashboard/` — home: starts with the dusk
  hero (countdown / live now-next clock, a client island that honours `?now=`, over a
  `<SachuFlurry>` band of "SĀCHU" words), then colour tiles. No murti on either home page.
  The tiles between the Schedule and History bands are a 2 x 2 of one size (user, 2026-10-01): Menu,
  Breakout Sessions, Transportation (the guest's next leg, `transportTileSummary()`) and Accommodation
  (their hotel and room group, `stayTileSummary()`; always shown, "No hotel room on file" when they
  have none, so the grid keeps its shape). It links to /stay ("Your stay" in More).
- `src/app/(hub)/transportation/page.tsx` + `src/components/transport/` — the delegate's own
  transport: "Your arrival" / "Your departure" cards (`TransportLegCard`: date and time as given at
  that airport, flight, pickup / drop-off group and its size, driver with tap-to-call once
  assigned; a Today / Done chip via `legPhase()`, which honours `?now=`), then who to call
  ("Need a change?": `<HelpContacts>` with the guest's TRANSPORT + GENERAL contacts; left out,
  with every "please get in touch" line on the cards, when they have none).
- `src/app/(hub)/stay/page.tsx` + `src/components/stay/` — the delegate's own hotel stay (in
  More as "Your stay"): a `StayCard` per room group (hotel name, plus full name / address / phone /
  times once `hotels.ts` has them; "Room group N" with "Your actual room number is given at
  check-in"; from which night; the roommates by name and center (user, 2026-10-01), those without an account counted, not
  named; the hotel's "Hotel Liaison" for their track ("Hotel Liaisons" when several, each with
  its own Call button), once per hotel on its first card still on, none when the hotel has none),
  a "Check-in today" chip via `stayPhase()` (honours `?now=`), then "Questions about your room?"
  (`<HelpContacts>` with the guest's STAY + GENERAL contacts; left out when they have none). Two
  cards when the Wednesday room group differs from the Thursday one. "Hotel details aren't
  available yet" until the rooming list is imported; "No hotel room on file" when it is and they
  have none (`StayEmptyCard`: the contacts under the message when there are any).
- Navigation: the bottom nav has four tabs + More (`src/components/MoreSheet.tsx`), which lists
  every other page of the view; add new pages to `DELEGATE_MORE` in `BottomNav.tsx` /
  `SANT_MORE` in `SantBottomNav.tsx` (and a delegate page's path to `PROTECTED` and the matcher
  in `src/middleware.ts`; `/sant/*` is already covered; `/here` is too, for the NFC tags). The delegate More lists Transportation,
  Your stay, Venue map, Dress code, the Prasang form, History and the profile; the Santo More
  lists Accommodation, Breakout Sessions ("Sessions you can join"), Venue map (`/sant/map`) and
  the profile. The admin console has five tabs (Overview, Delegates,
  Announce, Schedule, Logistics) and no More. Logistics leads to `/admin/transport` (and stays
  on `/admin/rooming` when you're there); a Transport | Rooming switch (`LogisticsSwitch`) tops
  both boards. `/admin/bounces` has no tab: the Overview's bounces card and the directory's
  "Email bounced" note lead there.
- `src/app/admin/*` — the admin console (`users.role = ADMIN`): overview, delegate directory
  (search/filter/sort, add/edit), announcements (targeted or to specific people, send now or
  scheduled), live schedule (shift/extend/edit/reset/undo), transport and rooming boards, email
  bounces. Server actions in `src/app/admin/*/actions.ts`; logic in `src/lib/admin/`
  (`delegates.ts`, `announcements.ts` = the notification targeting rule, `announcementPeople.ts` =
  the "Specific people" search and look-ups, `schedule.ts` = the schedule engine, `overview.ts`,
  `emailEvents.ts` = the bounce tracker).
- Announcements to specific people (`/admin/announcements`, Audience step): `<PeoplePicker>`
  (`src/components/admin/announcements/`) searches by name, BAPS ID or the organisers' User Id
  through `searchAnnouncementPeople()` (a server action that checks `getAdmin()` itself; at most 20
  matches, each only the account id, the name (`greetingName()`; a sant's `santName()`), BAPS ID,
  role and `sevaLabel()`; "%" and "_" in a query match only themselves), lists the picked people
  as removable chips (in a box that scrolls once the list is long) and says "Goes to N people".
  Enter picks a match only after an arrow key has highlighted one, or when there is exactly one:
  the phone keyboard's "search" key never picks whoever is first. Delegates, santos and admins
  can all be picked, at most `PEOPLE_MAX` (100); with an admin picked a hint says admins see the
  bell on the delegate pages, not in the console. While people are picked the Role / Track / Seva /
  Hotel / Region filters keep their values but sit in a disabled fieldset with one line saying why;
  clearing the people brings them back. A draft for specific people must never become one for a
  wider audience without the admin deciding so (keep it that way): a template fills the message
  and the filters but keeps the picked people (the toast says "It still goes only to …"), "Send
  again" asks before replacing them, and the draft keeps the picks with their names in state but
  only the account ids in localStorage (`draft.ts`): a restored draft looks them up again
  (`lookUpAnnouncementPeople()`; "Review & send", templates and "Send again" wait for it), and
  when they can't be brought back (accounts gone, look-up failed) the composer holds a notice that
  blocks "Review & send" until the admin changes the audience or accepts it; until then the ids
  stay in storage (`lostPeople`, `saveDraft()`'s `heldPeopleIds`), so a reload or coming back to
  the tab asks again. `publishAnnouncement()` refuses when a picked account no longer exists
  (`gonePeople`: they come off the list and the confirmation closes) and when a people list comes
  to nothing (blank ids): it never falls back to the filters. The history row reads "To N people ·
  Reaches N of M" (M = accounts listed, N = those that still exist) with their names (a name two
  of them share carries its BAPS ID, `listNames()`), admin only; "Send again" brings back the
  people who still have an account and refuses when none do.
  `npm run notify -- --to <BAPS ID>` (repeatable or comma-separated) does the same from the
  terminal; `--to` can't be combined with `--audience` / `--roles` / `--sevas` / `--hotels` / `--regions`;
  `--hotels hampton,courtyard` targets a hotel's guests (not with `--regions`).
- `src/app/admin/transport/` + `src/components/admin/transport/` — the read-only transport board
  (`?dir=arrivals|departures`, `?day=YYYY-MM-DD|all|none`, the console seva filter): per day and
  airport the numbered groups with their driver, "Not grouped yet" and "No pickup needed", an
  in-browser search and a Flagged chip, and the sheet's oddities as coral warnings (`board.ts`
  mirrors the import's flags). A coral note (`HelpContactNote`) says when delegates of a track see
  no transport contact (no DELEGATE hotline with topic TRANSPORT or GENERAL for them). `TransportGlance` is
  its card on the Overview. Nothing is edited there: the next import replaces the data.
- `src/app/admin/rooming/` + `src/components/admin/rooming/` — the read-only rooming board
  (`?stay=main|wed`, default main; `?hotel=<key>`; the console seva filter): per hotel every room
  group the organisers booked (`room_groups`, even one nobody could be placed in) with its
  occupants by bed (name linking to their directory entry, BAPS ID, seva, a non-Registered
  status, their room group in the other stay), open beds, beds held by a sheet conflict (by User
  Id), people not in the app yet (by User Id) and rooms mixing Bhaio and Behno (noted as family /
  couple rooms, never fixed); an in-browser search and "Open beds" / "With notes" chips
  (`board.ts`); each hotel's header lists its Hotel Liaisons by track, with a coral note when
  guests there have none for their track; and the same `HelpContactNote` up top when delegates of
  a track see no accommodation contact on /stay (topic STAY or GENERAL). Nothing is edited there:
  the next import replaces the data.
- Console-wide seva filter: repeated `?seva=` params (the directory's format), read with
  `readSevaFilter()` and written with `withSevaFilter()` (`src/lib/admin/sevaFilter.ts`, pure;
  options from `getSevaOptions()` in `sevaFilterData.ts`), UI `<SevaFilter>` in
  `src/components/admin/shell/`. Overview (people KPIs, "Where they are" breakouts, recent
  announcements, the transport card), announcements history ("Reaches N of M", "Target these
  sevas"), the live schedule (the picked teams' sessions in each Team Breakouts slot) and the
  transport board (people whose account has a picked seva; legs without an account never match)
  and the rooming board (room groups with anyone of the picked sevas, listed with everyone in
  them) follow it; the directory uses its own seva facet over the same params. The admin bottom nav
  carries it between tabs (`BottomNav`'s opt-in `carry` prop; delegate/Santo navs carry only
  `?now=`).
- `src/lib/auth.ts` — session cookie (`hh_session`) helpers, `requireGuest()`, `requireSant()`,
  `requireAdmin()` (pages), `getAdmin()` (actions/route handlers), `homePathFor()`.
  `requireGuest()` applies mirror test accounts (`withMirror()`, `mirrorOf` for the header band:
  a delegate by User Id, a sant by `santName()` and BAPS ID; `dataUserId` = the users.id the
  Santo pages' per-person reads use: the mirrored sant's for a Santo mirror, else the account's
  own). The sant layout passes `mirrorOf` to `HubHeader` as the hub layout does.
- `scripts/tester-personas.ts` — mirror test accounts TEST0101–TEST0110, each showing the hub as
  one real delegate sees it (Bhaio/Behno, hotel/no room, transport/none, ...):
  `npm run testers:personas[:lightsail] -- (--plan | --apply | --remove)`. `--plan` is read-only
  (User Ids only, never names); `--apply` upserts only those ten rows in one transaction (each
  with its own random tester code from the git-ignored `.tester-personas.local`, lockout reset,
  `mirror_registration_id` = the lowest-User-Id candidate); `--remove` deletes only them
  (removed from Lightsail on 2026-10-05; only the volunteer account and the tester sant remain).
- Volunteer account (user, 2026-10-05; `src/lib/volunteer.ts`): BAPS ID `VOLUNTEER`
  (`VOLUNTEER_BAPS_IDS`; no column, so older builds treat it as a delegate), role DELEGATE, no
  gender (both tracks), no seva / goshthi / User Id, a tester code: a shared sign-in for the
  event's volunteers that sees ONLY the schedule, the menu, the venue map and the Edison Mandir
  History (plus the profile, to sign out; user, 2026-10-05).
  `requireGuest()` sends it from any other page to `/schedule` (the page's path comes from the
  middleware's `x-hh-path` request header, `PATH_HEADER`, which the middleware always sets, so a
  client-sent one never counts); `homePathFor()` lands it on `/schedule`; the hub layout gives
  it the Schedule, Menu, Map and History tabs only (`BottomNav volunteer`, no More) and a home
  link to the schedule; the schedule's Breakout rows don't link to `/breakouts`; the map has no
  rooms of their own (no goshthi or breakouts) and, with no gender on file, every stair.
- NFC tags (user, 2026-10-06; `src/lib/here.ts`): tags around the mandir hold
  `https://naam-five.vercel.app/here/<place>`; scanning one opens the venue map with that place as
  "You are here". `<place>` = a room's title as a slug (`hereSlug()`: "main-foyer",
  "sahajanand-hall", or an event name, "main-hall") or, when that slug finds more than one room
  (twins, one room per track, stairs), its map id; the links are made from the stored map, never
  written into committed files (admins see each room's link, with Copy, in its /map room sheet:
  `hereLinks()` in `src/lib/venue/mapPage.ts`, the `tagLinks` prop, `RoomSheet`'s `TagLink`).
  `src/app/here/[place]/page.tsx` (`requireGuest()`) redirects a sant to `/sant/map?here=`, everyone
  else (delegates, admins, the volunteer account: `/here` is in `VOLUNTEER_PATHS`) to `/map?here=`,
  `?now=` passed on. Signed out (a phone opens a tag in its default browser, not Telegram's), the
  middleware sends them to `/?next=/here/<place>` and sign-in returns there (`LoginForm`'s `next`,
  the login page's "see where you are" line); a stale cookie goes through
  `/api/auth/expired?next=`; signed in on `/?next=` goes straight to it. `next` is only ever a
  `/here/<slug>` path (`hereNextPath()`), never another page or site. The middleware leaves the
  sign-in splash for the map's own request. The map (`mapHereLink()`, `VenueMap`'s `initialHere`):
  resolved with NO track (where a tag is doesn't depend on who scans it; a name finding several
  rooms finds none: "This tag's place isn't on the map yet", directions from the Main Foyer); it is
  the start in place of `?from=` (the other side's stairs too: the guest is standing there, and
  routes from them still climb only their own side's), opened on its floor and framed, a pulsing
  dot with a "You are here" pill (`MapCanvas` `startHere`; on the route's first point once there is
  a route), a "You are here" card over the search and the first group of the From list, all while
  it is the start (picking another start ends it).
- `src/lib/sant.ts` — santos' personal schedule (`sant_schedule_items`: the real santos' rows,
  `sp-*`, are written only by `npm run sant:personal:sync` from `prisma/sant-personal-data.ts`,
  the tester SANTO0001's only by `sant:demo`; same `ScheduleItemView` shape as the general
  one), `getSantSchedules(userId, now)` (general + personal), utaro (`getAccommodation(userId)`;
  shared: `users.sant_accommodation_id`, with companions, never `userId` himself;
  `AccommodationView` has no address; the host's name and phone and the notes, e.g. the Wi-Fi
  password and the organisers' introduction of the host family ("Haribhakto Parichay"), live only
  in the database, set with `sant:utaro`), the SANT hotlines (`getHotlines()`, `santContactsFor()`), and `santName()` (plain name, no
  "Pujya"/"Sadhu"/"Swami" — the only way to show a sant's name; it lives in the pure
  `src/lib/santName.ts`, re-exported here, so `auth.ts` and scripts use it too). Per-person reads
  (`getSantSchedules()`, `getPersonalSchedule()`, `getAccommodation()`) take the `requireSant()`
  object's `dataUserId`, never its `id` (Santo home, schedule, transport, stay), so a Santo mirror
  shows the mirrored sant's programme, rides and utaro. `src/lib/santSchedule.ts` —
  `getSantGeneralSchedule(now)`: `sant_general_schedule_items` adapted to `ScheduleItem` (audience
  ALL, never moved) and annotated. `npm run sant:demo` recreates the tester sant SANTO0001
  (+ sample companions SANTO0002/3; no menu: it deletes a sample menu an older version left,
  `sample-santo-meal-*`, and never touches the real `sm-*` meals; no breakouts: santos have none
  of their own, so it deletes the sample Santo breakouts an older version left,
  `sample-santo-breakout-*`, and never touches the `bk-*` rows; `--remove` deletes all of it,
  SANTO0001's mirror with him); `npm run sant:demo -- [--env .env.lightsail] --mirror <BAPS ID>`
  makes SANTO0001 a Santo mirror of that sant (sets only his `mirror_registration_id`, after
  checking exactly one other SANT has that BAPS ID and SANTO0001 is the sample sant; prints the
  BAPS ID and `santName()`, never the code), `--mirror off` clears it, `--mirror` with `--remove`
  is an error, a plain run keeps it, unknown options are refused;
  `npm run sant:utaro` creates utaros and places santos by hand (it prints an utaro's notes,
  which may hold a Wi-Fi password, only with `--show-notes`). `santVenueTrack()` = the venue
  map track of a sant (`santGender()`: Bhaio), for `/sant/map` and the `/sant/breakouts` room links.
- `src/lib/prasang.ts` — the reporting team's Prasang form (URL, title, subtitle): the card on
  the delegate home and `/prasang` (the in-app page announcements link to; the admin composer
  has a "Prasang form" template aimed at delegates).
- Sign-in splash: `src/lib/splash.ts` (cookie, wallpaper URLs, preload) +
  `src/components/brand/LoginSplash.tsx` (server) / `SplashArt.tsx` (shared markup) /
  `SplashReveal.tsx` (client island) / `splash.module.css`. verify-otp also sets `hh_splash`
  (not httpOnly, 2 min); LoginForm then dismisses the keyboard and covers the login page with
  `<SplashArt>` (portalled to body) while home loads. `src/middleware.ts` uses the cookie up on
  that first document request (deletes it, passes `x-hh-splash: 1` on as a request header), and
  the (hub), sant and admin layouts mount `<LoginSplash />` as the first child of `.app-shell`,
  which then shows the same wallpaper (light/dark by `prefers-color-scheme`) and blurs it away.
  The reveal is pure CSS (finishes without JS); the island lets a tap/key skip the hold and
  unmounts the layer. The two wallpapers get a day-long `Cache-Control` in `next.config.ts` so
  home reuses the login page's preloaded copy without a round trip.
- Venue Wi-Fi (open network `BAPS_5G`) is an announcement, not a page: the "Venue Wi-Fi"
  template in `src/components/admin/announcements/templates.ts` (no link, so it opens in the
  bell's full-screen reader).
- `src/lib/otp/` — code generation/verification; providers in `providers/`. `providers/aws.ts`
  sends the sign-in email from `SES_FROM_EMAIL` (default `DEFAULT_SES_FROM` =
  `NAAM 2026 Hospitality Hub <noreply@sypramsoftware.com>`, the DKIM-verified SES identity), with
  optional `SES_REPLY_TO` and `SES_CONFIGURATION_SET`; plain transactional mail (no links or
  tracking; the one image is the inline `cid:` Sāchu logo from `emailLogo.ts`;
  `Auto-Submitted: auto-generated`). The subject starts with the code. The configuration set
  (`naam-hospitality-hub`) sends bounces, complaints and rejects to the SNS topic
  `naam-ses-bounces-complaints`, which feeds the bounce tracker (next bullet).
- Email bounces (user, 2026-10-04): `/admin/bounces` + `src/lib/admin/emailEvents.ts`
  (`getEmailBounceTracker()`, `getBounceCounts()`, `getOpenBounceNotes()`, resolve / reopen) over
  `email_events` (one row per SES event and recipient, id `<feedback id, else SES message id>:<recipient>`,
  so a redelivery or a backfill of the same event is stored once). Written by `POST
  /api/ses/events` (`src/app/api/ses/events/route.ts`, source "sns"): an Amazon SNS HTTPS
  endpoint, off (404) unless `SES_EVENTS_TOPIC_ARN` is set; the message's TopicArn must equal it
  (403 before any fetch), the SNS signature is checked (`src/lib/emailEvents/sns.ts`:
  SignatureVersion 1 = SHA1withRSA, 2 = SHA256withRSA, the AWS canonical string per type, the
  certificate only from an https `sns.<region>.amazonaws.com` URL ending .pem, no redirects,
  cached per URL; 403 when bad), a SubscriptionConfirmation is confirmed by visiting its
  SubscribeURL (same host rule, this topic only), an UnsubscribeConfirmation does nothing, and a
  Notification's SES event (`eventType` or `notificationType`) becomes rows
  (`rowsFromSesEvent()`, `src/lib/emailEvents/ses.ts`: Bounce per bouncedRecipients, Complaint
  per complainedRecipients, Reject per mail.destination) inserted with `skipDuplicates` (a
  resolved row stays resolved); a database error is a 503 so SNS retries. Raw message delivery
  must stay off. THE SUBJECT HOLDS THE SIGN-IN CODE: never read, store, log or return
  `mail.commonHeaders`, `mail.headers`, `mail.source` or recipients other than the affected ones;
  the server's reply (`diagnostic`) is one cleaned line, cut to 300 characters, with any 6-digit
  number masked; the route logs only kind and counts. Also written by `npm run
  ses:bounces[:lightsail] -- --backfill [--dry-run] [--profile <aws profile>]`
  (`scripts/ses-bounces.ts`, source "suppression-list"): the SES account suppression list
  entries whose address is a Hub account's email (the AWS account is shared with other
  businesses: every other address is only counted, never printed or stored); `-- --list` prints
  counts and per open address the BAPS ID (never names or phones). The tracker folds rows per
  address (`src/lib/emailEvents/view.ts`, pure: labels "Hard bounce" = Permanent, "Soft bounce" =
  Transient, "Bounce", "Complaint", "Rejected", plain subtypes, severity; Open while any row has
  no `resolved_at`, so a new event reopens it) and matches the accounts whose email is that
  address now with `lower()` in SQL (never Prisma's insensitive equals: ILIKE treats `_` as a
  wildcard); none = "No account with this address". Mark resolved (optional note, 200
  characters) sets `resolved_at` / `resolved_by_id` / `note` on the address's open rows; Reopen
  clears the first two. Both are server actions that call `getAdmin()`. A hard bounce is on the
  SES suppression list: SES sends nothing more to it until it is removed there, while a
  corrected email in the directory works at once (the page and the directory note say so). The
  Overview shows `BouncesGlance` ("Email bounces · N open", one quiet row when none is open,
  nothing while nothing has bounced); `PersonDetail` notes "Email bounced" under an email with an
  open bounce (`getOpenBounceNotes()`, keyed by the lower-cased address, so it goes away when the
  email is changed). Missing table (P2021) = "not set up yet", never a crash. The table needs
  `db:push[:lightsail]`.
- `src/lib/schedule.ts` — now/next annotation and the menu reveal rule
  (`revealTime` = max(previous meal end, meal start − 1 h); delegate menu only: `menuIsTimed()`
  is false for SANT, whose meals are open from the start, user 2026-10-02).
- `src/lib/time.ts` — `EVENT_TZ`, `EVENT_DAYS`, `SANT_DAYS` (Oct 5–15; must equal
  `SANT_SCHEDULE_DAYS` in the data file) + `santDayOf()`, `formatDayRange()`, formatting, `?now=`
  override parsing.
- `src/middleware.ts` — protects hub routes; redirects signed-in users away from `/` (to a valid
  `?next=` NFC tag path, else /dashboard; signed out, a `/here/<place>` keeps itself as `next`);
  passes each protected page its path (`x-hh-path`, for the volunteer account) and the splash cue. It never
  matches `/api/*`: route handlers check their own callers (`/api/display/*` a key,
  `/api/ses/events` the SNS signature and topic).
- `src/app/api/display/*` + `src/lib/display.ts` — the read-only display API for the TV screens
  around the mandir (another developer's screens; docs/DISPLAY_API.md): `schedule`, `menu`,
  `breakouts`, `now`, GET + OPTIONS. Gated by `DISPLAY_API_KEYS` (comma-separated; unset = 404;
  keys under 24 characters ignored): `Authorization: Bearer <key>` or `?key=`, compared in
  constant time. CORS `*`, `Cache-Control: no-store`, `?now=` through `pageNow()`. Auth, query
  parsing (`day` = an event day | `today` | `all`, `track` = bhaio | behno | all), serialisers
  and the exported response types live in `display.ts`; the routes stay thin. The team breakouts
  are read and folded into sessions by `src/lib/breakoutSessions.ts` (`getTeamBreakoutRows()`,
  `foldSessions()`), shared with the Santo breakouts.

## Conventions

- Server components fetch data and pass plain serialisable props (ISO strings) to client
  components (`ScheduleView`, `MenuView`).
- Every hub page computes `now` via `pageNow(searchParams)` so time-travel works uniformly.
- Hub pages read per-person data (gender, seva, goshthi group, breakouts, `registrationId` for
  transport/stay) from the `requireGuest()` object, never a fresh `users` lookup, so mirror test
  accounts work. Mirroring needs a DELEGATE with a `test_code`, `mirror_registration_id` naming a
  DELEGATE, and `ALLOW_MIRROR_TESTERS=true` (off by default); or (user, 2026-10-02) a SANT with a
  `test_code` whose `mirror_registration_id` is the BAPS ID of another SANT (case-insensitive;
  santos have no User Id): it takes his gender, seva, region, center and utaro, and Santo pages
  read per-person data (personal schedule, rides, utaro) by the guest's `dataUserId`, never
  `id` (set with `sant:demo --mirror`). Never for ADMIN. Writes, the bell's read state and
  personal announcements stay keyed on the session's own user id. Mirror accounts show real
  people's data (a Santo mirror: a real sant's utaro and programme) behind a static code:
  remove them (`testers:personas --remove`, `sant:demo --mirror off` or `sant:demo --remove`)
  and set the flag false after testing.
- Sign-in codes (`src/lib/otp/`, user decision 2026-09-30: emails to the delegates' Microsoft 365
  mailboxes can arrive late): a resend never cancels the earlier codes; any unexpired code the
  guest was sent signs them in, and signing in ends all of them (one statement). Attempts are
  claimed before a code is compared: one guess claims a try on every live code in one raw
  `UPDATE ... RETURNING` (rows locked in id order and re-checked under the lock, so parallel
  requests can't exceed the limit or deadlock) and is compared only with the codes it claimed;
  each code allows `OTP_MAX_ATTEMPTS` tries (the 2-minute replay grace, which only the code that
  signed in gets, counts too). The wrong try that uses up the last one answers
  `TOO_MANY_ATTEMPTS` itself; an older code of theirs typed after it expired, while a later one
  is live, answers `EXPIRED_CODE` (it still costs a try; expired codes are looked at for that
  message only). `requestOtp()` allows `OTP_MAX_SENDS_PER_WINDOW` (5) codes per 10 minutes,
  counted and stored under a per-user advisory lock (never the `users` row; the transaction
  starts with `SET LOCAL lock_timeout = '2s'`, because Prisma's timeout can't interrupt a lock
  wait). A code whose delivery failed is deleted and doesn't count, but only while its
  `attempts` is 0: one a guess was ever compared with is kept, ended, and counts.
  `verifyOtp()` only compares codes created within that limit (`WITHIN_SEND_LIMIT`), so
  guessing is bounded by sends × tries = 25 one-in-a-million chances per 10 minutes of sends
  whatever wrote the rows: change either constant only with that in mind, and never delete or
  stop counting a code a guess was compared with. Dates go into the raw SQL through `utc()`
  only (the session time zone must not matter). Sign-in never waits on the guest's `users`
  row: `recordSignIn()` writes `last_sign_in_at` with `SKIP LOCKED` (that sign-in goes
  unrecorded while an import holds the row). The guest lookup (`findGuest()`) is repeated on
  Prisma's P1017 (a dead pooled connection); nothing after a claim is ever retried. A refused
  request is a 429 with `Retry-After` /
  `retryAfterSeconds` (until the oldest counted code leaves the window), `codesUsable` and the
  wait in words; the login form counts Resend down to it (by the clock, not by ticks) and, from
  the ID step, goes on to the code step only while a code already sent is still usable. Resend
  opens after 60 s. A database error in either route is a JSON 503. Never tell guests to "use
  the newest code". Tester codes allow 5 tries per 15 minutes, locked until reset after 3
  lockouts (`users.test_code_failures / _lockouts / _locked_until`, reset by
  `testers:personas --apply` or `user:upsert --testCode`).
- EMERGENCY direct sign-in (user, 2026-10-05; `src/lib/directSignIn.ts`): with
  `DELEGATE_DIRECT_SIGN_IN=true` (Vercel production since 2026-10-05, 10:28 PM Eastern, because
  BAPS's Microsoft 365 rejected the code emails to most na.baps.id mailboxes: "550 5.7.1
  TRANSPORT.RULES.RejectMessage", a mail-flow rule only BAPS IT can change), a DELEGATE without a
  `test_code` who enters their BAPS ID or email is signed in at once by `/api/auth/request-otp`
  (same session and splash cookies as verify-otp; logged by account id only); emails are matched
  with `lower()` in SQL, never ILIKE. Admins, santos and fixed-code accounts still get a code, and
  the login form (`directSignIn` prop) reads "BAPS ID or email". It gives up the code: anyone who
  knows a delegate's BAPS ID can sign in as them. Unset the variable and redeploy once BAPS IT lets
  the sender through; sessions it started last their 7 days. Off anywhere the variable isn't
  exactly "true".
- Store times in UTC; format only through helpers in `src/lib/time.ts`.
- `users.breakout_sessions` empty means "not linked"; `getBreakoutsForUser()` then falls back to
  rows whose `seva` is in `teamCodesFor(user.seva)` and whose `audience` is on the user's track
  (`tracksFor(trackGender(user))`). Delegates and admins only: the Santo view never calls it.
- Team breakouts: edit `prisma/breakouts-data.ts`, then `npm run breakouts:sync[:lightsail]` (the
  Lightsail DB needs `db:push:lightsail` for `breakouts.audience` first; a sync keeps live moves
  from /admin/schedule, the seed resets them). One row per team per track: `seva` = canonical
  team code, `audience` = BHAIO/BEHNO (mock and Santo sample rows stay ALL). Seva spellings from
  the master list map to codes through `TEAM_ALIASES`/`teamCodesFor()` (Satsang Admins → SA,
  Campus → CE, BKSTL → BSTL + KSTL, RMC/RMCA → "RMCs + RMCAs", ...); add new spellings there, not
  in the data. In the sheet `e` = Bhaio (Kishore), `i` = Behno (Kishori), `ei` = both: never show
  those prefixes (show a guest's seva through `sevaLabel()`, which strips them), headcounts or
  the sheet's room numbers, and never call a session "joint" (a session for both tracks is one
  entry per track). A team split across rooms lists every room with `SPLIT_NOTE` ("Split amongst
  these rooms.") until the split is final (a multi-room entry without a note gets it anyway).
  Santos have no breakout sessions of their own (user, 2026-10-02): `/sant/breakouts` offers them
  every Bhaio session that isn't combined with Behno, plus the combined ones marked "Santo
  joining" (`santos` in the data, at the marked time), in blocks (see the Santo breakouts bullet);
  never give a sant `breakout_sessions` or Santo rows of his own.
- Master list (organiser rules, in `delegateImport.ts`): the workbooks and the `--out` plan JSON
  (the script refuses a path inside the repo) hold personal details: keep them out of the repo
  and never copy rows into code, data files or docs (the printed summary has only counts, User
  Ids and BAPS IDs; names, emails and phones are never printed). Refunded registrations are
  imported (status as given) and listed, in case anything changes (organisers, 2026-09-27); a
  User Id on two rows is imported once, from the row with a usable Seva Wing/Seva (phone from
  either row; differing statuses listed). Skipped and listed by the plan: rows of one User Id
  with different BAPS IDs or different sevas, no usable BAPS ID, a BAPS ID shared by several
  User Ids, no usable Seva Wing/Seva. `baps_id` = BAPS ID upper-cased (name-style IDs such as
  "FIRST.LAST" kept as given), `email` per the next bullet, channel EMAIL, phone E.164 when the
  sheet has one, `name` = "First Last" (no middle name), `gender` = `genderForPerson()`: the
  Personal Wing when it names one (Bal/Kishore/Yuvak/Sanyukta → MALE,
  Balika/Kishori/Yuvati/Premvati → FEMALE), else the Seva Wing (Bal/Kishore/Yuvak/EBKY → MALE,
  Balika/Kishori/Yuvati/IBKY → FEMALE), so men in IBKY liaison roles stay Bhaio. `seva` = `teamForSeva()`'s team code, else the raw Seva text
  ("Sant Admin", "NC", "NC Lead", "NCM", "NMS", "Sanyojak", the EBKY/IBKY wing roles, any pair
  not in the table), which matches no team: those delegates get
  "Sessions coming soon" (`sevaHasTeam()`) until the organisers place them; change the table only
  on their word. The raw cells stay in `seva_wing` / `seva_role`.
- Delegate emails (organisers, 2026-09-27, `src/lib/delegateEmail.ts`): every delegate the import
  brings in gets exactly `defaultDelegateEmail()` = `<BAPS ID lower-case>@na.baps.id`; the
  organisers' email list is no longer used (no `--emails`). `--dry-run` counts the stored
  addresses that change, by their current domain. The admin person form offers the same address
  while a delegate's email is empty (`bapsEmail()`). Santos keep their own sheet's addresses
  (the import never touches SANT/ADMIN rows or testers).
- Transport (organisers' rules, `src/lib/transportImport.ts`): a leg is one person + direction
  (id `<User Id>-arrival|departure`), linked to `users` by `registration_id` with no foreign key
  (User Ids not imported yet are stored and listed, and link once imported). The airport tabs
  ("Arrival …", "Departures …", the transport team's working lists) win for airport, date, time,
  airline and flight and are the only source of groups and drivers; the full-record tabs
  ("Transport - With Accom" / "- No Accom") fill in the rest, mode / need pickup when the tab has
  none, and "Fee Description" → `accommodation_package` (a blank never clears it; set only for
  users that exist, so import delegates first). "Non EWR-PHL Airports" is a cross-check only and
  "Sheet1" (the email list) is ignored. Group identity = `group_key`
  `<direction>-<airport>-<local date>-<number>`; merged group cells apply to every row they span.
  Driver / Driver Phone # are read when filled: the drivers are expected from a separate sheet
  later, so a booked leg says "Driver details will be shared closer to the day" until then. Dates
  and times are the wall-clock at that airport as given (`local_date` "YYYY-MM-DD", `local_time`
  "HH:MM"), shown as they are (`wallClockLabel()`, `formatDayShort()`), never converted between
  zones; `sort_at` (the same wall-clock read as Eastern) is for ordering and `legPhase()` only.
  Duplicate rows that agree count once; rows that disagree skip that person entirely. Oddities are
  flagged by User Id, never fixed. A delegate sees only their own legs and their group's size,
  never who else is in the group; a leg is "booked" only when it is on an airport tab (a
  registration Yes alone is "requested"). The workbook and `--out` plan hold personal data: same
  rules as the master list (printed report = counts, sheet/field names and User Ids).
- Rooming (organisers' rules of 2026-09-26, `src/lib/roomingImport.ts`): only the five visible
  hotel tabs in `ROOMING_TABS` are read ("eBKY Hampton Wednesday" = stay WED, the night of Wed,
  Oct 7; "eBKY Hampton Thursday", "eBKY Courtyard", "eBKY-iBKY DoubleTree", "iBKY Hilton" = MAIN,
  from Thu, Oct 8). A listed tab missing, hidden or empty, or another visible tab with a "Mock
  Room" header, is a plan error (nothing is written), never a hotel's worth of deletes; hidden
  tabs are the organisers' working sheets and ignored; "Summary V2" is a cross-check only. When
  the organisers rename or add a tab, change `ROOMING_TABS`; a new hotel goes in `hotels.ts` (an
  unknown Hotel cell stops the import). A room group = (stay, hotel, "Mock Room" number), key
  `room_key` `<stay>-<hotel>-<number>`; merged Mock Room / Hotel cells make every spanned row a
  bed; a bed row without a User Id is an open bed. The numbers are room ASSIGNMENTS: always show
  them via `roomGroupLabel()` ("Room group N"), never as hotel room numbers (those come at
  check-in). Assignments link to `users` by `registration_id` with no foreign key (id `<User
  Id>-wed|main`; User Ids not imported yet are stored and listed, counted but not named). A User
  Id on more than one bed row in a stay is a conflict: that stay is skipped for them and their
  beds show as held. The same room group on both nights reads "From Wed, Oct 7"; a different
  Wednesday room shows as two stays. Rooms mixing Bhaio and Behno are family / couple rooms:
  listed, never fixed; every other oddity is flagged, not fixed. Names are never read from the
  workbook: a delegate sees their roommates' names and centers only (from `users`: `greetingName()` and `center`; user decision 2026-10-01),
  nothing else about them. Same personal-data rules as the master list for the workbook and
  `--out`.
- Goshthi group (user decision 2026-09-27): each group meets in its own room during the Goshthi
  sessions, not inside the team breakout rooms, so breakout cards never mention it.
  `goshthi_group`: Bhaio "Group 4" (or "eBKY Group 3" when listed under another wing), read with
  `seva_wing` and shown via `goshthiGroupLabel()` ("Kishore Group 4"); Behno "Goshthi Group N"
  (numbered across Behno), shown as given, never with a wing. `goshthi_room` = the room as the
  organisers name it (null = none given), `goshthi_moderator` = they moderate the group (admin
  directory only: the organisers don't want moderators shown in the hub).
  `goshthiFor()` (`src/lib/schedule.ts`) feeds the `/breakouts` header (group and room);
  `personalizeGoshthi()` gives the delegate's own "Goshthi 1/2" items their room ("Room to
  be confirmed" when none) and label on `/schedule` and the home page only (never the Santo,
  admin or display views). The import sets all three only for tracks a `--goshthi` workbook
  covers (and anyone it lists). A blank Room cell takes the room the rest of its group names when
  those rows agree and outnumber the blank ones (a merged cell that stops short, organisers
  2026-09-27); other blank rooms and groups without
  exactly one "Moderator:" row are flagged, never fixed. A Bhaio list tab of several wings that
  numbers its groups across them ("Eside": Bal 1–15, Kishore 16–32, …) reads a group number as
  one group (organisers' 2026-09-29 file, whose merged cells slip by a row): a blank or differing
  Wing takes the group's wing, a Room unlike the one the rest of the group (2+ rows) names takes
  theirs unless "Split?" is filled, and a row among another group's rows (moved without its number
  changed) takes that group only when the typed "Ppl in Group" counts match the blocks as laid
  out, else gets no group (a conflict); each such row is listed for the organisers. One-wing
  tabs keep the wing + number reading.
- Admin directory: `registration_id` (unique; a payload without it leaves it alone, "" clears it)
  and `center` are editable; the other master-list fields are import-only and shown read-only.
  `BAPS_ID_PATTERN` allows inner dots for the master list's name-style IDs.
- Use `greetingName()` / `initials()` from `src/lib/users.ts` when showing a user's name.
- Menu content comes from the organisers' menu file; do not add dietary disclaimers or "vegetarian"
  labels in the UI (the guests take that as given).
- The app title everywhere is "NAAM 2026: Hospitality Hub" (`APP_TITLE` in `src/lib/branding.ts`).
- UI is fixed-scale (no pinch/double-tap zoom): viewport `maximumScale: 1` plus
  `touch-action: pan-x pan-y` on every element (WebKit resets it at each scroll container).
  Keep new pages inside that.
- App shell (for Telegram's iOS in-app browser, which paints scrolled content above the header):
  the document never scrolls. Every screen renders `.app-shell` with the header in flow and one
  `<AppScroll>` (`#app-scroll`) as the only scroller. Never use `window.scrollY/scrollTo`, window
  scroll listeners or `body.style.overflow`; use `src/lib/scroll.ts` (`getScrollTop`,
  `scrollAppTo`, `onAppScroll`, `useAppScrollLock`). Sticky offsets are relative to the
  scroller (the header no longer overlaps content).
- External links (e.g. the Prasang form) open in the same tab: `target="_blank"` strands
  Telegram users outside the Hub.
- Schedule icons are chosen per item in `iconFor()` in `ScheduleView.tsx` (bus only for
  mandir/utaro/airport/Edison/DC rides, footsteps for hops between rooms, armchair for Seating, camera for
  Group Photo, mandir mark for Akshardham, waving hand for Departures, folded hands for
  Darshan/Abhishek/Charansparsh, flame for Arti). Icons missing from Lucide come from Phosphor (MIT) as
  small components in `src/components/icons/`; prefer an existing open-source icon over
  drawing one.
- Notifications: `src/lib/notifications.ts` merges organiser rows from `notifications` (publish
  with `npm run notify`) with menu releases derived from meal reveal times (delegate menu
  only; the Santo menu has no reveals, so santos get none). Read state is
  `users.notifications_seen_at`. Sign-out lives on the profile page, not the header.
- Theme: the organisers' NAAM 2026 "Sāchu" Karyakar brand kit (Brand Guide.pdf). Colours only
  from the brand token families in `globals.css`: `ink` (800 = #2f4f60), `coral` (400 = #f68f77,
  700 = #c44147), `ember` (deep red), `sand` (200 = #e8e0d1; canvas sand-100), `jade` (500 = #3d9283),
  plus white/black. Brand gradients: teal `from-jade-500 to-ink-800`, coral `from-coral-400 to-coral-700`.
  No Tailwind default-palette colours and no old `gold/saffron/navy/cream/maroon` names. Semantics:
  late/warning → coral, error/destructive → ember, good/on time/early → jade, info → ink.
  Keep text contrast at WCAG AA (no small white text on coral-400/500).
- Fonts: `font-display` = Enilas (one weight; `.font-display` forces 400 and disables faux bold, so
  never add font-bold to it; headings only, not small/all-caps text), body = Just Sans (variable).
  Both self-hosted in `src/app/fonts/` via `next/font/local`.
- Logos: `<SachuLogo variant>` / `<SachuMark variant>` (src/components/brand/Sachu.tsx) are the
  event brand; pick the variant for the background (full/flat on white or sand, single on sand,
  white on ink/teal/coral) and never recolour, crop or overlap them. `<MandirMark>` / `<MandirArt>`
  (Edison mandir art, CSS masks) only where the mandir itself is meant (Akshardham row, History).
  `<Murti>` and `<BapsFooter>` are sacred images: whole, unaltered, never tinted/overlapped/
  animated, at most once per screen, footer on an ink band. No screen shows the murti at the top (login and both homes).
  The History page's photographs are sacred images too (whole, unaltered, nothing over them: see its bullet).
  `<SachuFlurry tone>` (src/components/brand/SachuFlurry.tsx) is the decorative word band in the
  home heroes. The sign-in splash shows the Sāchu wallpapers whole (a capped "cover" on portrait
  screens, height-fit on landscape ones, in `splash.module.css`, so the lock-up is never cut or
  blown up; blurring/fading the whole wallpaper is the
  transition); its fill colours are sampled from the wallpapers, the one exception to brand
  tokens. Assets, app icons and web fonts are built by
  `python scripts/build-sachu-assets.py "<Digital Assets folder>"`; the Edison art by
  `scripts/build-brand-assets.py` (no longer writes app icons unless `--icons`).
- Admin: every admin server action/route handler calls `getAdmin()` itself (never trust the page
  check). Tester `test_code`s are ignored for ADMIN accounts (a static code is weaker than a real one),
  so admins always get a real code; for local admin QA run the `hub-lightsail-console` launch
  config (codes print to the server log) with a throwaway admin, and delete it afterwards.
- Seva filter values are picker option values: spellings of one breakout team fold into its code
  ("eBM RA" → "BM RA", "Satsang Admins" → "SA"); umbrella names ("BKY RA") and plain sevas stay
  as they are. Filter with `expandSevaSelection()` (`userSevas` for `users.seva`, `teamCodes` for
  `breakouts.seva`; an empty selection means no filter, never `in []`), keep it on internal admin
  links with `withSevaFilter()`, and name an active filter in copy only via `sevaFilterLabel()`.
  With no filter every view must behave exactly as before; the schedule engine always moves every
  team's breakouts regardless of the filter.
- Notifications carry optional targeting (`roles`, `sevas`, `regions`, and hotels; empty = no
  restriction) on top of the gender `audience`; the one matching rule lives in
  `src/lib/admin/announcements.ts`. Hotels (user, 2026-10-05): a hotel announcement goes to the
  people with a room group at one of the picked hotels, either stay (`src/lib/hotelGuests.ts`:
  room_assignments by User Id; `getHotelsOf()` for the bell, `registrationIdsAtHotels()` for
  `usersReachedBy()`'s `atHotels`; `getFacetGroups()` in `src/lib/admin/announcementFacets.ts`
  adds each account's hotels to the anonymous facet groups) and doesn't combine with regions
  (`normaliseTargeting()` drops them; the composer's Region picker sits disabled while a hotel is
  picked). It has no column: the row stores its hotels in `regions` as "hotel:<key>"
  (`storedRegions()`, `HOTEL_REGION_PREFIX`; a real region with that prefix is refused), which
  no account has, so code that doesn't know about hotels (an old deployment, a rollback) shows
  it to no one, never to everyone. Every row read from `notifications` goes through
  `fromStored()` before the rule, a label or a draft sees it (`Targeting.hotels` is required,
  so a raw row doesn't type-check there); the bell's SQL matches the stored form directly.
  Exception: a MENU notice with no roles is about the delegate menu (delegates + admins); it
  reaches santos only when `roles` includes SANT. `createdAt` is the publish time (future =
  scheduled).
- Personal announcements: a notification with `userIds` (`notifications.user_ids`, users.id
  values, no foreign key) goes to EXACTLY those accounts and to nobody else. Track, roles, sevas,
  regions and the MENU exception don't apply to it (`reaches()` / `notificationsVisibleTo()` /
  `usersReachedBy()` look at the people first). `normaliseTargeting()` stores it with track ALL,
  no roles, and `PERSONAL_MARK` ("(specific people)") as its only seva and its only region: no
  account has that seva or region (never give one to an account), so anything that reads the row
  without `user_ids` (a build from before 2026-10-02 after a rollback, an old deployment on the
  same database, a database the column was dropped from) shows it to NO ONE, never to everyone.
  Keep that mark on every personal row, never show or copy it (`describeAudience()` says "N
  specific people"; `draftFromAnnouncement()` drops it), and remember a SQL prefilter on `sevas`
  must also admit rows with people (`getAnnouncementHistory()`'s seva-filter scan). It is matched
  on the session's own account id (`guest.id`, which `withMirror()` never
  replaces), so a mirror tester gets their own personal announcements and never the mirrored
  delegate's. A listed account that was deleted simply reaches no one. The anonymous facet groups
  can't count one (`countReach()` is 0): its reach is the listed accounts that exist
  (`getPeopleByIds()`), and with the console's seva filter those of them with a picked seva. A
  santo's link still goes through `santHref()`. Names of the people leave the server only for
  admins (the history and the picker); the bell never selects `userIds`. The bell holds the 25
  newest items plus this account's older personal announcements (up to 25 more,
  `getNotificationsFor()`), so a message meant for one person isn't pushed out by broadcasts.
  The column was added on 2026-10-02 and needs `db:push[:lightsail]`. Until a database has it,
  Prisma fails on any query naming it (P2022) and names it in every `notification.create()`
  (it fills in the `[]` default itself), so: read `notifications` only through
  `withPeopleColumn()` and add rows only through `createNotification()`
  (`src/lib/notificationPeople.ts`; never `prisma.notification.create()`, findMany without a
  `select`, or `include`). Before the push the reads leave the column out (every row an ordinary
  announcement), `createNotification()` inserts by SQL without it (also inside the schedule
  engine's transaction: `executeScheduleOp()` gets it as `publishNotice`, because
  `schedule.ts` must stay client-safe), and publishing to specific people refuses with
  `PEOPLE_NEED_PUSH` ("run npm run db:push first"); the first query after the push uses the
  column (`schemaState`, as in `helpContacts.ts`). Code from before 2026-10-02 doesn't know the
  column: thanks to the mark it shows a personal announcement to no one (not to its recipients
  either), and its history lists it as seva "(specific people)" reaching 0. So still deploy this
  code everywhere first, then push, then send to specific people; after a rollback the people
  concerned stop seeing theirs until the new code is back, but nobody else ever sees them. Never
  run `db push` from an older checkout once personal announcements exist: it would drop
  `user_ids` (the rows then reach no one, and who they were for is lost).
- Two menus: `meals.menu_for` is DELEGATE (/menu) or SANT (/sant/menu). Always go through
  `getMeals(menuFor)` and never mix them (reveal times chain within one menu); derived menu
  releases come from the viewer's own menu. Only the delegate menu is revealed meal by meal:
  every SANT meal shows its dishes from the start, "Served" once over, never locked, with no
  "menu is out" releases in the santos' bell and a Santo home Menu tile that features the meal on
  now or next (user, 2026-10-02: `menuIsTimed()` in `src/lib/schedule.ts`, applied by
  `annotateMeals()` per meal, so it holds whatever `MENU_REVEAL_ALL` is).
  `prisma/seed.ts` only rewrites DELEGATE meals; SANT
  meals are written only by the Santo menu sync (`prisma/sant-menu-data.ts` -> `prisma/sant-menu.ts`,
  `npm run sant:menu:sync[:lightsail]`, also run by the seed). Santo menu changes are an edit to
  `sant-menu-data.ts` and a sync; the kitchen sheet's logistics columns (quantities, people,
  follow-ups, statuses) never go into the app, data files or docs.
- Live schedule changes go through `src/lib/admin/schedule.ts`: relative SQL updates in one
  transaction, printed times kept in `original_starts_at/_ends_at` (null = never moved), linked
  delegate meals and in-window breakouts move too (a breakout always follows the slot of its own
  track or a shared one that contains it, so a shared "Team Breakouts" slot carries both tracks'
  sessions; the Santo menu and the Santo general schedule never move), every change is logged in
  `schedule_changes` with a per-row snapshot for undo. Guests see "Delayed N min" badges in
  `ScheduleView`.
- The sant view is separate: delegate-only pages live in `(hub)`, sant pages in `src/app/sant/`.
  Santos never see the delegate `schedule_items`: the General tab of `/sant/schedule` and the
  Santo home's hero clock and General tile show the Santo general schedule
  (`sant_general_schedule_items`, via `getSantGeneralSchedule()`), with no delay badges. Santo
  pages count days over `SANT_DAYS` (`santDayOf(now)`, "Day N of 11", `<SantDayChips>` strip), not
  `EVENT_DAYS`. They also get their own menu (`/sant/menu`), breakouts (`/sant/breakouts`: no
  sessions of their own, every Bhaio session that isn't combined, plus those marked "Santo
  joining", in blocks; see the Santo breakouts bullet) and venue map (`/sant/map`); never link them to delegate pages (`santHref()`
  maps delegate links in announcements, `/map` to `/sant/map` with its query; room links use
  `venueHref()`'s `base: "/sant/map"`; their schedules' Breakout rows read "See the sessions you
  can join", `ScheduleView`'s `breakoutsLabel`, though neither Santo list has a BREAKOUT row since
  2026-10-03).
  Don't pass the whole `User` row to client components (it includes `test_code`).
- Utaros are shown by name only (with companions, host, notes): never read or show
  `sant_accommodations.address` (kept for the organisers' records) and never add addresses to
  data files, docs or the UI.
- Display API: reads only through the app's own getters and rules (`getScheduleItems()` +
  `annotateSchedule()`; `getMeals(MenuFor.DELEGATE)` + `annotateMeals()`, so the reveal rule and
  `MENU_REVEAL_ALL` hold and a locked meal has no dishes; only the `bk-` team breakouts, folded
  per track, teams named via `sevaLabel()`: `getTeamBreakoutRows()` + `foldSessions()` in
  `src/lib/breakoutSessions.ts`, which the Santo breakouts share, so a change there changes the
  API too). Never the Santo schedule or menu, and never personal
  data (users, codes, names, contacts, rooming, transport, notifications, a breakout's
  facilitator). Never log a key (a request URL may carry `?key=`). The response shapes are a
  contract with the screens' developer: add fields, never rename or remove them, and update
  docs/DISPLAY_API.md with every change.
- Venue map: the organisers' blueprint and everything derived from it (the extractor's JSON,
  report and PNGs) never go in the repo or `/public`, and no client module imports geometry: the
  map reaches the browser only as `toClientVenue()` props on signed-in pages. Back-of-house and
  private-quarters rooms are `public: false`: never labelled, searched, routed through or sent
  by name, number or id (the server strips them to outlines); change the line only with
  `extract.py --public/--private <id>` on the organisers' word (the residence boundary is theirs
  to confirm). The one exception: the sadhus' residence rooms santos may use reach santos'
  browsers through `toSantClientVenue()` only (`getVenueForPages({ role })` with role SANT, from
  pages behind `requireSant()`; never pass a viewer from a page or API a non-santo can reach), and
  of those only the "own" rooms SANT_ROOM_NAMES names are sent as rooms (by that name, no number);
  the floor santos walk ("way" / "shared" rooms) is sent as no outline at all (it reads as plain
  floor under their route, never named), and every other residence room stays an outline. The deities' rooms and the altar stay private for everyone. Nothing
  santo-only ever goes in `public`, `entry`, `points` or `grid`; new venue fields stay optional
  with `version` 1; `breakoutWays()` never takes the santo payload. Change the santos' boundary
  only with `--sant` / `--not-sant` / `--sant-class` / `--sant-open` / `--sant-seal` on the
  organisers' (or the user's) word, recorded in the arguments note outside the repo. Staff-only rooms (hatched on the organisers' own floor plans, organisers
  2026-10-01) that are worth showing are `closed`, not private: drawn, named and searchable, but
  never a start or a destination and never walked through (`extract.py --closed <id>`; the freight
  elevator is `--drop-connector`). Stairs and elevators are never numbered for guests (the
  building has no stair signs): steps, labels, the From list, failure messages and `/breakouts`
  name them by place through `connectorPhrase()` / `shaftRoomName()` (view.ts), never from a
  connector's stored `name` or id; ids such as "stair-5" are for admins (the `--plan` printout,
  the "Map id" line of a stair's room sheet) and the extractor's arguments only. Nor are two rooms
  of one name told apart by the blueprint's room number where their place on the map does it
  (`twinSpots()`). The extractor's arguments for the event (which rooms are public,
  closed, merged or renamed, which connectors are dropped) are the organisers' decisions and
  carry blueprint room ids: keep them in a note beside the extractor's output, outside the repo,
  and re-run with the same ones. Room names live only in `src/lib/venue/aliasTable.ts` (server
  only): `VENUE_ROOM_NAMES` (map id -> the organisers' own name for the room: what the map,
  search, steps and /breakouts call it; public rooms only, a name for a private id is a
  `--plan` error and is never sent) and `VENUE_ALIASES` (event name -> ids, one list per track
  for a place there are two of, or null). Those name <-> id pairs are the only blueprint-derived
  thing in committed files: no blueprint descriptions or other room inventory anywhere else (use
  made-up ids such as "2-999" in comments), and a mapping that is assumed rather than confirmed is
  listed in `VENUE_ALIAS_TENTATIVE` with what is assumed until the organisers confirm it. Check
  with `venue:import --plan` before applying. Resolve a name for a guest with their track
  (`resolveVenueRoom(name, index, track)`, `venueHref(name, index, { track })`,
  `aliasEntriesFor(index, track)`); the per-track table never goes to the browser. Show a room by
  `roomTitleOf()` / `destTitleOf()`, never by reading the blueprint's name. Unmapped names must
  keep working: shown as "not on the map yet", never a dead link (a staff-only room likewise gets
  no link from /breakouts). Flow rules and the organisers' flow drawings are blueprint-derived too
  (room, door and stair ids, points): the rules file, the flows file and the flow check's `--out`
  stay outside the repo (the scripts refuse paths inside it), and no rule, door id, coordinate or
  the organisers' stair numbers go in committed files (made-up ids in comments). Browsers get only
  `routeRulesFor()`'s narrowed set for the viewer (no notes, no other track's rules); a rule never
  names a room guests can't go to, and steps never name a door.
- Use `127.0.0.1` rather than `localhost` in `DATABASE_URL` on Windows (Docker does not
  answer on IPv6 `::1`).
- Don't commit `.env`; `.env.example` documents every variable.
