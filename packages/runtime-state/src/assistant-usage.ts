import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { writeJsonFileAtomic } from "./atomic-write.ts";
import { ensureAssistantStateDirectory } from "./assistant-state-security.ts";
import {
  resolveAssistantStatePaths,
  type AssistantStatePaths,
} from "./assistant-state.ts";

export const ASSISTANT_USAGE_SCHEMA = "murph.assistant-usage.v1";
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
  "VENICE_API_KEY",
  "XAI_API_KEY",
]);

export type AssistantUsageCredentialSource = "member" | "platform" | "unknown";

export interface AssistantUsageRecord {
  apiKeyEnv: string | null;
  attemptCount: number;
  baseUrl: string | null;
  cacheWriteTokens: number | null;
  cachedInputTokens: number | null;
  credentialSource: AssistantUsageCredentialSource;
  inputTokens: number | null;
  memberId: string | null;
  occurredAt: string;
  outputTokens: number | null;
  provider: string;
  providerName: string | null;
  reasoningTokens: number | null;
  requestedModel: string | null;
  routeId: string | null;
  schema: typeof ASSISTANT_USAGE_SCHEMA;
  servedModel: string | null;
  sessionId: string;
  totalTokens: number | null;
  turnId: string;
  usageId: string;
}

export function createAssistantUsageId(input: {
  attemptCount: number;
  turnId: string;
}): string {
  const attemptCount = normalizeRequiredInteger(input.attemptCount, "attemptCount");
  const turnId = normalizeRequiredString(input.turnId, "turnId");

  return `${turnId}.attempt-${attemptCount}`;
}

export function resolvePendingAssistantUsagePath(
  paths: AssistantStatePaths,
  usageId: string,
): string {
  return path.join(paths.usagePendingDirectory, `${normalizeRequiredString(usageId, "usageId")}.json`);
}

export async function writePendingAssistantUsageRecord(input: {
  paths?: AssistantStatePaths;
  record: AssistantUsageRecord;
  vault?: string;
}): Promise<void> {
  const paths = resolveAssistantUsagePaths(input.vault, input.paths);
  const record = parseAssistantUsageRecord(input.record);
  await ensureAssistantStateDirectory(paths.usagePendingDirectory);
  await writeJsonFileAtomic(resolvePendingAssistantUsagePath(paths, record.usageId), record);
}

export async function listPendingAssistantUsageRecords(input: {
  paths?: AssistantStatePaths;
  vault?: string;
}): Promise<AssistantUsageRecord[]> {
  const paths = resolveAssistantUsagePaths(input.vault, input.paths);

  try {
    const entries = await readdir(paths.usagePendingDirectory, {
      withFileTypes: true,
    });
    const records = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map(async (entry) => {
          const raw = await readFile(path.join(paths.usagePendingDirectory, entry.name), "utf8");
          return parseAssistantUsageRecord(JSON.parse(raw) as unknown);
        }),
    );

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
  const inputTokens = normalizeOptionalInteger(record.inputTokens, "inputTokens");
  const outputTokens = normalizeOptionalInteger(record.outputTokens, "outputTokens");

  return {
    apiKeyEnv: normalizeOptionalString(record.apiKeyEnv, "apiKeyEnv"),
    attemptCount: normalizeRequiredInteger(record.attemptCount, "attemptCount"),
    baseUrl: normalizeOptionalString(record.baseUrl, "baseUrl"),
    cacheWriteTokens: normalizeOptionalInteger(record.cacheWriteTokens, "cacheWriteTokens"),
    cachedInputTokens: normalizeOptionalInteger(record.cachedInputTokens, "cachedInputTokens"),
    credentialSource: normalizeCredentialSource(record.credentialSource),
    inputTokens,
    memberId: normalizeOptionalString(record.memberId, "memberId"),
    occurredAt: normalizeRequiredString(record.occurredAt, "occurredAt"),
    outputTokens,
    provider: normalizeRequiredString(record.provider, "provider"),
    providerName: normalizeOptionalString(record.providerName, "providerName"),
    reasoningTokens: normalizeOptionalInteger(record.reasoningTokens, "reasoningTokens"),
    requestedModel: normalizeOptionalString(record.requestedModel, "requestedModel"),
    routeId: normalizeOptionalString(record.routeId, "routeId"),
    schema: normalizeUsageSchema(record.schema),
    servedModel: normalizeOptionalString(record.servedModel, "servedModel"),
    sessionId: normalizeRequiredString(record.sessionId, "sessionId"),
    totalTokens: normalizeOptionalInteger(record.totalTokens, "totalTokens"),
    turnId: normalizeRequiredString(record.turnId, "turnId"),
    usageId: normalizeRequiredString(record.usageId, "usageId"),
  };
}

export function resolveAssistantUsageCredentialSource(input: {
  apiKeyEnv: string | null;
  provider: string;
  userEnvKeys: Iterable<string>;
}): AssistantUsageCredentialSource {
  const userEnvKeys = new Set(
    [...input.userEnvKeys].map((key) => normalizeRequiredString(key, "userEnvKey")),
  );

  if (!input.apiKeyEnv) {
    if (input.provider === "codex-cli" && hasHostedMemberAiCredential(userEnvKeys)) {
      return "unknown";
    }

    return "platform";
  }

  return userEnvKeys.has(input.apiKeyEnv) ? "member" : "platform";
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

function normalizeRequiredInteger(value: unknown, label: string): number {
  const normalized = normalizeOptionalInteger(value, label);

  if (normalized === null) {
    throw new TypeError(`${label} must be a whole number.`);
  }

  return normalized;
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

function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error
      && typeof error === "object"
      && "code" in error
      && error.code === "ENOENT",
  );
}

function hasHostedMemberAiCredential(userEnvKeys: ReadonlySet<string>): boolean {
  return [...userEnvKeys].some((key) => HOSTED_MEMBER_AI_CREDENTIAL_ENV_KEYS.has(key));
}
