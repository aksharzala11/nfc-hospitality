#!/usr/bin/env python3
"""
Venue map extraction: the Edison mandir's floors from the organisers' blueprint.

Reads the blueprint (a vector CAD PDF: one sheet per floor, the third sheet holding the
mezzanine strip above the second floor) and writes, into a directory OUTSIDE this repository:

  venue-map.json        VenueMapData (src/lib/venue/types.ts): levels with walls, rooms and a
                        walkable grid, and the stairs / elevators joining them
  preview-<level>.png   one picture per level: rooms (public by kind, back-of-house grey),
                        staff-only rooms pale grey with their name), labels, walls, entries
                        (blue dots), connector landings with their id, place and side, the
                        building's central axis (dashed), sample routes per track (far-apart
                        rooms, plus any given with --route; by the app's rules: that side's
                        stairs, an elevator only when those don't get there)
  grid-<level>.png      with --debug: walkable cells (green kept, orange cut off), room
                        outlines and door hinges
  report.json           what was found: scale, alignment, counts, splits, leaks, sizes, sides,
                        places, and what each argument below did

Levels, bottom to top (`order`): Basement (B) 0, First Floor (1) 1, Second Floor (2) 2,
Mezzanine (M) 3. The mezzanine is the top floor, above the second floor (organisers,
2026-09-30).

Usage:
  python scripts/venue/extract.py --pdf <blueprint.pdf> --out <dir outside the repo>
      [--public <room id>]... [--private <room id>]... [--closed <room id>]...
      [--merge <room id>+<room id>]... [--partition <room id>+<room id>]... [--passage <room id>]...
      [--name <room id>=<name>]...
      [--drop-connector <connector id>]... [--drop-landing <connector id>:<level>]...
      [--landing <connector id>:<level>=<x>,<y>]...
      [--side <connector id>=left|right|none]... [--place <connector id>=foyer|side|back|none]...
      [--sant <room id>]... [--not-sant <room id>]... [--sant-class <room id>=own|shared|way]...
      [--sant-open <santo room id>:<room id>]... [--sant-seal <santo room id>:<room id>]...
      [--route <from id>:<to id>]... [--no-preview] [--debug]

  Every one is optional and repeatable. Keep room ids of the blueprint out of the repo: they
  belong on the command line (and in a note kept beside the output), not in this file.
  --public / --private override the back-of-house / private-quarters rules for one room id
  (ids as the previews and the admin map sheet show them, e.g. "2-999" or "B-open-area-9").
  --closed marks a room STAFF ONLY, as the organisers' own plans hatch it: it stays drawn and
  named (public: true) but gets closed: true, no entry, and its floor is not walkable, so the
  app shows it and never gives directions to, from or through it.
  --merge makes one room of two ("M-999+M-998": a hall whose sliding partition stays open): the
  union of their outlines, the partition between them taken out of the level's walls and the
  walkable grid opened across it. It keeps the first id (and, without --name, the first name).
  --partition is the opposite: two rooms of one hall that a movable partition divides, drawn
  dashed on the blueprint ("2-999A+2-999B": the partition is closed for the event). The floor the
  two labels share is split along the partition (the walkable floor on either side of it, at the
  grid's clearance), not by distance between the labels, so neither room's outline reaches past
  it; the dashes already keep routes from crossing it.
  --passage makes a room a way through (a water station alcove between a gym and a foyer): its
  kind becomes "corridor", so routes cross it at no extra cost; it keeps its name.
  --name gives a room the organisers' name for it ("B-999=Large Banquet Hall"): what the app
  shows where no event name is mapped to it. Its kind follows the new name (a "... Hall" is a
  hall).
  --drop-connector takes a stair / elevator off the map for guests altogether (a freight
  elevator): no connector, and its room on each level becomes a closed room named "Freight
  Elevator" ("Staff Stairs" for a stair); --private <room id> hides one of those rooms.
  --drop-landing takes one level off a stair / elevator ("stair-9:B": the back stairs don't
  serve the basement for guests); its room on that level becomes private (a plain block, not
  drawn as stairs).
  --landing places a stair's / elevator's landing on one level where the organisers' plans have
  guests reach it ("stair-9:B=1234.5,567.5", map units), instead of the extractor's spot beside the
  shaft: the walkable cell nearest that point (within LANDING_PIN_REACH), on the level's floor.
  Routes then end their walk there before the climb.
  --side sets one stair's / elevator's side ("stair-3=right"), overriding the geometry; "none"
  leaves it without a side (every guest may use it).
  --place sets where one is in the building ("stair-3=back"), overriding the geometry; "none"
  leaves it without one.
  --route draws that route on the previews too (ids not on the map are skipped).
  --sant / --not-sant / --sant-class / --sant-open / --sant-seal set the Pujya Santo view's
  residence (see "Santos' quarters" below).
  An id that isn't on the map stops the script for every argument but --public, --private and
  --route (report.json lists those under "arguments" when they matched nothing).

Sides (organisers, 2026-09-30): Bhaio use only the stairs on the right of the map, Behno only
those on the left (the app applies it, src/lib/venue/route.ts TRACK_SIDE; elevators follow
the same split while ELEVATORS_FOLLOW_SIDE). A connector's side is where its landings lie (their
mean x in the map frame) against the building's central axis, the middle of the largest public
hall on the first floor (the mandir prayer hall); one within SIDE_AXIS_MIN of the axis gets no
side (anyone may use it). The report lists every connector's side, its distance from the axis
and whether --side set it.

Places and names (organisers, 2026-10-01): the building has no stair signs, so no stair or
elevator carries a number for guests: a connector's `name` is "Stairs" / "Elevator" and the app
names it by its `place`: "foyer" (near the central axis: beside the main foyer), "side" (off
the axis, in the half of the building the main lobby is in) or "back" (off the axis, in the far
half). Ids ("stair-5") keep the blueprint's numbers for the organisers' terminal only. The
shaft's room on each level is named the same way ("Foyer Stairs", "Back Elevator").

The blueprint and everything derived from it stay out of the repo: the script refuses a --pdf
or --out inside it. `npm run venue:import` loads the JSON into the venue_maps table; in local
development VENUE_DATA_FILE can name the JSON instead. Runs in about two minutes.

Method, per plan:
  * sheets are /Rotate 270: every coordinate goes through page.rotation_matrix, so x/y are the
    sheet as printed (landscape, y down); map units are PDF points (1/8" = 1'-0": 9 per foot,
    measured from the door swings);
  * plans are the framed areas (hairline rectangles) with a level title ("BASEMENT", ...); the
    third sheet has two: the mezzanine strip and the second floor;
  * each plan is moved into the first floor's frame by its column-grid origin marker (the
    circled cross at the building's north-west corner, drawn on every plan); the report lists
    the offsets and how far each shaft's labels spread across levels;
  * architecture = black strokes on pens >= 0.5 (fixtures and furniture are the 0.12-0.24
    pens, kitchen equipment and site work are grey); door swings = circular arcs of 1-5 ft
    (thin or grey arcs only with a leaf line from the hinge); every door is closed by drawing
    both radii of its swing, which also cuts the swing sector off both rooms; gaps between
    collinear wall ends with glazing / a sliding door drawn in them are bridged;
  * the outside is flooded from the plan's border through gaps under 60 units, then big
    unnamed floor bounded by single lines with the outside behind them (a front plaza) joins it;
  * rooms = 4-connected free regions holding a room label (lines above a room number such as
    "123" / "045A"); a region holding several labels is split: a label whose fine-pen room is
    closed (a cry room behind glass, a walk-in cooler) keeps that room, the rest is cut at
    bottlenecks (openings of the region by discs of 20 / 28 / 36 units) and finally by a
    geodesic Voronoi; unnamed pieces over 150 sq ft stay out of every room;
  * big unnamed floor that routes reach becomes "Open Area N" (a foyer, a lower lobby), so an
    event room can be mapped onto it later;
  * outlines are traced on the pixel cracks and simplified (Douglas-Peucker, 1.5 units);
  * walkable = free space with door symbols and hatch removed (doors open), at least CLEAR
    units from any stroke, inside the building, outside back-of-house rooms, sampled on a
    CELL grid; the level's largest component and those holding a landing are kept;
  * stairs / elevators come from their labels ("STAIR. 5", "STAIRS 2", "ELEV. 1", "ELEVATOR",
    UP / DN arrows, X-marked shafts) matched across levels by position; a full floor between
    two served levels with no label there gets the shaft when that spot is in no named room; a
    landing whose floor only reaches back-of-house, staff-only rooms or the private quarters (a
    kitchen-side stair or lift, one inside the residence) is dropped for that level, and that
    level's shaft room becomes a plain block (public: false), not drawn as stairs;
  * a toilet room the blueprint doesn't label (only a fixture count, "N URINAL") is named
    from that note (FIXTURE_NOTES) when no labelled room covers it;
  * every public room (not staff only, not a stair / elevator) lists its door openings on the
    finished delegates' grid (room_doors()): the walkable cells just outside its outline that
    touch walkable cells inside it, 8-connected, each with a stable id "<room id>:<side><n>" (the
    side of the room's box it is on, n / e / s / w, numbered west to east or north to south), its
    middle, its width and the room on the other side. Flow rules (the organisers' flow maps,
    src/lib/venue/flowRules.ts) name doors by these ids; the router finds the same openings on
    the same grid, so no coordinates are needed in a rule;
  * back-of-house (BACK_OF_HOUSE) and private quarters (PRIVATE_QUARTERS: the sadhus' residence,
    the deities' rooms, the altar; with their en-suite baths) are public: false, and so is the
    quarters' own circulation (residence_zone(): a corridor or common area lined with them that
    leads nowhere public but its one way in) with the rooms reached only through it; a stair or
    elevator landing inside them is dropped for that level. report.json lists them all under
    private_quarters (the circulation also under private_quarters_circulation) for the organisers
    to confirm; --public / --private adjust the boundary.

Santos' quarters (the Pujya Santo view, /sant/map): after the delegates' map is finished,
settle_sant() adds what only santos get, without changing anything delegates get (a drift guard
compares every delegate-facing value before and after and exits on any difference):
  * which residence rooms santos may use (classify_sant()): the sadhus' rooms (SANT_QUARTERS names),
    their en-suite baths, and the residence's own circulation with the rooms reached only through it
    (residence_zone() run from the sadhus' rooms alone); never the deities' rooms or the altar
    (DEITY_ROOMS), a back-of-house room by name (unless the residence names it), a --private room.
    Each gets a class: "own" (a sadhu's own room, OWN_QUARTERS, or its en-suite bath: shown to
    santos by the organisers' name, a start and a destination), "way" (corridors, the common area,
    its stair / elevator shafts, and a room that is the only way out of an own room: walkable,
    never named) or "shared" (the rest: walkable, never named). --not-sant <id> keeps a room or
    shaft private for santos too, --sant <id> adds a private room, --sant-class <id>=... sets a
    class;
  * the santos' floor of the level: the walkable grid with those rooms (and the private shafts of
    live stairs / elevators) open. An opening between it and the delegates' floor stays open only
    where a door swing covers it (a glazed partition or a window is sealed); --sant-open
    <santo id>:<id> keeps a pair's opening, --sant-seal seals it. A residence room the sealing cuts
    off, or without an entry, stops the script and says which;
  * a stair / elevator whose landing on a level only opens into the residence lands there for
    santos (`santPoints`), when that landing joins the floor; never a connector of its own.
  JSON: four optional fields, `version` stays 1, so older app builds ignore them and show the
  residence as before: a room's `sant` (class) and `santEntry` (still `public: false`, `entry`
  null), a level's `santGrid` (exactly the grid's frame) and a connector's `santPoints`. The
  report's `sant` key lists the rooms by class, the openings kept / sealed, the landings, the rooms
  left private, any own room reached only through another, and the extra cells; the previews draw
  santo rooms pale violet with a dashed outline and santo landings as hollow squares.
"""

from __future__ import annotations

import argparse
import base64
import heapq
import json
import math
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pymupdf
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi

# ---------------------------------------------------------------------------------------------
# Tunables (map units = PDF points; the drawing is 1/8" = 1'-0", i.e. 9 units per foot).

RASTER = 2.0  # raster pixels per unit
CELL = 9.0  # walkable grid cell (1 ft)
CLEAR = 4.5  # clearance from any stroke for a walkable cell centre (half a foot)
SEAL = 30.0  # the outside is flooded through gaps narrower than 2x this (windows, storefronts)
OPEN_AREA_MIN = 250.0  # sq ft: unnamed floor at least this big becomes an "Open Area N" room
ARCH_MIN_PEN = 0.5  # black strokes at or above this pen are architecture
WALL_MIN_PEN = 0.8  # ... and at or above this one go into the walls path
DOOR_PENS = (0.5, 1.2)  # pens door swings / leaves are drawn with
DOOR_RADIUS = (9.0, 45.0)  # 1 ft .. 5 ft swings
LABEL_RE = re.compile(r"^\d{3}[A-Z]?$")
INLINE_NUMBER_RE = re.compile(r"^(?P<name>.*[A-Z].*?)\s+(?P<num>\d{3}[A-Z]?)$")
STAIR_RE = re.compile(r"^STAIRS?\s*\.?\s*(\d+)\b")
ELEV_RE = re.compile(r"^ELEV(?:ATOR)?\s*\.?\s*(\d+)?$")

LEVELS = {  # title on the sheet -> (id, name, order); bottom to top, the mezzanine on top
    "BASEMENT": ("B", "Basement", 0),
    "FIRST FLOOR": ("1", "First Floor", 1),
    "SECOND FLOOR": ("2", "Second Floor", 2),
    "MEZZANINE": ("M", "Mezzanine", 3),
}
LEVEL_ORDER = {lid: order for lid, _, order in LEVELS.values()}  # "B" -> 0 ... "M" -> 3
REFERENCE_LEVEL = "1"  # the map frame is this plan's (sheet coordinates, rotation undone)
SIDE_AXIS_MIN = 45.0  # units (5 ft): a connector nearer the central axis than this has no side
# The app's rules (src/lib/venue/route.ts: TRACK_SIDE, ELEVATORS_FOLLOW_SIDE), read from there by
# read_app_route_rules() so the previews' sample routes follow a change made there; these values
# are only the fallback when it can't be read. They draw the previews only: the app never reads
# them.
TRACK_SIDE = {"bhaio": "right", "behno": "left"}
ELEVATORS_FOLLOW_SIDE = True
SIDE_ARG_RE = re.compile(r"^(?P<id>(?:stair|elev)-[A-Za-z0-9]+)=(?P<side>left|right|none)$")
PLACE_ARG_RE = re.compile(r"^(?P<id>(?:stair|elev)-[A-Za-z0-9]+)=(?P<place>foyer|side|back|none)$")
CONNECTOR_ID_RE = re.compile(r"^(?:stair|elev)-[A-Za-z0-9]+$")
LANDING_ARG_RE = re.compile(r"^(?P<id>(?:stair|elev)-[A-Za-z0-9]+):(?P<level>[A-Za-z0-9]+)$")
LANDING_PIN_RE = re.compile(r"^(?P<id>(?:stair|elev)-[A-Za-z0-9]+):(?P<level>[A-Za-z0-9]+)=(?P<x>-?\d+(?:\.\d+)?),(?P<y>-?\d+(?:\.\d+)?)$")
LANDING_PIN_REACH = 45.0  # units (5 ft): how far --landing's point may be from a walkable cell
PLACE_CENTRAL = 0.5  # a connector nearer the axis than this share of the building's half width is "foyer"
MERGE_REACH = 45.0  # units (5 ft): --merge closes gaps between the two rooms narrower than twice this
# A fixture count drawn in a room that has no label of its own names the room (pattern on the
# upper-case text -> the room's name, as the blueprint would have written it).
FIXTURE_NOTES = [(re.compile(r"\bURINALS?\b"), "MEN'S TOILET")]
# What a stair / elevator is called for guests: never numbered (the building has no stair signs).
CONNECTOR_NAME = {"stair": "Stairs", "elevator": "Elevator"}
DROPPED_SHAFT_NAME = {"stair": "Staff Stairs", "elevator": "Freight Elevator"}

# Back-of-house: never labelled, searched or routed to (matched on the upper-case name).
BACK_OF_HOUSE = [
    r"\bELEC", r"\bIT\b", r"\bAV\s*/\s*IT\b", r"\bAVIT\b", r"\bAV\.?\s*CL", r"\bAV\.?\s*EQUIP",
    r"\bAUDIO\b", r"\bDATA\b", r"TELECOM", r"SERVER", r"BOILER", r"\bMECH", r"JANITOR",
    r"\bJAN\.?\s*CL", r"CUSTODIAL", r"SHAFT", r"MACHINE", r"STORAGE", r"KITCHEN", r"PANTRY",
    r"UTENSIL", r"GROCERY", r"COOLER", r"FREEZER", r"MAINTENANCE", r"RECORDING", r"\bMEDIA\b",
    r"^WATER$", r"\bTOOL\b", r"WORKSHOP", r"LOADING", r"\bCLOSET\b",
]
# Private quarters: the sadhus' residence (monk rooms, the guru's and priest's quarters, their
# bedrooms), the deities' rooms and the altar platform. Not destinations for delegates, so treated
# like back-of-house (a plain block, never labelled, searched or walked through); a "Bath" numbered
# within two of one of them is its en-suite and goes with it. --public <id> brings one back.
SANT_QUARTERS = [r"^MONK\b", r"^GURU", r"^PRIEST\b", r"^BEDROOM\b"]  # the sadhus' residence
DEITY_ROOMS = [r"^DEIT(?:Y|IES)\b", r"^ALTAR\b"]  # private for everyone, the Pujya Santo view too
PRIVATE_QUARTERS = SANT_QUARTERS + DEITY_ROOMS
# A sadhu's own room in the residence (matched on the tidied name, upper-cased): class "own" in the
# Pujya Santo view (see settle_sant()).
OWN_QUARTERS = [r"^MONK\s+ROOMS?\b", r"^GURU", r"^PRIEST\b", r"^BEDROOMS?\b"]
SANT_CLASSES = ("own", "shared", "way")
# A santo-only cell beside the delegates' floor stays open only where a door swing covers it: its
# centre within the swing's radius plus this of the hinge (one cell).
SANT_SEAM_DOOR_MARGIN = CELL
# The santos' extra floor stays the residence's: a cell of it in no room (a door swing, a nook by a
# stair) lies within this many cells of a residence room, one in a public room within one cell.
SANT_NO_ROOM_REACH = 5
SANT_PAIR_RE = re.compile(r"^(?P<a>[A-Za-z0-9][A-Za-z0-9-]*):(?P<b>[A-Za-z0-9][A-Za-z0-9-]*)$")
SANT_CLASS_ARG_RE = re.compile(r"^(?P<id>[A-Za-z0-9][A-Za-z0-9-]*)=(?P<cls>own|shared|way)$")
# Blueprint spellings tidied for delegates (word -> word).
WORD_FIXES = {"VESTIBLUE": "VESTIBULE", "RM": "ROOM", "LUGG.": "LUGGAGE", "STAIR.": "STAIR",
              "ELEV.": "ELEVATOR", "ELEV": "ELEVATOR", "AVIT": "AV/IT", "AV.": "AV", "JAN.": "JANITOR",
              "JAN": "JANITOR", "CL.": "CLOSET", "CL": "CLOSET", "EQUIP.": "EQUIPMENT"}
ACRONYMS = {"IT", "AV", "ATS", "ADA", "AV/IT", "W/D", "A/V"}

HERE = Path(__file__).resolve()
REPO = HERE.parents[2]
ROUTE_TS = REPO / "src" / "lib" / "venue" / "route.ts"


def read_app_route_rules() -> str:
    """Sets TRACK_SIDE and ELEVATORS_FOLLOW_SIDE from the app's src/lib/venue/route.ts (so
    flipping ELEVATORS_FOLLOW_SIDE there changes the previews too); keeps the fallbacks above for
    any it can't find. Returns a line for the printout."""
    global ELEVATORS_FOLLOW_SIDE
    try:
        src = ROUTE_TS.read_text(encoding="utf-8")
    except OSError:
        return f"app routing rules: {ROUTE_TS} not readable, using this script's copies"
    missing = []
    m = re.search(r'export const TRACK_SIDE\b[^=]*=\s*\{\s*BHAIO:\s*"(left|right)",\s*BEHNO:\s*"(left|right)",?\s*\}', src)
    if m:
        TRACK_SIDE.update({"bhaio": m[1], "behno": m[2]})
    else:
        missing.append("TRACK_SIDE")
    m = re.search(r"export const ELEVATORS_FOLLOW_SIDE\b[^=]*=\s*(true|false)\s*;", src)
    if m:
        ELEVATORS_FOLLOW_SIDE = m[1] == "true"
    else:
        missing.append("ELEVATORS_FOLLOW_SIDE")
    rules = (f"Bhaio {TRACK_SIDE['bhaio']}, Behno {TRACK_SIDE['behno']}, elevators "
             f"{'split the same way' if ELEVATORS_FOLLOW_SIDE else 'shared'}")
    if missing:
        return f"app routing rules ({rules}): {', '.join(missing)} not found in {ROUTE_TS.name}, using this script's copies"
    return f"app routing rules from {ROUTE_TS.name}: {rules}"


# ---------------------------------------------------------------------------------------------
# Small geometry helpers


def perp(v):
    return np.array([-v[1], v[0]])


def bezier(P, n=9):
    t = np.linspace(0.0, 1.0, n)[:, None]
    return ((1 - t) ** 3) * P[0] + 3 * ((1 - t) ** 2) * t * P[1] + 3 * (1 - t) * t * t * P[2] + t ** 3 * P[3]


def douglas_peucker(points: np.ndarray, tol: float) -> np.ndarray:
    n = len(points)
    if n < 3:
        return points
    keep = np.zeros(n, bool)
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        a, b = points[i], points[j]
        seg = b - a
        length = math.hypot(seg[0], seg[1])
        rest = points[i + 1: j] - a
        if length < 1e-9:
            d = np.hypot(rest[:, 0], rest[:, 1])
        else:
            d = np.abs(seg[0] * rest[:, 1] - seg[1] * rest[:, 0]) / length
        k = int(np.argmax(d))
        if d[k] > tol:
            keep[i + 1 + k] = True
            stack.append((i, i + 1 + k))
            stack.append((i + 1 + k, j))
    return points[keep]


def simplify_ring(ring: np.ndarray, tol: float) -> np.ndarray:
    if len(ring) < 4:
        return ring
    far = int(np.argmax(np.hypot(*(ring - ring[0]).T)))
    a = douglas_peucker(np.vstack([ring[: far + 1]]), tol)
    b = douglas_peucker(np.vstack([ring[far:], ring[:1]]), tol)
    return np.vstack([a[:-1], b[:-1]])


def trace_outline(mask: np.ndarray) -> np.ndarray:
    """Outer boundary of the 4-connected component holding the top-left-most pixel of `mask`,
    as pixel-corner coordinates (col, row), clockwise on screen (inside on the right)."""
    rows, cols = np.nonzero(mask)
    if len(rows) == 0:
        return np.zeros((0, 2))
    i = int(np.lexsort((cols, rows))[0])
    r0, c0 = int(rows[i]), int(cols[i])
    H, W = mask.shape

    def inside(r, c):
        return 0 <= r < H and 0 <= c < W and mask[r, c]

    # directions: 0 E, 1 S, 2 W, 3 N  as (drow, dcol)
    D = [(0, 1), (1, 0), (0, -1), (-1, 0)]
    # (ahead-left pixel, ahead-right pixel) offsets from the corner, per direction
    AHEAD = [((-1, 0), (0, 0)), ((0, 0), (0, -1)), ((0, -1), (-1, -1)), ((-1, -1), (-1, 0))]
    r, c, d = r0, c0, 0
    verts = [(c, r)]
    for _ in range(4 * mask.size + 8):
        r += D[d][0]
        c += D[d][1]
        if r == r0 and c == c0 and d == 0:
            break
        (alr, alc), (arr, arc) = AHEAD[d]
        al = inside(r + alr, c + alc)
        ar = inside(r + arr, c + arc)
        if not ar:
            nd = (d + 1) % 4
        elif al:
            nd = (d + 3) % 4
        else:
            nd = d
        if nd != d:
            verts.append((c, r))
            d = nd
        if r == r0 and c == c0 and d == 0:
            break
    return np.array(verts, float)


# ---------------------------------------------------------------------------------------------
# Reading the PDF


class Stroke:
    __slots__ = ("pts", "pen", "grey", "op", "ctrl", "path", "closed", "fill")

    def __init__(self, pts, pen, grey, op, ctrl=None, path=-1, closed=False, fill=False):
        self.pts = pts
        self.pen = pen
        self.grey = grey
        self.op = op
        self.ctrl = ctrl
        self.path = path
        self.closed = closed
        self.fill = fill

    def bbox(self):
        return self.pts.min(axis=0), self.pts.max(axis=0)


class Plan:
    def __init__(self, level, name, order, page_no, area):
        self.level = level
        self.name = name
        self.order = order
        self.page_no = page_no
        self.area = area  # (x0, y0, x1, y1) sheet coordinates
        self.strokes: list[Stroke] = []
        self.lines: list[dict] = []
        self.offset = np.zeros(2)
        self.marker = None


def read_sheet(page):
    """All strokes / fills and text lines of a page, in sheet coordinates (rotation undone)."""
    m = page.rotation_matrix
    strokes = []
    for pi, d in enumerate(page.get_drawings()):
        pen = round(float(d.get("width") or 0.0), 2)
        col = d.get("color") or d.get("fill") or (0, 0, 0)
        grey = bool(col and max(col) > 0.1)
        is_fill = d.get("type") in ("f", "fs")
        for it in d["items"]:
            op = it[0]
            if op == "l":
                a, b = it[1] * m, it[2] * m
                pts = np.array([[a.x, a.y], [b.x, b.y]])
                strokes.append(Stroke(pts, pen, grey, "l", path=pi, fill=is_fill))
            elif op == "c":
                P = np.array([[q.x, q.y] for q in (it[1] * m, it[2] * m, it[3] * m, it[4] * m)])
                strokes.append(Stroke(bezier(P), pen, grey, "c", ctrl=P, path=pi, fill=is_fill))
            elif op in ("re", "qu"):
                q = it[1].quad if op == "re" else it[1]
                q = q * m
                pts = np.array([[q.ul.x, q.ul.y], [q.ur.x, q.ur.y], [q.lr.x, q.lr.y], [q.ll.x, q.ll.y], [q.ul.x, q.ul.y]])
                strokes.append(Stroke(pts, pen, grey, "q", path=pi, closed=True, fill=is_fill))
    lines = []
    seen = set()
    for b in page.get_text("dict")["blocks"]:
        if b.get("type") != 0:
            continue
        for ln in b["lines"]:
            text = "".join(s["text"] for s in ln["spans"]).strip()
            if not text:
                continue
            r = pymupdf.Rect(ln["bbox"]) * m
            key = (text, round(r.x0), round(r.y0))
            if key in seen:  # the third sheet draws some labels twice
                continue
            seen.add(key)
            dx, dy = ln["dir"]
            u = np.array([dx * m.a + dy * m.c, dx * m.b + dy * m.d])
            u = u / (np.linalg.norm(u) or 1.0)
            size = max(float(s["size"]) for s in ln["spans"])
            lines.append({"text": text, "bbox": (r.x0, r.y0, r.x1, r.y1), "u": u, "size": size})
    return strokes, lines


def find_plans(doc) -> list[Plan]:
    plans = []
    for page in doc:
        strokes, lines = read_sheet(page)
        # frames: hairline rectangles of plan size; drop any that contains another frame
        frames = []
        for s in strokes:
            if s.pen == 0 and s.op == "q" and not s.fill:
                (x0, y0), (x1, y1) = s.bbox()
                if x1 - x0 > 1000 and y1 - y0 > 300:
                    frames.append((x0, y0, x1, y1))
        frames = sorted(set(tuple(round(v, 1) for v in f) for f in frames))
        inner = [f for f in frames if not any(g != f and f[0] <= g[0] and f[1] <= g[1] and f[2] >= g[2] and f[3] >= g[3] for g in frames)]
        if not inner:
            r = page.rect
            inner = [(r.x0, r.y0, r.x1, r.y1)]
        for f in inner:
            titles = [ln for ln in lines if ln["size"] > 40 and ln["text"].upper() in LEVELS and f[0] <= ln["bbox"][0] and ln["bbox"][2] <= f[2] and f[1] <= ln["bbox"][1] and ln["bbox"][3] <= f[3]]
            if not titles:
                print(f"  sheet {page.number + 1}: a framed area without a level title, skipped", file=sys.stderr)
                continue
            lid, lname, order = LEVELS[titles[0]["text"].upper()]
            plan = Plan(lid, lname, order, page.number, f)
            pad = 1.0
            for s in strokes:
                (x0, y0), (x1, y1) = s.bbox()
                if s.pen == 0 and s.op == "q" and (x1 - x0) > 1000:
                    continue  # the frame itself
                if x0 >= f[0] + pad and y0 >= f[1] + pad and x1 <= f[2] - pad and y1 <= f[3] - pad:
                    plan.strokes.append(s)
            for ln in lines:
                x0, y0, x1, y1 = ln["bbox"]
                if ln["size"] > 40:
                    continue
                if f[0] <= x0 and x1 <= f[2] and f[1] <= y0 and y1 <= f[3]:
                    plan.lines.append(ln)
            plans.append(plan)
    plans.sort(key=lambda p: p.order)
    return plans


def find_grid_marker(plan: Plan):
    """The column-grid origin marker: a black circle (pen ~1, 8-10 units across) with a
    horizontal and a vertical line through its centre. Top-left-most one wins."""
    by_path = defaultdict(list)
    for s in plan.strokes:
        by_path[s.path].append(s)
    circles = []
    for items in by_path.values():
        if len(items) >= 4 and all(s.op == "c" and not s.grey for s in items):
            pts = np.vstack([s.pts for s in items])
            lo, hi = pts.min(axis=0), pts.max(axis=0)
            w, h = hi - lo
            if 6 <= w <= 14 and abs(w - h) < 1:
                circles.append(((lo + hi) / 2, w / 2))
    found = []
    for c, r in circles:
        hor = ver = False
        for s in plan.strokes:
            if s.op != "l" or s.grey:
                continue
            a, b = s.pts
            mid = (a + b) / 2
            length = float(np.hypot(*(b - a)))
            if length < 2 * r + 10 or np.hypot(*(mid - c)) > 3:
                continue
            if abs(a[1] - b[1]) < 0.5:
                hor = True
            elif abs(a[0] - b[0]) < 0.5:
                ver = True
        if hor and ver:
            found.append(c)
    if not found:
        return None
    return min(found, key=lambda c: c[0] + c[1])


# ---------------------------------------------------------------------------------------------
# Labels


def group_labels(plan: Plan):
    """Room labels: name lines stacked above a room number (or "NAME 301" on one line), plus
    stair / elevator names and UP/DN arrows. Coordinates in map units."""
    lines = []
    for ln in plan.lines:
        x0, y0, x1, y1 = ln["bbox"]
        c = np.array([(x0 + x1) / 2, (y0 + y1) / 2]) + plan.offset
        u = ln["u"]
        v = np.array([-u[1], u[0]])  # the next line's direction
        half_len = abs(((x1 - x0) * u[0] + (y1 - y0) * u[1])) / 2
        lines.append({**ln, "c": c, "v": v, "cu": float(c @ u), "cv": float(c @ v), "half": half_len, "used": False,
                      "box": np.array([x0, y0, x1, y1]) + np.tile(plan.offset, 2)})

    def above(line):
        """The line directly above `line` in the same label block."""
        best, best_d = None, None
        for o in lines:
            if o is line or o["used"]:
                continue
            if abs(o["size"] - line["size"]) > 0.6 or float(o["u"] @ line["u"]) < 0.99:
                continue
            dv = line["cv"] - o["cv"]
            if not (0.6 * line["size"] <= dv <= 1.9 * line["size"]):
                continue
            if abs(o["cu"] - line["cu"]) > max(o["half"], line["half"]) + 2:
                continue
            if best is None or dv < best_d:
                best, best_d = o, dv
        return best

    labels = []
    for ln in lines:
        text = ln["text"].upper().strip()
        num = None
        name_parts = []
        if LABEL_RE.match(text):
            num = text
        else:
            mm = INLINE_NUMBER_RE.match(text)
            if mm and not STAIR_RE.match(text) and not ELEV_RE.match(text):
                num = mm.group("num")
                name_parts = [mm.group("name")]
        if num is None:
            continue
        ln["used"] = True
        block = [ln]
        cur = ln
        for _ in range(4):
            o = above(cur)
            if o is None:
                break
            o["used"] = True
            block.append(o)
            cur = o
        names = [o["text"].upper().strip() for o in reversed(block[1:])] + name_parts
        name = " ".join(names).strip()
        if not name:
            continue
        boxes = np.array([o["box"] for o in block])
        box = np.array([boxes[:, 0].min(), boxes[:, 1].min(), boxes[:, 2].max(), boxes[:, 3].max()])
        labels.append({"kind": "room", "number": num, "raw": name, "anchor": ln["c"], "center": (box[:2] + box[2:]) / 2,
                       "box": box, "size": ln["size"]})
    # stairs / elevators and arrows (not room-numbered)
    for ln in lines:
        if ln["used"]:
            continue
        text = ln["text"].upper().strip()
        ms = STAIR_RE.match(text)
        me = ELEV_RE.match(text)
        if ms:
            labels.append({"kind": "stair", "number": ms.group(1), "raw": f"STAIR {ms.group(1)}", "anchor": ln["c"], "center": ln["c"], "box": ln["box"], "size": ln["size"]})
        elif me:
            labels.append({"kind": "elevator", "number": me.group(1), "raw": f"ELEVATOR {me.group(1)}" if me.group(1) else "ELEVATOR", "anchor": ln["c"], "center": ln["c"], "box": ln["box"], "size": ln["size"]})
        elif text in ("UP", "DN"):
            labels.append({"kind": "arrow", "number": None, "raw": text, "anchor": ln["c"], "center": ln["c"], "box": ln["box"], "size": ln["size"]})
        elif ln["size"] < 20 and re.match(r"^[A-Z][A-Z .'&/()-]{2,}$", text) and re.search(r"CLOSET|PANTRY|STORAGE|OFFICE|\bROOM\b|\bBATH|LOBBY|\bHALL\b", text) and text != "ROOM":
            # an unnumbered room name (CLOSET, PANTRY, ...): kept as a room without a number
            labels.append({"kind": "named", "number": None, "raw": text, "anchor": ln["c"], "center": ln["c"], "box": ln["box"], "size": ln["size"]})
        else:
            # a fixture count ("N URINAL"): names its room when the blueprint gives it no label
            for pat, raw in FIXTURE_NOTES:
                if pat.search(text):
                    labels.append({"kind": "named", "number": None, "raw": raw, "anchor": ln["c"], "center": ln["c"],
                                   "box": ln["box"], "size": ln["size"], "note": text})
                    break
    return labels


def tidy_name(raw: str) -> str:
    words = []
    for w in raw.split():
        w = WORD_FIXES.get(w, w)
        words.append(w)
    out = []
    for w in " ".join(words).split():
        if w in ACRONYMS:
            out.append(w)
            continue
        s = w.lower()
        chars = list(s)
        start = True
        for i, ch in enumerate(chars):
            if ch.isalpha():
                if start:
                    chars[i] = ch.upper()
                start = False
            elif ch in "(-/&":
                start = True
        out.append("".join(chars))
    return " ".join(out)


def kind_for(raw: str) -> str:
    n = raw.upper()
    if re.search(r"\bSTAIRS?\b|\bSTAIR\.", n):
        return "stair"
    if re.search(r"\bELEV", n) and "MACHINE" not in n:
        return "elevator"
    if "CORRIDOR" in n:
        return "corridor"
    if re.search(r"LOBBY|FOYER|WAITING|COMMON AREA", n):  # FOYER: the organisers' word (--name)
        return "lobby"
    if re.search(r"VESTIB|\bEXIT\b", n):
        return "exit"
    if re.search(r"TOILET|BATHROOM|RESTROOM|\bBATH\b|URINAL", n) and "UTENSIL" not in n:
        return "restroom"
    if re.search(r"DINING|FOOD SHOP|CAFE", n):
        return "dining"
    if re.search(r"HALL\b|\bGYM\b|MULTI PURPOSE|\bSTAGE\b|ASSEMBLY", n):
        return "hall"
    return "room"


def is_back_of_house(raw: str) -> bool:
    n = raw.upper()
    return any(re.search(p, n) for p in BACK_OF_HOUSE)


def is_private_quarters(raw: str) -> bool:
    n = raw.upper().strip()
    return any(re.search(p, n) for p in PRIVATE_QUARTERS)


def is_sant_quarters(raw: str) -> bool:
    """The sadhus' residence by the blueprint's name (not the deities' rooms or the altar)."""
    n = raw.upper().strip()
    return any(re.search(p, n) for p in SANT_QUARTERS)


def is_deity_room(raw: str) -> bool:
    """The deities' rooms and the altar: private for everyone, never in the Pujya Santo view."""
    n = raw.upper().strip()
    return any(re.search(p, n) for p in DEITY_ROOMS)


def is_own_quarters(name: str) -> bool:
    """A sadhu's own room (on the tidied name: "Monk Room", "Guru's Room", "Bedroom")."""
    n = name.upper().strip()
    return any(re.search(p, n) for p in OWN_QUARTERS)


def residence_zone(rooms, openings, quarters_ids, overrides) -> list[str]:
    """The private quarters' own circulation, and the rooms reached only through it: made
    public: false like the quarters, so they are never labelled, searched or walked through, and a
    stair / elevator landing inside them is dropped (main() drops a landing cut off from the
    level's floor). `openings` = opening_graph(). Returns the ids it made private.

    A corridor or common area is part of the quarters when at least two quarters rooms open onto
    it, they outnumber the public rooms that do, and it leads on to at most one other public room
    (the way in) apart from rooms that open onto nothing else: a cul-de-sac lined with the
    quarters, not a passage between public corridors. A public room whose every opening leads into
    the quarters or back-of-house is part of them. Stairs and elevators are never made private
    (their room keeps its name, without directions); --public <id> keeps any room out of the zone.
    """
    quarters = set(quarters_ids)
    zone = {i for i, rm in enumerate(rooms) if rm["id"] in quarters}

    def is_conn(i):
        return rooms[i]["kind"] in ("stair", "elevator")

    def is_circ(i):
        return rooms[i]["kind"] in ("corridor", "lobby") or bool(rooms[i].get("_open"))

    def public_neighbours(i, but=None):
        return [j for j in openings.get(i, {})
                if j not in zone and j != but and rooms[j]["public"] and not is_conn(j)]

    added = []
    changed = True
    while changed:
        changed = False
        for i, rm in enumerate(rooms):
            if i in zone or not rm["public"] or is_conn(i) or rm["id"] in overrides["public"]:
                continue
            inside = [j for j in openings.get(i, {}) if j in zone]
            outside = public_neighbours(i)
            if is_circ(i):
                ways_on = [j for j in outside if is_circ(j) or public_neighbours(j, but=i)]
                private = len(inside) >= 2 and len(inside) > len(outside) and len(ways_on) <= 1
            else:
                private = bool(inside) and not outside
            if private:
                zone.add(i)
                rm["public"] = False
                added.append(rm["id"])
                changed = True
    return added


def classify_sant(t, overrides):
    """The sadhus' residence rooms the Pujya Santo view shows (and may route through), by class:
    rm["_sant"] = "own" (a sadhu's own room: OWN_QUARTERS, or the en-suite bath of one), "way"
    (the residence's corridors and common area; settle_sant() adds its stair / elevator shafts) or
    "shared" (any other room of it). A shared room that is the only way out of an own room is
    "way" (t.sant_auto_way). Never a public room, the deities' rooms or the altar, a back-of-house
    room by name (unless its name is a residence one too, SANT_QUARTERS), a --private or --not-sant
    room; --sant adds one, --sant-class sets one's class. Never changes `public`: delegates' rooms
    are as before. Runs at the end of build_level()."""
    rooms = t.rooms
    for rm in rooms:
        rm.pop("_sant", None)
    t.sant_applied = {"sant": set(), "not_sant": set(), "sant_class": set()}
    seed = [i for i, rm in enumerate(rooms) if not rm["public"] and not rm["_conn"] and is_sant_quarters(rm["raw"])]
    seed_numbers = [room_number_value(rooms[i]["number"]) for i in seed]
    own_seed_numbers = [room_number_value(rooms[i]["number"]) for i in seed if is_own_quarters(rooms[i]["name"])]
    public_numbers = {rm["number"] for rm in rooms if rm["public"] and rm["number"]}
    private_q = set(t.private_quarters)

    def ensuite_of(rm, numbers):
        """A "Bath" numbered within two of one of `numbers` (not the "195B" of a public room "195")."""
        n = room_number_value(rm["number"])
        owner = re.match(r"^(\d+)[A-Z]$", rm["number"] or "")
        if n is None or (owner and owner.group(1) in public_numbers):
            return False
        return bool(re.fullmatch(r"BATH", rm["raw"].upper().strip())) and any(q is not None and abs(n - q) <= 2 for q in numbers)

    ensuite = [i for i, rm in enumerate(rooms) if rm["id"] in private_q and not rm["_conn"] and ensuite_of(rm, seed_numbers)]
    # the residence's own circulation as residence_zone() finds it from the sadhus' rooms alone (the
    # deities' rooms left out), on copies with the delegates' residence flips undone
    residence = set(t.residence)
    copies = [dict(rm, public=bool(rm["public"] or rm["id"] in residence)) for rm in rooms]
    zone_ids = set(residence_zone(copies, t.openings, [rooms[i]["id"] for i in seed], overrides)) & residence
    zone = [i for i, rm in enumerate(rooms) if rm["id"] in zone_ids]
    candidates = set(seed) | set(ensuite) | set(zone)
    by_id = {rm["id"]: i for i, rm in enumerate(rooms)}
    for i in sorted(candidates):
        rm = rooms[i]
        if (rm["public"] or is_deity_room(rm["raw"]) or (is_back_of_house(rm["raw"]) and not is_sant_quarters(rm["raw"]))
                or rm["id"] in overrides["private"]):
            candidates.discard(i)
        elif rm["id"] in overrides["not_sant"]:
            candidates.discard(i)
            t.sant_applied["not_sant"].add(rm["id"])
    for rid in overrides["sant"]:
        i = by_id.get(rid)
        if i is None:
            continue  # on another level (settle_sant() stops when no level has it)
        rm = rooms[i]
        why = ("a public room" if rm["public"] else "a stair / elevator" if rm["_conn"] else
               "a deity room or the altar" if is_deity_room(rm["raw"]) else
               "given with --public / --private / --closed" if rid in overrides["public"] | overrides["private"] | overrides["closed"]
               else None)
        if why:
            sys.exit(f"--sant {rid}: {why}; only a private room of the residence can be shown to santos")
        candidates.add(i)
        t.sant_applied["sant"].add(rid)
    ensuite_set = set(ensuite)
    for i in candidates:
        rm = rooms[i]
        if is_own_quarters(rm["name"]) or (i in ensuite_set and ensuite_of(rm, own_seed_numbers)):
            rm["_sant"] = "own"
        elif rm["kind"] in ("corridor", "lobby", "exit"):
            rm["_sant"] = "way"
        else:
            rm["_sant"] = "shared"
    # a shared room that is the only way out of a sadhu's own room is a way (never a destination)
    t.sant_auto_way = []
    for i in candidates:
        if rooms[i]["_sant"] != "own":
            continue
        outs = {j for j in t.openings.get(i, {})
                if rooms[j].get("_sant") != "own" and not (not rooms[j]["public"] and j not in candidates)}
        if len(outs) == 1:
            (j,) = outs
            if j in candidates and rooms[j]["_sant"] == "shared":
                rooms[j]["_sant"] = "way"
                t.sant_auto_way.append(f"{rooms[j]['id']} (the only way out of {rooms[i]['id']})")
    for rid, cls in overrides["sant_class"].items():
        i = by_id.get(rid)
        if i is None:
            continue
        if i not in candidates:
            sys.exit(f"--sant-class {rid}={cls}: {rid} is not a room the Pujya Santo view shows (see --sant / --not-sant)")
        rooms[i]["_sant"] = cls
        t.sant_applied["sant_class"].add(rid)
    for i, rm in enumerate(rooms):
        if i not in candidates:
            rm.pop("_sant", None)
    # for the report: residence rooms left private for santos too, and back-of-house rooms opening into the residence
    left = [rooms[i]["id"] for i in zone if i not in candidates]
    left += [rm["id"] for i, rm in enumerate(rooms)
             if i not in candidates and not rm["public"] and not rm["_conn"] and rm["id"] not in left
             and (is_deity_room(rm["raw"]) and rm["id"] in private_q
                  or any(j in candidates for j in t.openings.get(i, {})))]
    t.sant_left_private = sorted(left)


def room_number_value(number) -> int | None:
    m = re.match(r"^(\d+)", number or "")
    return int(m.group(1)) if m else None


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


# ---------------------------------------------------------------------------------------------
# Rasters


class Canvas:
    """A raster over a plan's area in map units."""

    def __init__(self, x0, y0, x1, y1):
        self.x0, self.y0 = float(x0), float(y0)
        self.W = int(math.ceil((x1 - x0) * RASTER)) + 1
        self.H = int(math.ceil((y1 - y0) * RASTER)) + 1

    def px(self, pts):
        return (np.asarray(pts, float) - [self.x0, self.y0]) * RASTER

    def map(self, cols, rows):
        return np.stack([self.x0 + np.asarray(cols, float) / RASTER, self.y0 + np.asarray(rows, float) / RASTER], axis=-1)

    def draw(self, strokes, extra_lines=()):
        img = Image.new("1", (self.W, self.H), 0)
        dr = ImageDraw.Draw(img)
        for s in strokes:
            p = self.px(s.pts)
            if s.fill and s.closed:
                dr.polygon([tuple(q) for q in p], fill=1, outline=1)
            elif s.fill:
                dr.polygon([tuple(q) for q in p], fill=1, outline=1) if len(p) > 2 else None
            w = max(1, int(round(s.pen * RASTER)))
            dr.line([tuple(q) for q in p], fill=1, width=w)
        for a, b, pen in extra_lines:
            w = max(1, int(round(pen * RASTER)))
            dr.line([tuple(self.px(a)), tuple(self.px(b))], fill=1, width=w)
        return np.array(img, dtype=bool)

    def pixel(self, pt):
        c, r = self.px(pt)
        return int(round(r)), int(round(c))

    def inside(self, r, c):
        return 0 <= r < self.H and 0 <= c < self.W


def segments_of(strokes):
    """Every straight piece (lines and rectangle edges) as arrays a, b."""
    a, b = [], []
    for s in strokes:
        if s.op == "c" or s.fill:
            continue
        a.append(s.pts[:-1])
        b.append(s.pts[1:])
    return np.vstack(a), np.vstack(b)


def detect_doors(all_strokes):
    """Door swings: circular arcs of 1-5 ft radius sweeping 20-135 degrees. Arcs on the door
    pens (black, 0.5-1.2) count as they are; thin or grey arcs (some sheets draw doors with the
    fixture pen) only with a leaf: a straight piece from the hinge, as long as the radius, along
    one end of the arc. Returns the hinge, radius, both ends and the swept angle per arc."""
    from scipy.spatial import cKDTree

    sa, sb = segments_of(all_strokes)
    tree = cKDTree(np.vstack([sa, sb]))
    nseg = len(sa)
    doors = []
    for s in all_strokes:
        if s.op != "c" or s.fill or s.pen > DOOR_PENS[1]:
            continue
        P0, P1, P2, P3 = s.ctrl
        t0, t3 = P1 - P0, P3 - P2
        if np.hypot(*t0) < 1e-6 or np.hypot(*t3) < 1e-6:
            continue
        n0, n3 = perp(t0), perp(t3)
        A = np.array([n0, -n3]).T
        if abs(np.linalg.det(A)) < 1e-9:
            continue
        a, _ = np.linalg.solve(A, P3 - P0)
        C = P0 + a * n0
        r0, r3 = np.hypot(*(P0 - C)), np.hypot(*(P3 - C))
        r = (r0 + r3) / 2
        if abs(r0 - r3) > 0.12 * r or not (DOOR_RADIUS[0] <= r <= DOOR_RADIUS[1]):
            continue
        mid = s.pts[len(s.pts) // 2]
        if abs(np.hypot(*(mid - C)) - r) > 0.12 * r:
            continue
        th0 = math.atan2(*(P0 - C)[::-1])
        th3 = math.atan2(*(P3 - C)[::-1])
        thm = math.atan2(*(mid - C)[::-1])
        sweep = (th3 - th0 + math.pi) % (2 * math.pi) - math.pi
        half = (thm - th0 + math.pi) % (2 * math.pi) - math.pi
        if half * sweep < 0:
            sweep = sweep - math.copysign(2 * math.pi, sweep)
        if not (math.radians(20) <= abs(sweep) <= math.radians(135)):
            continue
        strong = (not s.grey) and s.pen >= DOOR_PENS[0]
        if not strong:
            leaf = False
            for k in tree.query_ball_point(C, 2.0):
                i = k % nseg
                other = sb[i] if k < nseg else sa[i]
                v = other - C
                length = np.hypot(*v)
                if not (0.8 * r <= length <= 1.15 * r):
                    continue
                for end in (P0, P3):
                    e = end - C
                    if float(v @ e) / (length * np.hypot(*e)) > 0.985:
                        leaf = True
                if leaf:
                    break
            if not leaf:
                continue
        doors.append({"hinge": C, "r": r, "p0": P0, "p3": P3, "th0": th0, "sweep": sweep, "stroke": s,
                      "thin": not strong})
    return doors


def bridge_gaps(arch, all_strokes, max_gap=80.0, thin=False, roi=None):
    """Gaps between collinear wall ends that something is drawn in (a sliding door, glazing,
    a window, a storefront): returned as segments that close them for room outlines only.
    thin=True bridges the fixture-pen lines instead (a walk-in cooler's panels), only inside
    the boxes `roi` [(x0, y0, x1, y1)]."""
    from scipy.spatial import cKDTree

    if thin:
        walls = [s for s in all_strokes if not s.fill and s.op != "c" and 0 < s.pen < 1.0]
    else:
        walls = [s for s in arch if not s.fill and s.op != "c" and s.pen >= 1.0]
    if not walls:
        return []
    A, B = segments_of(walls)
    L = np.hypot(*(B - A).T)
    ok = L >= (8.0 if thin else 2.0)
    A, B, L = A[ok], B[ok], L[ok]
    U = (B - A) / L[:, None]
    E = np.vstack([A, B])
    D = np.vstack([-U, U])
    seg = np.concatenate([np.arange(len(A))] * 2)
    active = np.ones(len(E), bool)
    if roi is not None:
        active[:] = False
        for x0, y0, x1, y1 in roi:
            active |= (E[:, 0] >= x0) & (E[:, 0] <= x1) & (E[:, 1] >= y0) & (E[:, 1] <= y1)
    if not active.any():
        return []
    tree = cKDTree(E)
    # evidence: every other straight piece, cut into chunks of at most 16 units
    ev = [s for s in all_strokes if not s.fill and s.op != "c" and (thin or s.grey or s.pen < 1.0)]
    EA, EB = segments_of(ev)
    n = np.maximum(1, np.ceil(np.hypot(*(EB - EA).T) / 16.0)).astype(int)
    idx = np.repeat(np.arange(len(EA)), n)
    k = np.concatenate([np.arange(m) for m in n])
    f0 = (k / n[idx])[:, None]
    f1 = ((k + 1) / n[idx])[:, None]
    EA, EB = EA[idx] + (EB[idx] - EA[idx]) * f0, EA[idx] + (EB[idx] - EA[idx]) * f1
    etree = cKDTree((EA + EB) / 2)
    bridges, seen = [], set()
    for i in np.nonzero(active)[0]:
        e, d = E[i], D[i]
        best = None
        for j in tree.query_ball_point(e, max_gap):
            if seg[j] == seg[i]:
                continue
            v = E[j] - e
            along = float(v @ d)
            if along < 6.0 or abs(v[0] * d[1] - v[1] * d[0]) > 1.0 or float(D[j] @ d) > -0.999:
                continue
            if best is None or along < best[0]:
                best = (along, j)
        if best is None:
            continue
        along, j = best
        key = (min(i, j), max(i, j))
        if key in seen:
            continue
        seen.add(key)
        mid = (e + E[j]) / 2
        spans = []
        for q in etree.query_ball_point(mid, along / 2 + 9.0):
            a, b = EA[q], EB[q]
            da = abs((a - e)[0] * d[1] - (a - e)[1] * d[0])
            db = abs((b - e)[0] * d[1] - (b - e)[1] * d[0])
            if da > 8.0 or db > 8.0:
                continue
            ta, tb = sorted((float((a - e) @ d), float((b - e) @ d)))
            ta, tb = max(ta, 0.0), min(tb, along)
            if tb > ta:
                spans.append((ta, tb))
        spans.sort()
        covered, cur_a, cur_b = 0.0, None, None
        for ta, tb in spans:
            if cur_b is None or ta > cur_b:
                if cur_b is not None:
                    covered += cur_b - cur_a
                cur_a, cur_b = ta, tb
            else:
                cur_b = max(cur_b, tb)
        if cur_b is not None:
            covered += cur_b - cur_a
        if covered >= 0.5 * along:
            bridges.append((e.copy(), E[j].copy(), 1.0))
    return bridges


def door_parts(strokes, doors):
    """Strokes that belong to a door symbol (swing arc, leaf, frame bits inside the swing)."""
    parts = set()
    if not doors:
        return parts
    hinges = np.array([d["hinge"] for d in doors])
    for i, s in enumerate(strokes):
        if s.grey or not (DOOR_PENS[0] <= s.pen <= DOOR_PENS[1]):
            continue
        lo, hi = s.bbox()
        cand = np.nonzero((hinges[:, 0] > lo[0] - DOOR_RADIUS[1]) & (hinges[:, 0] < hi[0] + DOOR_RADIUS[1]) &
                          (hinges[:, 1] > lo[1] - DOOR_RADIUS[1]) & (hinges[:, 1] < hi[1] + DOOR_RADIUS[1]))[0]
        for k in cand:
            d = doors[k]
            v = s.pts - d["hinge"]
            dist = np.hypot(v[:, 0], v[:, 1])
            if np.any(dist > d["r"] * 1.1 + 0.5):
                continue
            ang = np.arctan2(v[:, 1], v[:, 0])
            rel = (ang - d["th0"]) * math.copysign(1, d["sweep"])
            rel = (rel + math.radians(10)) % (2 * math.pi) - math.radians(10)
            ok = (dist < 2.0) | ((rel >= -math.radians(10)) & (rel <= abs(d["sweep"]) + math.radians(10)))
            if np.all(ok):
                parts.add(i)
                break
    return parts


def edt_free(mask):
    """Distance (px) from each True pixel to the nearest False pixel."""
    return ndi.distance_transform_edt(mask)


FOUR = np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]], bool)

OPENING_MIN_PX = 12  # shared walkable edge (raster px) for two rooms to count as opening onto each other


def opening_graph(room_raster, free):
    """Which rooms open onto which: {room index: {room index: shared walkable edge in px}}.

    Walkable = `free` (doors open, every room walkable) at least CLEAR from any stroke; a
    walkable pixel in no room (a door's swing, a nook) belongs to the nearest room, so two
    rooms joined through a doorway share an edge there and rooms split by a wall share none."""
    walk = edt_free(free) >= CLEAR * RASTER
    ir, ic = ndi.distance_transform_edt(room_raster < 0, return_distances=False, return_indices=True)
    filled = room_raster[ir, ic]
    del ir, ic
    filled[~walk] = -1
    graph: dict[int, dict[int, int]] = defaultdict(dict)
    for a, b in ((filled[:, :-1], filled[:, 1:]), (filled[:-1, :], filled[1:, :])):
        m = (a >= 0) & (b >= 0) & (a != b)
        lo = np.minimum(a[m], b[m]).astype(np.int64)
        hi = np.maximum(a[m], b[m]).astype(np.int64)
        keys, counts = np.unique(lo * 1_000_000 + hi, return_counts=True)
        for key, n in zip(keys.tolist(), counts.tolist()):
            i, j = divmod(key, 1_000_000)
            graph[i][j] = graph[i].get(j, 0) + n
            graph[j][i] = graph[j].get(i, 0) + n
    return {i: {j: n for j, n in nb.items() if n >= OPENING_MIN_PX} for i, nb in graph.items()}


# ---------------------------------------------------------------------------------------------
# One level


SPLIT_RHOS = (20.0, 28.0, 36.0)  # passages narrower than 2x this are cuts between rooms
SEEDLESS_KEEP = 150.0  # sq ft: a seedless piece at least this big is left out of every room
EIGHT = np.ones((3, 3), bool)


def geodesic_voronoi(mask, seeds):
    """Label each pixel of `mask` with the seed (1-based) nearest along paths inside it."""
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import dijkstra

    H, W = mask.shape
    idx = np.full(mask.shape, -1, np.int64)
    nodes = np.flatnonzero(mask)
    idx.flat[nodes] = np.arange(len(nodes))
    ii, jj, ww = [], [], []
    for dr, dc, w in ((0, 1, 1.0), (1, 0, 1.0), (1, 1, 1.4142), (1, -1, 1.4142)):
        c0, c1 = (0, W - dc) if dc >= 0 else (-dc, W)
        both = mask[0: H - dr, c0: c1] & mask[dr: H, c0 + dc: c1 + dc]
        ra, ca = np.nonzero(both)
        ca = ca + c0
        ii.append(idx[ra, ca])
        jj.append(idx[ra + dr, ca + dc])
        ww.append(np.full(len(ra), w))
    ii, jj, ww = np.concatenate(ii), np.concatenate(jj), np.concatenate(ww)
    G = coo_matrix((ww, (ii, jj)), shape=(len(nodes), len(nodes))).tocsr()
    src = np.array([int(idx[r, c]) for _, r, c in seeds])
    label_of = np.zeros(len(nodes), np.int32)
    label_of[src] = [k for k, _, _ in seeds]
    _, _, sources = dijkstra(G, directed=False, indices=src, min_only=True, return_predecessors=True)
    out = np.zeros(mask.shape, np.int32)
    out.flat[nodes] = np.where(sources >= 0, label_of[np.clip(sources, 0, None)], 0)
    return out


def decompose(mask, seeds, rhos, px_per_unit):
    """Split a free region at its bottlenecks. `seeds` = [(label, r, c)]. Pieces = the region's
    morphological opening by a disc of radius rho, one per core, plus the narrow leftovers.
    A piece with one seed is that room; with several, recurse with a wider rho, finally a
    geodesic Voronoi; seedless pieces join their neighbours when small, else stay unlabeled
    (-1). Returns int32 labels over `mask`."""
    out = np.zeros(mask.shape, np.int32)
    rho = rhos[0] * px_per_unit
    d = edt_free(mask)
    core = d >= rho
    core_lab, n = ndi.label(core, EIGHT)
    if n == 0:
        piece, npieces = ndi.label(mask, FOUR)
    else:
        dd, (ir, ic) = ndi.distance_transform_edt(~core, return_indices=True)
        opened = (dd <= rho) & mask
        piece = np.where(opened, core_lab[ir, ic], 0).astype(np.int32)
        del dd, ir, ic
        resid = mask & ~opened
        res_lab, m = ndi.label(resid, FOUR)
        piece[resid] = n + res_lab[resid]
        npieces = n + m
    by_piece = defaultdict(list)
    for sd in seeds:
        k, r, c = sd
        p = int(piece[r, c])
        if p == 0:
            continue
        by_piece[p].append(sd)
    objs = ndi.find_objects(piece)
    area_px = np.bincount(piece.ravel(), minlength=npieces + 1)
    keep_px = SEEDLESS_KEEP * 81.0 * px_per_unit ** 2
    for p in range(1, npieces + 1):
        sl = objs[p - 1]
        if sl is None:
            continue
        pm = piece[sl] == p
        ss = by_piece.get(p, [])
        view = out[sl]
        if len(ss) == 1:
            view[pm] = ss[0][0]
        elif len(ss) > 1:
            local = [(k, r - sl[0].start, c - sl[1].start) for k, r, c in ss]
            if len(rhos) > 1:
                sub = decompose(pm, local, rhos[1:], px_per_unit)
            else:
                sub = geodesic_voronoi(pm, local)
            view[pm] = sub[pm]
        elif area_px[p] >= keep_px:
            view[pm] = -1
    zero = mask & (out == 0)
    if zero.any() and (out > 0).any():
        _, (ir, ic) = ndi.distance_transform_edt(~(out > 0), return_indices=True)
        out[zero] = out[ir[zero], ic[zero]]
    return out


def split_region(reg, seeds):
    """Rooms of one free region: `seeds` = [(label, r, c)] at full raster resolution. Works at
    1 px per unit; returns full-resolution labels (0 = in no room)."""
    f = int(RASTER)
    small = reg[::f, ::f]
    ss = []
    for k, r, c in seeds:
        r2, c2 = min(r // f, small.shape[0] - 1), min(c // f, small.shape[1] - 1)
        if not small[r2, c2]:
            rr, cc = np.nonzero(small[max(0, r2 - 6): r2 + 7, max(0, c2 - 6): c2 + 7])
            if len(rr) == 0:
                continue
            j = int(np.argmin((rr + max(0, r2 - 6) - r2) ** 2 + (cc + max(0, c2 - 6) - c2) ** 2))
            r2, c2 = int(rr[j] + max(0, r2 - 6)), int(cc[j] + max(0, c2 - 6))
        ss.append((k, r2, c2))
    lab = decompose(small, ss, list(SPLIT_RHOS), RASTER / f)
    up = np.repeat(np.repeat(lab, f, 0), f, 1)[: reg.shape[0], : reg.shape[1]]
    up = np.where(reg, up, 0)
    gap = reg & (up == 0)
    for _ in range(3):
        if not gap.any():
            break
        grown = ndi.grey_dilation(np.where(up > 0, up, 0), size=(3, 3))
        fill = gap & (grown > 0)
        up[fill] = grown[fill]
        gap &= ~fill
    up[up < 0] = 0
    return up


NOTE_ALCOVE_MAX = 400.0  # sq ft: unnamed floor up to this size beside a fixture-note room is part of it


def absorb_alcoves(m, unowned):
    """A fixture-note room with the unnamed floor that belongs to it: pieces of `unowned` (floor
    of the same region that no room took), cut at the same bottlenecks rooms are (SPLIT_RHOS[0]),
    that touch the room and are no bigger than NOTE_ALCOVE_MAX (a toilet room's wash-basin end,
    cut off from its stalls by a screen), with the slivers between them. Works in a window round
    the room; `m` and `unowned` are masks over the same slice."""
    rr, cc = np.nonzero(m)
    pad = int(300 * RASTER)  # wider than any piece it may take
    r0, r1 = max(0, rr.min() - pad), min(m.shape[0], rr.max() + pad + 1)
    c0, c1 = max(0, cc.min() - pad), min(m.shape[1], cc.max() + pad + 1)
    room = m[r0:r1, c0:c1]
    free = unowned[r0:r1, c0:c1] & ~room
    rho = SPLIT_RHOS[0] * RASTER
    core = edt_free(np.pad(free, 1))[1:-1, 1:-1] >= rho
    core_lab, n = ndi.label(core, EIGHT)
    if n == 0:
        return m
    dd, (ir, ic) = ndi.distance_transform_edt(~core, return_indices=True)
    opened = (dd <= rho) & free
    piece = np.where(opened, core_lab[ir, ic], 0)
    near = ndi.binary_dilation(room, EIGHT, iterations=4)
    edge = np.zeros_like(room)
    edge[0, :] = edge[-1, :] = edge[:, 0] = edge[:, -1] = True
    out = room.copy()
    for k in np.unique(piece[near & (piece > 0)]):
        pm = piece == k
        if pm.sum() <= NOTE_ALCOVE_MAX * 81.0 * RASTER ** 2 and not (pm & edge).any():
            out |= pm
    if (out & ~room).any():
        # the slivers left between the room and what it took (the throat of the bottleneck)
        res_lab, _ = ndi.label(free & ~opened, FOUR)
        grown = ndi.binary_dilation(out, EIGHT, iterations=2)
        sizes = np.bincount(res_lab.ravel())
        for k in np.unique(res_lab[grown & (res_lab > 0)]):
            if sizes[k] <= 40 * 81.0 * RASTER ** 2:
                out |= res_lab == k
    res = m.copy()
    res[r0:r1, c0:c1] = out
    return res


class LevelResult:
    pass


def label_rid(lvl: str, l) -> str:
    """The room id a label makes (before any "-2" suffix for a repeat)."""
    if l["kind"] in ("stair", "elevator"):
        return f"{lvl}-{l['kind'] if l['kind'] == 'stair' else 'elev'}-{l['number']}" if l["number"] else f"{lvl}-{slug(l['raw'])}"
    return f"{lvl}-{l['number']}" if l["number"] else f"{lvl}-{slug(l['raw'])}"


def merge_masks(cv, masks, ia, ib, building):
    """--merge: one mask from masks[ia] and masks[ib]: their union plus the seam between them (what
    a closing by MERGE_REACH adds between the two: the partition's strokes and any sliver inside
    it), never another room's floor or the outside. Returns (label, slices, mask, seam slices,
    seam) with the label's centre moved to the merged room's middle, or None when the two rooms
    don't touch even so."""
    (la, sla, ma), (lb, slb, mb) = masks[ia], masks[ib]
    R = MERGE_REACH * RASTER
    pad = int(3 * R) + 4
    r0 = max(0, min(sla[0].start, slb[0].start) - pad)
    r1 = min(cv.H, max(sla[0].stop, slb[0].stop) + pad)
    c0 = max(0, min(sla[1].start, slb[1].start) - pad)
    c1 = min(cv.W, max(sla[1].stop, slb[1].stop) + pad)
    win = (slice(r0, r1), slice(c0, c1))
    A = np.zeros((r1 - r0, c1 - c0), bool)
    B = np.zeros_like(A)
    A[sla[0].start - r0: sla[0].stop - r0, sla[1].start - c0: sla[1].stop - c0] = ma
    B[slb[0].start - r0: slb[0].stop - r0, slb[1].start - c0: slb[1].stop - c0] = mb
    U = A | B
    others = np.zeros_like(A)
    for k, (_, slo, mo) in enumerate(masks):
        if k in (ia, ib):
            continue
        a0, a1 = max(slo[0].start, r0), min(slo[0].stop, r1)
        b0, b1 = max(slo[1].start, c0), min(slo[1].stop, c1)
        if a0 < a1 and b0 < b1:
            others[a0 - r0: a1 - r0, b0 - c0: b1 - c0] |= mo[a0 - slo[0].start: a1 - slo[0].start, b0 - slo[1].start: b1 - slo[1].start]
    grown = edt_free(~U) <= R  # dilation by R ...
    closing = edt_free(grown) > R  # ... then erosion by R
    near = (edt_free(~A) <= 2 * R) & (edt_free(~B) <= 2 * R)
    seam = closing & ~U & near & building[win] & ~others
    merged = U | seam
    lab_m, _ = ndi.label(merged, FOUR)
    ra, ca = np.argwhere(A)[0]
    rb, cb = np.argwhere(B)[0]
    if lab_m[ra, ca] != lab_m[rb, cb]:
        return None
    merged = lab_m == lab_m[ra, ca]
    rr, cc = np.nonzero(merged)
    mid = (int(round(rr.mean())), int(round(cc.mean())))
    if not merged[mid]:
        d = edt_free(merged)
        mid = np.unravel_index(int(np.argmax(d)), d.shape)
    label = dict(la)
    label["center"] = cv.map(mid[1] + c0, mid[0] + r0)
    return label, win, merged, win, seam


def partition_masks(cv, masks, ia, ib, clear):
    """--partition: masks[ia] and masks[ib] split again along the partition between them (a movable
    wall the blueprint draws dashed, closed for the event). `clear` = the floor at least CLEAR from
    any stroke (where a walkable cell centre may be): on it the dashes divide the two rooms' shared
    floor in two, so each side is the piece holding that room's label, and every other pixel of the
    two rooms goes to the side it is nearer. Returns ((label, slices, mask), (label, slices, mask),
    moved pixels) or None when the two labels aren't on two sides of anything."""
    (la, sla, ma), (lb, slb, mb) = masks[ia], masks[ib]
    pad = 4
    r0 = max(0, min(sla[0].start, slb[0].start) - pad)
    r1 = min(cv.H, max(sla[0].stop, slb[0].stop) + pad)
    c0 = max(0, min(sla[1].start, slb[1].start) - pad)
    c1 = min(cv.W, max(sla[1].stop, slb[1].stop) + pad)
    win = (slice(r0, r1), slice(c0, c1))
    A = np.zeros((r1 - r0, c1 - c0), bool)
    B = np.zeros_like(A)
    A[sla[0].start - r0: sla[0].stop - r0, sla[1].start - c0: sla[1].stop - c0] = ma
    B[slb[0].start - r0: slb[0].stop - r0, slb[1].start - c0: slb[1].stop - c0] = mb
    U = A | B
    lab, n = ndi.label(U & clear[win], FOUR)

    def side_of(l, own):
        """The clear piece holding the label's seed (else the nearest clear pixel of its own room)."""
        r, c = l["seed"][0] - r0, l["seed"][1] - c0
        if 0 <= r < lab.shape[0] and 0 <= c < lab.shape[1] and lab[r, c]:
            return int(lab[r, c])
        rr, cc = np.nonzero((lab > 0) & own)
        if len(rr) == 0:
            return 0
        k = int(np.argmin((rr - r) ** 2 + (cc - c) ** 2))
        return int(lab[rr[k], cc[k]])

    ka, kb = side_of(la, A), side_of(lb, B)
    if not ka or not kb or ka == kb:
        return None
    da = edt_free(lab != ka)
    db = edt_free(lab != kb)
    na = U & (da <= db)
    nb = U & ~na

    def piece(m, seed_side):
        lab_m, nm = ndi.label(m, FOUR)
        if nm > 1:
            hit = lab_m[lab == seed_side]
            keep = int(np.bincount(hit[hit > 0]).argmax()) if (hit > 0).any() else int(np.argmax(np.bincount(lab_m.ravel())[1:]) + 1)
            m = lab_m == keep
        return m

    na, nb = piece(na, ka), piece(nb, kb)
    moved = int((na & B).sum() + (nb & A).sum())
    return (la, win, na), (lb, win, nb), moved


def walkable_grid(t, blocked):
    """The walkable cells with the rooms `blocked` names (a bool per room index, plus a last entry
    for "in no room", which is never blocked) taken out: the free floor (doors open) at least
    CLEAR from any stroke or blocked room, sampled at the cell centres. Returns (grid, walk_fine)."""
    free = t.free_all & ~blocked[t.room_raster]
    walk_fine = edt_free(free) >= CLEAR * RASTER
    R, C, valid = t.cell_px
    grid = np.zeros(valid.shape, bool)
    grid[valid] = walk_fine[R[valid], C[valid]]
    return grid, walk_fine


def level_grid(t):
    """The level's walkable grid from its rooms' current flags: the free floor (doors open) at
    least CLEAR from any stroke, outside back-of-house / private rooms and staff-only (closed)
    ones, sampled at the cell centres. Run again whenever a room's flags change."""
    blocked = np.zeros(len(t.rooms) + 1, bool)  # the last entry answers for "in no room" (-1)
    for i, rm in enumerate(t.rooms):
        blocked[i] = (not rm["public"]) or bool(rm.get("closed"))
    t.grid, t.walk_fine = walkable_grid(t, blocked)


def build_level(plan: Plan, overrides):
    t = LevelResult()
    t.plan = plan
    lvl = plan.level
    off = plan.offset
    for s in plan.strokes:
        s.pts = s.pts + off
        if s.ctrl is not None:
            s.ctrl = s.ctrl + off

    # the grid marker is not architecture
    marker = plan.marker + off
    arch = []
    for s in plan.strokes:
        lo, hi = s.bbox()
        if np.hypot(*(((lo + hi) / 2) - marker)) < 30 and s.pen >= 1.0 and max(hi - lo) < 70:
            continue
        if s.fill:
            if max(hi - lo) <= 40:
                arch.append(s)
            continue
        if s.grey or s.pen < ARCH_MIN_PEN:
            continue
        arch.append(s)
    doors = detect_doors(plan.strokes)
    parts = door_parts(arch, doors)
    arch_open = [s for i, s in enumerate(arch) if i not in parts]
    closures = []
    for d in doors:
        closures.append((d["hinge"], d["p0"], 1.0))
        closures.append((d["hinge"], d["p3"], 1.0))
    t.doors = doors

    # raster area: heavy strokes' extent + margin, clipped to the frame
    heavy = [s for s in arch if s.pen >= 1.0 and not s.fill]
    pts = np.vstack([s.pts for s in heavy])
    lo, hi = pts.min(axis=0) - 30, pts.max(axis=0) + 30
    fx0, fy0, fx1, fy1 = np.array(plan.area) + np.tile(off, 2)
    lo = np.maximum(lo, [fx0 + 1, fy0 + 1])
    hi = np.minimum(hi, [fx1 - 1, fy1 - 1])
    cv = Canvas(lo[0], lo[1], hi[0], hi[1])
    t.canvas = cv

    bridges = bridge_gaps(arch, plan.strokes)
    t.bridges = bridges
    rooms_bar = cv.draw(arch, closures + bridges)
    rooms_bar = ndi.binary_dilation(rooms_bar, np.ones((3, 3), bool))  # seal hairline gaps
    walk_bar = cv.draw([s for s in arch_open if not s.fill])  # hatch fills run across openings
    walk_bar = ndi.binary_dilation(walk_bar, np.ones((3, 3), bool))
    encl_bar = cv.draw([s for s in arch if s.pen >= 1.0 or s.fill], closures + bridges)
    encl_bar = ndi.binary_dilation(encl_bar, np.ones((3, 3), bool))

    # outside: flood from the border through gaps narrower than ~8 units closed
    seal = edt_free(~rooms_bar) <= SEAL * RASTER
    lab, n = ndi.label(~seal, FOUR)
    border = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    outside_core = np.isin(lab, border[border > 0])
    outside = (edt_free(~outside_core) <= SEAL * RASTER + 1) & ~rooms_bar
    t.outside = outside
    building = ~outside
    del lab, seal, outside_core

    # ---- labels -> regions
    labels = group_labels(plan)
    t.labels = labels
    regions, nreg = ndi.label(~rooms_bar & building, FOUR)
    enclosures, _ = ndi.label(~encl_bar & building, FOUR)
    reg_area = np.bincount(regions.ravel())

    def region_at(lbl, lab):
        pts = [lbl["anchor"], lbl["center"]]
        for p in pts:
            r, c = cv.pixel(p)
            if cv.inside(r, c) and lab[r, c] > 0:
                return int(lab[r, c]), (r, c)
        # nearest free pixel within 8 units of the anchor
        r, c = cv.pixel(lbl["anchor"])
        rad = int(8 * RASTER)
        r0, r1 = max(0, r - rad), min(cv.H, r + rad + 1)
        c0, c1 = max(0, c - rad), min(cv.W, c + rad + 1)
        win = lab[r0:r1, c0:c1]
        rr, cc = np.nonzero(win > 0)
        if len(rr) == 0:
            return 0, None
        k = int(np.argmin((rr + r0 - r) ** 2 + (cc + c0 - c) ** 2))
        return int(win[rr[k], cc[k]]), (int(rr[k] + r0), int(cc[k] + c0))

    room_labels = [l for l in labels if l["kind"] in ("room", "named") and not l.get("note")]
    # fixture notes ("N URINAL"): a room of their own only where no labelled room covers them
    notes = [l for l in labels if l.get("note")]
    # duplicated numbers on one level: keep the copy alone in its region
    for l in room_labels + notes:
        l["region"], l["seed"] = region_at(l, regions)
    by_num = defaultdict(list)
    for l in room_labels:
        if l["number"]:
            by_num[l["number"]].append(l)
    per_region = defaultdict(list)
    for l in room_labels:
        if l["region"]:
            per_region[l["region"]].append(l)
    dropped = []
    for num, ls in by_num.items():
        if len(ls) > 1:
            alone = [l for l in ls if len(per_region[l["region"]]) == 1]
            keep = alone[0] if alone else ls[0]
            for l in ls:
                if l is not keep:
                    dropped.append(f"{lvl}-{num}")
                    l["region"] = 0
    room_labels = [l for l in room_labels if l["region"]]
    # unnumbered names inside a numbered room's region are notes, not rooms
    per_region = defaultdict(list)
    for l in room_labels:
        per_region[l["region"]].append(l)
    room_labels = [l for l in room_labels if not (l["kind"] == "named" and any(o["number"] for o in per_region[l["region"]]))]
    per_region = defaultdict(list)
    for l in room_labels:
        per_region[l["region"]].append(l)
    # a room label drawn just outside its room (over the door, in the corridor): when it shares
    # a region with other labels and a small unclaimed room lies within 12 units of its text,
    # it names that room instead
    t.moved_labels = []
    objs_r = ndi.find_objects(regions)
    for l in list(room_labels):
        if len(per_region[l["region"]]) < 2 or kind_for(l["raw"]) in ("corridor", "lobby", "hall", "exit"):
            continue
        x0, y0, x1, y1 = l["box"]
        r0, c0 = cv.pixel((x0 - 12, y0 - 12))
        r1, c1 = cv.pixel((x1 + 12, y1 + 12))
        r0, c0 = max(r0, 0), max(c0, 0)
        win = regions[r0: r1 + 1, c0: c1 + 1]
        ids, counts = np.unique(win[win > 0], return_counts=True)
        best = None
        for rid, cnt in zip(ids, counts):
            rid = int(rid)
            if rid == l["region"] or rid in per_region or not (30 <= reg_area[rid] / RASTER ** 2 / 81.0 <= 600):
                continue
            ext = [(q.stop - q.start) / RASTER for q in objs_r[rid - 1]]
            if min(ext) < 50:  # narrower than 5.5 ft: a toilet stall, not a room
                continue
            if best is None or cnt > best[1]:
                best = (rid, cnt)
        if best:
            rr, cc = np.nonzero(win == best[0])
            k = len(rr) // 2
            per_region[l["region"]].remove(l)
            l["region"], l["seed"] = best[0], (int(rr[k] + r0), int(cc[k] + c0))
            per_region[best[0]].append(l)
            t.moved_labels.append(f"{lvl}-{l['number'] or slug(l['raw'])}")
    per_region = {k: v for k, v in per_region.items() if v}

    # a finer raster (fixture pens too) that closes glass fronts and panel boxes drawn thin
    detail_lab = None
    if any(len(ls) > 1 for ls in per_region.values()):
        fine = [s for s in plan.strokes if (s.pen > 0 and not s.fill) or (s.fill and not s.grey)]
        roi = []
        objs_x = ndi.find_objects(regions)
        for rid, ls in per_region.items():
            if len(ls) > 1 and objs_x[rid - 1] is not None:
                a, b = objs_x[rid - 1]
                roi.append((cv.x0 + b.start / RASTER, cv.y0 + a.start / RASTER, cv.x0 + b.stop / RASTER, cv.y0 + a.stop / RASTER))
        thin_bridges = bridge_gaps(arch, plan.strokes, 60.0, thin=True, roi=roi)
        detail_bar = cv.draw(fine, closures + bridges + thin_bridges) | rooms_bar
        # thickened by 4.5 units so sliding doors drawn a little open still close their room
        detail_bar = edt_free(~detail_bar) <= 4.5 * RASTER
        detail_lab, _ = ndi.label(~detail_bar & building, FOUR)
        del detail_bar

    # ---- masks per label (split shared regions)
    total_building = int(building.sum())
    leaks = {"split": [], "big": [], "trimmed": [], "carved": []}
    masks = []  # (label, slice, mask)
    objs = ndi.find_objects(regions)
    def split_labels(sl, reg, ls):
        """Each label's part of one free region: int32 labels over `reg` (k = ls[k - 1], 0 = in
        no room), and the ids carved out by fine lines."""
        carved = []
        seeds = [(k, l["seed"][0] - sl[0].start, l["seed"][1] - sl[1].start) for k, l in enumerate(ls, start=1)]
        lab_r = np.zeros(reg.shape, np.int32)
        rest = reg
        if len(ls) > 1 and detail_lab is not None:
            # a seed whose fine-raster room is closed, holds no other seed and is a small part of
            # the region (a cry room behind glass, a walk-in cooler) keeps exactly that room
            dl = detail_lab[sl]
            ids = []
            for k, r, c in seeds:
                win = dl[max(0, r - 8): r + 9, max(0, c - 8): c + 9]
                vals = win[win > 0]
                ids.append(int(np.bincount(vals).argmax()) if len(vals) else 0)
            rest = reg.copy()
            for (k, r, c), did in zip(seeds, ids):
                if did == 0 or ids.count(did) > 1:
                    continue
                rr_, cc_ = np.nonzero(dl == did)
                w0, w1 = max(0, rr_.min() - 12), min(reg.shape[0], rr_.max() + 13)
                v0, v1 = max(0, cc_.min() - 12), min(reg.shape[1], cc_.max() + 13)
                D = np.zeros(reg.shape, bool)
                grown = edt_free(dl[w0:w1, v0:v1] != did) <= 4.5 * RASTER + 1  # grow back the thickening
                D[w0:w1, v0:v1] = grown
                D &= reg & (lab_r == 0)
                a = int(D.sum())
                if a < 40 * 81 * RASTER ** 2 or a > 0.4 * reg.sum():
                    continue
                lab_r[D] = k
                rest &= ~D
                carved.append(f"{lvl}-{ls[k - 1]['number'] or slug(ls[k - 1]['raw'])}")
        left = [sd for sd in seeds if not (lab_r == sd[0]).any()]
        if left:
            if rest is not reg:
                snapped = []
                for k, r, c in left:
                    if not rest[r, c]:
                        rr, cc = np.nonzero(rest[max(0, r - 16): r + 17, max(0, c - 16): c + 17])
                        if len(rr) == 0:
                            continue
                        j = int(np.argmin((rr - min(r, 16)) ** 2 + (cc - min(c, 16)) ** 2))
                        r, c = int(rr[j] + max(0, r - 16)), int(cc[j] + max(0, c - 16))
                    snapped.append((k, r, c))
                left = snapped
            if left:
                sub = split_region(rest, left)
                lab_r[sub > 0] = sub[sub > 0]
        return lab_r, carved

    def label_masks(sl, lab_r, ls):
        """One mask per label from split_labels()'s result: its piece holding its seed (else its
        largest), so floor a label was handed across a wall is left to no room."""
        out = []
        for k, l in enumerate(ls, start=1):
            m = lab_r == k
            if not m.any():
                continue
            lab_m, nm = ndi.label(m, FOUR)
            if nm > 1:
                rs, cs = l["seed"][0] - sl[0].start, l["seed"][1] - sl[1].start
                keep_id = lab_m[rs, cs] if lab_m[rs, cs] else np.argmax(np.bincount(lab_m.ravel())[1:]) + 1
                m = lab_m == keep_id
            out.append((l, sl, m))
        return out

    notes_by_region = defaultdict(list)
    for l in notes:
        if l["region"]:
            notes_by_region[l["region"]].append(l)
    t.fixture_rooms = []
    for rid in list(per_region) + [r for r in notes_by_region if r not in per_region]:
        ls = list(per_region.get(rid, []))
        sl = objs[rid - 1]
        reg = regions[sl] == rid
        lab_r, carved = split_labels(sl, reg, ls) if ls else (np.zeros(reg.shape, np.int32), [])
        found = label_masks(sl, lab_r, ls)
        # a fixture note on floor no labelled room took names that floor's room
        loose = [n for n in notes_by_region.get(rid, [])
                 if not any(m[n["seed"][0] - sl[0].start, n["seed"][1] - sl[1].start] for _, _, m in found)]
        if loose:
            ls = ls + loose
            lab_r, carved = split_labels(sl, reg, ls)
            found = label_masks(sl, lab_r, ls)
            for i, (l, _, m) in enumerate(found):
                if l.get("note"):
                    taken = np.zeros(reg.shape, bool)
                    for _, _, mo in found:
                        taken |= mo
                    found[i] = (l, sl, absorb_alcoves(m, reg & ~taken))
            t.fixture_rooms += [f"{lvl}-{slug(n['raw'])} (from the note \"{n['note']}\")" for n in loose]
        if not ls:
            continue
        name = [f"{lvl}-{l['number'] or slug(l['raw'])}" for l in ls]
        if reg.sum() > 0.35 * total_building:
            leaks["big"].append(name)
        if len(ls) > 1:
            leaks["split"].append(name)
        leaks["carved"] += carved
        if (lab_r[reg] == 0).mean() > 0.05:
            leaks["trimmed"].append([name, round(float((lab_r[reg] == 0).sum() / RASTER ** 2 / 81.0))])
        masks += found
    t.leaks = leaks
    t.dropped = dropped

    # ---- --merge: one room of two (a hall whose partition stays open). The seam between them
    # leaves the walls (t.erase, read by walls_path()) and the rasters, so people walk across it.
    t.erase = np.zeros((cv.H, cv.W), bool)
    t.merged = []
    t.merged_away = []
    for a_id, b_id in overrides["merge"]:
        ia = next((i for i, (l, _, _) in enumerate(masks) if label_rid(lvl, l) == a_id), None)
        ib = next((i for i, (l, _, _) in enumerate(masks) if label_rid(lvl, l) == b_id), None)
        if ia is None or ib is None:
            continue  # on another level (main() stops when no level has both)
        got = merge_masks(cv, masks, ia, ib, building)
        if got is None:
            sys.exit(f"--merge {a_id}+{b_id}: the two rooms don't touch (nothing within {MERGE_REACH:.0f} units joins them)")
        label, win, merged, _, seam = got
        for bar in (rooms_bar, walk_bar, encl_bar):
            bar[win][seam] = False
        t.erase[win] |= ndi.binary_dilation(seam, EIGHT, iterations=2)
        masks[ia] = (label, win, merged)
        del masks[ib]
        t.merged.append(f"{a_id}+{b_id}")
        t.merged_away.append(b_id)

    # ---- --partition: two rooms of one hall divided by a movable partition (drawn dashed, closed
    # for the event): their shared floor is split along it, not by distance between the labels
    t.partitioned = []
    if overrides["partition"]:
        clear = edt_free(~walk_bar & building) >= CLEAR * RASTER
        for a_id, b_id in overrides["partition"]:
            ia = next((i for i, (l, _, _) in enumerate(masks) if label_rid(lvl, l) == a_id), None)
            ib = next((i for i, (l, _, _) in enumerate(masks) if label_rid(lvl, l) == b_id), None)
            if ia is None or ib is None:
                continue  # on another level (main() stops when no level has both)
            got = partition_masks(cv, masks, ia, ib, clear)
            if got is None:
                sys.exit(f"--partition {a_id}+{b_id}: nothing on the floor divides the two rooms (their labels are on one piece of floor)")
            ma_, mb_, moved = got
            masks[ia], masks[ib] = ma_, mb_
            t.partitioned.append(f"{a_id}+{b_id} ({round(moved / RASTER ** 2 / 81.0)} sq ft moved)")

    # stair / elevator rooms from the enclosure raster (treads and X marks ignored)
    conn_labels = [l for l in labels if l["kind"] in ("stair", "elevator")]
    enc_objs = ndi.find_objects(enclosures)
    used_enc = set()
    for l in conn_labels:
        eid, seed = region_at(l, enclosures)
        if not eid or eid in used_enc:
            continue
        sl = enc_objs[eid - 1]
        m = enclosures[sl] == eid
        area_sqft = m.sum() / RASTER ** 2 / 81.0
        if area_sqft > 1200 or area_sqft < 20:
            continue
        used_enc.add(eid)
        l["seed"] = seed
        masks.append((l, sl, m))

    # ---- rooms
    room_raster = np.full((cv.H, cv.W), -1, np.int32)
    owner = np.full((cv.H, cv.W), -1, np.int32)  # every mask, to keep outlines from enclosing another room
    for i, (_, sl, m) in enumerate(masks):
        owner[sl][m] = i
    rooms = []
    seen_ids = set()
    t.unwrapped = []
    t.applied = {"public": set(), "private": set(), "closed": set(), "name": set(), "passage": set()}
    for mi, (l, sl, m) in enumerate(masks):
        if l["kind"] in ("stair", "elevator"):
            raw = l["raw"]
            kind = l["kind"]
            number = None
            rid = f"{lvl}-{kind if kind == 'stair' else 'elev'}-{l['number']}" if l["number"] else f"{lvl}-{slug(raw)}"
        else:
            raw = l["raw"]
            kind = kind_for(raw)
            number = l["number"]
            rid = f"{lvl}-{number}" if number else f"{lvl}-{slug(raw)}"
        base, k = rid, 2
        while rid in seen_ids:
            rid = f"{base}-{k}"
            k += 1
        seen_ids.add(rid)
        # an outline is one ring: a room wrapped round another (a corridor round a walk-in
        # cooler) loses its thin parts until it no longer encloses it
        others = (owner[sl] >= 0) & (owner[sl] != mi)
        if (ndi.binary_fill_holes(m) & ~m & others).any():
            dm = edt_free(np.pad(m, 1))[1:-1, 1:-1]
            for rad in (2.0, 4.0, 6.0, 8.0, 10.0):
                core = dm > rad * RASTER
                if not core.any():
                    break
                mo = (edt_free(~core) <= rad * RASTER) & m
                lab_o, no = ndi.label(mo, FOUR)
                if no > 1:
                    mo = lab_o == (np.argmax(np.bincount(lab_o.ravel())[1:]) + 1)
                if not (ndi.binary_fill_holes(mo) & ~mo & others).any():
                    m = mo
                    t.unwrapped.append(rid)
                    break
        m = ndi.binary_fill_holes(m)
        if m.sum() > 50:
            mo = ndi.binary_opening(m, np.ones((3, 3), bool))
            if mo.sum() > 0.8 * m.sum():
                m = mo
        lab_m, nm = ndi.label(m, FOUR)
        if nm > 1:
            m = lab_m == (np.argmax(np.bincount(lab_m.ravel())[1:]) + 1)
        if not m.any():
            continue
        ring = trace_outline(np.pad(m, 1))
        ring = ring - 1  # undo the pad
        ring = cv.map(ring[:, 0] + sl[1].start, ring[:, 1] + sl[0].start)
        poly = simplify_ring(ring, 1.5)
        if len(poly) < 3:
            continue
        idx = len(rooms)
        view = room_raster[sl]
        view[m] = idx
        name = tidy_name(raw)
        public = not is_back_of_house(raw) and not is_private_quarters(raw)
        if rid in overrides["public"]:
            public = True
            t.applied["public"].add(rid)
        if rid in overrides["private"]:
            public = False
            t.applied["private"].add(rid)
        # staff only on the organisers' plans: drawn and named, never entered (no entry, no floor)
        closed = rid in overrides["closed"]
        if closed:
            public = True
            t.applied["closed"].add(rid)
        if rid in overrides["name"] and l["kind"] not in ("stair", "elevator"):
            name = overrides["name"][rid]
            kind = kind_for(name.upper())
            t.applied["name"].add(rid)
        # a way through (an alcove between two rooms): crossed at no extra cost, name kept
        if rid in overrides["passage"] and l["kind"] not in ("stair", "elevator"):
            kind = "corridor"
            t.applied["passage"].add(rid)
        # label point: the blueprint's own label when it lies in the room, else the deepest point
        lp = l["center"]
        r, c = cv.pixel(lp)
        if not (cv.inside(r, c) and room_raster[r, c] == idx):
            d = edt_free(np.pad(m, 1))[1:-1, 1:-1]
            rr, cc = np.unravel_index(int(np.argmax(d)), d.shape)
            lp = cv.map(cc + sl[1].start, rr + sl[0].start)
        rooms.append({"id": rid, "level": lvl, "number": number, "name": name, "kind": kind, "public": public,
                      "polygon": poly, "label": np.asarray(lp, float), "entry": None, "raw": raw,
                      "area_sqft": float(m.sum() / RASTER ** 2 / 81.0), "_conn": l["kind"] in ("stair", "elevator"),
                      "_conn_num": l["number"] if l["kind"] in ("stair", "elevator") else None,
                      "_conn_kind": l["kind"] if l["kind"] in ("stair", "elevator") else None, "closed": closed})
    # a quarters room's en-suite bath (a "Bath" numbered within two of it, and not the "195B" of a
    # public room "195") is private too
    quarters = [room_number_value(rm["number"]) for rm in rooms if is_private_quarters(rm["raw"]) and not rm["public"]]
    t.private_quarters = [rm["id"] for rm in rooms if is_private_quarters(rm["raw"]) and not rm["public"]]
    public_numbers = {rm["number"] for rm in rooms if rm["public"] and rm["number"]}
    for rm in rooms:
        n = room_number_value(rm["number"])
        owner = re.match(r"^(\d+)[A-Z]$", rm["number"] or "")
        if owner and owner.group(1) in public_numbers:
            continue
        if (rm["public"] and n is not None and re.fullmatch(r"BATH", rm["raw"].upper().strip())
                and rm["id"] not in overrides["public"] and any(q is not None and abs(n - q) <= 2 for q in quarters)):
            rm["public"] = False
            t.private_quarters.append(rm["id"])
    t.rooms = rooms
    t.room_raster = room_raster
    have = {rm["id"] for rm in rooms}
    t.missing = sorted({f"{lvl}-{l['number']}" for l in labels if l["kind"] == "room" and l["number"]} - have - set(t.merged_away))

    # floor in no room that is really outside the building (a front plaza, a terrace): big,
    # holding no label, and bounded in good part by single lines with the outside right behind
    t.exterior_regions = 0
    for _ in range(3):
        cand, ncand = ndi.label(~rooms_bar & building & (room_raster < 0), FOUR)
        protected = set()
        for l in labels:
            r, c = cv.pixel(l["anchor"])
            if cv.inside(r, c):
                protected.add(int(cand[r, c]))
        to_out = edt_free(~outside)
        objs0 = ndi.find_objects(cand)
        area0 = np.bincount(cand.ravel())
        added = False
        for k in range(1, ncand + 1):
            if k in protected or objs0[k - 1] is None or area0[k] < 300 * 81 * RASTER ** 2:
                continue
            sl0 = tuple(slice(max(0, q.start - 3), q.stop + 3) for q in objs0[k - 1])
            reg0 = cand[sl0] == k
            ring = ndi.binary_dilation(reg0, EIGHT, iterations=2) & ~reg0
            if ring.any() and (to_out[sl0][ring] <= 4 * RASTER).mean() >= 0.15:
                outside[sl0] |= reg0
                t.exterior_regions += 1
                added = True
        if not added:
            break
    building = ~outside
    t.outside = outside

    # unlabeled regions (report only): free regions > 40 sq ft that no room covers
    covered = np.zeros(nreg + 1, bool)
    covered[np.unique(regions[room_raster >= 0])] = True
    big = np.nonzero((reg_area > 40 * 81 * RASTER ** 2) & ~covered)[0]
    t.unlabeled = int(sum(1 for k in big if k > 0))

    # open areas: big unnamed floor inside the building (a foyer, a lower lobby, an unlabeled
    # corridor) becomes a room "Open Area N" so an event room can be mapped onto it later;
    # main() drops the ones no walkable route reaches
    cand, ncand = ndi.label(~rooms_bar & building & (room_raster < 0), FOUR)
    area_c = np.bincount(cand.ravel())
    objs_c = ndi.find_objects(cand)
    found = []
    for k in range(1, ncand + 1):
        if objs_c[k - 1] is None or area_c[k] < OPEN_AREA_MIN * 81 * RASTER ** 2:
            continue
        sl = objs_c[k - 1]
        m = ndi.binary_fill_holes(cand[sl] == k)
        mo = ndi.binary_opening(m, np.ones((3, 3), bool))
        if mo.sum() > 0.8 * m.sum():
            m = mo
        lab_m, nm = ndi.label(m, FOUR)
        if nm > 1:
            m = lab_m == (np.argmax(np.bincount(lab_m.ravel())[1:]) + 1)
        ring = trace_outline(np.pad(m, 1)) - 1
        poly = simplify_ring(cv.map(ring[:, 0] + sl[1].start, ring[:, 1] + sl[0].start), 1.5)
        if len(poly) < 3:
            continue
        d = edt_free(np.pad(m, 1))[1:-1, 1:-1]
        rr, cc = np.unravel_index(int(np.argmax(d)), d.shape)
        found.append((sl, m, poly, cv.map(cc + sl[1].start, rr + sl[0].start)))
    found.sort(key=lambda f: (round(float(f[3][1]) / 200), float(f[3][0])))  # rows of ~200 units, left to right
    for n, (sl, m, poly, lp) in enumerate(found, start=1):
        # floor hemmed in by back-of-house rooms (a kitchen's servery) is back-of-house too
        pad = int(8 * RASTER)
        big = tuple(slice(max(0, q.start - pad), q.stop + pad) for q in sl)
        mm = np.zeros(room_raster[big].shape, bool)
        mm[sl[0].start - big[0].start: sl[0].stop - big[0].start, sl[1].start - big[1].start: sl[1].stop - big[1].start] = m
        ring = (edt_free(~mm) <= pad) & ~mm
        owners = room_raster[big][ring]
        owners = owners[owners >= 0]
        boh = float(np.mean([not rooms[o]["public"] for o in owners])) if len(owners) else 0.0
        room_raster[sl][m] = len(rooms)
        rooms.append({"id": f"{lvl}-open-area-{n}", "level": lvl, "number": None, "name": f"Open Area {n}",
                      "kind": "other", "public": boh < 0.6, "polygon": poly, "label": np.asarray(lp, float),
                      "entry": None, "raw": f"OPEN AREA {n}", "area_sqft": float(m.sum() / RASTER ** 2 / 81.0),
                      "_conn": False, "_conn_num": None, "_open": True})

    # ---- the private quarters' own corridors (see residence_zone())
    free = ~walk_bar & building
    t.openings = opening_graph(room_raster, free)
    t.residence = residence_zone(rooms, t.openings, t.private_quarters, overrides)
    t.private_quarters += t.residence
    # ---- which of those rooms the Pujya Santo view shows (settle_sant() finishes it)
    t.rooms = rooms
    classify_sant(t, overrides)

    # ---- walkable grid (level_grid(); main() runs it again when a shaft room's flags change)
    gx0 = math.floor(cv.x0 / CELL) * CELL
    gy0 = math.floor(cv.y0 / CELL) * CELL
    cols = int(math.ceil((cv.x0 + cv.W / RASTER - gx0) / CELL))
    rows = int(math.ceil((cv.y0 + cv.H / RASTER - gy0) / CELL))
    cx = gx0 + (np.arange(cols) + 0.5) * CELL
    cy = gy0 + (np.arange(rows) + 0.5) * CELL
    pc = np.round((cx - cv.x0) * RASTER).astype(int)
    pr = np.round((cy - cv.y0) * RASTER).astype(int)
    okc = (pc >= 0) & (pc < cv.W)
    okr = (pr >= 0) & (pr < cv.H)
    cell_room = np.full((rows, cols), -1, np.int32)
    R, C = np.meshgrid(pr, pc, indexing="ij")
    valid = okr[:, None] & okc[None, :]
    cell_room[valid] = room_raster[R[valid], C[valid]]
    t.cell_room = cell_room
    t.grid_origin = np.array([gx0, gy0])
    t.free_all = free
    t.cell_px = (R, C, valid)
    level_grid(t)
    t.encl_bar = encl_bar
    t.interior = building & ~rooms_bar
    t.building = building
    t.arch = arch
    t.arch_open = arch_open
    return t


# ---------------------------------------------------------------------------------------------
# Grid helpers


N8 = [(-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)]


def grid_cell(t, pt):
    c = int(math.floor((pt[0] - t.grid_origin[0]) / CELL))
    r = int(math.floor((pt[1] - t.grid_origin[1]) / CELL))
    return r, c


def cell_center(t, r, c):
    return t.grid_origin + (np.array([c, r]) + 0.5) * CELL


def landing_cell(t, pt, max_units=250.0, kept=None, grid=None):
    """A walkable cell beside a shaft, found by walking from its label inside the walls (stair
    treads, railings and X marks ignored, doors closed): the kept cell nearest along that walk,
    so a stair open to a lobby lands in the lobby, not in the shop on the other side of its
    wall. Circulation (corridors, lobbies, halls, unnamed floor) is preferred over rooms. Falls
    back to the straight-line nearest cell within 90 units. `kept` / `grid` = another view of
    the level's floor (the Pujya Santo view's, settle_sant()); default the level's own."""
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import dijkstra

    kept = t.kept if kept is None else kept
    grid = t.grid if grid is None else grid
    cv = t.canvas
    f = int(RASTER)
    r, c = cv.pixel(pt)
    rad = int(max_units * RASTER)
    r0, r1 = max(0, r - rad), min(cv.H, r + rad + 1)
    c0, c1 = max(0, c - rad), min(cv.W, c + rad + 1)
    free = ~t.encl_bar[r0:r1:f, c0:c1:f] & t.building[r0:r1:f, c0:c1:f]
    H, W = free.shape
    sr, sc = min((r - r0) // f, H - 1), min((c - c0) // f, W - 1)
    if not free[sr, sc]:
        rr, cc = np.nonzero(free[max(0, sr - 8): sr + 9, max(0, sc - 8): sc + 9])
        if len(rr):
            j = int(np.argmin((rr - min(sr, 8)) ** 2 + (cc - min(sc, 8)) ** 2))
            sr, sc = int(rr[j] + max(0, sr - 8)), int(cc[j] + max(0, sc - 8))
    best = None
    if free[sr, sc]:
        idx = np.full(free.shape, -1, np.int64)
        nodes = np.flatnonzero(free)
        idx.flat[nodes] = np.arange(len(nodes))
        ii, jj, ww = [], [], []
        for dr, dc, w in ((0, 1, 1.0), (1, 0, 1.0), (1, 1, 1.4142), (1, -1, 1.4142)):
            a0, a1 = (0, W - dc) if dc >= 0 else (-dc, W)
            both = free[0: H - dr, a0: a1] & free[dr: H, a0 + dc: a1 + dc]
            ra, ca = np.nonzero(both)
            ca = ca + a0
            ii.append(idx[ra, ca])
            jj.append(idx[ra + dr, ca + dc])
            ww.append(np.full(len(ra), w))
        G = coo_matrix((np.concatenate(ww), (np.concatenate(ii), np.concatenate(jj))), shape=(len(nodes), len(nodes))).tocsr()
        dist = np.full(free.shape, np.inf)
        dist.flat[nodes] = dijkstra(G, directed=False, indices=int(idx[sr, sc]), limit=max_units * RASTER / f)
        rows, cols = grid.shape
        g0, g1 = grid_cell(t, cv.map(c0, r0)), grid_cell(t, cv.map(c1, r1))
        for a in range(max(0, g0[0]), min(rows, g1[0] + 1)):
            for b in range(max(0, g0[1]), min(cols, g1[1] + 1)):
                if not kept[a, b]:
                    continue
                pr, pc = cv.pixel(cell_center(t, a, b))
                qr, qc = (pr - r0) // f, (pc - c0) // f
                if not (0 <= qr < H and 0 <= qc < W):
                    continue
                d = dist[qr, qc] * f / RASTER
                if not np.isfinite(d):
                    continue
                k = int(t.cell_room[a, b])
                if k >= 0 and t.rooms[k]["kind"] not in ("corridor", "lobby", "exit", "hall", "stair", "elevator", "other"):
                    d += 40.0
                if best is None or d < best[0]:
                    best = (d, (a, b))
    if best is not None:
        return best[1]
    # fallback: the straight-line nearest walkable cell
    gr, gc = grid_cell(t, pt)
    rad = int(math.ceil(90.0 / CELL))
    rows, cols = grid.shape
    for mask in (kept, grid):
        a0, b0 = max(0, gr - rad), max(0, gc - rad)
        rr, cc = np.nonzero(mask[a0: gr + rad + 1, b0: gc + rad + 1])
        if len(rr):
            ctr = t.grid_origin + (np.stack([cc + b0, rr + a0], axis=1) + 0.5) * CELL
            d = np.hypot(*(ctr - pt).T)
            j = int(np.argmin(d))
            if d[j] <= 90.0:
                return int(rr[j] + a0), int(cc[j] + b0)
    return None


# ---------------------------------------------------------------------------------------------
# Connectors


def find_x_marks(plan_strokes):
    """Centres of X-marked shafts: two crossing diagonals of one box."""
    diag = []
    for s in plan_strokes:
        if s.op != "l":
            continue
        a, b = s.pts
        v = b - a
        length = math.hypot(*v)
        if not (30 <= length <= 300):
            continue
        ang = abs(math.degrees(math.atan2(v[1], v[0]))) % 180
        if 15 <= ang <= 75 or 105 <= ang <= 165:
            diag.append(((a + b) / 2, v / length, length))
    out = []
    for i in range(len(diag)):
        for j in range(i + 1, len(diag)):
            mi, ui, li = diag[i]
            mj, uj, lj = diag[j]
            if np.hypot(*(mi - mj)) < 3 and abs(li - lj) < 0.1 * li and abs(float(ui @ uj)) < 0.95:
                out.append((mi + mj) / 2)
    return out


def connector_id(kind: str, num) -> str:
    return f"{'stair' if kind == 'stair' else 'elev'}-{num}"


def connector_positions(results):
    """Every stair / elevator the blueprint numbers: {(kind, number): where its labels are (the
    mean over the levels that label it)}."""
    numbered = defaultdict(list)
    for t in results:
        for l in t.labels:
            if l["kind"] in ("stair", "elevator") and l["number"]:
                numbered[(l["kind"], l["number"])].append(l["anchor"])
    return {k: np.mean(v, axis=0) for k, v in numbered.items()}


def number_shafts(results, canon):
    """An unnumbered shaft room ("ELEVATOR") takes the number of the numbered shaft it stands on:
    the nearest one of its kind within 150 units of where the other levels label it."""
    for t in results:
        ids = {rm["id"] for rm in t.rooms}
        for rm in t.rooms:
            if not rm["_conn"] or rm["_conn_num"]:
                continue
            best = None
            for (kind, num), pos in canon.items():
                d = float(np.hypot(*(pos - rm["label"])))
                if kind == rm["_conn_kind"] and d < 150 and (best is None or d < best[0]):
                    best = (d, num)
            if best and f"{t.plan.level}-{connector_id(rm['_conn_kind'], best[1])}" not in ids:
                ids.discard(rm["id"])
                rm["id"] = f"{t.plan.level}-{connector_id(rm['_conn_kind'], best[1])}"
                rm["_conn_num"] = best[1]
                ids.add(rm["id"])


def shaft_connector_id(rm):
    """The connector a shaft room belongs to ("stair-5"), None for other rooms and unmatched shafts."""
    return connector_id(rm["_conn_kind"], rm["_conn_num"]) if rm["_conn"] and rm["_conn_num"] else None


def shaft_name(kind: str, place) -> str:
    """A stair / elevator room as guests read it: by its place, never a number ("Foyer Stairs")."""
    return f"{place.title()} {CONNECTOR_NAME[kind]}" if place else CONNECTOR_NAME[kind]


def build_connectors(results, report, canon, view=None):
    """Stairs / elevators across levels, from labels matched by position (`canon` =
    connector_positions()). `view` = {level id: (kept, grid)}: the floor to land on per level
    (the Pujya Santo view's, settle_sant()); a level it leaves out lands on its own."""
    view = view or {}
    xmarks = {t.plan.level: find_x_marks(t.plan.strokes) for t in results}
    MATCH = 250.0
    connectors = []
    spreads = {}
    for (kind, num), pos in sorted(canon.items(), key=lambda kv: (kv[0][0], int(kv[0][1]))):
        points = {}
        evidence = {}
        for t in results:
            lvl = t.plan.level
            ev = None
            best = None
            for l in t.labels:
                ok_kind = (l["kind"] == kind) or (kind == "stair" and l["kind"] == "arrow")
                if not ok_kind:
                    continue
                if l["number"] and l["number"] != num:
                    continue
                d = float(np.hypot(*(l["anchor"] - pos)))
                if d > MATCH:
                    continue
                # prefer numbered labels, then the nearest
                score = (0 if l["number"] else 1, d)
                if best is None or score < best:
                    best, ev = score, l["anchor"]
            if ev is None and kind == "elevator":
                near = [x for x in xmarks[lvl] if np.hypot(*(x - pos)) < 100]
                if near:
                    ev = min(near, key=lambda x: np.hypot(*(x - pos)))
            if ev is None:
                continue
            # the shaft must be inside this level's building
            r, c = t.canvas.pixel(ev)
            if not (t.canvas.inside(r, c) and t.building[r, c]):
                continue
            kept, grid = view.get(lvl, (None, None))
            cell = landing_cell(t, ev, kept=kept, grid=grid)
            if cell is None:
                continue
            points[lvl] = cell_center(t, *cell)
            evidence[lvl] = ev
        # a level between two it serves, with no label there (the first floor's lobby lifts):
        # the shaft continues if that spot is inside the building and in no named room
        if points:
            orders = [t.plan.order for t in results if t.plan.level in points]
            biggest = max(int(t.building.sum()) for t in results)
            for t in results:
                lvl = t.plan.level
                if lvl in points or not (min(orders) < t.plan.order < max(orders)):
                    continue
                if t.building.sum() < 0.5 * biggest:  # a partial plan (the mezzanine strip)
                    continue
                r, c = t.canvas.pixel(pos)
                if not (t.canvas.inside(r, c) and t.building[r, c]):
                    continue
                k = int(t.room_raster[r, c])
                if k >= 0 and t.rooms[k]["kind"] != kind:
                    continue
                kept, grid = view.get(lvl, (None, None))
                cell = landing_cell(t, pos, kept=kept, grid=grid)
                if cell is None:
                    continue
                points[lvl] = cell_center(t, *cell)
                report["connectors_inferred"].append(f"{kind}-{num} on {lvl} (no label there)")
        if len(points) < 2:
            report["connectors_dropped"].append(f"{kind}-{num}: serves {sorted(points)} only")
            continue
        ev = np.array(list(evidence.values()))
        spreads[f"{kind}-{num}"] = round(float(np.max(np.hypot(*(ev - ev.mean(axis=0)).T))), 1)
        connectors.append({"id": connector_id(kind, num), "kind": kind, "name": CONNECTOR_NAME[kind],
                           "points": {k: v for k, v in sorted(points.items(), key=lambda kv: LEVEL_ORDER[kv[0]])}})
    report["connector_label_spread_units"] = spreads
    return connectors


def polygon_area(poly) -> float:
    p = np.asarray(poly, dtype=float)
    x, y = p[:, 0], p[:, 1]
    return float(abs(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1))) / 2)


def building_axis(results):
    """The building's central axis (x in the map frame): the middle of the largest public hall on
    the first floor (the mandir prayer hall, which the plan is laid out around). (None, None) when
    that floor has no public hall."""
    t = next((t for t in results if t.plan.level == REFERENCE_LEVEL), None)
    halls = [rm for rm in (t.rooms_out if t else []) if rm["public"] and rm["kind"] == "hall"]
    if not halls:
        return None, None
    hall = max(halls, key=lambda rm: polygon_area(rm["polygon"]))
    xs = np.asarray(hall["polygon"], dtype=float)[:, 0]
    return float((xs.min() + xs.max()) / 2), hall["id"]


def assign_sides(results, connectors, side_args, report):
    """Each connector's side of the map ("left" / "right", None = on the axis: anyone), from its
    landings' mean x against building_axis(), then the --side overrides. Exits on an override
    for a connector that isn't on the map (nothing is written)."""
    axis, hall_id = building_axis(results)
    report["side_axis"] = {"room": hall_id, "x": None if axis is None else round(axis, 1)}
    ids = {cn["id"] for cn in connectors}
    unknown = sorted(set(side_args) - ids)
    if unknown:
        sys.exit(f"--side: no such stair / elevator on the map: {', '.join(unknown)} (the map has {', '.join(sorted(ids))})")
    sides = {}
    for cn in connectors:
        x = float(np.mean([p[0] for p in cn["points"].values()]))
        d = None if axis is None else x - axis
        side = None if d is None or abs(d) < SIDE_AXIS_MIN else ("right" if d > 0 else "left")
        how = "geometry" if d is not None else "no axis (no public hall on the first floor)"
        if cn["id"] in side_args:
            given = side_args[cn["id"]]
            side = None if given == "none" else given
            how = "--side"
        if side:
            cn["side"] = side
        else:
            cn.pop("side", None)
        sides[cn["id"]] = {"side": side or "none (everyone)", "x": round(x, 1),
                           "from_axis": None if d is None else round(d, 1), "set_by": how}
    report["connector_sides"] = sides
    return axis


def assign_places(results, connectors, place_args, axis, report):
    """Each connector's place in the building, which is how guests are told which one to take (the
    building has no stair signs): "foyer" when it is near the central axis (within PLACE_CENTRAL of
    the building's half width: beside the main foyer), else "side" when it is in the half of the
    building the main lobby is in, "back" in the far half; then the --place overrides. None when
    there is no axis, or (off the axis) no lobby to tell front from back. Exits on an override for
    a connector that isn't on the map."""
    ids = {cn["id"] for cn in connectors}
    unknown = sorted(set(place_args) - ids)
    if unknown:
        sys.exit(f"--place: no such stair / elevator on the map: {', '.join(unknown)} (the map has {', '.join(sorted(ids))})")
    t = next((t for t in results if t.plan.level == REFERENCE_LEVEL), None)
    half = ymid = front_low = None
    lobby_id = None
    if t is not None and axis is not None:
        pts = np.vstack([np.asarray(rm["polygon"], dtype=float) for rm in t.rooms_out])
        (x0, y0), (x1, y1) = pts.min(axis=0), pts.max(axis=0)
        half = max(axis - x0, x1 - axis)
        ymid = (y0 + y1) / 2
        lobbies = [rm for rm in t.rooms_out if rm["public"] and rm["kind"] == "lobby" and re.search(r"LOBBY|FOYER|ENTRANCE", rm["raw"].upper())]
        if lobbies:
            lobby = max(lobbies, key=lambda rm: polygon_area(rm["polygon"]))
            lobby_id = lobby["id"]
            front_low = bool(lobby["label"][1] < ymid)
    places = {}
    for cn in connectors:
        x = float(np.mean([q[0] for q in cn["points"].values()]))
        y = float(np.mean([q[1] for q in cn["points"].values()]))
        place, how = None, "geometry"
        if half is None:
            how = "no axis (no public hall on the first floor)"
        elif abs(x - axis) < PLACE_CENTRAL * half:
            place = "foyer"
        elif front_low is None:
            how = "no main lobby on the first floor to tell front from back"
        else:
            place = "side" if (y < ymid) == front_low else "back"
        if cn["id"] in place_args:
            given = place_args[cn["id"]]
            place = None if given == "none" else given
            how = "--place"
        if place:
            cn["place"] = place
        else:
            cn.pop("place", None)
        places[cn["id"]] = {"place": place or "none", "x": round(x, 1), "y": round(y, 1), "set_by": how}
    report["connector_places"] = places
    report["place_frame"] = {"lobby": lobby_id, "front": None if front_low is None else ("low y" if front_low else "high y"),
                             "half_width": None if half is None else round(float(half), 1)}


# ---------------------------------------------------------------------------------------------
# Entries


def compute_entries(t, kept=None, is_open=None, key="entry", only=None, way_is_corridor=False):
    """Each open room's entry: a kept cell just inside its main door (the door cluster leading to
    circulation first, then a hall, then the biggest). The defaults are the delegates' map: the
    level's kept floor, public rooms that aren't staff only, written to "entry". The Pujya Santo
    view (settle_sant()) passes its own floor (`kept`), which rooms are open (`is_open`), the key to
    write (`key`), the rooms to write it on (`only`; the others are left as they are) and
    `way_is_corridor`: a door into a residence corridor-like room ("way") counts as circulation."""
    rooms = t.rooms
    grid = t.kept if kept is None else kept
    if is_open is None:
        is_open = lambda rm: rm["public"] and not rm.get("closed")  # noqa: E731
    cr = t.cell_room
    rows, cols = grid.shape
    for i, rm in enumerate(rooms):
        if only is not None and not only(rm):
            continue
        if not is_open(rm):
            rm[key] = None
            continue
        cells = grid & (cr == i)
        if not cells.any():
            # too small for a cell: the nearest kept cell within a foot of the room
            m = ndi.binary_dilation(cr == i, np.ones((3, 3), bool)) & grid
            if m.any():
                rr, cc = np.nonzero(m)
                ctr = t.grid_origin + (np.stack([cc, rr], axis=1) + 0.5) * CELL
                k = int(np.argmin(np.hypot(*(ctr - rm["label"]).T)))
                rm[key] = ctr[k]
            elif key != "entry":
                rm[key] = None
            continue
        rr, cc = np.nonzero(cells)
        doors = []
        for r, c in zip(rr, cc):
            for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                nr, nc = r + dr, c + dc
                if 0 <= nr < rows and 0 <= nc < cols and grid[nr, nc] and cr[nr, nc] != i:
                    doors.append((r, c, nr, nc))
                    break
        if not doors:
            ctr = t.grid_origin + (np.stack([cc, rr], axis=1) + 0.5) * CELL
            k = int(np.argmin(np.hypot(*(ctr - rm["label"]).T)))
            rm[key] = ctr[k]
            continue
        # cluster door cells (8-connected) and score them by where they lead
        dmask = np.zeros_like(grid)
        outside_of = {}
        for r, c, nr, nc in doors:
            dmask[r, c] = True
            outside_of[(r, c)] = (nr, nc)
        lab, n = ndi.label(dmask, np.ones((3, 3), bool))
        best = None
        for k in range(1, n + 1):
            pr_, pc_ = np.nonzero(lab == k)
            leads = "other"
            for r, c in zip(pr_, pc_):
                q = [outside_of[(r, c)]]
                seen = {q[0]}
                steps = 0
                found = None
                while q and steps < 60 and found is None:
                    nq = []
                    for a, b in q:
                        o = cr[a, b]
                        if o >= 0 and o != i:
                            found = o
                            break
                        for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                            x, y = a + dr, b + dc
                            if 0 <= x < rows and 0 <= y < cols and grid[x, y] and cr[x, y] != i and (x, y) not in seen:
                                seen.add((x, y))
                                nq.append((x, y))
                    q = nq
                    steps += 1
                if found is not None:
                    kd = rooms[found]["kind"]
                    # open floor (a foyer, "Open Area N") counts as circulation: a hall's main
                    # doors open onto it
                    if kd in ("corridor", "lobby", "exit") or (rooms[found].get("_open") and rooms[found]["public"]) or (
                            way_is_corridor and rooms[found].get("_sant") == "way"):
                        leads = "corridor"
                        break
                    if kd == "hall" and leads != "corridor":
                        leads = "hall"
            ctr = t.grid_origin + (np.array([pc_.mean(), pr_.mean()]) + 0.5) * CELL
            outs = np.array([outside_of[(r, c)] for r, c in zip(pr_, pc_)], float)
            out_ctr = t.grid_origin + (np.array([outs[:, 1].mean(), outs[:, 0].mean()]) + 0.5) * CELL
            score = ({"corridor": 0, "hall": 1, "other": 2}[leads], -len(pr_), float(np.hypot(*(ctr - rm["label"]))))
            if best is None or score < best[0]:
                best = (score, ctr, out_ctr)
        _, ctr, out_ctr = best
        inward = ctr - out_ctr
        nrm = np.hypot(*inward)
        target = ctr + (inward / nrm * 1.5 * CELL if nrm > 1e-6 else 0)
        ctrs = t.grid_origin + (np.stack([cc, rr], axis=1) + 0.5) * CELL
        k = int(np.argmin(np.hypot(*(ctrs - target).T)))
        rm[key] = ctrs[k]


# ---------------------------------------------------------------------------------------------
# Door openings (for flow rules: src/lib/venue/flowRules.ts)


DOOR_SIDES = ("n", "e", "s", "w")
DOOR_TO_REACH = 10  # cells: how far past a doorway (a gap in no room) the room on the other side is looked for


def cells_in_polygon(poly, rows, cols, origin):
    """The cells of a grid (rows x cols, `origin` its top-left corner) whose centres lie inside `poly`,
    by the even-odd rule exactly as pointInPolygon() in src/lib/venue/view.ts (the same operations in
    the same order, so the app finds the same cells)."""
    poly = np.asarray(poly, float)
    out = np.zeros((rows, cols), bool)
    x0, y0 = poly.min(axis=0)
    x1, y1 = poly.max(axis=0)
    c0 = max(0, int(math.floor((x0 - origin[0]) / CELL)))
    c1 = min(cols - 1, int(math.floor((x1 - origin[0]) / CELL)))
    r0 = max(0, int(math.floor((y0 - origin[1]) / CELL)))
    r1 = min(rows - 1, int(math.floor((y1 - origin[1]) / CELL)))
    if c1 < c0 or r1 < r0:
        return out
    X = origin[0] + (np.arange(c0, c1 + 1) + 0.5) * CELL
    Y = origin[1] + (np.arange(r0, r1 + 1) + 0.5) * CELL
    X, Y = np.meshgrid(X, Y)
    inside = np.zeros(X.shape, bool)
    n = len(poly)
    j = n - 1
    with np.errstate(divide="ignore", invalid="ignore"):
        for i in range(n):
            xi, yi = poly[i]
            xj, yj = poly[j]
            cross = (yi > Y) != (yj > Y)
            xint = ((xj - xi) * (Y - yi)) / (yj - yi) + xi
            inside ^= cross & (X < xint)
            j = i
    out[r0: r1 + 1, c0: c1 + 1] = inside
    return out


def room_doors(rid, poly, g, origin, cell_room, rooms):
    """A room's door openings on a finished walkable grid `g` (the delegates' kept floor, as written to
    the JSON, `origin` its corner, both rounded as written): the walkable cells outside the outline
    that touch (8-neighbour) a walkable cell inside it, in 8-connected groups. Each: id
    "<room id>:<side><n>" (the side of the room's box its middle is nearest, n / e / s / w; numbered
    west to east on n / s, north to south on e / w), "at" (the middle of its cells), "width" (its
    extent) and "to" (the room on the other side: most of its cells' room, else the first room past
    the doorway; None when there is none). The app (flowRules.ts doorOpenings()) groups the same
    cells, so a rule's door id finds its opening by "at"."""
    rows, cols = g.shape
    inside = cells_in_polygon(poly, rows, cols, origin) & g
    if not inside.any():
        return []
    ring = ndi.binary_dilation(inside, EIGHT) & ~inside & g
    lab, n = ndi.label(ring, EIGHT)
    if n == 0:
        return []
    poly = np.asarray(poly, float)
    bx0, by0 = poly.min(axis=0)
    bx1, by1 = poly.max(axis=0)
    cx, cy = (bx0 + bx1) / 2, (by0 + by1) / 2
    hw, hh = max((bx1 - bx0) / 2, 1e-6), max((by1 - by0) / 2, 1e-6)
    own = next((k for k, rm in enumerate(rooms) if rm["id"] == rid), -1)
    found = []
    for k in range(1, n + 1):
        ys, xs = np.nonzero(lab == k)
        x = float(origin[0] + (xs.mean() + 0.5) * CELL)
        y = float(origin[1] + (ys.mean() + 0.5) * CELL)
        width = float((max(xs.max() - xs.min(), ys.max() - ys.min()) + 1) * CELL)
        # the room on the other side: most of the opening's cells, else past the doorway
        owners = [int(cell_room[r, c]) for r, c in zip(ys, xs) if cell_room[r, c] >= 0 and cell_room[r, c] != own]
        to = None
        if owners:
            to = max(set(owners), key=owners.count)
        else:
            seen = set(zip(ys.tolist(), xs.tolist()))
            frontier = list(seen)
            for _ in range(DOOR_TO_REACH):
                nxt = []
                hit = []
                for r, c in frontier:
                    for dr, dc in N8:
                        rr, cc = r + dr, c + dc
                        if not (0 <= rr < rows and 0 <= cc < cols) or (rr, cc) in seen or not g[rr, cc] or inside[rr, cc]:
                            continue
                        seen.add((rr, cc))
                        o = int(cell_room[rr, cc])
                        if o >= 0 and o != own:
                            hit.append(o)
                        nxt.append((rr, cc))
                if hit:
                    to = max(set(hit), key=hit.count)
                    break
                frontier = nxt
        to_id = None if to is None or rooms[to].get("_drop") else rooms[to]["id"]
        dx, dy = (x - cx) / hw, (y - cy) / hh
        side = ("e" if dx > 0 else "w") if abs(dx) >= abs(dy) else ("s" if dy > 0 else "n")
        found.append({"side": side, "at": [round(x, 1), round(y, 1)], "width": round(width, 1), "to": to_id})
    out = []
    for side in DOOR_SIDES:
        here = [d for d in found if d["side"] == side]
        here.sort(key=lambda d: (d["at"][0], d["at"][1]) if side in ("n", "s") else (d["at"][1], d["at"][0]))
        for i, d in enumerate(here, start=1):
            out.append({"id": f"{rid}:{side}{i}", "at": d["at"], "width": d["width"], "to": d["to"]})
    return out


# ---------------------------------------------------------------------------------------------
# Walls path


def walls_path(t) -> tuple[str, list]:
    """Heavy strokes (walls, columns, partitions, the stage edge) chained into polylines and
    simplified; door symbols, fixtures, text and site work outside the building are left out."""
    cv = t.canvas
    near = edt_free(~t.interior) <= 6.0 * RASTER  # within 6 units of the building's floor

    def touches_building(pts):
        for a, b in zip(pts[:-1], pts[1:]):
            n = max(2, int(np.hypot(*(b - a)) / 2.0) + 1)
            q = cv.px(a + (b - a) * np.linspace(0, 1, n)[:, None])
            r = np.clip(np.round(q[:, 1]).astype(int), 0, cv.H - 1)
            c = np.clip(np.round(q[:, 0]).astype(int), 0, cv.W - 1)
            if near[r, c].any():
                return True
        return False

    erase = t.erase if t.erase.any() else None

    def kept_parts(a, b):
        """The segment a-b without what lies in t.erase (a partition --merge removed), in half units."""
        if erase is None:
            return [(a, b)]
        n = max(2, int(math.ceil(np.hypot(*(b - a)) * 2)) + 1)
        f = np.linspace(0, 1, n)
        q = cv.px(a + (b - a) * f[:, None])
        r = np.clip(np.round(q[:, 1]).astype(int), 0, cv.H - 1)
        c = np.clip(np.round(q[:, 0]).astype(int), 0, cv.W - 1)
        gone = erase[r, c]
        if not gone.any():
            return [(a, b)]
        out, start = [], None
        for i in range(n):
            if not gone[i] and start is None:
                start = i
            if start is not None and (gone[i] or i == n - 1):
                end = i if not gone[i] else i - 1
                if end > start:
                    out.append((np.round((a + (b - a) * f[start]) * 2) / 2, np.round((a + (b - a) * f[end]) * 2) / 2))
                start = None
        return out

    segs = []
    for s in t.arch_open:
        if s.fill or s.pen < WALL_MIN_PEN:
            continue
        lo, hi = s.bbox()
        if max(hi - lo) < 2.5 or not touches_building(s.pts):
            continue
        p = np.round(s.pts * 2) / 2  # snap to half units
        if s.op == "c":
            p = douglas_peucker(p, 0.6)
        for a, b in zip(p[:-1], p[1:]):
            for a2, b2 in kept_parts(a, b):
                if np.hypot(*(b2 - a2)) >= 0.5:
                    segs.append((tuple(a2), tuple(b2)))
    # dedupe
    uniq = {}
    for a, b in segs:
        key = (a, b) if a <= b else (b, a)
        uniq[key] = True
    segs = list(uniq)
    # chain through degree-2 vertices
    adj = defaultdict(list)
    for i, (a, b) in enumerate(segs):
        adj[a].append(i)
        adj[b].append(i)
    used = [False] * len(segs)
    lines = []

    def walk(start_pt, i):
        pts = [start_pt]
        cur = start_pt
        while True:
            used[i] = True
            a, b = segs[i]
            nxt = b if a == cur else a
            pts.append(nxt)
            cur = nxt
            if len(adj[cur]) != 2:
                break
            j = adj[cur][0] if adj[cur][0] != i else adj[cur][1]
            if used[j]:
                break
            i = j
        return pts

    for v, ids in adj.items():
        if len(ids) != 2:
            for i in ids:
                if not used[i]:
                    lines.append(walk(v, i))
    for i in range(len(segs)):
        if not used[i]:
            lines.append(walk(segs[i][0], i))
    parts = []
    polylines = []
    for pl in lines:
        p = douglas_peucker(np.array(pl, float), 0.4)
        polylines.append(p)
        x, y = p[0]
        cmd = [f"M{fmt(x)} {fmt(y)}"]
        prev = np.round(p[0], 1)
        for q in p[1:]:
            d = np.round(q - prev, 1)
            cmd.append(f"l{fmt(d[0])} {fmt(d[1])}")
            prev = prev + d
        parts.append("".join(cmd))
    return "".join(parts), polylines


def fmt(v: float) -> str:
    s = f"{round(float(v), 1):.1f}"
    if s.endswith(".0"):
        s = s[:-2]
    if s == "-0":
        s = "0"
    return s


def pack_bits(grid: np.ndarray) -> str:
    return base64.b64encode(np.packbits(grid.astype(np.uint8).ravel(), bitorder="big").tobytes()).decode("ascii")


# ---------------------------------------------------------------------------------------------
# Preview


KIND_COLOURS = {
    "room": (214, 232, 226), "hall": (190, 222, 213), "corridor": (247, 240, 226), "lobby": (240, 228, 205),
    "restroom": (206, 222, 240), "stair": (246, 200, 186), "elevator": (246, 200, 186), "exit": (225, 240, 215),
    "dining": (250, 220, 200), "other": (232, 226, 244),
}


def load_font(size):
    for f in ("arial.ttf", "DejaVuSans.ttf", "C:/Windows/Fonts/arial.ttf"):
        try:
            return ImageFont.truetype(f, size)
        except OSError:
            continue
    return ImageFont.load_default()


def render_preview(t, level_json, connectors, routes, path, axis=None, scale=1.0):
    b = level_json["bounds"]
    W = int(b["width"] * scale) + 1
    # the header: the level, then the routes on it (per track), wrapped to the picture's width
    f_head = load_font(16)
    measure = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    words = [f"{t.plan.name} ({t.plan.level}, order {t.plan.order})  rooms {len(t.rooms)}  routes:"] + [
        f"{r['from']}->{r['to']} [{r['track']}]{'' if r['ok'] else ' FAILED'};"
        for r in routes if any(l == t.plan.level for l, _ in r["legs"]) or not r["ok"]]
    head = [""]
    for w in words:
        line = f"{head[-1]} {w}".strip()
        if head[-1] and measure.textlength(line, font=f_head) > W - 20:
            head.append(w)
        else:
            head[-1] = line
    top = 20 + 20 * len(head)
    H = int(b["height"] * scale) + top
    img = Image.new("RGB", (W, H), (255, 255, 255))
    dr = ImageDraw.Draw(img, "RGBA")
    ox, oy = b["x"], b["y"] - top / scale

    def P(pt):
        return ((pt[0] - ox) * scale, (pt[1] - oy) * scale)

    # walkable cells
    g = t.kept
    rr, cc = np.nonzero(g)
    for r, c in zip(rr, cc):
        x, y = t.grid_origin + np.array([c, r]) * CELL
        dr.rectangle([P((x, y)), P((x + CELL, y + CELL))], fill=(120, 200, 120, 40))
    sant_floor = getattr(t, "sant_kept", None)
    if sant_floor is not None:  # the santos' extra floor (Pujya Santo view), violet
        rr, cc = np.nonzero(sant_floor & ~t.kept)
        for r, c in zip(rr, cc):
            x, y = t.grid_origin + np.array([c, r]) * CELL
            dr.rectangle([P((x, y)), P((x + CELL, y + CELL))], fill=(150, 110, 220, 50))
    for rm in t.rooms_out:
        poly = [P(q) for q in rm["polygon"]]
        if rm["public"] and rm.get("closed"):  # staff only: drawn and named, no floor
            dr.polygon(poly, fill=(218, 218, 218, 200), outline=(110, 110, 110, 255))
        elif rm["public"]:
            col = KIND_COLOURS.get(rm["kind"], (220, 220, 220))
            dr.polygon(poly, fill=col + (200,), outline=(60, 110, 100, 255))
        elif rm.get("_sant"):  # the Pujya Santo view only: pale violet, dashed outline
            dr.polygon(poly, fill=(226, 214, 246, 200))
            for pa, pb in zip(poly, poly[1:] + poly[:1]):
                n = max(1, int(math.hypot(pb[0] - pa[0], pb[1] - pa[1]) // 6))
                for k in range(0, n, 2):
                    f0, f1 = k / n, min(1.0, (k + 1) / n)
                    dr.line([(pa[0] + (pb[0] - pa[0]) * f0, pa[1] + (pb[1] - pa[1]) * f0),
                             (pa[0] + (pb[0] - pa[0]) * f1, pa[1] + (pb[1] - pa[1]) * f1)], fill=(110, 60, 180, 255), width=1)
        else:
            dr.polygon(poly, fill=(150, 150, 150, 200), outline=(90, 90, 90, 255))
    for pl in t.wall_polylines:
        dr.line([P(q) for q in pl], fill=(20, 20, 20, 255), width=max(1, int(round(1.2 * scale))))
    f_small = load_font(max(9, int(9 * scale)))
    for rm in t.rooms_out:
        x, y = P(rm["label"])
        if rm["public"]:
            txt = rm["name"] + (f" {rm['number']}" if rm["number"] else "") + (" [staff only]" if rm.get("closed") else "")
            tw = dr.textlength(txt, font=f_small)
            dr.text((x - tw / 2, y - 6 * scale), txt, fill=(95, 95, 95) if rm.get("closed") else (0, 60, 150), font=f_small)
        elif rm.get("_sant"):
            txt = rm["name"] + (f" {rm['number']}" if rm["number"] else "") + f" [santos: {rm['_sant']}]"
            tw = dr.textlength(txt, font=f_small)
            dr.text((x - tw / 2, y - 6 * scale), txt, fill=(110, 60, 180), font=f_small)
            se = rm.get("_sant_entry")
            if se is not None:
                ex, ey = P(se)
                dr.ellipse([ex - 3, ey - 3, ex + 3, ey + 3], fill=(130, 70, 200))
        if rm["entry"] is not None:
            ex, ey = P(rm["entry"])
            dr.ellipse([ex - 3, ey - 3, ex + 3, ey + 3], fill=(0, 120, 255) if rm["public"] else (120, 120, 120))
    # door openings of the rooms (not corridors): their side + number, as flow rules name them
    f_door = load_font(max(8, int(8 * scale)))
    by_id = {rm["id"]: rm for rm in t.rooms_out}
    for rid, ds in getattr(t, "doors_out", {}).items():
        if by_id.get(rid, {}).get("kind") == "corridor":
            continue
        for d in ds:
            x, y = P(d["at"])
            dr.ellipse([x - 2, y - 2, x + 2, y + 2], fill=(200, 0, 120))
            dr.text((x + 3, y - 9), d["id"].split(":")[1], fill=(200, 0, 120), font=f_door)
    if axis is not None:  # the central axis the connectors' sides are measured against (dashed)
        ax, _ = P((axis, 0))
        y0, y1 = P((0, b["y"]))[1], P((0, b["y"] + b["height"]))[1]
        for y in np.arange(y0, y1, 24):
            dr.line([(ax, y), (ax, min(y + 12, y1))], fill=(0, 0, 0, 160), width=2)
        dr.text((ax + 6, y0 + 4), "axis: Behno (left) | Bhaio (right)", fill=(0, 0, 0), font=f_small)
    for cn in connectors:
        p = cn["points"].get(t.plan.level)
        if p is None:
            continue
        x, y = P(p)
        col = (230, 90, 0) if cn["kind"] == "stair" else (160, 0, 200)
        dr.rectangle([x - 6, y - 6, x + 6, y + 6], fill=col)
        dr.text((x + 8, y - 8), f"{cn['id']}: {cn.get('place') or 'no place'}, {cn.get('side') or 'no side'}", fill=col, font=f_small)
    for cn in connectors:  # landings only santos use: hollow squares
        p = (cn.get("santPoints") or {}).get(t.plan.level)
        if p is None:
            continue
        x, y = P(p)
        col = (230, 90, 0) if cn["kind"] == "stair" else (160, 0, 200)
        dr.rectangle([x - 6, y - 6, x + 6, y + 6], outline=col, width=2)
        dr.text((x + 8, y - 8), f"{cn['id']}: santos", fill=col, font=f_small)
    palette = [(220, 20, 60), (0, 140, 70), (30, 60, 220), (200, 120, 0), (140, 0, 160), (0, 150, 170)]
    for k, rt in enumerate(routes):
        col = palette[k % len(palette)]
        for lvl, pts in rt["legs"]:
            if lvl != t.plan.level or len(pts) < 2:
                continue
            dr.line([P(q) for q in pts], fill=col + (255,), width=3)
            sx, sy = P(pts[0])
            ex, ey = P(pts[-1])
            dr.ellipse([sx - 5, sy - 5, sx + 5, sy + 5], outline=col, width=2)
            dr.rectangle([ex - 5, ey - 5, ex + 5, ey + 5], outline=col, width=2)
    for i, line in enumerate(head):
        dr.text((10, 10 + 20 * i), line, fill=(0, 0, 0), font=f_head)
    img.save(path)


def render_grid_debug(t, level_json, path, scale=1.0):
    """The walkable grid: kept cells green, other walkable cells orange, room outlines, door
    hinges (blue: door pens, magenta: thin doors with a leaf), walls black."""
    b = level_json["bounds"]
    W, H = int(b["width"] * scale) + 1, int(b["height"] * scale) + 1
    img = Image.new("RGB", (W, H), (255, 255, 255))
    dr = ImageDraw.Draw(img)
    ox, oy = b["x"], b["y"]

    def P(pt):
        return ((pt[0] - ox) * scale, (pt[1] - oy) * scale)

    for r, c in zip(*np.nonzero(t.grid)):
        x, y = t.grid_origin + np.array([c, r]) * CELL
        dr.rectangle([P((x + 1, y + 1)), P((x + CELL - 1, y + CELL - 1))], fill=(120, 210, 120) if t.kept[r, c] else (255, 170, 60))
    for rm in t.rooms_out:
        dr.polygon([P(q) for q in rm["polygon"]], outline=(0, 90, 200) if rm["public"] else (150, 150, 150))
    for pl in t.wall_polylines:
        dr.line([P(q) for q in pl], fill=(0, 0, 0), width=1)
    for d in t.doors:
        x, y = P(d["hinge"])
        dr.ellipse([x - 3, y - 3, x + 3, y + 3], outline=(200, 0, 200) if d.get("thin") else (0, 0, 255))
    img.save(path)


# ---------------------------------------------------------------------------------------------
# Routing across levels (for the previews / report)


def usable(cn, track) -> bool:
    """As connectorUsable() in src/lib/venue/route.ts: a guest of `track` ("bhaio" / "behno",
    None = no gender on file: any) may use this stair / elevator."""
    if track is None or not cn.get("side"):
        return True
    if cn["kind"] == "elevator" and not ELEVATORS_FOLLOW_SIDE:
        return True
    return cn["side"] == TRACK_SIDE[track]


def route(results, connectors, a, b, track=None):
    """Room a -> room b as the app routes a guest without Step-free (src/lib/venue/route.ts):
    over the stairs `track` may use, and over their elevators as well only when those stairs
    don't get there."""
    r = route_over(results, connectors, a, b, track, {"stair"})
    if not r["ok"] and r["why"] == "no path":
        r = route_over(results, connectors, a, b, track, {"stair", "elevator"})
    return r


def route_over(results, connectors, a, b, track, kinds):
    """Room a -> room b: one A* over all level grids (8-neighbour moves, no corner cutting),
    changing level only between the landings of one connector of `kinds` that `track` may use."""
    by_level = {t.plan.level: t for t in results}
    found = {}
    for t in results:
        for rm in t.rooms_out:
            if rm["id"] in (a, b):
                found[rm["id"]] = (t, rm)
    if a not in found or b not in found or found[a][1]["entry"] is None or found[b][1]["entry"] is None:
        return {"from": a, "to": b, "track": track or "any", "ok": False, "legs": [], "why": "no entry"}
    ta, rma = found[a]
    tb, rmb = found[b]
    start = (ta.plan.level,) + grid_cell(ta, rma["entry"])
    goal = (tb.plan.level,) + grid_cell(tb, rmb["entry"])
    # climbing costs as in the app's router (LEVEL_COST, in cells of a ~300 ft building): a stair
    # 37 per storey, an elevator 77 + 9 per storey, storeys = the levels' order (B 0, 1, 2, the
    # mezzanine 3 on top), and 185 more to a level beyond the storeys the route spans
    storey = LEVEL_ORDER
    span = sorted((storey[start[0]], storey[goal[0]]))
    jumps = defaultdict(list)  # (level, r, c) -> [(level, r, c, connector id, cost)]
    for cn in connectors:
        if not usable(cn, track) or cn["kind"] not in kinds:
            continue
        ends = [(lvl,) + grid_cell(by_level[lvl], p) for lvl, p in cn["points"].items()]
        for x in ends:
            for y in ends:
                if x != y:
                    floors = abs(storey[x[0]] - storey[y[0]])
                    w = 37.0 * floors if cn["kind"] == "stair" else 77.0 + 9.0 * floors
                    if not span[0] <= storey[y[0]] <= span[1]:
                        w += 185.0
                    jumps[x].append(y + (cn["id"], w))
    gx, gy = rmb["entry"]
    # as the app's router (src/lib/venue/route.ts): walking through a room, hall, shop or restroom
    # that is neither end costs three times more, so routes keep to corridors and lobbies
    exempt = {(start[0], int(ta.cell_room[start[1], start[2]])), (goal[0], int(tb.cell_room[goal[1], goal[2]]))}
    # as the app, the route ends at the destination room's nearest door: any kept cell in it
    dest_k = next((i for i, rm in enumerate(tb.rooms) if rm is rmb), -1)
    exempt.add((goal[0], dest_k))
    goal_cells = set()
    if dest_k >= 0:
        rr, cc = np.nonzero(tb.kept & (tb.cell_room == dest_k))
        goal_cells = {(tb.plan.level, int(r), int(c)) for r, c in zip(rr, cc)}
    goal_cells.add(goal)
    gctr = np.array([cell_center(tb, r, c) for _, r, c in goal_cells])
    gx0, gy0 = gctr.min(axis=0)
    gx1, gy1 = gctr.max(axis=0)

    def through(state):
        t = by_level[state[0]]
        k = int(t.cell_room[state[1], state[2]])
        if k < 0 or (state[0], k) in exempt:
            return 1.0
        rm = t.rooms[k]
        return 3.0 if rm["public"] and rm["kind"] in ("room", "hall", "dining", "restroom") else 1.0

    def h(state):
        t = by_level[state[0]]
        x, y = cell_center(t, state[1], state[2])
        return math.hypot(max(gx0 - x, 0, x - gx1), max(gy0 - y, 0, y - gy1)) / CELL

    g = {start: 0.0}
    came = {start: None}
    pq = [(h(start), 0.0, start)]
    while pq:
        _, gc, cur = heapq.heappop(pq)
        if cur in goal_cells:
            goal = cur
            break
        if gc > g.get(cur, 1e18):
            continue
        lvl, r, c = cur
        grid = by_level[lvl].kept
        rows, cols = grid.shape
        nbrs = []
        for dr, dc in N8:
            nr, nc = r + dr, c + dc
            if not (0 <= nr < rows and 0 <= nc < cols) or not grid[nr, nc]:
                continue
            if dr and dc and not (grid[r + dr, c] and grid[r, c + dc]):
                continue
            nbrs.append(((lvl, nr, nc), (1.4142 if dr and dc else 1.0) * through((lvl, nr, nc))))
        for j in jumps.get(cur, ()):
            nbrs.append((j[:3], j[4]))
        for nxt, w in nbrs:
            ng = gc + w
            if ng < g.get(nxt, 1e18):
                g[nxt] = ng
                came[nxt] = cur
                heapq.heappush(pq, (ng + h(nxt), ng, nxt))
    if goal not in came:
        return {"from": a, "to": b, "track": track or "any", "ok": False, "legs": [], "why": "no path"}
    seq = []
    cur = goal
    while cur is not None:
        seq.append(cur)
        cur = came[cur]
    seq.reverse()
    legs, via = [], []
    prev = None
    for st in seq:
        t = by_level[st[0]]
        if not legs or legs[-1][0] != st[0]:
            if legs:
                cid = next((j[3] for j in jumps.get(prev, ()) if j[:3] == st), "?")
                via.append(f"{cid} {legs[-1][0]}->{st[0]}")
            legs.append((st[0], []))
        legs[-1][1].append(cell_center(t, st[1], st[2]))
        prev = st
    return {"from": a, "to": b, "track": track or "any", "ok": True, "legs": legs, "via": via,
            "length_ft": round(g[goal] * CELL / 9.0)}


# ---------------------------------------------------------------------------------------------


def parse_arguments(args):
    """The room / connector arguments, checked for shape (ids are checked against the map later).
    Returns (overrides for build_level(), side_args, place_args, drop_connectors, drop_landings)."""
    def pairs(specs, pattern, flag, example):
        out = {}
        for spec in specs:
            m = pattern.match(spec.strip())
            if not m:
                sys.exit(f"{flag} {spec}: expected {example}")
            if m["id"] in out:
                sys.exit(f"{flag} {m['id']} is given more than once")
            out[m["id"]] = m[2]
        return out

    side_args = pairs(args.side, SIDE_ARG_RE, "--side", '<connector id>=left|right|none, e.g. "stair-3=right"')
    place_args = pairs(args.place, PLACE_ARG_RE, "--place", '<connector id>=foyer|side|back|none, e.g. "stair-3=back"')
    drop_connectors = set()
    for spec in args.drop_connector:
        if not CONNECTOR_ID_RE.match(spec.strip()):
            sys.exit(f'--drop-connector {spec}: expected a connector id, e.g. "elev-9"')
        drop_connectors.add(spec.strip())
    drop_landings = set()
    for spec in args.drop_landing:
        m = LANDING_ARG_RE.match(spec.strip())
        if not m or m["level"] not in LEVEL_ORDER:
            sys.exit(f'--drop-landing {spec}: expected <connector id>:<level> with a level of {", ".join(LEVEL_ORDER)}, e.g. "stair-9:B"')
        drop_landings.add((m["id"], m["level"]))
    landing_pins = {}
    for spec in args.landing:
        m = LANDING_PIN_RE.match(spec.strip())
        if not m or m["level"] not in LEVEL_ORDER:
            sys.exit(f'--landing {spec}: expected <connector id>:<level>=<x>,<y> with a level of {", ".join(LEVEL_ORDER)}, e.g. "stair-9:B=1234.5,567.5"')
        key = (m["id"], m["level"])
        if key in landing_pins:
            sys.exit(f"--landing {m['id']}:{m['level']} is given more than once")
        if key in drop_landings:
            sys.exit(f"--landing and --drop-landing both name {m['id']}:{m['level']}")
        landing_pins[key] = (float(m["x"]), float(m["y"]))
    merges = []
    for spec in args.merge:
        ids = [x.strip() for x in spec.split("+")]
        if len(ids) != 2 or not all(ids) or ids[0] == ids[1]:
            sys.exit(f'--merge {spec}: expected <room id>+<room id>, e.g. "M-999+M-998"')
        if any(x in pair for pair in merges for x in ids):
            sys.exit(f"--merge {spec}: a room can be in one --merge only")
        merges.append((ids[0], ids[1]))
    partitions = []
    for spec in args.partition:
        ids = [x.strip() for x in spec.split("+")]
        if len(ids) != 2 or not all(ids) or ids[0] == ids[1]:
            sys.exit(f'--partition {spec}: expected <room id>+<room id>, e.g. "2-999A+2-999B"')
        if (ids[0], ids[1]) in partitions or (ids[1], ids[0]) in partitions:
            sys.exit(f"--partition {spec} is given more than once")
        partitions.append((ids[0], ids[1]))
    passages = {x.strip() for x in args.passage}
    names = {}
    for spec in args.name:
        rid, sep, name = spec.partition("=")
        rid, name = rid.strip(), " ".join(name.split())
        if not sep or not rid or not name:
            sys.exit(f'--name {spec}: expected <room id>=<name>, e.g. "B-999=Large Banquet Hall"')
        if rid in names:
            sys.exit(f"--name {rid} is given more than once")
        names[rid] = name
    # the Pujya Santo view's residence (classify_sant(), settle_sant())
    sant_class = {}
    for spec in args.sant_class:
        m = SANT_CLASS_ARG_RE.match(spec.strip())
        if not m:
            sys.exit(f'--sant-class {spec}: expected <room id>=own|shared|way, e.g. "1-999=way"')
        if m["id"] in sant_class:
            sys.exit(f"--sant-class {m['id']} is given more than once")
        sant_class[m["id"]] = m["cls"]

    def room_pairs(specs, flag):
        out = set()
        for spec in specs:
            m = SANT_PAIR_RE.match(spec.strip())
            if not m or m["a"] == m["b"]:
                sys.exit(f'{flag} {spec}: expected <santo room id>:<other room id>, e.g. "1-999:1-998"')
            out.add((m["a"], m["b"]))
        return out

    sant_open = room_pairs(args.sant_open, "--sant-open")
    sant_seal = room_pairs(args.sant_seal, "--sant-seal")
    overrides = {"public": set(args.public), "private": set(args.private), "closed": set(args.closed),
                 "merge": merges, "partition": partitions, "passage": passages, "name": names, "landing": landing_pins,
                 "sant": {x.strip() for x in args.sant},
                 "not_sant": {x.strip() for x in args.not_sant}, "sant_class": sant_class,
                 "sant_open": sant_open, "sant_seal": sant_seal}
    both = sorted(overrides["closed"] & overrides["private"])
    if both:
        sys.exit(f"--closed and --private both name {', '.join(both)}: a staff-only room is shown, a private one is not")
    both = sorted(overrides["sant"] & overrides["not_sant"])
    if both:
        sys.exit(f"--sant and --not-sant both name {', '.join(both)}")
    both = sorted(f"{a}:{b}" for a, b in sant_open & sant_seal)
    if both:
        sys.exit(f"--sant-open and --sant-seal both name {', '.join(both)}")
    gone = {b for _, b in merges}
    merged_rooms = {x for pair in merges for x in pair}
    both = sorted(merged_rooms & {x for pair in partitions for x in pair})
    if both:
        sys.exit(f"--merge and --partition both name {', '.join(both)}: a room is either one with its neighbour or divided from it")
    both = sorted(passages & overrides["closed"])
    if both:
        sys.exit(f"--passage and --closed both name {', '.join(both)}: a staff-only room is never a way through")
    for flag in ("public", "private", "closed", "name", "passage", "sant", "not_sant", "sant_class"):
        used = sorted(gone & set(overrides[flag]))
        if used:
            sys.exit(f"--{flag.replace('_', '-')} {', '.join(used)}: that room is merged into another by --merge; use the first id of the pair")
    return overrides, side_args, place_args, drop_connectors, drop_landings


def settle_connectors(results, report, overrides, drop_connectors, drop_landings):
    """The stairs / elevators guests may use, and what each shaft's room is on each level:
      * a connector named with --drop-connector is no connector, and its rooms are staff-only
        (closed) rooms named DROPPED_SHAFT_NAME (hidden with --private <room id>);
      * a shaft room on a level its connector lands on is that stair / elevator (its entry the
        landing);
      * a shaft room on a level it doesn't land on for guests (a landing that only reaches
        back-of-house, staff-only rooms or the private quarters, one taken off with
        --drop-landing, a shaft that is no connector at all) is a plain block (public: false),
        unless --public <room id> keeps it drawn (without directions).
    Changing a room's flags changes the walkable grid, which can change the landings, so this
    repeats until nothing changes. Returns the connectors (their landings as map points)."""
    canon = connector_positions(results)
    all_ids = {connector_id(kind, num) for kind, num in canon}
    unknown = sorted((drop_connectors | {cid for cid, _ in drop_landings}) - all_ids)
    if unknown:
        sys.exit(f"--drop-connector / --drop-landing: no such stair / elevator on the blueprint: {', '.join(unknown)} (it has {', '.join(sorted(all_ids))})")
    number_shafts(results, canon)
    connectors = []
    for attempt in range(5):
        # keep the grid component that is the level's largest (and, below, those holding a landing)
        for t in results:
            if attempt:
                level_grid(t)
            lab, n = ndi.label(t.grid, np.ones((3, 3), bool))
            t.grid_lab = lab
            sizes = np.bincount(lab.ravel())
            sizes[0] = 0
            t.main_comp = int(np.argmax(sizes)) if n else 0
            t.kept = lab == t.main_comp if n else t.grid.copy()
        notes = {"connectors_dropped": [], "connectors_inferred": [], "connector_landings_dropped": []}
        connectors = build_connectors(results, notes, canon)
        # a landing cut off from the level's main floor (a service stair / lift opening only into
        # the kitchen, or one inside the private quarters) is no use to a delegate: that level is
        # dropped from the connector, unless the landing's piece of floor holds a public room of
        # its own (then it is kept, reached by the shaft)
        for t in results:
            lvl = t.plan.level
            for cn in connectors:
                pt = cn["points"].get(lvl)
                if pt is None:
                    continue
                r, c = grid_cell(t, pt)
                comp = int(t.grid_lab[r, c]) if 0 <= r < t.grid.shape[0] and 0 <= c < t.grid.shape[1] else 0
                if comp == t.main_comp:
                    continue
                here = t.grid_lab == comp
                useful = comp > 0 and any(
                    rm["public"] and not rm["_conn"] and bool((here & (t.cell_room == i)).any())
                    for i, rm in enumerate(t.rooms))
                if not useful:
                    del cn["points"][lvl]
                    notes["connector_landings_dropped"].append(f"{cn['id']} on {lvl} (its landing only reaches back-of-house, staff-only rooms or private quarters)")
        # shafts still unnumbered: the nearest connector of their kind landing on their level
        for t in results:
            ids = {rm["id"] for rm in t.rooms}
            for rm in t.rooms:
                if not rm["_conn"] or rm["_conn_num"]:
                    continue
                best = None
                for cn in connectors:
                    pt = cn["points"].get(t.plan.level)
                    if cn["kind"] != rm["_conn_kind"] or pt is None:
                        continue
                    d = float(np.hypot(*(pt - rm["label"])))
                    if d < 200 and (best is None or d < best[0]):
                        best = (d, cn)
                if best and f"{t.plan.level}-{best[1]['id']}" not in ids:
                    ids.discard(rm["id"])
                    rm["id"] = f"{t.plan.level}-{best[1]['id']}"
                    rm["_conn_num"] = best[1]["id"].split("-")[-1]
                    ids.add(rm["id"])
        # the organisers' word: not a stair / elevator for guests, or not on that level
        notes["connectors_dropped_by_argument"] = sorted(drop_connectors)
        connectors = [cn for cn in connectors if cn["id"] not in drop_connectors]
        for cn in connectors:
            for cid, lvl in sorted(drop_landings):
                if cn["id"] == cid and lvl in cn["points"]:
                    del cn["points"][lvl]
                    notes["connector_landings_dropped"].append(f"{cid} on {lvl} (--drop-landing)")
        # --landing: where the organisers' plans have guests reach a stair / elevator on a level
        notes["connector_landings_placed"] = []
        by_lvl = {t.plan.level: t for t in results}
        for (cid, lvl), pt in sorted(overrides["landing"].items()):
            cn = next((c for c in connectors if c["id"] == cid), None)
            if cn is None or lvl not in cn["points"] or lvl not in by_lvl:
                continue  # checked once the stairs / elevators settle
            t = by_lvl[lvl]
            rr, cc = np.nonzero(t.kept)
            ctr = t.grid_origin + (np.stack([cc, rr], axis=1) + 0.5) * CELL
            d = np.hypot(*(ctr - np.asarray(pt)).T)
            k = int(np.argmin(d)) if len(d) else -1
            if k < 0 or d[k] > LANDING_PIN_REACH:
                sys.exit(f"--landing {cid}:{lvl}={pt[0]},{pt[1]}: no walkable floor within {LANDING_PIN_REACH:.0f} units of that point")
            before = cn["points"][lvl]
            cn["points"][lvl] = ctr[k]
            notes["connector_landings_placed"].append(
                f"{cid} on {lvl}: {np.round(before, 1).tolist()} -> {np.round(ctr[k], 1).tolist()} (--landing)")
        for cn in [c for c in connectors if len(c["points"]) < 2]:
            notes["connectors_dropped"].append(f"{cn['id']}: serves {sorted(cn['points'])} only")
            connectors.remove(cn)
        # what each shaft's room is now
        live = {cn["id"]: cn for cn in connectors}
        changed = False
        for t in results:
            lvl = t.plan.level
            for rm in t.rooms:
                if not rm["_conn"]:
                    continue
                cid = shaft_connector_id(rm)
                if rm["id"] in overrides["private"]:
                    state = "private"
                elif cid in drop_connectors:
                    state = "closed"
                elif cid in live and lvl in live[cid]["points"]:
                    state = "shaft"
                else:
                    state = "shown" if rm["id"] in overrides["public"] else "private"
                if rm.get("_state", "shaft") != state:
                    changed = True
                rm["_state"] = state
                rm["public"] = state != "private"
                rm["closed"] = state == "closed"
                rm["kind"] = "room" if state == "closed" else rm["_conn_kind"]
        report.update(notes)
        if not changed:
            break
    else:
        print("the stairs / elevators did not settle after 5 rounds: check report.json", file=sys.stderr)
    unused = sorted(f"{cid}:{lvl}" for cid, lvl in overrides["landing"]
                    if not any(c["id"] == cid and lvl in c["points"] for c in connectors))
    if unused:
        sys.exit(f"--landing: that stair / elevator doesn't land on that level for guests: {', '.join(unused)}")
    # now also keep components holding a landing
    for t in results:
        keep = {t.main_comp}
        for cn in connectors:
            pt = cn["points"].get(t.plan.level)
            if pt is not None:
                r, c = grid_cell(t, pt)
                if t.grid_lab[r, c]:
                    keep.add(int(t.grid_lab[r, c]))
        t.kept = np.isin(t.grid_lab, list(keep))
    return connectors


# ---------------------------------------------------------------------------------------------
# The Pujya Santo view: the sadhus' residence (classify_sant(), settle_sant())


def delegate_snapshot(results, connectors):
    """Everything of the delegates' map settle_sant() could touch: the levels' floors, every room's
    flags, entry, name and label, the rooms written out and the connectors."""
    snap = {"connectors": [cn["id"] for cn in connectors]}
    for t in results:
        lvl = t.plan.level
        snap[("kept", lvl)] = t.kept.copy()
        snap[("grid", lvl)] = t.grid.copy()
        snap[("rooms_out", lvl)] = [rm["id"] for rm in t.rooms_out]
        snap[("rooms", lvl)] = [
            (rm["id"], bool(rm["public"]), bool(rm.get("closed")),
             None if rm["entry"] is None else tuple(float(v) for v in rm["entry"]), rm.get("_state"), rm["name"],
             rm["kind"], rm["number"], tuple(float(v) for v in rm["label"]))
            for rm in t.rooms]
    for cn in connectors:
        snap[("connector", cn["id"])] = (
            tuple((k, float(v[0]), float(v[1])) for k, v in cn["points"].items()), cn.get("side"), cn.get("place"), cn["name"], cn["kind"])
    return snap


def snapshot_drift(before, after) -> list[str]:
    out = []
    for key in sorted(set(before) | set(after), key=str):
        a, b = before.get(key), after.get(key)
        same = np.array_equal(a, b) if isinstance(a, np.ndarray) or isinstance(b, np.ndarray) else a == b
        if not same:
            out.append(str(key))
    return out


def seal_seams(t, g, sant_ish, overrides):
    """Openings between the residence and the delegates' floor that no door swing covers are sealed
    (a glazed partition, a window): a seam cell (walkable only in the Pujya Santo view, 4-adjacent to
    a cell delegates walk) stays open only when a door's swing covers it (its centre within the
    door's radius plus SANT_SEAM_DOOR_MARGIN of the hinge) and its pair isn't named with
    --sant-seal, or when its pair is named with --sant-open. A pair = (the residence room it is in or
    nearest to, the room most of its delegate-floor neighbours are in, else, when those are in no
    room (a doorway), the room of the nearest delegate floor that is in one; "-" = none). Changes
    `g` in place; returns {pair: stats}."""
    K = t.kept
    S = g & ~K
    near_k = np.zeros_like(K)
    near_k[1:, :] |= K[:-1, :]
    near_k[:-1, :] |= K[1:, :]
    near_k[:, 1:] |= K[:, :-1]
    near_k[:, :-1] |= K[:, 1:]
    seam = S & near_k
    pairs = {}
    if not seam.any():
        return pairs
    cr = t.cell_room
    in_sant = sant_ish[cr]  # cr = -1 reads the last entry: "in no room", never santo
    if in_sant.any():
        _, (ir, ic) = ndi.distance_transform_edt(~in_sant, return_indices=True)
    k_room = K & (cr >= 0)
    if k_room.any():
        _, (kr, kc) = ndi.distance_transform_edt(~k_room, return_indices=True)
    hinges = np.array([d["hinge"] for d in t.doors], float).reshape(-1, 2)
    radii = np.array([d["r"] for d in t.doors], float)
    rows, cols = g.shape
    rr, cc = np.nonzero(seam)
    for r, c in zip(rr.tolist(), cc.tolist()):
        if in_sant[r, c]:
            inside = int(cr[r, c])
        elif in_sant.any():
            inside = int(cr[ir[r, c], ic[r, c]])
        else:
            inside = -1
        nbrs = [(r + dr, c + dc) for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1))
                if 0 <= r + dr < rows and 0 <= c + dc < cols and K[r + dr, c + dc]]
        owners = sorted(int(cr[a, b]) for a, b in nbrs if cr[a, b] >= 0)
        if owners:
            outside = max(owners, key=owners.count)
        else:
            a, b = nbrs[0]
            outside = int(cr[kr[a, b], kc[a, b]]) if k_room.any() else -1
        key = (t.rooms[inside]["id"] if inside >= 0 else "-", t.rooms[outside]["id"] if outside >= 0 else "-")
        ctr = cell_center(t, r, c)
        d = np.hypot(*(hinges - ctr).T) if len(hinges) else np.zeros(0)
        covered = bool(len(d) and np.any(d <= radii + SANT_SEAM_DOOR_MARGIN))
        keep = (covered and key not in overrides["sant_seal"]) or key in overrides["sant_open"]
        st = pairs.setdefault(key, {"edges": 0, "kept": 0, "sealed": 0, "cells": [], "hinge": None})
        st["edges"] += len(nbrs)
        st["kept" if keep else "sealed"] += 1
        st["cells"].append(ctr)
        if len(d):
            k = int(np.argmin(d))
            if st["hinge"] is None or d[k] < st["hinge"][0]:
                st["hinge"] = (float(d[k]), float(radii[k]))
        if not keep:
            g[r, c] = False
    return pairs


def settle_sant(results, connectors, overrides, drop_connectors, drop_landings, report):
    """The Pujya Santo view's residence, on top of the finished delegates' map (which it never
    changes: the drift guard at the end exits on any difference):
      * classify_sant() picked the residence rooms (rm["_sant"]: own / shared / way); here a
        private stair / elevator shaft that a live connector lands in for santos (its landing on the
        santos' floor joins the level's main floor or a residence room) becomes a "way" room, and
        that landing the connector's santPoints (a level its points lack; one landing per level);
      * the santos' floor of a level (t.sant_kept) = the walkable grid with the residence rooms and
        those shafts open, openings without a door swing sealed (seal_seams()), kept where it joins
        the delegates' floor (4-connected: the router never cuts a corner) or holds a santo landing;
        it must contain the delegates' kept floor and stay inside its frame;
      * each residence room's entry on it (rm["_sant_entry"]; a shaft's = its landing).
    Exits, writing nothing, when a residence room is cut off, has no entry, is a deity room, or the
    delegates' map would change. Fills report["sant"] and prints one line."""
    canon = connector_positions(results)
    live = {cn["id"]: cn for cn in connectors}
    before = delegate_snapshot(results, connectors)
    rooms_by_id = {rm["id"]: (t, rm) for t in results for rm in t.rooms}

    # ---- the arguments: every id on the map, each used as it says
    pair_ids = {x for p in overrides["sant_open"] | overrides["sant_seal"] for x in p if x != "-"}
    named = set(overrides["sant"]) | set(overrides["not_sant"]) | set(overrides["sant_class"]) | pair_ids
    missing = sorted(named - set(rooms_by_id))
    if missing:
        sys.exit(f"--sant / --not-sant / --sant-class / --sant-open / --sant-seal: no such room on the map: {', '.join(missing)}")
    applied = {k: set().union(*(getattr(t, "sant_applied", {}).get(k, set()) for t in results)) for k in ("sant", "not_sant", "sant_class")}
    for rid in sorted(set(overrides["sant"]) - applied["sant"]):
        sys.exit(f"--sant {rid}: a stair / elevator room ({rid}) is shown to santos only through its landing; drop the argument")
    for rid in sorted(set(overrides["sant_class"]) - applied["sant_class"]):
        sys.exit(f"--sant-class {rid}: a stair / elevator room is always a way; drop the argument")

    def candidate_shaft(t, rm):
        if not rm["_conn"] or rm.get("_state") != "private":
            return False
        if rm["id"] in overrides["private"] or rm["id"] in overrides["not_sant"]:
            return False
        cid = shaft_connector_id(rm)
        return cid in live and cid not in drop_connectors and (cid, t.plan.level) not in drop_landings

    not_sant_shafts = sorted(rm["id"] for t in results for rm in t.rooms if rm["_conn"] and rm["id"] in overrides["not_sant"])
    not_sant_unused = sorted(set(overrides["not_sant"]) - applied["not_sant"] - set(not_sant_shafts))
    levels = [t for t in results if any(rm.get("_sant") for rm in t.rooms) or any(candidate_shaft(t, rm) for rm in t.rooms)]
    lvls = [t.plan.level for t in levels]

    refused = {}  # shaft room id -> why
    per, accepted, found = {}, {}, []
    for rnd in range(4):
        per = {}
        for t in levels:
            sant_ish = np.zeros(len(t.rooms) + 1, bool)  # the last entry: "in no room"
            blocked = np.zeros(len(t.rooms) + 1, bool)
            for i, rm in enumerate(t.rooms):
                sant_ish[i] = bool(rm.get("_sant")) or (candidate_shaft(t, rm) and rm["id"] not in refused)
                blocked[i] = bool(rm.get("closed")) or (not rm["public"] and not sant_ish[i])
            g, _ = walkable_grid(t, blocked)
            seams = seal_seams(t, g, sant_ish, overrides)
            lab, _ = ndi.label(g, FOUR)
            main = sorted(set(np.unique(lab[t.kept]).tolist()) - {0})
            per[t.plan.level] = {"g": g, "lab": lab, "main": main, "seams": seams, "sant_ish": sant_ish}
        view = {lvl: (np.isin(st["lab"], st["main"]), st["g"]) for lvl, st in per.items()}
        notes = {"connectors_dropped": [], "connectors_inferred": [], "connector_landings_dropped": []}
        found = build_connectors(results, notes, canon, view=view)
        found_by_id = {c["id"]: c for c in found}
        accepted = {}
        changed = False
        for t in levels:
            lvl = t.plan.level
            st = per[lvl]
            for rm in t.rooms:
                if not candidate_shaft(t, rm) or rm["id"] in refused:
                    continue
                cid = shaft_connector_id(rm)
                if lvl in live[cid]["points"]:
                    continue  # the delegates' landing: never a santo one too
                p = found_by_id.get(cid, {}).get("points", {}).get(lvl)
                if p is None:
                    refused[rm["id"]] = f"{cid} on {lvl}: no landing found on the santos' floor"
                    changed = True
                    continue
                r, c = grid_cell(t, p)
                comp = int(st["lab"][r, c]) if 0 <= r < st["lab"].shape[0] and 0 <= c < st["lab"].shape[1] else 0
                here = st["lab"] == comp
                holds = comp > 0 and any(o.get("_sant") and not o["_conn"] and bool((here & (t.cell_room == i)).any())
                                         for i, o in enumerate(t.rooms))
                if comp > 0 and (comp in st["main"] or holds):
                    accepted[(cid, lvl)] = (p, rm, comp)
                else:
                    refused[rm["id"]] = f"{cid} on {lvl}: its landing only reaches rooms santos don't walk either"
                    changed = True
        if not changed:
            break
    else:
        sys.exit("settle_sant: the santos' stair / elevator landings did not settle; check the --sant arguments")

    # connectors delegates don't get at all, which santo landings alone would make: never written
    not_written = sorted(f"{c['id']} ({', '.join(sorted(c['points'], key=LEVEL_ORDER.__getitem__))})" for c in found
                         if c["id"] not in live and c["id"] not in drop_connectors and len(c["points"]) >= 2)
    for (cid, lvl), (p, rm, _) in sorted(accepted.items()):
        live[cid].setdefault("santPoints", {})[lvl] = p
        rm["_sant"] = "way"
        rm["_sant_entry"] = p
    for cn in connectors:
        if cn.get("santPoints"):
            cn["santPoints"] = {k: v for k, v in sorted(cn["santPoints"].items(), key=lambda kv: LEVEL_ORDER[kv[0]])}

    # ---- the santos' floor per level, and its frame
    for t in results:
        t.sant_kept = t.kept
    for t in levels:
        lvl = t.plan.level
        st = per[lvl]
        keep = set(st["main"]) | {comp for (cid, l), (_, _, comp) in accepted.items() if l == lvl}
        t.sant_kept = np.isin(st["lab"], sorted(keep))
        if (t.kept & ~t.sant_kept).any():
            sys.exit(f"settle_sant: on level {lvl} the santos' floor lacks {int((t.kept & ~t.sant_kept).sum())} cells delegates walk")
        rr, cc = np.nonzero(t.kept)
        r0, r1, c0, c1 = rr.min(), rr.max() + 1, cc.min(), cc.max() + 1
        outside = t.sant_kept.copy()
        outside[r0:r1, c0:c1] = False
        if outside.any():
            sys.exit(f"settle_sant: on level {lvl} the santos' floor is outside the delegates' grid frame: not supported")

    # ---- entries on the santos' floor; every residence room joined to it
    for t in levels:
        compute_entries(t, kept=t.sant_kept,
                        is_open=lambda rm: (rm["public"] and not rm.get("closed")) or bool(rm.get("_sant")),
                        key="_sant_entry", only=lambda rm: bool(rm.get("_sant")) and not rm["_conn"], way_is_corridor=True)
    problems = []
    without_entry = []
    for t in levels:
        seams = per[t.plan.level]["seams"]
        for i, rm in enumerate(t.rooms):
            if not rm.get("_sant") or rm["_conn"]:
                continue
            joined = bool((t.sant_kept & (t.cell_room == i)).any())
            if rm.get("_sant_entry") is None:
                without_entry.append(rm["id"])
            if rm["kind"] != "corridor" and (rm.get("_sant_entry") is None or not joined):
                sealed = [f"{a}:{b}" for (a, b), s in seams.items() if s["sealed"] and rm["id"] in (a, b)]
                problems.append(f"{rm['id']} ({'no entry' if rm.get('_sant_entry') is None else 'cut off from the floor'}"
                                f"{'; sealed next to it: ' + ', '.join(sealed) if sealed else ''})")
    if problems:
        sys.exit("settle_sant: residence rooms santos can't reach: " + "; ".join(problems)
                 + ". Add --sant-open <id>:<other> if the blueprint draws a door there, or --not-sant <id>.")

    # ---- hard checks: never the deities' rooms or the altar; the extra floor is the residence's
    extra_cells = {}
    for t in levels:
        lvl = t.plan.level
        sant_idx = [i for i, rm in enumerate(t.rooms) if rm.get("_sant")]
        for i in sant_idx:
            rm = t.rooms[i]
            if is_deity_room(rm["raw"]):
                sys.exit(f"settle_sant: {rm['id']} is a deity room or the altar; it is never shown to santos")
            outs = [j for j in t.openings.get(i, {})]
            if outs and all(is_deity_room(t.rooms[j]["raw"]) for j in outs):
                sys.exit(f"settle_sant: {rm['id']} opens only into the deities' rooms; keep it private (--not-sant {rm['id']})")
        extra = t.sant_kept & ~t.kept
        in_sant = np.isin(t.cell_room, sant_idx)
        reach = ndi.distance_transform_cdt(~in_sant, metric="chessboard") if in_sant.any() else np.full(in_sant.shape, 10 ** 6)
        no_room = extra & (t.cell_room < 0)
        pub = np.array([bool(rm["public"]) for rm in t.rooms] + [False])
        in_pub = extra & pub[t.cell_room]
        stray = (no_room & (reach > SANT_NO_ROOM_REACH)) | (in_pub & (reach > 1)) | (extra & ~in_sant & ~no_room & ~in_pub)
        extra_cells[lvl] = {"total": int(extra.sum()), "in_santo_rooms": int((extra & in_sant).sum()),
                            "in_no_room": int(no_room.sum()),
                            "in_no_room_max_cells_from_the_residence": int(reach[no_room].max()) if no_room.any() else 0,
                            "in_public_rooms": int(in_pub.sum())}
        if stray.any():
            owners = sorted({t.rooms[k]["id"] if k >= 0 else "(no room)" for k in t.cell_room[stray].tolist()})
            sys.exit(f"settle_sant: on level {lvl}, {int(stray.sum())} santo-only cells lie outside the residence "
                     f"(in {', '.join(owners)}; no room: more than {SANT_NO_ROOM_REACH} cells from it, public: more than one)")

    # an own room reached only across another own room (its suite): listed for the organisers
    only_through = []
    for t in levels:
        own = [i for i, rm in enumerate(t.rooms) if rm.get("_sant") == "own"]
        for i in own:
            others = [j for j in own if j != i]
            lab, _ = ndi.label(t.sant_kept & ~np.isin(t.cell_room, others), FOUR)
            mine = (t.cell_room == i) & t.sant_kept
            comps = set(np.unique(lab[t.kept]).tolist()) - {0}
            if mine.any() and not (set(np.unique(lab[mine]).tolist()) & comps):
                via = []
                for j in others:
                    lab2, _ = ndi.label(t.sant_kept & ~np.isin(t.cell_room, [o for o in others if o != j]), FOUR)
                    if set(np.unique(lab2[mine]).tolist()) & (set(np.unique(lab2[t.kept]).tolist()) - {0}):
                        via.append(t.rooms[j]["id"])
                only_through.append(f"{t.rooms[i]['id']} via {', '.join(via) or '(several)'}")

    # ---- the drift guard: delegates' map exactly as before
    drift = snapshot_drift(before, delegate_snapshot(results, connectors))
    if drift:
        sys.exit(f"settle_sant changed delegate-facing data: {', '.join(drift[:12])}")

    # ---- report (outside the repo) and one line
    def seam_line(key, s):
        pts = np.array(s["cells"])
        extent = float(np.max(np.hypot(*(pts[:, None, :] - pts[None, :, :]).reshape(-1, 2).T))) if len(pts) > 1 else 0.0
        hinge = "no door" if s["hinge"] is None else f"nearest hinge {s['hinge'][0]:.0f} u (r {s['hinge'][1]:.0f})"
        return f"{key[0]}<->{key[1]}: {s['edges']} edges, kept {s['kept']}, sealed {s['sealed']}, {extent + CELL:.0f} u, {hinge}"

    seams_all = [(k, s) for t in levels for k, s in sorted(per[t.plan.level]["seams"].items())]
    classes = {t.plan.level: {cls: sorted(rm["id"] for rm in t.rooms if rm.get("_sant") == cls) for cls in SANT_CLASSES}
               for t in levels if any(rm.get("_sant") for rm in t.rooms)}
    report["sant"] = {
        "rooms": classes,
        "auto_way": sorted(x for t in results for x in getattr(t, "sant_auto_way", [])),
        "seams": {"kept": [seam_line(k, s) for k, s in seams_all if s["kept"]],
                  "sealed": [seam_line(k, s) for k, s in seams_all if s["sealed"]]},
        "landings": [f"{cid} on {lvl}" for (cid, lvl) in sorted(accepted)],
        "landings_refused": [refused[k] for k in sorted(refused)],
        "left_private": sorted(x for t in results for x in getattr(t, "sant_left_private", [])),
        "rooms_without_entry": sorted(without_entry),
        "reached_only_through": only_through,
        "extra_cells": extra_cells,
        "connectors_not_written": not_written,
        "arguments": {"sant": sorted(overrides["sant"]), "not_sant": sorted(overrides["not_sant"]),
                      "not_sant_unused": not_sant_unused, "sant_class": sorted(f"{k}={v}" for k, v in overrides["sant_class"].items()),
                      "sant_open": sorted(f"{a}:{b}" for a, b in overrides["sant_open"]),
                      "sant_seal": sorted(f"{a}:{b}" for a, b in overrides["sant_seal"])},
    }
    for pair in sorted(overrides["sant_open"] | overrides["sant_seal"]):
        if not any(k == pair for k, _ in seams_all):
            sys.exit(f"--sant-open / --sant-seal {pair[0]}:{pair[1]}: no opening between them on the santos' floor "
                     f"(the first id is the residence room)")
    if not_sant_unused:
        print(f"--not-sant: not a residence room or stair / elevator (ignored): {', '.join(not_sant_unused)}", file=sys.stderr)
    counts = []
    for lvl, by in classes.items():
        n = sum(len(v) for v in by.values())
        counts.append(f"{n} rooms on {lvl} (own {len(by['own'])}, shared {len(by['shared'])}, way {len(by['way'])})")
    kept_n = sum(s["kept"] for _, s in seams_all)
    sealed_n = sum(s["sealed"] for _, s in seams_all)
    extra_n = sum(v["total"] for v in extra_cells.values())
    print(f"santos only (Pujya Santo view): {'; '.join(counts) or 'no rooms'}; landings "
          f"{', '.join(f'{c}:{l}' for c, l in sorted(accepted)) or 'none'}; refused "
          f"{', '.join(sorted(v.split(':')[0].replace(' on ', ':') for v in refused.values())) or 'none'}; "
          f"seam cells kept {kept_n} / sealed {sealed_n}; +{extra_n} santo cells; "
          f"delegates' output unchanged")
    return lvls


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0],
                                 epilog="Every room / connector argument can be repeated. See the top of this file for what each one does.")
    ap.add_argument("--pdf", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--public", action="append", default=[], metavar="ROOM", help="force a room id public")
    ap.add_argument("--private", action="append", default=[], metavar="ROOM", help="force a room id back-of-house (a plain block)")
    ap.add_argument("--closed", action="append", default=[], metavar="ROOM",
                    help="staff only: the room stays drawn and named, with no directions to, from or through it")
    ap.add_argument("--merge", action="append", default=[], metavar="ROOM+ROOM",
                    help="one room of two (the partition between them removed); keeps the first id")
    ap.add_argument("--partition", action="append", default=[], metavar="ROOM+ROOM",
                    help="two rooms divided by a movable partition drawn dashed (closed): their floor is split along it")
    ap.add_argument("--passage", action="append", default=[], metavar="ROOM",
                    help="a way through (an alcove between two rooms): kind corridor, crossed at no extra cost, name kept")
    ap.add_argument("--name", action="append", default=[], metavar="ROOM=NAME",
                    help="the organisers' name for a room (its kind follows the name)")
    ap.add_argument("--drop-connector", action="append", default=[], metavar="ID",
                    help='not a stair / elevator for guests (a freight elevator): its rooms become staff-only "Freight Elevator" rooms')
    ap.add_argument("--drop-landing", action="append", default=[], metavar="ID:LEVEL",
                    help="that stair / elevator doesn't serve that level for guests; its room there becomes private")
    ap.add_argument("--landing", action="append", default=[], metavar="ID:LEVEL=X,Y",
                    help="place that stair's / elevator's landing on that level at the walkable cell nearest X,Y (map units)")
    ap.add_argument("--side", action="append", default=[], metavar="ID=left|right|none",
                    help="set a stair's / elevator's side of the map (overrides the geometry)")
    ap.add_argument("--place", action="append", default=[], metavar="ID=foyer|side|back|none",
                    help="set where a stair / elevator is in the building (overrides the geometry)")
    ap.add_argument("--route", action="append", default=[], metavar="FROM:TO",
                    help="also draw the route between these two room ids on the previews")
    ap.add_argument("--sant", action="append", default=[], metavar="ROOM",
                    help="the Pujya Santo view also shows this private room of the residence")
    ap.add_argument("--not-sant", action="append", default=[], metavar="ROOM",
                    help="a residence room or shaft the Pujya Santo view keeps private too")
    ap.add_argument("--sant-class", action="append", default=[], metavar="ROOM=own|shared|way",
                    help="set a residence room's class in the Pujya Santo view")
    ap.add_argument("--sant-open", action="append", default=[], metavar="SANT:OTHER",
                    help="keep every opening between a residence room and a room delegates walk (a door the blueprint draws no swing for)")
    ap.add_argument("--sant-seal", action="append", default=[], metavar="SANT:OTHER",
                    help="seal the openings between a residence room and a room delegates walk, even under a door swing")
    ap.add_argument("--no-preview", action="store_true")
    ap.add_argument("--debug", action="store_true", help="also write grid-<level>.png (walkable cells, doors)")
    args = ap.parse_args()
    overrides, side_args, place_args, drop_connectors, drop_landings = parse_arguments(args)

    print(read_app_route_rules())
    pdf = Path(args.pdf).resolve()
    out = Path(args.out).resolve()
    repo = os.path.normcase(str(REPO))
    for p, what in ((pdf, "--pdf"), (out, "--out")):
        q = os.path.normcase(str(p))
        if q == repo or q.startswith(repo + os.sep):
            sys.exit(f"{what} is inside the repository ({p}); the blueprint and everything derived from it stay outside it.")
    if not pdf.is_file():
        sys.exit(f"no such file: {pdf}")
    out.mkdir(parents=True, exist_ok=True)

    doc = pymupdf.open(str(pdf))
    plans = find_plans(doc)
    if not plans:
        sys.exit("no plans found")
    report = {"source": pdf.name, "sheets": doc.page_count, "plans": [], "connectors_dropped": [], "connectors_inferred": []}

    # alignment on the column-grid origin marker
    for p in plans:
        p.marker = find_grid_marker(p)
        if p.marker is None:
            sys.exit(f"{p.name}: grid origin marker not found")
    ref = next((p for p in plans if p.level == REFERENCE_LEVEL), plans[0])
    for p in plans:
        p.offset = ref.marker - p.marker
        report["plans"].append({"level": p.level, "name": p.name, "sheet": p.page_no + 1,
                                "frame": [round(v, 1) for v in p.area],
                                "grid_marker_sheet_xy": [round(float(v), 1) for v in p.marker],
                                "offset_to_map": [round(float(v), 1) for v in p.offset]})

    results = []
    for p in plans:
        print(f"{p.name}: {len(p.strokes)} strokes, {len(p.lines)} text lines ...", flush=True)
        t = build_level(p, overrides)
        results.append(t)
    # every --merge / --closed must have found its rooms (nothing is written otherwise)
    merged = {m for t in results for m in t.merged}
    missing = [f"{a}+{b}" for a, b in overrides["merge"] if f"{a}+{b}" not in merged]
    if missing:
        sys.exit(f"--merge: no level has both rooms of {', '.join(missing)}")
    missing = sorted(overrides["closed"] - {rid for t in results for rid in t.applied["closed"]})
    if missing:
        sys.exit(f"--closed: no such room on the map: {', '.join(missing)}")
    partitioned = {p.split(" ")[0] for t in results for p in t.partitioned}
    missing = [f"{a}+{b}" for a, b in overrides["partition"] if f"{a}+{b}" not in partitioned]
    if missing:
        sys.exit(f"--partition: no level has both rooms of {', '.join(missing)}")
    missing = sorted(overrides["passage"] - {rid for t in results for rid in t.applied["passage"]})
    if missing:
        sys.exit(f"--passage: no such room on the map (a stair / elevator is never one): {', '.join(missing)}")

    # door scale: the most common swing radius is a 3'-0" door
    radii = np.concatenate([[d["r"] for d in t.doors] for t in results])
    hist = np.round(radii).astype(int)
    common = int(np.bincount(hist).argmax())
    report["scale"] = {"door_swing_radius_mode_units": common, "units_per_foot": round(common / 3.0, 2),
                       "drawing_scale": "1/8\" = 1'-0\"" if abs(common / 3.0 - 9.0) < 0.6 else "?",
                       "doors_found": {t.plan.level: len(t.doors) for t in results}}

    connectors = settle_connectors(results, report, overrides, drop_connectors, drop_landings)
    for t in results:
        compute_entries(t)
        for rm in t.rooms:  # a shaft's route end is its connector landing; none when it doesn't stop here
            if rm["_conn"]:
                cn = next((c for c in connectors if c["id"] == shaft_connector_id(rm)), None)
                rm["entry"] = cn["points"][t.plan.level] if cn and t.plan.level in cn["points"] and rm["_state"] == "shaft" else None
        # open areas no route reaches are left out; the rest are numbered again in order
        n = 0
        for rm in t.rooms:
            if rm.get("_open"):
                if rm["public"] and rm["entry"] is None:
                    rm["_drop"] = True
                else:
                    n += 1
                    rm["id"], rm["name"] = f"{t.plan.level}-open-area-{n}", f"Open Area {n}"
                    if rm["id"] in overrides["name"]:
                        rm["name"] = overrides["name"][rm["id"]]
                        t.applied["name"].add(rm["id"])
        t.rooms_out = [rm for rm in t.rooms if not rm.get("_drop")]

    # each stair's / elevator's side of the map (Bhaio right, Behno left) and its place in the
    # building (foyer / side / back), with the --side / --place overrides
    axis = assign_sides(results, connectors, side_args, report)
    assign_places(results, connectors, place_args, axis, report)
    # shaft rooms as guests read them: by place, never by number
    by_id = {cn["id"]: cn for cn in connectors}
    for t in results:
        for rm in t.rooms:
            if not rm["_conn"]:
                continue
            if rm["_state"] == "closed":
                rm["name"] = overrides["name"].get(rm["id"], DROPPED_SHAFT_NAME[rm["_conn_kind"]])
                if rm["id"] in overrides["name"]:
                    t.applied["name"].add(rm["id"])
            elif rm["_state"] != "private":
                rm["name"] = shaft_name(rm["_conn_kind"], by_id.get(shaft_connector_id(rm), {}).get("place"))
    missing = sorted(set(overrides["name"]) - {rid for t in results for rid in t.applied["name"]})
    if missing:
        sys.exit(f"--name: no such room on the map (a stair / elevator room is named by its place): {', '.join(missing)}")
    # the Pujya Santo view's residence, on top of the finished delegates' map (never changing it)
    settle_sant(results, connectors, overrides, drop_connectors, drop_landings, report)
    report["arguments"] = {
        "public_not_found": sorted(overrides["public"] - {rid for t in results for rid in t.applied["public"]}
                                   - {rm["id"] for t in results for rm in t.rooms if rm["_conn"]}),
        "private_not_found": sorted(overrides["private"] - {rid for t in results for rid in t.applied["private"]}
                                    - {rm["id"] for t in results for rm in t.rooms if rm["_conn"]}),
        "closed": sorted(overrides["closed"]), "merged": sorted(merged), "named": sorted(overrides["name"]),
        "partitioned": sorted(p for t in results for p in t.partitioned), "passage": sorted(overrides["passage"]),
        "drop_connector": sorted(drop_connectors), "drop_landing": sorted(f"{c}:{l}" for c, l in drop_landings),
        "landing": sorted(f"{c}:{l}={x},{y}" for (c, l), (x, y) in overrides["landing"].items()),
    }

    # JSON
    levels = []
    total_rooms = {"public": 0, "staff_only": 0, "back_of_house": 0, "open_areas": 0}
    santos_only = 0
    for t in results:
        wpath, wpolys = walls_path(t)
        t.wall_polylines = wpolys
        # trim the grid to the kept cells' extent
        rr, cc = np.nonzero(t.kept)
        r0, r1, c0, c1 = rr.min(), rr.max() + 1, cc.min(), cc.max() + 1
        g = t.kept[r0:r1, c0:c1]
        origin = t.grid_origin + np.array([c0, r0]) * CELL
        corners = np.array([origin, origin + np.array([g.shape[1], g.shape[0]]) * CELL])
        allpts = np.vstack([np.vstack(wpolys), corners] + [rm["polygon"] for rm in t.rooms_out])
        lo = np.floor(allpts.min(axis=0) - 10)
        hi = np.ceil(allpts.max(axis=0) + 10)
        rooms_json = []
        origin_r = [round(float(origin[0]), 1), round(float(origin[1]), 1)]
        cell_room_trim = t.cell_room[r0:r1, c0:c1]
        t.doors_out = {}
        for rm in t.rooms_out:
            closed = bool(rm["public"] and rm.get("closed"))
            total_rooms["open_areas" if rm.get("_open") else "staff_only" if closed else "public" if rm["public"] else "back_of_house"] += 1
            # the Pujya Santo view only: its class and its entry on the santos' floor (still public: false)
            sant = bool(rm.get("_sant")) and not rm["public"] and not rm.get("closed")
            santos_only += sant
            se = rm.get("_sant_entry") if sant else None
            poly_r = [[round(float(x), 1), round(float(y), 1)] for x, y in rm["polygon"]]
            # door openings of a public room guests can go to (flow rules name doors by these ids)
            doors = []
            if rm["public"] and not closed and rm["entry"] is not None and rm["kind"] not in ("stair", "elevator"):
                doors = room_doors(rm["id"], poly_r, g, origin_r, cell_room_trim, t.rooms)
                if doors:
                    t.doors_out[rm["id"]] = doors
            rooms_json.append({
                "id": rm["id"], "level": rm["level"], "number": rm["number"], "name": rm["name"], "kind": rm["kind"],
                "public": rm["public"],
                "polygon": poly_r,
                "label": [round(float(rm["label"][0]), 1), round(float(rm["label"][1]), 1)],
                "entry": None if rm["entry"] is None or not rm["public"] or closed else [round(float(rm["entry"][0]), 1), round(float(rm["entry"][1]), 1)],
                # staff only (drawn and named, never entered); absent on every other room
                **({"closed": True} if closed else {}),
                **({"sant": rm["_sant"], "santEntry": None if se is None else [round(float(se[0]), 1), round(float(se[1]), 1)]} if sant else {}),
                **({"doors": doors} if doors else {}),
            })
        rooms_json.sort(key=lambda r: r["id"])
        level_json = {
            "id": t.plan.level, "name": t.plan.name, "order": t.plan.order,
            "bounds": {"x": float(lo[0]), "y": float(lo[1]), "width": float(hi[0] - lo[0]), "height": float(hi[1] - lo[1])},
            "walls": wpath, "rooms": rooms_json,
            "grid": {"cell": CELL, "cols": int(g.shape[1]), "rows": int(g.shape[0]),
                     "origin": [round(float(origin[0]), 1), round(float(origin[1]), 1)], "walkable": pack_bits(g)},
        }
        if any(r.get("sant") for r in rooms_json):
            # the santos' floor, in exactly the grid's frame (settle_sant() checked it fits)
            level_json["santGrid"] = {"cell": CELL, "cols": int(g.shape[1]), "rows": int(g.shape[0]),
                                      "origin": [round(float(origin[0]), 1), round(float(origin[1]), 1)],
                                      "walkable": pack_bits(t.sant_kept[r0:r1, c0:c1])}
        levels.append(level_json)
        report.setdefault("levels", {})[t.plan.level] = {
            "rooms_public": sum(1 for r in t.rooms_out if r["public"] and not r.get("closed") and not r.get("_open")),
            "rooms_staff_only": sorted(r["id"] for r in t.rooms_out if r["public"] and r.get("closed")),
            "rooms_back_of_house": sum(1 for r in t.rooms_out if not r["public"] and not r.get("_open")),
            "open_areas": [f"{r['id']} ({round(r['area_sqft'])} sq ft{'' if r['public'] else ', back-of-house'})" for r in t.rooms_out if r.get("_open")],
            "public_without_entry": sorted(r["id"] for r in t.rooms_out if r["public"] and not r.get("closed") and r["entry"] is None),
            "shaft_rooms_hidden": sorted(r["id"] for r in t.rooms_out if r["_conn"] and r["_state"] == "private"),
            "merged": t.merged,
            "partitioned": t.partitioned,
            "passages": sorted(t.applied["passage"]),
            # every public room's door openings, for writing flow rules (ids, where, width, the room beyond)
            "door_openings": {rid: [f"{d['id']} at {d['at']} width {d['width']:.0f} to {d['to'] or '-'}" for d in ds]
                      for rid, ds in sorted(t.doors_out.items())},
            "rooms_from_fixture_notes": t.fixture_rooms,
            "private_quarters": sorted(t.private_quarters),
            "private_quarters_circulation": sorted(t.residence),
            "unlabeled_regions_over_40sqft": t.unlabeled,
            "shared_regions_split": t.leaks["split"],
            "carved_by_fine_lines": t.leaks["carved"],
            "trimmed_sqft": t.leaks["trimmed"],
            "exterior_regions_removed": t.exterior_regions,
            "numbered_labels_without_room": t.missing,
            "labels_moved_into_adjacent_room": t.moved_labels,
            "outlines_unwrapped_from_enclosed_rooms": t.unwrapped,
            "oversize_regions": t.leaks["big"],
            "duplicate_numbers_dropped": t.dropped,
            "grid": {"cols": int(g.shape[1]), "rows": int(g.shape[0]), "walkable_cells": int(g.sum())},
            "walls_path_chars": len(wpath),
            "doors": len(t.doors),
            "rooms_sant": {cls: sorted(r["id"] for r in t.rooms_out if r.get("_sant") == cls and not r["public"]) for cls in SANT_CLASSES},
        }
    conn_json = [{"id": c["id"], "kind": c["kind"], "name": c["name"],
                  "points": {k: [round(float(v[0]), 1), round(float(v[1]), 1)] for k, v in c["points"].items()},
                  **({"side": c["side"]} if c.get("side") else {}),
                  **({"place": c["place"]} if c.get("place") else {}),
                  # landings only the Pujya Santo view uses (levels `points` lacks)
                  **({"santPoints": {k: [round(float(v[0]), 1), round(float(v[1]), 1)] for k, v in c["santPoints"].items()}}
                     if c.get("santPoints") else {})} for c in connectors]
    data = {"version": 1, "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "source": pdf.name, "levels": levels, "connectors": conn_json}
    js = json.dumps(data, separators=(",", ":"))
    (out / "venue-map.json").write_text(js, encoding="utf-8")
    report["json_bytes"] = len(js.encode("utf-8"))
    report["rooms_total"] = {**total_rooms, "santos_only": santos_only}
    report["connectors"] = {c["id"]: sorted(c["points"], key=LEVEL_ORDER.__getitem__) for c in connectors}

    # sample routes: far-apart public rooms on each level and across levels
    publics = [(t.plan.level, rm) for t in results for rm in t.rooms_out
               if rm["public"] and not rm.get("closed") and rm["entry"] is not None and rm["kind"] not in ("stair", "elevator", "other")]
    samples = []
    by_lvl = defaultdict(list)
    for lvl, rm in publics:
        by_lvl[lvl].append(rm)
    for lvl, rms in by_lvl.items():
        if len(rms) >= 2:
            pts = np.array([r["entry"] for r in rms])
            i = int(np.argmin(pts.sum(axis=1)))
            j = int(np.argmax(pts.sum(axis=1)))
            samples.append((rms[i]["id"], rms[j]["id"]))
    lv = sorted(by_lvl, key=LEVEL_ORDER.__getitem__)
    for x, y in zip(lv[:-1], lv[1:]):
        a = min(by_lvl[x], key=lambda r: r["entry"][0])
        b = max(by_lvl[y], key=lambda r: r["entry"][0])
        samples.append((a["id"], b["id"]))
    if len(lv) >= 2:
        samples.append((by_lvl[lv[0]][0]["id"], by_lvl[lv[-1]][-1]["id"]))
    # and any asked for with --route (skipped, with a note, when a room isn't on the map)
    ids = {rm["id"] for t in results for rm in t.rooms_out if rm["public"]}
    for spec in args.route:
        a, _, b = spec.partition(":")
        if a in ids and b in ids:
            samples.append((a, b))
        else:
            print(f"--route {spec}: not two public rooms on the map, skipped", file=sys.stderr)
    # each for both tracks: Bhaio on the right-side stairs, Behno on the left-side ones
    routes = [route(results, connectors, a, b, track) for a, b in samples for track in TRACK_SIDE]
    report["sample_routes"] = [{k: v for k, v in r.items() if k != "legs"} for r in routes]

    if not args.no_preview:
        for t, lj in zip(results, levels):
            render_preview(t, lj, connectors, routes, out / f"preview-{t.plan.level}.png", axis=axis)
            if args.debug:
                render_grid_debug(t, lj, out / f"grid-{t.plan.level}.png")
    (out / "report.json").write_text(json.dumps(report, indent=2, default=float), encoding="utf-8")
    print(json.dumps({k: report[k] for k in ("scale", "rooms_total", "json_bytes", "connectors", "side_axis")}, indent=2))
    print("stairs / elevators (Bhaio right, Behno left; x against the axis; place = foyer / side / back):")
    for cid, sd in report["connector_sides"].items():
        where = "" if sd["from_axis"] is None else f"{sd['from_axis']:+.0f} units from the axis"
        pl = report["connector_places"][cid]
        print(f"  {cid:<8} {pl['place']:<6} [{pl['set_by']}]  {sd['side']:<16} {where}  [{sd['set_by']}]")
    for key, what in (("connectors_dropped_by_argument", "not for guests (--drop-connector)"),
                      ("connector_landings_dropped", "landings dropped"), ("connector_landings_placed", "landings placed"),
                      ("connectors_dropped", "connectors dropped")):
        if report.get(key):
            print(f"{what}: {'; '.join(report[key])}")
    for key in ("public_not_found", "private_not_found"):
        if report["arguments"][key]:
            print(f"--{key.split('_')[0]}: not on the map (ignored): {', '.join(report['arguments'][key])}", file=sys.stderr)
    failed = [r for r in report["sample_routes"] if not r["ok"]]
    print(f"sample routes: {len(routes) - len(failed)} of {len(routes)} found")
    for r in failed:
        print(f"  no route: {r['from']} -> {r['to']} [{r['track']}] ({r['why']})")
    print(f"wrote {out / 'venue-map.json'} and previews")


if __name__ == "__main__":
    main()
