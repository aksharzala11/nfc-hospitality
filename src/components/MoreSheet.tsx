"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ChevronRight, LoaderCircle, X } from "lucide-react";
import { useAppScrollLock } from "@/lib/scroll";
import type { NavIcon, NavTone } from "@/components/BottomNav";

/** A destination listed in the More sheet. */
export type MoreItem = {
  /** Plain path, without a query string. */
  href: string;
  label: string;
  /** One short line under the label. */
  description: string;
  icon: NavIcon;
  /** Icon tile: background + icon colour, from the Sāchu palette (3:1 for the icon). */
  tint: string;
  /** Listed in a second group after the destinations (profile & sign out). */
  account?: boolean;
};

/** True when `pathname` is `href` or (unless `exact`) one of its sub-paths. */
export function isCurrentPath(pathname: string, href: string, exact = false) {
  return pathname === href || (!exact && pathname.startsWith(`${href}/`));
}

/** The row of the page you're on, in the view's accent. */
const HERE: Record<NavTone, { row: string; text: string }> = {
  coral: { row: "bg-coral-50", text: "text-coral-800" },
  bhagwa: { row: "bg-coral-50", text: "text-ember-700" },
  console: { row: "bg-ink-50", text: "text-ink-900" },
};

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';
const EASE_IN = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const EASE_OUT = "cubic-bezier(0.4, 0, 1, 1)";
/** How long a tapped row shows "Opening" before the sheet gives up waiting for the page. */
const NAV_WAIT_MS = 8000;

/**
 * The same-URL history entry the open sheet pushes, so Back (Android, Telegram's back, a
 * swipe) closes the sheet instead of leaving the page, or closing Telegram's browser on the
 * first page a guest opened.
 */
type SheetEntry = {
  /** URL the entry was pushed on; null until pushed. */
  href: string | null;
  /** The entry is gone (Back was pressed, or the sheet popped it itself). */
  popped: boolean;
  /** A link in the sheet is replacing the entry with its page (Link `replace`). */
  navigating: boolean;
  /** The panel is mounted (StrictMode unmounts and remounts it once in development). */
  alive: boolean;
};

/**
 * True while the browser is still on the sheet's entry. Compared by URL, not by a marker in
 * history.state: Next's router.refresh() (AutoRefresh, every minute) rewrites that state.
 */
function onSheetEntry(entry: SheetEntry) {
  return entry.href !== null && !entry.popped && window.location.href === entry.href;
}

type MoreSheetProps = {
  open: boolean;
  onClose: () => void;
  /** id of the dialog, for the More tab's aria-controls. */
  id: string;
  items: MoreItem[];
  pathname: string;
  /** "?now=…" while time travelling, otherwise "". */
  suffix: string;
  tone: NavTone;
};

/**
 * Bottom sheet behind the nav's More tab: every destination that has no tab of its
 * own, with an icon and one line each, so the bar covers the whole view.
 *
 * Portalled to <body> (a transformed ancestor would otherwise capture position: fixed),
 * above the header and the nav. Focus moves into it and stays there; Escape, the
 * backdrop, the close button, a swipe down on its top edge and Back close it. Tapping a
 * page keeps it up with that row marked "Opening" until the new page arrives (BottomNav
 * then unmounts it), so a slow load never looks like a missed tap. The app scroller is
 * locked while it's open (useAppScrollLock).
 */
export function MoreSheet(props: MoreSheetProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || !props.open) return null;
  return createPortal(<MorePanel {...props} />, document.body);
}

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function MorePanel({ onClose, id, items, pathname, suffix, tone }: MoreSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  const closing = useRef(false);
  const drag = useRef<{ id: number; y0: number; t0: number; dy: number } | null>(null);
  const entry = useRef<SheetEntry>({ href: null, popped: false, navigating: false, alive: false });
  /** The row whose page is loading (shown as "Opening"). */
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const stopWaiting = useRef<number | undefined>(undefined);

  useAppScrollLock(true);

  /** Slide away (unless reduced motion), then close. `from`: the current drag offset. */
  function dismiss(from = 0) {
    if (closing.current) return;
    closing.current = true;
    const panel = panelRef.current;
    const close = () => onCloseRef.current();
    if (!panel || typeof panel.animate !== "function" || reducedMotion()) {
      close();
      return;
    }
    const slide = panel.animate(
      [{ transform: `translateY(${from}px)` }, { transform: "translateY(100%)" }],
      { duration: 200, easing: EASE_OUT, fill: "forwards" },
    );
    backdropRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: EASE_OUT, fill: "forwards" });
    slide.finished.then(close, close);
  }

  /**
   * Close from inside the sheet: slide away and drop the history entry it pushed. Ignored
   * once closing, and while a row's page loads: popping the entry then would make Next
   * restore this page and discard the navigation the guest just chose (a double tap, or
   * Escape). Back still works then, through the popstate handler below.
   */
  function requestClose(from = 0) {
    if (closing.current || entry.current.navigating) return;
    dismiss(from);
    const e = entry.current;
    if (onSheetEntry(e)) {
      e.popped = true;
      window.history.back();
    }
  }
  const requestCloseRef = useRef(requestClose);
  const dismissRef = useRef(dismiss);
  useEffect(() => {
    requestCloseRef.current = requestClose;
    dismissRef.current = dismiss;
  });

  // Push a same-URL history entry so Back closes the sheet. The state is Next's own (its
  // __NA flag makes the router's pushState patch pass it straight through), so popping back
  // to the page's entry is a no-op restore of the same page.
  useEffect(() => {
    const e = entry.current;
    e.alive = true;
    if (e.href === null) {
      e.href = window.location.href;
      window.history.pushState({ ...window.history.state, hhMoreSheet: true }, "");
    }
    function onPopState() {
      e.popped = true;
      // Back while a row's page loads: Next restores this page and drops that navigation.
      e.navigating = false;
      window.clearTimeout(stopWaiting.current);
      dismissRef.current();
    }
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      window.clearTimeout(stopWaiting.current);
      e.alive = false;
      // Closed without popping the entry (the nav unmounted): drop it. StrictMode remounts
      // straight away, so wait a microtask to tell a real unmount from its rehearsal.
      queueMicrotask(() => {
        if (e.alive || e.navigating || !onSheetEntry(e)) return;
        e.popped = true;
        window.history.back();
      });
    };
  }, []);

  function onLinkClick(event: ReactMouseEvent<HTMLAnchorElement>, href: string, thisPage: boolean) {
    // Closing, or a page is already on its way: a second tap must not start another.
    if (closing.current || entry.current.navigating) {
      event.preventDefault();
      return;
    }
    // Opening in a new tab or window: this tab stays on its page.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      requestClose();
      return;
    }
    // Already on it: nothing to load (navigating would leave a duplicate history entry).
    if (thisPage) {
      event.preventDefault();
      requestClose();
      return;
    }
    // The Link replaces the sheet's entry with the new page, so history ends up
    // [this page, new page] and Back from there returns here. The sheet stays up, the row
    // marked "Opening", until the page commits: BottomNav unmounts it when the pathname
    // changes. Sliding it away first would show the old page again for as long as the
    // (dynamic) page takes on venue Wi-Fi, which reads as a missed tap.
    entry.current.navigating = true;
    setPendingHref(href);
    // The page never came (offline, a redirect back here): make the sheet usable again.
    // Closing it then pops the entry, which also drops the navigation if it's still pending.
    window.clearTimeout(stopWaiting.current);
    stopWaiting.current = window.setTimeout(() => {
      entry.current.navigating = false;
      setPendingHref(null);
    }, NAV_WAIT_MS);
  }

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.focus({ preventScroll: true });

    if (!reducedMotion() && typeof panel.animate === "function") {
      panel.animate([{ transform: "translateY(100%)" }, { transform: "translateY(0)" }], { duration: 280, easing: EASE_IN });
      backdropRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: EASE_IN });
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        requestCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    };
  }, []);

  // Swipe down on the sheet's top edge (handle + title row) to close it.
  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || closing.current || entry.current.navigating) return;
    // Leave the close button alone: capturing the pointer would steal its click.
    if ((e.target as Element).closest("button, a")) return;
    drag.current = { id: e.pointerId, y0: e.clientY, t0: performance.now(), dy: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    const panel = panelRef.current;
    if (!d || d.id !== e.pointerId || !panel) return;
    d.dy = Math.max(0, e.clientY - d.y0);
    panel.style.transform = d.dy ? `translateY(${d.dy}px)` : "";
  }
  function onPointerEnd(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    const panel = panelRef.current;
    if (!d || d.id !== e.pointerId || !panel) return;
    drag.current = null;
    const speed = d.dy / Math.max(1, performance.now() - d.t0); // px per ms
    panel.style.transform = "";
    if (e.type === "pointerup" && (d.dy > 96 || (d.dy > 24 && speed > 0.5))) {
      requestClose(d.dy);
    } else if (d.dy > 0 && !reducedMotion() && typeof panel.animate === "function") {
      panel.animate([{ transform: `translateY(${d.dy}px)` }, { transform: "translateY(0)" }], {
        duration: 180,
        easing: EASE_IN,
      });
    }
  }

  const here = HERE[tone];
  const groups = [items.filter((i) => !i.account), items.filter((i) => i.account)].filter((g) => g.length > 0);

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center">
      <div
        ref={backdropRef}
        aria-hidden="true"
        className="absolute inset-0 touch-none bg-ink-950/45"
        onClick={() => requestClose()}
      />
      <div
        ref={panelRef}
        id={id}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative flex max-h-[85dvh] w-full max-w-md flex-col rounded-t-[1.75rem] bg-sand-100 shadow-card-lg outline-none"
      >
        {/* Top edge: grab handle, title and close; drag it down to dismiss. */}
        <div
          className="shrink-0 touch-none select-none px-5 pt-2.5"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
        >
          <div aria-hidden="true" className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-ink-800/20" />
          <div className="flex items-center justify-between gap-3">
            <h2 id={titleId} className="font-display text-[1.625rem] leading-tight text-ink-900">
              More
            </h2>
            <button
              type="button"
              onClick={() => requestClose()}
              aria-label="Close"
              className="-mr-2.5 flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink-600 transition hover:bg-ink-800/5 hover:text-ink-900 focus-visible:outline-2 focus-visible:outline-ink-800"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto overscroll-contain px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-2">
          {groups.map((group, g) => (
            <ul
              key={g}
              className="mb-3 divide-y divide-sand-200 overflow-hidden rounded-3xl border border-white/80 bg-white shadow-card last:mb-0"
            >
              {group.map(({ href, label, description, icon: Icon, tint }) => {
                const current = isCurrentPath(pathname, href);
                const pending = pendingHref === href;
                return (
                  <li key={href}>
                    <Link
                      href={`${href}${suffix}`}
                      replace
                      aria-current={current ? "page" : undefined}
                      aria-busy={pending || undefined}
                      onClick={(e) => onLinkClick(e, href, pathname === href)}
                      className={`group flex min-h-16 items-center gap-3 px-3.5 py-3 transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink-800 ${
                        current ? here.row : pending ? "bg-sand-50" : "hover:bg-sand-50 active:bg-sand-100"
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${tint}`}
                      >
                        <Icon className="h-5 w-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-semibold leading-snug text-ink-900">{label}</span>
                        <span className="mt-0.5 block text-xs leading-snug text-ink-600">{description}</span>
                      </span>
                      {pending ? (
                        <span className="flex shrink-0 items-center gap-1 text-[10px] font-bold uppercase tracking-caps text-ink-600">
                          <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 motion-safe:animate-spin" />
                          Opening
                        </span>
                      ) : current ? (
                        <span className={`shrink-0 text-[10px] font-bold uppercase tracking-caps ${here.text}`}>
                          You&rsquo;re here
                        </span>
                      ) : (
                        <ChevronRight
                          aria-hidden="true"
                          className="h-4 w-4 shrink-0 text-ink-400 transition group-hover:translate-x-0.5 group-hover:text-ink-700 motion-reduce:transition-none"
                        />
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          ))}
        </div>
      </div>
    </div>
  );
}
