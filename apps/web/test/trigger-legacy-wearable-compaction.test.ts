import { describe, expect, it, vi } from "vitest";

import {
  LEGACY_WEARABLE_RECEIPT_COMPACTION_WAKE_REASON,
  buildLegacyWearableCompactionTotals,
  parseHostedLegacyWearableCompactionArgs,
  readLegacyWearableCompactionStatusReport,
  readSnapshotSizeReport,
  runHostedLegacyWearableCompactionTrigger,
  type HostedLegacyWearableCompactionStore,
} from "../scripts/trigger-legacy-wearable-compaction";

const NOW = new Date("2026-05-22T12:00:00.000Z");
const SYNTHETIC_MEMBER_ID = "member_sensitive_test";

describe("trigger legacy wearable compaction script", () => {
  it("defaults to dry-run and requires execute before waiting", () => {
    expect(parseHostedLegacyWearableCompactionArgs([])).toMatchObject({
      forceExistingWake: false,
      help: false,
      limit: null,
      memberIds: [],
      mode: "dry_run",
      wait: false,
    });

    expect(() =>
      parseHostedLegacyWearableCompactionArgs(["--wait"])
    ).toThrow("--wait requires --execute.");

    expect(parseHostedLegacyWearableCompactionArgs([
      "--",
      "--execute",
      "--wait",
      "--limit=4",
      "--member-id",
      "member_test_1",
      "--force-existing-wake",
      "--timeout-ms",
      "1000",
      "--poll-ms=10",
    ])).toMatchObject({
      forceExistingWake: true,
      limit: 4,
      memberIds: ["member_test_1"],
      mode: "execute",
      pollMs: 10,
      timeoutMs: 1000,
      wait: true,
    });
  });

  it("reads v2 snapshot sizes without retaining sensitive ref fields", () => {
    const report = readSnapshotSizeReport(buildSnapshotRef({
      encryptedByteSize: 48 * 1024 * 1024,
      totalPlainBytes: 1100 * 1024 * 1024,
    }));

    expect(report).toEqual({
      encryptedBytes: 50331648,
      encryptedMiB: 48,
      fileCount: 17,
      kind: "v2",
      plainBytes: 1153433600,
      plainMiB: 1100,
    });
    expect(JSON.stringify(report)).not.toContain(SYNTHETIC_MEMBER_ID);
    expect(JSON.stringify(report)).not.toContain("users/");
    expect(JSON.stringify(report)).not.toContain("sha256");
  });

  it("builds dry-run reports without exposing member ids from rows or refs", async () => {
    const store = fakeStore({
      hostedMemberRows: [{
        hostedWorkspace: {
          checkpointedAt: NOW,
          nextWakeAt: null,
          nextWakeReason: null,
          redactedStatusJson: null,
          snapshotRef: buildSnapshotRef({
            encryptedByteSize: 1024,
            totalPlainBytes: 2048,
          }),
          updatedAt: NOW,
          userId: SYNTHETIC_MEMBER_ID,
          version: 4n,
        },
        id: SYNTHETIC_MEMBER_ID,
      }],
    });

    const report = await runHostedLegacyWearableCompactionTrigger({
      now: NOW,
      options: parseHostedLegacyWearableCompactionArgs([]),
      store,
    });

    expect(report.targets).toHaveLength(1);
    expect(report.targets[0]).toMatchObject({
      dryRun: true,
      scheduledWakeReason: null,
      signalAccepted: false,
      status: "dry_run",
      target: 1,
      versionAfterSchedule: null,
      versionBefore: "4",
    });
    expect(report.totals).toMatchObject({
      beforeEncryptedBytes: 1024,
      beforeKnownCount: 1,
      targetCount: 1,
    });
    expect(JSON.stringify(report)).not.toContain(SYNTHETIC_MEMBER_ID);
    expect(JSON.stringify(report)).not.toContain("users/");
    expect(JSON.stringify(report)).not.toContain("workspace-snapshots");
  });

  it("schedules the existing wake reason and accepts a runtime poke on execute", async () => {
    const signalWithStart = vi.fn().mockResolvedValue(undefined);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findUnique = vi.fn().mockResolvedValue({
      checkpointedAt: NOW,
      nextWakeAt: NOW,
      nextWakeReason: LEGACY_WEARABLE_RECEIPT_COMPACTION_WAKE_REASON,
      redactedStatusJson: null,
      snapshotRef: buildSnapshotRef({
        encryptedByteSize: 1024,
        totalPlainBytes: 2048,
      }),
      updatedAt: NOW,
      userId: SYNTHETIC_MEMBER_ID,
      version: 5n,
    });
    const store = fakeStore({
      hostedMemberRows: [{
        hostedWorkspace: {
          checkpointedAt: NOW,
          nextWakeAt: null,
          nextWakeReason: null,
          redactedStatusJson: null,
          snapshotRef: buildSnapshotRef({
            encryptedByteSize: 1024,
            totalPlainBytes: 2048,
          }),
          updatedAt: NOW,
          userId: SYNTHETIC_MEMBER_ID,
          version: 4n,
        },
        id: SYNTHETIC_MEMBER_ID,
      }],
      hostedWorkspace: {
        findUnique,
        updateMany,
      },
    });

    const report = await runHostedLegacyWearableCompactionTrigger({
      createTemporalClient: async () => ({
        workflow: {
          signalWithStart,
        },
      }),
      now: NOW,
      options: parseHostedLegacyWearableCompactionArgs(["--execute"]),
      store,
    });

    expect(updateMany).toHaveBeenCalledWith({
      data: {
        nextWakeAt: NOW,
        nextWakeReason: LEGACY_WEARABLE_RECEIPT_COMPACTION_WAKE_REASON,
        version: {
          increment: 1,
        },
      },
      where: {
        OR: [
          {
            nextWakeAt: null,
          },
          {
            nextWakeReason: LEGACY_WEARABLE_RECEIPT_COMPACTION_WAKE_REASON,
          },
        ],
        userId: SYNTHETIC_MEMBER_ID,
        version: 4n,
      },
    });
    expect(signalWithStart).toHaveBeenCalledOnce();
    expect(signalWithStart).toHaveBeenCalledWith(
      "hostedUserRuntimeWorkflow",
      expect.objectContaining({
        signal: "runtimeSignal",
        signalArgs: [{ kind: "mailbox_lag_observed" }],
        taskQueue: "murph-hosted-runtime",
        workflowId: `hosted-user-runtime:${SYNTHETIC_MEMBER_ID}`,
      }),
    );
    expect(report.targets[0]).toMatchObject({
      dryRun: false,
      scheduledWakeReason: LEGACY_WEARABLE_RECEIPT_COMPACTION_WAKE_REASON,
      signalAccepted: true,
      status: "scheduled",
      versionAfterSchedule: "5",
    });
    expect(JSON.stringify(report)).not.toContain(SYNTHETIC_MEMBER_ID);
  });

  it("does not overwrite a non-compaction workspace wake", async () => {
    const createTemporalClient = vi.fn().mockResolvedValue({
      workflow: {
        signalWithStart: vi.fn(),
      },
    });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const store = fakeStore({
      hostedMemberRows: [{
        hostedWorkspace: {
          checkpointedAt: NOW,
          nextWakeAt: new Date(NOW.getTime() + 60_000),
          nextWakeReason: "assistant",
          redactedStatusJson: null,
          snapshotRef: buildSnapshotRef({
            encryptedByteSize: 1024,
            totalPlainBytes: 2048,
          }),
          updatedAt: NOW,
          userId: SYNTHETIC_MEMBER_ID,
          version: 4n,
        },
        id: SYNTHETIC_MEMBER_ID,
      }],
      hostedWorkspace: {
        updateMany,
      },
    });

    const report = await runHostedLegacyWearableCompactionTrigger({
      createTemporalClient,
      now: NOW,
      options: parseHostedLegacyWearableCompactionArgs(["--execute"]),
      store,
    });

    expect(createTemporalClient).toHaveBeenCalledOnce();
    expect(updateMany).not.toHaveBeenCalled();
    expect(report.targets[0]).toMatchObject({
      status: "skipped_existing_wake",
      versionAfterSchedule: null,
    });
  });

  it("overwrites a non-compaction workspace wake only with the force flag", async () => {
    const signalWithStart = vi.fn().mockResolvedValue(undefined);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findUnique = vi.fn().mockResolvedValue({
      checkpointedAt: NOW,
      nextWakeAt: NOW,
      nextWakeReason: LEGACY_WEARABLE_RECEIPT_COMPACTION_WAKE_REASON,
      redactedStatusJson: null,
      snapshotRef: buildSnapshotRef({
        encryptedByteSize: 1024,
        totalPlainBytes: 2048,
      }),
      updatedAt: NOW,
      userId: SYNTHETIC_MEMBER_ID,
      version: 5n,
    });
    const store = fakeStore({
      hostedMemberRows: [{
        hostedWorkspace: {
          checkpointedAt: NOW,
          nextWakeAt: new Date(NOW.getTime() + 60_000),
          nextWakeReason: "device-sync.reconcile",
          redactedStatusJson: null,
          snapshotRef: buildSnapshotRef({
            encryptedByteSize: 1024,
            totalPlainBytes: 2048,
          }),
          updatedAt: NOW,
          userId: SYNTHETIC_MEMBER_ID,
          version: 4n,
        },
        id: SYNTHETIC_MEMBER_ID,
      }],
      hostedWorkspace: {
        findUnique,
        updateMany,
      },
    });

    const report = await runHostedLegacyWearableCompactionTrigger({
      createTemporalClient: async () => ({
        workflow: {
          signalWithStart,
        },
      }),
      now: NOW,
      options: parseHostedLegacyWearableCompactionArgs([
        "--execute",
        "--force-existing-wake",
      ]),
      store,
    });

    expect(updateMany).toHaveBeenCalledWith({
      data: {
        nextWakeAt: NOW,
        nextWakeReason: LEGACY_WEARABLE_RECEIPT_COMPACTION_WAKE_REASON,
        version: {
          increment: 1,
        },
      },
      where: {
        userId: SYNTHETIC_MEMBER_ID,
        version: 4n,
      },
    });
    expect(signalWithStart).toHaveBeenCalledOnce();
    expect(report.targets[0]).toMatchObject({
      scheduledWakeReason: LEGACY_WEARABLE_RECEIPT_COMPACTION_WAKE_REASON,
      signalAccepted: true,
      status: "scheduled",
      versionAfterSchedule: "5",
    });
    expect(JSON.stringify(report)).not.toContain(SYNTHETIC_MEMBER_ID);
  });

  it("connects Temporal before mutating any workspace in execute mode", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const store = fakeStore({
      hostedMemberRows: [{
        hostedWorkspace: {
          checkpointedAt: NOW,
          nextWakeAt: null,
          nextWakeReason: null,
          redactedStatusJson: null,
          snapshotRef: buildSnapshotRef({
            encryptedByteSize: 1024,
            totalPlainBytes: 2048,
          }),
          updatedAt: NOW,
          userId: SYNTHETIC_MEMBER_ID,
          version: 4n,
        },
        id: SYNTHETIC_MEMBER_ID,
      }],
      hostedWorkspace: {
        updateMany,
      },
    });

    await expect(runHostedLegacyWearableCompactionTrigger({
      createTemporalClient: async () => {
        throw new Error("Temporal unavailable");
      },
      now: NOW,
      options: parseHostedLegacyWearableCompactionArgs(["--execute"]),
      store,
    })).rejects.toThrow("Temporal unavailable");

    expect(updateMany).not.toHaveBeenCalled();
  });

  it("reports waited compaction status and before/after totals without snapshot internals", async () => {
    const signalWithStart = vi.fn().mockResolvedValue(undefined);
    const afterSnapshotRef = buildSnapshotRef({
      encryptedByteSize: 700,
      totalPlainBytes: 1200,
    });
    const compactionStatus = {
      legacyWearableReceiptCompactionBytesAfter: 1200,
      legacyWearableReceiptCompactionBytesBefore: 2048,
      legacyWearableReceiptCompactionCompactedCount: 2,
      legacyWearableReceiptCompactionHasMore: false,
      legacyWearableReceiptCompactionMutated: true,
      legacyWearableReceiptCompactionOversizedEnvelopeSkippedCount: 0,
      legacyWearableReceiptCompactionOversizedEvidenceSkippedCount: 0,
      legacyWearableReceiptCompactionScannedCount: 3,
      legacyWearableReceiptCompactionSkippedCount: 1,
    };
    const store = fakeStore({
      hostedMemberRows: [{
        hostedWorkspace: {
          checkpointedAt: NOW,
          nextWakeAt: null,
          nextWakeReason: null,
          redactedStatusJson: null,
          snapshotRef: buildSnapshotRef({
            encryptedByteSize: 1024,
            totalPlainBytes: 2048,
          }),
          updatedAt: NOW,
          userId: SYNTHETIC_MEMBER_ID,
          version: 4n,
        },
        id: SYNTHETIC_MEMBER_ID,
      }],
      hostedWorkspace: {
        findMany: vi.fn().mockResolvedValue([{
          checkpointedAt: new Date(NOW.getTime() + 1),
          nextWakeAt: null,
          nextWakeReason: null,
          redactedStatusJson: compactionStatus,
          snapshotRef: afterSnapshotRef,
          updatedAt: new Date(NOW.getTime() + 1),
          userId: SYNTHETIC_MEMBER_ID,
          version: 6n,
        }]),
        findUnique: vi.fn().mockResolvedValue({
          checkpointedAt: NOW,
          nextWakeAt: NOW,
          nextWakeReason: LEGACY_WEARABLE_RECEIPT_COMPACTION_WAKE_REASON,
          redactedStatusJson: null,
          snapshotRef: buildSnapshotRef({
            encryptedByteSize: 1024,
            totalPlainBytes: 2048,
          }),
          updatedAt: NOW,
          userId: SYNTHETIC_MEMBER_ID,
          version: 5n,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    });

    const report = await runHostedLegacyWearableCompactionTrigger({
      createTemporalClient: async () => ({
        workflow: {
          signalWithStart,
        },
      }),
      now: NOW,
      options: parseHostedLegacyWearableCompactionArgs(["--execute", "--wait"]),
      store,
    });

    expect(report.targets[0]).toMatchObject({
      after: {
        encryptedBytes: 700,
        plainBytes: 1200,
      },
      before: {
        encryptedBytes: 1024,
        plainBytes: 2048,
      },
      compaction: {
        bytesAfter: 1200,
        bytesBefore: 2048,
        compactedCount: 2,
        mutated: true,
        skippedCount: 1,
      },
      status: "completed",
    });
    expect(report.totals).toMatchObject({
      afterEncryptedBytes: 700,
      afterKnownCount: 1,
      beforeEncryptedBytes: 1024,
      beforeKnownCount: 1,
      completedCount: 1,
      encryptedDeltaBytes: -324,
    });
    expect(JSON.stringify(report)).not.toContain(SYNTHETIC_MEMBER_ID);
    expect(JSON.stringify(report)).not.toContain("users/");
    expect(JSON.stringify(report)).not.toContain("workspace-snapshots");
    expect(JSON.stringify(report)).not.toContain("sha256");
  });

  it("continues waiting while the compaction wake remains pending", async () => {
    const signalWithStart = vi.fn().mockResolvedValue(undefined);
    const finalSnapshotRef = buildSnapshotRef({
      encryptedByteSize: 600,
      totalPlainBytes: 1100,
    });
    const compactionStatus = {
      legacyWearableReceiptCompactionBytesAfter: 1100,
      legacyWearableReceiptCompactionBytesBefore: 2048,
      legacyWearableReceiptCompactionCompactedCount: 2,
      legacyWearableReceiptCompactionHasMore: false,
      legacyWearableReceiptCompactionMutated: true,
      legacyWearableReceiptCompactionOversizedEnvelopeSkippedCount: 0,
      legacyWearableReceiptCompactionOversizedEvidenceSkippedCount: 0,
      legacyWearableReceiptCompactionScannedCount: 3,
      legacyWearableReceiptCompactionSkippedCount: 1,
    };
    const findMany = vi.fn()
      .mockResolvedValueOnce([{
        checkpointedAt: new Date(NOW.getTime() + 1),
        nextWakeAt: NOW,
        nextWakeReason: LEGACY_WEARABLE_RECEIPT_COMPACTION_WAKE_REASON,
        redactedStatusJson: null,
        snapshotRef: buildSnapshotRef({
          encryptedByteSize: 900,
          totalPlainBytes: 1800,
        }),
        updatedAt: new Date(NOW.getTime() + 1),
        userId: SYNTHETIC_MEMBER_ID,
        version: 6n,
      }])
      .mockResolvedValueOnce([{
        checkpointedAt: new Date(NOW.getTime() + 2),
        nextWakeAt: null,
        nextWakeReason: null,
        redactedStatusJson: compactionStatus,
        snapshotRef: finalSnapshotRef,
        updatedAt: new Date(NOW.getTime() + 2),
        userId: SYNTHETIC_MEMBER_ID,
        version: 7n,
      }]);
    const store = fakeStore({
      hostedMemberRows: [{
        hostedWorkspace: {
          checkpointedAt: NOW,
          nextWakeAt: null,
          nextWakeReason: null,
          redactedStatusJson: null,
          snapshotRef: buildSnapshotRef({
            encryptedByteSize: 1024,
            totalPlainBytes: 2048,
          }),
          updatedAt: NOW,
          userId: SYNTHETIC_MEMBER_ID,
          version: 4n,
        },
        id: SYNTHETIC_MEMBER_ID,
      }],
      hostedWorkspace: {
        findMany,
        findUnique: vi.fn().mockResolvedValue({
          checkpointedAt: NOW,
          nextWakeAt: NOW,
          nextWakeReason: LEGACY_WEARABLE_RECEIPT_COMPACTION_WAKE_REASON,
          redactedStatusJson: null,
          snapshotRef: buildSnapshotRef({
            encryptedByteSize: 1024,
            totalPlainBytes: 2048,
          }),
          updatedAt: NOW,
          userId: SYNTHETIC_MEMBER_ID,
          version: 5n,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    });

    const report = await runHostedLegacyWearableCompactionTrigger({
      createTemporalClient: async () => ({
        workflow: {
          signalWithStart,
        },
      }),
      now: NOW,
      options: parseHostedLegacyWearableCompactionArgs([
        "--execute",
        "--wait",
        "--poll-ms=1",
        "--timeout-ms=1000",
      ]),
      store,
    });

    expect(findMany).toHaveBeenCalledTimes(2);
    expect(report.targets[0]).toMatchObject({
      after: {
        encryptedBytes: 600,
        plainBytes: 1100,
      },
      status: "completed",
    });
    expect(report.targets[0]?.status).not.toBe("checkpointed_without_compaction_status");
  });

  it("extracts the metadata-only compaction status and totals", () => {
    expect(readLegacyWearableCompactionStatusReport({
      legacyWearableReceiptCompactionBytesAfter: 100,
      legacyWearableReceiptCompactionBytesBefore: 200,
      legacyWearableReceiptCompactionCompactedCount: 3,
      legacyWearableReceiptCompactionHasMore: false,
      legacyWearableReceiptCompactionMutated: true,
      legacyWearableReceiptCompactionOversizedEnvelopeSkippedCount: 0,
      legacyWearableReceiptCompactionOversizedEvidenceSkippedCount: 1,
      legacyWearableReceiptCompactionScannedCount: 4,
      legacyWearableReceiptCompactionSkippedCount: 2,
    })).toEqual({
      bytesAfter: 100,
      bytesBefore: 200,
      compactedCount: 3,
      hasMore: false,
      mutated: true,
      oversizedEnvelopeSkippedCount: 0,
      oversizedEvidenceSkippedCount: 1,
      scannedCount: 4,
      skippedCount: 2,
    });

    expect(buildLegacyWearableCompactionTotals([
      {
        after: {
          encryptedBytes: 70,
          encryptedMiB: 0,
          fileCount: 1,
          kind: "v2",
          plainBytes: 140,
          plainMiB: 0,
        },
        before: {
          encryptedBytes: 100,
          encryptedMiB: 0,
          fileCount: 1,
          kind: "v2",
          plainBytes: 200,
          plainMiB: 0,
        },
        compaction: null,
        dryRun: false,
        scheduledWakeReason: LEGACY_WEARABLE_RECEIPT_COMPACTION_WAKE_REASON,
        signalAccepted: true,
        status: "completed",
        target: 1,
        versionAfterSchedule: "2",
        versionBefore: "1",
      },
    ])).toMatchObject({
      afterEncryptedBytes: 70,
      beforeEncryptedBytes: 100,
      completedCount: 1,
      encryptedDeltaBytes: -30,
    });
  });
});

function fakeStore(input: {
  hostedMemberRows: Awaited<
    ReturnType<HostedLegacyWearableCompactionStore["listActiveMembers"]>
  >;
  hostedWorkspace?: {
    findMany?: (args: unknown) => Promise<Awaited<
      ReturnType<HostedLegacyWearableCompactionStore["findWorkspaces"]>
    >>;
    findUnique?: (args: unknown) => Promise<Awaited<
      ReturnType<HostedLegacyWearableCompactionStore["findWorkspace"]>
    >>;
    updateMany?: (args: unknown) => Promise<{ count: number }>;
  };
}): HostedLegacyWearableCompactionStore {
  const findMany = input.hostedWorkspace?.findMany ?? vi.fn().mockResolvedValue([]);
  const findUnique = input.hostedWorkspace?.findUnique ?? vi.fn().mockResolvedValue(null);
  const updateMany = input.hostedWorkspace?.updateMany ?? vi.fn().mockResolvedValue({ count: 0 });

  return {
    findWorkspace(userId) {
      return findUnique({ userId });
    },
    findWorkspaces(userIds) {
      return findMany({ userIds: [...userIds] });
    },
    listActiveMembers() {
      return Promise.resolve(input.hostedMemberRows);
    },
    markCompactionWakeDue(input) {
      const wakeGuard = input.forceExistingWake
        ? {}
        : {
            OR: [
              {
                nextWakeAt: null,
              },
              {
                nextWakeReason: LEGACY_WEARABLE_RECEIPT_COMPACTION_WAKE_REASON,
              },
            ],
          };
      return updateMany({
        data: {
          nextWakeAt: input.now,
          nextWakeReason: LEGACY_WEARABLE_RECEIPT_COMPACTION_WAKE_REASON,
          version: {
            increment: 1,
          },
        },
        where: {
          ...wakeGuard,
          userId: input.userId,
          version: input.version,
        },
      });
    },
  };
}

function buildSnapshotRef(input: {
  encryptedByteSize: number;
  totalPlainBytes: number;
}): unknown {
  const snapshotId = "snapshot_test_1";
  const objectKey =
    `users/${SYNTHETIC_MEMBER_ID}/workspace-snapshots/${snapshotId}.snapshot.enc`;
  const sha = "a".repeat(64);

  return {
    archive: {
      compression: "zstd",
      encryptedByteSize: input.encryptedByteSize,
      encryptedObjectSha256: sha,
      fileCount: 17,
      format: "tar",
      plaintextArchiveSha256: sha,
      totalPlainBytes: input.totalPlainBytes,
    },
    createdAt: "2026-05-22T11:00:00.000Z",
    encryption: {
      aad: {
        objectKey,
        purpose: "workspace-snapshot",
        schema: "murph.hosted-workspace-snapshot.v2",
        snapshotId,
        userId: SYNTHETIC_MEMBER_ID,
      },
      ivBase64: "YWJjZGVmZ2hpamts",
      rootKeyId: "root_test",
      scheme: "murph.hosted-workspace-snapshot-single-object.v1",
      wrappedDataKey: "wrapped_test",
    },
    objectKey,
    schema: "murph.hosted-workspace-snapshot.v2",
    snapshotId,
    upload: "direct-r2-presigned-put",
    userId: SYNTHETIC_MEMBER_ID,
  };
}
