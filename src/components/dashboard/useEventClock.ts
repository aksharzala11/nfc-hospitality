"use client";

import { useEffect, useRef, useState } from "react";

/** Trust the device clock when it agrees with the server to within this much. */
const DEVICE_CLOCK_TOLERANCE_MS = 5 * 60_000;
/** Ignore offset changes smaller than this (network latency noise between refreshes). */
const RESYNC_THRESHOLD_MS = 15_000;

/**
 * A ticking "now" (epoch ms) that starts from the server's clock and honours
 * `?now=` time travel.
 *
 * - First render (SSR and hydration) returns `serverNow` exactly, so markup matches.
 * - After mount it ticks once per second, aligned to whole seconds.
 * - Time travel: offset = serverNow − Date.now(), taken on mount, so
 *   `?now=2026-10-08T16:59` counts down from one minute. AutoRefresh re-renders
 *   with the same frozen `serverNow`, which leaves the offset (and the display) untouched.
 * - Real time: the device clock is used as-is (no latency lag, no jump when a
 *   cached page is restored), unless it is clearly wrong, in which case the
 *   server's clock wins. Small differences between refreshes are ignored.
 */
export function useEventClock(serverNowIso: string, traveling: boolean): number {
  const serverMs = Date.parse(serverNowIso);
  const [now, setNow] = useState(serverMs);
  const offset = useRef<number | null>(null);

  // Declared before the ticker so the offset is in place for the first tick.
  useEffect(() => {
    const skew = serverMs - Date.now();
    const wanted = traveling || Math.abs(skew) > DEVICE_CLOCK_TOLERANCE_MS ? skew : 0;
    if (offset.current === null || Math.abs(wanted - offset.current) > RESYNC_THRESHOLD_MS) {
      offset.current = wanted;
      setNow(Date.now() + wanted);
    }
  }, [serverMs, traveling]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const t = Date.now() + (offset.current ?? 0);
      setNow(t);
      // Land just after the next whole second so the seconds digit flips on time.
      timer = setTimeout(tick, 1000 - (((t % 1000) + 1000) % 1000) + 8);
    };
    tick();
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      clearTimeout(timer);
      tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return now;
}
