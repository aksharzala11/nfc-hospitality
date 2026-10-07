"use client";

import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useAppScrollLock } from "@/lib/scroll";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type SheetProps = {
  open: boolean;
  /** Escape, the backdrop and the close button call this (never while `busy`). */
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  /** Shown before the title, e.g. an avatar. */
  leading?: ReactNode;
  /** While true the sheet can't be dismissed (a save is in flight). */
  busy?: boolean;
  /** Where focus goes on close when set; otherwise back to whatever had focus when it opened. */
  returnFocusRef?: RefObject<HTMLElement | null>;
  /** Content: a <SheetBody>, optionally followed by a <SheetFooter> (a <form> may wrap both). */
  children: ReactNode;
};

/**
 * Bottom sheet on phones, centred dialog from md up, with a scrolling body and
 * an optional footer that stays in view. Focus moves in on open (unless the
 * content already took it), is trapped while open and goes back on close.
 *
 * Rendered in a portal on <body>: the page's `stagger` animation leaves a
 * transform on its children, which would otherwise pin `position: fixed` to
 * them instead of the viewport.
 */
export function Sheet(props: SheetProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || !props.open) return null;
  return createPortal(<SheetPanel {...props} />, document.body);
}

function SheetPanel({ onClose, title, description, leading, busy = false, returnFocusRef, children }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  // The opener, read while rendering: the content's own effects (the add form
  // focusing its first field) run before ours and would otherwise hide it.
  const [opener] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  // Latest values for the listeners, which are registered once per opening.
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(busy);
  useEffect(() => {
    onCloseRef.current = onClose;
    busyRef.current = busy;
  });
  // The page behind stays put while the sheet is up (this panel only exists while open).
  useAppScrollLock(true);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const returnRef = returnFocusRef;
    // Content that focuses a field itself (the add form) keeps that focus.
    if (!panel.contains(document.activeElement)) panel.focus({ preventScroll: true });

    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches && typeof panel.animate === "function") {
      const phone = !window.matchMedia("(min-width: 768px)").matches;
      const easing = "cubic-bezier(0.2, 0.8, 0.2, 1)";
      panel.animate(
        phone
          ? [{ transform: "translateY(100%)" }, { transform: "translateY(0)" }]
          : [
              { opacity: 0, transform: "translateY(8px) scale(0.98)" },
              { opacity: 1, transform: "none" },
            ],
        { duration: phone ? 280 : 180, easing },
      );
      backdropRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing });
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        if (!busyRef.current) onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.getClientRects().length > 0,
      );
      if (items.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      const target = returnRef?.current ?? opener;
      if (target?.isConnected) target.focus({ preventScroll: true });
    };
    // Runs once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center md:items-center md:p-6">
      <div
        ref={backdropRef}
        aria-hidden="true"
        className="absolute inset-0 bg-ink-950/45"
        onClick={() => {
          if (!busyRef.current) onCloseRef.current();
        }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className="relative flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-sand-50 shadow-card-lg outline-none md:max-w-lg md:rounded-3xl"
      >
        <div className="shrink-0 px-5 pt-2.5 md:px-6 md:pt-6">
          <div aria-hidden="true" className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-ink-800/15 md:hidden" />
          <div className="flex items-start gap-3 pb-3">
            {leading}
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="font-display text-[1.375rem] leading-snug text-ink-900 [overflow-wrap:anywhere]">
                {title}
              </h2>
              {description && (
                <p id={descId} className="mt-0.5 text-sm leading-relaxed text-ink-600 [overflow-wrap:anywhere]">
                  {description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              aria-label="Close"
              className="-mr-2.5 -mt-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-500 transition hover:bg-ink-800/5 hover:text-ink-900 focus-visible:outline-2 focus-visible:outline-coral-600 disabled:opacity-40"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Scrolling content area. `last`: nothing follows, so it pads for the phone's home indicator. */
export function SheetBody({ children, last = false }: { children: ReactNode; last?: boolean }) {
  return (
    <div
      className={`min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-ink-800/8 px-5 pt-4 md:px-6 ${
        last ? "pb-[max(env(safe-area-inset-bottom),1.25rem)] md:pb-6" : "pb-5"
      }`}
    >
      {children}
    </div>
  );
}

/** Action row pinned under the body. Put the main action last. */
export function SheetFooter({ children }: { children: ReactNode }) {
  return (
    <div className="flex shrink-0 gap-2 border-t border-ink-800/8 bg-sand-50 px-5 pb-[max(env(safe-area-inset-bottom),1rem)] pt-3 md:justify-end md:px-6 md:pb-5">
      {children}
    </div>
  );
}
