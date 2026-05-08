import type {
  AssistantChannelTypingDependencies,
} from "@murphai/assistant-engine";
import {
  startAssistantChannelActivitySession,
  startLinqTypingIndicator,
  startTelegramTypingIndicator,
} from "@murphai/assistant-engine/assistant-channel-adapters";
import type {
  AssistantChannelActivityHandle,
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
const HOSTED_WHATSAPP_CHANNEL_ENV_KEYS = [
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_API_BASE_URL",
  "WHATSAPP_GRAPH_VERSION",
  "WHATSAPP_PHONE_NUMBER_ID",
] as const;
const HOSTED_CHANNEL_TYPING_REFRESH_MS = 4_000;
const HOSTED_CHANNEL_TYPING_EFFECT_TIMEOUT_MS = 750;

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

export function buildHostedWhatsAppChannelEnv(input: {
  forwardedEnv: Readonly<Record<string, string>>;
  platformEnv?: Readonly<Record<string, string>>;
}): Record<string, string> {
  const source = {
    ...input.forwardedEnv,
    ...(input.platformEnv ?? {}),
  };
  return pickHostedChannelEnv(source, HOSTED_WHATSAPP_CHANNEL_ENV_KEYS);
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
        return startHostedLinqEffectsPortTypingSession({
          sendLinqChatAction,
          signal: input.signal,
          target: request.target,
        });
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
      const sendTelegramChatAction = input.effectsPort?.sendTelegramChatAction;
      if (sendTelegramChatAction) {
        return startAssistantChannelActivitySession({
          refreshMs: HOSTED_CHANNEL_TYPING_REFRESH_MS,
          signal: input.signal,
          start: () => sendTelegramChatAction({
            action: "typing",
            target: request.target,
          }),
        });
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

function startHostedLinqEffectsPortTypingSession(input: {
  sendLinqChatAction: NonNullable<HostedRuntimeEffectsPort["sendLinqChatAction"]>;
  signal?: AbortSignal;
  target: string;
}): AssistantChannelActivityHandle {
  let activeHandle: AssistantChannelActivityHandle | null = null;
  let loggedBestEffortFailure = false;
  let stopRequested = false;
  const logBestEffortFailure = (error: unknown) => {
    if (loggedBestEffortFailure) {
      return;
    }
    loggedBestEffortFailure = true;
    logHostedLinqTypingBestEffortFailure(error);
  };
  const sessionReady = startAssistantChannelActivitySession({
    refreshMs: HOSTED_CHANNEL_TYPING_REFRESH_MS,
    signal: input.signal,
    start: () => withHostedLinqTypingEffectTimeout(
      input.sendLinqChatAction({
        action: "typing",
        target: input.target,
      }),
      logBestEffortFailure,
    ),
    stop: () => withHostedLinqTypingEffectTimeout(
      input.sendLinqChatAction({
        action: "typing_stop",
        target: input.target,
      }),
      logBestEffortFailure,
    ),
  }).then(async (handle) => {
    if (stopRequested) {
      await stopHostedLinqTypingBestEffort(handle);
      return null;
    }

    activeHandle = handle;
    return handle;
  }).catch((error: unknown) => {
    logBestEffortFailure(error);
    return null;
  });

  return {
    async stop() {
      stopRequested = true;
      if (activeHandle) {
        const handle = activeHandle;
        activeHandle = null;
        void stopHostedLinqTypingBestEffort(handle);
        return;
      }

      void sessionReady.then((handle) => {
        if (handle) {
          activeHandle = null;
          return stopHostedLinqTypingBestEffort(handle);
        }
        return undefined;
      });
    },
  };
}

async function stopHostedLinqTypingBestEffort(
  handle: AssistantChannelActivityHandle,
): Promise<void> {
  try {
    await handle.stop();
  } catch (error) {
    logHostedLinqTypingBestEffortFailure(error);
  }
}

function withHostedLinqTypingEffectTimeout(
  task: Promise<void>,
  logBestEffortFailure: (error: unknown) => void,
): Promise<void> {
  let settled = false;
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      logBestEffortFailure("timeout");
      resolve();
    }, HOSTED_CHANNEL_TYPING_EFFECT_TIMEOUT_MS);

    task.then(
      () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve();
      },
      (error: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        logBestEffortFailure(error);
        resolve();
      },
    );
  });
}

function logHostedLinqTypingBestEffortFailure(error: unknown): void {
  console.warn("Hosted Linq typing provider effect failed; continuing best-effort.", {
    errorName: error === "timeout" ? "Timeout" : error instanceof Error ? "Error" : "NonError",
  });
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
