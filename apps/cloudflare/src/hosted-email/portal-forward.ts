import { matchClinicalPortalSender, parsePublicClinicalProviderDirectory, type ClinicalProviderDirectory } from "@murphai/clinical-records/provider-directory";
import { forwardedPortalFallback, portalDiscoverySummary } from "@murphai/clinical-records/portal-discovery-link";
import { parseRawEmailMessage, readRawEmailHeaderValue, type ParsedEmailMessage } from "@murphai/inboxd/connectors/email/parsed";

const portalNotice = /\b(?:my\s?chart|patient\s+portal|followmyhealth|iqhealth|healow|athenahealth|eclinicalmail)\b/iu;
const forwardHeader = /^(?:-+\s*(?:forwarded message|original message)\s*-+|begin forwarded message:)\s*$/imu;
let directory: ClinicalProviderDirectory | undefined;

function quotedText(message: ParsedEmailMessage) {
  return (message.text || message.html?.replace(/<(?:br\b[^>]*|\/div|\/p)>/giu, "\n")
    .replace(/<[^<>]*>/gu, "").replace(/&lt;/giu, "<").replace(/&gt;/giu, ">").replace(/&nbsp;/giu, " ") || "")
    .replace(/^[ \t]*>[ >]*/gmu, "").replace(/\r\n/gu, "\n");
}

// undefined means ordinary mail. A recognized forward with unusable evidence gets generic Find.
export function forwardedPortalSender(message: ParsedEmailMessage): string | null | undefined {
  const attached = message.attachments.filter(part => part.contentType === "message/rfc822" || part.fileName?.toLowerCase().endsWith(".eml"));
  if (attached.length) {
    const notices = attached.flatMap(part => {
      if (!part.data) return [];
      const inner = parseRawEmailMessage(part.data);
      if (!portalNotice.test([inner.from, inner.subject, quotedText(inner)].join("\n"))) return [];
      const header = readRawEmailHeaderValue(part.data, "from");
      return [header.repeated ? null : header.value];
    });
    if (notices.length) return attached.length === 1 ? notices[0] : null;
  }
  const text = quotedText(message);
  const delimiter = forwardHeader.exec(text);
  if (!delimiter && !/^\s*fw(?:d)?:/iu.test(message.subject ?? "")) return undefined;
  if (!portalNotice.test(message.subject ?? "") && !portalNotice.test(text)) return undefined;
  const forwarded = delimiter ? text.slice(delimiter.index + delimiter[0].length) : text;
  // Multiple nested senders are ambiguous. Never extract addresses or URLs from prose.
  const senders = Array.from(forwarded.matchAll(/^From:[ \t]*([^\n]{1,512})$/gimu));
  return senders.length === 1 ? senders[0][1].trim() : null;
}

export async function projectPersonalPortalForward(input: {
  sender: string | null;
  from: string;
  to: string;
  message: ParsedEmailMessage;
}): Promise<Uint8Array> {
  const mailbox = /^(?:(?<name>[^<>\r\n]{0,320})\s*<[^\s<>@,]+@(?<domain>[^<>\s@,]+)>|[^\s<>@,]+@(?<bareDomain>[^<>\s@,]+))$/u.exec(input.sender ?? "")?.groups;
  let summary = forwardedPortalFallback;
  if (mailbox) {
    directory ??= parsePublicClinicalProviderDirectory((await import("@murphai/clinical-records/provider-directory.v2.json", { with: { type: "json" } })).default);
    const place = matchClinicalPortalSender(directory, { displayName: mailbox.name ?? "", domain: mailbox.domain ?? mailbox.bareDomain });
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
