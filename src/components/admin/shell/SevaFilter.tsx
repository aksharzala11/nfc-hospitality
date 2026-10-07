"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ListFilter, LoaderCircle, Search, X } from "lucide-react";
import {
  MAX_SEVA_FILTER,
  readSevaFilter,
  sevaOptionValue,
  withSevaFilter,
  type SevaOption,
} from "@/lib/admin/sevaFilter";
import { useAppScrollLock } from "@/lib/scroll";
import { Sheet, SheetBody, SheetFooter } from "@/components/admin/delegates/Sheet";
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  CHIP,
  CHIP_EMPTY,
  CHIP_OFF,
  CHIP_ON,
  INPUT,
  LABEL,
  chipCount,
} from "@/components/admin/delegates/ui";
import { FOCUS } from "@/components/admin/shell/ui";

const TITLE = "Filter by seva";
const DESCRIPTION = "Counts are people with that seva. Every console tab keeps this filter.";
/** This many options or more get a search box. */
const SEARCH_FROM = 9;
/** The popover (md and up), in px. */
const POPOVER_WIDTH = 416;
const POPOVER_MAX_HEIGHT = 560;
const POPOVER_MIN_HEIGHT = 300;
const GAP = 8;
const EDGE = 16;
/** Room kept free under the popover for the floating bottom nav. */
const NAV_CLEARANCE = 104;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const TRIGGER = `inline-flex min-h-11 items-center gap-2 rounded-2xl border border-ink-800/12 bg-white/85 py-2 pl-3.5 pr-3 text-sm font-semibold text-ink-900 shadow-card transition hover:border-ink-800/20 hover:bg-white active:scale-[0.98] ${FOCUS}`;
/** A picked seva on the bar, like the delegate directory's active-filter chips; `before:` makes it 44px tall to tap. */
const PICKED_CHIP = `relative inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full border border-coral-300 bg-coral-50 py-1.5 pl-3 pr-2 text-xs font-semibold text-coral-800 transition hover:bg-coral-100 before:absolute before:inset-x-0 before:-inset-y-1 before:content-[''] ${FOCUS}`;

/** Lower case without accents, for the search box. */
function fold(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
/** Letters and digits only, so "bmra" finds "BM RA" and "rpcs rgcs" finds "BK RPCs & RGCs". */
const compact = (value: string) => fold(value).replace(/[^a-z0-9]/g, "");

function matches(option: SevaOption, query: string): boolean {
  if (!query) return true;
  if (fold(option.label).includes(fold(query))) return true;
  const q = compact(query);
  return q !== "" && compact(option.label).includes(q);
}

/** Option values, blanks and repeats dropped ("eBM RA" in an old link is BM RA). */
function canonical(values: readonly string[]): string[] {
  return [...new Set(values.map(sevaOptionValue).filter(Boolean))];
}

function sameSelection(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v) => b.includes(v));
}

/**
 * The console-wide seva filter: a compact bar with a "Seva" button ("All sevas", or the
 * picked sevas as removable chips) that opens a picker, a bottom sheet on phones and a
 * popover from md up, with a search box for long lists, each seva's head count, multi-select
 * and Clear. Picks apply when the picker closes (Apply, Escape, the close button or a tap
 * outside all keep them): the page is replaced with the same URL and new `seva` params
 * (withSevaFilter(): ?now= and every other param stay), without scrolling. The admin bottom
 * nav carries the params to the other tabs.
 *
 * Server pages render it as
 *   <SevaFilter options={await getSevaOptions()} selected={readSevaFilter(sp)} />
 * `selected` is what the page filtered by; the bar then follows the live URL, which only
 * differs when a page rewrites ?seva= itself (the delegate directory's own seva filter),
 * so both stay in step. No outer margin: the page places it.
 */
export function SevaFilter({ options, selected }: { options: SevaOption[]; selected: string[] }) {
  const router = useRouter();
  const params = useSearchParams() as URLSearchParams | null;
  const [pending, startTransition] = useTransition();

  const urlKey = params?.toString() ?? null;
  const current = useMemo(
    () => canonical(urlKey === null ? selected : readSevaFilter(new URLSearchParams(urlKey))),
    [urlKey, selected],
  );
  // What the bar shows: the picks being applied until the page catches up.
  const [shown, setShown] = useOptimistic(current);

  const [open, setOpen] = useState<"sheet" | "popover" | null>(null);
  const [draft, setDraft] = useState<string[]>([]);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // The bar's chips by value, and where focus goes once a chip (or the bar's Clear) has gone:
  // the chip now at `index` (or the one before it), else the Seva button (index -1).
  const chipRefs = useRef(new Map<string, HTMLButtonElement>());
  const refocus = useRef<number | null>(null);

  useLayoutEffect(() => {
    const index = refocus.current;
    if (index === null) return;
    refocus.current = null;
    const chip = index >= 0 && shown.length > 0 ? chipRefs.current.get(shown[Math.min(index, shown.length - 1)]) : null;
    (chip ?? triggerRef.current)?.focus({ preventScroll: true });
  }, [shown]);

  // Every option, plus picked values nobody has (an old link), so they can be removed.
  const all = useMemo((): SevaOption[] => {
    const known = new Set(options.map((o) => o.value));
    const extra = [...new Set([...shown, ...draft])].filter((v) => !known.has(v));
    return [...options, ...extra.map((value) => ({ value, label: value, count: 0, isTeam: false }))];
  }, [options, shown, draft]);
  const byValue = useMemo(() => new Map(all.map((o) => [o.value, o])), [all]);
  const order = useMemo(() => new Map(all.map((o, i) => [o.value, i])), [all]);

  /**
   * `focusAfter`: the bar control that asked for this is about to unmount, so focus the chip
   * at that index once the bar re-renders (-1 = the Seva button). The picker handles its own.
   */
  function apply(next: readonly string[], focusAfter?: number) {
    const sorted = [...next].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    // Against what's shown: a pick still on its way counts as made.
    if (sameSelection(sorted, shown)) return;
    refocus.current = focusAfter ?? null;
    startTransition(() => {
      setShown(sorted);
      // The live address: pages may have rewritten their own params (the directory's ?q=...).
      const { pathname, search, hash } = window.location;
      router.replace(withSevaFilter(`${pathname}${search}${hash}`, sorted), { scroll: false });
    });
  }

  function openPicker() {
    setDraft(shown);
    setOpen(window.matchMedia("(min-width: 768px)").matches ? "popover" : "sheet");
  }

  /** Closing, however it happens, keeps the picks. The sheet returns focus itself. */
  function closePicker() {
    const wasPopover = open === "popover";
    setOpen(null);
    apply(draft);
    if (wasPopover) triggerRef.current?.focus({ preventScroll: true });
  }

  function toggle(value: string) {
    setDraft((d) =>
      d.includes(value) ? d.filter((v) => v !== value) : d.length >= MAX_SEVA_FILTER ? d : [...d, value],
    );
  }

  const picker = <Picker options={all} draft={draft} onToggle={toggle} />;
  const footer = <PickerFooter draft={draft} current={shown} onClear={() => setDraft([])} onDone={closePicker} />;

  return (
    <div
      role="group"
      aria-label="Seva filter"
      aria-busy={pending || undefined}
      className="flex flex-wrap items-center gap-2"
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? closePicker() : openPicker())}
        aria-haspopup="dialog"
        aria-expanded={open !== null}
        aria-label={shown.length === 0 ? "Seva: all sevas" : `Seva: ${shown.length} picked`}
        className={TRIGGER}
      >
        <ListFilter aria-hidden="true" className="h-4 w-4 text-ink-500" />
        Seva
        {shown.length === 0 ? (
          <span className="font-medium text-ink-600">All sevas</span>
        ) : (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-coral-700 px-1.5 text-[11px] font-bold leading-none text-white">
            {shown.length}
          </span>
        )}
        {pending ? (
          <LoaderCircle aria-hidden="true" className="h-4 w-4 text-ink-500 motion-safe:animate-spin" />
        ) : (
          <ChevronDown aria-hidden="true" className="h-4 w-4 text-ink-500" />
        )}
      </button>

      {shown.length > 0 && (
        <ul aria-label="Picked sevas" className="flex min-w-0 max-w-full flex-wrap gap-2">
          {shown.map((value, index) => {
            const label = byValue.get(value)?.label ?? value;
            return (
              <li key={value} className="min-w-0 max-w-full">
                <button
                  ref={(el) => {
                    if (el) chipRefs.current.set(value, el);
                    else chipRefs.current.delete(value);
                  }}
                  type="button"
                  onClick={() => apply(shown.filter((v) => v !== value), index)}
                  aria-label={`Remove seva: ${label}`}
                  className={PICKED_CHIP}
                >
                  <span className="truncate">{label}</span>
                  <X aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {shown.length > 1 && (
        <button
          type="button"
          onClick={() => apply([], -1)}
          aria-label="Clear the seva filter"
          className="relative rounded text-sm font-semibold text-coral-800 underline-offset-2 before:absolute before:-inset-x-2 before:-inset-y-3 before:content-[''] hover:underline focus-visible:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral-600"
        >
          Clear
        </button>
      )}

      <Sheet open={open === "sheet"} onClose={closePicker} title={TITLE} description={DESCRIPTION}>
        <SheetBody>{picker}</SheetBody>
        <SheetFooter>{footer}</SheetFooter>
      </Sheet>
      {open === "popover" && (
        <Popover anchorRef={triggerRef} onClose={closePicker} footer={footer}>
          {picker}
        </Popover>
      )}
    </div>
  );
}

/** Clear, and Apply / Done, under the picker (main action last). */
function PickerFooter({
  draft,
  current,
  onClear,
  onDone,
}: {
  draft: readonly string[];
  current: readonly string[];
  onClear: () => void;
  onDone: () => void;
}) {
  const label = sameSelection(draft, current)
    ? "Done"
    : draft.length === 0
      ? "Show all sevas"
      : `Apply ${draft.length} ${draft.length === 1 ? "seva" : "sevas"}`;
  return (
    <>
      <button
        type="button"
        onClick={onClear}
        disabled={draft.length === 0}
        className={`${BTN_SECONDARY} flex-1 md:flex-none`}
      >
        Clear
      </button>
      <button type="button" onClick={onDone} className={`${BTN_PRIMARY} flex-[2] md:flex-none`}>
        {label}
      </button>
    </>
  );
}

/** Search box, then the sevas as toggle chips with head counts: breakout teams, then other sevas. */
function Picker({
  options,
  draft,
  onToggle,
}: {
  options: readonly SevaOption[];
  draft: readonly string[];
  onToggle: (value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim();
  const full = draft.length >= MAX_SEVA_FILTER;

  const groups = [
    { legend: "Breakout teams", options: options.filter((o) => o.isTeam && matches(o, q)) },
    { legend: "Other sevas", options: options.filter((o) => !o.isTeam && matches(o, q)) },
  ].filter((g) => g.options.length > 0);

  return (
    <div className="space-y-5">
      {options.length >= SEARCH_FROM && (
        <div className="relative">
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
                // Escape clears the search first; the next one closes the picker. The
                // picker's own Escape listeners sit on the document after React's.
                e.preventDefault();
                e.nativeEvent.stopImmediatePropagation();
                setQuery("");
              }
            }}
            placeholder="Search sevas"
            aria-label="Search sevas"
            maxLength={80}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            className={`${INPUT} pl-10 [&::-webkit-search-cancel-button]:appearance-none`}
          />
        </div>
      )}

      {groups.length === 0 ? (
        <p className="py-2 text-sm text-ink-600">No sevas match &ldquo;{q}&rdquo;.</p>
      ) : (
        groups.map((group) => (
          <fieldset key={group.legend}>
            <legend className={LABEL}>{group.legend}</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {group.options.map((option) => {
                const on = draft.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={on}
                    disabled={!on && full}
                    onClick={() => onToggle(option.value)}
                    className={`${CHIP} ${on ? CHIP_ON : option.count === 0 ? CHIP_EMPTY : CHIP_OFF} max-w-full disabled:opacity-50`}
                  >
                    <span className="break-words">{option.label}</span>
                    <span className={chipCount(on)}>
                      {option.count}
                      <span className="sr-only"> {option.count === 1 ? "person" : "people"}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))
      )}
      {full && <p className="text-xs text-ink-600">Up to {MAX_SEVA_FILTER} sevas at a time. Remove one to pick another.</p>}
    </div>
  );
}

type Placement = { left: number; width: number; maxHeight: number; top?: number; bottom?: number };

/**
 * The picker from md up: a panel under the Seva button (above it when there's more room
 * there), in a portal on <body> so the pages' `stagger` animation (which leaves a transform,
 * and so a stacking context, on every block) can't paint later cards over it. A clear layer
 * behind it takes the click that closes it (so that click doesn't also land on a link or a
 * tab), the app stops scrolling so it stays attached, and focus moves in (to the search box
 * when there is one) and stays in until it closes.
 */
function Popover({
  anchorRef,
  onClose,
  footer,
  children,
}: {
  anchorRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  footer: ReactNode;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const [place, setPlace] = useState<Placement | null>(null);
  // Latest onClose for the listeners registered once.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useAppScrollLock(true);

  useLayoutEffect(() => {
    function measure() {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const r = anchor.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const width = Math.min(POPOVER_WIDTH, vw - 2 * EDGE);
      const left = Math.min(Math.max(r.left, EDGE), vw - width - EDGE);
      const below = vh - r.bottom - GAP - NAV_CLEARANCE;
      const above = r.top - GAP - EDGE;
      const up = below < POPOVER_MIN_HEIGHT && above > below;
      const maxHeight = Math.max(200, Math.min(POPOVER_MAX_HEIGHT, up ? above : below));
      setPlace(
        up ? { left, width, maxHeight, bottom: vh - r.top + GAP } : { left, width, maxHeight, top: r.bottom + GAP },
      );
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [anchorRef]);

  // Once placed (it renders hidden until measured): focus in and animate.
  const placed = place !== null;
  useEffect(() => {
    const panel = panelRef.current;
    if (!placed || !panel) return;
    (panel.querySelector<HTMLElement>('input[type="search"]') ?? panel).focus({ preventScroll: true });
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches && typeof panel.animate === "function") {
      panel.animate(
        [
          { opacity: 0, transform: "translateY(-4px) scale(0.98)" },
          { opacity: 1, transform: "none" },
        ],
        { duration: 160, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
      );
    }
  }, [placed]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const panel = panelRef.current;
      if (!panel) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.getClientRects().length > 0,
      );
      if (items.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return createPortal(
    <>
      <div aria-hidden="true" className="fixed inset-0 z-[59]" onClick={() => onCloseRef.current()} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        tabIndex={-1}
        style={
          place
            ? { left: place.left, width: place.width, maxHeight: place.maxHeight, top: place.top, bottom: place.bottom }
            : { visibility: "hidden" }
        }
        className="fixed z-[60] flex flex-col overflow-hidden rounded-3xl border border-ink-800/10 bg-sand-50 shadow-card-lg outline-none"
      >
        <div className="flex shrink-0 items-start gap-3 px-5 pb-3 pt-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="font-display text-xl leading-snug text-ink-900">
              {TITLE}
            </h2>
            <p id={descId} className="mt-0.5 text-xs leading-relaxed text-ink-600">
              {DESCRIPTION}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onCloseRef.current()}
            aria-label="Close"
            className="-mr-2.5 -mt-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-500 transition hover:bg-ink-800/5 hover:text-ink-900 focus-visible:outline-2 focus-visible:outline-coral-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-ink-800/8 px-5 py-4">
          {children}
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-ink-800/8 bg-sand-50 px-5 py-3">{footer}</div>
      </div>
    </>,
    document.body,
  );
}
