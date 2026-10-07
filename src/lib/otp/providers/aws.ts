import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import type { OtpProvider } from "@/lib/otp/providers";
import { OTP_TTL_MINUTES } from "@/lib/otp/constants";
import { EMAIL_LOGO_CID, EMAIL_LOGO_HEIGHT, EMAIL_LOGO_PNG_BASE64, EMAIL_LOGO_WIDTH } from "@/lib/otp/emailLogo";
import { EVENT_DATES, EVENT_NAME, EVENT_PLACE } from "@/lib/branding";

// Clients pick up credentials from the default chain: env vars, a shared
// profile, or the IAM role attached to the Lightsail/EC2 instance or container.
const region = process.env.AWS_REGION ?? "us-east-1";
let ses: SESv2Client | undefined;
let sns: SNSClient | undefined;

function sesClient() {
  return (ses ??= new SESv2Client({ region }));
}
function snsClient() {
  return (sns ??= new SNSClient({ region }));
}

const APP_NAME = "Hospitality Hub";

/**
 * Sender used when SES_FROM_EMAIL is unset: the organisers' SES identity (DKIM-verified).
 * No colon in the display name ("NAAM 2026: …" would need quoting; formatMailbox does that
 * if an env value has one).
 */
export const DEFAULT_SES_FROM = "NAAM 2026 Hospitality Hub <noreply@sypramsoftware.com>";

/** Trimmed env value, or undefined when unset/blank. */
function env(key: string) {
  return process.env[key]?.trim() || undefined;
}

/**
 * Amazon SES (email) + Amazon SNS (SMS).
 *
 * SES: verify the sending domain/address and request production access so
 * you can email unverified recipients. Env:
 *   SES_FROM_EMAIL         sender (default DEFAULT_SES_FROM); must be verified in AWS_REGION
 *   SES_REPLY_TO           optional, comma-separated Reply-To addresses
 *   SES_CONFIGURATION_SET  optional, sent as ConfigurationSetName (bounce/complaint events);
 *                          keep open/click tracking off in it (no pixel in an OTP email)
 * SNS: US SMS traffic needs a registered origination identity (10DLC or
 * toll-free number). Request an SNS spending-limit increase before the event.
 */
export const awsProvider: OtpProvider = {
  async sendEmail({ to, code, name }) {
    const from = formatMailbox(env("SES_FROM_EMAIL") ?? DEFAULT_SES_FROM);
    const replyTo = splitAddressList(env("SES_REPLY_TO") ?? "").map(formatMailbox);
    const configurationSet = env("SES_CONFIGURATION_SET");

    const { subject, text, html } = signInEmail({ code, name });

    await sesClient().send(
      new SendEmailCommand({
        FromEmailAddress: from,
        Destination: { ToAddresses: [to] },
        ...(replyTo.length ? { ReplyToAddresses: replyTo } : {}),
        ...(configurationSet
          ? {
              ConfigurationSetName: configurationSet,
              EmailTags: [{ Name: "category", Value: "sign-in-code" }],
            }
          : {}),
        Content: {
          Simple: {
            Subject: { Data: subject, Charset: "UTF-8" },
            Body: {
              Text: { Data: text, Charset: "UTF-8" },
              Html: { Data: html, Charset: "UTF-8" },
            },
            // The Sāchu lock-up under the title, inline (cid:) so it shows without loading
            // remote images; the text part doesn't reference it.
            Attachments: [
              {
                FileName: "sachu.png",
                ContentType: "image/png",
                ContentDisposition: "INLINE",
                ContentId: EMAIL_LOGO_CID,
                ContentTransferEncoding: "BASE64",
                RawContent: Buffer.from(EMAIL_LOGO_PNG_BASE64, "base64"),
              },
            ],
            // Machine-generated (RFC 3834): stops out-of-office/auto-replies bouncing
            // back to the no-reply sender. Outlook/Exchange honour the X- header.
            // (No List-Unsubscribe: a one-off transactional code, not a mailing.)
            Headers: [
              { Name: "Auto-Submitted", Value: "auto-generated" },
              { Name: "X-Auto-Response-Suppress", Value: "OOF, AutoReply" },
            ],
          },
        },
      }),
    );
  },

  async sendSms({ to, code }) {
    await snsClient().send(
      new PublishCommand({
        PhoneNumber: to,
        // "From when you asked for it": a message can arrive late, and the time doesn't start then.
        Message: `${APP_NAME}: your sign-in code is ${code}. It works for ${OTP_TTL_MINUTES} minutes from when you asked for it.`,
        MessageAttributes: {
          "AWS.SNS.SMS.SMSType": { DataType: "String", StringValue: "Transactional" },
          ...(process.env.SNS_ORIGINATION_NUMBER
            ? {
                "AWS.MM.SMS.OriginationNumber": {
                  DataType: "String",
                  StringValue: process.env.SNS_ORIGINATION_NUMBER,
                },
              }
            : {}),
        },
      }),
    );
  },
};

/**
 * "Name <addr>" or "addr" from env -> a header-safe mailbox for SES. Drops quotes an env
 * editor left around the whole value, quotes display names containing RFC 5322 specials
 * (e.g. the colon in "NAAM 2026: Hospitality Hub") and MIME-encodes non-ASCII names (RFC
 * 2047), which SES requires. Anything else is passed through for SES to validate.
 */
function formatMailbox(raw: string): string {
  const s = unwrapQuotes(raw.trim());
  const m = /^(.*?)\s*<\s*([^<>\s]+@[^<>\s]+)\s*>$/.exec(s);
  if (!m) return s;
  let displayName = m[1].trim();
  if (displayName.length >= 2 && displayName.startsWith('"') && displayName.endsWith('"')) {
    displayName = displayName.slice(1, -1).replace(/\\(.)/g, "$1").trim();
  }
  return displayName ? `${encodeDisplayName(displayName)} <${m[2]}>` : m[2];
}

function encodeDisplayName(name: string) {
  if (/[^\x20-\x7e]/.test(name)) {
    // Encoded words are capped at 75 chars: 45 UTF-8 bytes -> 60 base64 chars + 12 overhead.
    const words: string[] = [];
    let chunk = "";
    for (const ch of name) {
      if (Buffer.byteLength(chunk + ch, "utf8") > 45) {
        words.push(chunk);
        chunk = "";
      }
      chunk += ch;
    }
    if (chunk) words.push(chunk);
    return words.map((w) => `=?UTF-8?B?${Buffer.from(w, "utf8").toString("base64")}?=`).join(" ");
  }
  return /[()<>[\]:;@\\,."]/.test(name) ? `"${name.replace(/(["\\])/g, "\\$1")}"` : name;
}

/** Strips one pair of quotes wrapping the whole value (`"a <b@c>"`), not `"a" <b@c>`. */
function unwrapQuotes(s: string) {
  const q = s[0];
  if (s.length >= 2 && (q === '"' || q === "'") && s.endsWith(q) && !s.slice(1, -1).includes(q)) {
    return s.slice(1, -1).trim();
  }
  return s;
}

/** Comma-separated address list; commas inside quotes or <…> don't split. */
function splitAddressList(raw: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  let inAngle = false;
  for (const ch of unwrapQuotes(raw.trim())) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch === "<") inAngle = true;
    else if (!inQuotes && ch === ">") inAngle = false;
    else if (ch === "," && !inQuotes && !inAngle) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((a) => a.trim()).filter(Boolean);
}

/**
 * Subject, plain-text and HTML parts of the sign-in email. The two bodies carry the same
 * words (spam filters penalise a text part that differs from the HTML). No links or tracking:
 * the code is all the guest needs; the only image is the inline Sāchu logo (cid:, not remote).
 */
function signInEmail({ code, name }: { code: string; name: string }) {
  const subject = `${code} is your ${EVENT_NAME} ${APP_NAME} sign-in code`;
  const footer = `${EVENT_NAME} · ${EVENT_PLACE} · ${EVENT_DATES}`;
  const text = [
    `${EVENT_NAME} · ${APP_NAME}`,
    ``,
    `Jay Swaminarayan ${name},`,
    ``,
    `Your ${APP_NAME} sign-in code is: ${code}`,
    ``,
    // The email can arrive late (the time runs from the request, not from arrival), and a
    // resend doesn't cancel this code: never say "use the newest code".
    `It works for ${OTP_TTL_MINUTES} minutes from when you asked for it. If you asked for more than one code, any of them works.`,
    `Don't share it with anyone. If you did not request this code, you can ignore this email.`,
    ``,
    footer,
  ].join("\n");
  return { subject, text, html: signInEmailHtml({ subject, name, code, footer }) };
}

/*
 * The sign-in email in the NAAM 2026 "Sāchu" theme: sand canvas, a white card with the coral
 * brand gradient as a hairline, the code on an ink panel. Mail clients won't load the app's
 * fonts, so Just Sans falls back to the system sans and Enilas to Georgia (as in the app).
 * Table layout with inline styles for Outlook/Gmail. The only image is the Sāchu lock-up under
 * the title, sent as an inline attachment (src/lib/otp/emailLogo.ts), so no absolute URL is needed.
 * Brand hex values only: ink #2f4f60 (body and quiet text, sized down) / #213e4b (greeting),
 * coral #f68f77 → #c44147 (hairline; #c44147 also the eyebrow, 5:1 on white), sand #f3eee5 /
 * #e8e0d1.
 */
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";

function signInEmailHtml({ subject, name, code, footer }: { subject: string; name: string; code: string; footer: string }) {
  const preheader = `Your ${APP_NAME} sign-in code is ${code}. It works for ${OTP_TTL_MINUTES} minutes from when you asked for it.`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(subject)}</title>
<style>a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important}</style>
</head>
<body style="margin:0;padding:0;background-color:#f3eee5">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3eee5">
  <tr>
    <td align="center" style="padding:32px 16px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background-color:#ffffff;border:1px solid #e8e0d1;border-radius:20px;overflow:hidden">
        <tr>
          <td style="height:4px;line-height:4px;font-size:0;background-color:#f68f77;background-image:linear-gradient(90deg,#f68f77,#c44147)">&nbsp;</td>
        </tr>
        <tr>
          <td style="padding:28px 28px 0;font-family:${SANS};color:#2f4f60">
            <p style="margin:0 0 16px;font-size:11px;line-height:16px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#c44147">${escapeHtml(EVENT_NAME)} &middot; ${APP_NAME}</p>
            <img src="cid:${EMAIL_LOGO_CID}" width="${EMAIL_LOGO_WIDTH}" height="${EMAIL_LOGO_HEIGHT}" alt="S&#257;chu &middot; ${escapeHtml(EVENT_NAME)}" style="display:block;width:${EMAIL_LOGO_WIDTH}px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;margin:0 0 22px">
            <p style="margin:0 0 12px;font-family:${SERIF};font-size:24px;line-height:30px;color:#213e4b">Jay Swaminarayan ${escapeHtml(name)},</p>
            <p style="margin:0 0 16px;font-size:16px;line-height:24px;color:#2f4f60">Your ${APP_NAME} sign-in code is:</p>
          </td>
        </tr>
        <tr>
          <td style="padding:0 28px">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#2f4f60;border-radius:14px">
              <tr>
                <td align="center" style="padding:22px 12px 22px 22px;font-family:${SANS};font-size:36px;line-height:40px;font-weight:700;letter-spacing:10px;color:#ffffff;font-variant-numeric:tabular-nums">${escapeHtml(code)}</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:18px 28px 28px;font-family:${SANS};font-size:14px;line-height:21px;color:#2f4f60">It works for ${OTP_TTL_MINUTES} minutes from when you asked for it. If you asked for more than one code, any of them works.<br>Don&#39;t share it with anyone. If you did not request this code, you can ignore this email.</td>
        </tr>
      </table>
      <p style="margin:18px 0 0;font-family:${SANS};font-size:12px;line-height:18px;color:#2f4f60">${escapeHtml(footer)}</p>
    </td>
  </tr>
</table>
</body>
</html>`;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
