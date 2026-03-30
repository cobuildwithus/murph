export const HOSTED_EMAIL_THREAD_TARGET_SCHEMA = "murph.hosted-email-thread-target.v1";
export const HOSTED_EMAIL_THREAD_TARGET_PREFIX = "hostedmail:";

export interface HostedEmailThreadTarget {
  cc: string[];
  lastMessageId: string | null;
  references: string[];
  replyAliasAddress: string | null;
  replyKey: string | null;
  schema: typeof HOSTED_EMAIL_THREAD_TARGET_SCHEMA;
  subject: string | null;
  to: string[];
}

export function createHostedEmailThreadTarget(input: {
  cc?: ReadonlyArray<string> | null;
  lastMessageId?: string | null;
  references?: ReadonlyArray<string> | null;
  replyAliasAddress?: string | null;
  replyKey?: string | null;
  subject?: string | null;
  to?: ReadonlyArray<string> | null;
}): HostedEmailThreadTarget {
  const lastMessageId = normalizeHostedEmailMessageId(input.lastMessageId);
  const references = appendHostedEmailReferenceChain({
    lastMessageId,
    references: input.references ?? [],
  });

  return {
    cc: normalizeHostedEmailAddressList(input.cc ?? []),
    lastMessageId,
    references,
    replyAliasAddress: normalizeHostedEmailAddress(input.replyAliasAddress),
    replyKey: normalizeHostedEmailRouteKey(input.replyKey),
    schema: HOSTED_EMAIL_THREAD_TARGET_SCHEMA,
    subject: normalizeHostedEmailSubject(input.subject),
    to: normalizeHostedEmailAddressList(input.to ?? []),
  };
}

export function serializeHostedEmailThreadTarget(
  input: HostedEmailThreadTarget | Parameters<typeof createHostedEmailThreadTarget>[0],
): string {
  return `${HOSTED_EMAIL_THREAD_TARGET_PREFIX}${encodeHostedEmailTargetPayload(
    JSON.stringify(createHostedEmailThreadTarget(input)),
  )}`;
}

export function parseHostedEmailThreadTarget(
  value: string | null | undefined,
): HostedEmailThreadTarget | null {
  const normalized = value?.trim() ?? "";
  if (!normalized || !normalized.startsWith(HOSTED_EMAIL_THREAD_TARGET_PREFIX)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      decodeHostedEmailTargetPayload(
        normalized.slice(HOSTED_EMAIL_THREAD_TARGET_PREFIX.length),
      ),
    ) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const record = parsed as Partial<HostedEmailThreadTarget>;
    if (record.schema !== HOSTED_EMAIL_THREAD_TARGET_SCHEMA) {
      return null;
    }

    return createHostedEmailThreadTarget(record);
  } catch {
    return null;
  }
}

export function appendHostedEmailReferenceChain(input: {
  lastMessageId?: string | null;
  references?: ReadonlyArray<string> | null;
}): string[] {
  const references = new Set<string>();

  for (const value of input.references ?? []) {
    const normalized = normalizeHostedEmailMessageId(value);
    if (normalized) {
      references.add(normalized);
    }
  }

  const lastMessageId = normalizeHostedEmailMessageId(input.lastMessageId);
  if (lastMessageId) {
    references.add(lastMessageId);
  }

  return [...references].slice(-20);
}

export function ensureHostedEmailReplySubject(
  subject: string | null | undefined,
  fallback = "Murph update",
): string {
  const normalized = normalizeHostedEmailSubject(subject) ?? normalizeHostedEmailSubject(fallback);
  if (!normalized) {
    return "Murph update";
  }

  return /^re\s*:/iu.test(normalized) ? normalized : `Re: ${normalized}`;
}

export function normalizeHostedEmailAddress(value: string | null | undefined): string | null {
  const normalized = normalizeHostedEmailOptionalText(value);
  if (!normalized) {
    return null;
  }

  const angleMatch = normalized.match(/<([^>]+)>/u);
  const candidate = (angleMatch?.[1] ?? normalized).trim().toLowerCase();
  return candidate.length > 0 ? candidate : null;
}

export function normalizeHostedEmailAddressList(
  input: ReadonlyArray<string | null | undefined>,
): string[] {
  const seen = new Set<string>();
  const values: string[] = [];

  for (const value of input) {
    const normalized = normalizeHostedEmailAddress(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    values.push(normalized);
  }

  return values;
}

export function resolveHostedEmailInboundSenderAddress(input: {
  envelopeFrom?: string | null;
  hasRepeatedHeaderFrom?: boolean;
  headerFrom?: string | null;
}): string | null {
  if (input.hasRepeatedHeaderFrom) {
    return null;
  }

  const headerSender = resolveHostedEmailHeaderSenderAddress(input.headerFrom);
  const envelopeSender = normalizeHostedEmailAddress(input.envelopeFrom);
  const hasHeaderSender = typeof input.headerFrom === "string" && input.headerFrom.trim().length > 0;

  if (hasHeaderSender) {
    if (!headerSender) {
      return null;
    }

    if (envelopeSender && headerSender !== envelopeSender) {
      return null;
    }

    return headerSender;
  }

  return envelopeSender;
}

export function resolveHostedEmailAuthorizedSenderAddresses(input: {
  threadTarget?: HostedEmailThreadTarget | null;
  verifiedEmailAddress?: string | null;
}): string[] {
  return normalizeHostedEmailAddressList([
    input.verifiedEmailAddress,
    ...(input.threadTarget?.to ?? []),
    ...(input.threadTarget?.cc ?? []),
  ]);
}

export function isHostedEmailInboundSenderAuthorized(input: {
  envelopeFrom?: string | null;
  hasRepeatedHeaderFrom?: boolean;
  headerFrom?: string | null;
  threadTarget?: HostedEmailThreadTarget | null;
  verifiedEmailAddress?: string | null;
}): boolean {
  const sender = resolveHostedEmailInboundSenderAddress(input);

  if (!sender) {
    return false;
  }

  return resolveHostedEmailAuthorizedSenderAddresses(input).includes(sender);
}

function resolveHostedEmailHeaderSenderAddress(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const candidates = new Set<string>();
  const angleMatches = [...value.matchAll(/<([^>]+)>/gu)];

  for (const match of angleMatches) {
    const normalized = normalizeHostedEmailAddress(match[1]);
    if (normalized) {
      candidates.add(normalized);
    }
  }

  if (candidates.size === 0) {
    const bareMatches = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu) ?? [];
    for (const match of bareMatches) {
      const normalized = normalizeHostedEmailAddress(match);
      if (normalized) {
        candidates.add(normalized);
      }
    }
  }

  return candidates.size === 1
    ? [...candidates][0] ?? null
    : null;
}

export function normalizeHostedEmailMessageId(value: string | null | undefined): string | null {
  return normalizeHostedEmailOptionalText(value);
}

export function normalizeHostedEmailRouteKey(value: string | null | undefined): string | null {
  return normalizeHostedEmailOptionalText(value);
}

export function normalizeHostedEmailSubject(value: string | null | undefined): string | null {
  return normalizeHostedEmailOptionalText(value);
}

function normalizeHostedEmailOptionalText(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function encodeHostedEmailTargetPayload(value: string): string {
  const utf8 = new TextEncoder().encode(value);

  if (typeof Buffer !== "undefined") {
    return Buffer.from(utf8).toString("base64url");
  }

  return toBase64Url(bytesToBinaryString(utf8));
}

function decodeHostedEmailTargetPayload(value: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(value, "base64url").toString("utf8");
  }

  const binary = fromBase64Url(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new TextDecoder().decode(bytes);
}

function bytesToBinaryString(bytes: Uint8Array): string {
  let output = "";
  for (const byte of bytes) {
    output += String.fromCharCode(byte);
  }
  return output;
}

function toBase64Url(binary: string): string {
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

function fromBase64Url(value: string): string {
  const padded = value.replace(/-/gu, "+").replace(/_/gu, "/");
  const remainder = padded.length % 4;
  const suffix = remainder === 0 ? "" : "=".repeat(4 - remainder);
  return atob(`${padded}${suffix}`);
}
