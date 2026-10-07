import type { User } from "@prisma/client";
import { santName } from "@/lib/sant";

/** First letter of a plain sant name, upper-cased: "Testdas" -> "T". "?" when empty. */
export function nameInitial(name: string): string {
  const first = Array.from(name.trim())[0];
  return first ? first.toLocaleUpperCase("en") : "?";
}

/**
 * One letter for a sant's avatar, from santName() (no honorifics):
 * "Sadhu Testdas" -> "Testdas" -> "T".
 */
export function santInitial(user: Pick<User, "name" | "displayName">): string {
  return nameInitial(santName(user));
}
