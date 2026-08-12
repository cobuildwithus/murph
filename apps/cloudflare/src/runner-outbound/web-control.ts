import { type readHostedExecutionEnvironment } from "../env.ts";
import {
  jsonError,
  methodNotAllowed,
  notFound,
  readRequestBodyText,
  unauthorized,
} from "../json.ts";
import { fetchHostedExecutionWebControlPlaneResponse } from "../web-control-plane.ts";
import {
  parseHostedWorkspaceCheckpointRequest,
  parseHostedWorkspaceCheckpointResponse,
} from "@murphai/hosted-execution/parsers";
import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import {
  HOSTED_VAULT_SHARE_DELIVERY_TRANSPORT_MARGIN_MS,
  HOSTED_VAULT_SHARE_EFFECT_DEADLINE_HEADER,
  parseHostedVaultShareEffectDeadlineAtEpochMs,
} from "@murphai/hosted-execution/vault-share";
import {
  HOSTED_RUNTIME_BROWSER_VAULT_REPLICA_PUBLISH_PATH,
  HOSTED_RUNTIME_USAGE_RECORD_PATH,
  HOSTED_RUNTIME_WORKSPACE_CHECKPOINT_PATH,
} from "@murphai/hosted-execution/routes";
import {
  createAssistantUsageReportingUserId,
} from "@murphai/hosted-execution/assistant-usage";
import {
  HOSTED_PHYSICAL_NOTE_SEND_TRANSPORT_TIMEOUT_MS,
} from "@murphai/hosted-execution/physical-notes";
import {
  HOSTED_RUNTIME_MAILBOX_PAYLOAD_DECODE_PATH,
} from "../runtime-mailbox-payload-decode-contract.ts";
import {
  requireRunnerRuntimeWriteFenceWrite,
  requireRunnerRuntimeWriteFenceWorkspaceWrite,
  RunnerRuntimeWriteFenceError,
  type RunnerRuntimeWriteFenceWriteAuthority,
  writeRunnerRuntimeWriteFenceHeaders,
} from "./write-fence.ts";
import {
  handleRunnerMailboxPayloadDecodeRequest,
} from "./mailbox-payload-decode.ts";
import {
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH,
  readHostedRunnerWebControlPolicy,
} from "./shared-web-control-policy.ts";
import {
  readHostedRunnerDiagnosticMethod,
  readHostedRunnerSafeResponseBodyMetadata,
} from "./diagnostics.ts";
import {
  type RunnerOutboundEnvironmentSource,
} from "./shared.ts";
import {
  HOSTED_RUNTIME_ATTEMPT_ID_HEADER,
  HOSTED_RUNTIME_LEASE_GENERATION_HEADER,
  HOSTED_WEB_CONTROL_FORWARDED_RESPONSE_HEADER,
} from "./headers.ts";

const HOSTED_RUNNER_WEB_CONTROL_BODY_LIMIT_BYTES = 256 * 1024;

export async function handleRunnerWebControlRequest(input: {
  env: RunnerOutboundEnvironmentSource;
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  request: Request;
  url: URL;
  userId: string;
}): Promise<Response> {
  const policy = readHostedRunnerWebControlPolicy({
    method: input.request.method,
    path: input.url.pathname,
  });
  const method = readHostedRunnerDiagnosticMethod(input.request.method);

  if (input.request.method !== "GET" && input.request.method !== "POST") {
    emitHostedExecutionStructuredLog({
      component: "runner",
      details: {
        method,
        operation: policy.operation,
        reason: "method_not_allowed",
      },
      level: "warn",
      message: "Hosted runner web-control request rejected.",
      phase: "wake.running",
    });
    return methodNotAllowed();
  }

  if (input.url.pathname === HOSTED_RUNTIME_MAILBOX_PAYLOAD_DECODE_PATH) {
    emitHostedExecutionStructuredLog({
      component: "runner",
      details: {
        method,
        operation: policy.operation,
        workerOwned: true,
      },
      message: "Hosted runner web-control request routed to worker-owned handler.",
      phase: "wake.running",
    });
    return await handleRunnerMailboxPayloadDecodeRequest({
      env: input.env,
      environment: input.environment,
      request: input.request,
      userId: input.userId,
    });
  }

  if (!policy.allowed) {
    emitHostedExecutionStructuredLog({
      component: "runner",
      details: {
        method,
        operation: policy.operation,
        reason: "not_allowlisted",
      },
      level: "warn",
      message: "Hosted runner web-control request rejected.",
      phase: "wake.running",
    });
    return notFound();
  }

  const isCheckpointRequest = input.url.pathname === HOSTED_RUNTIME_WORKSPACE_CHECKPOINT_PATH
    && input.request.method === "POST";
  const isBrowserVaultReplicaPublishRequest =
    input.url.pathname === HOSTED_RUNTIME_BROWSER_VAULT_REPLICA_PUBLISH_PATH
    && input.request.method === "POST";
  const isDeviceSyncRuntimeSnapshotRequest =
    input.url.pathname === HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH
    && input.request.method === "POST";
  const isVaultShareDeliveryRequest =
    policy.operation === "vault_share_deliver"
    && input.request.method === "POST";
  const vaultShareEffectDeadlineAtEpochMs = isVaultShareDeliveryRequest
    ? parseHostedVaultShareEffectDeadlineAtEpochMs(
      input.request.headers.get(HOSTED_VAULT_SHARE_EFFECT_DEADLINE_HEADER),
    )
    : null;
  const isClinicalRecordsRequest = (
    policy.operation === "clinical_records_connect_link"
    || policy.operation === "clinical_records_fetch_page"
    || policy.operation === "clinical_records_read_run"
    || policy.operation === "clinical_records_record_outcome"
  ) && input.request.method === "POST";
  let writeAuthority: RunnerRuntimeWriteFenceWriteAuthority;
  try {
    writeAuthority = await (
      isBrowserVaultReplicaPublishRequest
        ? requireRunnerRuntimeWriteFenceWorkspaceWrite({
          env: input.env,
          request: input.request,
          userId: input.userId,
        })
        : requireRunnerRuntimeWriteFenceWrite({
          env: input.env,
          request: input.request,
          userId: input.userId,
        })
    );
  } catch (error) {
    if (error instanceof RunnerRuntimeWriteFenceError) {
      return unauthorized();
    }
    throw error;
  }

  let body: string | undefined;
  try {
    body = input.request.method === "POST"
      ? await readOptionalHostedRunnerWebControlBody(input.request)
      : undefined;
    body = augmentHostedRunnerWebControlBody({
      body,
      env: input.env,
      includeDeviceSyncCredentialMaterial: isDeviceSyncRuntimeSnapshotRequest,
      path: input.url.pathname,
      userId: input.userId,
    });
  } catch (error) {
    if (error instanceof RangeError) {
      return jsonError("Request body too large.", 413);
    }
    throw error;
  }
  const checkpointRequest = isCheckpointRequest
    ? parseHostedWorkspaceCheckpointRequest(JSON.parse(body ?? "{}"))
    : null;
  if (
    checkpointRequest
    && (
      writeAuthority.attemptId !== checkpointRequest.attemptId
      || writeAuthority.generation !== checkpointRequest.leaseGeneration
      || (
        writeAuthority.workspaceVersion !== null
        && writeAuthority.workspaceVersion !== checkpointRequest.expectedWorkspaceVersion
      )
    )
  ) {
    return unauthorized();
  }

  emitHostedExecutionStructuredLog({
    component: "runner",
    details: {
      allowHttpHostCount: input.environment.hostedWebAllowHttpHosts?.length ?? 0,
      bodyPresent: body !== undefined,
      callbackSigningConfigured: input.environment.webCallbackSigning !== null,
      ...readHostedWebBaseUrlLogDetails(input.environment.hostedWebBaseUrl),
      method,
      operation: policy.operation,
      searchPresent: input.url.search.length > 0,
      workspaceCheckpoint: isCheckpointRequest,
    },
    message: "Hosted runner web-control request forwarding.",
    phase: "wake.running",
  });
  const forwardHeaders = createRunnerRuntimeWriteFenceForwardHeaders(
    writeAuthority,
    checkpointRequest?.expectedWorkspaceVersion ?? writeAuthority.workspaceVersion,
  );
  if (vaultShareEffectDeadlineAtEpochMs !== null) {
    forwardHeaders.set(
      HOSTED_VAULT_SHARE_EFFECT_DEADLINE_HEADER,
      String(vaultShareEffectDeadlineAtEpochMs),
    );
  }
  const response = await fetchHostedExecutionWebControlPlaneResponse({
    ...(input.environment.hostedWebAllowHttpHosts
      ? { allowHttpHosts: input.environment.hostedWebAllowHttpHosts }
      : {}),
    baseUrl: input.environment.hostedWebBaseUrl,
    body,
    boundUserId: input.userId,
    callbackSigning: input.environment.webCallbackSigning,
    method: input.request.method,
    path: input.url.pathname,
    search: input.url.search || null,
    headers: forwardHeaders,
    timeoutMs: policy.operation === "physical_note_send"
      ? Math.max(
        input.environment.webControlTimeoutMs,
        HOSTED_PHYSICAL_NOTE_SEND_TRANSPORT_TIMEOUT_MS,
      )
      : isVaultShareDeliveryRequest
      ? Math.max(
        1,
        requireHostedVaultShareSettlementDeadlineAtEpochMs(
          vaultShareEffectDeadlineAtEpochMs,
        ) - Date.now(),
      )
      : input.environment.webControlTimeoutMs,
  });
  const responseBodyMetadata = response.ok || isClinicalRecordsRequest
    ? {}
    : await readHostedRunnerSafeResponseBodyMetadata(response.clone());
  emitHostedExecutionStructuredLog({
    component: "runner",
    details: {
      contentTypePresent: response.headers.has("content-type"),
      method,
      operation: policy.operation,
      ...responseBodyMetadata,
      responseOk: response.ok,
      responseStatus: response.status,
      responseType: response.type,
      workspaceCheckpoint: isCheckpointRequest,
    },
    level: response.ok ? "info" : "warn",
    message: "Hosted runner web-control response received.",
    phase: "wake.running",
  });
  if (checkpointRequest && response.ok) {
    try {
      parseHostedWorkspaceCheckpointResponse(await response.clone().json());
    } catch {
      return jsonError("Hosted workspace checkpoint response was invalid.", 502);
    }
  }

  if (!isVaultShareDeliveryRequest) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set(HOSTED_WEB_CONTROL_FORWARDED_RESPONSE_HEADER, "1");
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

function requireHostedVaultShareSettlementDeadlineAtEpochMs(
  effectDeadlineAtEpochMs: number | null,
): number {
  if (effectDeadlineAtEpochMs === null) {
    throw new TypeError("Hosted vault-share effect deadline is missing.");
  }
  return effectDeadlineAtEpochMs
    + HOSTED_VAULT_SHARE_DELIVERY_TRANSPORT_MARGIN_MS;
}

function createRunnerRuntimeWriteFenceForwardHeaders(
  writeAuthority: RunnerRuntimeWriteFenceWriteAuthority,
  workspaceVersion: string | null,
): Headers {
  const headers = new Headers();
  if (workspaceVersion) {
    writeRunnerRuntimeWriteFenceHeaders(headers, {
      attemptId: writeAuthority.attemptId,
      generation: writeAuthority.generation,
      workspaceVersion,
    });
    return headers;
  }
  headers.set(HOSTED_RUNTIME_ATTEMPT_ID_HEADER, writeAuthority.attemptId);
  headers.set(HOSTED_RUNTIME_LEASE_GENERATION_HEADER, writeAuthority.generation);
  return headers;
}

function readHostedWebBaseUrlLogDetails(value: string): {
  hostedWebBaseUrlHost: string | null;
  hostedWebBaseUrlProtocol: string;
} {
  try {
    const url = new URL(value);
    return {
      hostedWebBaseUrlHost: url.hostname,
      hostedWebBaseUrlProtocol: url.protocol.replace(/:$/u, ""),
    };
  } catch {
    return {
      hostedWebBaseUrlHost: null,
      hostedWebBaseUrlProtocol: "invalid",
    };
  }
}

function augmentHostedRunnerWebControlBody(input: {
  body: string | undefined;
  env: RunnerOutboundEnvironmentSource;
  includeDeviceSyncCredentialMaterial: boolean;
  path: string;
  userId: string;
}): string | undefined {
  if (
    input.body !== undefined
    && input.includeDeviceSyncCredentialMaterial
    && input.path === HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH
  ) {
    return forceHostedRunnerRuntimeSnapshotCredentialMaterial(input.body);
  }

  if (
    input.body === undefined
    || input.path !== HOSTED_RUNTIME_USAGE_RECORD_PATH
  ) {
    return input.body;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(input.body);
  } catch {
    return input.body;
  }
  if (!isHostedRunnerRecord(payload)) {
    return input.body;
  }

  const reportingUserId = createAssistantUsageReportingUserId({
    memberId: input.userId,
    reportingSecret: readRunnerStringEnv(input.env, "HOSTED_AI_USAGE_REPORTING_SECRET"),
  });

  return JSON.stringify({
    ...payload,
    usage: {
      ...payload.usage,
      reportingUserId: reportingUserId ?? null,
    },
  });
}

function forceHostedRunnerRuntimeSnapshotCredentialMaterial(body: string): string {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return body;
  }
  if (!isJsonObject(payload)) {
    return body;
  }

  return JSON.stringify({
    ...payload,
    includeCredentialMaterial:
      typeof payload.includeCredentialMaterial === "boolean"
        ? payload.includeCredentialMaterial
        : true,
  });
}

async function readOptionalHostedRunnerWebControlBody(request: Request): Promise<string | undefined> {
  const bodyText = await readRequestBodyText(request, {
    limitBytes: HOSTED_RUNNER_WEB_CONTROL_BODY_LIMIT_BYTES,
  });
  return bodyText.length > 0 ? bodyText : undefined;
}

function isHostedRunnerRecord(value: unknown): value is {
  usage: Record<string, unknown>;
} {
  return isJsonObject(value)
    && typeof (value as { usage?: unknown }).usage === "object"
    && (value as { usage?: unknown }).usage !== null
    && !Array.isArray((value as { usage?: unknown }).usage);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value);
}

function readRunnerStringEnv(
  env: RunnerOutboundEnvironmentSource,
  key: string,
): string | null {
  const value = env[key];
  return typeof value === "string" && value.trim() ? value : null;
}
