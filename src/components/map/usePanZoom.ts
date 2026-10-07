"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { Box } from "@/lib/venue/view";

/**
 * Pan and zoom for the 2D floor plan (an <svg> whose viewBox is the level, with one <g> inside
 * that carries the view transform). One finger drags, two pinch (about their midpoint), a
 * trackpad pinch or Ctrl / Cmd + wheel zooms about the pointer (a plain wheel scrolls the page, and
 * onWheelHint says how to zoom); the page's own zoom is off (fixed-scale UI), so the +/- and
 * recentre buttons call zoomBy() / reset(). A tap (little movement, short) is reported with the
 * element it started on, so rooms can be picked without click events fighting the drag; when
 * onTap handles a touch or pen tap, the click the browser sends after it is swallowed, so it
 * can't land on whatever the tap just opened (the room's sheet) under the finger.
 *
 * During a gesture the transform is written straight to the DOM (no React render per frame);
 * `--inv` on the <svg> is 1 / (screen px per map unit), which labels, markers and strokes use to
 * stay the same size on screen. `zoom` (React state) updates when a gesture or animation ends,
 * for the things that re-render by zoom (which labels fit); it is null until the <svg> has been
 * measured (server render, first client render), when nothing zoom-dependent should show.
 *
 * The view is held so that the middle of what you can see stays over the building: `insets` are
 * the parts of the box that controls and the room sheet cover (the same ones fitBox() frames
 * between), so a floor that is a thin strip (the mezzanine) sits above an open sheet, not behind it.
 */
export type PanZoomView = { k: number; tx: number; ty: number };

/** Screen px of the map's box covered on each side (controls, the room sheet). */
export type PanZoomInsets = { top: number; right: number; bottom: number; left: number };

type Rect = { x: number; y: number; width: number; height: number };

const TAP_SLOP_PX = 8;
const TAP_MAX_MS = 600;
/** How long after a handled touch tap its follow-up click is swallowed. */
const GHOST_CLICK_MS = 450;

/** Swallows the next click anywhere (capture phase) within GHOST_CLICK_MS. */
function swallowNextClick() {
  const swallow = (ev: Event) => {
    ev.preventDefault();
    ev.stopPropagation();
    done();
  };
  const done = () => {
    window.removeEventListener("click", swallow, true);
    window.clearTimeout(timer);
  };
  window.addEventListener("click", swallow, true);
  const timer = window.setTimeout(done, GHOST_CLICK_MS);
}
const EASE = (t: number) => 1 - Math.pow(1 - t, 3);

export function usePanZoom({
  svgRef,
  gRef,
  viewBox,
  content,
  maxK,
  insets,
  onTap,
  onWheelHint,
  reducedMotion,
}: {
  svgRef: RefObject<SVGSVGElement | null>;
  gRef: RefObject<SVGGElement | null>;
  /** The <svg>'s viewBox (the level with a margin). */
  viewBox: Rect;
  /** What must stay under the middle of what you can see (the level's bounds). */
  content: Rect;
  maxK: number;
  /** What covers the box's edges (px): the visible middle is taken between them. Absent = nothing. */
  insets?: PanZoomInsets;
  /** A tap on the plan, with the element it started on; returns true when it did something. */
  onTap?: (target: Element | null) => boolean;
  /** A plain wheel over the plan (it scrolls the page): say how to zoom. */
  onWheelHint?: () => void;
  reducedMotion: boolean;
}) {
  const view = useRef<PanZoomView>({ k: 1, tx: 0, ty: 0 });
  /** Screen px per viewBox unit (the <svg>'s own scale). */
  const ppu = useRef(1);
  const [zoom, setZoom] = useState<{ k: number; ppu: number } | null>(null);
  const frame = useRef(0);
  const tween = useRef(0);
  const onTapRef = useRef(onTap);
  onTapRef.current = onTap;
  const onWheelHintRef = useRef(onWheelHint);
  onWheelHintRef.current = onWheelHint;
  const insetsRef = useRef(insets);
  insetsRef.current = insets;
  /** The <svg>'s size on screen (px), from measure(). */
  const size = useRef<{ w: number; h: number } | null>(null);

  const clamp = useCallback(
    (v: PanZoomView): PanZoomView => {
      const k = Math.min(maxK, Math.max(1, v.k));
      // Keep the middle of what you can see over the building: the box's centre, moved off the
      // sides that are covered (the same limits as visible(), so what fitBox() frames is allowed).
      const i = insetsRef.current;
      const s = size.current;
      let dx = 0;
      let dy = 0;
      if (i && s) {
        dx = (Math.min(i.left, s.w * 0.2) - Math.min(i.right, s.w * 0.2)) / 2 / ppu.current;
        dy = (Math.min(i.top, s.h * 0.25) - Math.min(i.bottom, s.h * 0.6)) / 2 / ppu.current;
      }
      const cx = viewBox.x + viewBox.width / 2 + dx;
      const cy = viewBox.y + viewBox.height / 2 + dy;
      const tx = Math.min(cx - content.x * k, Math.max(cx - (content.x + content.width) * k, v.tx));
      const ty = Math.min(cy - content.y * k, Math.max(cy - (content.y + content.height) * k, v.ty));
      return { k, tx, ty };
    },
    [viewBox.x, viewBox.y, viewBox.width, viewBox.height, content.x, content.y, content.width, content.height, maxK],
  );

  const measure = useCallback(() => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (m && m.a > 0) ppu.current = m.a;
    const r = svg?.getBoundingClientRect();
    if (r && r.width > 0 && r.height > 0) size.current = { w: r.width, h: r.height };
  }, [svgRef]);

  const apply = useCallback(() => {
    const g = gRef.current;
    const svg = svgRef.current;
    if (!g || !svg) return;
    const v = view.current;
    g.setAttribute("transform", `translate(${v.tx} ${v.ty}) scale(${v.k})`);
    svg.style.setProperty("--inv", String(1 / (ppu.current * v.k)));
  }, [gRef, svgRef]);

  const commit = useCallback(() => setZoom({ k: view.current.k, ppu: ppu.current }), []);

  const schedule = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      apply();
    });
  }, [apply]);

  const setView = useCallback(
    (v: PanZoomView, andCommit = false) => {
      view.current = clamp(v);
      schedule();
      if (andCommit) commit();
    },
    [clamp, schedule, commit],
  );

  const stopTween = () => {
    if (tween.current) cancelAnimationFrame(tween.current);
    tween.current = 0;
  };

  const animateTo = useCallback(
    (target: PanZoomView) => {
      stopTween();
      const to = clamp(target);
      if (reducedMotion) {
        view.current = to;
        apply();
        commit();
        return;
      }
      const from = { ...view.current };
      const start = performance.now();
      const step = (t: number) => {
        // Never before the start: a frame's timestamp can be a little earlier than `start`.
        const p = Math.min(1, Math.max(0, (t - start) / 380));
        const e = EASE(p);
        view.current = {
          k: from.k + (to.k - from.k) * e,
          tx: from.tx + (to.tx - from.tx) * e,
          ty: from.ty + (to.ty - from.ty) * e,
        };
        apply();
        if (p < 1) tween.current = requestAnimationFrame(step);
        else {
          tween.current = 0;
          commit();
        }
      };
      tween.current = requestAnimationFrame(step);
    },
    [clamp, apply, commit, reducedMotion],
  );

  /** Client (px) -> viewBox units. */
  const toView = useCallback(
    (x: number, y: number): [number, number] | null => {
      const m = svgRef.current?.getScreenCTM();
      if (!m) return null;
      const p = new DOMPoint(x, y).matrixTransform(m.inverse());
      return [p.x, p.y];
    },
    [svgRef],
  );

  /** The part of the viewBox you can see (meet leaves bands on one axis), less insets (px). */
  const visible = useCallback(
    (insetBottomPx = 0, insetTopPx = 0, insetRightPx = 0, insetLeftPx = 0) => {
      const svg = svgRef.current;
      if (!svg) return null;
      const r = svg.getBoundingClientRect();
      const a = toView(r.left + Math.min(insetLeftPx, r.width * 0.2), r.top + Math.min(insetTopPx, r.height * 0.25));
      const b = toView(r.right - Math.min(insetRightPx, r.width * 0.2), r.bottom - Math.min(insetBottomPx, r.height * 0.6));
      if (!a || !b) return null;
      return { x0: a[0], y0: a[1], x1: b[0], y1: b[1] };
    },
    [svgRef, toView],
  );

  const zoomAt = useCallback(
    (p: [number, number], factor: number, andCommit: boolean) => {
      const v = view.current;
      const k = Math.min(maxK, Math.max(1, v.k * factor));
      const f = k / v.k;
      setView({ k, tx: p[0] - (p[0] - v.tx) * f, ty: p[1] - (p[1] - v.ty) * f }, andCommit);
    },
    [maxK, setView],
  );

  /** Zooms about the middle of what you can see. */
  const zoomBy = useCallback(
    (factor: number) => {
      const vis = visible();
      if (!vis) return;
      const p: [number, number] = [(vis.x0 + vis.x1) / 2, (vis.y0 + vis.y1) / 2];
      const v = view.current;
      const k = Math.min(maxK, Math.max(1, v.k * factor));
      const f = k / v.k;
      animateTo({ k, tx: p[0] - (p[0] - v.tx) * f, ty: p[1] - (p[1] - v.ty) * f });
    },
    [visible, maxK, animateTo],
  );

  /** Frames a box of map units (a room, a route) in what you can see between the insets. */
  const fitBox = useCallback(
    (
      box: Box,
      {
        insetBottomPx = 0,
        insetTopPx = 0,
        insetRightPx = 0,
        insetLeftPx = 0,
        maxZoom = maxK,
        animate = true,
      }: {
        insetBottomPx?: number;
        insetTopPx?: number;
        insetRightPx?: number;
        insetLeftPx?: number;
        maxZoom?: number;
        animate?: boolean;
      } = {},
    ) => {
      measure();
      const vis = visible(insetBottomPx, insetTopPx, insetRightPx, insetLeftPx);
      if (!vis) return;
      const w = Math.max(box.x1 - box.x0, 1);
      const h = Math.max(box.y1 - box.y0, 1);
      const k = Math.min(maxZoom, maxK, Math.max(1, Math.min(((vis.x1 - vis.x0) * 0.78) / w, ((vis.y1 - vis.y0) * 0.78) / h)));
      const cx = (vis.x0 + vis.x1) / 2;
      const cy = (vis.y0 + vis.y1) / 2;
      const target = { k, tx: cx - ((box.x0 + box.x1) / 2) * k, ty: cy - ((box.y0 + box.y1) / 2) * k };
      if (animate) animateTo(target);
      else {
        view.current = clamp(target);
        apply();
        commit();
      }
    },
    [measure, visible, maxK, animateTo, clamp, apply, commit],
  );

  const reset = useCallback(() => animateTo({ k: 1, tx: 0, ty: 0 }), [animateTo]);

  // Pointer and wheel handling on the <svg>.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let tap: { x: number; y: number; t: number; target: Element | null; moved: boolean } | null = null;
    let pan: { start: [number, number]; view: PanZoomView } | null = null;
    let pinch: { dist: number; mid: [number, number]; view: PanZoomView } | null = null;
    let wheelTimer = 0;

    const startPan = (x: number, y: number) => {
      const p = toView(x, y);
      pan = p ? { start: p, view: { ...view.current } } : null;
      pinch = null;
    };
    const startPinch = () => {
      const [a, b] = [...pointers.values()];
      const mid = toView((a.x + b.x) / 2, (a.y + b.y) / 2);
      pinch = mid ? { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid, view: { ...view.current } } : null;
      pan = null;
    };

    const down = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      stopTween();
      measure();
      try {
        svg.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic pointers can't be captured; the gesture still works while over the map.
      }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        tap = { x: e.clientX, y: e.clientY, t: performance.now(), target: e.target as Element | null, moved: false };
        startPan(e.clientX, e.clientY);
      } else {
        tap = null;
        if (pointers.size === 2) startPinch();
      }
    };
    const move = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > TAP_SLOP_PX) tap.moved = true;
      if (pointers.size === 1 && pan) {
        if (tap && !tap.moved) return;
        const p = toView(e.clientX, e.clientY);
        if (!p) return;
        setView({ k: pan.view.k, tx: pan.view.tx + p[0] - pan.start[0], ty: pan.view.ty + p[1] - pan.start[1] });
      } else if (pointers.size >= 2 && pinch) {
        const [a, b] = [...pointers.values()];
        const mid = toView((a.x + b.x) / 2, (a.y + b.y) / 2);
        if (!mid) return;
        const k = Math.min(maxK, Math.max(1, pinch.view.k * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.dist)));
        const mx = (pinch.mid[0] - pinch.view.tx) / pinch.view.k;
        const my = (pinch.mid[1] - pinch.view.ty) / pinch.view.k;
        setView({ k, tx: mid[0] - mx * k, ty: mid[1] - my * k });
      }
    };
    const up = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (tap && !tap.moved && pointers.size === 0 && performance.now() - tap.t < TAP_MAX_MS && e.type === "pointerup") {
        const handled = onTapRef.current?.(tap.target) ?? false;
        // The tap's compatibility click comes after this and is hit-tested against the page as it
        // is by then (the sheet that just opened): swallow it. A mouse click can't land there.
        if (handled && e.pointerType !== "mouse") swallowNextClick();
      }
      if (pointers.size === 1) {
        const [p] = [...pointers.values()];
        startPan(p.x, p.y);
      } else if (pointers.size === 0) {
        pan = null;
        pinch = null;
        tap = null;
        commit();
      }
    };
    const wheel = (e: WheelEvent) => {
      // A plain wheel (or a two-finger swipe) scrolls the page past the map; Ctrl / Cmd + wheel
      // and a trackpad pinch (which arrives as ctrl + wheel) zoom it.
      if (!e.ctrlKey && !e.metaKey) {
        onWheelHintRef.current?.();
        return;
      }
      e.preventDefault();
      stopTween();
      measure();
      const p = toView(e.clientX, e.clientY);
      if (!p) return;
      // A trackpad pinch sends small pixel deltas, a wheel notch about 100 px (or 3 lines).
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      const factor = Math.exp(-dy * (Math.abs(dy) < 30 ? 0.01 : 0.0022));
      zoomAt(p, factor, false);
      window.clearTimeout(wheelTimer);
      wheelTimer = window.setTimeout(commit, 160);
    };

    svg.addEventListener("pointerdown", down);
    svg.addEventListener("pointermove", move);
    svg.addEventListener("pointerup", up);
    svg.addEventListener("pointercancel", up);
    svg.addEventListener("wheel", wheel, { passive: false });
    return () => {
      svg.removeEventListener("pointerdown", down);
      svg.removeEventListener("pointermove", move);
      svg.removeEventListener("pointerup", up);
      svg.removeEventListener("pointercancel", up);
      svg.removeEventListener("wheel", wheel);
      window.clearTimeout(wheelTimer);
    };
  }, [svgRef, toView, setView, zoomAt, commit, measure, maxK]);

  // First paint: size labels and markers for the whole-floor view straight away (a frame
  // callback may not run until the tab is painted).
  useLayoutEffect(() => {
    measure();
    apply();
    commit();
  }, [measure, apply, commit]);

  // Re-measure on resize (the box, or the page's layout, changed).
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const ro = new ResizeObserver(() => {
      measure();
      view.current = clamp(view.current);
      apply();
      commit();
    });
    ro.observe(svg);
    return () => ro.disconnect();
  }, [svgRef, measure, clamp, apply, commit]);

  // The sheet over the map opened, closed or changed height: what was allowed may now sit behind
  // it. Hold the view again (no animation; a framed target follows from the caller's fitBox()).
  const insetBottom = Math.round((insets?.bottom ?? 0) / 24);
  useEffect(() => {
    if (tween.current) return;
    const held = clamp(view.current);
    if (held.tx === view.current.tx && held.ty === view.current.ty && held.k === view.current.k) return;
    view.current = held;
    apply();
  }, [insetBottom, clamp, apply]);

  useEffect(
    () => () => {
      if (frame.current) cancelAnimationFrame(frame.current);
      stopTween();
    },
    [],
  );

  return { zoom, zoomBy, fitBox, reset, view, apply };
}
