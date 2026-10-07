"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Info, X } from "lucide-react";

export type ToastMessage = { id: number; text: string; tone?: "success" | "info" };

/**
 * Short confirmation above the floating nav ("Sent to 312 people"). The live
 * region is always mounted so screen readers announce each new message.
 * `onDismiss` should be stable (useCallback): it restarts the 5 s timer.
 */
export function Toast({ toast, onDismiss }: { toast: ToastMessage | null; onDismiss: () => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(onDismiss, 5000);
    return () => clearTimeout(timer);
  }, [toast, onDismiss]);

  if (!mounted) return null;
  const Icon = toast?.tone === "info" ? Info : CheckCircle2;

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-4"
      // Above the floating nav and the back-to-top button (same spot as the other console pages).
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 8.25rem)" }}
    >
      {toast && (
        <div
          key={toast.id}
          className="pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-2xl bg-ink-900 py-1.5 pl-4 pr-1.5 text-sm text-white shadow-card-lg ring-1 ring-inset ring-white/10 motion-safe:animate-fade-up motion-safe:[animation-duration:300ms]"
        >
          <Icon
            aria-hidden="true"
            className={`h-4 w-4 shrink-0 ${toast.tone === "info" ? "text-coral-300" : "text-jade-300"}`}
          />
          <span className="min-w-0 flex-1 py-1.5 leading-snug [overflow-wrap:anywhere]">{toast.text}</span>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white/70 transition hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-coral-300"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}
