import type {
  HostedRuntimeEnsureProcessingRequest,
  HostedRuntimeEnsureProcessingResponse,
} from "../index.js";
import {
  parseHostedRuntimeDemandRunSource,
  parseHostedRuntimeEnsureProcessingRequest,
  parseHostedRuntimeEnsureProcessingResponse,
} from "@murphai/hosted-execution/parsers";
import type {
  HostedRuntimeDemandRunSource,
} from "@murphai/hosted-execution/orchestration-control";
import {
  HOSTED_RUNTIME_ENSURE_PROCESSING_TIMEOUT_MS_HEADER,
} from "@murphai/hosted-execution/contracts";
import {
  HOSTED_WORKSPACE_INVOCATION_REASONS,
  type HostedWorkspaceInvocationReason,
} from "@murphai/hosted-execution/runtime-control";

import {
  HostedOrchestratorHttpResponseError,
  observeHostedTemporalActivity,
  readHostedOrchestratorTemporalCloudflareEnvironment,
  requestHostedOrchestratorJson,
} from "./http-client.js";

const LEGACY_DEVICE_SYNC_RECOVERY_SOURCE = "device_sync_recovery";

export interface EnsureRuntimeProcessingInput {
  orchestrationAttemptId: string;
  reason: HostedWorkspaceInvocationReason;
  source?: EnsureRuntimeProcessingInputSource | null;
  userId: string;
}

type EnsureRuntimeProcessingInputSource =
  | HostedRuntimeDemandRunSource
  | typeof LEGACY_DEVICE_SYNC_RECOVERY_SOURCE;

const CLOUDFLARE_RUNTIME_ENSURE_PROCESSING_PATH_PREFIX = "/internal/users/";
const CLOUDFLARE_RUNTIME_ENSURE_PROCESSING_PATH_SUFFIX =
  "/runtime/ensure-processing";
const ENSURE_PROCESSING_SOURCE_DEPLOY_SKEW_RETRY_DELAY_MS = 30_000;

export async function ensureRuntimeProcessing(
  request: EnsureRuntimeProcessingInput,
): Promise<HostedRuntimeEnsureProcessingResponse> {
  const parsedRequest = parseEnsureRuntimeProcessingInput(request);
  const cloudflareEnvironment = readHostedOrchestratorTemporalCloudflareEnvironment();
  const cloudflareSource = parsedRequest.source === LEGACY_DEVICE_SYNC_RECOVERY_SOURCE
    ? null
    : parsedRequest.source ?? null;
  const cloudflareRequest = parseHostedRuntimeEnsureProcessingRequest({
    orchestrationAttemptId: parsedRequest.orchestrationAttemptId,
    reason: parsedRequest.reason,
    ...(cloudflareSource ? { source: cloudflareSource } : {}),
  } satisfies HostedRuntimeEnsureProcessingRequest);

  return observeHostedTemporalActivity({
    activity: "ensureRuntimeProcessing",
    orchestrationAttemptId: parsedRequest.orchestrationAttemptId,
    reason: parsedRequest.reason,
    userId: parsedRequest.userId,
  }, async () => {
    try {
      return await requestHostedOrchestratorJson(
        cloudflareEnvironment.cloudflareHostedControlBaseUrl,
        {
          body: JSON.stringify(cloudflareRequest),
          boundUserId: parsedRequest.userId,
          unsignedHeaders: {
            [HOSTED_RUNTIME_ENSURE_PROCESSING_TIMEOUT_MS_HEADER]:
              String(cloudflareEnvironment.ensureRuntimeProcessingHttpTimeoutMs),
          },
          label: "runtime ensure processing",
          method: "POST",
          parse: parseHostedRuntimeEnsureProcessingResponse,
          path: buildCloudflareRuntimeEnsureProcessingPath(parsedRequest.userId),
          signing: cloudflareEnvironment.cloudflareHostedControlSigning,
          timeoutMs: cloudflareEnvironment.ensureRuntimeProcessingHttpTimeoutMs,
        },
      );
    } catch (error) {
      if (!cloudflareSource || !isEnsureProcessingSourceDeploySkewRejection(error)) {
        throw error;
      }

      // Deploy-skew only: old Cloudflare workers reject the new optional
      // `source` key. Keep sourced demand pending until the consumer
      // deployment can accept it instead of silently running without source.
      return {
        kind: "retry_later",
        retryAt: new Date(
          Date.now() + ENSURE_PROCESSING_SOURCE_DEPLOY_SKEW_RETRY_DELAY_MS,
        ).toISOString(),
      };
    }
  });
}

function isEnsureProcessingSourceDeploySkewRejection(error: unknown): boolean {
  const visited = new Set<unknown>();
  let current: unknown = error;

  while (current && typeof current === "object" && !visited.has(current)) {
    visited.add(current);
    if (current instanceof HostedOrchestratorHttpResponseError) {
      return current.status === 400 && current.code === undefined;
    }
    current = (current as { cause?: unknown }).cause;
  }

  return false;
}

function parseEnsureRuntimeProcessingInput(
  value: unknown,
): EnsureRuntimeProcessingInput {
  if (!isRecord(value)) {
    throw new TypeError("Hosted runtime ensure-processing Activity input must be an object.");
  }

  const record = value;
  assertExactKeys(record, "Hosted runtime ensure-processing Activity input", [
    "orchestrationAttemptId",
    "reason",
    "source",
    "userId",
  ]);

  return {
    orchestrationAttemptId: requireOpaqueIdentifier(
      record.orchestrationAttemptId,
      "Hosted runtime ensure-processing Activity input orchestrationAttemptId",
    ),
    reason: parseHostedWorkspaceInvocationReason(
      record.reason,
      "Hosted runtime ensure-processing Activity input reason",
    ),
    ...(record.source === undefined || record.source === null
      ? {}
      : {
          source: parseEnsureRuntimeProcessingInputSource(record.source),
        }),
    userId: requireOpaqueIdentifier(
      record.userId,
      "Hosted runtime ensure-processing Activity input userId",
    ),
  };
}

function parseEnsureRuntimeProcessingInputSource(
  value: unknown,
): EnsureRuntimeProcessingInputSource {
  if (value === LEGACY_DEVICE_SYNC_RECOVERY_SOURCE) {
    return LEGACY_DEVICE_SYNC_RECOVERY_SOURCE;
  }
  return parseHostedRuntimeDemandRunSource(
    value,
    "Hosted runtime ensure-processing Activity input source",
  );
}

function buildCloudflareRuntimeEnsureProcessingPath(userId: string): string {
  return `${CLOUDFLARE_RUNTIME_ENSURE_PROCESSING_PATH_PREFIX}${encodeURIComponent(userId)}${
    CLOUDFLARE_RUNTIME_ENSURE_PROCESSING_PATH_SUFFIX
  }`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
