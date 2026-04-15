import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";

import {
  ASSISTANT_USAGE_SCHEMA,
  type AssistantUsageRecord,
  createAssistantUsageId,
  deletePendingAssistantUsageRecord,
  listPendingAssistantUsageRecords,
  parseAssistantUsageRecord,
  resolveAssistantUsageCredentialSource,
  writePendingAssistantUsageRecord,
} from "../src/node/index.ts";

test("assistant usage ids validate and normalize turn ids before formatting", () => {
  assert.equal(
    createAssistantUsageId({
      attemptCount: 3,
      turnId: " turn_123 ",
    }),
    "turn_123.attempt-3",
  );

  assert.throws(
    () =>
      createAssistantUsageId({
        attemptCount: -1,
        turnId: "turn_123",
      }),
    /attemptCount must be a non-negative integer when provided/u,
  );
});

test("assistant usage records round-trip through pending storage and sort by occurredAt", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "murph-assistant-usage-"));
  const vaultRoot = path.join(parent, "vault");

  try {
    const laterRecord: AssistantUsageRecord = {
      apiKeyEnv: "OPENAI_API_KEY",
      attemptCount: 2,
      baseUrl: "https://api.example.test/v1",
      cacheWriteTokens: 3,
      cachedInputTokens: 5,
      credentialSource: "platform" as const,
      inputTokens: 120,
      memberId: "member_123",
      occurredAt: "2026-03-29T12:00:01.000Z",
      outputTokens: 45,
      provider: "openai-compatible",
      providerName: "example",
      reasoningTokens: 8,
      requestedModel: "gpt-5.4-mini",
      routeId: "primary",
      schema: ASSISTANT_USAGE_SCHEMA,
      servedModel: "gpt-5.4-mini",
      sessionId: "asst_123",
      totalTokens: 165,
      turnId: "turn_123",
      usageId: createAssistantUsageId({
        attemptCount: 2,
        turnId: "turn_123",
      }),
    };
    const earlierRecord: AssistantUsageRecord = {
      ...laterRecord,
      attemptCount: 1,
      occurredAt: "2026-03-29T12:00:00.000Z",
      usageId: createAssistantUsageId({
        attemptCount: 1,
        turnId: "turn_123",
      }),
    };

    await writePendingAssistantUsageRecord({
      record: laterRecord,
      vault: vaultRoot,
    });
    await writePendingAssistantUsageRecord({
      record: earlierRecord,
      vault: vaultRoot,
    });

    const records = await listPendingAssistantUsageRecords({
      vault: vaultRoot,
    });

    assert.deepEqual(records, [earlierRecord, laterRecord]);

    await deletePendingAssistantUsageRecord({
      usageId: earlierRecord.usageId,
      vault: vaultRoot,
    });

    const remaining = await listPendingAssistantUsageRecords({
      vault: vaultRoot,
    });

    assert.deepEqual(remaining, [laterRecord]);
  } finally {
    await rm(parent, { force: true, recursive: true });
  }
});

test("assistant usage parsing preserves a missing totalTokens value", () => {
  assert.deepEqual(
    parseAssistantUsageRecord({
      attemptCount: 1,
      credentialSource: "platform",
      inputTokens: 10,
      occurredAt: "2026-03-29T12:00:00.000Z",
      outputTokens: 5,
      provider: "codex-cli",
      schema: ASSISTANT_USAGE_SCHEMA,
      sessionId: "asst_123",
      turnId: "turn_123",
      usageId: "turn_123.attempt-1",
    }),
    {
      apiKeyEnv: null,
      attemptCount: 1,
      baseUrl: null,
      cacheWriteTokens: null,
      cachedInputTokens: null,
      credentialSource: "platform",
      inputTokens: 10,
      memberId: null,
      occurredAt: "2026-03-29T12:00:00.000Z",
      outputTokens: 5,
      provider: "codex-cli",
      providerName: null,
      reasoningTokens: null,
      requestedModel: null,
      routeId: null,
      schema: ASSISTANT_USAGE_SCHEMA,
      servedModel: null,
      sessionId: "asst_123",
      totalTokens: null,
      turnId: "turn_123",
      usageId: "turn_123.attempt-1",
    },
  );
});

test("listing pending assistant usage records returns an empty array when the directory is absent", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "murph-assistant-usage-"));
  const vaultRoot = path.join(parent, "vault");

  try {
    assert.deepEqual(
      await listPendingAssistantUsageRecords({
        vault: vaultRoot,
      }),
      [],
    );
  } finally {
    await rm(parent, { force: true, recursive: true });
  }
});

test("assistant usage parsing rejects missing credentialSource", () => {
  assert.throws(
    () => parseAssistantUsageRecord({
      attemptCount: 1,
      inputTokens: 10,
      occurredAt: "2026-03-29T12:00:00.000Z",
      outputTokens: 5,
      provider: "codex-cli",
      schema: ASSISTANT_USAGE_SCHEMA,
      sessionId: "asst_123",
      turnId: "turn_123",
      usageId: "turn_123.attempt-1",
    }),
    /credentialSource must be a non-empty string/u,
  );
});

test("assistant usage parsing rejects invalid schema and non-string optional values", () => {
  assert.throws(
    () =>
      parseAssistantUsageRecord({
        apiKeyEnv: 1,
        attemptCount: 1,
        credentialSource: "platform",
        occurredAt: "2026-03-29T12:00:00.000Z",
        provider: "codex-cli",
        schema: ASSISTANT_USAGE_SCHEMA,
        sessionId: "asst_123",
        turnId: "turn_123",
        usageId: "turn_123.attempt-1",
      }),
    /apiKeyEnv must be a string when provided/u,
  );

  assert.throws(
    () =>
      parseAssistantUsageRecord({
        attemptCount: 1,
        credentialSource: "invalid",
        occurredAt: "2026-03-29T12:00:00.000Z",
        provider: "codex-cli",
        schema: "murph.assistant-usage.v0",
        sessionId: "asst_123",
        turnId: "turn_123",
        usageId: "turn_123.attempt-1",
      }),
    /credentialSource must be 'member', 'platform', or 'unknown'/u,
  );
});

test("assistant usage credential source resolves against the hosted user env snapshot", () => {
  assert.equal(
    resolveAssistantUsageCredentialSource({
      apiKeyEnv: "OPENAI_API_KEY",
      provider: "openai-compatible",
      userEnvKeys: ["OPENAI_API_KEY"],
    }),
    "member",
  );
  assert.equal(
    resolveAssistantUsageCredentialSource({
      apiKeyEnv: "OPENAI_API_KEY",
      provider: "openai-compatible",
      userEnvKeys: [],
    }),
    "platform",
  );
  assert.equal(
    resolveAssistantUsageCredentialSource({
      apiKeyEnv: "HF_TOKEN",
      provider: "openai-compatible",
      userEnvKeys: ["HF_TOKEN"],
    }),
    "member",
  );
  assert.equal(
    resolveAssistantUsageCredentialSource({
      apiKeyEnv: null,
      provider: "codex-cli",
      userEnvKeys: ["VENICE_API_KEY"],
    }),
    "unknown",
  );
  assert.equal(
    resolveAssistantUsageCredentialSource({
      apiKeyEnv: null,
      provider: "openai-compatible",
      userEnvKeys: ["VENICE_API_KEY"],
    }),
    "platform",
  );
  assert.equal(
    resolveAssistantUsageCredentialSource({
      apiKeyEnv: " OPENAI_API_KEY ",
      provider: "openai-compatible",
      userEnvKeys: ["OPENAI_API_KEY"],
    }),
    "platform",
  );
  assert.throws(
    () =>
      Reflect.apply(resolveAssistantUsageCredentialSource, undefined, [{
        apiKeyEnv: "OPENAI_API_KEY",
        provider: "openai-compatible",
        userEnvKeys: [123],
      }]),
    /userEnvKey must be a string when provided/u,
  );
});
