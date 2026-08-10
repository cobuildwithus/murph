import { Prisma } from "@prisma/client";
import {
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
  checkpointHostedWorkspaceTx,
  ensureHostedWorkspace,
  publishLatestBrowserVaultReplicaRefTx,
  claimHostedAcceptedAttemptFailureRecheck,
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

  it("returns the successor workspace and replaced snapshot from the versioned update", async () => {
    const currentSnapshotRef = createBundleRef("snapshot_current");
    const successorSnapshotRef = createBundleRef("snapshot_successor");
    const queryRaw = vi.fn<HostedWorkspaceQueryRaw>(async () => [
      buildHostedWorkspaceCheckpointMutationRow({
        checkpointedAt: new Date("2026-04-26T00:01:00.000Z"),
        nextWakeAt: new Date("2026-04-26T00:05:00.000Z"),
        nextWakeReason: "mailbox",
        redactedStatusJson: { state: "idle" },
        replacedSnapshotRef: currentSnapshotRef,
        snapshotRef: successorSnapshotRef,
        version: 5n,
      }),
    ]);
    const hostedWorkspace = createHostedWorkspaceDelegate();
    const tx = createHostedWorkspaceTx({
      $queryRaw: queryRaw,
      hostedWorkspace,
    });

    const result = await checkpointHostedWorkspaceTx({
      checkpointedAt: "2026-04-26T00:01:00.000Z",
      expectedVersion: "4",
      nextWakeAt: "2026-04-26T00:05:00.000Z",
      nextWakeReason: "mailbox",
      reason: "import",
      redactedStatusJson: {
        state: "idle",
      },
      snapshotRef: successorSnapshotRef,
      tx,
      userId: "member_workspace_1",
    });

    expect(queryRaw).toHaveBeenCalledOnce();
    const workspaceSql = readPrismaSql(queryRaw.mock.calls[0]?.[0]);
    expect(workspaceSql).toContain("UPDATE hosted_workspace AS workspace");
    expect(workspaceSql).toContain("workspace.version =");
    expect(workspaceSql).toContain("RETURNING");
    expect(workspaceSql).not.toContain("FOR UPDATE");
    expect(hostedWorkspace.findUnique).not.toHaveBeenCalled();
    expect(result).toEqual({
      replacedSnapshotRef: currentSnapshotRef,
      status: "updated",
      workspace: {
        browserVaultReplicaRef: null,
        checkpointedAt: "2026-04-26T00:01:00.000Z",
        createdAt: FIXED_NOW.toISOString(),
        inboxMediaRetentionWakeAt: null,
        nextWakeAt: "2026-04-26T00:05:00.000Z",
        nextWakeReason: "mailbox",
        redactedStatusJson: { state: "idle" },
        snapshotRef: successorSnapshotRef,
        updatedAt: FIXED_NOW.toISOString(),
        userId: "member_workspace_1",
        version: "5",
      },
    });
  });

  it("uses one set-based mailbox statement for exact stamping, contiguous progress, and monotonic lanes", async () => {
    const queryRaw = vi.fn<HostedWorkspaceQueryRaw>(async () => {
      if (queryRaw.mock.calls.length === 1) {
        return [buildHostedWorkspaceCheckpointMutationRow({
          replacedSnapshotRef: createBundleRef("snapshot_current"),
          snapshotRef: createBundleRef("snapshot_idle"),
          version: 5n,
        })];
      }
      return [{ conversationInputAhead: true }];
    });
    const tx = createHostedWorkspaceTx({
      $queryRaw: queryRaw,
      hostedWorkspace: createHostedWorkspaceDelegate(),
    });

    const result = await checkpointHostedWorkspaceTx({
      checkpointedAt: FIXED_NOW,
      expectedVersion: "4",
      handledConversationMailboxItemIds: ["item_exact_3", "item_exact_5"],
      reason: "idle_shutdown",
      redactedStatusJson: {
        hostedMailboxConversationImportedSeq: "8",
        hostedMailboxSystemHandledThroughSeq: "99",
      },
      snapshotRef: createBundleRef("snapshot_idle"),
      tx,
      userId: "member_workspace_1",
    });

    expect(queryRaw).toHaveBeenCalledTimes(2);
    const mailboxSql = readPrismaSql(queryRaw.mock.calls[1]?.[0]);
    expect(mailboxSql).toContain("WITH stamped_conversation AS");
    expect(mailboxSql).toContain("item.id = ANY");
    expect(mailboxSql).toContain("item.kind = 'conversation.message'");
    expect(mailboxSql).toContain("item.lane_seq <=");
    expect(mailboxSql).toContain("conversation_progress AS MATERIALIZED");
    expect(mailboxSql).toContain("FROM stamped_conversation AS stamped");
    expect(mailboxSql).toContain("ORDER BY item.lane_seq ASC");
    expect(mailboxSql).toContain("counter.next_seq - 1");
    expect(mailboxSql).toContain("item.created_at >=");
    expect(mailboxSql).toContain("item.expires_at IS NULL OR item.expires_at >");
    expect(mailboxSql).toContain("counter.consumed_seq < progress.target_consumed_seq");
    expect(mailboxSql).toContain("counter.lane = 'system'");
    expect(mailboxSql).not.toContain("FOR UPDATE");
    expect(result).toMatchObject({
      conversationInputAhead: true,
      replacedSnapshotRef: createBundleRef("snapshot_current"),
      status: "updated",
      workspace: {
        snapshotRef: createBundleRef("snapshot_idle"),
        version: "5",
      },
    });
  });

  it("does not run dependent mailbox mutation after a lost workspace CAS", async () => {
    const current = buildHostedWorkspaceRow({
      snapshotRef: createBundleRef("snapshot_current"),
      version: 6n,
    });
    const queryRaw = vi.fn<HostedWorkspaceQueryRaw>(async () => []);
    const hostedWorkspace = createHostedWorkspaceDelegate({
      findUnique: vi.fn<HostedWorkspaceFindUnique>(async () => current),
    });
    const tx = createHostedWorkspaceTx({
      $queryRaw: queryRaw,
      hostedWorkspace,
    });

    const result = await checkpointHostedWorkspaceTx({
      expectedVersion: "4",
      handledConversationMailboxItemIds: ["item_stale"],
      reason: "idle_shutdown",
      redactedStatusJson: {
        hostedMailboxConversationImportedSeq: "7",
        hostedMailboxSystemHandledThroughSeq: "7",
      },
      snapshotRef: createBundleRef("snapshot_stale"),
      tx,
      userId: "member_workspace_1",
    });

    expect(queryRaw).toHaveBeenCalledOnce();
    expect(hostedWorkspace.findUnique).toHaveBeenCalledOnce();
    expect(result).toEqual({
      replacedSnapshotRef: null,
      status: "conflict",
      workspace: expect.objectContaining({
        snapshotRef: createBundleRef("snapshot_current"),
        version: "6",
      }),
    });
  });

  it("omits optional workspace assignments when the checkpoint omits them", async () => {
    const queryRaw = vi.fn<HostedWorkspaceQueryRaw>(async () => [
      buildHostedWorkspaceCheckpointMutationRow({
        browserVaultReplicaRef: createBrowserVaultReplicaRef(),
        replacedSnapshotRef: createBundleRef("snapshot_current"),
        snapshotRef: createBundleRef("snapshot_next"),
        version: 5n,
      }),
    ]);
    const tx = createHostedWorkspaceTx({
      $queryRaw: queryRaw,
      hostedWorkspace: createHostedWorkspaceDelegate(),
    });

    const result = await checkpointHostedWorkspaceTx({
      expectedVersion: "4",
      reason: "canonical_runtime_commit",
      snapshotRef: createBundleRef("snapshot_next"),
      tx,
      userId: "member_workspace_1",
    });

    const assignmentSql = readPrismaSql(queryRaw.mock.calls[0]?.[0]).split("RETURNING")[0] ?? "";
    expect(assignmentSql).not.toContain("next_wake_at =");
    expect(assignmentSql).not.toContain("next_wake_reason =");
    expect(assignmentSql).not.toContain("inbox_media_retention_wake_at =");
    expect(assignmentSql).not.toContain("redacted_status_json =");
    expect(assignmentSql).not.toContain("browser_vault_replica_ref =");
    expect(result).toMatchObject({
      status: "updated",
      workspace: {
        browserVaultReplicaRef: createBrowserVaultReplicaRef(),
        snapshotRef: createBundleRef("snapshot_next"),
        version: "5",
      },
    });
  });

  it.each([
    "assistant_runtime_commit",
    "canonical_runtime_commit",
  ] as const)("does not mutate conversation progress on a %s checkpoint", async (reason) => {
    const queryRaw = vi.fn<HostedWorkspaceQueryRaw>(async () => [
      buildHostedWorkspaceCheckpointMutationRow({ version: 5n }),
    ]);
    const tx = createHostedWorkspaceTx({
      $queryRaw: queryRaw,
      hostedWorkspace: createHostedWorkspaceDelegate(),
    });

    await expect(checkpointHostedWorkspaceTx({
      expectedVersion: "4",
      handledConversationMailboxItemIds: ["item_status_only"],
      reason,
      redactedStatusJson: {
        hostedMailboxConversationImportedSeq: "7",
      },
      snapshotRef: createBundleRef("snapshot_status_only"),
      tx,
      userId: "member_workspace_1",
    })).resolves.toMatchObject({ status: "updated" });

    expect(queryRaw).toHaveBeenCalledOnce();
  });

  it("does not stamp handled conversation ids without a valid imported prefix", async () => {
    const queryRaw = vi.fn<HostedWorkspaceQueryRaw>(async () => [
      buildHostedWorkspaceCheckpointMutationRow({ version: 5n }),
    ]);
    const tx = createHostedWorkspaceTx({
      $queryRaw: queryRaw,
      hostedWorkspace: createHostedWorkspaceDelegate(),
    });

    await expect(checkpointHostedWorkspaceTx({
      expectedVersion: "4",
      handledConversationMailboxItemIds: ["item_without_imported_prefix"],
      reason: "idle_shutdown",
      redactedStatusJson: {
        hostedMailboxConversationImportedSeq: "not-a-sequence",
      },
      snapshotRef: createBundleRef("snapshot_without_imported_prefix"),
      tx,
      userId: "member_workspace_1",
    })).resolves.toMatchObject({ status: "updated" });

    expect(queryRaw).toHaveBeenCalledOnce();
  });

  it("rejects malformed exact handled conversation item ids before the CAS", async () => {
    const queryRaw = vi.fn<HostedWorkspaceQueryRaw>(async () => []);
    const tx = createHostedWorkspaceTx({
      $queryRaw: queryRaw,
      hostedWorkspace: createHostedWorkspaceDelegate(),
    });

    await expect(checkpointHostedWorkspaceTx({
      expectedVersion: "4",
      handledConversationMailboxItemIds: ["not a mailbox item id"],
      reason: "idle_shutdown",
      redactedStatusJson: {
        hostedMailboxConversationImportedSeq: "7",
      },
      snapshotRef: createBundleRef("snapshot_invalid_item"),
      tx,
      userId: "member_workspace_1",
    })).rejects.toThrow(/bounded opaque token/u);

    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("reserves canonical receipt protocol fields outside the ordinary status budget", async () => {
    const queryRaw = vi.fn<HostedWorkspaceQueryRaw>(async () => [
      buildHostedWorkspaceCheckpointMutationRow({ version: 5n }),
    ]);
    const tx = createHostedWorkspaceTx({
      $queryRaw: queryRaw,
      hostedWorkspace: createHostedWorkspaceDelegate(),
    });
    const ordinaryStatus = Object.fromEntries(
      Array.from({ length: 96 }, (_, index) => [`diagnostic${index}Count`, index]),
    );
    const recoveryStatus = {
      ...ordinaryStatus,
      [HOSTED_CANONICAL_WRITE_RECEIPT_LOG_BYTE_SIZE_STATUS_KEY]: 1,
      [HOSTED_CANONICAL_WRITE_RECEIPT_LOG_SHA_STATUS_KEY]: "a".repeat(64),
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
    await expect(checkpointHostedWorkspaceTx({
      ...checkpoint,
      redactedStatusJson: {
        ...recoveryStatus,
        overflowCount: 1,
      },
    })).rejects.toThrow(/at most 96 fields/u);
  });

  it("preserves checkpoint validation before SQL", async () => {
    const queryRaw = vi.fn<HostedWorkspaceQueryRaw>(async () => []);
    const tx = createHostedWorkspaceTx({
      $queryRaw: queryRaw,
      hostedWorkspace: createHostedWorkspaceDelegate(),
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
          snapshotRef: createBundleRef("snapshot_invalid_status"),
          tx,
          userId: "member_workspace_1",
        })).rejects.toThrow(/must be a boolean/u);
      }
    }
    await expect(checkpointHostedWorkspaceTx({
      expectedVersion: "4",
      reason: "maintenance",
      snapshotRef: createBundleRef("snapshot_invalid_reason"),
      tx,
      userId: "member_workspace_1",
    })).rejects.toThrow(/Hosted workspace checkpoint reason/u);
    expect(queryRaw).not.toHaveBeenCalled();
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

describe("hosted accepted-attempt recheck claim", () => {
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

type HostedWorkspaceUpdateMany = (args: HostedWorkspaceUpdateManyArgs) => Promise<{ count: number }>;
type HostedWorkspaceFindUnique = (args: HostedWorkspaceFindUniqueArgs) => Promise<HostedWorkspaceRow | null>;
type HostedWorkspaceUpsert = (args: HostedWorkspaceUpsertArgs) => Promise<HostedWorkspaceRow>;
type HostedWorkspaceQueryRaw = (query: Prisma.Sql) => Promise<unknown>;

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

function buildHostedWorkspaceCheckpointMutationRow(
  overrides: Partial<HostedWorkspaceRow & {
    replacedSnapshotRef: Prisma.JsonValue | null;
  }> = {},
) {
  return {
    ...buildHostedWorkspaceRow(),
    replacedSnapshotRef: null,
    ...overrides,
  };
}

function readPrismaSql(query: Prisma.Sql | undefined): string {
  if (!query) {
    throw new Error("Expected a Prisma SQL query.");
  }
  return query.sql;
}

function createBundleRef(id: string) {
  return {
    hash: `${id}_hash`,
    key: `bundles/vault/${id}.bundle.json`,
    size: 128,
    updatedAt: "2026-04-26T00:00:00.000Z",
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

function createHostedWorkspaceTx(input: {
  $queryRaw?: ReturnType<typeof vi.fn<HostedWorkspaceQueryRaw>>;
  hostedWorkspace: ReturnType<typeof createHostedWorkspaceDelegate>;
}) {
  return Object.assign(Object.create(null), {
    ...(input.$queryRaw ? { $queryRaw: input.$queryRaw } : {}),
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
