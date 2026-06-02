import {
  hasPendingAssistantAutoReplyInput,
} from "@murphai/assistant-engine/assistant-automation";
import {
  readAssistantAutomationState,
} from "@murphai/assistant-engine/assistant-store";

import {
  createHostedAssistantInputSource,
} from "./turn-input.ts";

export async function resolveHostedPendingAssistantInputWakeAt(input: {
  now?: (() => string) | null;
  signal?: AbortSignal | null;
  vaultRoot: string;
}): Promise<string | null> {
  const automationState = await readAssistantAutomationState(input.vaultRoot);
  const hasPendingInput = await hasPendingAssistantAutoReplyInput({
    inputSource: createHostedAssistantInputSource({
      vaultRoot: input.vaultRoot,
    }),
    signal: input.signal ?? undefined,
    state: automationState,
    vault: input.vaultRoot,
  });

  return hasPendingInput ? resolveHostedPendingAssistantInputWakeNow(input.now) : null;
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
