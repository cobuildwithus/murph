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
import type {
  HostedRuntimeEffectsPort,
} from "./platform.ts";
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
  effectsPort?: Pick<HostedRuntimeEffectsPort, "assertLinqRecentInboundEngagement"> | null;
  forwardedEnv: Readonly<Record<string, string>>;
  linqDeliveryContexts?: readonly HostedAssistantLinqDeliveryContext[] | null;
  platformEnv?: Readonly<Record<string, string>>;
  providerFetch?: typeof fetch | null;
  signal?: AbortSignal;
  userEnv: Readonly<Record<string, string>>;
}): AssistantChannelTypingDependencies {
  return {
    startLinqTyping: async (request) => {
      const deliveryContext = resolveHostedAssistantLinqDeliveryContextFromCandidatesForRequest({
        contexts: input.linqDeliveryContexts ?? [],
        replyToMessageId: null,
        target: request.target,
        targetKind: "thread",
      });
      if (!deliveryContext || !input.providerFetch) {
        return undefined;
      }
      const assertRecentInbound = input.effectsPort?.assertLinqRecentInboundEngagement;
      if (!assertRecentInbound) {
        return undefined;
      }
      const currentInbound = deliveryContext.currentInbound ?? null;
      try {
        await assertRecentInbound({
          ...(currentInbound ? { currentInbound } : {}),
          directRecipientPhoneNumber: deliveryContext.directRecipientPhoneNumber,
          engagementKind: "requires_recent_inbound",
          fromPhoneNumber: deliveryContext.fromPhoneNumber,
          idempotencyKey: null,
          intentId: null,
          routeAuthority: deliveryContext.routeAuthority,
          target: deliveryContext.target ?? request.target,
          targetKind: "thread",
        }, {
          signal: input.signal ?? null,
        });
      } catch {
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
      return startLinqTypingIndicator({
        target: deliveryContext.target ?? request.target,
      }, dependencies);
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
