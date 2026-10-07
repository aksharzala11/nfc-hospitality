# Deployment

The app runs on Dokploy at https://dok.msalia.org, serving https://baps-bky.org.
IDs and DNS details are in [INFRASTRUCTURE.md](INFRASTRUCTURE.md).

## How it works

Dokploy clones `git@github.com:msalia/baps-bky.git` (branch `main`) using the
`baps-bky-deploy` SSH key, builds the `Dockerfile`, and runs the container on
port 3000 behind Traefik with a Let's Encrypt certificate.

The Dockerfile is a three-stage build:

1. **deps** — `npm ci`, then an explicit `npm install --no-save` of
   `lightningcss-linux-x64-gnu` and `@tailwindcss/oxide-linux-x64-gnu`.
   `package-lock.json` is generated on macOS, so `npm ci` records the darwin
   variants and skips the linux ones; without this the build dies with
   `Cannot find module '../lightningcss.linux-x64-gnu.node'`.
2. **builder** — `npm run build` (`prisma generate && next build`). A throwaway
   `DATABASE_URL` is set here because `prisma generate` parses the URL; it never
   connects at build time.
3. **runner** — copies `.next/standalone`, `.next/static`, `public`, and
   — explicitly — `node_modules/.prisma` and `node_modules/@prisma/client`.
   Next's file tracing does not reliably pull the generated Prisma client and
   its query engine into the standalone output.

`next.config.ts` sets `output: "standalone"` so the runner can `node server.js`.

The health check hits `http://0.0.0.0:3000/`, not `localhost` — the server binds
`0.0.0.0` (via `ENV HOSTNAME`) and does not answer on `127.0.0.1`.

## Ship a change

From the repo root:

```bash
npm run typecheck          # there is no test suite; this is the gate
git add -A
git commit -m "feat: description"
git push
```

Then trigger the deploy (or use `/project ship` from the Projects root, which
does all of the above):

```bash
ROOT=/Users/msalia/Documents/Projects
TOKEN=$(grep TOKEN "$ROOT/integrations/DOKPLOY-server-1/.creds" | awk '{print $2}')
API_BASE=https://dok.msalia.org/api/trpc
APP=AYty5rSUbFkhG-6g-zI8m

curl -s -H "x-api-key: $TOKEN" "$API_BASE/application.redeploy" \
  -X POST -H "Content-Type: application/json" \
  --data-raw "{\"json\":{\"applicationId\":\"$APP\"}}"
```

Always reload Traefik afterwards — stale routing is the usual cause of a 502 on
a container that is demonstrably running:

```bash
curl -s -H "x-api-key: $TOKEN" "$API_BASE/settings.reloadTraefik" \
  -X POST -H "Content-Type: application/json" --data-raw '{"json":{}}'
```

## Environment variables

Set in Dokploy (Application → Environment), not in the repo. Current state:

| Variable | Value | Status |
|---|---|---|
| `DATABASE_URL` | placeholder | **Blocked** — needs the real `naam-users` URL, with `sslmode=require` and `connection_limit=10` |
| `AUTH_SECRET` | 48 random bytes, base64url | Set. Rotating it signs every guest out. |
| `OTP_PROVIDER` | `console` | Temporary — codes print to the container log instead of being emailed |
| `AWS_REGION` | `us-east-1` | Set |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | key of the send-only IAM user `naam-hub-dokploy` (same policy as `naam-hub-vercel`) | Created 2026-09-26 and handed over in `.env.dokploy` (git-ignored). Separate from Vercel's key, so each can be rotated alone; never re-run `setup-vercel-aws-key.mjs` for Dokploy |
| `SES_FROM_EMAIL` | `NAAM 2026 Hospitality Hub <noreply@sypramsoftware.com>` | **Change it**: Dokploy still has the old `Hospitality Hub <hospitality@sypramtechnology.com>`, which is not a verified SES identity and overrides the app's default. Set this value, or delete the variable (the app then sends from this address) |
| `EVENT_TZ` | `America/New_York` | Set |
| `ALLOW_TIME_TRAVEL` | `true` | **Set to `false` before the event** |
| `ALLOW_MIRROR_TESTERS` | unset (= `false`) | Optional. `true` lets the mirror test accounts (`npm run testers:personas:lightsail`, TEST0101–TEST0110) show real delegates' hub data, and the tester sant SANTO0001, once given a mirror (`npm run sant:demo -- --env .env.lightsail --mirror <BAPS ID>`), show that real sant's Santo view (his programme, rides and utaro); set it only while organisers test with them, then back to `false` |
| `MENU_REVEAL_ALL` | `true` | **Set to `false` before the event** |
| `SES_EVENTS_TOPIC_ARN` | unset (= `/api/ses/events` is a 404 here) | Leave unset: the SNS topic `naam-ses-bounces-complaints` is subscribed to the Vercel deployment (`https://naam-five.vercel.app/api/ses/events`), which stores the bounces in the shared database, so the bounce tracker (`/admin/bounces`) shows them here too. If the guests' deployment moves here, set it to `arn:aws:sns:us-east-1:<account id>:naam-ses-bounces-complaints`, subscribe `https://baps-bky.org/api/ses/events` to the topic and unsubscribe the Vercel URL (see the README, "Email bounces"); keep the variable in every `env` update below |
| `DISPLAY_API_KEYS` | unset (= the display API is off here: every `/api/display/*` call is a 404) | Leave unset: the TV screens ([DISPLAY_API.md](DISPLAY_API.md)) use the Vercel deployment, where the key is set. If they ever move here, set comma-separated keys of 24+ characters (`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`) and keep the variable in every `env` update below |

Optional, not needed to send: `SES_REPLY_TO` (comma-separated Reply-To for the sign-in email;
unset, replies go to the sender) and `SES_CONFIGURATION_SET` (sends through that SES
configuration set for bounce/complaint events; keep open/click tracking off in it, and the IAM
policy must allow `ses:SendEmail` on it: `scripts/setup-vercel-aws-key.mjs` grants
`configuration-set/naam-hospitality-hub`).

Update them with:

```bash
curl -s -H "x-api-key: $TOKEN" "$API_BASE/application.update" \
  -X POST -H "Content-Type: application/json" \
  --data-raw '{"json":{"applicationId":"'"$APP"'","env":"KEY=value\nKEY2=value2"}}'
```

`env` replaces the whole block, so send every variable, not just the changed one.

## Pre-event checklist

- [ ] Real `DATABASE_URL` set in Dokploy, app redeployed, sign-in verified
- [ ] `prisma db push` run against the production database (`npm run db:push:lightsail`;
      creates the new `sant_general_schedule_items` table and the master-list `users` columns:
      `registration_id`, `center`, `personal_wing`, `seva_wing`, `seva_role`,
      `registration_status`, `goshthi_group`, `goshthi_room`, `goshthi_moderator`,
      `accommodation_package`, `mirror_registration_id` (push before deploying this code:
      sign-in and every hub page read every `users` column, so a missing one fails them), and the
      `transport_legs`, `room_assignments` and `room_groups` tables), then `prisma db seed`
      with `SEED_MOCK_DATA=false` (schedule/menus only — never seed mock users)
- [ ] Delegates and their transport loaded, in this order, each import run `--plan` →
      `--dry-run` → `--apply` (workbooks outside the repo): (1) the `db:push:lightsail` above; (2)
      `npm run delegates:import:lightsail -- --master "<App DataSet.xlsx>" --goshthi "<eNAAM
      Goshthi Group Allocations.xlsx>"` plus every `--baps-id <User Id>=<BAPS ID>` the
      organisers sent (the same on each run): check the skipped / Refunded / two-row / unmapped
      lists and the goshthi section (blank rooms, moderator rows) in the plan, and the changes in
      the dry run (every delegate's email becomes `<BAPS ID>@na.baps.id`, counted by domain); (3)
      `npm run transport:import:lightsail -- --file "<Transportation Information v3.xlsx>"`:
      check the disagreements, skipped people and flags. Transport goes last because it sets
      `accommodation_package` only on users that already exist. Re-run step 2 whenever the
      organisers send a new master list or goshthi workbook
- [ ] Hotel rooming loaded, after the `db:push:lightsail` above and the delegate import (so the
      import's people check sees their accounts; rooms are stored either way and link by User
      Id): `npm run rooming:import:lightsail -- --file "<FINAL Rooming List v17.xlsx>"` with
      `--plan --master "<App DataSet.xlsx>"` → `--dry-run` → `--apply` (workbook outside the
      repo). In the plan check the tab list (only the five visible hotel tabs are read; a missing
      or hidden one is an error), the conflicts, the room groups mixing Bhaio and Behno, the
      people not on file and the "Summary V2" cross-check; in the dry run the creates, updates and
      deletes. If `--apply` refuses because a hotel would be emptied, check the workbook's tabs;
      add `--allow-deletes` only if everyone there really has left
- [ ] Hotel details filled in `src/lib/hotels.ts` once the organisers confirm them (full name,
      address, front-desk phone, check-in / check-out times), then redeploy: until then `/stay`
      shows the hotel name only, with "Address and check-in time to follow"
- [ ] Delegates' help contacts added, in this order: (1) the code of 2026-10-01 or later is
      deployed (it reads each contact's topic and track; the code before it shows every delegate
      line on both pages to both tracks, so never add a one-track contact while that is live); (2)
      `npm run db:push:lightsail` (adds `hotlines.topic` / `.audience` and lets a hotel and track
      have several liaisons; no data loss, no prompt: stop if it warns of any); (3)
      `npm run hotlines:lightsail -- --list`, and `--remove --id <id>` any line that is out of
      date (lines from before the push read as general, for everyone); (4)
      `npm run hotlines:lightsail -- --add --role delegate --topic <stay|transport|general>
      --track <bhaio|behno|all> --label "…" --name "…" --phone "…"`: an accommodation contact per
      track for `/stay` and a transport contact for `/transportation`, each shown with a Call
      button. A page with no contact shows none (the admin Transport and Rooming boards warn while
      a track has none). Hotel Liaisons per hotel and track with
      `npm run hotel:liaisons:lightsail -- --add ...` (a second one for a hotel and track needs the
      same push)
- [ ] Real santos and utaros imported: `npm run santos:import:lightsail -- --dry-run`, check
      the output, then `npm run santos:import:lightsail`
- [ ] Santo general schedule synced: `npm run sant:schedule:sync:lightsail` (the seed runs the
      same sync; run it again after any change to `prisma/sant-schedule-data.ts`)
- [ ] Santo personal programmes synced (after the santos are imported):
      `npm run sant:personal:sync:lightsail -- --dry-run`, check it, then
      `npm run sant:personal:sync:lightsail` (not run by the seed; run it again after any change
      to `prisma/sant-personal-data.ts`)
- [ ] Santo menu synced: `npm run sant:menu:sync:lightsail -- --dry-run`, check it, then
      `npm run sant:menu:sync:lightsail` (the seed runs the same sync; it also deletes the old
      `sample-santo-meal-*` menu; run it again after any change to `prisma/sant-menu-data.ts`, or
      to a meal's time in `prisma/sant-schedule-data.ts`)
- [ ] AWS credentials with `ses:SendEmail` + `sns:Publish` set, and
      `OTP_PROVIDER=aws`
- [ ] `SES_FROM_EMAIL` set to `NAAM 2026 Hospitality Hub <noreply@sypramsoftware.com>` (or
      removed) in Dokploy, and a test sign-in email received from that address
- [x] SES production access granted (out of the sandbox) in the account and region that send
      (us-east-1; granted 2026-09-27, 50,000/day), so unverified recipients such as the santos' `na.baps.org` and the
      delegates' `<BAPS ID>@na.baps.id` addresses get their codes
- [ ] SPF for `sypramsoftware.com` mail: a custom MAIL FROM domain on the SES identity (e.g.
      `mail.sypramsoftware.com`, with the MX and `v=spf1 include:amazonses.com ~all` TXT records
      SES lists), so SPF aligns for DMARC
- [ ] DMARC record for `sypramsoftware.com`: a TXT at `_dmarc.sypramsoftware.com` (start with
      `v=DMARC1; p=none; rua=mailto:<reports address>`, tighten once reports are clean)
- [ ] SNS origination number registered if SMS sign-in is used (2–4 weeks lead
      time for a toll-free number)
- [ ] `ALLOW_TIME_TRAVEL=false`
- [ ] `MENU_REVEAL_ALL=false`
- [ ] The TV screens use the Vercel deployment (`https://naam-five.vercel.app/api/display`,
      [DISPLAY_API.md](DISPLAY_API.md)): there `DISPLAY_API_KEYS` holds their key, and
      `ALLOW_TIME_TRAVEL` / `MENU_REVEAL_ALL` must be `false` in Vercel too before the event;
      check `curl -H "Authorization: Bearer <key>" https://naam-five.vercel.app/api/display/now`
      gives `200` with `"timeTravel": false`, and a `401` without the header
- [ ] Tester rows removed, or `test_code` cleared (`TEST0001` exists today)
- [ ] Mirror test accounts removed (`npm run testers:personas:lightsail -- --remove`; they show
      real delegates' transport, stay and roommates behind a static code), SANTO0001's Santo
      mirror cleared (`npm run sant:demo -- --env .env.lightsail --mirror off`, or `--remove`,
      which deletes the tester sant; it shows a real sant's utaro and programme behind a static
      code) and `ALLOW_MIRROR_TESTERS` unset or `false`
- [ ] Manual snapshot of the database taken
