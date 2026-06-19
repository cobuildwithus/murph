import {
  compactHostedPendingAssistantInputIds,
} from "./pending-input-index.ts";

export async function resolveHostedPendingAssistantInputWakeAt(input: {
  now?: (() => string) | null;
  vaultRoot: string;
}): Promise<string | null> {
  const inputIds = await compactHostedPendingAssistantInputIds({
    vaultRoot: input.vaultRoot,
  });

  return inputIds.length > 0
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
