/**
 * The Pujya Santo menu (Thu Oct 8 - Sun Oct 11, 2026), from the kitchen team's menu: first
 * transcribed on 2026-10-02 from screenshots of their Google Sheet "BKY NAAM SANT MENU" (one tab
 * per day), then checked cell by cell on 2026-10-03 against the "Menu" tab of the organisers'
 * workbook "TEJBHAI THIS IS EVERYTHING BUDDY - Version 1 (1).xlsx", which is now the source.
 * Kept by hand, by the reading below; prisma/sant-menu.ts checks it and syncs it into `meals`
 * (menu_for = SANT) and `menu_items`.
 *
 * How the "Menu" tab was read:
 *  - Four blocks side by side, one per day. Every block's heading reads "Thursday, Oct 8", so a
 *    block's day is its position: B-D Thursday, G-I Friday, K-M Saturday, O-Q Sunday.
 *  - Each block has three columns, "Meal", "Category" and "Item Name" (the Google Sheet's single
 *    "<Meal> - <Category>" column, split in two). The tab has no logistics columns; the Google
 *    Sheet's (quantity / servings, person making / bringing, follow up, status) are the kitchen
 *    team's: never copy them into the app, this file or anywhere else.
 *  - The Meal cell (merged over its rows) picks the entry below. The category is the dish's
 *    course, without the sheet's "(Option N)" / "(Dish N)" numbering ("Western (Option 2)" ->
 *    course "Western"). The kitchen's own categories are kept as given, also where the dish is
 *    not what the word suggests (breads under "Vegetables", Jeera Rice under "Khichdi", Dal
 *    Makhani under "Kadhi" on Thursday).
 *  - "Baked Goods" rows stand under the Meal "Sweets": they go with the meal above them that day,
 *    as the course "Baked Goods" (Thursday and Saturday dinner). Sunday's two Baked Goods rows
 *    repeat its breakfast Bakery rows (Muffins, Banana Bread): the sheet tracks batches, the menu
 *    lists dishes, so they appear once, under Bakery (sant-menu.ts refuses one dish twice in a
 *    meal).
 *  - A cell with two dishes is two dishes (Friday dinner's Dessert). A row with an empty Item
 *    Name would be left out (the tab has none).
 *  - "TBD" in an Item Name becomes the tag "Tentative" (as the delegate menu marks TBD items),
 *    with the TBD words taken out of the name ("(flavor tbd)" too). A person's name in brackets
 *    in an Item Name cell is left out.
 *  - Names are as the tab spells them, Gujarati dishes included (the kitchen writes both "Shak"
 *    and "Shaak", "Bataka" and "Bateta"). Changed: the stray space in "( different types of
 *    naans)", and the TBD / name removals above. No dietary labels.
 *  - Changes from the 2026-10-02 transcription: Thursday dinner's "Browkies and Mini Bundt Cakes"
 *    is "Brownies and Mini Bundt Cakes", as the tab spells it; the note on Sunday's empty first
 *    Hot Indian row is gone (the tab has no such row). Every other dish, course and order is
 *    unchanged.
 *
 * Times are not in this file: each meal names the Santo general schedule item it is served in
 * (`slot`, an item of that day in prisma/sant-schedule-data.ts that is a MEAL or names a meal,
 * such as Sunday's "Darshan/Breakfast"), and takes that item's start, end and place. The meal
 * is named after it too ("Dinner & Dessert").
 */

/** "breakfast" | "lunch" | "dinner": the meal's id part ("sm-2026-10-09-lunch"). */
export type SantMealKey = "breakfast" | "lunch" | "dinner";

export type SantMenuDish = {
  course: string;
  name: string;
  description?: string;
  /** Only "Tentative" (an item the sheet marks TBD). */
  tags?: string[];
};

export type SantMealData = {
  /** YYYY-MM-DD (Eastern). */
  day: string;
  meal: SantMealKey;
  /** Title of the Santo general schedule item that day this meal is served in (a MEAL, or one whose title names a meal). */
  slot: string;
  /** In the sheet's order (rows top to bottom). */
  dishes: SantMenuDish[];
};

export const TENTATIVE = "Tentative";

type DishName = string | { name: string; tags?: string[]; description?: string };

/** Dishes of one course, in the sheet's order. */
const course = (name: string, ...dishes: DishName[]): SantMenuDish[] =>
  dishes.map((d) => (typeof d === "string" ? { course: name, name: d } : { course: name, ...d }));

/** A dish the sheet marks TBD. */
const tentative = (name: string) => ({ name, tags: [TENTATIVE] });

/** In time order. */
export const SANT_MENU: SantMealData[] = [
  // ---- Thu Oct 8 ("Menu" tab, block B-D: dinner only) ----------------
  {
    day: "2026-10-08", meal: "dinner", slot: "Dinner & Dessert",
    dishes: [
      ...course("Dessert", "Cannoli"),
      ...course("Western", "Mexican Chili with Jalapeno Bread", "Ravioli", "Lettuce Wraps"),
      ...course("Farsan", "Masala Papad"),
      ...course("Shak", "Mushroom Palak Shaak", "Saahi Paneer"),
      ...course("Vegetables", "Paratha/Naan (different types of naans)"),
      ...course("Salad", "Grilled Vegetables"),
      ...course("Khichdi", "Jeera Rice"),
      ...course("Kadhi", "Dal Makhani"),
      ...course("Baked Goods", "Brownies and Mini Bundt Cakes", tentative("Assorted Baked Goods")),
    ],
  },
  // ---- Fri Oct 9 ("Menu" tab, block G-I) -----------------------------
  {
    day: "2026-10-09", meal: "breakfast", slot: "Breakfast",
    dishes: [
      ...course("Hot Indian", "Muthiya", "Mug"),
      ...course("Western", "Avocado Toast"),
      ...course("Bakery", "Scones", "Donuts"),
      ...course("Dry Farsan", "Mamra"),
      ...course("Misc", "Fresh Fruit Juice Bar"),
    ],
  },
  {
    day: "2026-10-09", meal: "lunch", slot: "Lunch",
    dishes: [
      ...course("Sweet", "Orange Philo Cups"),
      ...course("Western", "Falafel Bowl/Wrap", "Vegan balls sandwiches"),
      ...course("Farsan", "Dahivada", "Dalvada"),
      ...course("Rotli / Puri", "Rotli"),
      ...course("Shak", "Tindoda Bataka", "Kobij Bateta"),
      ...course("Kathor", "Chora"),
      ...course("Bhat (Rice)", "Bhat"),
      ...course("Dal / Kadhi", "Dal"),
      ...course("Salad", "Mediterranean Salad"),
      ...course("Papad / Papdi", "Papdi"),
    ],
  },
  {
    day: "2026-10-09", meal: "dinner", slot: "Dinner & Dessert",
    dishes: [
      // One cell (I24), two dishes.
      ...course("Dessert", tentative("Pie and Ice cream"), "Coldstone Ice Cream Cupcakes"),
      ...course("Western", "Mexican Boat", "Mexican Stuffed Shells", "Soy Wraps"),
      ...course("Shak", "Bhinda nu Shaak", "Cauliflower bataka"),
      ...course("Vegetables", "Bhakri/Paratha"),
      ...course("Salad", "Corn Avocado Salad"),
      ...course("Khichdi", "Khichdi"),
      ...course("Kadhi", "Kadhi"),
    ],
  },
  // ---- Sat Oct 10 ("Menu" tab, block K-M) ----------------------------
  {
    day: "2026-10-10", meal: "breakfast", slot: "Breakfast",
    dishes: [
      ...course("Hot Indian", tentative("Cabbage Pauva"), "Mug"),
      ...course("Western", "Bagels - Plain & Jalapeno Cheddar"),
      ...course("Bakery", "Sticky Cinnamon Rolls", "Cake"),
      ...course("Dry Farsan", "Dry Tikhi Puri"),
    ],
  },
  {
    day: "2026-10-10", meal: "lunch", slot: "Lunch",
    dishes: [
      ...course("Sweet", "Tres Leche Mini Cake"),
      ...course("Western", "Vegan Sliders", "Grilled Halloumi Arugula Sandwich"),
      ...course("Farsan", "Mix Veg Pakoda"),
      ...course("Rotli / Puri", "Rotli"),
      ...course("Shak", "Parvar", "Methi Bataka/Squash"),
      ...course("Kathor", "Kala Chana"),
      ...course("Bhat (Rice)", "Bhat"),
      ...course("Dal / Kadhi", "Dal"),
      ...course("Salad", "Watermelon Salad"),
      ...course("Papad / Papdi", "Papad"),
    ],
  },
  {
    day: "2026-10-10", meal: "dinner", slot: "Dinner & Dessert",
    dishes: [
      ...course("Dessert", "Dessert Bar"),
      ...course("Western", "Pizza", "Sushi", "Artichoke Dip and Chips"),
      ...course("Shak", "Undhiyu", "Sev Tameta"),
      ...course("Vegetables", "Bhakri"),
      ...course("Salad", "Italian Salad"),
      ...course("Khichdi", "Khichdi"),
      ...course("Kadhi", "Kadhi"),
      ...course("Baked Goods", "Coffee Cake", "Cookies"),
    ],
  },
  // ---- Sun Oct 11 ("Menu" tab, block O-Q: breakfast only) ------------
  // The Santo schedule has two Sunday breakfasts: "Breakfast" at Edison (7:30) and
  // "Darshan/Breakfast" at Robbinsville (9:00). This is the Edison one (to be confirmed; for
  // Robbinsville, set slot: "Darshan/Breakfast").
  {
    day: "2026-10-11", meal: "breakfast", slot: "Breakfast",
    dishes: [
      ...course("Hot Indian", "Mug"),
      ...course("Western", "Tofu Scramble Burrito"),
      ...course("Bakery", "Muffins", "Banana Bread"),
      ...course("Dry Farsan", "Vagharela cereal"),
      // The sheet's Baked Goods rows, Muffins and Banana Bread, repeat the Bakery dishes above.
    ],
  },
];
