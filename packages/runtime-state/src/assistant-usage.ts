import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { writeJsonFileAtomic } from "./atomic-write.ts";
import {
  resolveAssistantStatePaths,
  type AssistantStatePaths,
} from "./assistant-state.ts";

export const ASSISTANT_USAGE_SCHEMA = "murph.assistant-usage.v1";

export type AssistantUsageCredentialSource = "member" | "platform" | "unknown";

export interface AssistantUsageRecord {
  apiKeyEnv: string | null;
  attemptCount: number;
  baseUrl: string | null;
  cacheWriteTokens: number | null;
  cachedInputTokens: number | null;
  credentialSource: AssistantUsageCredentialSource | null;
  inputTokens: number | null;
  memberId: string | null;
  occurredAt: string;
  outputTokens: number | null;
  provider: string;
  providerMetadataJson: unknown | null;
  providerName: string | null;
  providerRequestId: string | null;
  providerSessionId: string | null;
  rawUsageJson: unknown | null;
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
  await mkdir(paths.usagePendingDirectory, {
    recursive: true,
  });
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
  const totalTokens =
    normalizeOptionalInteger(record.totalTokens, "totalTokens")
    ?? resolveFallbackTotalTokens({
      inputTokens,
      outputTokens,
    });

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
    providerMetadataJson: record.providerMetadataJson ?? null,
    providerName: normalizeOptionalString(record.providerName, "providerName"),
    providerRequestId: normalizeOptionalString(record.providerRequestId, "providerRequestId"),
    providerSessionId: normalizeOptionalString(record.providerSessionId, "providerSessionId"),
    rawUsageJson: record.rawUsageJson ?? null,
    reasoningTokens: normalizeOptionalInteger(record.reasoningTokens, "reasoningTokens"),
    requestedModel: normalizeOptionalString(record.requestedModel, "requestedModel"),
    routeId: normalizeOptionalString(record.routeId, "routeId"),
    schema: normalizeUsageSchema(record.schema),
    servedModel: normalizeOptionalString(record.servedModel, "servedModel"),
    sessionId: normalizeRequiredString(record.sessionId, "sessionId"),
    totalTokens,
    turnId: normalizeRequiredString(record.turnId, "turnId"),
    usageId: normalizeRequiredString(record.usageId, "usageId"),
  };
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

function normalizeCredentialSource(value: unknown): AssistantUsageCredentialSource | null {
  const normalized = normalizeOptionalString(value, "credentialSource");

  if (!normalized) {
    return null;
  }

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

function resolveFallbackTotalTokens(input: {
  inputTokens: number | null;
  outputTokens: number | null;
}): number | null {
  if (input.inputTokens === null && input.outputTokens === null) {
    return null;
  }

  return (input.inputTokens ?? 0) + (input.outputTokens ?? 0);
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error
      && typeof error === "object"
      && "code" in error
      && error.code === "ENOENT",
  );
}
