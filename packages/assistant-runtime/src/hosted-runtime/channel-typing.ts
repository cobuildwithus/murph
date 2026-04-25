import type {
  AssistantChannelTypingDependencies,
} from "@murphai/assistant-engine";
import {
  startLinqTypingIndicator,
  startTelegramTypingIndicator,
} from "@murphai/assistant-engine/assistant-channel-adapters";

import { buildHostedPlatformBackedRuntimeEnv } from "./environment.ts";

export function createHostedAssistantChannelTypingDependencies(input: {
  forwardedEnv: Readonly<Record<string, string>>;
  platformEnv?: Readonly<Record<string, string>>;
  runtimeEnv: Readonly<Record<string, string>>;
  signal?: AbortSignal;
}): AssistantChannelTypingDependencies {
  const linqEnv = input.runtimeEnv as NodeJS.ProcessEnv;
  const telegramEnv = buildHostedPlatformBackedRuntimeEnv({
    forwardedEnv: input.forwardedEnv,
    platformEnv: input.platformEnv,
  }) as NodeJS.ProcessEnv;

  return {
    startLinqTyping: async (request) =>
      startLinqTypingIndicator(request, {
        env: linqEnv,
        signal: input.signal,
      }),
    startTelegramTyping: async (request) =>
      startTelegramTypingIndicator(request, {
        env: telegramEnv,
        signal: input.signal,
      }),
  };
}
