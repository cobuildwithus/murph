import {
  compactHostedPendingAssistantInputIds,
  compactExistingHostedPendingAssistantInputs,
} from "./pending-input-index.ts";

export async function resolveHostedPendingAssistantInputWakeAt(input: {
  now?: (() => string) | null;
  vaultRoot: string;
}): Promise<string | null> {
  const pending = await compactExistingHostedPendingAssistantInputs({
    vaultRoot: input.vaultRoot,
  });
  if (pending.inputIds.length > 0) {
    return resolveHostedPendingAssistantInputWakeNow(input.now);
  }
  if (pending.complete) {
    return null;
  }

  const backfilledInputIds = await compactHostedPendingAssistantInputIds({
    vaultRoot: input.vaultRoot,
  });

  return backfilledInputIds.length > 0
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
