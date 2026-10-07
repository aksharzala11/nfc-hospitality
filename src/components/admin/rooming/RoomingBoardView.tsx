"use client";

import { useDeferredValue, useId, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { BedSingle, Clock, Hotel, Info, MoonStar, Search, TriangleAlert, UserRoundX, X } from "lucide-react";
import type { HotelLiaisonView } from "@/lib/hotelLiaisons";
import type { RoomingBoardHotel, RoomingBoardOccupant, RoomingBoardRoom, Stay } from "@/lib/rooming";
import { CHIP, CHIP_OFF, CHIP_ON, INPUT, chipCount } from "@/components/admin/delegates/ui";
import { BADGE, FOCUS, TRACK_CHIP } from "@/components/admin/shell/ui";
import { directoryHref, people as peopleText, plural } from "@/components/admin/transport/board";
import {
  occupantNotes,
  roomAnchor,
  roomNotes,
  sinceWednesday,
  sizeBreakdown,
  statusKind,
  type Keep,
  type Note,
} from "./board";

/**
 * Search text: `text` / `compact` for words and long numbers (substring),
 * `ids` (User Ids, BAPS IDs, folded) and `roomNumber` for short numbers, which
 * only ever match exactly (so "12" finds room group 12, not every ID with a 12 in it).
 */
type Haystack = { text: string; compact: string; ids: string[]; roomNumber: number };
type OccupantRow = { occupant: RoomingBoardOccupant; notes: Note[]; since: boolean; haystack: Haystack };
type RoomView = {
  room: RoomingBoardRoom;
  notes: Note[];
  rows: OccupantRow[];
  /** Any note on the room or its occupants, "Not in the app" included. */
  hasNotes: boolean;
  /** The room's own search text (hotel, room number, held User Ids), for a room nobody in it matches. */
  haystack: Haystack;
};
type HotelView = { hotel: RoomingBoardHotel; rooms: RoomView[] };

/**
 * The board itself: per hotel (its totals in the heading), the room groups by
 * number as cards: size and open beds, the track(s), the room's notes, then
 * each occupant by bed with name (to their directory entry), BAPS ID, seva
 * (a coral pill when it matches the console's seva filter), registration
 * status when it isn't Registered and where they are in the other stay; then
 * the beds held by a User Id the import skipped, and the open beds. Each
 * hotel's heading also lists its Hotel Liaison(s) by track (what its guests
 * see on /stay), and says when guests of a track listed there have none.
 *
 * The search box and the "Open beds" / "With notes" chips narrow what's
 * listed in the browser (a room shows whole when anyone in it matches); the
 * stay, hotel and seva filter are the page's (URL) and arrive as `hotels`.
 * A room group number ("12", "room group 12", "Hilton 12") matches exactly.
 * Read-only, and everything in the props is plain data.
 */
export function RoomingBoardView({
  hotels,
  liaisons = [],
  stay,
  sevaFiltered,
  keep,
}: {
  hotels: RoomingBoardHotel[];
  /** Every hotel's liaisons (getHotelLiaisons()); each hotel's heading shows its own. */
  liaisons?: HotelLiaisonView[];
  stay: Stay;
  /** The console seva filter is on: highlight the matching occupants' seva. */
  sevaFiltered: boolean;
  /** Params the directory links keep (?now= while time-travelling, the seva filter). */
  keep: Keep;
}) {
  const [query, setQuery] = useState("");
  const [openOnly, setOpenOnly] = useState(false);
  const [notesOnly, setNotesOnly] = useState(false);
  const deferredQuery = useDeferredValue(query);

  // Notes and search text once per board.
  const board = useMemo(() => buildView(hotels, stay), [hotels, stay]);
  const openTotal = useMemo(() => countRooms(board, (r) => r.room.openBeds > 0), [board]);
  const notesTotal = useMemo(() => countRooms(board, (r) => r.hasNotes), [board]);

  const tokens = useMemo(() => searchTokens(deferredQuery), [deferredQuery]);
  const filtering = tokens.length > 0 || openOnly || notesOnly;
  const shown = useMemo(
    () =>
      filtering
        ? filterView(
            board,
            (r) =>
              (!openOnly || r.room.openBeds > 0) &&
              (!notesOnly || r.hasNotes) &&
              (tokens.length === 0 ||
                r.rows.some((row) => matches(row.haystack, tokens)) ||
                matches(r.haystack, tokens)),
          )
        : board,
    [board, filtering, openOnly, notesOnly, tokens],
  );
  const shownRooms = filtering ? countRooms(shown, () => true) : 0;
  const status = !filtering
    ? ""
    : shownRooms === 0
      ? "No room group matches."
      : `Showing ${plural(shownRooms, "room group")}.`;

  function showAll() {
    setQuery("");
    setOpenOnly(false);
    setNotesOnly(false);
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 basis-60">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400"
            />
            <input
              type="search"
              inputMode="search"
              enterKeyHint="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.preventDefault();
                if (e.key === "Escape" && query) {
                  e.preventDefault();
                  setQuery("");
                }
              }}
              placeholder="Name, BAPS ID, User Id or room group"
              aria-label="Search the room groups"
              maxLength={80}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              className={`${INPUT} pl-10 [&::-webkit-search-cancel-button]:appearance-none`}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <ToggleChip
              on={openOnly}
              onToggle={() => setOpenOnly((v) => !v)}
              count={openTotal}
              icon={<BedSingle aria-hidden="true" className={`mr-1 h-3.5 w-3.5 ${openOnly ? "text-coral-300" : "text-ink-500"}`} />}
            >
              Open beds
            </ToggleChip>
            <ToggleChip
              on={notesOnly}
              onToggle={() => setNotesOnly((v) => !v)}
              count={notesTotal}
              icon={
                <TriangleAlert aria-hidden="true" className={`mr-1 h-3.5 w-3.5 ${notesOnly ? "text-coral-300" : "text-coral-700"}`} />
              }
            >
              With notes
            </ToggleChip>
          </div>
        </div>
        <p aria-live="polite" className={`px-1 text-xs text-ink-600 ${status ? "" : "sr-only"}`}>
          {status}
        </p>
      </div>

      {filtering && shownRooms === 0 ? (
        <div className="card px-6 py-8 text-center">
          <span className="mx-auto mb-2.5 flex h-11 w-11 items-center justify-center rounded-2xl bg-sand-200 text-ink-500">
            <Search aria-hidden="true" className="h-5 w-5" />
          </span>
          <p className="text-sm font-semibold text-ink-900">No room group matches</p>
          <p className="mx-auto mt-0.5 max-w-xs text-xs leading-snug text-ink-600">
            {tokens.length > 0
              ? "Try a name, a BAPS ID, a User Id or a room group number."
              : "No room group here has that."}
          </p>
          <button
            type="button"
            onClick={showAll}
            className={`mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-2xl border border-ink-800/12 bg-white/85 px-4 text-sm font-semibold text-ink-900 shadow-card transition hover:bg-white ${FOCUS}`}
          >
            <X aria-hidden="true" className="h-4 w-4" />
            Show every room group
          </button>
        </div>
      ) : (
        shown.map((h) => (
          <HotelSection
            key={h.hotel.key}
            view={h}
            liaisons={liaisons.filter((l) => l.hotel === h.hotel.key)}
            stay={stay}
            sevaFiltered={sevaFiltered}
            keep={keep}
          />
        ))
      )}
    </div>
  );
}

function ToggleChip({
  on,
  onToggle,
  count,
  icon,
  children,
}: {
  on: boolean;
  onToggle: () => void;
  count: number;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      disabled={!on && count === 0}
      className={`${CHIP} ${on ? CHIP_ON : CHIP_OFF} inline-flex items-center disabled:opacity-50`}
    >
      {icon}
      {children}
      <span className={chipCount(on)}>
        {count}
        <span className="sr-only"> {count === 1 ? "room group" : "room groups"}</span>
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function HotelSection({
  view,
  liaisons,
  stay,
  sevaFiltered,
  keep,
}: {
  view: HotelView;
  liaisons: HotelLiaisonView[];
  stay: Stay;
  sevaFiltered: boolean;
  keep: Keep;
}) {
  const id = useId();
  const { hotel } = view;
  const { info } = hotel;
  const counts = [
    plural(hotel.rooms.length, "room group"),
    plural(hotel.capacity, "bed"),
    hotel.openBeds > 0 ? `${hotel.openBeds} open` : "none open",
    hotel.mixedRooms > 0 ? plural(hotel.mixedRooms, "mixed room") : null,
  ].filter(Boolean);
  const times = [
    info.checkInTime ? `Check-in ${info.checkInTime}` : null,
    info.checkOutTime ? `check-out ${info.checkOutTime}` : null,
  ].filter(Boolean);

  return (
    <section aria-labelledby={id} className="space-y-3">
      <header className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-jade-500 to-ink-800 text-white shadow-card"
        >
          <Hotel className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h2 id={id} className="font-display text-2xl leading-none text-ink-900">
              {hotel.name}
            </h2>
            <span className="text-sm font-bold tabular-nums text-ink-900">{peopleText(hotel.people)}</span>
          </div>
          <p className="mt-1 text-xs leading-snug text-ink-600">{counts.join(" · ")}</p>
          <p className="text-xs leading-snug text-ink-600">{sizeBreakdown(hotel.rooms)}</p>
          {(info.fullName || info.address || info.phone || times.length > 0) && (
            <p className="mt-1 text-xs leading-snug text-ink-700">
              {[info.fullName, info.address, times.join(", ") || null].filter(Boolean).join(" · ")}
              {info.phone && (
                <>
                  {" · "}
                  <a href={`tel:${info.phone}`} className={`rounded font-semibold underline underline-offset-2 ${FOCUS}`}>
                    {info.phone}
                  </a>
                </>
              )}
            </p>
          )}
          <HotelLiaisons liaisons={liaisons} rooms={hotel.rooms} />
        </div>
      </header>

      <div className="grid items-start gap-3 md:grid-cols-2 lg:grid-cols-3">
        {view.rooms.map((r) => (
          <RoomCard key={r.room.roomKey} view={r} stay={stay} sevaFiltered={sevaFiltered} keep={keep} />
        ))}
      </div>
    </section>
  );
}

/**
 * The hotel's liaisons, one line each: track, name and phone (tap to call), as
 * set with `npm run hotel:liaisons`. When guests of a track are listed here
 * (under the current filters) but no liaison covers that track, a coral line
 * says they see none; guests with no gender on file see every liaison of the
 * hotel, so they miss out only when it has none.
 */
function HotelLiaisons({ liaisons, rooms }: { liaisons: HotelLiaisonView[]; rooms: RoomingBoardRoom[] }) {
  const present = (["BHAIO", "BEHNO"] as const).filter((t) => rooms.some((r) => (t === "BHAIO" ? r.bhaio : r.behno) > 0));
  const uncovered = present.filter((t) => !liaisons.some((l) => l.audience === "ALL" || l.audience === t));
  const guests = present.length > 0 || rooms.some((r) => r.noTrack > 0);
  const missing =
    liaisons.length === 0
      ? guests
        ? "No Hotel Liaison yet: guests here see none."
        : null
      : uncovered.length > 0
        ? `No ${uncovered.map((t) => TRACK_CHIP[t].label).join(" or ")} liaison yet: ${uncovered.map((t) => TRACK_CHIP[t].label).join(" and ")} guests here see none.`
        : null;
  if (liaisons.length === 0 && !missing) return null;
  return (
    <div className="mt-1.5 space-y-1">
      {liaisons.map((l) => (
        <p key={l.id} className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs leading-snug text-ink-700">
          <span className="font-semibold text-ink-900">Hotel Liaison</span>
          <span className={`${BADGE} ${TRACK_CHIP[l.audience].tone}`}>{TRACK_CHIP[l.audience].label}</span>
          <span className="break-words">{l.name}</span>
          <span aria-hidden="true">·</span>
          <a
            href={l.telHref}
            className={`rounded font-semibold tabular-nums text-ink-900 underline underline-offset-2 ${FOCUS}`}
          >
            {l.phoneDisplay}
          </a>
        </p>
      ))}
      {missing && <p className="text-xs font-semibold leading-snug text-coral-800">{missing}</p>}
    </div>
  );
}

function RoomCard({
  view,
  stay,
  sevaFiltered,
  keep,
}: {
  view: RoomView;
  stay: Stay;
  sevaFiltered: boolean;
  keep: Keep;
}) {
  const id = useId();
  const { room, rows, notes } = view;
  const tracks = (["BHAIO", "BEHNO"] as const).filter((t) => (t === "BHAIO" ? room.bhaio : room.behno) > 0);
  const size = [
    plural(room.capacity, "bed"),
    room.openBeds > 0 ? `${room.openBeds} open` : null,
    room.heldBeds > 0 ? `${room.heldBeds} held` : null,
  ].filter(Boolean);

  return (
    // An article, not a section: 140-odd cards would flood the page's landmarks.
    <article id={roomAnchor(room.roomKey)} aria-labelledby={id} className="card scroll-mt-4 overflow-hidden">
      <header className="flex items-start justify-between gap-3 px-4 pb-2.5 pt-3.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 id={id} className="font-display text-xl leading-tight text-ink-900">
              {room.label}
            </h3>
            {tracks.map((t) => (
              <span key={t} className={`${BADGE} ${TRACK_CHIP[t].tone}`}>
                {TRACK_CHIP[t].label}
              </span>
            ))}
          </div>
          <p className="mt-0.5 text-xs text-ink-600">{size.join(" · ")}</p>
        </div>
        <BedMeter filled={room.occupants.length} held={room.heldBeds} open={room.openBeds} />
      </header>

      {notes.length > 0 && (
        <ul aria-label="Notes on this room group" className="flex flex-wrap gap-1.5 px-4 pb-2.5">
          {notes.map((n) => (
            <li key={n.text}>
              <NotePill note={n} />
            </li>
          ))}
        </ul>
      )}

      <ul className="divide-y divide-ink-800/8 border-t border-ink-800/8 px-4">
        {rows.map((r) => (
          <OccupantItem
            key={r.occupant.assignmentId}
            row={r}
            showTrack={room.mixedTrack}
            sevaFiltered={sevaFiltered}
            keep={keep}
          />
        ))}
        {Array.from({ length: room.heldBeds }, (_, i) => {
          const heldBy = room.heldRegistrationIds[i];
          return (
            <li key={`held-${i}`} className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-center gap-x-3 py-2.5">
              <span
                aria-hidden="true"
                className="flex h-7 w-7 items-center justify-center rounded-full bg-coral-100 text-coral-800"
              >
                <TriangleAlert className="h-3.5 w-3.5" />
              </span>
              <p className="text-xs font-semibold leading-snug text-coral-800">
                {heldBy ? (
                  <>
                    Held for <span className="tabular-nums">User Id {heldBy}</span>, who is on more than one row of the
                    sheet (not placed)
                  </>
                ) : (
                  "Held: the sheet gives this bed to a User Id that is on more than one row (not placed)"
                )}
              </p>
            </li>
          );
        })}
        {Array.from({ length: room.openBeds }, (_, i) => (
          <li key={`open-${i}`} className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-center gap-x-3 py-2.5">
            <span
              aria-hidden="true"
              className="flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-ink-500 text-ink-500"
            >
              <BedSingle className="h-3.5 w-3.5" />
            </span>
            <p className="text-sm font-semibold text-ink-700">Open bed</p>
          </li>
        ))}
      </ul>
    </article>
  );
}

/** Decorative: one dot per bed (filled, held in coral, open dashed); the text beside it says the same. */
function BedMeter({ filled, held, open }: { filled: number; held: number; open: number }) {
  const dots = [
    ...Array.from({ length: filled }, () => "bg-ink-800"),
    ...Array.from({ length: held }, () => "bg-coral-500"),
    ...Array.from({ length: open }, () => "border border-dashed border-ink-500"),
  ];
  return (
    <span aria-hidden="true" className="mt-1.5 flex max-w-[4.5rem] shrink-0 flex-wrap justify-end gap-1">
      {dots.map((tone, i) => (
        <span key={i} className={`h-2.5 w-2.5 rounded-full ${tone}`} />
      ))}
    </span>
  );
}

function OccupantItem({
  row,
  showTrack,
  sevaFiltered,
  keep,
}: {
  row: OccupantRow;
  /** The room mixes the tracks: say each person's. */
  showTrack: boolean;
  sevaFiltered: boolean;
  keep: Keep;
}) {
  const o = row.occupant;
  const inApp = o.userId !== null;
  // Registered (the usual) shows nothing; "Pending …" a quiet pill; anything else is a warn note (row.notes).
  const pending = statusKind(o.status) === "pending" ? o.status!.trim() : null;
  const highlightSeva = sevaFiltered && o.inFilter && o.seva;

  return (
    <li className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-start gap-x-3 py-2.5">
      <span className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-sand-200 text-xs font-bold tabular-nums text-ink-800">
        {o.bed !== null ? (
          <>
            <span className="sr-only">Bed </span>
            {o.bed}
          </>
        ) : (
          <>
            <span aria-hidden="true">–</span>
            <span className="sr-only">No bed number</span>
          </>
        )}
      </span>

      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {o.name && o.bapsId ? (
            <Link
              href={directoryHref(o.bapsId, keep)}
              className={`break-words rounded font-semibold leading-snug text-ink-900 underline-offset-2 hover:underline ${FOCUS}`}
            >
              {o.name}
            </Link>
          ) : (
            <span className={`break-words font-semibold leading-snug ${o.name ? "text-ink-900" : "text-ink-700"}`}>
              {o.name ?? "Not in the app yet"}
            </span>
          )}
          {showTrack && o.track && (
            <span className={`${BADGE} ${TRACK_CHIP[o.track].tone}`}>{TRACK_CHIP[o.track].label}</span>
          )}
          {!inApp && (
            <span className={`${BADGE} inline-flex items-center gap-1 bg-ink-800/8 text-ink-700`}>
              <UserRoundX aria-hidden="true" className="h-3 w-3" />
              Not in the app
            </span>
          )}
        </p>

        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-ink-600">
          {inApp && (
            <>
              <span className="tabular-nums">{o.bapsId ?? "No BAPS ID"}</span>
              <span aria-hidden="true">·</span>
              {highlightSeva ? (
                <span className="rounded-full border border-coral-300 bg-coral-50 px-1.5 font-semibold text-coral-800">
                  {o.seva}
                  <span className="sr-only"> (matches the seva filter)</span>
                </span>
              ) : (
                <span>{o.seva ?? "No seva"}</span>
              )}
              <span aria-hidden="true">·</span>
            </>
          )}
          <span className="tabular-nums">User Id {o.registrationId}</span>
        </p>

        {(pending || row.since || row.notes.length > 0) && (
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {row.notes.map((n) => (
              <li key={n.text}>
                <NotePill note={n} />
              </li>
            ))}
            {pending && (
              <li>
                <Pill tone="info" icon={<Clock aria-hidden="true" className="h-3 w-3 shrink-0" />}>
                  {pending}
                </Pill>
              </li>
            )}
            {row.since && (
              <li>
                <Pill tone="info" icon={<MoonStar aria-hidden="true" className="h-3 w-3 shrink-0" />}>
                  Here since Wed night
                </Pill>
              </li>
            )}
          </ul>
        )}
      </div>
    </li>
  );
}

const PILL_TONE = {
  info: "bg-ink-800/8 text-ink-700",
  warn: "bg-coral-100 text-coral-800",
} as const;

/** A small status / note pill, AA at 11px on every tone. */
function Pill({ tone, icon, children }: { tone: keyof typeof PILL_TONE; icon: ReactNode; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-snug ${PILL_TONE[tone]}`}
    >
      {icon}
      {children}
    </span>
  );
}

function NotePill({ note }: { note: Note }) {
  return note.tone === "warn" ? (
    <Pill tone="warn" icon={<TriangleAlert aria-hidden="true" className="h-3 w-3 shrink-0" />}>
      {note.text}
    </Pill>
  ) : (
    <Pill tone="info" icon={<Info aria-hidden="true" className="h-3 w-3 shrink-0" />}>
      {note.text}
    </Pill>
  );
}

// ---------------------------------------------------------------------------
// View model and search
// ---------------------------------------------------------------------------

/** Lower case without accents. */
function fold(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
/** Letters and digits only, so "bk 1234" finds "BK1234". */
const squash = (value: string) => fold(value).replace(/[^a-z0-9]/g, "");

function haystackOf(
  fields: readonly (string | null | undefined)[],
  ids: readonly (string | null | undefined)[],
  roomNumber: number,
): Haystack {
  const present = fields.filter((f): f is string => Boolean(f));
  return {
    text: present.map(fold).join(" | "),
    compact: present.map(squash).join("|"),
    ids: ids.filter((id): id is string => Boolean(id)).map(squash),
    roomNumber,
  };
}

/** Words that only say "a room group" ("room group 12", "room #12", "no. 12"): dropped, leaving the number. */
const ROOM_WORDS = new Set(["room", "rooms", "group", "groups", "no", "no.", "#"]);

/**
 * The query's words (at most eight), folded, with the room-group words dropped
 * and a number written onto them unwrapped ("#12", "roomgroup12" -> "12").
 */
function searchTokens(query: string): string[] {
  return fold(query)
    .split(/\s+/)
    .filter((t) => t && !ROOM_WORDS.has(t))
    .map((t) => t.match(/^(?:room)?(?:group)?(?:no\.?)?#?(\d+)$/)?.[1] ?? t)
    .slice(0, 8);
}

/**
 * Every word of the query is in one of the fields. A number of one to three
 * digits is a room group number or a whole ID (exact); longer numbers and
 * words match anywhere, so "1234" still finds User Id 12345.
 */
function matches(h: Haystack, tokens: readonly string[]): boolean {
  return tokens.every((t) => {
    if (/^\d{1,3}$/.test(t)) return h.roomNumber === Number(t) || h.ids.includes(t);
    if (h.text.includes(t)) return true;
    const s = squash(t);
    return s.length > 0 && h.compact.includes(s);
  });
}

function buildView(hotels: readonly RoomingBoardHotel[], stay: Stay): HotelView[] {
  return hotels.map((hotel) => ({
    hotel,
    rooms: hotel.rooms.map((room) => {
      // The hotel name and room number go into each occupant's search too, so "hilton patel" and
      // "patel 12" find them; the "Room group" label doesn't (every room has those words).
      const rows: OccupantRow[] = room.occupants.map((occupant) => ({
        occupant,
        notes: occupantNotes(occupant, stay),
        since: sinceWednesday(occupant, stay),
        haystack: haystackOf(
          [occupant.name, occupant.bapsId, occupant.registrationId, occupant.seva, occupant.status, hotel.name],
          [occupant.registrationId, occupant.bapsId],
          room.roomNumber,
        ),
      }));
      const notes = roomNotes(room);
      const held = [...new Set(room.heldRegistrationIds)];
      return {
        room,
        notes,
        rows,
        hasNotes: notes.length > 0 || rows.some((r) => r.notes.length > 0 || r.occupant.userId === null),
        haystack: haystackOf([hotel.name, ...held], held, room.roomNumber),
      };
    }),
  }));
}

/** The view with only the room groups `keep` accepts; hotels left empty drop out. */
function filterView(view: readonly HotelView[], keep: (r: RoomView) => boolean): HotelView[] {
  const out: HotelView[] = [];
  for (const h of view) {
    const rooms = h.rooms.filter(keep);
    if (rooms.length > 0) out.push({ ...h, rooms });
  }
  return out;
}

function countRooms(view: readonly HotelView[], test: (r: RoomView) => boolean): number {
  let n = 0;
  for (const h of view) for (const r of h.rooms) if (test(r)) n++;
  return n;
}
