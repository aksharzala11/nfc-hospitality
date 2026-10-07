import { buildScheduleResponse, displayGet, displayOptions } from "@/lib/display";

/** The delegate schedule for the TV screens (docs/DISPLAY_API.md). Read-only; logic in src/lib/display.ts. */
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return displayGet(req, "schedule", { day: "all", track: true }, buildScheduleResponse);
}

export function OPTIONS() {
  return displayOptions();
}
