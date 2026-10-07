"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { VenueLevelId, VenuePoint } from "@/lib/venue/types";
import type { RouteClimb, VenueRoute } from "@/lib/venue/route";
import { polygonPath, type ClientVenue } from "@/lib/venue/view";
import styles from "./map.module.css";

const TILT = { min: 20, max: 72, start: 56 };
const SPIN_START = -32;
const TAP_SLOP_PX = 8;

/**
 * Every level stacked in 3D with CSS transforms (no WebGL): each floor is its own flat SVG in a
 * preserve-3d stage, lifted by its `order` (basement at the bottom, the mezzanine on top) and
 * turned by rotateX / rotateZ. Drag to turn it; tap a
 * floor to open it in 2D. The route is drawn on each floor it crosses, with a vertical line where
 * it changes floors (two crossed planes, so it shows from any angle).
 *
 * Only what a floor draws catches a tap (its outline and name, not the whole shared frame), so a
 * tap on the floor below isn't taken by the empty part of the one above. Floors above the route's
 * highest floor (or the destination's floor) fade out and let taps through, so a route on the
 * second floor isn't hidden under the mezzanine above it.
 */
export function Map3D({
  venue,
  currentLevel,
  route,
  destId,
  startId,
  destPoint,
  startPoint,
  reducedMotion,
  insetBottomPx = 0,
  onPickLevel,
}: {
  venue: ClientVenue;
  currentLevel: VenueLevelId;
  route: VenueRoute | null;
  destId: string | null;
  startId: string | null;
  destPoint: { level: VenueLevelId; point: VenuePoint } | null;
  startPoint: { level: VenueLevelId; point: VenuePoint } | null;
  reducedMotion: boolean;
  /** Height (px) the sheet covers at the bottom: the stack centres above it. */
  insetBottomPx?: number;
  onPickLevel: (id: VenueLevelId) => void;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 360, h: 420 });
  const [angle, setAngle] = useState({ tilt: TILT.start, spin: SPIN_START });
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // One frame for every level (they share map coordinates).
  const frame = useMemo(() => {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const l of venue.levels) {
      x0 = Math.min(x0, l.bounds.x);
      y0 = Math.min(y0, l.bounds.y);
      x1 = Math.max(x1, l.bounds.x + l.bounds.width);
      y1 = Math.max(y1, l.bounds.y + l.bounds.height);
    }
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }, [venue]);

  const n = venue.levels.length;
  // Height rank by `order` (0 = bottom), whatever order the levels arrive in.
  const rank = useMemo(
    () => new Map([...venue.levels].sort((a, b) => a.order - b.order).map((l, i) => [l.id, i] as const)),
    [venue],
  );
  const planeW = Math.min(size.w * 0.74, 460);
  const planeH = planeW * (frame.height / frame.width);
  const room = Math.max(size.h - insetBottomPx, size.h * 0.5);
  const gap = Math.max(40, Math.min(96, room * 0.2));
  const unit = planeW / frame.width; // px per map unit
  const zOf = (id: VenueLevelId) => ((rank.get(id) ?? 0) - (n - 1) / 2) * gap;
  const px = ([x, y]: VenuePoint) => [(x - frame.x) * unit, (y - frame.y) * unit] as const;

  const byLevel = useMemo(() => {
    const out = new Map<VenueLevelId, VenuePoint[][]>();
    for (const s of route?.segments ?? []) {
      if (s.type !== "walk" || s.points.length < 2) continue;
      out.set(s.level, [...(out.get(s.level) ?? []), s.points]);
    }
    return out;
  }, [route]);
  const climbs = (route?.segments.filter((s) => s.type === "connector") ?? []) as RouteClimb[];

  // The highest floor that matters: the route's top floor, else the destination's.
  const orderOf = (id: VenueLevelId) => venue.levels.find((l) => l.id === id)?.order ?? 0;
  const topOrder = route ? Math.max(...route.levels.map(orderOf)) : destPoint ? orderOf(destPoint.level) : Infinity;

  // Drag to turn: horizontal spins, vertical tilts. A tap on a floor opens it.
  const drag = useRef<{ x: number; y: number; tilt: number; spin: number; moved: boolean; target: Element | null } | null>(null);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, tilt: angle.tilt, spin: angle.spin, moved: false, target: e.target as Element };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Not capturable (synthetic): dragging still works while over the box.
    }
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) > TAP_SLOP_PX) {
      d.moved = true;
      setDragging(true);
    }
    if (!d.moved) return;
    setAngle({
      spin: d.spin + dx * 0.45,
      tilt: Math.min(TILT.max, Math.max(TILT.min, d.tilt - dy * 0.3)),
    });
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (d && !d.moved) {
      const level = d.target?.closest?.("[data-level]")?.getAttribute("data-level");
      if (level) onPickLevel(level as VenueLevelId);
    }
  };

  const strokeUnit = 1 / unit; // map units per screen px on a plane

  return (
    <div
      ref={boxRef}
      className="absolute inset-0 cursor-grab touch-none select-none overflow-hidden active:cursor-grabbing"
      style={{ perspective: "1100px", perspectiveOrigin: "50% 38%" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        drag.current = null;
        setDragging(false);
      }}
      role="img"
      aria-label="All floors stacked in 3D. Drag to turn; tap a floor to open it."
    >
      <div
        className={`${styles.stage} ${dragging || reducedMotion ? styles.stack3dDragging : styles.stack3d} absolute left-1/2`}
        style={{
          width: planeW,
          height: planeH,
          top: room / 2 + 16,
          marginLeft: -planeW / 2,
          marginTop: -planeH / 2,
          transform: `rotateX(${angle.tilt}deg) rotateZ(${angle.spin}deg)`,
        }}
      >
        {venue.levels.map((l) => {
          const lines = byLevel.get(l.id) ?? [];
          const active = l.id === currentLevel;
          const onRoute = route?.levels.includes(l.id) ?? false;
          const faded = l.order > topOrder;
          // Taps: only the floor's own outline and name pill (pointer-events-auto), never the
          // transparent rest of the plane, and nothing on a faded floor.
          const hit = faded ? "" : "pointer-events-auto cursor-pointer";
          return (
            <div
              key={l.id}
              data-level={l.id}
              className={`${styles.plane} pointer-events-none absolute inset-0 transition-opacity duration-300`}
              style={{ transform: `translateZ(${zOf(l.id)}px)`, opacity: faded ? 0.14 : 1 }}
            >
              <svg
                viewBox={`${frame.x} ${frame.y} ${frame.width} ${frame.height}`}
                className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
                aria-hidden="true"
              >
                <rect
                  x={l.bounds.x}
                  y={l.bounds.y}
                  width={l.bounds.width}
                  height={l.bounds.height}
                  rx={6 * strokeUnit}
                  className={`${hit} ${active ? "fill-sand-100/90 stroke-coral-600" : onRoute ? "fill-sand-50/85 stroke-ink-400" : "fill-sand-50/70 stroke-ink-300"}`}
                  strokeWidth={1.4 * strokeUnit}
                />
                {l.blocks.length > 0 && <path d={l.blocks.map(polygonPath).join("")} className="fill-sand-300/60" />}
                {l.rooms.map((r) => (
                  <path
                    key={r.id}
                    d={polygonPath(r.pts)}
                    className={
                      r.id === destId
                        ? "fill-coral-300"
                        : r.id === startId
                          ? "fill-jade-200"
                          : r.kind === "corridor"
                            ? "fill-transparent"
                            : r.closed
                              ? "fill-sand-200/70" // staff only: quieter (the floor view hatches them)
                              : "fill-white/80"
                    }
                  />
                ))}
                <path d={l.walls} className="fill-none stroke-ink-700" strokeWidth={0.9 * strokeUnit} />
                {lines.map((pts, i) => (
                  <polyline
                    key={i}
                    points={pts.map((p) => p.join(",")).join(" ")}
                    className="fill-none stroke-coral-600"
                    strokeWidth={3.2 * strokeUnit}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ))}
                {startPoint?.level === l.id && (
                  <circle cx={startPoint.point[0]} cy={startPoint.point[1]} r={5 * strokeUnit} className="fill-jade-500 stroke-white" strokeWidth={1.5 * strokeUnit} />
                )}
                {destPoint?.level === l.id && (
                  <circle cx={destPoint.point[0]} cy={destPoint.point[1]} r={6 * strokeUnit} className="fill-coral-700 stroke-white" strokeWidth={1.5 * strokeUnit} />
                )}
              </svg>
              <span
                className={`${hit} absolute -left-2 -top-7 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold shadow-card ${
                  active ? "bg-ink-800 text-white" : "bg-white text-ink-800 ring-1 ring-sand-300"
                }`}
              >
                {l.name}
              </span>
            </div>
          );
        })}

        {climbs.map((c, i) => {
          const za = zOf(c.from);
          const zb = zOf(c.to);
          const [x, y] = px(c.fromPoint);
          const z0 = Math.min(za, zb);
          const h = Math.abs(zb - za);
          const beam = "absolute w-[3px] rounded-full bg-coral-600";
          return (
            <div key={`${c.connectorId}-${i}`} className={styles.plane} style={{ position: "absolute", left: x, top: y }}>
              <div className={beam} style={{ height: h, transformOrigin: "0 0", transform: `translateZ(${z0}px) rotateX(90deg)` }} />
              <div className={beam} style={{ height: h, transformOrigin: "0 0", transform: `translateZ(${z0}px) rotateZ(90deg) rotateX(90deg)` }} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
