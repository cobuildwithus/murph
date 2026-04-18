import {
  formatHostedRuntimeChildResult,
  parseHostedAssistantRuntimeJobInput,
  runHostedAssistantRuntimeJobInProcessDetailed,
} from "@murphai/assistant-runtime";

import { readHostedExecutionEnvironment } from "./env.js";
import { buildHostedExecutionRuntimePlatform } from "./runtime-platform.js";

async function main(): Promise<void> {
  const input = parseHostedExecutionChildInput(
    JSON.parse(await readStandardInput()) as unknown,
  );

  try {
    const environment = readHostedExecutionEnvironment();
    const result = await runHostedAssistantRuntimeJobInProcessDetailed(
      input.job,
      {
        platform: buildHostedExecutionRuntimePlatform({
          boundUserId: input.job.request.dispatch.event.userId,
          commitTimeoutMs: input.job.runtime?.commitTimeoutMs ?? null,
          internalWorkerProxyToken: input.internalWorkerProxyToken,
          localInternalProxyBaseUrl: input.localInternalProxyBaseUrl,
          localLoopbackProxyToken: input.localLoopbackProxyToken,
          webCallbackSigning: environment.webCallbackSigning,
          webControlBaseUrl: environment.hostedWebBaseUrl,
        }),
      },
    );
    process.stdout.write(`${formatHostedRuntimeChildResult({ ok: true, result })}\n`);
  } catch (error) {
    process.stdout.write(
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
    process.exitCode = 1;
  }
}

async function readStandardInput(): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

function parseHostedExecutionChildInput(value: unknown): {
  internalWorkerProxyToken: string | null;
  localInternalProxyBaseUrl: string | null;
  localLoopbackProxyToken: string | null;
  job: ReturnType<typeof parseHostedAssistantRuntimeJobInput>;
} {
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
    localLoopbackProxyToken: readNullableString(
      record.localLoopbackProxyToken,
      "Hosted node runner child input.localLoopbackProxyToken",
    ),
    job: parseHostedAssistantRuntimeJobInput(record.job),
  };
}

function readNullableString(value: unknown, label: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string or null.`);
  }

  return value;
}

await main();
