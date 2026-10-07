/**
 * A route (src/lib/venue/route.ts) as 3 to 6 plain-English steps:
 *
 *   1. Start at the Main Foyer (First Floor)   ("Start at Mahant Hall (Mezz)": a name that says its floor)
 *   2. Walk to the foyer stairs
 *   3. Take the foyer stairs up to the Second Floor
 *   4. Niyam is on your left
 *
 * Stairs and elevators are named by where they are, never by number (the building has no stair
 * signs; organisers, 2026-10-01): "the foyer stairs", "the side stairs", "the back stairs", "the
 * foyer elevator", "the back elevator" (connectorPhrase(), view.ts); "the stairs" / "the elevator"
 * on a map that doesn't say where they are. A guest who may use both of a pair (no gender on
 * file) is told which the first time it is named: "Walk to the foyer stairs on the left".
 *
 * Climbs name the floor they arrive on, by the levels' order (B < 1 < 2 < M, the mezzanine on
 * top): "Take the back stairs up to the Mezzanine", "Take the back elevator down to the Second
 * Floor". A climb that stays in one shaft past a floor is one step ("Take the back elevator up to
 * the Mezzanine" from the basement); changing shafts on the way (no one stair joins both floors)
 * is two climbs, merged with their walks when the list would otherwise run past six steps: "Walk
 * to the foyer stairs and take them up to the Second Floor", "Walk to the back stairs and take
 * them up to the Mezzanine" (stairs are "them", an elevator "it").
 *
 * The last step says which side the room is on only when the route's final turn into its door
 * is clear-cut (see arrivalSide()); otherwise it is "Follow the line to Niyam" ("Walk to Niyam" where
 * no line is drawn, StepContext.noLine; "You're already at Niyam" when there is nothing to walk).
 *
 * A room the organisers' flow maps have guests walk through (a flow rule's passage; the route's
 * RouteWalk.through) is named in the walk that crosses it, by its shown name (StepContext.placeOf):
 * "Walk through the Ladies' Gym to the side stairs", "Walk through the Ladies' Gym to Suhradbhav".
 * Never a door: doors are never named. A stair a flow rule lets a track use on the other side says
 * which side ("Take the back stairs on the left down to the Second Floor").
 * Pure; runs in the browser and on the server.
 */
import type { VenueLevelId, VenuePoint } from "./types";
import type { RouteClimb, RouteWalk, VenueRoute } from "./route";
import { capitalise, connectorPhrase, connectorPronoun, levelPhrase, pointInPolygon, withArticle } from "./view";

export type RouteStep = {
  text: string;
  /** The level the step happens on (a climb: the level it arrives on). */
  level: VenueLevelId;
  kind: "start" | "walk" | "climb" | "arrive";
};

export type StepContext = {
  /** Where the route starts, as the guest knows it ("Main Foyer", "Niyam"). */
  startName: string;
  /** Where it ends. */
  destName: string;
  /** The names are the blueprint's descriptions, not event or team names ("Bath" -> "the Bath"; isGenericTitle()). */
  startGeneric?: boolean;
  destGeneric?: boolean;
  /** The destination's outline (flat points), for which side it's on. */
  destPolygon?: number[];
  levelName: (id: VenueLevelId) => string;
  /**
   * No line is drawn beside the steps (the breakouts page's "How to get there"): the last walk
   * reads "Walk to Niyam" rather than "Follow the line to Niyam".
   */
  noLine?: boolean;
  /**
   * A room walked through (RouteWalk.through: a map id) in running text, as guests read it ("the
   * Ladies' Gym"); null leaves it out. Without it no room walked through is named.
   */
  placeOf?: (roomId: string) => string | null;
};

export type ArrivalSide = "left" | "right" | "ahead";

/** Turn angle (degrees) at or above which the room is clearly to one side. */
const SIDE_MIN_TURN = 35;
/** Turn angle at or below which it is straight ahead. */
const AHEAD_MAX_TURN = 20;

/**
 * Which side the destination is on as you reach its door: the direction you were walking before
 * the route's last segment into the room, against that segment. Null when it isn't clear-cut
 * (the turn is in between, the route goes straight in from its start, or the walk is too short).
 * Map y grows down, so a positive cross product is a turn to the right.
 */
export function arrivalSide(walk: RouteWalk, polygon?: number[]): ArrivalSide | null {
  const pts = walk.points;
  if (pts.length < 2) return null;
  // The segment that crosses into the room (the first whose end is inside); else the last one.
  let k = pts.length - 1;
  if (polygon && polygon.length >= 6) {
    for (let i = 1; i < pts.length; i++) {
      if (pointInPolygon(polygon, pts[i][0], pts[i][1])) {
        k = i;
        break;
      }
    }
  }
  if (k < 2) return null;
  const into: VenuePoint = [pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]];
  const before: VenuePoint = [pts[k - 1][0] - pts[k - 2][0], pts[k - 1][1] - pts[k - 2][1]];
  const la = Math.hypot(...before);
  const lb = Math.hypot(...into);
  if (la < 1e-6 || lb < 1e-6) return null;
  const cos = (before[0] * into[0] + before[1] * into[1]) / (la * lb);
  const turn = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
  if (turn <= AHEAD_MAX_TURN) return "ahead";
  if (turn < SIDE_MIN_TURN || turn > 150) return null;
  const cross = before[0] * into[1] - before[1] * into[0];
  return cross > 0 ? "right" : "left";
}

/**
 * "Take the foyer stairs up to the Second Floor". `withSide` adds the side hint ("on the left")
 * when the climb carries one and no step before named this stair.
 */
function climbText(c: RouteClimb, levelName: (id: VenueLevelId) => string, withSide: boolean): string {
  return `Take ${connectorPhrase(c, withSide ? c.sideHint : null)} ${c.direction} to ${levelPhrase(levelName(c.to))}`;
}

/**
 * "the Main Foyer (First Floor)": the start with its floor. A name that already ends in a note
 * keeps one pair of brackets: "Mahant Hall (Mezz)" on the Mezzanine stays as it is (the note is
 * the floor), "Guestroom (First Floor)" too; any other note takes the floor after a comma.
 */
function withFloor(place: string, floor: string): string {
  const note = /\(([^()]*)\)\s*$/.exec(place)?.[1].trim().toLowerCase();
  if (note === undefined) return `${place} (${floor})`;
  return note && floor.toLowerCase().startsWith(note) ? place : `${place}, ${floor}`;
}

/** "the Ladies' Gym", "the Ladies' Gym and the Small Banquet Hall": the rooms a walk goes through, or "". */
function throughText(walk: RouteWalk, ctx: StepContext): string {
  if (!ctx.placeOf || !walk.through?.length) return "";
  const names = walk.through.map((id) => ctx.placeOf!(id)).filter((n): n is string => Boolean(n));
  if (names.length === 0) return "";
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The steps for a route. `route.segments` starts and ends with a walk. */
export function routeSteps(route: VenueRoute, ctx: StepContext): RouteStep[] {
  const segs = route.segments;
  const first = segs[0] as RouteWalk;
  const last = segs[segs.length - 1] as RouteWalk;
  const dest = withArticle(ctx.destName, ctx.destGeneric);
  /** "Walk to", or "Walk through the Ladies' Gym to" when the walk crosses a passage room. */
  const walkTo = (walk: RouteWalk) => {
    const through = throughText(walk, ctx);
    return through ? `Walk through ${through} to` : "Walk to";
  };
  const steps: RouteStep[] = [
    { kind: "start", level: first.level, text: `Start at ${withFloor(withArticle(ctx.startName, ctx.startGeneric), ctx.levelName(first.level))}` },
  ];

  if (segs.length === 1 && route.distance < 1e-6) {
    return [...steps, { kind: "arrive", level: last.level, text: `You're already at ${dest}` }];
  }

  // Each climb, with the walk to it (skipped when you start right at it).
  const pairs: { walk: RouteWalk; climb: RouteClimb }[] = [];
  for (let i = 1; i < segs.length; i += 2) pairs.push({ walk: segs[i - 1] as RouteWalk, climb: segs[i] as RouteClimb });
  const merge = 1 + pairs.length * 2 + 2 > 6;
  for (const { walk, climb } of pairs) {
    const walked = walk.distance > 1e-6;
    if (merge && walked) {
      steps.push({
        kind: "climb",
        level: climb.to,
        text: `${walkTo(walk)} ${connectorPhrase(climb, climb.sideHint)} and take ${connectorPronoun(climb)} ${climb.direction} to ${levelPhrase(ctx.levelName(climb.to))}`,
      });
      continue;
    }
    if (walked) steps.push({ kind: "walk", level: walk.level, text: `${walkTo(walk)} ${connectorPhrase(climb, climb.sideHint)}` });
    steps.push({ kind: "climb", level: climb.to, text: climbText(climb, ctx.levelName, !walked) });
  }

  const side = arrivalSide(last, ctx.destPolygon);
  const through = last.distance > 1e-6 ? throughText(last, ctx) : "";
  if (!side && last.distance > 1e-6) {
    // No clear side: one step, not "Follow the line to X" and then "Arrive at X".
    const via = through ? ` through ${through}` : "";
    steps.push({ kind: "arrive", level: last.level, text: `${ctx.noLine ? "Walk" : "Follow the line"}${via} to ${dest}` });
    return steps;
  }
  if (last.distance > 1e-6 && (steps.length < 5 || through)) {
    steps.push({ kind: "walk", level: last.level, text: through ? `Walk through ${through} towards ${dest}` : `Walk towards ${dest}` });
  }
  const Dest = capitalise(dest);
  steps.push({
    kind: "arrive",
    level: last.level,
    text: side === "left" || side === "right" ? `${Dest} is on your ${side}` : side === "ahead" ? `${Dest} is straight ahead` : `Arrive at ${dest}`,
  });
  return steps;
}
