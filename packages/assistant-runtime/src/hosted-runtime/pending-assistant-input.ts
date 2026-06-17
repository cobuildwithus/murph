import {
  readExistingHostedPendingAssistantInputIds,
} from "./pending-input-index.ts";

export async function resolveHostedPendingAssistantInputWakeAt(input: {
  now?: (() => string) | null;
  vaultRoot: string;
}): Promise<string | null> {
  const pendingInputIds = await readExistingHostedPendingAssistantInputIds({
    vaultRoot: input.vaultRoot,
  });

  return pendingInputIds.length > 0
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
