"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useAppScrollLock } from "@/lib/scroll";
import { labelCls } from "./ui";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Bottom sheet on phones, centred dialog from md up (same pattern as the other
 * console pages): a pinned SheetHeader, a scrolling SheetBody and a pinned
 * SheetFooter. Escape and the backdrop close it unless `busy` (a save is in
 * flight); focus moves in, is trapped while open and returns afterwards.
 *
 * Portalled to <body>: the page's `stagger` animation leaves a transform on
 * ancestors, which would otherwise pin `position: fixed` to them.
 */
export function Sheet(props: { onClose: () => void; labelledBy: string; busy?: boolean; children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(<SheetPanel {...props} />, document.body);
}

function SheetPanel({
  onClose,
  labelledBy,
  busy = false,
  children,
}: {
  onClose: () => void;
  labelledBy: string;
  busy?: boolean;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  // Whatever had focus when the sheet opened (read while rendering, before
  // any effect moves focus).
  const [opener] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));
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
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0);
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
      if (opener?.isConnected) opener.focus({ preventScroll: true });
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
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className="relative flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-sand-50 shadow-card-lg outline-none md:max-w-lg md:rounded-3xl"
      >
        <div aria-hidden="true" className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-ink-800/15 md:hidden" />
        {children}
      </div>
    </div>
  );
}

/** Title block with the close button; `leading` sits before the title (e.g. a back button). */
export function SheetHeader({
  titleId,
  eyebrow,
  title,
  meta,
  leading,
  onClose,
  busy = false,
}: {
  titleId: string;
  eyebrow?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  leading?: ReactNode;
  onClose: () => void;
  busy?: boolean;
}) {
  return (
    <div className="shrink-0 px-5 pb-3 pt-3 md:px-6 md:pt-6">
      <div className="flex items-start gap-3">
        {leading}
        <div className="min-w-0 flex-1">
          {eyebrow && <p className={labelCls}>{eyebrow}</p>}
          <h2 id={titleId} className="mt-0.5 font-display text-[1.375rem] leading-snug text-ink-900 [overflow-wrap:anywhere]">
            {title}
          </h2>
          {meta}
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
  );
}

/** Scrolling content between the header and the footer. */
export function SheetBody({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-ink-800/8 px-5 pb-5 pt-4 md:px-6">
      {children}
    </div>
  );
}

/** Action area pinned under the body; carries the phone's home-indicator inset. */
export function SheetFooter({ children }: { children: ReactNode }) {
  return (
    <div className="shrink-0 border-t border-ink-800/8 bg-sand-50 px-5 pb-[max(env(safe-area-inset-bottom),1rem)] pt-3 md:px-6 md:pb-5">
      {children}
    </div>
  );
}
