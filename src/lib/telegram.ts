/**
 * Telegram contacts (user, 2026-10-06): the Santo view's contacts and utaro hosts carry a
 * Telegram username beside their phone, and a "Message on Telegram" button opens a chat.
 *
 * Stored as the bare username ("example_name": no "@", no link), or, for someone found by phone
 * number, "+" and the E.164 digits. Links go to https://t.me/<value>: the Telegram app opens
 * the chat where it's installed (the in-app browser hands it over), else the t.me page offers
 * it. Opened in the same tab, like every external link in the Hub.
 *
 * Pure: client-safe, no database.
 */

/** Telegram usernames: 5-32 letters, digits and underscores, starting with a letter. */
const USERNAME = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;

/**
 * What to store for a handle as the organisers write it ("@Example_Name", "t.me/example_name",
 * "https://t.me/example_name", "+1 732 555 0142"), or null when it can't be one. A username never
 * has spaces, so a value with spaces inside (a display name, "Example Name") is not one: only a
 * phone number may be written with spaces. A number without "+" and with 10 digits is read as
 * North American; one with "+" keeps its own country code.
 */
export function normalizeTelegram(input: string | null | undefined): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  const bare = raw.replace(/^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\//i, "").replace(/^@/, "");
  if (USERNAME.test(bare)) return bare;
  if (/^\+?[\d\s().-]+$/.test(bare)) {
    const digits = bare.replace(/\D/g, "");
    const international = bare.startsWith("+");
    if (international ? digits.length >= 8 && digits.length <= 15 : digits.length === 10 || (digits.length === 11 && digits.startsWith("1"))) {
      return `+${!international && digits.length === 10 ? `1${digits}` : digits}`;
    }
  }
  return null;
}

/** The chat link for a stored value, or null for none. */
export function telegramHref(value: string | null | undefined): string | null {
  const v = normalizeTelegram(value);
  return v ? `https://t.me/${v}` : null;
}
