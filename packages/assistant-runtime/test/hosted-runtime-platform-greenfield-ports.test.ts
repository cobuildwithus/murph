import assert from "node:assert/strict";

import { test } from "vitest";

import type {
  HostedMailboxFetchRequest,
  HostedMailboxItem,
  HostedMailboxLane,
  HostedMailboxLaneHighWater,
  HostedMailboxPayload,
  HostedMailboxPayloadFetchRequest,
  HostedRuntimeLogRequest,
  HostedRuntimeSharePayloadFetchRequest,
  HostedRuntimeVaultSyncPayloadFetchRequest,
  HostedWorkspaceCheckpointRequest,
  HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";

import type {
  HostedRuntimeLogPort,
  HostedRuntimeMailboxPort,
  HostedRuntimePlatform,
  HostedRuntimeSharePort,
  HostedRuntimeVaultSyncPort,
  HostedRuntimeWorkspacePort,
} from "../src/hosted-runtime-contracts.ts";
import {
  createHostedRuntimeArtifactStoreStub,
  createHostedRuntimeEffectsPortStub,
} from "./hosted-runtime-test-helpers.ts";

const TEST_USER_ID = "member_synthetic_001";
const TEST_NOW = "2026-04-26T00:00:00.000Z";

type HostedRuntimePlatformWithGreenfieldPorts = HostedRuntimePlatform & {
  logPort: HostedRuntimeLogPort;
  mailboxPort: HostedRuntimeMailboxPort;
  sharePort: HostedRuntimeSharePort;
  vaultSyncPort: HostedRuntimeVaultSyncPort;
  workspacePort: HostedRuntimeWorkspacePort;
};

test("hosted runtime platform can fetch mailbox items through an injected fake port", async () => {
  const firstItem = createMailboxItem({
    id: "mailbox_item_synthetic_001",
    laneSeq: "1",
  });
  const secondItem = createMailboxItem({
    id: "mailbox_item_synthetic_002",
    laneSeq: "2",
  });
  const { mailboxFetchRequests, platform } = createFakeHostedRuntimePlatform({
    mailboxItems: [firstItem, secondItem],
  });
  const request = {
    lanes: [
      {
        importedSeq: "1",
        lane: "conversation",
      },
    ],
    limitPerLane: 10,
    requestId: "request_synthetic_fetch_001",
  } satisfies HostedMailboxFetchRequest;

  const response = await platform.mailboxPort.fetch(request);

  assert.deepEqual(mailboxFetchRequests, [request]);
  assert.deepEqual(response, {
    fetchedAt: TEST_NOW,
    items: [secondItem],
    maxSeqByLane: [
      {
        lane: "conversation",
        maxSeq: "2",
      },
    ],
    userId: TEST_USER_ID,
  });
});

test("hosted runtime platform can fetch sidecar mailbox payloads through the mailbox port", async () => {
  const payload = createMailboxPayload({
    mailboxItemId: "mailbox_item_synthetic_001",
  });
  const { mailboxPayloadFetchRequests, platform } = createFakeHostedRuntimePlatform({
    mailboxPayloads: [payload],
  });
  const request = {
    dedupeKey: "dedupe_synthetic_001",
    mailboxItemId: payload.mailboxItemId,
    payloadRef: `hosted-mailbox-payload:${payload.mailboxItemId}`,
    requestId: "request_synthetic_payload_001",
  } satisfies HostedMailboxPayloadFetchRequest;

  const response = await platform.mailboxPort.fetchPayload(request);

  assert.deepEqual(mailboxPayloadFetchRequests, [request]);
  assert.deepEqual(response, {
    fetchedAt: TEST_NOW,
    payload,
  });
});

test("hosted runtime platform can checkpoint workspace state through an injected fake port", async () => {
  const { checkpointRequests, platform } = createFakeHostedRuntimePlatform();
  const request = {
    attemptId: "attempt_synthetic_001",
    expectedWorkspaceVersion: "0",
    leaseGeneration: "1",
    nextWakeAt: null,
    nextWakeReason: null,
    reason: "import",
    redactedStatus: {
      importedCount: 1,
      retryable: false,
    },
    snapshotRef: null,
  } satisfies HostedWorkspaceCheckpointRequest;

  const response = await platform.workspacePort.checkpoint(request);

  assert.deepEqual(checkpointRequests, [request]);
  assert.equal(response.checkpointed, true);
  assert.deepEqual(response.workspace, {
    checkpointedAt: TEST_NOW,
    createdAt: TEST_NOW,
    nextWakeAt: null,
    nextWakeReason: null,
    redactedStatus: {
      importedCount: 1,
      retryable: false,
    },
    snapshotRef: null,
    updatedAt: TEST_NOW,
    userId: TEST_USER_ID,
    version: "1",
  });

  const conflict = await platform.workspacePort.checkpoint({
    ...request,
    attemptId: "attempt_synthetic_002",
    expectedWorkspaceVersion: "0",
  });
  assert.equal(conflict.checkpointed, false);
  assert.equal(conflict.workspace.version, "1");
});

test("hosted runtime platform can write structured logs through an injected fake port", async () => {
  const { logRequests, platform } = createFakeHostedRuntimePlatform();
  const request = {
    entries: [
      {
        at: TEST_NOW,
        component: "mailbox",
        eventCode: "mailbox.imported",
        level: "info",
        mailboxLane: "conversation",
        mailboxSeqEnd: "2",
        mailboxSeqStart: "2",
        phase: "import",
        redactedJson: {
          importedCount: 1,
          retryable: false,
        },
        workspaceVersion: "1",
      },
    ],
  } satisfies HostedRuntimeLogRequest;

  const response = await platform.logPort.write(request);

  assert.deepEqual(logRequests, [request]);
  assert.deepEqual(response, {
    loggedCount: 1,
  });
});

test("hosted runtime platform can fetch and record share side inputs through an injected fake port", async () => {
  const { shareFetchRequests, shareImportRequests, platform } = createFakeHostedRuntimePlatform();
  const fetchRequest = {
    eventId: "event_synthetic_share_001",
    ownerUserId: TEST_USER_ID,
    requestId: "request_synthetic_share_001",
    shareId: "share_synthetic_001",
  } satisfies HostedRuntimeSharePayloadFetchRequest;

  const fetchResponse = await platform.sharePort.fetchPayload(fetchRequest);

  assert.deepEqual(shareFetchRequests, [fetchRequest]);
  assert.deepEqual(fetchResponse, {
    fetchedAt: TEST_NOW,
    payload: null,
    unavailable: {
      code: "not_found",
      retryable: false,
    },
  });

  const importRequest = {
    eventId: "event_synthetic_share_001",
    importedAt: TEST_NOW,
    ownerUserId: TEST_USER_ID,
    shareId: "share_synthetic_001",
    status: "skipped",
  } as const;
  const importResponse = await platform.sharePort.recordImport(importRequest);

  assert.deepEqual(shareImportRequests, [importRequest]);
  assert.deepEqual(importResponse, {
    recorded: true,
    shareId: "share_synthetic_001",
    status: "skipped",
  });
});

test("hosted runtime platform can fetch and record vault-sync side inputs through an injected fake port", async () => {
  const { platform, vaultSyncFetchRequests, vaultSyncImportRequests } =
    createFakeHostedRuntimePlatform();
  const fetchRequest = {
    requestId: "request_synthetic_vault_sync_001",
    sessionId: "vault_sync_session_synthetic_001",
  } satisfies HostedRuntimeVaultSyncPayloadFetchRequest;

  const fetchResponse = await platform.vaultSyncPort.fetchPayload(fetchRequest);

  assert.deepEqual(vaultSyncFetchRequests, [fetchRequest]);
  assert.deepEqual(fetchResponse, {
    fetchedAt: TEST_NOW,
    payload: null,
    unavailable: {
      code: "not_found",
      retryable: false,
    },
  });

  const importRequest = {
    importedAt: TEST_NOW,
    sessionId: "vault_sync_session_synthetic_001",
    status: "failed",
    summary: {
      conflictCount: 0,
      importedJsonlRecords: 0,
      importedRawFiles: 0,
      importedTextFiles: 0,
      skippedDuplicates: 0,
      skippedExcludedFiles: 0,
    },
  } as const;
  const importResponse = await platform.vaultSyncPort.recordImport(importRequest);

  assert.deepEqual(vaultSyncImportRequests, [importRequest]);
  assert.deepEqual(importResponse, {
    recorded: true,
    sessionId: "vault_sync_session_synthetic_001",
    status: "failed",
  });
});

function createFakeHostedRuntimePlatform(input: {
  mailboxItems?: readonly HostedMailboxItem[];
  mailboxPayloads?: readonly HostedMailboxPayload[];
  workspace?: HostedWorkspaceState;
} = {}): {
  checkpointRequests: HostedWorkspaceCheckpointRequest[];
  logRequests: HostedRuntimeLogRequest[];
  mailboxFetchRequests: HostedMailboxFetchRequest[];
  mailboxPayloadFetchRequests: HostedMailboxPayloadFetchRequest[];
  platform: HostedRuntimePlatformWithGreenfieldPorts;
  shareFetchRequests: HostedRuntimeSharePayloadFetchRequest[];
  shareImportRequests: Parameters<HostedRuntimeSharePort["recordImport"]>[0][];
  vaultSyncFetchRequests: HostedRuntimeVaultSyncPayloadFetchRequest[];
  vaultSyncImportRequests: Parameters<HostedRuntimeVaultSyncPort["recordImport"]>[0][];
} {
  const artifactStore = createHostedRuntimeArtifactStoreStub().artifactStore;
  const mailboxItems = [...(input.mailboxItems ?? [])];
  const mailboxPayloads = [...(input.mailboxPayloads ?? [])];
  const mailboxFetchRequests: HostedMailboxFetchRequest[] = [];
  const mailboxPayloadFetchRequests: HostedMailboxPayloadFetchRequest[] = [];
  const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
  const logRequests: HostedRuntimeLogRequest[] = [];
  const shareFetchRequests: HostedRuntimeSharePayloadFetchRequest[] = [];
  const shareImportRequests: Parameters<HostedRuntimeSharePort["recordImport"]>[0][] = [];
  const vaultSyncFetchRequests: HostedRuntimeVaultSyncPayloadFetchRequest[] = [];
  const vaultSyncImportRequests: Parameters<HostedRuntimeVaultSyncPort["recordImport"]>[0][] = [];
  let workspace = input.workspace ?? createWorkspaceState();

  const platform: HostedRuntimePlatformWithGreenfieldPorts = {
    artifactStore,
    effectsPort: createHostedRuntimeEffectsPortStub(),
    logPort: {
      async write(request) {
        logRequests.push(request);
        return {
          loggedCount: request.entries.length,
        };
      },
    },
    mailboxPort: {
      async fetch(request) {
        mailboxFetchRequests.push(request);
        return {
          fetchedAt: TEST_NOW,
          items: request.lanes.flatMap((cursor) =>
            mailboxItems
              .filter((item) =>
                item.lane === cursor.lane
                && BigInt(item.laneSeq) > BigInt(cursor.importedSeq)
              )
              .slice(0, request.limitPerLane)
          ),
          maxSeqByLane: request.lanes.map((cursor) =>
            createLaneHighWater({
              importedSeq: cursor.importedSeq,
              items: mailboxItems,
              lane: cursor.lane,
            })
          ),
          userId: TEST_USER_ID,
        };
      },
      async fetchPayload(request) {
        mailboxPayloadFetchRequests.push(request);
        return {
          fetchedAt: TEST_NOW,
          payload: mailboxPayloads.find((payload) =>
            payload.mailboxItemId === request.mailboxItemId
          ) ?? null,
        };
      },
    },
    sharePort: {
      async fetchPayload(request) {
        shareFetchRequests.push(request);
        return {
          fetchedAt: TEST_NOW,
          payload: null,
          unavailable: {
            code: "not_found",
            retryable: false,
          },
        };
      },
      async recordImport(request) {
        shareImportRequests.push(request);
        return {
          recorded: true,
          shareId: request.shareId,
          status: request.status,
        };
      },
    },
    vaultSyncPort: {
      async fetchPayload(request) {
        vaultSyncFetchRequests.push(request);
        return {
          fetchedAt: TEST_NOW,
          payload: null,
          unavailable: {
            code: "not_found",
            retryable: false,
          },
        };
      },
      async recordImport(request) {
        vaultSyncImportRequests.push(request);
        return {
          recorded: true,
          sessionId: request.sessionId,
          status: request.status,
        };
      },
    },
    workspacePort: {
      async checkpoint(request) {
        checkpointRequests.push(request);
        if (request.expectedWorkspaceVersion !== workspace.version) {
          return {
            checkpointed: false,
            workspace,
          };
        }

        workspace = {
          checkpointedAt: TEST_NOW,
          createdAt: workspace.createdAt,
          nextWakeAt: request.nextWakeAt ?? null,
          nextWakeReason: request.nextWakeReason ?? null,
          redactedStatus: request.redactedStatus ?? null,
          snapshotRef: request.snapshotRef,
          updatedAt: TEST_NOW,
          userId: workspace.userId,
          version: (BigInt(workspace.version) + 1n).toString(),
        };

        return {
          checkpointed: true,
          workspace,
        };
      },
    },
  };

  return {
    checkpointRequests,
    logRequests,
    mailboxFetchRequests,
    mailboxPayloadFetchRequests,
    platform,
    shareFetchRequests,
    shareImportRequests,
    vaultSyncFetchRequests,
    vaultSyncImportRequests,
  };
}

function createMailboxItem(input: {
  id: string;
  laneSeq: string;
}): HostedMailboxItem {
  return {
    createdAt: TEST_NOW,
    dedupeKey: `dedupe_${input.id}`,
    expiresAt: null,
    id: input.id,
    kind: "conversation.message",
    lane: "conversation",
    laneSeq: input.laneSeq,
    occurredAt: TEST_NOW,
    payloadBytes: 64,
    payloadInlineCiphertext: "ciphertext_synthetic_mailbox_payload",
    payloadRef: null,
    payloadSchema: "murph.hosted-mailbox-item.v1",
    updatedAt: TEST_NOW,
    userId: TEST_USER_ID,
  };
}

function createMailboxPayload(input: {
  mailboxItemId: string;
}): HostedMailboxPayload {
  return {
    createdAt: TEST_NOW,
    mailboxItemId: input.mailboxItemId,
    payloadCiphertext: "ciphertext_synthetic_sidecar_payload",
    payloadSchema: "murph.hosted-mailbox-payload.v1",
    userId: TEST_USER_ID,
  };
}

function createWorkspaceState(): HostedWorkspaceState {
  return {
    checkpointedAt: null,
    createdAt: TEST_NOW,
    nextWakeAt: null,
    nextWakeReason: null,
    redactedStatus: null,
    snapshotRef: null,
    updatedAt: TEST_NOW,
    userId: TEST_USER_ID,
    version: "0",
  };
}

function createLaneHighWater(input: {
  importedSeq: string;
  items: readonly HostedMailboxItem[];
  lane: HostedMailboxLane;
}): HostedMailboxLaneHighWater {
  let maxSeq = BigInt(input.importedSeq);

  for (const item of input.items) {
    if (item.lane !== input.lane) {
      continue;
    }

    const itemSeq = BigInt(item.laneSeq);
    if (itemSeq > maxSeq) {
      maxSeq = itemSeq;
    }
  }

  return {
    lane: input.lane,
    maxSeq: maxSeq.toString(),
  };
}
