import {
  sendHostedProviderWhatsAppMessage,
} from "@murphai/assistant-runtime/hosted-provider-effects";
import {
  emitHostedExecutionStructuredLog,
  readHostedExecutionSafeErrorName,
  type HostedExecutionStructuredLogDetails,
} from "@murphai/hosted-execution";
import {
  parseCloudflareHostedControlConversationUsageNoticeRequest,
  type CloudflareHostedControlConversationUsageNoticeRequest,
} from "@murphai/cloudflare-hosted-control/client";
import {
  CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS,
  matchCloudflareHostedControlUserRoutePath,
} from "@murphai/cloudflare-hosted-control/routes";

import {
  readHostedEmailConfig,
  sendHostedEmailMessage,
} from "../../hosted-email.ts";
import { json } from "../../json.ts";
import { asWorkerStringEnvironment } from "../../worker-contracts.ts";
import { normalizeCloudflareWorkerFetch } from "../../worker-fetch.ts";
import {
  readCachedRequestText,
  type WorkerRouteContext,
} from "../../worker-routes/shared.ts";
import { requireBoundInternalRouteUser } from "../auth.ts";
import type { DeclarativeRoute } from "../routes.ts";
import { buildWorkerRouteLogDetails } from "../route-utils/log-details.ts";
import {
  INTERNAL_CONTROL_JSON_BODY_LIMIT_BYTES,
  parseJsonValue,
} from "../route-utils/json-body.ts";
import { decodeRouteParam } from "../route-utils/route-params.ts";

export const conversationUsageNoticeRoutes: readonly DeclarativeRoute<WorkerRouteContext>[] = [
  {
    authorizeBeforeMethod: true,
    authorization: "vercel-oidc",
    beforeMethod(context, params) {
      return requireBoundInternalRouteUser(context, params, "conversation-usage-notice");
    },
    async handle(context, params) {
      return handleConversationUsageNoticeRoute(context, params.userId);
    },
    match: (pathname) =>
      matchCloudflareHostedControlUserRoutePath("conversationUsageNotice", pathname),
    methods: [CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS.conversationUsageNotice.method],
    name: "conversation-usage-notice",
    wrongMethodResponse: "method-not-allowed",
  },
];

async function handleConversationUsageNoticeRoute(
  context: WorkerRouteContext,
  encodedUserId: string,
): Promise<Response> {
  const userId = decodeRouteParam(encodedUserId);
  let providerRequest: CloudflareHostedControlConversationUsageNoticeRequest;
  try {
    providerRequest = parseCloudflareHostedControlConversationUsageNoticeRequest(
      parseJsonValue(await readCachedRequestText(context, {
        limitBytes: INTERNAL_CONTROL_JSON_BODY_LIMIT_BYTES,
      })),
    );
  } catch (error) {
    emitConversationUsageNoticeFailure({
      context,
      error,
      reason: "conversation-usage-notice-request-invalid",
      userId,
    });
    return json({
      code: "invalid_request",
      error: "Malformed conversation usage notice request.",
    }, 400);
  }

  try {
    await sendConversationUsageNotice({
      context,
      request: providerRequest,
      userId,
    });
    return json({ status: "sent" });
  } catch (error) {
    const retryable = readProviderFailureRetryable(error);
    const retryAfterSeconds = retryable
      ? readProviderRetryAfterSeconds(error)
      : null;
    const failureCode = readProviderFailureCode(error);
    emitConversationUsageNoticeFailure({
      context,
      details: {
        failureCode,
        retryable,
        ...(retryAfterSeconds === null ? {} : { retryAfterSeconds }),
      },
      error,
      reason: "conversation-usage-notice-provider-failed",
      userId,
    });
    return json({
      failureCode,
      ...(retryAfterSeconds === null ? {} : { retryAfterSeconds }),
      retryable,
      status: "failed",
    });
  }
}

async function sendConversationUsageNotice(input: {
  context: WorkerRouteContext;
  request: CloudflareHostedControlConversationUsageNoticeRequest;
  userId: string;
}): Promise<void> {
  if (input.request.channel === "whatsapp") {
    await sendHostedProviderWhatsAppMessage(input.request, {
      env: asWorkerStringEnvironment(input.context.env) as NodeJS.ProcessEnv,
      fetchImplementation: normalizeCloudflareWorkerFetch(),
      signal: input.context.request.signal,
    });
    return;
  }

  const workerEnvironment = asWorkerStringEnvironment(input.context.env);
  const emailConfig = readHostedEmailConfig(workerEnvironment);
  if (
    !emailConfig.domain
    || !emailConfig.signingSecret
    || !input.context.env.HOSTED_EMAIL
  ) {
    throw Object.assign(
      new Error("Hosted email usage notice delivery is unavailable."),
      { code: "ASSISTANT_EMAIL_UNAVAILABLE" },
    );
  }
  const result = await sendHostedEmailMessage({
    config: emailConfig,
    emailBinding: input.context.env.HOSTED_EMAIL,
    fetchImpl: normalizeCloudflareWorkerFetch(),
    request: {
      message: input.request.message,
      replyToMessageId: input.request.replyToMessageId,
      subject: input.request.subject,
      target: input.request.target,
      targetKind: input.request.targetKind,
    },
    userId: input.userId,
    webCallbackSigning: input.context.environment.webCallbackSigning,
    ...(input.context.environment.hostedWebAllowHttpHosts
      ? { webControlAllowHttpHosts: input.context.environment.hostedWebAllowHttpHosts }
      : {}),
    webControlBaseUrl: input.context.environment.hostedWebBaseUrl,
  });
  if (
    result.delivery?.status === "failed"
    || (result.delivery && result.delivery.sentCount === 0)
  ) {
    throw new Error("Hosted email usage notice was not accepted.");
  }
}

function emitConversationUsageNoticeFailure(input: {
  context: WorkerRouteContext;
  details?: HostedExecutionStructuredLogDetails;
  error: unknown;
  reason: string;
  userId: string;
}): void {
  emitHostedExecutionStructuredLog({
    component: "worker",
    details: {
      ...buildWorkerRouteLogDetails({
        reason: input.reason,
        routeName: "conversation-usage-notice",
      }, input.context.request, input.userId),
      ...input.details,
    },
    error: input.error,
    level: "warn",
    message: "Hosted worker conversation usage notice route failed.",
    phase: "failed",
    userId: input.userId,
  });
}

function readProviderFailureCode(error: unknown): string {
  const record = readRecord(error);
  return normalizeErrorString(record?.code)
    ?? readHostedExecutionSafeErrorName(error)
    ?? "HostedConversationUsageNoticeError";
}

function readProviderFailureRetryable(error: unknown): boolean {
  const record = readRecord(error);
  if (record?.deliveryMayHaveSucceeded === true) {
    return false;
  }
  const context = readRecord(record?.context);
  const code = normalizeErrorString(record?.code);
  if (
    code === "ASSISTANT_WHATSAPP_TOKEN_REQUIRED"
    || code === "ASSISTANT_WHATSAPP_UNAVAILABLE"
    || code === "ASSISTANT_EMAIL_UNAVAILABLE"
  ) {
    return true;
  }
  const status = readHttpStatus(context?.status) ?? readHttpStatus(record?.status);
  return status === 429;
}

function readProviderRetryAfterSeconds(error: unknown): number | null {
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
  return typeof value === "number"
      && Number.isSafeInteger(value)
      && value >= 100
      && value <= 599
    ? value
    : null;
}
