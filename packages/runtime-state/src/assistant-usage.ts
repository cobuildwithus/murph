import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { writeJsonFileAtomic } from "./atomic-write.ts";
import { ensureAssistantStateDirectory } from "./assistant-state-security.ts";
import {
  resolveAssistantStatePaths,
  type AssistantStatePaths,
} from "./assistant-state.ts";
import {
  createVersionedJsonStateEnvelope,
  parseVersionedJsonStateEnvelope,
} from "./versioned-json-state.ts";

export const ASSISTANT_USAGE_SCHEMA = "murph.assistant-usage.v1";
const ASSISTANT_USAGE_FILE_SCHEMA_VERSION = 1;
const HOSTED_MEMBER_AI_CREDENTIAL_ENV_KEYS = new Set([
  "ANTHROPIC_API_KEY",
  "CEREBRAS_API_KEY",
  "DEEPSEEK_API_KEY",
  "FIREWORKS_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GROQ_API_KEY",
  "HF_TOKEN",
  "HUGGINGFACEHUB_API_TOKEN",
  "HUGGINGFACE_API_KEY",
  "HUGGING_FACE_HUB_TOKEN",
  "LITELLM_PROXY_API_KEY",
  "MISTRAL_API_KEY",
  "NVIDIA_API_KEY",
  "NGC_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "PERPLEXITY_API_KEY",
  "TOGETHER_API_KEY",
  "VERCEL_AI_API_KEY",
  "VENICE_API_KEY",
  "XAI_API_KEY",
]);

export type AssistantUsageCredentialSource = "member" | "platform" | "unknown";
export type AssistantUsageStripeMeterSource = "murph" | "vercel-ai-gateway";

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
  providerRequestOrdinal?: number;
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
  usageId: string;
}

export interface PendingAssistantUsageRecordParseFailure {
  error: unknown;
  fileName: string;
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

export function resolvePendingAssistantUsagePath(
  paths: AssistantStatePaths,
  usageId: string,
): string {
  return path.join(
    paths.usagePendingDirectory,
    encodePendingAssistantUsageFileName(normalizeRequiredString(usageId, "usageId")),
  );
}

export async function writePendingAssistantUsageRecord(input: {
  paths?: AssistantStatePaths;
  record: AssistantUsageRecord;
  vault?: string;
}): Promise<void> {
  const paths = resolveAssistantUsagePaths(input.vault, input.paths);
  const record = parseAssistantUsageRecord(input.record);
  await ensureAssistantStateDirectory(paths.usagePendingDirectory);
  await writeJsonFileAtomic(
    resolvePendingAssistantUsagePath(paths, record.usageId),
    createVersionedJsonStateEnvelope({
      schema: ASSISTANT_USAGE_SCHEMA,
      schemaVersion: ASSISTANT_USAGE_FILE_SCHEMA_VERSION,
      value: record,
    }),
  );
}

export async function listPendingAssistantUsageRecords(input: {
  onInvalidRecord?: ((failure: PendingAssistantUsageRecordParseFailure) => void) | null;
  paths?: AssistantStatePaths;
  skipInvalidRecords?: boolean;
  vault?: string;
}): Promise<AssistantUsageRecord[]> {
  const paths = resolveAssistantUsagePaths(input.vault, input.paths);
  const onInvalidRecord = input.onInvalidRecord ?? null;
  const skipInvalidRecords = input.skipInvalidRecords ?? false;

  try {
    const entries = await readdir(paths.usagePendingDirectory, {
      withFileTypes: true,
    });
    const records: AssistantUsageRecord[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !isCanonicalPendingAssistantUsageFileName(entry.name)) {
        continue;
      }

      try {
        const raw = await readFile(path.join(paths.usagePendingDirectory, entry.name), "utf8");
        records.push(parsePendingAssistantUsageFile(JSON.parse(raw)));
      } catch (error) {
        if (!skipInvalidRecords) {
          throw error;
        }

        onInvalidRecord?.({
          error,
          fileName: entry.name,
        });
      }
    }

    return records.sort((left, right) => {
      const occurredAtOrder = left.occurredAt.localeCompare(right.occurredAt);

      if (occurredAtOrder !== 0) {
        return occurredAtOrder;
      }

      return left.usageId.localeCompare(right.usageId);
    });
  } catch (error) {
    if (isMissingFileError(error)) {
      return [];
    }

    throw error;
  }
}

export async function deletePendingAssistantUsageRecord(input: {
  paths?: AssistantStatePaths;
  usageId: string;
  vault?: string;
}): Promise<void> {
  const paths = resolveAssistantUsagePaths(input.vault, input.paths);

  await rm(resolvePendingAssistantUsagePath(paths, input.usageId), {
    force: true,
  });
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
    ...(record.providerRequestOrdinal === undefined ? {} : { providerRequestOrdinal }),
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
    usageId,
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
      return "unknown";
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

function resolveAssistantUsagePaths(
  vault: string | undefined,
  paths: AssistantStatePaths | undefined,
): AssistantStatePaths {
  if (paths) {
    return paths;
  }

  if (!vault) {
    throw new TypeError("vault or paths is required when resolving assistant usage state.");
  }

  return resolveAssistantStatePaths(vault);
}

function encodePendingAssistantUsageFileName(usageId: string): string {
  return `${Buffer.from(usageId, "utf8").toString("base64url")}.json`;
}

function isCanonicalPendingAssistantUsageFileName(fileName: string): boolean {
  return /^[A-Za-z0-9_-]+\.json$/u.test(fileName);
}

function parsePendingAssistantUsageFile(value: unknown): AssistantUsageRecord {
  return parseVersionedJsonStateEnvelope(value, {
    label: "pending assistant usage record",
    parseValue: parseAssistantUsageRecord,
    schema: ASSISTANT_USAGE_SCHEMA,
    schemaVersion: ASSISTANT_USAGE_FILE_SCHEMA_VERSION,
  });
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

export function normalizeAssistantUsageStripeMeterSource(
  value: unknown,
): AssistantUsageStripeMeterSource {
  const normalized = normalizeOptionalString(value, "stripeMeterSource");

  if (!normalized) {
    return "murph";
  }

  if (normalized !== "murph" && normalized !== "vercel-ai-gateway") {
    throw new TypeError(
      "stripeMeterSource must be 'murph' or 'vercel-ai-gateway' when provided.",
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

function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error
      && typeof error === "object"
      && "code" in error
      && error.code === "ENOENT",
  );
}

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
