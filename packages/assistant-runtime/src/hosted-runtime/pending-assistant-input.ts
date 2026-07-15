import {
  hasHostedPendingAssistantInputWakeCandidate,
  inspectHostedPendingAssistantInputWakeCandidate,
} from "./pending-input-index.ts";

const HOSTED_PENDING_ASSISTANT_INPUT_INDEX_MAINTENANCE_DELAY_MS = 30_000;

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
