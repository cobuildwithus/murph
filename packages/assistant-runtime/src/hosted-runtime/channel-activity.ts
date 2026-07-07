import type {
  AssistantChannelTypingDependencies,
} from "@murphai/assistant-engine";
import {
  startLinqTypingIndicator,
  startTelegramTypingIndicator,
} from "@murphai/assistant-engine/assistant-channel-adapters";
import {
  HOSTED_ELEVENLABS_ENV_NAMES,
} from "@murphai/hosted-execution/assistant-capabilities";

import {
  requireHostedProviderFetchDependencies,
} from "./provider-fetch.ts";
import {
  resolveHostedAssistantLinqDeliveryContextFromCandidatesForRequest,
  type HostedAssistantLinqDeliveryContext,
} from "./linq-delivery-context.ts";

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

const HOSTED_LINQ_TYPING_MAX_SESSION_MS = 5 * 60_000;
const HOSTED_LINQ_TYPING_REFRESH_MS = 45_000;
const HOSTED_LINQ_TYPING_RESTART_COOLDOWN_MS = 10 * 60_000;

type HostedLinqTypingTargetState = {
  activeUntilMs: number;
  cooldownUntilMs: number;
};

const hostedLinqTypingTargets = new Map<string, HostedLinqTypingTargetState>();

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

export function buildHostedTelegramVoiceMemoChannelEnv(input: {
  forwardedEnv: Readonly<Record<string, string>>;
  platformEnv?: Readonly<Record<string, string>>;
}): Record<string, string> {
  const source = {
    ...input.forwardedEnv,
    ...(input.platformEnv ?? {}),
  };
  return {
    ...pickHostedChannelEnv(source, HOSTED_TELEGRAM_CHANNEL_ENV_KEYS),
    ...pickHostedChannelEnv(source, HOSTED_ELEVENLABS_ENV_NAMES),
  };
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
  forwardedEnv: Readonly<Record<string, string>>;
  linqDeliveryContexts?: readonly HostedAssistantLinqDeliveryContext[] | null;
  platformEnv?: Readonly<Record<string, string>>;
  providerFetch?: typeof fetch | null;
  signal?: AbortSignal;
  userEnv: Readonly<Record<string, string>>;
}): AssistantChannelTypingDependencies {
  return {
    startLinqTyping: async (request) => {
      const linqDeliveryContexts = input.linqDeliveryContexts ?? [];
      const deliveryContext = resolveHostedAssistantLinqDeliveryContextFromCandidatesForRequest({
        contexts: linqDeliveryContexts,
        replyToMessageId: null,
        target: request.target,
        targetKind: "thread",
      });
      if (!deliveryContext && linqDeliveryContexts.length > 0) {
        return undefined;
      }
      if (!input.providerFetch) {
        return undefined;
      }
      const target = deliveryContext?.target ?? request.target;
      const typingTarget = claimHostedLinqTypingTarget(target);
      if (!typingTarget) {
        return undefined;
      }

      const dependencies = requireHostedProviderFetchDependencies({
        env: buildHostedLinqChannelEnv({
          forwardedEnv: input.forwardedEnv,
          userEnv: input.userEnv,
        }) as NodeJS.ProcessEnv,
        fetchImplementation: input.providerFetch,
        signal: input.signal,
      }, "Hosted Linq typing indicator");
      try {
        const handle = await startLinqTypingIndicator({
          target,
        }, {
          ...dependencies,
          maxSessionMs: HOSTED_LINQ_TYPING_MAX_SESSION_MS,
          refreshMs: HOSTED_LINQ_TYPING_REFRESH_MS,
        });
        if (!handle) {
          releaseHostedLinqTypingTarget(typingTarget, {
            completedMaxSession: false,
          });
          return undefined;
        }
        return wrapHostedLinqTypingHandle({
          handle,
          target: typingTarget,
        });
      } catch (error) {
        releaseHostedLinqTypingTarget(typingTarget, {
          completedMaxSession: false,
        });
        throw error;
      }
    },
    startTelegramTyping: async (request) => {
      const dependencies = requireHostedProviderFetchDependencies({
        env: buildHostedTelegramChannelEnv({
          forwardedEnv: input.forwardedEnv,
          platformEnv: input.platformEnv,
        }) as NodeJS.ProcessEnv,
        fetchImplementation: input.providerFetch,
        signal: input.signal,
      }, "Hosted Telegram typing indicator");
      return startTelegramTypingIndicator(request, dependencies);
    },
  };
}

function claimHostedLinqTypingTarget(target: string): string | null {
  const normalized = target.trim();
  if (!normalized) {
    return null;
  }

  const now = Date.now();
  for (const [key, state] of hostedLinqTypingTargets) {
    if (state.activeUntilMs <= now && state.cooldownUntilMs <= now) {
      hostedLinqTypingTargets.delete(key);
    }
  }

  const existing = hostedLinqTypingTargets.get(normalized);
  if (existing && (existing.activeUntilMs > now || existing.cooldownUntilMs > now)) {
    return null;
  }

  hostedLinqTypingTargets.set(normalized, {
    activeUntilMs: now + HOSTED_LINQ_TYPING_MAX_SESSION_MS,
    cooldownUntilMs: now + HOSTED_LINQ_TYPING_MAX_SESSION_MS
      + HOSTED_LINQ_TYPING_RESTART_COOLDOWN_MS,
  });
  return normalized;
}

function wrapHostedLinqTypingHandle(input: {
  handle: NonNullable<Awaited<ReturnType<typeof startLinqTypingIndicator>>>;
  target: string;
}): NonNullable<Awaited<ReturnType<typeof startLinqTypingIndicator>>> {
  return {
    ...input.handle,
    stop: async (options) => {
      const state = hostedLinqTypingTargets.get(input.target);
      const completedMaxSession = Boolean(state && Date.now() >= state.activeUntilMs);
      try {
        await input.handle.stop(options);
      } finally {
        releaseHostedLinqTypingTarget(input.target, {
          completedMaxSession,
        });
      }
    },
  };
}

function releaseHostedLinqTypingTarget(input: string, options: {
  completedMaxSession: boolean;
}): void {
  if (!options.completedMaxSession) {
    hostedLinqTypingTargets.delete(input);
    return;
  }

  hostedLinqTypingTargets.set(input, {
    activeUntilMs: Date.now(),
    cooldownUntilMs: Date.now() + HOSTED_LINQ_TYPING_RESTART_COOLDOWN_MS,
  });
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
