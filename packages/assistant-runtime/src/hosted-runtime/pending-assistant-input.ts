import {
  readAssistantInputEvent,
} from "@murphai/assistant-engine";

import {
  hasHostedPendingAssistantInputWakeCandidate,
  inspectHostedPendingAssistantInputWakeCandidate,
  readExistingHostedPendingAssistantInputIds,
} from "./pending-input-index.ts";

const HOSTED_PENDING_ASSISTANT_INPUT_INDEX_MAINTENANCE_DELAY_MS = 30_000;

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

  const event = await readAssistantInputEvent({
    inputId: firstInputId,
    vault: input.vaultRoot,
  });
  const occurredAt = event?.occurredAt ?? null;
  return occurredAt && Number.isFinite(Date.parse(occurredAt))
    ? occurredAt
    : null;
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
