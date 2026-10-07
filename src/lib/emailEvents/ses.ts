/**
 * SES events -> email_events rows (the admin bounce tracker, /admin/bounces).
 *
 * Reads ONLY what is needed to fix an address: the event type, SES's message
 * id and time, the bounce / complaint details per affected recipient, and for
 * a reject the recipients (mail.destination) and SES's reason. Never
 * mail.commonHeaders or mail.headers (the subject holds the sign-in code),
 * mail.source, or any recipient besides the bounced / complained ones. The
 * receiving server's reply is cleaned (one line, printable), any run of
 * OTP_LENGTH digits in it masked, and cut short.
 *
 * Handles both shapes SES sends: event publishing (a configuration set's
 * event destination: `eventType` "Bounce" | "Complaint" | "Reject" ...) and
 * identity feedback notifications (`notificationType` "Bounce" | "Complaint").
 * Other types (Send, Delivery, Open, ...) give no rows.
 *
 * Pure apart from node:crypto (a fallback id); relative imports only, so
 * scripts/ses-bounces.ts can use it through tsx.
 */
import { createHash } from "node:crypto";
import { OTP_LENGTH } from "../otp/constants";
import type { EmailEventKindName } from "./view";

export type EmailEventSource = "sns" | "suppression-list";

/** One row for email_events (Prisma's EmailEvent create input, minus the admin's columns). */
export type EmailEventRow = {
  id: string;
  kind: EmailEventKindName;
  recipient: string;
  bounceType: string | null;
  bounceSubType: string | null;
  diagnostic: string | null;
  complaintType: string | null;
  sesMessageId: string | null;
  occurredAt: Date;
  source: EmailEventSource;
};

/** How much of a server's reply is kept. */
export const DIAGNOSTIC_MAX = 300;
const MAX_EMAIL = 254;
/** Rows one event may give (a reject lists every destination; we send to one). */
const MAX_ROWS_PER_EVENT = 50;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** A bare, lower-cased address ("Name <a@b.c>" -> "a@b.c"), or null when it isn't one. */
export function normaliseAddress(raw: unknown): string | null {
  const s = str(raw);
  if (!s) return null;
  const angled = /<([^<>\s]+)>\s*$/.exec(s);
  const address = (angled ? angled[1] : s).trim().toLowerCase();
  if (address.length > MAX_EMAIL || /\s/.test(address)) return null;
  return /^[^@]+@[^@]+\.[^@]+$/.test(address) ? address : null;
}

/** A short code-like value (a bounce type, subtype, feedback type), or null. */
function token(raw: unknown, max = 40): string | null {
  const s = str(raw);
  return s && s.length <= max && /^[A-Za-z][A-Za-z0-9_-]*$/.test(s) ? s : null;
}

/** An SES id usable in our row id (a feedback id or message id), or null. */
function idPart(raw: unknown): string | null {
  const s = str(raw);
  return s && s.length <= 200 && /^[A-Za-z0-9._@+=-]+$/.test(s) ? s : null;
}

/** A timestamp SES gave, or null. */
function time(raw: unknown): Date | null {
  const s = str(raw);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

const OTP_RUN = new RegExp(`\\b\\d{${OTP_LENGTH}}\\b`, "g");

/**
 * The receiving server's reply as one short, printable line: control
 * characters dropped, spaces collapsed, any OTP_LENGTH-digit number masked (in
 * case a server quotes the subject, which starts with the code), at most
 * DIAGNOSTIC_MAX characters.
 */
export function cleanDiagnostic(parts: readonly unknown[]): string | null {
  const text = parts
    .map(str)
    .filter((p): p is string => p !== null)
    .join(" · ")
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(OTP_RUN, "•".repeat(OTP_LENGTH));
  if (!text) return null;
  return text.length > DIAGNOSTIC_MAX ? `${text.slice(0, DIAGNOSTIC_MAX - 1).trimEnd()}…` : text;
}

/** "<feedback id or message id>:<recipient>", or a hash of what we know when SES gave neither. */
function rowId(ids: readonly unknown[], recipient: string, kind: EmailEventKindName, at: Date): string {
  const id = ids.map(idPart).find((x): x is string => x !== null);
  if (id) return `${id}:${recipient}`;
  const hash = createHash("sha256").update(`${kind}|${recipient}|${at.toISOString()}`).digest("hex").slice(0, 32);
  return `x-${hash}:${recipient}`;
}

/**
 * The rows for one SES event (the SNS notification's Message, parsed).
 * `fallbackAt`: when SES gives no usable time (the SNS Timestamp).
 * Empty for any event that isn't a bounce, complaint or reject, or that names
 * no usable recipient.
 */
export function rowsFromSesEvent(message: unknown, fallbackAt: Date): EmailEventRow[] {
  const event = obj(message);
  if (!event) return [];
  const type = str(event.eventType) ?? str(event.notificationType);
  const mail = obj(event.mail);
  const messageId = mail ? idPart(mail.messageId) : null;
  const rows: EmailEventRow[] = [];
  const push = (row: EmailEventRow) => {
    if (rows.length < MAX_ROWS_PER_EVENT && !rows.some((r) => r.id === row.id)) rows.push(row);
  };

  if (type === "Bounce") {
    const bounce = obj(event.bounce);
    if (!bounce) return [];
    const at = time(bounce.timestamp) ?? (mail && time(mail.timestamp)) ?? fallbackAt;
    for (const entry of list(bounce.bouncedRecipients)) {
      const r = obj(entry);
      const recipient = r && normaliseAddress(r.emailAddress);
      if (!r || !recipient) continue;
      push({
        id: rowId([bounce.feedbackId, messageId], recipient, "BOUNCE", at),
        kind: "BOUNCE",
        recipient,
        bounceType: token(bounce.bounceType),
        bounceSubType: token(bounce.bounceSubType),
        diagnostic: cleanDiagnostic([r.action, r.status, r.diagnosticCode]),
        complaintType: null,
        sesMessageId: messageId,
        occurredAt: at,
        source: "sns",
      });
    }
  } else if (type === "Complaint") {
    const complaint = obj(event.complaint);
    if (!complaint) return [];
    const at = time(complaint.timestamp) ?? (mail && time(mail.timestamp)) ?? fallbackAt;
    for (const entry of list(complaint.complainedRecipients)) {
      const r = obj(entry);
      const recipient = r && normaliseAddress(r.emailAddress);
      if (!recipient) continue;
      push({
        id: rowId([complaint.feedbackId, messageId], recipient, "COMPLAINT", at),
        kind: "COMPLAINT",
        recipient,
        bounceType: null,
        bounceSubType: null,
        diagnostic: null,
        complaintType: token(complaint.complaintFeedbackType) ?? token(complaint.complaintSubType),
        sesMessageId: messageId,
        occurredAt: at,
        source: "sns",
      });
    }
  } else if (type === "Reject") {
    if (!mail) return [];
    const reject = obj(event.reject);
    const at = time(mail.timestamp) ?? fallbackAt;
    for (const dest of list(mail.destination)) {
      const recipient = normaliseAddress(dest);
      if (!recipient) continue;
      push({
        id: rowId([messageId], recipient, "REJECT", at),
        kind: "REJECT",
        recipient,
        bounceType: null,
        bounceSubType: null,
        diagnostic: cleanDiagnostic([reject?.reason]),
        complaintType: null,
        sesMessageId: messageId,
        occurredAt: at,
        source: "sns",
      });
    }
  }
  return rows;
}

/** One entry of the SES account suppression list (sesv2 GetSuppressedDestination). */
export type SuppressedEntry = {
  emailAddress: string;
  reason: string | undefined;
  lastUpdateTime: Date | undefined;
  messageId?: string | undefined;
  feedbackId?: string | undefined;
};

/**
 * The row for a suppression-list entry (`npm run ses:bounces -- --backfill`):
 * SES puts an address there after a hard bounce (reason BOUNCE) or a complaint
 * (COMPLAINT) and sends nothing more to it until it is removed. Keyed like the
 * SNS event that put it there (same feedback id), so the two never double up.
 * Null for an address or reason we can't read.
 */
export function rowFromSuppressedDestination(entry: SuppressedEntry): EmailEventRow | null {
  const recipient = normaliseAddress(entry.emailAddress);
  const kind = entry.reason === "BOUNCE" ? "BOUNCE" : entry.reason === "COMPLAINT" ? "COMPLAINT" : null;
  const at = entry.lastUpdateTime && !Number.isNaN(entry.lastUpdateTime.getTime()) ? entry.lastUpdateTime : null;
  if (!recipient || !kind || !at) return null;
  return {
    id: rowId([entry.feedbackId, entry.messageId], recipient, kind, at),
    kind,
    recipient,
    // Only hard bounces put an address on the account suppression list.
    bounceType: kind === "BOUNCE" ? "Permanent" : null,
    bounceSubType: null,
    diagnostic: null,
    complaintType: null,
    sesMessageId: idPart(entry.messageId),
    occurredAt: at,
    source: "suppression-list",
  };
}
