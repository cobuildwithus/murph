import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
  resolveAssistantStatePaths,
  resolveAssistantUsageCredentialSource,
  resolvePendingAssistantUsagePath,
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
      featureKey: "assistant_reply",
      gatewayTags: ["env:development", "feature:assistant_reply"],
      inputTokens: 120,
      memberId: "member_123",
      occurredAt: "2026-03-29T12:00:01.000Z",
      outputTokens: 45,
      provider: "openai-compatible",
      providerName: "example",
      reasoningTokens: 8,
      reportingUserId: "musr_example",
      requestedModel: "gpt-5.4-mini",
      routeId: "primary",
      schema: ASSISTANT_USAGE_SCHEMA,
      servedModel: "gpt-5.4-mini",
      sessionId: "asst_123",
      stripeMeterSource: "vercel-ai-gateway",
      surface: "assistant",
      totalTokens: 165,
      triggerKind: "manual_ask",
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
    assert.deepEqual(
      JSON.parse(await readFile(
        resolvePendingAssistantUsagePath(resolveAssistantStatePaths(vaultRoot), laterRecord.usageId),
        "utf8",
      )),
      {
        schema: ASSISTANT_USAGE_SCHEMA,
        schemaVersion: 1,
        value: laterRecord,
      },
    );

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

test("assistant usage listing rejects raw pending files unless invalid records are skipped", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "murph-assistant-usage-"));
  const vaultRoot = path.join(parent, "vault");
  const paths = resolveAssistantStatePaths(vaultRoot);
  const invalidFiles: string[] = [];
  const record: AssistantUsageRecord = {
    apiKeyEnv: null,
    attemptCount: 1,
    baseUrl: null,
    cacheWriteTokens: null,
    cachedInputTokens: null,
    credentialSource: "platform",
    featureKey: null,
    gatewayTags: [],
    inputTokens: 10,
    memberId: "member_legacy",
    occurredAt: "2026-03-29T12:00:00.000Z",
    outputTokens: 5,
    provider: "codex-cli",
    providerName: null,
    reasoningTokens: null,
    reportingUserId: null,
    requestedModel: null,
    routeId: null,
    schema: ASSISTANT_USAGE_SCHEMA,
    servedModel: null,
    sessionId: "asst_legacy",
    stripeMeterSource: "murph",
    surface: null,
    totalTokens: 15,
    triggerKind: null,
    turnId: "turn_legacy",
    usageId: createAssistantUsageId({
      attemptCount: 1,
      turnId: "turn_legacy",
    }),
  };

  try {
    await mkdir(paths.usagePendingDirectory, { recursive: true });
    await writeFile(
      resolvePendingAssistantUsagePath(paths, record.usageId),
      `${JSON.stringify(record)}\n`,
      "utf8",
    );

    assert.deepEqual(
      await listPendingAssistantUsageRecords({
        onInvalidRecord: ({ fileName }) => {
          invalidFiles.push(fileName);
        },
        paths,
        skipInvalidRecords: true,
      }),
      [],
    );
    assert.deepEqual(invalidFiles, [
      path.basename(resolvePendingAssistantUsagePath(paths, record.usageId)),
    ]);

    await assert.rejects(
      () => listPendingAssistantUsageRecords({
        paths,
      }),
      /pending assistant usage record must be a versioned murph\.assistant-usage\.v1 envelope/u,
    );
  } finally {
    await rm(parent, { force: true, recursive: true });
  }
});

test("assistant usage listing skips forward-versioned pending files when requested", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "murph-assistant-usage-"));
  const vaultRoot = path.join(parent, "vault");
  const paths = resolveAssistantStatePaths(vaultRoot);
  const usageId = createAssistantUsageId({
    attemptCount: 1,
    turnId: "turn_forward_version",
  });
  const invalidFiles: string[] = [];

  try {
    await mkdir(paths.usagePendingDirectory, { recursive: true });
    await writeFile(
      resolvePendingAssistantUsagePath(paths, usageId),
      `${JSON.stringify({
        schema: ASSISTANT_USAGE_SCHEMA,
        schemaVersion: 2,
        value: {
          apiKeyEnv: null,
          attemptCount: 1,
          baseUrl: null,
          cacheWriteTokens: null,
          cachedInputTokens: null,
          credentialSource: "platform",
          featureKey: null,
          gatewayTags: [],
          inputTokens: 10,
          memberId: "member_forward",
          occurredAt: "2026-03-29T12:00:00.000Z",
          outputTokens: 5,
          provider: "codex-cli",
          providerName: null,
          reasoningTokens: null,
          reportingUserId: null,
          requestedModel: null,
          routeId: null,
          schema: ASSISTANT_USAGE_SCHEMA,
          servedModel: null,
          sessionId: "asst_forward",
          stripeMeterSource: "murph",
          surface: null,
          totalTokens: 15,
          triggerKind: null,
          turnId: "turn_forward_version",
          usageId,
        },
      })}\n`,
      "utf8",
    );

    assert.deepEqual(
      await listPendingAssistantUsageRecords({
        onInvalidRecord: ({ fileName }) => {
          invalidFiles.push(fileName);
        },
        paths,
        skipInvalidRecords: true,
      }),
      [],
    );
    assert.deepEqual(invalidFiles, [path.basename(resolvePendingAssistantUsagePath(paths, usageId))]);
  } finally {
    await rm(parent, { force: true, recursive: true });
  }
});

test("assistant usage listing fails closed on forward-versioned pending files by default", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "murph-assistant-usage-"));
  const vaultRoot = path.join(parent, "vault");
  const paths = resolveAssistantStatePaths(vaultRoot);
  const usageId = createAssistantUsageId({
    attemptCount: 1,
    turnId: "turn_forward_version_strict",
  });

  try {
    await mkdir(paths.usagePendingDirectory, { recursive: true });
    await writeFile(
      resolvePendingAssistantUsagePath(paths, usageId),
      `${JSON.stringify({
        schema: ASSISTANT_USAGE_SCHEMA,
        schemaVersion: 2,
        value: {
          apiKeyEnv: null,
          attemptCount: 1,
          baseUrl: null,
          cacheWriteTokens: null,
          cachedInputTokens: null,
          credentialSource: "platform",
          featureKey: null,
          gatewayTags: [],
          inputTokens: 10,
          memberId: "member_forward_strict",
          occurredAt: "2026-03-29T12:00:00.000Z",
          outputTokens: 5,
          provider: "codex-cli",
          providerName: null,
          reasoningTokens: null,
          reportingUserId: null,
          requestedModel: null,
          routeId: null,
          schema: ASSISTANT_USAGE_SCHEMA,
          servedModel: null,
          sessionId: "asst_forward_strict",
          stripeMeterSource: "murph",
          surface: null,
          totalTokens: 15,
          triggerKind: null,
          turnId: "turn_forward_version_strict",
          usageId,
        },
      })}\n`,
      "utf8",
    );

    await assert.rejects(
      () => listPendingAssistantUsageRecords({
        paths,
      }),
      /pending assistant usage record schemaVersion must be 1\./u,
    );
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
      featureKey: null,
      gatewayTags: [],
      inputTokens: 10,
      memberId: null,
      occurredAt: "2026-03-29T12:00:00.000Z",
      outputTokens: 5,
      provider: "codex-cli",
      providerName: null,
      reasoningTokens: null,
      reportingUserId: null,
      requestedModel: null,
      routeId: null,
      schema: ASSISTANT_USAGE_SCHEMA,
      servedModel: null,
      sessionId: "asst_123",
      stripeMeterSource: "murph",
      surface: null,
      totalTokens: null,
      triggerKind: null,
      turnId: "turn_123",
      usageId: "turn_123.attempt-1",
    },
  );
});

test("assistant usage parsing rejects non-canonical usage ids", () => {
  assert.throws(
    () =>
      parseAssistantUsageRecord({
        attemptCount: 1,
        credentialSource: "platform",
        occurredAt: "2026-03-29T12:00:00.000Z",
        provider: "codex-cli",
        schema: ASSISTANT_USAGE_SCHEMA,
        sessionId: "asst_123",
        turnId: "turn_123",
        usageId: "turn_123.unexpected-1",
      }),
    /usageId must match the canonical turnId\/attemptCount-derived value turn_123\.attempt-1/u,
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
        stripeMeterSource: "invalid",
        occurredAt: "2026-03-29T12:00:00.000Z",
        provider: "codex-cli",
        schema: "murph.assistant-usage.v0",
        sessionId: "asst_123",
        turnId: "turn_123",
        usageId: "turn_123.attempt-1",
      }),
    /credentialSource must be 'member', 'platform', or 'unknown'/u,
  );

  assert.throws(
    () =>
      parseAssistantUsageRecord({
        attemptCount: 1,
        credentialSource: "platform",
        stripeMeterSource: "invalid",
        occurredAt: "2026-03-29T12:00:00.000Z",
        provider: "codex-cli",
        schema: ASSISTANT_USAGE_SCHEMA,
        sessionId: "asst_123",
        turnId: "turn_123",
        usageId: "turn_123.attempt-1",
      }),
    /stripeMeterSource must be 'murph' or 'vercel-ai-gateway' when provided/u,
  );
});

test("assistant usage credential source resolves against the hosted user env snapshot", () => {
  assert.equal(
    resolveAssistantUsageCredentialSource({
      apiKeyEnv: "OPENAI_API_KEY",
      effectiveEnv: {
        OPENAI_API_KEY: "sk-user",
      },
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
      apiKeyEnv: null,
      headers: {
        "X-Api-Key": "member-header-secret",
      },
      provider: "openai-compatible",
      userEnvKeys: [],
    }),
    "member",
  );
  assert.equal(
    resolveAssistantUsageCredentialSource({
      apiKeyEnv: "PLATFORM_API_KEY",
      headers: {
        "X-Trace-Id": "Bearer member-header-secret-1234",
      },
      provider: "openai-compatible",
      userEnvKeys: [],
    }),
    "member",
  );
  assert.equal(
    resolveAssistantUsageCredentialSource({
      apiKeyEnv: null,
      headers: {
        "X-Trace-Id": "trace-123",
      },
      provider: "openai-compatible",
      userEnvKeys: [],
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

test("assistant usage credential source treats blank effective env overrides as non-member keys", () => {
  assert.equal(
    resolveAssistantUsageCredentialSource({
      apiKeyEnv: "OPENAI_API_KEY",
      effectiveEnv: {
        OPENAI_API_KEY: "   ",
      },
      provider: "openai-compatible",
      userEnvKeys: ["OPENAI_API_KEY"],
    }),
    "platform",
  );
  assert.equal(
    resolveAssistantUsageCredentialSource({
      apiKeyEnv: null,
      effectiveEnv: {
        OPENAI_API_KEY: " ",
      },
      provider: "codex-cli",
      userEnvKeys: ["OPENAI_API_KEY"],
    }),
    "platform",
  );
  assert.equal(
    resolveAssistantUsageCredentialSource({
      apiKeyEnv: "OPENAI_API_KEY",
      provider: "openai-compatible",
      userEnvKeys: ["OPENAI_API_KEY"],
    }),
    "member",
  );
});
