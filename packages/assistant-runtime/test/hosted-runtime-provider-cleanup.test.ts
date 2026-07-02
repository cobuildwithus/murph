import assert from "node:assert/strict";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildHostedExecutionRuntimeTimerWake } from "@murphai/hosted-execution";
import { resolveAssistantStatePaths } from "@murphai/runtime-state/node";
import { beforeEach, expect, test, vi } from "vitest";

import { createHostedRuntimeWorkspace } from "./hosted-runtime-test-helpers.ts";

const mocks = vi.hoisted(() => ({
  deleteHostedLinqMessages: vi.fn(),
  listPendingAssistantAutoReplyLinqCleanupEvidence: vi.fn(),
  markAssistantAutoReplyLinqCleanupQueued: vi.fn(),
}));

vi.mock("@murphai/assistant-engine/assistant-automation", () => ({
  listPendingAssistantAutoReplyLinqCleanupEvidence:
    mocks.listPendingAssistantAutoReplyLinqCleanupEvidence,
  markAssistantAutoReplyLinqCleanupQueued: mocks.markAssistantAutoReplyLinqCleanupQueued,
}));

vi.mock("../src/hosted-runtime/message-cleanup.ts", () => ({
  deleteHostedLinqMessages: mocks.deleteHostedLinqMessages,
}));

import {
  drainHostedProviderCleanupAfterCommit,
  hasHostedProviderCleanupRecoveryCompleted,
  prepareHostedProviderCleanupPlan,
  readHostedProviderCleanupCheckpoint,
  recordHostedProviderCleanupBeforeCommit,
  resolveHostedProviderCleanupFirstDeferredWakeAt,
  resolveHostedProviderCleanupScheduledWakeAt,
} from "../src/hosted-runtime/provider-cleanup.ts";

const checkpoint = {
  nextWakeAt: "2026-04-08T00:05:00.000Z",
} as const;

const wake = buildHostedExecutionRuntimeTimerWake({
  eventId: "evt_provider_cleanup",
  occurredAt: "2026-04-08T00:00:00.000Z",
  triggerKind: "runtime_timer",
  userId: "member_123",
});

async function createLegacyEvidenceDirectory(vaultRoot: string): Promise<void> {
  await mkdir(path.join(
    resolveAssistantStatePaths(vaultRoot).assistantStateRoot,
    "auto-reply",
    "evidence",
  ), { recursive: true });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.deleteHostedLinqMessages.mockResolvedValue(undefined);
  mocks.listPendingAssistantAutoReplyLinqCleanupEvidence.mockResolvedValue({
    captureIds: [],
    linqMessageIds: [],
  });
  mocks.markAssistantAutoReplyLinqCleanupQueued.mockResolvedValue(undefined);
});

test("hosted provider cleanup records checkpoint state and unique Linq ids in runtime state", async () => {
  const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace("hosted-provider-cleanup-");

  try {
    const result = await recordHostedProviderCleanupBeforeCommit({
      linqMessageIds: ["linq_inbound_1", "linq_inbound_1", " "],
      checkpoint,
      vaultRoot,
    });

    assert.deepEqual(result, checkpoint);
    assert.deepEqual(
      await readHostedProviderCleanupCheckpoint(vaultRoot),
      checkpoint,
    );
    const raw = await readHostedProviderCleanupFile(vaultRoot);
    assert.deepEqual(raw.linqMessageIds, ["linq_inbound_1"]);
    assert.deepEqual(raw.checkpoint, checkpoint);
  } finally {
    await cleanup();
  }
});

test("hosted provider cleanup replaces an earlier existing checkpoint when appending ids", async () => {
  const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace("hosted-provider-cleanup-");

  try {
    await recordHostedProviderCleanupBeforeCommit({
      linqMessageIds: ["linq_inbound_1"],
      checkpoint: {
        nextWakeAt: "2099-07-01T00:10:00.000Z",
      },
      vaultRoot,
    });
    const result = await recordHostedProviderCleanupBeforeCommit({
      linqMessageIds: ["linq_inbound_2"],
      checkpoint: {
        nextWakeAt: "2099-07-01T00:30:00.000Z",
      },
      vaultRoot,
    });

    assert.deepEqual(result, {
      nextWakeAt: "2099-07-01T00:30:00.000Z",
    });
    assert.deepEqual(await readHostedProviderCleanupCheckpoint(vaultRoot), {
      nextWakeAt: "2099-07-01T00:30:00.000Z",
    });
    const raw = await readHostedProviderCleanupFile(vaultRoot);
    assert.deepEqual(raw.linqMessageIds, ["linq_inbound_1", "linq_inbound_2"]);
  } finally {
    await cleanup();
  }
});

test("hosted provider cleanup replaces a stale due checkpoint when appending deferred ids", async () => {
  const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace("hosted-provider-cleanup-");

  try {
    await recordHostedProviderCleanupBeforeCommit({
      linqMessageIds: ["linq_inbound_1"],
      checkpoint: {
        nextWakeAt: "2026-07-01T00:08:00.000Z",
      },
      vaultRoot,
    });
    const result = await recordHostedProviderCleanupBeforeCommit({
      linqMessageIds: ["linq_inbound_2"],
      checkpoint: {
        nextWakeAt: "2026-07-01T00:14:00.000Z",
      },
      vaultRoot,
    });

    assert.deepEqual(result, {
      nextWakeAt: "2026-07-01T00:14:00.000Z",
    });
    assert.deepEqual(await readHostedProviderCleanupCheckpoint(vaultRoot), {
      nextWakeAt: "2026-07-01T00:14:00.000Z",
    });
    const raw = await readHostedProviderCleanupFile(vaultRoot);
    assert.deepEqual(raw.linqMessageIds, ["linq_inbound_1", "linq_inbound_2"]);
  } finally {
    await cleanup();
  }
});

test("hosted provider cleanup deferred plan persists a re-armed due cleanup wake into the owner state", async () => {
  const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace("hosted-provider-cleanup-");

  try {
    await recordHostedProviderCleanupBeforeCommit({
      linqMessageIds: ["linq_inbound_1"],
      checkpoint: {
        nextWakeAt: null,
      },
      vaultRoot,
    });

    const plan = await prepareHostedProviderCleanupPlan({
      deferred: true,
      idleCheckpointDelayMs: 1_000,
      nowMs: Date.parse("2026-07-01T00:09:00.000Z"),
      vaultRoot,
    });

    // hosted-provider-cleanup.json is the single owner of the next cleanup
    // wake: re-arming a due/invalid checkpoint writes the deferred wake back
    // into the file and requires a checkpoint so the re-arm is durable.
    assert.deepEqual(plan, {
      checkpoint: {
        nextWakeAt: "2026-07-01T00:09:02.000Z",
      },
      deferred: true,
      due: false,
      requiresCheckpoint: true,
      stateQueued: true,
    });
    assert.deepEqual(await readHostedProviderCleanupCheckpoint(vaultRoot), {
      nextWakeAt: "2026-07-01T00:09:02.000Z",
    });
    assert.equal(
      await resolveHostedProviderCleanupScheduledWakeAt({
        nowMs: Date.parse("2026-07-01T00:09:00.000Z"),
        vaultRoot,
      }),
      "2026-07-01T00:09:02.000Z",
    );
    const raw = await readHostedProviderCleanupFile(vaultRoot);
    assert.deepEqual(raw.linqMessageIds, ["linq_inbound_1"]);
  } finally {
    await cleanup();
  }
});

test("hosted provider cleanup deferred plan durably queues terminal cleanup written this turn", async () => {
  const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace("hosted-provider-cleanup-");

  try {
    const plan = await prepareHostedProviderCleanupPlan({
      deferred: true,
      idleCheckpointDelayMs: 1_000,
      nowMs: Date.parse("2026-07-01T00:09:00.000Z"),
      terminalCleanupMessageIds: ["linq_terminal_1", "linq_terminal_1"],
      vaultRoot,
    });

    assert.deepEqual(plan, {
      checkpoint: {
        nextWakeAt: "2026-07-01T00:09:02.000Z",
      },
      deferred: true,
      due: false,
      requiresCheckpoint: true,
      stateQueued: true,
    });
    const raw = await readHostedProviderCleanupFile(vaultRoot);
    assert.deepEqual(raw.linqMessageIds, ["linq_terminal_1"]);
    assert.deepEqual(raw.checkpoint, {
      nextWakeAt: "2026-07-01T00:09:02.000Z",
    });
  } finally {
    await cleanup();
  }
});

test("hosted provider cleanup queued this turn survives a foreground preemption that consumes the wake", async () => {
  const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace("hosted-provider-cleanup-");

  try {
    await prepareHostedProviderCleanupPlan({
      deferred: true,
      idleCheckpointDelayMs: 1_000,
      nowMs: Date.parse("2026-07-01T00:09:00.000Z"),
      terminalCleanupMessageIds: ["linq_terminal_1"],
      vaultRoot,
    });

    const preemptedPlan = await prepareHostedProviderCleanupPlan({
      deferred: true,
      idleCheckpointDelayMs: 1_000,
      nowMs: Date.parse("2026-07-01T00:09:01.000Z"),
      vaultRoot,
    });

    assert.equal(preemptedPlan.requiresCheckpoint, false);
    assert.equal(
      await resolveHostedProviderCleanupScheduledWakeAt({
        nowMs: Date.parse("2026-07-01T00:09:01.000Z"),
        vaultRoot,
      }),
      "2026-07-01T00:09:02.000Z",
    );
    const raw = await readHostedProviderCleanupFile(vaultRoot);
    assert.deepEqual(raw.linqMessageIds, ["linq_terminal_1"]);

    const duePlan = await prepareHostedProviderCleanupPlan({
      deferred: true,
      idleCheckpointDelayMs: 1_000,
      nowMs: Date.parse("2026-07-01T00:10:00.000Z"),
      vaultRoot,
    });

    // The due wake re-arms durably: the owner file carries the new wake and
    // the queued ids survive.
    assert.equal(duePlan.requiresCheckpoint, true);
    assert.deepEqual(await readHostedProviderCleanupCheckpoint(vaultRoot), {
      nextWakeAt: "2026-07-01T00:10:02.000Z",
    });
    const rearmedRaw = await readHostedProviderCleanupFile(vaultRoot);
    assert.deepEqual(rearmedRaw.linqMessageIds, ["linq_terminal_1"]);
  } finally {
    await cleanup();
  }
});

test("hosted provider cleanup deferred plan does not bootstrap on vaults without auto-reply history", async () => {
  const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace("hosted-provider-cleanup-");

  try {
    const plan = await prepareHostedProviderCleanupPlan({
      deferred: true,
      idleCheckpointDelayMs: 1_000,
      nowMs: Date.parse("2026-07-01T00:09:00.000Z"),
      vaultRoot,
    });

    assert.equal(plan.requiresCheckpoint, false);
    assert.equal(plan.stateQueued, false);
    assert.equal(
      await resolveHostedProviderCleanupScheduledWakeAt({
        nowMs: Date.parse("2026-07-01T00:09:00.000Z"),
        vaultRoot,
      }),
      null,
    );
    await assert.rejects(readHostedProviderCleanupFile(vaultRoot), {
      code: "ENOENT",
    });
  } finally {
    await cleanup();
  }
});

test("hosted provider cleanup deferred plan stays wakeless after recovery without state or new evidence", async () => {
  const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace("hosted-provider-cleanup-");

  try {
    await prepareHostedProviderCleanupPlan({
      deferred: false,
      nowMs: Date.parse("2026-07-01T00:08:00.000Z"),
      vaultRoot,
    });

    const plan = await prepareHostedProviderCleanupPlan({
      deferred: true,
      idleCheckpointDelayMs: 1_000,
      nowMs: Date.parse("2026-07-01T00:09:00.000Z"),
      vaultRoot,
    });

    assert.equal(plan.requiresCheckpoint, false);
    assert.equal(plan.stateQueued, false);
    assert.equal(
      await resolveHostedProviderCleanupScheduledWakeAt({
        nowMs: Date.parse("2026-07-01T00:09:00.000Z"),
        vaultRoot,
      }),
      null,
    );
  } finally {
    await cleanup();
  }
});

test("hosted provider cleanup deferred plan bootstraps a recovery wake before the migration has run", async () => {
  const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace("hosted-provider-cleanup-");

  try {
    await mkdir(path.join(
      resolveAssistantStatePaths(vaultRoot).assistantStateRoot,
      "auto-reply",
      "evidence",
    ), { recursive: true });
    const plan = await prepareHostedProviderCleanupPlan({
      deferred: true,
      idleCheckpointDelayMs: 1_000,
      nowMs: Date.parse("2026-07-01T00:09:00.000Z"),
      vaultRoot,
    });

    assert.deepEqual(plan, {
      checkpoint: {
        nextWakeAt: "2026-07-01T00:09:02.000Z",
      },
      deferred: true,
      due: false,
      requiresCheckpoint: true,
      stateQueued: true,
    });
    expect(mocks.listPendingAssistantAutoReplyLinqCleanupEvidence).not.toHaveBeenCalled();
    assert.equal(await hasHostedProviderCleanupRecoveryCompleted(vaultRoot), false);
    const raw = await readHostedProviderCleanupFile(vaultRoot);
    assert.deepEqual(raw.linqMessageIds, []);

    const rearmedPlan = await prepareHostedProviderCleanupPlan({
      deferred: true,
      idleCheckpointDelayMs: 1_000,
      nowMs: Date.parse("2026-07-01T00:09:01.000Z"),
      vaultRoot,
    });

    assert.equal(rearmedPlan.stateQueued, false);
    assert.equal(
      await resolveHostedProviderCleanupScheduledWakeAt({
        nowMs: Date.parse("2026-07-01T00:09:01.000Z"),
        vaultRoot,
      }),
      "2026-07-01T00:09:02.000Z",
    );
  } finally {
    await cleanup();
  }
});

test("hosted provider cleanup plan queues terminal Linq cleanup as checkpoint work", async () => {
  const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace("hosted-provider-cleanup-");

  try {
    const plan = await prepareHostedProviderCleanupPlan({
      deferred: false,
      nowMs: Date.parse("2026-07-01T00:09:00.000Z"),
      terminalCleanupMessageIds: ["linq_terminal_1", "linq_terminal_1"],
      vaultRoot,
    });

    assert.deepEqual(plan, {
      checkpoint: {
        nextWakeAt: "2026-07-01T00:12:01.000Z",
      },
      deferred: false,
      due: false,
      requiresCheckpoint: true,
      stateQueued: true,
    });
    const raw = await readHostedProviderCleanupFile(vaultRoot);
    assert.deepEqual(raw.linqMessageIds, ["linq_terminal_1"]);
  } finally {
    await cleanup();
  }
});




test("hosted provider cleanup keeps a bounded steady-state file count", async () => {
  const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace("hosted-provider-cleanup-");
  await createLegacyEvidenceDirectory(vaultRoot);

  try {
    const listProviderCleanupFiles = async (): Promise<string[]> =>
      (await readdir(resolveAssistantStatePaths(vaultRoot).assistantStateRoot))
        .filter((name) => name.startsWith("hosted-provider-cleanup"))
        .sort();

    // Repeated queueing and re-arming overwrites the single owner file.
    await prepareHostedProviderCleanupPlan({
      deferred: true,
      idleCheckpointDelayMs: 1_000,
      nowMs: Date.parse("2026-07-01T00:09:00.000Z"),
      terminalCleanupMessageIds: ["linq_terminal_1"],
      vaultRoot,
    });
    await prepareHostedProviderCleanupPlan({
      deferred: true,
      idleCheckpointDelayMs: 1_000,
      nowMs: Date.parse("2026-07-01T00:10:00.000Z"),
      terminalCleanupMessageIds: ["linq_terminal_2"],
      vaultRoot,
    });
    assert.deepEqual(await listProviderCleanupFiles(), [
      "hosted-provider-cleanup.json",
    ]);

    // The one-shot legacy recovery adds at most the single migration marker.
    await prepareHostedProviderCleanupPlan({
      deferred: false,
      nowMs: Date.parse("2026-07-01T00:11:00.000Z"),
      vaultRoot,
    });
    assert.deepEqual(await listProviderCleanupFiles(), [
      "hosted-provider-cleanup-recovery.json",
      "hosted-provider-cleanup.json",
    ]);

    // A successful drain deletes the queue file; only the temporary
    // migration marker remains until its delete-together code is removed.
    await drainHostedProviderCleanupAfterCommit({
      env: {
        LINQ_API_TOKEN: "test-token",
      },
      fetchImplementation: vi.fn<typeof fetch>(),
      checkpoint,
      vaultRoot,
      wake,
    });
    assert.deepEqual(await listProviderCleanupFiles(), [
      "hosted-provider-cleanup-recovery.json",
    ]);
  } finally {
    await cleanup();
  }
});

test("hosted provider cleanup upgrade recovery queues legacy unqueued evidence once", async () => {
  const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace("hosted-provider-cleanup-");
  await createLegacyEvidenceDirectory(vaultRoot);
  mocks.listPendingAssistantAutoReplyLinqCleanupEvidence
    .mockResolvedValueOnce({
      captureIds: ["capture_batch_1"],
      linqMessageIds: ["linq_legacy_1"],
    })
    .mockResolvedValueOnce({
      captureIds: ["capture_batch_2"],
      linqMessageIds: ["linq_legacy_2"],
    });

  try {
    assert.equal(await hasHostedProviderCleanupRecoveryCompleted(vaultRoot), false);
    const plan = await prepareHostedProviderCleanupPlan({
      deferred: false,
      nowMs: Date.parse("2026-07-01T00:09:00.000Z"),
      vaultRoot,
    });

    assert.equal(plan.stateQueued, true);
    assert.equal(plan.due, true);
    assert.equal(await hasHostedProviderCleanupRecoveryCompleted(vaultRoot), true);
    expect(mocks.listPendingAssistantAutoReplyLinqCleanupEvidence).toHaveBeenCalledTimes(3);
    expect(mocks.markAssistantAutoReplyLinqCleanupQueued).toHaveBeenCalledWith({
      captureIds: ["capture_batch_1"],
      vault: vaultRoot,
    });
    const raw = await readHostedProviderCleanupFile(vaultRoot);
    assert.deepEqual(raw.linqMessageIds, ["linq_legacy_1", "linq_legacy_2"]);

    mocks.listPendingAssistantAutoReplyLinqCleanupEvidence.mockClear();
    const secondPlan = await prepareHostedProviderCleanupPlan({
      deferred: false,
      nowMs: Date.parse("2026-07-01T00:20:00.000Z"),
      vaultRoot,
    });

    expect(mocks.listPendingAssistantAutoReplyLinqCleanupEvidence).not.toHaveBeenCalled();
    assert.equal(secondPlan.stateQueued, false);
  } finally {
    await cleanup();
  }
});

test("hosted provider cleanup upgrade recovery yields to foreground between batches and resumes later", async () => {
  const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace("hosted-provider-cleanup-");
  await createLegacyEvidenceDirectory(vaultRoot);

  try {
    let scannedBatches = 0;
    mocks.listPendingAssistantAutoReplyLinqCleanupEvidence.mockImplementationOnce(async () => {
      scannedBatches += 1;
      return {
        captureIds: ["capture_batch_1"],
        linqMessageIds: ["linq_legacy_1"],
      };
    });

    const plan = await prepareHostedProviderCleanupPlan({
      deferred: false,
      nowMs: Date.parse("2026-07-01T00:09:00.000Z"),
      shouldYield: () => scannedBatches >= 1,
      vaultRoot,
    });

    assert.equal(plan.stateQueued, true);
    expect(mocks.listPendingAssistantAutoReplyLinqCleanupEvidence).toHaveBeenCalledTimes(1);
    const raw = await readHostedProviderCleanupFile(vaultRoot);
    assert.deepEqual(raw.linqMessageIds, ["linq_legacy_1"]);
    assert.equal(await hasHostedProviderCleanupRecoveryCompleted(vaultRoot), false);

    mocks.listPendingAssistantAutoReplyLinqCleanupEvidence.mockClear();
    mocks.listPendingAssistantAutoReplyLinqCleanupEvidence
      .mockResolvedValueOnce({
        captureIds: ["capture_batch_2"],
        linqMessageIds: ["linq_legacy_2"],
      });
    const resumedPlan = await prepareHostedProviderCleanupPlan({
      deferred: false,
      nowMs: Date.parse("2026-07-01T00:20:00.000Z"),
      vaultRoot,
    });

    assert.equal(resumedPlan.stateQueued, true);
    assert.equal(await hasHostedProviderCleanupRecoveryCompleted(vaultRoot), true);
    const resumed = await readHostedProviderCleanupFile(vaultRoot);
    assert.deepEqual(resumed.linqMessageIds, ["linq_legacy_1", "linq_legacy_2"]);
  } finally {
    await cleanup();
  }
});

test("hosted provider cleanup no-op recovery still forces a checkpoint so the marker is durable", async () => {
  const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace("hosted-provider-cleanup-");
  await createLegacyEvidenceDirectory(vaultRoot);

  try {
    const plan = await prepareHostedProviderCleanupPlan({
      deferred: false,
      nowMs: Date.parse("2026-07-01T00:09:00.000Z"),
      vaultRoot,
    });

    assert.equal(plan.requiresCheckpoint, true);
    assert.equal(await hasHostedProviderCleanupRecoveryCompleted(vaultRoot), true);

    mocks.listPendingAssistantAutoReplyLinqCleanupEvidence.mockClear();
    const secondPlan = await prepareHostedProviderCleanupPlan({
      deferred: false,
      nowMs: Date.parse("2026-07-01T00:20:00.000Z"),
      vaultRoot,
    });

    expect(mocks.listPendingAssistantAutoReplyLinqCleanupEvidence).not.toHaveBeenCalled();
    assert.equal(secondPlan.requiresCheckpoint, false);
  } finally {
    await cleanup();
  }
});

test("hosted provider cleanup upgrade recovery stops when marking makes no progress", async () => {
  const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace("hosted-provider-cleanup-");
  await createLegacyEvidenceDirectory(vaultRoot);
  mocks.listPendingAssistantAutoReplyLinqCleanupEvidence.mockResolvedValue({
    captureIds: ["capture_stuck"],
    linqMessageIds: ["linq_stuck_1"],
  });

  try {
    const plan = await prepareHostedProviderCleanupPlan({
      deferred: false,
      nowMs: Date.parse("2026-07-01T00:09:00.000Z"),
      vaultRoot,
    });

    assert.equal(plan.stateQueued, true);
    expect(mocks.listPendingAssistantAutoReplyLinqCleanupEvidence).toHaveBeenCalledTimes(2);
    const raw = await readHostedProviderCleanupFile(vaultRoot);
    assert.deepEqual(raw.linqMessageIds, ["linq_stuck_1"]);
  } finally {
    await cleanup();
  }
});

test("hosted provider cleanup deferred plans never run the upgrade recovery scan", async () => {
  const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace("hosted-provider-cleanup-");

  try {
    await prepareHostedProviderCleanupPlan({
      deferred: true,
      idleCheckpointDelayMs: 1_000,
      nowMs: Date.parse("2026-07-01T00:09:00.000Z"),
      vaultRoot,
    });

    expect(mocks.listPendingAssistantAutoReplyLinqCleanupEvidence).not.toHaveBeenCalled();
  } finally {
    await cleanup();
  }
});

test("hosted provider cleanup scheduled read surfaces an immediate wake for due queued state", async () => {
  const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace("hosted-provider-cleanup-");

  try {
    await recordHostedProviderCleanupBeforeCommit({
      linqMessageIds: ["linq_inbound_1"],
      checkpoint: {
        nextWakeAt: null,
      },
      vaultRoot,
    });

    assert.equal(
      await resolveHostedProviderCleanupScheduledWakeAt({
        nowMs: Date.parse("2026-07-01T00:09:00.000Z"),
        vaultRoot,
      }),
      "2026-07-01T00:09:00.000Z",
    );

    await drainHostedProviderCleanupAfterCommit({
      env: {
        LINQ_API_TOKEN: "test-token",
      },
      fetchImplementation: vi.fn<typeof fetch>(),
      checkpoint: {
        nextWakeAt: null,
      },
      vaultRoot,
      wake,
    });

    assert.equal(
      await resolveHostedProviderCleanupScheduledWakeAt({
        nowMs: Date.parse("2026-07-01T00:09:05.000Z"),
        vaultRoot,
      }),
      null,
    );
  } finally {
    await cleanup();
  }
});

test("hosted provider cleanup first defer wake follows the idle checkpoint delay", () => {
  assert.equal(
    resolveHostedProviderCleanupFirstDeferredWakeAt({
      idleCheckpointDelayMs: 54_000,
      nowMs: Date.parse("2026-07-01T00:09:00.000Z"),
    }),
    "2026-07-01T00:09:55.000Z",
  );
});

test("hosted provider cleanup drains only persisted ids after commit", async () => {
  const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace("hosted-provider-cleanup-");

  try {
    await recordHostedProviderCleanupBeforeCommit({
      linqMessageIds: ["linq_inbound_1"],
      checkpoint,
      vaultRoot,
    });
    const assertLiveness = vi.fn(async () => undefined);
    const providerFetch = vi.fn<typeof fetch>();

    const result = await drainHostedProviderCleanupAfterCommit({
      assertLiveness,
      env: {
        LINQ_API_TOKEN: "test-token",
      },
      fetchImplementation: providerFetch,
      checkpoint,
      vaultRoot,
      wake,
    });

    expect(assertLiveness).toHaveBeenCalledTimes(1);
    assert.deepEqual(result, {
      attemptedLinqMessageCount: 1,
      deletedLinqMessageCount: 1,
      failedLinqMessageCount: 0,
      nextWakeAt: null,
    });
    expect(mocks.deleteHostedLinqMessages).toHaveBeenCalledTimes(1);
    expect(mocks.deleteHostedLinqMessages).toHaveBeenCalledWith({
      env: {
        LINQ_API_TOKEN: "test-token",
      },
      fetchImplementation: providerFetch,
      messageIds: ["linq_inbound_1"],
    });
    await assert.rejects(readHostedProviderCleanupFile(vaultRoot), {
      code: "ENOENT",
    });
  } finally {
    await cleanup();
  }
});

test("hosted provider cleanup drain yields to foreground work between provider deletes", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-04-08T00:00:00.000Z"));
  const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace("hosted-provider-cleanup-");

  try {
    await recordHostedProviderCleanupBeforeCommit({
      linqMessageIds: ["linq_inbound_1", "linq_inbound_2"],
      checkpoint,
      vaultRoot,
    });
    let deletesStarted = 0;
    mocks.deleteHostedLinqMessages.mockImplementation(async () => {
      deletesStarted += 1;
    });

    const result = await drainHostedProviderCleanupAfterCommit({
      env: {
        LINQ_API_TOKEN: "test-token",
      },
      fetchImplementation: vi.fn<typeof fetch>(),
      checkpoint,
      shouldYield: () => deletesStarted >= 1,
      vaultRoot,
      wake,
    });

    assert.deepEqual(result, {
      attemptedLinqMessageCount: 1,
      deletedLinqMessageCount: 1,
      failedLinqMessageCount: 0,
      nextWakeAt: "2026-04-08T00:05:00.000Z",
    });
    expect(mocks.deleteHostedLinqMessages).toHaveBeenCalledTimes(1);
    const raw = await readHostedProviderCleanupFile(vaultRoot);
    assert.deepEqual(raw.linqMessageIds, ["linq_inbound_2"]);
    assert.deepEqual(raw.checkpoint, {
      nextWakeAt: "2026-04-08T00:05:00.000Z",
    });
  } finally {
    vi.useRealTimers();
    await cleanup();
  }
});

test("hosted provider cleanup uses direct provider cleanup with provider fetch", async () => {
  const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace("hosted-provider-cleanup-");

  try {
    await recordHostedProviderCleanupBeforeCommit({
      linqMessageIds: ["linq_inbound_1"],
      checkpoint,
      vaultRoot,
    });
    const providerFetch = vi.fn<typeof fetch>();

    const result = await drainHostedProviderCleanupAfterCommit({
      env: {
        LINQ_API_TOKEN: "legacy-token",
      },
      fetchImplementation: providerFetch,
      checkpoint,
      vaultRoot,
      wake,
    });

    assert.deepEqual(result, {
      attemptedLinqMessageCount: 1,
      deletedLinqMessageCount: 1,
      failedLinqMessageCount: 0,
      nextWakeAt: null,
    });
    expect(mocks.deleteHostedLinqMessages).toHaveBeenCalledWith({
      env: {
        LINQ_API_TOKEN: "legacy-token",
      },
      fetchImplementation: providerFetch,
      messageIds: ["linq_inbound_1"],
    });
  } finally {
    await cleanup();
  }
});

test("hosted provider cleanup keeps runtime retry state when Linq deletion fails", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-04-08T00:00:00.000Z"));
  const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace("hosted-provider-cleanup-");

  try {
    await recordHostedProviderCleanupBeforeCommit({
      linqMessageIds: ["linq_inbound_1"],
      checkpoint,
      vaultRoot,
    });

    const result = await drainHostedProviderCleanupAfterCommit({
      env: {},
      fetchImplementation: null,
      checkpoint,
      vaultRoot,
      wake,
    });

    assert.deepEqual(result, {
      attemptedLinqMessageCount: 1,
      deletedLinqMessageCount: 0,
      failedLinqMessageCount: 1,
      nextWakeAt: "2026-04-08T00:05:00.000Z",
    });
    const raw = await readHostedProviderCleanupFile(vaultRoot);
    assert.deepEqual(raw.linqMessageIds, ["linq_inbound_1"]);
    assert.deepEqual(raw.checkpoint, checkpoint);
    expect(mocks.deleteHostedLinqMessages).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
    await cleanup();
  }
});

test("hosted provider cleanup persists a future retry checkpoint after failed deletion", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-04-08T00:00:00.000Z"));
  const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace("hosted-provider-cleanup-");

  try {
    await recordHostedProviderCleanupBeforeCommit({
      linqMessageIds: ["linq_inbound_1"],
      checkpoint: {
        nextWakeAt: null,
      },
      vaultRoot,
    });

    const result = await drainHostedProviderCleanupAfterCommit({
      env: {},
      fetchImplementation: null,
      checkpoint: {
        nextWakeAt: null,
      },
      vaultRoot,
      wake,
    });

    assert.deepEqual(result, {
      attemptedLinqMessageCount: 1,
      deletedLinqMessageCount: 0,
      failedLinqMessageCount: 1,
      nextWakeAt: "2026-04-08T00:05:00.000Z",
    });
    assert.deepEqual(
      await readHostedProviderCleanupCheckpoint(vaultRoot),
      {
        nextWakeAt: "2026-04-08T00:05:00.000Z",
      },
    );
    expect(mocks.deleteHostedLinqMessages).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
    await cleanup();
  }
});

test("hosted provider cleanup ignores malformed retry state", async () => {
  const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace("hosted-provider-cleanup-");

  try {
    const filePath = path.join(
      resolveAssistantStatePaths(vaultRoot).assistantStateRoot,
      "hosted-provider-cleanup.json",
    );
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, '{"schema":', "utf8");

    assert.equal(await readHostedProviderCleanupCheckpoint(vaultRoot), null);

    const result = await drainHostedProviderCleanupAfterCommit({
      env: {},
      fetchImplementation: null,
      checkpoint: {
        nextWakeAt: null,
      },
      vaultRoot,
      wake,
    });

    assert.deepEqual(result, {
      attemptedLinqMessageCount: 0,
      deletedLinqMessageCount: 0,
      failedLinqMessageCount: 0,
      nextWakeAt: null,
    });
  } finally {
    await cleanup();
  }
});

async function readHostedProviderCleanupFile(vaultRoot: string): Promise<{
  linqMessageIds: unknown;
  checkpoint: unknown;
}> {
  const filePath = path.join(
    resolveAssistantStatePaths(vaultRoot).assistantStateRoot,
    "hosted-provider-cleanup.json",
  );
  return JSON.parse(await readFile(filePath, "utf8")) as {
    linqMessageIds: unknown;
    checkpoint: unknown;
  };
}
