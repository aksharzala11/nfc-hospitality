"use client";

import { useId, useMemo } from "react";
import { Check, ListFilter, RotateCcw, Users } from "lucide-react";
import { HOTEL_KEYS, hotelInfo } from "@/lib/hotels";
import type { Audience, NotificationKind, UserRole } from "@prisma/client";
import {
  ROLES,
  ROLE_LABELS,
  TRACKS,
  TRACK_LABELS,
  countReach,
  describeAudience,
  isEveryone,
  peopleLabel,
  reaches,
  type FacetGroup,
  type PersonPick,
  type Targeting,
} from "@/lib/admin/announcements";
import { FacetPicker, type FacetOption } from "./FacetPicker";
import { PeoplePicker } from "./PeoplePicker";
import { BTN_SMALL_SECONDARY, CARD_TITLE, CHIP, CHIP_OFF, CHIP_ON, HINT, HINT_WARN, LABEL, chipCount } from "./ui";

export type AudienceValue = {
  audience: Audience;
  roles: UserRole[];
  sevas: string[];
  /** Not used while hotels are picked. */
  regions: string[];
  /** Hotel keys: the people with a room group at one of them. */
  hotels: string[];
  /** Specific people: while any are picked it goes to exactly them and the filters above are not used. */
  people: PersonPick[];
};

/** The console's seva filter as a one-tap audience ("Target these sevas"). */
export type SevaTarget = {
  /** The filtered sevas as the filter bar names them, e.g. "BM RA, SA" (scopeName()). */
  name: string;
  /** How many sevas are picked in the filter (for "this seva" / "these sevas"). */
  count: number;
  /** Accounts with those sevas, every role. */
  people: number;
  /** Someone holds one of those sevas, so there is something to target. */
  available: boolean;
  /** The audience's sevas are already exactly those. */
  targeted: boolean;
  onTarget: () => void;
};

function sum(groups: readonly FacetGroup[], keep: (g: FacetGroup) => boolean) {
  let n = 0;
  for (const g of groups) if (keep(g)) n += g.count;
  return n;
}

function blank(v: string | null) {
  return v === null || v.trim() === "";
}

/** Distinct non-blank values of one facet with their totals, most common first. */
function facetOptions(groups: readonly FacetGroup[], pick: (g: FacetGroup) => string | null): FacetOption[] {
  const totals = new Map<string, number>();
  for (const g of groups) {
    const v = pick(g);
    if (v === null || blank(v)) continue;
    totals.set(v, (totals.get(v) ?? 0) + g.count);
  }
  return [...totals]
    .map(([value, total]) => ({ value, total }))
    .sort((a, b) => b.total - a.total || a.value.localeCompare(b.value));
}

/**
 * "Everyone" by default (a Menu notice: delegates and admins, until Santos is
 * picked); narrow by role, track, seva, hotel and region, or pick specific
 * people. Hotel and region don't combine: while a hotel is picked the region
 * picker is shown disabled (one line says why), as the server drops it.
 * Every filter count is computed here from anonymous facet groups with the
 * same rule the server applies (src/lib/admin/announcements.ts).
 *
 * While people are picked the announcement goes to exactly them: the filters
 * stay as they were but are shown disabled (one line says why), and clearing
 * the people brings them back.
 */
export function AudienceBuilder({
  id,
  kind,
  value,
  onChange,
  groups,
  error,
  sevaTarget,
  restoringPeople = false,
  onAcceptAudience,
  pickerKey = 0,
}: {
  /** Section id, so the composer can scroll here when the audience is empty. */
  id?: string;
  kind: NotificationKind;
  value: AudienceValue;
  onChange: (patch: Partial<AudienceValue>) => void;
  groups: readonly FacetGroup[];
  /** Shown under the count, e.g. after trying to send to no one. */
  error?: string;
  /** While the console is filtered by seva: a shortcut to target those sevas. */
  sevaTarget?: SevaTarget | null;
  /** A restored draft's people are still being looked up: say so instead of the picker's hint. */
  restoringPeople?: boolean;
  /**
   * `error` is a notice the admin has to answer before sending (a draft's people
   * couldn't be brought back): adds a button that accepts the audience as shown.
   */
  onAcceptAudience?: () => void;
  /** Changes when the composer is emptied or refilled: the people search starts over (its text and matches). */
  pickerKey?: number;
}) {
  const headingId = useId();
  const trackLabelId = useId();
  const filtersOffId = useId();
  const regionOffId = useId();
  // The filters, without the people: what the chips count, and what applies once the people are cleared.
  const t: Targeting = {
    kind,
    audience: value.audience,
    roles: value.roles,
    sevas: value.sevas,
    regions: value.regions,
    hotels: value.hotels,
  };
  const personal = value.people.length > 0;
  const reach = personal ? value.people.length : countReach(t, groups);
  const everyone = !personal && isEveryone(value);

  const sevaOptions = useMemo(() => facetOptions(groups, (g) => g.seva), [groups]);
  const regionOptions = useMemo(() => facetOptions(groups, (g) => g.region), [groups]);
  // Every hotel, in hotels.ts order (four of them: no point sorting by size).
  const hotelOptions: FacetOption[] = useMemo(
    () =>
      HOTEL_KEYS.map((h) => ({
        value: h,
        label: hotelInfo(h).name,
        total: sum(groups, (g) => (g.hotels ?? []).includes(h)),
      })),
    [groups],
  );
  const byHotel = value.hotels.length > 0;
  const roleOptions: FacetOption[] = useMemo(
    () => ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r].many, total: sum(groups, (g) => g.role === r) })),
    [groups],
  );

  const reached = groups.filter((g) => reaches(t, g));
  const breakdown = ROLES.map((r) => ({
    r,
    n: personal ? value.people.filter((p) => p.role === r).length : sum(reached, (g) => g.role === r),
  })).filter((x) => x.n > 0);
  const noGenderIncluded = value.audience === "ALL" ? 0 : sum(reached, (g) => g.gender === null);
  const noRegionLeftOut =
    value.regions.length && !byHotel ? sum(groups, (g) => blank(g.region) && reaches({ ...t, regions: [] }, g)) : 0;
  // Everyone the other filters reach who has no hotel room on file (santos, admins, delegates without one).
  const noHotelLeftOut = byHotel
    ? sum(groups, (g) => (g.hotels ?? []).length === 0 && reaches({ ...t, hotels: [], regions: [] }, g))
    : 0;

  return (
    <section id={id} tabIndex={-1} className="card scroll-mt-4 p-4 outline-none sm:p-5" aria-labelledby={headingId}>
      <div className="flex min-h-11 items-center justify-between gap-3">
        <h2 id={headingId} className={CARD_TITLE}>
          Audience
        </h2>
        {!everyone && (
          <button
            type="button"
            onClick={() => onChange({ audience: "ALL", roles: [], sevas: [], regions: [], hotels: [], people: [] })}
            className={`${BTN_SMALL_SECONDARY} shrink-0`}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset to everyone
          </button>
        )}
      </div>

      <div className="mt-1" aria-live="polite" aria-atomic="true">
        <p className="flex items-baseline gap-1.5">
          <span className="text-sm font-semibold text-ink-600">{personal ? "Goes to" : "Reaches"}</span>
          <span
            className={`text-[2rem] font-extrabold leading-none tracking-tight tabular-nums ${reach === 0 ? "text-ember-600" : "text-ink-900"}`}
          >
            {reach.toLocaleString("en-US")}
          </span>
          <span className="text-sm font-semibold text-ink-600">{reach === 1 ? "person" : "people"}</span>
        </p>
        <p className="mt-1.5 text-sm font-semibold text-ink-900 [overflow-wrap:anywhere]">
          {personal ? "Only the people picked below" : describeAudience({ ...t, kind })}
        </p>
        {breakdown.length > 0 && (
          <p className="mt-0.5 text-[11px] text-ink-500">
            {breakdown
              .map(({ r, n }) => `${n.toLocaleString("en-US")} ${n === 1 ? ROLE_LABELS[r].one : ROLE_LABELS[r].many.toLowerCase()}`)
              .join(" · ")}
          </p>
        )}
      </div>

      {(reach === 0 || error) && (
        <p role="alert" className="mt-2 flex items-start gap-1.5 text-xs font-medium text-ember-600">
          <Users className="mt-px h-3.5 w-3.5 shrink-0" />
          {error ?? "No one matches this audience. Widen it to send."}
        </p>
      )}
      {error && onAcceptAudience && (
        <button type="button" onClick={onAcceptAudience} className={`${BTN_SMALL_SECONDARY} mt-2`}>
          Use the audience shown here
        </button>
      )}

      <div className="mt-4 border-t border-ink-800/8 pt-4">
        <PeoplePicker key={pickerKey} selected={value.people} onChange={(people) => onChange({ people })} />
        {restoringPeople && (
          <p role="status" className={HINT_WARN}>
            Looking up the people your draft was for…
          </p>
        )}
      </div>

      {personal && (
        <p
          id={filtersOffId}
          className="mt-4 border-t border-ink-800/8 pt-4 text-[11px] font-semibold leading-snug text-coral-800"
        >
          Role, track, seva, hotel and region aren&apos;t used while specific people are picked: it goes only to them.
          Clear the people to use these filters again.
        </p>
      )}

      {/* A disabled fieldset turns every chip and search box inside off (and out of the tab order) at once. */}
      <fieldset
        disabled={personal}
        aria-describedby={personal ? filtersOffId : undefined}
        className={`min-w-0 space-y-5 ${
          personal ? "pointer-events-none mt-3 select-none opacity-50" : "mt-4 border-t border-ink-800/8 pt-4"
        }`}
      >
        <legend className="sr-only">Filters</legend>
        <FacetPicker
          label="Role"
          anyLabel="Any role"
          noun="roles"
          options={roleOptions}
          countFor={(r) => countReach({ ...t, roles: [r as UserRole] }, groups)}
          selected={value.roles}
          onChange={(next) => onChange({ roles: next as UserRole[] })}
          collapsedCount={ROLES.length}
        />

        <div role="group" aria-labelledby={trackLabelId}>
          <p id={trackLabelId} className={`${LABEL} mb-2`}>
            Track
          </p>
          <div className="flex flex-wrap gap-1.5">
            {TRACKS.map((tr) => {
              const on = value.audience === tr;
              return (
                <button
                  key={tr}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onChange({ audience: tr })}
                  className={`${CHIP} ${on ? CHIP_ON : CHIP_OFF} inline-flex items-center`}
                >
                  {TRACK_LABELS[tr]}
                  <span className={chipCount(on)}>{countReach({ ...t, audience: tr }, groups)}</span>
                </button>
              );
            })}
          </div>
          {noGenderIncluded > 0 && (
            <p className={HINT}>
              Includes {peopleLabel(noGenderIncluded)} with no gender on file (they see both tracks).
            </p>
          )}
        </div>

        <FacetPicker
          label="Seva"
          anyLabel="Any seva"
          noun="sevas"
          options={sevaOptions}
          countFor={(s) => countReach({ ...t, sevas: [s] }, groups)}
          selected={value.sevas}
          onChange={(next) => onChange({ sevas: next })}
          lead={sevaTarget && <SevaTargetStrip {...sevaTarget} />}
        />

        <div>
          <FacetPicker
            label="Hotel"
            anyLabel="Any hotel"
            noun="hotels"
            options={hotelOptions}
            countFor={(h) => countReach({ ...t, hotels: [h] }, groups)}
            selected={value.hotels}
            onChange={(next) => onChange({ hotels: next })}
            collapsedCount={HOTEL_KEYS.length}
          />
          {noHotelLeftOut > 0 && (
            <p className={HINT}>
              {peopleLabel(noHotelLeftOut)} with no hotel room on file won&apos;t get it.
            </p>
          )}
          {hotelOptions.every((o) => o.total === 0) && value.hotels.length === 0 && (
            <p className={HINT}>No hotel rooms on file yet.</p>
          )}
        </div>

        {byHotel && (
          <p id={regionOffId} className="text-[11px] font-semibold leading-snug text-coral-800">
            Region isn&apos;t used while a hotel is picked. Clear the hotel to pick regions again.
          </p>
        )}
        {/* Only there to turn the region picker off while a hotel is picked (nested in the filters'
            fieldset, so specific people still turn it off too); the picker labels itself. */}
        <fieldset
          disabled={byHotel}
          aria-describedby={byHotel ? regionOffId : undefined}
          className={`min-w-0 ${byHotel ? "pointer-events-none -mt-3 select-none opacity-50" : ""}`}
        >
          <FacetPicker
            label="Region"
            anyLabel="Any region"
            noun="regions"
            options={regionOptions}
            // While a hotel is picked: what picking the region would reach once the hotel is cleared.
            countFor={(r) => countReach({ ...t, hotels: [], regions: [r] }, groups)}
            selected={value.regions}
            onChange={(next) => onChange({ regions: next })}
          />
          {noRegionLeftOut > 0 && (
            <p className={HINT}>
              {peopleLabel(noRegionLeftOut)} with no region on file won&apos;t get it.
            </p>
          )}
          {regionOptions.length === 0 && value.regions.length === 0 && (
            <p className={HINT}>No regions on file yet.</p>
          )}
        </fieldset>
      </fieldset>
    </section>
  );
}

/**
 * Under the Seva label while the console is filtered by seva: names the filter
 * and puts its sevas in the audience in one tap (the composer asks first when
 * that would replace sevas already picked). Pale coral like the filter's chips.
 */
function SevaTargetStrip({ name, count, people, available, targeted, onTarget }: SevaTarget) {
  return (
    <div className="mb-2 flex items-center gap-2.5 rounded-2xl border border-coral-200 bg-coral-50 py-1 pl-3.5 pr-1 text-xs text-ink-800">
      <ListFilter aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-coral-700" />
      <p className="min-w-0 flex-1 py-1.5 leading-snug [overflow-wrap:anywhere]">
        Seva filter: <span className="font-semibold text-ink-900">{name}</span>
        {available ? ` · ${peopleLabel(people)}` : ` · no one has ${count === 1 ? "it" : "them"} yet`}
      </p>
      {available && (
        // One button in both states, so focus stays put once the sevas are in the audience.
        <button
          type="button"
          onClick={onTarget}
          className={`inline-flex min-h-11 shrink-0 items-center gap-1 rounded-xl px-2.5 font-semibold transition hover:bg-white/70 focus-visible:outline-2 focus-visible:outline-coral-600 ${
            targeted ? "text-jade-700" : "text-coral-800"
          }`}
        >
          {targeted && <Check aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2.6} />}
          {targeted ? "Targeted" : count === 1 ? "Target this seva" : "Target these sevas"}
        </button>
      )}
    </div>
  );
}
