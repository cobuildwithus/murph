import assert from "node:assert/strict";

import { test } from "vitest";

import {
  ASSISTANT_USAGE_SCHEMA,
  createAssistantUsageId,
  listPendingAssistantUsageRecords,
  resolveAssistantUsageCredentialSource,
  writePendingAssistantUsageRecord,
} from "@murphai/runtime-state/node";

import { normalizeHostedAssistantRuntimeConfig } from "../src/hosted-runtime/environment.ts";
import {
  parseHostedRuntimeIssueRecordResponse,
  parseHostedRuntimeUsageRecordResponse,
} from "../src/hosted-runtime/platform.ts";
import { exportHostedPendingAssistantUsage } from "../src/hosted-runtime/usage.ts";
import type { HostedRuntimePlatform } from "../src/hosted-runtime/platform.ts";
import { createHostedRuntimeWorkspace } from "./hosted-runtime-test-helpers.ts";

test("hosted runtime config fails closed when the platform is not injected", () => {
  assert.throws(
    () => normalizeHostedAssistantRuntimeConfig(undefined, null),
    /platform must be injected/u,
  );
});

test("hosted runtime usage parser accepts a non-negative integer count and trims usage ids", () => {
  assert.deepEqual(
    parseHostedRuntimeUsageRecordResponse({
      recorded: 2,
      usageIds: [" usage_1 ", "usage_2"],
    }),
    {
      recorded: 2,
      usageIds: ["usage_1", "usage_2"],
    },
  );
});

test("hosted runtime usage parser rejects non-object payloads", () => {
  assert.throws(
    () => parseHostedRuntimeUsageRecordResponse(null),
    /must be an object/u,
  );
});

test("hosted runtime usage parser rejects fractional recorded counts", () => {
  assert.throws(
    () => parseHostedRuntimeUsageRecordResponse({
      recorded: 1.5,
      usageIds: [],
    }),
    /recorded must be a non-negative integer/u,
  );
});

test("hosted runtime usage parser rejects non-string or blank usage ids", () => {
  assert.throws(
    () => parseHostedRuntimeUsageRecordResponse({
      recorded: 1,
      usageIds: ["usage_1", 2],
    }),
    /usageIds must be a string array of non-empty values/u,
  );
  assert.throws(
    () => parseHostedRuntimeUsageRecordResponse({
      recorded: 1,
      usageIds: ["   "],
    }),
    /usageIds must be a string array of non-empty values/u,
  );
});

test("hosted runtime usage parser rejects recorded counts that do not match usage ids", () => {
  assert.throws(
    () => parseHostedRuntimeUsageRecordResponse({
      recorded: 1,
      usageIds: ["usage_1", "usage_2"],
    }),
    /recorded must equal usageIds\.length/u,
  );
});

test("hosted runtime treats blank configured user API key overrides as platform-funded execution", () => {
  const platform = {
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
  } satisfies HostedRuntimePlatform;
  const normalized = normalizeHostedAssistantRuntimeConfig(
    {
      forwardedEnv: {
        HOSTED_ASSISTANT_API_KEY_ENV: "OPENAI_API_KEY",
      },
      userEnv: {
        OPENAI_API_KEY: "   ",
      },
    },
    platform,
  );

  assert.deepEqual(normalized.userEnv, {});
  assert.equal(
    resolveAssistantUsageCredentialSource({
      apiKeyEnv: "OPENAI_API_KEY",
      provider: "codex-cli",
      userEnvKeys: Object.keys(normalized.userEnv),
    }),
    "platform",
  );
});

test("hosted runtime issue parser accepts a non-negative integer count and trims issue ids", () => {
  assert.deepEqual(
    parseHostedRuntimeIssueRecordResponse({
      issueIds: [" issue_1 ", "issue_2"],
      recorded: 2,
    }),
    {
      issueIds: ["issue_1", "issue_2"],
      recorded: 2,
    },
  );
});

test("hosted runtime issue parser rejects non-array issue ids", () => {
  assert.throws(
    () => parseHostedRuntimeIssueRecordResponse({
      issueIds: "issue_1",
      recorded: 1,
    }),
    /issueIds must be a string array of non-empty values/u,
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
        featureKey: null,
        gatewayTags: [],
        inputTokens: 10,
        memberId: "member_123",
        occurredAt: "2026-04-07T00:00:00.000Z",
        outputTokens: 5,
        provider: "codex-cli",
        providerName: "OpenAI",
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
        turnId: "turn_missing_port",
        usageId,
        usageExtractionSourcePath: null,
        usageExtractionVersion: "legacy",
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
        invalid: 0,
        invalidIssueRecorded: false,
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
          featureKey: null,
          gatewayTags: [],
          inputTokens: 10,
          memberId: "member_123",
          occurredAt: "2026-04-07T00:00:00.000Z",
          outputTokens: 5,
          provider: "codex-cli",
          providerName: "OpenAI",
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
        invalid: 0,
        invalidIssueRecorded: false,
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
