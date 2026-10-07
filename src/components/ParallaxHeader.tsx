"use client";

import { useEffect, useRef } from "react";
import { getScrollTop, onAppScroll } from "@/lib/scroll";

/**
 * Page header that drifts and fades as the app (#app-scroll) scrolls, giving the list
 * beneath it a parallax feel. A soft coral glow behind the title, with a
 * fainter jade one trailing off to the right (the brand's two gradients),
 * moves at a different rate for depth. Disabled for users who prefer reduced motion.
 */
export function ParallaxHeader({ children }: { children: React.ReactNode }) {
  const headerRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const y = getScrollTop();
      const header = headerRef.current;
      const glow = glowRef.current;
      if (header) {
        // Drift down slower than the page and fade out before the day tabs
        // scroll underneath, so the two never visibly overlap.
        const t = Math.min(y, 140);
        header.style.transform = `translate3d(0, ${t * 0.3}px, 0)`;
        header.style.opacity = String(Math.max(0, 1 - t / 110));
      }
      if (glow) glow.style.transform = `translate3d(0, ${y * -0.18}px, 0) scale(${1 + Math.min(y, 400) / 1600})`;
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    const unsubscribe = onAppScroll(onScroll);
    return () => {
      unsubscribe();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className="relative">
      {/* Scales about its top-right corner and the jade glow stays inside the header's box, so
          neither ever pushes past the right edge: that would give #app-scroll sideways overflow
          at 375px (only boxes count, not the blur). Overflow to the left isn't scrollable. */}
      <div
        ref={glowRef}
        aria-hidden="true"
        className="parallax-layer pointer-events-none absolute inset-0 -z-10 origin-top-right"
      >
        <div className="absolute -left-16 -top-24 h-56 w-72 rounded-full bg-coral-300/35 blur-3xl" />
        <div className="absolute -top-10 right-0 h-32 w-48 rounded-full bg-jade-300/20 blur-3xl" />
      </div>
      <div ref={headerRef} className="parallax-layer">
        {children}
      </div>
    </div>
  );
}
