import {
  sendHostedProviderTelegramMessage,
} from "@murphai/assistant-runtime/hosted-provider-effects";
import {
  emitHostedExecutionStructuredLog,
  readHostedExecutionSafeErrorName,
} from "@murphai/hosted-execution";
import {
  CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS,
  matchCloudflareHostedControlUserRoutePath,
} from "@murphai/cloudflare-hosted-control/routes";
import {
  parseCloudflareHostedControlTelegramUsageLimitNoticeRequest,
  type CloudflareHostedControlTelegramUsageLimitNoticeRequest,
} from "@murphai/cloudflare-hosted-control/client";

import {
  json,
} from "../../json.ts";
import {
  asWorkerStringEnvironment,
} from "../../worker-contracts.ts";
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
  parseJsonValue,
} from "../route-utils/json-body.ts";
import {
  decodeRouteParam,
} from "../route-utils/route-params.ts";
import {
  createUsageNoticeProviderEntryBoundary,
} from "../route-utils/usage-notice-provider-entry.ts";

export const telegramUsageLimitNoticeRoutes: readonly DeclarativeRoute<WorkerRouteContext>[] = [
  {
    authorizeBeforeMethod: true,
    authorization: "vercel-oidc",
    beforeMethod(context, params) {
      return requireBoundInternalRouteUser(context, params, "telegram-usage-limit-notice");
    },
    async handle(context, params) {
      return handleTelegramUsageLimitNoticeRoute(context, params.userId);
    },
    match: (pathname) =>
      matchCloudflareHostedControlUserRoutePath("telegramUsageLimitNotice", pathname),
    methods: [CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS.telegramUsageLimitNotice.method],
    name: "telegram-usage-limit-notice",
    wrongMethodResponse: "method-not-allowed",
  },
];

async function handleTelegramUsageLimitNoticeRoute(
  context: WorkerRouteContext,
  encodedUserId: string,
): Promise<Response> {
  const userId = decodeRouteParam(encodedUserId);
  let providerRequest: CloudflareHostedControlTelegramUsageLimitNoticeRequest;
  try {
    providerRequest = parseCloudflareHostedControlTelegramUsageLimitNoticeRequest(
      parseJsonValue(await readCachedRequestText(context, {
        limitBytes: INTERNAL_CONTROL_JSON_BODY_LIMIT_BYTES,
      })),
    );
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "worker",
      details: buildWorkerRouteLogDetails({
        reason: "telegram-usage-limit-notice-request-invalid",
        routeName: "telegram-usage-limit-notice",
      }, context.request, userId),
      error,
      level: "warn",
      message: "Hosted worker Telegram usage-limit notice route rejected an invalid request body.",
      phase: "failed",
      userId,
    });
    return json({
      code: "invalid_request",
      error: "Malformed Telegram usage-limit notice request.",
    }, 400);
  }

  const workerEnv = asWorkerStringEnvironment(context.env);
  const providerEntry = createUsageNoticeProviderEntryBoundary({
    attempt: providerRequest.providerDispatchAttempt,
    authority: {
      channel: "telegram",
      target: providerRequest.target,
    },
    context,
    userId,
  });
  try {
    await sendHostedProviderTelegramMessage(providerRequest, {
      env: workerEnv as NodeJS.ProcessEnv,
      fetchImplementation: providerEntry.fetchImplementation,
      signal: context.request.signal,
      telegramMaxDeliveryAttempts: 1,
    });
    return json({ status: "sent" });
  } catch (error) {
    const deliveryMayHaveSucceeded = readTelegramDeliveryMayHaveSucceeded(error);
    const retryable = readTelegramProviderFailureRetryable(error);
    const retryAfterSeconds = retryable
      ? readTelegramProviderRetryAfterSeconds(error)
      : null;
    emitHostedExecutionStructuredLog({
      component: "worker",
      details: {
        ...buildWorkerRouteLogDetails({
          reason: "telegram-usage-limit-notice-provider-failed",
          routeName: "telegram-usage-limit-notice",
        }, context.request, userId),
        deliveryMayHaveSucceeded,
        failureCode: readTelegramProviderFailureCode(error),
        retryable,
        ...(retryAfterSeconds === null ? {} : { retryAfterSeconds }),
      },
      error,
      level: "warn",
      message: "Hosted worker Telegram usage-limit notice route returned a provider failure.",
      phase: "failed",
      userId,
    });
    return json({
      deliveryMayHaveSucceeded,
      failureCode: readTelegramProviderFailureCode(error),
      ...(retryAfterSeconds === null ? {} : { retryAfterSeconds }),
      retryable,
      status: "failed",
    });
  }
}

function readTelegramDeliveryMayHaveSucceeded(error: unknown): boolean {
  return readRecord(error)?.deliveryMayHaveSucceeded === true;
}

function readTelegramProviderFailureCode(error: unknown): string {
  const record = readRecord(error);
  const code = normalizeErrorString(record?.code);
  return code ?? readHostedExecutionSafeErrorName(error) ?? "HostedTelegramSendError";
}

function readTelegramProviderFailureRetryable(error: unknown): boolean {
  const record = readRecord(error);
  if (record?.deliveryMayHaveSucceeded === true) {
    return false;
  }

  const context = readRecord(record?.context);
  if (record?.retryable === true || context?.retryable === true) {
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
  return status === 429;
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
