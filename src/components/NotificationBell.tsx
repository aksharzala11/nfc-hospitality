"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Bell, Bus, CalendarDays, Megaphone, UtensilsCrossed, X } from "lucide-react";
import type { NotificationView } from "@/lib/notifications";
import { KIND_TINT } from "@/components/brand/kindTints";
import { dayKey, formatDayShort, formatTime } from "@/lib/time";
import { useAppScrollLock } from "@/lib/scroll";

const KIND = {
  MENU: { icon: UtensilsCrossed, tint: KIND_TINT.MENU, label: "Menu" },
  SCHEDULE: { icon: CalendarDays, tint: KIND_TINT.SCHEDULE, label: "Schedule" },
  TRANSPORT: { icon: Bus, tint: KIND_TINT.TRANSPORT, label: "Transportation" },
  GENERAL: { icon: Megaphone, tint: KIND_TINT.GENERAL, label: "Announcement" },
} as const;

/** The brand's tracked-caps label, at the size used for meta lines here. */
const CAPS = "text-[10px] font-bold uppercase tracking-caps";

function timeAgo(iso: string, now: number) {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "Yesterday" : `${days} days ago`;
}

export function NotificationBell({ items, unread }: { items: NotificationView[]; unread: number }) {
  const [open, setOpen] = useState(false);
  // A notification without a link opens full screen so the whole message is easy to read.
  const [reading, setReading] = useState<NotificationView | null>(null);
  // Badge count shown on the bell. Cleared as soon as the panel opens; the
  // per-item "new" dots stay for this viewing so guests can see what changed.
  const [badge, setBadge] = useState(unread);
  const [now, setNow] = useState(() => Date.now());
  const rootRef = useRef<HTMLDivElement>(null);
  const readerTrigger = useRef<HTMLElement | null>(null);

  // A server refresh can bring new items; keep the badge in step.
  useEffect(() => setBadge(unread), [unread]);

  // Close the panel on an outside tap or Escape. Paused while the reader is
  // open: it sits outside this element (a portal) and handles Escape itself,
  // so closing it drops the guest back into the list they came from.
  useEffect(() => {
    if (!open || reading) return;
    setNow(Date.now());
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, reading]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && badge > 0) {
      setBadge(0);
      fetch("/api/notifications/seen", { method: "POST" }).catch(() => {});
    }
  }

  function closeReader() {
    setReading(null);
    readerTrigger.current?.focus();
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={badge > 0 ? `Notifications, ${badge} new` : "Notifications"}
        aria-haspopup="dialog"
        aria-expanded={open}
        // 36px circle with an invisible 44px hit area; ink when open, like the panel's header.
        className={`relative flex h-9 w-9 items-center justify-center rounded-full border shadow-card transition after:absolute after:-inset-1 after:content-[''] active:scale-95 ${
          open
            ? "border-ink-800 bg-ink-800 text-sand-50"
            : "border-white bg-white/85 text-ink-700 hover:bg-white hover:text-ink-900"
        }`}
      >
        <Bell className="h-4 w-4" strokeWidth={2.2} />
        {badge > 0 && (
          <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-ember-600 px-1 text-[10px] font-bold leading-none tabular-nums text-white ring-2 ring-sand-50">
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          // Opaque on purpose: it drops over the page content below the header, and
          // nothing from there should bleed through the list.
          className="absolute right-0 top-full z-50 mt-2.5 w-[min(21rem,calc(100vw-2rem))] origin-top-right overflow-hidden rounded-3xl bg-white shadow-card-lg ring-1 ring-ink-900/10 motion-safe:animate-[fade-up_0.2s_ease-out_both]"
        >
          {/* Ink band with the title in Enilas: the brand guide's "type on an ink panel". */}
          <div className="flex items-end justify-between gap-3 bg-ink-800 px-4 pb-3 pt-3.5">
            <h2 className="font-display text-[1.375rem] leading-none text-sand-50">Notifications</h2>
            <span className={`${CAPS} text-coral-300`}>{items.length === 0 ? "" : `${items.length} recent`}</span>
          </div>

          {items.length === 0 ? (
            <div className="px-6 py-8 text-center">
              <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-sand-100 text-ink-500">
                <Bell className="h-5 w-5" />
              </span>
              <p className="font-display text-xl text-ink-900">You&apos;re all caught up</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-600">
                Menu releases, schedule changes and transportation updates will show up here.
              </p>
            </div>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-ink-900/[0.06] overflow-y-auto overscroll-contain">
              {items.map((n) => {
                const meta = KIND[n.kind];
                const Icon = meta.icon;
                // Spans only, so the same row works inside a link or a button.
                const content = (
                  <span className="flex items-start gap-3 px-4 py-3">
                    <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${meta.tint}`}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="block min-w-0 flex-1">
                      <span className={`flex flex-wrap items-center gap-x-1.5 ${CAPS} text-ink-500`}>
                        {meta.label}
                        <span aria-hidden="true">·</span>
                        {timeAgo(n.createdAt, now)}
                      </span>
                      <span className="mt-0.5 block text-sm font-semibold leading-snug text-ink-900">{n.title}</span>
                      {n.body && (
                        // Rows without a link open the full-screen reader, so their preview can be short.
                        <span
                          className={`mt-0.5 block whitespace-pre-line text-xs leading-snug text-ink-600 ${n.href ? "" : "line-clamp-3"}`}
                        >
                          {n.body}
                        </span>
                      )}
                    </span>
                    {n.unread && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-ember-500" aria-label="New" />}
                  </span>
                );
                return (
                  <li key={n.id} className={n.unread ? "bg-coral-50" : ""}>
                    {n.href ? (
                      <Link href={n.href} onClick={() => setOpen(false)} className="block transition hover:bg-sand-100/70">
                        {content}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          readerTrigger.current = e.currentTarget;
                          setReading(n);
                        }}
                        aria-haspopup="dialog"
                        className="block w-full text-left transition hover:bg-sand-100/70"
                      >
                        {content}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {reading && <NotificationReader n={reading} now={now} onClose={closeReader} />}
    </div>
  );
}

/**
 * Full-screen, opaque reader for one notification. Portalled to <body>: the
 * header is its own stacking context (z-30), which would otherwise keep this
 * layer under the floating nav. The app's scroll container stays still behind it.
 */
function NotificationReader({ n, now, onClose }: { n: NotificationView; now: number; onClose: () => void }) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  // Mounted only while a notification is open.
  useAppScrollLock(true);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const meta = KIND[n.kind];
  const Icon = meta.icon;
  const at = new Date(n.createdAt);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-[70] flex flex-col bg-sand-50 motion-safe:animate-fade-up"
    >
      <div className="border-b border-ink-900/[0.07]">
        <div className="mx-auto flex w-full max-w-lg items-center justify-between gap-3 px-4 pb-3 pt-[max(env(safe-area-inset-top),0.75rem)]">
          <span className="inline-flex items-center gap-2.5 text-[11px] font-bold uppercase tracking-caps text-ink-600">
            <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${meta.tint}`}>
              <Icon className="h-4 w-4" />
            </span>
            {meta.label}
          </span>
          <button
            ref={closeRef}
            type="button"
            onClick={() => onCloseRef.current()}
            aria-label="Close"
            className="flex h-11 w-11 items-center justify-center rounded-full border border-white bg-white/85 text-ink-700 shadow-card transition hover:bg-white hover:text-ink-900 active:scale-95"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain">
        <article className="mx-auto w-full max-w-lg px-5 pb-8 pt-7">
          <p className="text-[11px] font-bold uppercase tracking-caps text-coral-800">
            {formatDayShort(dayKey(at))} · {formatTime(at)}
            <span aria-hidden="true"> · </span>
            {timeAgo(n.createdAt, now)}
          </p>
          <h2 id={titleId} className="font-display mt-3 text-[2rem] leading-[1.1] text-ink-900 [overflow-wrap:anywhere]">
            {n.title}
          </h2>
          {/* A short rule in the brand's coral gradient under the headline. */}
          <span aria-hidden="true" className="mt-4 block h-1 w-12 rounded-full bg-gradient-to-r from-coral-400 to-coral-700" />
          {n.body && (
            <p className="mt-5 whitespace-pre-line text-base leading-relaxed text-ink-700 [overflow-wrap:anywhere]">
              {n.body}
            </p>
          )}
        </article>
      </div>

      <div className="mx-auto w-full max-w-lg px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-2">
        <button
          type="button"
          onClick={() => onCloseRef.current()}
          className="w-full rounded-2xl bg-ink-800 py-3.5 text-sm font-bold text-sand-50 shadow-card transition hover:bg-ink-900 active:scale-[0.99]"
        >
          Done
        </button>
      </div>
    </div>,
    document.body,
  );
}
