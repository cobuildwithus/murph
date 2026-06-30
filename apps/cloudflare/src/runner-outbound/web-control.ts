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
  HOSTED_RUNTIME_ACTION_APPROVAL_CONSUME_PATH,
  HOSTED_RUNTIME_ACTION_APPROVAL_REQUEST_PATH,
  HOSTED_RUNTIME_BROWSER_VAULT_REPLICA_PUBLISH_PATH,
  HOSTED_RUNTIME_LATENCY_TRACE_PATH,
  HOSTED_RUNTIME_USAGE_RECORD_PATH,
  HOSTED_RUNTIME_VAULT_SHARE_DELIVER_PATH,
  HOSTED_RUNTIME_WORKSPACE_CHECKPOINT_PATH,
} from "@murphai/hosted-execution/routes";
import {
  createAssistantUsageReportingUserId,
} from "@murphai/hosted-execution/assistant-usage";
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

  const isActionApprovalRequest =
    input.url.pathname === HOSTED_RUNTIME_ACTION_APPROVAL_REQUEST_PATH
    && input.request.method === "POST";
  const isActionApprovalConsume =
    input.url.pathname === HOSTED_RUNTIME_ACTION_APPROVAL_CONSUME_PATH
    && input.request.method === "POST";
  const isCheckpointRequest = input.url.pathname === HOSTED_RUNTIME_WORKSPACE_CHECKPOINT_PATH
    && input.request.method === "POST";
  const isBrowserVaultReplicaPublishRequest =
    input.url.pathname === HOSTED_RUNTIME_BROWSER_VAULT_REPLICA_PUBLISH_PATH
    && input.request.method === "POST";
  const isDeviceSyncRuntimeSnapshotRequest =
    input.url.pathname === HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH
    && input.request.method === "POST";
  const isRuntimeLatencyTraceRequest =
    input.url.pathname === HOSTED_RUNTIME_LATENCY_TRACE_PATH
    && input.request.method === "POST";
  const isLinqEgressEngagementRequest = policy.operation === "linq_egress_engagement"
    && input.request.method === "POST";
  const isLinqDeliveryOutcomeRequest = policy.operation === "linq_delivery_outcome"
    && input.request.method === "POST";
  const isVaultShareDeliverRequest =
    input.url.pathname === HOSTED_RUNTIME_VAULT_SHARE_DELIVER_PATH
    && input.request.method === "POST";
  const isComputerUseRequest = policy.operation === "computer_use"
    && input.request.method === "POST";
  const isConnectedAppsRequest = policy.operation === "connected_apps"
    && input.request.method === "POST";
  const isCodexAuthUpdateRequest = policy.operation === "codex_auth_update"
    && input.request.method === "POST";
  const isPhoneCallStartRequest = policy.operation === "phone_call_start"
    && input.request.method === "POST";
  const isLinqContactCardShareAfterOutboundRequest =
    policy.operation === "linq_contact_card_share_after_outbound"
    && input.request.method === "POST";
  let writeAuthority: RunnerRuntimeWriteFenceWriteAuthority | null =
    null;
  if (
    isActionApprovalRequest
    || isActionApprovalConsume
    || isCheckpointRequest
    || isBrowserVaultReplicaPublishRequest
    || isDeviceSyncRuntimeSnapshotRequest
    || isRuntimeLatencyTraceRequest
    || isLinqDeliveryOutcomeRequest
    || isLinqEgressEngagementRequest
    || isVaultShareDeliverRequest
    || isComputerUseRequest
    || isConnectedAppsRequest
    || isCodexAuthUpdateRequest
    || isLinqContactCardShareAfterOutboundRequest
    || isPhoneCallStartRequest
  ) {
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
  }

  let body: string | undefined;
  try {
    body = input.request.method === "POST"
      ? await readOptionalHostedRunnerWebControlBody(input.request)
      : undefined;
    body = augmentHostedRunnerWebControlBody({
      body,
      env: input.env,
      includeDeviceSyncCredentialMaterial: isDeviceSyncRuntimeSnapshotRequest
        && writeAuthority !== null,
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
    writeAuthority
    && checkpointRequest
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
    headers: writeAuthority
      ? createRunnerRuntimeWriteFenceForwardHeaders(
        writeAuthority,
        checkpointRequest?.expectedWorkspaceVersion ?? writeAuthority.workspaceVersion,
      )
      : undefined,
    timeoutMs: input.environment.webControlTimeoutMs,
  });
  const responseBodyMetadata = response.ok
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
    if (!writeAuthority) {
      return unauthorized();
    }
    try {
      parseHostedWorkspaceCheckpointResponse(await response.clone().json());
    } catch {
      return unauthorized();
    }
  }

  return response;
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
    includeCredentialMaterial: true,
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
