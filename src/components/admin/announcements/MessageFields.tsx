"use client";

import { useId } from "react";
import { BODY_MAX, KINDS, LINK_OPTIONS, TITLE_MAX, linkLabel, type LinkHref } from "@/lib/admin/announcements";
import { KIND_META } from "./kinds";
import type { Draft } from "./draft";
import { CARD_TITLE, FIELD_ERROR, HINT, HINT_WARN, LABEL, inputClass, tileClass } from "./ui";

export const TITLE_INPUT_ID = "announcement-title";

function joinAnd(items: string[]) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function Counter({ length, max }: { length: number; max: number }) {
  const near = max - length <= Math.max(5, Math.round(max * 0.1));
  return (
    <span aria-hidden="true" className={`text-[11px] font-medium tabular-nums ${near ? "font-semibold text-ember-600" : "text-ink-500"}`}>
      {length}/{max}
    </span>
  );
}

/** Title, message, category and link of the announcement. */
export function MessageFields({
  draft,
  onChange,
  errors,
  santLinks,
  santsReached,
  santsLeftOut,
}: {
  draft: Pick<Draft, "title" | "body" | "kind" | "href">;
  onChange: (patch: Partial<Draft>) => void;
  errors: { title?: string; body?: string };
  /** Links the Pujya Santo view can open (Menu and Breakout Sessions open the santos' own pages; others are dropped). */
  santLinks: readonly string[];
  /** Santos this announcement reaches (for the link note). */
  santsReached: number;
  /** Santos in the audience that a Menu notice leaves out because no role is picked (for the Menu note). */
  santsLeftOut: number;
}) {
  const headingId = useId();
  const bodyId = useId();
  const categoryId = useId();
  const linkId = useId();

  const santLinkNames = LINK_OPTIONS.filter((l) => santLinks.includes(l.href)).map((l) => l.label);
  const santsLoseLink = draft.href !== "" && !santLinks.includes(draft.href) && santsReached > 0;

  return (
    <section className="card p-4 sm:p-5" aria-labelledby={headingId}>
      <h2 id={headingId} className={CARD_TITLE}>
        Message
      </h2>

      <div className="mt-3 space-y-4">
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor={TITLE_INPUT_ID} className={LABEL}>
              Title
            </label>
            <Counter length={draft.title.length} max={TITLE_MAX} />
          </div>
          <input
            id={TITLE_INPUT_ID}
            type="text"
            value={draft.title}
            maxLength={TITLE_MAX}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="e.g. Lunch is served in Hall B"
            autoComplete="off"
            aria-invalid={errors.title ? true : undefined}
            aria-describedby={errors.title ? `${TITLE_INPUT_ID}-error` : undefined}
            className={`mt-1.5 ${inputClass({ invalid: Boolean(errors.title) })}`}
          />
          {errors.title && (
            <p id={`${TITLE_INPUT_ID}-error`} className={FIELD_ERROR}>
              {errors.title}
            </p>
          )}
        </div>

        <div>
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor={bodyId} className={LABEL}>
              Message <span className="font-medium normal-case tracking-normal">(optional)</span>
            </label>
            <Counter length={draft.body.length} max={BODY_MAX} />
          </div>
          <textarea
            id={bodyId}
            value={draft.body}
            maxLength={BODY_MAX}
            rows={3}
            onChange={(e) => onChange({ body: e.target.value })}
            placeholder="A line or two of detail, shown under the title."
            aria-invalid={errors.body ? true : undefined}
            className={`mt-1.5 block min-h-20 resize-y ${inputClass({ invalid: Boolean(errors.body) })}`}
          />
          {errors.body && <p className={FIELD_ERROR}>{errors.body}</p>}
        </div>

        <div role="group" aria-labelledby={categoryId}>
          <p id={categoryId} className={LABEL}>
            Category
          </p>
          <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {KINDS.map((k) => {
              const meta = KIND_META[k];
              const Icon = meta.icon;
              const on = draft.kind === k;
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onChange({ kind: k })}
                  className={`flex items-center gap-2.5 px-3 py-2.5 text-sm font-semibold ${tileClass(on)}`}
                >
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${meta.tint}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  {meta.label}
                </button>
              );
            })}
          </div>
          {draft.kind === "MENU" && santsLeftOut > 0 && (
            <p className={HINT_WARN}>
              Santos aren&apos;t included: with no role picked, a Menu notice is about the delegate menu. To tell
              santos about their own menu, pick Santos under Role.
            </p>
          )}
        </div>

        <div>
          <label htmlFor={linkId} className={LABEL}>
            Link <span className="font-medium normal-case tracking-normal">(optional)</span>
          </label>
          <select
            id={linkId}
            value={draft.href}
            onChange={(e) => onChange({ href: e.target.value as LinkHref | "" })}
            className={`mt-1.5 ${inputClass()}`}
          >
            <option value="">No link</option>
            {LINK_OPTIONS.map((l) => (
              <option key={l.href} value={l.href}>
                {l.label}
              </option>
            ))}
          </select>
          {santsLoseLink ? (
            <p className={HINT_WARN}>
              Santos in this audience get it without the link: their view has no {linkLabel(draft.href)} page.
            </p>
          ) : (
            <p className={HINT}>
              {santLinkNames.length
                ? `Santos only get links to ${joinAnd(santLinkNames)}; for them, other links open nothing.`
                : "Santos get announcements without links."}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
