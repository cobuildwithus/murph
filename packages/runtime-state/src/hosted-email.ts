export const HOSTED_EMAIL_THREAD_TARGET_SCHEMA = "murph.hosted-email-thread-target.v1";
export const HOSTED_EMAIL_THREAD_TARGET_PREFIX = "hostedmail:";
export const HOSTED_EMAIL_THREAD_TARGET_MAX_LENGTH = 8_192;
export const HOSTED_EMAIL_THREAD_TARGET_MESSAGE_ID_MAX_LENGTH = 256;
export const HOSTED_EMAIL_THREAD_TARGET_REFERENCE_MAX_COUNT = 12;
export const HOSTED_EMAIL_THREAD_TARGET_RECIPIENT_MAX_COUNT = 8;
export const HOSTED_EMAIL_THREAD_TARGET_GROUP_ID_MAX_LENGTH = 128;
export const HOSTED_EMAIL_THREAD_TARGET_RECIPIENT_MEMBER_ID_MAX_LENGTH = 128;
export const HOSTED_EMAIL_THREAD_TARGET_SUBJECT_MAX_LENGTH = 256;
export const HOSTED_EMAIL_ADDRESS_MAX_LENGTH = 254;
export const hostedEmailThreadTargetKindValues = ["explicit", "group"] as const;

export type HostedEmailThreadTargetKind =
  (typeof hostedEmailThreadTargetKindValues)[number];

export interface HostedEmailThreadTarget {
  cc: string[];
  groupId: string | null;
  lastMessageId: string | null;
  recipientMemberId: string | null;
  references: string[];
  schema: typeof HOSTED_EMAIL_THREAD_TARGET_SCHEMA;
  subject: string | null;
  targetKind: HostedEmailThreadTargetKind;
  to: string[];
}

interface HostedEmailThreadTargetPayload {
  cc?: unknown;
  groupId?: unknown;
  lastMessageId?: unknown;
  recipientMemberId?: unknown;
  references?: unknown;
  schema?: unknown;
  subject?: unknown;
  targetKind?: unknown;
  to?: unknown;
}

export function createHostedEmailThreadTarget(input: {
  cc?: ReadonlyArray<string> | null;
  groupId?: string | null;
  lastMessageId?: string | null;
  recipientMemberId?: string | null;
  references?: ReadonlyArray<string> | null;
  subject?: string | null;
  targetKind?: string | null;
  to?: ReadonlyArray<string> | null;
}): HostedEmailThreadTarget {
  const lastMessageId = normalizeHostedEmailMessageId(input.lastMessageId);
  const references = appendHostedEmailReferenceChain({
    lastMessageId,
    references: input.references ?? [],
  });
  const groupId = normalizeHostedEmailThreadTargetGroupId(input.groupId);
  const targetKind = normalizeHostedEmailThreadTargetKind({
    groupId,
    targetKind: input.targetKind,
  });

  return {
    cc: targetKind === "group"
      ? []
      : normalizeHostedEmailAddressList(input.cc ?? []).slice(
          0,
          HOSTED_EMAIL_THREAD_TARGET_RECIPIENT_MAX_COUNT,
        ),
    groupId: targetKind === "group" ? groupId : null,
    lastMessageId,
    recipientMemberId: targetKind === "group"
      ? normalizeHostedEmailThreadTargetRecipientMemberId(input.recipientMemberId)
      : null,
    references,
    schema: HOSTED_EMAIL_THREAD_TARGET_SCHEMA,
    subject: normalizeHostedEmailSubject(input.subject),
    targetKind,
    to: targetKind === "group"
      ? []
      : normalizeHostedEmailAddressList(input.to ?? []).slice(
          0,
          HOSTED_EMAIL_THREAD_TARGET_RECIPIENT_MAX_COUNT,
        ),
  };
}

export function serializeHostedEmailThreadTarget(
  input: HostedEmailThreadTarget | Parameters<typeof createHostedEmailThreadTarget>[0],
): string {
  return serializeHostedEmailThreadTargetRecord(
    compactHostedEmailThreadTarget(createHostedEmailThreadTarget(input)),
  );
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
      groupId: readHostedEmailThreadTargetString(record.groupId),
      lastMessageId: readHostedEmailThreadTargetString(record.lastMessageId),
      recipientMemberId: readHostedEmailThreadTargetString(record.recipientMemberId),
      references: readHostedEmailThreadTargetList(record.references),
      subject: readHostedEmailThreadTargetString(record.subject),
      targetKind: readHostedEmailThreadTargetString(record.targetKind),
      to: readHostedEmailThreadTargetList(record.to),
    });
  } catch {
    return null;
  }
}

function compactHostedEmailThreadTarget(
  target: HostedEmailThreadTarget,
): HostedEmailThreadTarget {
  if (
    serializeHostedEmailThreadTargetRecord(target).length <=
      HOSTED_EMAIL_THREAD_TARGET_MAX_LENGTH
  ) {
    return target;
  }

  const withoutBulkCc: HostedEmailThreadTarget = {
    ...target,
    cc: [],
    references: target.references.slice(-4),
    subject: null,
  };
  if (
    serializeHostedEmailThreadTargetRecord(withoutBulkCc).length <=
      HOSTED_EMAIL_THREAD_TARGET_MAX_LENGTH
  ) {
    return withoutBulkCc;
  }

  const primaryOnly: HostedEmailThreadTarget = {
    ...withoutBulkCc,
    references: target.lastMessageId ? [target.lastMessageId] : [],
    to: target.to.slice(0, 1),
  };
  if (
    serializeHostedEmailThreadTargetRecord(primaryOnly).length <=
      HOSTED_EMAIL_THREAD_TARGET_MAX_LENGTH
  ) {
    return primaryOnly;
  }

  return {
    ...primaryOnly,
    lastMessageId: null,
    references: [],
  };
}

function serializeHostedEmailThreadTargetRecord(
  target: HostedEmailThreadTarget,
): string {
  return `${HOSTED_EMAIL_THREAD_TARGET_PREFIX}${encodeHostedEmailTargetPayload(
    JSON.stringify(target),
  )}`;
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

function normalizeHostedEmailThreadTargetGroupId(
  value: string | null | undefined,
): string | null {
  return normalizeHostedEmailOptionalText(value, {
    maxLength: HOSTED_EMAIL_THREAD_TARGET_GROUP_ID_MAX_LENGTH,
    overLimit: "drop",
  });
}

function normalizeHostedEmailThreadTargetRecipientMemberId(
  value: string | null | undefined,
): string | null {
  return normalizeHostedEmailOptionalText(value, {
    maxLength: HOSTED_EMAIL_THREAD_TARGET_RECIPIENT_MEMBER_ID_MAX_LENGTH,
    overLimit: "drop",
  });
}

function normalizeHostedEmailThreadTargetKind(input: {
  groupId: string | null;
  targetKind?: string | null;
}): HostedEmailThreadTargetKind {
  return input.targetKind === "group" && input.groupId ? "group" : "explicit";
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

  const normalizedReferences = [...references];
  if (normalizedReferences.length <= HOSTED_EMAIL_THREAD_TARGET_REFERENCE_MAX_COUNT) {
    return normalizedReferences;
  }

  return [
    normalizedReferences[0]!,
    ...normalizedReferences.slice(-(HOSTED_EMAIL_THREAD_TARGET_REFERENCE_MAX_COUNT - 1)),
  ];
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
  if (!candidate || candidate.length > HOSTED_EMAIL_ADDRESS_MAX_LENGTH) {
    return null;
  }

  return candidate.toLowerCase();
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

export function resolveHostedEmailBootstrapCandidateAddress(input: {
  envelopeFrom?: string | null;
  hasRepeatedHeaderFrom?: boolean;
  headerFrom?: string | null;
}): string | null {
  if (input.hasRepeatedHeaderFrom) {
    return null;
  }

  const envelopeSender = normalizeHostedEmailAddress(input.envelopeFrom);
  const headerSender = resolveHostedEmailHeaderSenderAddress(input.headerFrom);
  return envelopeSender && headerSender && envelopeSender === headerSender
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

const HOSTED_GROUP_EMAIL_PROMPT_EMAIL_ADDRESS_PATTERN =
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu;
const HOSTED_GROUP_EMAIL_PROMPT_QUOTED_HEADER_LINE_PATTERN =
  /^\s*(?:>+\s*)?(?:from|to|cc|reply-to)\s*:/iu;

export function redactHostedGroupEmailPromptText(
  value: string | null | undefined,
): string | null {
  const redacted = (value ?? "")
    .split(/\r\n|\r|\n/u)
    .filter((line) => !HOSTED_GROUP_EMAIL_PROMPT_QUOTED_HEADER_LINE_PATTERN.test(line))
    .join("\n")
    .replace(HOSTED_GROUP_EMAIL_PROMPT_EMAIL_ADDRESS_PATTERN, "[redacted email]")
    .trim();

  return redacted.length > 0 ? redacted : null;
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
  return normalizeHostedEmailOptionalText(value, {
    maxLength: HOSTED_EMAIL_THREAD_TARGET_MESSAGE_ID_MAX_LENGTH,
    overLimit: "drop",
  });
}

export function normalizeHostedEmailSubject(value: string | null | undefined): string | null {
  return normalizeHostedEmailOptionalText(value, {
    maxLength: HOSTED_EMAIL_THREAD_TARGET_SUBJECT_MAX_LENGTH,
    overLimit: "truncate",
  });
}

function normalizeHostedEmailOptionalText(
  value: string | null | undefined,
  options: {
    maxLength?: number;
    overLimit?: "drop" | "truncate";
  } = {},
): string | null {
  const normalized = value?.trim() ?? "";
  if (normalized.length === 0 || /[\r\n]/u.test(normalized)) {
    return null;
  }
  if (
    typeof options.maxLength === "number" &&
    normalized.length > options.maxLength
  ) {
    return options.overLimit === "truncate"
      ? normalized.slice(0, options.maxLength)
      : null;
  }

  return normalized;
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
