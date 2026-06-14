import { createHmac, randomUUID } from "node:crypto";

export const ASSISTANT_USAGE_SCHEMA = "murph.assistant-usage.v1";
const HOSTED_MEMBER_AI_CREDENTIAL_ENV_KEYS = new Set<string>(["OPENAI_API_KEY"]);
const ASSISTANT_USAGE_REPORTING_USER_ID_HMAC_CONTEXT =
  "murph.assistant-usage.reporting-user.v1";
const ASSISTANT_USAGE_RAW_TOKEN_KEYS = new Set<string>([
  "cacheWriteTokens",
  "cache_write_tokens",
  "cachedInputTokens",
  "cached_input_tokens",
  "completionTokens",
  "completion_tokens",
  "inputTokens",
  "input_tokens",
  "outputTokens",
  "output_tokens",
  "promptTokens",
  "prompt_tokens",
  "reasoningTokens",
  "reasoning_tokens",
  "reasoningOutputTokens",
  "totalTokens",
  "total_tokens",
]);
const ASSISTANT_USAGE_RAW_DETAIL_TOKEN_KEYS = new Map<string, ReadonlySet<string>>([
  ["input_tokens_details", new Set(["cached_tokens", "image_tokens", "text_tokens"])],
  ["output_tokens_details", new Set(["image_tokens", "reasoning_tokens", "text_tokens"])],
  ["prompt_tokens_details", new Set(["cached_tokens"])],
]);
// Audio transcription usage is metered by audio duration rather than tokens.
// These keys carry the cost basis for duration-priced rows and stay under the
// same non-negative-integer rule as the token keys.
const ASSISTANT_USAGE_RAW_AUDIO_KEYS = new Set<string>([
  "audioBytes",
  "durationMs",
]);
export const ASSISTANT_TURN_PROFILE_SCHEMA = "murph.assistant-turn-profile.v1";
export const ASSISTANT_TURN_PROFILE_MAX_REQUESTS = 32;
export const ASSISTANT_TURN_PROFILE_MAX_TOOLS = 16;
export const ASSISTANT_TURN_PROFILE_MAX_TOOL_LABEL_LENGTH = 64;
const ASSISTANT_TURN_PROFILE_TOOL_LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/ -]*$/u;

export type AssistantUsageCredentialSource = "member" | "platform" | "unknown";
export type AssistantProviderRequestOutcome =
  | "aborted"
  | "failed"
  | "partial"
  | "succeeded";
export type AssistantUsageStripeMeterSource = "murph";

export interface AssistantUsageRecord {
  apiKeyEnv: string | null;
  attemptCount: number;
  baseUrl: string | null;
  cacheWriteTokens: number | null;
  cachedInputTokens: number | null;
  credentialSource: AssistantUsageCredentialSource;
  featureKey: string | null;
  gatewayTags: string[];
  inputTokens: number | null;
  memberId: string | null;
  occurredAt: string;
  outputTokens: number | null;
  provider: string;
  providerName: string | null;
  providerRequestId: string | null;
  providerRequestOutcome?: AssistantProviderRequestOutcome;
  providerRequestOrdinal?: number;
  rawUsageJson: Record<string, unknown> | null;
  rawUsageJsonHash: string | null;
  reasoningTokens: number | null;
  reportingUserId: string | null;
  requestedModel: string | null;
  routeId: string | null;
  schema: typeof ASSISTANT_USAGE_SCHEMA;
  servedModel: string | null;
  sessionId: string;
  stripeMeterSource: AssistantUsageStripeMeterSource;
  surface: string | null;
  totalTokens: number | null;
  triggerKind: string | null;
  turnId: string;
  turnProfileJson: Record<string, unknown> | null;
  usageId: string;
  usageExtractionSourcePath: string | null;
  usageExtractionVersion: string;
}

export function createAssistantUsageId(input: {
  attemptCount: number;
  providerRequestOrdinal?: number;
  turnId: string;
}): string {
  const attemptCount = normalizeRequiredInteger(input.attemptCount, "attemptCount");
  const providerRequestOrdinal = normalizeOptionalInteger(
    input.providerRequestOrdinal,
    "providerRequestOrdinal",
  ) ?? 0;
  const turnId = normalizeRequiredString(input.turnId, "turnId");

  return providerRequestOrdinal === 0
    ? `${turnId}.attempt-${attemptCount}`
    : `${turnId}.request-${providerRequestOrdinal}.attempt-${attemptCount}`;
}

// Usage record for provider work that happens outside any member turn (today:
// idle-time thread compaction). Uses a synthetic turn id so the existing
// turn-keyed dedupe and storage path apply unchanged.
export function buildAssistantMaintenanceUsageRecord(input: {
  // The Murph assistant session/conversation id — never a provider thread id.
  assistantSessionId: string;
  // Provider-side correlation handle, stored as providerRequestId.
  codexThreadId: string | null;
  credentialSource: AssistantUsageCredentialSource;
  featureKey: string;
  memberId: string;
  model: string;
  triggerKind: string;
  usage: {
    cachedInputTokens: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  };
}): AssistantUsageRecord {
  const turnId = `turn_maintenance_${randomUUID().replaceAll("-", "")}`;

  return parseAssistantUsageRecord({
    attemptCount: 1,
    cachedInputTokens: input.usage.cachedInputTokens,
    credentialSource: input.credentialSource,
    featureKey: input.featureKey,
    inputTokens: input.usage.inputTokens,
    memberId: input.memberId,
    occurredAt: new Date().toISOString(),
    outputTokens: input.usage.outputTokens,
    provider: "codex-cli",
    providerRequestId: input.codexThreadId,
    requestedModel: input.model,
    schema: ASSISTANT_USAGE_SCHEMA,
    sessionId: input.assistantSessionId,
    surface: "hosted-runtime",
    totalTokens: input.usage.totalTokens,
    triggerKind: input.triggerKind,
    turnId,
    usageId: createAssistantUsageId({
      attemptCount: 1,
      turnId,
    }),
  });
}

// Usage record for Worker-mediated Workers AI audio transcription. It runs
// outside any member turn (hosted attachment parse jobs), so it uses a
// synthetic turn id like the maintenance record above. Cost basis is audio
// duration in rawUsageJson rather than tokens.
export function buildHostedTranscriptionUsageRecord(input: {
  audioBytes: number;
  durationMs: number | null;
  memberId: string;
  model: string;
}): AssistantUsageRecord {
  const turnId = `turn_transcribe_${randomUUID().replaceAll("-", "")}`;

  return parseAssistantUsageRecord({
    attemptCount: 1,
    credentialSource: "platform",
    featureKey: "audio-transcription",
    memberId: input.memberId,
    occurredAt: new Date().toISOString(),
    provider: "workers-ai",
    providerName: "Workers AI",
    rawUsageJson: {
      audioBytes: input.audioBytes,
      ...(input.durationMs === null ? {} : { durationMs: input.durationMs }),
    },
    requestedModel: input.model,
    schema: ASSISTANT_USAGE_SCHEMA,
    sessionId: turnId,
    surface: "hosted-runner",
    triggerKind: "attachment-parse",
    turnId,
    usageId: createAssistantUsageId({
      attemptCount: 1,
      turnId,
    }),
    usageExtractionSourcePath: "workers-ai.transcribe",
    usageExtractionVersion: "workers-ai-transcribe-v1",
  });
}

export function createAssistantUsageReportingUserId(input: {
  memberId: string;
  reportingSecret?: string | null;
}): string | null {
  const memberId = input.memberId.trim();
  const reportingSecret = input.reportingSecret?.trim() ?? "";

  if (!memberId || !reportingSecret) {
    return null;
  }

  const digest = createHmac("sha256", reportingSecret)
    .update(ASSISTANT_USAGE_REPORTING_USER_ID_HMAC_CONTEXT)
    .update("\0")
    .update(memberId)
    .digest("base64url")
    .slice(0, 32);

  return `musr_${digest}`;
}

export function parseAssistantUsageRecord(value: unknown): AssistantUsageRecord {
  const record = requireRecord(value, "assistant usage record");
  const attemptCount = normalizeRequiredInteger(record.attemptCount, "attemptCount");
  const inputTokens = normalizeOptionalInteger(record.inputTokens, "inputTokens");
  const occurredAt = normalizeRequiredString(record.occurredAt, "occurredAt");
  const outputTokens = normalizeOptionalInteger(record.outputTokens, "outputTokens");
  const providerRequestOrdinal =
    normalizeOptionalInteger(record.providerRequestOrdinal, "providerRequestOrdinal") ?? 0;
  const turnId = normalizeRequiredString(record.turnId, "turnId");
  const usageId = normalizeCanonicalAssistantUsageId({
    attemptCount,
    providerRequestOrdinal,
    turnId,
    usageId: normalizeRequiredString(record.usageId, "usageId"),
  });

  return {
    apiKeyEnv: normalizeOptionalString(record.apiKeyEnv, "apiKeyEnv"),
    attemptCount,
    baseUrl: normalizeOptionalString(record.baseUrl, "baseUrl"),
    cacheWriteTokens: normalizeOptionalInteger(record.cacheWriteTokens, "cacheWriteTokens"),
    cachedInputTokens: normalizeOptionalInteger(record.cachedInputTokens, "cachedInputTokens"),
    credentialSource: normalizeCredentialSource(record.credentialSource),
    featureKey: normalizeOptionalString(record.featureKey, "featureKey"),
    gatewayTags: normalizeOptionalStringArray(record.gatewayTags, "gatewayTags"),
    inputTokens,
    memberId: normalizeOptionalString(record.memberId, "memberId"),
    occurredAt,
    outputTokens,
    provider: normalizeRequiredString(record.provider, "provider"),
    providerName: normalizeOptionalString(record.providerName, "providerName"),
    providerRequestId: normalizeOptionalString(record.providerRequestId, "providerRequestId"),
    ...(record.providerRequestOutcome === undefined
      ? {}
      : {
          providerRequestOutcome: normalizeProviderRequestOutcome(
            record.providerRequestOutcome,
          ),
        }),
    ...(record.providerRequestOrdinal === undefined ? {} : { providerRequestOrdinal }),
    rawUsageJson: normalizeOptionalRawUsageJsonRecord(record.rawUsageJson, "rawUsageJson"),
    rawUsageJsonHash: normalizeOptionalString(record.rawUsageJsonHash, "rawUsageJsonHash"),
    reasoningTokens: normalizeOptionalInteger(record.reasoningTokens, "reasoningTokens"),
    reportingUserId: normalizeOptionalString(record.reportingUserId, "reportingUserId"),
    requestedModel: normalizeOptionalString(record.requestedModel, "requestedModel"),
    routeId: normalizeOptionalString(record.routeId, "routeId"),
    schema: normalizeUsageSchema(record.schema),
    servedModel: normalizeOptionalString(record.servedModel, "servedModel"),
    sessionId: normalizeRequiredString(record.sessionId, "sessionId"),
    stripeMeterSource: normalizeAssistantUsageStripeMeterSource(record.stripeMeterSource),
    surface: normalizeOptionalString(record.surface, "surface"),
    totalTokens: normalizeOptionalInteger(record.totalTokens, "totalTokens"),
    triggerKind: normalizeOptionalString(record.triggerKind, "triggerKind"),
    turnId,
    turnProfileJson: normalizeOptionalTurnProfileJson(record.turnProfileJson, "turnProfileJson"),
    usageId,
    usageExtractionSourcePath: normalizeOptionalString(
      record.usageExtractionSourcePath,
      "usageExtractionSourcePath",
    ),
    usageExtractionVersion:
      normalizeOptionalString(record.usageExtractionVersion, "usageExtractionVersion") ?? "legacy",
  };
}

export function resolveAssistantUsageCredentialSource(input: {
  apiKeyEnv: string | null;
  effectiveEnv?: Readonly<Record<string, string | undefined>> | null;
  headers?: Readonly<Record<string, string>> | null;
  provider: string;
  userEnvKeys: Iterable<string>;
}): AssistantUsageCredentialSource {
  const userEnvKeys = new Set(
    [...input.userEnvKeys].map((key) => normalizeRequiredString(key, "userEnvKey")),
  );
  const effectiveEnv = input.effectiveEnv ?? null;

  if (hasCredentialLikeAssistantHeaders(input.headers)) {
    return "member";
  }

  if (!input.apiKeyEnv) {
    if (input.provider === "codex-cli" && hasHostedMemberAiCredential(userEnvKeys, effectiveEnv)) {
      return "member";
    }

    return "platform";
  }

  if (!userEnvKeys.has(input.apiKeyEnv)) {
    return "platform";
  }

  if (!effectiveEnv) {
    return "member";
  }

  return hasNonEmptyAssistantEnvValue(effectiveEnv, input.apiKeyEnv) ? "member" : "platform";
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a JSON object.`);
  }

  return value as Record<string, unknown>;
}

function normalizeUsageSchema(value: unknown): typeof ASSISTANT_USAGE_SCHEMA {
  const schema = normalizeRequiredString(value, "schema");

  if (schema !== ASSISTANT_USAGE_SCHEMA) {
    throw new TypeError(`assistant usage record schema must be ${ASSISTANT_USAGE_SCHEMA}.`);
  }

  return ASSISTANT_USAGE_SCHEMA;
}

function normalizeCredentialSource(value: unknown): AssistantUsageCredentialSource {
  const normalized = normalizeRequiredString(value, "credentialSource");

  if (normalized !== "member" && normalized !== "platform" && normalized !== "unknown") {
    throw new TypeError("credentialSource must be 'member', 'platform', or 'unknown'.");
  }

  return normalized;
}

export function normalizeAssistantProviderRequestOutcome(
  value: unknown,
): AssistantProviderRequestOutcome {
  return normalizeProviderRequestOutcome(value);
}

function normalizeProviderRequestOutcome(value: unknown): AssistantProviderRequestOutcome {
  const normalized = normalizeRequiredString(value, "providerRequestOutcome");

  if (
    normalized === "aborted" ||
    normalized === "failed" ||
    normalized === "partial" ||
    normalized === "succeeded"
  ) {
    return normalized;
  }

  throw new TypeError(
    "providerRequestOutcome must be succeeded, failed, aborted, or partial.",
  );
}

export function normalizeAssistantUsageStripeMeterSource(
  value: unknown,
): AssistantUsageStripeMeterSource {
  const normalized = normalizeOptionalString(value, "stripeMeterSource");

  if (!normalized) {
    return "murph";
  }

  if (normalized !== "murph") {
    throw new TypeError(
      "stripeMeterSource must be 'murph' when provided.",
    );
  }

  return normalized;
}

function normalizeRequiredString(value: unknown, label: string): string {
  const normalized = normalizeOptionalString(value, label);

  if (!normalized) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return normalized;
}

function normalizeOptionalString(value: unknown, label: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string when provided.`);
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeOptionalStringArray(value: unknown, label: string): string[] {
  if (value === null || value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array of strings when provided.`);
  }

  const seen = new Set<string>();
  const normalizedValues: string[] = [];

  for (const [index, entry] of value.entries()) {
    const normalized = normalizeOptionalString(entry, `${label}[${index}]`);

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    normalizedValues.push(normalized);
  }

  return normalizedValues;
}

function normalizeOptionalJsonRecord(
  value: unknown,
  label: string,
): Record<string, unknown> | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a JSON object when provided.`);
  }

  const serialized = JSON.stringify(value);

  if (serialized === undefined) {
    throw new TypeError(`${label} must be JSON-serializable when provided.`);
  }

  const normalized: unknown = JSON.parse(serialized);

  if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) {
    throw new TypeError(`${label} must be a JSON object when provided.`);
  }

  return normalized as Record<string, unknown>;
}

function normalizeOptionalRawUsageJsonRecord(
  value: unknown,
  label: string,
): Record<string, unknown> | null {
  const record = normalizeOptionalJsonRecord(value, label);

  if (record === null) {
    return null;
  }

  const normalized: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(record)) {
    if (ASSISTANT_USAGE_RAW_TOKEN_KEYS.has(key) || ASSISTANT_USAGE_RAW_AUDIO_KEYS.has(key)) {
      if (!isNonNegativeInteger(entry)) {
        throw new TypeError(`${label}.${key} must be a non-negative integer.`);
      }
      normalized[key] = entry;
      continue;
    }

    const allowedDetailKeys = ASSISTANT_USAGE_RAW_DETAIL_TOKEN_KEYS.get(key);
    if (allowedDetailKeys) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new TypeError(`${label}.${key} must be a token detail object.`);
      }

      const normalizedDetails: Record<string, number> = {};
      for (const [detailKey, detailEntry] of Object.entries(entry)) {
        if (!allowedDetailKeys.has(detailKey)) {
          throw new TypeError(`${label}.${key}.${detailKey} is not allowed.`);
        }
        if (!isNonNegativeInteger(detailEntry)) {
          throw new TypeError(`${label}.${key}.${detailKey} must be a non-negative integer.`);
        }
        normalizedDetails[detailKey] = detailEntry;
      }

      normalized[key] = normalizedDetails;
      continue;
    }

    throw new TypeError(`${label}.${key} is not allowed.`);
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

// Strict allowlist for the per-turn profile: numeric series plus sanitized
// tool labels only, so nothing member-authored can ride along into the DB.
// The profile is droppable telemetry: an invalid profile becomes null instead
// of rejecting the whole usage record, so token accounting never fails open
// because of a telemetry-only validation mismatch.
function normalizeOptionalTurnProfileJson(
  value: unknown,
  label: string,
): Record<string, unknown> | null {
  try {
    return requireValidTurnProfileJson(value, label);
  } catch {
    return null;
  }
}

function requireValidTurnProfileJson(
  value: unknown,
  label: string,
): Record<string, unknown> | null {
  if (value === null || value === undefined) {
    return null;
  }

  const record = requireRecord(value, label);
  if (record.schema !== ASSISTANT_TURN_PROFILE_SCHEMA) {
    throw new TypeError(`${label}.schema must be ${ASSISTANT_TURN_PROFILE_SCHEMA}.`);
  }
  if (!isNonNegativeInteger(record.requestCount)) {
    throw new TypeError(`${label}.requestCount must be a non-negative integer.`);
  }
  if (record.modelContextWindow !== null && !isNonNegativeInteger(record.modelContextWindow)) {
    throw new TypeError(`${label}.modelContextWindow must be null or a non-negative integer.`);
  }
  if (typeof record.requestsTruncated !== "boolean" || typeof record.toolsTruncated !== "boolean") {
    throw new TypeError(`${label} truncation flags must be booleans.`);
  }
  if (!Array.isArray(record.requests) || record.requests.length > ASSISTANT_TURN_PROFILE_MAX_REQUESTS) {
    throw new TypeError(
      `${label}.requests must be an array of at most ${ASSISTANT_TURN_PROFILE_MAX_REQUESTS} entries.`,
    );
  }
  if (!Array.isArray(record.tools) || record.tools.length > ASSISTANT_TURN_PROFILE_MAX_TOOLS) {
    throw new TypeError(
      `${label}.tools must be an array of at most ${ASSISTANT_TURN_PROFILE_MAX_TOOLS} entries.`,
    );
  }

  return {
    modelContextWindow: record.modelContextWindow,
    requestCount: record.requestCount,
    requests: record.requests.map((entry, index) =>
      normalizeTurnProfileIntegerRecord(
        entry,
        `${label}.requests[${index}]`,
        ["cachedInput", "input", "output"],
      ),
    ),
    requestsTruncated: record.requestsTruncated,
    schema: ASSISTANT_TURN_PROFILE_SCHEMA,
    tools: record.tools.map((entry, index) => {
      const toolLabel = `${label}.tools[${index}]`;
      const tool = requireRecord(entry, toolLabel);
      if (
        typeof tool.label !== "string"
        || tool.label.length === 0
        || tool.label.length > ASSISTANT_TURN_PROFILE_MAX_TOOL_LABEL_LENGTH
        || !ASSISTANT_TURN_PROFILE_TOOL_LABEL_PATTERN.test(tool.label)
      ) {
        throw new TypeError(`${toolLabel}.label must be a short sanitized tool label.`);
      }

      return {
        ...normalizeTurnProfileIntegerRecord(tool, toolLabel, [
          "calls",
          "durationMs",
          "outputChars",
        ]),
        label: tool.label,
      };
    }),
    toolsTruncated: record.toolsTruncated,
  };
}

function normalizeTurnProfileIntegerRecord(
  value: unknown,
  label: string,
  keys: readonly string[],
): Record<string, number> {
  const record = requireRecord(value, label);
  const normalized: Record<string, number> = {};

  for (const key of keys) {
    const entry = record[key];
    if (!isNonNegativeInteger(entry)) {
      throw new TypeError(`${label}.${key} must be a non-negative integer.`);
    }
    normalized[key] = entry;
  }

  return normalized;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function normalizeRequiredInteger(value: unknown, label: string): number {
  const normalized = normalizeOptionalInteger(value, label);

  if (normalized === null) {
    throw new TypeError(`${label} must be a whole number.`);
  }

  return normalized;
}

function normalizeCanonicalAssistantUsageId(input: {
  attemptCount: number;
  providerRequestOrdinal: number;
  turnId: string;
  usageId: string;
}): string {
  const canonicalUsageId = createAssistantUsageId({
    attemptCount: input.attemptCount,
    providerRequestOrdinal: input.providerRequestOrdinal,
    turnId: input.turnId,
  });

  if (input.usageId !== canonicalUsageId) {
    throw new TypeError(
      `usageId must match the canonical turnId/providerRequestOrdinal/attemptCount-derived value ${canonicalUsageId}.`,
    );
  }

  return canonicalUsageId;
}

function normalizeOptionalInteger(value: unknown, label: string): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer when provided.`);
  }

  return value;
}

const SENSITIVE_HEADER_NAME_PATTERN =
  /(?:^|[-_])(?:authorization|cookie|token|secret|api[-_]?key|session[-_]?key)(?:$|[-_])/iu;
const SENSITIVE_HEADER_VALUE_PATTERN = /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/iu;

function hasCredentialLikeAssistantHeaders(
  headers: Readonly<Record<string, string>> | null | undefined,
): boolean {
  if (!headers || Object.keys(headers).length === 0) {
    return false;
  }

  return Object.entries(headers).some(([name, value]) =>
    isCredentialLikeAssistantHeader(name, value),
  );
}

function isCredentialLikeAssistantHeader(name: string, value: string): boolean {
  return (
    SENSITIVE_HEADER_NAME_PATTERN.test(name)
    || SENSITIVE_HEADER_VALUE_PATTERN.test(value)
  );
}

function hasHostedMemberAiCredential(
  userEnvKeys: ReadonlySet<string>,
  effectiveEnv: Readonly<Record<string, string | undefined>> | null,
): boolean {
  return [...userEnvKeys].some(
    (key) =>
      HOSTED_MEMBER_AI_CREDENTIAL_ENV_KEYS.has(key)
      && (effectiveEnv === null || hasNonEmptyAssistantEnvValue(effectiveEnv, key)),
  );
}

function hasNonEmptyAssistantEnvValue(
  env: Readonly<Record<string, string | undefined>>,
  key: string,
): boolean {
  const value = env[key];
  return typeof value === "string" && value.trim().length > 0;
}
