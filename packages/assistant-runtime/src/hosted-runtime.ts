import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  decodeHostedBundleBase64,
  materializeHostedExecutionArtifacts,
  restoreHostedExecutionContext,
} from "@murphai/runtime-state/node";
import type {
  HostedExecutionRunnerResult,
} from "@murphai/hosted-execution";
import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import type { AssistantExecutionContext } from "@murphai/assistant-core";

import {
  commitHostedExecutionResult,
  resumeHostedCommittedExecution,
} from "./hosted-runtime/callbacks.ts";
import { createHostedArtifactResolver } from "./hosted-runtime/artifacts.ts";
import {
  createHostedRuntimeChildLauncherDirectories,
  createHostedRuntimeChildProcessEnv,
  normalizeHostedAssistantRuntimeConfig,
  resolveHostedRuntimeChildEntry,
  resolveHostedRuntimeTsxImportSpecifier,
  withHostedProcessEnvironment,
} from "./hosted-runtime/environment.ts";
import { createHostedInternalWorkerFetch } from "./hosted-runtime/internal-http.ts";
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
export {
  parseHostedAssistantRuntimeConfig,
  parseHostedAssistantRuntimeJobInput,
  parseHostedAssistantRuntimeJobRequest,
} from "./hosted-runtime/parsers.ts";

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
  emitHostedExecutionStructuredLog({
    component: "runtime",
    dispatch: input.request.dispatch,
    message: "Hosted runtime starting.",
    phase: "runtime.starting",
    run: input.request.run ?? null,
  });
  const runtime = normalizeHostedAssistantRuntimeConfig(input.runtime);
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-"));

  try {
    const incomingVaultBundle = decodeHostedBundleBase64(input.request.bundles.vault);
    const internalWorkerFetch = createHostedInternalWorkerFetch(runtime.internalWorkerProxyToken);
    const artifactResolver = createHostedArtifactResolver({
      baseUrl: runtime.artifactsBaseUrl,
      fetchImpl: internalWorkerFetch,
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
    const executionContext: AssistantExecutionContext = {
      hosted: {
        memberId: input.request.dispatch.event.userId,
        userEnvKeys: Object.keys(runtime.userEnv),
      },
    };

    return await withHostedProcessEnvironment(
      {
        envOverrides: runtimeEnv,
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
              internalWorkerFetch,
              request: input.request,
              restored,
              runtime,
              executionContext,
              runtimeEnv,
            });

        if (!input.request.resume?.committedResult) {
          await commitHostedExecutionResult({
            commit: input.request.commit ?? null,
            dispatch: input.request.dispatch,
            fetchImpl: internalWorkerFetch,
            gatewayProjectionSnapshot: committedExecution.committedGatewayProjectionSnapshot,
            result: committedExecution.committedResult,
            sideEffects: committedExecution.committedSideEffects,
            runtime,
          });
          emitHostedExecutionStructuredLog({
            component: "runtime",
            dispatch: input.request.dispatch,
            message: "Hosted runtime recorded a durable commit callback.",
            phase: "commit.recorded",
            run: input.request.run ?? null,
          });
        }

        const finalResult = await completeHostedExecutionAfterCommit({
          commit: input.request.commit ?? null,
          dispatch: input.request.dispatch,
          internalWorkerFetch,
          materializedArtifactPaths,
          run: input.request.run ?? null,
          runtime,
          restored,
          committedExecution,
        });

        emitHostedExecutionStructuredLog({
          component: "runtime",
          dispatch: input.request.dispatch,
          message: "Hosted runtime completed.",
          phase: "completed",
          run: input.request.run ?? null,
        });

        return finalResult;
      },
    );
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "runtime",
      dispatch: input.request.dispatch,
      error,
      message: "Hosted runtime failed.",
      phase: "failed",
      run: input.request.run ?? null,
    });
    throw error;
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
}

export async function runHostedAssistantRuntimeJobIsolated(
  input: HostedAssistantRuntimeJobInput,
  options?: {
    signal?: AbortSignal;
  },
): Promise<HostedExecutionRunnerResult> {
  const runtime = input.runtime;
  const childEntry = resolveHostedRuntimeChildEntry();
  const isTypeScriptChild = childEntry.endsWith(".ts");
  const childArgs = isTypeScriptChild
    ? ["--import", resolveHostedRuntimeTsxImportSpecifier(), childEntry]
    : [childEntry];
  const launcherRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-launch-"));
  const abortSignal = options?.signal ?? null;

  try {
    const launcherDirectories = await createHostedRuntimeChildLauncherDirectories(launcherRoot);

    if (abortSignal?.aborted) {
      throw createHostedRuntimeAbortError(abortSignal);
    }

    return await new Promise<HostedExecutionRunnerResult>((resolve, reject) => {
      const child = spawn(process.execPath, childArgs, {
        cwd: launcherRoot,
        detached: process.platform !== "win32",
        env: createHostedRuntimeChildProcessEnv({
          forwardedEnv: { ...(runtime?.forwardedEnv ?? {}) },
          isTypeScriptChild,
          launcherDirectories,
        }),
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const removeAbortListener = attachHostedRuntimeAbortHandler({
        child,
        onAbort: (error) => {
          settleError(error);
        },
        signal: abortSignal,
      });

      const settleError = (error: Error) => {
        if (settled) {
          return;
        }

        settled = true;
        removeAbortListener();
        reject(error);
      };

      const settleResult = (result: HostedExecutionRunnerResult) => {
        if (settled) {
          return;
        }

        settled = true;
        removeAbortListener();
        resolve(result);
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

          settleResult(payload.result as HostedExecutionRunnerResult);
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
      child.stdin.end(JSON.stringify(input));
    });
  } finally {
    await rm(launcherRoot, { force: true, recursive: true });
  }
}

function attachHostedRuntimeAbortHandler(input: {
  child: ReturnType<typeof spawn>;
  onAbort: (error: Error) => void;
  signal: AbortSignal | null;
}): () => void {
  if (!input.signal) {
    return () => {};
  }

  if (input.signal.aborted) {
    terminateHostedRuntimeChildProcess(input.child);
    queueMicrotask(() => {
      input.onAbort(createHostedRuntimeAbortError(input.signal));
    });
    return () => {};
  }

  const handleAbort = () => {
    terminateHostedRuntimeChildProcess(input.child);
    input.onAbort(createHostedRuntimeAbortError(input.signal));
  };

  input.signal.addEventListener("abort", handleAbort, { once: true });
  return () => {
    input.signal?.removeEventListener("abort", handleAbort);
  };
}

function terminateHostedRuntimeChildProcess(child: ReturnType<typeof spawn>): void {
  const pid = typeof child.pid === "number" && child.pid > 0 ? child.pid : null;

  if (pid !== null && process.platform !== "win32") {
    try {
      process.kill(-pid, "SIGKILL");
      return;
    } catch {
      // Fall back to killing the child directly below.
    }
  }

  try {
    child.kill("SIGKILL");
  } catch {
    // best-effort cleanup only
  }
}

function createHostedRuntimeAbortError(signal: AbortSignal | null): Error {
  const reason = signal?.reason;

  if (reason instanceof Error) {
    return reason;
  }

  return new Error("Hosted assistant runtime child was aborted.");
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
