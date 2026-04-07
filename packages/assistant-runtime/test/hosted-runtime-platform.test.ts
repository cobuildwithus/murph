import assert from "node:assert/strict";

import { test } from "vitest";

import {
  ASSISTANT_USAGE_SCHEMA,
  createAssistantUsageId,
  listPendingAssistantUsageRecords,
  writePendingAssistantUsageRecord,
} from "@murphai/runtime-state/node";

import { normalizeHostedAssistantRuntimeConfig } from "../src/hosted-runtime/environment.ts";
import { exportHostedPendingAssistantUsage } from "../src/hosted-runtime/usage.ts";
import type { HostedRuntimePlatform } from "../src/hosted-runtime/platform.ts";
import { createHostedRuntimeWorkspace } from "./hosted-runtime-test-helpers.ts";

test("hosted runtime config fails closed when the platform is not injected", () => {
  assert.throws(
    () => normalizeHostedAssistantRuntimeConfig(undefined, null),
    /platform must be injected/u,
  );
});

test("hosted usage export stays non-fatal and leaves records pending when no usage port is injected", async () => {
  const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace("hosted-runtime-platform-");

  try {
    const usageId = createAssistantUsageId({
      attemptCount: 1,
      turnId: "turn_missing_port",
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
        providerMetadataJson: null,
        providerName: "example",
        providerRequestId: "req_123",
        providerSessionId: null,
        rawUsageJson: null,
        reasoningTokens: null,
        requestedModel: "gpt-5.4-mini",
        routeId: "primary",
        schema: ASSISTANT_USAGE_SCHEMA,
        servedModel: "gpt-5.4-mini",
        sessionId: "asst_123",
        totalTokens: 15,
        turnId: "turn_missing_port",
        usageId,
      },
      vault: vaultRoot,
    });

    assert.deepEqual(
      await exportHostedPendingAssistantUsage({
        usageExportPort: null,
        vaultRoot,
      }),
      {
        exported: 0,
        failed: 0,
        pending: 1,
      },
    );

    const remaining = await listPendingAssistantUsageRecords({
      vault: vaultRoot,
    });
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0]?.usageId, usageId);
  } finally {
    await cleanup();
  }
});

test("hosted usage export deletes only the usage ids acknowledged by the injected usage port", async () => {
  const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace("hosted-runtime-platform-");

  try {
    const firstUsageId = createAssistantUsageId({
      attemptCount: 1,
      turnId: "turn_ack_1",
    });
    const secondUsageId = createAssistantUsageId({
      attemptCount: 1,
      turnId: "turn_ack_2",
    });

    for (const [usageId, turnId] of [
      [firstUsageId, "turn_ack_1"],
      [secondUsageId, "turn_ack_2"],
    ] as const) {
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
          providerMetadataJson: null,
          providerName: "example",
          providerRequestId: `req_${turnId}`,
          providerSessionId: null,
          rawUsageJson: null,
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
    }

    const usageExportPort: NonNullable<HostedRuntimePlatform["usageExportPort"]> = {
      async recordUsage(usage) {
        assert.equal(usage.length, 2);
        return {
          recorded: 1,
          usageIds: [firstUsageId],
        };
      },
    };

    assert.deepEqual(
      await exportHostedPendingAssistantUsage({
        usageExportPort,
        vaultRoot,
      }),
      {
        exported: 1,
        failed: 1,
        pending: 1,
      },
    );

    const remaining = await listPendingAssistantUsageRecords({
      vault: vaultRoot,
    });
    assert.deepEqual(
      remaining.map((record) => record.usageId),
      [secondUsageId],
    );
  } finally {
    await cleanup();
  }
});
