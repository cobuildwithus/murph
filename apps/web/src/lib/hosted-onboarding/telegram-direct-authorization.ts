import type {
  CloudflareHostedControlClient,
} from "@murphai/cloudflare-hosted-control/client";
import {
  normalizeTelegramBotId,
  serializeTelegramThreadTarget,
} from "@murphai/messaging-ingress/telegram-webhook";

import { readHostedExecutionControlClientIfConfigured } from "../hosted-execution/control";

const TELEGRAM_AUTHORIZATION_TIMEOUT_MS = 10_000;
export const HOSTED_TELEGRAM_BOT_BOUND_TARGET_PRODUCER_ENABLED_ENV =
  "HOSTED_TELEGRAM_BOT_BOUND_TARGET_PRODUCER_ENABLED";

type HostedTelegramAuthorizationEnv = Readonly<Record<string, string | undefined>>;

type HostedTelegramAuthorizationControlClient = Pick<
  CloudflareHostedControlClient,
  "authorizeTelegramDirectMessage"
>;

export interface HostedTelegramDirectAuthorization {
  telegramThreadId: string;
  telegramUserId: string;
}

export async function verifyHostedTelegramDirectAuthorization(
  input: {
    authorizationUserId: string;
    telegramUserId: string;
  },
  dependencies: {
    controlClient?: HostedTelegramAuthorizationControlClient | null;
    env?: HostedTelegramAuthorizationEnv;
  } = {},
): Promise<HostedTelegramDirectAuthorization | null | undefined> {
  if (!hostedTelegramBotBoundTargetProducerEnabled(dependencies.env ?? process.env)) {
    return undefined;
  }

  const authorizationUserId = normalizeString(input.authorizationUserId);
  const telegramUserId = normalizeTelegramBotId(input.telegramUserId);
  if (!authorizationUserId || !telegramUserId) {
    return null;
  }

  const controlClient = dependencies.controlClient === undefined
    ? readHostedExecutionControlClientIfConfigured(TELEGRAM_AUTHORIZATION_TIMEOUT_MS)
    : dependencies.controlClient;
  if (!controlClient) {
    return null;
  }

  try {
    const response = await controlClient.authorizeTelegramDirectMessage({
      request: { telegramUserId },
      userId: authorizationUserId,
    });
    if (response.status !== "authorized") {
      return null;
    }
    const botId = normalizeTelegramBotId(response.botId);
    if (!botId) {
      return null;
    }

    return {
      telegramThreadId: serializeTelegramThreadTarget({
        botId,
        chatId: telegramUserId,
      }),
      telegramUserId,
    };
  } catch {
    return null;
  }
}

export function hostedTelegramBotBoundTargetProducerEnabled(
  env: HostedTelegramAuthorizationEnv,
): boolean {
  return env[HOSTED_TELEGRAM_BOT_BOUND_TARGET_PRODUCER_ENABLED_ENV]?.trim() === "1";
}

function normalizeString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
