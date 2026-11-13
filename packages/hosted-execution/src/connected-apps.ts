import * as z from "@murphai/contracts/zod-runtime";

export const HOSTED_CONNECTED_APPS_PATH = "/api/internal/connected-apps";

// Serialized budget for a connected-app result handed to the assistant. The web
// tier compacts provider output and enforces this before responding, so an
// oversized read turns into actionable guidance instead of a discarded payload.
export const HOSTED_CONNECTED_APPS_RESULT_MAX_BYTES = 120_000;

// Composio tool results commonly include raw HTML email bodies (Gmail
// FETCH_MESSAGE_BY_MESSAGE_ID) and similar markup-heavy payloads. The model
// processes plain text just as well and pays per token for every markup
// character, so strip HTML to text before serializing. Only strings that look
// HTML-shaped get stripped; descriptions, slugs and schemas pass through.
const HOSTED_CONNECTED_APPS_HTML_MIN_LENGTH = 200;
const HOSTED_CONNECTED_APPS_HTML_TAG_SENTINEL =
  /<(?:!doctype|html|body|head|table|div|p|span|br|a\s|img|h[1-6]|td|tr|style|script)\b/iu;
// Encoded MIME bodies and attachments live under these keys (Gmail
// `payload.parts[].body.data` and `raw`, Outlook `contentBytes`). Text decodes
// in place so the HTML strip still applies; binary means nothing to the model,
// so only its size survives. No other key is decoded: identifiers, page tokens
// and plain strings can look like base64 too.
const HOSTED_CONNECTED_APPS_ENCODED_KEYS = new Set(["contentBytes", "data", "raw"]);
const HOSTED_CONNECTED_APPS_ENCODED_MIN_LENGTH = 512;
const HOSTED_CONNECTED_APPS_ENCODED_PATTERN = /^[A-Za-z0-9+/_-]+={0,2}$/u;
const HOSTED_CONNECTED_APPS_CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u;
// A Gmail message already carries its decoded body as `messageText`, so the
// encoded copies under `payload` repeat it (twice for multipart/alternative).
const HOSTED_CONNECTED_APPS_DUPLICATE_BODY_TEXT = "[omitted: same text as messageText]";
// Full-format messages carry dozens of transport headers (Received,
// DKIM-Signature, ARC-*). A header list is recognized by those markers and
// keeps only what a person reads.
const HOSTED_CONNECTED_APPS_MAIL_TRANSPORT_HEADERS = new Set([
  "authentication-results", "dkim-signature", "mime-version", "received", "return-path",
]);
const HOSTED_CONNECTED_APPS_MAIL_READABLE_HEADERS = new Set([
  "bcc", "cc", "date", "from", "list-unsubscribe", "message-id", "reply-to", "sender", "subject", "to",
]);

export const hostedConnectedAppsToolkitSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9_-]*$/u);

export const hostedConnectedAppsAliasSchema = z
  .string()
  .trim()
  .min(1)
  .max(64);

export const hostedConnectedAppsAccountSelectorSchema = z
  .string()
  .trim()
  .min(1)
  .max(256);

export const hostedConnectedAppsToolSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/u);

const hostedConnectedAppsListInputSchema = z
  .object({
    action: z.literal("list"),
    toolkit: hostedConnectedAppsToolkitSchema.optional(),
  })
  .strict();

const hostedConnectedAppsConnectInputSchema = z
  .object({
    action: z.literal("connect"),
    alias: hostedConnectedAppsAliasSchema.optional(),
    toolkit: hostedConnectedAppsToolkitSchema,
  })
  .strict();

const hostedConnectedAppsRenameInputSchema = z
  .object({
    account: hostedConnectedAppsAccountSelectorSchema,
    action: z.literal("rename"),
    alias: hostedConnectedAppsAliasSchema,
  })
  .strict();

const hostedConnectedAppsDisconnectInputSchema = z
  .object({
    account: hostedConnectedAppsAccountSelectorSchema,
    action: z.literal("disconnect"),
  })
  .strict();

export const hostedConnectedAppsManageInputSchema = z.discriminatedUnion("action", [
  hostedConnectedAppsListInputSchema,
  hostedConnectedAppsConnectInputSchema,
  hostedConnectedAppsRenameInputSchema,
  hostedConnectedAppsDisconnectInputSchema,
]);

export const hostedConnectedAppsSearchInputSchema = z
  .object({
    query: z.string().trim().min(1).max(2_000),
    toolkits: z.array(hostedConnectedAppsToolkitSchema).min(1).max(16).optional(),
  })
  .strict();

export const hostedConnectedAppsExecuteInputSchema = z
  .object({
    account: hostedConnectedAppsAccountSelectorSchema.optional(),
    arguments: z.record(z.string(), z.unknown()).default({}),
    agentApproved: z.literal(true).optional(),
    toolSlug: hostedConnectedAppsToolSlugSchema,
  })
  .strict();

export const hostedConnectedAppsRequestSchema = z.discriminatedUnion("operation", [
  z
    .object({
      input: hostedConnectedAppsManageInputSchema,
      operation: z.literal("manage"),
    })
    .strict(),
  z
    .object({
      input: hostedConnectedAppsSearchInputSchema,
      operation: z.literal("search"),
    })
    .strict(),
  z
    .object({
      input: hostedConnectedAppsExecuteInputSchema,
      operation: z.literal("execute"),
    })
    .strict(),
]);

export const hostedConnectedAppsResponseSchema = z
  .object({
    result: z.unknown(),
  })
  .strict();

// Walks the provider result and removes what costs tokens without carrying
// meaning: HTML markup, encoded MIME bodies and attachments, and mail transport
// headers. Every other value passes through unchanged.
export function compactHostedConnectedAppsResult(value: unknown): unknown {
  return compactConnectedAppsValue(value, null, "none");
}

// "payload": inside a Gmail message that also has `messageText`.
// "text-body": the `body` of a text/plain or text/html part of that payload.
type ConnectedAppsBodyScope = "none" | "payload" | "text-body";

function compactConnectedAppsValue(
  value: unknown,
  key: string | null,
  scope: ConnectedAppsBodyScope,
): unknown {
  if (typeof value === "string") {
    return compactConnectedAppsString(value, key, scope);
  }
  if (Array.isArray(value)) {
    const items = isMailTransportHeaderList(value)
      ? value.filter((header) => HOSTED_CONNECTED_APPS_MAIL_READABLE_HEADERS.has(
        String((header as { name: string }).name).toLowerCase(),
      ))
      : value;
    return items.map((item) => compactConnectedAppsValue(item, key, scope));
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(record)) {
      out[k] = compactConnectedAppsValue(v, k, childBodyScope(record, k, scope));
    }
    return out;
  }
  return value;
}

function childBodyScope(
  record: Record<string, unknown>,
  key: string,
  scope: ConnectedAppsBodyScope,
): ConnectedAppsBodyScope {
  if (scope === "none") {
    return key === "payload" && typeof record.messageText === "string" && record.messageText.length > 0
      ? "payload"
      : "none";
  }
  if (scope === "payload" && key === "body") {
    const textPart = typeof record.mimeType === "string"
      && /^text\/(?:plain|html)$/iu.test(record.mimeType)
      && !record.filename;
    return textPart ? "text-body" : "payload";
  }
  return scope;
}

function compactConnectedAppsString(
  value: string,
  key: string | null,
  scope: ConnectedAppsBodyScope,
): string {
  const decoded = key !== null && HOSTED_CONNECTED_APPS_ENCODED_KEYS.has(key)
    ? decodeConnectedAppsEncodedBlob(value)
    : null;
  if (decoded?.kind === "text" && scope === "text-body" && key === "data") {
    return HOSTED_CONNECTED_APPS_DUPLICATE_BODY_TEXT;
  }
  const text = decoded?.text ?? value;
  if (text.length < HOSTED_CONNECTED_APPS_HTML_MIN_LENGTH) return text;
  if (!HOSTED_CONNECTED_APPS_HTML_TAG_SENTINEL.test(text)) return text;
  return stripHtmlForHostedConnectedAppsResult(text);
}

function decodeConnectedAppsEncodedBlob(
  value: string,
): { kind: "binary" | "text"; text: string } | null {
  if (
    value.length < HOSTED_CONNECTED_APPS_ENCODED_MIN_LENGTH
    || !HOSTED_CONNECTED_APPS_ENCODED_PATTERN.test(value)
  ) {
    return null;
  }
  let bytes: Uint8Array;
  try {
    const standard = value.replace(/-/gu, "+").replace(/_/gu, "/");
    const binary = atob(standard.padEnd(Math.ceil(standard.length / 4) * 4, "="));
    bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
  const omitted = { kind: "binary" as const, text: `[binary data omitted: ${bytes.byteLength} bytes]` };
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return HOSTED_CONNECTED_APPS_CONTROL_CHARACTER_PATTERN.test(text) ? omitted : { kind: "text", text };
  } catch {
    return omitted;
  }
}

function isMailTransportHeaderList(value: unknown[]): boolean {
  let transport = false;
  for (const item of value) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return false;
    const { name, value: headerValue } = item as Record<string, unknown>;
    if (typeof name !== "string" || typeof headerValue !== "string") return false;
    transport ||= HOSTED_CONNECTED_APPS_MAIL_TRANSPORT_HEADERS.has(name.toLowerCase());
  }
  return transport;
}

// Serializes a compacted result and fails closed when it exceeds the assistant
// budget. Truncating would hand the model a half-read mailbox it cannot detect,
// so callers turn `null` into an explicit narrow-the-request instruction.
export function serializeHostedConnectedAppsResult(value: unknown): string | null {
  let text: string;
  try {
    text = JSON.stringify(value) ?? "null";
  } catch {
    return null;
  }
  return new TextEncoder().encode(text).byteLength
      <= HOSTED_CONNECTED_APPS_RESULT_MAX_BYTES
    ? text
    : null;
}

function stripHtmlForHostedConnectedAppsResult(value: string): string {
  return value
    // Drop noise: style/script/head blocks carry no model-useful signal and
    // they account for most of the markup volume in Gmail HTML envelopes.
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/giu, " ")
    // Preserve the most semantically important attributes: a hyperlink's
    // href (tracking links, order URLs, calendar invites, unsubscribe) and
    // an image's alt text. The opening-tag pattern uses a quote-aware
    // tokenizer (`[^>"']` OR a complete `"..."` / `'...'` string) so that
    // attribute values containing literal `>` (`<a title="Reply >>"...>`,
    // common in marketing email and table-of-contents emails) do not abort
    // the match and silently drop the href. href and alt are then extracted
    // from the captured opening tag with a separate regex so both single-
    // and double-quoted forms work without nested capture-group plumbing.
    .replace(
      /<a\b(?:[^>"']|"[^"]*"|'[^']*')*?>([\s\S]*?)<\/a>/giu,
      (match, inner: string) => {
        const hrefMatch = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/iu.exec(match);
        const href = hrefMatch ? (hrefMatch[1] ?? hrefMatch[2] ?? null) : null;
        const label = inner.replace(/<[^>]+>/gu, "").replace(/\s+/gu, " ").trim();
        if (!href) return label;
        if (!label) return href;
        return label === href ? href : `${label} (${href})`;
      },
    )
    .replace(
      /<img\b(?:[^>"']|"[^"]*"|'[^']*')*?>/giu,
      (match) => {
        const altMatch = /\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/iu.exec(match);
        const alt = altMatch ? (altMatch[1] ?? altMatch[2] ?? null) : null;
        return alt ? `[image: ${alt}]` : " ";
      },
    )
    // Block-level breaks become real newlines so flowing prose survives.
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<\/(?:p|div|li|tr|h[1-6])>/giu, "\n")
    // Every remaining tag goes; we've already pulled out the bits that
    // carried information beyond their text content.
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, "'")
    // Angle brackets stay escaped. Decoding them would let an email whose
    // visible text quotes markup ("&lt;p&gt;Do not cancel&lt;/p&gt;") come out
    // of this function looking like structure, and a later pass over that
    // output would then strip the member's own words as if they were tags.
    // Leaving the entities intact costs the model nothing and keeps compaction
    // safe to apply more than once.
    .replace(/&#(\d+);/gu, (_match, code: string) => {
      const num = Number(code);
      if (num === 0x3c) return "&lt;";
      if (num === 0x3e) return "&gt;";
      return Number.isInteger(num) && num >= 32 && num <= 0x10ffff
        ? String.fromCodePoint(num)
        : " ";
    })
    .replace(/\s+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .replace(/[ \t]{2,}/gu, " ")
    .trim();
}

export type HostedConnectedAppsManageInput = z.infer<
  typeof hostedConnectedAppsManageInputSchema
>;
export type HostedConnectedAppsSearchInput = z.infer<
  typeof hostedConnectedAppsSearchInputSchema
>;
export type HostedConnectedAppsExecuteInput = z.infer<
  typeof hostedConnectedAppsExecuteInputSchema
>;
export type HostedConnectedAppsRequest = z.infer<typeof hostedConnectedAppsRequestSchema>;
export type HostedConnectedAppsResponse = z.infer<typeof hostedConnectedAppsResponseSchema>;
