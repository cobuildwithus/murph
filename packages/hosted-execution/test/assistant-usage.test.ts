import assert from "node:assert/strict";
import { test } from "vitest";

import {
  ASSISTANT_TURN_PROFILE_MAX_REQUESTS,
  ASSISTANT_TURN_PROFILE_MAX_TOOL_LABEL_LENGTH,
  ASSISTANT_TURN_PROFILE_MAX_TOOLS,
  ASSISTANT_USAGE_SCHEMA,
  createAssistantUsageId,
  createAssistantUsageReportingUserId,
  parseAssistantUsageRecord,
  resolveAssistantUsageCredentialSource,
} from "../src/assistant-usage.ts";

test("assistant usage ids validate and normalize turn ids before formatting", () => {
  assert.equal(
    createAssistantUsageId({
      attemptCount: 3,
      providerRequestOrdinal: 2,
      turnId: " turn_123 ",
    }),
    "turn_123.request-2.attempt-3",
  );

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

test("assistant usage reporting user ids are stable HMAC identifiers", () => {
  assert.equal(
    createAssistantUsageReportingUserId({
      memberId: " member_123 ",
      reportingSecret: " usage-secret ",
    }),
    createAssistantUsageReportingUserId({
      memberId: "member_123",
      reportingSecret: "usage-secret",
    }),
  );
  assert.match(
    createAssistantUsageReportingUserId({
      memberId: "member_123",
      reportingSecret: "usage-secret",
    }) ?? "",
    /^musr_[A-Za-z0-9_-]{32}$/u,
  );
  assert.notEqual(
    createAssistantUsageReportingUserId({
      memberId: "member_123",
      reportingSecret: "usage-secret",
    }),
    createAssistantUsageReportingUserId({
      memberId: "member_456",
      reportingSecret: "usage-secret",
    }),
  );
  assert.equal(
    createAssistantUsageReportingUserId({
      memberId: "member_123",
      reportingSecret: "",
    }),
    null,
  );
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
      providerRequestId: null,
      rawUsageJson: null,
      rawUsageJsonHash: null,
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
      turnProfileJson: null,
      usageId: "turn_123.attempt-1",
      usageExtractionSourcePath: null,
      usageExtractionVersion: "legacy",
    },
  );
});

test("assistant usage parsing validates the turn profile allowlist", () => {
  const profile = {
    modelContextWindow: 258400,
    requestCount: 2,
    requests: [
      { cachedInput: 0, input: 32000, output: 120 },
      { cachedInput: 31872, input: 33000, output: 80 },
    ],
    requestsTruncated: false,
    schema: "murph.assistant-turn-profile.v1",
    tools: [
      { calls: 2, durationMs: 1200, label: "vault-cli samples query", outputChars: 20480 },
    ],
    toolsTruncated: false,
  };
  const baseRecord = {
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
  };

  assert.deepEqual(
    parseAssistantUsageRecord({
      ...baseRecord,
      turnProfileJson: profile,
    }).turnProfileJson,
    profile,
  );

  // Invalid profiles are droppable telemetry: the usage record (and its token
  // accounting) must survive with turnProfileJson nulled, never be rejected.
  const dropped = parseAssistantUsageRecord({
    ...baseRecord,
    turnProfileJson: {
      ...profile,
      tools: [{ calls: 1, durationMs: 0, label: "rm -rf 'member secret'", outputChars: 1 }],
    },
  });
  assert.equal(dropped.turnProfileJson, null);
  assert.equal(dropped.inputTokens, 10);
});

test("assistant usage parsing drops out-of-contract turn profiles without failing the record", () => {
  const validProfile = {
    // A null context window is part of the contract (older runtimes omit it).
    modelContextWindow: null,
    requestCount: 1,
    requests: [{ cachedInput: 0, input: 10, output: 5 }],
    requestsTruncated: false,
    schema: "murph.assistant-turn-profile.v1",
    tools: [],
    toolsTruncated: false,
  };
  const baseRecord = {
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
  };

  assert.deepEqual(
    parseAssistantUsageRecord({
      ...baseRecord,
      turnProfileJson: validProfile,
    }).turnProfileJson,
    validProfile,
  );

  const invalidProfiles: Array<Record<string, unknown>> = [
    // Unknown schema versions never persist under the v1 contract.
    { ...validProfile, schema: "murph.assistant-turn-profile.v0" },
    // Non-integer and non-safe-integer counters are out of contract.
    { ...validProfile, requests: [{ cachedInput: 0, input: 10.5, output: 5 }] },
    { ...validProfile, requests: [{ cachedInput: 0, input: 2 ** 53, output: 5 }] },
    { ...validProfile, modelContextWindow: -1 },
    // Series longer than the producer-side caps mean an untrusted producer.
    {
      ...validProfile,
      requestCount: ASSISTANT_TURN_PROFILE_MAX_REQUESTS + 1,
      requests: Array.from(
        { length: ASSISTANT_TURN_PROFILE_MAX_REQUESTS + 1 },
        () => ({ cachedInput: 0, input: 1, output: 1 }),
      ),
      requestsTruncated: true,
    },
    {
      ...validProfile,
      tools: Array.from(
        { length: ASSISTANT_TURN_PROFILE_MAX_TOOLS + 1 },
        (_, index) => ({ calls: 1, durationMs: 0, label: `tool-${index}`, outputChars: 1 }),
      ),
      toolsTruncated: true,
    },
    // Overlong labels exceed what the producer is allowed to emit.
    {
      ...validProfile,
      tools: [{
        calls: 1,
        durationMs: 0,
        label: "a".repeat(ASSISTANT_TURN_PROFILE_MAX_TOOL_LABEL_LENGTH + 1),
        outputChars: 1,
      }],
    },
  ];

  for (const profile of invalidProfiles) {
    const parsed = parseAssistantUsageRecord({
      ...baseRecord,
      turnProfileJson: profile,
    });
    // Telemetry drops; token accounting must survive untouched.
    assert.equal(parsed.turnProfileJson, null);
    assert.equal(parsed.inputTokens, 10);
    assert.equal(parsed.outputTokens, 5);
  }
});

test("assistant usage parsing allows only token-count raw usage metadata", () => {
  assert.deepEqual(
    parseAssistantUsageRecord({
      attemptCount: 1,
      credentialSource: "platform",
      occurredAt: "2026-03-29T12:00:00.000Z",
      provider: "codex-cli",
      rawUsageJson: {
        input_tokens: 10,
        input_tokens_details: {
          cached_tokens: 2,
          image_tokens: 5,
          text_tokens: 8,
        },
        output_tokens_details: {
          image_tokens: 9,
          reasoning_tokens: 3,
          text_tokens: 1,
        },
        prompt_tokens_details: {
          cached_tokens: 4,
        },
        totalTokens: 15,
      },
      schema: ASSISTANT_USAGE_SCHEMA,
      sessionId: "asst_123",
      turnId: "turn_123",
      usageId: "turn_123.attempt-1",
    }).rawUsageJson,
    {
      input_tokens: 10,
      input_tokens_details: {
        cached_tokens: 2,
        image_tokens: 5,
        text_tokens: 8,
      },
      output_tokens_details: {
        image_tokens: 9,
        reasoning_tokens: 3,
        text_tokens: 1,
      },
      prompt_tokens_details: {
        cached_tokens: 4,
      },
      totalTokens: 15,
    },
  );

  assert.throws(
    () =>
      parseAssistantUsageRecord({
        attemptCount: 1,
        credentialSource: "platform",
        occurredAt: "2026-03-29T12:00:00.000Z",
        provider: "codex-cli",
        rawUsageJson: {
          authorization: "Bearer secret",
          prompt: "hello",
        },
        schema: ASSISTANT_USAGE_SCHEMA,
        sessionId: "asst_123",
        turnId: "turn_123",
        usageId: "turn_123.attempt-1",
      }),
    /rawUsageJson\.authorization is not allowed/u,
  );
});

test("assistant usage parsing rejects Vercel meter source payloads", () => {
  assert.throws(
    () => parseAssistantUsageRecord({
      attemptCount: 1,
      credentialSource: "platform",
      occurredAt: "2026-03-29T12:00:00.000Z",
      provider: "codex-cli",
      schema: ASSISTANT_USAGE_SCHEMA,
      sessionId: "asst_123",
      stripeMeterSource: "external-meter",
      turnId: "turn_123",
      usageId: "turn_123.attempt-1",
    }),
    /stripeMeterSource must be 'murph' when provided/u,
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
    /usageId must match the canonical turnId\/providerRequestOrdinal\/attemptCount-derived value turn_123\.attempt-1/u,
  );
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
    /stripeMeterSource must be 'murph' when provided/u,
  );

  assert.throws(
    () =>
      parseAssistantUsageRecord({
        attemptCount: 1,
        credentialSource: "platform",
        occurredAt: "2026-03-29T12:00:00.000Z",
        provider: "codex-cli",
        providerRequestOutcome: "retried",
        schema: ASSISTANT_USAGE_SCHEMA,
        sessionId: "asst_123",
        turnId: "turn_123",
        usageId: "turn_123.attempt-1",
      }),
    /providerRequestOutcome must be succeeded, failed, aborted, or partial/u,
  );
});

test("assistant usage credential source resolves against the hosted user env snapshot", () => {
  assert.equal(
    resolveAssistantUsageCredentialSource({
      apiKeyEnv: "OPENAI_API_KEY",
      effectiveEnv: {
        OPENAI_API_KEY: "member-api-key",
      },
      provider: "codex-cli",
      userEnvKeys: ["OPENAI_API_KEY"],
    }),
    "member",
  );
  assert.equal(
    resolveAssistantUsageCredentialSource({
      apiKeyEnv: "OPENAI_API_KEY",
      provider: "codex-cli",
      userEnvKeys: [],
    }),
    "platform",
  );
  assert.equal(
    resolveAssistantUsageCredentialSource({
      apiKeyEnv: "CUSTOM_MODEL_API_KEY",
      provider: "codex-cli",
      userEnvKeys: ["CUSTOM_MODEL_API_KEY"],
    }),
    "member",
  );
  assert.equal(
    resolveAssistantUsageCredentialSource({
      apiKeyEnv: null,
      provider: "codex-cli",
      userEnvKeys: ["CUSTOM_MODEL_API_KEY"],
    }),
    "platform",
  );
  assert.equal(
    resolveAssistantUsageCredentialSource({
      apiKeyEnv: null,
      effectiveEnv: {
        OPENAI_API_KEY: "member-openai-key",
      },
      provider: "codex-cli",
      userEnvKeys: ["OPENAI_API_KEY"],
    }),
    "member",
  );
  assert.equal(
    resolveAssistantUsageCredentialSource({
      apiKeyEnv: null,
      provider: "codex-cli",
      userEnvKeys: ["CUSTOM_MODEL_API_KEY"],
    }),
    "platform",
  );
  assert.equal(
    resolveAssistantUsageCredentialSource({
      apiKeyEnv: null,
      headers: {
        "X-Api-Key": "member-header-secret",
      },
      provider: "codex-cli",
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
      provider: "codex-cli",
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
      provider: "codex-cli",
      userEnvKeys: [],
    }),
    "platform",
  );
  assert.equal(
    resolveAssistantUsageCredentialSource({
      apiKeyEnv: " OPENAI_API_KEY ",
      provider: "codex-cli",
      userEnvKeys: ["OPENAI_API_KEY"],
    }),
    "platform",
  );
  assert.throws(
    () =>
      Reflect.apply(resolveAssistantUsageCredentialSource, undefined, [{
        apiKeyEnv: "OPENAI_API_KEY",
        provider: "codex-cli",
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
      provider: "codex-cli",
      userEnvKeys: ["OPENAI_API_KEY"],
    }),
    "platform",
  );
  assert.equal(
    resolveAssistantUsageCredentialSource({
      apiKeyEnv: null,
      effectiveEnv: {
        CUSTOM_MODEL_API_KEY: " ",
      },
      provider: "codex-cli",
      userEnvKeys: ["CUSTOM_MODEL_API_KEY"],
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
      provider: "codex-cli",
      userEnvKeys: ["OPENAI_API_KEY"],
    }),
    "member",
  );
});
