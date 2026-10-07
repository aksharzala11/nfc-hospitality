# Hospitality Hub — architecture and data flow

Mobile web app for NAAM 2026 delegates (Edison, NJ · Oct 8–11, 2026). One deployable unit
(a Next.js app) plus one PostgreSQL database and two AWS messaging services.

```
 Phone browser ──HTTPS──▶ Next.js app (server-rendered pages + /api/auth/* handlers)
                              │                      │
                              │ Prisma (TCP 5432,    │ AWS SDK v3 (HTTPS)
                              │ TLS)                 ├──▶ Amazon SES   (email OTP)
                              ▼                      └──▶ Amazon SNS   (SMS OTP, optional)
                 Lightsail managed PostgreSQL "naam-users" (us-east-1)
```

Environments:

| Environment | App host                          | Database                       | OTP delivery              |
| ----------- | --------------------------------- | ------------------------------ | ------------------------- |
| Local dev   | `npm run dev` on a laptop         | Postgres in Docker (`db:up`)   | console log or real SES   |
| Dev testing | Vercel (`naam-five.vercel.app`)   | Lightsail `naam-users`         | real SES                  |
| Production  | Your platform, pulled from git    | Lightsail `naam-users`         | real SES (+ SNS optional) |

---

## 1. Technology, piece by piece

### Next.js 15 (App Router) + React 19 + TypeScript
The whole application. There is no separate backend service: pages are React Server
Components rendered on the server per request, and the three auth endpoints are Next.js
route handlers under `src/app/api/auth/`. Everything under `src/app/(hub)/` is the signed-in
area; `src/app/page.tsx` is the login screen.

- Pages are marked `dynamic = "force-dynamic"` so nothing is cached: every request reads the
  database and computes "now".
- Client components (`"use client"`) are limited to interactive bits: the login form, day
  tabs, schedule/menu views, bottom nav, scroll-to-top, parallax header. They receive plain
  JSON props (ISO date strings), never database objects.
- `src/middleware.ts` runs on the Edge runtime and only checks that the session cookie
  exists; it deliberately does not verify the JWT so it needs no secrets.

### Tailwind CSS 4
Styling. Design tokens (the Sāchu brand palette ink/coral/sand/jade/ember, the Enilas + Just Sans
fonts, shadows, animations) are defined
with `@theme` in `src/app/globals.css`; components use utility classes. A few custom classes
live there too: `.card`, `.glass` (frosted bottom bar), `.reveal` (scroll-in rows),
`.rotate-guard` (portrait overlay).

### Prisma 6 (ORM) → PostgreSQL 18
`prisma/schema.prisma` is the single source of truth for the tables. `prisma generate`
produces a typed client; the app imports one shared instance from `src/lib/db.ts`.
Tables (snake_case in Postgres):

| Table            | What it holds                                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| `users`          | One row per delegate: `baps_id`, `name`, `display_name`, `seva`, `email`, `phone`, `gender`, `preferred_channel`, `breakout_sessions[]`, `region`; from the master list: `registration_id` (the organisers' "User Id", unique: links a delegate to their other data sources), `center`, `personal_wing`, `seva_wing`, `seva_role`, `registration_status`, `goshthi_group`, `goshthi_room`, `goshthi_moderator`; from the transport workbook: `accommodation_package` |
| `otp_codes`      | Hashed one-time codes with expiry, attempt count and consumed timestamp                         |
| `schedule_items` | The programme: title, kind (ARTI/SESSION/BREAKOUT/MEAL/BREAK/TRAVEL/FREE), audience (ALL/BHAIO/BEHNO), start/end |
| `meals`          | Each meal with its own start/end, optional link to a schedule slot; `menu_for` DELEGATE or SANT (two menus) |
| `menu_items`     | Dishes per meal, grouped by course, with tags such as "Tentative"                               |
| `breakouts`      | Breakout sessions, one row per team per track: `seva` (canonical team code), `audience` (BHAIO/BEHNO/ALL), title, room(s), note, start/end |
| `sant_general_schedule_items` | The Santo general schedule (Oct 5–15): title, kind, location, start/end; no audience, no printed-time columns (never moved live) |
| `sant_schedule_items` | A sant's personal programme; the real santos' rows (`sp-*`) are written only by `npm run sant:personal:sync` |
| `sant_accommodations` | Utaros, shared by the santos placed there (`users.sant_accommodation_id`); the app reads place name, host and notes, never `address` |
| `hotlines`       | Phone lines per role: the santos' transport hotline (SANT), and the delegates' help contacts (DELEGATE, each with a `topic` GENERAL / STAY / TRANSPORT and an `audience` BHAIO / BEHNO / ALL) |
| `transport_legs` | One airport arrival / departure per person, keyed by (`registration_id`, `direction`) with no foreign key: mode, need pickup / drop-off, airport, wall-clock `local_date` / `local_time`, `sort_at`, airline, flight, `group_number` / `group_key`, driver, `source_sheet` |
| `room_assignments` | One hotel room group per person and stay, keyed by (`registration_id`, `stay` WED/MAIN) with no foreign key: `hotel` (a `hotels.ts` key), `room_number` (the organisers' assignment, not a hotel room number), `bed`, `room_key` (`<stay>-<hotel>-<number>`), `room_capacity`, `room_open_beds`, `source_sheet` |
| `room_groups`    | One row per room group and stay (`room_key`), whoever is in it: hotel, number, `capacity`, `open_beds`, `held_beds` / `held_registration_ids` (beds of User Ids skipped as conflicts), `source_sheet` |
| `email_events`   | One SES bounce / complaint / reject per recipient of a sign-in email (id `<feedback id or SES message id>:<recipient>`): `kind`, lower-cased `recipient`, `bounce_type` / `bounce_sub_type`, a short `diagnostic` (the server's reply), `complaint_type`, `ses_message_id`, `occurred_at`, `source` (sns / suppression-list), and the admin's `resolved_at` / `resolved_by_id` / `note`. Never the subject (it holds the code), headers, sender or other recipients |

Content (`schedule_items`, `meals`, `menu_items`) is loaded by `prisma/seed.ts`, transcribed
from the organisers' block schedule and menu spreadsheets. Delegates come from the master-list import (below); one-off users are
added with `scripts/upsert-user.ts`. Team breakouts are transcribed from the organisers' breakout matrix into
`prisma/breakouts-data.ts` and synced by `prisma/breakouts.ts` (from the seed, or
`npm run breakouts:sync[:lightsail]`): ids `bk-*`, one row per team per track, all rooms plus a
"Split amongst these rooms." note while a team's split is open. The sync only ever writes
`bk-*` rows.

The Pujya Santo data comes from the organisers' santo spreadsheets (since 2026-10-03 their Santo
workbook's "Updated Accomodations", "Master Schedule", "Menu" and "Individual Schedule" tabs, with
the BAPS IDs, emails and phones still from "Pujya Santo Info"), turned into data files (the
generators that read the workbook stay outside the repo):
- `prisma/santos-data.ts` (33 santos, 9 utaros) → `scripts/import-santos.ts`
  (`npm run santos:import[:lightsail]`, `-- --dry-run`): one transaction that upserts `users` by
  BAPS ID (BAPS ID = the BAPS ID email's local part, upper-cased; name `<Name>das`; role SANT,
  gender MALE, seva "Pujya Santo", email channel), upserts the utaros by stable `utaro-*` id
  (place name only) and places each sant. It never deletes rows, never demotes an ADMIN and
  leaves `test_code`, `display_name` and `breakout_sessions` alone.
- `prisma/sant-schedule-data.ts` → `prisma/sant-schedule.ts` (from the seed, or
  `npm run sant:schedule:sync[:lightsail]`): validates the items (days = `SANT_DAYS`, ordered,
  non-overlapping, no sheet shorthand) and makes `sant_general_schedule_items` match them (ids
  `ss-<day>-<HHMM>-<title slug>`; rows no longer in the data are deleted).
- `prisma/sant-menu-data.ts` (the kitchen team's menu, now the workbook's "Menu" tab: meal,
  category and item name only) → `prisma/sant-menu.ts` (from the seed, or `npm run sant:menu:sync[:lightsail]`):
  each meal takes its name, times and place from the Santo general schedule item it names
  (`slot`: a MEAL item, or one whose title names a meal); validates (one slot, time order, no
  dish twice in a meal, no TBD left in a name, only the "Tentative" tag) and
  makes the SANT `meals` and their `menu_items` match (ids `sm-<day>-<meal>`, dishes
  `<meal id>-NN`; SANT meals no longer in the data are deleted; DELEGATE meals are never touched).
- `prisma/sant-personal-data.ts` (the workbook's "Individual Schedule" tab, less its "Santo
  Breakout" rows) → `prisma/sant-personal.ts` (`npm run sant:personal:sync[:lightsail]`,
  `-- --dry-run`; not the seed): validates the items (BAPS IDs in `SANTOS`, Santo days, ordered
  and non-overlapping per sant, known kinds, no sheet shorthand), finds each sant by BAPS ID (no
  account or not a SANT: nothing written) and makes the `sp-*` rows of `sant_schedule_items`
  match in one transaction (ids `sp-<BAPS ID lower-case>-<day>-<HHMM>-<title slug>`; `sp-` rows
  no longer in the data are deleted, but never every row of a sant without `--allow-deletes`;
  other rows, such as SANTO0001's sample programme, are never touched).

The delegates come from the organisers' master list ("App DataSet.xlsx") and goshthi group
workbook ("NAAM Goshthi Group Allocations.xlsx"), read at run time by
`scripts/import-delegates.ts` (`exceljs`) and never copied into the repo:
`npm run delegates:import[:lightsail] -- --master <xlsx> [--goshthi <xlsx>]... [--baps-id <User Id>=<BAPS ID>]...` with
`--plan` (workbooks only, no database), then `--dry-run` (reads `users`, prints every change),
then `--apply` (one transaction; refused while the plan has errors). The rules are pure functions
in `src/lib/delegateImport.ts`, `src/lib/goshthiImport.ts`, `src/lib/delegateEmail.ts` and
`src/lib/sevaMapping.ts`:
- Each master-list "User Id" becomes `users.registration_id`, the key that links a delegate to
  the organisers' other data sources; rows match by it, else by BAPS ID (which then gets the
  User Id). SANT and ADMIN rows are never changed and nothing is deleted.
- Refunded registrations are imported (status as given) and listed; a User Id on two rows is
  imported once, from the row with a usable Seva Wing and Seva (differing statuses listed).
  Skipped and listed: rows of one User Id with different BAPS IDs or different sevas, no usable
  BAPS ID, a BAPS ID shared by several User Ids, no usable Seva Wing / Seva.
- `--baps-id <User Id>=<BAPS ID>` fills or corrects a sheet BAPS ID (the given value wins); a
  User Id not in the list or given twice, a malformed value, or one another person or account
  holds is an error. An account matched by User Id gets the corrected BAPS ID.
- `baps_id` = BAPS ID upper-cased, channel EMAIL, phone in E.164 when present, `name` = "First
  Last", `gender` = `genderForPerson()`: the Personal Wing when it names one
  (Bal/Kishore/Yuvak/Sanyukta → MALE, Balika/Kishori/Yuvati/Premvati → FEMALE), else the Seva
  Wing (`genderForSevaWing()`: Bal/Kishore/Yuvak/EBKY → MALE, Balika/Kishori/Yuvati/IBKY → FEMALE).
- `email` (organisers, 2026-09-27): `<baps id lower-case>@na.baps.id` for every delegate
  (`defaultDelegateEmail()`), which is also what the admin "Add delegate" form suggests; the
  organisers' email list is no longer used. Santos keep their own sheet's addresses.
- `seva` = the breakout team code `teamForSeva(sevaWing, seva)` gives, else the raw Seva text
  (no team: "Sant Admin", "NC", "NC Lead", "NCM", "NMS", "Sanyojak", the EBKY/IBKY wing roles);
  the raw cells go to `seva_wing` / `seva_role`.
- Goshthi groups (`src/lib/goshthiImport.ts`, visible tabs only): each group meets in its own
  room during the Goshthi sessions. `goshthi_group` = Bhaio "Group 4" (shown with the wing,
  "Kishore Group 4") or Behno "Goshthi Group 12" (shown as given), `goshthi_room` = its room,
  `goshthi_moderator` = they moderate it (admin directory only, never shown in the hub); set only
  for the tracks a goshthi workbook covers. A blank Room cell takes the room the rest of its group
  names when those rows agree and outnumber the blank ones.

Airport pickups and drop-offs come from the transport team's workbook, read at run time by
`scripts/import-transport.ts`: `npm run transport:import[:lightsail] -- --file <xlsx>` with
`--plan`, `--dry-run`, then `--apply`, as above. The rules are pure functions in
`src/lib/transportImport.ts` (`planTransport()`, `reconcileTransport()`):
- One `transport_legs` row per person and direction (id `<User Id>-arrival` / `-departure`),
  linked by `registration_id` without a foreign key, so User Ids not imported as users yet are
  stored too (and listed).
- The airport tabs ("Arrival …", "Departures …", the transport team's working lists) win for
  group, airport, date, time, airline and flight; the full-record tabs fill in everyone else,
  mode and need pickup / drop-off, plus `users.accommodation_package` ("Fee Description").
  "Non EWR-PHL Airports" is only cross-checked and "Sheet1" (an email list, no longer used) is
  ignored. Every tab-vs-record disagreement is reported by User Id and field; identical duplicate
  rows count once, conflicting ones skip that person.
- Dates and times are the wall-clock at that airport as given ("YYYY-MM-DD", "HH:MM"), never
  converted; `sort_at` reads them as Eastern for ordering only. Group identity = direction +
  airport + local date + group number (merged group cells apply to every row they span).
  Driver / Driver Phone # come only from the airport tabs and are read when filled; the drivers
  are expected from a separate sheet later. Oddities (far or code-only airports, dates outside
  the event, placeholder flights, blank need answers, a Yes on no airport tab) are flagged,
  never fixed.
- `--apply` upserts every planned leg, deletes legs whose person no longer has that leg in the
  workbook (not for people skipped as conflicting), and sets `accommodation_package` only on
  users that already exist (a blank cell never clears it); no other `users` column is written.
  So the transport import runs after the delegate import.

`src/lib/transport.ts` serves them: `getTransportFor(registrationId)` returns only that
delegate's own legs and their group's size for `/transportation` and the home tile (a leg reads
as "booked" only when it is on the team's tabs); `getTransportBoard()` feeds the read-only admin
board `/admin/transport`. Pages treat a missing `transport_legs` table as "no data yet". The
delegates' contacts on `/transportation` are the `hotlines` rows with role DELEGATE and topic
TRANSPORT or GENERAL for their track; `/stay` lists those with topic STAY or GENERAL the same way
(`src/lib/helpContacts.ts`, set with `npm run hotlines`). The event has no staffed help desk to
fall back to: without a matching contact the page shows no help block and the admin board says so.
Until `hotlines.topic` / `.audience` are pushed to a database, every DELEGATE line is read as
before (both pages, both tracks); the first read after the push uses them. Code from before
2026-10-01 shows every DELEGATE line to everyone, so contacts are added only once this code is
deployed and the schema pushed.

Hotel room groups come from the organisers' rooming workbook ("FINAL Rooming List"), read at run
time by `scripts/import-rooming.ts`: `npm run rooming:import[:lightsail] -- --file <xlsx>` with
`--plan` (optionally `--master <App DataSet.xlsx>` for an offline account / mixed-track check),
`--dry-run`, then `--apply`, as above. The rules are pure functions in `src/lib/roomingImport.ts`
(`planRooming()`, `reconcileRooming()`, `reconcileRoomGroups()`, `checkRoomingPeople()`):
- Only the visible hotel tabs in `ROOMING_TABS` are read: "eBKY Hampton Wednesday" is stay WED
  (the night of Wed, Oct 7), the other four ("eBKY Hampton Thursday", "eBKY Courtyard",
  "eBKY-iBKY DoubleTree", "iBKY Hilton") are MAIN (from Thu, Oct 8). A listed tab missing, hidden
  or without beds, or any other visible tab with a "Mock Room" header, is a plan error, so a tab
  gone wrong never reads as a hotel emptying. Hidden tabs are ignored; "Summary V2" is only a
  cross-check of rooms per hotel and size.
- A room group is (stay, hotel, "Mock Room" number); merged Mock Room / Hotel cells make every
  spanned row one bed, and a bed row without a User Id is open. The number is an assignment,
  shown as "Room group N" (`roomGroupLabel()`); real room numbers come at check-in. The hotel
  comes from the Hotel cell via the spellings in `src/lib/hotels.ts` (an unknown one stops the
  import). Names in the workbook are never read.
- One `room_assignments` row per person and stay (id `<User Id>-wed` / `-main`), linked by
  `registration_id` without a foreign key, and one `room_groups` row per room group, even one
  nobody could be placed in. A User Id on more than one bed row in a stay is skipped for that
  stay (its beds are stored as held) and listed. Rooms mixing Bhaio and Behno (by
  `users.gender`) are family / couple rooms: listed, never fixed.
- `--apply` upserts every planned room group and assignment and deletes those no longer in the
  workbook (not for people skipped as conflicting), in one transaction; it refuses when the
  deletes would empty a whole hotel for a stay unless `--allow-deletes` is given. `users` is
  only read (who has an account, their track).

`src/lib/rooming.ts` serves them: `getStayFor(registrationId)` returns that delegate's own room
group(s) (two when the Wednesday room differs from the Thursday one; one reading "From Wed, Oct
7" when it carries on) with their roommates' names and centers only, for `/stay` and the home band;
`getRoomingBoard()` feeds the read-only admin board `/admin/rooming`. A missing table or an
empty `room_assignments` reads as "not available yet". `src/lib/hotels.ts` holds each hotel's
name and, once the organisers confirm them, its full name, address, phone and check-in /
check-out times (null until then; the UI shows only what is set).

### Amazon Lightsail managed PostgreSQL (`naam-users`, us-east-1, Small bundle)
The only persistent store. Public mode is on so Vercel and laptops can reach it; every
connection uses TLS (`sslmode=require`). If the production platform runs inside AWS in
us-east-1, public mode can be turned off and the private endpoint used instead.

### `jose` (JWT) + httpOnly cookie
Sessions. After OTP verification the server signs an HS256 JWT (`sub` = user id, 7-day
expiry) with `AUTH_SECRET` and sets it as the `hh_session` cookie (httpOnly, Secure,
SameSite=Lax). Server components call `requireGuest()` (`src/lib/auth.ts`) which verifies the
token and loads the user row. No session table.

### Amazon SES (email) and Amazon SNS (SMS)
OTP delivery, behind a small provider interface in `src/lib/otp/providers/`. `OTP_PROVIDER=aws`
selects them; `console` prints codes to the server log for development. Sender is
`SES_FROM_EMAIL`, defaulting to `NAAM 2026 Hospitality Hub <noreply@sypramsoftware.com>` (domain
DKIM-verified in SES); display names needing it are quoted or MIME-encoded. Optional
`SES_REPLY_TO` adds Reply-To addresses and `SES_CONFIGURATION_SET` sends through an SES
configuration set (bounce/complaint events). Its event destination publishes bounces, complaints
and rejects to an SNS topic, which (with `SES_EVENTS_TOPIC_ARN` set) delivers them to
`POST /api/ses/events`: the handler checks the SNS signature (SignatureVersion 1 / 2, certificate
only from an `sns.<region>.amazonaws.com` https URL, cached in memory) and the topic, confirms
the subscription itself, and stores one `email_events` row per affected recipient for the admin
bounce tracker (`/admin/bounces`). The middleware never matches `/api/*`; the handler is its own
gate, needs no AWS credentials, and never logs a body, header or address. The email is a plain transactional code (text + HTML
with the same words, no links or tracking, the Sāchu logo as an inline `cid:` attachment,
`Auto-Submitted: auto-generated`). SES has
production access (granted 2026-09-27; 50,000 emails/day), so any address receives codes. SNS needs a registered origination number before US SMS will deliver.

### Node.js 20+ runtime, npm
Build: `npm ci && npm run build` (runs `prisma generate` then `next build`). Run:
`npm start` (`next start`) behind HTTPS. `output` is the default server build, so the
platform needs Node, not just static hosting.

### Supporting pieces
- `zod` validates request bodies on the auth endpoints.
- `lucide-react` icons.
- `next/font/local` self-hosts the brand fonts (Enilas, Just Sans) from `src/app/fonts/`.
- `dotenv-cli` powers the `*:lightsail` npm scripts that point local tooling at the real DB.
- `docker-compose.yml` gives developers a throwaway Postgres.

---

## 2. Data flow

### Sign-in (BAPS ID → one-time code → session)

```mermaid
sequenceDiagram
  participant P as Phone
  participant N as Next.js (server)
  participant DB as Postgres
  participant SES as Amazon SES
  P->>N: POST /api/auth/request-otp {bapsId}
  N->>DB: SELECT users WHERE baps_id
  N->>DB: per-user advisory lock; count codes of the last 10 min; INSERT otp_codes (HMAC of code, +10 min)
  N->>SES: SendEmail(noreply@…, user.email, code)
  N-->>P: {destination: "up•••@outlook.com"}
  P->>N: POST /api/auth/verify-otp {bapsId, code}
  N->>DB: claim a try on every live code; compare HMAC; mark all consumed
  N-->>P: Set-Cookie hh_session=JWT (7 days), hh_splash=1 (2 min)
  P->>N: GET /dashboard (cookie)
  N->>DB: SELECT user, schedule_items, meals
  N-->>P: rendered HTML
```

Details that matter operationally:
- Codes are never stored in clear text: `otp_codes.code_hash = HMAC-SHA256(AUTH_SECRET, userId:code)`.
- Limits: 5 codes per 10 minutes per user (a 429 says how long to wait and whether a code
  already sent is still usable), 5 wrong attempts per code, 10-minute expiry. A resend does not
  cancel earlier codes (emails can arrive late): any unexpired code signs the guest in, and
  signing in ends all of them. A wrong try counts against every live code at once; the try
  that uses up the last one is answered "Too many incorrect attempts" straight away (not "check
  and try again"), and an older code of the guest's typed after its 10 minutes, while a later
  one is still good, is answered "That code has expired. A code we sent you later still works"
  (`EXPIRED_CODE`; it costs a try like any wrong guess).
- The guessing bound: each code is compared with at most 5 wrong guesses for as long as it can
  sign anyone in (expired codes are only looked at for that message), and the
  verify step only ever compares codes created within the send limit (at most 5 in any 10
  minutes, checked in the claim itself, so it holds whatever wrote the rows). The codes sent in
  any 10 minutes are therefore worth at most 5 × 5 = 25 one-in-a-million guesses: 25 per 10
  minutes over time. One badly aligned 10-minute stretch can hold up to 50 (tries saved from
  one batch of codes spent just before they expire, then a fresh batch), followed by nothing
  for the next 10 minutes. There is no per-day cap.
- Concurrency: the send limit is counted and the code stored under a per-user advisory lock
  (`pg_advisory_xact_lock`, never the `users` row, so an import transaction that has updated
  the row doesn't block it); a request beyond the limit is answered from a plain read without
  taking it. That transaction starts with `SET LOCAL lock_timeout = '2s'`: Prisma's own
  transaction timeout can't interrupt a statement waiting on a lock, so without it a stalled
  holder (or an import that changed the guest's BAPS ID / User Id, which the INSERT's
  foreign-key check waits for) would park requests on every pooled connection of the instance.
  After 2 s the request fails cleanly (the JSON 503) and nothing is stored. Each
  multi-row statement of the verify step locks its rows in id order before updating them, so
  parallel requests for one user can't deadlock. Dates go into that raw SQL through `utc()`
  only (the columns are `timestamp` in UTC; the session time zone must not matter).
- A code whose delivery failed is removed again (the guest was told it wasn't sent), so a mail
  or SMS outage doesn't use up the guest's five sends. Only while no guess has been tried
  against it: one that a guess was compared with is kept, ended, and still counts, so the
  guessing bound is unchanged. While delivery is failing, the cap on provider calls is the five
  codes that can be pending per guest at one time, not five per 10 minutes.
- A database error in either route is a JSON 503 ("try again"). The guest lookup (the first
  query of both steps) is repeated when Prisma reports a dead pooled connection (P1017), which
  clears those connections before anything is stored or claimed.
- The code that was just verified is accepted again for 2 minutes, so mobile autofill
  double-submits don't error. Only that code: when two different codes of one guest are
  verified in parallel, the second to finish stays ended.
- `users.last_sign_in_at` is written by `recordSignIn()` in one statement that skips the row
  when another transaction holds it (`FOR NO KEY UPDATE SKIP LOCKED`): a sign-in never waits
  for an import that has updated the guest's row and not committed yet. That sign-in is then
  not recorded in "last signed in".
- If the cookie is valid but the user row is gone (e.g. database switched), the app routes
  through `/api/auth/expired`, which clears the cookie and returns to the login page.
- `hh_splash` is a one-shot UI cue, not auth: the middleware uses it up on the first document
  request that carries it (deletes it and sets the `x-hh-splash` request header, which it strips
  from every other request), and that page's layout renders the Sāchu wallpaper splash (CSS
  blur-out) (`src/lib/splash.ts`).

### Every page load (schedule, menu, dashboard, breakouts, transportation, stay)

1. Middleware checks the `hh_session` cookie exists; otherwise redirects to `/`.
2. The page calls `pageNow(searchParams)` to resolve "now" (real time, or the `?now=` override
   when `ALLOW_TIME_TRAVEL=true`).
3. `requireGuest()` verifies the JWT and loads the user (cached per request, so layout and
   page share one query).
4. The page queries content with Prisma:
   - Schedule: all `schedule_items`, then `forAudience()` keeps `ALL` plus the user's gender
     track (BHAIO for male, BEHNO for female, both if gender unknown). `annotateSchedule()`
     marks the in-progress item "now" and the next one "up next".
   - Menu: all `meals` + `menu_items`; `annotateMeals()` sets each meal to locked / revealed /
     served. Reveal time = max(previous meal ended, meal start − 1 h). `MENU_REVEAL_ALL=true`
     forces every delegate meal revealed (audit mode). The Santo menu (`menu_for = SANT`) is
     never locked: `menuIsTimed()` is false for it, so its meals are revealed until they end,
     then served, whatever `MENU_REVEAL_ALL` is.
   - Breakouts: rows whose ids are in `users.breakout_sessions`, or, when that's empty, rows
     whose `seva` is one of `teamCodesFor(user.seva)` (`src/lib/teams.ts`: the canonical team
     code(s) a seva spelling means, plus the seva itself) and whose `audience` is on the user's
     track (`tracksFor(trackGender(user))`, as for announcements; santos never come here: see
     "Pujya Santo view"). Identical sessions shared by
     several of the user's teams, or by both tracks for a guest who sees both, are listed once.
     The page header also shows the delegate's goshthi group and its room (`goshthiFor()`,
     "Kishore Group 4" / "Goshthi Group 12"; moderators aren't shown); the cards don't,
     as each group meets in its own room. `personalizeGoshthi()` puts that room and label on
     their own Goshthi sessions (`/schedule`, home clock and tiles only). A seva with no team
     (`sevaHasTeam()` false) gets a "Sessions coming soon" card.
   - Transportation (and the home tile): `getTransportFor(user.registrationId)`, the user's own
     arrival and departure from `transport_legs` plus their group's size; `legPhase()` marks a
     leg Today / Done against "now" (an arrival stays live for 3 hours).
   - Stay (and the home band): `getStayFor(user.registrationId)`, the user's own room group(s)
     from `room_assignments`, their roommates' names from `users` by `registration_id` (nothing
     else about them), and the hotel details from `src/lib/hotels.ts`; `stayPhase()` shows
     "Check-in today" on the first night against "now".
   - Venue map and "How to get there": `getVenueForPages()` reads the stored map (`venue_maps`)
     and returns the client payload plus `rulesAt(time, track)`: the organisers' flow rules
     (stored with the map, `src/lib/venue/flowRules.ts`) in force at that time for that track,
     resolved for the router. `/map` and `/sant/map` take them at the page's now (or at a
     `/breakouts` card's session, `?at=`; `mapRules()` in `src/lib/venue/mapPage.ts`) and send that
     set to the browser, whose router (`src/lib/venue/route.ts`) applies it as costs (doors a room
     is left or entered by, stairs some trips take, rooms avoided or walked through, the other
     side's stairs at a time, a whole route as a last resort); the map page refreshes itself when a
     rule's window opens or closes. `/breakouts` works the routes out on the server with the rules
     in force at each session's printed start and sends text only.
5. The server renders HTML and streams it; client components hydrate for tabs, reveal
   animations and the 60-second auto-refresh (`router.refresh()` re-runs steps 2–5).
   The home page's countdown clock ticks client-side from the server's `now`, so it follows
   `?now=` and doesn't jump when the page refreshes.

### Pujya Santo view (`/sant`)
`users.role = SANT` splits the app in two. The delegate `(hub)` layout redirects santos to
`/sant`; `src/app/sant/layout.tsx` calls `requireSant()`, which sends delegates back to
`/dashboard`. Sant pages read:
- the Santo general schedule (`sant_general_schedule_items`, Oct 5–15, via
  `getSantGeneralSchedule()` in `src/lib/santSchedule.ts`, never the delegate `schedule_items`)
  and the sant's own `sant_schedule_items`, both annotated into the same `ScheduleItemView`
  shape. The general one is the General tab of `/sant/schedule` and the home's hero clock and
  General tile; the home and both tabs frame their days over `SANT_DAYS` (`santDayOf(now)`,
  "Day N of 11", a sideways `<SantDayChips>` strip) instead of the four NAAM days;
- `sant_accommodations` (an utaro shared by the santos placed there via
  `users.sant_accommodation_id`, so each sant sees who is staying with them), selected without
  the `address` column (the view shows the place name, companions, host and notes), and
  `hotlines` where `role = SANT`.
- their own menu (`meals` with `menu_for = SANT`, written only by the Santo menu sync,
  `/sant/menu`);
- the breakouts they can join (`/sant/breakouts` and the home's Breakouts tile). Santos have no
  sessions of their own (user, 2026-10-02): `getSantBreakouts()` (`src/lib/santBreakouts.ts`)
  reads the real team breakouts (the `bk-` rows, with their live moves; never
  `users.breakout_sessions`, `getBreakoutsForUser()` or the old Santo sample rows), folds them
  into sessions with the display API's `foldSessions()` (`src/lib/breakoutSessions.ts`), keeps
  the Bhaio ones less every "combined" one (`isCombined()`: a Behno session on the same day, at
  overlapping times, with a room in common) unless the organisers mark it "Santo joining"
  (`santos` in `prisma/breakouts-data.ts`; no column: `santoJoiningByRowId()` in
  `prisma/breakouts.ts` maps the marked rows' ids to the window as offsets from the row's start,
  passed into the pure `santBreakoutSessions()`), which then shows at that window, taken from
  the live row so it follows live moves, with a "Santo joining" chip, and groups them per day
  into blocks of overlapping or touching sessions ("Friday afternoon"). The page shows each
  block as a card that opens to its sessions, their rooms linking to `/sant/map`
  (`venueHref(…, { base: "/sant/map" })`);
- the venue map (`/sant/map`): the delegate `/map` for santos, on the Bhaio track
  (`santVenueTrack()`), with the Programme places and deep links shared through
  `src/lib/venue/mapPage.ts`, no rooms of their own and no admin panel. It is the only page
  that sends the Pujya Santo payload to the browser (`/sant/breakouts` resolves its room links on
  it server-side): `getVenueForPages(sant)` gives a viewer with role SANT `toSantClientVenue()`
  (the delegates' payload plus the sadhus' residence rooms santos are shown, under the names the
  user gave them in `SANT_ROOM_NAMES`, the residence floor as the level's grid with the delegates'
  as `guestGrid`, the floor santos walk there sent as plain floor rather than grey outlines, and
  the santo-only stair / elevator landings) when the map's santo extras validate, else the
  delegates' payload. On it the router is two searches (`src/lib/venue/route.ts`): trips that neither start
  nor end in the residence run over exactly the delegates' inputs, so they are the delegates'
  routes, and residence trips over the santos' floor, never through another sadhu's own room
  unless nothing else gets there. Delegates' and admins' payload is unchanged
  (`toClientVenue()`), and `breakoutWays()` refuses the santo payload.
The per-person reads (personal schedule, rides, utaro and its companions) go by the
`requireSant()` object's `dataUserId`, never its `id`: for everyone that is their own id, but a
Santo mirror test account (a SANT with a tester code whose `users.mirror_registration_id` holds
another sant's BAPS ID, honoured only with `ALLOW_MIRROR_TESTERS=true`; user, 2026-10-02; set
with `npm run sant:demo -- --mirror <BAPS ID>`) gets the mirrored sant's id there, with his
gender, seva, region, center and utaro, and a band under the header naming him
(`withMirror()` in `src/lib/auth.ts`). Writes, the bell's read state and personal announcements
stay on the account's own `id`; admin accounts never mirror. It shows a real sant's utaro and
programme behind a static code, so clear it (`sant:demo -- --mirror off`, or `--remove`) and set
`ALLOW_MIRROR_TESTERS=false` after testing, before the event.
The sant bell shows organiser announcements, their delegate links rewritten by `santHref()` (a
`/map` link becomes `/sant/map` with its query, so `?to=` still opens the room); the Santo menu is
open from the start, so it adds no "menu is out" releases. A Menu announcement with no role targeting is about the delegate menu and skips
santos; it reaches them only when targeted to santos.

### Admin console (`/admin`)
`users.role = ADMIN`. `src/app/admin/layout.tsx` calls `requireAdmin()`; every mutation is a
server action that calls `getAdmin()` itself and validates with zod. Admin accounts never accept
tester codes, and sign-in sends admins to `/admin`.
- Delegates: the page loads every user with a safe `select` (no `test_code`), and the browser
  searches/filters/sorts in memory (including by registration ID and registration status);
  add/edit go through `createPerson` / `updatePerson`. The registration ID (unique) and center are
  editable; an edit that doesn't send the registration ID leaves it alone, so a form can't unlink
  someone the import linked. The other master-list fields are import-only.
- Announcements: one rule in `src/lib/admin/announcements.ts` decides who a notification
  reaches (gender track × roles × sevas × regions, empty list = no restriction). The bell
  (`getNotificationsFor`) and the composer's recipient count both use it. `createdAt` is the
  publish time, so a future value schedules the announcement. A personal announcement
  (`notifications.user_ids` not empty) goes to exactly the accounts it lists, matched on the
  session's own user id, and none of the other dimensions applies; it is stored under a seva and
  region nobody has (`PERSONAL_MARK`), so code that doesn't know the column shows it to no one
  rather than to everyone. Rows are read through
  `withPeopleColumn()` and added through `createNotification()` (`src/lib/notificationPeople.ts`),
  which keep working on a database the column hasn't been pushed to yet.
- Live schedule: `src/lib/admin/schedule.ts` plans a change (the UI shows the exact preview),
  then applies it in one locked transaction with relative SQL updates, capturing printed times
  in `original_*` columns. Linked meals (and so their menu reveals) and in-window breakouts move
  with their slots (a breakout follows the slot of its own track or a shared one that contains
  it, so a shared "Team Breakouts" slot carries both tracks' sessions). The Santo menu and the
  Santo general schedule never move. Each change is logged in `schedule_changes` with per-row
  before/after times, which is what Undo subtracts. Guests pick changes up on their next request /
  60-second refresh.
- Transport (`/admin/transport`, read-only): `loadTransportBoard()` → `getTransportBoard()` for
  one direction under the console seva filter; the page picks `?dir=` (default arrivals, then
  departures from Sat, Oct 10) and `?day=` (default today when anyone travels today, else all).
  The browser searches and narrows to flagged people in memory; the warnings in
  `src/components/admin/transport/board.ts` mirror the import's flags. The Overview's
  `TransportGlance` card shows the same counts. Nothing is edited here: the next import replaces
  the data.
- Rooming (`/admin/rooming`, read-only): `loadRoomingBoard()` → `getRoomingBoard()` for one stay
  (`?stay=main|wed`, default main) and optionally one hotel (`?hotel=`) under the console seva
  filter (room groups with anyone of those sevas, listed whole). Every `room_groups` row is
  listed, with its occupants by bed, open and held beds, and notes (mixed tracks, people not in
  the app yet, where someone is in the other stay); the browser searches and narrows to open
  beds or rooms with notes in memory. Nothing is edited here: the next import replaces the data.
- Transport and Rooming share the console's Logistics tab: the bottom nav's fifth tab leads to
  `/admin/transport`, and `LogisticsSwitch` at the top of each board switches between them.
- Email bounces (`/admin/bounces`, no tab: the Overview's `BouncesGlance` card and the directory's
  "Email bounced" note lead there): `getEmailBounceTracker()` (`src/lib/admin/emailEvents.ts`)
  folds `email_events` per address (open while any event is unresolved; `src/lib/emailEvents/view.ts`)
  and matches each to the accounts whose email is that address now (`lower()` in SQL). Mark
  resolved (with a short note) / Reopen are server actions that call `getAdmin()`. A missing
  table reads as "not set up yet". `npm run ses:bounces -- --backfill` imports the SES account
  suppression list entries that are Hub accounts' emails; `--list` prints counts and BAPS IDs.

### App shell (scrolling)
Many guests open the Hub inside Telegram, whose iOS in-app browser lays the page out below its
floating controls without clipping it, so anything the document scrolls past the top shows
behind them. The document therefore never scrolls: each layout renders `.app-shell` (viewport
height) with the header in flow and one `<AppScroll>` (`#app-scroll`) as the only scroller, and
the bottom nav and overlays are `position: fixed` outside it. Scroll reads, jumps, listeners and
scroll locks all go through `src/lib/scroll.ts`; `<AppScroll>` also restores the offset on
back/forward and takes keyboard focus on desktop so Page Down works. Links that leave the Hub
(the Prasang form) open in the same tab so Telegram users can come back with Back.

### Venue Wi-Fi
The venue network (`BAPS_5G`) is open, so Wi-Fi is an announcement rather than a page: the
"Venue Wi-Fi" template in the admin composer (`src/components/admin/announcements/templates.ts`).
It carries no link, so the bell opens it in the full-screen reader.

### Content updates
Organisers change the schedule or menu → edit `prisma/seed.ts` → `npm run db:seed:lightsail`
(rewrites the three content tables and syncs the team breakouts, never touches users). The
breakout matrix changes → edit `prisma/breakouts-data.ts` → `npm run breakouts:sync:lightsail`
(needs `npm run db:push:lightsail` once for the `breakouts.audience` column). The santo list or
utaros change → regenerate `prisma/santos-data.ts` (or edit it for a small fix) →
`npm run santos:import:lightsail`. The
Santo schedule changes → regenerate `prisma/sant-schedule-data.ts` →
`npm run sant:schedule:sync:lightsail` (needs `db:push:lightsail` once for
`sant_general_schedule_items`), then `npm run sant:menu:sync:lightsail` if a meal moved. The
santos' own schedules change → regenerate `prisma/sant-personal-data.ts` →
`npm run sant:personal:sync:lightsail -- --dry-run`, then without `--dry-run`. The
kitchen's Santo menu sheet changes → edit `prisma/sant-menu-data.ts` →
`npm run sant:menu:sync:lightsail -- --dry-run`, then without `--dry-run`. A new master list or goshthi file →
`npm run delegates:import:lightsail` with `--plan`, then `--dry-run`, then `--apply` (needs
`db:push:lightsail` once for the new `users` columns). A new transport workbook →
`npm run transport:import:lightsail` the same way (needs `db:push:lightsail` once for
`transport_legs` and `users.accommodation_package`). A new rooming workbook →
`npm run rooming:import:lightsail` the same way (needs `db:push:lightsail` once for
`room_assignments` and `room_groups`). The organisers' flow maps change → edit the flow rules
file kept outside the repo (windows starting before the walk to their session) → `npm run
venue:import -- --file <map> --plan --flows <flows> --compare <the map imported last>`, then
`venue:import:lightsail` with `--dry-run` and `--apply` (with `--delegates-change`). New drawings
also need the flows file (kept beside the venue files) matched again. No deploy
needed because pages read the database on every request. The exception is hotel details (full name, address, phone, check-in / check-out
times): they live in `src/lib/hotels.ts`, so filling them in is a code change and a deploy.

---

## 3. Deploying production from the git repo

Requirements on the target platform:

- Node.js 20 or newer, outbound HTTPS to AWS (SES/SNS) and TCP 5432 to the Lightsail
  endpoint.
- Build command `npm ci && npm run build`; start command `npm start`; port from `PORT`
  (Next.js defaults to 3000).
- HTTPS termination (the session cookie is `Secure`).

Environment variables (see `.env.example`):

| Variable                | Production value                                                          |
| ----------------------- | ------------------------------------------------------------------------- |
| `DATABASE_URL`          | Lightsail URL with `sslmode=require&connection_limit=10` (single long-lived process) |
| `AUTH_SECRET`           | 48+ random bytes; changing it signs everyone out                          |
| `OTP_PROVIDER`          | `aws`                                                                     |
| `AWS_REGION`            | `us-east-1`                                                               |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Send-only IAM user (`scripts/setup-vercel-aws-key.mjs` creates it); omit if the host has an IAM role |
| `SES_FROM_EMAIL`        | `NAAM 2026 Hospitality Hub <noreply@sypramsoftware.com>` (also the default when unset; or the final domain once verified) |
| `SES_REPLY_TO`          | Optional: comma-separated Reply-To addresses (unset: replies go to the sender) |
| `SES_CONFIGURATION_SET` | Optional: SES configuration set for bounce/complaint events (open/click tracking off) |
| `SES_EVENTS_TOPIC_ARN`  | Optional: the SNS topic of those events (`arn:aws:sns:us-east-1:<account id>:naam-ses-bounces-complaints`); turns on `POST /api/ses/events` for the bounce tracker (unset: 404). Set it only on the deployment the topic is subscribed to |
| `EVENT_TZ`              | `America/New_York`                                                        |
| `ALLOW_TIME_TRAVEL`     | `false`                                                                   |
| `MENU_REVEAL_ALL`       | `false`                                                                   |

First-time database setup from the repo: `npx prisma db push` (or `prisma migrate deploy`
once migrations exist) and `SEED_MOCK_DATA=false npx prisma db seed` (which also syncs the Santo
general schedule), both with the production `DATABASE_URL` in the environment, then
`npm run santos:import:lightsail` for the santos and their utaros,
`npm run sant:personal:sync:lightsail` (dry-run first) for their personal programmes and
`npm run delegates:import:lightsail` (plan → dry-run → apply) for the delegates, then
`npm run transport:import:lightsail` (plan → dry-run → apply) for their airport transport and
`npm run rooming:import:lightsail` (plan → dry-run → apply) for their hotel room groups.

Sizing: a single instance with 1 vCPU / 1–2 GB handles 800 users comfortably; the work per
request is a few indexed queries. Run two instances only if the platform needs it for
zero-downtime deploys.

---

## 4. Security notes

- Secrets live only in environment variables; `.env*` files are gitignored and excluded from
  Vercel uploads (`.vercelignore`).
- The database is reachable from the internet (Lightsail has no IP allow-list). Mitigations:
  32-character master password, TLS required, and the option to switch to private mode if the
  app runs inside AWS. Creating an app-only Postgres role with least privilege is recommended.
- The IAM user used for sending can only call `ses:SendEmail`, `ses:SendRawEmail` and
  `sns:Publish` (to phone numbers). The policy written by `scripts/setup-vercel-aws-key.mjs`
  allows sending on the account's SES identities and the `naam-hospitality-hub` configuration
  set, so a different `SES_CONFIGURATION_SET` name needs the policy changed too.
- OTP endpoints are rate-limited per user in the database; add per-IP throttling at the
  platform edge if available.
- The organisers' spreadsheets hold personal details: the delegate, transport and rooming
  imports read them from a path given at run time and they are never committed. The printed
  summaries have counts, sheet / field names, User Ids (and, for delegates, BAPS IDs; for
  rooming, room keys and row numbers) only, never names, emails, phones, flights or times, and
  `--out` (the full plan as JSON) refuses a path inside the repo.
- Transport: a delegate's `/transportation` shows only their own legs and their group's size,
  never who else is in the group; the admin board (names, phones) is behind `requireAdmin()`.
- Rooming: a delegate's `/stay` shows only their own room group(s) and their roommates' names
  (nothing else about them; roommates without an account are counted, not named); the rooming
  import never reads names from the workbook. The admin board (names, BAPS IDs) is behind
  `requireAdmin()`.
