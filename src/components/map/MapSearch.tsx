"use client";

import { useId, useMemo, useRef, useState } from "react";
import { MapPin, Search, X } from "lucide-react";
import { normalizeVenueName } from "@/lib/venue/aliases";
import type { ClientRoom } from "@/lib/venue/view";
import type { MapAlias, MatchSpread } from "./mapTypes";

export type SearchHit = {
  key: string;
  label: string;
  /** "Second Floor", "Second Floor · Sahajanand Hall", "Basement · Staff only", or "Not on the map yet". */
  sub: string;
  roomIds: string[];
  /**
   * "covers": an event name mapped to several rooms (it covers them all); "same-name": an event
   * name with one room per track, for a guest with no track (the nearer is opened); else "one".
   */
  spread: MatchSpread;
};

const MAX_HITS = 12;
/** Event names not on the map yet: only a few, and only close matches, so they never crowd out rooms. */
const MAX_UNMAPPED = 3;

/** 0 = starts with the query, 1 = a word starts with it, 2 = contains it, -1 = no match. */
function rank(text: string, q: string): number {
  const t = normalizeVenueName(text);
  if (!t) return -1;
  if (t.startsWith(q)) return 0;
  if (t.includes(` ${q}`)) return 1;
  return t.includes(q) ? 2 : -1;
}

/**
 * Event names (the alias list: "Main Hall") and the map's rooms by name (the organisers' team
 * name, else the blueprint's) or number ("ashro", "123") in one list: rooms guests can go to
 * before staff-only ones ("office" finds the offices with directions first), then best match
 * first (by how well it matches, then rooms on the map before names that aren't yet, then by
 * name). A room found by an event name is offered under its own
 * name when that matches the query just as well ("mahant" -> "Mahant Hall", not "Mahant Hall
 * (Mezz)"). Unmapped event names show only when they start with the query or one of their words
 * does, at most MAX_UNMAPPED of them. Staff-only rooms are found like any other and say "Staff
 * only" (describe()); corridors and back-of-house rooms are never offered.
 */
export function searchVenue(
  query: string,
  aliases: MapAlias[],
  rooms: ClientRoom[],
  /** A room's line under a hit; `shown` = the name the hit shows, when it isn't the room's own. */
  describe: (id: string, shown?: string) => string,
  titleOf: (id: string) => string,
): SearchHit[] {
  const q = normalizeVenueName(query);
  if (!q) return [];
  /** `open`: it has directions (at least one of its rooms isn't staff only). */
  type Scored = SearchHit & { score: number; mapped: boolean; open: boolean };
  const closed = new Set(rooms.filter((r) => r.closed).map((r) => r.id));
  const events: Scored[] = aliases
    .map((a) => ({ a, r: rank(a.name, q) }))
    .filter((x) => x.r >= 0)
    .map(({ a, r }) => {
      // The room's own name when it matches as well as the event name does (one room only).
      const own = a.roomIds.length === 1 ? titleOf(a.roomIds[0]) : null;
      const ownRank = own ? rank(own, q) : -1;
      const label = own && ownRank >= 0 && ownRank <= r ? own : a.name;
      return {
        key: `e-${a.name}`,
        label,
        // One room per track, both offered (no gender on file): just "2 rooms", not one of them.
        sub: a.roomIds.length === 0 ? "Not on the map yet" : a.either ? `${a.roomIds.length} rooms` : describe(a.roomIds[0], label),
        roomIds: a.roomIds,
        spread: (a.roomIds.length > 1 ? (a.either ? "same-name" : "covers") : "one") as MatchSpread,
        score: r,
        mapped: a.roomIds.length > 0,
        open: a.roomIds.some((id) => !closed.has(id)),
      };
    });
  // Several names of one room ("Main Hall" and "Sabha Hall"; two spellings of one office): only
  // the one that matches best (the first listed on a tie), so one room isn't offered three times.
  const bestByRooms = new Map<string, Scored>();
  for (const e of events) {
    if (!e.mapped) continue;
    const key = e.roomIds.join();
    const best = bestByRooms.get(key);
    if (!best || e.score < best.score) bestByRooms.set(key, e);
  }
  const mappedEvents = [...bestByRooms.values()];
  const unmapped = events
    .filter((e) => !e.mapped && e.score <= 1)
    .sort((x, y) => x.score - y.score || x.label.localeCompare(y.label))
    .slice(0, MAX_UNMAPPED);
  // A room an event name already covers is offered under that name only; and a room that merely
  // shares that name (the other track's "Samp Square") isn't offered beside it: the event name
  // means the guest's own.
  const covered = new Set(mappedEvents.flatMap((e) => e.roomIds));
  const eventKeys = new Set(mappedEvents.map((e) => normalizeVenueName(e.label)));
  const byRoom: Scored[] = rooms
    .filter((r) => !covered.has(r.id) && !eventKeys.has(normalizeVenueName(titleOf(r.id))))
    .map((r) => {
      const byName = Math.min(...[rank(titleOf(r.id), q), rank(r.name, q)].map((x) => (x < 0 ? 9 : x)));
      const num = r.number ? normalizeVenueName(r.number) : "";
      const byNumber = num && (num === q || num.startsWith(q) || `room ${num}`.startsWith(q)) ? 0 : 9;
      return { r, score: Math.min(byName, byNumber) };
    })
    .filter((x) => x.score < 9)
    .map(({ r, score }) => ({
      key: `r-${r.id}`,
      label: titleOf(r.id),
      sub: describe(r.id),
      roomIds: [r.id],
      spread: "one" as MatchSpread,
      score,
      mapped: true,
      open: !r.closed,
    }));
  return [...mappedEvents, ...byRoom, ...unmapped]
    .sort(
      (x, y) =>
        Number(x.mapped && !x.open) - Number(y.mapped && !y.open) ||
        x.score - y.score ||
        Number(y.mapped) - Number(x.mapped) ||
        x.label.localeCompare(y.label),
    )
    .slice(0, MAX_HITS)
    .map(({ key, label, sub, roomIds, spread }) => ({ key, label, sub, roomIds, spread }));
}

export function MapSearch({
  aliases,
  rooms,
  describe,
  titleOf,
  onPick,
}: {
  aliases: MapAlias[];
  rooms: ClientRoom[];
  describe: (id: string, shown?: string) => string;
  titleOf: (id: string) => string;
  onPick: (hit: SearchHit) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hits = useMemo(() => searchVenue(query, aliases, rooms, describe, titleOf), [query, aliases, rooms, describe, titleOf]);
  const show = open && query.trim().length > 0;

  const pick = (hit: SearchHit) => {
    onPick(hit);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  };

  return (
    <div className="relative">
      <label className="flex items-center gap-2.5 rounded-2xl bg-white px-3.5 py-2.5 shadow-card ring-1 ring-sand-300 focus-within:ring-2 focus-within:ring-ink-800">
        <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-500" />
        <span className="sr-only">Find a room</span>
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded={show}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={show && hits[active] ? `${listId}-${active}` : undefined}
          value={query}
          placeholder="Find a room: Niyam, Main Hall, Restroom…"
          autoComplete="off"
          enterKeyHint="search"
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, Math.max(hits.length - 1, 0)));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter" && hits[active]) {
              e.preventDefault();
              pick(hits[active]);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-[15px] text-ink-900 placeholder:text-ink-400 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
            className="-mr-1 flex h-7 w-7 items-center justify-center rounded-full text-ink-500 hover:bg-sand-100"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        )}
      </label>
      {show && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Rooms"
          className="absolute inset-x-0 top-full z-30 mt-2 max-h-[min(22rem,55dvh)] overflow-y-auto overscroll-contain rounded-2xl bg-white p-1.5 shadow-card-lg ring-1 ring-sand-300"
        >
          {hits.length === 0 && <li className="px-3 py-3 text-sm text-ink-500">No rooms match &ldquo;{query.trim()}&rdquo;</li>}
          {hits.map((h, i) => {
            const off = h.roomIds.length === 0;
            return (
              <li
                key={h.key}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                aria-disabled={off || undefined}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => pick(h)}
                className={`flex cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5 ${i === active ? "bg-sand-100" : "hover:bg-sand-50"}`}
              >
                <MapPin aria-hidden="true" className={`mt-0.5 h-4 w-4 shrink-0 ${off ? "text-ink-300" : "text-coral-700"}`} />
                <span className="min-w-0">
                  <span className={`block text-sm font-semibold ${off ? "text-ink-500" : "text-ink-900"}`}>{h.label}</span>
                  <span className="block text-xs text-ink-500">{h.sub}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
