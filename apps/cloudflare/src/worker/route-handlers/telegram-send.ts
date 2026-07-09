import {
  sendHostedProviderTelegramMessage,
} from "@murphai/assistant-runtime/hosted-provider-effects";
import type {
  HostedRuntimeTelegramSendRequest,
  HostedRuntimeTelegramSendResponse,
} from "@murphai/assistant-runtime/hosted-runtime/platform";
import {
  emitHostedExecutionStructuredLog,
  readHostedExecutionSafeErrorName,
} from "@murphai/hosted-execution";
import {
  CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS,
  matchCloudflareHostedControlUserRoutePath,
} from "@murphai/cloudflare-hosted-control/routes";

import {
  json,
} from "../../json.ts";
import {
  asWorkerStringEnvironment,
} from "../../worker-contracts.ts";
import {
  normalizeCloudflareWorkerFetch,
} from "../../worker-fetch.ts";
import {
  readCachedRequestText,
  type WorkerRouteContext,
} from "../../worker-routes/shared.ts";
import {
  requireBoundInternalRouteUser,
} from "../auth.ts";
import type {
  DeclarativeRoute,
} from "../routes.ts";
import {
  buildWorkerRouteLogDetails,
} from "../route-utils/log-details.ts";
import {
  INTERNAL_CONTROL_JSON_BODY_LIMIT_BYTES,
  normalizeNonEmptyString,
  parseJsonValue,
  requireJsonRecord,
} from "../route-utils/json-body.ts";
import {
  decodeRouteParam,
} from "../route-utils/route-params.ts";

export const telegramSendRoutes: readonly DeclarativeRoute<WorkerRouteContext>[] = [
  {
    authorizeBeforeMethod: true,
    authorization: "vercel-oidc",
    beforeMethod(context, params) {
      return requireBoundInternalRouteUser(context, params, "telegram-send");
    },
    async handle(context, params) {
      return handleTelegramSendRoute(context, params.userId);
    },
    match: (pathname) => matchCloudflareHostedControlUserRoutePath("telegramSend", pathname),
    methods: [CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS.telegramSend.method],
    name: "telegram-send",
    wrongMethodResponse: "method-not-allowed",
  },
];

export async function handleTelegramSendRoute(
  context: WorkerRouteContext,
  encodedUserId: string,
): Promise<Response> {
  const userId = decodeRouteParam(encodedUserId);
  let request: HostedRuntimeTelegramSendRequest;
  try {
    request = parseTelegramSendRequest(
      parseJsonValue(await readCachedRequestText(context, {
        limitBytes: INTERNAL_CONTROL_JSON_BODY_LIMIT_BYTES,
      })),
    );
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "worker",
      details: buildWorkerRouteLogDetails({
        reason: "telegram-send-request-invalid",
        routeName: "telegram-send",
      }, context.request, userId),
      error,
      level: "warn",
      message: "Hosted worker Telegram send route rejected an invalid request body.",
      phase: "failed",
      userId,
    });
    return json({
      code: "invalid_request",
      error: "Malformed Telegram send request.",
    }, 400);
  }

  try {
    const delivery = await sendHostedProviderTelegramMessage(request, {
      env: asWorkerStringEnvironment(context.env) as NodeJS.ProcessEnv,
      fetchImplementation: normalizeCloudflareWorkerFetch(),
      signal: context.request.signal,
    });
    return json(readTelegramSendSuccessResponse(delivery));
  } catch (error) {
    const retryAfterSeconds = readTelegramProviderRetryAfterSeconds(error);
    const retryable = readTelegramProviderFailureRetryable(error);
    emitHostedExecutionStructuredLog({
      component: "worker",
      details: {
        ...buildWorkerRouteLogDetails({
          reason: "telegram-send-provider-failed",
          routeName: "telegram-send",
        }, context.request, userId),
        failureCode: readTelegramProviderFailureCode(error),
        retryable,
        ...(retryAfterSeconds === null ? {} : { retryAfterSeconds }),
      },
      error,
      level: "warn",
      message: "Hosted worker Telegram send route returned a provider failure.",
      phase: "failed",
      userId,
    });
    return json({
      failureCode: readTelegramProviderFailureCode(error),
      failureReason: readTelegramProviderFailureReason(error),
      ...(retryAfterSeconds === null ? {} : { retryAfterSeconds }),
      retryable,
      status: "failed",
    });
  }
}

function parseTelegramSendRequest(value: unknown): HostedRuntimeTelegramSendRequest {
  const record = requireJsonRecord(value, "Telegram send request");
  const message = normalizeNonEmptyString(record.message);
  const target = normalizeNonEmptyString(record.target);

  if (!message) {
    throw new TypeError("Telegram send request message must be a non-empty string.");
  }
  if (!target) {
    throw new TypeError("Telegram send request target must be a non-empty string.");
  }

  return {
    ...readOptionalStringProperty(record, "idempotencyKey"),
    message,
    ...readOptionalStringProperty(record, "replyToMessageId"),
    target,
  };
}

function readOptionalStringProperty<Key extends "idempotencyKey" | "replyToMessageId">(
  record: Record<string, unknown>,
  key: Key,
): { [K in Key]?: string | null } {
  if (record[key] === undefined || record[key] === null) {
    return {};
  }
  const value = normalizeNonEmptyString(record[key]);
  return value ? { [key]: value } as { [K in Key]?: string | null } : {};
}

function readTelegramSendSuccessResponse(
  delivery: HostedRuntimeTelegramSendResponse,
): HostedRuntimeTelegramSendResponse & { status: "sent" } {
  return {
    ...delivery,
    status: "sent",
  };
}

function readTelegramProviderFailureCode(error: unknown): string {
  const record = readRecord(error);
  const code = normalizeErrorString(record?.code);
  return code ?? readHostedExecutionSafeErrorName(error) ?? "HostedTelegramSendError";
}

function readTelegramProviderFailureReason(error: unknown): string {
  const record = readRecord(error);
  const message = normalizeErrorString(record?.message);
  return message
    ? message.slice(0, 500)
    : "Hosted Telegram send failed.";
}

function readTelegramProviderFailureRetryable(error: unknown): boolean {
  const record = readRecord(error);
  if (record?.deliveryMayHaveSucceeded === true) {
    return false;
  }

  const context = readRecord(record?.context);
  if (
    record?.retryable === true
    || context?.retryable === true
    || context?.assistantDeliveryFailureClass === "transient"
  ) {
    return true;
  }

  const code = normalizeErrorString(record?.code);
  if (
    code === "ASSISTANT_TELEGRAM_TOKEN_REQUIRED"
    || code === "ASSISTANT_TELEGRAM_UNAVAILABLE"
  ) {
    return true;
  }

  const status = readHttpStatus(context?.status) ?? readHttpStatus(record?.status);
  return status === 429 || (status !== null && status >= 500);
}

function readTelegramProviderRetryAfterSeconds(error: unknown): number | null {
  const record = readRecord(error);
  const context = readRecord(record?.context);
  const value = context?.retryAfterSeconds ?? record?.retryAfterSeconds;
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeErrorString(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
}

function readHttpStatus(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 100 && value <= 599
    ? value
    : null;
}
