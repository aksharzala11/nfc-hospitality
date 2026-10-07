"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clearSplashCookie } from "@/lib/splash";
import styles from "./splash.module.css";

/** Playback speed once skipped: the 0.8 s blur-out in about a third of a second. */
const SKIP_RATE = 2.5;
/**
 * Unmount even if animationend never arrives. Counted from hydration, which is never before the
 * CSS animation (it starts with the server HTML), so this is always after the 2 s it takes.
 */
const FALLBACK_UNMOUNT_MS = 3200;

/**
 * Set once the splash has been shown in this document. The router keeps each layout's server
 * payload (splash included) for back/forward, so leaving this layout for another (admin to
 * delegate view) and coming back would otherwise remount it and play it again. Module state is
 * per document on the client, and only ever written in an effect, so hydration always starts
 * from false like the server.
 */
let shownInThisDocument = false;

/**
 * Client island of <LoginSplash>. The reveal itself is pure CSS (`.reveal` in
 * splash.module.css) and runs from the server HTML; this only
 *  - deletes the one-shot `hh_splash` cookie if it's still there (the middleware has normally
 *    used it up on this page's request already, so a reload never replays the splash);
 *  - lets a tap, click or key press skip the rest of the hold (a quick blur-out from wherever
 *    the animation is, so nothing jumps);
 *  - removes the overlay from the DOM once it has faded.
 * Its first render matches the server's (no cookie, media or storage reads during render), and
 * it plays at most once per page load.
 * It never takes focus or announces anything: the artwork is aria-hidden and the page underneath
 * is already in the DOM with focus where it would be anyway.
 */
export function SplashReveal({ children }: { children: React.ReactNode }) {
  const [done, setDone] = useState(() => shownInThisDocument);
  const ref = useRef<HTMLDivElement>(null);
  const skipped = useRef(false);

  const skip = useCallback(() => {
    if (skipped.current) return;
    skipped.current = true;
    const el = ref.current;
    const animations = el && typeof el.getAnimations === "function" ? el.getAnimations() : [];
    if (animations.length === 0) {
      setDone(true);
      return;
    }
    for (const animation of animations) {
      if (animation.playState === "finished") continue;
      // Past the hold (animation-delay), then play the rest faster. Moving the same animation
      // forward, rather than swapping in another one, keeps a tap mid-blur seamless.
      const delay = Number(animation.effect?.getTiming().delay ?? 0);
      const at = animation.currentTime;
      if (typeof at === "number" && at < delay) animation.currentTime = delay;
      if (typeof animation.updatePlaybackRate === "function") animation.updatePlaybackRate(SKIP_RATE);
      else animation.playbackRate = SKIP_RATE;
    }
  }, []);

  useEffect(() => {
    shownInThisDocument = true;
    clearSplashCookie();
  }, []);

  useEffect(() => {
    if (done) return;
    const timer = window.setTimeout(() => setDone(true), FALLBACK_UNMOUNT_MS);
    // Keyboard users: the page underneath already has focus; any key hurries the reveal along.
    window.addEventListener("keydown", skip);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", skip);
    };
  }, [done, skip]);

  if (done) return null;

  return (
    <div
      ref={ref}
      className={styles.reveal}
      onPointerDown={skip}
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget) setDone(true);
      }}
    >
      {children}
    </div>
  );
}
