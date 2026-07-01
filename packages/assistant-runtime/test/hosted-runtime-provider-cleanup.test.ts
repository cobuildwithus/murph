import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.deleteHostedLinqMessages.mockResolvedValue(undefined);
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

test("hosted provider cleanup defers due persisted cleanup until after the idle window", async () => {
  const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace("hosted-provider-cleanup-");

  try {
    await recordHostedProviderCleanupBeforeCommit({
      linqMessageIds: ["linq_inbound_1"],
      checkpoint: {
        nextWakeAt: "2026-07-01T00:08:00.000Z",
      },
      vaultRoot,
    });

    assert.equal(
      await resolveHostedProviderCleanupScheduledWakeAt({
        deferDueOrInvalid: true,
        idleCheckpointDelayMs: 1_000,
        nowMs: Date.parse("2026-07-01T00:09:00.000Z"),
        vaultRoot,
      }),
      "2026-07-01T00:09:02.000Z",
    );
    assert.deepEqual(await readHostedProviderCleanupCheckpoint(vaultRoot), {
      nextWakeAt: "2026-07-01T00:08:00.000Z",
    });
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

test("hosted provider cleanup deletes persisted and delivered Linq ids after commit", async () => {
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
      assertLiveness,
      env: {
        LINQ_API_TOKEN: "test-token",
      },
      fetchImplementation: providerFetch,
      checkpoint,
      vaultRoot,
      wake,
    });

    expect(assertLiveness).toHaveBeenCalledTimes(2);
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
      fetchImplementation: providerFetch,
      messageIds: ["linq_inbound_1", "linq_outbound_1", "linq_outbound_2"],
    });
    await assert.rejects(readHostedProviderCleanupFile(vaultRoot), {
      code: "ENOENT",
    });
  } finally {
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
      assistantDeliveryOutcomes: [],
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
      assistantDeliveryOutcomes: [],
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
      assistantDeliveryOutcomes: [],
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
      assistantDeliveryOutcomes: [],
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
