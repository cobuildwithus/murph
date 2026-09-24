import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { resolveWorkspaceScratchRoot } from "./workspace-paths.ts";
import { Worker } from "node:worker_threads";

import { isHostedWorkspaceSnapshotV2Ref } from "@murphai/hosted-execution/parsers";
import type { HostedWorkspaceState } from "@murphai/hosted-execution/runtime-control";
import type { HostedRuntimePlatform, HostedRuntimeVaultSharePort } from "./platform.ts";
import {
  offerCapturedHostedVaultShareProjectionBestEffort,
  resolveHostedVaultShareProjectionScopesBestEffort,
  type HostedVaultShareProjectionCaptureResult,
  type HostedVaultShareProjectionOfferResult,
} from "./vault-share-projection.ts";
import type { HostedVaultShareProjectionMode } from "@murphai/hosted-execution/vault-share";
import type { HostedVaultShareCaptureWorkerInput } from "../hosted-vault-share-capture-worker.ts";

/**
 * Own one projection from a committed checkpoint. It never reads the live vault.
 * Conversation arrivals do not cancel this work; the caller retains and drains
 * its promise at invocation release. Web still fences publication by version.
 */
export async function projectHostedVaultShareCheckpoint(input: {
  projectionMode?: HostedVaultShareProjectionMode;
  shouldStop: () => boolean;
  signal: AbortSignal;
  snapshotPort: HostedRuntimePlatform["workspaceSnapshotPort"];
  vaultRoot: string;
  vaultSharePort: HostedRuntimeVaultSharePort;
  workspace: HostedWorkspaceState | null;
}): Promise<HostedVaultShareProjectionOfferResult> {
  const workspace = input.workspace;
  if (!workspace || !isHostedWorkspaceSnapshotV2Ref(workspace.snapshotRef) || !input.snapshotPort) {
    return { outcome: "error" };
  }
  let temporaryRoot: string | null = null;
  try {
    const scopes = await resolveHostedVaultShareProjectionScopesBestEffort({
      ...(input.projectionMode ? { projectionMode: input.projectionMode } : {}),
      signal: input.signal,
      sourceWorkspaceVersion: workspace.version,
      vaultSharePort: input.vaultSharePort,
    });
    if (scopes.outcome !== "active-scopes") return { outcome: scopes.outcome };
    if (input.shouldStop()) return { outcome: "preempted" };
    const scratchRoot = resolveWorkspaceScratchRoot(input.vaultRoot);
    await mkdir(scratchRoot, { mode: 0o700, recursive: true });
    temporaryRoot = await mkdtemp(path.join(scratchRoot, "vault-share-"));
    const readRoot = path.join(temporaryRoot, "durable");
    await input.snapshotPort.restoreWorkspaceSnapshot({
      durableRoot: readRoot,
      ref: workspace.snapshotRef,
      signal: input.signal,
      usePreparedRestore: false,
    });
    if (input.shouldStop()) return { outcome: "preempted" };
    const capture = await captureInWorker({
      generationTokensByProjectionScopeKey: scopes.generationTokensByProjectionScopeKey,
      hasDeferredProjectionWork: scopes.hasDeferredProjectionWork,
      ...(scopes.projectionMode ? { projectionMode: scopes.projectionMode } : {}),
      projectionScopes: scopes.projectionScopes,
      sourceWorkspaceVersion: workspace.version,
      vaultRoot: path.join(readRoot, "vault"),
    }, input.signal);
    if (input.shouldStop()) return { outcome: "preempted" };
    if (capture.outcome !== "captured") return { outcome: capture.outcome };
    return await offerCapturedHostedVaultShareProjectionBestEffort({
      capture: capture.capture,
      shouldStop: input.shouldStop,
      vaultSharePort: input.vaultSharePort,
    });
  } catch {
    return { outcome: input.shouldStop() ? "preempted" : "error" };
  } finally {
    if (temporaryRoot) {
      // Cleanup failure must not turn best-effort sharing into a foreground failure.
      await rm(temporaryRoot, { force: true, recursive: true }).catch(() => undefined);
    }
  }
}

function captureInWorker(
  input: HostedVaultShareCaptureWorkerInput,
  signal: AbortSignal,
): Promise<HostedVaultShareProjectionCaptureResult> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.resolve("@murphai/assistant-runtime/hosted-vault-share-capture-worker")), {
      env: {},
      execArgv: [],
      workerData: input,
    });
    let result: HostedVaultShareProjectionCaptureResult | undefined;
    let failed = false;
    const abort = () => { void worker.terminate().catch(() => undefined); };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    worker.once("message", (value: HostedVaultShareProjectionCaptureResult) => { result = value; });
    worker.once("error", () => { failed = true; });
    // Exit proves that the isolated reader has stopped before its directory is removed.
    worker.once("exit", (code) => {
      signal.removeEventListener("abort", abort);
      if (!failed && !signal.aborted && code === 0 && result) resolve(result);
      else reject(new Error("Hosted vault-share capture worker did not complete."));
    });
  });
}
