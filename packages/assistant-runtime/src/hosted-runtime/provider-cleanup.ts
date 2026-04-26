import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import type {
  HostedExecutionRunnerResult,
  HostedRuntimeEvent,
} from "@murphai/hosted-execution/contracts";
import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import {
  parseHostedExecutionRunnerResult,
} from "@murphai/hosted-execution/parsers";
import {
  resolveAssistantStatePaths,
  writeJsonFileAtomic,
} from "@murphai/runtime-state/node";

import type {
  HostedAssistantDeliveryOutcome,
} from "./models.ts";
import { deleteHostedLinqMessages } from "./message-cleanup.ts";

const HOSTED_PROVIDER_CLEANUP_SCHEMA = "murph.hosted-provider-cleanup.v1";
const HOSTED_PROVIDER_CLEANUP_FILE_NAME = "hosted-provider-cleanup.json";
const HOSTED_PROVIDER_CLEANUP_RETRY_DELAY_MS = 5 * 60_000;

interface HostedProviderCleanupState {
  linqMessageIds: string[];
  preparedResult: HostedExecutionRunnerResult["result"] | null;
  schema: typeof HOSTED_PROVIDER_CLEANUP_SCHEMA;
}

export interface HostedProviderCleanupDrainResult {
  attemptedLinqMessageCount: number;
  deletedLinqMessageCount: number;
  failedLinqMessageCount: number;
  nextWakeAt: string | null;
}

export async function recordHostedProviderCleanupBeforeCommit(input: {
  linqMessageIds?: readonly string[] | null;
  preparedResult: HostedExecutionRunnerResult["result"];
  vaultRoot: string;
}): Promise<void> {
  const existing = await readHostedProviderCleanupState(input.vaultRoot);
  await writeHostedProviderCleanupState(input.vaultRoot, {
    schema: HOSTED_PROVIDER_CLEANUP_SCHEMA,
    preparedResult: input.preparedResult,
    linqMessageIds: normalizeHostedProviderMessageIds([
      ...(existing?.linqMessageIds ?? []),
      ...(input.linqMessageIds ?? []),
    ]),
  });
}

export async function readHostedProviderCleanupPreparedResult(
  vaultRoot: string,
): Promise<HostedExecutionRunnerResult["result"] | null> {
  return (await readHostedProviderCleanupState(vaultRoot))?.preparedResult ?? null;
}

export async function drainHostedProviderCleanupAfterCommit(input: {
  assistantDeliveryOutcomes: readonly HostedAssistantDeliveryOutcome[];
  env: NodeJS.ProcessEnv;
  preparedResult: HostedExecutionRunnerResult["result"];
  vaultRoot: string;
  wake: HostedRuntimeEvent;
}): Promise<HostedProviderCleanupDrainResult> {
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
    await deleteHostedLinqMessages({
      env: input.env,
      messageIds,
    });
  } catch (error) {
    await writeHostedProviderCleanupState(input.vaultRoot, {
      schema: HOSTED_PROVIDER_CLEANUP_SCHEMA,
      preparedResult: existing?.preparedResult ?? input.preparedResult,
      linqMessageIds: messageIds,
    });
    const nextWakeAt = new Date(Date.now() + HOSTED_PROVIDER_CLEANUP_RETRY_DELAY_MS).toISOString();
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
      phase: "side-effects.draining",
      run: null,
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

  return parseHostedProviderCleanupState(JSON.parse(raw));
}

async function writeHostedProviderCleanupState(
  vaultRoot: string,
  state: HostedProviderCleanupState,
): Promise<void> {
  const filePath = resolveHostedProviderCleanupStatePath(vaultRoot);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeJsonFileAtomic(filePath, {
    schema: HOSTED_PROVIDER_CLEANUP_SCHEMA,
    preparedResult: state.preparedResult,
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
    linqMessageIds?: unknown;
    preparedResult?: unknown;
    schema?: unknown;
  };
  if (record.schema !== HOSTED_PROVIDER_CLEANUP_SCHEMA) {
    return null;
  }

  return {
    schema: HOSTED_PROVIDER_CLEANUP_SCHEMA,
    preparedResult: record.preparedResult === undefined || record.preparedResult === null
      ? null
      : parseHostedExecutionRunnerResult({
          bundle: null,
          result: record.preparedResult,
        }).result,
    linqMessageIds: Array.isArray(record.linqMessageIds)
      ? normalizeHostedProviderMessageIds(record.linqMessageIds.filter((messageId) =>
          typeof messageId === "string"
        ))
      : [],
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
