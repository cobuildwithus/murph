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

export type HostedTelegramDirectAuthorization =
  | {
      status: "authorized";
      telegramThreadId: string;
      telegramUserId: string;
    }
  | {
      status: "denied" | "not_attempted" | "unavailable";
    };

export async function verifyHostedTelegramDirectAuthorization(
  input: {
    authorizationUserId: string;
    telegramUserId: string;
  },
  dependencies: {
    controlClient?: HostedTelegramAuthorizationControlClient | null;
    env?: HostedTelegramAuthorizationEnv;
  } = {},
): Promise<HostedTelegramDirectAuthorization> {
  if (!hostedTelegramBotBoundTargetProducerEnabled(dependencies.env ?? process.env)) {
    return { status: "not_attempted" };
  }

  const authorizationUserId = normalizeString(input.authorizationUserId);
  const telegramUserId = normalizeTelegramBotId(input.telegramUserId);
  if (!authorizationUserId || !telegramUserId) {
    return { status: "unavailable" };
  }

  const controlClient = dependencies.controlClient === undefined
    ? readHostedExecutionControlClientIfConfigured(TELEGRAM_AUTHORIZATION_TIMEOUT_MS)
    : dependencies.controlClient;
  if (!controlClient) {
    return { status: "unavailable" };
  }

  try {
    const response = await controlClient.authorizeTelegramDirectMessage({
      request: { telegramUserId },
      userId: authorizationUserId,
    });
    if (response.status !== "authorized") {
      return { status: response.status };
    }
    const botId = normalizeTelegramBotId(response.botId);
    if (!botId) {
      return { status: "unavailable" };
    }

    return {
      status: "authorized",
      telegramThreadId: serializeTelegramThreadTarget({
        botId,
        chatId: telegramUserId,
      }),
      telegramUserId,
    };
  } catch {
    return { status: "unavailable" };
  }
}

export function resolveHostedTelegramDirectAuthorizationThreadId(
  authorization: HostedTelegramDirectAuthorization,
  expectedTelegramUserId: string,
): string | null | undefined {
  if (authorization.status === "denied") {
    return null;
  }
  if (authorization.status !== "authorized") {
    return undefined;
  }

  return authorization.telegramUserId === expectedTelegramUserId
    ? authorization.telegramThreadId
    : null;
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
