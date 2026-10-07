import { buildBreakoutsResponse, displayGet, displayOptions } from "@/lib/display";

/** The team breakouts by day and slot for the TV screens (docs/DISPLAY_API.md). Read-only; logic in src/lib/display.ts. */
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return displayGet(req, "breakouts", { day: "all", track: true }, buildBreakoutsResponse);
}

export function OPTIONS() {
  return displayOptions();
}
