import type {
  AssistantChannelTypingDependencies,
} from "@murphai/assistant-engine";
import {
  startLinqTypingIndicator,
  startTelegramTypingIndicator,
} from "@murphai/assistant-engine/assistant-channel-adapters";
import type {
  HostedExecutionConversationMessageWake,
} from "@murphai/hosted-execution";
import {
  isHostedLinqConversationMessageWake,
} from "@murphai/hosted-execution";
import {
  markLinqChatRead,
} from "@murphai/operator-config/linq-runtime";
import type {
  HostedRuntimeEffectsPort,
} from "./platform.ts";

const HOSTED_TELEGRAM_CHANNEL_ENV_KEYS = [
  "TELEGRAM_API_BASE_URL",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_FILE_BASE_URL",
] as const;

export function buildHostedLinqChannelEnv(input: {
  forwardedEnv: Readonly<Record<string, string>>;
  userEnv: Readonly<Record<string, string>>;
}): Record<string, string> {
  const env: Record<string, string> = {};

  const userToken = readHostedChannelEnvValue(input.userEnv, "LINQ_API_TOKEN");
  if (userToken) {
    const userBaseUrl = readHostedChannelEnvValue(input.userEnv, "LINQ_API_BASE_URL");
    const forwardedBaseUrl = readHostedChannelEnvValue(input.forwardedEnv, "LINQ_API_BASE_URL");
    const baseUrl = userBaseUrl ?? forwardedBaseUrl;
    if (baseUrl) {
      env.LINQ_API_BASE_URL = baseUrl;
    }
    env.LINQ_API_TOKEN = userToken;
    return env;
  }

  const forwardedBaseUrl = readHostedChannelEnvValue(input.forwardedEnv, "LINQ_API_BASE_URL");
  const forwardedToken = readHostedChannelEnvValue(input.forwardedEnv, "LINQ_API_TOKEN");
  if (forwardedBaseUrl) {
    env.LINQ_API_BASE_URL = forwardedBaseUrl;
  }
  if (forwardedToken) {
    env.LINQ_API_TOKEN = forwardedToken;
  }
  return env;
}

export function buildHostedTelegramChannelEnv(input: {
  forwardedEnv: Readonly<Record<string, string>>;
  platformEnv?: Readonly<Record<string, string>>;
}): Record<string, string> {
  const source = {
    ...input.forwardedEnv,
    ...(input.platformEnv ?? {}),
  };
  return pickHostedChannelEnv(source, HOSTED_TELEGRAM_CHANNEL_ENV_KEYS);
}

export function createHostedAssistantChannelTypingDependencies(input: {
  effectsPort?: Pick<
    HostedRuntimeEffectsPort,
    "sendLinqChatAction" | "sendTelegramChatAction"
  > | null;
  forwardedEnv: Readonly<Record<string, string>>;
  platformEnv?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
  userEnv: Readonly<Record<string, string>>;
}): AssistantChannelTypingDependencies {
  return {
    startLinqTyping: async (request) => {
      const sendLinqChatAction = input.effectsPort?.sendLinqChatAction;
      if (sendLinqChatAction) {
        await sendLinqChatAction({
          action: "typing",
          target: request.target,
        });
        return {
          async stop() {
            await sendLinqChatAction({
              action: "typing_stop",
              target: request.target,
            });
          },
        };
      }

      return startLinqTypingIndicator(request, {
        env: buildHostedLinqChannelEnv({
          forwardedEnv: input.forwardedEnv,
          userEnv: input.userEnv,
        }) as NodeJS.ProcessEnv,
        signal: input.signal,
      });
    },
    startTelegramTyping: async (request) => {
      if (input.effectsPort?.sendTelegramChatAction) {
        await input.effectsPort.sendTelegramChatAction({
          action: "typing",
          target: request.target,
        });
        return;
      }

      return startTelegramTypingIndicator(request, {
        env: buildHostedTelegramChannelEnv({
          forwardedEnv: input.forwardedEnv,
          platformEnv: input.platformEnv,
        }) as NodeJS.ProcessEnv,
        signal: input.signal,
      });
    },
  };
}

export async function markHostedConversationReadBestEffort(input: {
  effectsPort?: Pick<HostedRuntimeEffectsPort, "markLinqRead"> | null;
  forwardedEnv: Readonly<Record<string, string>>;
  userEnv: Readonly<Record<string, string>>;
  wake: HostedExecutionConversationMessageWake;
  signal?: AbortSignal;
}): Promise<void> {
  if (!isHostedLinqConversationMessageWake(input.wake)) {
    return;
  }

  const linqMessage = input.wake.message.linqMessage;
  if (linqMessage.isFromMe) {
    return;
  }

  try {
    if (input.effectsPort?.markLinqRead) {
      await input.effectsPort.markLinqRead({
        chatId: linqMessage.chatId,
      });
      return;
    }

    await markLinqChatRead(
      {
        chatId: linqMessage.chatId,
      },
      {
        env: buildHostedLinqChannelEnv({
          forwardedEnv: input.forwardedEnv,
          userEnv: input.userEnv,
        }) as NodeJS.ProcessEnv,
        signal: input.signal,
      },
    );
  } catch {
    // Best-effort provider-visible acknowledgement; local import remains authoritative.
  }
}

function pickHostedChannelEnv(
  source: Readonly<Record<string, string>>,
  keys: readonly string[],
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of keys) {
    const value = readHostedChannelEnvValue(source, key);
    if (value) {
      env[key] = value;
    }
  }
  return env;
}

function readHostedChannelEnvValue(
  env: Readonly<Record<string, string>>,
  key: string,
): string | null {
  const value = env[key];
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
