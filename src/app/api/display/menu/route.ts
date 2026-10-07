import { buildMenuResponse, displayGet, displayOptions } from "@/lib/display";

/** The delegate menu, reveal-gated, for the TV screens (docs/DISPLAY_API.md). Read-only; logic in src/lib/display.ts. */
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return displayGet(req, "menu", { day: "today" }, buildMenuResponse);
}

export function OPTIONS() {
  return displayOptions();
}
