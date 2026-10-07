"use client";

import { useDeferredValue, useId, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  CarFront,
  ChevronDown,
  Phone,
  Plane,
  PlaneLanding,
  PlaneTakeoff,
  Search,
  TriangleAlert,
  UserRoundX,
  X,
} from "lucide-react";
import type {
  TransportBoardAirport,
  TransportBoardDay,
  TransportBoardDriver,
  TransportBoardGroup,
  TransportBoardPerson,
  TransportDirection,
} from "@/lib/transport";
import { formatPhone } from "@/components/admin/delegates/directory";
import { CHIP, CHIP_OFF, CHIP_ON, INPUT, chipCount } from "@/components/admin/delegates/ui";
import { BADGE, FOCUS, LABEL } from "@/components/admin/shell/ui";
import {
  WORDS,
  airportBuckets,
  airportWarning,
  dayWarning,
  directoryHref,
  isFlagged,
  people as peopleText,
  personWarnings,
  plural,
  type PersonPlace,
} from "./board";

type Keep = { now: string | null; sevas: string[] };

/** A person as listed: the board's row plus their own warnings. */
type Row = { person: TransportBoardPerson; warnings: string[]; flagged: boolean; haystack: Haystack };
type ViewGroup = { group: TransportBoardGroup; rows: Row[] };
type ViewAirport = {
  key: string;
  airport: TransportBoardAirport;
  warning: string | null;
  groups: ViewGroup[];
  notGrouped: Row[];
  noService: Row[];
};
type ViewDay = { key: string; day: TransportBoardDay; warning: string | null; airports: ViewAirport[] };

/**
 * The board itself: per day (headed when several are shown) and airport, the
 * transport team's numbered groups with their driver, then "Not grouped yet"
 * and a folded "No pickup needed". Each person: time (local to the airport, as
 * the sheet gives it), name (to their directory entry), BAPS ID, seva, flight,
 * phone with a call button, their driver when it isn't the group's, and small
 * coral warnings for the sheet's oddities (never fixed here).
 *
 * The search box and "Flagged" chip narrow what's listed in the browser; the
 * direction, day and seva filter are the page's (URL) and arrive as `days`.
 * Everything in the props is plain data.
 */
export function TransportBoardView({
  direction,
  days,
  byDay,
  keep,
}: {
  direction: TransportDirection;
  /** The day(s) picked, in order. */
  days: TransportBoardDay[];
  /** Several days: head each one. */
  byDay: boolean;
  /** Params the directory links keep (?now= while time-travelling, the seva filter). */
  keep: Keep;
}) {
  const [query, setQuery] = useState("");
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const deferredQuery = useDeferredValue(query);
  const words = WORDS[direction];

  // Warnings and search text once per board.
  const board = useMemo(() => buildView(days, direction), [days, direction]);
  const flaggedTotal = useMemo(() => countRows(board, (r) => r.flagged), [board]);

  const tokens = useMemo(() => searchTokens(deferredQuery), [deferredQuery]);
  const filtering = tokens.length > 0 || flaggedOnly;
  const shown = useMemo(
    () => (filtering ? filterView(board, (r) => (!flaggedOnly || r.flagged) && matches(r.haystack, tokens)) : board),
    [board, filtering, flaggedOnly, tokens],
  );
  const shownCount = filtering ? countRows(shown, () => true) : 0;

  const status = !filtering ? "" : shownCount === 0 ? "No one matches." : `Showing ${peopleText(shownCount)}.`;

  return (
    <div className={byDay ? "space-y-10" : "space-y-6"}>
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
              placeholder="Name, BAPS ID, flight or phone"
              aria-label={`Search ${words.people}`}
              maxLength={80}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              className={`${INPUT} pl-10 [&::-webkit-search-cancel-button]:appearance-none`}
            />
          </div>
          <button
            type="button"
            aria-pressed={flaggedOnly}
            onClick={() => setFlaggedOnly((v) => !v)}
            disabled={!flaggedOnly && flaggedTotal === 0}
            className={`${CHIP} ${flaggedOnly ? CHIP_ON : CHIP_OFF} inline-flex items-center disabled:opacity-50`}
          >
            <TriangleAlert
              aria-hidden="true"
              className={`mr-1 h-3.5 w-3.5 ${flaggedOnly ? "text-coral-300" : "text-coral-700"}`}
            />
            Flagged only
            <span className={chipCount(flaggedOnly)}>
              {flaggedTotal}
              <span className="sr-only"> {flaggedTotal === 1 ? "person" : "people"}</span>
            </span>
          </button>
        </div>
        <p aria-live="polite" className={`px-1 text-xs text-ink-600 ${status ? "" : "sr-only"}`}>
          {status}
        </p>
      </div>

      {filtering && shownCount === 0 ? (
        <div className="card px-6 py-8 text-center">
          <span className="mx-auto mb-2.5 flex h-11 w-11 items-center justify-center rounded-2xl bg-sand-200 text-ink-500">
            <Search aria-hidden="true" className="h-5 w-5" />
          </span>
          <p className="text-sm font-semibold text-ink-900">No one matches</p>
          <p className="mx-auto mt-0.5 max-w-xs text-xs leading-snug text-ink-600">
            {tokens.length > 0 ? "Try a name, a BAPS ID, a flight number or part of a phone number." : "Nobody here is flagged."}
          </p>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setFlaggedOnly(false);
            }}
            className={`mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-2xl border border-ink-800/12 bg-white/85 px-4 text-sm font-semibold text-ink-900 shadow-card transition hover:bg-white ${FOCUS}`}
          >
            <X aria-hidden="true" className="h-4 w-4" />
            Show everyone
          </button>
        </div>
      ) : (
        shown.map((d) =>
          byDay ? (
            <DaySection key={d.key} view={d} direction={direction} keep={keep} expandAll={filtering} />
          ) : (
            <div key={d.key} className="space-y-8">
              {d.warning && <Warning>{d.warning}</Warning>}
              {d.airports.map((a) => (
                <AirportSection
                  key={a.key}
                  view={a}
                  day={d.day.day}
                  direction={direction}
                  keep={keep}
                  level={2}
                  expandAll={filtering}
                />
              ))}
            </div>
          ),
        )
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function DaySection({
  view,
  direction,
  keep,
  expandAll,
}: {
  view: ViewDay;
  direction: TransportDirection;
  keep: Keep;
  expandAll: boolean;
}) {
  const id = useId();
  const { day } = view;
  return (
    <section aria-labelledby={id} className="space-y-5">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-ink-800/10 pb-2">
        <h2 id={id} className="font-display text-[1.75rem] leading-tight text-ink-900">
          {day.label}
        </h2>
        <p className="text-xs text-ink-600">
          <span className="font-bold tabular-nums text-ink-900">{peopleText(day.people)}</span>
          {" · "}
          {day.needsService} {WORDS[direction].needService.toLowerCase()}
        </p>
      </header>
      {view.warning && <Warning>{view.warning}</Warning>}
      <div className="space-y-8">
        {view.airports.map((a) => (
          <AirportSection
            key={a.key}
            view={a}
            day={day.day}
            direction={direction}
            keep={keep}
            level={3}
            expandAll={expandAll}
          />
        ))}
      </div>
    </section>
  );
}

function AirportSection({
  view,
  day,
  direction,
  keep,
  level,
  expandAll,
}: {
  view: ViewAirport;
  day: string | null;
  direction: TransportDirection;
  keep: Keep;
  /** Heading level of the airport (its groups go one deeper). */
  level: 2 | 3;
  expandAll: boolean;
}) {
  const id = useId();
  const { airport } = view;
  const words = WORDS[direction];
  const Heading = level === 2 ? "h2" : "h3";
  const Icon = airport.code ? (direction === "ARRIVAL" ? PlaneLanding : PlaneTakeoff) : CarFront;
  const groupCount = view.groups.length;
  const counts = [
    `${airport.needsService} ${words.needService.toLowerCase()}`,
    groupCount > 0 ? plural(groupCount, "group") : null,
    view.notGrouped.length > 0 ? `${view.notGrouped.length} not grouped yet` : null,
  ].filter(Boolean);

  return (
    <section aria-labelledby={id} className="space-y-3">
      <header className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-jade-500 to-ink-800 text-white shadow-card"
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <Heading id={id} className="font-display text-2xl leading-none text-ink-900">
              {airport.label}
            </Heading>
            <span className="text-sm font-bold tabular-nums text-ink-900">{peopleText(airport.people)}</span>
          </div>
          <p className="mt-1 truncate text-xs text-ink-600">
            {airport.code ? (airport.name ?? "Airport name not given") : "Driving, or no airport given"}
          </p>
        </div>
      </header>
      <p className="text-xs text-ink-600">{counts.join(" · ")}</p>
      {view.warning && (
        <Warning>
          {view.warning}. Times are local to {airport.label}.
        </Warning>
      )}

      <div className="grid items-start gap-3 md:grid-cols-2">
        {view.groups.map((g) => (
          <GroupCard
            key={g.group.key}
            view={g}
            place={{ direction, day, airportCode: airport.code, grouped: true }}
            keep={keep}
            level={level === 2 ? "h3" : "h4"}
          />
        ))}
        {view.notGrouped.length > 0 && (
          <NotGroupedCard
            rows={view.notGrouped}
            place={{ direction, day, airportCode: airport.code, grouped: false }}
            keep={keep}
            level={level === 2 ? "h3" : "h4"}
            only={groupCount === 0}
          />
        )}
        {view.noService.length > 0 && (
          <NoServiceCard
            rows={view.noService}
            place={{ direction, day, airportCode: airport.code, grouped: false }}
            keep={keep}
            level={level === 2 ? "h3" : "h4"}
            forceOpen={expandAll}
          />
        )}
      </div>
    </section>
  );
}

type HeadingTag = "h3" | "h4";

function GroupCard({ view, place, keep, level: Heading }: { view: ViewGroup; place: PersonPlace; keep: Keep; level: HeadingTag }) {
  const id = useId();
  const { group, rows } = view;
  const listed = group.people.length;
  const times =
    group.firstTimeLabel && group.lastTimeLabel
      ? group.firstTimeLabel === group.lastTimeLabel
        ? group.firstTimeLabel
        : `${group.firstTimeLabel} – ${group.lastTimeLabel}`
      : null;
  return (
    <section aria-labelledby={id} className="card overflow-hidden">
      <header className="flex items-start justify-between gap-3 px-4 pb-2.5 pt-3.5">
        <div className="min-w-0">
          <Heading id={id} className="font-display text-xl leading-tight text-ink-900">
            {group.label}
          </Heading>
          <p className="mt-0.5 text-xs text-ink-600">
            {listed < group.size ? `${listed} of ${peopleText(group.size)}` : peopleText(listed)}
            {times && (
              <>
                {" · "}
                <span className="tabular-nums">{times}</span>
              </>
            )}
          </p>
        </div>
        <span
          aria-hidden="true"
          className="flex h-8 min-w-8 shrink-0 items-center justify-center rounded-full bg-ink-800 px-2 text-sm font-bold tabular-nums text-white"
        >
          {listed}
        </span>
      </header>
      <DriverLine driver={group.driver} conflict={group.driverConflict} />
      <PeopleList rows={rows} place={place} keep={keep} groupDriver={group.driver} />
    </section>
  );
}

/**
 * Coral: a pickup / drop-off is needed (or the sheet doesn't say) and nobody has
 * put them in a group yet. People on none of the team's tabs carry a "Not on
 * the … tabs" warning: they can only get a group once they're added to the sheet.
 */
function NotGroupedCard({
  rows,
  place,
  keep,
  level: Heading,
  only,
}: {
  rows: Row[];
  place: PersonPlace;
  keep: Keep;
  level: HeadingTag;
  /** The airport has no numbered groups at all. */
  only: boolean;
}) {
  const id = useId();
  const words = WORDS[place.direction];
  return (
    <section
      aria-labelledby={id}
      // Not .card: its border is unlayered CSS that a coral border utility couldn't override.
      className="overflow-hidden rounded-3xl border border-coral-300 bg-coral-50/80 shadow-card"
    >
      <header className="flex items-start justify-between gap-3 px-4 pb-2.5 pt-3.5">
        <div className="min-w-0">
          <Heading id={id} className="font-display text-xl leading-tight text-coral-800">
            Not grouped yet
          </Heading>
          <p className="mt-0.5 text-xs text-ink-700">
            {only ? `No ${words.service} groups here yet` : `Need a ${words.service} (or didn't say), no group yet`}
          </p>
        </div>
        <span className="flex h-8 min-w-8 shrink-0 items-center justify-center rounded-full bg-coral-700 px-2 text-sm font-bold tabular-nums text-white">
          {rows.length}
          <span className="sr-only"> {rows.length === 1 ? "person" : "people"}</span>
        </span>
      </header>
      <PeopleList rows={rows} place={place} keep={keep} groupDriver={null} tone="coral" />
    </section>
  );
}

/** Quiet and folded: nothing for the transport team to do. Opens by itself while searching. */
function NoServiceCard({
  rows,
  place,
  keep,
  level: Heading,
  forceOpen,
}: {
  rows: Row[];
  place: PersonPlace;
  keep: Keep;
  level: HeadingTag;
  forceOpen: boolean;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const expanded = open || forceOpen;
  const words = WORDS[place.direction];
  return (
    <section className="overflow-hidden rounded-3xl border border-sand-300/70 bg-sand-50">
      <Heading>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={expanded}
          aria-controls={listId}
          disabled={forceOpen}
          // An inset outline: the card clips anything outside it.
          className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-sand-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-coral-600 disabled:cursor-default disabled:hover:bg-transparent"
        >
          <span className="min-w-0 flex-1">
            <span className="block font-display text-xl leading-tight text-ink-900">{words.noService}</span>
            <span className="mt-0.5 block text-xs font-normal text-ink-600">Driving, or the sheet says No</span>
          </span>
          <span className="flex h-8 min-w-8 shrink-0 items-center justify-center rounded-full bg-sand-200 px-2 text-sm font-bold tabular-nums text-ink-800">
            {rows.length}
            <span className="sr-only"> {rows.length === 1 ? "person" : "people"}</span>
          </span>
          <ChevronDown
            aria-hidden="true"
            className={`h-5 w-5 shrink-0 text-ink-500 transition-transform motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`}
          />
        </button>
      </Heading>
      <div id={listId} hidden={!expanded} className="border-t border-sand-300/70">
        {expanded && <PeopleList rows={rows} place={place} keep={keep} groupDriver={null} />}
      </div>
    </section>
  );
}

function DriverLine({ driver, conflict }: { driver: TransportBoardDriver | null; conflict: boolean }) {
  return (
    <div className="border-y border-ink-800/8 bg-sand-50/80 px-4 py-2.5">
      {driver ? (
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ink-800 text-coral-300"
          >
            <CarFront className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <p className={LABEL}>Driver</p>
            <p className="truncate text-sm font-semibold text-ink-900">{driver.name ?? "Name not given"}</p>
            {driver.phone && <p className="text-xs tabular-nums text-ink-600">{formatPhone(driver.phone)}</p>}
          </div>
          {driver.phone && <CallButton phone={driver.phone} who={`driver ${driver.name ?? ""}`.trim()} />}
        </div>
      ) : (
        <p className="flex min-h-9 items-center gap-2 text-xs text-ink-600">
          <CarFront aria-hidden="true" className="h-4 w-4 text-ink-400" />
          No driver yet
        </p>
      )}
      {conflict && (
        <div className="mt-2">
          <Warning>The sheet names more than one driver for this group</Warning>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

function PeopleList({
  rows,
  place,
  keep,
  groupDriver,
  tone = "plain",
}: {
  rows: Row[];
  place: PersonPlace;
  keep: Keep;
  groupDriver: TransportBoardDriver | null;
  tone?: "plain" | "coral";
}) {
  return (
    <ul className={`divide-y px-4 ${tone === "coral" ? "divide-coral-200 border-t border-coral-200" : "divide-ink-800/8"}`}>
      {rows.map((r) => (
        <PersonRow key={r.person.legId} row={r} place={place} keep={keep} groupDriver={groupDriver} />
      ))}
    </ul>
  );
}

const sameDriver = (a: TransportBoardDriver | null, b: { name: string | null; phone: string | null }) =>
  a !== null && (a.name ?? "").trim().toLowerCase() === (b.name ?? "").trim().toLowerCase() && (a.phone ?? "") === (b.phone ?? "");

function PersonRow({
  row,
  place,
  keep,
  groupDriver,
}: {
  row: Row;
  place: PersonPlace;
  keep: Keep;
  groupDriver: TransportBoardDriver | null;
}) {
  const p = row.person;
  const driving = p.mode === "DRIVING";
  const who = p.name ?? `User Id ${p.registrationId}`;
  const travel = [p.airline, p.flight].filter(Boolean).join(" · ");
  const ownDriver = { name: p.driverName, phone: p.driverPhone };
  const showDriver = Boolean(p.driverName || p.driverPhone) && !sameDriver(groupDriver, ownDriver);
  const meta = p.userId ? [p.bapsId, p.seva].filter(Boolean).join(" · ") : `User Id ${p.registrationId}`;

  return (
    <li className="grid grid-cols-[4.25rem_minmax(0,1fr)_auto] items-start gap-x-3 py-3">
      <p className="pt-0.5 text-sm font-bold tabular-nums text-ink-900">
        {p.timeLabel ?? (
          <>
            <span aria-hidden="true" className="text-ink-500">
              —
            </span>
            <span className="sr-only">No time</span>
          </>
        )}
      </p>

      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {p.name && p.bapsId ? (
            <Link
              href={directoryHref(p.bapsId, keep)}
              className={`break-words font-semibold leading-snug text-ink-900 underline-offset-2 hover:underline ${FOCUS} rounded`}
            >
              {p.name}
            </Link>
          ) : (
            <span className={`break-words font-semibold leading-snug ${p.name ? "text-ink-900" : "text-ink-700"}`}>
              {p.name ?? "Not in the app yet"}
            </span>
          )}
          {!p.userId && (
            <span className={`${BADGE} inline-flex items-center gap-1 bg-ink-800/8 text-ink-700`}>
              <UserRoundX aria-hidden="true" className="h-3 w-3" />
              Not in the app
            </span>
          )}
        </p>
        {meta && <p className="mt-0.5 break-words text-xs text-ink-600">{meta}</p>}
        <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-700">
          {driving ? (
            <>
              <CarFront aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-ink-400" />
              Driving
            </>
          ) : travel ? (
            <>
              <Plane aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-ink-400" />
              <span className="min-w-0 break-words">{travel}</span>
            </>
          ) : p.mode === "FLYING" ? (
            <>
              <Plane aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-ink-400" />
              <span className="text-ink-600">Flight not given</span>
            </>
          ) : null}
        </p>
        {p.phone && <p className="mt-0.5 text-xs tabular-nums text-ink-600">{formatPhone(p.phone)}</p>}
        {showDriver && (
          <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-700">
            <CarFront aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-ink-400" />
            <span className="min-w-0 break-words">
              Driver: {p.driverName ?? "name not given"}
              {p.driverPhone && (
                <>
                  {" · "}
                  <a
                    href={`tel:${p.driverPhone}`}
                    className={`rounded font-semibold tabular-nums text-ink-900 underline underline-offset-2 ${FOCUS}`}
                  >
                    {formatPhone(p.driverPhone)}
                  </a>
                </>
              )}
            </span>
          </p>
        )}
        {row.warnings.length > 0 && (
          <ul aria-label="Check with the transport team" className="mt-1.5 flex flex-wrap gap-1.5">
            {row.warnings.map((w) => (
              <li key={w}>
                <WarningPill>{w}</WarningPill>
              </li>
            ))}
          </ul>
        )}
      </div>

      {p.phone ? <CallButton phone={p.phone} who={who} /> : <span aria-hidden="true" className="w-11" />}
    </li>
  );
}

function CallButton({ phone, who }: { phone: string; who: string }) {
  return (
    <a
      href={`tel:${phone}`}
      aria-label={`Call ${who}, ${formatPhone(phone)}`}
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-ink-800 text-white shadow-card transition hover:bg-ink-900 active:scale-95 motion-reduce:active:scale-100 ${FOCUS}`}
    >
      <Phone aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={2.2} />
    </a>
  );
}

/** A sheet oddity on a person: coral (warning), AA at 11px. */
function WarningPill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-coral-100 px-2 py-0.5 text-[11px] font-semibold leading-snug text-coral-800">
      <TriangleAlert aria-hidden="true" className="h-3 w-3 shrink-0" />
      {children}
    </span>
  );
}

/** A day's, airport's or group's oddity: a coral line. */
function Warning({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-2xl bg-coral-100 px-3 py-2 text-xs font-semibold leading-snug text-coral-800">
      <TriangleAlert aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

// ---------------------------------------------------------------------------
// View model and search
// ---------------------------------------------------------------------------

type Haystack = { text: string; compact: string };

/** Lower case without accents. */
function fold(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
/** Letters and digits only, so "ua1234" finds "UA 1234" and "8484829" finds "(848) 482-9439". */
const squash = (value: string) => fold(value).replace(/[^a-z0-9]/g, "");

function haystackOf(p: TransportBoardPerson): Haystack {
  const fields = [p.name, p.bapsId, p.registrationId, p.seva, p.airline, p.flight, p.phone, p.driverName].filter(
    (f): f is string => Boolean(f),
  );
  return { text: fields.map(fold).join(" | "), compact: fields.map(squash).join("|") };
}

function searchTokens(query: string): string[] {
  return fold(query).split(/\s+/).filter(Boolean).slice(0, 8);
}

/** Every word of the query is in one of the person's fields. */
function matches(h: Haystack, tokens: readonly string[]): boolean {
  return tokens.every((t) => {
    if (h.text.includes(t)) return true;
    const s = squash(t);
    return s.length > 0 && h.compact.includes(s);
  });
}

function buildView(days: readonly TransportBoardDay[], direction: TransportDirection): ViewDay[] {
  return days.map((day) => ({
    key: day.day ?? "none",
    day,
    warning: dayWarning(day.day),
    airports: day.airports.map((airport) => {
      const b = airportBuckets(airport);
      const place = (grouped: boolean): PersonPlace => ({ direction, day: day.day, airportCode: airport.code, grouped });
      const row = (person: TransportBoardPerson, grouped: boolean): Row => {
        const where = place(grouped);
        return {
          person,
          warnings: personWarnings(person, where),
          flagged: isFlagged(person, where),
          haystack: haystackOf(person),
        };
      };
      return {
        key: airport.code ?? "none",
        airport,
        warning: airportWarning(airport.code),
        groups: b.groups.map((group) => ({ group, rows: group.people.map((p) => row(p, true)) })),
        notGrouped: b.notGrouped.map((p) => row(p, false)),
        noService: b.noService.map((p) => row(p, false)),
      };
    }),
  }));
}

/** The view with only the rows `keep` accepts; empty groups, airports and days drop out. */
function filterView(view: readonly ViewDay[], keep: (r: Row) => boolean): ViewDay[] {
  const out: ViewDay[] = [];
  for (const d of view) {
    const airports: ViewAirport[] = [];
    for (const a of d.airports) {
      const groups = a.groups.map((g) => ({ ...g, rows: g.rows.filter(keep) })).filter((g) => g.rows.length > 0);
      const notGrouped = a.notGrouped.filter(keep);
      const noService = a.noService.filter(keep);
      if (groups.length + notGrouped.length + noService.length > 0) airports.push({ ...a, groups, notGrouped, noService });
    }
    if (airports.length > 0) out.push({ ...d, airports });
  }
  return out;
}

function countRows(view: readonly ViewDay[], test: (r: Row) => boolean): number {
  let n = 0;
  for (const d of view)
    for (const a of d.airports) {
      for (const g of a.groups) for (const r of g.rows) if (test(r)) n++;
      for (const r of a.notGrouped) if (test(r)) n++;
      for (const r of a.noService) if (test(r)) n++;
    }
  return n;
}
