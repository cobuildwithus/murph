import { pathToFileURL } from "node:url";

import {
  runHostedWorkspaceRuntimeJobInProcess,
} from "@murphai/assistant-runtime";
import {
  buildHostedExecutionSafeErrorDetails,
  deriveHostedExecutionErrorCode,
  emitHostedExecutionStructuredLog,
  extractHostedAssistantNotificationRedactedDetails,
  readHostedExecutionSafeErrorName,
} from "@murphai/hosted-execution";

import { buildHostedExecutionRuntimePlatform } from "./runtime-platform.js";
import {
  createHostedRuntimeBridgeLeaseFromWorkspaceRequest,
  createHostedWorkspaceRuntimeBridgeJobOptions,
} from "./runtime-bridge-workspace.js";
import {
  formatHostedExecutionRunnerChildResult,
  parseHostedExecutionRunnerJobInput,
  readHostedExecutionRunnerJobUserId,
  type HostedExecutionWorkspaceInvocationJobInput,
} from "./runner-job-transport.js";

interface HostedExecutionChildDependencies {
  emitLog?: typeof emitHostedExecutionStructuredLog;
  readStandardInput?: () => Promise<string>;
  runWorkspaceInProcess?: typeof runHostedWorkspaceRuntimeJobInProcess;
  stdout?: Pick<NodeJS.WriteStream, "write">;
  setExitCode?: (value: number) => void;
}

interface HostedExecutionChildInput {
  internalWorkerProxyToken: string | null;
  localInternalProxyBaseUrl: string | null;
  job: HostedExecutionWorkspaceInvocationJobInput;
}

export async function runHostedExecutionChild(
  dependencies: HostedExecutionChildDependencies = {},
): Promise<void> {
  const emitLog = dependencies.emitLog ?? emitHostedExecutionStructuredLog;
  const readInput = dependencies.readStandardInput ?? readStandardInput;
  const runWorkspaceInProcess =
    dependencies.runWorkspaceInProcess ?? runHostedWorkspaceRuntimeJobInProcess;
  const stdout = dependencies.stdout ?? process.stdout;
  const setExitCode = dependencies.setExitCode ?? ((value: number) => {
    process.exitCode = value;
  });

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
    stdout.write(`${formatHostedExecutionRunnerChildResult({
      ok: false,
      error: createHostedExecutionChildBootstrapError(error),
    })}\n`);
    setExitCode(1);
    return;
  }

  try {
    emitHostedRunnerChildDebug({
      stage: "before-run",
      payload: {
        hostedAssistantBaseUrl: input.job.runtime?.forwardedEnv?.HOSTED_ASSISTANT_BASE_URL ?? null,
        hostedAssistantModel: input.job.runtime?.forwardedEnv?.HOSTED_ASSISTANT_MODEL ?? null,
        hostedAssistantProvider: input.job.runtime?.forwardedEnv?.HOSTED_ASSISTANT_PROVIDER ?? null,
        hasLocalInternalProxyBaseUrl: Boolean(input.localInternalProxyBaseUrl),
        linqApiBaseUrl: input.job.runtime?.forwardedEnv?.LINQ_API_BASE_URL ?? null,
      },
    });
    const result = await runWorkspaceChildJob({
      internalWorkerProxyToken: input.internalWorkerProxyToken,
      job: input.job,
      localInternalProxyBaseUrl: input.localInternalProxyBaseUrl,
      runWorkspaceInProcess,
    });
    emitHostedRunnerChildDebug({
      stage: "after-run",
      payload: {
        resultPhase: "phase" in result ? result.phase ?? null : null,
      },
    });
    stdout.write(`${formatHostedExecutionRunnerChildResult({ ok: true, result })}\n`);
  } catch (error) {
    emitHostedRunnerChildDebug({
      stage: "run-error",
      payload: {
        errorMessage: error instanceof Error ? error.message : String(error),
        errorName: error instanceof Error ? error.name : null,
      },
    });
    stdout.write(
      `${formatHostedExecutionRunnerChildResult({
        ok: false,
        error: {
          code:
            error
            && typeof error === "object"
            && "code" in error
            && typeof error.code === "string"
              ? error.code
              : null,
          details: extractHostedAssistantNotificationRedactedDetails(error),
          message: error instanceof Error ? error.message : String(error),
          name: error instanceof Error ? error.name : null,
          stack: error instanceof Error ? error.stack ?? null : null,
        },
      })}\n`,
    );
    setExitCode(1);
  }
}

async function runWorkspaceChildJob(input: {
  internalWorkerProxyToken: string | null;
  job: HostedExecutionWorkspaceInvocationJobInput;
  localInternalProxyBaseUrl: string | null;
  runWorkspaceInProcess: typeof runHostedWorkspaceRuntimeJobInProcess;
}) {
  const platform = buildHostedExecutionRuntimePlatform({
    boundUserId: readHostedExecutionRunnerJobUserId(input.job),
    commitTimeoutMs: input.job.runtime?.commitTimeoutMs ?? null,
    internalWorkerProxyToken: input.internalWorkerProxyToken,
    localInternalProxyBaseUrl: input.localInternalProxyBaseUrl,
    workspaceCheckpointBridge: {
      readCurrentLease: () =>
        createHostedRuntimeBridgeLeaseFromWorkspaceRequest(input.job.request),
    },
  });

  return await input.runWorkspaceInProcess(
    input.job,
    createHostedWorkspaceRuntimeBridgeJobOptions({
      platform,
      request: input.job.request,
      runtime: input.job.runtime ?? {},
    }),
  );
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
    internalWorkerProxyToken: readNullableString(
      record.internalWorkerProxyToken,
      "Hosted node runner child input.internalWorkerProxyToken",
    ),
    localInternalProxyBaseUrl: readNullableString(
      record.localInternalProxyBaseUrl,
      "Hosted node runner child input.localInternalProxyBaseUrl",
    ),
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

function readNullableString(value: unknown, label: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string or null.`);
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function emitHostedRunnerChildDebug(input: {
  payload: Record<string, unknown>;
  stage: string;
}): void {
  if (process.env.MURPH_E2E_DEBUG_HOSTED_RUNNER !== "1") {
    return;
  }

  console.error(`[hosted-runner-child:${input.stage}] ${JSON.stringify(input.payload)}`);
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
