"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, Search, SearchX, SlidersHorizontal, UserPlus, X } from "lucide-react";
import type { DirectoryPerson } from "@/lib/admin/delegates";
import type { OpenBounceNote } from "@/lib/admin/emailEvents";
import { buildSevaOptions } from "@/lib/admin/sevaFilter";
import {
  DIMENSIONS,
  EMPTY_FILTERS,
  PAGE_SIZE,
  ROLE_LABEL,
  ROLE_ORDER,
  SORT_OPTIONS,
  activeFilterCount,
  distinctSorted,
  facetCounts,
  filterEntries,
  hasBapsIdShape,
  indexPeople,
  isNarrowed,
  nextSort,
  parseSortParam,
  peopleCount,
  personMatches,
  readUrlState,
  sameSort,
  selectedValues,
  sortEntries,
  sortLabel,
  sortParam,
  toggleValue,
  valueLabel,
  writeUrlState,
  type Filters,
  type OpenSheet,
  type Sort,
  type SortKey,
} from "./directory";
import { FilterPanel } from "./FilterPanel";
import { PeopleList } from "./PeopleList";
import { PersonDetail } from "./PersonDetail";
import { PersonForm } from "./PersonForm";
import { Sheet } from "./Sheet";
import { Toast, type ToastData } from "./Toast";
import { SachuMark } from "@/components/brand/Sachu";
import { PageHeader } from "@/components/admin/shell/PageHeader";
import {
  Avatar,
  BTN_PRIMARY,
  BTN_SECONDARY,
  BTN_SECONDARY_COMPACT,
  CHIP,
  CHIP_OFF,
  CHIP_ON,
  INPUT,
  chipCount,
} from "./ui";

type SheetState =
  | { kind: "filters" }
  | { kind: "new"; bapsId?: string }
  | { kind: "person"; id: string; editing: boolean };

const SEARCH_DEBOUNCE_MS = 180;
/** How long a just-saved person may take to appear before we stop waiting to scroll to them. */
const SCROLL_WAIT_MS = 6000;

function sheetFromUrl(open: OpenSheet, people: readonly DirectoryPerson[]): SheetState | null {
  if (!open) return null;
  if (open.kind === "new") return { kind: "new" };
  const person = people.find((p) => p.bapsId === open.bapsId);
  return person ? { kind: "person", id: person.id, editing: false } : null;
}

/** The on-screen element (card or table row button) for a person, if rendered. */
function focusTargetFor(id: string): HTMLElement | null {
  const nodes = document.querySelectorAll<HTMLElement>(`[data-person-id="${CSS.escape(id)}"]`);
  for (const node of nodes) if (node.getClientRects().length > 0) return node;
  return null;
}

/**
 * A search that looks like a BAPS ID, for "Add BK1234": letters and a digit, or a
 * name-style ID with an inner dot. BAPS IDs always have a letter; an all-digit
 * search is a registration ID (the master list's User Id), not a sign-in ID.
 */
function bapsIdFromQuery(q: string): string | null {
  const v = q.trim().toUpperCase();
  return hasBapsIdShape(v) && /[A-Z]/.test(v) && /[\d.]/.test(v) ? v : null;
}

/**
 * The admin delegate directory: everyone who can sign in, searched, filtered
 * and sorted in memory, with the view kept in the URL, plus the detail and
 * add/edit sheets.
 */
export function DelegateDirectory({
  people: serverPeople,
  viewerId,
  serverNow,
  mirrorsEnabled,
  bounces = {},
}: {
  people: DirectoryPerson[];
  /** The signed-in admin. */
  viewerId: string;
  /** Server render time (ISO), so relative times hydrate identically. */
  serverNow: string;
  /** Whether this server honours mirror test accounts (mirrorTestersEnabled() in src/lib/auth.ts). */
  mirrorsEnabled: boolean;
  /** Open email bounces by address, lower-cased (getOpenBounceNotes()): a person's detail notes theirs. */
  bounces?: Record<string, OpenBounceNote>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlQuery = searchParams.toString();

  // ---- View state, first read from the URL ---------------------------------
  const [initialUrl] = useState(() => readUrlState(new URLSearchParams(urlQuery)));
  const [filters, setFilters] = useState<Filters>(initialUrl.filters);
  const [qInput, setQInput] = useState(initialUrl.filters.q);
  const [sort, setSort] = useState<Sort>(initialUrl.sort);
  const [sheet, setSheet] = useState<SheetState | null>(() => sheetFromUrl(initialUrl.open, serverPeople));
  const [toast, setToast] = useState<ToastData | null>(null);
  const [busy, setBusy] = useState(false);
  const dirtyRef = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  /** Where focus returns when the person sheet closes, if not to the row that opened it. */
  const personReturnRef = useRef<HTMLElement | null>(null);

  // Relative times ("12 min ago"): the server's clock for hydration, then live.
  const [now, setNow] = useState(() => Date.parse(serverNow));
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // ---- People --------------------------------------------------------------
  // A just-saved person, shown straight away until the refreshed list arrives.
  const [saved, setSaved] = useState<DirectoryPerson | null>(null);
  useEffect(() => setSaved(null), [serverPeople]);
  const people = useMemo(() => {
    if (!saved) return serverPeople;
    const i = serverPeople.findIndex((p) => p.id === saved.id);
    if (i === -1) return [...serverPeople, saved];
    const next = serverPeople.slice();
    next[i] = saved;
    return next;
  }, [serverPeople, saved]);

  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const byBapsId = useMemo(() => new Map(people.map((p) => [p.bapsId, p])), [people]);
  const byRegistrationId = useMemo(
    () => new Map(people.flatMap((p) => (p.registrationId ? [[p.registrationId, p] as const] : []))),
    [people],
  );
  // Raw spellings for the add/edit form's suggestions; folded options for the seva filter.
  const sevaOptions = useMemo(() => distinctSorted(people.map((p) => p.seva)), [people]);
  const sevaFacet = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of people) counts.set(p.seva, (counts.get(p.seva) ?? 0) + 1);
    return buildSevaOptions([...counts].map(([seva, count]) => ({ seva, count })));
  }, [people]);
  const regionOptions = useMemo(
    () => distinctSorted(people.flatMap((p) => (p.region ? [p.region] : []))),
    [people],
  );
  const centerOptions = useMemo(
    () => distinctSorted(people.flatMap((p) => (p.center ? [p.center] : []))),
    [people],
  );
  const statusOptions = useMemo(
    () => distinctSorted(people.flatMap((p) => (p.registrationStatus ? [p.registrationStatus] : []))),
    [people],
  );
  const signedInCount = useMemo(() => people.filter((p) => p.lastSignInAt).length, [people]);

  const entries = useMemo(() => indexPeople(people), [people]);
  const sorted = useMemo(() => sortEntries(entries, sort), [entries, sort]);
  const results = useMemo(() => filterEntries(sorted, filters), [sorted, filters]);
  const roleCounts = useMemo(() => facetCounts(entries, filters, "role"), [entries, filters]);

  // ---- Search debounce -----------------------------------------------------
  useEffect(() => {
    if (qInput === filters.q) return;
    const timer = setTimeout(() => setFilters((f) => ({ ...f, q: qInput })), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [qInput, filters.q]);

  // ---- Paging (render 50 at a time) ----------------------------------------
  const resultKey = useMemo(() => JSON.stringify([filters, sort]), [filters, sort]);
  const [paging, setPaging] = useState({ key: resultKey, limit: PAGE_SIZE });
  const limit = paging.key === resultKey ? paging.limit : PAGE_SIZE;
  const shown = useMemo(() => results.slice(0, limit).map((e) => e.person), [results, limit]);

  // ---- URL sync ------------------------------------------------------------
  const openNew = sheet?.kind === "new";
  const openBapsId = sheet?.kind === "person" ? (byId.get(sheet.id)?.bapsId ?? null) : null;
  const lastQuery = useRef(urlQuery);

  // A navigation brought a different query (the nav tab, a shared link): adopt it.
  useEffect(() => {
    if (urlQuery === lastQuery.current) return;
    // The router can lag behind a burst of our own replaceState calls; an echo
    // of an older one no longer matches the address bar, so ignore it.
    if (urlQuery !== new URLSearchParams(window.location.search).toString()) return;
    lastQuery.current = urlQuery;
    const next = readUrlState(new URLSearchParams(urlQuery));
    setFilters(next.filters);
    setQInput(next.filters.q);
    setSort(next.sort);
    setSheet(sheetFromUrl(next.open, people));
    dirtyRef.current = false;
    // Only a real navigation should re-read the URL; `people` is read as of now.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlQuery]);

  // Mirror the view into the URL without a navigation (no server round trip).
  useEffect(() => {
    const open: OpenSheet = openNew ? { kind: "new" } : openBapsId ? { kind: "person", bapsId: openBapsId } : null;
    const next = writeUrlState(new URLSearchParams(window.location.search), { filters, sort, open }).toString();
    if (next === lastQuery.current) return;
    lastQuery.current = next;
    window.history.replaceState(null, "", next ? `${pathname}?${next}` : pathname);
  }, [filters, sort, openNew, openBapsId, pathname]);

  // ---- After a save: bring the person into view and flash them -------------
  const [pendingScroll, setPendingScroll] = useState<{ id: string; until: number } | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  useEffect(() => {
    if (!pendingScroll) return;
    if (Date.now() > pendingScroll.until) {
      setPendingScroll(null);
      return;
    }
    const index = results.findIndex((e) => e.person.id === pendingScroll.id);
    if (index === -1) return; // not in the list yet
    if (index >= limit) {
      setPaging({ key: resultKey, limit: Math.ceil((index + 1) / PAGE_SIZE) * PAGE_SIZE });
      return;
    }
    const target = focusTargetFor(pendingScroll.id);
    if (!target) return;
    setPendingScroll(null);
    setHighlightId(pendingScroll.id);
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ block: "center", behavior: smooth ? "smooth" : "auto" });
    target.focus({ preventScroll: true });
  }, [pendingScroll, results, limit, resultKey]);

  useEffect(() => {
    if (!highlightId) return;
    const timer = setTimeout(() => setHighlightId(null), 2400);
    return () => clearTimeout(timer);
  }, [highlightId]);

  // ---- "/" focuses the search (desktop) ------------------------------------
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      searchRef.current?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // ---- Actions ---------------------------------------------------------------
  const updateFilters = useCallback((next: Filters) => setFilters(next), []);

  const clearAll = useCallback(() => {
    setQInput("");
    setFilters(EMPTY_FILTERS);
  }, []);

  const clearSearch = useCallback(() => {
    setQInput("");
    setFilters((f) => ({ ...f, q: "" }));
    searchRef.current?.focus();
  }, []);

  const onSort = useCallback((key: SortKey) => setSort((s) => nextSort(s, key)), []);

  const openPerson = useCallback((id: string) => {
    dirtyRef.current = false;
    personReturnRef.current = null;
    setSheet({ kind: "person", id, editing: false });
  }, []);

  /** From the add form's "already in the directory" hint: that form's button is about to go. */
  const openPersonFromAddForm = useCallback((id: string) => {
    dirtyRef.current = false;
    personReturnRef.current = addButtonRef.current;
    setSheet({ kind: "person", id, editing: false });
  }, []);

  const closeSheet = useCallback(() => {
    if (busy) return;
    const editing = sheet?.kind === "new" || (sheet?.kind === "person" && sheet.editing);
    if (editing && dirtyRef.current && !window.confirm("Discard the changes you've made?")) return;
    dirtyRef.current = false;
    setSheet(null);
  }, [busy, sheet]);

  const setDirty = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
  }, []);

  const showSaved = useCallback((id: string) => {
    setQInput("");
    setFilters(EMPTY_FILTERS);
    setPendingScroll({ id, until: Date.now() + SCROLL_WAIT_MS });
  }, []);

  const handleSaved = useCallback(
    (person: DirectoryPerson, created: boolean) => {
      dirtyRef.current = false;
      setSheet(null);
      setSaved(person);
      const verb = created ? "Added" : "Saved";
      if (personMatches(person, filters)) {
        setPendingScroll({ id: person.id, until: Date.now() + SCROLL_WAIT_MS });
        setToast({ id: Date.now(), message: `${verb} ${person.name}.` });
      } else {
        setToast({
          id: Date.now(),
          message: `${verb} ${person.name}. Your search or filters hide them.`,
          action: { label: "Show", onClick: () => showSaved(person.id) },
        });
      }
      // revalidatePath() in the action refreshes too; this also covers the header (own name) and other admins' edits.
      router.refresh();
    },
    [filters, router, showSaved],
  );

  // A person whose sheet is open disappeared (deleted elsewhere): close it.
  const sheetPerson = sheet?.kind === "person" ? byId.get(sheet.id) : undefined;
  useEffect(() => {
    if (sheet?.kind === "person" && !sheetPerson) setSheet(null);
  }, [sheet, sheetPerson]);

  // ---- Render ----------------------------------------------------------------
  const narrowed = isNarrowed(filters) || qInput.trim() !== "";
  const filterCount = activeFilterCount(filters);
  const nonRoleChips = DIMENSIONS.filter((d) => d !== "role").flatMap((d) =>
    selectedValues(filters, d).map((value) => ({ d, value, label: valueLabel(d, value) })),
  );
  const totalForRoles = ROLE_ORDER.reduce((n, r) => n + (roleCounts.get(r) ?? 0), 0);
  const queryId = results.length === 0 ? bapsIdFromQuery(filters.q) : null;
  const addBapsId = queryId && !byBapsId.has(queryId) ? queryId : null;
  const sortIsListed = SORT_OPTIONS.some((o) => sameSort(o.sort, sort));

  return (
    <>
      <PageHeader
        title="Delegates"
        description={
          people.length === 0
            ? "Everyone who can sign in: delegates, Pujya Santo and admins."
            : `${peopleCount(people.length)} · ${signedInCount.toLocaleString("en-US")} signed in`
        }
        action={
          <button ref={addButtonRef} type="button" onClick={() => setSheet({ kind: "new" })} className={BTN_PRIMARY}>
            <UserPlus className="h-4 w-4" />
            Add<span className="sr-only sm:not-sr-only"> person</span>
          </button>
        }
      />

      {people.length === 0 ? (
        <section className="card flex flex-col items-center px-6 py-10 text-center">
          {/* First run: the event's mark welcomes the first entry. */}
          <SachuMark variant="full" className="mb-4 h-20 w-auto" />
          <h2 className="font-display text-2xl leading-tight text-ink-900">No people yet</h2>
          <p className="mt-2 max-w-xs text-sm text-ink-600">
            Add delegates, Pujya Santo and admins here. They sign in with their BAPS ID and a one-time code.
          </p>
          <button type="button" onClick={() => setSheet({ kind: "new" })} className={`${BTN_PRIMARY} mt-5`}>
            <UserPlus className="h-4 w-4" />
            Add the first person
          </button>
        </section>
      ) : (
        <>
          <section aria-label="Search and filters" className="mb-4 space-y-3">
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400"
                />
                <input
                  ref={searchRef}
                  type="search"
                  inputMode="search"
                  enterKeyHint="search"
                  aria-label="Search people"
                  placeholder="Name, ID, phone, seva, center…"
                  value={qInput}
                  onChange={(e) => setQInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape" && qInput) {
                      e.preventDefault();
                      clearSearch();
                    } else if (e.key === "Enter") {
                      // Search now rather than after the pause, and put a phone keyboard away.
                      e.preventDefault();
                      setFilters((f) => (f.q === qInput ? f : { ...f, q: qInput }));
                      if (window.matchMedia("(pointer: coarse)").matches) e.currentTarget.blur();
                    }
                  }}
                  maxLength={100}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  className={`${INPUT} pl-10 pr-11 [&::-webkit-search-cancel-button]:appearance-none`}
                />
                {qInput && (
                  <button
                    type="button"
                    onClick={clearSearch}
                    aria-label="Clear search"
                    className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-ink-500 transition before:absolute before:-inset-1 before:content-[''] hover:bg-ink-800/5 hover:text-ink-900 focus-visible:outline-2 focus-visible:outline-coral-600"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSheet({ kind: "filters" })}
                aria-label={filterCount ? `Filters, ${filterCount} on` : "Filters"}
                className={`${BTN_SECONDARY_COMPACT} shrink-0`}
              >
                <SlidersHorizontal className="h-4 w-4" />
                <span className="hidden sm:inline">Filters</span>
                {filterCount > 0 && (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-coral-700 px-1.5 text-[11px] font-bold leading-none text-white">
                    {filterCount}
                  </span>
                )}
              </button>
            </div>

            <div
              role="group"
              aria-label="Role"
              className="-mx-4 flex gap-2 overflow-x-auto px-4 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              <button
                type="button"
                aria-pressed={filters.roles.length === 0}
                onClick={() => setFilters((f) => ({ ...f, roles: [] }))}
                className={`${CHIP} ${filters.roles.length === 0 ? CHIP_ON : CHIP_OFF} shrink-0`}
              >
                Everyone
                <span className={chipCount(filters.roles.length === 0)}>{totalForRoles}</span>
              </button>
              {ROLE_ORDER.map((role) => {
                const on = filters.roles.includes(role);
                return (
                  <button
                    key={role}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setFilters((f) => toggleValue(f, "role", role))}
                    className={`${CHIP} ${on ? CHIP_ON : CHIP_OFF} shrink-0`}
                  >
                    {ROLE_LABEL[role]}
                    <span className={chipCount(on)}>{roleCounts.get(role) ?? 0}</span>
                  </button>
                );
              })}
            </div>

            {nonRoleChips.length > 0 && (
              <ul aria-label="Active filters" className="flex flex-wrap gap-2">
                {nonRoleChips.map((chip) => (
                  <li key={`${chip.d}:${chip.value}`} className="min-w-0 max-w-full">
                    <button
                      type="button"
                      onClick={() => setFilters((f) => toggleValue(f, chip.d, chip.value))}
                      aria-label={`Remove filter: ${chip.label}`}
                      className="relative inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full border border-coral-300 bg-coral-50 py-1.5 pl-3 pr-2 text-xs font-semibold text-coral-800 transition hover:bg-coral-100 before:absolute before:inset-x-0 before:-inset-y-1 before:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral-600"
                    >
                      <span className="truncate">{chip.label}</span>
                      <X className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <p className="text-sm text-ink-600">
                <span aria-live="polite">
                  <span className="font-semibold text-ink-900">{results.length.toLocaleString("en-US")}</span> of{" "}
                  {peopleCount(people.length)}
                </span>
                {narrowed && (
                  <>
                    {" · "}
                    <button
                      type="button"
                      onClick={clearAll}
                      className="relative font-semibold text-coral-800 underline-offset-2 before:absolute before:-inset-x-1 before:-inset-y-3 before:content-[''] hover:underline focus-visible:underline focus-visible:outline-none"
                    >
                      Clear all
                    </button>
                  </>
                )}
              </p>
              <label className="relative flex items-center">
                <span className="sr-only">Sort by</span>
                <select
                  value={sortParam(sort)}
                  onChange={(e) => setSort(parseSortParam(e.target.value))}
                  className="min-h-11 appearance-none rounded-xl border border-ink-800/15 bg-white/85 py-1.5 pl-3 pr-8 text-base font-semibold text-ink-900 outline-none transition hover:bg-white focus:border-coral-500 focus:ring-2 focus:ring-coral-400/35 md:text-sm"
                >
                  {!sortIsListed && <option value={sortParam(sort)}>{sortLabel(sort)}</option>}
                  {SORT_OPTIONS.map((o) => (
                    <option key={sortParam(o.sort)} value={sortParam(o.sort)}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  aria-hidden="true"
                  className="pointer-events-none absolute right-2.5 h-4 w-4 text-ink-500"
                />
              </label>
            </div>
          </section>

          <section aria-label="People">
            {results.length === 0 ? (
              <div className="card flex flex-col items-center px-6 py-10 text-center">
                <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-sand-200 text-ink-500">
                  <SearchX className="h-7 w-7" />
                </span>
                <h2 className="font-display text-2xl leading-tight text-ink-900">No one matches</h2>
                <p className="mt-2 max-w-xs text-sm text-ink-600">
                  {filters.q.trim()
                    ? `Nothing for “${filters.q.trim()}”${filterCount ? " with these filters" : ""}.`
                    : "No one fits these filters."}{" "}
                  Try another spelling, or clear the search and filters.
                </p>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  <button type="button" onClick={clearAll} className={BTN_SECONDARY}>
                    Clear all
                  </button>
                  {addBapsId && (
                    <button
                      type="button"
                      onClick={() => setSheet({ kind: "new", bapsId: addBapsId })}
                      className={BTN_PRIMARY}
                    >
                      <UserPlus className="h-4 w-4" />
                      Add {addBapsId}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <>
                <PeopleList
                  people={shown}
                  query={filters.q}
                  sort={sort}
                  onSort={onSort}
                  onOpen={openPerson}
                  highlightId={highlightId}
                  viewerId={viewerId}
                  now={now}
                />
                {results.length > shown.length && (
                  <div className="mt-4 flex flex-col items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPaging({ key: resultKey, limit: limit + PAGE_SIZE })}
                      className={BTN_SECONDARY}
                    >
                      Show {Math.min(PAGE_SIZE, results.length - shown.length)} more
                    </button>
                    <p className="text-xs text-ink-500">
                      Showing {shown.length.toLocaleString("en-US")} of {results.length.toLocaleString("en-US")}
                    </p>
                  </div>
                )}
              </>
            )}
          </section>
        </>
      )}

      <Sheet
        open={sheet?.kind === "filters"}
        onClose={closeSheet}
        title="Filters"
        description="Counts show how many people each choice would leave."
      >
        <FilterPanel
          entries={entries}
          filters={filters}
          resultCount={results.length}
          sevaOptions={sevaFacet}
          regionOptions={regionOptions}
          statusOptions={statusOptions}
          onChange={updateFilters}
          onDone={closeSheet}
        />
      </Sheet>

      <Sheet
        open={sheet?.kind === "new"}
        onClose={closeSheet}
        busy={busy}
        title="Add a person"
        description="They'll sign in with their BAPS ID and a one-time code."
      >
        {sheet?.kind === "new" && (
          <PersonForm
            key={`new:${sheet.bapsId ?? ""}`}
            mode={{ kind: "create", bapsId: sheet.bapsId }}
            viewerId={viewerId}
            sevaOptions={sevaOptions}
            regionOptions={regionOptions}
            centerOptions={centerOptions}
            findByBapsId={(id) => byBapsId.get(id)}
            findByRegistrationId={(id) => byRegistrationId.get(id)}
            onOpenPerson={openPersonFromAddForm}
            onSaved={(p) => handleSaved(p, true)}
            onCancel={closeSheet}
            onDirtyChange={setDirty}
            onBusyChange={setBusy}
          />
        )}
      </Sheet>

      <Sheet
        open={sheet?.kind === "person" && sheetPerson !== undefined}
        onClose={closeSheet}
        busy={busy}
        returnFocusRef={personReturnRef}
        leading={sheetPerson && !(sheet?.kind === "person" && sheet.editing) ? <Avatar person={sheetPerson} size="lg" /> : undefined}
        title={sheet?.kind === "person" && sheet.editing ? "Edit details" : (sheetPerson?.name ?? "")}
        description={
          sheet?.kind === "person" && sheet.editing
            ? sheetPerson && `${sheetPerson.name} · ${sheetPerson.bapsId}`
            : sheetPerson?.displayName
              ? `Greeted as “${sheetPerson.displayName}”`
              : undefined
        }
      >
        {sheet?.kind === "person" &&
          sheetPerson &&
          (sheet.editing ? (
            <PersonForm
              key={`edit:${sheetPerson.id}`}
              mode={{ kind: "edit", person: sheetPerson }}
              viewerId={viewerId}
              sevaOptions={sevaOptions}
              regionOptions={regionOptions}
              centerOptions={centerOptions}
              findByBapsId={(id) => byBapsId.get(id)}
              findByRegistrationId={(id) => byRegistrationId.get(id)}
              onOpenPerson={openPerson}
              onSaved={(p) => handleSaved(p, false)}
              onCancel={() => {
                dirtyRef.current = false;
                setSheet({ kind: "person", id: sheetPerson.id, editing: false });
              }}
              onDirtyChange={setDirty}
              onBusyChange={setBusy}
            />
          ) : (
            <PersonDetail
              person={sheetPerson}
              viewerId={viewerId}
              now={now}
              onEdit={() => setSheet({ kind: "person", id: sheetPerson.id, editing: true })}
              findByRegistrationId={(id) => byRegistrationId.get(id)}
              findByBapsId={(id) => byBapsId.get(id)}
              mirrorsEnabled={mirrorsEnabled}
              bounce={sheetPerson.email ? bounces[sheetPerson.email.trim().toLowerCase()] : undefined}
            />
          ))}
      </Sheet>

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
