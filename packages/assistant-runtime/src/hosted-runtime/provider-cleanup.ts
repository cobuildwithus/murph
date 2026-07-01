import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import type {
  HostedRuntimeEvent,
} from "@murphai/hosted-execution/contracts";
import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import {
  resolveAssistantStatePaths,
  writeAssistantStateJson,
} from "@murphai/runtime-state/node/assistant-state-fs";

import type {
  HostedAssistantDeliveryOutcome,
} from "./models.ts";
import { deleteHostedLinqMessages } from "./message-cleanup.ts";
import {
  requireHostedProviderFetchDependencies,
} from "./provider-fetch.ts";

const HOSTED_PROVIDER_CLEANUP_SCHEMA = "murph.hosted-provider-cleanup.v1";
const HOSTED_PROVIDER_CLEANUP_FILE_NAME = "hosted-provider-cleanup.json";
const HOSTED_PROVIDER_CLEANUP_DEFAULT_IDLE_CHECKPOINT_DELAY_MS = 180_000;
const HOSTED_PROVIDER_CLEANUP_AFTER_IDLE_BUFFER_MS = 1_000;
const HOSTED_PROVIDER_CLEANUP_RETRY_DELAY_MS = 5 * 60_000;

interface HostedProviderCleanupState {
  linqMessageIds: string[];
  checkpoint: HostedProviderCleanupCheckpoint | null;
  schema: typeof HOSTED_PROVIDER_CLEANUP_SCHEMA;
}

export interface HostedProviderCleanupCheckpoint {
  nextWakeAt?: string | null;
}

export interface HostedProviderCleanupDrainResult {
  attemptedLinqMessageCount: number;
  deletedLinqMessageCount: number;
  failedLinqMessageCount: number;
  nextWakeAt: string | null;
}

export async function recordHostedProviderCleanupBeforeCommit(input: {
  linqMessageIds?: readonly string[] | null;
  checkpoint: HostedProviderCleanupCheckpoint;
  nowMs?: number | null;
  vaultRoot: string;
}): Promise<HostedProviderCleanupCheckpoint> {
  const existing = await readHostedProviderCleanupState(input.vaultRoot);
  const checkpoint = resolveHostedProviderCleanupRecordedCheckpoint({
    existing: existing?.checkpoint ?? null,
    next: input.checkpoint,
    nowMs: input.nowMs,
  });
  await writeHostedProviderCleanupState(input.vaultRoot, {
    schema: HOSTED_PROVIDER_CLEANUP_SCHEMA,
    checkpoint,
    linqMessageIds: normalizeHostedProviderMessageIds([
      ...(existing?.linqMessageIds ?? []),
      ...(input.linqMessageIds ?? []),
    ]),
  });
  return checkpoint;
}

export async function readHostedProviderCleanupCheckpoint(
  vaultRoot: string,
): Promise<HostedProviderCleanupCheckpoint | null> {
  return (await readHostedProviderCleanupState(vaultRoot))?.checkpoint ?? null;
}

export async function resolveHostedProviderCleanupScheduledWakeAt(input: {
  deferDueOrInvalid: boolean;
  idleCheckpointDelayMs?: number | null;
  nowMs: number;
  vaultRoot: string;
}): Promise<string | null> {
  return resolveHostedProviderCleanupCheckpointWakeAt({
    checkpoint: await readHostedProviderCleanupCheckpoint(input.vaultRoot),
    deferDueOrInvalid: input.deferDueOrInvalid,
    idleCheckpointDelayMs: input.idleCheckpointDelayMs,
    nowMs: input.nowMs,
  });
}

export async function drainHostedProviderCleanupAfterCommit(input: {
  assistantDeliveryOutcomes: readonly HostedAssistantDeliveryOutcome[];
  assertLiveness?: () => Promise<void>;
  env: NodeJS.ProcessEnv;
  fetchImplementation: typeof fetch | null;
  checkpoint: HostedProviderCleanupCheckpoint;
  signal?: AbortSignal | null;
  vaultRoot: string;
  wake: HostedRuntimeEvent;
}): Promise<HostedProviderCleanupDrainResult> {
  assertHostedProviderCleanupLiveness(input.signal);
  const existing = await readHostedProviderCleanupState(input.vaultRoot);
  const messageIds = normalizeHostedProviderMessageIds([
    ...(existing?.linqMessageIds ?? []),
    ...collectHostedLinqProviderMessageIds(input.assistantDeliveryOutcomes),
  ]);

  if (messageIds.length === 0) {
    if (existing) {
      await clearHostedProviderCleanupState(input.vaultRoot);
    }
    return {
      attemptedLinqMessageCount: 0,
      deletedLinqMessageCount: 0,
      failedLinqMessageCount: 0,
      nextWakeAt: null,
    };
  }

  try {
    await assertHostedProviderCleanupLiveNow(input);
    const dependencies = requireHostedProviderFetchDependencies({
      env: input.env,
      fetchImplementation: input.fetchImplementation,
      ...(input.signal ? { signal: input.signal } : {}),
    }, "Hosted Linq provider cleanup");
    await deleteHostedLinqMessages({
      ...dependencies,
      messageIds,
    });
    await assertHostedProviderCleanupLiveNow(input);
  } catch (error) {
    const nextWakeAt = resolveHostedProviderCleanupRetryWakeAt();
    await writeHostedProviderCleanupState(input.vaultRoot, {
      schema: HOSTED_PROVIDER_CLEANUP_SCHEMA,
      checkpoint: {
        nextWakeAt,
      },
      linqMessageIds: messageIds,
    });
    emitHostedExecutionStructuredLog({
      component: "runtime",
      details: {
        linqMessageCount: messageIds.length,
        provider: "linq",
      },
      error,
      level: "warn",
      message:
        "Hosted runtime could not delete provider-visible Linq messages after commit; retry state remains in the runtime snapshot.",
      phase: "outbox",
      wake: input.wake,
    });
    return {
      attemptedLinqMessageCount: messageIds.length,
      deletedLinqMessageCount: 0,
      failedLinqMessageCount: messageIds.length,
      nextWakeAt,
    };
  }

  await clearHostedProviderCleanupState(input.vaultRoot);
  return {
    attemptedLinqMessageCount: messageIds.length,
    deletedLinqMessageCount: messageIds.length,
    failedLinqMessageCount: 0,
    nextWakeAt: null,
  };
}

export function collectHostedProviderCleanupMessageIdsFromDeliveryOutcomes(
  outcomes: readonly HostedAssistantDeliveryOutcome[],
): string[] {
  return normalizeHostedProviderMessageIds(collectHostedLinqProviderMessageIds(outcomes));
}

export function resolveHostedProviderCleanupFirstDeferredWakeAt(input: {
  idleCheckpointDelayMs?: number | null;
  nowMs?: number | null;
} = {}): string {
  const nowMs = Number.isFinite(input.nowMs)
    ? Number(input.nowMs)
    : Date.now();
  return new Date(
    nowMs
      + resolveHostedProviderCleanupIdleCheckpointDelayMs(input.idleCheckpointDelayMs)
      + HOSTED_PROVIDER_CLEANUP_AFTER_IDLE_BUFFER_MS,
  ).toISOString();
}

export function resolveHostedProviderCleanupRetryWakeAt(input: {
  nowMs?: number | null;
} = {}): string {
  const nowMs = Number.isFinite(input.nowMs)
    ? Number(input.nowMs)
    : Date.now();
  return new Date(nowMs + HOSTED_PROVIDER_CLEANUP_RETRY_DELAY_MS).toISOString();
}

export function resolveHostedProviderCleanupCheckpointWakeAt(input: {
  checkpoint: HostedProviderCleanupCheckpoint | null;
  deferDueOrInvalid: boolean;
  idleCheckpointDelayMs?: number | null;
  nowMs: number;
}): string | null {
  if (!input.checkpoint) {
    return null;
  }

  const checkpointWakeAt = input.checkpoint.nextWakeAt ?? null;
  const checkpointWakeMs = Date.parse(checkpointWakeAt ?? "");
  if (!Number.isFinite(checkpointWakeMs) || checkpointWakeMs <= input.nowMs) {
    return input.deferDueOrInvalid
      ? resolveHostedProviderCleanupFirstDeferredWakeAt({
          idleCheckpointDelayMs: input.idleCheckpointDelayMs,
          nowMs: input.nowMs,
        })
      : null;
  }

  return checkpointWakeAt;
}

function resolveHostedProviderCleanupRecordedCheckpoint(input: {
  existing: HostedProviderCleanupCheckpoint | null;
  next: HostedProviderCleanupCheckpoint;
  nowMs?: number | null;
}): HostedProviderCleanupCheckpoint {
  const normalizedNext = normalizeHostedProviderCleanupCheckpoint(input.next)
    ?? { nextWakeAt: null };
  const nextWakeAt = normalizedNext.nextWakeAt ?? null;
  const nextWakeMs = Date.parse(nextWakeAt ?? "");
  if (!Number.isFinite(nextWakeMs)) {
    return normalizedNext;
  }

  const existingWakeAt = input.existing?.nextWakeAt ?? null;
  const existingWakeMs = Date.parse(existingWakeAt ?? "");
  const nowMs = Number.isFinite(input.nowMs)
    ? Number(input.nowMs)
    : Date.now();
  if (
    Number.isFinite(existingWakeMs)
    && existingWakeMs > nowMs
    && existingWakeMs < nextWakeMs
  ) {
    return {
      nextWakeAt: existingWakeAt,
    };
  }

  return normalizedNext;
}

function resolveHostedProviderCleanupIdleCheckpointDelayMs(
  value: number | null | undefined,
): number {
  if (value !== null && value !== undefined && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }

  return HOSTED_PROVIDER_CLEANUP_DEFAULT_IDLE_CHECKPOINT_DELAY_MS;
}

async function assertHostedProviderCleanupLiveNow(input: {
  assertLiveness?: () => Promise<void>;
  signal?: AbortSignal | null;
}): Promise<void> {
  assertHostedProviderCleanupLiveness(input.signal);
  await input.assertLiveness?.();
  assertHostedProviderCleanupLiveness(input.signal);
}

function assertHostedProviderCleanupLiveness(signal: AbortSignal | null | undefined): void {
  if (!signal?.aborted) {
    return;
  }

  const reason = signal.reason;
  if (reason instanceof Error) {
    throw reason;
  }
  throw new Error("Hosted provider cleanup was aborted.");
}

function collectHostedLinqProviderMessageIds(
  outcomes: readonly HostedAssistantDeliveryOutcome[],
): string[] {
  const messageIds: string[] = [];

  for (const outcome of outcomes) {
    if (
      outcome.deliveryChannel !== "linq"
      || (outcome.deliveryStatus !== "sent" && outcome.deliveryStatus !== "failed_ambiguous")
    ) {
      continue;
    }

    if (Array.isArray(outcome.providerMessageIds) && outcome.providerMessageIds.length > 0) {
      messageIds.push(...outcome.providerMessageIds);
      continue;
    }

    if (outcome.providerMessageId) {
      messageIds.push(outcome.providerMessageId);
    }
  }

  return messageIds;
}

async function readHostedProviderCleanupState(
  vaultRoot: string,
): Promise<HostedProviderCleanupState | null> {
  const filePath = resolveHostedProviderCleanupStatePath(vaultRoot);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }
    throw error;
  }

  try {
    return parseHostedProviderCleanupState(JSON.parse(raw));
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

async function writeHostedProviderCleanupState(
  vaultRoot: string,
  state: HostedProviderCleanupState,
): Promise<void> {
  const filePath = resolveHostedProviderCleanupStatePath(vaultRoot);
  await writeAssistantStateJson(filePath, {
    schema: HOSTED_PROVIDER_CLEANUP_SCHEMA,
    checkpoint: state.checkpoint,
    linqMessageIds: normalizeHostedProviderMessageIds(state.linqMessageIds),
  });
}

async function clearHostedProviderCleanupState(vaultRoot: string): Promise<void> {
  await rm(resolveHostedProviderCleanupStatePath(vaultRoot), {
    force: true,
  });
}

function resolveHostedProviderCleanupStatePath(vaultRoot: string): string {
  return path.join(
    resolveAssistantStatePaths(vaultRoot).assistantStateRoot,
    HOSTED_PROVIDER_CLEANUP_FILE_NAME,
  );
}

function parseHostedProviderCleanupState(value: unknown): HostedProviderCleanupState | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as {
    checkpoint?: unknown;
    linqMessageIds?: unknown;
    schema?: unknown;
  };
  if (record.schema !== HOSTED_PROVIDER_CLEANUP_SCHEMA) {
    return null;
  }

  return {
    schema: HOSTED_PROVIDER_CLEANUP_SCHEMA,
    checkpoint: normalizeHostedProviderCleanupCheckpoint(record.checkpoint ?? null),
    linqMessageIds: Array.isArray(record.linqMessageIds)
      ? normalizeHostedProviderMessageIds(record.linqMessageIds.filter((messageId) =>
          typeof messageId === "string"
        ))
      : [],
  };
}

function normalizeHostedProviderCleanupCheckpoint(
  value: HostedProviderCleanupCheckpoint | unknown,
): HostedProviderCleanupCheckpoint | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as { nextWakeAt?: unknown };
  return {
    ...(typeof record.nextWakeAt === "string" || record.nextWakeAt === null
      ? { nextWakeAt: record.nextWakeAt }
      : {}),
  };
}

function normalizeHostedProviderMessageIds(messageIds: readonly string[]): string[] {
  return [...new Set(messageIds.map((messageId) => messageId.trim()).filter(Boolean))];
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error
      && typeof error === "object"
      && "code" in error
      && error.code === "ENOENT",
  );
}
