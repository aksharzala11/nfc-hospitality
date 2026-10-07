/**
 * A sant's name as the Santo view shows it (santName()). Pure (no database), so the session
 * code (src/lib/auth.ts, the Santo mirror band) and scripts (scripts/seed-sant-demo.ts) can use
 * it too; src/lib/sant.ts re-exports it, and pages import it from there.
 */
import type { User } from "@prisma/client";
// Relative, so a tsx script resolves it without the "@/" path alias.
import { greetingName } from "./users";

/** One leading honorific: "Pujya " / "Pūjya ", "Sadhu " / "Sādhu ", "Pu." or "P." (space after the dot optional). */
const LEADING_HONORIFIC = /^(?:(?:p[uū]jya|s[aā]dhu)\s+|p[uū]?\.\s*)/iu;
/** A trailing " Swami" / " Swāmī" (any mix of the macrons). */
const TRAILING_SWAMI = /\s+sw[aā]m[iī]$/iu;

/**
 * A sant's name as shown in the Santo view: no honorifics, e.g. "Munitilakdas".
 * Starts from greetingName() (displayName, else the full name), removes any
 * leading "Pujya", "Pu.", "P." or "Sadhu"/"Sādhu" (also combined, e.g.
 * "Pujya Sadhu ...") and a trailing "Swami"/"Swāmī":
 *   "Sadhu Munitilakdas" -> "Munitilakdas", "Pujya Test Swami" -> "Test".
 * If that would leave nothing, the name is returned as entered.
 */
export function santName(user: Pick<User, "name" | "displayName">): string {
  const base = greetingName(user).normalize("NFC").replace(/\s+/g, " ").trim();
  let core = base;
  for (let prev = ""; core !== prev; ) {
    prev = core;
    core = core.replace(LEADING_HONORIFIC, "");
  }
  core = core.replace(TRAILING_SWAMI, "").trim();
  return core || base;
}
