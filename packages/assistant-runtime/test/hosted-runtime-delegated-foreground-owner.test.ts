import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { initializeVault } from "@murphai/core";
import {
  buildHostedExecutionAssistantAskRequestedWake,
  type HostedExecutionAssistantAskRequestedPayload,
} from "@murphai/hosted-execution";
import type {
  HostedMailboxFetchRequest,
  HostedMailboxFetchResponse,
  HostedMailboxPayloadFetchRequest,
  HostedMailboxPayloadFetchResponse,
  HostedWorkspaceCheckpointResponse,
  HostedWorkspaceReadResponse,
  HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import {
  HOSTED_WORKSPACE_SNAPSHOT_COMPRESSION,
  HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
  HOSTED_WORKSPACE_SNAPSHOT_V2_AAD_PURPOSE,
  HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME,
  HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA,
  type HostedWorkspaceSnapshotV2Ref,
} from "@murphai/hosted-execution/workspace-snapshot-v2";
import { describe, expect, test, vi } from "vitest";

import {
  runHostedWorkspaceRuntimeJobInProcess,
} from "../src/hosted-runtime.ts";
import type {
  HostedRuntimeEffectsPort,
  HostedRuntimeMailboxPort,
  HostedRuntimePlatform,
} from "../src/hosted-runtime-contracts.ts";
import {
  createEmptyHostedMailboxImportState,
  writeHostedMailboxImportState,
} from "../src/hosted-runtime/mailbox-state.ts";
import {
  readHostedSystemMailboxState,
  removeHostedSystemMailboxPendingItem,
  updateHostedSystemMailboxState,
  type HostedSystemMailboxPendingItem,
} from "../src/hosted-runtime/system-mailbox-state.ts";

const TEST_NOW = "2036-08-22T19:00:00.000Z";
const TEST_USER_ID = "member_synthetic_delegated_owner";

describe("hosted runtime delegated foreground owner", () => {
  test.each([
    {
      askSeq: "2",
      deviceSeq: "1",
      label: "a delegated ask ahead of older device work",
      targetKind: "current_sender_personal" as const,
    },
    {
      askSeq: "1",
      deviceSeq: null,
      label: "an ordinary consented ask once it reaches the durable head",
      targetKind: "consented_member" as const,
    },
  ])("upgrades $label", async ({ askSeq, deviceSeq, targetKind }) => {
    const vaultRoot = await mkdtemp(
      path.join(tmpdir(), "murph-runtime-delegated-owner-"),
    );
    const delegated = createDelegatedAskItem(askSeq, targetKind);
    const device = deviceSeq === null ? null : createDeviceItem(deviceSeq);
    const snapshotRef = createWorkspaceSnapshotV2Ref();
    let delegatedConsumptionCount = 0;
    let assistantPhaseCalls = 0;

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      await initializeVault({
        createdAt: new Date(TEST_NOW),
        timezone: "UTC",
        title: "Hosted Runtime Delegated Owner Test Vault",
        vaultRoot,
      });
      await updateHostedSystemMailboxState(
        vaultRoot,
        () => ({ pending: [...(device ? [device] : []), delegated] }),
        { now: () => TEST_NOW },
      );
      await writeHostedMailboxImportState({
        state: {
          ...createEmptyHostedMailboxImportState(),
          watermarks: {
            ...createEmptyHostedMailboxImportState().watermarks,
            system: "2",
          },
        },
        vaultRoot,
      });

      const result = await runHostedWorkspaceRuntimeJobInProcess({
        request: {
          attemptId: "attempt_synthetic_delegated_owner",
          idleCheckpointDelayMs: 1,
          leaseGeneration: "1",
          processingMode: "system_mailbox",
          userId: TEST_USER_ID,
          workspace: createWorkspaceState({ snapshotRef }),
          workspaceVersion: "0",
        },
        runtime: {
          forwardedEnv: {
            HOSTED_ASSISTANT_MODEL: "gpt-synthetic",
            HOSTED_ASSISTANT_PROVIDER: "openai",
            OPENAI_API_KEY: "test-api-key",
          },
        },
      }, {
        async createCheckpointSnapshot() {
          return {
            snapshotRef,
          };
        },
        async importItem() {
          throw new Error("Already-imported delegated work must not import again.");
        },
        platform: createPlatform(snapshotRef),
        async runAssistantPhase(input) {
          assistantPhaseCalls += 1;
          expect(input.runtimeEnv.HOSTED_ASSISTANT_PROVIDER).toBe("openai");
          expect(input.runtimeIssueProvenance).toEqual({
            releaseSha: "0123456789abcdef0123456789abcdef01234567",
            runtimeName: "cloudflare-hosted-runner",
          });
          const pending = await readHostedSystemMailboxState(vaultRoot);
          const selected = pending.pending.find(
            (item) => item.itemId === delegated.itemId,
          ) ?? null;
          if (!selected) {
            return { progressed: false };
          }
          assert.equal(
            pending.pending.some((item) => item.itemId === device?.itemId),
            device !== null,
          );
          delegatedConsumptionCount += 1;
          await removeHostedSystemMailboxPendingItem({
            itemId: selected.itemId,
            vaultRoot,
          });
          return {
            checkpointReason: "assistant_runtime_commit" as const,
            progressed: true,
          };
        },
        runtimeIssueProvenance: {
          releaseSha: "0123456789abcdef0123456789abcdef01234567",
          runtimeName: "cloudflare-hosted-runner",
        },
        vaultRoot,
      });

      const finalPending = (await readHostedSystemMailboxState(vaultRoot)).pending;
      expect(finalPending).toEqual(device ? [device] : []);
      expect(assistantPhaseCalls).toBe(1);
      expect(delegatedConsumptionCount).toBe(1);
      if (device) {
        assert.equal(result.status, "scheduled");
        assert.equal(result.nextWakeAt, TEST_NOW);
        assert.equal(result.nextWakeReason, "device-sync.reconcile");
      } else {
        assert.equal(result.status, "idle");
      }
    } finally {
      vi.useRealTimers();
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });
});

function createBaseItem(input: {
  itemId: string;
  mailboxDedupeKey: string;
  mailboxLaneSeq: string;
  routeAction: HostedSystemMailboxPendingItem["routeAction"];
  wake: HostedSystemMailboxPendingItem["wake"];
}): HostedSystemMailboxPendingItem {
  return {
    attemptCount: 0,
    itemId: input.itemId,
    lastAttemptAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    mailboxDedupeKey: input.mailboxDedupeKey,
    mailboxLaneSeq: input.mailboxLaneSeq,
    nextAttemptAt: null,
    occurredAt: input.wake.occurredAt,
    postCheckpointRecord: null,
    preferenceCausalSeq: null,
    requestId: null,
    routeAction: input.routeAction,
    status: "pending",
    wake: input.wake,
  };
}

function createDeviceItem(mailboxLaneSeq: string): HostedSystemMailboxPendingItem {
  const eventId = `device-sync.wake:synthetic-${mailboxLaneSeq}`;
  return createBaseItem({
    itemId: `device_${mailboxLaneSeq}`,
    mailboxDedupeKey: eventId,
    mailboxLaneSeq,
    routeAction: "run-device-sync-wake",
    wake: {
      eventId,
      kind: "device-sync.wake",
      occurredAt: TEST_NOW,
      reason: "reconcile_due",
      userId: TEST_USER_ID,
    },
  });
}

function createDelegatedAskItem(
  mailboxLaneSeq: string,
  targetKind: "consented_member" | "current_sender_personal",
): HostedSystemMailboxPendingItem {
  const eventId = `assistant.ask.requested:synthetic-${mailboxLaneSeq}`;
  const ask: HostedExecutionAssistantAskRequestedPayload =
    targetKind === "consented_member"
      ? {
          expiresAt: "2036-08-22T19:10:00.000Z",
          origin: {
            assistantInputId: `ain_${"a".repeat(32)}`,
            kind: "accepted_input",
            sessionId: "session_synthetic_delegated_owner",
          },
          question: "What synthetic fact should be shared?",
          target: {
            grantId: "grant_synthetic",
            kind: targetKind,
            membershipId: "membership_synthetic",
            permissionDigest: "d".repeat(64),
          },
        }
      : {
          expiresAt: "2036-08-22T19:10:00.000Z",
          origin: {
            assistantInputId: `ain_${"a".repeat(32)}`,
            kind: "accepted_input",
            sessionId: "session_synthetic_delegated_owner",
          },
          question: "What synthetic fact should be shared?",
          resultDestination: { kind: "origin_context" },
          target: {
            groupRuntimeMemberId: "member_group_synthetic",
            kind: targetKind,
            permissionDigest: "d".repeat(64),
          },
        };
  return createBaseItem({
    itemId: `ask_${targetKind}_${mailboxLaneSeq}`,
    mailboxDedupeKey: eventId,
    mailboxLaneSeq,
    routeAction: "run-assistant-ask",
    wake: buildHostedExecutionAssistantAskRequestedWake({
      ask,
      eventId,
      memberId: TEST_USER_ID,
      occurredAt: TEST_NOW,
    }),
  });
}

function createPlatform(
  snapshotRef: HostedWorkspaceSnapshotV2Ref,
): HostedRuntimePlatform {
  return {
    artifactStore: {
      async get() {
        return null;
      },
      async put() {},
    },
    effectsPort: createEffectsPort(),
    mailboxPort: createMailboxPort(),
    providerFetch: vi.fn<typeof fetch>(async () => Response.json({ ok: true })),
    workspaceSnapshotPort: {
      async abortSnapshotSession() {
        throw new Error("Delegated owner test should not abort snapshots.");
      },
      async completeSnapshotSession() {
        throw new Error("Delegated owner test should not complete snapshots.");
      },
      async putSnapshotObjectDirect() {
        throw new Error("Delegated owner test should not upload snapshots.");
      },
      async restoreWorkspaceSnapshot() {},
      async startSnapshotSession() {
        throw new Error("Delegated owner test should not start snapshots.");
      },
    },
    workspacePort: {
      async read(): Promise<HostedWorkspaceReadResponse> {
        return {
          fetchedAt: TEST_NOW,
          workspace: createWorkspaceState({ snapshotRef }),
        };
      },
      async checkpoint(request): Promise<HostedWorkspaceCheckpointResponse> {
        return {
          checkpointed: true,
          workspace: createWorkspaceState({
            checkpointedAt: TEST_NOW,
            nextWakeAt: request.nextWakeAt ?? null,
            nextWakeReason: request.nextWakeReason ?? null,
            redactedStatus: request.redactedStatus ?? null,
            snapshotRef: request.snapshotRef,
            version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
          }),
        };
      },
    },
  };
}

function createWorkspaceSnapshotV2Ref(): HostedWorkspaceSnapshotV2Ref {
  const snapshotId = "snapshot-delegated-foreground-owner";
  const objectKey =
    `users/${TEST_USER_ID}/workspace-snapshots/${snapshotId}.snapshot.enc`;
  return {
    archive: {
      compression: HOSTED_WORKSPACE_SNAPSHOT_COMPRESSION,
      encryptedByteSize: 1,
      encryptedObjectSha256: "1".repeat(64),
      fileCount: 1,
      format: "tar",
      plaintextArchiveSha256: "2".repeat(64),
      totalPlainBytes: 1,
    },
    createdAt: TEST_NOW,
    encryption: {
      aad: {
        objectKey,
        purpose: HOSTED_WORKSPACE_SNAPSHOT_V2_AAD_PURPOSE,
        schema: HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA,
        snapshotId,
        userId: TEST_USER_ID,
      },
      ivBase64: "AAAAAAAAAAAAAAAA",
      rootKeyId: "synthetic-root-key",
      scheme: HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME,
      wrappedDataKey: "synthetic-wrapped-data-key",
    },
    objectKey,
    schema: HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA,
    snapshotId,
    upload: HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
    userId: TEST_USER_ID,
  };
}

function createMailboxPort(): HostedRuntimeMailboxPort {
  return {
    async fetch(request: HostedMailboxFetchRequest): Promise<HostedMailboxFetchResponse> {
      return {
        fetchedAt: TEST_NOW,
        items: [],
        maxSeqByLane: request.lanes.map((lane) => ({
          lane: lane.lane,
          maxSeq: lane.importedSeq,
        })),
        userId: TEST_USER_ID,
      };
    },
    async fetchPayload(
      _request: HostedMailboxPayloadFetchRequest,
    ): Promise<HostedMailboxPayloadFetchResponse> {
      throw new Error("Delegated owner test should not fetch mailbox payloads.");
    },
  };
}

function createEffectsPort(): HostedRuntimeEffectsPort {
  return {
    async readRawEmailMessage() {
      return null;
    },
    async sendEmail() {
      return undefined;
    },
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
