import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  decodeHostedBundleBase64,
  materializeHostedExecutionArtifacts,
  restoreHostedExecutionContext,
} from "@murph/runtime-state";
import type {
  HostedExecutionRunnerResult,
} from "@murph/hosted-execution";

import {
  commitHostedExecutionResult,
  resumeHostedCommittedExecution,
} from "./hosted-runtime/callbacks.ts";
import { createHostedArtifactResolver } from "./hosted-runtime/artifacts.ts";
import {
  normalizeHostedAssistantRuntimeConfig,
  resolveHostedRuntimeChildEntry,
  resolveHostedRuntimeTsconfigPath,
  withHostedProcessEnvironment,
} from "./hosted-runtime/environment.ts";
import {
  completeHostedExecutionAfterCommit,
  executeHostedDispatchForCommit,
} from "./hosted-runtime/execution.ts";
import type {
  HostedAssistantRuntimeJobInput,
} from "./hosted-runtime/models.ts";

export type {
  HostedAssistantRuntimeConfig,
  HostedAssistantRuntimeJobInput,
  HostedAssistantRuntimeJobRequest,
  HostedExecutionCommitCallback,
} from "./hosted-runtime/models.ts";
export {
  readHostedRunnerCommitTimeoutMs,
} from "./hosted-runtime/callbacks.ts";

interface HostedAssistantRuntimeChildResult {
  ok: boolean;
  error?: {
    message: string;
    stack?: string | null;
  };
  result?: HostedExecutionRunnerResult;
}

const HOSTED_RUNTIME_CHILD_RESULT_PREFIX = "__HB_ASSISTANT_RUNTIME_RESULT__";

export async function runHostedAssistantRuntimeJobInProcess(
  input: HostedAssistantRuntimeJobInput,
): Promise<HostedExecutionRunnerResult> {
  const runtime = normalizeHostedAssistantRuntimeConfig(input.runtime);
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-"));

  try {
    const incomingVaultBundle = decodeHostedBundleBase64(input.request.bundles.vault);
    const artifactResolver = createHostedArtifactResolver({
      baseUrl: runtime.artifactsBaseUrl,
      timeoutMs: runtime.commitTimeoutMs,
    });
    const materializedArtifactPaths = new Set<string>();
    const restored = await restoreHostedExecutionContext({
      agentStateBundle: decodeHostedBundleBase64(input.request.bundles.agentState),
      artifactResolver,
      shouldRestoreArtifact: () => false,
      vaultBundle: incomingVaultBundle,
      workspaceRoot,
    });
    const runtimeEnv = {
      ...runtime.forwardedEnv,
      ...runtime.userEnv,
    };

    return await withHostedProcessEnvironment(
      {
        envOverrides: runtimeEnv,
        hostedMemberId: input.request.dispatch.event.userId,
        operatorHomeRoot: restored.operatorHomeRoot,
        vaultRoot: restored.vaultRoot,
      },
      async () => {
        const committedExecution = input.request.resume?.committedResult
          ? resumeHostedCommittedExecution(input.request)
          : await executeHostedDispatchForCommit({
              artifactMaterializer: incomingVaultBundle
                ? async (relativePaths) => {
                    const pendingPaths = [...new Set(relativePaths)]
                      .filter((relativePath) => !materializedArtifactPaths.has(relativePath));
                    if (pendingPaths.length === 0) {
                      return;
                    }

                    await materializeHostedExecutionArtifacts({
                      artifactResolver,
                      shouldRestoreArtifact: ({ path: artifactPath, root }) => (
                        root === "vault" && pendingPaths.includes(artifactPath)
                      ),
                      vaultBundle: incomingVaultBundle,
                      workspaceRoot,
                    });
                    for (const relativePath of pendingPaths) {
                      materializedArtifactPaths.add(relativePath);
                    }
                  }
                : null,
              materializedArtifactPaths,
              request: input.request,
              restored,
              runtime,
              runtimeEnv,
            });

        if (!input.request.resume?.committedResult) {
          await commitHostedExecutionResult({
            commit: input.request.commit ?? null,
            dispatch: input.request.dispatch,
            result: committedExecution.committedResult,
            sideEffects: committedExecution.committedSideEffects,
            runtime,
          });
        }

        return await completeHostedExecutionAfterCommit({
          commit: input.request.commit ?? null,
          dispatch: input.request.dispatch,
          materializedArtifactPaths,
          runtime,
          restored,
          committedExecution,
        });
      },
    );
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
}

export async function runHostedAssistantRuntimeJobIsolated(
  input: HostedAssistantRuntimeJobInput,
): Promise<HostedExecutionRunnerResult> {
  const runtime = normalizeHostedAssistantRuntimeConfig(input.runtime);
  const childEntry = resolveHostedRuntimeChildEntry();
  const isTypeScriptChild = childEntry.endsWith(".ts");
  const childArgs = isTypeScriptChild
    ? ["--import", "tsx", childEntry]
    : [childEntry];

  return await new Promise<HostedExecutionRunnerResult>((resolve, reject) => {
    const child = spawn(process.execPath, childArgs, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...runtime.forwardedEnv,
        ...(isTypeScriptChild
          ? {
              TSX_TSCONFIG_PATH: resolveHostedRuntimeTsconfigPath(),
            }
          : {}),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const settleError = (error: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      reject(error);
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      settleError(error);
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }

      try {
        const payload = parseHostedRuntimeChildResult(stdout);

        if (!payload.ok) {
          settleError(
            new Error(
              payload.error?.message
                ?? `Hosted assistant runtime child exited with code ${code ?? "unknown"}.`,
            ),
          );
          return;
        }

        settled = true;
        resolve(payload.result as HostedExecutionRunnerResult);
      } catch (error) {
        settleError(
          new Error(
            [
              `Hosted assistant runtime child failed${code === null ? "" : ` with exit code ${code}`}.`,
              stderr.trim(),
              stdout.trim(),
              error instanceof Error ? error.message : String(error),
            ]
              .filter(Boolean)
              .join("\n"),
          ),
        );
      }
    });

    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify({ request: input.request, runtime }));
  });
}

export function formatHostedRuntimeChildResult(
  payload: HostedAssistantRuntimeChildResult,
): string {
  return `${HOSTED_RUNTIME_CHILD_RESULT_PREFIX}${Buffer.from(
    JSON.stringify(payload),
    "utf8",
  ).toString("base64")}`;
}

export function parseHostedRuntimeChildResult(output: string): HostedAssistantRuntimeChildResult {
  const lines = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const encoded = [...lines]
    .reverse()
    .find((line) => line.startsWith(HOSTED_RUNTIME_CHILD_RESULT_PREFIX));

  if (!encoded) {
    throw new Error("Hosted assistant runtime child did not emit a result payload.");
  }

  return JSON.parse(
    Buffer.from(
      encoded.slice(HOSTED_RUNTIME_CHILD_RESULT_PREFIX.length),
      "base64",
    ).toString("utf8"),
  ) as HostedAssistantRuntimeChildResult;
}
