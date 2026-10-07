/**
 * Seed script for NAAM 2026 (Edison, NJ · October 8-11, 2026).
 *
 * Schedule and menus are transcribed from the organisers' files:
 *   - "NAAM 2026 - Block Schedule (2)" (spreadsheet, updated Oct 5, 2026): its
 *     "2026 NAAM Schedule" tab; the per-day tabs are older and not used
 *   - "BKY NAAM 2026 Menu Final v1" (spreadsheet, Sept 26, 2026): its "Menu" tab
 * Items highlighted as TBD/tentative in them are tagged "Tentative".
 *
 * `npm run db:seed` always rewrites schedule_items and the delegate menu
 * (meals with menu_for = DELEGATE, and their menu_items). The Pujya Santo menu
 * (menu_for = SANT, shown on /sant/menu) is not rewritten here: it is synced from
 * prisma/sant-menu-data.ts (see prisma/sant-menu.ts), which only ever touches SANT
 * meals. The real team breakouts (prisma/breakouts-data.ts) are always synced
 * (the "bk-*" rows only; see prisma/breakouts.ts), and so are the Pujya Santo
 * general schedule (prisma/sant-schedule-data.ts -> sant_general_schedule_items;
 * see prisma/sant-schedule.ts) and the Santo menu. Mock users and mock breakouts
 * are only created when SEED_MOCK_DATA=true.
 */
import { PrismaClient, Gender, OtpChannel, ScheduleKind, Audience, MenuFor } from "@prisma/client";
import { syncBreakouts, syncSummary } from "./breakouts";
import { santScheduleSummary, syncSantSchedule } from "./sant-schedule";
import { santMenuSummary, syncSantMenu } from "./sant-menu";

const prisma = new PrismaClient();

// October is EDT (UTC-4) in New Jersey.
const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00-04:00`);
const THU = "2026-10-08";
const FRI = "2026-10-09";
const SAT = "2026-10-10";
const SUN = "2026-10-11";

// ---------------------------------------------------------------------------
// Mock users (local development only)
// ---------------------------------------------------------------------------
type UserSeed = {
  bapsId: string;
  name: string;
  displayName?: string;
  email?: string;
  phone?: string;
  preferredChannel: OtpChannel;
  gender: Gender;
  seva: string;
  region: string;
};

const mockUsers: UserSeed[] = [
  {
    bapsId: "MT9901",
    name: "Munitilak Swami",
    displayName: "Munitilakdas",
    email: process.env.SEED_DEMO_EMAIL ?? "munitilakdas@example.org",
    phone: process.env.SEED_DEMO_PHONE,
    preferredChannel: OtpChannel.EMAIL,
    gender: Gender.MALE,
    seva: "Hospitality",
    region: "Atlanta",
  },
  { bapsId: "BK1001", name: "Harshad Patel", displayName: "Harshadbhai", email: "harshad.patel@example.com", phone: "+14045550101", preferredChannel: OtpChannel.EMAIL, gender: Gender.MALE, seva: "Hospitality", region: "Atlanta" },
  { bapsId: "BK1002", name: "Nilam Patel", displayName: "Nilamben", email: "nilam.patel@example.com", phone: "+14045550102", preferredChannel: OtpChannel.SMS, gender: Gender.FEMALE, seva: "Registration", region: "Chicago" },
  { bapsId: "BK1003", name: "Jay Shah", displayName: "Jaybhai", email: "jay.shah@example.com", phone: "+14045550103", preferredChannel: OtpChannel.EMAIL, gender: Gender.MALE, seva: "Audio Visual", region: "Robbinsville" },
  { bapsId: "BK1004", name: "Priya Desai", displayName: "Priyaben", email: "priya.desai@example.com", phone: "+14045550104", preferredChannel: OtpChannel.EMAIL, gender: Gender.FEMALE, seva: "Hospitality", region: "Houston" },
  { bapsId: "BK1005", name: "Kunal Bhatt", displayName: "Kunalbhai", email: "kunal.bhatt@example.com", phone: "+14045550105", preferredChannel: OtpChannel.SMS, gender: Gender.MALE, seva: "Logistics & Transport", region: "Los Angeles" },
  { bapsId: "BK1006", name: "Rina Mehta", displayName: "Rinaben", email: "rina.mehta@example.com", phone: "+14045550106", preferredChannel: OtpChannel.EMAIL, gender: Gender.FEMALE, seva: "Medical", region: "Toronto" },
  { bapsId: "BK1007", name: "Vivek Amin", displayName: "Vivekbhai", email: "vivek.amin@example.com", phone: "+14045550107", preferredChannel: OtpChannel.EMAIL, gender: Gender.MALE, seva: "Kitchen & Prasad", region: "Atlanta" },
  { bapsId: "BK1008", name: "Hetal Joshi", displayName: "Hetalben", email: "hetal.joshi@example.com", phone: "+14045550108", preferredChannel: OtpChannel.SMS, gender: Gender.FEMALE, seva: "Audio Visual", region: "Dallas" },
  { bapsId: "BK1009", name: "Sanjay Trivedi", displayName: "Sanjaybhai", email: "sanjay.trivedi@example.com", phone: "+14045550109", preferredChannel: OtpChannel.EMAIL, gender: Gender.MALE, seva: "Security & Parking", region: "Chicago" },
  { bapsId: "BK1010", name: "Meera Patel", displayName: "Meeraben", email: "meera.patel@example.com", phone: "+14045550110", preferredChannel: OtpChannel.EMAIL, gender: Gender.FEMALE, seva: "Kitchen & Prasad", region: "Houston" },
];

// ---------------------------------------------------------------------------
// Schedule (from the block schedule)
// ---------------------------------------------------------------------------
type ItemSeed = {
  day: string;
  start: string;
  end: string;
  title: string;
  kind: ScheduleKind;
  audience?: Audience;
  location?: string;
  description?: string;
  /** Links this slot to a menu below (only for slots shared by everyone). */
  mealKey?: string;
};

const { ALL, BHAIO, BEHNO } = Audience;
const K = ScheduleKind;
const MANDIR = "Mandir";
const MAIN_HALL = "Main Hall";
const COMBINED = "i/eBKY Combined";
const AKSHARDHAM = "Akshardham, Robbinsville";
const SUNDAY_CHOICE = "The AM Museum Tour, or Tapomurti Nilkanth Varni Maharaj, Shangar Arti, Mandir Darshan and Abhishek.";

// Organisers, 2026-10-06: delegates need not attend the morning Mandir Arti; arti and ashtak are
// part of the morning program (that day's keynote) instead.
const ARTI_IN_PROGRAM = (keynote: string) =>
  `Optional for delegates: arti and ashtak are part of the morning program (${keynote}).`;
const WITH_ARTI = `${COMBINED}. Includes arti and ashtak.`;

const schedule: ItemSeed[] = [
  // ---- Thursday, Oct 8 (Day 1: arrival) ----
  { day: THU, start: "17:00", end: "19:00", title: "Arrival & Check-In", kind: K.FREE, location: MANDIR, description: "Mukhpath testing available during check-in." },
  { day: THU, start: "19:00", end: "19:30", title: "Arti", kind: K.ARTI, location: MANDIR },
  { day: THU, start: "19:30", end: "21:00", title: "Dinner & Dessert", kind: K.MEAL, location: "Dining Hall", description: "Ongoing arrival & check-in. Mukhpath testing 8–9 PM. Flights arriving after 7 PM are transported directly to the utaro.", mealKey: "thu-dinner" },
  { day: THU, start: "21:00", end: "21:45", title: "Depart to Utaro", kind: K.TRAVEL },

  // ---- Friday, Oct 9 (Day 2) ----
  { day: FRI, start: "06:30", end: "07:00", title: "Travel to Mandir", kind: K.TRAVEL, audience: BHAIO },
  { day: FRI, start: "06:30", end: "07:45", title: "Travel to Mandir", kind: K.TRAVEL, audience: BEHNO },
  { day: FRI, start: "07:00", end: "07:45", title: "Mandir Arti, Darshan, Abhishek", kind: K.ARTI, audience: BHAIO, location: MANDIR, description: ARTI_IN_PROGRAM("Keynote Program 1") },
  { day: FRI, start: "07:45", end: "08:15", title: "Murti Darshan & Abhishek", kind: K.ARTI, audience: BHAIO, location: MANDIR },
  { day: FRI, start: "08:15", end: "09:00", title: "Delegate Breakfast", kind: K.MEAL, audience: BHAIO, location: "Dining Hall" },
  { day: FRI, start: "07:45", end: "08:30", title: "Delegate Breakfast", kind: K.MEAL, audience: BEHNO, location: "Dining Hall" },
  { day: FRI, start: "08:30", end: "09:00", title: "Murti Darshan", kind: K.ARTI, audience: BEHNO, location: MANDIR },
  { day: FRI, start: "09:00", end: "09:15", title: "Seating", kind: K.BREAK, location: MAIN_HALL },
  { day: FRI, start: "09:15", end: "10:45", title: "Keynote Program 1", kind: K.SESSION, location: MAIN_HALL, description: WITH_ARTI },
  { day: FRI, start: "10:45", end: "11:00", title: "Travel", kind: K.TRAVEL },
  { day: FRI, start: "11:00", end: "12:30", title: "Team Breakouts", kind: K.BREAKOUT, location: "By team – see Breakout Sessions" },
  { day: FRI, start: "12:30", end: "14:00", title: "Delegate Lunch/Break", kind: K.MEAL, location: "Dining Hall", description: "Mukhpath testing during the break.", mealKey: "fri-lunch" },
  { day: FRI, start: "14:00", end: "14:45", title: "Goshthi 1", kind: K.SESSION, location: MAIN_HALL },
  { day: FRI, start: "14:45", end: "15:00", title: "Travel", kind: K.TRAVEL },
  { day: FRI, start: "15:00", end: "16:30", title: "Team Breakouts", kind: K.BREAKOUT, audience: BHAIO, location: "By team – see Breakout Sessions" },
  { day: FRI, start: "15:00", end: "16:30", title: "Mahila Program", kind: K.SESSION, audience: BEHNO, location: MAIN_HALL },
  { day: FRI, start: "16:30", end: "16:45", title: "Group Photo", kind: K.FREE, audience: BHAIO },
  { day: FRI, start: "16:45", end: "17:00", title: "Snacks", kind: K.MEAL, audience: BHAIO },
  { day: FRI, start: "16:30", end: "16:45", title: "Snacks", kind: K.MEAL, audience: BEHNO },
  { day: FRI, start: "16:45", end: "17:00", title: "Group Photo", kind: K.FREE, audience: BEHNO },
  { day: FRI, start: "17:00", end: "17:15", title: "Seating", kind: K.BREAK, location: MAIN_HALL },
  { day: FRI, start: "17:15", end: "18:45", title: "Keynote Program 2", kind: K.SESSION, location: MAIN_HALL, description: COMBINED },
  { day: FRI, start: "18:45", end: "19:00", title: "Sabha Hall Arti", kind: K.ARTI, location: "Sabha Hall" },
  { day: FRI, start: "19:00", end: "19:15", title: "Charansparsh", kind: K.ARTI, audience: BHAIO },
  { day: FRI, start: "19:15", end: "19:30", title: "Travel", kind: K.TRAVEL, audience: BHAIO },
  { day: FRI, start: "19:00", end: "19:30", title: "Travel", kind: K.TRAVEL, audience: BEHNO },
  { day: FRI, start: "19:30", end: "21:00", title: "Dinner & Dessert", kind: K.MEAL, location: "Dining Hall", mealKey: "fri-dinner" },
  { day: FRI, start: "21:00", end: "21:45", title: "Depart to Utaro", kind: K.TRAVEL },

  // ---- Saturday, Oct 10 (Day 3) ----
  { day: SAT, start: "06:30", end: "07:00", title: "Travel to Mandir", kind: K.TRAVEL, audience: BHAIO },
  { day: SAT, start: "06:30", end: "07:45", title: "Travel to Mandir", kind: K.TRAVEL, audience: BEHNO },
  { day: SAT, start: "07:00", end: "07:45", title: "Mandir Arti, Darshan, Abhishek", kind: K.ARTI, audience: BHAIO, location: MANDIR, description: ARTI_IN_PROGRAM("Keynote Program 3") },
  { day: SAT, start: "07:45", end: "08:30", title: "Delegate Breakfast", kind: K.MEAL, audience: BHAIO, location: "Dining Hall" },
  { day: SAT, start: "07:45", end: "08:15", title: "Murti Darshan & Abhishek", kind: K.ARTI, audience: BEHNO, location: MANDIR },
  { day: SAT, start: "08:15", end: "09:00", title: "Delegate Breakfast", kind: K.MEAL, audience: BEHNO, location: "Dining Hall" },
  { day: SAT, start: "08:30", end: "09:00", title: "Murti Darshan", kind: K.ARTI, audience: BHAIO, location: MANDIR },
  { day: SAT, start: "09:00", end: "09:15", title: "Seating", kind: K.BREAK, location: MAIN_HALL },
  { day: SAT, start: "09:15", end: "10:45", title: "Keynote Program 3", kind: K.SESSION, location: MAIN_HALL, description: WITH_ARTI },
  { day: SAT, start: "10:45", end: "11:00", title: "Travel", kind: K.TRAVEL },
  { day: SAT, start: "11:00", end: "12:30", title: "Team Breakouts", kind: K.BREAKOUT, location: "By team – see Breakout Sessions" },
  { day: SAT, start: "12:30", end: "14:00", title: "Delegate Lunch/Break", kind: K.MEAL, location: "Dining Hall", description: "Mukhpath testing during the break.", mealKey: "sat-lunch" },
  { day: SAT, start: "14:00", end: "14:45", title: "Goshthi 2", kind: K.SESSION, location: MAIN_HALL },
  { day: SAT, start: "14:45", end: "15:00", title: "Travel", kind: K.TRAVEL },
  { day: SAT, start: "15:00", end: "16:30", title: "Regional Review", kind: K.SESSION, location: MAIN_HALL },
  { day: SAT, start: "16:30", end: "17:00", title: "Snacks & Travel", kind: K.MEAL, mealKey: "sat-snack" },
  { day: SAT, start: "17:00", end: "17:15", title: "Seating", kind: K.BREAK, location: MAIN_HALL },
  { day: SAT, start: "17:15", end: "18:45", title: "Keynote Program 4", kind: K.SESSION, location: MAIN_HALL, description: COMBINED },
  { day: SAT, start: "18:45", end: "19:00", title: "Sabha Hall Arti", kind: K.ARTI, location: "Sabha Hall" },
  { day: SAT, start: "19:00", end: "19:15", title: "Charansparsh", kind: K.ARTI, audience: BHAIO },
  { day: SAT, start: "19:15", end: "19:30", title: "Travel", kind: K.TRAVEL, audience: BHAIO },
  { day: SAT, start: "19:00", end: "19:30", title: "Travel", kind: K.TRAVEL, audience: BEHNO },
  { day: SAT, start: "19:30", end: "21:00", title: "Dinner & Dessert", kind: K.MEAL, location: "Dining Hall", mealKey: "sat-dinner" },
  { day: SAT, start: "21:00", end: "21:45", title: "Depart to Utaro", kind: K.TRAVEL },

  // ---- Sunday, Oct 11 (Day 4: Akshardham, Robbinsville, and departures) ----
  // The Oct 5 sheet splits Sunday into Bhaio and Behno. It leaves Bhaio 6:30-7:00 and
  // 1:15-2:00 PM empty, so the app shows nothing there either.
  { day: SUN, start: "06:00", end: "06:30", title: "Travel to BAPS Shri Swaminarayan Akshardham, Robbinsville", kind: K.TRAVEL, description: "Delegates not taking part on Sunday: departures." },
  { day: SUN, start: "07:00", end: "07:15", title: "Luggage Storage in Tent", kind: K.FREE, audience: BHAIO, location: AKSHARDHAM },
  { day: SUN, start: "07:15", end: "07:45", title: "Delegate Breakfast", kind: K.MEAL, audience: BHAIO, location: AKSHARDHAM },
  { day: SUN, start: "07:45", end: "09:30", title: "AM Museum Tour or Darshan", kind: K.FREE, audience: BHAIO, location: AKSHARDHAM, description: SUNDAY_CHOICE },
  { day: SUN, start: "06:30", end: "06:45", title: "Luggage Storage in Tent", kind: K.FREE, audience: BEHNO, location: AKSHARDHAM },
  { day: SUN, start: "06:45", end: "07:15", title: "Delegate Breakfast", kind: K.MEAL, audience: BEHNO, location: AKSHARDHAM },
  { day: SUN, start: "07:15", end: "09:00", title: "AM Museum Tour or Darshan", kind: K.FREE, audience: BEHNO, location: AKSHARDHAM, description: SUNDAY_CHOICE },
  { day: SUN, start: "09:00", end: "09:30", title: "Travel", kind: K.TRAVEL, audience: BEHNO },
  { day: SUN, start: "09:30", end: "12:30", title: "Special Program", kind: K.SESSION, location: AKSHARDHAM, description: "i/eBKYS Combined" },
  { day: SUN, start: "12:30", end: "13:15", title: "Delegate Lunch", kind: K.MEAL, location: AKSHARDHAM, mealKey: "sun-lunch" },
  { day: SUN, start: "14:00", end: "15:45", title: "PM Museum Tour", kind: K.FREE, audience: BHAIO, location: AKSHARDHAM },
  { day: SUN, start: "15:45", end: "21:45", title: "Departures", kind: K.FREE, audience: BHAIO },
  { day: SUN, start: "13:15", end: "14:30", title: "PM Museum Tour", kind: K.FREE, audience: BEHNO, location: AKSHARDHAM },
  { day: SUN, start: "14:30", end: "21:45", title: "Departures", kind: K.FREE, audience: BEHNO },
];

// ---------------------------------------------------------------------------
// Menus (from the menu spreadsheet, which gives no times or places). Meals have
// their own times; some also link to a timeline slot via `mealKey`.
// ---------------------------------------------------------------------------
type MenuItemSeed = { course: string; name: string; description?: string; tags?: string[] };
type MealSeed = {
  key: string;
  day: string;
  start: string;
  end: string;
  name: string;
  note?: string;
  location?: string;
  items: MenuItemSeed[];
};

// The Fri-Sun fruit station; only the parfait's toppings differ (berries on
// Fri/Sat, fruit on Sun).
const parfaitStation = (toppings: string): MenuItemSeed[] => [
  { course: "Fruit, Yogurt & Cereals", name: "Sliced Apples" },
  { course: "Fruit, Yogurt & Cereals", name: "Whole Banana" },
  { course: "Fruit, Yogurt & Cereals", name: "Yogurt Parfait", description: toppings, tags: ["Contains almonds", "Contains coconut"] },
];
const PARFAIT_BERRIES = "Granola, honey, coconut flakes, sliced almonds, strawberries & blueberries";
const PARFAIT_FRUIT = "Granola, honey, coconut flakes, fruit & sliced almonds";
const BREAKFAST_BEVERAGES: MenuItemSeed[] = [
  { course: "Beverages", name: "Milk" },
  { course: "Beverages", name: "Indian Chai" },
  { course: "Beverages", name: "Black Hot Coffee & Creamer" },
];
const SNACK_BAG: MenuItemSeed[] = [
  { course: "Snacks To-Go", name: "Make your own snack bag", description: "Oreos / Chips Ahoy, Popcorners, Pirates Booty, water bottles" },
];
const VEGAN_COOKIES: MenuItemSeed = { course: "Dessert", name: "Fresh Baked Cookies", tags: ["Vegan"] };
const SNACK_BEVERAGES: MenuItemSeed[] = [
  { course: "Beverages", name: "Cold Coffee" },
  { course: "Beverages", name: "Hot Coffee" },
  { course: "Beverages", name: "Masala Chai" },
];
const TO_CONFIRM = "Time to be confirmed";

// The menu file also has a Wed Oct 7 "Team Hangouts Arrival" dinner, with a
// "Delegates" list (black bean burgers, fries, secret sauce, jalapeno coins,
// milkshake) and a "Volunteers" list still "????", and no time or place. Only
// some delegates arrive on Wednesday, so it stays out of the delegate menu
// until the organisers say who should see it.
const meals: MealSeed[] = [
  // ---- Thursday, Oct 8 (arrival) ----
  {
    key: "thu-breakfast", day: THU, start: "07:30", end: "09:00", name: "Breakfast", note: `Early arrivals · ${TO_CONFIRM}`,
    // In the file's order; one cell spans all the station rows, so each item
    // sits at the station its name matches (the menu groups by station).
    items: [
      { course: "Fruit, Yogurt & Cereals", name: "Whole Apples" },
      { course: "Fruit, Yogurt & Cereals", name: "Whole Banana" },
      { course: "Bakery, Breads & Spreads", name: "Muffins" },
      { course: "Fruit, Yogurt & Cereals", name: "Milk & Cereal" },
      { course: "Beverages", name: "Black Hot Coffee" },
    ],
  },
  {
    key: "thu-lunch", day: THU, start: "12:00", end: "14:00", name: "Lunch", note: `Early arrivals · ${TO_CONFIRM}`,
    items: [
      { course: "Main", name: "Cold Sandwiches", description: "6-inch" },
      { course: "Sides", name: "Deep River Jalapeno Chips" },
      { course: "Sides", name: "Variety CLIF Bars" },
      { course: "Beverages", name: "Gatorade" },
      { course: "Beverages", name: "Water Bottles" },
    ],
  },
  // The menu has a Thursday snack but no time for it; the welcome drink fits the
  // 5-7 PM arrival & check-in slot, which has no meal on the schedule to link to.
  {
    key: "thu-snack", day: THU, start: "17:00", end: "19:00", name: "Snacks", note: `During arrival & check-in · ${TO_CONFIRM}`,
    items: [
      { course: "Beverages", name: "Welcome Drink", description: "Blueberry lemonade" },
      { course: "Snacks", name: "Skinny Pop" },
    ],
  },
  {
    key: "thu-dinner", day: THU, start: "19:30", end: "21:00", name: "Dinner & Dessert", location: "Dining Hall",
    items: [
      { course: "Beverages", name: "Soda", description: "Regular & zero sugar" },
      { course: "Main", name: "Pasta with Red Sauce, White Sauce & Veggies", tags: ["Tentative"] },
      { course: "Sides", name: "Fresh Breadsticks" },
      { course: "Salad", name: "Salad with Dressing" },
      { course: "Dessert", name: "Cheesecake Cups" },
      VEGAN_COOKIES,
      ...SNACK_BAG,
    ],
  },
  // ---- Friday, Oct 9 ----
  {
    key: "fri-breakfast", day: FRI, start: "07:45", end: "09:00", name: "Delegate Breakfast", location: "Dining Hall", note: "Bhaio 8:15–9:00 · Behno 7:45–8:30",
    items: [
      ...parfaitStation(PARFAIT_BERRIES),
      { course: "Bakery, Breads & Spreads", name: "Bagels", description: "With varieties of cream cheese: sun dried tomato, jalapeno, plain" },
      { course: "Hot Foods", name: "Moong with Dahi", description: "With Ratlami sev" },
      ...BREAKFAST_BEVERAGES,
    ],
  },
  {
    key: "fri-lunch", day: FRI, start: "12:30", end: "14:00", name: "Delegate Lunch", location: "Dining Hall",
    items: [
      { course: "Beverages", name: "Strawberry Mint Lemonade" },
      { course: "Main", name: "Falafel Bowl", description: "Pita bread, bhajiya, salad, red chutney/tahini" },
      { course: "Main", name: "Hummus" },
      { course: "Main", name: "Pita Chips" },
      { course: "Dessert", name: "Baklava", tags: ["Contains nuts (type to be confirmed)"] },
    ],
  },
  {
    key: "fri-snack", day: FRI, start: "16:30", end: "17:00", name: "Snacks", note: "Bhaio 4:45 PM · Behno 4:30 PM",
    items: [
      ...SNACK_BEVERAGES,
      { course: "Snacks", name: "Aloo Puff & Ketchup" },
    ],
  },
  {
    key: "fri-dinner", day: FRI, start: "19:30", end: "21:00", name: "Dinner & Dessert", location: "Dining Hall",
    items: [
      { course: "Beverages", name: "Mango Nada Drink" },
      { course: "Main", name: "Tacos", description: "Paneer and cauliflower varieties" },
      { course: "Main", name: "Poblano Sauce Enchiladas" },
      { course: "Main", name: "Mexican Rice" },
      { course: "Sides", name: "Salsa/Guacamole Cups", description: "With chips" },
      { course: "Salad", name: "Elote Cups" },
      { course: "Dessert", name: "Tiramisu Cups" },
      VEGAN_COOKIES,
      ...SNACK_BAG,
    ],
  },
  // ---- Saturday, Oct 10 ----
  {
    key: "sat-breakfast", day: SAT, start: "07:45", end: "09:00", name: "Delegate Breakfast", location: "Dining Hall", note: "Bhaio 7:45–8:30 · Behno 8:15–9:00",
    items: [
      ...parfaitStation(PARFAIT_BERRIES),
      { course: "Bakery, Breads & Spreads", name: "Croissants" },
      { course: "Bakery, Breads & Spreads", name: "Spreads", description: "Individually packaged butter, jam & Nutella" },
      { course: "Hot Foods", name: "Scrambled Tofu", tags: ["Vegan"] },
      ...BREAKFAST_BEVERAGES,
    ],
  },
  {
    key: "sat-lunch", day: SAT, start: "12:30", end: "14:00", name: "Delegate Lunch", location: "Dining Hall",
    items: [
      { course: "Beverages", name: "Refresher Drinks" },
      { course: "Main", name: "Manchow Soup" },
      { course: "Main", name: "Spring Rolls", description: "With duck sauce" },
      { course: "Main", name: "Chinese Noodles" },
      { course: "Main", name: "Manchurian" },
      { course: "Main", name: "Chili Paneer" },
    ],
  },
  {
    key: "sat-snack", day: SAT, start: "16:30", end: "17:00", name: "Snacks",
    items: [
      ...SNACK_BEVERAGES,
      { course: "Snacks", name: "Chana ni Daal Garam", description: "Indian street style with tomato, lime & cilantro" },
    ],
  },
  {
    key: "sat-dinner", day: SAT, start: "19:30", end: "21:00", name: "Dinner & Dessert", location: "Dining Hall",
    items: [
      { course: "Beverages", name: "Mango Lassi" },
      { course: "Main", name: "Paratha" },
      { course: "Main", name: "Paneer Tikka" },
      { course: "Main", name: "Mushroom Masala" },
      { course: "Main", name: "Jeera Rice" },
      { course: "Main", name: "Dal Fry" },
      { course: "Main", name: "Masala Papad" },
      { course: "Sides", name: "Amul Jalapeno Samosa", description: "With green chutney & sweet chutney" },
      { course: "Salad", name: "Punjabi Pickle" },
      { course: "Dessert", name: "Ras Malai Cups" },
      { course: "Dessert", name: "Gulab Jamun Cake" },
      VEGAN_COOKIES,
      ...SNACK_BAG,
    ],
  },
  // ---- Sunday, Oct 11 (Akshardham, Robbinsville, and departures) ----
  {
    key: "sun-breakfast", day: SUN, start: "06:45", end: "07:45", name: "Delegate Breakfast", location: AKSHARDHAM, note: "Bhaio 7:15–7:45 · Behno 6:45–7:15",
    items: [
      ...parfaitStation(PARFAIT_FRUIT),
      { course: "Bakery, Breads & Spreads", name: "French Toast" },
      { course: "Bakery, Breads & Spreads", name: "Dry Nasto" },
      { course: "Hot Foods", name: "Bataka Pauva" },
      ...BREAKFAST_BEVERAGES,
    ],
  },
  {
    key: "sun-lunch", day: SUN, start: "12:30", end: "13:15", name: "Delegate Lunch", location: AKSHARDHAM,
    items: [
      { course: "Main", name: "Cold Veggie Wraps" },
      { course: "Sides", name: "Potato Chips" },
      { course: "Sides", name: "Chocolate Chip Bars" },
      { course: "Beverages", name: "Gatorade" },
      { course: "Beverages", name: "Water Bottles" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Mock breakout sessions, per seva (only seeded when SEED_MOCK_DATA=true).
// One entry per breakout slot on the schedule.
// ---------------------------------------------------------------------------
type BreakoutSeed = { title: string; description: string; room: string; facilitator: string };

const breakoutSlots = schedule.filter((s) => s.kind === K.BREAKOUT && (s.audience ?? ALL) !== BEHNO);

const breakoutsBySeva: Record<string, BreakoutSeed[]> = {
  Hospitality: [
    { title: "Guest Journey Mapping", description: "Walk through arrival to departure and find friction points.", room: "Room A", facilitator: "Harshadbhai Patel" },
    { title: "Accommodation & Utaro Planning", description: "Housing capacity, host families and hotel blocks.", room: "Room A", facilitator: "Priyaben Desai" },
    { title: "Hospitality Action Plan", description: "Owners, milestones and budget.", room: "Room A", facilitator: "Harshadbhai Patel" },
  ],
  Registration: [
    { title: "Registration Flow Review", description: "Lessons from last year's check-in queues.", room: "Room B", facilitator: "Nilamben Patel" },
    { title: "Data & Badge Systems", description: "Requirements for the registration platform and badge printing.", room: "Room B", facilitator: "Nilamben Patel" },
    { title: "Registration Action Plan", description: "Owners, milestones and next steps.", room: "Room B", facilitator: "Nilamben Patel" },
  ],
  "Audio Visual": [
    { title: "Venue Walkthrough & AV Needs", description: "Stage, sound and screens for the main hall.", room: "Room C", facilitator: "Jaybhai Shah" },
    { title: "Live Stream & Recording", description: "Streaming setup, redundancy and archival.", room: "Room C", facilitator: "Hetalben Joshi" },
    { title: "AV Action Plan", description: "Equipment list, vendors and volunteer roster.", room: "Room C", facilitator: "Jaybhai Shah" },
  ],
  "Logistics & Transport": [
    { title: "Airport Shuttle Planning", description: "Arrival waves, routes and driver scheduling.", room: "Room D", facilitator: "Kunalbhai Bhatt" },
    { title: "Parking & Traffic Flow", description: "Lot assignments and coordination with security.", room: "Room D", facilitator: "Kunalbhai Bhatt" },
    { title: "Logistics Action Plan", description: "Owners, milestones and next steps.", room: "Room D", facilitator: "Kunalbhai Bhatt" },
  ],
  Medical: [
    { title: "First Aid Coverage Model", description: "Stations, staffing and escalation paths.", room: "Room E", facilitator: "Rinaben Mehta" },
    { title: "Working with Local EMS", description: "Agreements and communication with local services.", room: "Room E", facilitator: "Rinaben Mehta" },
    { title: "Medical Action Plan", description: "Owners, milestones and next steps.", room: "Room E", facilitator: "Rinaben Mehta" },
  ],
  "Kitchen & Prasad": [
    { title: "Menu Planning for 5,000", description: "Balancing variety, dietary needs and prep time.", room: "Dining Hall Annex", facilitator: "Vivekbhai Amin" },
    { title: "Prasad Distribution Flow", description: "Serving lines, timing and volunteer roles.", room: "Dining Hall Annex", facilitator: "Meeraben Patel" },
    { title: "Kitchen Action Plan", description: "Owners, milestones and next steps.", room: "Dining Hall Annex", facilitator: "Vivekbhai Amin" },
  ],
  "Security & Parking": [
    { title: "Perimeter & Access Control", description: "Entry points, badges and volunteer posts.", room: "Room F", facilitator: "Sanjaybhai Trivedi" },
    { title: "Parking Operations", description: "Lot layouts, signage and shuttle loops.", room: "Room F", facilitator: "Sanjaybhai Trivedi" },
    { title: "Security Action Plan", description: "Owners, milestones and next steps.", room: "Room F", facilitator: "Sanjaybhai Trivedi" },
  ],
};

// ---------------------------------------------------------------------------
async function main() {
  const seedMock = process.env.SEED_MOCK_DATA === "true";
  console.log(seedMock ? "Seeding content + mock users/breakouts." : "Seeding content only (SEED_MOCK_DATA is not true).");

  // Only the delegate menu is reset (and recreated below, with the DELEGATE
  // default); the Santo menu is synced on its own further down.
  console.log("Resetting content tables (schedule + delegate menu)...");
  await prisma.menuItem.deleteMany({ where: { meal: { menuFor: MenuFor.DELEGATE } } });
  await prisma.meal.deleteMany({ where: { menuFor: MenuFor.DELEGATE } });
  await prisma.scheduleItem.deleteMany();

  if (seedMock) {
    console.log("Resetting users and breakouts (the real ones are synced again below)...");
    await prisma.breakout.deleteMany();
    await prisma.otpCode.deleteMany();
    await prisma.user.deleteMany();
    console.log(`Creating ${mockUsers.length} mock users...`);
    await prisma.user.createMany({ data: mockUsers });
  }

  console.log(`Creating ${schedule.length} schedule items...`);
  const slotIdByMealKey = new Map<string, string>();
  for (const [i, item] of schedule.entries()) {
    const created = await prisma.scheduleItem.create({
      data: {
        title: item.title,
        description: item.description,
        location: item.location,
        kind: item.kind,
        audience: item.audience ?? ALL,
        startsAt: at(item.day, item.start),
        endsAt: at(item.day, item.end),
        sortOrder: i,
      },
    });
    if (item.mealKey) slotIdByMealKey.set(item.mealKey, created.id);
  }

  console.log(`Creating ${meals.length} meals...`);
  for (const meal of meals) {
    await prisma.meal.create({
      data: {
        scheduleItemId: slotIdByMealKey.get(meal.key),
        name: meal.name,
        note: meal.note,
        location: meal.location,
        startsAt: at(meal.day, meal.start),
        endsAt: at(meal.day, meal.end),
        items: {
          create: meal.items.map((m, idx) => ({
            course: m.course,
            name: m.name,
            description: m.description,
            tags: m.tags ?? [],
            sortOrder: idx,
          })),
        },
      },
    });
  }
  for (const key of slotIdByMealKey.keys()) {
    if (!meals.some((m) => m.key === key)) throw new Error(`Schedule references unknown meal "${key}"`);
  }

  // Real team breakouts (prisma/breakouts-data.ts), like the schedule: always.
  // In mock mode every breakout was deleted above, so they are recreated here.
  // The schedule was just recreated at its printed times, so live moves on the
  // team breakouts are reset too (resetMoves).
  console.log("Syncing team breakouts (prisma/breakouts-data.ts)...");
  for (const line of syncSummary(await syncBreakouts(prisma, { resetMoves: true }))) console.log(`  ${line}`);

  // The Pujya Santo general schedule (prisma/sant-schedule-data.ts), like the schedule: always.
  console.log("Syncing the Santo general schedule (prisma/sant-schedule-data.ts)...");
  for (const line of santScheduleSummary(await syncSantSchedule(prisma))) console.log(`  ${line}`);

  // The Pujya Santo menu (prisma/sant-menu-data.ts, SANT meals only), like the Santo schedule: always.
  console.log("Syncing the Santo menu (prisma/sant-menu-data.ts)...");
  for (const line of santMenuSummary(await syncSantMenu(prisma))) console.log(`  ${line}`);

  if (!seedMock) {
    console.log("Seed complete.");
    return;
  }

  console.log("Creating mock breakout sessions...");
  let count = 0;
  for (const [seva, sessions] of Object.entries(breakoutsBySeva)) {
    for (const [i, slot] of breakoutSlots.entries()) {
      const s = sessions[i];
      if (!s) continue;
      await prisma.breakout.create({
        data: {
          seva,
          title: s.title,
          description: s.description,
          room: s.room,
          facilitator: s.facilitator,
          startsAt: at(slot.day, slot.start),
          endsAt: at(slot.day, slot.end),
        },
      });
      count++;
    }
  }
  console.log(`Created ${count} breakout sessions.`);
  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
