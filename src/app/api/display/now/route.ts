import { buildNowResponse, displayGet, displayOptions } from "@/lib/display";

/** What's on now and next, per track, for the TV screens (docs/DISPLAY_API.md). Read-only; logic in src/lib/display.ts. */
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return displayGet(req, "now", {}, buildNowResponse);
}

export function OPTIONS() {
  return displayOptions();
}
