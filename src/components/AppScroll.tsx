"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { SCROLLER_ID } from "@/lib/scroll";

/** Last offset of each URL (path + query) this tab has scrolled, for back/forward. */
const positions = new Map<string, number>();
/**
 * Set by a back/forward traversal: the offset to put the page at once it renders. Taken from
 * `positions` at the popstate itself, so a scroll event that lands before the new page commits
 * (the old page's momentum, now under the new URL) can't overwrite it.
 */
let pendingRestore: { path: string; top: number } | null = null;

const urlKey = () => window.location.pathname + window.location.search;

/**
 * Desktop keys (Space, Page Down, arrows) scroll whatever has focus, and the pinned document no
 * longer scrolls, so with focus on <body> (a fresh load) or on a clicked header/nav link they'd
 * do nothing: hand focus to the scroller then. Focus the user placed with the keyboard
 * (:focus-visible) stays put, and touch devices are left alone so screen-reader focus isn't moved.
 */
function focusForKeys(el: HTMLElement) {
  if (!window.matchMedia("(pointer: fine)").matches) return;
  const active = document.activeElement;
  if (active && active !== document.body) {
    if (el.contains(active)) return;
    try {
      if (active.matches(":focus-visible")) return;
    } catch {
      // No :focus-visible (Safari < 15.4): treat it as a pointer focus.
    }
  }
  el.focus({ preventScroll: true });
}

/**
 * The app's one scroll container, #app-scroll (see `.app-shell` in globals.css and
 * src/lib/scroll.ts). Goes inside an `.app-shell` element, below the header; everything that
 * scrolls lives in here, and floating chrome (bottom nav, back-to-top, sheets) stays outside as
 * position: fixed.
 *
 * The browser only resets and restores the document's scroll on navigation, not a container's,
 * so this does both itself: a new page opens at the top (unless the URL targets a #fragment),
 * and back/forward returns to where that page was left. It runs as a layout effect, before the
 * new page's own effects, so a page that scrolls itself on arrival (the schedule jumping to
 * "now") still wins.
 */
export function AppScroll({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  // null until the first layout effect, so a layout mounting on a back/forward (delegate hub to
  // admin console, say) restores too.
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => positions.set(urlKey(), el.scrollTop);
    const onPop = () => {
      pendingRestore = { path: window.location.pathname, top: positions.get(urlKey()) ?? 0 };
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("popstate", onPop);
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  useLayoutEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    // Only a traversal to this very path restores; a stale one (a back/forward that changed only
    // the query) is dropped here.
    const restore = pendingRestore?.path === window.location.pathname ? pendingRestore.top : 0;
    pendingRestore = null;
    const el = ref.current;
    if (!el) return;
    if (!window.location.hash) el.scrollTop = restore;
    // After this frame's rendering step, so an autofocus field (login) or a page's own focus
    // effect gets there first and is left alone. Not cancelled on cleanup: Strict Mode's
    // mount/unmount/mount would drop it, and focusing a detached node does nothing anyway.
    requestAnimationFrame(() => focusForKeys(el));
  }, [pathname]);

  return (
    <div
      id={SCROLLER_ID}
      ref={ref}
      tabIndex={-1}
      className={`app-scroll${className ? ` ${className}` : ""}`}
    >
      {children}
    </div>
  );
}
