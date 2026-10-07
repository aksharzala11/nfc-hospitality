import { buildIndexResponse, displayGet, displayOptions } from "@/lib/display";

/** The display API's base URL: lists the endpoints (docs/DISPLAY_API.md). Read-only; logic in src/lib/display.ts. */
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return displayGet(req, "index", {}, buildIndexResponse);
}

export function OPTIONS() {
  return displayOptions();
}
