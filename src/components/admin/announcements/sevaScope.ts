/**
 * The console-wide seva filter (src/lib/admin/sevaFilter.ts) as the
 * announcements page applies it: the history keeps the announcements that
 * reach at least one person with a picked seva, each row says how many of
 * those people it reaches, and "Target these sevas" puts the picked sevas in
 * the composer's audience.
 *
 * Pure and isomorphic (the page builds the scope on the server, the console
 * reads it in the browser). Counting goes through countReach(), the one
 * targeting rule, over the anonymous facet groups: an announcement with no
 * seva targeting counts when its role / track / region reach those people.
 */
import { countReach, type AnnouncementView, type FacetGroup, type Targeting } from "@/lib/admin/announcements";
import { expandSevaSelection, sevaFilterLabel, sevaOptionValue } from "@/lib/admin/sevaFilter";

/** An active seva filter, resolved against today's accounts. */
export type SevaScope = {
  /** The picked sevas as the filter bar names them (option values, e.g. ["BM RA", "SA"]). */
  labels: string[];
  /**
   * The users.seva values, exactly as stored and held by at least one account,
   * that the picks cover (every spelling of a picked team, e.g. "BM RA" and
   * "eBM RA"), sorted. What "Target these sevas" puts in the audience; empty
   * when nobody has a picked seva yet.
   */
  userSevas: string[];
  /**
   * The labels at least one of those userSevas belongs to: the picks "Target
   * these sevas" actually puts in the audience (a team nobody has yet adds
   * nothing), in `labels` order.
   */
  targetLabels: string[];
  /** Accounts (every role) with one of those sevas: the "of M" in each row. */
  people: number;
};

/** A history row; `sevaReach` (people of the filtered sevas it reaches) only while a seva filter is on. */
export type ScopedAnnouncementView = AnnouncementView & { sevaReach?: number };

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

/**
 * The scope for the sevas in the URL (readSevaFilter()), or null for no filter.
 * `groups` are the page's facet groups, so the counts come from the same
 * snapshot as the composer's reach.
 */
export function sevaScopeFor(selected: readonly string[], groups: readonly FacetGroup[]): SevaScope | null {
  const labels = [...new Set(selected.map(sevaOptionValue).filter(Boolean))];
  if (labels.length === 0) return null;

  const held = [...new Set(groups.map((g) => g.seva))];
  const heldSet = new Set(held);
  const covered = new Set(expandSevaSelection(selected, held).userSevas.filter((s) => heldSet.has(s)));
  const userSevas = [...covered].sort((a, b) => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0));

  // Every covered spelling folds into one of the labels (expandSevaSelection() matches by option value).
  const targeted = new Set(userSevas.map(sevaOptionValue));
  const targetLabels = labels.filter((l) => targeted.has(l));

  let people = 0;
  for (const g of groups) if (covered.has(g.seva)) people += g.count;
  return { labels, userSevas, targetLabels, people };
}

/** The facet groups of the people in the scope (the groups whose seva it covers). */
export function scopeGroups(scope: SevaScope, groups: readonly FacetGroup[]): FacetGroup[] {
  const covered = new Set(scope.userSevas);
  return groups.filter((g) => covered.has(g.seva));
}

/** People of the scope a notification reaches (`inScope` from scopeGroups()): the "N" in each row. */
export function scopeReach(t: Targeting, inScope: readonly FacetGroup[]): number {
  return countReach(t, inScope);
}

/**
 * "BM RA", "BM RA, SA", "BM RA, SA, KM RA", then "BM RA, SA +2 more": how
 * every console view names the filter (sevaFilterLabel()).
 */
export function scopeName(scope: Pick<SevaScope, "labels">): string {
  return sevaFilterLabel(scope.labels);
}

/** A history row's line: "Reaches 12 of 40 in BM RA, SA", "Reaches all 40 in BM RA". */
export function scopeReachLabel(n: number, scope: SevaScope): string {
  const name = scopeName(scope);
  const m = scope.people;
  const fmt = (x: number) => x.toLocaleString("en-US");
  if (n === 0) return `Reaches none of the ${fmt(m)} in ${name}`;
  if (m === 1) return `Reaches the 1 person in ${name}`;
  if (n === m) return `Reaches all ${fmt(m)} in ${name}`;
  return `Reaches ${fmt(n)} of ${fmt(m)} in ${name}`;
}

/** Same values, any order (seva lists are sets). */
export function sameSevas(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((v) => set.has(v)) && set.size === new Set(b).size;
}
