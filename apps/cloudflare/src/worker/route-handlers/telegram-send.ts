import {
  sendHostedProviderTelegramMessage,
} from "@murphai/assistant-runtime/hosted-provider-effects";
import type {
  HostedRuntimeTelegramSendResponse,
} from "@murphai/assistant-runtime/hosted-runtime-worker-contracts";
import {
  emitHostedExecutionStructuredLog,
  readHostedExecutionSafeErrorName,
} from "@murphai/hosted-execution";
import {
  CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS,
  matchCloudflareHostedControlUserRoutePath,
} from "@murphai/cloudflare-hosted-control/routes";
import {
  parseCloudflareHostedControlTelegramUsageLimitNoticeAuthority,
  readCloudflareHostedControlTelegramUsageLimitNoticeAuthoritySecret,
  readCloudflareHostedControlTelegramUsageLimitNoticeProviderRequest,
  verifyCloudflareHostedControlTelegramUsageLimitNoticeAuthority,
  type CloudflareHostedControlTelegramUsageLimitNoticeAuthority,
} from "@murphai/cloudflare-hosted-control/client";

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
  parseJsonValue,
  requireJsonRecord,
} from "../route-utils/json-body.ts";
import {
  decodeRouteParam,
} from "../route-utils/route-params.ts";

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

export async function handleTelegramUsageLimitNoticeRoute(
  context: WorkerRouteContext,
  encodedUserId: string,
): Promise<Response> {
  const userId = decodeRouteParam(encodedUserId);
  let authority: CloudflareHostedControlTelegramUsageLimitNoticeAuthority;
  try {
    authority = parseTelegramUsageLimitNoticeRequest(
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
  const authoritySecret =
    readCloudflareHostedControlTelegramUsageLimitNoticeAuthoritySecret(workerEnv);
  if (!authoritySecret) {
    emitHostedExecutionStructuredLog({
      component: "worker",
      details: buildWorkerRouteLogDetails({
        reason: "telegram-usage-limit-notice-authority-secret-missing",
        routeName: "telegram-usage-limit-notice",
      }, context.request, userId),
      level: "warn",
      message: "Hosted worker Telegram usage-limit notice route cannot verify authority because signing is unavailable.",
      phase: "failed",
      userId,
    });
    return json({
      code: "authority_unavailable",
      error: "Telegram usage-limit notice authority verification is unavailable.",
    }, 503);
  }

  let authorityVerified = false;
  try {
    authorityVerified =
      await verifyCloudflareHostedControlTelegramUsageLimitNoticeAuthority({
        authority,
        expectedUserId: userId,
        secret: authoritySecret,
      });
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "worker",
      details: buildWorkerRouteLogDetails({
        reason: "telegram-usage-limit-notice-authority-verification-failed",
        routeName: "telegram-usage-limit-notice",
      }, context.request, userId),
      error,
      level: "warn",
      message: "Hosted worker Telegram usage-limit notice route could not verify authority.",
      phase: "failed",
      userId,
    });
    return json({
      code: "authority_unavailable",
      error: "Telegram usage-limit notice authority verification failed.",
    }, 503);
  }

  if (!authorityVerified) {
    emitHostedExecutionStructuredLog({
      component: "worker",
      details: buildWorkerRouteLogDetails({
        reason: "telegram-usage-limit-notice-authority-invalid",
        routeName: "telegram-usage-limit-notice",
      }, context.request, userId),
      level: "warn",
      message: "Hosted worker Telegram usage-limit notice route rejected invalid authority.",
      phase: "failed",
      userId,
    });
    return json({
      code: "authority_invalid",
      error: "Telegram usage-limit notice authority is invalid.",
    }, 401);
  }

  try {
    const request =
      readCloudflareHostedControlTelegramUsageLimitNoticeProviderRequest(authority);
    const delivery = await sendHostedProviderTelegramMessage(request, {
      env: workerEnv as NodeJS.ProcessEnv,
      fetchImplementation: normalizeCloudflareWorkerFetch(),
      signal: context.request.signal,
      telegramMaxDeliveryAttempts: 1,
    });
    return json(readTelegramUsageLimitNoticeSuccessResponse(delivery));
  } catch (error) {
    const retryAfterSeconds = readTelegramProviderRetryAfterSeconds(error);
    const retryable = readTelegramProviderFailureRetryable(error);
    emitHostedExecutionStructuredLog({
      component: "worker",
      details: {
        ...buildWorkerRouteLogDetails({
          reason: "telegram-usage-limit-notice-provider-failed",
          routeName: "telegram-usage-limit-notice",
        }, context.request, userId),
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
      failureCode: readTelegramProviderFailureCode(error),
      failureReason: readTelegramProviderFailureReason(error),
      ...(retryAfterSeconds === null ? {} : { retryAfterSeconds }),
      retryable,
      status: "failed",
    });
  }
}

function parseTelegramUsageLimitNoticeRequest(
  value: unknown,
): CloudflareHostedControlTelegramUsageLimitNoticeAuthority {
  const record = requireJsonRecord(value, "Telegram usage-limit notice request");
  const authority = record.authority;
  if (!authority || typeof authority !== "object" || Array.isArray(authority)) {
    throw new TypeError("Telegram usage-limit notice request authority must be an object.");
  }
  return parseCloudflareHostedControlTelegramUsageLimitNoticeAuthority(authority);
}

function readTelegramUsageLimitNoticeSuccessResponse(
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
