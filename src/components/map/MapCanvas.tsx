"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { LocateFixed, Minus, Plus } from "lucide-react";
import type { VenueLevelId, VenuePoint } from "@/lib/venue/types";
import { boxOf, polygonPath, type Box, type ClientLevel, type ClientRoom } from "@/lib/venue/view";
import { usePanZoom } from "./usePanZoom";
import styles from "./map.module.css";

/** A "Next: Second Floor" hand-off where the route leaves this level. */
export type Handoff = { point: VenuePoint; to: VenueLevelId; text: string; direction: "up" | "down" };

/** Fill of a room by kind (public rooms), brand tokens only. */
const KIND_FILL: Record<ClientRoom["kind"], string> = {
  room: "fill-white",
  hall: "fill-sand-200",
  dining: "fill-sand-200",
  lobby: "fill-sand-100",
  corridor: "fill-sand-50",
  restroom: "fill-ink-50",
  stair: "fill-ink-100",
  elevator: "fill-ink-100",
  exit: "fill-jade-50",
  other: "fill-sand-100",
};

/**
 * A staff-only room (ClientRoom.closed) is hatched, as on the organisers' plans: told apart from
 * every room guests can go to at a glance (a plain tint read like a hall's). The hatch is a
 * pattern in map units, about HATCH_PX wide on screen at whole-floor zoom.
 */
const HATCH_PX = 6;

/** Label metrics in screen px (map.module.css .label / .labelSmall), for fitting and overlaps. */
const LABEL = { charPx: 6.1, heightPx: 14 };
const LABEL_SMALL = { charPx: 5.3, heightPx: 12 };
/**
 * A room with an event name is labelled even when the name is wider than the room, up to this
 * many times its width: beyond that the name would read as its neighbours' too (a row of small
 * offices), so it waits for a closer zoom. The guest's own rooms are labelled regardless.
 */
const EVENT_LABEL_MAX_SPILL = 4;
/** A label keeps this far (screen px) inside the plan's frame, so the map's edge never cuts it. */
const LABEL_EDGE_PX = 4;
/** Steps (screen px) a label may move up or down inside its room to clear another label. */
const LABEL_DODGE_PX = [0, 15, -15, 30, -30] as const;
/** How far below its point a room's label moves when a marker sits there (screen px). */
const UNDER_PIN_PX = 13;
const UNDER_DOT_PX = 17;
/** The "You are here" pill over the guest's dot (screen px). */
const HERE_PILL_W = 96;
/** How far framing a room or route may zoom in (x the whole floor). */
const FOCUS_MAX_ZOOM = 4;
/** Room kept clear at the top when framing (the view switch, floor name and a hand-off pill). */
const FOCUS_TOP_PX = 64;
/** ... on the right, where the floor buttons are, and on the left, where the zoom buttons are. */
const FOCUS_RIGHT_PX = 56;
const FOCUS_LEFT_PX = 52;

type Label = { id: string; x: number; y: number; text: string; small: boolean; shiftPx: number; strong: boolean; quiet: boolean };

/** A polygon's area (flat points), so an L-shaped room doesn't count for its whole bounding box. */
function areaOf(pts: number[]): number {
  let a = 0;
  for (let i = 0, n = pts.length / 2; i < n; i++) {
    const j = (i + 1) % n;
    a += pts[2 * i] * pts[2 * j + 1] - pts[2 * j] * pts[2 * i + 1];
  }
  return Math.abs(a) / 2;
}

export function MapCanvas({
  level,
  titles,
  mine,
  named,
  listedIds,
  destId,
  startId,
  startHere = false,
  routeLines,
  routeKey,
  handoffs,
  startPoint,
  destPoint,
  connectors,
  focus,
  insetBottomPx,
  compactControls = false,
  reducedMotion,
  onTapRoom,
  onHandoff,
}: {
  level: ClientLevel;
  /** Room id -> the name to show (the organisers' team name, an event name mapped to it, else the blueprint's). */
  titles: Map<string, string>;
  /** The guest's own rooms (breakouts, goshthi), tinted and always labelled when there's room. */
  mine: Set<string>;
  /** Rooms an event name is mapped to (where guests are sent): labelled ahead of every other room. */
  named: Set<string>;
  /** Rooms that are labelled and can be tapped (not plain corridors). */
  listedIds: Set<string>;
  destId: string | null;
  startId: string | null;
  /** The start is where the guest is (an NFC tag's room): its dot says "You are here". */
  startHere?: boolean;
  /** The route's lines on this level. */
  routeLines: VenuePoint[][];
  /** Changes when the route changes, to replay the drawing animation. */
  routeKey: string;
  handoffs: Handoff[];
  startPoint: VenuePoint | null;
  destPoint: VenuePoint | null;
  /** Stair / elevator landings on this floor; `usable: false` = the other side's (drawn faded). */
  connectors: { id: string; kind: "stair" | "elevator"; point: VenuePoint; usable?: boolean }[];
  /** A box to frame; framed again whenever `key` changes. */
  focus: { box: Box; key: string } | null;
  /** Height (px) the sheet covers at the bottom of the map. */
  insetBottomPx: number;
  /** Only the recentre button (a tall sheet leaves no room for +/-). */
  compactControls?: boolean;
  reducedMotion: boolean;
  onTapRoom: (id: string) => void;
  onHandoff: (to: VenueLevelId) => void;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const gRef = useRef<SVGGElement | null>(null);
  const hatchId = `${useId().replace(/[^a-zA-Z0-9_-]/g, "")}-staff`;
  const b = level.bounds;
  const pad = Math.max(b.width, b.height) * 0.04;
  const viewBox = { x: b.x - pad, y: b.y - pad, width: b.width + 2 * pad, height: b.height + 2 * pad };
  const maxK = Math.min(24, Math.max(4, Math.max(b.width, b.height) / 45));

  // "Hold Ctrl to zoom", briefly, when a plain wheel scrolls the page past the map.
  const [wheelHint, setWheelHint] = useState(false);
  const hintTimer = useRef(0);
  const showWheelHint = useCallback(() => {
    setWheelHint(true);
    window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setWheelHint(false), 1600);
  }, []);
  useEffect(() => () => window.clearTimeout(hintTimer.current), []);

  const { zoom, zoomBy, fitBox, reset } = usePanZoom({
    svgRef,
    gRef,
    viewBox,
    content: b,
    maxK,
    // What covers the plan: the view switch and floor name (top), the floor buttons (right), the
    // zoom buttons (left) and the room sheet (bottom). The view is held between them.
    insets: { top: FOCUS_TOP_PX, right: FOCUS_RIGHT_PX, bottom: insetBottomPx, left: FOCUS_LEFT_PX },
    reducedMotion,
    onWheelHint: showWheelHint,
    onTap: (target) => {
      const el = target?.closest?.("[data-handoff],[data-room]");
      if (!el) return false;
      const handoff = el.getAttribute("data-handoff");
      if (handoff) onHandoff(handoff as VenueLevelId);
      else onTapRoom(el.getAttribute("data-room")!);
      return true;
    },
  });

  const frame = useCallback(
    (box: Box) =>
      fitBox(box, {
        insetBottomPx,
        insetTopPx: FOCUS_TOP_PX,
        insetRightPx: FOCUS_RIGHT_PX,
        insetLeftPx: FOCUS_LEFT_PX,
        maxZoom: FOCUS_MAX_ZOOM,
      }),
    [fitBox, insetBottomPx],
  );

  // Frame the target when it changes, and again when the sheet over the map grows or shrinks
  // (it appears with the target, so the first frame may not know its height yet).
  const insetStep = Math.round(insetBottomPx / 24);
  const focusRef = useRef(focus);
  focusRef.current = focus;
  useEffect(() => {
    const f = focusRef.current;
    if (f) frame(f.box);
    // Only when the target or the sheet's height changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.key, insetStep]);

  const listed = useMemo(() => level.rooms.filter((r) => listedIds.has(r.id)), [level, listedIds]);
  const boxes = useMemo(() => new Map(level.rooms.map((r) => [r.id, boxOf(r.pts)])), [level]);
  const blocks = useMemo(() => level.blocks.map(polygonPath).join(""), [level]);

  // Which labels show at this zoom, placed by priority so they never overlap: the destination and
  // start always (moved below their marker), then the guest's own rooms, then rooms with an event
  // name (unless the name is far wider than the room: EVENT_LABEL_MAX_SPILL), then every other
  // name that fits its room (a blueprint room that doesn't fit shows just its number when that
  // fits; a room the organisers named never shows a number), then staff-only rooms, quieter.
  // Within a tier the larger room first (by its real area). A label that would overlap one
  // already placed moves up or down inside its own room when there is space (two halls side by
  // side both get their name), and every label is kept inside the plan's frame, so a room at the
  // building's edge isn't cut off by the map's. Stairs and elevators carry their marker, never a
  // label of their own.
  // Nothing before the <svg> is measured (the server render would size them for 1 px per unit).
  const labels = useMemo((): Label[] => {
    if (!zoom) return [];
    const scale = zoom.ppu * zoom.k;
    type Candidate = Label & { tier: number; area: number; upPx: number; downPx: number };
    const cands: Candidate[] = [];
    // The plan's frame (the level with its margin), in screen px at this zoom.
    const framePad = Math.max(level.bounds.width, level.bounds.height) * 0.04;
    const frameX0 = (level.bounds.x - framePad) * scale + LABEL_EDGE_PX;
    const frameX1 = (level.bounds.x + level.bounds.width + framePad) * scale - LABEL_EDGE_PX;
    for (const r of listed) {
      const forced = r.id === destId || r.id === startId;
      if (!forced && (r.kind === "stair" || r.kind === "elevator")) continue;
      const box = boxes.get(r.id)!;
      const w = (box.x1 - box.x0) * scale;
      const h = (box.y1 - box.y0) * scale;
      const title = titles.get(r.id) ?? r.name;
      const tier = forced ? 0 : r.closed ? 4 : mine.has(r.id) ? 1 : named.has(r.id) ? 2 : 3;
      let text = title;
      let small = false;
      if (tier === 2 && title.length * LABEL.charPx + 4 > w * EVENT_LABEL_MAX_SPILL) continue;
      if (tier >= 3 && !(title.length * LABEL.charPx + 4 <= w * 1.1 && h >= 13)) {
        if (r.named || r.closed || !r.number || !(r.number.length * LABEL_SMALL.charPx + 4 <= w * 1.2 && h >= 10)) continue;
        text = r.number;
        small = true;
      }
      let shiftPx = 0;
      if (r.id === destId && destPoint) shiftPx = UNDER_PIN_PX;
      else if (r.id === startId && startPoint && Math.hypot(startPoint[0] - r.label[0], startPoint[1] - r.label[1]) * scale < 14) {
        shiftPx = UNDER_DOT_PX;
      }
      cands.push({
        id: r.id,
        x: r.label[0],
        y: r.label[1],
        text,
        small,
        shiftPx,
        strong: r.id === destId,
        quiet: Boolean(r.closed) && !forced,
        tier,
        area: areaOf(r.pts) * scale * scale,
        upPx: (r.label[1] - box.y0) * scale,
        downPx: (box.y1 - r.label[1]) * scale,
      });
    }
    cands.sort((a, b) => a.tier - b.tier || b.area - a.area);
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const out: Label[] = [];
    for (const c of cands) {
      const m = c.small ? LABEL_SMALL : LABEL;
      const halfW = (c.text.length * m.charPx + 4) / 2;
      // Inside the plan's frame: a room at the building's edge keeps its whole name on the map.
      const lo = frameX0 + halfW;
      const hi = frameX1 - halfW;
      const cx = lo <= hi ? Math.min(hi, Math.max(lo, c.x * scale)) : c.x * scale;
      // The picked rooms' labels stay put; a guest's own room or an event room may move up or
      // down inside the room to clear a label already placed; the rest show only where they fit.
      const dodges = c.tier === 1 || c.tier === 2 ? LABEL_DODGE_PX : [0];
      for (const d of dodges) {
        if (d !== 0 && Math.abs(d) + m.heightPx / 2 > (d > 0 ? c.downPx : c.upPx)) continue;
        const cy = c.y * scale + c.shiftPx + d;
        const box = { x0: cx - halfW, y0: cy - m.heightPx / 2, x1: cx + halfW, y1: cy + m.heightPx / 2 };
        if (c.tier > 0 && placed.some((p) => p.x0 < box.x1 && box.x0 < p.x1 && p.y0 < box.y1 && box.y0 < p.y1)) continue;
        placed.push(box);
        out.push({ ...c, x: cx / scale, shiftPx: c.shiftPx + d });
        break;
      }
    }
    return out;
  }, [zoom, level, listed, boxes, titles, mine, named, destId, startId, destPoint, startPoint]);

  // The staff-only hatch: one pattern in map units (see HATCH_PX).
  const hatch = HATCH_PX / (zoom?.ppu ?? 1);
  const hasClosed = useMemo(() => level.rooms.some((r) => r.closed), [level]);

  const lineD = (pts: VenuePoint[]) => pts.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join("");
  const controlButton =
    "flex h-10 w-10 items-center justify-center rounded-full bg-white text-ink-800 shadow-card ring-1 ring-sand-300 hover:bg-sand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-800";

  return (
    <div className="absolute inset-0">
      <svg
        ref={svgRef}
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
        preserveAspectRatio="xMidYMid meet"
        className={`${styles.canvas} h-full w-full cursor-grab touch-none select-none active:cursor-grabbing`}
        // Hidden until measured: the server render can't know the screen scale, so walls and
        // markers would be hairlines until the first client frame sizes them.
        style={zoom ? undefined : { visibility: "hidden" }}
        role="img"
        aria-label={`Floor plan of the ${level.name}`}
      >
        {hasClosed && (
          <defs>
            <pattern id={hatchId} patternUnits="userSpaceOnUse" width={hatch} height={hatch} patternTransform="rotate(45)">
              <rect width={hatch} height={hatch} className="fill-sand-100" />
              <rect width={hatch * 0.3} height={hatch} className="fill-sand-400" />
            </pattern>
          </defs>
        )}
        <g ref={gRef}>
          {blocks && <path d={blocks} className="fill-sand-300/70" />}
          {level.rooms.map((r) => {
            const isDest = r.id === destId;
            const isStart = r.id === startId;
            // Staff only: drawn and named, hatched (as the organisers' plans draw them) so it never
            // reads as a room guests can go to; picked, it takes the destination's tint like any room.
            const hatched = Boolean(r.closed) && !isDest && !isStart;
            const fill = isDest
              ? "fill-coral-200"
              : isStart
                ? "fill-jade-100"
                : hatched
                  ? ""
                  : mine.has(r.id)
                    ? "fill-coral-50"
                    : KIND_FILL[r.kind];
            const stroke = isDest
              ? "stroke-coral-700"
              : isStart
                ? "stroke-jade-600"
                : r.closed
                  ? "stroke-sand-400"
                  : mine.has(r.id)
                    ? "stroke-coral-300"
                    : "stroke-sand-400";
            const listedRoom = listedIds.has(r.id);
            return (
              <path
                key={r.id}
                d={polygonPath(r.pts)}
                data-room={listedRoom ? r.id : undefined}
                fill={hatched ? `url(#${hatchId})` : undefined}
                className={`${fill} ${stroke} ${isDest || isStart ? styles.roomEdgeStrong : styles.roomEdge} ${listedRoom ? "cursor-pointer" : ""}`}
              />
            );
          })}
          <path d={level.walls} className={`${styles.walls} fill-none stroke-ink-800`} strokeLinecap="round" strokeLinejoin="round" />

          {routeLines.map((pts, i) => (
            <g key={`${routeKey}-${i}`} className="pointer-events-none">
              <path d={lineD(pts)} className={`${styles.routeCasing} fill-none stroke-white`} strokeLinecap="round" strokeLinejoin="round" />
              <path
                d={lineD(pts)}
                pathLength={1}
                className={`${styles.routeLine} fill-none stroke-coral-600`}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {!reducedMotion && pts.length > 1 && (
                <g>
                  <animateMotion dur={`${Math.min(6, Math.max(2, pts.length * 0.5))}s`} repeatCount="indefinite" path={lineD(pts)} />
                  <g className={styles.marker}>
                    <circle r={3.2} className="fill-white stroke-coral-700" strokeWidth={1.6} />
                  </g>
                </g>
              )}
            </g>
          ))}

          {connectors.map((c) => (
            <g
              key={c.id}
              transform={`translate(${c.point[0]} ${c.point[1]})`}
              className="pointer-events-none"
              opacity={c.usable === false ? 0.3 : undefined}
            >
              <g className={styles.marker}>
                <circle r={8} className="fill-ink-800 stroke-white" strokeWidth={1.5} />
                {c.kind === "stair" ? (
                  <path d="M-4.5 3.5h3v-2.5h3v-2.5h3" className="fill-none stroke-white" strokeWidth={1.5} strokeLinejoin="round" />
                ) : (
                  <path d="M-2.8 -1.2l2.8-3.6l2.8 3.6zM-2.8 1.2l2.8 3.6l2.8-3.6z" className="fill-white" />
                )}
              </g>
            </g>
          ))}

          {labels.map((l) => (
            <text
              key={`l-${l.id}`}
              x={l.x}
              y={l.y}
              textAnchor="middle"
              dominantBaseline="central"
              className={`${l.small ? styles.labelSmall : styles.label} ${l.strong ? "fill-coral-900" : l.quiet || l.small ? "fill-ink-600" : "fill-ink-900"} stroke-sand-50`}
              style={l.shiftPx ? { transform: `translateY(calc(${l.shiftPx}px * var(--inv)))` } : undefined}
            >
              {l.text}
            </text>
          ))}

          {startPoint && (
            <g transform={`translate(${startPoint[0]} ${startPoint[1]})`} className="pointer-events-none">
              <g className={styles.marker}>
                {startHere &&
                  (reducedMotion ? (
                    <circle r={14} className="fill-jade-500/25" />
                  ) : (
                    <circle r={7.5} className="fill-jade-500/40">
                      <animate attributeName="r" values="7.5;22" dur="1.8s" repeatCount="indefinite" />
                      <animate attributeName="opacity" values="0.9;0" dur="1.8s" repeatCount="indefinite" />
                    </circle>
                  ))}
                <circle r={7.5} className="fill-jade-500 stroke-white" strokeWidth={2.5} />
                {startHere && (
                  <g>
                    <rect
                      x={-HERE_PILL_W / 2}
                      y={-38}
                      width={HERE_PILL_W}
                      height={22}
                      rx={11}
                      className="fill-jade-700 stroke-white"
                      strokeWidth={1.5}
                    />
                    <text y={-27} textAnchor="middle" dominantBaseline="central" className="fill-white text-[11.5px] font-bold">
                      You are here
                    </text>
                    <path d="M-5 -16.5l5 6l5 -6z" className="fill-jade-700" />
                  </g>
                )}
              </g>
            </g>
          )}
          {destPoint && (
            <g transform={`translate(${destPoint[0]} ${destPoint[1]})`} className="pointer-events-none">
              <g className={styles.marker}>
                <path d="M0 0c-2-5-8-8.5-8-15a8 8 0 0 1 16 0c0 6.5-6 10-8 15z" className="fill-coral-700 stroke-white" strokeWidth={2} />
                <circle cy={-15} r={3} className="fill-white" />
              </g>
            </g>
          )}

          {handoffs.map((h) => {
            const w = h.text.length * 6.6 + 30;
            return (
              <g key={`h-${h.to}-${h.point.join(",")}`} transform={`translate(${h.point[0]} ${h.point[1]})`}>
                <g className={`${styles.marker} cursor-pointer`} data-handoff={h.to}>
                  <rect x={-w / 2} y={-40} width={w} height={26} rx={13} className="fill-ink-800 stroke-white" strokeWidth={1.5} />
                  <path
                    d={h.direction === "up" ? `M${-w / 2 + 12} -24l5 -5l5 5` : `M${-w / 2 + 12} -30l5 5l5 -5`}
                    className="fill-none stroke-coral-300"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <text x={-w / 2 + 25} y={-27} dominantBaseline="central" className="fill-white text-[11.5px] font-bold">
                    {h.text}
                  </text>
                  <path d="M-5 -14l5 6l5 -6z" className="fill-ink-800" />
                </g>
              </g>
            );
          })}
        </g>
      </svg>

      {/* Bottom left, clear of the floor buttons (top right) at any sheet height. Behind a tall
          sheet there's no room for +/-: pinch, or collapse the sheet. Recentre always stays. */}
      <div className="absolute left-3 flex flex-col gap-2" style={{ bottom: insetBottomPx + 12 }}>
        {!compactControls && (
          <>
            <button type="button" onClick={() => zoomBy(1.6)} aria-label="Zoom in" className={controlButton}>
              <Plus aria-hidden="true" className="h-4.5 w-4.5" />
            </button>
            <button type="button" onClick={() => zoomBy(1 / 1.6)} aria-label="Zoom out" className={controlButton}>
              <Minus aria-hidden="true" className="h-4.5 w-4.5" />
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => (focus ? frame(focus.box) : reset())}
          aria-label={focus ? "Back to the route" : "Show the whole floor"}
          className={controlButton}
        >
          <LocateFixed aria-hidden="true" className="h-4.5 w-4.5" />
        </button>
      </div>

      {wheelHint && (
        <p
          role="status"
          className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink-800/90 px-4 py-2 text-sm font-semibold text-white shadow-card"
        >
          Hold Ctrl (or ⌘) and scroll to zoom
        </p>
      )}
    </div>
  );
}
