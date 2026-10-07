import { ChevronRight } from "lucide-react";
import type { NotificationKind } from "@prisma/client";
import { KIND_META } from "./kinds";

/**
 * How the announcement will look in the header bell: the same chrome (ink band,
 * Enilas title, coral tracked caps) and row markup as NotificationBell, shown
 * unread (as it lands for everyone it goes to; a personal announcement looks
 * the same in the bell of each person picked).
 */
export function BellPreview({
  kind,
  title,
  body,
  linkLabel,
}: {
  kind: NotificationKind;
  title: string;
  body: string;
  /** Page the row opens, e.g. "Schedule"; null = no link. */
  linkLabel: string | null;
}) {
  const meta = KIND_META[kind];
  const Icon = meta.icon;
  const hasTitle = title.trim() !== "";

  return (
    <div className="overflow-hidden rounded-3xl bg-white shadow-card ring-1 ring-ink-900/10">
      <div className="flex items-end justify-between gap-3 bg-ink-800 px-4 pb-3 pt-3.5">
        <p className="font-display text-[1.375rem] leading-none text-sand-50">Notifications</p>
        <span className="text-[10px] font-bold uppercase tracking-caps text-coral-300">Preview</span>
      </div>
      <div className="flex items-start gap-3 bg-coral-50 px-4 py-3">
        <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${meta.tint}`}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-1.5 text-[10px] font-bold uppercase tracking-caps text-ink-500">
            {meta.bellLabel}
            <span aria-hidden="true">·</span>
            Just now
          </p>
          <p
            className={`text-sm font-semibold leading-snug [overflow-wrap:anywhere] ${hasTitle ? "text-ink-900" : "text-ink-500"}`}
          >
            {hasTitle ? title.trim() : "Your title shows here"}
          </p>
          {body.trim() && (
            <p className="mt-0.5 whitespace-pre-line text-xs leading-snug text-ink-600 [overflow-wrap:anywhere]">{body.trim()}</p>
          )}
        </div>
        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-ember-500" aria-hidden="true" />
      </div>
      <div className="flex items-center gap-1 border-t border-ink-800/8 bg-white px-4 py-2 text-[11px] font-medium text-ink-500">
        {linkLabel ? (
          <>
            Tapping it opens <span className="font-semibold text-ink-900">{linkLabel}</span>
            <ChevronRight className="h-3 w-3" />
          </>
        ) : (
          "No link: tapping it does nothing"
        )}
      </div>
    </div>
  );
}
