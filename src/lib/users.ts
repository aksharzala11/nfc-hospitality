/** Helpers for presenting a `users` row. */

import type { Gender, UserRole } from "@prisma/client";

type NameFields = { name: string; displayName: string | null };

/** Name used in the "Jay Swaminarayan {name}" greeting. */
export function greetingName(u: NameFields) {
  return u.displayName?.trim() || u.name;
}

/**
 * The personal name used in a signed-in welcome: the first name followed by
 * "bhai" for Bhaiyo or "ben" for Behno. A name that already has either ending
 * is left alone, so imported display names never become "Rameshbhaibhai".
 * Santos keep the name already stored for them (normally ending in "das").
 */
export function welcomeName(u: NameFields & { gender: Gender | null; role: UserRole }) {
  const base = greetingName(u).normalize("NFC").replace(/\s+/g, " ").trim();
  if (u.role === "SANT") return base;
  const first = base.split(" ")[0] || base;
  if (/\b(?:bhai|ben)$/i.test(first)) return first;
  if (u.gender === "MALE") return `${first}bhai`;
  if (u.gender === "FEMALE") return `${first}ben`;
  return first;
}

/** Up to two initials from the full name, e.g. "Upsham Naik" -> "UN". */
export function initials(u: { name: string }) {
  const parts = u.name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return `${first}${last}`.toUpperCase() || "?";
}

/** Normalise a US/Canada phone number to E.164 (+1XXXXXXXXXX). Returns null if unusable. */
export function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (raw.trim().startsWith("+") && digits.length >= 8) return `+${digits}`;
  return null;
}
