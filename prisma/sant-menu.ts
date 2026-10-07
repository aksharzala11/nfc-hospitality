/**
 * The Pujya Santo menu: turns prisma/sant-menu-data.ts (the kitchen team's menu, now the "Menu"
 * tab of the organisers' Santo workbook) into `meals` rows with menu_for = SANT and their `menu_items`,
 * and syncs them into the database. Used by prisma/seed.ts (always, like the Santo general
 * schedule) and `npm run sant:menu:sync`.
 *
 * Ids are stable: a meal is "sm-<day>-<meal>" ("sm-2026-10-09-lunch"), a dish
 * "<meal id>-<NN>" in menu order ("sm-2026-10-09-lunch-03"), so a re-sync only rewrites what
 * changed. Each
 * meal takes its start, end and place from the Santo general schedule item it names (`slot`: a
 * MEAL item, or one whose title names a meal, such as Sunday's ARTI "Darshan/Breakfast"), so
 * the menu and the Santo schedule always agree.
 *
 * The sync owns every SANT meal and its dishes: SANT meals not in the data (the sample menu of
 * older `npm run sant:demo` runs, say) are deleted with their dishes. DELEGATE meals are never
 * read or written. The admin live-schedule engine never moves SANT meals, and the sync keeps
 * them unlinked from the delegate schedule (schedule_item_id and the printed-time columns null).
 */
import type { Meal, MenuItem, PrismaClient } from "@prisma/client";
import { SANT_MENU, TENTATIVE, type SantMealData } from "./sant-menu-data";
import { SANT_GENERAL_SCHEDULE, type SantGeneralItemData } from "./sant-schedule-data";
import { SANT_DAYS } from "../src/lib/time";

/** Every meal id starts with this. */
export const SANT_MENU_ID_PREFIX = "sm-";

// October is EDT (UTC-4) in New Jersey for the whole Santo programme (DST ends Nov 1),
// exactly as prisma/seed.ts and prisma/sant-schedule.ts build times.
const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00-04:00`);

const MEAL_KEYS = ["breakfast", "lunch", "dinner"] as const;
/** The only tag a Santo dish may carry: the sheet gives no dietary labels. */
const ALLOWED_TAGS: readonly string[] = [TENTATIVE];

export function santMealId(meal: Pick<SantMealData, "day" | "meal">): string {
  return `${SANT_MENU_ID_PREFIX}${meal.day}-${meal.meal}`;
}

/** One SANT `meals` row as the sync writes it (every column it owns). */
export type SantMealRow = Pick<
  Meal,
  "id" | "menuFor" | "scheduleItemId" | "name" | "note" | "location" | "startsAt" | "endsAt" | "originalStartsAt" | "originalEndsAt"
>;
/** One `menu_items` row of a SANT meal as the sync writes it. */
export type SantMenuItemRow = Pick<MenuItem, "id" | "mealId" | "course" | "name" | "description" | "tags" | "sortOrder">;

/** A title that names a meal ("Darshan/Breakfast", "Snacks & Travel"). */
const MEAL_WORD = /\b(?:breakfast|lunch|dinner|snacks?|dessert)\b/i;

/**
 * Whether a meal can be served in a Santo schedule item: a MEAL item, or one whose title names a
 * meal although the schedule files it under another kind (Sunday's "Darshan/Breakfast" at
 * Robbinsville is ARTI).
 */
const servesMeal = (s: SantGeneralItemData) => s.kind === "MEAL" || MEAL_WORD.test(s.title);

/** The Santo general schedule item a meal is served in: exactly one, or a thrown error. */
function slotOf(meal: SantMealData, where: string, schedule: readonly SantGeneralItemData[]): SantGeneralItemData {
  const found = schedule.filter((s) => s.day === meal.day && servesMeal(s) && s.title === meal.slot);
  if (found.length !== 1) {
    const meals = schedule.filter((s) => s.day === meal.day && servesMeal(s)).map((s) => `"${s.title}" ${s.start}`);
    throw new Error(
      `Santo menu ${where}: the Santo general schedule has ${found.length} meal items "${meal.slot}" that day ` +
        `(its meals that day: ${meals.join(", ") || "none"}). Name one of them as \`slot\`.`,
    );
  }
  return found[0];
}

/**
 * Sheet leftovers guests must never see: TBD markers (a tag instead), the sheet's
 * "(Option N)" / "(Dish N)" numbering, a "Meal - " prefix, or a sant's name.
 */
function dishTextProblem(text: string): string | null {
  if (/\btbd\b/i.test(text)) return 'still says "TBD" (use the "Tentative" tag)';
  if (/\((?:option|dish)\s*\d+\)/i.test(text)) return 'has the sheet\'s "(Option N)" / "(Dish N)" numbering';
  if (/^(?:breakfast|lunch|dinner)\s+-\s/i.test(text)) return 'starts with the sheet\'s "<Meal> - " prefix';
  if (/\b(?:swami|sadhu|pujya)\b/i.test(text)) return "looks like it holds a sant's name";
  return null;
}

/**
 * SANT_MENU as rows, in time order. Throws on data the app can't show correctly (a day outside
 * SANT_DAYS, a slot the Santo schedule doesn't have once, meals out of order or overlapping,
 * duplicate meals, one dish twice in a meal, empty courses or names, sheet leftovers, tags other
 * than "Tentative"), so a
 * bad edit fails the seed or sync instead of reaching the santos.
 */
export function santMenuRows(
  meals: readonly SantMealData[] = SANT_MENU,
  schedule: readonly SantGeneralItemData[] = SANT_GENERAL_SCHEDULE,
): { meals: SantMealRow[]; items: SantMenuItemRow[] } {
  const mealRows: SantMealRow[] = [];
  const itemRows: SantMenuItemRow[] = [];
  const seen = new Set<string>();
  let prevEnd: Date | null = null;
  for (const meal of meals) {
    const where = `${meal.day} ${meal.meal}`;
    if (!SANT_DAYS.includes(meal.day)) throw new Error(`Santo menu ${where}: the day is not in SANT_DAYS.`);
    if (!MEAL_KEYS.includes(meal.meal)) throw new Error(`Santo menu ${where}: meal must be one of ${MEAL_KEYS.join(", ")}.`);
    const id = santMealId(meal);
    if (seen.has(id)) throw new Error(`Santo menu ${where}: listed twice.`);
    seen.add(id);

    const slot = slotOf(meal, where, schedule);
    const startsAt = at(slot.day, slot.start);
    const endsAt = at(slot.day, slot.end);
    // The menu page and the Santo home tile take the meals in time order, one at a time.
    if (prevEnd && startsAt < prevEnd) {
      throw new Error(`Santo menu ${where}: out of order or overlapping the meal before it (keep SANT_MENU in time order).`);
    }
    prevEnd = endsAt;
    if (meal.dishes.length === 0) throw new Error(`Santo menu ${where}: no dishes.`);
    // A menu shows each dish once: the sheet tracks batches (two rows of one dish from two
    // kitchens), the santos see dishes.
    const dishNames = new Map<string, string>();

    mealRows.push({
      id,
      menuFor: "SANT",
      scheduleItemId: null,
      name: slot.title,
      note: null,
      location: slot.location ?? null,
      startsAt,
      endsAt,
      originalStartsAt: null,
      originalEndsAt: null,
    });

    for (const [i, dish] of meal.dishes.entries()) {
      const course = dish.course.replace(/\s+/g, " ").trim();
      const name = dish.name.replace(/\s+/g, " ").trim();
      const description = dish.description?.replace(/\s+/g, " ").trim() || null;
      const tags = dish.tags ?? [];
      const what = `Santo menu ${where} dish ${i + 1} "${dish.name}"`;
      if (!course || !name) throw new Error(`${what}: missing course or name.`);
      for (const text of [course, name, description ?? ""]) {
        const problem = dishTextProblem(text);
        if (problem) throw new Error(`${what}: "${text}" ${problem}.`);
      }
      const unknown = tags.filter((t) => !ALLOWED_TAGS.includes(t));
      if (unknown.length) throw new Error(`${what}: tag(s) ${unknown.join(", ")} not allowed (only ${ALLOWED_TAGS.join(", ")}).`);
      if (new Set(tags).size !== tags.length) throw new Error(`${what}: a tag is listed twice.`);
      const sameName = dishNames.get(name.toLowerCase());
      if (sameName) throw new Error(`${what}: this meal already lists "${sameName}" (list each dish once).`);
      dishNames.set(name.toLowerCase(), `${course}: ${name}`);
      itemRows.push({ id: `${id}-${String(i + 1).padStart(2, "0")}`, mealId: id, course, name, description, tags, sortOrder: i });
    }
  }
  return { meals: mealRows, items: itemRows };
}

/**
 * What the sync did (or, with dryRun, would do) to one meal: "update" when its row or any of
 * its dishes changes.
 */
export type SantMealChange = {
  id: string;
  name: string;
  startsAt: Date;
  endsAt: Date;
  action: "create" | "update" | "unchanged";
  dishes: number;
};

export type SantMenuSyncResult = {
  meals: { created: number; updated: number; unchanged: number; deleted: number };
  dishes: { created: number; updated: number; unchanged: number; deleted: number };
  /** Every meal of the data, in time order. */
  changes: SantMealChange[];
  /** SANT meals deleted because they are no longer in the data, with their dish counts. */
  deletedMeals: { id: string; name: string; dishes: number }[];
  dryRun: boolean;
};

const sameTime = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);

const sameMeal = (db: Meal, row: SantMealRow) =>
  db.menuFor === row.menuFor &&
  db.scheduleItemId === row.scheduleItemId &&
  db.name === row.name &&
  db.note === row.note &&
  db.location === row.location &&
  sameTime(db.startsAt, row.startsAt) &&
  sameTime(db.endsAt, row.endsAt) &&
  sameTime(db.originalStartsAt, row.originalStartsAt) &&
  sameTime(db.originalEndsAt, row.originalEndsAt);

const sameItem = (db: MenuItem, row: SantMenuItemRow) =>
  db.mealId === row.mealId &&
  db.course === row.course &&
  db.name === row.name &&
  db.description === row.description &&
  db.sortOrder === row.sortOrder &&
  db.tags.length === row.tags.length &&
  db.tags.every((t, i) => t === row.tags[i]);

/**
 * Makes the SANT meals and their dishes match sant-menu-data.ts, in one transaction: new rows
 * are created, changed rows rewritten, and SANT meals and dishes no longer in the data deleted.
 * Refuses (throws, nothing written) if one of its ids is held by a DELEGATE meal or a DELEGATE
 * meal's dish. With `dryRun`, only works out what it would do.
 */
export async function syncSantMenu(prisma: PrismaClient, opts: { dryRun?: boolean } = {}): Promise<SantMenuSyncResult> {
  const rows = santMenuRows();
  const dryRun = opts.dryRun === true;

  return prisma.$transaction(
    async (tx) => {
      const existing = await tx.meal.findMany({ where: { menuFor: "SANT" }, include: { items: true } });
      const wantedMealIds = new Set(rows.meals.map((m) => m.id));
      const wantedItemIds = new Set(rows.items.map((i) => i.id));

      // Never take over a delegate row that happens to use one of our ids.
      const clashes = [
        ...(await tx.meal.findMany({ where: { id: { in: [...wantedMealIds] }, menuFor: { not: "SANT" } }, select: { id: true } })),
        ...(await tx.menuItem.findMany({
          where: { id: { in: [...wantedItemIds] }, meal: { menuFor: { not: "SANT" } } },
          select: { id: true },
        })),
      ];
      if (clashes.length) {
        throw new Error(`Refusing to sync the Santo menu: ${clashes.map((c) => c.id).join(", ")} belong(s) to the delegate menu.`);
      }

      const mealById = new Map(existing.map((m) => [m.id, m]));
      // Dishes of meals that stay; those of deleted meals are deleted with them (then created anew).
      const itemById = new Map(
        existing
          .filter((m) => wantedMealIds.has(m.id))
          .flatMap((m) => m.items)
          .map((i) => [i.id, i]),
      );

      const mealCreates: SantMealRow[] = [];
      const mealUpdates: SantMealRow[] = [];
      const changes: SantMealChange[] = [];
      for (const row of rows.meals) {
        const db = mealById.get(row.id);
        const action = !db ? "create" : sameMeal(db, row) ? "unchanged" : "update";
        if (action === "create") mealCreates.push(row);
        if (action === "update") mealUpdates.push(row);
        changes.push({
          id: row.id,
          name: row.name,
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          action,
          dishes: rows.items.filter((i) => i.mealId === row.id).length,
        });
      }

      const itemCreates: SantMenuItemRow[] = [];
      const itemUpdates: SantMenuItemRow[] = [];
      let itemsUnchanged = 0;
      for (const row of rows.items) {
        const db = itemById.get(row.id);
        if (!db) itemCreates.push(row);
        else if (!sameItem(db, row)) itemUpdates.push(row);
        else itemsUnchanged++;
      }
      const deletedMeals = existing.filter((m) => !wantedMealIds.has(m.id));
      // Stale dishes of meals that stay (those of deleted meals go with them: on delete cascade).
      const staleItems = existing
        .filter((m) => wantedMealIds.has(m.id))
        .flatMap((m) => m.items)
        .filter((i) => !wantedItemIds.has(i.id));
      const staleItemIds = staleItems.map((i) => i.id);

      // A meal whose dishes change counts as updated, even when its own row doesn't.
      const touched = new Set([...itemCreates, ...itemUpdates, ...staleItems].map((i) => i.mealId));
      for (const c of changes) if (c.action === "unchanged" && touched.has(c.id)) c.action = "update";

      if (!dryRun) {
        if (deletedMeals.length) await tx.meal.deleteMany({ where: { id: { in: deletedMeals.map((m) => m.id) }, menuFor: "SANT" } });
        if (staleItemIds.length) await tx.menuItem.deleteMany({ where: { id: { in: staleItemIds } } });
        if (mealCreates.length) await tx.meal.createMany({ data: mealCreates });
        for (const { id, ...data } of mealUpdates) await tx.meal.update({ where: { id }, data });
        if (itemCreates.length) await tx.menuItem.createMany({ data: itemCreates });
        for (const { id, ...data } of itemUpdates) await tx.menuItem.update({ where: { id }, data });
      }

      const dishesOfDeleted = deletedMeals.reduce((n, m) => n + m.items.length, 0);
      return {
        meals: {
          created: mealCreates.length,
          updated: changes.filter((c) => c.action === "update").length,
          unchanged: changes.filter((c) => c.action === "unchanged").length,
          deleted: deletedMeals.length,
        },
        dishes: {
          created: itemCreates.length,
          updated: itemUpdates.length,
          unchanged: itemsUnchanged,
          deleted: staleItemIds.length + dishesOfDeleted,
        },
        changes,
        deletedMeals: deletedMeals.map((m) => ({ id: m.id, name: m.name, dishes: m.items.length })),
        dryRun,
      };
    },
    // ~90 rows over a remote connection: well past the 5 s default.
    { maxWait: 15_000, timeout: 120_000 },
  );
}

/** Console lines for a sync result, e.g. "Santo menu: 8 meals (8 created, 0 updated, 0 unchanged), 0 deleted; ...". */
export function santMenuSummary(r: SantMenuSyncResult): string[] {
  const m = r.meals;
  const d = r.dishes;
  return [
    `Santo menu: ${m.created + m.updated + m.unchanged} meals (${m.created} created, ${m.updated} updated, ` +
      `${m.unchanged} unchanged), ${m.deleted} deleted; ${d.created + d.updated + d.unchanged} dishes ` +
      `(${d.created} created, ${d.updated} updated, ${d.unchanged} unchanged), ${d.deleted} deleted`,
  ];
}
