"use client";

import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useAppScrollLock } from "@/lib/scroll";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type SheetProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Action buttons, stacked on phones and in a row from sm up (put the main action last). */
  footer?: ReactNode;
  /** While true the sheet can't be dismissed (a request is in flight). */
  busy?: boolean;
  /** Element to focus when the sheet opens; defaults to the panel itself. */
  initialFocusRef?: RefObject<HTMLElement | null>;
};

/**
 * Bottom sheet on phones, centred dialog from md up. Escape, the backdrop and
 * the close button dismiss it (unless `busy`); focus stays inside while open.
 *
 * Rendered in a portal on <body>: the page's `stagger` animation leaves a
 * transform on its children, which would otherwise make `position: fixed`
 * relative to them instead of the viewport.
 */
export function Sheet(props: SheetProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || !props.open) return null;
  return createPortal(<SheetPanel {...props} />, document.body);
}

function SheetPanel({ onClose, title, description, children, footer, busy = false, initialFocusRef }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  // Latest callbacks for the listeners registered once per opening.
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
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (initialFocusRef?.current ?? panel).focus({ preventScroll: true });

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
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) {
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
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    };
    // Runs once per opening; initialFocusRef is read at that moment only.
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
        className="relative max-h-[85dvh] w-full overflow-y-auto overscroll-contain rounded-t-3xl bg-sand-50 px-5 pb-[max(env(safe-area-inset-bottom),1.25rem)] pt-2.5 shadow-card-lg outline-none md:max-w-md md:rounded-3xl md:px-6 md:pb-6 md:pt-6"
      >
        <div aria-hidden="true" className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-ink-800/15 md:hidden" />
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="font-display text-[1.375rem] leading-snug text-ink-900 [overflow-wrap:anywhere]">
              {title}
            </h2>
            {description && (
              <p id={descId} className="mt-1.5 text-sm leading-relaxed text-ink-600">
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
        {children && <div className="mt-4">{children}</div>}
        {footer && <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{footer}</div>}
      </div>
    </div>
  );
}
