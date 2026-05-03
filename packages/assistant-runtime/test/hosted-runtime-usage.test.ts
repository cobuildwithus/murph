import assert from "node:assert/strict";
import { stat, writeFile } from "node:fs/promises";

import { test, vi } from "vitest";

import {
  ASSISTANT_USAGE_SCHEMA,
  createAssistantUsageId,
  listPendingAssistantRuntimeIssueRecords,
  listPendingAssistantUsageRecords,
  resolveAssistantStatePaths,
  resolvePendingAssistantUsagePath,
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
      featureKey: null,
      gatewayTags: [],
      inputTokens: 10,
      memberId: "member_123",
      occurredAt: "2026-04-07T00:00:00.000Z",
      outputTokens: 5,
      provider: "codex-cli",
      providerName: "Vercel AI Gateway",
      providerRequestId: null,
      rawUsageJson: null,
      rawUsageJsonHash: null,
      reasoningTokens: null,
      reportingUserId: null,
      requestedModel: "gpt-5.5",
      routeId: "primary",
      schema: ASSISTANT_USAGE_SCHEMA,
      servedModel: "gpt-5.5",
      sessionId: "asst_123",
      stripeMeterSource: "murph",
      surface: null,
      totalTokens: 15,
      triggerKind: null,
      turnId,
      usageId,
      usageExtractionSourcePath: null,
      usageExtractionVersion: "legacy",
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
      invalid: 0,
      invalidIssueRecorded: false,
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
            recorded: 3,
            usageIds: [firstUsageId, firstUsageId, "unknown_usage_id"],
          };
        },
      },
      vaultRoot,
    });

    assert.deepEqual(result, {
      exported: 1,
      failed: 1,
      invalid: 0,
      invalidIssueRecorded: false,
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

test("hosted usage export skips malformed pending records and still exports valid ones", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace("hosted-runtime-usage-");

  try {
    const validUsageId = await writePendingRecord(vaultRoot, "turn_valid");
    const invalidUsageId = "turn_invalid.unexpected-1";
    const invalidRecordPath = resolvePendingAssistantUsagePath(
      resolveAssistantStatePaths(vaultRoot),
      invalidUsageId,
    );

    await writeFile(
      invalidRecordPath,
      `${JSON.stringify({
        apiKeyEnv: null,
        attemptCount: 1,
        baseUrl: null,
        cacheWriteTokens: null,
        cachedInputTokens: null,
        credentialSource: "platform",
        featureKey: null,
        gatewayTags: [],
        inputTokens: 10,
        memberId: "member_123",
        occurredAt: "2026-04-07T00:00:00.000Z",
        outputTokens: 5,
        provider: "codex-cli",
        providerName: "Vercel AI Gateway",
        reasoningTokens: null,
        reportingUserId: null,
        requestedModel: "gpt-5.5",
        routeId: "primary",
        schema: ASSISTANT_USAGE_SCHEMA,
        servedModel: "gpt-5.5",
        sessionId: "asst_invalid",
        stripeMeterSource: "murph",
        surface: null,
        totalTokens: 15,
        triggerKind: null,
        turnId: "turn_invalid",
        usageId: invalidUsageId,
      })}\n`,
      "utf8",
    );

    const result = await exportHostedPendingAssistantUsage({
      usageExportPort: {
        async recordUsage() {
          return {
            recorded: 1,
            usageIds: [validUsageId],
          };
        },
      },
      vaultRoot,
    });

    assert.deepEqual(result, {
      exported: 1,
      failed: 1,
      invalid: 1,
      invalidIssueRecorded: true,
      pending: 1,
    });
    const issues = await listPendingAssistantRuntimeIssueRecords({
      vault: vaultRoot,
    });
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.component, "hosted.usage_export");
    assert.equal(issues[0]?.errorCode, "pending_usage_invalid");
    assert.deepEqual(issues[0]?.details, {
      invalidPendingRecordCount: 1,
    });
    assert.equal(JSON.stringify(issues).includes(invalidUsageId), false);
    assert.deepEqual(
      await listPendingAssistantUsageRecords({
        skipInvalidRecords: true,
        vault: vaultRoot,
      }),
      [],
    );
    assert.equal((await stat(invalidRecordPath)).isFile(), true);
    assert.equal(warn.mock.calls.length, 1);
    assert.match(
      String(warn.mock.calls[0]?.[0]),
      /Skipping malformed pending assistant usage file/u,
    );
  } finally {
    warn.mockRestore();
    await cleanup();
  }
});
