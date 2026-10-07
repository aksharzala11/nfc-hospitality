"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * The same-URL history entry an open overlay pushes, so Back (Android, Telegram's back, a
 * swipe) closes the overlay instead of leaving the page. The bookkeeping is MoreSheet's,
 * without its "a link is navigating" case: nothing in the photo viewer leads anywhere.
 */
type OverlayEntry = {
  /** URL the entry was pushed on; null until pushed. */
  href: string | null;
  /** The entry is gone (Back was pressed, or the overlay popped it itself). */
  popped: boolean;
  /** The overlay is mounted (StrictMode unmounts and remounts it once in development). */
  alive: boolean;
};

/**
 * True while the browser is still on the overlay's entry. Compared by URL, not by a marker in
 * history.state: Next's router.refresh() (AutoRefresh, every minute) rewrites that state.
 */
function onOverlayEntry(entry: OverlayEntry) {
  return entry.href !== null && !entry.popped && window.location.href === entry.href;
}

/**
 * Call from a component that is mounted exactly while its overlay is open. Back then calls
 * `onClose`; the returned function closes from inside (Close, Escape) and drops the entry the
 * overlay pushed, so history is left as it was found.
 */
export function useBackToClose(onClose: () => void): () => void {
  const entry = useRef<OverlayEntry>({ href: null, popped: false, alive: false });
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const e = entry.current;
    e.alive = true;
    if (e.href === null) {
      e.href = window.location.href;
      // The state is Next's own (its __NA flag makes the router's pushState patch pass it
      // straight through), so popping back to the page's entry is a no-op restore of this page.
      window.history.pushState({ ...window.history.state, hhPhotoViewer: true }, "");
    }
    function onPopState() {
      e.popped = true;
      onCloseRef.current();
    }
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      e.alive = false;
      // Unmounted without popping the entry (the page went away under it): drop it. StrictMode
      // remounts straight away, so wait a microtask to tell a real unmount from its rehearsal.
      queueMicrotask(() => {
        if (e.alive || !onOverlayEntry(e)) return;
        e.popped = true;
        window.history.back();
      });
    };
  }, []);

  return useCallback(() => {
    const e = entry.current;
    onCloseRef.current();
    if (onOverlayEntry(e)) {
      e.popped = true;
      window.history.back();
    }
  }, []);
}
