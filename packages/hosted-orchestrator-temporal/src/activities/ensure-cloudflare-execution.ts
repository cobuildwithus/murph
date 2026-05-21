import type {
  HostedRuntimeEnsureExecutionRequest,
  HostedRuntimeEnsureExecutionResponse,
} from "../index.js";
import {
  ApplicationFailure,
} from "@temporalio/common";
import {
  parseHostedRuntimeEnsureExecutionRequest,
  parseHostedRuntimeEnsureExecutionResponse,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_WORKSPACE_INVOCATION_REASONS,
  parseHostedAiUsageAllowDecision,
  type HostedAiUsageAllowDecision,
  type HostedWorkspaceInvocationReason,
} from "@murphai/hosted-execution/runtime-control";

import {
  readHostedOrchestratorTemporalCloudflareEnvironment,
  readHostedOrchestratorTemporalWebEnvironment,
  requestHostedOrchestratorJson,
} from "./http-client.js";

export interface EnsureCloudflareExecutionInput {
  orchestrationAttemptId: string;
  reason: HostedWorkspaceInvocationReason;
  requiresAiUsageDecision: boolean;
  userId: string;
}

type HostedRuntimeUsageAllowDecisionFetchResult =
  | {
      aiUsageAllowDecision: HostedAiUsageAllowDecision;
      kind: "allowed";
    }
  | {
      kind: "blocked";
      reason: "ai_usage_denied" | "ai_usage_gate_unavailable";
      retryAt: string | null;
    };

const HOSTED_RUNTIME_USAGE_ALLOW_DECISION_PATH_PREFIX =
  "/api/internal/hosted-orchestration/users/";
const HOSTED_RUNTIME_USAGE_ALLOW_DECISION_PATH_SUFFIX =
  "/usage-allow-decision";
const CLOUDFLARE_RUNTIME_ENSURE_EXECUTION_PATH_PREFIX = "/internal/users/";
const CLOUDFLARE_RUNTIME_ENSURE_EXECUTION_PATH_SUFFIX =
  "/runtime/ensure-execution";

export async function ensureCloudflareExecution(
  request: EnsureCloudflareExecutionInput,
): Promise<HostedRuntimeEnsureExecutionResponse> {
  const parsedRequest = parseEnsureCloudflareExecutionInput(request);
  const cloudflareEnvironment = readHostedOrchestratorTemporalCloudflareEnvironment();
  const aiUsageAllowDecision = parsedRequest.requiresAiUsageDecision
    ? await fetchFreshAiUsageAllowDecision(parsedRequest.userId)
    : null;
  const cloudflareRequest = parseHostedRuntimeEnsureExecutionRequest({
    ...(aiUsageAllowDecision ? { aiUsageAllowDecision } : {}),
    orchestrationAttemptId: parsedRequest.orchestrationAttemptId,
    reason: parsedRequest.reason,
  } satisfies HostedRuntimeEnsureExecutionRequest);

  return requestHostedOrchestratorJson(
    cloudflareEnvironment.cloudflareHostedControlBaseUrl,
    {
      body: JSON.stringify(cloudflareRequest),
      boundUserId: parsedRequest.userId,
      label: "runtime ensure execution",
      method: "POST",
      parse: parseHostedRuntimeEnsureExecutionResponse,
      path: buildCloudflareRuntimeEnsureExecutionPath(parsedRequest.userId),
      signing: cloudflareEnvironment.cloudflareHostedControlSigning,
      timeoutMs: cloudflareEnvironment.ensureCloudflareExecutionTimeoutMs,
    },
  );
}

async function fetchFreshAiUsageAllowDecision(userId: string) {
  const webEnvironment = readHostedOrchestratorTemporalWebEnvironment();
  const decision = await requestHostedOrchestratorJson(
    webEnvironment.hostedWebBaseUrl,
    {
      boundUserId: userId,
      label: "AI usage allow decision",
      method: "GET",
      parse: parseHostedRuntimeUsageAllowDecisionFetchResult,
      path: buildHostedRuntimeUsageAllowDecisionPath(userId),
      signing: webEnvironment.hostedWebCallbackSigning,
      timeoutMs: webEnvironment.readRuntimeDemandTimeoutMs,
    },
  );

  if (decision.kind === "blocked") {
    throw createUsageDecisionBlockedFailure(decision);
  }

  if (decision.aiUsageAllowDecision.userId !== userId) {
    throw new TypeError("AI usage allow decision userId must match the requested user.");
  }

  return decision.aiUsageAllowDecision;
}

function createUsageDecisionBlockedFailure(
  input: Extract<HostedRuntimeUsageAllowDecisionFetchResult, { kind: "blocked" }>,
): ApplicationFailure {
  const failure = ApplicationFailure.create({
    details: [{
      retryAt: input.retryAt,
    }],
    message: "Hosted orchestrator AI usage decision is blocked.",
    nonRetryable: true,
    type: input.reason,
  }) as ApplicationFailure & {
    code?: typeof input.reason;
    retryAt?: string | null;
  };
  failure.code = input.reason;
  failure.retryAt = input.retryAt;
  return failure;
}

function parseEnsureCloudflareExecutionInput(
  value: unknown,
): EnsureCloudflareExecutionInput {
  if (!isRecord(value)) {
    throw new TypeError("Hosted runtime ensure-execution Activity input must be an object.");
  }

  const record = value;
  assertExactKeys(record, "Hosted runtime ensure-execution Activity input", [
    "orchestrationAttemptId",
    "reason",
    "requiresAiUsageDecision",
    "userId",
  ]);

  return {
    orchestrationAttemptId: requireOpaqueIdentifier(
      record.orchestrationAttemptId,
      "Hosted runtime ensure-execution Activity input orchestrationAttemptId",
    ),
    reason: parseHostedWorkspaceInvocationReason(
      record.reason,
      "Hosted runtime ensure-execution Activity input reason",
    ),
    requiresAiUsageDecision: requireBoolean(
      record.requiresAiUsageDecision,
      "Hosted runtime ensure-execution Activity input requiresAiUsageDecision",
    ),
    userId: requireOpaqueIdentifier(
      record.userId,
      "Hosted runtime ensure-execution Activity input userId",
    ),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function buildHostedRuntimeUsageAllowDecisionPath(userId: string): string {
  return `${HOSTED_RUNTIME_USAGE_ALLOW_DECISION_PATH_PREFIX}${encodeURIComponent(userId)}${
    HOSTED_RUNTIME_USAGE_ALLOW_DECISION_PATH_SUFFIX
  }`;
}

function buildCloudflareRuntimeEnsureExecutionPath(userId: string): string {
  return `${CLOUDFLARE_RUNTIME_ENSURE_EXECUTION_PATH_PREFIX}${encodeURIComponent(userId)}${
    CLOUDFLARE_RUNTIME_ENSURE_EXECUTION_PATH_SUFFIX
  }`;
}

function assertExactKeys(
  record: Record<string, unknown>,
  label: string,
  allowedKeys: readonly string[],
): void {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new TypeError(`${label} must not include ${key}.`);
    }
  }
}

function requireOpaqueIdentifier(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  if (value.length > 192 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value)) {
    throw new TypeError(`${label} must be a bounded opaque identifier.`);
  }
  return value;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean.`);
  }
  return value;
}

function parseHostedWorkspaceInvocationReason(
  value: unknown,
  label: string,
): HostedWorkspaceInvocationReason {
  if (
    typeof value !== "string"
    || !HOSTED_WORKSPACE_INVOCATION_REASONS.includes(
      value as HostedWorkspaceInvocationReason,
    )
  ) {
    throw new TypeError(`${label} must be a supported invocation reason.`);
  }
  return value as HostedWorkspaceInvocationReason;
}

function parseHostedRuntimeUsageAllowDecisionFetchResult(
  value: unknown,
): HostedRuntimeUsageAllowDecisionFetchResult {
  try {
    return {
      aiUsageAllowDecision: parseHostedAiUsageAllowDecision(value),
      kind: "allowed",
    };
  } catch {
    return parseHostedRuntimeUsageAllowDecisionBlockedResult(value);
  }
}

function parseHostedRuntimeUsageAllowDecisionBlockedResult(
  value: unknown,
): Extract<HostedRuntimeUsageAllowDecisionFetchResult, { kind: "blocked" }> {
  const record = requireBlockedUsageDecisionRecord(value);
  assertExactKeys(record, "Hosted runtime usage decision blocked response", [
    "kind",
    "reason",
    "retryAt",
  ]);

  const kind = record.kind;
  if (kind !== "blocked") {
    throw new TypeError("Hosted runtime usage decision response kind must be blocked.");
  }

  const reason = record.reason;
  if (
    reason !== "ai_usage_denied"
    && reason !== "ai_usage_gate_unavailable"
  ) {
    throw new TypeError("Hosted runtime usage decision blocked reason is unsupported.");
  }

  return {
    kind,
    reason,
    retryAt: readNullableIsoTimestamp(
      record.retryAt,
      "Hosted runtime usage decision blocked retryAt",
    ),
  };
}

function requireBlockedUsageDecisionRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new TypeError("Hosted runtime usage decision response must be an object.");
  }
  return value;
}

function readNullableIsoTimestamp(value: unknown, label: string): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be null or an ISO timestamp.`);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new TypeError(`${label} must be a valid ISO timestamp.`);
  }
  return new Date(timestamp).toISOString();
}
