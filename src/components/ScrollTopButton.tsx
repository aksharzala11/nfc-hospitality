"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ArrowUp } from "lucide-react";
import { getScrollTop, onAppScroll, scrollAppTo } from "@/lib/scroll";

/**
 * Small floating "back to top" button that appears once the app (#app-scroll) is scrolled.
 * `skip`: path prefixes where it stays off (the History page, which has its own year strip and
 * "Back to the start", and whose photographs nothing should float over).
 */
export function ScrollTopButton({ threshold = 480, skip = [] }: { threshold?: number; skip?: string[] }) {
  const [visible, setVisible] = useState(false);
  const pathname = usePathname();
  const skipped = skip.some((p) => pathname === p || pathname?.startsWith(`${p}/`));

  useEffect(() => {
    if (skipped) return;
    const onScroll = () => setVisible(getScrollTop() > threshold);
    onScroll();
    return onAppScroll(onScroll);
  }, [threshold, skipped]);

  if (skipped) return null;

  return (
    <button
      type="button"
      aria-label="Back to top"
      // Browsers don't turn smooth scrolling off for reduced motion, so jump instead.
      onClick={() =>
        scrollAppTo(0, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth")
      }
      // Solid ink in every view, so it stands apart from the white tiles and the coral accents.
      className={`fixed right-4 z-40 flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-ink-700 to-ink-950 text-sand-50 shadow-[0_10px_24px_-8px_rgb(20_42_51/0.65)] ring-2 ring-sand-50/80 transition-all duration-300 hover:from-ink-800 active:scale-95 motion-reduce:transition-none ${
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0"
      }`}
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 5.25rem)" }}
    >
      <ArrowUp className="h-4 w-4" strokeWidth={2.4} />
    </button>
  );
}
