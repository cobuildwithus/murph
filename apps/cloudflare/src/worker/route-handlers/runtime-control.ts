import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import type {
  HostedRuntimeEnsureProcessingRequest,
  HostedRuntimeEnsureProcessingResponse,
} from "@murphai/hosted-execution/orchestration-control";
import type {
  HostedRuntimeLatencyPhaseBreakdown,
} from "@murphai/hosted-execution/runtime-control";
import {
  assertHostedRuntimeProcessingTimeoutMs,
  HOSTED_RUNTIME_ENSURE_PROCESSING_ACTIVITY_STARTED_AT_MS_HEADER,
  HOSTED_RUNTIME_ENSURE_PROCESSING_DIRECT_REQUEST_STARTED_AT_MS_HEADER,
  HOSTED_RUNTIME_ENSURE_PROCESSING_REQUEST_STARTED_AT_MS_HEADER,
  HOSTED_RUNTIME_ENSURE_PROCESSING_TIMEOUT_MS_HEADER,
  HOSTED_RUNTIME_ENSURE_PROCESSING_TOKEN_ACQUIRED_AT_MS_HEADER,
  HOSTED_RUNTIME_ENSURE_PROCESSING_TOKEN_ACQUIRE_STARTED_AT_MS_HEADER,
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
  readPresentedWorkerRouteAuthorization,
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
  // Signed requests come from the Temporal orchestrator; OIDC requests come
  // from the web app's direct ingress wake fast path. Same idempotent ensure.
  authorization: "web-callback-signature-or-vercel-oidc",
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

const runtimeHealthDataConsentRoute = {
  authorizeBeforeMethod: true,
  authorization: "vercel-oidc",
  beforeMethod(context, params) {
    return requireBoundInternalRouteUser(
      context,
      params,
      "runtime-health-data-consent",
    );
  },
  async handle(context, params) {
    return handleRuntimeHealthDataConsentRoute(context, params.userId);
  },
  match: (pathname) => matchCloudflareHostedControlUserRoutePath(
    "runtimeHealthDataConsentReconcile",
    pathname,
  ),
  methods: [
    CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS
      .runtimeHealthDataConsentReconcile.method,
  ],
  name: "runtime-health-data-consent",
  signatureBodyLimitBytes: INTERNAL_CONTROL_JSON_BODY_LIMIT_BYTES,
  wrongMethodResponse: "method-not-allowed",
} satisfies DeclarativeRoute<WorkerRouteContext>;

const runtimeShellPrewarmRoute = {
  authorizeBeforeMethod: true,
  authorization: "vercel-oidc",
  beforeMethod(context, params) {
    return requireBoundInternalRouteUser(context, params, "runtime-shell-prewarm");
  },
  async handle(context, params) {
    return handleRuntimeShellPrewarmRoute(context, params.userId);
  },
  match: (pathname) => matchCloudflareHostedControlUserRoutePath(
    "runtimeShellPrewarm",
    pathname,
  ),
  methods: [CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS.runtimeShellPrewarm.method],
  name: "runtime-shell-prewarm",
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
  runtimeShellPrewarmRoute,
  runtimeHealthDataConsentRoute,
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
  const status = await stub.runnerStatus(readHostedStatusRouteOptions(context.url));
  return json(status);
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
  const cloudflareRouteReceivedAtEpochMs = Date.now();
  const commandStartedAtEpochMs =
    context.runtimeControlAuthTiming?.runtimeControlAuthStartedAtEpochMs
    ?? cloudflareRouteReceivedAtEpochMs;
  const userId = decodeRouteParam(encodedUserId);
  let ensureRequest: HostedRuntimeEnsureProcessingRequest;
  let commandTimeoutMs: number | null;
  let orchestration: NonNullable<HostedRuntimeLatencyPhaseBreakdown["orchestration"]> = {
    cloudflareRouteReceivedAtEpochMs,
  };
  try {
    const payload = await readCachedRequestText(context, {
      limitBytes: INTERNAL_CONTROL_JSON_BODY_LIMIT_BYTES,
    });
    ensureRequest = parseHostedRuntimeEnsureProcessingRequest(
      requireJsonObject(payload.trim() ? JSON.parse(payload) : {}),
    );
    commandTimeoutMs = readRuntimeEnsureProcessingCommandTimeoutMs(context.request.headers);
    const authorizationKind = readPresentedWorkerRouteAuthorization(context.request);
    orchestration = readRuntimeEnsureProcessingOrchestrationDiagnostics(
      context.request.headers,
      cloudflareRouteReceivedAtEpochMs,
      context.runtimeControlAuthTiming ?? null,
      // Derived from the credential that authorized this request, never from
      // caller-supplied body fields.
      authorizationKind === "vercel-oidc",
    );
    if (authorizationKind === "vercel-oidc") {
      try {
        const result = await runRuntimeEnsureProcessingForUser({
          commandStartedAtEpochMs,
          commandTimeoutMs,
          context,
          ensureRequest,
          orchestration,
          userId,
        });
        emitHostedExecutionStructuredLog({
          component: "worker",
          details: {
            ...buildWorkerRouteLogDetails({
              reason: "runtime-ensure-processing-direct-completed",
              routeName: "runtime-ensure-processing",
            }, context.request, userId),
            orchestrationAttemptId: ensureRequest.orchestrationAttemptId,
            ...(result.kind === "runtime_processing_accepted"
              ? {
                  runtimeAttemptId: result.runtimeAttemptId,
                  runtimeProcessingAction: result.action,
                }
              : {}),
            runtimeProcessingKind: result.kind,
          },
          message: "Hosted worker direct runtime ensure-processing completed.",
          phase: "runtime.starting",
          userId,
        });
        return json(result);
      } catch (error) {
        emitHostedExecutionStructuredLog({
          component: "worker",
          details: {
            ...buildWorkerRouteLogDetails({
              reason: "runtime-ensure-processing-direct-failed",
              routeName: "runtime-ensure-processing",
            }, context.request, userId),
            orchestrationAttemptId: ensureRequest.orchestrationAttemptId,
          },
          error,
          level: "error",
          message: "Hosted worker direct runtime ensure-processing failed.",
          phase: "failed",
          userId,
        });
        const classified = classifyPublicRouteError(error);
        return json({
          code: "runtime_ensure_processing_failed",
          error: classified.error,
        }, classified.status);
      }
    }
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

  return json(await runRuntimeEnsureProcessingForUser({
    commandStartedAtEpochMs,
    commandTimeoutMs,
    context,
    ensureRequest,
    orchestration,
    userId,
  }));
}

export async function handleRuntimeHealthDataConsentRoute(
  context: WorkerRouteContext,
  encodedUserId: string,
): Promise<Response> {
  const userId = decodeRouteParam(encodedUserId);
  const payload = await readCachedRequestText(context, {
    limitBytes: INTERNAL_CONTROL_JSON_BODY_LIMIT_BYTES,
  });
  const body = requireJsonObject(payload.trim() ? JSON.parse(payload) : {});
  if (Object.keys(body).length > 0) {
    throw new TypeError(
      "Hosted runtime health-data consent request must be empty.",
    );
  }
  const stub = await resolveUserRunnerStub(context.env, userId);
  if (!stub.reconcileRuntimeHealthDataConsentForUser) {
    throw new Error(
      "Hosted runtime health-data consent reconciliation is unavailable.",
    );
  }
  return json(await stub.reconcileRuntimeHealthDataConsentForUser(userId));
}

async function handleRuntimeShellPrewarmRoute(
  context: WorkerRouteContext,
  encodedUserId: string,
): Promise<Response> {
  const userId = decodeRouteParam(encodedUserId);
  try {
    const payload = await readCachedRequestText(context, {
      limitBytes: INTERNAL_CONTROL_JSON_BODY_LIMIT_BYTES,
    });
    const body = requireJsonObject(payload.trim() ? JSON.parse(payload) : {});
    if (Object.keys(body).some((key) => key !== "source")) {
      throw new TypeError("Hosted runtime shell prewarm request has unknown fields.");
    }
    const source = body.source;
    if (
      source !== undefined
      && source !== "linq-instant-start"
      && source !== "linq-typing-started"
    ) {
      throw new TypeError("Hosted runtime shell prewarm source is invalid.");
    }

    const stub = context.env.USER_RUNNER.getByName(userId);
    if (!stub.prewarmRuntimeShellForUser) {
      throw new Error("User runner shell-prewarm RPC is unavailable.");
    }
    await stub.prewarmRuntimeShellForUser(userId, source);
    return json({ accepted: true }, 202);
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "worker",
      details: buildWorkerRouteLogDetails({
        reason: "runtime-shell-prewarm-request-failed",
        routeName: "runtime-shell-prewarm",
      }, context.request, userId),
      error,
      level: "warn",
      message: "Hosted worker runtime shell prewarm request failed.",
      phase: "failed",
      userId,
    });
    const classified = classifyPublicRouteError(error);
    return json({
      code: "invalid_request",
      error: classified.error,
    }, classified.status);
  }
}

function runRuntimeEnsureProcessingForUser(input: {
  commandStartedAtEpochMs: number;
  commandTimeoutMs: number | null;
  context: WorkerRouteContext;
  ensureRequest: HostedRuntimeEnsureProcessingRequest;
  orchestration: NonNullable<HostedRuntimeLatencyPhaseBreakdown["orchestration"]>;
  userId: string;
}): Promise<HostedRuntimeEnsureProcessingResponse> {
  const stub = input.context.env.USER_RUNNER.getByName(input.userId);
  return stub.ensureRuntimeProcessingForUser({
    ...input.ensureRequest,
    commandStartedAtEpochMs: input.commandStartedAtEpochMs,
    ...(input.commandTimeoutMs === null ? {} : { commandTimeoutMs: input.commandTimeoutMs }),
    orchestration: input.orchestration,
    userId: input.userId,
  });
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

function readRuntimeEnsureProcessingOrchestrationDiagnostics(
  headers: Headers,
  cloudflareRouteReceivedAtEpochMs: number,
  runtimeControlAuthTiming: WorkerRouteContext["runtimeControlAuthTiming"] | null,
  triggeredByWebDirect: boolean,
): NonNullable<HostedRuntimeLatencyPhaseBreakdown["orchestration"]> {
  const temporalActivityStartedAtEpochMs = readOptionalEpochMsHeader(
    headers,
    HOSTED_RUNTIME_ENSURE_PROCESSING_ACTIVITY_STARTED_AT_MS_HEADER,
  );
  const temporalActivityRequestStartedAtEpochMs = readOptionalEpochMsHeader(
    headers,
    HOSTED_RUNTIME_ENSURE_PROCESSING_REQUEST_STARTED_AT_MS_HEADER,
  );
  const tokenAcquireStartedAtEpochMs = readOptionalEpochMsHeader(
    headers,
    HOSTED_RUNTIME_ENSURE_PROCESSING_TOKEN_ACQUIRE_STARTED_AT_MS_HEADER,
  );
  const tokenAcquiredAtEpochMs = readOptionalEpochMsHeader(
    headers,
    HOSTED_RUNTIME_ENSURE_PROCESSING_TOKEN_ACQUIRED_AT_MS_HEADER,
  );
  const directEnsureRequestStartedAtEpochMs = readOptionalEpochMsHeader(
    headers,
    HOSTED_RUNTIME_ENSURE_PROCESSING_DIRECT_REQUEST_STARTED_AT_MS_HEADER,
  );
  return {
    cloudflareRouteReceivedAtEpochMs,
    ...(triggeredByWebDirect ? { triggeredByWebDirect } : {}),
    ...(temporalActivityStartedAtEpochMs === null ? {} : { temporalActivityStartedAtEpochMs }),
    ...(temporalActivityRequestStartedAtEpochMs === null ? {} : {
      temporalActivityRequestStartedAtEpochMs,
    }),
    ...(tokenAcquireStartedAtEpochMs === null ? {} : { tokenAcquireStartedAtEpochMs }),
    ...(tokenAcquiredAtEpochMs === null ? {} : { tokenAcquiredAtEpochMs }),
    ...(directEnsureRequestStartedAtEpochMs === null
      ? {}
      : { directEnsureRequestStartedAtEpochMs }),
    ...(runtimeControlAuthTiming ?? {}),
  };
}

function readOptionalEpochMsHeader(headers: Headers, headerName: string): number | null {
  const raw = headers.get(headerName);
  if (raw === null || !/^\d+$/u.test(raw.trim())) {
    return null;
  }
  const value = Number(raw.trim());
  return Number.isSafeInteger(value) ? value : null;
}
