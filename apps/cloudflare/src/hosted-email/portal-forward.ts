import { isClinicalPortalDomain, matchClinicalPortalSender, parsePublicClinicalProviderDirectory, type ClinicalProviderDirectory } from "@murphai/clinical-records/provider-directory";
import { forwardedPortalFallback, portalDiscoverySummary } from "@murphai/clinical-records/portal-discovery-link";
import { parseRawEmailMessage, readRawEmailHeaderValue, type ParsedEmailMessage } from "@murphai/inboxd/connectors/email/parsed";

const portalNotice = /\b(?:my\s?chart|patient\s+portal|followmyhealth|iqhealth|healow|athenahealth|eclinicalmail)\b/iu;
const forwardHeader = /^(?:-+\s*(?:forwarded message|original message)\s*-+|begin forwarded message:)\s*$/imu;
let directory: ClinicalProviderDirectory | undefined;

function quotedText(message: ParsedEmailMessage) {
  return (message.text || message.html?.replace(/<(?:br\b[^>]*|\/div|\/p)>/giu, "\n")
    .replace(/<[^<>]*>/gu, "").replace(/&lt;/giu, "<").replace(/&gt;/giu, ">").replace(/&nbsp;/giu, " ") || "")
    .replace(/\r\n/gu, "\n");
}

async function publicDirectory() {
  directory ??= parsePublicClinicalProviderDirectory((await import("@murphai/clinical-records/provider-directory.v2.json", { with: { type: "json" } })).default);
  return directory;
}

function senderMailbox(sender: string | null) {
  return /^(?:(?<name>[^<>\r\n]{0,320})\s*<[^\s<>@,]+@(?<domain>[^<>\s@,]+)>|[^\s<>@,]+@(?<bareDomain>[^<>\s@,]+))$/u.exec(sender ?? "")?.groups;
}

async function isPortalHeader(sender: string | null, subject: string | null) {
  if (portalNotice.test(sender ?? "") || portalNotice.test(subject ?? "")) return true;
  const mailbox = senderMailbox(sender);
  return !!mailbox && isClinicalPortalDomain(await publicDirectory(), mailbox.domain ?? mailbox.bareDomain);
}

// undefined means ordinary mail. A recognized forward with unusable evidence gets generic Find.
export async function forwardedPortalSender(message: ParsedEmailMessage, replyDomain: string): Promise<string | null | undefined> {
  if (/^\s*re:/iu.test(message.subject ?? "") || [message.inReplyTo, ...message.references]
    .some(id => id?.toLowerCase().replace(/>$/u, "").endsWith(`@${replyDomain.toLowerCase()}`))) return undefined;

  const attached = message.attachments.filter(part => part.contentType === "message/rfc822" || part.fileName?.toLowerCase().endsWith(".eml"));
  for (const part of attached) {
    if (!part.data) continue;
    const from = readRawEmailHeaderValue(part.data, "from").value;
    const subject = readRawEmailHeaderValue(part.data, "subject").value;
    if (!await isPortalHeader(from, subject)) continue;
    // Validate only the first candidate under the ordinary MIME limits.
    try {
      parseRawEmailMessage(part.data);
    } catch (error) {
      if (error instanceof RangeError) return undefined;
      throw error;
    }
    return attached.length === 1 ? from : null;
  }

  return inlinePortalSender(message);
}

async function inlinePortalSender(message: ParsedEmailMessage) {
  const isForward = /^\s*fw(?:d)?:/iu.test(message.subject ?? "");
  const body = quotedText(message);
  // Some clients quote the entire forwarded block. Remove one level only on explicit forwards.
  const text = isForward ? body.replace(/^[ \t]*>[ \t]?/gmu, "") : body;
  const delimiter = forwardHeader.exec(text);
  const inlineFrom = isForward ? /^From:[ \t]/imu.exec(text) : null;
  // Outlook can start with From after the member's introduction and omit the delimiter.
  // Read that block even if the inner message later quotes another forward.
  const start = inlineFrom && (!delimiter || inlineFrom.index < delimiter.index)
    ? inlineFrom.index : delimiter && delimiter.index + delimiter[0].length;
  if (start === null) return undefined;
  const forwarded = text.slice(start);
  const headers = /^(?:[A-Za-z][A-Za-z-]*:[^\n]*(?:\n[ \t][^\n]*)*(?:\n|$))+/u.exec(forwarded.trimStart())?.[0];
  if (!headers) return undefined;
  const from = readRawEmailHeaderValue(headers, "from");
  const subject = readRawEmailHeaderValue(headers, "subject");
  if (!await isPortalHeader(from.value, subject.value)) return undefined;
  return from.value;
}

export async function projectPersonalPortalForward(input: {
  sender: string | null;
  from: string;
  to: string;
  message: ParsedEmailMessage;
}): Promise<Uint8Array> {
  const mailbox = senderMailbox(input.sender);
  let summary = forwardedPortalFallback;
  if (mailbox) {
    const place = matchClinicalPortalSender(await publicDirectory(), { displayName: mailbox.name ?? "", domain: mailbox.domain ?? mailbox.bareDomain });
    if (place) summary = portalDiscoverySummary(place);
  }
  // Keep reply/deduplication identity. Drop the original subject, content, attachments,
  // reply-to and copies. The only recipient of a reply is the authenticated outer sender.
  const messageId = input.message.messageId ?? `<${input.message.rawHash}@portal-forward.invalid>`;
  return new TextEncoder().encode([
    `From: ${input.from}`, `To: ${input.to}`, `Message-ID: ${messageId}`,
    "Subject: Forwarded patient portal notice", "Content-Type: text/plain; charset=utf-8",
    "", summary,
  ].join("\r\n"));
}
