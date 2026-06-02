import { Prisma } from "@prisma/client";
import {
  HOSTED_EXECUTION_LAYERED_SNAPSHOT_REF_SCHEMA,
  HOSTED_EXECUTION_WORKING_SNAPSHOT_REF_SCHEMA,
} from "@murphai/hosted-execution/bundles";
import type {
  HostedRuntimeRedactedJson,
} from "@murphai/hosted-execution/runtime-control";
import { describe, expect, it, vi } from "vitest";

import {
  checkpointHostedWorkspaceTx,
  ensureHostedWorkspace,
  publishHostedBrowserVaultReplicaRef,
  publishLatestBrowserVaultReplicaRefTx,
  readAcceptedRuntimeAttemptFailureSignalOwnerLogId,
  recordHostedRuntimeLogTx,
  type HostedRuntimeLogRow,
  type HostedWorkspaceTransactionRunner,
  type HostedWorkspaceRow,
} from "@/src/lib/hosted-workspace/store";
import {
  publishLegacySourceHashBrowserVaultReplicaRefTx,
} from "@/src/lib/hosted-workspace/legacy-source-hash-browser-vault";

const FIXED_NOW = new Date("2026-04-26T00:00:00.000Z");

describe("hosted workspace store", () => {
  it("creates the version-zero workspace row when missing", async () => {
    const hostedWorkspace = createHostedWorkspaceDelegate();
    const prisma = createHostedWorkspaceClient({
      hostedWorkspace,
    });

    const workspace = await ensureHostedWorkspace({
      prisma,
      userId: "member_workspace_1",
    });

    expect(hostedWorkspace.upsert).toHaveBeenCalledWith({
      create: {
        userId: "member_workspace_1",
      },
      update: {},
      where: {
        userId: "member_workspace_1",
      },
    });
    expect(workspace).toMatchObject({
      snapshotRef: null,
      userId: "member_workspace_1",
      version: "4",
    });
  });

  it("updates checkpoints with an expected-version CAS fence", async () => {
    const hostedWorkspace = createHostedWorkspaceDelegate({
      findUnique: vi.fn<HostedWorkspaceFindUnique>(async () => buildHostedWorkspaceRow({
        browserVaultReplicaRef: createBrowserVaultReplicaRef(),
        checkpointedAt: new Date("2026-04-26T00:01:00.000Z"),
        nextWakeAt: new Date("2026-04-26T00:05:00.000Z"),
        nextWakeReason: "mailbox",
        redactedStatusJson: {
          state: "idle",
        },
        snapshotRef: createBundleRef("snapshot_2"),
        version: 5n,
      })),
      updateMany: vi.fn<HostedWorkspaceUpdateMany>(async () => ({ count: 1 })),
    });
    const tx = createHostedWorkspaceTx({
      hostedWorkspace,
    });

    const result = await checkpointHostedWorkspaceTx({
      checkpointedAt: "2026-04-26T00:01:00.000Z",
      expectedVersion: "4",
      nextWakeAt: "2026-04-26T00:05:00.000Z",
      nextWakeReason: "mailbox",
      reason: "import",
      redactedStatusJson: {
        importedConversationSeq: "12",
        state: "idle",
      },
      snapshotRef: createBundleRef("snapshot_2"),
      tx,
      userId: "member_workspace_1",
    });

    expect(hostedWorkspace.updateMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        checkpointedAt: new Date("2026-04-26T00:01:00.000Z"),
        nextWakeAt: new Date("2026-04-26T00:05:00.000Z"),
        nextWakeReason: "mailbox",
        redactedStatusJson: {
          importedConversationSeq: "12",
          state: "idle",
        },
        snapshotRef: createBundleRef("snapshot_2"),
        version: {
          increment: 1,
        },
      }),
      where: {
        userId: "member_workspace_1",
        version: 4n,
      },
    });
    expect(result).toMatchObject({
      status: "updated",
      workspace: {
        snapshotRef: createBundleRef("snapshot_2"),
        userId: "member_workspace_1",
        version: "5",
      },
    });
  });

  it("reports CAS conflicts without merging checkpoint refs", async () => {
    const current = buildHostedWorkspaceRow({
      snapshotRef: createBundleRef("snapshot_current"),
      version: 6n,
    });
    const hostedWorkspace = createHostedWorkspaceDelegate({
      findUnique: vi.fn<HostedWorkspaceFindUnique>(async () => current),
      updateMany: vi.fn<HostedWorkspaceUpdateMany>(async () => ({ count: 0 })),
    });
    const tx = createHostedWorkspaceTx({
      hostedWorkspace,
    });

    const result = await checkpointHostedWorkspaceTx({
      expectedVersion: 4n,
      reason: "canonical_runtime_commit",
      snapshotRef: createBundleRef("snapshot_stale"),
      tx,
      userId: "member_workspace_1",
    });

    expect(result).toMatchObject({
      status: "conflict",
      workspace: {
        snapshotRef: createBundleRef("snapshot_current"),
        version: "6",
      },
    });
  });

  it("rejects legacy maintenance checkpoint reasons", async () => {
    const hostedWorkspace = createHostedWorkspaceDelegate();
    const tx = createHostedWorkspaceTx({
      hostedWorkspace,
    });

    await expect(checkpointHostedWorkspaceTx({
      expectedVersion: "4",
      reason: "maintenance",
      snapshotRef: createBundleRef("snapshot_2"),
      tx,
      userId: "member_workspace_1",
    })).rejects.toThrow(/Hosted workspace checkpoint reason/u);
    expect(hostedWorkspace.updateMany).not.toHaveBeenCalled();
  });

  it("preserves optional wake and redacted status fields when a checkpoint omits them", async () => {
    const hostedWorkspace = createHostedWorkspaceDelegate({
      findUnique: vi.fn<HostedWorkspaceFindUnique>(async () => buildHostedWorkspaceRow({
        nextWakeAt: new Date("2026-04-26T00:05:00.000Z"),
        nextWakeReason: "assistant",
        redactedStatusJson: {
          hostedAssistantProgressed: true,
        },
        snapshotRef: createBundleRef("snapshot_2"),
        version: 5n,
      })),
      updateMany: vi.fn<HostedWorkspaceUpdateMany>(async () => ({ count: 1 })),
    });
    const tx = createHostedWorkspaceTx({
      hostedWorkspace,
    });

    await checkpointHostedWorkspaceTx({
      expectedVersion: "4",
      reason: "canonical_runtime_commit",
      snapshotRef: createBundleRef("snapshot_2"),
      tx,
      userId: "member_workspace_1",
    });

    const updateData = hostedWorkspace.updateMany.mock.calls[0]?.[0].data;
    expect(updateData).not.toHaveProperty("nextWakeAt");
    expect(updateData).not.toHaveProperty("nextWakeReason");
    expect(updateData).not.toHaveProperty("redactedStatusJson");
  });

  it("preserves browser-vault replica refs when checkpoint payloads omit continuity", async () => {
    const hostedWorkspace = createHostedWorkspaceDelegate({
      findUnique: vi.fn<HostedWorkspaceFindUnique>(async () => buildHostedWorkspaceRow({
        browserVaultReplicaRef: null,
        snapshotRef: createBundleRef("snapshot_2"),
        version: 5n,
      })),
      updateMany: vi.fn<HostedWorkspaceUpdateMany>(async () => ({ count: 1 })),
    });
    const tx = createHostedWorkspaceTx({
      hostedWorkspace,
    });

    const result = await checkpointHostedWorkspaceTx({
      expectedVersion: "4",
      reason: "canonical_runtime_commit",
      snapshotRef: createBundleRef("snapshot_2"),
      tx,
      userId: "member_workspace_1",
    });

    const updateData = hostedWorkspace.updateMany.mock.calls[0]?.[0].data;
    expect(updateData).toEqual(expect.objectContaining({
      snapshotRef: createBundleRef("snapshot_2"),
    }));
    expect(updateData).not.toHaveProperty("browserVaultReplicaRef");
    expect(result).toMatchObject({
      status: "updated",
      workspace: {
        browserVaultReplicaRef: null,
        snapshotRef: createBundleRef("snapshot_2"),
        version: "5",
      },
    });
  });

  it("does not overwrite a stale browser-vault replica ref when old runner payloads omit continuity", async () => {
    const staleBrowserVaultReplicaRef = createBrowserVaultReplicaRef("snapshot_1_hash");
    const hostedWorkspace = createHostedWorkspaceDelegate({
      findUnique: vi.fn<HostedWorkspaceFindUnique>(async () => buildHostedWorkspaceRow({
        browserVaultReplicaRef: staleBrowserVaultReplicaRef,
        snapshotRef: createBundleRef("snapshot_2"),
        version: 5n,
      })),
      updateMany: vi.fn<HostedWorkspaceUpdateMany>(async () => ({ count: 1 })),
    });
    const tx = createHostedWorkspaceTx({
      hostedWorkspace,
    });

    await checkpointHostedWorkspaceTx({
      expectedVersion: "4",
      reason: "canonical_runtime_commit",
      snapshotRef: createBundleRef("snapshot_2"),
      tx,
      userId: "member_workspace_1",
    });

    expect(staleBrowserVaultReplicaRef.sourceBundleHash).toBe("snapshot_1_hash");
    expect(hostedWorkspace.updateMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        snapshotRef: createBundleRef("snapshot_2"),
      }),
      where: {
        userId: "member_workspace_1",
        version: 4n,
      },
    });
    const updateData = hostedWorkspace.updateMany.mock.calls[0]?.[0].data;
    expect(updateData).not.toHaveProperty("browserVaultReplicaRef");
  });

  it("does not clear browser-vault replica refs from checkpoint writes", async () => {
    const browserVaultReplicaRef = createBrowserVaultReplicaRef("snapshot_1_hash");
    const hostedWorkspace = createHostedWorkspaceDelegate({
      findUnique: vi.fn<HostedWorkspaceFindUnique>(async () => buildHostedWorkspaceRow({
        browserVaultReplicaRef,
        snapshotRef: createBundleRef("snapshot_2"),
        version: 5n,
      })),
      updateMany: vi.fn<HostedWorkspaceUpdateMany>(async () => ({ count: 1 })),
    });
    const tx = createHostedWorkspaceTx({
      hostedWorkspace,
    });

    const result = await checkpointHostedWorkspaceTx({
      expectedVersion: "4",
      reason: "canonical_runtime_commit",
      snapshotRef: createBundleRef("snapshot_2"),
      tx,
      userId: "member_workspace_1",
    });

    expect(hostedWorkspace.updateMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        snapshotRef: createBundleRef("snapshot_2"),
      }),
      where: {
        userId: "member_workspace_1",
        version: 4n,
      },
    });
    expect(result).toMatchObject({
      status: "updated",
      workspace: {
        browserVaultReplicaRef,
        snapshotRef: createBundleRef("snapshot_2"),
        version: "5",
      },
    });
    expect(hostedWorkspace.updateMany.mock.calls[0]?.[0].data).not.toHaveProperty(
      "browserVaultReplicaRef",
    );
  });

  it("leaves browser-vault replica refs untouched for latest-hot checkpoint refs", async () => {
    const browserVaultReplicaRef = createBrowserVaultReplicaRef("snapshot_2_hash");
    const hostedWorkspace = createHostedWorkspaceDelegate({
      findUnique: vi.fn<HostedWorkspaceFindUnique>(async () => buildHostedWorkspaceRow({
        browserVaultReplicaRef,
        snapshotRef: createLayeredSnapshotRef({
          base: createBundleRef("snapshot_2"),
          hot: createBundleRef("hot_1"),
        }),
        version: 5n,
      })),
      updateMany: vi.fn<HostedWorkspaceUpdateMany>(async () => ({ count: 1 })),
    });
    const tx = createHostedWorkspaceTx({
      hostedWorkspace,
    });
    const nextSnapshotRef = createLayeredSnapshotRef({
      base: createBundleRef("snapshot_2"),
      hot: createBundleRef("hot_2"),
    });

    const result = await checkpointHostedWorkspaceTx({
      expectedVersion: "4",
      reason: "import",
      snapshotRef: nextSnapshotRef,
      tx,
      userId: "member_workspace_1",
    });

    const updateData = hostedWorkspace.updateMany.mock.calls[0]?.[0].data;
    expect(updateData).toEqual(expect.objectContaining({
      snapshotRef: nextSnapshotRef,
    }));
    expect(updateData).not.toHaveProperty("browserVaultReplicaRef");
    expect(result).toMatchObject({
      status: "updated",
      workspace: {
        browserVaultReplicaRef,
        snapshotRef: createLayeredSnapshotRef({
          base: createBundleRef("snapshot_2"),
          hot: createBundleRef("hot_1"),
        }),
      },
    });
  });

  it("preserves browser-vault replica refs when latest-hot checkpoint refs omit continuity", async () => {
    const nextSnapshotRef = createLayeredSnapshotRef({
      base: createBundleRef("snapshot_2"),
      hot: createBundleRef("hot_2"),
    });
    const hostedWorkspace = createHostedWorkspaceDelegate({
      findUnique: vi.fn<HostedWorkspaceFindUnique>(async () => buildHostedWorkspaceRow({
        snapshotRef: nextSnapshotRef,
        version: 5n,
      })),
      updateMany: vi.fn<HostedWorkspaceUpdateMany>(async () => ({ count: 1 })),
    });
    const tx = createHostedWorkspaceTx({
      hostedWorkspace,
    });

    const result = await checkpointHostedWorkspaceTx({
      expectedVersion: "4",
      reason: "import",
      snapshotRef: nextSnapshotRef,
      tx,
      userId: "member_workspace_1",
    });

    const updateData = hostedWorkspace.updateMany.mock.calls[0]?.[0].data;
    expect(updateData).toEqual(expect.objectContaining({
      snapshotRef: nextSnapshotRef,
    }));
    expect(updateData).not.toHaveProperty("browserVaultReplicaRef");
    expect(result).toMatchObject({
      status: "updated",
      workspace: {
        browserVaultReplicaRef: null,
        snapshotRef: nextSnapshotRef,
        version: "5",
      },
    });
  });

  it("leaves browser-vault replica refs untouched for working checkpoint refs", async () => {
    const snapshotRef = createWorkingSnapshotRef({
      base: createBundleRef("snapshot_2"),
      delta: createBundleRef("delta_2"),
    });
    const hostedWorkspace = createHostedWorkspaceDelegate({
      findUnique: vi.fn<HostedWorkspaceFindUnique>(async () => buildHostedWorkspaceRow({
        browserVaultReplicaRef: createBrowserVaultReplicaRef("snapshot_2_hash"),
        snapshotRef,
        version: 5n,
      })),
      updateMany: vi.fn<HostedWorkspaceUpdateMany>(async () => ({ count: 1 })),
    });
    const tx = createHostedWorkspaceTx({
      hostedWorkspace,
    });

    const result = await checkpointHostedWorkspaceTx({
      expectedVersion: "4",
      reason: "canonical_runtime_commit",
      snapshotRef,
      tx,
      userId: "member_workspace_1",
    });

    expect(hostedWorkspace.updateMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        snapshotRef,
      }),
      where: {
        userId: "member_workspace_1",
        version: 4n,
      },
    });
    expect(result).toMatchObject({
      status: "updated",
      workspace: {
        browserVaultReplicaRef: createBrowserVaultReplicaRef("snapshot_2_hash"),
        snapshotRef,
        version: "5",
      },
    });
    expect(hostedWorkspace.updateMany.mock.calls[0]?.[0].data).not.toHaveProperty(
      "browserVaultReplicaRef",
    );
  });

  it("preserves stale browser-vault replicas when working checkpoint refs omit continuity", async () => {
    const staleBrowserVaultReplicaRef = createBrowserVaultReplicaRef("snapshot_2_hash");
    const snapshotRef = createWorkingSnapshotRef({
      base: createBundleRef("snapshot_2"),
      delta: createBundleRef("delta_2"),
    });
    const hostedWorkspace = createHostedWorkspaceDelegate({
      findUnique: vi.fn<HostedWorkspaceFindUnique>(async () => buildHostedWorkspaceRow({
        browserVaultReplicaRef: staleBrowserVaultReplicaRef,
        snapshotRef,
        version: 5n,
      })),
      updateMany: vi.fn<HostedWorkspaceUpdateMany>(async () => ({ count: 1 })),
    });
    const tx = createHostedWorkspaceTx({
      hostedWorkspace,
    });

    await checkpointHostedWorkspaceTx({
      expectedVersion: "4",
      reason: "canonical_runtime_commit",
      snapshotRef,
      tx,
      userId: "member_workspace_1",
    });

    const updateData = hostedWorkspace.updateMany.mock.calls[0]?.[0].data;
    expect(updateData).toEqual(expect.objectContaining({
      snapshotRef,
    }));
    expect(updateData).not.toHaveProperty("browserVaultReplicaRef");
  });

  it("publishes latest browser-vault refs as derived state without incrementing workspace version", async () => {
    const replicaRef = createBrowserVaultReplicaRef("snapshot_2_hash", {
      generatedAt: "2026-04-26T00:05:00.000Z",
    });
    const current = buildHostedWorkspaceRow({
      browserVaultReplicaRef: createBrowserVaultReplicaRef("snapshot_1_hash", {
        generatedAt: "2026-04-26T00:01:00.000Z",
      }),
      snapshotRef: createBundleRef("snapshot_2"),
      version: 5n,
    });
    const updated = buildHostedWorkspaceRow({
      browserVaultReplicaRef: replicaRef,
      snapshotRef: createBundleRef("snapshot_2"),
      version: 5n,
    });
    let findUniqueCallCount = 0;
    const findUnique = vi.fn<HostedWorkspaceFindUnique>(async () => {
      findUniqueCallCount += 1;
      return findUniqueCallCount === 1 ? current : updated;
    });
    const hostedWorkspace = createHostedWorkspaceDelegate({
      findUnique,
      updateMany: vi.fn<HostedWorkspaceUpdateMany>(async () => ({ count: 1 })),
    });
    const tx = createHostedWorkspaceTx({
      hostedWorkspace,
    });

    const result = await publishLatestBrowserVaultReplicaRefTx({
      replicaRef,
      tx,
      userId: "member_workspace_1",
    });

    expect(hostedWorkspace.updateMany).toHaveBeenCalledWith({
      data: {
        browserVaultReplicaRef: replicaRef,
      },
      where: {
        browserVaultReplicaRef: {
          equals: current.browserVaultReplicaRef,
        },
        userId: "member_workspace_1",
        version: 5n,
      },
    });
    expect(hostedWorkspace.updateMany.mock.calls[0]?.[0].data).not.toHaveProperty("version");
    expect(hostedWorkspace.updateMany.mock.calls[0]?.[0].data).not.toHaveProperty("snapshotRef");
    expect(result).toMatchObject({
      status: "published",
      workspace: {
        browserVaultReplicaRef: replicaRef,
        snapshotRef: createBundleRef("snapshot_2"),
        version: "5",
      },
    });
  });

  it("retries latest browser-vault ref publish conflicts after metadata-only workspace races", async () => {
    const snapshotRef = createWorkingSnapshotRef({
      base: createBundleRef("snapshot_2"),
      delta: createBundleRef("delta_2"),
    });
    const replicaRef = createBrowserVaultReplicaRef("delta_2_hash");
    const firstRead = buildHostedWorkspaceRow({
      nextWakeAt: new Date("2026-04-26T00:10:00.000Z"),
      snapshotRef,
      version: 6n,
    });
    const racedRead = buildHostedWorkspaceRow({
      nextWakeReason: "metadata-only-race",
      snapshotRef,
      version: 7n,
    });
    const updated = buildHostedWorkspaceRow({
      browserVaultReplicaRef: replicaRef,
      nextWakeReason: racedRead.nextWakeReason,
      snapshotRef,
      version: 7n,
    });
    const findUniqueRows = [firstRead, racedRead, updated];
    const findUnique = vi.fn<HostedWorkspaceFindUnique>(async () => findUniqueRows.shift() ?? updated);
    const updateMany = vi.fn<HostedWorkspaceUpdateMany>()
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    const hostedWorkspace = createHostedWorkspaceDelegate({
      findUnique,
      updateMany,
    });
    const tx = createHostedWorkspaceTx({
      hostedWorkspace,
    });

    const result = await publishLatestBrowserVaultReplicaRefTx({
      replicaRef,
      tx,
      userId: "member_workspace_1",
    });

    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany).toHaveBeenNthCalledWith(1, {
      data: {
        browserVaultReplicaRef: replicaRef,
      },
      where: {
        browserVaultReplicaRef: {
          equals: Prisma.DbNull,
        },
        userId: "member_workspace_1",
        version: 6n,
      },
    });
    expect(updateMany).toHaveBeenNthCalledWith(2, {
      data: {
        browserVaultReplicaRef: replicaRef,
      },
      where: {
        browserVaultReplicaRef: {
          equals: Prisma.DbNull,
        },
        userId: "member_workspace_1",
        version: 7n,
      },
    });
    expect(result).toMatchObject({
      status: "published",
      workspace: {
        browserVaultReplicaRef: replicaRef,
        nextWakeReason: "metadata-only-race",
        snapshotRef,
        version: "7",
      },
    });
  });

  it("does not retry browser-vault ref publishes across an expected runtime workspace version", async () => {
    const snapshotRef = createWorkingSnapshotRef({
      base: createBundleRef("snapshot_2"),
      delta: createBundleRef("delta_2"),
    });
    const replicaRef = createBrowserVaultReplicaRef("delta_2_hash");
    const firstRead = buildHostedWorkspaceRow({
      snapshotRef,
      version: 6n,
    });
    const racedRead = buildHostedWorkspaceRow({
      nextWakeReason: "checkpoint-race",
      snapshotRef,
      version: 7n,
    });
    const findUniqueRows = [firstRead, racedRead];
    const findUnique = vi.fn<HostedWorkspaceFindUnique>(async () => findUniqueRows.shift() ?? racedRead);
    const updateMany = vi.fn<HostedWorkspaceUpdateMany>()
      .mockResolvedValueOnce({ count: 0 });
    const hostedWorkspace = createHostedWorkspaceDelegate({
      findUnique,
      updateMany,
    });
    const tx = createHostedWorkspaceTx({
      hostedWorkspace,
    });

    const result = await publishLatestBrowserVaultReplicaRefTx({
      expectedWorkspaceVersion: "6",
      replicaRef,
      tx,
      userId: "member_workspace_1",
    });

    expect(updateMany).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      status: "conflict",
      workspace: {
        browserVaultReplicaRef: null,
        nextWakeReason: "checkpoint-race",
        version: "7",
      },
    });
  });

  it("rejects older browser-vault refs that race with a newer publish at the same workspace version", async () => {
    const olderRef = createBrowserVaultReplicaRef("live_old_hash", {
      generatedAt: "2026-04-26T00:01:00.000Z",
    });
    const newerRef = createBrowserVaultReplicaRef("live_new_hash", {
      generatedAt: "2026-04-26T00:05:00.000Z",
    });
    const firstRead = buildHostedWorkspaceRow({
      browserVaultReplicaRef: null,
      snapshotRef: createWorkingSnapshotRef({
        base: createBundleRef("snapshot_2"),
        delta: createBundleRef("delta_3"),
      }),
      version: 6n,
    });
    const racedRead = buildHostedWorkspaceRow({
      ...firstRead,
      browserVaultReplicaRef: newerRef,
    });
    const findUniqueRows = [firstRead, racedRead, racedRead];
    const findUnique = vi.fn<HostedWorkspaceFindUnique>(async () => findUniqueRows.shift() ?? racedRead);
    const updateMany = vi.fn<HostedWorkspaceUpdateMany>(async () => ({ count: 0 }));
    const hostedWorkspace = createHostedWorkspaceDelegate({
      findUnique,
      updateMany,
    });
    const tx = createHostedWorkspaceTx({
      hostedWorkspace,
    });

    const result = await publishLatestBrowserVaultReplicaRefTx({
      replicaRef: olderRef,
      tx,
      userId: "member_workspace_1",
    });

    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith({
      data: {
        browserVaultReplicaRef: olderRef,
      },
      where: {
        browserVaultReplicaRef: {
          equals: Prisma.DbNull,
        },
        userId: "member_workspace_1",
        version: 6n,
      },
    });
    expect(result).toMatchObject({
      status: "conflict",
      workspace: {
        browserVaultReplicaRef: newerRef,
        version: "6",
      },
    });
  });

  it("does not let an older latest browser-vault ref replace a newer ref", async () => {
    const currentRef = createBrowserVaultReplicaRef("live_new_hash", {
      generatedAt: "2026-04-26T00:05:00.000Z",
    });
    const olderRef = createBrowserVaultReplicaRef("live_old_hash", {
      generatedAt: "2026-04-26T00:01:00.000Z",
    });
    const current = buildHostedWorkspaceRow({
      browserVaultReplicaRef: currentRef,
      snapshotRef: createWorkingSnapshotRef({
        base: createBundleRef("snapshot_2"),
        delta: createBundleRef("delta_3"),
      }),
      version: 6n,
    });
    const hostedWorkspace = createHostedWorkspaceDelegate({
      findUnique: vi.fn<HostedWorkspaceFindUnique>(async () => current),
    });
    const tx = createHostedWorkspaceTx({
      hostedWorkspace,
    });

    const result = await publishLatestBrowserVaultReplicaRefTx({
      replicaRef: olderRef,
      tx,
      userId: "member_workspace_1",
    });

    expect(result).toMatchObject({
      status: "conflict",
      workspace: {
        browserVaultReplicaRef: currentRef,
        version: "6",
      },
    });
    expect(hostedWorkspace.updateMany).not.toHaveBeenCalled();
  });

  it("does not let a different same-timestamp latest browser-vault ref replace the stored ref", async () => {
    const currentRef = createBrowserVaultReplicaRef("live_a_hash", {
      generatedAt: "2026-04-26T00:05:00.000Z",
    });
    const sameTimestampDifferentRef = createBrowserVaultReplicaRef("live_b_hash", {
      generatedAt: "2026-04-26T00:05:00.000Z",
    });
    const current = buildHostedWorkspaceRow({
      browserVaultReplicaRef: currentRef,
      snapshotRef: createWorkingSnapshotRef({
        base: createBundleRef("snapshot_2"),
        delta: createBundleRef("delta_3"),
      }),
      version: 6n,
    });
    const hostedWorkspace = createHostedWorkspaceDelegate({
      findUnique: vi.fn<HostedWorkspaceFindUnique>(async () => current),
    });
    const tx = createHostedWorkspaceTx({
      hostedWorkspace,
    });

    const result = await publishLatestBrowserVaultReplicaRefTx({
      replicaRef: sameTimestampDifferentRef,
      tx,
      userId: "member_workspace_1",
    });

    expect(result).toMatchObject({
      status: "conflict",
      workspace: {
        browserVaultReplicaRef: currentRef,
        version: "6",
      },
    });
    expect(hostedWorkspace.updateMany).not.toHaveBeenCalled();
  });

  it("allows idempotent same-timestamp latest browser-vault ref publishes", async () => {
    const replicaRef = createBrowserVaultReplicaRef("live_same_hash", {
      generatedAt: "2026-04-26T00:05:00.000Z",
    });
    const current = buildHostedWorkspaceRow({
      browserVaultReplicaRef: replicaRef,
      snapshotRef: createWorkingSnapshotRef({
        base: createBundleRef("snapshot_2"),
        delta: createBundleRef("delta_3"),
      }),
      version: 6n,
    });
    const updated = buildHostedWorkspaceRow({
      ...current,
      browserVaultReplicaRef: replicaRef,
    });
    let findUniqueCallCount = 0;
    const findUnique = vi.fn<HostedWorkspaceFindUnique>(async () => {
      findUniqueCallCount += 1;
      return findUniqueCallCount === 1 ? current : updated;
    });
    const hostedWorkspace = createHostedWorkspaceDelegate({
      findUnique,
      updateMany: vi.fn<HostedWorkspaceUpdateMany>(async () => ({ count: 1 })),
    });
    const tx = createHostedWorkspaceTx({
      hostedWorkspace,
    });

    const result = await publishLatestBrowserVaultReplicaRefTx({
      replicaRef,
      tx,
      userId: "member_workspace_1",
    });

    expect(result).toMatchObject({
      status: "published",
      workspace: {
        browserVaultReplicaRef: replicaRef,
        version: "6",
      },
    });
  });

  it("returns missing when a latest browser-vault ref publish conflict reread finds no workspace", async () => {
    const snapshotRef = createWorkingSnapshotRef({
      base: createBundleRef("snapshot_2"),
      delta: createBundleRef("delta_2"),
    });
    const replicaRef = createBrowserVaultReplicaRef("delta_2_hash");
    const firstRead = buildHostedWorkspaceRow({
      snapshotRef,
      version: 6n,
    });
    const findUniqueRows = [firstRead, null];
    const findUnique = vi.fn<HostedWorkspaceFindUnique>(async () => findUniqueRows.shift() ?? null);
    const updateMany = vi.fn<HostedWorkspaceUpdateMany>(async () => ({ count: 0 }));
    const hostedWorkspace = createHostedWorkspaceDelegate({
      findUnique,
      updateMany,
    });
    const tx = createHostedWorkspaceTx({
      hostedWorkspace,
    });

    const result = await publishLatestBrowserVaultReplicaRefTx({
      replicaRef,
      tx,
      userId: "member_workspace_1",
    });

    expect(findUnique).toHaveBeenCalledTimes(2);
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      status: "missing",
      workspace: null,
    });
  });

  it("returns conflict when a latest browser-vault ref publish retry also loses the version guard", async () => {
    const snapshotRef = createWorkingSnapshotRef({
      base: createBundleRef("snapshot_2"),
      delta: createBundleRef("delta_2"),
    });
    const replicaRef = createBrowserVaultReplicaRef("delta_2_hash");
    const firstRead = buildHostedWorkspaceRow({
      snapshotRef,
      version: 6n,
    });
    const retryRead = buildHostedWorkspaceRow({
      nextWakeReason: "metadata-only-race",
      snapshotRef,
      version: 7n,
    });
    const finalRead = buildHostedWorkspaceRow({
      nextWakeReason: "second-metadata-race",
      snapshotRef,
      version: 8n,
    });
    const findUniqueRows = [firstRead, retryRead, finalRead];
    const findUnique = vi.fn<HostedWorkspaceFindUnique>(
      async () => findUniqueRows.shift() ?? finalRead,
    );
    const updateMany = vi.fn<HostedWorkspaceUpdateMany>(async () => ({ count: 0 }));
    const hostedWorkspace = createHostedWorkspaceDelegate({
      findUnique,
      updateMany,
    });
    const tx = createHostedWorkspaceTx({
      hostedWorkspace,
    });

    const result = await publishLatestBrowserVaultReplicaRefTx({
      replicaRef,
      tx,
      userId: "member_workspace_1",
    });

    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      status: "conflict",
      workspace: {
        nextWakeReason: "second-metadata-race",
        snapshotRef,
        version: "8",
      },
    });
  });

  it("publishes legacy source-hash browser-vault refs against the working delta hash", async () => {
    const snapshotRef = createWorkingSnapshotRef({
      base: createBundleRef("snapshot_2"),
      delta: createBundleRef("delta_2"),
    });
    const replicaRef = createBrowserVaultReplicaRef("delta_2_hash");
    const hostedWorkspace = createHostedWorkspaceDelegate({
      findUnique: vi.fn<HostedWorkspaceFindUnique>(async () => buildHostedWorkspaceRow({
        snapshotRef,
        version: 5n,
      })),
      updateMany: vi.fn<HostedWorkspaceUpdateMany>(async () => ({ count: 1 })),
    });
    const tx = createHostedWorkspaceTx({
      hostedWorkspace,
    });

    await publishLegacySourceHashBrowserVaultReplicaRefTx({
      expectedSourceStateHash: "delta_2_hash",
      replicaRef,
      tx,
      userId: "member_workspace_1",
    });

    expect(hostedWorkspace.updateMany).toHaveBeenCalledWith({
      data: {
        browserVaultReplicaRef: replicaRef,
      },
      where: {
        browserVaultReplicaRef: {
          equals: Prisma.DbNull,
        },
        userId: "member_workspace_1",
        version: 5n,
      },
    });
  });

  it("rejects legacy source-hash browser-vault publishes for the wrong replica source hash", async () => {
    const hostedWorkspace = createHostedWorkspaceDelegate();
    const tx = createHostedWorkspaceTx({
      hostedWorkspace,
    });

    await expect(publishLegacySourceHashBrowserVaultReplicaRefTx({
      expectedSourceStateHash: "snapshot_2_hash",
      replicaRef: createBrowserVaultReplicaRef("delta_2_hash"),
      tx,
      userId: "member_workspace_1",
    })).rejects.toThrow(
      "Legacy hosted browser-vault replica publish sourceBundleHash must match expectedSourceStateHash.",
    );
    expect(hostedWorkspace.updateMany).not.toHaveBeenCalled();
  });

  it("rejects legacy source-hash browser-vault publishes when the workspace source advanced", async () => {
    const replicaRef = createBrowserVaultReplicaRef("delta_2_hash");
    const current = buildHostedWorkspaceRow({
      snapshotRef: createWorkingSnapshotRef({
        base: createBundleRef("snapshot_2"),
        delta: createBundleRef("delta_3"),
      }),
      version: 6n,
    });
    const hostedWorkspace = createHostedWorkspaceDelegate({
      findUnique: vi.fn<HostedWorkspaceFindUnique>(async () => current),
    });
    const tx = createHostedWorkspaceTx({
      hostedWorkspace,
    });

    const result = await publishLegacySourceHashBrowserVaultReplicaRefTx({
      expectedSourceStateHash: "delta_2_hash",
      replicaRef,
      tx,
      userId: "member_workspace_1",
    });

    expect(result).toMatchObject({
      status: "conflict",
      workspace: {
        snapshotRef: current.snapshotRef,
        version: "6",
      },
    });
    expect(hostedWorkspace.updateMany).not.toHaveBeenCalled();
  });

  it("does not retry legacy source-hash browser-vault ref publishes across an expected runtime workspace version", async () => {
    const snapshotRef = createWorkingSnapshotRef({
      base: createBundleRef("snapshot_2"),
      delta: createBundleRef("delta_2"),
    });
    const replicaRef = createBrowserVaultReplicaRef("delta_2_hash");
    const firstRead = buildHostedWorkspaceRow({
      snapshotRef,
      version: 6n,
    });
    const racedRead = buildHostedWorkspaceRow({
      nextWakeReason: "checkpoint-race",
      snapshotRef,
      version: 7n,
    });
    const findUniqueRows = [firstRead, racedRead];
    const findUnique = vi.fn<HostedWorkspaceFindUnique>(async () => findUniqueRows.shift() ?? racedRead);
    const updateMany = vi.fn<HostedWorkspaceUpdateMany>()
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    const hostedWorkspace = createHostedWorkspaceDelegate({
      findUnique,
      updateMany,
    });
    const tx = createHostedWorkspaceTx({
      hostedWorkspace,
    });

    const result = await publishLegacySourceHashBrowserVaultReplicaRefTx({
      expectedSourceStateHash: "delta_2_hash",
      expectedWorkspaceVersion: "6",
      replicaRef,
      tx,
      userId: "member_workspace_1",
    });

    expect(updateMany).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      status: "conflict",
      workspace: {
        browserVaultReplicaRef: null,
        nextWakeReason: "checkpoint-race",
        version: "7",
      },
    });
  });

  it("rejects legacy source-hash browser-vault publishes older than the stored latest ref", async () => {
    const snapshotRef = createWorkingSnapshotRef({
      base: createBundleRef("snapshot_2"),
      delta: createBundleRef("delta_2"),
    });
    const current = buildHostedWorkspaceRow({
      browserVaultReplicaRef: createBrowserVaultReplicaRef("delta_2_hash", {
        generatedAt: "2026-04-26T00:05:00.000Z",
      }),
      snapshotRef,
      version: 6n,
    });
    const hostedWorkspace = createHostedWorkspaceDelegate({
      findUnique: vi.fn<HostedWorkspaceFindUnique>(async () => current),
      updateMany: vi.fn<HostedWorkspaceUpdateMany>(async () => ({ count: 1 })),
    });
    const tx = createHostedWorkspaceTx({
      hostedWorkspace,
    });

    const result = await publishLegacySourceHashBrowserVaultReplicaRefTx({
      expectedSourceStateHash: "delta_2_hash",
      replicaRef: createBrowserVaultReplicaRef("delta_2_hash", {
        generatedAt: "2026-04-26T00:01:00.000Z",
      }),
      tx,
      userId: "member_workspace_1",
    });

    expect(result).toMatchObject({
      status: "conflict",
      workspace: {
        snapshotRef,
        version: "6",
      },
    });
    expect(hostedWorkspace.updateMany).not.toHaveBeenCalled();
  });

  it("publishes live latest-ref browser-vault refs without coupling them to workspace snapshot source", async () => {
    const replicaRef = createBrowserVaultReplicaRef("delta_2_hash");
    const current = buildHostedWorkspaceRow({
      snapshotRef: createWorkingSnapshotRef({
        base: createBundleRef("snapshot_2"),
        delta: createBundleRef("delta_3"),
      }),
      version: 6n,
    });
    const updated = buildHostedWorkspaceRow({
      browserVaultReplicaRef: replicaRef,
      snapshotRef: current.snapshotRef,
      version: 6n,
    });
    const findUniqueRows = [current, updated];
    const hostedWorkspace = createHostedWorkspaceDelegate({
      findUnique: vi.fn<HostedWorkspaceFindUnique>(async () => findUniqueRows.shift() ?? updated),
    });
    const tx = createHostedWorkspaceTx({
      hostedWorkspace,
    });

    const result = await publishLatestBrowserVaultReplicaRefTx({
      replicaRef,
      tx,
      userId: "member_workspace_1",
    });

    expect(result).toMatchObject({
      status: "published",
      workspace: {
        browserVaultReplicaRef: replicaRef,
        snapshotRef: current.snapshotRef,
        version: "6",
      },
    });
    expect(hostedWorkspace.updateMany).toHaveBeenCalledOnce();
  });

  it("keeps the old hosted browser-vault publish name as a latest-ref compatibility wrapper", async () => {
    const replicaRef = createBrowserVaultReplicaRef("delta_2_hash");
    const current = buildHostedWorkspaceRow({
      snapshotRef: createWorkingSnapshotRef({
        base: createBundleRef("snapshot_2"),
        delta: createBundleRef("delta_3"),
      }),
      version: 6n,
    });
    const updated = buildHostedWorkspaceRow({
      browserVaultReplicaRef: replicaRef,
      snapshotRef: current.snapshotRef,
      version: 6n,
    });
    const findUniqueRows = [current, updated];
    const hostedWorkspace = createHostedWorkspaceDelegate({
      findUnique: vi.fn<HostedWorkspaceFindUnique>(async () => findUniqueRows.shift() ?? updated),
    });
    const prisma = createHostedWorkspaceClient({
      hostedWorkspace,
    });

    const result = await publishHostedBrowserVaultReplicaRef({
      prisma,
      replicaRef,
      userId: "member_workspace_1",
    });

    expect(result).toMatchObject({
      status: "published",
      workspace: {
        browserVaultReplicaRef: replicaRef,
        version: "6",
      },
    });
    expect(hostedWorkspace.updateMany).toHaveBeenCalledOnce();
  });

});

describe("hosted runtime log store", () => {
  it("selects the earliest recent same-user accepted-failure log as signal owner", async () => {
    const findFirst = vi.fn<HostedRuntimeLogFindFirst>(async () => ({ id: "runtime_log_prior" }));
    const prisma = Object.assign(Object.create(null), {
      hostedRuntimeLog: {
        findFirst,
      },
    }) as Parameters<typeof readAcceptedRuntimeAttemptFailureSignalOwnerLogId>[0]["prisma"];

    const result = await readAcceptedRuntimeAttemptFailureSignalOwnerLogId({
      prisma,
      since: new Date("2026-05-27T12:34:00.000Z"),
      userId: "member_workspace_1",
    });

    expect(result).toBe("runtime_log_prior");
    expect(findFirst).toHaveBeenCalledWith({
      orderBy: [
        { createdAt: "asc" },
        { id: "asc" },
      ],
      select: {
        id: true,
      },
      where: {
        createdAt: {
          gte: new Date("2026-05-27T12:34:00.000Z"),
        },
        eventCode: "runner.accepted_attempt_failed",
        userId: "member_workspace_1",
      },
    });
  });

  it("inserts parser-accepted structured log fields", async () => {
    const hostedRuntimeLog = createHostedRuntimeLogDelegate();
    const tx = createHostedWorkspaceTx({
      hostedRuntimeLog,
      hostedWorkspace: createHostedWorkspaceDelegate(),
    });

    const result = await recordHostedRuntimeLogTx({
      at: "2026-04-26T00:02:00.000Z",
      component: "mailbox",
      eventCode: "mailbox.imported",
      level: "warn",
      mailboxLane: "conversation",
      mailboxSeqStart: "12",
      phase: "import",
      redacted: {
        dedupeConflict: true,
        incomingKind: "conversation.message",
        unallowlistedDetail: "DROP_THIS",
      },
      tx,
      userId: "member_workspace_1",
      workspaceVersion: 5n,
    });

    expect(hostedRuntimeLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        at: new Date("2026-04-26T00:02:00.000Z"),
        component: "mailbox",
        eventCode: "mailbox.imported",
        level: "warn",
        mailboxLane: "conversation",
        mailboxSeqStart: 12n,
        phase: "import",
        redactedJson: {
          dedupeConflict: true,
          incomingKind: "conversation.message",
          unallowlistedDetail: "DROP_THIS",
        },
        userId: "member_workspace_1",
        workspaceVersion: 5n,
      }),
    });
    expect(result.redactedJson).toEqual({
      dedupeConflict: true,
      incomingKind: "conversation.message",
      unallowlistedDetail: "DROP_THIS",
    });
  });

  it("persists sanitized device-sync provider failure diagnostics", async () => {
    const hostedRuntimeLog = createHostedRuntimeLogDelegate();
    const tx = createHostedWorkspaceTx({
      hostedRuntimeLog,
      hostedWorkspace: createHostedWorkspaceDelegate(),
    });
    const diagnostic = {
      failureCode: "WHOOP_TOKEN_REQUEST_FAILED",
      failureRetryable: false,
      failureSummary: "WHOOP token request failed.",
      provider: "whoop",
      providerHttpStatus: 400,
      providerHttpStatusText: "Bad Request",
      providerRequestAuthKind: "oauth_client_secret_body",
      providerRequestBodyFieldCount: 5,
      providerRequestBodyFieldNames: "client_id.client_secret.grant_type.refresh_token.scope",
      providerRequestBodyKind: "form_urlencoded",
      providerRequestEndpointKind: "whoop_oauth_token",
      providerRequestMethod: "POST",
      providerResponseErrorCode: "invalid_grant",
      providerResponseErrorDescription: "Refresh token expired. Reconnect WHOOP.",
      providerResponseShapeKind: "json_object",
      providerOAuthErrorCode: "invalid_grant",
      providerOAuthErrorDescription: "Refresh token expired. Reconnect WHOOP.",
      providerOAuthGrantType: "refresh_token",
      providerOAuthRequestBodyBuilderKind: "url_search_params_record",
      providerOAuthRequestClientAuthPlacement: "body_parameters",
      providerOAuthRequestClientCredentialPresent: true,
      providerOAuthRequestClientIdPresent: true,
      providerOAuthRequestContentType: "application_x_www_form_urlencoded",
      providerOAuthRequestDuplicateParameterCount: 0,
      providerOAuthRequestEncodingKind: "form_urlencoded",
      providerOAuthRequestHasDuplicateParameters: false,
      providerOAuthRequestMethod: "POST",
      providerOAuthRequestOfflineScopePresent: true,
      providerOAuthRequestParameterCount: 5,
      providerOAuthRequestParameterNames: "client_id.client_secret.grant_type.refresh_token.scope",
      providerOAuthRequestRefreshCredentialPresent: true,
      providerOAuthRequestScopeCount: 1,
      providerOAuthRequestScopePresent: true,
      providerOAuthRequestScopeValue: "offline",
      providerOAuthRequestTokenEndpointKind: "whoop_oauth_token",
      providerOAuthResponseErrorDescriptionFieldPresent: true,
      providerOAuthResponseErrorFieldPresent: true,
      providerOAuthResponseShapeKind: "json_object",
    };

    const result = await recordHostedRuntimeLogTx({
      at: "2026-05-19T22:03:27.378Z",
      component: "device-sync",
      errorCode: "WHOOP_TOKEN_REQUEST_FAILED",
      eventCode: "device-sync.job_failed",
      level: "warn",
      phase: "invoke",
      redacted: diagnostic,
      tx,
      userId: "member_workspace_1",
    });

    expect(hostedRuntimeLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        component: "device-sync",
        errorCode: "WHOOP_TOKEN_REQUEST_FAILED",
        eventCode: "device-sync.job_failed",
        level: "warn",
        phase: "invoke",
        redactedJson: diagnostic,
      }),
    });
    expect(result.redactedJson).toEqual(diagnostic);
  });

  it("persists OpenAI cache diagnostics as bounded redacted metadata", async () => {
    const hostedRuntimeLog = createHostedRuntimeLogDelegate();
    const tx = createHostedWorkspaceTx({
      hostedRuntimeLog,
      hostedWorkspace: createHostedWorkspaceDelegate(),
    });
    const diagnostic = {
      cacheNamespaceFingerprint: `hmac-sha256:${"a".repeat(64)}`,
      cacheNamespaceFingerprintPresent: true,
      cacheNamespacePresent: true,
      cacheRetentionKind: "24h",
      diagnosticVersion: 1,
      endpointKind: "responses",
      fingerprintKind: "hmac-sha256",
      inputBytes: 8192,
      inputCount: 1,
      inputFingerprintPresent: true,
      inputPrefixFingerprints: [`hmac-sha256:${"b".repeat(64)}`],
      inputPrefixLengths: [8192],
      inputPresent: true,
      inputType: "array",
      instructionsBytes: 4096,
      instructionsPresent: true,
      jsonType: "object",
      jsonValid: true,
      methodKind: "POST",
      modelKind: "gpt-5.5",
      previousResponseFingerprint: `hmac-sha256:${"c".repeat(64)}`,
      previousResponseFingerprintPresent: true,
      previousResponsePresent: true,
      providerKind: "openai",
      requestBytes: 16384,
      requestFieldCount: 9,
      requestFingerprintPresent: true,
      requestPrefixFingerprints: [`hmac-sha256:${"d".repeat(64)}`],
      requestPrefixLengths: [8192],
      storePresent: true,
      streamPresent: true,
      toolCount: 1,
    };

    const result = await recordHostedRuntimeLogTx({
      at: "2026-04-26T00:02:00.000Z",
      attemptId: "attempt_1",
      component: "runner",
      eventCode: "runner.provider_egress_diagnostic",
      leaseGeneration: "7",
      level: "debug",
      phase: "fetch",
      redacted: diagnostic,
      tx,
      userId: "member_workspace_1",
      workspaceVersion: "4",
    });

    expect(hostedRuntimeLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        attemptId: "attempt_1",
        component: "runner",
        eventCode: "runner.provider_egress_diagnostic",
        leaseGeneration: 7n,
        level: "debug",
        phase: "fetch",
        redactedJson: diagnostic,
        userId: "member_workspace_1",
        workspaceVersion: 4n,
      }),
    });
    expect(result.redactedJson).toEqual(diagnostic);
  });

  it("persists bounded Codex action tool summaries", async () => {
    const hostedRuntimeLog = createHostedRuntimeLogDelegate();
    const tx = createHostedWorkspaceTx({
      hostedRuntimeLog,
      hostedWorkspace: createHostedWorkspaceDelegate(),
    });
    const diagnostic: HostedRuntimeRedactedJson = {
      codexActionToolSummaries: [
        {
          callCount: 1,
          kind: "dynamic.tool.call",
          namespacePresent: true,
          outputBytesMax: 64,
          outputBytesTotal: 96,
          tool: "readSummary",
        },
        {
          callCount: 1,
          kind: "command.execution",
          outputBytesMax: 32,
          outputBytesTotal: 32,
        },
      ],
    };

    const result = await recordHostedRuntimeLogTx({
      at: "2026-04-26T00:02:00.000Z",
      component: "assistant",
      eventCode: "assistant.automation_detail",
      level: "info",
      phase: "invoke",
      redacted: diagnostic,
      tx,
      userId: "member_workspace_1",
    });

    expect(hostedRuntimeLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        component: "assistant",
        eventCode: "assistant.automation_detail",
        phase: "invoke",
        redactedJson: diagnostic,
      }),
    });
    expect(result.redactedJson).toEqual(diagnostic);
  });

  it("rejects raw OpenAI diagnostic payload fields before persistence", async () => {
    const hostedRuntimeLog = createHostedRuntimeLogDelegate();
    const tx = createHostedWorkspaceTx({
      hostedRuntimeLog,
      hostedWorkspace: createHostedWorkspaceDelegate(),
    });

    await expect(recordHostedRuntimeLogTx({
      at: "2026-04-26T00:02:00.000Z",
      component: "runner",
      eventCode: "runner.provider_egress_diagnostic",
      level: "debug",
      phase: "fetch",
      redacted: {
        promptText: "redacted",
      },
      tx,
      userId: "member_workspace_1",
    })).rejects.toThrow(/not allowed/u);

    await expect(recordHostedRuntimeLogTx({
      at: "2026-04-26T00:02:00.000Z",
      component: "runner",
      eventCode: "runner.provider_egress_diagnostic",
      level: "debug",
      phase: "fetch",
      redacted: {
        requestBody: "redacted",
      },
      tx,
      userId: "member_workspace_1",
    })).rejects.toThrow(/not allowed/u);

    expect(hostedRuntimeLog.create).not.toHaveBeenCalled();
  });

  it("allows bounded sanitized device-sync failure summaries", async () => {
    const hostedRuntimeLog = createHostedRuntimeLogDelegate();
    const tx = createHostedWorkspaceTx({
      hostedRuntimeLog,
      hostedWorkspace: createHostedWorkspaceDelegate(),
    });
    const failureSummary = [
      "Device provider snapshot import input is invalid.",
      `validationIssues=${"collectionTypeMismatch ".repeat(40).trim()}`,
    ].join(" | ");

    const result = await recordHostedRuntimeLogTx({
      at: "2026-04-26T00:02:00.000Z",
      component: "device-sync",
      errorCode: "SYNC_JOB_FAILED",
      eventCode: "device-sync.job_failed",
      level: "warn",
      phase: "invoke",
      redacted: {
        failureCode: "SYNC_JOB_FAILED",
        failureSummary,
        provider: "whoop",
      },
      tx,
      userId: "member_workspace_1",
    });

    expect(failureSummary.length).toBeGreaterThan(128);
    expect(hostedRuntimeLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        component: "device-sync",
        errorCode: "SYNC_JOB_FAILED",
        eventCode: "device-sync.job_failed",
        level: "warn",
        phase: "invoke",
        redactedJson: {
          failureCode: "SYNC_JOB_FAILED",
          failureSummary,
          provider: "whoop",
        },
      }),
    });
    expect(result.redactedJson).toEqual({
      failureCode: "SYNC_JOB_FAILED",
      failureSummary,
      provider: "whoop",
    });
  });

  it("allows bounded safe runtime diagnostic text keys", async () => {
    const hostedRuntimeLog = createHostedRuntimeLogDelegate();
    const tx = createHostedWorkspaceTx({
      hostedRuntimeLog,
      hostedWorkspace: createHostedWorkspaceDelegate(),
    });

    const result = await recordHostedRuntimeLogTx({
      at: "2026-04-26T00:02:00.000Z",
      component: "assistant",
      errorCode: "ASSISTANT_CODEX_FAILED",
      eventCode: "assistant.automation_detail",
      level: "warn",
      phase: "invoke",
      redacted: {
        assistantNotificationErrorMessage: "Hosted assistant notification failed.",
        customProviderErrorDetail: "Provider rejected the request after resume.",
        failureAssistantProviderErrorMessage: "provider rejected the request",
        safeErrorMessage: "Codex app-server failed before producing a reply.",
      },
      tx,
      userId: "member_workspace_1",
    });

    expect(result.redactedJson).toEqual({
      assistantNotificationErrorMessage: "Hosted assistant notification failed.",
      customProviderErrorDetail: "Provider rejected the request after resume.",
      failureAssistantProviderErrorMessage: "provider rejected the request",
      safeErrorMessage: "Codex app-server failed before producing a reply.",
    });
  });

  it("allows metadata-only redacted keys that mention sensitive field names", async () => {
    const hostedRuntimeLog = createHostedRuntimeLogDelegate();
    const tx = createHostedWorkspaceTx({
      hostedRuntimeLog,
      hostedWorkspace: createHostedWorkspaceDelegate(),
    });

    const result = await recordHostedRuntimeLogTx({
      at: "2026-04-26T00:02:00.000Z",
      component: "assistant",
      errorCode: "ASSISTANT_CODEX_FAILED",
      eventCode: "assistant.automation_detail",
      level: "warn",
      phase: "invoke",
      redacted: {
        authorizationHeaderPresent: false,
        codexInvalidOutputErrorMessageLength: 96,
        codexResumeFailureErrorMessageLength: 251,
        messageStatus: "failed",
        promptTokenCount: 120,
        rawPayloadBytes: 2048,
        authorizationHeaderValue: "redacted",
        bodyJson: "redacted",
        messageContent: "redacted",
        messageText: 1,
        payloadValue: "redacted",
        tokenPreview: "redacted",
        routePlanningActiveExperimentContextElapsedMs: 6000,
        routePlanningAssistantContextSnapshotElapsedMs: 8,
        routePlanningCliBootstrapElapsedMs: null,
        routePlanningElapsedMs: 16,
        routePlanningFallbackInstructionsElapsedMs: null,
        routePlanningAnyBootstrapContextPrepared: true,
        routePlanningBootstrapContextPrepared: false,
        routePlanningFreshThreadFallbackPromptElapsedMs: null,
        routePlanningFreshThreadFallbackPrepared: false,
        routePlanningMeasuredElapsedMs: 15,
        routePlanningMemoryOverviewElapsedMs: null,
        routePlanningPrimaryInstructionsElapsedMs: 12,
        routePlanningPrimarySystemPromptElapsedMs: 12,
        routePlanningResumeBindingElapsedMs: 0,
        routePlanningSensitiveHealthContextAllowed: true,
        routePlanningSlowestStage: "assistant_context_snapshot",
        routePlanningSlowestStageElapsedMs: 8,
        routePlanningSupportedExperimentProtocolsElapsedMs: 0,
        routePlanningTargetCapabilitiesElapsedMs: 1,
        routePlanningUnaccountedElapsedMs: 1,
        routePlanningVaultOverviewElapsedMs: null,
      },
      tx,
      userId: "member_workspace_1",
    });

    expect(result.redactedJson).toEqual({
      authorizationHeaderPresent: false,
      codexInvalidOutputErrorMessageLength: 96,
      codexResumeFailureErrorMessageLength: 251,
      messageStatus: "failed",
      promptTokenCount: 120,
      rawPayloadBytes: 2048,
      authorizationHeaderValue: "redacted",
      bodyJson: "redacted",
      messageContent: "redacted",
      messageText: 1,
      payloadValue: "redacted",
      tokenPreview: "redacted",
      routePlanningActiveExperimentContextElapsedMs: 6000,
      routePlanningAssistantContextSnapshotElapsedMs: 8,
      routePlanningCliBootstrapElapsedMs: null,
      routePlanningElapsedMs: 16,
      routePlanningFallbackInstructionsElapsedMs: null,
      routePlanningAnyBootstrapContextPrepared: true,
      routePlanningBootstrapContextPrepared: false,
      routePlanningFreshThreadFallbackPromptElapsedMs: null,
      routePlanningFreshThreadFallbackPrepared: false,
      routePlanningMeasuredElapsedMs: 15,
      routePlanningMemoryOverviewElapsedMs: null,
      routePlanningPrimaryInstructionsElapsedMs: 12,
      routePlanningPrimarySystemPromptElapsedMs: 12,
      routePlanningResumeBindingElapsedMs: 0,
      routePlanningSensitiveHealthContextAllowed: true,
      routePlanningSlowestStage: "assistant_context_snapshot",
      routePlanningSlowestStageElapsedMs: 8,
      routePlanningSupportedExperimentProtocolsElapsedMs: 0,
      routePlanningTargetCapabilitiesElapsedMs: 1,
      routePlanningUnaccountedElapsedMs: 1,
      routePlanningVaultOverviewElapsedMs: null,
    });

    for (const timingKey of [
      "routePlanningActiveExperimentContextElapsedMs",
      "routePlanningAssistantContextSnapshotElapsedMs",
      "routePlanningElapsedMs",
      "routePlanningFreshThreadFallbackPromptElapsedMs",
      "routePlanningPrimarySystemPromptElapsedMs",
      "routePlanningVaultOverviewElapsedMs",
    ] as const) {
      await expect(recordHostedRuntimeLogTx({
        at: "2026-04-26T00:02:00.000Z",
        component: "assistant",
        errorCode: "ASSISTANT_CODEX_FAILED",
        eventCode: "assistant.automation_detail",
        level: "warn",
        phase: "invoke",
        redacted: {
          [timingKey]: "prompt-like timing text",
        },
        tx,
        userId: "member_workspace_1",
      })).rejects.toThrow(/finite number or null/u);
      await expect(recordHostedRuntimeLogTx({
        at: "2026-04-26T00:02:00.000Z",
        component: "assistant",
        errorCode: "ASSISTANT_CODEX_FAILED",
        eventCode: "assistant.automation_detail",
        level: "warn",
        phase: "invoke",
        redacted: {
          [timingKey]: -1,
        },
        tx,
        userId: "member_workspace_1",
      })).rejects.toThrow(/nonnegative finite number or null/u);
    }
    await expect(recordHostedRuntimeLogTx({
      at: "2026-04-26T00:02:00.000Z",
      component: "assistant",
      errorCode: "ASSISTANT_CODEX_FAILED",
      eventCode: "assistant.automation_detail",
      level: "warn",
      phase: "invoke",
      redacted: {
        routePlanningGlucoseContextElapsedMs: 12,
      },
      tx,
      userId: "member_workspace_1",
    })).rejects.toThrow(/allowed route-planning diagnostic key/u);
    await expect(recordHostedRuntimeLogTx({
      at: "2026-04-26T00:02:00.000Z",
      component: "assistant",
      errorCode: "ASSISTANT_CODEX_FAILED",
      eventCode: "assistant.automation_detail",
      level: "warn",
      phase: "invoke",
      redacted: {
        routePlanningSlowestStage: "oura_sleep_context",
      },
      tx,
      userId: "member_workspace_1",
    })).rejects.toThrow(/known route-planning stage/u);
  });

  it("rejects raw-value redacted keys that mention sensitive field names", async () => {
    const hostedRuntimeLog = createHostedRuntimeLogDelegate();
    const tx = createHostedWorkspaceTx({
      hostedRuntimeLog,
      hostedWorkspace: createHostedWorkspaceDelegate(),
    });

    for (const rawKey of [
      "authorizationHeaderRawValue",
      "bodyJsonRawValue",
      "messageContentRawValue",
      "payloadRawValue",
      "tokenRawValue",
    ]) {
      await expect(recordHostedRuntimeLogTx({
        at: "2026-04-26T00:02:00.000Z",
        component: "assistant",
        errorCode: "ASSISTANT_CODEX_FAILED",
        eventCode: "assistant.automation_detail",
        level: "warn",
        phase: "invoke",
        redacted: {
          [rawKey]: "redacted",
        },
        tx,
        userId: "member_workspace_1",
      })).rejects.toThrow(/not allowed/u);
    }
  });

  it("rejects unsafe or oversized redacted log metadata before persistence", async () => {
    const hostedRuntimeLog = createHostedRuntimeLogDelegate();
    const tx = createHostedWorkspaceTx({
      hostedRuntimeLog,
      hostedWorkspace: createHostedWorkspaceDelegate(),
    });

    await expect(recordHostedRuntimeLogTx({
      at: "2026-04-26T00:02:00.000Z",
      component: "mailbox",
      eventCode: "mailbox.imported",
      level: "warn",
      phase: "import",
      redacted: {
        reason: `sent to ${["person", "example.test"].join("@")}`,
      },
      tx,
      userId: "member_workspace_1",
    })).rejects.toThrow(/email address/u);

    await expect(recordHostedRuntimeLogTx({
      at: "2026-04-26T00:02:00.000Z",
      component: "mailbox",
      eventCode: "mailbox.imported",
      level: "warn",
      phase: "import",
      redacted: Object.fromEntries(
        Array.from({ length: 97 }, (_, index) => [`count${index}`, index]),
      ),
      tx,
      userId: "member_workspace_1",
    })).rejects.toThrow(/at most 96 fields/u);

    await expect(recordHostedRuntimeLogTx({
      at: "2026-04-26T00:02:00.000Z",
      component: "device-sync",
      eventCode: "device-sync.job_failed",
      level: "warn",
      phase: "invoke",
      redacted: {
        failureSummary: "x".repeat(2049),
      },
      tx,
      userId: "member_workspace_1",
    })).rejects.toThrow(/at most 2048 characters/u);

    expect(hostedRuntimeLog.create).not.toHaveBeenCalled();
  });
});

interface HostedWorkspaceUpdateManyArgs {
  data: Prisma.HostedWorkspaceUpdateManyMutationInput;
  where: {
    browserVaultReplicaRef?: Prisma.HostedWorkspaceWhereInput["browserVaultReplicaRef"];
    userId: string;
    version: bigint;
  };
}

interface HostedWorkspaceFindUniqueArgs {
  where: {
    userId: string;
  };
}

interface HostedWorkspaceUpsertArgs {
  create: {
    userId: string;
  };
  update: Record<string, never>;
  where: {
    userId: string;
  };
}

interface HostedRuntimeLogCreateArgs {
  data: {
    at: Date;
    attemptId: string | null;
    checkpointVersion: bigint | null;
    component: string;
    errorCode: string | null;
    eventCode: string;
    id: string;
    leaseGeneration: bigint | null;
    level: string;
    mailboxLane: string | null;
    mailboxSeqEnd: bigint | null;
    mailboxSeqStart: bigint | null;
    outboxIntentRef: string | null;
    phase: string;
    redactedJson: Prisma.InputJsonValue | typeof Prisma.DbNull;
    userId: string;
    workspaceVersion: bigint | null;
  };
}

interface HostedRuntimeLogFindFirstArgs {
  orderBy: [
    { createdAt: "asc" },
    { id: "asc" },
  ];
  select: {
    id: true;
  };
  where: {
    createdAt: {
      gte: Date;
    };
    eventCode: string;
    userId: string;
  };
}

type HostedWorkspaceUpdateMany = (args: HostedWorkspaceUpdateManyArgs) => Promise<{ count: number }>;
type HostedWorkspaceFindUnique = (args: HostedWorkspaceFindUniqueArgs) => Promise<HostedWorkspaceRow | null>;
type HostedWorkspaceUpsert = (args: HostedWorkspaceUpsertArgs) => Promise<HostedWorkspaceRow>;
type HostedRuntimeLogCreate = (args: HostedRuntimeLogCreateArgs) => Promise<HostedRuntimeLogRow>;
type HostedRuntimeLogFindFirst = (args: HostedRuntimeLogFindFirstArgs) => Promise<{ id: string } | null>;

function buildHostedWorkspaceRow(
  overrides: Partial<HostedWorkspaceRow> = {},
): HostedWorkspaceRow {
  return {
    browserVaultReplicaRef: null,
    checkpointedAt: null,
    createdAt: FIXED_NOW,
    nextWakeAt: null,
    nextWakeReason: null,
    redactedStatusJson: null,
    snapshotRef: null,
    updatedAt: FIXED_NOW,
    userId: "member_workspace_1",
    version: 4n,
    ...overrides,
  };
}

function buildHostedRuntimeLogRow(
  overrides: Partial<HostedRuntimeLogRow> = {},
): HostedRuntimeLogRow {
  return {
    at: FIXED_NOW,
    attemptId: null,
    checkpointVersion: null,
    component: "mailbox",
    createdAt: FIXED_NOW,
    errorCode: null,
    eventCode: "mailbox.imported",
    id: "runtime_log_1",
    leaseGeneration: null,
    level: "warn",
    mailboxLane: "conversation",
    mailboxSeqEnd: null,
    mailboxSeqStart: 12n,
    outboxIntentRef: null,
    phase: "import",
    redactedJson: {
      dedupeConflict: true,
      incomingKind: "conversation.message",
    },
    userId: "member_workspace_1",
    workspaceVersion: 5n,
    ...overrides,
  };
}

function createBundleRef(id: string) {
  return {
    hash: `${id}_hash`,
    key: `bundles/vault/${id}.bundle.json`,
    size: 128,
    updatedAt: "2026-04-26T00:00:00.000Z",
  };
}

function createLayeredSnapshotRef(input: {
  base: ReturnType<typeof createBundleRef> | null;
  hot: ReturnType<typeof createBundleRef> | null;
}) {
  return {
    base: input.base,
    hot: input.hot,
    schema: HOSTED_EXECUTION_LAYERED_SNAPSHOT_REF_SCHEMA,
  };
}

function createWorkingSnapshotRef(input: {
  base: ReturnType<typeof createBundleRef>;
  delta: ReturnType<typeof createBundleRef>;
}) {
  return {
    base: input.base,
    delta: input.delta,
    schema: HOSTED_EXECUTION_WORKING_SNAPSHOT_REF_SCHEMA,
  };
}

function createBrowserVaultReplicaRef(
  sourceBundleHash = "snapshot_2_hash",
  overrides: Partial<{
    generatedAt: string;
  }> = {},
) {
  return {
    byteLength: 256,
    dataVersion: "workspace-test-data-version",
    generatedAt: overrides.generatedAt ?? "2026-04-26T00:00:00.000Z",
    keyId: "browser-key-1",
    objectKey: "browser_projection_1",
    replicaSchema: "murph.browser-vault-replica",
    runtimeRootKeyId: "udrk:runtime:workspace-test",
    schema: "murph.hosted-browser-vault-replica-ref.v1",
    sourceBundleHash,
  };
}

function createHostedWorkspaceDelegate(overrides: Partial<{
  findUnique: ReturnType<typeof vi.fn<HostedWorkspaceFindUnique>>;
  updateMany: ReturnType<typeof vi.fn<HostedWorkspaceUpdateMany>>;
  upsert: ReturnType<typeof vi.fn<HostedWorkspaceUpsert>>;
}> = {}) {
  return {
    findUnique: vi.fn<HostedWorkspaceFindUnique>(async () => buildHostedWorkspaceRow()),
    updateMany: vi.fn<HostedWorkspaceUpdateMany>(async () => ({ count: 1 })),
    upsert: vi.fn<HostedWorkspaceUpsert>(async (args) => buildHostedWorkspaceRow({
      userId: args.create.userId,
    })),
    ...overrides,
  };
}

function createHostedRuntimeLogDelegate(overrides: Partial<{
  create: ReturnType<typeof vi.fn<HostedRuntimeLogCreate>>;
}> = {}) {
  return {
    create: vi.fn<HostedRuntimeLogCreate>(async (args) => {
      const { redactedJson, ...data } = args.data;

      return buildHostedRuntimeLogRow({
        ...data,
        redactedJson: redactedJson === Prisma.DbNull
          ? null
          : JSON.parse(JSON.stringify(redactedJson)) as Prisma.JsonValue,
      });
    }),
    ...overrides,
  };
}

function createHostedWorkspaceTx(input: {
  hostedRuntimeLog?: ReturnType<typeof createHostedRuntimeLogDelegate>;
  hostedWorkspace: ReturnType<typeof createHostedWorkspaceDelegate>;
}) {
  return Object.assign(Object.create(null), {
    hostedRuntimeLog: input.hostedRuntimeLog ?? createHostedRuntimeLogDelegate(),
    hostedWorkspace: input.hostedWorkspace,
  }) as Parameters<typeof checkpointHostedWorkspaceTx>[0]["tx"];
}

function createHostedWorkspaceClient(input: {
  hostedWorkspace: ReturnType<typeof createHostedWorkspaceDelegate>;
}): NonNullable<Parameters<typeof ensureHostedWorkspace>[0]["prisma"]> & HostedWorkspaceTransactionRunner {
  return Object.assign(Object.create(null), {
    hostedWorkspace: input.hostedWorkspace,
    $transaction: async <T>(
      run: (tx: Parameters<typeof checkpointHostedWorkspaceTx>[0]["tx"]) => Promise<T>,
    ) => await run(createHostedWorkspaceTx({
      hostedWorkspace: input.hostedWorkspace,
    })),
  }) as NonNullable<Parameters<typeof ensureHostedWorkspace>[0]["prisma"]> & HostedWorkspaceTransactionRunner;
}
