"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * Re-renders server components periodically (and when the tab regains focus)
 * so "happening now" and menu reveals stay current without a manual reload.
 * `skip`: path prefixes where it stays off (the venue map, whose ~200 KB of floor plans nothing
 * time-dependent would justify re-sending every minute).
 */
export function AutoRefresh({
  intervalMs = 60_000,
  enabled: enabledProp = true,
  skip = [],
}: {
  intervalMs?: number;
  enabled?: boolean;
  skip?: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const enabled = enabledProp && !skip.some((p) => pathname === p || pathname?.startsWith(`${p}/`));

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => router.refresh(), intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, intervalMs, enabled]);

  return null;
}
