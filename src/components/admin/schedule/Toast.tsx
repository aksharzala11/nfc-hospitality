"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CircleCheck, X } from "lucide-react";

/**
 * Confirmation after a change, floating above the bottom nav and the
 * back-to-top button. Dismisses itself after `durationMs`.
 */
export function Toast({
  title,
  detail,
  action,
  onClose,
  durationMs = 9000,
}: {
  title: string;
  detail?: string;
  action?: { label: string; onClick: () => void; disabled?: boolean };
  onClose: () => void;
  durationMs?: number;
}) {
  const [mounted, setMounted] = useState(false);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const id = window.setTimeout(() => closeRef.current(), durationMs);
    return () => window.clearTimeout(id);
  }, [title, detail, durationMs]);

  if (!mounted) return null;
  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-4"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 8.25rem)" }}
    >
      <div className="pointer-events-auto flex w-full max-w-md items-center gap-2 rounded-2xl bg-ink-900 py-1.5 pl-4 pr-1.5 text-white shadow-card-lg ring-1 ring-inset ring-white/10 motion-safe:animate-fade-up motion-safe:[animation-duration:300ms]">
        <CircleCheck className="mr-1 mt-2.5 h-4 w-4 shrink-0 self-start text-jade-300" aria-hidden="true" />
        <div className="min-w-0 flex-1 py-1">
          <p className="text-sm font-semibold">{title}</p>
          {detail && <p className="mt-0.5 line-clamp-2 text-xs text-white/75">{detail}</p>}
        </div>
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            disabled={action.disabled}
            className="min-h-11 shrink-0 rounded-xl px-3 text-sm font-bold text-coral-300 transition hover:bg-white/10 hover:text-coral-200 focus-visible:outline-2 focus-visible:outline-coral-300 disabled:opacity-50"
          >
            {action.label}
          </button>
        )}
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => closeRef.current()}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white/70 transition hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-coral-300"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>,
    document.body,
  );
}
