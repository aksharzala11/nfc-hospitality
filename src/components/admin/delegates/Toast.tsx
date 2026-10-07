"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, X } from "lucide-react";

export type ToastData = {
  /** Changes for every new toast, so the same text can show twice. */
  id: number;
  message: string;
  action?: { label: string; onClick: () => void };
};

/**
 * Confirmation that floats above the bottom nav (and the back-to-top button),
 * announced politely to screen readers. Hides itself after a few seconds;
 * longer when it offers an action.
 */
export function Toast({ toast, onDismiss }: { toast: ToastData | null; onDismiss: () => void }) {
  const [mounted, setMounted] = useState(false);
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  });
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => onDismissRef.current(), toast.action ? 9000 : 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  if (!mounted) return null;
  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-4"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 8.25rem)" }}
    >
      {toast && (
        <div
          key={toast.id}
          className="pointer-events-auto flex w-full max-w-sm items-center gap-2 rounded-2xl bg-ink-900 py-1.5 pl-4 pr-1.5 text-sm text-white shadow-card-lg ring-1 ring-inset ring-white/10 motion-safe:animate-fade-up motion-safe:[animation-duration:300ms]"
        >
          <CheckCircle2 className="mr-1 h-4 w-4 shrink-0 text-jade-300" aria-hidden="true" />
          <p className="min-w-0 flex-1 py-1.5 leading-snug">{toast.message}</p>
          {toast.action && (
            <button
              type="button"
              onClick={() => {
                toast.action?.onClick();
                onDismiss();
              }}
              className="min-h-11 shrink-0 rounded-xl px-3 font-bold text-coral-300 transition hover:bg-white/10 hover:text-coral-200 focus-visible:outline-2 focus-visible:outline-coral-300"
            >
              {toast.action.label}
            </button>
          )}
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white/70 transition hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-coral-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}
