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
  forwardedEnv: Readonly<Record<string, string>>;
  platformEnv?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
  userEnv: Readonly<Record<string, string>>;
}): AssistantChannelTypingDependencies {
  const linqEnv = buildHostedLinqChannelEnv({
    forwardedEnv: input.forwardedEnv,
    userEnv: input.userEnv,
  }) as NodeJS.ProcessEnv;
  const telegramEnv = buildHostedTelegramChannelEnv({
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

export async function markHostedConversationReadBestEffort(input: {
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

  const linqEnv = buildHostedLinqChannelEnv({
    forwardedEnv: input.forwardedEnv,
    userEnv: input.userEnv,
  });

  try {
    await markLinqChatRead(
      {
        chatId: linqMessage.chatId,
      },
      {
        env: linqEnv as NodeJS.ProcessEnv,
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
