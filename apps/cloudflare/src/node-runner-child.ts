import { pathToFileURL } from "node:url";

import {
  runHostedWorkspaceRuntimeJobInProcess,
} from "@murphai/assistant-runtime";
import {
  HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_TOKEN_ENV,
  HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_URL_ENV,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  buildHostedExecutionSafeErrorDetails,
  deriveHostedExecutionErrorCode,
  emitHostedExecutionStructuredLog,
  extractHostedAssistantNotificationRedactedDetails,
  readHostedExecutionSafeErrorName,
} from "@murphai/hosted-execution";

import {
  buildHostedExecutionRuntimePlatform,
  createCloudflareHostedRuntimeFetch,
} from "./runtime-platform.js";
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
import {
  redactHostedRuntimeDiagnosticDetails,
  redactHostedRuntimeDiagnosticText,
} from "./hosted-runtime-redaction.js";
import {
  CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS,
  CLOUDFLARE_HOSTED_RUNTIME_HOSTS,
} from "./internal-hosts.js";
import {
  LOCAL_CONTAINER_HTTP_WEB_CONTROL_HOSTS,
} from "./web-control-plane.js";

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
    const childRunDiagnostics = buildHostedRunnerChildRuntimeDiagnostics(input);
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
        errorMessage: readHostedRuntimeChildErrorMessage(error),
        errorName: error instanceof Error ? error.name : null,
      },
    });
    const serializedError = createHostedExecutionChildRuntimeError(error);
    stdout.write(
      `${formatHostedExecutionRunnerChildResult({
        ok: false,
        error: serializedError,
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
  let currentLease = createHostedRuntimeBridgeLeaseFromWorkspaceRequest(input.job.request);
  const boundUserId = readHostedExecutionRunnerJobUserId(input.job);
  const platform = buildHostedExecutionRuntimePlatform({
    boundUserId,
    commitTimeoutMs: input.job.runtime?.commitTimeoutMs ?? null,
    internalWorkerProxyToken: input.internalWorkerProxyToken,
    localInternalProxyBaseUrl: input.localInternalProxyBaseUrl,
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
  const webControlFetch = input.internalWorkerProxyToken && input.localInternalProxyBaseUrl
    ? createCloudflareHostedRuntimeFetch(
        boundUserId,
        input.internalWorkerProxyToken,
        input.localInternalProxyBaseUrl,
        fetch,
      )
    : undefined;

  return await input.runWorkspaceInProcess(
    input.job,
    createHostedWorkspaceRuntimeBridgeJobOptions({
      platform,
      request: input.job.request,
      runtime: input.job.runtime ?? {},
      ...(webControlFetch
        ? {
            webControlAllowHttpHosts: [
              CLOUDFLARE_HOSTED_RUNTIME_HOSTS.webControlPlane,
              ...LOCAL_CONTAINER_HTTP_WEB_CONTROL_HOSTS,
            ],
            webControlBaseUrl: CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.webControlPlane,
            webControlFetch,
          }
        : {}),
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

function createHostedExecutionChildRuntimeError(error: unknown): {
  code: string | null;
  details: Record<string, unknown> | null;
  message: string;
  name: string | null;
  stack: string | null;
} {
  return {
    code:
      error
      && typeof error === "object"
      && "code" in error
      && typeof error.code === "string"
        ? error.code
        : null,
    details: redactHostedRuntimeDiagnosticDetails(
      extractHostedAssistantNotificationRedactedDetails(error),
    ),
    message: readHostedRuntimeChildErrorMessage(error),
    name: error instanceof Error ? error.name : null,
    stack: error instanceof Error && error.stack
      ? redactHostedRuntimeDiagnosticText(error.stack)
      : null,
  };
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
  const localCodexProxyDiagnostics = summarizeHostedRunnerChildLocalCodexProxyEnv(
    forwardedEnv,
  );

  return {
    forwardedEnvKeyCount: Object.keys(forwardedEnv).length,
    hostedAssistantModelConfigured:
      typeof forwardedEnv.HOSTED_ASSISTANT_MODEL === "string",
    hostedAssistantProviderConfigured:
      typeof forwardedEnv.HOSTED_ASSISTANT_PROVIDER === "string",
    hasLocalInternalProxyBaseUrl: Boolean(input.localInternalProxyBaseUrl),
    localCodexAppServerProxyConfigured:
      localCodexProxyDiagnostics.configured,
    localCodexAppServerProxyHostKind:
      localCodexProxyDiagnostics.hostKind,
    localCodexAppServerProxyPortPresent:
      localCodexProxyDiagnostics.portPresent,
    localCodexAppServerProxyScheme:
      localCodexProxyDiagnostics.scheme,
    localCodexAppServerProxyTokenPresent:
      localCodexProxyDiagnostics.tokenPresent,
    localCodexAppServerProxyUrlPresent:
      localCodexProxyDiagnostics.urlPresent,
    linqApiConfigured:
      typeof forwardedEnv.LINQ_API_TOKEN === "string",
    modelCredentialConfigured:
      typeof forwardedEnv.VERCEL_AI_API_KEY === "string"
      && forwardedEnv.VERCEL_AI_API_KEY.length > 0,
    nodeEnvConfigured:
      typeof forwardedEnv.NODE_ENV === "string"
      && forwardedEnv.NODE_ENV.length > 0,
  };
}

function summarizeHostedRunnerChildLocalCodexProxyEnv(
  forwardedEnv: Readonly<Record<string, string>>,
): {
  configured: boolean;
  hostKind: string | null;
  portPresent: boolean;
  scheme: string | null;
  tokenPresent: boolean;
  urlPresent: boolean;
} {
  const rawUrl = forwardedEnv[HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_URL_ENV];
  const urlPresent = typeof rawUrl === "string" && rawUrl.length > 0;
  const tokenPresent =
    typeof forwardedEnv[HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_TOKEN_ENV] === "string"
    && forwardedEnv[HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_TOKEN_ENV].length > 0;

  if (!urlPresent) {
    return {
      configured: false,
      hostKind: null,
      portPresent: false,
      scheme: null,
      tokenPresent,
      urlPresent: false,
    };
  }

  try {
    const url = new URL(rawUrl);
    return {
      configured: tokenPresent,
      hostKind: classifyHostedRunnerChildLocalCodexProxyHost(url.hostname),
      portPresent: url.port.length > 0,
      scheme: url.protocol.replace(/:$/u, "") || null,
      tokenPresent,
      urlPresent: true,
    };
  } catch {
    return {
      configured: false,
      hostKind: "invalid",
      portPresent: false,
      scheme: null,
      tokenPresent,
      urlPresent: true,
    };
  }
}

function classifyHostedRunnerChildLocalCodexProxyHost(hostname: string): string {
  const normalized = hostname.toLowerCase();

  if (
    normalized === "localhost"
    || normalized === "127.0.0.1"
    || normalized === "::1"
  ) {
    return "loopback";
  }

  if (
    normalized === "host.docker.internal"
    || normalized.endsWith(".docker.internal")
  ) {
    return "docker-host";
  }

  if (
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u.test(normalized)
    || /^192\.168\.\d{1,3}\.\d{1,3}$/u.test(normalized)
    || /^172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/u.test(normalized)
  ) {
    return "private-ip";
  }

  return "other";
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
