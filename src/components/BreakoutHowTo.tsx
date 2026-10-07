"use client";

import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { Accessibility, ChevronDown, Map as MapIcon, Navigation } from "lucide-react";
import type { BreakoutWay } from "@/lib/venue/breakoutDirections";
import { getScrollTop, getScroller, scrollAppTo } from "@/lib/scroll";
import { useReducedMotion } from "@/components/map/useReducedMotion";
import { useStepFreePreference } from "@/components/useStepFreePreference";

/** A tap on these inside the card does its own thing (a room link, ...), not open the section. */
const OWN_TAP = "a, button, input, select, textarea, label, [role='button'], [role='switch']";

/** What the floating bottom nav and back-to-top button cover at the foot of #app-scroll. */
const NAV_CLEARANCE = 112;

/**
 * A breakout card's "How to get there" (delegate /breakouts only; BreakoutList renders this only
 * when the page passes directions): the card's own content (`children`, server-rendered) stays as
 * it is, a tap on it (outside its links) or on the "How to get there" button opens the section
 * inside the card: from where (the place before the session, or the Main Foyer and why), to which room
 * (chips when the team is split amongst rooms), the numbered steps with a Step-free switch when
 * that way differs, and a link to the same route on /map (same tab, with ?stepFree=1 while
 * Step-free is on). Everything was worked out on the server (src/lib/venue/breakoutDirections.ts):
 * this only shows it. The Step-free choice is one for the whole page and kept for this viewer
 * (useStepFreePreference()). Nothing opens by itself. Opening scrolls the app's scroller (never
 * the window) just enough to show the section above the bottom nav, instantly when the viewer asks
 * for less motion.
 */
export function BreakoutHowTo({
  way,
  label,
  past,
  children,
}: {
  way: BreakoutWay;
  /** The session for screen readers, told apart from the others ("BM RA, Fri, Oct 9, 11:00 AM"). */
  label: string;
  /** A finished session: quiet icon, as the card's own. */
  past: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [roomAt, setRoomAt] = useState(0);
  const [stepFree, setStepFree] = useStepFreePreference();
  const panelId = `${useId()}-how-to`;
  const panelRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  // Just opened: if the section ends under the bottom nav, scroll it up, but never the button and
  // the card's line above it out of view.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const el = panelRef.current;
      const scroller = getScroller();
      if (!el || !scroller) return;
      const box = el.getBoundingClientRect();
      const view = scroller.getBoundingClientRect();
      const by = Math.min(box.bottom - (view.bottom - NAV_CLEARANCE), box.top - view.top - 96);
      if (by > 8) scrollAppTo(getScrollTop() + by, reducedMotion ? "auto" : "smooth");
    });
    return () => cancelAnimationFrame(frame);
    // Only on opening, not when the motion preference changes while open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onCardTap = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest(OWN_TAP)) return;
    // Selecting text isn't a tap.
    if (window.getSelection()?.toString()) return;
    setOpen((o) => !o);
  };

  const room = way.rooms[Math.min(roomAt, way.rooms.length - 1)];
  const variant = room.message ? null : stepFree && room.stepFree ? room.stepFree : room.stairs;
  const split = way.rooms.length > 1;
  const from = room.from;
  const place = from.place ? from.place.charAt(0).toUpperCase() + from.place.slice(1) : null;
  const steps = variant?.steps ?? null;
  // Step-free on and the steps are the same either way: /map's Step-free note, as its link shows.
  const note = stepFree && !room.stepFree && room.stepFreeNote ? room.stepFreeNote : (variant?.note ?? null);
  // /map opens with Step-free on too (it applies it only when their side has an elevator).
  const mapHref = room.mapHref && stepFree ? `${room.mapHref}&stepFree=1` : room.mapHref;

  return (
    <>
      {/* The card as it was; tapping it (not its links) toggles the section. The button below is
          the real control (keyboard, screen readers). */}
      <div onClick={onCardTap} className="cursor-pointer">
        {children}
      </div>

      <div className="mt-3 border-t border-sand-200 pt-1">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
          className="-mx-1.5 flex min-h-11 w-[calc(100%+0.75rem)] items-center gap-2 rounded-xl px-1.5 text-left text-xs font-bold text-ink-700 hover:bg-sand-50 hover:text-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-800"
        >
          <Navigation aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 ${past ? "text-ink-400" : "text-coral-700"}`} />
          <span className="flex-1">
            How to get there<span className="sr-only">: {label}</span>
          </span>
          <ChevronDown
            aria-hidden="true"
            className={`h-4 w-4 shrink-0 text-ink-500 motion-safe:transition-transform motion-safe:duration-200 ${open ? "rotate-180" : ""}`}
          />
        </button>
      </div>

      <div id={panelId} ref={panelRef} hidden={!open}>
        <div className="mt-1.5 space-y-3 motion-safe:animate-fade-up motion-safe:[animation-duration:300ms]">
          {/* From -> To, on a small rail: jade where they start, coral where they're going. */}
          <div className="flex gap-3 rounded-2xl bg-sand-50 px-3.5 py-3 ring-1 ring-inset ring-sand-200">
            <span aria-hidden="true" className="flex flex-col items-center pb-1.5 pt-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-jade-600 ring-2 ring-jade-100" />
              <span className="my-1 w-px flex-1 bg-sand-300" />
              <span className="h-2.5 w-2.5 rounded-full bg-coral-700 ring-2 ring-coral-100" />
            </span>
            <dl className="min-w-0 flex-1 space-y-2.5 text-sm leading-snug">
              <div>
                <dt className="text-[11px] font-bold uppercase tracking-caps text-ink-500">From</dt>
                <dd className="break-words font-semibold text-ink-900">
                  {place ?? from.label}
                  {place && from.context && <span className="font-normal text-ink-600"> · {from.context}</span>}
                </dd>
                {from.note && <dd className="mt-0.5 text-xs leading-snug text-ink-600">{from.note}</dd>}
              </div>
              <div>
                <dt className="text-[11px] font-bold uppercase tracking-caps text-ink-500">To</dt>
                <dd className="break-words font-semibold text-ink-900">
                  {room.room}
                  {room.floor && <span className="font-normal text-ink-600"> · {room.floor}</span>}
                </dd>
              </div>
            </dl>
          </div>

          {split && (
            <div>
              <p className="mb-1.5 text-xs text-ink-600">Your team is split amongst these rooms:</p>
              <div role="group" aria-label="Rooms" className="flex flex-wrap gap-1.5">
                {way.rooms.map((r, i) => (
                  <button
                    key={`${i}-${r.room}`}
                    type="button"
                    aria-pressed={r === room}
                    onClick={() => setRoomAt(i)}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-800 ${
                      r === room ? "bg-ink-800 text-white" : "bg-sand-100 text-ink-800 hover:bg-sand-200"
                    }`}
                  >
                    {r.room}
                  </button>
                ))}
              </div>
            </div>
          )}

          {room.message ? (
            <p
              className={`rounded-2xl px-3 py-2.5 text-sm ${room.here ? "bg-jade-50 text-jade-700" : "bg-sand-100 text-ink-700"}`}
            >
              {room.message}
            </p>
          ) : (
            variant && (
              <div>
                <div className="mb-1.5 flex min-h-9 items-center justify-between gap-2">
                  <p className="text-[11px] font-bold uppercase tracking-caps text-ink-500">Directions</p>
                  {room.stepFree && (
                    <button
                      type="button"
                      role="switch"
                      aria-checked={stepFree}
                      onClick={() => setStepFree(!stepFree)}
                      title="Step-free: elevators only"
                      className={`flex shrink-0 items-center gap-1.5 rounded-2xl px-3 py-1.5 text-xs font-bold ring-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-800 ${
                        stepFree ? "bg-jade-700 text-white ring-jade-700" : "bg-white text-ink-800 ring-sand-300 hover:bg-sand-50"
                      }`}
                    >
                      <Accessibility aria-hidden="true" className="h-4 w-4" />
                      Step-free
                    </button>
                  )}
                </div>
                {variant.problem && <p className="rounded-2xl bg-coral-50 px-3 py-2.5 text-sm text-coral-900">{variant.problem}</p>}
                {steps && (
                  <ol className="space-y-1.5">
                    {steps.map((text, i) => (
                      <li key={i} className="flex items-start gap-3">
                        <span
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                            i === 0 ? "bg-jade-600 text-white" : i === steps.length - 1 ? "bg-coral-700 text-white" : "bg-ink-100 text-ink-800"
                          }`}
                        >
                          {i + 1}
                        </span>
                        <span className="min-w-0 pt-0.5 text-sm leading-snug text-ink-900">{text}</span>
                      </li>
                    ))}
                  </ol>
                )}
                {steps && note && <p className="mt-2 text-[11px] leading-snug text-ink-500">{note}</p>}
              </div>
            )
          )}

          {mapHref && (
            <Link
              href={mapHref}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-800 underline decoration-coral-400 decoration-2 underline-offset-2 hover:text-coral-800"
            >
              <MapIcon aria-hidden="true" className="h-4 w-4 shrink-0 text-coral-700" />
              {steps ? "Show the route on the map" : "Show it on the map"}
            </Link>
          )}
        </div>
      </div>
    </>
  );
}
