# Display API (TV screens)

A small read-only JSON API for the screens around the mandir during NAAM 2026 (Thu Oct 8 to
Sun Oct 11, Edison, NJ). It serves the same schedule, delegate menu and team breakouts that
delegates see in the Hospitality Hub, with the same rules: live delays entered by the
organisers, menus that stay hidden until their reveal time, and breakout sessions per
gender track. When the organisers change something in the Hub, the API shows it on your
next request.

It holds no personal data: no names, contacts, rooming, transport or announcements.

- **Base URL:** `https://naam-five.vercel.app/api/display`. Point the event's screens there.
- **Before the event** the Hub team keeps testing switches on at that host, so `now` works
  (see below) and menus may show before their reveal time (`"revealAll": true`). Both are
  turned off before Thu, Oct 8; from then on the responses are exactly what delegates see.
- **Endpoints:** `GET /schedule`, `GET /menu`, `GET /breakouts`, `GET /now`, each under the
  base URL (e.g. `https://naam-five.vercel.app/api/display/now`). `GET` on the base URL itself
  lists them (same key), which is a quick way to check that your key works.
- **Format:** JSON (UTF-8). Every response is built fresh (`Cache-Control: no-store`).
- **Response types:** TypeScript definitions in `src/lib/display.ts` (`DisplayScheduleResponse`,
  `DisplayMenuResponse`, `DisplayBreakoutsResponse`, `DisplayNowResponse`, `DisplayIndexResponse`
  for the base URL, and the types they use).

## Authentication

Every request needs the display key the Hub team gives you. Send it in a header:

```
Authorization: Bearer <key>
```

or, when the screen can only be given a URL (a TV browser, a signage player), as a query
parameter:

```
https://naam-five.vercel.app/api/display/now?key=<key>
```

Give `key` once: a URL with `key` in it twice is a `400` (`Give "key" once.`), even when the
header is sent too.

Prefer the header when you can: a URL with the key ends up in browser history and request
logs.

**The key is a shared secret.** Keep it out of public repositories, screenshots and chat
channels, and out of JavaScript served from a public website (anyone could read it there).
Load it from your own configuration on the device or server that drives the screens. If a key
leaks, tell the Hub team: they replace it and the old one stops working. Every screen
developer or group of devices can have its own key.

| Status | Meaning |
| --- | --- |
| `400` | `key` given more than once in the URL (or another bad parameter: see below). |
| `401` | Key missing or wrong. |
| `404` | The API is switched off (no keys configured), or no such endpoint (that one may be an HTML page). |

## Conventions

**Times.** Every instant is ISO 8601 in UTC (`"2026-10-09T15:00:00.000Z"`). Next to each one
is the Eastern (America/New_York) label the Hub shows: `startLabel` `"11:00 AM"`, `timeLabel`
`"11:00 AM – 12:30 PM"` (en dash), `dayLabel` `"Day 2"` (the printed schedule's name:
Arrival, Day 2, Day 3, Departure), `dayTitle` `"Fri, Oct 9"`, and `day` `"2026-10-09"`. Show
the labels as they are, or format the UTC instants yourself in `America/New_York`, whatever
zone the screen's device is set to.

**Tracks.** Friday and Saturday have separate programmes for Bhaio (gents) and Behno
(ladies). Every item carries `audience` (`"ALL"`, `"BHAIO"` or `"BEHNO"`) and `tracks`
(`["bhaio", "behno"]` for ALL, else one of them).

**Status.** Items, meals and sessions carry a `status` computed on the server at `now`:
`past`, `now` (in progress), `next` or `upcoming`. On `/schedule`, `next` is the first item
to start and only while nothing is in progress (as the Hub shows it). On `/breakouts`, `next`
marks every session, and every slot, starting at the earliest upcoming start on its track,
even while others run. A slot for both tracks (`"audience": "ALL"`) counts on each track it
has sessions for, so with `track=bhaio` or `track=behno` one start time is `next`, and with
`track=all` each track has its own `next` (at 11:10 AM on Friday: the Bhaio slot at 3:00 PM,
and Saturday's shared 11:00 AM slot for Behno).

**Live changes.** When the organisers move something from the printed schedule,
`delayMinutes` (start) and `endDelayMinutes` (end) say by how much (+ later, − earlier),
`changeLabel` gives the Hub's badge text (`"Delayed 15 min"`, `"Earlier by 10 min"`,
`"Ends 10 min later"`, `"Ends 5 min early"`) and `original` holds the printed times. On
time: `0`, `0`, `null`, `null`.

**Every response starts with:**

```jsonc
{
  "generatedAt": "2026-10-09T15:40:02.117Z", // the server's clock
  "now": "2026-10-09T15:40:02.117Z",         // the moment the statuses describe: exactly generatedAt unless timeTravel
  "timeTravel": false,
  "timeZone": "America/New_York",
  "today": "2026-10-09",                     // Eastern date of `now`
  "eventDay": "2026-10-09"                   // `today` during the event (Oct 8–11), else null
}
```

**Query parameters.** Unknown parameters are ignored (a cache-busting `&_=123` is fine). A
`day`, `track` or `key` given twice, or a value that isn't allowed, is a `400`. Production
ignores `now` altogether, even given twice.

| Parameter | Values | Used by |
| --- | --- | --- |
| `day` | `2026-10-08` … `2026-10-11`, `today` (today's event day; every day outside the event), or `all` | `/schedule`, `/breakouts` (default `all`), `/menu` (default `today`) |
| `track` | `bhaio`, `behno` or `all` (default). An ALL item is on both tracks. | `/schedule`, `/breakouts` |
| `key` | your key, when you can't send the header | all |
| `now` | a moment such as `2026-10-09T11:15` (Eastern) to preview; **test deployments only** (`ALLOW_TIME_TRAVEL=true`), where a bad or repeated value is a `400`. Production ignores it and says `"timeTravel": false` | all |

Responses echo the `day` they applied (`null` = every day) and the `track`.

**Errors** are JSON too:

```json
{ "error": "bad_request", "message": "\"track\" must be \"bhaio\", \"behno\" or \"all\"." }
```

`error` is one of `bad_request` (400), `unauthorized` (401), `not_found` (404) or
`server_error` (500: try again on the next poll).

**CORS.** Any origin may call the API from a browser (`Access-Control-Allow-Origin: *`,
methods `GET, OPTIONS`, request header `Authorization`). No cookies are used; the key is the
only credential.

## Polling

Poll every **30 to 60 seconds** (not faster than every 15 s), and give each screen a few
seconds of random offset so they don't all ask at once. Statuses, delays and menu reveals
are only as fresh as your last request, so 30 s is right for a "Now" screen and 60 s for a
full-day schedule.

- Set a request timeout (about 10 s). On a timeout, a `5xx` or no network, keep showing the
  last good response and try again on the next tick.
- On `401`, show a "display key needed" message rather than stale data.
- Between polls you can advance a clock yourself from `now`; the next poll corrects it.

## `GET /schedule`

The delegate programme, in time order. Parameters: `day`, `track`.

```
GET /api/display/schedule?day=today&track=bhaio
```

```jsonc
{
  "generatedAt": "2026-10-09T13:40:00.412Z",
  "now": "2026-10-09T13:40:00.412Z",
  "timeTravel": false,
  "timeZone": "America/New_York",
  "today": "2026-10-09",
  "eventDay": "2026-10-09",
  "day": "2026-10-09",
  "track": "bhaio",
  "items": [
    // … earlier items with "status": "past"
    {
      "id": "cm2k8q0v1000108l4f3h2a9xy",
      "day": "2026-10-09",
      "dayLabel": "Day 2",
      "dayTitle": "Fri, Oct 9",
      "startsAt": "2026-10-09T13:25:00.000Z",
      "endsAt": "2026-10-09T14:55:00.000Z",
      "startLabel": "9:25 AM",
      "endLabel": "10:55 AM",
      "timeLabel": "9:25 AM – 10:55 AM",
      "delayMinutes": 10,
      "endDelayMinutes": 10,
      "changeLabel": "Delayed 10 min",
      "original": {
        "startsAt": "2026-10-09T13:15:00.000Z",
        "endsAt": "2026-10-09T14:45:00.000Z",
        "startLabel": "9:15 AM",
        "endLabel": "10:45 AM",
        "timeLabel": "9:15 AM – 10:45 AM"
      },
      "title": "Keynote Program 1",
      "kind": "SESSION",          // ARTI, SESSION, BREAKOUT, MEAL, BREAK, TRAVEL or FREE
      "audience": "ALL",
      "tracks": ["bhaio", "behno"],
      "location": "Main Hall",
      "description": "i/eBKY Combined",
      "status": "now"
    },
    {
      "id": "cm2k8q0v1000208l4c7d1e5fg",
      "title": "Travel",
      "kind": "TRAVEL",
      "timeLabel": "10:45 AM – 11:00 AM",
      "status": "upcoming"
      // … same fields as above
    }
    // …
  ]
}
```

`kind: "BREAKOUT"` items ("Team Breakouts") are the blocks in which the team sessions of
`/breakouts` happen.

## `GET /menu`

The delegate meals with their menus, in time order. Parameter: `day` (default `today`: the
current event day, or every day before and after the event).

A meal's menu is revealed one hour before it starts, and not before the previous meal has
ended. Until then the meal is listed with its name, time and `revealsAt`, `status: "locked"`
and no dishes. After it ends it is `"served"` (dishes still listed).

```
GET /api/display/menu
```

```jsonc
{
  "generatedAt": "2026-10-09T15:40:02.117Z",
  "now": "2026-10-09T15:40:02.117Z",
  "timeTravel": false,
  "timeZone": "America/New_York",
  "today": "2026-10-09",
  "eventDay": "2026-10-09",
  "day": "2026-10-09",
  "revealAll": false,           // true only while the organisers audit menus before the event
  "meals": [
    {
      "id": "cm2k8q0vz000908l4d2c4b1aa",
      "day": "2026-10-09",
      "dayLabel": "Day 2",
      "dayTitle": "Fri, Oct 9",
      "startsAt": "2026-10-09T11:45:00.000Z",
      "endsAt": "2026-10-09T13:00:00.000Z",
      "startLabel": "7:45 AM",
      "endLabel": "9:00 AM",
      "timeLabel": "7:45 AM – 9:00 AM",
      "delayMinutes": 0,
      "endDelayMinutes": 0,
      "changeLabel": null,
      "original": null,
      "name": "Delegate Breakfast",
      "note": "Bhaio 7:45–9:00 · Behno 7:45–8:30",
      "location": "Dining Hall",
      "status": "served",
      "revealed": true,
      "revealsAt": "2026-10-09T10:45:00.000Z",
      "revealLabel": "6:45 AM",
      "courses": [
        {
          "course": "Fruit, Yogurt & Cereals",
          "dishes": [
            { "name": "Sliced Apples", "description": null, "tags": [] },
            { "name": "Whole Banana", "description": null, "tags": [] },
            {
              "name": "Yogurt Parfait",
              "description": "Granola, honey, coconut flakes, sliced almonds, strawberries & blueberries",
              "tags": ["Contains almonds", "Contains coconut"]
            }
          ]
        }
        // …
      ]
    },
    {
      "id": "cm2k8q0w0000a08l4b9f0c3dd",
      "name": "Delegate Lunch",
      "timeLabel": "12:30 PM – 2:00 PM",
      "status": "revealed",
      "revealed": true,
      "revealsAt": "2026-10-09T15:30:00.000Z",
      "revealLabel": "11:30 AM",
      "courses": [
        { "course": "Beverages", "dishes": [{ "name": "Strawberry Mint Lemonade", "description": null, "tags": [] }] },
        { "course": "Main", "dishes": [{ "name": "Falafel Bowl", "description": null, "tags": [] } /* … */] }
        // …
      ]
      // … same fields as above
    },
    // … "Snacks" (4:30 PM, "locked")
    {
      "id": "cm2k8q0w1000b08l4e6a7b2cc",
      "name": "Dinner & Dessert",
      "timeLabel": "7:30 PM – 9:00 PM",
      "status": "locked",
      "revealed": false,
      "revealsAt": "2026-10-09T22:30:00.000Z",
      "revealLabel": "6:30 PM",
      "courses": []
      // … same fields as above
    }
  ]
}
```

`tags` are the organisers' own notes from the menu (allergens such as "Contains almonds",
"Vegan", "Tentative"): show them as given, and add no dietary labels of your own.

## `GET /breakouts`

The team breakout sessions, grouped for a board: days → "Team Breakouts" slots of the
schedule → the sessions in them. Parameters: `day`, `track`.

Each session is one team meeting (or several teams meeting together) in one or more rooms.
A session held for both tracks is listed once per track. When a team is split across
rooms, `rooms` lists them all, `split` is true and `note` says so. Show `title` and `teams`
as they are.

```
GET /api/display/breakouts?day=2026-10-09&track=bhaio
```

```jsonc
{
  "generatedAt": "2026-10-09T15:10:00.051Z",
  "now": "2026-10-09T15:10:00.051Z",
  "timeTravel": false,
  "timeZone": "America/New_York",
  "today": "2026-10-09",
  "eventDay": "2026-10-09",
  "day": "2026-10-09",
  "track": "bhaio",
  "days": [
    {
      "day": "2026-10-09",
      "dayLabel": "Day 2",
      "dayTitle": "Fri, Oct 9",
      "slots": [
        {
          "id": "cm2k8q0v1000308l4a1b2c3de",
          "scheduleItemId": "cm2k8q0v1000308l4a1b2c3de",
          "day": "2026-10-09",
          "dayLabel": "Day 2",
          "dayTitle": "Fri, Oct 9",
          "startsAt": "2026-10-09T15:00:00.000Z",
          "endsAt": "2026-10-09T16:30:00.000Z",
          "startLabel": "11:00 AM",
          "endLabel": "12:30 PM",
          "timeLabel": "11:00 AM – 12:30 PM",
          "delayMinutes": 0,
          "endDelayMinutes": 0,
          "changeLabel": null,
          "original": null,
          "title": "Team Breakouts",
          "location": "By team – see Breakout Sessions",
          "audience": "ALL",
          "tracks": ["bhaio", "behno"],
          "status": "now",
          "sessions": [
            {
              "id": "bk-bhaio-fri-1100-bm-ra",
              "day": "2026-10-09",
              "dayLabel": "Day 2",
              "dayTitle": "Fri, Oct 9",
              "startsAt": "2026-10-09T15:00:00.000Z",
              "endsAt": "2026-10-09T15:30:00.000Z",
              "startLabel": "11:00 AM",
              "endLabel": "11:30 AM",
              "timeLabel": "11:00 AM – 11:30 AM",
              "delayMinutes": 0,
              "endDelayMinutes": 0,
              "changeLabel": null,
              "original": null,
              "audience": "BHAIO",
              "tracks": ["bhaio"],
              "title": "BM RA",
              "teams": ["BM RA"],
              "rooms": ["Niyam"],
              "room": "Niyam",
              "note": null,
              "split": false,
              "status": "now"
            },
            // … the other sessions from 11:00 AM ("now")
            {
              "id": "bk-bhaio-fri-1130-bm-ra",
              "title": "BKY RAs",
              "teams": ["BM RA", "KM RA", "YM RA"],
              "rooms": ["Main Hall"],
              "room": "Main Hall",
              "timeLabel": "11:30 AM – 12:00 PM",
              "status": "next"
              // … same fields as above
            }
            // …
          ]
        },
        {
          "id": "cm2k8q0v1000608l4f0e9d8cb",
          "title": "Team Breakouts",
          "timeLabel": "3:00 PM – 4:30 PM",
          "audience": "BHAIO",
          "tracks": ["bhaio"],
          "status": "next",             // the next Bhaio slot, although its sessions are not next yet
          "sessions": [
            // … the sessions from 3:00 PM ("upcoming")
            {
              "id": "bk-bhaio-fri-1545-bm-ndc",
              "title": "BM NDC",
              "teams": ["BM NDC"],
              "rooms": ["Divyabhav", "Mezzanine Ladies Office 1"],
              "room": "Divyabhav · Mezzanine Ladies Office 1",
              "note": "Split amongst these rooms.",
              "split": true,
              "timeLabel": "3:45 PM – 4:30 PM",
              "status": "upcoming"
              // …
            }
            // …
          ]
          // … same fields as the first slot
        }
      ]
    }
  ]
}
```

Session `id`s stay the same while the organisers keep a session's track, day, start and
teams. A slot's `id` is the schedule item's; if a session falls outside every "Team
Breakouts" block, it is still listed, under a slot with `"scheduleItemId": null` and an `id`
such as `"unscheduled-2026-10-10-behno"`.

## `GET /now`

A compact snapshot for a "Now / Next" screen: for each track, what is on and what comes
next in the programme and in the breakouts, and the delegate meal on now and next. No
parameters besides the key (and `now` on a test deployment).

```
GET /api/display/now
```

```jsonc
{
  "generatedAt": "2026-10-09T15:40:02.117Z",
  "now": "2026-10-09T15:40:02.117Z",
  "timeTravel": false,
  "timeZone": "America/New_York",
  "today": "2026-10-09",
  "eventDay": "2026-10-09",
  "dayLabel": "Day 2",                       // null outside the event days
  "tracks": {
    "bhaio": {
      "schedule": {
        "now": [ { "title": "Team Breakouts", "timeLabel": "11:00 AM – 12:30 PM", "status": "now" /* … a /schedule item */ } ],
        "next": { "title": "Delegate Lunch/Break", "timeLabel": "12:30 PM – 2:00 PM", "status": "next" /* … */ }
      },
      "breakouts": {
        "now": [ { "title": "BKY RAs", "teams": ["BM RA", "KM RA", "YM RA"], "room": "Main Hall", "status": "now" /* … a /breakouts session */ } /* , … every session in progress */ ],
        "next": [ { "title": "BKY RCTLs", "room": "Mezzanine", "startLabel": "12:00 PM", "status": "next" /* … */ } /* , … every session at 12:00 PM */ ]
      }
    },
    "behno": {
      "schedule": { "now": [ /* … */ ], "next": { /* … */ } },
      "breakouts": { "now": [ /* … */ ], "next": [ /* … */ ] }
    }
  },
  "meal": {
    "now": null,
    "next": { "name": "Delegate Lunch", "timeLabel": "12:30 PM – 2:00 PM", "status": "revealed", "courses": [ /* … */ ] /* … a /menu meal */ }
  }
}
```

- `schedule.now` is a list (usually one item; several when items overlap). `schedule.next`
  is the next item to start, even while something is on, or `null` after the last one.
- `breakouts.next` lists every session at the track's next breakout start time, which may be
  on a later day; empty after the last session.
- `meal.next` has dishes only once revealed (`"revealed": true`).
- After the event everything is empty or `null`.

## Example

```js
const BASE = "https://naam-five.vercel.app/api/display";
const KEY = loadKeyFromDeviceConfig(); // never hard-code it in a public repo

async function poll() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(`${BASE}/now`, {
      headers: { Authorization: `Bearer ${KEY}` },
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (res.status === 401) return showKeyNeeded();
    if (!res.ok) return; // keep the last good screen
    render(await res.json());
  } catch {
    // offline or timed out: keep the last good screen
  } finally {
    clearTimeout(timer);
  }
}

poll();
setInterval(poll, 30_000 + Math.random() * 5_000);
```

## Stability

The fields above won't be renamed or removed during the event. New fields may be added, so
ignore fields you don't use. Questions or a new key: ask the Hospitality Hub team.
