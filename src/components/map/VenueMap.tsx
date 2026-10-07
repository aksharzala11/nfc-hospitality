"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Info, Layers, LocateFixed, MapPin, Navigation, X } from "lucide-react";
import type { VenueLevelId, VenuePoint, VenueTrack } from "@/lib/venue/types";
import type { RouteRules } from "@/lib/venue/flowRules";
import { buildVenueIndex, normalizeVenueName } from "@/lib/venue/aliases";
import { TRACK_SIDE, createVenueRouter, type RouteClimb, type RouteResult, type VenueRoute } from "@/lib/venue/route";
import {
  SIDE_THINGS,
  TRACK_NAME,
  blueprintTitleOf,
  canStepFreeWith,
  defaultStart,
  destTitleOf,
  directionsProblem,
  isOtherSideRoom,
  listedRooms,
  pickRoom,
  placeTextOf,
  repeatedNames,
  roomTitleOf,
  routeBetween,
  routeNoteFor,
  routeStartPoint,
  servedLevelsOf,
  spotLabel,
  spotPhrase,
  stepsBetween,
  titleBesideFloor,
  twinSpots,
  usableConnectorIds,
} from "@/lib/venue/directions";
import { boxOf, boxOfPoints, connectorOfRoom, unionBox, type Box, type ClientRoom, type ClientVenue } from "@/lib/venue/view";
import { MapCanvas, type Handoff } from "./MapCanvas";
import { Map3D } from "./Map3D";
import { MapSearch, type SearchHit } from "./MapSearch";
import { RoomSheet, type StartOption } from "./RoomSheet";
import { useReducedMotion } from "./useReducedMotion";
import type { MapAlias, MapCoverage, MapDeepLink, MapHere, MatchSpread, QuickPlace } from "./mapTypes";

/** Short floor-button label: "B", "1", "2", "M". */
const SHORT: Record<VenueLevelId, string> = { B: "B", "1": "1", "2": "2", M: "M" };

export function VenueMap({
  venue,
  track,
  aliases,
  quick,
  places,
  initialTo,
  initialFrom,
  initialHere = null,
  initialStepFree = false,
  coverage,
  tagLinks = null,
  rules = null,
  rulesUntil = null,
  rulesNote = null,
}: {
  venue: ClientVenue;
  /**
   * The guest's track (their gender, from requireGuest(), so mirror testers get the mirrored
   * delegate's; admins by their gender too; on /sant/map santVenueTrack(), Bhaio): routes use
   * only that side's stairs / elevators. Null = no gender on file: all.
   */
  track: VenueTrack | null;
  aliases: MapAlias[];
  quick: QuickPlace[];
  places: QuickPlace[];
  initialTo: MapDeepLink | null;
  initialFrom: MapDeepLink | null;
  /**
   * An NFC tag's place (?here=, from /here/<place>: src/lib/here.ts): the start, in place of
   * ?from=, marked "You are here" on its floor (opened and framed) while it is the start.
   */
  initialHere?: MapHere | null;
  /** Open with Step-free on (?stepFree=1; applied only when the guest's side has an elevator). */
  initialStepFree?: boolean;
  coverage: MapCoverage | null;
  /** Admins only: map id -> the /here path an NFC tag at that room carries (hereLinks()). */
  tagLinks?: Record<string, string> | null;
  /**
   * The organisers' flow rules in force at the page's time (or at a /breakouts card's session,
   * ?at=) for this guest's track (mapRules(), src/lib/venue/mapPage.ts): doors, stairs and rooms
   * the routes keep to. Null = none.
   */
  rules?: RouteRules | null;
  /** When the rules in force next change (ISO): the page refreshes then for the new set. Null = never. */
  rulesUntil?: string | null;
  /** Said under the steps when the rules are a /breakouts card's session's, not the page's time's. */
  rulesNote?: string | null;
}) {
  const reducedMotion = useReducedMotion();
  const nav = useRouter();

  // A rule's window opens or closes: fetch the page again (AutoRefresh skips the map pages). The
  // refresh keeps this component's state (the room, the start, Step-free) and brings the new rules.
  // Once per `rulesUntil` (a server clock a little behind this one sends the same value back, and
  // that never sets another timer); more than a day off, the next visit has them.
  useEffect(() => {
    if (!rulesUntil) return;
    const ms = new Date(rulesUntil).getTime() - Date.now();
    if (!Number.isFinite(ms) || ms > 24 * 60 * 60 * 1000) return;
    const t = window.setTimeout(() => nav.refresh(), Math.max(0, ms) + 1000);
    return () => window.clearTimeout(t);
  }, [rulesUntil, nav]);

  // ---- Lookups -------------------------------------------------------------------------------
  const rooms = useMemo(() => venue.levels.flatMap((l) => l.rooms), [venue]);
  const roomById = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms]);
  const index = useMemo(() => buildVenueIndex(rooms, aliases), [rooms, aliases]);
  // Searchable, labelled and tappable (listedRooms()).
  const listed = useMemo(() => listedRooms(rooms, index), [rooms, index]);
  const listedIds = useMemo(() => new Set(listed.map((r) => r.id)), [listed]);
  // Stairs / elevators this guest may use (their side's; every one without a track).
  const usableConnectors = useMemo(() => usableConnectorIds(venue.connectors, track), [venue, track]);
  // ... and, drawn as theirs and offered as a start, the other side's stairs a flow rule lets them
  // use now (RouteRules.side). Step-free and the "doesn't reach" messages keep to their side's own.
  const shownConnectors = useMemo(() => {
    const side = (rules?.side ?? []).filter((id) => venue.connectors.some((c) => c.id === id));
    return side.length > 0 ? new Set([...usableConnectors, ...side]) : usableConnectors;
  }, [usableConnectors, rules, venue]);
  /** A stair / elevator room on the other side (not a start for this guest). */
  const otherSide = useCallback(
    (r: ClientRoom) => isOtherSideRoom(r, venue.connectors, shownConnectors),
    [venue, shownConnectors],
  );
  // Step-free needs an elevator this guest may use.
  const canStepFree = useMemo(() => canStepFreeWith(venue.connectors, usableConnectors), [venue, usableConnectors]);
  /** Floors this guest's stairs and elevators (or elevators only) stop on, for routeProblem(). */
  const servedLevels = useCallback(
    (elevatorsOnly: boolean) => servedLevelsOf(venue.connectors, usableConnectors, elevatorsOnly),
    [venue, usableConnectors],
  );
  const levelById = useMemo(() => new Map(venue.levels.map((l) => [l.id, l])), [venue]);
  const levelName = useCallback((id: VenueLevelId) => levelById.get(id)?.name ?? id, [levelById]);
  // A name the blueprint repeats ("Classroom", "Bath") is told apart by its room number.
  const repeated = useMemo(() => repeatedNames(rooms), [rooms]);
  const blueprintTitle = useCallback((r: ClientRoom) => blueprintTitleOf(r, repeated), [repeated]);
  const titleOf = useCallback((id: string) => roomTitleOf(id, index, roomById, repeated), [index, roomById, repeated]);
  // A room the steps say to walk through ("the Ladies' Gym"), in running text.
  const placeOf = useCallback(
    (id: string) => {
      const r = roomById.get(id);
      return r ? placeTextOf(r, titleOf(id), blueprintTitle) : null;
    },
    [roomById, titleOf, blueprintTitle],
  );
  // A team name two rooms of one floor share ("Samp Square", "Cry Room") is told apart by where
  // each is ("Left side", "At the back": twinSpots()), the room number only where that wouldn't
  // (three of a name in a row); the same name on another floor ("Ladies' Restroom") by the floor.
  const twinsOnFloor = useMemo(() => {
    const count = new Map<string, number>();
    for (const r of listed) count.set(`${r.level}|${r.name}`, (count.get(`${r.level}|${r.name}`) ?? 0) + 1);
    return (r: ClientRoom) => (count.get(`${r.level}|${r.name}`) ?? 0) > 1;
  }, [listed]);
  const spots = useMemo(() => twinSpots(listed), [listed]);
  /**
   * The line under a room's name: its floor, then what tells it apart, then "Staff only".
   *  - shown under another name (`shown`: the event name it was found by): its own, "Second Floor
   *    · Sahajanand Hall" under "Main Hall";
   *  - a room the organisers named: nothing more, or where it is ("Left side", "At the back";
   *    failing that "Room 123") when another room of that floor has the same name;
   *  - a blueprint room: "Classroom 123" under an event name, else "Room 123" (nothing when its
   *    title already ends in the number);
   *  - stairs / an elevator: which side of the map ("Left side").
   */
  const describe = useCallback(
    (id: string, shown?: string) => {
      const r = roomById.get(id);
      if (!r) return "";
      const own = titleOf(id);
      const spot = spots.get(id);
      let detail = "";
      if (shown && normalizeVenueName(shown) !== normalizeVenueName(own)) detail = own;
      else if (!r.named && own !== blueprintTitle(r)) detail = [r.name, r.number].filter(Boolean).join(" ");
      else if (r.named && spot) detail = spotLabel(spot);
      else if (r.number && !own.endsWith(r.number) && (!r.named || twinsOnFloor(r))) detail = `Room ${r.number}`;
      const side = connectorOfRoom(r, venue.connectors)?.side;
      return [levelName(r.level), detail || null, side ? `${side === "left" ? "Left" : "Right"} side` : null, r.closed ? "Staff only" : null]
        .filter(Boolean)
        .join(" · ");
    },
    [roomById, titleOf, blueprintTitle, twinsOnFloor, spots, levelName, venue],
  );
  // One router per map version (a server re-render may send an equal but new `venue`).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const router = useMemo(() => createVenueRouter(venue), [venue.generatedAt]);
  const lobby = useMemo(() => defaultStart(listed), [listed]);
  const mine = useMemo(() => new Set(quick.flatMap((q) => q.roomIds)), [quick]);
  const named = useMemo(() => new Set(index.eventNames.keys()), [index]);
  const orderOf = useCallback((id: VenueLevelId) => levelById.get(id)?.order ?? 0, [levelById]);

  // ---- State ---------------------------------------------------------------------------------
  // The first view, from ?to= / ?from=, chosen the way goTo() chooses: a room with directions,
  // routing only when both ends have them, and the floor of whatever is shown. A ?from= naming
  // the other side's stair / elevator isn't a start for this guest (the From list leaves those
  // out too), and neither is a staff-only room: directions then start at the Main Foyer, and a
  // notice says why. A ?to= naming a staff-only room opens it (no directions) with a notice.
  // An NFC tag's ?here= is a ?from= that, when it is a start, opens its floor and says "You are here".
  // It may be the other side's stairs: the guest is standing there (the routes from it still climb
  // only their own side's), so it is offered in the From list under "You are here".
  const [initial] = useState(() => {
    const hereIds = (initialHere?.roomIds ?? []).filter((id) => listedIds.has(id));
    const from: MapDeepLink | null = initialHere
      ? {
          query: initialHere.name ?? (hereIds.length === 1 ? titleOf(hereIds[0]) : initialHere.label),
          roomIds: hereIds.length === 1 ? hereIds : [],
          spread: "one",
        }
      : initialFrom;
    const fromIds = from?.roomIds ?? [];
    const withEntry = fromIds.filter((id) => roomById.get(id)?.entry);
    const firstFrom = withEntry.find((id) => initialHere || !otherSide(roomById.get(id)!)) ?? null;
    const start = (firstFrom ? roomById.get(firstFrom) : null) ?? lobby;
    const toIds = (initialTo?.roomIds ?? []).filter((id) => roomById.has(id));
    const destId = initialTo ? pickRoom(toIds, initialTo.spread, start, roomById, orderOf) : null;
    const dest = destId ? roomById.get(destId)! : null;
    const routing = Boolean(dest?.entry && start?.entry);
    const hereId = initialHere && firstFrom ? firstFrom : null;
    const levelId: VenueLevelId =
      (routing ? start?.level : dest?.level) ?? (hereId ? start?.level : undefined) ?? (levelById.has("1") ? "1" : venue.levels[0].id);
    const lobbyName = lobby ? placeTextOf(lobby, titleOf(lobby.id), blueprintTitle) : null;
    let notice: string | null = null;
    if (initialTo && !dest) notice = `${initialTo.query} isn’t on the map yet`;
    else if (initialTo && dest?.closed) {
      notice = `${destTitleOf(dest, initialTo.query, index, titleOf)} is for staff only, so there are no directions to it`;
    } else if (from && !firstFrom) {
      const other: VenueTrack | null = track === "BHAIO" ? "BEHNO" : track === "BEHNO" ? "BHAIO" : null;
      const staffOnly = fromIds.length > 0 && fromIds.every((id) => roomById.get(id)?.closed);
      const why =
        withEntry.length > 0 && other
          ? `${from.query} is for ${TRACK_NAME[other]} (on the ${TRACK_SIDE[other]})`
          : staffOnly
            ? `${from.query} is for staff only`
            : fromIds.length > 0
              ? `There are no directions from ${from.query} yet`
              : initialHere
                ? "This tag’s place isn’t on the map yet"
                : `${from.query} isn’t on the map yet`;
      notice = lobbyName ? `${why}: directions start at ${lobbyName}` : `${why}: choose where you are`;
    }
    // The name the link gave the start, kept while it is the start (the steps name it so): a tag's
    // only when it is an event name ("Main Hall"), else the room's own title.
    const startName = firstFrom && from ? (initialHere ? initialHere.name : from.query) : null;
    return { startId: start?.id ?? null, startName, destId, alternatives: toIds, routing, levelId, notice, hereId };
  });
  const [destId, setDestId] = useState<string | null>(initial.destId);
  /** The name the guest picked it by ("Niyam"), shown when it's an event name for that room. */
  const [destLabel, setDestLabel] = useState<string | null>(initialTo?.query ?? null);
  const [alternatives, setAlternatives] = useState<string[]>(initial.alternatives);
  const [spread, setSpread] = useState<MatchSpread>(initialTo?.spread ?? "one");
  const [startId, setStartId] = useState<string | null>(initial.startId);
  /**
   * The name the start was picked by, when it isn't the room's own: the ?from= link's ("Main
   * Hall", as the breakouts page's "How to get there" names it), or the From list line's (a room
   * of theirs, a programme place). Step 1 and the From list say it, so /map reads as the card
   * that linked here. Null = the room's own title.
   */
  const [startName, setStartName] = useState<string | null>(initial.startName);
  /** The NFC tag's room (?here=): "You are here" while it is the start (the guest may pick another). */
  const hereId = initial.hereId;
  const [routing, setRouting] = useState(initial.routing);
  const [stepFree, setStepFree] = useState(initialStepFree);
  const [mode, setMode] = useState<"2d" | "3d">("2d");
  const [expanded, setExpanded] = useState(true);
  const [levelId, setLevelId] = useState<VenueLevelId>(initial.levelId);
  const [notice, setNotice] = useState<string | null>(initial.notice);
  /** A room tapped while following directions: offered as a new destination, not switched to. */
  const [peekId, setPeekId] = useState<string | null>(null);
  const [sheetPx, setSheetPx] = useState(0);
  const sheetRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(t);
  }, [notice]);

  // The sheet's height, so the map frames things above it and the zoom buttons clear it.
  useEffect(() => {
    const el = sheetRef.current;
    if (!el) {
      setSheetPx(0);
      return;
    }
    const ro = new ResizeObserver(() => setSheetPx(el.offsetHeight + 8));
    ro.observe(el);
    return () => ro.disconnect();
  }, [destId]);

  const dest = destId ? roomById.get(destId) ?? null : null;
  const destTitle = dest ? destTitleOf(dest, destLabel, index, titleOf) : "";
  const start = startId ? roomById.get(startId) ?? null : null;
  // As it was picked ("Main Hall") when that event name maps to the room; else its own title.
  const startTitle = start ? destTitleOf(start, startName, index, titleOf) : null;
  // Where the route starts in that room: a lobby's middle, else inside its door (startPointOf()).
  const routeFrom: VenuePoint | null = useMemo(() => routeStartPoint(start, router), [start, router]);
  // Where the guest is (an NFC tag's room), while it is the start.
  const here = hereId !== null && start?.id === hereId ? start : null;

  // ---- Route ---------------------------------------------------------------------------------
  const stepFreeOn = stepFree && canStepFree;
  const result: RouteResult | null = useMemo(() => {
    if (!routing || !dest?.entry || !start || !routeFrom) return null;
    return routeBetween(router, start, routeFrom, dest, { stepFree: stepFreeOn, track, rules });
  }, [routing, dest, start, routeFrom, stepFreeOn, track, router, rules]);
  const route: VenueRoute | null = result?.ok ? result.route : null;
  // New flow rules (a window opened or closed and the page refreshed) are a new route too.
  const routeKey = route ? `${start?.id}>${dest?.id}:${stepFreeOn ? "sf" : ""}:${rules?.key ?? ""}` : "none";

  const steps = useMemo(
    () =>
      route && start && dest && startTitle
        ? stepsBetween(route, start, dest, { startTitle, destTitle, blueprintTitle, levelName, placeOf })
        : null,
    [route, start, dest, startTitle, destTitle, blueprintTitle, levelName, placeOf],
  );
  const problem =
    routing && dest && !route
      ? directionsProblem({
          dest,
          destTitle,
          start,
          startTitle,
          result,
          stepFree: stepFreeOn,
          track,
          served: servedLevels,
          levelName,
        })
      : null;

  // When a new route appears, open the floor it starts on.
  const lastRoute = useRef<string>("none");
  useEffect(() => {
    if (route && routeKey !== lastRoute.current) setLevelId(route.levels[0]);
    lastRoute.current = routeKey;
  }, [route, routeKey]);

  // ---- What the current floor shows ------------------------------------------------------------
  const level = levelById.get(levelId) ?? venue.levels[0];
  const routeLines = useMemo(
    () =>
      (route?.segments ?? []).flatMap((s) => (s.type === "walk" && s.level === level.id && s.points.length > 1 ? [s.points] : [])),
    [route, level.id],
  );
  const handoffs: Handoff[] = useMemo(
    () =>
      ((route?.segments ?? []).filter((s) => s.type === "connector" && s.from === level.id) as RouteClimb[]).map((c) => ({
        point: c.fromPoint,
        to: c.to,
        text: `Next: ${levelName(c.to)}`,
        direction: c.direction,
      })),
    [route, level.id, levelName],
  );
  const connectors = useMemo(
    () =>
      venue.connectors.flatMap((c) => {
        const p = c.points[level.id];
        return p ? [{ id: c.id, kind: c.kind, point: p as VenuePoint, usable: shownConnectors.has(c.id) }] : [];
      }),
    [venue, level.id, shownConnectors],
  );
  const firstWalk = route?.segments[0];
  // The route's first point; with no route, where the guest is (their tag's room) on its floor.
  const startPoint =
    firstWalk?.type === "walk" && firstWalk.level === level.id
      ? firstWalk.points[0]
      : !route && here && here.level === level.id
        ? here.label
        : null;
  const destPoint = dest && dest.level === level.id ? dest.label : null;

  const focus = useMemo((): { box: Box; key: string } | null => {
    if (route) {
      let box: Box | null = null;
      for (const l of routeLines) box = unionBox(box, boxOfPoints(l));
      if (destPoint) box = unionBox(box, boxOfPoints([destPoint]));
      for (const h of handoffs) box = unionBox(box, boxOfPoints([h.point]));
      return box ? { box, key: `${routeKey}@${level.id}` } : null;
    }
    if (dest && dest.level === level.id) return { box: boxOf(dest.pts), key: `room:${dest.id}` };
    // Where the guest is, with enough around it to see the way out: at least a quarter of the floor.
    if (here && here.level === level.id) {
      const b = boxOf(here.pts);
      const half = Math.max(b.x1 - b.x0, b.y1 - b.y0, Math.max(level.bounds.width, level.bounds.height) * 0.25) / 2;
      const cx = (b.x0 + b.x1) / 2;
      const cy = (b.y0 + b.y1) / 2;
      return { box: { x0: cx - half, y0: cy - half, x1: cx + half, y1: cy + half }, key: `here:${here.id}` };
    }
    return null;
  }, [route, routeLines, destPoint, handoffs, routeKey, dest, level.id, level.bounds, here]);

  // ---- Actions -------------------------------------------------------------------------------
  const goTo = (label: string, roomIds: string[], directions: boolean, how: MatchSpread = "one") => {
    const ids = roomIds.filter((id) => roomById.has(id));
    const pick = pickRoom(ids, how, start, roomById, orderOf);
    if (!pick) {
      setNotice(`${label} isn’t on the map yet`);
      return;
    }
    const r = roomById.get(pick)!;
    setDestId(r.id);
    setDestLabel(label);
    setAlternatives(ids);
    setSpread(how);
    setPeekId(null);
    setExpanded(true);
    setMode("2d");
    const canRoute = directions && Boolean(r.entry) && Boolean(start?.entry);
    setRouting(canRoute);
    if (!canRoute) setLevelId(r.level);
  };

  const tapRoom = (id: string) => {
    const r = roomById.get(id);
    if (!r || id === destId) return;
    // Following directions: a tap (maybe just brushing the map) doesn't throw the route away; the
    // room is offered as a new destination instead.
    if (route) {
      setPeekId(id);
      setNotice(null);
      return;
    }
    setDestId(r.id);
    setDestLabel(null);
    setAlternatives([r.id]);
    setSpread("one");
    setRouting(false);
    setExpanded(true);
  };
  const peek = peekId ? roomById.get(peekId) ?? null : null;
  // The offer goes when the route or the floor changes.
  useEffect(() => setPeekId(null), [routeKey, levelId]);

  const startOptions: StartOption[] = useMemo(() => {
    // Never a staff-only room (no entry) or the other side's stairs.
    const out: (StartOption & { side: string | null })[] = [];
    // A name two rooms of one floor share ("Cry Room", "Samp Square") says where each is ("on the
    // left", "at the back"; its room number only where that wouldn't tell them apart); the floor
    // in brackets tells the rest apart ("Ladies' Restroom (Basement)").
    const seen = new Map<string, number>();
    const key = (r: ClientRoom) => `${r.level}|${titleOf(r.id)}`;
    for (const r of listed) seen.set(key(r), (seen.get(key(r)) ?? 0) + 1);
    const add = (id: string, group: string, label?: string) => {
      const r = roomById.get(id);
      if (!r?.entry || out.some((o) => o.id === id && o.group === group)) return;
      // A room of theirs listed by its floor's name ("Mezzanine"): its own name, "Mahant Hall (Mezzanine)".
      const name = label ? titleBesideFloor(r, label, levelName) : titleOf(id);
      const spot = spots.get(id);
      const twin = !label && (seen.get(key(r)) ?? 0) > 1;
      const apart = !twin ? "" : spot ? ` ${spotPhrase(spot)}` : r.number ? ` ${r.number}` : "";
      out.push({
        key: `${group}|${id}`,
        id,
        group,
        label: `${name}${apart} (${levelName(r.level)})`,
        // Listed by another name than its own ("Main Hall" for Sahajanand Hall): the steps say it.
        ...(label && normalizeVenueName(label) !== normalizeVenueName(titleOf(id)) ? { name: label } : {}),
        side: connectorOfRoom(r, venue.connectors)?.side ?? null,
      });
    };
    // Where an NFC tag says they are, first (even the other side's stairs: they are standing there).
    if (hereId) add(hereId, "You are here", initialHere?.name ?? undefined);
    if (lobby) add(lobby.id, "Suggested");
    // The start a link named by a name no line below lists it by ("Sabha Hall"): offered as such.
    if (start && startName && startTitle === startName && normalizeVenueName(startName) !== normalizeVenueName(titleOf(start.id))) {
      const listedSo = [...quick, ...places].some((q) => q.roomIds[0] === start.id && normalizeVenueName(q.label) === normalizeVenueName(startName));
      if (!listedSo && start.id !== lobby?.id) add(start.id, "Suggested", startName);
    }
    // Other ways in (a vestibule, a waiting area); a room the organisers named ("Samp Square") is
    // an ordinary room, listed under its floor.
    for (const r of listed) if (r.id !== lobby?.id && !r.named && (r.kind === "lobby" || r.kind === "exit")) add(r.id, "Suggested");
    for (const q of quick) if (q.roomIds[0]) add(q.roomIds[0], "Your rooms", q.label);
    for (const p of places) if (p.roomIds[0]) add(p.roomIds[0], "Programme", p.label);
    // Every floor's rooms, bottom to top; not the other side's stairs / elevators (the guest
    // wouldn't be starting from one).
    for (const l of [...venue.levels].sort((a, b) => a.order - b.order)) {
      const onLevel = listed
        .filter((r) => r.level === l.id && r.entry && !otherSide(r))
        .sort((a, b) => titleOf(a.id).localeCompare(titleOf(b.id)));
      for (const r of onLevel) add(r.id, l.name);
    }
    // Two stairs of one name on a floor (a guest who may use both sides): say which side.
    const count = new Map<string, number>();
    for (const o of out) count.set(`${o.group}|${o.label}`, (count.get(`${o.group}|${o.label}`) ?? 0) + 1);
    return out.map(({ side, ...o }) =>
      side && (count.get(`${o.group}|${o.label}`) ?? 0) > 1 ? { ...o, label: o.label.replace(/ \(([^()]*)\)$/, ` on the ${side} ($1)`) } : o,
    );
  }, [roomById, listed, lobby, quick, places, venue, titleOf, levelName, otherSide, spots, start, startName, startTitle, hereId, initialHere]);
  // The From list's line in use: the start under the name it goes by (its own title: the line
  // without a name of its own), else any line for that room.
  const startKey = useMemo(() => {
    if (!startId) return "";
    const named = startTitle && start && normalizeVenueName(startTitle) !== normalizeVenueName(titleOf(start.id)) ? normalizeVenueName(startTitle) : null;
    const lines = startOptions.filter((o) => o.id === startId);
    return (lines.find((o) => (named ? o.name !== undefined && normalizeVenueName(o.name) === named : o.name === undefined)) ?? lines[0])?.key ?? "";
  }, [startOptions, startId, start, startTitle, titleOf]);

  // The rooms a name found, as chips: those that share a title are told apart by their floor, or
  // on one floor by where they are ("Samp Square (left)"; failing that their room number).
  const alternativeChips = useMemo(() => {
    const titles = alternatives.map((id) => titleOf(id));
    return alternatives.map((id, i) => {
      const r = roomById.get(id);
      const twins = alternatives.filter((_, j) => j !== i && titles[j] === titles[i]);
      if (!r || twins.length === 0) return { id, title: titles[i] };
      const onFloor = twins.some((o) => roomById.get(o)?.level === r.level);
      const spot = spots.get(id);
      const apart = spot ? ` (${spot})` : r.number ? ` ${r.number}` : "";
      return { id, title: onFloor ? `${titles[i]}${apart}` : `${titles[i]} (${levelName(r.level)})` };
    });
  }, [alternatives, roomById, titleOf, levelName, spots]);

  const routeLevels = new Set(route?.levels ?? []);
  // Top floor first (the mezzanine), by `order`.
  const levelsTopDown = useMemo(() => [...venue.levels].sort((a, b) => b.order - a.order), [venue]);
  // Under the steps: which stairs / elevators the directions use, and (rules from a /breakouts
  // card's link) whose time the directions are for.
  const sideNote = [routeNoteFor(track, stepFreeOn, route), rulesNote].filter(Boolean).join(" ") || null;
  // Under the map: what the hatched rooms and the faded stair / elevator markers mean.
  const hasStaffOnly = useMemo(() => rooms.some((r) => r.closed), [rooms]);
  const otherTrack: VenueTrack | null = track === "BHAIO" ? "BEHNO" : track === "BEHNO" ? "BHAIO" : null;
  const hasOtherSide = otherTrack !== null && venue.connectors.some((c) => !shownConnectors.has(c.id));

  return (
    <div className="space-y-3">
      {here && startTitle && (
        <section
          aria-label="Where you are"
          className="flex items-center gap-3 rounded-2xl bg-white px-3.5 py-3 shadow-card ring-1 ring-jade-200"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-jade-100 text-jade-700">
            <LocateFixed aria-hidden="true" className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-bold uppercase tracking-[0.16em] text-jade-700">You are here</span>
            <span className="block truncate text-base font-semibold text-ink-900">{titleBesideFloor(here, startTitle, levelName)}</span>
            <span className="block text-xs leading-snug text-ink-600">
              {levelName(here.level)} · Search or tap a room for directions from here
            </span>
          </span>
        </section>
      )}

      <MapSearch
        aliases={aliases}
        rooms={listed}
        describe={describe}
        titleOf={titleOf}
        onPick={(h: SearchHit) => goTo(h.label, h.roomIds, true, h.spread)}
      />

      {(quick.length > 0 || places.some((p) => p.roomIds.length > 0)) && (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          {[...quick, ...places.filter((p) => p.roomIds.length > 0 && !quick.some((q) => q.label === p.label))].map((q) => {
            const off = q.roomIds.length === 0;
            return (
              <button
                key={q.key}
                type="button"
                onClick={() => goTo(q.label, q.roomIds, true, q.spread)}
                className={`flex max-w-[15rem] shrink-0 flex-col items-start rounded-2xl border px-3 py-1.5 text-left ${
                  off
                    ? "border-dashed border-sand-400 bg-sand-50 text-ink-500"
                    : mine.has(q.roomIds[0])
                      ? "border-coral-200 bg-coral-50 text-ink-900 hover:bg-coral-100"
                      : "border-sand-300 bg-white text-ink-900 hover:bg-sand-50"
                }`}
              >
                <span className="flex max-w-full items-center gap-1.5 text-sm font-semibold">
                  <MapPin aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 ${off ? "text-ink-300" : "text-coral-700"}`} />
                  <span className="truncate">{q.label}</span>
                </span>
                <span className="max-w-full truncate text-[11px] text-ink-500">{off ? "Not on the map yet" : q.context}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="relative isolate h-[min(64dvh,600px)] min-h-[340px] overflow-hidden rounded-3xl border border-white/70 bg-sand-50 shadow-card">
        {mode === "2d" ? (
          <MapCanvas
            key={level.id}
            level={level}
            // The picked room under the name it was picked by ("Main Hall"); one picked by its floor's
            // name ("Mezzanine") under its own, on that floor's plan.
            titles={new Map(level.rooms.map((r) => [r.id, r.id === dest?.id ? titleBesideFloor(dest, destTitle, levelName) : titleOf(r.id)]))}
            listedIds={listedIds}
            mine={mine}
            named={named}
            destId={destId}
            startId={routing || here ? startId : null}
            startHere={Boolean(here)}
            routeLines={routeLines}
            routeKey={routeKey}
            handoffs={handoffs}
            startPoint={startPoint}
            destPoint={destPoint}
            connectors={connectors}
            focus={focus}
            insetBottomPx={dest ? sheetPx : 0}
            compactControls={Boolean(dest) && expanded}
            reducedMotion={reducedMotion}
            onTapRoom={tapRoom}
            onHandoff={(to) => setLevelId(to)}
          />
        ) : (
          <Map3D
            venue={venue}
            currentLevel={level.id}
            route={route}
            destId={destId}
            startId={routing || here ? startId : null}
            destPoint={dest ? { level: dest.level, point: dest.label } : null}
            // Where the line starts (a room left by its door starts at a door its flow rule allows), as on
            // the 2D plan; with no route, where the guest is (their tag's room).
            startPoint={
              firstWalk?.type === "walk"
                ? { level: firstWalk.level, point: firstWalk.points[0] }
                : !route && here
                  ? { level: here.level, point: here.label }
                  : null
            }
            reducedMotion={reducedMotion}
            insetBottomPx={dest ? sheetPx : 0}
            onPickLevel={(id) => {
              setLevelId(id);
              setMode("2d");
            }}
          />
        )}

        {/* View switch and the floor you're on. */}
        <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-col items-start gap-2">
          <div role="group" aria-label="View" className="pointer-events-auto flex rounded-full bg-white p-1 shadow-card ring-1 ring-sand-300">
            {(["2d", "3d"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  // The stack needs the room: fold the sheet down to its title.
                  if (m === "3d") setExpanded(false);
                }}
                aria-pressed={mode === m}
                className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold ${
                  mode === m ? "bg-ink-800 text-white" : "text-ink-700 hover:bg-sand-100"
                }`}
              >
                {m === "3d" && <Layers aria-hidden="true" className="h-3.5 w-3.5" />}
                {m === "2d" ? "Floor" : "3D view"}
              </button>
            ))}
          </div>
          {mode === "2d" && (
            <p className="rounded-full bg-ink-800/90 px-3 py-1 text-xs font-bold text-white shadow-card">{level.name}</p>
          )}
        </div>

        {/* Floors, top floor first like a lift panel. */}
        <div role="group" aria-label="Floors" className="absolute right-3 top-3 z-10 flex flex-col overflow-hidden rounded-2xl bg-white shadow-card ring-1 ring-sand-300">
          {levelsTopDown.map((l) => {
            const active = l.id === level.id;
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => {
                  setLevelId(l.id);
                  setMode("2d");
                }}
                aria-pressed={active && mode === "2d"}
                aria-label={l.name}
                title={l.name}
                className={`relative flex h-10 w-10 items-center justify-center text-sm font-bold ${
                  active ? "bg-ink-800 text-white" : "text-ink-800 hover:bg-sand-100"
                }`}
              >
                {SHORT[l.id]}
                {routeLevels.has(l.id) && (
                  <span aria-hidden="true" className={`absolute right-1.5 top-1.5 h-2 w-2 rounded-full ${active ? "bg-coral-300" : "bg-coral-600"}`} />
                )}
              </button>
            );
          })}
        </div>

        {peek && (
          <div
            role="status"
            className="absolute inset-x-3 z-30 mx-auto flex max-w-sm items-center gap-2 rounded-2xl bg-white px-3.5 py-2.5 shadow-card-lg ring-1 ring-sand-300"
            style={{ bottom: (dest ? sheetPx : 0) + 12 }}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-ink-900">{titleOf(peek.id)}</span>
              <span className="block truncate text-xs text-ink-500">{describe(peek.id)}</span>
            </span>
            {peek.entry && (
              <button
                type="button"
                onClick={() => goTo(titleOf(peek.id), [peek.id], true)}
                className="flex shrink-0 items-center gap-1.5 rounded-full bg-ink-800 px-3 py-1.5 text-xs font-bold text-white hover:bg-ink-900"
              >
                <Navigation aria-hidden="true" className="h-3.5 w-3.5" />
                Go here instead
              </button>
            )}
            <button
              type="button"
              onClick={() => setPeekId(null)}
              aria-label="Keep the current directions"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sand-100 text-ink-700 hover:bg-sand-200"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
        )}

        {notice && !peek && (
          <div
            role="status"
            className="absolute inset-x-3 z-30 mx-auto flex max-w-sm items-start gap-2 rounded-2xl bg-ink-800 px-3.5 py-2.5 text-sm text-white shadow-card-lg"
            style={{ bottom: (dest ? sheetPx : 0) + 12 }}
          >
            <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-coral-300" />
            <span>{notice}</span>
          </div>
        )}

        {dest && (
          <RoomSheet
            ref={sheetRef}
            room={dest}
            title={destTitle}
            subtitle={describe(dest.id, destTitle)}
            mapId={coverage ? dest.id : null}
            tagLink={tagLinks?.[dest.id] ?? null}
            alternatives={alternativeChips}
            spread={spread}
            query={destLabel}
            expanded={expanded}
            routing={routing}
            startKey={startKey}
            startOptions={startOptions}
            stepFree={stepFreeOn}
            canStepFree={canStepFree}
            routeNote={sideNote}
            steps={steps}
            problem={problem}
            levelName={levelName}
            onToggle={() => setExpanded((e) => !e)}
            onClose={() => {
              setDestId(null);
              setRouting(false);
              setAlternatives([]);
              setPeekId(null);
            }}
            onDirections={() => setRouting(true)}
            onStart={(key) => {
              const line = startOptions.find((o) => o.key === key);
              if (!line) return;
              setStartId(line.id);
              setStartName(line.name ?? null);
            }}
            onStepFree={setStepFree}
            onStep={(l) => {
              setLevelId(l);
              setMode("2d");
            }}
            onAlternative={(id) => {
              setDestId(id);
              // No route to follow to its floor (not routing, or a staff-only room): show it.
              const r = roomById.get(id);
              if (r && (!routing || !r.entry || !start?.entry)) setLevelId(r.level);
            }}
          />
        )}
      </div>

      {(hasStaffOnly || hasOtherSide) && (
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] leading-snug text-ink-600" aria-label="Map key">
          {hasStaffOnly && (
            <li className="flex items-center gap-1.5">
              <svg aria-hidden="true" viewBox="0 0 16 12" className="h-3 w-4 shrink-0 rounded-[3px] ring-1 ring-sand-400">
                <rect width="16" height="12" className="fill-sand-100" />
                <path d="M-2 6L6 -2M-2 12L12 -2M4 14L18 0M10 14L18 6" className="fill-none stroke-sand-400" strokeWidth="1.8" />
              </svg>
              Staff only: no directions
            </li>
          )}
          {hasOtherSide && otherTrack && (
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full bg-ink-800/30" />
              Faded {SIDE_THINGS} are for {TRACK_NAME[otherTrack]}
            </li>
          )}
        </ul>
      )}

      {coverage && (
        <section className="rounded-2xl bg-white px-4 py-3 text-sm text-ink-700 shadow-card ring-1 ring-sand-300">
          <p className="font-semibold text-ink-900">
            Admins: {coverage.mapped} of {coverage.total} event room names are on the map
          </p>
          <p className="mt-1 text-xs leading-relaxed text-ink-500">
            {coverage.namedRooms} of {coverage.rooms} rooms carry the organisers&rsquo; name. Tap a room to see its map id, then
            add it to <code className="font-mono">src/lib/venue/aliasTable.ts</code>.
            {coverage.unmapped.length > 0 && <> Not on the map yet: {coverage.unmapped.join(", ")}.</>}
            {coverage.tentative.length > 0 && <> To confirm with the organisers: {coverage.tentative.join(", ")}.</>}
          </p>
          {coverage.problems.length > 0 && (
            <p className="mt-2 rounded-xl bg-coral-50 px-3 py-2 text-xs leading-relaxed text-coral-900">
              <span className="font-semibold">This map needs extracting and importing again</span> (README, &ldquo;Venue
              map&rdquo;): {coverage.problems.slice(0, 3).join(" · ")}
              {coverage.problems.length > 3 && <> (and {coverage.problems.length - 3} more)</>}.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
