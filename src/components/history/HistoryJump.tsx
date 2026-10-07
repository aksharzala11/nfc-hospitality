"use client";

import type { MouseEvent, ReactNode } from "react";
import { getScroller, scrollAppTo } from "@/lib/scroll";

/** Set on a jump's target while it holds focus from a keyboard jump: its focus ring shows. */
const KEYBOARD_FOCUS = "data-keyboard-focus";

/**
 * Jump the app's scroller (#app-scroll) to the element with this id, at once, and move focus
 * to it (give the target tabIndex -1). The target's own scroll-margin-top is honoured, so a
 * year's heading lands under the sticky year strip exactly as its plain `#year-…` anchor does.
 * Returns false when there is nothing to jump to (the caller then leaves the link alone).
 *
 * `keyboard`: the jump came from the keyboard (Enter on the link), so the target shows a focus
 * ring. It is said outright with `data-keyboard-focus`, not left to :focus-visible: browsers
 * disagree on a focus moved by script, and Safari would ring the heading after every tap.
 */
export function jumpToId(id: string, keyboard = false): boolean {
  const target = document.getElementById(id);
  const scroller = getScroller();
  if (!target || !scroller) return false;
  target.toggleAttribute(KEYBOARD_FOCUS, keyboard);
  if (keyboard) target.addEventListener("blur", () => target.removeAttribute(KEYBOARD_FOCUS), { once: true });
  const margin = parseFloat(window.getComputedStyle(target).scrollMarginTop) || 0;
  const top = scroller.scrollTop + target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - margin;
  // Instant: a smooth scroll across forty years of photographs would load every one on the way.
  scrollAppTo(Math.max(0, Math.round(top)), "auto");
  target.focus({ preventScroll: true });
  return true;
}

/** A plain click (no modifier key, primary button): the ones a jump may take over. */
export function isPlainClick(event: MouseEvent<HTMLAnchorElement>) {
  return event.button === 0 && !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);
}

/** The click came from the keyboard (Enter on the link): a pointer's click counts at least 1. */
export function isKeyboardClick(event: MouseEvent<HTMLAnchorElement>) {
  return event.detail === 0;
}

/**
 * A link to a place on the History page: `<a href="#id">`, which works as it is without
 * JavaScript, and with it jumps through the app's scroller without adding a history entry.
 */
export function HistoryJump({ to, className, children }: { to: string; className?: string; children: ReactNode }) {
  return (
    <a
      href={`#${to}`}
      className={className}
      onClick={(event) => {
        if (isPlainClick(event) && jumpToId(to, isKeyboardClick(event))) event.preventDefault();
      }}
    >
      {children}
    </a>
  );
}
