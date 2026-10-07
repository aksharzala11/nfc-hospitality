"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { CHIP, CHIP_EMPTY, CHIP_OFF, CHIP_ON, LABEL, chipCount, inputClass } from "./ui";

export type FacetOption = { value: string; label?: string; total: number };

/**
 * One multi-select audience dimension as filter chips: "Any …" plus a chip
 * per value showing how many people picking it would reach, given the other
 * choices. Long lists (sevas, regions) get a search box and start collapsed to
 * the most common values; picked values always stay visible.
 */
export function FacetPicker({
  label,
  anyLabel,
  noun,
  options,
  countFor,
  selected,
  onChange,
  collapsedCount = 8,
  lead,
}: {
  label: string;
  anyLabel: string;
  /** Plural for the search box, e.g. "sevas". */
  noun: string;
  /** Most common first. */
  options: FacetOption[];
  countFor: (value: string) => number;
  selected: readonly string[];
  onChange: (next: string[]) => void;
  collapsedCount?: number;
  /** Shown under the label, above the search box and chips (e.g. the seva filter's shortcut). */
  lead?: ReactNode;
}) {
  const labelId = useId();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);

  // Picked values nobody has any more (e.g. from a restored draft) still show, so they can be removed.
  const all = useMemo((): FacetOption[] => {
    const known = new Set(options.map((o) => o.value));
    return [...options, ...selected.filter((v) => !known.has(v)).map((value) => ({ value, total: 0 }))];
  }, [options, selected]);

  const long = all.length > collapsedCount;
  const q = query.trim().toLowerCase();
  let visible: FacetOption[];
  if (q) visible = all.filter((o) => (o.label ?? o.value).toLowerCase().includes(q));
  else if (long && !expanded) visible = all.filter((o, i) => i < collapsedCount || selected.includes(o.value));
  else visible = all;
  const hiddenCount = q ? 0 : all.length - visible.length;

  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  }

  return (
    <div role="group" aria-labelledby={labelId}>
      <div className="mb-2 flex min-h-5 items-center justify-between gap-3">
        <p id={labelId} className={LABEL}>
          {label}
        </p>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="-my-3 min-h-11 rounded-lg px-2 text-[11px] font-semibold text-coral-700 transition hover:text-coral-900 focus-visible:outline-2 focus-visible:outline-coral-600"
          >
            Clear {selected.length > 1 ? `${selected.length} picked` : "choice"}
          </button>
        )}
      </div>

      {lead}

      {long && (
        <div className="relative mb-2">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            // Enter would submit the composer form; here it only means "done typing".
            onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
            placeholder={`Search ${noun}`}
            aria-label={`Search ${noun}`}
            className={inputClass({ padding: "py-2 pl-8 pr-3" })}
          />
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {!q && (
          <button
            type="button"
            aria-pressed={selected.length === 0}
            onClick={() => onChange([])}
            className={`${CHIP} ${selected.length === 0 ? CHIP_ON : CHIP_OFF}`}
          >
            {anyLabel}
          </button>
        )}
        {visible.map((o) => {
          const on = selected.includes(o.value);
          const n = countFor(o.value);
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(o.value)}
              title={o.label ?? o.value}
              className={`${CHIP} ${on ? CHIP_ON : n === 0 ? CHIP_EMPTY : CHIP_OFF} inline-flex max-w-full items-center`}
            >
              <span className="truncate">{o.label ?? o.value}</span>
              <span className={chipCount(on)}>{n}</span>
            </button>
          );
        })}
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className={`${CHIP} border-dashed border-ink-800/25 bg-transparent text-ink-600 hover:bg-white`}
          >
            +{hiddenCount} more
          </button>
        )}
        {!q && long && expanded && (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className={`${CHIP} border-transparent bg-transparent text-ink-500 hover:text-ink-900`}
          >
            Show fewer
          </button>
        )}
        {q && visible.length === 0 && (
          <p className="py-1.5 text-xs text-ink-500">
            No {noun} match &ldquo;{query.trim()}&rdquo;.
          </p>
        )}
      </div>
    </div>
  );
}
