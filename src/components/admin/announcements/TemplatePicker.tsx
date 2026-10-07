"use client";

import { useId } from "react";
import { Check, ChevronRight } from "lucide-react";
import { describeAudience, linkLabel } from "@/lib/admin/announcements";
import type { Draft } from "./draft";
import { TEMPLATES, matchesTemplate, type AnnouncementTemplate } from "./templates";
import { CARD_TITLE, HINT, tileClass } from "./ui";

/**
 * Composer quick start: one tap fills in a template's message and audience
 * (src/components/admin/announcements/templates.ts). It never sends anything;
 * the admin checks the draft, then reviews and confirms as usual.
 */
export function TemplatePicker({
  draft,
  onPick,
}: {
  draft: Draft;
  /** Fill the composer from `t` (asking first if that would replace typed words). */
  onPick: (t: AnnouncementTemplate) => void;
}) {
  const headingId = useId();
  const hintId = useId();

  return (
    <section className="card p-4 sm:p-5" aria-labelledby={headingId}>
      <h2 id={headingId} className={CARD_TITLE}>
        Templates
      </h2>

      <ul className={`mt-3 grid gap-2 ${TEMPLATES.length > 1 ? "sm:grid-cols-2" : ""}`}>
        {TEMPLATES.map((t) => {
          const Icon = t.icon;
          const inUse = matchesTemplate(draft, t);
          const link = linkLabel(t.fields.href || null);
          return (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => onPick(t)}
                aria-describedby={hintId}
                className={`flex min-h-14 w-full items-center gap-3 px-3 py-2.5 ${tileClass(false)}`}
              >
                <span
                  aria-hidden="true"
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${t.tint}`}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-ink-900">{t.label}</span>
                  <span className="mt-0.5 block text-[11px] font-medium leading-snug text-ink-500 [overflow-wrap:anywhere]">
                    {describeAudience(t.fields)}
                    {link && ` · opens ${link}`}
                  </span>
                </span>
                {inUse ? (
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-jade-700">
                    <Check aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2.6} />
                    In use
                  </span>
                ) : (
                  <span className="inline-flex shrink-0 items-center gap-0.5 text-xs font-semibold text-coral-700">
                    Use
                    <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      <p id={hintId} className={HINT}>
        Fills in the message and audience for you to check. Nothing is sent until you review and confirm.
      </p>
    </section>
  );
}
