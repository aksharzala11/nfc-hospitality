"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { getScroller } from "@/lib/scroll";
import { yearAnchor, type HistoryYearInfo } from "@/lib/history";
import { isKeyboardClick, isPlainClick, jumpToId } from "./HistoryJump";
import styles from "./history.module.css";

/** How far under the strip the "which year am I in" line sits. */
const ACTIVE_GAP = 8;
/** Stands in for "however far above": a root margin that reaches past the top of the page. */
const ABOVE = 100000;
/** From an entry's top edge to the middle of its dot on the line (.dot: top 8px, 10px tall). */
const DOT_CENTRE = 13;
/**
 * How far above the bottom nav's zone a year's heading is when its numeral settles into place:
 * with the zone (the page's bottom padding, a little more than the nav itself) that puts the
 * whole numeral, 64px tall and 16px low until it settles, in view above the nav.
 */
const SEEN_CLEARANCE = 72;
/** The nav's zone when the page's bottom padding can't be read: the hub layout's 7rem. */
const NAV_ZONE = 112;

/**
 * The sticky strip of years on the History page, and the page's only script for the timeline.
 *
 * The strip is plain `#year-…` links (they work without JavaScript); with it a tap jumps at
 * once through the app's scroller and focus moves to that year's heading.
 *
 * One effect runs three IntersectionObservers on the app's scroller (never a scroll listener):
 *  - passed: an entry's dot is above the reading line, half a screen down, where the CSS-drawn
 *    coral line ends (history.module.css): the dot is lit (data-passed). It follows the line
 *    both ways: scroll back up and the dots the line has left go out with it;
 *  - seen: a year's numeral has come into view, clear of the bottom nav: it settles into place
 *    (data-seen), once;
 *  - active: the year whose block is under the strip is the current one (aria-current, and
 *    the strip re-centres on it with its own scrollTo, never a scroll-into-view call, which could
 *    move the page).
 * The flags are data attributes set by hand on server-rendered elements, so they survive the
 * hub's AutoRefresh re-render (the ScheduleView precedent). The page's base CSS is the finished
 * state; the unlit / unsettled look applies only under data-live, which is set after everything
 * already above its line has been marked, so nothing flashes. Reduced motion: no passed / seen
 * and no data-live (the page stays in its finished state); the strip still follows.
 */
export function HistoryNav({ years }: { years: HistoryYearInfo[] }) {
  const navRef = useRef<HTMLElement>(null);
  const rowRef = useRef<HTMLOListElement>(null);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const nav = navRef.current;
    const root = nav?.closest<HTMLElement>("[data-history-root]");
    const scroller = getScroller();
    if (!nav || !root || !scroller || !("IntersectionObserver" in window)) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let observers: IntersectionObserver[] = [];

    const build = () => {
      observers.forEach((o) => o.disconnect());
      observers = [];

      const height = scroller.clientHeight;
      const scrollerTop = () => scroller.getBoundingClientRect().top;
      const offsetOf = (el: Element) => el.getBoundingClientRect().top - scrollerTop();

      // ── active: a 1px band a little under the strip; the year block on it is the current one.
      const band = nav.offsetHeight + ACTIVE_GAP;
      const yearBlocks = Array.from(root.querySelectorAll<HTMLElement>("[data-history-year]"));
      const findActive = () => {
        let current: number | null = null;
        for (const block of yearBlocks) {
          if (offsetOf(block) > band) break;
          current = Number(block.dataset.historyYear);
        }
        setActive(current);
      };
      findActive();
      const activeObserver = new IntersectionObserver(findActive, {
        root: scroller,
        // Never negative-of-negative: a margin below zero height throws.
        rootMargin: `-${band}px 0px -${Math.max(0, height - band - 1)}px 0px`,
      });
      yearBlocks.forEach((block) => activeObserver.observe(block));
      observers.push(activeObserver);

      if (reduce.matches) {
        root.removeAttribute("data-live");
        return;
      }

      // Both observers' roots reach far above the scroller, so "above the line" counts however
      // far above it is (an instant jump past an entry never shows it crossing the line).

      // ── passed: the dots follow the coral line, both ways. The reading line is half the
      // window's height below the scroller's top, where the CSS line's tip sticks (top: 50dvh);
      // a dot is lit while its middle is above it. The observer only says "an entry crossed":
      // every dot is then set from where its entry is now (27 rects read, then written).
      const dotLine = Math.max(0, Math.round(window.innerHeight * 0.5) - DOT_CENTRE);
      const entryItems = Array.from(root.querySelectorAll<HTMLElement>("[data-history-entry]"));
      const markPassed = () => {
        const passed = entryItems.map((el) => offsetOf(el) <= dotLine);
        entryItems.forEach((el, i) => el.toggleAttribute("data-passed", passed[i]));
      };
      markPassed();
      const passedObserver = new IntersectionObserver(markPassed, {
        root: scroller,
        rootMargin: `${ABOVE}px 0px -${Math.max(0, height - dotLine)}px 0px`,
      });
      entryItems.forEach((el) => passedObserver.observe(el));
      observers.push(passedObserver);

      // ── seen: a numeral settles once, when it is in view above the bottom nav (which lies
      // over the foot of the scroller: a numeral that settled behind it would never be seen
      // doing so). Whatever comes before one that has been seen has been seen too.
      // How much of the scroller's foot the nav takes is read from the page's own bottom
      // padding, which the hub layout sets to clear it (safe area included): it is there from
      // the first paint, while the nav itself may still be streaming in when this runs.
      const main = root.closest("main");
      const covered = (main && parseFloat(window.getComputedStyle(main).paddingBottom)) || NAV_ZONE;
      const seenLine = Math.max(0, height - covered - SEEN_CLEARANCE);
      const heads = Array.from(root.querySelectorAll<HTMLElement>("[data-history-year] h3"));
      const markSeen = (upTo: number) => {
        for (let i = 0; i <= upTo; i++) heads[i].setAttribute("data-seen", "");
      };
      let lastSeen = -1;
      heads.forEach((el, i) => {
        if (el.hasAttribute("data-seen") || offsetOf(el) < seenLine) lastSeen = i;
      });
      markSeen(lastSeen);
      if (lastSeen < heads.length - 1) {
        const seenObserver = new IntersectionObserver(
          (entries) => {
            let reached = -1;
            for (const entry of entries) {
              const rootTop = entry.rootBounds?.top ?? scrollerTop();
              if (entry.isIntersecting || entry.boundingClientRect.top < rootTop) {
                reached = Math.max(reached, heads.indexOf(entry.target as HTMLElement));
                seenObserver.unobserve(entry.target);
              }
            }
            markSeen(reached);
          },
          { root: scroller, rootMargin: `${ABOVE}px 0px -${Math.round(Math.max(0, height - seenLine))}px 0px` },
        );
        heads.slice(lastSeen + 1).forEach((el) => seenObserver.observe(el));
        observers.push(seenObserver);
      }

      // Only now: everything already above its line is marked, so nothing flashes.
      root.setAttribute("data-live", "");
    };

    // Rebuild when the scroller's box changes (the phone is turned, the browser's bars move) or
    // the motion preference does; the first resize report repeats what build() just read.
    let sized = `${scroller.clientHeight}:${window.innerHeight}`;
    build();
    const rebuild = () => {
      const now = `${scroller.clientHeight}:${window.innerHeight}`;
      if (now === sized) return;
      sized = now;
      build();
    };
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(rebuild);
    resize?.observe(scroller);
    reduce.addEventListener?.("change", build);

    return () => {
      observers.forEach((o) => o.disconnect());
      resize?.disconnect();
      reduce.removeEventListener?.("change", build);
    };
  }, []);

  // Keep the current year in the middle of the strip.
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const link = active === null ? null : row.querySelector<HTMLElement>(`[data-year="${active}"]`);
    const left = link ? link.offsetLeft - (row.clientWidth - link.offsetWidth) / 2 : 0;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    row.scrollTo({ left: Math.max(0, left), behavior: smooth ? "smooth" : "auto" });
  }, [active]);

  return (
    <nav
      ref={navRef}
      aria-label="Jump to a year"
      // Opaque, and above the timeline's dots and mats; bled to the page's edges.
      className="sticky top-0 z-10 -mx-4 h-12 border-b border-sand-300 bg-sand-100"
    >
      <ol ref={rowRef} className={`h-full px-4 ${styles.stripRow}`}>
        {years.map((y) => {
          const current = active === y.year;
          return (
            <Fragment key={y.year}>
              {y.startsPart && y.part > 1 && (
                <li aria-hidden="true" className="mx-1.5 my-3.5 w-px shrink-0 bg-sand-300" />
              )}
              <li className="shrink-0">
                <a
                  href={`#${yearAnchor(y.year)}`}
                  data-year={y.year}
                  aria-current={current ? "location" : undefined}
                  onClick={(event) => {
                    if (isPlainClick(event) && jumpToId(yearAnchor(y.year), isKeyboardClick(event))) {
                      event.preventDefault();
                    }
                  }}
                  className={`relative flex h-full min-w-11 items-center justify-center px-2.5 text-sm font-semibold tabular-nums focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink-800 ${
                    current ? "text-ink-900" : "text-ink-600"
                  }`}
                >
                  {y.year}
                  {y.hasPhotos && (
                    <>
                      <span aria-hidden="true" className="ml-1 h-1.5 w-1.5 rounded-full bg-coral-500" />
                      <span className="sr-only">, photographs</span>
                    </>
                  )}
                  {current && (
                    // coral-700, not the dots' coral-500: a state indicator needs 3:1 on the sand.
                    <span aria-hidden="true" className="absolute inset-x-2 bottom-0 h-[3px] rounded-full bg-coral-700" />
                  )}
                </a>
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
