/**
 * Amazon SNS HTTPS messages: the envelope's shape, its signature, and the
 * subscription confirmation. Used by the SES events endpoint
 * (src/app/api/ses/events/route.ts), which receives the bounce, complaint and
 * reject events of the `naam-hospitality-hub` SES configuration set through
 * the SNS topic named by SES_EVENTS_TOPIC_ARN.
 *
 * Verification follows "Verifying the signatures of Amazon SNS messages" (AWS
 * docs): the string to sign is "Key\nValue\n" for each field, in the order
 * below, SignatureVersion 1 = SHA1withRSA, 2 = SHA256withRSA, the signature
 * base64. The signing certificate is fetched only from an https URL on an SNS
 * host (sns.<region>.amazonaws.com) whose path ends in .pem, never following a
 * redirect, and kept in memory per URL.
 *
 * Server only (node:crypto, network). Nothing here logs a message or a header.
 */
import { X509Certificate, verify as verifySignature, type KeyObject } from "node:crypto";

export type SnsMessageType = "Notification" | "SubscriptionConfirmation" | "UnsubscribeConfirmation";

/** The SNS envelope (the HTTP body, JSON sent as text/plain). Only the fields we use. */
export type SnsMessage = {
  Type: SnsMessageType;
  MessageId: string;
  TopicArn: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: "1" | "2";
  Signature: string;
  SigningCertURL: string;
  /** Notification only, and only when the publisher gave one. */
  Subject?: string;
  /** Confirmations only. */
  Token?: string;
  SubscribeURL?: string;
};

/** An SNS host: sns.<region>.amazonaws.com (the docs' pattern for the certificate and subscribe URLs). */
const SNS_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com$/;

/** An SNS message is at most 256 KB; the envelope adds a little. Anything bigger isn't one. */
export const MAX_SNS_BODY_BYTES = 300 * 1024;

const TYPES: readonly SnsMessageType[] = ["Notification", "SubscriptionConfirmation", "UnsubscribeConfirmation"];

const isString = (v: unknown): v is string => typeof v === "string";

/**
 * The envelope from a parsed body, or null when it isn't a complete SNS
 * message of a type we know (every field the signature covers must be there).
 */
export function readSnsMessage(body: unknown): SnsMessage | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  const type = b.Type;
  if (!isString(type) || !(TYPES as readonly string[]).includes(type)) return null;
  for (const key of ["MessageId", "TopicArn", "Message", "Timestamp", "Signature", "SigningCertURL"]) {
    if (!isString(b[key])) return null;
  }
  if (b.SignatureVersion !== "1" && b.SignatureVersion !== "2") return null;
  if (b.Subject !== undefined && !isString(b.Subject)) return null;
  if (type !== "Notification" && (!isString(b.Token) || !isString(b.SubscribeURL))) return null;
  return {
    Type: type as SnsMessageType,
    MessageId: b.MessageId as string,
    TopicArn: b.TopicArn as string,
    Message: b.Message as string,
    Timestamp: b.Timestamp as string,
    SignatureVersion: b.SignatureVersion,
    Signature: b.Signature as string,
    SigningCertURL: b.SigningCertURL as string,
    ...(isString(b.Subject) ? { Subject: b.Subject } : {}),
    ...(type !== "Notification" ? { Token: b.Token as string, SubscribeURL: b.SubscribeURL as string } : {}),
  };
}

/**
 * The string SNS signed: "Key\nValue\n" per field, in this order.
 *   Notification:                       Message, MessageId, Subject (only if present), Timestamp, TopicArn, Type
 *   SubscriptionConfirmation / Unsubscribe: Message, MessageId, SubscribeURL, Timestamp, Token, TopicArn, Type
 */
export function snsStringToSign(m: SnsMessage): string {
  const keys: (keyof SnsMessage)[] =
    m.Type === "Notification"
      ? ["Message", "MessageId", ...(m.Subject !== undefined ? (["Subject"] as const) : []), "Timestamp", "TopicArn", "Type"]
      : ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"];
  return keys.map((k) => `${k}\n${m[k]}\n`).join("");
}

/** An https URL on an SNS host, or null. `pemPath`: the path must end in .pem (the signing certificate). */
export function snsUrl(raw: string, { pemPath = false } = {}): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  if (!SNS_HOST.test(url.hostname)) return null;
  if (pemPath && !url.pathname.endsWith(".pem")) return null;
  return url;
}

/** Fetches a certificate's PEM text. Injected in tests; the default fetches over https. */
export type CertFetcher = (url: URL) => Promise<string>;

const CERT_TIMEOUT_MS = 5000;
const MAX_CERT_BYTES = 16 * 1024;

const fetchCertPem: CertFetcher = async (url) => {
  const res = await fetch(url, {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(CERT_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`certificate fetch failed (${res.status})`);
  const text = await res.text();
  if (text.length > MAX_CERT_BYTES) throw new Error("certificate too large");
  return text;
};

/** Public keys of the signing certificates seen so far, per URL (SNS rotates them rarely). */
const certCache = new Map<string, KeyObject>();
const MAX_CACHED_CERTS = 16;

async function signingKey(url: URL, fetchCert: CertFetcher): Promise<KeyObject> {
  const key = url.href;
  const cached = certCache.get(key);
  if (cached) return cached;
  const publicKey = new X509Certificate(await fetchCert(url)).publicKey;
  if (certCache.size >= MAX_CACHED_CERTS) {
    const oldest = certCache.keys().next().value;
    if (oldest !== undefined) certCache.delete(oldest);
  }
  certCache.set(key, publicKey);
  return publicKey;
}

/** Forgets the cached certificates (tests). */
export function clearSnsCertCache() {
  certCache.clear();
}

/**
 * True when the message carries a valid SNS signature from a certificate on an
 * SNS host. False for anything else, including a certificate that can't be
 * fetched or read (the caller answers 403; SNS retries on its own schedule).
 */
export async function verifySnsMessage(m: SnsMessage, fetchCert: CertFetcher = fetchCertPem): Promise<boolean> {
  const certUrl = snsUrl(m.SigningCertURL, { pemPath: true });
  if (!certUrl) return false;
  const signature = Buffer.from(m.Signature, "base64");
  if (signature.length === 0) return false;
  let publicKey: KeyObject;
  try {
    publicKey = await signingKey(certUrl, fetchCert);
  } catch {
    return false;
  }
  try {
    return verifySignature(
      m.SignatureVersion === "1" ? "sha1" : "sha256",
      Buffer.from(snsStringToSign(m), "utf8"),
      publicKey,
      signature,
    );
  } catch {
    return false;
  }
}

/**
 * The SubscribeURL to visit to confirm a (verified) SubscriptionConfirmation:
 * only an https URL on an SNS host whose ConfirmSubscription is for `topicArn`.
 * Null otherwise (the caller then confirms nothing).
 */
export function confirmationUrl(m: SnsMessage, topicArn: string): URL | null {
  if (m.Type !== "SubscriptionConfirmation" || !m.SubscribeURL) return null;
  const url = snsUrl(m.SubscribeURL);
  if (!url) return null;
  if (url.searchParams.get("Action") !== "ConfirmSubscription") return null;
  if (url.searchParams.get("TopicArn") !== topicArn) return null;
  return url;
}

/** Visits the SubscribeURL (a GET, no redirects); throws when SNS doesn't answer 2xx. */
export async function confirmSubscription(url: URL): Promise<void> {
  const res = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(CERT_TIMEOUT_MS) });
  // Drain the body (the XML response names the subscription; nothing to keep).
  await res.text().catch(() => "");
  if (!res.ok) throw new Error(`subscription confirmation failed (${res.status})`);
}
