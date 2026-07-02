import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import type {
  HostedRuntimeEvent,
} from "@murphai/hosted-execution/contracts";
import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import {
  listPendingAssistantAutoReplyLinqCleanupEvidence,
  markAssistantAutoReplyLinqCleanupQueued,
} from "@murphai/assistant-engine/assistant-automation";
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
const HOSTED_PROVIDER_CLEANUP_RECOVERY_SCHEMA =
  "murph.hosted-provider-cleanup-recovery.v1";
const HOSTED_PROVIDER_CLEANUP_RECOVERY_FILE_NAME =
  "hosted-provider-cleanup-recovery.json";
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

export interface HostedProviderCleanupPlan {
  checkpoint: HostedProviderCleanupCheckpoint | null;
  deferred: boolean;
  due: boolean;
  requiresCheckpoint: boolean;
  stateQueued: boolean;
  wakeAt: string | null;
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
  vaultRoot: string;
}): Promise<HostedProviderCleanupCheckpoint> {
  const existing = await readHostedProviderCleanupState(input.vaultRoot);
  const checkpoint = normalizeHostedProviderCleanupCheckpoint(input.checkpoint)
    ?? { nextWakeAt: null };
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

export async function prepareHostedProviderCleanupPlan(input: {
  deferred: boolean;
  idleCheckpointDelayMs?: number | null;
  initialCheckpoint?: HostedProviderCleanupCheckpoint | null;
  nowMs: number;
  terminalCleanupMessageIds?: readonly string[] | null;
  vaultRoot: string;
}): Promise<HostedProviderCleanupPlan> {
  const pendingLinqMessageIds =
    normalizeHostedProviderMessageIds([...(input.terminalCleanupMessageIds ?? [])]);

  if (input.deferred) {
    if (pendingLinqMessageIds.length > 0) {
      const checkpoint = await recordHostedProviderCleanupBeforeCommit({
        checkpoint: {
          nextWakeAt: resolveHostedProviderCleanupFirstDeferredWakeAt({
            idleCheckpointDelayMs: input.idleCheckpointDelayMs,
            nowMs: input.nowMs,
          }),
        },
        linqMessageIds: pendingLinqMessageIds,
        vaultRoot: input.vaultRoot,
      });
      return {
        checkpoint,
        deferred: true,
        due: false,
        requiresCheckpoint: true,
        stateQueued: true,
        wakeAt: checkpoint.nextWakeAt ?? null,
      };
    }

    return {
      checkpoint: input.initialCheckpoint ?? null,
      deferred: true,
      due: false,
      requiresCheckpoint: false,
      stateQueued: false,
      wakeAt: resolveHostedProviderCleanupCheckpointWakeAt({
        checkpoint: await readHostedProviderCleanupCheckpoint(input.vaultRoot),
        deferDueOrInvalid: true,
        idleCheckpointDelayMs: input.idleCheckpointDelayMs,
        nowMs: input.nowMs,
      }),
    };
  }

  const recoveredCleanupQueued =
    await recoverLegacyPendingTerminalLinqCleanupOnce(input.vaultRoot);
  const terminalCleanupQueued =
    recoveredCleanupQueued || pendingLinqMessageIds.length > 0;
  if (pendingLinqMessageIds.length > 0) {
    await recordHostedProviderCleanupBeforeCommit({
      checkpoint: {
        nextWakeAt: null,
      },
      linqMessageIds: pendingLinqMessageIds,
      vaultRoot: input.vaultRoot,
    });
  }

  const checkpoint =
    input.initialCheckpoint
    ?? (terminalCleanupQueued
      ? { nextWakeAt: null }
      : await readHostedProviderCleanupCheckpoint(input.vaultRoot));
  return buildHostedProviderCleanupPlan({
    checkpoint,
    deferred: false,
    idleCheckpointDelayMs: input.idleCheckpointDelayMs,
    nowMs: input.nowMs,
    stateQueued: terminalCleanupQueued,
  });
}

export async function recordHostedProviderCleanupAfterDelivery(input: {
  idleCheckpointDelayMs?: number | null;
  nowMs: number;
  outcomes: readonly HostedAssistantDeliveryOutcome[];
  vaultRoot: string;
}): Promise<{ nextWakeAt: string | null }> {
  const providerCleanupMessageIds =
    collectHostedProviderCleanupMessageIdsFromDeliveryOutcomes(input.outcomes);
  if (providerCleanupMessageIds.length === 0) {
    return {
      nextWakeAt: null,
    };
  }

  const checkpoint = await recordHostedProviderCleanupBeforeCommit({
    checkpoint: {
      nextWakeAt: resolveHostedProviderCleanupFirstDeferredWakeAt({
        idleCheckpointDelayMs: input.idleCheckpointDelayMs,
        nowMs: input.nowMs,
      }),
    },
    linqMessageIds: providerCleanupMessageIds,
    vaultRoot: input.vaultRoot,
  });
  return {
    nextWakeAt: checkpoint.nextWakeAt ?? null,
  };
}

export async function drainHostedProviderCleanupAfterCommit(input: {
  assistantDeliveryOutcomes: readonly HostedAssistantDeliveryOutcome[];
  assertLiveness?: () => Promise<void>;
  env: NodeJS.ProcessEnv;
  fetchImplementation: typeof fetch | null;
  checkpoint: HostedProviderCleanupCheckpoint;
  shouldYield?: (() => boolean) | null;
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

  let deletedCount = 0;
  for (let index = 0; index < messageIds.length; index += 1) {
    if (input.shouldYield?.() === true) {
      const nextWakeAt = resolveHostedProviderCleanupRetryWakeAt();
      await writeHostedProviderCleanupState(input.vaultRoot, {
        schema: HOSTED_PROVIDER_CLEANUP_SCHEMA,
        checkpoint: {
          nextWakeAt,
        },
        linqMessageIds: messageIds.slice(index),
      });
      return {
        attemptedLinqMessageCount: deletedCount,
        deletedLinqMessageCount: deletedCount,
        failedLinqMessageCount: 0,
        nextWakeAt,
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
        messageIds: [messageIds[index]!],
      });
      deletedCount += 1;
    } catch (error) {
      const remainingMessageIds = messageIds.slice(index);
      const nextWakeAt = resolveHostedProviderCleanupRetryWakeAt();
      await writeHostedProviderCleanupState(input.vaultRoot, {
        schema: HOSTED_PROVIDER_CLEANUP_SCHEMA,
        checkpoint: {
          nextWakeAt,
        },
        linqMessageIds: remainingMessageIds,
      });
      emitHostedExecutionStructuredLog({
        component: "runtime",
        details: {
          linqMessageCount: remainingMessageIds.length,
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
        attemptedLinqMessageCount: deletedCount + remainingMessageIds.length,
        deletedLinqMessageCount: deletedCount,
        failedLinqMessageCount: remainingMessageIds.length,
        nextWakeAt,
      };
    }
  }

  await clearHostedProviderCleanupState(input.vaultRoot);
  return {
    attemptedLinqMessageCount: messageIds.length,
    deletedLinqMessageCount: messageIds.length,
    failedLinqMessageCount: 0,
    nextWakeAt: null,
  };
}

function collectHostedProviderCleanupMessageIdsFromDeliveryOutcomes(
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

function resolveHostedProviderCleanupRetryWakeAt(input: {
  nowMs?: number | null;
} = {}): string {
  const nowMs = Number.isFinite(input.nowMs)
    ? Number(input.nowMs)
    : Date.now();
  return new Date(nowMs + HOSTED_PROVIDER_CLEANUP_RETRY_DELAY_MS).toISOString();
}

function resolveHostedProviderCleanupCheckpointWakeAt(input: {
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

// One-shot migration per vault: terminal evidence written before producers
// carried cleanup message ids used a queuedAt marker as the pending-cleanup
// queue. Drain any such evidence into hosted-provider-cleanup.json in bounded
// batches, then mark recovery complete so steady-state wakes never scan the
// evidence directory. Delete this migration (and the evidence-scan helpers it
// uses: listPendingAssistantAutoReplyLinqCleanupEvidence,
// markAssistantAutoReplyLinqCleanupQueued) once production vaults have all
// written the recovery marker.
async function recoverLegacyPendingTerminalLinqCleanupOnce(
  vaultRoot: string,
): Promise<boolean> {
  if (await hasHostedProviderCleanupRecoveryCompleted(vaultRoot)) {
    return false;
  }

  let recoveredCleanupQueued = false;
  const queuedCaptureIds = new Set<string>();
  for (;;) {
    const pending = await listPendingAssistantAutoReplyLinqCleanupEvidence({
      vault: vaultRoot,
    });
    if (
      pending.linqMessageIds.length === 0
      || pending.captureIds.every((captureId) => queuedCaptureIds.has(captureId))
    ) {
      break;
    }
    recoveredCleanupQueued = true;
    for (const captureId of pending.captureIds) {
      queuedCaptureIds.add(captureId);
    }
    await recordHostedProviderCleanupBeforeCommit({
      checkpoint: {
        nextWakeAt: null,
      },
      linqMessageIds: pending.linqMessageIds,
      vaultRoot,
    });
    await markAssistantAutoReplyLinqCleanupQueued({
      captureIds: pending.captureIds,
      vault: vaultRoot,
    });
  }
  await markHostedProviderCleanupRecoveryCompleted(vaultRoot);
  return recoveredCleanupQueued;
}

export async function hasHostedProviderCleanupRecoveryCompleted(
  vaultRoot: string,
): Promise<boolean> {
  try {
    const raw = await readFile(
      resolveHostedProviderCleanupRecoveryPath(vaultRoot),
      "utf8",
    );
    return (JSON.parse(raw) as { schema?: unknown }).schema
      === HOSTED_PROVIDER_CLEANUP_RECOVERY_SCHEMA;
  } catch {
    return false;
  }
}

async function markHostedProviderCleanupRecoveryCompleted(
  vaultRoot: string,
): Promise<void> {
  await writeAssistantStateJson(resolveHostedProviderCleanupRecoveryPath(vaultRoot), {
    schema: HOSTED_PROVIDER_CLEANUP_RECOVERY_SCHEMA,
  });
}

function resolveHostedProviderCleanupRecoveryPath(vaultRoot: string): string {
  return path.join(
    resolveAssistantStatePaths(vaultRoot).assistantStateRoot,
    HOSTED_PROVIDER_CLEANUP_RECOVERY_FILE_NAME,
  );
}

function buildHostedProviderCleanupPlan(input: {
  checkpoint: HostedProviderCleanupCheckpoint | null;
  deferred: boolean;
  idleCheckpointDelayMs?: number | null;
  nowMs: number;
  stateQueued: boolean;
}): HostedProviderCleanupPlan {
  const due =
    !input.deferred
    && isHostedProviderCleanupCheckpointDue(input.checkpoint, input.nowMs);
  return {
    checkpoint: input.checkpoint,
    deferred: input.deferred,
    due,
    requiresCheckpoint: due || input.stateQueued,
    stateQueued: input.stateQueued,
    wakeAt: resolveHostedProviderCleanupCheckpointWakeAt({
      checkpoint: input.checkpoint,
      deferDueOrInvalid: input.deferred,
      idleCheckpointDelayMs: input.idleCheckpointDelayMs,
      nowMs: input.nowMs,
    }),
  };
}

function isHostedProviderCleanupCheckpointDue(
  checkpoint: HostedProviderCleanupCheckpoint | null,
  nowMs: number,
): boolean {
  if (!checkpoint) {
    return false;
  }

  const wakeAt = checkpoint.nextWakeAt ?? null;
  const wakeMs = Date.parse(wakeAt ?? "");
  return !Number.isFinite(wakeMs) || wakeMs <= nowMs;
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
