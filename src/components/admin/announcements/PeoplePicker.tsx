"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, Loader2, Search, X } from "lucide-react";
import { PEOPLE_MAX, ROLE_LABELS, peopleLabel, type PersonPick } from "@/lib/admin/announcements";
import { searchAnnouncementPeople } from "@/app/admin/announcements/actions";
import { CHIP, CHIP_ON, FIELD_ERROR, HINT, LABEL, inputClass } from "./ui";

/** Shortest query that is searched. */
const MIN_QUERY = 2;
/** Wait this long after the last keystroke before asking the server. */
const DEBOUNCE_MS = 250;

type Search =
  | { state: "idle" }
  | { state: "loading"; query: string }
  | { state: "done"; query: string; people: PersonPick[]; more: boolean }
  | { state: "error"; query: string; message: string };

/** "BAPS ID · Delegate · BM RA": the line under a name. */
function detailLine(p: PersonPick): string {
  const role = ROLE_LABELS[p.role].one;
  return [p.bapsId, role.charAt(0).toUpperCase() + role.slice(1), p.seva].filter(Boolean).join(" · ");
}

/**
 * "Specific people" in the audience step: a search box (name, BAPS ID or the
 * organisers' User Id; the server answers with at most 20 matches), results to
 * tap, and the picked people as chips to take off again. While anyone is
 * picked the announcement goes to exactly those accounts.
 *
 * The search box is a combobox over the results list: Up / Down move through
 * the matches and Enter picks (or unpicks) the highlighted one. Nothing is
 * highlighted until an arrow key has chosen a match (or there is only one), so
 * Enter alone, the phone keyboard's "search" key, never picks whoever happens
 * to be first; it never submits the composer either. Escape clears the search.
 * Results stay open after a pick, so several people can be picked from one
 * search.
 */
export function PeoplePicker({
  selected,
  onChange,
}: {
  selected: readonly PersonPick[];
  onChange: (next: PersonPick[]) => void;
}) {
  const labelId = useId();
  const hintId = useId();
  const listId = useId();
  const statusId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const chipsRef = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<Search>({ state: "idle" });
  /** The match the arrow keys (or a tap) chose; null until then. */
  const [active, setActive] = useState<number | null>(null);
  /** Only the latest request may answer. */
  const requestRef = useRef(0);
  /** A chip was taken off from the keyboard: where its place was, so focus moves to its neighbour. */
  const refocusChip = useRef<number | null>(null);

  const q = query.trim();
  useEffect(() => {
    const request = ++requestRef.current;
    if (q.length < MIN_QUERY) {
      setSearch({ state: "idle" });
      return;
    }
    setSearch((s) => (s.state === "done" ? s : { state: "loading", query: q }));
    const timer = setTimeout(async () => {
      try {
        const res = await searchAnnouncementPeople(q);
        if (request !== requestRef.current) return;
        if (res.ok) {
          setSearch({ state: "done", query: q, people: res.people, more: res.more });
          setActive(null);
        } else setSearch({ state: "error", query: q, message: res.error });
      } catch {
        if (request !== requestRef.current) return;
        setSearch({ state: "error", query: q, message: "Couldn't search. Check your connection and try again." });
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q]);

  // After a chip was removed from the keyboard: its neighbour (the next one, else the one before),
  // else the search box, takes the focus, which would otherwise fall back to the page.
  useEffect(() => {
    const at = refocusChip.current;
    if (at === null) return;
    refocusChip.current = null;
    const chips = chipsRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [];
    const target = chips.length > 0 ? chips[Math.min(at, chips.length - 1)] : inputRef.current;
    target?.focus({ preventScroll: true });
  }, [selected]);

  const results = search.state === "done" ? search.people : [];
  // Results for an earlier query stay on screen (dimmed) until the new ones arrive.
  const stale = search.state === "done" && search.query !== q;
  const busy = search.state === "loading" || stale;
  const open = results.length > 0;
  const pickedIds = new Set(selected.map((p) => p.id));
  const full = selected.length >= PEOPLE_MAX;
  // The only match is highlighted from the start; among several, nothing is until an arrow key or a tap chooses.
  const activeIndex = results.length === 1 ? 0 : active === null ? -1 : Math.min(active, results.length - 1);
  const optionId = (i: number) => `${listId}-${i}`;

  function toggle(p: PersonPick) {
    if (pickedIds.has(p.id)) onChange(selected.filter((x) => x.id !== p.id));
    else if (!full) onChange([...selected, p]);
  }

  function removeChip(p: PersonPick, index: number, button: HTMLButtonElement) {
    // Only when the chip itself has the focus (keyboard, or a desktop click): a tap on a phone
    // must not send the focus to the search box and bring the keyboard up.
    if (document.activeElement === button) refocusChip.current = index;
    onChange(selected.filter((x) => x.id !== p.id));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      // Enter would submit the composer form; here it picks the highlighted match, if any.
      e.preventDefault();
      if (open && !stale && activeIndex >= 0) toggle(results[activeIndex]);
      // The phone keyboard's "search" key with nothing highlighted: put the keyboard away so the matches show.
      else if (open && window.matchMedia?.("(pointer: coarse)").matches) inputRef.current?.blur();
      return;
    }
    if (e.key === "Escape") {
      if (query !== "") {
        e.preventDefault();
        setQuery("");
      }
      return;
    }
    // Home / End stay with the text caret.
    if (!open || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
    const last = results.length - 1;
    const next =
      e.key === "ArrowDown" ? (activeIndex >= last ? 0 : activeIndex + 1) : activeIndex <= 0 ? last : activeIndex - 1;
    e.preventDefault();
    setActive(next);
    document.getElementById(optionId(next))?.scrollIntoView({ block: "nearest" });
  }

  let status = "";
  if (q.length > 0 && q.length < MIN_QUERY) status = `Type at least ${MIN_QUERY} characters.`;
  else if (q.length >= MIN_QUERY) {
    if (busy) status = "Searching…";
    else if (search.state === "done") {
      if (search.people.length === 0) status = `No one matches “${search.query}”.`;
      else if (search.more) status = `Showing the first ${search.people.length}. Keep typing to narrow it down.`;
      else status = search.people.length === 1 ? "1 match" : `${search.people.length} matches`;
    }
  }

  return (
    <div role="group" aria-labelledby={labelId}>
      <div className="mb-2 flex min-h-5 items-center justify-between gap-3">
        <p id={labelId} className={LABEL}>
          Specific people
        </p>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={() => {
              onChange([]);
              inputRef.current?.focus({ preventScroll: true });
            }}
            className="-my-3 min-h-11 rounded-lg px-2 text-[11px] font-semibold text-coral-700 transition hover:text-coral-900 focus-visible:outline-2 focus-visible:outline-coral-600"
          >
            Clear {selected.length > 1 ? `${selected.length} people` : "1 person"}
          </button>
        )}
      </div>

      <div className="relative">
        {busy ? (
          <Loader2
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-ink-400"
          />
        ) : (
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400"
          />
        )}
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
          aria-labelledby={labelId}
          aria-describedby={`${hintId} ${statusId}`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Name, BAPS ID or User Id"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="search"
          maxLength={80}
          className={inputClass({ padding: "py-2 pl-8 pr-3" })}
        />
      </div>

      <p id={statusId} role="status" aria-live="polite" className={status ? HINT : "sr-only"}>
        {status}
      </p>
      {search.state === "error" && (
        <p role="alert" className={FIELD_ERROR}>
          {search.message}
        </p>
      )}

      <ul
        id={listId}
        role="listbox"
        aria-label="People matching your search"
        aria-multiselectable="true"
        className={
          open
            ? `mt-2 max-h-72 divide-y divide-ink-800/8 overflow-y-auto overscroll-contain rounded-2xl border border-ink-800/12 bg-white transition-opacity ${stale ? "opacity-60" : ""}`
            : "hidden"
        }
      >
        {results.map((p, i) => {
          const picked = pickedIds.has(p.id);
          const unavailable = full && !picked;
          return (
            <li
              key={p.id}
              id={optionId(i)}
              role="option"
              aria-selected={picked}
              aria-disabled={unavailable || undefined}
              // Keep the keyboard in the search box: a tap picks without moving focus.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setActive(i);
                toggle(p);
              }}
              className={`flex min-h-12 cursor-pointer items-center gap-3 px-3.5 py-2 ${
                i === activeIndex ? "bg-coral-50" : "hover:bg-sand-50"
              } ${unavailable ? "cursor-not-allowed opacity-50" : ""}`}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold leading-snug text-ink-900 [overflow-wrap:anywhere]">
                  {p.name}
                </span>
                <span className="block text-[11px] leading-snug text-ink-600 [overflow-wrap:anywhere]">
                  {detailLine(p)}
                </span>
              </span>
              {picked ? (
                <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-jade-700">
                  <Check aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2.6} />
                  Picked
                </span>
              ) : (
                !unavailable && <span className="shrink-0 text-xs font-semibold text-coral-700">Add</span>
              )}
            </li>
          );
        })}
      </ul>

      {selected.length > 0 ? (
        <div className="mt-3">
          <p className="text-xs font-semibold text-ink-900">
            Goes to {peopleLabel(selected.length)}
            <span className="font-medium text-ink-500"> · tap a name to take it off</span>
          </p>
          {/* A long list scrolls inside its own box, so the filters and the send button stay within reach. */}
          <ul
            ref={chipsRef}
            aria-label="People picked"
            className="-mx-1 mt-1 flex max-h-44 flex-wrap gap-1.5 overflow-y-auto overscroll-contain px-1 py-1"
          >
            {selected.map((p, i) => (
              <li key={p.id} className="max-w-full">
                <button
                  type="button"
                  onClick={(e) => removeChip(p, i, e.currentTarget)}
                  aria-label={`Remove ${p.name} (${p.bapsId})`}
                  title={detailLine(p)}
                  className={`${CHIP} ${CHIP_ON} inline-flex max-w-full items-center gap-1.5`}
                >
                  <span className="truncate">{p.name}</span>
                  <span className="shrink-0 font-medium text-white/70">{p.bapsId}</span>
                  <X aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-white/70" />
                </button>
              </li>
            ))}
          </ul>
          {full && <p className={HINT}>That&apos;s the most one announcement can list ({PEOPLE_MAX}).</p>}
          {selected.some((p) => p.role === "ADMIN") && (
            <p className={HINT}>
              Admins see announcements in the bell on the delegate pages (Home), not in this console.
            </p>
          )}
        </div>
      ) : (
        <p id={hintId} className={HINT}>
          Pick people to send it only to them, whatever their role, track, seva, hotel or region.
        </p>
      )}
      {/* The hint the search box points at, once the line above has given way to the chips. */}
      {selected.length > 0 && (
        <p id={hintId} className="sr-only">
          It goes only to the people picked.
        </p>
      )}
    </div>
  );
}
