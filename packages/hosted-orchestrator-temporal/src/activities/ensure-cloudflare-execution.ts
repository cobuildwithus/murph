import type {
  HostedRuntimeEnsureExecutionRequest,
  HostedRuntimeEnsureExecutionResponse,
} from "../index.js";
import {
  parseHostedRuntimeEnsureExecutionRequest,
  parseHostedRuntimeEnsureExecutionResponse,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_WORKSPACE_INVOCATION_REASONS,
  type HostedWorkspaceInvocationReason,
} from "@murphai/hosted-execution/runtime-control";

import {
  readHostedOrchestratorTemporalCloudflareEnvironment,
  requestHostedOrchestratorJson,
} from "./http-client.js";

export interface EnsureCloudflareExecutionInput {
  orchestrationAttemptId: string;
  reason: HostedWorkspaceInvocationReason;
  userId: string;
}

const CLOUDFLARE_RUNTIME_ENSURE_EXECUTION_PATH_PREFIX = "/internal/users/";
const CLOUDFLARE_RUNTIME_ENSURE_EXECUTION_PATH_SUFFIX =
  "/runtime/ensure-execution";

export async function ensureCloudflareExecution(
  request: EnsureCloudflareExecutionInput,
): Promise<HostedRuntimeEnsureExecutionResponse> {
  const parsedRequest = parseEnsureCloudflareExecutionInput(request);
  const cloudflareEnvironment = readHostedOrchestratorTemporalCloudflareEnvironment();
  const cloudflareRequest = parseHostedRuntimeEnsureExecutionRequest({
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
    userId: requireOpaqueIdentifier(
      record.userId,
      "Hosted runtime ensure-execution Activity input userId",
    ),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
