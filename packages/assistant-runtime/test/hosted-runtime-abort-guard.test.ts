import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { initializeVault } from "@murphai/core";
import type {
  HostedMailboxFetchRequest,
  HostedMailboxFetchResponse,
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
  HostedRuntimePlatform,
} from "../src/hosted-runtime-contracts.ts";

const TEST_NOW = "2026-04-27T00:00:00.000Z";
const TEST_USER_ID = "member_synthetic_abort_guard";

describe("hosted runtime abort guard", () => {
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

function createPlatform(providerFetch: typeof fetch): HostedRuntimePlatform {
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
    mailboxPort: {
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
    },
    providerFetch,
    workspacePort: {
      async read(): Promise<HostedWorkspaceReadResponse> {
        return {
          fetchedAt: TEST_NOW,
          workspace: createWorkspaceState(),
        };
      },
      async checkpoint(): Promise<HostedWorkspaceCheckpointResponse> {
        throw new Error("Abort guard test should not checkpoint workspace.");
      },
    },
  };
}

function createWorkspaceState(): HostedWorkspaceState {
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
  };
}
