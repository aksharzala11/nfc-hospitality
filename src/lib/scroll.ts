import { useEffect } from "react";

/**
 * Scrolling for the signed-in views goes through ONE container, #app-scroll, instead of the
 * document. Why: Telegram's iOS in-app browser places the page below its floating ✕ / address / ⋯
 * controls but doesn't clip it, so anything the document scrolls past the top keeps painting
 * behind those controls. A real overflow container clips its content at its own edge, so nothing
 * can show above the header.
 *
 * Every screen renders #app-scroll through <AppScroll> (the delegate, Santo and admin layouts,
 * login and the 404). Client-only helpers (call them from effects/handlers); they fall back to
 * the window only for a page without that shell, so callers never need to know which.
 */
export const SCROLLER_ID = "app-scroll";

export function getScroller(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.getElementById(SCROLLER_ID);
}

/** Current scroll offset of the app (container or window). */
export function getScrollTop(): number {
  const el = getScroller();
  return el ? el.scrollTop : window.scrollY;
}

export function scrollAppTo(top: number, behavior: ScrollBehavior = "smooth") {
  (getScroller() ?? window).scrollTo({ top, behavior });
}

/** Subscribe to the app's scroll events; returns the unsubscribe function. */
export function onAppScroll(handler: () => void): () => void {
  const target: HTMLElement | Window = getScroller() ?? window;
  target.addEventListener("scroll", handler, { passive: true });
  return () => target.removeEventListener("scroll", handler);
}

let locks = 0;
let savedOverflow = "";
let lockedEl: HTMLElement | null = null;

/**
 * Stop the app from scrolling (sheets, full-screen readers). Nested locks are counted; the
 * returned function releases this one.
 */
export function lockAppScroll(): () => void {
  if (locks === 0) {
    lockedEl = getScroller() ?? document.body;
    savedOverflow = lockedEl.style.overflow;
    lockedEl.style.overflow = "hidden";
  }
  locks += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    locks -= 1;
    if (locks === 0 && lockedEl) {
      lockedEl.style.overflow = savedOverflow;
      lockedEl = null;
    }
  };
}

/** Hook form of lockAppScroll(): locked while `active` is true. */
export function useAppScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    return lockAppScroll();
  }, [active]);
}
