"use client";

import { useMemo } from "react";
import {
  CHANNEL_LABEL,
  CHANNEL_ORDER,
  DIMENSIONS,
  GENDER_LABEL,
  GENDER_ORDER,
  NO_REGION,
  NO_STATUS,
  ROLE_LABEL,
  ROLE_ORDER,
  SIGN_IN_LABEL,
  SIGN_IN_ORDER,
  activeFilterCount,
  clearFilters,
  distinctSorted,
  facetCounts,
  peopleCount,
  selectedValues,
  toggleValue,
  type Dimension,
  type Entry,
  type Filters,
} from "./directory";
import type { SevaOption } from "@/lib/admin/sevaFilter";
import { SheetBody, SheetFooter } from "./Sheet";
import { BTN_PRIMARY, BTN_SECONDARY, CHIP, CHIP_EMPTY, CHIP_OFF, CHIP_ON, LABEL, chipCount } from "./ui";

type Section = { dimension: Dimension; legend: string; hint?: string; options: { value: string; label: string }[] };

/**
 * Every filter as toggle chips with live counts (what each choice would show
 * given the search and the other filters). Changes apply straight away; the
 * footer button just closes the sheet.
 */
export function FilterPanel({
  entries,
  filters,
  resultCount,
  sevaOptions,
  regionOptions,
  statusOptions,
  onChange,
  onDone,
}: {
  entries: readonly Entry[];
  filters: Filters;
  resultCount: number;
  /** buildSevaOptions() over the directory: the console-wide seva filter's options. */
  sevaOptions: readonly SevaOption[];
  regionOptions: readonly string[];
  /** Distinct master-list registration statuses on file. */
  statusOptions: readonly string[];
  onChange: (filters: Filters) => void;
  onDone: () => void;
}) {
  const counts = useMemo(() => {
    const out = {} as Record<Dimension, Map<string, number>>;
    for (const d of DIMENSIONS) out[d] = facetCounts(entries, filters, d);
    return out;
  }, [entries, filters]);

  const sections: Section[] = [
    { dimension: "role", legend: "Role", options: ROLE_ORDER.map((r) => ({ value: r, label: ROLE_LABEL[r] })) },
    {
      dimension: "signedIn",
      legend: "Signed in",
      options: SIGN_IN_ORDER.map((s) => ({ value: s, label: SIGN_IN_LABEL[s] })),
    },
    {
      dimension: "status",
      legend: "Registration status",
      hint: "From the organisers' master list.",
      // Hidden until someone has a status (before the import everyone would sit under "No status").
      options:
        statusOptions.length === 0 && filters.statuses.length === 0
          ? []
          : [
              ...distinctSorted([...statusOptions, ...filters.statuses.filter((s) => s !== NO_STATUS)]).map((s) => ({
                value: s,
                label: s,
              })),
              ...((counts.status.get(NO_STATUS) ?? 0) > 0 || filters.statuses.includes(NO_STATUS)
                ? [{ value: NO_STATUS, label: "No status" }]
                : []),
            ],
    },
    {
      dimension: "gender",
      legend: "Gender",
      hint: "Decides the schedule track: Bhaio (gents) or Behno (ladies).",
      options: GENDER_ORDER.map((g) => ({ value: g, label: GENDER_LABEL[g] })),
    },
    {
      dimension: "channel",
      legend: "Sign-in codes by",
      options: CHANNEL_ORDER.map((c) => ({ value: c, label: CHANNEL_LABEL[c] })),
    },
    {
      dimension: "seva",
      legend: "Seva",
      hint: "Spellings of one team are grouped under its code.",
      // Keep a selected value listed even if nobody has it any more, so it can be removed.
      options: [
        ...sevaOptions.map((o) => ({ value: o.value, label: o.label })),
        ...distinctSorted(filters.sevas.filter((s) => !sevaOptions.some((o) => o.value === s))).map((s) => ({
          value: s,
          label: s,
        })),
      ],
    },
    {
      dimension: "region",
      legend: "Region",
      options: [
        ...distinctSorted([...regionOptions, ...filters.regions.filter((r) => r !== NO_REGION)]).map((r) => ({
          value: r,
          label: r,
        })),
        ...((counts.region.get(NO_REGION) ?? 0) > 0 || filters.regions.includes(NO_REGION)
          ? [{ value: NO_REGION, label: "No region" }]
          : []),
      ],
    },
  ];

  const active = activeFilterCount(filters);

  return (
    <>
      <SheetBody>
        <div className="space-y-6">
          {sections.map((section) =>
            section.options.length === 0 ? null : (
              <fieldset key={section.dimension}>
                <legend className={LABEL}>{section.legend}</legend>
                {section.hint && <p className="mt-0.5 text-xs text-ink-500">{section.hint}</p>}
                <div className="mt-2 flex flex-wrap gap-2">
                  {section.options.map((option) => {
                    const on = selectedValues(filters, section.dimension).includes(option.value);
                    const n = counts[section.dimension].get(option.value) ?? 0;
                    return (
                      <button
                        key={option.value || "none"}
                        type="button"
                        aria-pressed={on}
                        onClick={() => onChange(toggleValue(filters, section.dimension, option.value))}
                        className={`${CHIP} ${on ? CHIP_ON : n === 0 ? CHIP_EMPTY : CHIP_OFF} max-w-full`}
                      >
                        <span className="break-words">{option.label}</span>
                        <span className={chipCount(on)}>{n}</span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            ),
          )}
        </div>
      </SheetBody>
      <SheetFooter>
        <button
          type="button"
          disabled={active === 0}
          onClick={() => onChange(clearFilters(filters))}
          className={`${BTN_SECONDARY} flex-1 md:flex-none`}
        >
          Clear filters
        </button>
        <button type="button" onClick={onDone} className={`${BTN_PRIMARY} flex-[2] md:flex-none`}>
          Show {peopleCount(resultCount)}
        </button>
      </SheetFooter>
    </>
  );
}
