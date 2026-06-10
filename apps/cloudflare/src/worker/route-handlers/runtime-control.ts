import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import type {
  HostedRuntimeEnsureProcessingRequest,
} from "@murphai/hosted-execution/orchestration-control";
import {
  assertHostedRuntimeProcessingTimeoutMs,
  HOSTED_RUNTIME_ENSURE_PROCESSING_TIMEOUT_MS_HEADER,
} from "@murphai/hosted-execution/contracts";
import {
  parseHostedRuntimeEnsureProcessingRequest,
} from "@murphai/hosted-execution/parsers";
import {
  CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS,
  matchCloudflareHostedControlUserRoutePath,
} from "@murphai/cloudflare-hosted-control/routes";

import {
  json,
  requireJsonObject,
} from "../../json.ts";
import {
  readCachedRequestText,
  resolveUserRunnerStub,
  type WorkerRouteContext,
} from "../../worker-routes/shared.ts";
import {
  requireBoundInternalRouteUser,
} from "../auth.ts";
import {
  classifyPublicRouteError,
} from "../errors.ts";
import type {
  DeclarativeRoute,
} from "../routes.ts";
import {
  buildWorkerRouteLogDetails,
} from "../route-utils/log-details.ts";
import {
  INTERNAL_CONTROL_JSON_BODY_LIMIT_BYTES,
} from "../route-utils/json-body.ts";
import {
  decodeRouteParam,
} from "../route-utils/route-params.ts";

const runtimeEnsureProcessingRoute = {
  authorizeBeforeMethod: true,
  authorization: "web-callback-signature",
  beforeMethod(context, params) {
    return requireBoundInternalRouteUser(context, params, "runtime-ensure-processing");
  },
  async handle(context, params) {
    return handleRuntimeEnsureProcessingRoute(context, params.userId);
  },
  match: (pathname) => matchCloudflareHostedControlUserRoutePath("runtimeEnsureProcessing", pathname),
  methods: [CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS.runtimeEnsureProcessing.method],
  name: "runtime-ensure-processing",
  signatureBodyLimitBytes: INTERNAL_CONTROL_JSON_BODY_LIMIT_BYTES,
  wrongMethodResponse: "method-not-allowed",
} satisfies DeclarativeRoute<WorkerRouteContext>;

const userStatusRoute = {
  authorizeBeforeMethod: true,
  authorization: "vercel-oidc",
  beforeMethod(context, params) {
    return requireBoundInternalRouteUser(context, params, "user-status");
  },
  async handle(context, params) {
    return handleStatusRoute(context, params.userId);
  },
  match: (pathname) => matchCloudflareHostedControlUserRoutePath("status", pathname),
  methods: [CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS.status.method],
  name: "user-status",
  wrongMethodResponse: "method-not-allowed",
} satisfies DeclarativeRoute<WorkerRouteContext>;

export const runtimeProcessingRoutes = [
  runtimeEnsureProcessingRoute,
] as const;

export const userStatusRoutes = [
  userStatusRoute,
] as const;

export async function handleStatusRoute(
  context: WorkerRouteContext,
  encodedUserId: string,
): Promise<Response> {
  const userId = decodeRouteParam(encodedUserId);
  const stub = await resolveUserRunnerStub(context.env, userId);
  return json(await stub.runnerStatus(readHostedStatusRouteOptions(context.url)));
}

function readHostedStatusRouteOptions(url: URL): { logLimit?: number } | undefined {
  const rawLogLimit = url.searchParams.get("logLimit");
  if (!rawLogLimit) {
    return undefined;
  }

  const logLimit = parseStrictPositiveInteger(rawLogLimit);
  return logLimit !== null
    ? { logLimit: Math.min(logLimit, 50) }
    : undefined;
}

function parseStrictPositiveInteger(value: string): number | null {
  if (!/^[0-9]+$/u.test(value)) {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function handleRuntimeEnsureProcessingRoute(
  context: WorkerRouteContext,
  encodedUserId: string,
): Promise<Response> {
  const userId = decodeRouteParam(encodedUserId);
  let ensureRequest: HostedRuntimeEnsureProcessingRequest;
  let commandTimeoutMs: number | null;
  try {
    const payload = await readCachedRequestText(context, {
      limitBytes: INTERNAL_CONTROL_JSON_BODY_LIMIT_BYTES,
    });
    ensureRequest = parseHostedRuntimeEnsureProcessingRequest(
      requireJsonObject(payload.trim() ? JSON.parse(payload) : {}),
    );
    commandTimeoutMs = readRuntimeEnsureProcessingCommandTimeoutMs(context.request.headers);
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "worker",
      details: buildWorkerRouteLogDetails({
        reason: "runtime-ensure-processing-request-invalid",
        routeName: "runtime-ensure-processing",
      }, context.request, userId),
      error,
      level: "warn",
      message: "Hosted worker runtime ensure-processing route rejected an invalid request.",
      phase: "failed",
      userId,
    });
    const classified = classifyPublicRouteError(error);
    return json({
      code: "invalid_request",
      error: classified.error,
    }, classified.status);
  }

  const stub = context.env.USER_RUNNER.getByName(userId);
  return json(await stub.ensureRuntimeProcessingForUser({
    ...ensureRequest,
    ...(commandTimeoutMs === null ? {} : { commandTimeoutMs }),
    userId,
  }));
}

export function readRuntimeEnsureProcessingCommandTimeoutMs(headers: Headers): number | null {
  const value = headers.get(HOSTED_RUNTIME_ENSURE_PROCESSING_TIMEOUT_MS_HEADER);
  if (value === null || value.trim().length === 0) {
    return null;
  }

  const normalized = value.trim();
  if (!/^[0-9]+$/u.test(normalized)) {
    throw new TypeError("Hosted runtime ensure-processing command timeout header must be a positive integer.");
  }

  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError("Hosted runtime ensure-processing command timeout header must be a positive integer.");
  }
  assertHostedRuntimeProcessingTimeoutMs(
    parsed,
    "Hosted runtime ensure-processing command timeout header",
  );

  return parsed;
}
