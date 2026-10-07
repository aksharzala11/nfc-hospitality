/**
 * Master-list delegates' email addresses (organisers, 2026-09-27): every
 * delegate the import brings in from the master list gets exactly
 * "<BAPS ID lower-case>@na.baps.id". The organisers' "BAPS Email" list is no
 * longer used for delegates. The admin person form offers the same default
 * while a delegate's email is empty (bapsEmail() in
 * src/components/admin/delegates/directory.ts). Santos keep their own sheet's
 * addresses (scripts/import-santos.ts).
 *
 * Pure: no database, no file access, no DNS.
 */

/** The delegates' domain: "<BAPS ID lower-case>@na.baps.id". */
export const DELEGATE_EMAIL_DOMAIN = "na.baps.id";

/**
 * Local part: dot-atom letters, digits and _ ' + - (no leading, trailing or
 * double dot). A subset of what the admin console's email field (zod) accepts,
 * so an imported address can always be saved from the delegate form.
 */
const LOCAL_PART = /^(?!\.)(?!.*\.\.)[a-z0-9_'+.-]*[a-z0-9_+-]$/;
/** Domain: two or more labels (letters, digits, inner hyphens), alphabetic TLD. */
const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;

/** A lower-case address the import can store: valid local part and domain, at most 254 characters. */
export function isValidEmail(email: string): boolean {
  if (email.length > 254 || email !== email.toLowerCase()) return false;
  const at = email.lastIndexOf("@");
  if (at <= 0 || email.indexOf("@") !== at) return false;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  return local.length <= 64 && domain.length <= 253 && LOCAL_PART.test(local) && DOMAIN.test(domain);
}

/** "<BAPS ID lower-case>@na.baps.id". */
export function defaultDelegateEmail(bapsId: string): string {
  return `${bapsId.trim().toLowerCase()}@${DELEGATE_EMAIL_DOMAIN}`;
}

/** The part after the "@" ("" when there is none), lower-cased. */
export function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at < 0 ? "" : email.slice(at + 1).trim().toLowerCase();
}
