import type {
  HostedRuntimePrewarmRequest,
  HostedRuntimePrewarmResponse,
  HostedRuntimePrewarmSource,
} from "@murphai/hosted-execution/orchestration-control";
import {
  parseHostedRuntimePrewarmRequest,
  parseHostedRuntimePrewarmResponse,
} from "@murphai/hosted-execution/parsers";

import {
  observeHostedTemporalActivity,
  readHostedOrchestratorTemporalCloudflareEnvironment,
  requestHostedOrchestratorJson,
} from "./http-client.js";

export interface PrewarmRuntimeContainerInput {
  prewarmAttemptId: string;
  source: HostedRuntimePrewarmSource;
  userId: string;
}

const CLOUDFLARE_RUNTIME_PREWARM_PATH_PREFIX = "/internal/users/";
const CLOUDFLARE_RUNTIME_PREWARM_PATH_SUFFIX = "/runtime/prewarm";
const PREWARM_RUNTIME_CONTAINER_HTTP_TIMEOUT_MS = 5_000;

export async function prewarmRuntimeContainer(
  request: PrewarmRuntimeContainerInput,
): Promise<HostedRuntimePrewarmResponse> {
  const parsedRequest = parsePrewarmRuntimeContainerInput(request);
  const cloudflareEnvironment = readHostedOrchestratorTemporalCloudflareEnvironment();
  const cloudflareRequest = parseHostedRuntimePrewarmRequest({
    prewarmAttemptId: parsedRequest.prewarmAttemptId,
    source: parsedRequest.source,
  } satisfies HostedRuntimePrewarmRequest);

  return observeHostedTemporalActivity({
    activity: "prewarmRuntimeContainer",
    prewarmAttemptId: parsedRequest.prewarmAttemptId,
    reason: parsedRequest.source,
    userId: parsedRequest.userId,
  }, async () =>
    requestHostedOrchestratorJson(
      cloudflareEnvironment.cloudflareHostedControlBaseUrl,
      {
        body: JSON.stringify(cloudflareRequest),
        boundUserId: parsedRequest.userId,
        label: "runtime prewarm",
        method: "POST",
        parse: parseHostedRuntimePrewarmResponse,
        path: buildCloudflareRuntimePrewarmPath(parsedRequest.userId),
        signing: cloudflareEnvironment.cloudflareHostedControlSigning,
        timeoutMs: Math.min(
          cloudflareEnvironment.ensureRuntimeProcessingHttpTimeoutMs,
          PREWARM_RUNTIME_CONTAINER_HTTP_TIMEOUT_MS,
        ),
      },
    )
  );
}

function parsePrewarmRuntimeContainerInput(
  value: unknown,
): PrewarmRuntimeContainerInput {
  if (!isRecord(value)) {
    throw new TypeError("Hosted runtime prewarm Activity input must be an object.");
  }

  const record = value;
  assertExactKeys(record, "Hosted runtime prewarm Activity input", [
    "prewarmAttemptId",
    "source",
    "userId",
  ]);

  const prewarmRequest = parseHostedRuntimePrewarmRequest({
    prewarmAttemptId: record.prewarmAttemptId,
    source: record.source,
  });

  return {
    prewarmAttemptId: prewarmRequest.prewarmAttemptId,
    source: prewarmRequest.source,
    userId: requireOpaqueIdentifier(
      record.userId,
      "Hosted runtime prewarm Activity input userId",
    ),
  };
}

function buildCloudflareRuntimePrewarmPath(userId: string): string {
  return `${CLOUDFLARE_RUNTIME_PREWARM_PATH_PREFIX}${encodeURIComponent(userId)}${
    CLOUDFLARE_RUNTIME_PREWARM_PATH_SUFFIX
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
