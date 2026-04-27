import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { buildHostedExecutionRuntimeTimerWake } from "@murphai/hosted-execution";
import { resolveAssistantStatePaths } from "@murphai/runtime-state/node";
import { beforeEach, expect, test, vi } from "vitest";

import { createHostedRuntimeWorkspace } from "./hosted-runtime-test-helpers.ts";

const mocks = vi.hoisted(() => ({
  deleteHostedLinqMessages: vi.fn(),
}));

vi.mock("../src/hosted-runtime/message-cleanup.ts", () => ({
  deleteHostedLinqMessages: mocks.deleteHostedLinqMessages,
}));

import {
  drainHostedProviderCleanupAfterCommit,
  readHostedProviderCleanupCheckpoint,
  recordHostedProviderCleanupBeforeCommit,
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.deleteHostedLinqMessages.mockResolvedValue(undefined);
});

test("hosted provider cleanup records checkpoint state and unique Linq ids in runtime state", async () => {
  const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace("hosted-provider-cleanup-");

  try {
    await recordHostedProviderCleanupBeforeCommit({
      linqMessageIds: ["linq_inbound_1", "linq_inbound_1", " "],
      checkpoint,
      vaultRoot,
    });

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

test("hosted provider cleanup deletes persisted and delivered Linq ids after commit", async () => {
  const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace("hosted-provider-cleanup-");

  try {
    await recordHostedProviderCleanupBeforeCommit({
      linqMessageIds: ["linq_inbound_1"],
      checkpoint,
      vaultRoot,
    });

    const result = await drainHostedProviderCleanupAfterCommit({
      assistantDeliveryOutcomes: [
        {
          deliveryChannel: "linq",
          deliveryErrorCode: null,
          deliveryErrorMessage: null,
          deliveryStatus: "sent",
          effectFingerprint: "fingerprint_1",
          effectId: "effect_1",
          journalMethod: null,
          journalStatus: null,
          providerMessageId: "linq_outbound_1",
          providerMessageIds: ["linq_outbound_1", "linq_outbound_2"],
          providerThreadId: "chat_1",
          retryable: false,
          target: "chat_1",
          targetKind: "thread",
        },
      ],
      env: {
        LINQ_API_TOKEN: "test-token",
      },
      checkpoint,
      vaultRoot,
      wake,
    });

    assert.deepEqual(result, {
      attemptedLinqMessageCount: 3,
      deletedLinqMessageCount: 3,
      failedLinqMessageCount: 0,
      nextWakeAt: null,
    });
    expect(mocks.deleteHostedLinqMessages).toHaveBeenCalledWith({
      env: {
        LINQ_API_TOKEN: "test-token",
      },
      messageIds: ["linq_inbound_1", "linq_outbound_1", "linq_outbound_2"],
    });
    await assert.rejects(readHostedProviderCleanupFile(vaultRoot), {
      code: "ENOENT",
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
    mocks.deleteHostedLinqMessages.mockRejectedValueOnce(new Error("delete unavailable"));
    await recordHostedProviderCleanupBeforeCommit({
      linqMessageIds: ["linq_inbound_1"],
      checkpoint,
      vaultRoot,
    });

    const result = await drainHostedProviderCleanupAfterCommit({
      assistantDeliveryOutcomes: [],
      env: {},
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
  } finally {
    vi.useRealTimers();
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
