import assert from "node:assert/strict";

import type {
  HostedMailboxFetchResponse,
  HostedMailboxPayloadFetchResponse,
  HostedRuntimeLogRequest,
  HostedWorkspaceCheckpointRequest,
  HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import { describe, it } from "vitest";

import {
  createHostedWorkspaceCheckpointRequestBuilder,
  runHostedWorkspaceUntilIdleOrBudget,
  type HostedMailboxImportCheckpointResult,
  type HostedRuntimeWorkspacePort,
  type HostedWorkspaceRunnerPlatform,
} from "../src/hosted-runtime.ts";
import {
  createEmptyHostedMailboxImportState,
} from "../src/hosted-runtime/mailbox-state.ts";

const TEST_NOW = "2026-04-26T00:00:00.000Z";
const TEST_USER_ID = "member_synthetic_runner_housekeeping";

describe("runHostedWorkspaceUntilIdleOrBudget housekeeping hook", () => {
  it("returns before assistant hydration when housekeeping handles a due wake", async () => {
    const initialMailboxImport = createMailboxImportResult();
    let assistantPhaseCalled = false;

    const result = await runHostedWorkspaceUntilIdleOrBudget({
      checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
        attemptId: "attempt_synthetic_runner_housekeeping",
        expectedWorkspaceVersion: "0",
        leaseGeneration: "1",
        nextWakeAt: "2026-04-25T23:59:00.000Z",
        nextWakeReason: "legacy-wearable-receipt-compaction-v1",
        snapshotRef: null,
      }),
      expectedUserId: TEST_USER_ID,
      async importItem() {
        throw new Error("Initial mailbox import was already provided.");
      },
      initialMailboxImport,
      limitPerLane: 10,
      platform: createPlatform(),
      requestId: "request_synthetic_runner_housekeeping",
      async runAssistantPhase() {
        assistantPhaseCalled = true;
        return {};
      },
      async runHousekeepingPhase(phaseInput) {
        assert.equal(phaseInput.initialMailboxImport, initialMailboxImport);
        assert.equal(phaseInput.vaultRoot, "vault_synthetic_runner_housekeeping");
        assert.equal(phaseInput.workspace?.nextWakeReason, "legacy-wearable-receipt-compaction-v1");
        return {
          handled: true,
          nextWakeAt: null,
          nextWakeReason: null,
          redactedStatus: {
            legacyWearableReceiptCompactionCompactedCount: 1,
          },
          runtimeStateDirty: true,
        };
      },
      vaultRoot: "vault_synthetic_runner_housekeeping",
      workspace: createWorkspaceState({
        nextWakeAt: "2026-04-25T23:59:00.000Z",
        nextWakeReason: "legacy-wearable-receipt-compaction-v1",
      }),
      now: () => TEST_NOW,
    });

    assert.equal(assistantPhaseCalled, false);
    assert.equal(result.assistantPhaseResult, null);
    assert.equal(result.housekeepingPhaseResult?.handled, true);
    assert.equal(result.runtimeStateDirty, true);
  });

  it("continues to the assistant phase when housekeeping declines", async () => {
    let assistantPhaseCalled = false;

    const result = await runHostedWorkspaceUntilIdleOrBudget({
      checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
        attemptId: "attempt_synthetic_runner_housekeeping_declined",
        expectedWorkspaceVersion: "0",
        leaseGeneration: "1",
        nextWakeAt: null,
        nextWakeReason: null,
        snapshotRef: null,
      }),
      expectedUserId: TEST_USER_ID,
      async importItem() {
        throw new Error("Initial mailbox import was already provided.");
      },
      initialMailboxImport: createMailboxImportResult(),
      limitPerLane: 10,
      platform: createPlatform(),
      requestId: "request_synthetic_runner_housekeeping_declined",
      async runAssistantPhase() {
        assistantPhaseCalled = true;
        return {
          progressed: false,
        };
      },
      async runHousekeepingPhase() {
        return {
          handled: false,
        };
      },
      vaultRoot: "vault_synthetic_runner_housekeeping",
      workspace: createWorkspaceState(),
      now: () => TEST_NOW,
    });

    assert.equal(assistantPhaseCalled, true);
    assert.equal(result.housekeepingPhaseResult?.handled, false);
    assert.equal(result.assistantPhaseResult?.progressed, false);
  });
});

function createPlatform(): HostedWorkspaceRunnerPlatform {
  return {
    artifactStore: {
      async get() {
        return null;
      },
      async put() {
        return undefined;
      },
    },
    effectsPort: {
      async readRawEmailMessage() {
        return null;
      },
      async sendEmail() {
        return undefined;
      },
    },
    logPort: {
      async write(request: HostedRuntimeLogRequest) {
        return {
          loggedCount: request.entries.length,
        };
      },
    },
    mailboxPort: {
      async fetch(): Promise<HostedMailboxFetchResponse> {
        return {
          fetchedAt: TEST_NOW,
          items: [],
          maxSeqByLane: [],
          userId: TEST_USER_ID,
        };
      },
      async fetchPayload(): Promise<HostedMailboxPayloadFetchResponse> {
        throw new Error("No mailbox payload should be fetched in this test.");
      },
    },
    workspacePort: createWorkspacePort(),
  };
}

function createWorkspacePort(): HostedRuntimeWorkspacePort {
  return {
    async checkpoint(
      request: HostedWorkspaceCheckpointRequest,
    ) {
      return {
        checkpointed: true,
        workspace: createWorkspaceState({
          nextWakeAt: request.nextWakeAt ?? null,
          nextWakeReason: request.nextWakeReason ?? null,
          redactedStatus: request.redactedStatus ?? null,
          snapshotRef: request.snapshotRef,
          version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
        }),
      };
    },
  };
}

function createMailboxImportResult(): HostedMailboxImportCheckpointResult {
  const state = createEmptyHostedMailboxImportState();
  return {
    afterCheckpointEffects: [],
    checkpoint: null,
    checkpointDeferred: true,
    importResult: {
      blocked: [],
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
