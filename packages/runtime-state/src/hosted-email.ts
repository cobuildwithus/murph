export const HOSTED_EMAIL_THREAD_TARGET_SCHEMA = "murph.hosted-email-thread-target.v1";
export const HOSTED_EMAIL_THREAD_TARGET_PREFIX = "hostedmail:";

export interface HostedEmailThreadTarget {
  cc: string[];
  lastMessageId: string | null;
  references: string[];
  schema: typeof HOSTED_EMAIL_THREAD_TARGET_SCHEMA;
  subject: string | null;
  to: string[];
}

interface HostedEmailThreadTargetPayload {
  cc?: unknown;
  lastMessageId?: unknown;
  references?: unknown;
  schema?: unknown;
  subject?: unknown;
  to?: unknown;
}

export function createHostedEmailThreadTarget(input: {
  cc?: ReadonlyArray<string> | null;
  lastMessageId?: string | null;
  references?: ReadonlyArray<string> | null;
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
    );
    const record = readHostedEmailThreadTargetPayload(parsed);
    if (!record || record.schema !== HOSTED_EMAIL_THREAD_TARGET_SCHEMA) {
      return null;
    }

    return createHostedEmailThreadTarget({
      cc: readHostedEmailThreadTargetList(record.cc),
      lastMessageId: readHostedEmailThreadTargetString(record.lastMessageId),
      references: readHostedEmailThreadTargetList(record.references),
      subject: readHostedEmailThreadTargetString(record.subject),
      to: readHostedEmailThreadTargetList(record.to),
    });
  } catch {
    return null;
  }
}

function readHostedEmailThreadTargetPayload(value: unknown): HostedEmailThreadTargetPayload | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function readHostedEmailThreadTargetList(value: unknown): string[] | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (!Array.isArray(value)) {
    throw new TypeError("Hosted email thread target lists must be arrays.");
  }

  return value.filter((entry): entry is string => typeof entry === "string");
}

function readHostedEmailThreadTargetString(value: unknown): string | null | undefined {
  if (value === undefined || value === null || typeof value === "string") {
    return value;
  }

  return undefined;
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
  const candidate = normalizeHostedEmailOptionalText(angleMatch?.[1] ?? normalized);
  return candidate ? candidate.toLowerCase() : null;
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

export interface HostedEmailAuthenticatedSenderVerdict {
  dkimAligned: boolean;
  dmarcPass: boolean;
  spfAligned: boolean;
}

export function isHostedEmailAuthenticatedSenderVerdictAccepted(
  value: HostedEmailAuthenticatedSenderVerdict | null | undefined,
): boolean {
  return value?.dkimAligned === true
    || value?.dmarcPass === true
    || value?.spfAligned === true;
}

export function resolveHostedEmailInboundSenderAddress(input: {
  envelopeFrom?: string | null;
  hasRepeatedHeaderFrom?: boolean;
  headerFrom?: string | null;
}): string | null {
  if (input.hasRepeatedHeaderFrom) {
    return null;
  }

  const envelopeSender = normalizeHostedEmailAddress(input.envelopeFrom);
  if (!normalizeHostedEmailOptionalText(input.headerFrom)) {
    return envelopeSender;
  }

  const headerSender = resolveHostedEmailHeaderSenderAddress(input.headerFrom);
  return headerSender && (!envelopeSender || headerSender === envelopeSender)
    ? headerSender
    : null;
}

export function resolveHostedEmailDirectSenderLookupAddress(input: {
  authenticatedSender?: HostedEmailAuthenticatedSenderVerdict | null;
  envelopeFrom?: string | null;
  hasRepeatedHeaderFrom?: boolean;
  headerFrom?: string | null;
}): string | null {
  if (!isHostedEmailAuthenticatedSenderVerdictAccepted(input.authenticatedSender)) {
    return null;
  }

  if (input.hasRepeatedHeaderFrom) {
    return null;
  }

  const envelopeSender = normalizeHostedEmailAddress(input.envelopeFrom);
  const headerSender = resolveHostedEmailHeaderSenderAddress(input.headerFrom);

  return envelopeSender && headerSender && envelopeSender === headerSender
    ? headerSender
    : null;
}

export function resolveHostedEmailAuthorizedSenderAddresses(input: {
  verifiedEmailAddress?: string | null;
}): string[] {
  return normalizeHostedEmailAddressList([input.verifiedEmailAddress]);
}

export function isHostedEmailInboundSenderAuthorized(input: {
  authenticatedSender?: HostedEmailAuthenticatedSenderVerdict | null;
  envelopeFrom?: string | null;
  hasRepeatedHeaderFrom?: boolean;
  headerFrom?: string | null;
  verifiedEmailAddress?: string | null;
}): boolean {
  if (!isHostedEmailAuthenticatedSenderVerdictAccepted(input.authenticatedSender)) {
    return false;
  }

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

  const angleBracketCandidates = collectHostedEmailHeaderSenderCandidates(
    [...value.matchAll(/<([^>]+)>/gu)].map((match) => match[1] ?? ""),
  );
  if (angleBracketCandidates.size > 0) {
    return readSingleHostedEmailHeaderSenderCandidate(angleBracketCandidates);
  }

  return readSingleHostedEmailHeaderSenderCandidate(
    collectHostedEmailHeaderSenderCandidates(
      value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu) ?? [],
    ),
  );
}

export function normalizeHostedEmailMessageId(value: string | null | undefined): string | null {
  return normalizeHostedEmailOptionalText(value);
}

export function normalizeHostedEmailSubject(value: string | null | undefined): string | null {
  return normalizeHostedEmailOptionalText(value);
}

function normalizeHostedEmailOptionalText(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 && !/[\r\n]/u.test(normalized) ? normalized : null;
}

function collectHostedEmailHeaderSenderCandidates(
  values: Iterable<string>,
): Set<string> {
  const candidates = new Set<string>();

  for (const value of values) {
    const normalized = normalizeHostedEmailAddress(value);
    if (normalized) {
      candidates.add(normalized);
    }
  }

  return candidates;
}

function readSingleHostedEmailHeaderSenderCandidate(
  candidates: ReadonlySet<string>,
): string | null {
  if (candidates.size !== 1) {
    return null;
  }

  for (const candidate of candidates) {
    return candidate;
  }

  return null;
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
