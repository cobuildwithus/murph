import { pathToFileURL } from "node:url";

import {
  formatHostedRuntimeChildResult,
  parseHostedAssistantRuntimeJobInput,
  runHostedAssistantRuntimeJobInProcessDetailed,
} from "@murphai/assistant-runtime";
import {
  buildHostedExecutionSafeErrorDetails,
  deriveHostedExecutionErrorCode,
  emitHostedExecutionStructuredLog,
  readHostedExecutionSafeErrorName,
} from "@murphai/hosted-execution";

import { buildHostedExecutionRuntimePlatform } from "./runtime-platform.js";

interface HostedExecutionChildDependencies {
  emitLog?: typeof emitHostedExecutionStructuredLog;
  readStandardInput?: () => Promise<string>;
  runInProcess?: typeof runHostedAssistantRuntimeJobInProcessDetailed;
  stdout?: Pick<NodeJS.WriteStream, "write">;
  setExitCode?: (value: number) => void;
}

interface HostedExecutionChildInput {
  internalWorkerProxyToken: string | null;
  localInternalProxyBaseUrl: string | null;
  job: ReturnType<typeof parseHostedAssistantRuntimeJobInput>;
}

export async function runHostedExecutionChild(
  dependencies: HostedExecutionChildDependencies = {},
): Promise<void> {
  const emitLog = dependencies.emitLog ?? emitHostedExecutionStructuredLog;
  const readInput = dependencies.readStandardInput ?? readStandardInput;
  const runInProcess = dependencies.runInProcess ?? runHostedAssistantRuntimeJobInProcessDetailed;
  const stdout = dependencies.stdout ?? process.stdout;
  const setExitCode = dependencies.setExitCode ?? ((value: number) => {
    process.exitCode = value;
  });

  let input: HostedExecutionChildInput;
  try {
    input = parseHostedExecutionChildInput(
      JSON.parse(await readInput()) as unknown,
    );
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
    stdout.write(`${formatHostedRuntimeChildResult({
      ok: false,
      error: createHostedExecutionChildBootstrapError(error),
    })}\n`);
    setExitCode(1);
    return;
  }

  try {
    const result = await runInProcess(
      input.job,
      {
        platform: buildHostedExecutionRuntimePlatform({
          boundUserId: input.job.request.wake.userId,
          commitTimeoutMs: input.job.runtime?.commitTimeoutMs ?? null,
          internalWorkerProxyToken: input.internalWorkerProxyToken,
          localInternalProxyBaseUrl: input.localInternalProxyBaseUrl,
        }),
      },
    );
    stdout.write(`${formatHostedRuntimeChildResult({ ok: true, result })}\n`);
  } catch (error) {
    stdout.write(
      `${formatHostedRuntimeChildResult({
        ok: false,
        error: {
          code:
            error
            && typeof error === "object"
            && "code" in error
            && typeof error.code === "string"
              ? error.code
              : null,
          message: error instanceof Error ? error.message : String(error),
          name: error instanceof Error ? error.name : null,
          stack: error instanceof Error ? error.stack ?? null : null,
        },
      })}\n`,
    );
    setExitCode(1);
  }
}

async function readStandardInput(): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
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
    job: parseHostedAssistantRuntimeJobInput(record.job),
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
