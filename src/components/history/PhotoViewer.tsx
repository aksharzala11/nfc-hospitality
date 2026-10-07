"use client";

import { useEffect, useLayoutEffect, useRef, useState, type UIEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useAppScrollLock } from "@/lib/scroll";
import { historyPhotoSources, type HistoryPhoto } from "@/lib/history";
import { useBackToClose } from "./useBackToClose";
import styles from "./history.module.css";

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

const ROUND_BUTTON =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/25 text-sand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sand-50";

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * One event's photographs, full screen, one at a time. Mounted only while open (PhotoPlate),
 * portalled to <body>, above the header and the nav.
 *
 * Sacred images: each photograph is shown whole, at the largest size that fits, with every
 * control outside it (count and Close above, caption and Previous / Next below; on a phone
 * turned sideways, in a column beside it). Nothing is laid over a photograph and nothing about
 * one moves, fades or zooms: the viewer appears and goes at once, and moving between
 * photographs is the browser's own scroll of a snap strip (a swipe, the buttons, the arrow
 * keys). No gestures in script, no pinch zoom (a zoomed photograph is a partial one).
 *
 * Focus goes to Close and stays inside (the slides that are off screen are inert); Escape,
 * Close and Back close it and focus returns to the photograph that opened it (`opener`). The
 * app's scroller is locked while it is open, and `data-photo-viewer` on <html> hides the rotate
 * guard (globals.css), so the phone can be turned for a larger view.
 */
export function PhotoViewer({
  caption,
  items,
  start,
  opener,
  onClose,
}: {
  caption: string;
  items: HistoryPhoto[];
  /** Index of the photograph that was tapped. */
  start: number;
  /** The button that was tapped: focus returns to it on close. */
  opener: HTMLElement | null;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(start);
  /** The same, readable by the resize observer without re-subscribing. */
  const indexRef = useRef(start);
  /** Slides whose photograph has been asked for: the one on screen and its neighbours. */
  const [wanted, setWanted] = useState<ReadonlySet<number>>(() => new Set([start - 1, start, start + 1]));
  const [status, setStatus] = useState<Record<number, "loaded" | "failed">>({});
  /** Bumped by Retry, so the <img> is a new element and the browser asks again. */
  const [attempt, setAttempt] = useState<Record<number, number>>({});

  const requestClose = useBackToClose(onClose);
  useAppScrollLock(true);

  // The rotate guard stands down while a photograph is open.
  useEffect(() => {
    const html = document.documentElement;
    html.setAttribute("data-photo-viewer", "");
    return () => html.removeAttribute("data-photo-viewer");
  }, []);

  // Open on the tapped photograph (before the first paint), and stay on the current one when
  // the stage changes width (the phone is turned).
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let width = stage.clientWidth;
    stage.scrollLeft = indexRef.current * width;
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      // Only a real change of width: an observer's first report repeats the size it started
      // with, and re-placing then would cut short a Previous / Next scroll already under way.
      if (stage.clientWidth === width) return;
      width = stage.clientWidth;
      stage.scrollLeft = indexRef.current * width;
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  function show(next: number) {
    if (next === indexRef.current) return;
    indexRef.current = next;
    setIndex(next);
    setWanted((prev) => new Set([...prev, next - 1, next, next + 1]));
  }

  // The strip's own scroll (a swipe, a button, a key) is what moves between photographs.
  function onStageScroll(event: UIEvent<HTMLDivElement>) {
    const stage = event.currentTarget;
    if (stage.clientWidth === 0) return;
    const at = Math.round(stage.scrollLeft / stage.clientWidth);
    show(Math.min(items.length - 1, Math.max(0, at)));
  }

  function go(to: number) {
    const stage = stageRef.current;
    if (!stage || to < 0 || to > items.length - 1) return;
    stage.scrollTo({ left: to * stage.clientWidth, behavior: reducedMotion() ? "auto" : "smooth" });
  }
  const goRef = useRef(go);
  useEffect(() => {
    goRef.current = go;
  });

  // Focus: in on open, kept inside, back to the opener on close.
  const openerRef = useRef(opener);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = openerRef.current;
    closeRef.current?.focus({ preventScroll: true });

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        requestClose();
        return;
      }
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        goRef.current(indexRef.current + (e.key === "ArrowRight" ? 1 : -1));
        return;
      }
      if (e.key !== "Tab" || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !dialog.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !dialog.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [requestClose]);

  const several = items.length > 1;
  const atStart = index === 0;
  const atEnd = index === items.length - 1;
  // Turning the phone only helps a photograph that is wider than it is tall.
  const current = historyPhotoSources(items[index].key).full;
  const widerThanTall = current.width > current.height;

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${caption}: photograph ${index + 1} of ${items.length}`}
      className={styles.viewer}
    >
      <div className={styles.viewerTop}>
        <p aria-live="polite" aria-atomic="true" className="text-sm font-semibold tabular-nums text-sand-50">
          <span className="sr-only">Photograph </span>
          {index + 1} of {items.length}
        </p>
        <button ref={closeRef} type="button" onClick={requestClose} aria-label="Close" className={`${ROUND_BUTTON} cursor-pointer`}>
          <X aria-hidden="true" className="h-5 w-5" />
        </button>
      </div>

      {/* tabIndex -1: the buttons and keys move it; it is not a stop of its own. */}
      <div ref={stageRef} tabIndex={-1} onScroll={onStageScroll} className={styles.stage}>
        {items.map((photo, i) => {
          const { full } = historyPhotoSources(photo.key);
          const state = status[i];
          return (
            <div
              key={photo.key}
              className={styles.slide}
              // Off-screen slides are out of reach of a screen reader's swipe and of Tab, as
              // they are of the eye (a focused Retry there would scroll the stage to it).
              aria-hidden={i === index ? undefined : true}
              inert={i !== index}
            >
              {state === "failed" ? (
                <p className="px-6 text-center text-sm text-ink-200">
                  This photo couldn&rsquo;t be loaded.
                  <button
                    type="button"
                    // Where `inert` isn't supported (iOS before 15.5), still not a Tab stop off screen.
                    tabIndex={i === index ? undefined : -1}
                    onClick={() => {
                      setStatus((prev) => {
                        const next = { ...prev };
                        delete next[i];
                        return next;
                      });
                      setAttempt((prev) => ({ ...prev, [i]: (prev[i] ?? 0) + 1 }));
                    }}
                    className="mx-auto mt-3 flex min-h-11 cursor-pointer items-center rounded-full border border-white/25 px-5 text-sm font-semibold text-sand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sand-50"
                  >
                    Retry
                  </button>
                </p>
              ) : (
                <>
                  {/* Behind the photograph, and gone once it has loaded. */}
                  {state !== "loaded" && <p className="text-sm text-ink-200">Loading photo…</p>}
                  {wanted.has(i) && (
                    // eslint-disable-next-line @next/next/no-img-element -- shown exactly as the file is: no optimiser, no cropping
                    <img
                      key={attempt[i] ?? 0}
                      ref={(img) => {
                        // Already there from the cache before React attached onLoad.
                        if (img?.complete && img.naturalWidth > 0) {
                          setStatus((prev) => (prev[i] === "loaded" ? prev : { ...prev, [i]: "loaded" }));
                        }
                      }}
                      src={full.src}
                      width={full.width}
                      height={full.height}
                      alt={photo.alt}
                      decoding="async"
                      draggable={false}
                      onLoad={() => setStatus((prev) => ({ ...prev, [i]: "loaded" }))}
                      onError={() => setStatus((prev) => ({ ...prev, [i]: "failed" }))}
                      className={styles.viewerPhoto}
                    />
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className={styles.viewerBottom}>
        <div className={styles.viewerCaption}>
          <p className="text-[15px] font-semibold leading-snug text-sand-50">{caption}</p>
          {/* Kept in the layout (only hidden) for an upright photograph, so the bar keeps its
              height and the photographs their size from one slide to the next. */}
          <p
            aria-hidden={widerThanTall ? undefined : true}
            className={`mt-0.5 text-xs text-ink-200 ${styles.viewerHint} ${widerThanTall ? "" : "invisible"}`}
          >
            Turn your phone sideways for a larger view
          </p>
        </div>
        {several && (
          <div className={styles.viewerArrows}>
            {/* aria-disabled, not disabled: focus stays on the button at either end. */}
            <button
              type="button"
              aria-label="Previous photograph"
              aria-disabled={atStart}
              onClick={() => go(index - 1)}
              className={`${ROUND_BUTTON} ${atStart ? "cursor-default opacity-40" : "cursor-pointer"}`}
            >
              <ChevronLeft aria-hidden="true" className="h-5 w-5" />
            </button>
            <button
              type="button"
              aria-label="Next photograph"
              aria-disabled={atEnd}
              onClick={() => go(index + 1)}
              className={`${ROUND_BUTTON} ${atEnd ? "cursor-default opacity-40" : "cursor-pointer"}`}
            >
              <ChevronRight aria-hidden="true" className="h-5 w-5" />
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
