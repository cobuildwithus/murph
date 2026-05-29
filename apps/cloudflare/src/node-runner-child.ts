import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  createCoalescingRuntimeWakeSignal,
  HostedWorkspaceRuntimeJobWorkspaceVersionMismatchError,
  runHostedWorkspaceRuntimeJobInProcess,
  type RuntimeWakeSignal,
} from "@murphai/assistant-runtime";
import {
  readHostedRunnerCommitTimeoutMs,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  buildHostedExecutionSafeErrorDetails,
  deriveHostedExecutionErrorCode,
  emitHostedExecutionStructuredLog,
  extractHostedAssistantNotificationRedactedDetails,
  readHostedExecutionSafeErrorName,
  type HostedExecutionStructuredLogDetails,
} from "@murphai/hosted-execution";

import {
  buildHostedExecutionRuntimePlatform,
  createCloudflareHostedProviderFetch,
  isHostedRuntimeInternalAuthorityRejectedError,
  readHostedRuntimeControlPlaneFetchFailureDiagnostics,
  readHostedWorkspaceSnapshotRestoreStep,
} from "./runtime-platform.js";
import {
  readHostedWorkspaceSnapshotProcessFailureDiagnostics,
} from "./workspace-snapshot-local.js";
import {
  createHostedRuntimeBridgeLeaseFromWorkspaceRequest,
  createHostedWorkspaceRuntimeBridgeJobOptions,
} from "./runtime-bridge-workspace.js";
import {
  readHostedBundleArchiveValidationErrorDetails,
} from "./hosted-bundle-validation.js";
import {
  createCloudflareHostedMailboxPayloadDecoder,
} from "./runtime-bridge-mailbox-payload-decode.js";
import {
  createHostedExecutionRunnerChildResultMessage,
  createHostedExecutionRunnerChildRuntimeWakeReadyMessage,
  isHostedExecutionRunnerChildRuntimeWakeMessage,
  parseHostedExecutionRunnerJobInput,
  readHostedExecutionRunnerJobUserId,
  type HostedExecutionRunnerChildResult,
  type HostedExecutionWorkspaceInvocationJobInput,
} from "./runner-job-transport.js";
import {
  redactHostedRuntimeDiagnosticDetails,
  redactHostedRuntimeDiagnosticText,
} from "./hosted-runtime-redaction.js";
import {
  CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS,
  CLOUDFLARE_HOSTED_RUNTIME_HOSTS,
} from "./internal-hosts.js";
import {
  classifyHostedExecutionChildRuntimeErrorMessageKind,
  readHostedExecutionChildRuntimeErrorName,
  type HostedExecutionChildRuntimeFailureKind,
  type HostedExecutionChildRuntimeHttpOperation,
  type HostedExecutionChildRuntimeStage,
} from "./runner-child-diagnostics.js";
import {
  LOCAL_CONTAINER_HTTP_WEB_CONTROL_HOSTS,
} from "./web-control-plane.js";
import {
  assertNoHostedRunnerDeprecatedCodexAppServerProxyEnv,
  hasHostedRunnerModelCredential,
  isHostedRunnerOpenAiProvider,
} from "./hosted-env-policy.ts";

interface HostedExecutionChildDependencies {
  emitLog?: typeof emitHostedExecutionStructuredLog;
  readStandardInput?: () => Promise<string>;
  runWorkspaceInProcess?: typeof runHostedWorkspaceRuntimeJobInProcess;
  sendResult?: (payload: HostedExecutionRunnerChildResult) => void;
  sendRuntimeWakeReady?: () => void;
  setExitCode?: (value: number) => void;
}

interface HostedExecutionChildInput {
  job: HostedExecutionWorkspaceInvocationJobInput;
}

const HOSTED_EXECUTION_CHILD_RUNTIME_TYPE_ERROR_FAILURES = new Map<
  string,
  HostedExecutionChildRuntimeFailureKind
>([
  ["Hosted assistant runtime platform must be injected.", "missing_runtime_platform"],
  ["Hosted workspace runtime job workspace port must be injected.", "missing_workspace_port"],
  ["Hosted workspace runtime job workspace port must support read.", "invalid_workspace_port"],
  ["Hosted workspace runtime job mailbox port must be injected.", "missing_mailbox_port"],
  ["Hosted workspace runtime bridge requires an explicit vault root.", "missing_vault_root"],
  ["Hosted workspace runtime bridge vault root must be absolute.", "relative_vault_root"],
]);

const HOSTED_EXECUTION_CHILD_RUNTIME_ERROR_MESSAGE_FAILURES = new Map<
  string,
  HostedExecutionChildRuntimeFailureKind
>([
  ["Hosted mailbox payload decode returned invalid JSON.", "mailbox_payload_decode_invalid_json"],
  [
    "Hosted mailbox payload decode requires a runtime write fence.",
    "mailbox_payload_decode_missing_write_fence",
  ],
]);

const HOSTED_EXECUTION_CHILD_RUNTIME_HTTP_OPERATION_PATTERNS: ReadonlyArray<{
  operation: HostedExecutionChildRuntimeHttpOperation;
  pattern: RegExp;
}> = [
  { operation: "artifact_fetch", pattern: /^Hosted artifact fetch(?:\b| )/u },
  { operation: "artifact_upload", pattern: /^Hosted artifact upload(?:\b| )/u },
  {
    operation: "assistant_runtime_issue_export",
    pattern: /^Hosted assistant runtime issue export$/u,
  },
  {
    operation: "browser_vault_replica_publish",
    pattern: /^Hosted browser-vault replica publish$/u,
  },
  {
    operation: "browser_vault_replica_write",
    pattern: /^Hosted browser-vault replica write$/u,
  },
  {
    operation: "device_sync_connect_link",
    pattern: /^Hosted device-sync connect link /u,
  },
  { operation: "device_sync_dirty_ack", pattern: /^Hosted device-sync dirty ack$/u },
  {
    operation: "device_sync_pending_dirty_state",
    pattern: /^Hosted device-sync pending dirty state$/u,
  },
  {
    operation: "device_sync_runtime_apply",
    pattern: /^Hosted device-sync runtime apply$/u,
  },
  {
    operation: "device_sync_runtime_snapshot",
    pattern: /^Hosted device-sync runtime snapshot$/u,
  },
  { operation: "email_send", pattern: /^Hosted email send$/u },
  { operation: "mailbox_fetch", pattern: /^Hosted mailbox fetch$/u },
  {
    operation: "mailbox_payload_decode",
    pattern: /^Hosted mailbox payload decode$/u,
  },
  {
    operation: "mailbox_payload_fetch",
    pattern: /^Hosted mailbox payload fetch$/u,
  },
  { operation: "raw_email_read", pattern: /^Hosted raw email read$/u },
  {
    operation: "runtime_crypto_context_fetch",
    pattern: /^Hosted runtime crypto context fetch$/u,
  },
  {
    operation: "runtime_crypto_root_fetch",
    pattern: /^Hosted runtime crypto root fetch$/u,
  },
  {
    operation: "runtime_internal_request",
    pattern: /^Hosted runtime internal request to /u,
  },
  { operation: "runtime_latency_trace", pattern: /^Hosted runtime latency trace$/u },
  { operation: "runtime_log_write", pattern: /^Hosted runtime log write$/u },
  {
    operation: "telegram_file_download",
    pattern: /^Hosted Telegram file download$/u,
  },
  { operation: "telegram_file_lookup", pattern: /^Hosted Telegram file lookup$/u },
  { operation: "usage_recording", pattern: /^Hosted usage recording$/u },
  { operation: "workspace_checkpoint", pattern: /^Hosted workspace checkpoint$/u },
  {
    operation: "workspace_snapshot_complete",
    pattern: /^Hosted workspace snapshot complete$/u,
  },
  {
    operation: "workspace_snapshot_data_key_unwrap",
    pattern: /^Hosted workspace snapshot data key unwrap$/u,
  },
  {
    operation: "workspace_snapshot_direct_r2_upload",
    pattern: /^Hosted workspace snapshot direct R2 upload$/u,
  },
  {
    operation: "workspace_snapshot_fetch",
    pattern: /^Hosted workspace snapshot fetch(?:\b| )/u,
  },
  {
    operation: "workspace_snapshot_presign_get",
    pattern: /^Hosted workspace snapshot presign download$/u,
  },
  {
    operation: "workspace_snapshot_presign_put",
    pattern: /^Hosted workspace snapshot presign PUT$/u,
  },
  {
    operation: "workspace_snapshot_session_abort",
    pattern: /^Hosted workspace snapshot session abort$/u,
  },
  {
    operation: "workspace_snapshot_session_start",
    pattern: /^Hosted workspace snapshot session start$/u,
  },
  { operation: "workspace_read", pattern: /^Hosted workspace read$/u },
];

export async function runHostedExecutionChild(
  dependencies: HostedExecutionChildDependencies = {},
): Promise<void> {
  const emitLog = dependencies.emitLog ?? emitHostedExecutionStructuredLog;
  const readInput = dependencies.readStandardInput ?? readStandardInput;
  const runWorkspaceInProcess =
    dependencies.runWorkspaceInProcess ?? runHostedWorkspaceRuntimeJobInProcess;
  const sendResult = dependencies.sendResult ?? sendHostedExecutionRunnerChildResult;
  const sendRuntimeWakeReady =
    dependencies.sendRuntimeWakeReady ?? sendHostedExecutionRunnerChildRuntimeWakeReady;
  const setExitCode = dependencies.setExitCode ?? ((value: number) => {
    process.exitCode = value;
  });
  let runtimeStage: HostedExecutionChildRuntimeStage = "runtime.not-started";

  let input: HostedExecutionChildInput;
  try {
    input = parseHostedExecutionChildInput(parseJsonValue(await readInput()));
  } catch (error) {
    const safeErrorDetails = buildHostedExecutionSafeErrorDetails(error);
    emitLog({
      component: "child",
      details: {
        bootstrapStage: "parse",
        ...(safeErrorDetails ? { bootstrapErrorDetails: safeErrorDetails } : {}),
      },
      error,
      level: "error",
      message: "Hosted node runner child failed to parse its bootstrap payload.",
      phase: "failed",
    });
    setExitCode(1);
    sendResult({
      ok: false,
      error: createHostedExecutionChildBootstrapError(error),
    });
    return;
  }

  const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
  const removeRuntimeWakeListener =
    addHostedExecutionRunnerChildRuntimeWakeListener(runtimeWakeSignal);
  sendRuntimeWakeReady();

  try {
    const childRunDiagnostics = buildHostedRunnerChildRuntimeDiagnostics(input);
    assertNoHostedRunnerDeprecatedCodexAppServerProxyEnv(
      input.job.runtime?.forwardedEnv ?? {},
    );
    assertNoHostedRunnerDeprecatedCodexAppServerProxyEnv(
      input.job.runtime?.userEnv ?? {},
    );
    emitLog({
      component: "child",
      details: childRunDiagnostics,
      message: "Hosted node runner child prepared workspace invocation.",
      phase: "runtime.starting",
      userId: readHostedExecutionRunnerJobUserId(input.job),
    });
    emitHostedRunnerChildDebug({
      stage: "before-run",
      payload: childRunDiagnostics,
    });
    const result = await runWorkspaceChildJob({
      job: input.job,
      noteRuntimeStage: (stage) => {
        runtimeStage = stage;
      },
      runWorkspaceInProcess,
      runtimeWakeSignal,
    });
    emitHostedRunnerChildDebug({
      stage: "after-run",
      payload: {
        resultPhase: "phase" in result ? result.phase ?? null : null,
      },
    });
    sendResult({ ok: true, result });
  } catch (error) {
    emitHostedRunnerChildDebug({
      stage: "run-error",
      payload: {
        errorMessage: readHostedRuntimeChildErrorMessage(error),
        errorName: error instanceof Error ? error.name : null,
      },
    });
    const serializedError = createHostedExecutionChildRuntimeError(error, {
      runtimeStage,
    });
    setExitCode(1);
    sendResult({
      ok: false,
      error: serializedError,
    });
  } finally {
    removeRuntimeWakeListener();
  }
}

function sendHostedExecutionRunnerChildResult(
  payload: HostedExecutionRunnerChildResult,
): void {
  if (typeof process.send !== "function") {
    throw new Error("Hosted node runner child requires an IPC result channel.");
  }

  process.send(createHostedExecutionRunnerChildResultMessage(payload));
}

function sendHostedExecutionRunnerChildRuntimeWakeReady(): void {
  if (typeof process.send !== "function") {
    throw new Error("Hosted node runner child requires an IPC runtime wake channel.");
  }

  process.send(createHostedExecutionRunnerChildRuntimeWakeReadyMessage());
}

function addHostedExecutionRunnerChildRuntimeWakeListener(
  runtimeWakeSignal: RuntimeWakeSignal,
): () => void {
  const listener = (message: unknown) => {
    if (isHostedExecutionRunnerChildRuntimeWakeMessage(message)) {
      runtimeWakeSignal.notify();
    }
  };
  process.on("message", listener);
  return () => process.off("message", listener);
}

async function runWorkspaceChildJob(input: {
  job: HostedExecutionWorkspaceInvocationJobInput;
  noteRuntimeStage: (stage: HostedExecutionChildRuntimeStage) => void;
  runWorkspaceInProcess: typeof runHostedWorkspaceRuntimeJobInProcess;
  runtimeWakeSignal: RuntimeWakeSignal;
}) {
  let currentLease = createHostedRuntimeBridgeLeaseFromWorkspaceRequest(input.job.request);
  const boundUserId = readHostedExecutionRunnerJobUserId(input.job);
  input.noteRuntimeStage("bridge.platform");
  const platform = buildHostedExecutionRuntimePlatform({
    boundUserId,
    commitTimeoutMs: input.job.runtime?.commitTimeoutMs ?? null,
    proxyBoundUserIdHeader: true,
    workspaceCheckpointBridge: {
      readCurrentLease: () => currentLease,
      recordCheckpoint: ({ workspaceVersion }) => {
        currentLease = {
          ...currentLease,
          workspaceVersion,
        };
      },
    },
  });
  input.noteRuntimeStage("bridge.web-control-fetch");
  const webControlFetch = createCloudflareHostedProviderFetch(
    boundUserId,
    fetch,
    {
      injectBoundUserIdHeader: true,
      readCurrentLease: () => currentLease,
    },
  );
  input.noteRuntimeStage("bridge.mailbox-decoder");
  const decodeMailboxPayload = createCloudflareHostedMailboxPayloadDecoder({
    fetchImpl: webControlFetch,
    readCurrentLease: () => currentLease,
    timeoutMs: readHostedRunnerCommitTimeoutMs(input.job.runtime?.commitTimeoutMs ?? null),
  });

  input.noteRuntimeStage("bridge.options");
  const jobOptions = createHostedWorkspaceRuntimeBridgeJobOptions({
    decodeMailboxPayload,
    platform,
    requireMailboxPayloadDecoder: true,
    request: input.job.request,
    runtime: input.job.runtime ?? {},
    snapshotDiagnosticsHashSecret:
      input.job.diagnostics?.workspaceSnapshotPathHashSecret ?? null,
    vaultRoot: resolveHostedWorkspaceChildVaultRoot(),
    webControlAllowHttpHosts: [
      CLOUDFLARE_HOSTED_RUNTIME_HOSTS.webControlPlane,
      ...LOCAL_CONTAINER_HTTP_WEB_CONTROL_HOSTS,
    ],
    webControlBaseUrl: CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.webControlPlane,
    webControlFetch,
  });

  input.noteRuntimeStage("runtime.in-process");
  return await input.runWorkspaceInProcess(input.job, {
    ...jobOptions,
    runtimeWakeSignal: input.runtimeWakeSignal,
  });
}

function resolveHostedWorkspaceChildVaultRoot(): string {
  return path.join(process.cwd(), "durable", "vault");
}

async function readStandardInput(): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

function parseJsonValue(value: string): unknown {
  return JSON.parse(value);
}

function parseHostedExecutionChildInput(value: unknown): HostedExecutionChildInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hosted node runner child input must be an object.");
  }

  const record = value as Record<string, unknown>;

  return {
    job: parseHostedExecutionRunnerJobInput(record.job),
  };
}

function createHostedExecutionChildBootstrapError(error: unknown): {
  code: string | null;
  message: string;
  name: string | null;
  stack: string | null;
} {
  return {
    code: deriveHostedExecutionErrorCode(error),
    message: "Hosted node runner child bootstrap payload is invalid.",
    name: readHostedExecutionSafeErrorName(error),
    stack: null,
  };
}

function createHostedExecutionChildRuntimeError(
  error: unknown,
  input: {
    runtimeStage: HostedExecutionChildRuntimeStage;
  },
): {
  code: string | null;
  details: Record<string, unknown> | null;
  message: string;
  name: string | null;
  stack: string | null;
} {
  const childRuntimeDiagnostics = buildHostedExecutionChildRuntimeErrorDiagnostics(error, input);
  return {
    code:
      error
      && typeof error === "object"
      && "code" in error
      && typeof error.code === "string"
        ? error.code
        : null,
    details: {
      ...(redactHostedRuntimeDiagnosticDetails(
        extractHostedAssistantNotificationRedactedDetails(error),
      ) ?? {}),
      ...childRuntimeDiagnostics,
    },
    message: readHostedRuntimeChildErrorMessage(error),
    name: error instanceof Error ? error.name : null,
    stack: error instanceof Error && error.stack
      ? redactHostedRuntimeDiagnosticText(error.stack)
      : null,
  };
}

function buildHostedExecutionChildRuntimeErrorDiagnostics(
  error: unknown,
  input: {
    runtimeStage: HostedExecutionChildRuntimeStage;
  },
): HostedExecutionStructuredLogDetails {
  const childRuntimeErrorName = error instanceof Error
    ? readHostedExecutionChildRuntimeErrorName(error.name)
    : null;
  const childRuntimeHttpOperation =
    readHostedExecutionChildRuntimeHttpOperation(error);
  const childRuntimeErrorCode = deriveHostedExecutionErrorCode(error);
  const childRuntimeErrorMessageKind = error instanceof Error
    ? classifyHostedExecutionChildRuntimeErrorMessageKind(error.message)
    : null;
  const bundleValidation = readHostedBundleArchiveValidationErrorDetails(error);
  return {
    childRuntimeErrorCode,
    ...(childRuntimeErrorName ? { childRuntimeErrorName } : {}),
    ...(childRuntimeErrorMessageKind ? { childRuntimeErrorMessageKind } : {}),
    childRuntimeFailureKind: classifyHostedExecutionChildRuntimeFailure(error, {
      bundleValidationPresent: bundleValidation !== null,
      childRuntimeErrorCode,
    }),
    ...(childRuntimeHttpOperation ? { childRuntimeHttpOperation } : {}),
    childRuntimeStage: input.runtimeStage,
    ...(bundleValidation
      ? {
          childRuntimeBundleArchiveOperation: bundleValidation.operation,
          ...(bundleValidation.validationCause
            ? {
                childRuntimeBundleArchiveValidationCause:
                  bundleValidation.validationCause,
              }
            : {}),
          childRuntimeBundleRefKeyPresent: bundleValidation.refKeyPresent,
          childRuntimeBundleRefPresent: bundleValidation.refHash !== null
            || bundleValidation.refKeyPresent
            || bundleValidation.refSize !== null,
          ...(bundleValidation.refSize !== null
            ? { childRuntimeBundleRefSize: bundleValidation.refSize }
            : {}),
        }
      : {}),
    ...readHostedExecutionChildRuntimeFetchFailureMetadata(error),
    ...readHostedExecutionChildRuntimeWorkspaceSnapshotRestoreStep(error),
    ...readHostedExecutionChildRuntimeWorkspaceSnapshotProcessFailure(error),
    ...readHostedExecutionChildRuntimeStatus(error),
  };
}

function readHostedExecutionChildRuntimeWorkspaceSnapshotRestoreStep(
  error: unknown,
): Record<string, string> {
  const step = readHostedWorkspaceSnapshotRestoreStep(error);
  return step ? { childRuntimeWorkspaceSnapshotRestoreStep: step } : {};
}

function readHostedExecutionChildRuntimeWorkspaceSnapshotProcessFailure(
  error: unknown,
): HostedExecutionStructuredLogDetails {
  const diagnostics = readHostedWorkspaceSnapshotProcessFailureDiagnostics(error);
  if (!diagnostics) {
    return {};
  }

  return {
    childRuntimeWorkspaceSnapshotProcessLabel: diagnostics.label,
    ...(diagnostics.exitCode !== null
      ? { childRuntimeWorkspaceSnapshotProcessExitCode: diagnostics.exitCode }
      : {}),
    ...(diagnostics.signal
      ? { childRuntimeWorkspaceSnapshotProcessSignal: diagnostics.signal }
      : {}),
    childRuntimeWorkspaceSnapshotProcessStderrBytes:
      diagnostics.stderrByteCount,
    childRuntimeWorkspaceSnapshotProcessStderrLineCount:
      diagnostics.stderrLineCount,
    ...(diagnostics.stderrMarkers.length > 0
      ? {
          childRuntimeWorkspaceSnapshotProcessStderrMarkers:
            [...diagnostics.stderrMarkers],
        }
      : {}),
    ...(diagnostics.stderrTail
      ? {
          childRuntimeWorkspaceSnapshotProcessStderrErrorDetail:
            redactHostedRuntimeDiagnosticText(diagnostics.stderrTail),
        }
      : {}),
    childRuntimeWorkspaceSnapshotProcessStderrTruncated:
      diagnostics.stderrTruncated,
  };
}

function readHostedExecutionChildRuntimeFetchFailureMetadata(
  error: unknown,
): Record<string, boolean | number | string> {
  const diagnostics =
    readHostedRuntimeControlPlaneFetchFailureDiagnostics(error)
    ?? readHostedExecutionChildRuntimeLegacyFetchFailureMetadata(error);
  if (!diagnostics) {
    return {};
  }

  return {
    childRuntimeFetchCallerSignalAborted: diagnostics.fetchCallerSignalAborted,
    childRuntimeFetchCauseKind: diagnostics.fetchCauseKind,
    ...(diagnostics.fetchCauseName
      ? { childRuntimeFetchCauseName: diagnostics.fetchCauseName }
      : {}),
    childRuntimeFetchRequestSignalAborted: diagnostics.fetchRequestSignalAborted,
    childRuntimeFetchTimeoutMs: diagnostics.fetchTimeoutMs,
    childRuntimeFetchTimeoutSignalAborted: diagnostics.fetchTimeoutSignalAborted,
  };
}

function readHostedExecutionChildRuntimeLegacyFetchFailureMetadata(
  error: unknown,
): ReturnType<typeof readHostedRuntimeControlPlaneFetchFailureDiagnostics> {
  if (
    !(error instanceof Error)
    || !readHostedExecutionRuntimeFetchFailureDescription(error.message)
    || !error.message.includes("The RPC call destroy() was called")
  ) {
    return null;
  }

  return {
    fetchCallerSignalAborted: false,
    fetchCauseCode: "runtime_error",
    fetchCauseKind: "cloudflare_rpc_destroy",
    fetchCauseName: "Error",
    fetchRequestSignalAborted: false,
    fetchTimeoutMs: readHostedRunnerCommitTimeoutMs(null),
    fetchTimeoutSignalAborted: false,
  };
}

function classifyHostedExecutionChildRuntimeFailure(
  error: unknown,
  input?: {
    bundleValidationPresent?: boolean;
    childRuntimeErrorCode?: string | null;
  },
): HostedExecutionChildRuntimeFailureKind {
  if (
    input?.bundleValidationPresent === true
    || input?.childRuntimeErrorCode === "bundle_archive_validation_error"
  ) {
    return "bundle_archive_validation";
  }
  if (error instanceof HostedWorkspaceRuntimeJobWorkspaceVersionMismatchError) {
    return "workspace_version_mismatch";
  }
  if (isHostedRuntimeInternalAuthorityRejectedError(error)) {
    return "stale_invocation_authority";
  }
  if (error instanceof TypeError) {
    const typeFailure = HOSTED_EXECUTION_CHILD_RUNTIME_TYPE_ERROR_FAILURES.get(
      error.message,
    );
    if (typeFailure) {
      return typeFailure;
    }
  }
  if (error instanceof Error) {
    if (error.name === "HostedAssistantConfigurationError") {
      return "hosted_assistant_configuration";
    }
    if (error.message === "The RPC call destroy() was called") {
      return "runtime_rpc_destroyed";
    }
    const messageFailure = HOSTED_EXECUTION_CHILD_RUNTIME_ERROR_MESSAGE_FAILURES.get(
      error.message,
    );
    if (messageFailure) {
      return messageFailure;
    }
    const httpOperation = readHostedExecutionChildRuntimeHttpOperation(error);
    if (httpOperation && readHostedExecutionRuntimeInvalidJsonDescription(error.message)) {
      return "control_plane_invalid_json";
    }
    if (httpOperation && readHostedExecutionRuntimeFetchFailureDescription(error.message)) {
      return "control_plane_fetch";
    }
    if (httpOperation === "mailbox_payload_decode") {
      return "mailbox_payload_decode_http";
    }
    if (httpOperation) {
      return "control_plane_http";
    }
  }
  return "unclassified_runtime_error";
}

function readHostedExecutionChildRuntimeHttpOperation(
  error: unknown,
): HostedExecutionChildRuntimeHttpOperation | null {
  if (!(error instanceof Error)) {
    return null;
  }

  const description = readHostedExecutionRuntimeHttpDescription(error.message);
  if (!description) {
    return null;
  }

  for (const { operation, pattern } of HOSTED_EXECUTION_CHILD_RUNTIME_HTTP_OPERATION_PATTERNS) {
    if (pattern.test(description)) {
      return operation;
    }
  }

  return null;
}

function readHostedExecutionRuntimeHttpDescription(message: string): string | null {
  return readHostedExecutionRuntimeHttpStatusDescription(message)
    ?? readHostedExecutionRuntimeInvalidJsonDescription(message)
    ?? readHostedExecutionRuntimeFetchFailureDescription(message);
}

function readHostedExecutionRuntimeHttpStatusDescription(message: string): string | null {
  const match =
    /^(.+?) failed with HTTP \d{3}\./u.exec(message)
    ?? /^Hosted invocation is stale: [^.]+\. (.+?) returned HTTP \d{3}\./u.exec(message)
    ?? /^(.+?) returned HTTP \d{3}\./u.exec(message);
  return match?.[1] ?? null;
}

function readHostedExecutionRuntimeInvalidJsonDescription(message: string): string | null {
  const match = /^(.+?) returned invalid JSON\./u.exec(message);
  return match?.[1] ?? null;
}

function readHostedExecutionRuntimeFetchFailureDescription(message: string): string | null {
  const match = /^(.+?) request failed(?:\.|:)/u.exec(message);
  return match?.[1] ?? null;
}

function readHostedExecutionChildRuntimeStatus(
  error: unknown,
): Record<string, number> {
  if (!error || typeof error !== "object") {
    return {};
  }
  const status = "status" in error ? error.status : "statusCode" in error ? error.statusCode : null;
  return (
    typeof status === "number"
    && Number.isInteger(status)
    && status >= 100
    && status <= 599
  )
    ? { childRuntimeErrorStatus: status }
    : {};
}

function readHostedRuntimeChildErrorMessage(error: unknown): string {
  return redactHostedRuntimeDiagnosticText(
    error instanceof Error ? error.message : String(error),
  );
}

function buildHostedRunnerChildRuntimeDiagnostics(
  input: HostedExecutionChildInput,
): Record<string, boolean | number | string | null> {
  const forwardedEnv = input.job.runtime?.forwardedEnv ?? {};
  const userEnv = input.job.runtime?.userEnv ?? {};

  return {
    forwardedEnvKeyCount: Object.keys(forwardedEnv).length,
    hostedAssistantModelConfigured:
      typeof forwardedEnv.HOSTED_ASSISTANT_MODEL === "string",
    hostedAssistantProviderConfigured:
      typeof forwardedEnv.HOSTED_ASSISTANT_PROVIDER === "string",
    hostedAssistantOpenAiConfigured:
      isHostedRunnerOpenAiProvider(forwardedEnv.HOSTED_ASSISTANT_PROVIDER),
    linqApiConfigured:
      typeof forwardedEnv.LINQ_API_TOKEN === "string",
    modelCredentialConfigured:
      hasHostedRunnerModelCredential({
        forwardedEnv,
        userEnv,
      }),
    nodeEnvConfigured:
      typeof forwardedEnv.NODE_ENV === "string"
      && forwardedEnv.NODE_ENV.length > 0,
  };
}

function emitHostedRunnerChildDebug(input: {
  payload: Record<string, unknown>;
  stage: string;
}): void {
  if (process.env.MURPH_E2E_DEBUG_HOSTED_RUNNER !== "1") {
    return;
  }

  console.error(
    `[hosted-runner-child:${input.stage}] ${JSON.stringify(
      redactHostedRuntimeDiagnosticDetails(input.payload),
    )}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runHostedExecutionChild().catch((error) => {
    emitHostedExecutionStructuredLog({
      component: "child",
      details: {
        bootstrapStage: "top-level",
      },
      error,
      level: "error",
      message: "Hosted node runner child failed unexpectedly.",
      phase: "failed",
    });
    process.exitCode = 1;
  });
}
