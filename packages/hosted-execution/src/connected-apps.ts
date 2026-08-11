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
// HTML-shaped get touched; everything else (descriptions, slugs, schemas)
// passes through unchanged.
const HOSTED_CONNECTED_APPS_HTML_MIN_LENGTH = 200;
const HOSTED_CONNECTED_APPS_HTML_TAG_SENTINEL =
  /<(?:!doctype|html|body|head|table|div|p|span|br|a\s|img|h[1-6]|td|tr|style|script)\b/iu;

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

// Walks the provider result and replaces any HTML-shaped string with its
// stripped plain-text equivalent. Non-string values, short strings, and
// strings without HTML tag markers pass through untouched, so this only
// affects payloads that would otherwise burn tokens on markup (chiefly Gmail
// message bodies).
export function compactHostedConnectedAppsResult(value: unknown): unknown {
  if (typeof value === "string") {
    if (value.length < HOSTED_CONNECTED_APPS_HTML_MIN_LENGTH) return value;
    if (!HOSTED_CONNECTED_APPS_HTML_TAG_SENTINEL.test(value)) return value;
    return stripHtmlForHostedConnectedAppsResult(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => compactHostedConnectedAppsResult(item));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = compactHostedConnectedAppsResult(v);
    }
    return out;
  }
  return value;
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
