import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { initializeVault } from "@murphai/core";
import { createEmptyMemoryDocument, renderMemoryDocument, setMemoryDisplayName } from "@murphai/contracts";
import {
  createDeferred, createPlatform, createVaultSnapshotBundle, createWorkspaceState,
} from "./hosted-runtime-workspace-entrypoint.harness.ts";
import { projectHostedVaultShareCheckpoint } from "../src/hosted-runtime/vault-share-background.ts";
import type { HostedVaultShareDeliverRequest } from "@murphai/hosted-execution/vault-share";

async function writeName(vaultRoot: string, displayName: string) {
  const now = new Date("2026-07-01T00:00:00.000Z");
  const document = setMemoryDisplayName(createEmptyMemoryDocument(now), { displayName, now }).document;
  await mkdir(path.join(vaultRoot, "bank"), { recursive: true });
  await writeFile(path.join(vaultRoot, "bank", "memory.md"), renderMemoryDocument({ document }));
}

describe("background vault-share checkpoint reader", () => {
  it("finishes on the committed snapshot while live foreground data changes, then removes its read view", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "murph-background-share-"));
    const vaultRoot = path.join(root, "durable", "vault");
    const restoreStarted = createDeferred<void>();
    const finishRestore = createDeferred<void>();
    const controller = new AbortController();
    const deliveries: HostedVaultShareDeliverRequest[] = [];
    let projection: ReturnType<typeof projectHostedVaultShareCheckpoint> | undefined;
    try {
      await initializeVault({ vaultRoot });
      await writeName(vaultRoot, "Original");
      const snapshot = await createVaultSnapshotBundle({ vaultRoot });
      const platform = createPlatform({
        artifactBytesByHash: new Map([[snapshot.hash, snapshot.bytes]]),
        mailboxPort: null,
        workspacePort: null,
      });
      const snapshotPort = platform.workspaceSnapshotPort!;
      projection = projectHostedVaultShareCheckpoint({
        workspace: createWorkspaceState({ version: "7", snapshotRef: snapshot.snapshotRef }),
        vaultRoot,
        signal: controller.signal,
        shouldStop: () => controller.signal.aborted,
        snapshotPort: {
          ...snapshotPort,
          async restoreWorkspaceSnapshot(request) {
            expect(request.usePreparedRestore).toBe(false);
            expect(request.durableRoot).not.toBe(path.dirname(vaultRoot));
            restoreStarted.resolve();
            await finishRestore.promise;
            return await snapshotPort.restoreWorkspaceSnapshot(request);
          },
        },
        vaultSharePort: {
          async listActiveProjectionScopes() {
            return {
              projectionKinds: ["profile-name.v0"],
              projectionScopes: [{ projectionKind: "profile-name.v0" }],
              generationTokensByProjectionScopeKey: { "profile-name.v0": "a".repeat(43) },
            };
          },
          async deliver(request) {
            deliveries.push(request);
            return { status: "delivered" };
          },
        },
      });
      await restoreStarted.promise;
      // Foreground keeps its mutable vault and completes before the reader resumes.
      await writeName(vaultRoot, "Updated");
      expect(deliveries).toHaveLength(0);
      expect(controller.signal.aborted).toBe(false);
      finishRestore.resolve();
      expect(await projection).toEqual({ outcome: "delivered" });
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]?.sourceWorkspaceVersion).toBe("7");
      expect(JSON.stringify(deliveries[0]?.records)).toContain("Original");
      expect(JSON.stringify(deliveries[0]?.records)).not.toContain("Updated");
      expect(await readdir(path.join(root, "scratch"))).toEqual([]);
    } finally {
      finishRestore.resolve();
      controller.abort();
      await projection;
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each(["failure", "shutdown"] as const)("cleans a partial restore after %s without publishing", async (stop) => {
    const root = await mkdtemp(path.join(tmpdir(), "murph-background-stopped-"));
    const vaultRoot = path.join(root, "durable", "vault");
    const controller = new AbortController();
    const deliver = vi.fn();
    try {
      await initializeVault({ vaultRoot });
      const snapshot = await createVaultSnapshotBundle({ vaultRoot });
      const platform = createPlatform({ mailboxPort: null, workspacePort: null });
      const result = await projectHostedVaultShareCheckpoint({
        workspace: createWorkspaceState({ snapshotRef: snapshot.snapshotRef }),
        vaultRoot,
        signal: controller.signal,
        shouldStop: () => controller.signal.aborted,
        snapshotPort: {
          ...platform.workspaceSnapshotPort!,
          async restoreWorkspaceSnapshot(request) {
            await mkdir(request.durableRoot, { recursive: true });
            await writeFile(path.join(request.durableRoot, "partial"), "synthetic");
            if (stop === "shutdown") controller.abort();
            throw new Error("Synthetic interrupted restore.");
          },
        },
        vaultSharePort: {
          async listActiveProjectionScopes() {
            return {
              projectionKinds: ["profile-name.v0"],
              projectionScopes: [{ projectionKind: "profile-name.v0" }],
              generationTokensByProjectionScopeKey: { "profile-name.v0": "a".repeat(43) },
            };
          },
          deliver,
        },
      });
      expect(result.outcome).toBe(stop === "shutdown" ? "preempted" : "error");
      expect(deliver).not.toHaveBeenCalled();
      expect(await readdir(path.join(root, "scratch"))).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not restore a checkpoint when there are no active shares", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "murph-background-no-shares-"));
    try {
      await initializeVault({ vaultRoot: root });
      const snapshot = await createVaultSnapshotBundle({ vaultRoot: root });
      const platform = createPlatform({ mailboxPort: null, workspacePort: null });
      const restore = vi.fn();
      const deliver = vi.fn();
      const result = await projectHostedVaultShareCheckpoint({
        workspace: createWorkspaceState({ snapshotRef: snapshot.snapshotRef }),
        vaultRoot: root,
        signal: new AbortController().signal,
        shouldStop: () => false,
        snapshotPort: { ...platform.workspaceSnapshotPort!, restoreWorkspaceSnapshot: restore },
        vaultSharePort: {
          async listActiveProjectionScopes() {
            return { projectionKinds: [], projectionScopes: [], generationTokensByProjectionScopeKey: {} };
          },
          deliver,
        },
      });
      expect(result).toEqual({ outcome: "no-active-share" });
      expect(restore).not.toHaveBeenCalled();
      expect(deliver).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
