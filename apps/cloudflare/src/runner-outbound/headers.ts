import {
  HOSTED_RUNTIME_ARTIFACT_READ_PURPOSES,
  type HostedRuntimeArtifactReadPurpose,
  HOSTED_RUNTIME_MEDIA_READ_PURPOSES,
  type HostedRuntimeMediaReadPurpose,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";

export const HOSTED_RUNNER_BOUND_USER_ID_HEADER =
  "x-hosted-runner-bound-user-id";
export const HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER =
  "x-hosted-execution-runner-proxy-token";
export const HOSTED_PROVIDER_EGRESS_TOKEN_HEADER =
  "x-hosted-provider-egress-token";
export const HOSTED_RUNTIME_ATTEMPT_ID_HEADER =
  "x-hosted-runtime-attempt-id";
export const HOSTED_RUNTIME_LEASE_GENERATION_HEADER =
  "x-hosted-runtime-lease-generation";
export const HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER =
  "x-hosted-runtime-workspace-version";
export const HOSTED_WEB_CONTROL_FORWARDED_RESPONSE_HEADER =
  "x-hosted-web-control-forwarded-response";
export const HOSTED_RUNTIME_ARTIFACT_READ_PURPOSE_HEADER =
  "x-hosted-runtime-artifact-read-purpose";
export const HOSTED_RUNTIME_ARTIFACT_FETCH_CORRELATION_ID_HEADER =
  "x-hosted-runtime-artifact-fetch-correlation-id";
export const HOSTED_RUNTIME_MEDIA_READ_PURPOSE_HEADER =
  "x-hosted-runtime-media-read-purpose";
export const HOSTED_RUNTIME_MEDIA_FETCH_CORRELATION_ID_HEADER =
  "x-hosted-runtime-media-fetch-correlation-id";
export const HOSTED_RUNTIME_MEDIA_BYTE_SIZE_HEADER =
  "x-hosted-runtime-media-byte-size";
export const HOSTED_RUNTIME_MEDIA_KIND_HEADER =
  "x-hosted-runtime-media-kind";
export const HOSTED_RUNTIME_MEDIA_SHA256_HEADER =
  "x-hosted-runtime-media-sha256";
export const HOSTED_RUNTIME_MEDIA_EXPIRES_AT_HEADER =
  "x-hosted-runtime-media-expires-at";

const HOSTED_RUNTIME_ARTIFACT_READ_PURPOSE_SET = new Set<string>(
  HOSTED_RUNTIME_ARTIFACT_READ_PURPOSES,
);
const HOSTED_RUNTIME_MEDIA_READ_PURPOSE_SET = new Set<string>(
  HOSTED_RUNTIME_MEDIA_READ_PURPOSES,
);
const HOSTED_RUNTIME_ARTIFACT_FETCH_CORRELATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export interface HostedRuntimeArtifactFetchTelemetry {
  correlationId: string;
  purpose: HostedRuntimeArtifactReadPurpose;
}

export interface HostedRuntimeMediaFetchTelemetry {
  correlationId: string;
  purpose: HostedRuntimeMediaReadPurpose;
}

export function readHostedRuntimeArtifactFetchTelemetry(
  headers: Headers,
): HostedRuntimeArtifactFetchTelemetry | null {
  const purpose = headers.get(HOSTED_RUNTIME_ARTIFACT_READ_PURPOSE_HEADER);
  const correlationId = headers.get(
    HOSTED_RUNTIME_ARTIFACT_FETCH_CORRELATION_ID_HEADER,
  );
  if (
    !purpose
    || !isHostedRuntimeArtifactReadPurpose(purpose)
    || !correlationId
    || !HOSTED_RUNTIME_ARTIFACT_FETCH_CORRELATION_ID_PATTERN.test(correlationId)
  ) {
    return null;
  }
  return {
    correlationId,
    purpose,
  };
}

export function readHostedRuntimeMediaFetchTelemetry(
  headers: Headers,
): HostedRuntimeMediaFetchTelemetry | null {
  const purpose = headers.get(HOSTED_RUNTIME_MEDIA_READ_PURPOSE_HEADER);
  const correlationId = headers.get(
    HOSTED_RUNTIME_MEDIA_FETCH_CORRELATION_ID_HEADER,
  );
  if (
    !purpose
    || !isHostedRuntimeMediaReadPurpose(purpose)
    || !correlationId
    || !HOSTED_RUNTIME_ARTIFACT_FETCH_CORRELATION_ID_PATTERN.test(correlationId)
  ) {
    return null;
  }
  return {
    correlationId,
    purpose,
  };
}

function isHostedRuntimeArtifactReadPurpose(
  value: string,
): value is HostedRuntimeArtifactReadPurpose {
  return HOSTED_RUNTIME_ARTIFACT_READ_PURPOSE_SET.has(value);
}

function isHostedRuntimeMediaReadPurpose(
  value: string,
): value is HostedRuntimeMediaReadPurpose {
  return HOSTED_RUNTIME_MEDIA_READ_PURPOSE_SET.has(value);
}
