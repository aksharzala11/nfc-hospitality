import { prisma } from "@/lib/db";
import { rowsFromSesEvent } from "@/lib/emailEvents/ses";
import {
  MAX_SNS_BODY_BYTES,
  confirmSubscription,
  confirmationUrl,
  readSnsMessage,
  verifySnsMessage,
} from "@/lib/emailEvents/sns";

/**
 * Amazon SNS HTTPS endpoint for the SES events of the sign-in emails: the
 * `naam-hospitality-hub` configuration set publishes BOUNCE, COMPLAINT and
 * REJECT events to the SNS topic named by SES_EVENTS_TOPIC_ARN, subscribed to
 * this URL. Stores one email_events row per affected recipient for the admin
 * bounce tracker (/admin/bounces). POST only.
 *
 *   SES_EVENTS_TOPIC_ARN unset          404 (the endpoint is off)
 *   not an SNS message / too big        400
 *   another topic, or a bad signature   403 (checked before anything else is done)
 *   SubscriptionConfirmation            visits the SubscribeURL (an SNS host, this topic only), 200
 *   UnsubscribeConfirmation             200, nothing else (never re-subscribes)
 *   Notification                        rows upserted by id (SNS may deliver twice), 200;
 *                                       a database error is a 503, so SNS retries
 *
 * The subscription must deliver the SNS envelope (raw message delivery OFF):
 * without it there is no signature to check, and every message is refused.
 * Logs at most the kind and count of what was stored, never the body, the
 * headers or an address. The middleware never matches /api/*: this handler is
 * its own gate. Data model and rules: src/lib/emailEvents/.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

export async function POST(req: Request) {
  const topicArn = process.env.SES_EVENTS_TOPIC_ARN?.trim();
  if (!topicArn) return text("Not found", 404);

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_SNS_BODY_BYTES) return text("Too large", 400);
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return text("Bad request", 400);
  }
  if (raw.length > MAX_SNS_BODY_BYTES) return text("Too large", 400);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return text("Bad request", 400);
  }
  const message = readSnsMessage(parsed);
  if (!message) return text("Bad request", 400);
  // Another topic's message is refused before its certificate is fetched.
  if (message.TopicArn !== topicArn) return text("Forbidden", 403);
  if (!(await verifySnsMessage(message))) {
    console.warn("SES events: refused a message with a bad signature");
    return text("Forbidden", 403);
  }

  if (message.Type === "SubscriptionConfirmation") {
    const url = confirmationUrl(message, topicArn);
    if (!url) return text("Bad request", 400);
    try {
      await confirmSubscription(url);
    } catch {
      console.error("SES events: couldn't confirm the SNS subscription");
      return text("Confirmation failed", 502);
    }
    console.info("SES events: SNS subscription confirmed");
    return text("OK", 200);
  }
  if (message.Type === "UnsubscribeConfirmation") {
    console.info("SES events: SNS unsubscribe confirmation received (nothing done)");
    return text("OK", 200);
  }

  let event: unknown;
  try {
    event = JSON.parse(message.Message);
  } catch {
    // A signed message that isn't an SES event (e.g. a test publish): nothing to store.
    return text("OK", 200);
  }
  const at = new Date(message.Timestamp);
  const rows = rowsFromSesEvent(event, Number.isNaN(at.getTime()) ? new Date() : at);
  if (rows.length === 0) return text("OK", 200);

  try {
    // Insert ... on conflict (id) do nothing: a redelivered event is stored once, and a row an
    // admin already resolved stays resolved.
    const { count } = await prisma.emailEvent.createMany({ data: rows, skipDuplicates: true });
    console.info(`SES events: ${rows[0].kind.toLowerCase()} for ${rows.length} recipient(s), ${count} new`);
  } catch (err) {
    const code = (err as { code?: unknown })?.code;
    console.error(`SES events: couldn't store the event (${typeof code === "string" ? code : "database error"})`);
    return text("Unavailable", 503);
  }
  return text("OK", 200);
}
