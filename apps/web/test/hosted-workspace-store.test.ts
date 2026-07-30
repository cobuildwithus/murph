import { Prisma } from "@prisma/client";
import {
  HOSTED_EXECUTION_LAYERED_SNAPSHOT_REF_SCHEMA,
  HOSTED_EXECUTION_WORKING_SNAPSHOT_REF_SCHEMA,
} from "@murphai/hosted-execution/bundles";
import {
  HOSTED_CANONICAL_WRITE_RECEIPT_LOG_BYTE_SIZE_STATUS_KEY,
  HOSTED_CANONICAL_WRITE_RECEIPT_LOG_SHA_STATUS_KEY,
  HOSTED_CANONICAL_WRITE_RECEIPT_RECOVERY_PRIOR_WAKE_AT_STATUS_KEY,
  HOSTED_CANONICAL_WRITE_RECEIPT_RECOVERY_PRIOR_WAKE_REASON_STATUS_KEY,
  HOSTED_CANONICAL_WRITE_RECEIPT_RECOVERY_STATUS_KEY,
} from "@murphai/hosted-execution/runtime-control";
import { describe, expect, it, vi } from "vitest";

import {
  checkpointHostedWorkspace,
  checkpointHostedWorkspaceTx,
  ensureHostedWorkspace,
  publishLatestBrowserVaultReplicaRefTx,
  claimHostedAcceptedAttemptFailureRecheck,
  recordHostedRuntimeLogs,
  type HostedWorkspaceTransactionRunner,
  type HostedWorkspaceRow,
} from "@/src/lib/hosted-workspace/store";

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
        assistantContextSnapshotRefreshAttempted: true,
        assistantContextSnapshotRefreshed: false,
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
          assistantContextSnapshotRefreshAttempted: true,
          assistantContextSnapshotRefreshed: false,
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

  it("advances handled system-mailbox progress in the successful checkpoint transaction", async () => {
    const hostedWorkspace = createHostedWorkspaceDelegate({
      updateMany: vi.fn<HostedWorkspaceUpdateMany>(async () => ({ count: 1 })),
    });
    const hostedMailboxLaneCounter = createHostedMailboxLaneCounterDelegate({
      consumedSeq: 3n,
      nextSeq: 9n,
    });
    const tx = createHostedWorkspaceTx({
      hostedMailboxLaneCounter,
      hostedWorkspace,
    });

    await expect(checkpointHostedWorkspaceTx({
      expectedVersion: "4",
      reason: "idle_shutdown",
      redactedStatusJson: {
        hostedMailboxSystemHandledThroughSeq: "7",
      },
      snapshotRef: createBundleRef("snapshot_system_handled"),
      tx,
      userId: "member_workspace_1",
    })).resolves.toMatchObject({
      status: "updated",
    });

    expect(hostedMailboxLaneCounter.updateMany).toHaveBeenCalledWith({
      data: {
        consumedSeq: 7n,
      },
      where: {
        consumedSeq: {
          lt: 7n,
        },
        lane: "system",
        userId: "member_workspace_1",
      },
    });
  });

  it.each([
    "assistant_runtime_commit",
    "canonical_runtime_commit",
  ] as const)("does not advance handled conversation progress on a %s status checkpoint", async (reason) => {
    const hostedWorkspace = createHostedWorkspaceDelegate({
      updateMany: vi.fn<HostedWorkspaceUpdateMany>(async () => ({ count: 1 })),
    });
    const hostedMailboxLaneCounter = createHostedMailboxLaneCounterDelegate({
      consumedSeq: 3n,
      nextSeq: 9n,
    });
    const hostedMailboxItem = createHostedMailboxItemDelegate();
    const tx = createHostedWorkspaceTx({
      hostedMailboxItem,
      hostedMailboxLaneCounter,
      hostedWorkspace,
    });

    await expect(checkpointHostedWorkspaceTx({
      expectedVersion: "4",
      handledConversationMailboxItemIds: ["item_status_only"],
      reason,
      redactedStatusJson: {
        hostedMailboxConversationImportedSeq: "7",
      },
      snapshotRef: createBundleRef("snapshot_conversation_status_only"),
      tx,
      userId: "member_workspace_1",
    })).resolves.toMatchObject({
      status: "updated",
    });

    expect(hostedWorkspace.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        redactedStatusJson: expect.objectContaining({
          hostedMailboxConversationImportedSeq: "7",
        }),
      }),
    }));
    expect(hostedMailboxItem.updateMany).not.toHaveBeenCalled();
    expect(hostedMailboxLaneCounter.findUnique).not.toHaveBeenCalled();
    expect(hostedMailboxLaneCounter.updateMany).not.toHaveBeenCalled();
  });

  it("advances handled conversation progress in the successful idle checkpoint transaction", async () => {
    const hostedWorkspace = createHostedWorkspaceDelegate({
      updateMany: vi.fn<HostedWorkspaceUpdateMany>(async () => ({ count: 1 })),
    });
    const hostedMailboxLaneCounter = createHostedMailboxLaneCounterDelegate({
      consumedSeq: 3n,
      nextSeq: 9n,
    });
    const hostedMailboxItem = createHostedMailboxItemDelegate({
      findFirst: vi.fn(async () => null),
    });
    const tx = createHostedWorkspaceTx({
      $queryRaw: vi.fn<HostedWorkspaceQueryRaw>(async () => []),
      hostedMailboxItem,
      hostedMailboxLaneCounter,
      hostedWorkspace,
    });

    await expect(checkpointHostedWorkspaceTx({
      checkpointedAt: FIXED_NOW,
      expectedVersion: "4",
      handledConversationMailboxItemIds: ["item_exact_terminal_7"],
      nextWakeAt: "2026-04-26T00:00:15.000Z",
      nextWakeReason: "mailbox",
      reason: "idle_shutdown",
      redactedStatusJson: {
        hostedMailboxConversationImportedSeq: "7",
      },
      snapshotRef: createBundleRef("snapshot_conversation_handled"),
      tx,
      userId: "member_workspace_1",
    })).resolves.toMatchObject({
      status: "updated",
    });

    expect(hostedMailboxItem.updateMany).toHaveBeenCalledWith({
      data: {
        consumedAt: FIXED_NOW,
      },
      where: {
        consumedAt: null,
        id: {
          in: ["item_exact_terminal_7"],
        },
        kind: "conversation.message",
        lane: "conversation",
        laneSeq: {
          lte: 7n,
        },
        userId: "member_workspace_1",
      },
    });

    expect(hostedMailboxLaneCounter.updateMany).toHaveBeenCalledWith({
      data: {
        consumedSeq: 7n,
      },
      where: {
        consumedSeq: {
          lt: 7n,
        },
        lane: "conversation",
        userId: "member_workspace_1",
      },
    });
  });

  it("stops exact handled conversation progress before the first unstamped row", async () => {
    const hostedWorkspace = createHostedWorkspaceDelegate({
      updateMany: vi.fn<HostedWorkspaceUpdateMany>(async () => ({ count: 1 })),
    });
    const hostedMailboxLaneCounter = createHostedMailboxLaneCounterDelegate({
      consumedSeq: 3n,
      nextSeq: 9n,
    });
    const hostedMailboxItem = createHostedMailboxItemDelegate({
      findFirst: vi.fn(async () => ({ laneSeq: 5n })),
    });
    const tx = createHostedWorkspaceTx({
      $queryRaw: vi.fn<HostedWorkspaceQueryRaw>(async () => []),
      hostedMailboxItem,
      hostedMailboxLaneCounter,
      hostedWorkspace,
    });

    await expect(checkpointHostedWorkspaceTx({
      expectedVersion: "4",
      handledConversationMailboxItemIds: ["item_exact_terminal_7"],
      nextWakeAt: "2026-04-26T00:00:15.000Z",
      nextWakeReason: "mailbox",
      reason: "idle_shutdown",
      redactedStatusJson: {
        hostedMailboxConversationImportedSeq: "7",
      },
      snapshotRef: createBundleRef("snapshot_conversation_ahead"),
      tx,
      userId: "member_workspace_1",
    })).resolves.toMatchObject({ status: "updated" });

    expect(hostedMailboxLaneCounter.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { consumedSeq: 4n } }),
    );
  });

  it("rejects malformed exact handled conversation item ids", async () => {
    const hostedWorkspace = createHostedWorkspaceDelegate();
    const hostedMailboxLaneCounter = createHostedMailboxLaneCounterDelegate({
      consumedSeq: 3n,
      nextSeq: 9n,
    });
    const tx = createHostedWorkspaceTx({
      $queryRaw: vi.fn<HostedWorkspaceQueryRaw>(async () => []),
      hostedMailboxLaneCounter,
      hostedWorkspace,
    });

    await expect(checkpointHostedWorkspaceTx({
      expectedVersion: "4",
      handledConversationMailboxItemIds: ["not a mailbox item id"],
      nextWakeAt: "2026-04-26T00:00:15.000Z",
      nextWakeReason: "mailbox",
      reason: "idle_shutdown",
      redactedStatusJson: {
        hostedMailboxConversationImportedSeq: "7",
      },
      snapshotRef: createBundleRef("snapshot_conversation_missing_import"),
      tx,
      userId: "member_workspace_1",
    })).rejects.toThrow(/bounded opaque token/u);

    expect(hostedWorkspace.updateMany).not.toHaveBeenCalled();
    expect(hostedMailboxLaneCounter.updateMany).not.toHaveBeenCalled();
  });

  it("does not stamp exact handled items without a valid imported prefix", async () => {
    const hostedWorkspace = createHostedWorkspaceDelegate({
      updateMany: vi.fn<HostedWorkspaceUpdateMany>(async () => ({ count: 1 })),
    });
    const hostedMailboxLaneCounter = createHostedMailboxLaneCounterDelegate({
      consumedSeq: 3n,
      nextSeq: 9n,
    });
    const hostedMailboxItem = createHostedMailboxItemDelegate();
    const tx = createHostedWorkspaceTx({
      $queryRaw: vi.fn<HostedWorkspaceQueryRaw>(async () => []),
      hostedMailboxItem,
      hostedMailboxLaneCounter,
      hostedWorkspace,
    });

    await expect(checkpointHostedWorkspaceTx({
      expectedVersion: "4",
      handledConversationMailboxItemIds: ["item_without_imported_prefix"],
      nextWakeAt: "2026-04-26T00:00:15.000Z",
      nextWakeReason: "mailbox",
      reason: "idle_shutdown",
      redactedStatusJson: {
        hostedMailboxConversationImportedSeq: "not-a-sequence",
      },
      snapshotRef: createBundleRef("snapshot_conversation_malformed_handled"),
      tx,
      userId: "member_workspace_1",
    })).resolves.toMatchObject({
      status: "updated",
    });

    expect(hostedMailboxItem.updateMany).not.toHaveBeenCalled();
    expect(hostedMailboxLaneCounter.findUnique).not.toHaveBeenCalled();
    expect(hostedMailboxLaneCounter.updateMany).not.toHaveBeenCalled();
  });

  it("propagates conversation replay-floor failures after the workspace CAS", async () => {
    const hostedWorkspace = createHostedWorkspaceDelegate({
      updateMany: vi.fn<HostedWorkspaceUpdateMany>(async () => ({ count: 1 })),
    });
    const hostedMailboxLaneCounter = createHostedMailboxLaneCounterDelegate({
      consumedSeq: 3n,
      nextSeq: 9n,
    });
    hostedMailboxLaneCounter.findUnique.mockRejectedValueOnce(
      new Error("synthetic lane-counter failure"),
    );
    const tx = createHostedWorkspaceTx({
      $queryRaw: vi.fn<HostedWorkspaceQueryRaw>(async () => []),
      hostedMailboxItem: createHostedMailboxItemDelegate(),
      hostedMailboxLaneCounter,
      hostedWorkspace,
    });

    await expect(checkpointHostedWorkspaceTx({
      expectedVersion: "4",
      nextWakeAt: "2026-04-26T00:00:15.000Z",
      nextWakeReason: "mailbox",
      reason: "idle_shutdown",
      redactedStatusJson: {
        hostedMailboxConversationImportedSeq: "7",
      },
      snapshotRef: createBundleRef("snapshot_conversation_rollback"),
      tx,
      userId: "member_workspace_1",
    })).rejects.toThrow("synthetic lane-counter failure");

    expect(hostedWorkspace.updateMany).toHaveBeenCalledOnce();
    expect(hostedMailboxLaneCounter.updateMany).not.toHaveBeenCalled();
  });

  it("rolls back both checkpoint writes when a post-acknowledgement read fails", async () => {
    const initialWorkspace = buildHostedWorkspaceRow({
      snapshotRef: createBundleRef("snapshot_conversation_before_rollback"),
      version: 4n,
    });
    let committedWorkspace = initialWorkspace;
    let committedConsumedSeq = 3n;
    let committedConsumedItemIds: string[] = [];
    let workingWorkspace = { ...committedWorkspace };
    let workingConsumedSeq = committedConsumedSeq;
    let workingConsumedItemIds = [...committedConsumedItemIds];
    let laneReadCount = 0;
    const hostedWorkspace = createHostedWorkspaceDelegate({
      findUnique: vi.fn<HostedWorkspaceFindUnique>(async () => workingWorkspace),
      updateMany: vi.fn<HostedWorkspaceUpdateMany>(async () => {
        workingWorkspace = buildHostedWorkspaceRow({
          ...workingWorkspace,
          snapshotRef: createBundleRef("snapshot_conversation_after_rollback"),
          version: workingWorkspace.version + 1n,
        });
        return { count: 1 };
      }),
    });
    const hostedMailboxLaneCounter = createHostedMailboxLaneCounterDelegate({
      consumedSeq: committedConsumedSeq,
      nextSeq: 9n,
    });
    hostedMailboxLaneCounter.findUnique.mockImplementation(async () => {
      laneReadCount += 1;
      if (laneReadCount === 3) {
        throw new Error("synthetic post-acknowledgement read failure");
      }
      return {
        consumedSeq: workingConsumedSeq,
        lane: "conversation",
        nextSeq: 9n,
        updatedAt: FIXED_NOW,
        userId: "member_workspace_1",
      };
    });
    hostedMailboxLaneCounter.updateMany.mockImplementation(async (args) => {
      workingConsumedSeq = args.data.consumedSeq;
      return { count: 1 };
    });
    const tx = createHostedWorkspaceTx({
      $queryRaw: vi.fn<HostedWorkspaceQueryRaw>(async () => []),
      hostedMailboxItem: createHostedMailboxItemDelegate({
        findFirst: vi.fn(async () => null),
        updateMany: vi.fn(async () => {
          workingConsumedItemIds = ["item_exact_terminal_7"];
          return { count: 1 };
        }),
      }),
      hostedMailboxLaneCounter,
      hostedWorkspace,
    });
    const transaction = vi.fn(async <T>(
      run: (transactionTx: Parameters<typeof checkpointHostedWorkspaceTx>[0]["tx"]) => Promise<T>,
    ) => {
      workingWorkspace = { ...committedWorkspace };
      workingConsumedSeq = committedConsumedSeq;
      workingConsumedItemIds = [...committedConsumedItemIds];
      const result = await run(tx);
      committedWorkspace = workingWorkspace;
      committedConsumedSeq = workingConsumedSeq;
      committedConsumedItemIds = workingConsumedItemIds;
      return result;
    });
    const prisma = Object.assign(Object.create(null), {
      $transaction: transaction,
    }) as NonNullable<Parameters<typeof checkpointHostedWorkspace>[0]["prisma"]>;

    await expect(checkpointHostedWorkspace({
      expectedVersion: "4",
      handledConversationMailboxItemIds: ["item_exact_terminal_7"],
      nextWakeAt: "2026-04-26T00:00:15.000Z",
      nextWakeReason: "mailbox",
      prisma,
      reason: "idle_shutdown",
      redactedStatusJson: {
        hostedMailboxConversationImportedSeq: "7",
      },
      snapshotRef: createBundleRef("snapshot_conversation_after_rollback"),
      userId: "member_workspace_1",
    })).rejects.toThrow("synthetic post-acknowledgement read failure");

    expect(transaction).toHaveBeenCalledOnce();
    expect(hostedWorkspace.updateMany).toHaveBeenCalledOnce();
    expect(hostedMailboxLaneCounter.updateMany).toHaveBeenCalledOnce();
    expect(committedWorkspace).toEqual(initialWorkspace);
    expect(committedConsumedSeq).toBe(3n);
    expect(committedConsumedItemIds).toEqual([]);
  });

  it("reserves canonical receipt protocol fields outside the ordinary status budget", async () => {
    const hostedWorkspace = createHostedWorkspaceDelegate();
    const tx = createHostedWorkspaceTx({ hostedWorkspace });
    const ordinaryStatus = Object.fromEntries(
      Array.from({ length: 96 }, (_, index) => [`diagnostic${index}Count`, index]),
    );
    const receiptStatus = {
      ...ordinaryStatus,
      [HOSTED_CANONICAL_WRITE_RECEIPT_LOG_BYTE_SIZE_STATUS_KEY]: 1,
      [HOSTED_CANONICAL_WRITE_RECEIPT_LOG_SHA_STATUS_KEY]: "a".repeat(64),
    };
    const recoveryStatus = {
      ...receiptStatus,
      [HOSTED_CANONICAL_WRITE_RECEIPT_RECOVERY_PRIOR_WAKE_AT_STATUS_KEY]:
        "2099-07-09T00:00:00.000Z",
      [HOSTED_CANONICAL_WRITE_RECEIPT_RECOVERY_PRIOR_WAKE_REASON_STATUS_KEY]:
        "assistant",
      [HOSTED_CANONICAL_WRITE_RECEIPT_RECOVERY_STATUS_KEY]: "pending",
    };
    const checkpoint = {
      expectedVersion: "4",
      reason: "idle_shutdown",
      redactedStatusJson: recoveryStatus,
      snapshotRef: null,
      tx,
      userId: "member_workspace_1",
    };

    await expect(checkpointHostedWorkspaceTx(checkpoint)).resolves.toMatchObject({
      status: "updated",
    });
    expect(hostedWorkspace.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        redactedStatusJson: recoveryStatus,
      }),
    }));
    await expect(checkpointHostedWorkspaceTx({
      ...checkpoint,
      redactedStatusJson: {
        ...recoveryStatus,
        overflowCount: 1,
      },
    })).rejects.toThrow(/at most 96 fields/u);
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
    const hostedMailboxLaneCounter = createHostedMailboxLaneCounterDelegate({
      consumedSeq: 3n,
      nextSeq: 9n,
    });
    const tx = createHostedWorkspaceTx({
      $queryRaw: vi.fn<HostedWorkspaceQueryRaw>(async () => []),
      hostedMailboxLaneCounter,
      hostedWorkspace,
    });

    const result = await checkpointHostedWorkspaceTx({
      expectedVersion: 4n,
      nextWakeAt: "2026-04-26T00:00:15.000Z",
      nextWakeReason: "mailbox",
      reason: "idle_shutdown",
      redactedStatusJson: {
        hostedMailboxConversationImportedSeq: "7",
        hostedMailboxSystemHandledThroughSeq: "7",
      },
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
    expect(hostedMailboxLaneCounter.findUnique).not.toHaveBeenCalled();
    expect(hostedMailboxLaneCounter.updateMany).not.toHaveBeenCalled();
  });

  it("commits idle shutdown checkpoints with an ahead-input observation and the checkpoint wake", async () => {
    const locked = buildHostedWorkspaceRow({
      nextWakeAt: new Date("2026-04-26T00:10:00.000Z"),
      nextWakeReason: "assistant",
      snapshotRef: createBundleRef("snapshot_current"),
      version: 4n,
    });
    const checkpointed = buildHostedWorkspaceRow({
      nextWakeAt: new Date("2026-04-26T00:00:05.000Z"),
      nextWakeReason: "system-mailbox",
      snapshotRef: createBundleRef("snapshot_idle"),
      version: 5n,
    });
    let findUniqueCount = 0;
    const hostedWorkspace = createHostedWorkspaceDelegate({
      findUnique: vi.fn<HostedWorkspaceFindUnique>(async () => {
        findUniqueCount += 1;
        return findUniqueCount === 1 ? locked : checkpointed;
      }),
      updateMany: vi.fn<HostedWorkspaceUpdateMany>(async () => ({ count: 1 })),
    });
    const hostedMailboxItem = {
      findFirst: vi.fn<HostedMailboxItemFindFirst>(async () => ({ laneSeq: 2n })),
    };
    const hostedMailboxLaneCounter = createHostedMailboxLaneCounterDelegate({
      consumedSeq: 0n,
      nextSeq: 3n,
    });
    const rawOperations: string[] = [];
    const executeRaw = vi.fn<HostedWorkspaceExecuteRaw>(async () => 0);
    const queryRaw = vi.fn<HostedWorkspaceQueryRaw>(async (strings) => {
      rawOperations.push(strings.join("?"));
      return [{ next_seq: 3n }];
    });
    const tx = createHostedWorkspaceTx({
      $executeRaw: executeRaw,
      $queryRaw: queryRaw,
      hostedMailboxItem,
      hostedMailboxLaneCounter,
      hostedWorkspace,
    });

    const result = await checkpointHostedWorkspaceTx({
      expectedVersion: "4",
      nextWakeAt: "2026-04-26T00:00:05.000Z",
      nextWakeReason: "system-mailbox",
      reason: "idle_shutdown",
      redactedStatusJson: {
        hostedMailboxConversationImportedSeq: "1",
      },
      snapshotRef: createBundleRef("snapshot_idle"),
      tx,
      userId: "member_workspace_1",
    });

    expect(executeRaw).toHaveBeenCalledOnce();
    expect(queryRaw).toHaveBeenCalledTimes(2);
    expect(rawOperations[0]).toContain("hosted_workspace");
    expect(rawOperations[1]).toContain("hosted_mailbox_lane_counter");
    expect(hostedMailboxItem.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: {
        laneSeq: "desc",
      },
      select: {
        laneSeq: true,
      },
      where: expect.objectContaining({
        lane: "conversation",
        userId: "member_workspace_1",
      }),
    }));
    expect(hostedWorkspace.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        nextWakeAt: new Date("2026-04-26T00:00:05.000Z"),
        nextWakeReason: "system-mailbox",
        snapshotRef: createBundleRef("snapshot_idle"),
      }),
      where: {
        userId: "member_workspace_1",
        version: 4n,
      },
    }));
    expect(hostedMailboxLaneCounter.updateMany).toHaveBeenCalledWith({
      data: {
        consumedSeq: 1n,
      },
      where: {
        consumedSeq: {
          lt: 1n,
        },
        lane: "conversation",
        userId: "member_workspace_1",
      },
    });
    expect(result).toMatchObject({
      conversationInputAhead: true,
      replacedSnapshotRef: createBundleRef("snapshot_current"),
      status: "updated",
      workspace: {
        nextWakeAt: "2026-04-26T00:00:05.000Z",
        nextWakeReason: "system-mailbox",
        snapshotRef: createBundleRef("snapshot_idle"),
        version: "5",
      },
    });
  });

  it("falls back to the redacted mailbox imported seq for old idle checkpoint callers", async () => {
    const current = buildHostedWorkspaceRow({
      snapshotRef: createBundleRef("snapshot_current"),
      version: 4n,
    });
    const checkpointed = buildHostedWorkspaceRow({
      snapshotRef: createBundleRef("snapshot_idle"),
      version: 5n,
    });
    let findUniqueCount = 0;
    const hostedWorkspace = createHostedWorkspaceDelegate({
      findUnique: vi.fn<HostedWorkspaceFindUnique>(async () => {
        findUniqueCount += 1;
        return findUniqueCount === 1 ? current : checkpointed;
      }),
      updateMany: vi.fn<HostedWorkspaceUpdateMany>(async () => ({ count: 1 })),
    });
    const hostedMailboxItem = {
      findFirst: vi.fn<HostedMailboxItemFindFirst>(async () => ({ laneSeq: 2n })),
    };
    const executeRaw = vi.fn<HostedWorkspaceExecuteRaw>(async () => 0);
    const queryRaw = vi.fn<HostedWorkspaceQueryRaw>(async () => [{ next_seq: 3n }]);
    const hostedMailboxLaneCounter = createHostedMailboxLaneCounterDelegate({
      consumedSeq: 0n,
      nextSeq: 3n,
    });
    const tx = createHostedWorkspaceTx({
      $executeRaw: executeRaw,
      $queryRaw: queryRaw,
      hostedMailboxItem,
      hostedMailboxLaneCounter,
      hostedWorkspace,
    });

    const result = await checkpointHostedWorkspaceTx({
      expectedVersion: "4",
      reason: "idle_shutdown",
      redactedStatusJson: {
        hostedMailboxConversationImportedSeq: "1",
        state: "idle",
      },
      snapshotRef: createBundleRef("snapshot_idle"),
      tx,
      userId: "member_workspace_1",
    });

    expect(executeRaw).toHaveBeenCalledOnce();
    expect(queryRaw).toHaveBeenCalledTimes(2);
    expect(hostedWorkspace.updateMany).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      conversationInputAhead: true,
      status: "updated",
      workspace: {
        snapshotRef: createBundleRef("snapshot_idle"),
        version: "5",
      },
    });
  });

  it("returns workspace-version conflict before observing conversation input when the locked row is stale", async () => {
    const current = buildHostedWorkspaceRow({
      snapshotRef: createBundleRef("snapshot_current"),
      version: 5n,
    });
    const hostedWorkspace = createHostedWorkspaceDelegate({
      findUnique: vi.fn<HostedWorkspaceFindUnique>(async () => current),
      updateMany: vi.fn<HostedWorkspaceUpdateMany>(async () => ({ count: 0 })),
    });
    const hostedMailboxItem = {
      findFirst: vi.fn<HostedMailboxItemFindFirst>(async () => ({ laneSeq: 6n })),
    };
    const queryRaw = vi.fn<HostedWorkspaceQueryRaw>(async () => []);
    const tx = createHostedWorkspaceTx({
      $queryRaw: queryRaw,
      hostedMailboxItem,
      hostedWorkspace,
    });

    const result = await checkpointHostedWorkspaceTx({
      expectedVersion: "4",
      reason: "idle_shutdown",
      redactedStatusJson: {
        hostedMailboxConversationImportedSeq: "1",
      },
      snapshotRef: createBundleRef("snapshot_stale_idle"),
      tx,
      userId: "member_workspace_1",
    });

    expect(queryRaw).toHaveBeenCalledOnce();
    expect(hostedMailboxItem.findFirst).not.toHaveBeenCalled();
    expect(hostedWorkspace.updateMany).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "conflict",
      workspace: {
        snapshotRef: createBundleRef("snapshot_current"),
        version: "5",
      },
    });
  });

  it("allows mailbox-continuation idle checkpoints to persist bounded mailbox progress", async () => {
    const beforeCheckpoint = buildHostedWorkspaceRow({
      snapshotRef: createBundleRef("snapshot_current"),
      version: 4n,
    });
    const afterCheckpoint = buildHostedWorkspaceRow({
      snapshotRef: createBundleRef("snapshot_checkpointed"),
      version: 5n,
    });
    let findUniqueCount = 0;
    const hostedWorkspace = createHostedWorkspaceDelegate({
      findUnique: vi.fn<HostedWorkspaceFindUnique>(async () => {
        findUniqueCount += 1;
        return findUniqueCount === 1 ? beforeCheckpoint : afterCheckpoint;
      }),
      updateMany: vi.fn<HostedWorkspaceUpdateMany>(async () => ({ count: 1 })),
    });
    const hostedMailboxItem = {
      findFirst: vi.fn<HostedMailboxItemFindFirst>(async () => ({ laneSeq: 6n })),
    };
    const rawOperations: string[] = [];
    const executeRaw = vi.fn<HostedWorkspaceExecuteRaw>(async (strings) => {
      rawOperations.push(strings.join("?"));
      return 0;
    });
    const queryRaw = vi.fn<HostedWorkspaceQueryRaw>(async (strings) => {
      rawOperations.push(strings.join("?"));
      return [];
    });
    const hostedMailboxLaneCounter = createHostedMailboxLaneCounterDelegate({
      consumedSeq: 0n,
      nextSeq: 7n,
    });
    const tx = createHostedWorkspaceTx({
      $executeRaw: executeRaw,
      $queryRaw: queryRaw,
      hostedMailboxItem,
      hostedMailboxLaneCounter,
      hostedWorkspace,
    });

    const result = await checkpointHostedWorkspaceTx({
      expectedVersion: "4",
      nextWakeAt: "2026-04-26T00:00:15.000Z",
      nextWakeReason: "mailbox",
      reason: "idle_shutdown",
      redactedStatusJson: {
        hostedMailboxConversationImportedSeq: "2",
        hostedMailboxFetchedCount: 3,
        hostedMailboxImportedCount: 2,
      },
      snapshotRef: createBundleRef("snapshot_checkpointed"),
      tx,
      userId: "member_workspace_1",
    });

    expect(result).toMatchObject({
      status: "updated",
      workspace: {
        snapshotRef: createBundleRef("snapshot_checkpointed"),
        version: "5",
      },
    });
    expect(hostedMailboxItem.findFirst).toHaveBeenCalledOnce();
    expect(hostedWorkspace.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        nextWakeReason: "mailbox",
        redactedStatusJson: expect.objectContaining({
          hostedMailboxConversationImportedSeq: "2",
        }),
      }),
      where: {
        userId: "member_workspace_1",
        version: 4n,
      },
    }));
    expect(rawOperations.join("\n")).toContain("hosted_workspace");
    expect(rawOperations.join("\n")).not.toContain("hosted_mailbox_lane_counter");
  });

  it("allows retryable mailbox continuation checkpoints even when an earlier non-mailbox wake is selected", async () => {
    const beforeCheckpoint = buildHostedWorkspaceRow({
      snapshotRef: createBundleRef("snapshot_current"),
      version: 4n,
    });
    const afterCheckpoint = buildHostedWorkspaceRow({
      nextWakeAt: new Date("2026-04-26T00:00:05.000Z"),
      nextWakeReason: "assistant",
      snapshotRef: createBundleRef("snapshot_retryable_block"),
      version: 5n,
    });
    let findUniqueCount = 0;
    const hostedWorkspace = createHostedWorkspaceDelegate({
      findUnique: vi.fn<HostedWorkspaceFindUnique>(async () => {
        findUniqueCount += 1;
        return findUniqueCount === 1 ? beforeCheckpoint : afterCheckpoint;
      }),
      updateMany: vi.fn<HostedWorkspaceUpdateMany>(async () => ({ count: 1 })),
    });
    const hostedMailboxItem = {
      findFirst: vi.fn<HostedMailboxItemFindFirst>(async () => ({ laneSeq: 6n })),
    };
    const queryRaw = vi.fn<HostedWorkspaceQueryRaw>(async () => []);
    const hostedMailboxLaneCounter = createHostedMailboxLaneCounterDelegate({
      consumedSeq: 0n,
      nextSeq: 7n,
    });
    const tx = createHostedWorkspaceTx({
      $queryRaw: queryRaw,
      hostedMailboxItem,
      hostedMailboxLaneCounter,
      hostedWorkspace,
    });

    const result = await checkpointHostedWorkspaceTx({
      expectedVersion: "4",
      nextWakeAt: "2026-04-26T00:00:05.000Z",
      nextWakeReason: "assistant",
      reason: "idle_shutdown",
      redactedStatusJson: {
        hostedMailboxConversationImportedSeq: "2",
        hostedMailboxImportedCount: 2,
        hostedMailboxRetryableBlockedCount: 1,
      },
      snapshotRef: createBundleRef("snapshot_retryable_block"),
      tx,
      userId: "member_workspace_1",
    });

    expect(queryRaw).toHaveBeenCalledOnce();
    expect(hostedMailboxItem.findFirst).toHaveBeenCalledOnce();
    expect(hostedWorkspace.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        nextWakeAt: new Date("2026-04-26T00:00:05.000Z"),
        nextWakeReason: "assistant",
        redactedStatusJson: expect.objectContaining({
          hostedMailboxRetryableBlockedCount: 1,
        }),
      }),
      where: {
        userId: "member_workspace_1",
        version: 4n,
      },
    }));
    expect(result).toMatchObject({
      status: "updated",
      workspace: {
        nextWakeReason: "assistant",
        snapshotRef: createBundleRef("snapshot_retryable_block"),
        version: "5",
      },
    });
  });

  it("rejects non-boolean assistant context snapshot checkpoint status", async () => {
    const hostedWorkspace = createHostedWorkspaceDelegate();
    const tx = createHostedWorkspaceTx({
      hostedWorkspace,
    });

    for (const key of [
      "assistantContextSnapshotRefreshAttempted",
      "assistantContextSnapshotRefreshed",
    ] as const) {
      for (const value of [null, "true", 1, [true], { value: true }] as const) {
        await expect(checkpointHostedWorkspaceTx({
          expectedVersion: "4",
          reason: "import",
          redactedStatusJson: {
            [key]: value,
          },
          snapshotRef: createBundleRef("snapshot_2"),
          tx,
          userId: "member_workspace_1",
        })).rejects.toThrow(/must be a boolean/u);
      }
    }
    expect(hostedWorkspace.updateMany).not.toHaveBeenCalled();
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

});

describe("hosted runtime log store", () => {
  it("writes a whole runtime log batch as one statement", async () => {
    const createMany = vi.fn(
      async (_args: { data: readonly { eventCode: string; id: string }[] }) => ({
        count: _args.data.length,
      }),
    );
    const create = vi.fn();
    const prisma = Object.assign(Object.create(null), {
      hostedRuntimeLog: { create, createMany },
    }) as Parameters<typeof recordHostedRuntimeLogs>[0]["prisma"];

    const loggedCount = await recordHostedRuntimeLogs({
      entries: Array.from({ length: 50 }, () => ({
        component: "mailbox",
        eventCode: "mailbox.imported",
        level: "info",
        phase: "import",
      })),
      prisma,
      userId: "member_workspace_1",
    });

    // The pool defaults to 15 clients; 50 independent creates would let one
    // request outrun the whole pool.
    expect(createMany).toHaveBeenCalledOnce();
    expect(create).not.toHaveBeenCalled();
    expect(createMany.mock.calls[0]?.[0]?.data).toHaveLength(50);
    expect(loggedCount).toBe(50);
    expect(new Set(createMany.mock.calls[0]?.[0]?.data.map((row) => row.id)).size)
      .toBe(50);
  });

  it("does not touch the database for an empty runtime log batch", async () => {
    const createMany = vi.fn(async () => ({ count: 0 }));
    const prisma = Object.assign(Object.create(null), {
      hostedRuntimeLog: { createMany },
    }) as Parameters<typeof recordHostedRuntimeLogs>[0]["prisma"];

    expect(await recordHostedRuntimeLogs({
      entries: [],
      prisma,
      userId: "member_workspace_1",
    })).toBe(0);
    expect(createMany).not.toHaveBeenCalled();
  });

  it("drops a late diagnostic batch after its member was deleted", async () => {
    const createMany = vi.fn(async () => {
      throw new Prisma.PrismaClientKnownRequestError(
        "Foreign key constraint failed.",
        {
          clientVersion: "7.8.0",
          code: "P2003",
          meta: {
            constraint: "hosted_runtime_log_user_id_fkey",
            modelName: "HostedRuntimeLog",
          },
        },
      );
    });
    const prisma = Object.assign(Object.create(null), {
      hostedRuntimeLog: { createMany },
    }) as Parameters<typeof recordHostedRuntimeLogs>[0]["prisma"];

    await expect(recordHostedRuntimeLogs({
      entries: [{
        component: "mailbox",
        eventCode: "mailbox.imported",
        level: "info",
        phase: "import",
      }],
      prisma,
      userId: "member_deleted",
    })).resolves.toBe(0);
  });

  it("does not hide a different runtime-log foreign-key failure", async () => {
    const error = new Prisma.PrismaClientKnownRequestError(
      "Foreign key constraint failed.",
      {
        clientVersion: "7.8.0",
        code: "P2003",
        meta: {
          constraint: "different_runtime_log_constraint",
          modelName: "HostedRuntimeLog",
        },
      },
    );
    const createMany = vi.fn(async () => {
      throw error;
    });
    const prisma = Object.assign(Object.create(null), {
      hostedRuntimeLog: { createMany },
    }) as Parameters<typeof recordHostedRuntimeLogs>[0]["prisma"];

    await expect(recordHostedRuntimeLogs({
      entries: [{
        component: "mailbox",
        eventCode: "mailbox.imported",
        level: "info",
        phase: "import",
      }],
      prisma,
      userId: "member_workspace_1",
    })).rejects.toBe(error);
  });

  it("rejects a batch entry with a forbidden field just like a single write", async () => {
    const createMany = vi.fn(async () => ({ count: 0 }));
    const prisma = Object.assign(Object.create(null), {
      hostedRuntimeLog: { createMany },
    }) as Parameters<typeof recordHostedRuntimeLogs>[0]["prisma"];

    await expect(recordHostedRuntimeLogs({
      entries: [{
        component: "not_a_real_component",
        eventCode: "mailbox.imported",
        level: "info",
        phase: "import",
      }],
      prisma,
      userId: "member_workspace_1",
    })).rejects.toThrow(/component/);
    expect(createMany).not.toHaveBeenCalled();
  });

  it("writes nothing when a later batch entry is invalid", async () => {
    // Normalizing the whole batch before the single write is what removes the
    // partial-success behaviour the per-entry loop had; a valid prefix must not
    // reach the database when a later entry is rejected.
    const createMany = vi.fn(async () => ({ count: 0 }));
    const create = vi.fn();
    const prisma = Object.assign(Object.create(null), {
      hostedRuntimeLog: { create, createMany },
    }) as Parameters<typeof recordHostedRuntimeLogs>[0]["prisma"];

    await expect(recordHostedRuntimeLogs({
      entries: [
        {
          component: "mailbox",
          eventCode: "mailbox.imported",
          level: "info",
          phase: "import",
        },
        {
          component: "not_a_real_component",
          eventCode: "mailbox.imported",
          level: "info",
          phase: "import",
        },
      ],
      prisma,
      userId: "member_workspace_1",
    })).rejects.toThrow(/component/);

    expect(createMany).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("claims the accepted-attempt recheck cooldown on workspace control state", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const prisma = Object.assign(Object.create(null), {
      hostedWorkspace: { updateMany },
    }) as Parameters<typeof claimHostedAcceptedAttemptFailureRecheck>[0]["prisma"];

    await expect(claimHostedAcceptedAttemptFailureRecheck({
      cooldownMs: 30_000,
      now: "2026-05-27T12:34:30.000Z",
      prisma,
      userId: "member_workspace_1",
    })).resolves.toBe(true);

    // One conditional update decides the owner, so recovery never depends on a
    // diagnostic row having been written or read back.
    expect(updateMany).toHaveBeenCalledWith({
      data: {
        acceptedAttemptFailureRecheckClaimedAt: new Date("2026-05-27T12:34:30.000Z"),
      },
      where: {
        OR: [
          { acceptedAttemptFailureRecheckClaimedAt: null },
          {
            acceptedAttemptFailureRecheckClaimedAt: {
              lt: new Date("2026-05-27T12:34:00.000Z"),
            },
          },
        ],
        userId: "member_workspace_1",
      },
    });
  });

  it("does not claim the recheck while another failure owns the cooldown", async () => {
    const prisma = Object.assign(Object.create(null), {
      hostedWorkspace: {
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
    }) as Parameters<typeof claimHostedAcceptedAttemptFailureRecheck>[0]["prisma"];

    await expect(claimHostedAcceptedAttemptFailureRecheck({
      cooldownMs: 30_000,
      now: "2026-05-27T12:34:30.000Z",
      prisma,
      userId: "member_workspace_1",
    })).resolves.toBe(false);
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

interface HostedMailboxItemFindFirstArgs {
  orderBy: {
    laneSeq: "desc";
  };
  select: {
    laneSeq: true;
  };
  where: {
    createdAt: {
      gte: Date;
    };
    lane: "conversation";
    OR: Array<
      | {
          expiresAt: null;
        }
      | {
          expiresAt: {
            gt: Date;
          };
        }
    >;
    userId: string;
  };
}

type HostedWorkspaceUpdateMany = (args: HostedWorkspaceUpdateManyArgs) => Promise<{ count: number }>;
type HostedWorkspaceFindUnique = (args: HostedWorkspaceFindUniqueArgs) => Promise<HostedWorkspaceRow | null>;
type HostedWorkspaceUpsert = (args: HostedWorkspaceUpsertArgs) => Promise<HostedWorkspaceRow>;
type HostedMailboxItemFindFirst = (
  args: HostedMailboxItemFindFirstArgs,
) => Promise<{ laneSeq: bigint } | null>;
type HostedMailboxItemUpdateMany = (args: {
  data: { consumedAt: Date };
  where: unknown;
}) => Promise<{ count: number }>;
type HostedWorkspaceExecuteRaw = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<number>;
type HostedWorkspaceQueryRaw = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<unknown>;

function buildHostedWorkspaceRow(
  overrides: Partial<HostedWorkspaceRow> = {},
): HostedWorkspaceRow {
  return {
    browserVaultReplicaRef: null,
    checkpointedAt: null,
    createdAt: FIXED_NOW,
    inboxMediaRetentionWakeAt: null,
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

function createHostedMailboxLaneCounterDelegate(initial: {
  consumedSeq: bigint;
  nextSeq: bigint;
}) {
  const state = { ...initial };
  return {
    findUnique: vi.fn(async () => ({
      consumedSeq: state.consumedSeq,
      lane: "system",
      nextSeq: state.nextSeq,
      updatedAt: FIXED_NOW,
      userId: "member_workspace_1",
    })),
    updateMany: vi.fn(async (args: { data: { consumedSeq: bigint } }) => {
      state.consumedSeq = args.data.consumedSeq;
      return { count: 1 };
    }),
  };
}

function createHostedMailboxItemDelegate(overrides: Partial<{
  findFirst: ReturnType<typeof vi.fn<HostedMailboxItemFindFirst>>;
  updateMany: ReturnType<typeof vi.fn<HostedMailboxItemUpdateMany>>;
}> = {}) {
  return {
    findFirst: vi.fn<HostedMailboxItemFindFirst>(async () => null),
    updateMany: vi.fn<HostedMailboxItemUpdateMany>(async () => ({ count: 1 })),
    ...overrides,
  };
}

function createHostedWorkspaceTx(input: {
  $executeRaw?: ReturnType<typeof vi.fn<HostedWorkspaceExecuteRaw>>;
  $queryRaw?: ReturnType<typeof vi.fn<HostedWorkspaceQueryRaw>>;
  hostedMailboxItem?: {
    findFirst: ReturnType<typeof vi.fn<HostedMailboxItemFindFirst>>;
    updateMany?: ReturnType<typeof vi.fn<HostedMailboxItemUpdateMany>>;
  };
  hostedMailboxLaneCounter?: ReturnType<typeof createHostedMailboxLaneCounterDelegate>;
  hostedWorkspace: ReturnType<typeof createHostedWorkspaceDelegate>;
}) {
  return Object.assign(Object.create(null), {
    ...(input.$executeRaw ? { $executeRaw: input.$executeRaw } : {}),
    ...(input.$queryRaw ? { $queryRaw: input.$queryRaw } : {}),
    ...(input.hostedMailboxItem ? { hostedMailboxItem: input.hostedMailboxItem } : {}),
    ...(input.hostedMailboxLaneCounter
      ? { hostedMailboxLaneCounter: input.hostedMailboxLaneCounter }
      : {}),
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
