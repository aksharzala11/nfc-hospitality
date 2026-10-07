"use client";

import { forwardRef, useState } from "react";
import { Accessibility, Check, ChevronDown, ChevronUp, Copy, Lock, Navigation, X } from "lucide-react";
import type { VenueLevelId } from "@/lib/venue/types";
import type { RouteStep } from "@/lib/venue/steps";
import type { ClientRoom } from "@/lib/venue/view";
import type { MatchSpread } from "./mapTypes";
import { TAG_SITE } from "@/lib/here";

/**
 * One line of the From list. `key` tells apart two lines for one room (the Main Hall under
 * "Programme" and the same room, Sahajanand Hall, under its floor); `name` = the name the line
 * lists it by when that isn't the room's own (the steps then start "at the Main Hall").
 */
export type StartOption = { key: string; id: string; label: string; group: string; name?: string };

/**
 * The sheet over the bottom of the map for the picked room: its name (the organisers', or the
 * event name it was found by) and floor, then "Directions": the numbered steps (tap one to see its
 * floor) under one compact row for where from (the Main Foyer by default, the guest's rooms, any
 * room) and step-free, so the steps show without scrolling on a small phone. Collapses to a
 * one-line bar so the map shows. Its height leaves the floor buttons (top right) clear. Directions
 * use only the guest's side's stairs (routeNote says so); when those don't reach the room,
 * `problem` says that plainly. A staff-only room (`room.closed`) says so and offers no directions.
 */
export const RoomSheet = forwardRef<
  HTMLDivElement,
  {
    room: ClientRoom;
    title: string;
    subtitle: string;
    /** Admins only: the room's map id, for src/lib/venue/aliasTable.ts. */
    mapId: string | null;
    /** Admins only: the /here path an NFC tag at this room carries (src/lib/here.ts). */
    tagLink?: string | null;
    alternatives: { id: string; title: string }[];
    /** Why there are several (split session, one name for several rooms, a shared blueprint name). */
    spread: MatchSpread;
    /** The name they were found by ("Multipurpose Room"). */
    query: string | null;
    expanded: boolean;
    routing: boolean;
    /** The From list's line in use (StartOption.key); "" = none chosen. */
    startKey: string;
    startOptions: StartOption[];
    stepFree: boolean;
    /** False when no elevator is open to this guest (none on their side): no Step-free switch. */
    canStepFree: boolean;
    /** Under the steps: which stairs / elevators they use ("Behno directions use only ..."). */
    routeNote: string | null;
    steps: RouteStep[] | null;
    /** Why there are no steps (no route, no entry, ...), when routing. */
    problem: string | null;
    levelName: (id: VenueLevelId) => string;
    onToggle: () => void;
    onClose: () => void;
    onDirections: () => void;
    /** A line of the From list was picked (its StartOption.key). */
    onStart: (key: string) => void;
    onStepFree: (on: boolean) => void;
    onStep: (level: VenueLevelId) => void;
    onAlternative: (id: string) => void;
  }
>(function RoomSheet(p, ref) {
  const groups = [...new Set(p.startOptions.map((o) => o.group))];
  return (
    <div
      ref={ref}
      className="absolute inset-x-2 bottom-2 z-20 flex flex-col overflow-hidden rounded-3xl bg-white/95 shadow-card-lg ring-1 ring-sand-300 backdrop-blur"
      // Taller while it lists directions; never up to the floor buttons (top 12 px + 4 x 40 px).
      style={{ maxHeight: p.routing ? "min(62%, calc(100% - 184px))" : "min(52%, calc(100% - 184px))" }}
      role="region"
      aria-label={`${p.title}: room details and directions`}
    >
      <div className="flex items-start gap-2 px-4 pb-2 pt-3">
        <button
          type="button"
          onClick={p.onToggle}
          aria-expanded={p.expanded}
          className="flex min-w-0 flex-1 items-start gap-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-800"
        >
          <span className="min-w-0 flex-1">
            <span className="font-display block truncate text-[1.375rem] leading-tight text-ink-900">{p.title}</span>
            <span className="mt-0.5 block truncate text-xs text-ink-500">{p.subtitle}</span>
          </span>
          <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sand-100 text-ink-700">
            {p.expanded ? <ChevronDown aria-hidden="true" className="h-4 w-4" /> : <ChevronUp aria-hidden="true" className="h-4 w-4" />}
            <span className="sr-only">{p.expanded ? "Show less" : "Show more"}</span>
          </span>
        </button>
        <button
          type="button"
          onClick={p.onClose}
          aria-label="Close"
          className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sand-100 text-ink-700 hover:bg-sand-200"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>

      {p.expanded && (
        <div className="min-h-0 overflow-y-auto overscroll-contain px-4 pb-4">
          {p.mapId && (
            <p className="mb-2 text-[11px] text-ink-500">
              Map id <code className="rounded bg-sand-100 px-1.5 py-0.5 font-mono text-ink-800">{p.mapId}</code>
              <span className="ml-1">(admins only)</span>
            </p>
          )}
          {p.tagLink && <TagLink path={p.tagLink} />}
          {p.alternatives.length > 1 && (
            <div className="mb-3">
              <p className="mb-1.5 text-xs text-ink-600">
                {p.spread === "split"
                  ? "This session is split amongst these rooms:"
                  : p.spread === "same-name"
                    ? `There are ${p.alternatives.length} rooms called ${p.query ?? p.title}:`
                    : `${p.query ?? p.title} covers these rooms:`}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {p.alternatives.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => p.onAlternative(a.id)}
                    aria-pressed={a.id === p.room.id}
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      a.id === p.room.id ? "bg-ink-800 text-white" : "bg-sand-100 text-ink-800 hover:bg-sand-200"
                    }`}
                  >
                    {a.title}
                  </button>
                ))}
              </div>
            </div>
          )}

          {p.room.closed ? (
            // Staff only (the organisers' plans): on the map by name, never a destination.
            <p className="flex items-start gap-2 rounded-2xl bg-sand-100 px-3 py-2.5 text-sm text-ink-700">
              <Lock aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-ink-500" />
              <span>
                <span className="font-semibold text-ink-900">Staff only.</span> There are no directions to this room.
              </span>
            </p>
          ) : !p.routing ? (
            p.room.entry ? (
              <button
                type="button"
                onClick={p.onDirections}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-ink-700 to-ink-900 px-4 py-3 text-sm font-bold text-white shadow-card hover:from-ink-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-800"
              >
                <Navigation aria-hidden="true" className="h-4 w-4" />
                Directions
              </button>
            ) : (
              <p className="rounded-2xl bg-sand-100 px-3 py-2.5 text-sm text-ink-600">No directions to this room yet.</p>
            )
          ) : (
            <>
              {/* Where from and step-free in one row, so the steps below show without scrolling. */}
              <div className="flex items-center gap-2">
                <label className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl bg-sand-50 px-3 py-1.5 ring-1 ring-sand-200">
                  <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-500">From</span>
                  <select
                    value={p.startKey}
                    onChange={(e) => p.onStart(e.target.value)}
                    className="min-w-0 flex-1 truncate bg-transparent py-0.5 text-sm font-semibold text-ink-900 focus:outline-none"
                  >
                    {!p.startKey && <option value="">Choose where you are</option>}
                    {groups.map((g) => (
                      <optgroup key={g} label={g}>
                        {p.startOptions
                          .filter((o) => o.group === g)
                          .map((o) => (
                            <option key={o.key} value={o.key}>
                              {o.label}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
                {p.canStepFree && (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={p.stepFree}
                    onClick={() => p.onStepFree(!p.stepFree)}
                    title="Step-free: elevators only"
                    className={`flex shrink-0 items-center gap-1.5 rounded-2xl px-3 py-2 text-xs font-bold ring-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-800 ${
                      p.stepFree ? "bg-jade-700 text-white ring-jade-700" : "bg-white text-ink-800 ring-sand-300 hover:bg-sand-50"
                    }`}
                  >
                    <Accessibility aria-hidden="true" className="h-4 w-4" />
                    Step-free
                  </button>
                )}
              </div>

              {p.problem && <p className="mt-3 rounded-2xl bg-coral-50 px-3 py-2.5 text-sm text-coral-900">{p.problem}</p>}
              {p.steps && (
                <ol className="mt-2.5 space-y-1">
                  {p.steps.map((s, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        onClick={() => p.onStep(s.level)}
                        className="flex w-full items-start gap-3 rounded-xl px-1.5 py-1.5 text-left hover:bg-sand-50 focus-visible:outline-2 focus-visible:outline-ink-800"
                      >
                        <span
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                            s.kind === "arrive" ? "bg-coral-700 text-white" : s.kind === "start" ? "bg-jade-600 text-white" : "bg-ink-100 text-ink-800"
                          }`}
                        >
                          {i + 1}
                        </span>
                        <span className="min-w-0 pt-0.5 text-sm leading-snug text-ink-900">
                          {s.text}
                          {s.kind === "climb" && <span className="sr-only"> (shows the {p.levelName(s.level)})</span>}
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              )}
              {p.routeNote && p.steps && <p className="mt-1.5 px-1.5 text-[11px] text-ink-500">{p.routeNote}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
});

/**
 * Admins only: the link an NFC tag at this room carries (scanning it opens the map with the room as
 * "You are here"): the production address (TAG_SITE), whichever address the admin is on, shown in
 * full and selectable by hand, with a button that copies it (where the browser allows).
 */
function TagLink({ path }: { path: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const url = `${TAG_SITE}${path}`;
  return (
    <div className="mb-2 text-[11px] text-ink-500">
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        NFC tag link
        <button
          type="button"
          onClick={() => {
            const done = (ok: boolean) => {
              setState(ok ? "copied" : "failed");
              window.setTimeout(() => setState("idle"), 2500);
            };
            if (!navigator.clipboard) return done(false);
            navigator.clipboard.writeText(url).then(
              () => done(true),
              () => done(false),
            );
          }}
          className="inline-flex items-center gap-1 rounded-full bg-sand-100 px-2 py-0.5 font-semibold text-ink-700 hover:bg-sand-200"
        >
          {state === "copied" ? <Check aria-hidden="true" className="h-3 w-3" /> : <Copy aria-hidden="true" className="h-3 w-3" />}
          {state === "copied" ? "Copied" : "Copy"}
        </button>
        {state === "failed" && <span role="status">Couldn&rsquo;t copy: select the link instead</span>}
      </p>
      <code className="mt-1 block select-all break-all rounded bg-sand-100 px-1.5 py-0.5 font-mono text-ink-800">{url}</code>
    </div>
  );
}
