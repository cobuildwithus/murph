import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { initializeVault } from "@murphai/core";
import {
  HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
  HOSTED_MAILBOX_PAYLOAD_SCHEMA,
} from "@murphai/hosted-execution/runtime-control";
import type {
  HostedMailboxFetchRequest,
  HostedMailboxFetchResponse,
  HostedMailboxItem,
  HostedMailboxPayloadFetchRequest,
  HostedMailboxPayloadFetchResponse,
  HostedWorkspaceCheckpointResponse,
  HostedWorkspaceReadResponse,
  HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import { describe, expect, test, vi } from "vitest";

import {
  runHostedWorkspaceRuntimeJobInProcess,
} from "../src/hosted-runtime.ts";
import type {
  HostedRuntimeMailboxPort,
  HostedRuntimePlatform,
} from "../src/hosted-runtime-contracts.ts";

const TEST_NOW = "2026-04-27T00:00:00.000Z";
const TEST_USER_ID = "member_synthetic_abort_guard";

describe("hosted runtime abort guard", () => {
  test("preserves prototype-backed required mailbox read methods", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-mailbox-guard-"));
    const mailboxItem = createMailboxItem({
      id: "mailbox_item_prototype_mailbox_guard",
      kind: "member.activated",
      lane: "system",
      payloadInlineCiphertext: null,
      payloadRef: "payload_ref_prototype_mailbox_guard",
    });
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const payloadFetchRequests: HostedMailboxPayloadFetchRequest[] = [];
    const importedPayloadSources: string[] = [];

    class PrototypeMailboxPort implements HostedRuntimeMailboxPort {
      readonly #mailboxItem = mailboxItem;
      readonly #userId = TEST_USER_ID;

      async fetch(request: HostedMailboxFetchRequest): Promise<HostedMailboxFetchResponse> {
        fetchRequests.push(request);
        return {
          fetchedAt: TEST_NOW,
          items: [this.#mailboxItem],
          maxSeqByLane: request.lanes.map((lane) => ({
            lane: lane.lane,
            maxSeq: lane.lane === this.#mailboxItem.lane
              ? this.#mailboxItem.laneSeq
              : lane.importedSeq,
          })),
          userId: this.#userId,
        };
      }

      async fetchPayload(
        request: HostedMailboxPayloadFetchRequest,
      ): Promise<HostedMailboxPayloadFetchResponse> {
        payloadFetchRequests.push(request);
        return {
          fetchedAt: TEST_NOW,
          payload: {
            createdAt: TEST_NOW,
            mailboxItemId: this.#mailboxItem.id,
            payloadCiphertext: "ciphertext_synthetic_sidecar",
            payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
            userId: this.#userId,
          },
        };
      }
    }

    try {
      await initializeVault({
        createdAt: new Date(TEST_NOW),
        timezone: "UTC",
        title: "Hosted Runtime Prototype Mailbox Test Vault",
        vaultRoot,
      });

      const result = await runHostedWorkspaceRuntimeJobInProcess({
        request: {
          attemptId: "attempt_synthetic_prototype_mailbox_guard",
          idleCheckpointDelayMs: 1,
          leaseGeneration: "1",
          userId: TEST_USER_ID,
          workspace: createWorkspaceState(),
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
            snapshotRef: {
              hash: "c".repeat(64),
              key: "users/bundles/member-synthetic/prototype-mailbox-guard.bundle.json",
              size: 512,
              updatedAt: TEST_NOW,
            },
          };
        },
        async importItem(item) {
          importedPayloadSources.push(item.payload.source);
          assert.equal(item.payload.payloadCiphertext, "ciphertext_synthetic_sidecar");
          return {
            assistantInputId: "ain_prototype_mailbox_guard",
            status: "imported",
          };
        },
        platform: createPlatform(vi.fn<typeof fetch>(), new PrototypeMailboxPort()),
        async runAssistantPhase() {
          return {
            progressed: false,
          };
        },
        vaultRoot,
      });

      assert.equal(result.status, "idle");
      assert.equal(fetchRequests.length > 0, true);
      assert.deepEqual(
        payloadFetchRequests.map((request) => request.payloadRef),
        ["payload_ref_prototype_mailbox_guard"],
      );
      assert.deepEqual(importedPayloadSources, ["sidecar"]);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("blocks providerFetch after the host signal aborts", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-abort-guard-"));
    const hostAbortController = new AbortController();
    const hostAbortReason = new Error("host aborted before provider egress");
    const providerFetch = vi.fn<typeof fetch>(async () => Response.json({ ok: true }));

    try {
      await initializeVault({
        createdAt: new Date(TEST_NOW),
        timezone: "UTC",
        title: "Hosted Runtime Abort Guard Test Vault",
        vaultRoot,
      });

      await expect(runHostedWorkspaceRuntimeJobInProcess({
        request: {
          attemptId: "attempt_synthetic_provider_abort_guard",
          idleCheckpointDelayMs: 1,
          leaseGeneration: "1",
          userId: TEST_USER_ID,
          workspace: createWorkspaceState(),
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
          throw new Error("Abort guard test should not checkpoint.");
        },
        async importItem() {
          throw new Error("Abort guard test should not import mailbox items.");
        },
        platform: createPlatform(providerFetch),
        async runAssistantPhase(input) {
          hostAbortController.abort(hostAbortReason);
          assert.ok(input.platform.providerFetch);
          await input.platform.providerFetch("https://provider.example.test", {
            method: "POST",
          });
          return {
            progressed: false,
          };
        },
        signal: hostAbortController.signal,
        vaultRoot,
      })).rejects.toBe(hostAbortReason);

      expect(providerFetch).not.toHaveBeenCalled();
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });
});

function createPlatform(
  providerFetch: typeof fetch,
  mailboxPort: HostedRuntimeMailboxPort = createDefaultMailboxPort(),
): HostedRuntimePlatform {
  return {
    artifactStore: {
      async get() {
        return null;
      },
      async put() {},
    },
    effectsPort: {
      async readRawEmailMessage() {
        return null;
      },
      async sendEmail() {
        return undefined;
      },
    },
    mailboxPort,
    providerFetch,
    workspacePort: {
      async read(): Promise<HostedWorkspaceReadResponse> {
        return {
          fetchedAt: TEST_NOW,
          workspace: createWorkspaceState(),
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

function createDefaultMailboxPort(): HostedRuntimeMailboxPort {
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
      throw new Error("Abort guard test should not fetch mailbox payloads.");
    },
  };
}

function createMailboxItem(overrides: Partial<HostedMailboxItem> = {}): HostedMailboxItem {
  return {
    createdAt: TEST_NOW,
    dedupeKey: `dedupe_${overrides.id ?? "mailbox_item_abort_guard_001"}`,
    expiresAt: null,
    id: "mailbox_item_abort_guard_001",
    kind: "conversation.message",
    lane: "conversation",
    laneSeq: "1",
    occurredAt: TEST_NOW,
    payloadBytes: 128,
    payloadInlineCiphertext: "ciphertext_synthetic_inline",
    payloadRef: null,
    payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
    updatedAt: TEST_NOW,
    userId: TEST_USER_ID,
    ...overrides,
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
