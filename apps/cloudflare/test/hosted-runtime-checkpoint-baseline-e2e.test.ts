import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { HostedWorkspaceReadResponse } from "@murphai/hosted-execution/runtime-control";
import {
  readHostedBundleTextFile,
  sha256HostedBundleHex,
  snapshotHostedExecutionContext,
} from "@murphai/runtime-state/node";

import {
  createHostedWorkspaceRuntimeBridgeJobOptions,
} from "../src/runtime-bridge-workspace.ts";

type HostedCheckpointSnapshotInput =
  Parameters<ReturnType<typeof createHostedWorkspaceRuntimeBridgeJobOptions>["createCheckpointSnapshot"]>[0];

const cleanupPaths: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(cleanupPaths.splice(0).map((target) =>
    rm(target, {
      force: true,
      recursive: true,
    })
  ));
});

describe("hosted runtime checkpoint baseline", () => {
  it("writes idle shutdown full/base checkpoints without browser-vault replicas", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-checkpoint-baseline-"));
    const baseVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-checkpoint-base-"));
    cleanupPaths.push(vaultRoot, baseVaultRoot);
    await writeFile(path.join(baseVaultRoot, "note.md"), "base state\n", "utf8");
    await writeFile(path.join(vaultRoot, "note.md"), "idle compacted state\n", "utf8");
    const artifactBundles = new Map<string, Uint8Array>();
    const baseSnapshot = await snapshotHostedExecutionContext({ vaultRoot: baseVaultRoot });
    const baseSnapshotHash = sha256HostedBundleHex(baseSnapshot.bundle);
    artifactBundles.set(baseSnapshotHash, baseSnapshot.bundle);
    const putArtifact = vi.fn(async ({ bytes, sha256 }: { bytes: Uint8Array; sha256: string }) => {
      artifactBundles.set(sha256, bytes);
    });
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        getArtifact: async (hash) => artifactBundles.get(hash) ?? null,
        putArtifact,
        readWorkspace: async () => createWorkspaceReadResponse({
          snapshotRef: {
            hash: baseSnapshotHash,
            key: `cloudflare-workspace-snapshots/${baseSnapshotHash}.bundle`,
            size: baseSnapshot.bundle.byteLength,
            updatedAt: "2026-05-01T00:00:00.000Z",
          },
          version: "7",
        }),
      }),
      readCurrentLease: () => createLease({ workspaceVersion: "7" }),
      request: createInvocationRequest({
        reason: "idle_shutdown_checkpoint",
        workspaceVersion: "7",
      }),
      runtime: {},
      vaultRoot,
    });

    const result = await options.createCheckpointSnapshot(createCheckpointInput());
    const snapshotRef = requireBundleRef(result.snapshotRef);
    expect(snapshotRef.key).toMatch(/^cloudflare-workspace-snapshots\/[a-f0-9]{64}\.bundle$/u);
    expect(readHostedBundleTextFile({
      bytes: artifactBundles.get(snapshotRef.hash) ?? null,
      expectedKind: "vault",
      path: "note.md",
      root: "vault",
    })).toBe("idle compacted state\n");
    expect(result).not.toHaveProperty("browserVaultReplicaRef");
    expect(putArtifact).toHaveBeenCalledWith(expect.objectContaining({
      sha256: snapshotRef.hash,
    }));
  });
});

function createWorkspaceReadResponse(input: {
  snapshotRef?: NonNullable<HostedWorkspaceReadResponse["workspace"]>["snapshotRef"];
  version: string;
}): HostedWorkspaceReadResponse {
  return {
    fetchedAt: "2026-05-01T00:00:00.000Z",
    workspace: {
      browserVaultReplicaRef: null,
      checkpointedAt: input.snapshotRef ? "2026-05-01T00:00:00.000Z" : null,
      createdAt: "2026-05-01T00:00:00.000Z",
      nextWakeAt: null,
      nextWakeReason: null,
      redactedStatus: null,
      snapshotRef: input.snapshotRef ?? null,
      updatedAt: "2026-05-01T00:00:00.000Z",
      userId: "member_1",
      version: input.version,
    },
  };
}

function createInvocationRequest(input: {
  reason?: "idle_shutdown_checkpoint" | "nudge";
  workspaceVersion: string;
}) {
  return {
    attemptId: "attempt_1",
    leaseGeneration: "4",
    reason: input.reason ?? "nudge",
    userId: "member_1",
    workspaceVersion: input.workspaceVersion,
  };
}

function createLease(input: { workspaceVersion: string }) {
  return {
    attemptId: "attempt_1",
    leaseGeneration: "4",
    userId: "member_1",
    workspaceVersion: input.workspaceVersion,
  };
}

function createCheckpointInput(): HostedCheckpointSnapshotInput {
  return {
    nextWakeAt: null,
    nextWakeReason: null,
    reason: "idle_shutdown",
    redactedStatus: null,
  };
}

function createPlatform(input: {
  getArtifact?: (hash: string) => Promise<Uint8Array | null>;
  putArtifact: (payload: { bytes: Uint8Array; sha256: string }) => Promise<void>;
  readWorkspace: () => Promise<HostedWorkspaceReadResponse>;
}) {
  return {
    artifactStore: {
      get: input.getArtifact ?? (async () => null),
      put: input.putArtifact,
    },
    effectsPort: {
      readRawEmailMessage: async () => null,
      sendEmail: async () => undefined,
    },
    workspacePort: {
      async checkpoint() {
        throw new Error("Workspace checkpoint is not used by baseline snapshot tests.");
      },
      read: input.readWorkspace,
    },
  };
}

function requireBundleRef(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Expected a hosted execution bundle ref.");
  }

  const record = value as Record<string, unknown>;
  if (
    typeof record.hash !== "string"
    || typeof record.key !== "string"
    || typeof record.size !== "number"
    || typeof record.updatedAt !== "string"
  ) {
    throw new TypeError("Hosted execution bundle ref is malformed.");
  }

  return {
    hash: record.hash,
    key: record.key,
    size: record.size,
    updatedAt: record.updatedAt,
  };
}
