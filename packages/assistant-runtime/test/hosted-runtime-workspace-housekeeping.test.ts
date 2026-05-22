import assert from "node:assert/strict";

import type {
  HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import { beforeEach, describe, it, vi } from "vitest";

import type {
  HostedMailboxImportCheckpointResult,
} from "../src/hosted-runtime/mailbox-checkpoint.ts";
import {
  createEmptyHostedMailboxImportState,
} from "../src/hosted-runtime/mailbox-state.ts";

const coreMocks = vi.hoisted(() => ({
  compactLegacyWearableReceiptEnvelopes: vi.fn(),
  detectLegacyWearableReceiptCompaction: vi.fn(),
}));

vi.mock("@murphai/core", () => ({
  compactLegacyWearableReceiptEnvelopes:
    coreMocks.compactLegacyWearableReceiptEnvelopes,
  detectLegacyWearableReceiptCompaction:
    coreMocks.detectLegacyWearableReceiptCompaction,
}));

import {
  HOSTED_LEGACY_WEARABLE_RECEIPT_COMPACTION_DEADLINE_MS,
  HOSTED_LEGACY_WEARABLE_RECEIPT_COMPACTION_WAKE_REASON,
  isLegacyWearableReceiptCompactionWakeDue,
  runHostedWorkspaceHousekeepingPhase,
  scheduleLegacyWearableReceiptCompactionWakeForDetection,
  scheduleLegacyWearableReceiptCompactionWakeIfNeeded,
} from "../src/hosted-runtime/workspace-housekeeping.ts";

const TEST_NOW = "2026-04-26T00:00:00.000Z";
const TEST_USER_ID = "member_synthetic_housekeeping";
const DUE_WAKE_AT = "2026-04-25T23:59:00.000Z";
const RESCHEDULE_DELAY_MS = 185_000;

beforeEach(() => {
  vi.clearAllMocks();
  coreMocks.compactLegacyWearableReceiptEnvelopes.mockResolvedValue({
    bytesAfter: 512,
    bytesBefore: 1024,
    compactedCount: 1,
    hasMore: false,
    mutated: true,
    skippedCount: 0,
    touchedPaths: ["raw/integrations/garmin/2026/04/import_synthetic/receipt.json"],
  });
  coreMocks.detectLegacyWearableReceiptCompaction.mockResolvedValue({
    hasWork: true,
    suspectedCount: 1,
  });
});

describe("hosted workspace housekeeping", () => {
  it("handles a due legacy wearable receipt compaction wake without request reason state", async () => {
    const result = await runHostedWorkspaceHousekeepingPhase({
      initialMailboxImport: createMailboxImportResult(),
      now: () => TEST_NOW,
      rescheduleDelayMs: RESCHEDULE_DELAY_MS,
      vaultRoot: "vault_synthetic_housekeeping",
      workspace: createWorkspaceState({
        nextWakeAt: DUE_WAKE_AT,
        nextWakeReason: HOSTED_LEGACY_WEARABLE_RECEIPT_COMPACTION_WAKE_REASON,
      }),
    });

    assert.equal(result.handled, true);
    if (result.handled) {
      assert.equal(result.runtimeStateDirty, true);
      assert.equal(result.nextWakeAt, null);
      assert.equal(result.nextWakeReason, null);
      assert.equal(result.compactedCount, 1);
      assert.equal(result.redactedStatus.legacyWearableReceiptCompactionCompactedCount, 1);
    }
    assert.equal(coreMocks.compactLegacyWearableReceiptEnvelopes.mock.calls.length, 1);
    assert.equal(
      coreMocks.compactLegacyWearableReceiptEnvelopes.mock.calls[0]?.[0].now.toISOString(),
      TEST_NOW,
    );
    assert.equal(
      coreMocks.compactLegacyWearableReceiptEnvelopes.mock.calls[0]?.[0].deadlineMs,
      HOSTED_LEGACY_WEARABLE_RECEIPT_COMPACTION_DEADLINE_MS,
    );
  });

  it("reschedules the same maintenance wake when bounded compaction has more work", async () => {
    coreMocks.compactLegacyWearableReceiptEnvelopes.mockResolvedValueOnce({
      bytesAfter: 512,
      bytesBefore: 1024,
      compactedCount: 1,
      hasMore: true,
      mutated: true,
      skippedCount: 0,
      touchedPaths: [],
    });

    const result = await runHostedWorkspaceHousekeepingPhase({
      initialMailboxImport: createMailboxImportResult(),
      now: () => TEST_NOW,
      rescheduleDelayMs: RESCHEDULE_DELAY_MS,
      vaultRoot: "vault_synthetic_housekeeping",
      workspace: createWorkspaceState({
        nextWakeAt: DUE_WAKE_AT,
        nextWakeReason: HOSTED_LEGACY_WEARABLE_RECEIPT_COMPACTION_WAKE_REASON,
      }),
    });

    assert.equal(result.handled, true);
    if (result.handled) {
      assert.equal(result.nextWakeAt, "2026-04-26T00:03:05.000Z");
      assert.equal(
        result.nextWakeReason,
        HOSTED_LEGACY_WEARABLE_RECEIPT_COMPACTION_WAKE_REASON,
      );
      assert.equal(result.runtimeStateDirty, true);
    }
  });

  it("clears a stale maintenance wake when no eligible work remains", async () => {
    coreMocks.compactLegacyWearableReceiptEnvelopes.mockResolvedValueOnce({
      bytesAfter: 0,
      bytesBefore: 0,
      compactedCount: 0,
      hasMore: false,
      mutated: false,
      skippedCount: 0,
      touchedPaths: [],
    });

    const result = await runHostedWorkspaceHousekeepingPhase({
      initialMailboxImport: createMailboxImportResult(),
      now: () => TEST_NOW,
      rescheduleDelayMs: RESCHEDULE_DELAY_MS,
      vaultRoot: "vault_synthetic_housekeeping",
      workspace: createWorkspaceState({
        nextWakeAt: DUE_WAKE_AT,
        nextWakeReason: HOSTED_LEGACY_WEARABLE_RECEIPT_COMPACTION_WAKE_REASON,
      }),
    });

    assert.equal(result.handled, true);
    if (result.handled) {
      assert.equal(result.mutated, false);
      assert.equal(result.runtimeStateDirty, true);
      assert.equal(result.nextWakeAt, null);
      assert.equal(result.nextWakeReason, null);
    }
  });

  it("lets fresh conversation input win over a due maintenance wake", async () => {
    const result = await runHostedWorkspaceHousekeepingPhase({
      initialMailboxImport: createMailboxImportResult({
        assistantInputIds: ["input_synthetic_fresh"],
        conversationImportedCount: 1,
      }),
      now: () => TEST_NOW,
      rescheduleDelayMs: RESCHEDULE_DELAY_MS,
      vaultRoot: "vault_synthetic_housekeeping",
      workspace: createWorkspaceState({
        nextWakeAt: DUE_WAKE_AT,
        nextWakeReason: HOSTED_LEGACY_WEARABLE_RECEIPT_COMPACTION_WAKE_REASON,
      }),
    });

    assert.deepEqual(result, { handled: false });
    assert.equal(coreMocks.compactLegacyWearableReceiptEnvelopes.mock.calls.length, 0);
  });

  it("detects due maintenance wake state from workspace metadata only", () => {
    assert.equal(
      isLegacyWearableReceiptCompactionWakeDue({
        nowMs: Date.parse(TEST_NOW),
        workspace: createWorkspaceState({
          nextWakeAt: DUE_WAKE_AT,
          nextWakeReason: HOSTED_LEGACY_WEARABLE_RECEIPT_COMPACTION_WAKE_REASON,
        }),
      }),
      true,
    );
    assert.equal(
      isLegacyWearableReceiptCompactionWakeDue({
        nowMs: Date.parse(TEST_NOW),
        workspace: createWorkspaceState({
          nextWakeAt: DUE_WAKE_AT,
          nextWakeReason: "assistant",
        }),
      }),
      false,
    );
  });

  it("schedules maintenance only when the single wake slot is empty or already maintenance", async () => {
    const empty = await scheduleLegacyWearableReceiptCompactionWakeIfNeeded({
      idleCheckpointDelayMs: 180_000,
      nowMs: Date.parse(TEST_NOW),
      projection: {
        nextWakeAt: null,
        nextWakeReason: null,
      },
      vaultRoot: "vault_synthetic_housekeeping",
    });
    assert.equal(empty.changed, true);
    assert.equal(empty.projection.nextWakeAt, "2026-04-26T00:03:05.000Z");
    assert.equal(
      empty.projection.nextWakeReason,
      HOSTED_LEGACY_WEARABLE_RECEIPT_COMPACTION_WAKE_REASON,
    );

    const assistant = await scheduleLegacyWearableReceiptCompactionWakeIfNeeded({
      idleCheckpointDelayMs: 180_000,
      nowMs: Date.parse(TEST_NOW),
      projection: {
        nextWakeAt: "2026-04-26T00:01:00.000Z",
        nextWakeReason: "assistant",
      },
      vaultRoot: "vault_synthetic_housekeeping",
    });
    assert.equal(assistant.changed, false);
    assert.deepEqual(assistant.projection, {
      nextWakeAt: "2026-04-26T00:01:00.000Z",
      nextWakeReason: "assistant",
    });
  });

  it("does not leave an existing maintenance wake due before the idle checkpoint grace", () => {
    const early = scheduleLegacyWearableReceiptCompactionWakeForDetection({
      idleCheckpointDelayMs: 180_000,
      nowMs: Date.parse(TEST_NOW),
      projection: {
        nextWakeAt: "2026-04-26T00:00:30.000Z",
        nextWakeReason: HOSTED_LEGACY_WEARABLE_RECEIPT_COMPACTION_WAKE_REASON,
      },
    });
    assert.equal(early.changed, true);
    assert.equal(early.projection.nextWakeAt, "2026-04-26T00:03:05.000Z");

    const later = scheduleLegacyWearableReceiptCompactionWakeForDetection({
      idleCheckpointDelayMs: 180_000,
      nowMs: Date.parse(TEST_NOW),
      projection: {
        nextWakeAt: "2026-04-26T00:10:00.000Z",
        nextWakeReason: HOSTED_LEGACY_WEARABLE_RECEIPT_COMPACTION_WAKE_REASON,
      },
    });
    assert.equal(later.changed, false);
    assert.deepEqual(later.projection, {
      nextWakeAt: "2026-04-26T00:10:00.000Z",
      nextWakeReason: HOSTED_LEGACY_WEARABLE_RECEIPT_COMPACTION_WAKE_REASON,
    });
  });
});

function createMailboxImportResult(input: {
  assistantInputIds?: readonly string[];
  conversationImportedCount?: number;
} = {}): HostedMailboxImportCheckpointResult {
  const state = createEmptyHostedMailboxImportState();
  return {
    afterCheckpointEffects: [],
    checkpoint: null,
    checkpointDeferred: true,
    importResult: {
      ...(input.assistantInputIds
        ? { assistantInputIds: [...input.assistantInputIds] }
        : {}),
      blocked: [],
      conversationImportedCount: input.conversationImportedCount ?? 0,
      fetchedCount: 0,
      importedCount: 0,
      state,
    },
    previousState: state,
    state,
    stateChanged: false,
  };
}

function createWorkspaceState(
  overrides: Partial<HostedWorkspaceState> = {},
): HostedWorkspaceState {
  return {
    checkpointedAt: TEST_NOW,
    createdAt: TEST_NOW,
    nextWakeAt: null,
    nextWakeReason: null,
    redactedStatus: null,
    snapshotRef: null,
    updatedAt: TEST_NOW,
    userId: TEST_USER_ID,
    version: "0",
    ...overrides,
  };
}
