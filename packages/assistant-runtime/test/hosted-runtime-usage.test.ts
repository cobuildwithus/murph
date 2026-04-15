import assert from "node:assert/strict";

import { test, vi } from "vitest";

import {
  ASSISTANT_USAGE_SCHEMA,
  createAssistantUsageId,
  listPendingAssistantUsageRecords,
  writePendingAssistantUsageRecord,
} from "@murphai/runtime-state/node";

import { exportHostedPendingAssistantUsage } from "../src/hosted-runtime/usage.ts";
import { createHostedRuntimeWorkspace } from "./hosted-runtime-test-helpers.ts";

async function writePendingRecord(vaultRoot: string, turnId: string) {
  const usageId = createAssistantUsageId({
    attemptCount: 1,
    turnId,
  });

  await writePendingAssistantUsageRecord({
    record: {
      apiKeyEnv: null,
      attemptCount: 1,
      baseUrl: null,
      cacheWriteTokens: null,
      cachedInputTokens: null,
      credentialSource: "platform",
      inputTokens: 10,
      memberId: "member_123",
      occurredAt: "2026-04-07T00:00:00.000Z",
      outputTokens: 5,
      provider: "openai-compatible",
      providerName: "example",
      reasoningTokens: null,
      requestedModel: "gpt-5.4-mini",
      routeId: "primary",
      schema: ASSISTANT_USAGE_SCHEMA,
      servedModel: "gpt-5.4-mini",
      sessionId: "asst_123",
      totalTokens: 15,
      turnId,
      usageId,
    },
    vault: vaultRoot,
  });

  return usageId;
}

function readUsageId(record: object | undefined): string | null {
  if (!record) {
    return null;
  }

  const usageId = Reflect.get(record, "usageId");
  return typeof usageId === "string" ? usageId : null;
}

test("hosted usage export retries failed batches one record at a time and warns", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace("hosted-runtime-usage-");

  try {
    const firstUsageId = await writePendingRecord(vaultRoot, "turn_retry_1");
    const secondUsageId = await writePendingRecord(vaultRoot, "turn_retry_2");
    let attempt = 0;

    const result = await exportHostedPendingAssistantUsage({
      usageExportPort: {
        async recordUsage(usage) {
          attempt += 1;

          if (attempt === 1) {
            throw new Error("upstream unavailable");
          }

          return {
            recorded: 1,
            usageIds: (() => {
              const usageId = readUsageId(usage[0]);
              return usageId ? [usageId] : [];
            })(),
          };
        },
      },
      vaultRoot,
    });

    assert.deepEqual(result, {
      exported: 2,
      failed: 0,
      pending: 0,
    });
    assert.equal(attempt, 3);
    const remaining = await listPendingAssistantUsageRecords({
      vault: vaultRoot,
    });
    assert.deepEqual(remaining, []);
    assert.equal(warn.mock.calls.length, 1);
    assert.match(String(warn.mock.calls[0]?.[0]), /retrying each record individually/u);
    assert.ok([firstUsageId, secondUsageId]);
  } finally {
    warn.mockRestore();
    await cleanup();
  }
});

test("hosted usage export leaves unacknowledged records pending and warns", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace("hosted-runtime-usage-");

  try {
    const firstUsageId = await writePendingRecord(vaultRoot, "turn_partial_1");
    const secondUsageId = await writePendingRecord(vaultRoot, "turn_partial_2");

    const result = await exportHostedPendingAssistantUsage({
      usageExportPort: {
        async recordUsage() {
          return {
            recorded: 1,
            usageIds: [firstUsageId, "unknown_usage_id"],
          };
        },
      },
      vaultRoot,
    });

    assert.deepEqual(result, {
      exported: 1,
      failed: 1,
      pending: 1,
    });
    const remaining = await listPendingAssistantUsageRecords({
      vault: vaultRoot,
    });
    assert.deepEqual(
      remaining.map((record) => record.usageId),
      [secondUsageId],
    );
    assert.equal(warn.mock.calls.length, 1);
    assert.match(String(warn.mock.calls[0]?.[0]), /leaving the remainder pending/u);
  } finally {
    warn.mockRestore();
    await cleanup();
  }
});
