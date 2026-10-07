/**
 * The bounce tracker's vocabulary and grouping (/admin/bounces, the Overview
 * card, `npm run ses:bounces -- --list`): plain labels for SES's bounce,
 * complaint and reject events, how bad each is, and the events of one address
 * folded into one entry (Open while any event of it is unresolved).
 *
 * Pure and client-safe (no imports), so scripts use it through tsx too.
 */

export type EmailEventKindName = "BOUNCE" | "COMPLAINT" | "REJECT";

/** What the tracker reads of an email_events row. */
export type StoredEmailEvent = {
  id: string;
  kind: EmailEventKindName;
  recipient: string;
  bounceType: string | null;
  bounceSubType: string | null;
  diagnostic: string | null;
  complaintType: string | null;
  occurredAt: Date;
  source: string;
  resolvedAt: Date | null;
  /** The admin who resolved it, as shown (null when not resolved or the account is gone). */
  resolvedByName: string | null;
  note: string | null;
};

/** Error (ember): the address can't get codes as it is. Warn (coral): it may work next time. */
export type EventTone = "error" | "warn";

/** "Hard bounce" (Permanent), "Soft bounce" (Transient), "Bounce" (Undetermined), "Complaint", "Rejected". */
export function eventLabel(e: Pick<StoredEmailEvent, "kind" | "bounceType">): string {
  if (e.kind === "COMPLAINT") return "Complaint";
  if (e.kind === "REJECT") return "Rejected";
  if (e.bounceType === "Permanent") return "Hard bounce";
  if (e.bounceType === "Transient") return "Soft bounce";
  return "Bounce";
}

/** A hard bounce: SES puts the address on the account suppression list and stops sending to it. */
export function isHardBounce(e: Pick<StoredEmailEvent, "kind" | "bounceType">): boolean {
  return e.kind === "BOUNCE" && e.bounceType === "Permanent";
}

const BOUNCE_SUBTYPES: Record<string, string> = {
  General: "Refused by the receiving server",
  NoEmail: "No such address",
  Suppressed: "On SES's global suppression list",
  OnAccountSuppressionList: "Not sent: the address is on the SES suppression list",
  MailboxFull: "Mailbox full",
  MessageTooLarge: "Message too large",
  ContentRejected: "Content rejected",
  AttachmentRejected: "Attachment rejected",
};

const COMPLAINT_TYPES: Record<string, string> = {
  abuse: "Reported as spam",
  "auth-failure": "Authentication failure report",
  fraud: "Reported as fraud",
  "not-spam": "Reported as not spam",
  virus: "Reported a virus",
  other: "Other report",
  OnAccountSuppressionList: "Not sent: the address is on the SES suppression list",
};

/** SES's subtype in plain words ("No such address"), or null when it says nothing more. */
export function subTypeLabel(e: Pick<StoredEmailEvent, "kind" | "bounceSubType" | "complaintType">): string | null {
  if (e.kind === "BOUNCE") {
    const sub = e.bounceSubType;
    if (!sub || sub === "Undetermined") return null;
    return BOUNCE_SUBTYPES[sub] ?? sub;
  }
  if (e.kind === "COMPLAINT") {
    const type = e.complaintType;
    return type ? (COMPLAINT_TYPES[type] ?? type) : null;
  }
  return null;
}

/** Higher = worse: hard bounce, complaint, reject, undetermined bounce, soft bounce. */
export function severity(e: Pick<StoredEmailEvent, "kind" | "bounceType">): number {
  if (isHardBounce(e)) return 5;
  if (e.kind === "COMPLAINT") return 4;
  if (e.kind === "REJECT") return 3;
  if (e.bounceType === "Transient") return 1;
  return 2;
}

export function eventTone(e: Pick<StoredEmailEvent, "kind" | "bounceType">): EventTone {
  return severity(e) >= 3 ? "error" : "warn";
}

/** One address's events, folded. */
export type RecipientGroup = {
  recipient: string;
  /** Newest first. */
  events: StoredEmailEvent[];
  /** Any event without resolvedAt. */
  open: boolean;
  /** The worst event (latest of the worst kind). */
  worst: StoredEmailEvent;
  latest: StoredEmailEvent;
  first: Date;
  last: Date;
  /** Any hard bounce: SES won't send to the address until it is off the suppression list. */
  hard: boolean;
  /** Any complaint. */
  complaint: boolean;
  /** When it was last resolved (resolved entries only), and by whom. */
  resolvedAt: Date | null;
  resolvedByName: string | null;
  /** The admin's latest note (kept when reopened). */
  note: string | null;
};

const newestFirst = (a: StoredEmailEvent, b: StoredEmailEvent) =>
  b.occurredAt.getTime() - a.occurredAt.getTime() || a.id.localeCompare(b.id);

/** Folds rows by recipient: open entries first (latest event first), then resolved ones (latest resolved first). */
export function groupEmailEvents(rows: readonly StoredEmailEvent[]): RecipientGroup[] {
  const byRecipient = new Map<string, StoredEmailEvent[]>();
  for (const row of rows) {
    const list = byRecipient.get(row.recipient);
    if (list) list.push(row);
    else byRecipient.set(row.recipient, [row]);
  }
  const groups: RecipientGroup[] = [];
  for (const [recipient, list] of byRecipient) {
    const events = [...list].sort(newestFirst);
    const latest = events[0];
    const worst = events.reduce((w, e) => (severity(e) > severity(w) ? e : w), latest);
    const open = events.some((e) => e.resolvedAt === null);
    const resolved = events
      .filter((e) => e.resolvedAt !== null)
      .sort((a, b) => b.resolvedAt!.getTime() - a.resolvedAt!.getTime());
    const noted = [...events]
      .filter((e) => e.note)
      .sort((a, b) => (b.resolvedAt?.getTime() ?? 0) - (a.resolvedAt?.getTime() ?? 0) || newestFirst(a, b));
    groups.push({
      recipient,
      events,
      open,
      worst,
      latest,
      first: events[events.length - 1].occurredAt,
      last: latest.occurredAt,
      hard: events.some(isHardBounce),
      complaint: events.some((e) => e.kind === "COMPLAINT"),
      resolvedAt: open ? null : (resolved[0]?.resolvedAt ?? null),
      resolvedByName: open ? null : (resolved[0]?.resolvedByName ?? null),
      note: noted[0]?.note ?? null,
    });
  }
  return groups.sort((a, b) => {
    if (a.open !== b.open) return a.open ? -1 : 1;
    if (a.open) return b.last.getTime() - a.last.getTime() || a.recipient.localeCompare(b.recipient);
    return (b.resolvedAt?.getTime() ?? 0) - (a.resolvedAt?.getTime() ?? 0) || a.recipient.localeCompare(b.recipient);
  });
}

/** The tracker's counts: addresses, not events. */
export type BounceCounts = {
  /** Addresses with an unresolved event. */
  open: number;
  /** Of those, with a hard bounce (SES won't send to them). */
  openHard: number;
  /** Addresses whose every event is resolved. */
  resolved: number;
};

export function bounceCounts(groups: readonly RecipientGroup[]): BounceCounts {
  const open = groups.filter((g) => g.open);
  return { open: open.length, openHard: open.filter((g) => g.hard).length, resolved: groups.length - open.length };
}

/** Longest admin note. */
export const NOTE_MAX = 200;

/** A note as stored: one line, single spaces, at most NOTE_MAX characters; null when blank. */
export function tidyNote(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, NOTE_MAX) : null;
}
