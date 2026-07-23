import {
  readAssistantInputEvent,
} from "@murphai/assistant-engine";

import {
  hasHostedPendingAssistantInputWakeCandidate,
  inspectHostedPendingAssistantInputWakeCandidate,
  readExistingHostedPendingAssistantInputIds,
} from "./pending-input-index.ts";

const HOSTED_PENDING_ASSISTANT_INPUT_INDEX_MAINTENANCE_DELAY_MS = 30_000;

export async function resolveHostedOldestAssistantInputOccurredAt(input: {
  assistantInputIds: readonly string[];
  signal?: AbortSignal | null;
  vaultRoot: string;
}): Promise<string | null> {
  let oldestOccurredAt: string | null = null;
  let oldestOccurredAtMs = Number.POSITIVE_INFINITY;
  for (const inputId of input.assistantInputIds) {
    input.signal?.throwIfAborted();
    const event = await readAssistantInputEvent({
      inputId,
      vault: input.vaultRoot,
    });
    input.signal?.throwIfAborted();
    const occurredAt = event?.occurredAt ?? null;
    const occurredAtMs = Date.parse(occurredAt ?? "");
    if (!Number.isFinite(occurredAtMs)) {
      return null;
    }
    if (occurredAtMs < oldestOccurredAtMs) {
      oldestOccurredAt = occurredAt;
      oldestOccurredAtMs = occurredAtMs;
    }
  }
  return oldestOccurredAt;
}

export async function resolveHostedOldestPendingAssistantInputAt(input: {
  signal?: AbortSignal | null;
  vaultRoot: string;
}): Promise<string | null> {
  const inspection = await inspectHostedPendingAssistantInputWakeCandidate({
    vaultRoot: input.vaultRoot,
  });
  if (!inspection.indexComplete) {
    return null;
  }

  input.signal?.throwIfAborted();
  const inputIds = await readExistingHostedPendingAssistantInputIds({
    vaultRoot: input.vaultRoot,
  });
  const firstInputId = inputIds[0] ?? null;
  if (!firstInputId) {
    return null;
  }

  return await resolveHostedOldestAssistantInputOccurredAt({
    assistantInputIds: [firstInputId],
    signal: input.signal ?? null,
    vaultRoot: input.vaultRoot,
  });
}

export async function resolveHostedPendingAssistantInputWakeAt(input: {
  inspectOnly?: boolean;
  now?: (() => string) | null;
  vaultRoot: string;
}): Promise<string | null> {
  if (input.inspectOnly) {
    const inspection = await inspectHostedPendingAssistantInputWakeCandidate({
      vaultRoot: input.vaultRoot,
    });
    if (!inspection.hasCandidate && inspection.indexComplete) {
      return null;
    }

    const wakeAt = resolveHostedPendingAssistantInputWakeNow(input.now);
    return inspection.indexComplete
      ? wakeAt
      : new Date(
          Date.parse(wakeAt)
            + HOSTED_PENDING_ASSISTANT_INPUT_INDEX_MAINTENANCE_DELAY_MS,
        ).toISOString();
  }

  const hasCandidate = await hasHostedPendingAssistantInputWakeCandidate({
    vaultRoot: input.vaultRoot,
  });

  return hasCandidate
    ? resolveHostedPendingAssistantInputWakeNow(input.now)
    : null;
}

export function resolveHostedPendingAssistantInputWakeNow(
  now: (() => string) | null | undefined,
): string {
  const fallback = new Date().toISOString();
  if (!now) {
    return fallback;
  }

  const value = now();
  return Number.isFinite(Date.parse(value)) ? value : fallback;
}
