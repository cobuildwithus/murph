import assert from "node:assert/strict";
import { test } from "vitest";

import {
  ASSISTANT_IDLE_COMPACTION_USAGE_ESTIMATE_SOURCE_PATH,
  ASSISTANT_IDLE_COMPACTION_USAGE_ESTIMATE_VERSION,
  ASSISTANT_TURN_PROFILE_MAX_REQUESTS,
  ASSISTANT_TURN_PROFILE_MAX_TOOL_LABEL_LENGTH,
  ASSISTANT_TURN_PROFILE_MAX_TOOLS,
  ASSISTANT_USAGE_SCHEMA,
  buildAssistantMaintenanceUsageRecord,
  buildHostedTranscriptionUsageRecord,
  createAssistantUsageId,
  createAssistantUsageReportingUserId,
  isAssistantUsageOpenAiTokenPricingProviderName,
  parseAssistantUsageRecord,
  resolveAssistantUsageCredentialSource,
} from "../src/assistant-usage.ts";

test("maintenance usage records parse, attribute, and dedupe like turn usage", () => {
  const record = buildAssistantMaintenanceUsageRecord({
    assistantSessionId: "asst_123",
    codexThreadId: "thread_abc",
    credentialSource: "platform",
    featureKey: "assistant_idle_compact",
    memberId: "member_123",
    model: "gpt-5.5",
    triggerKind: "automation_idle_compact",
    usage: {
      cachedInputTokens: 96_000,
      inputTokens: 104_000,
      outputTokens: 1_200,
      totalTokens: 105_200,
    },
    usageExtractionSourcePath: ASSISTANT_IDLE_COMPACTION_USAGE_ESTIMATE_SOURCE_PATH,
    usageExtractionVersion: ASSISTANT_IDLE_COMPACTION_USAGE_ESTIMATE_VERSION,
  });

  // Round-trips through the canonical parser (build already parses; prove a
  // re-parse is stable, mirroring what the web record route will do).
  assert.deepEqual(parseAssistantUsageRecord({ ...record }), record);
  assert.match(record.turnId, /^turn_maintenance_[0-9a-f]{32}$/u);
  assert.equal(record.usageId, `${record.turnId}.attempt-1`);
  assert.equal(record.credentialSource, "platform");
  assert.equal(record.tokenPricingBasis, "standard");
  // sessionId is the Murph assistant session; the provider thread id lands in
  // providerRequestId so the two identities can never be conflated.
  assert.equal(record.sessionId, "asst_123");
  assert.equal(record.providerRequestId, "thread_abc");
  assert.equal(record.requestedModel, "gpt-5.5");
  assert.equal(record.triggerKind, "automation_idle_compact");
  assert.equal(record.inputTokens, 104_000);
  assert.equal(
    record.usageExtractionSourcePath,
    ASSISTANT_IDLE_COMPACTION_USAGE_ESTIMATE_SOURCE_PATH,
  );
  assert.equal(
    record.usageExtractionVersion,
    ASSISTANT_IDLE_COMPACTION_USAGE_ESTIMATE_VERSION,
  );

  // Distinct calls never collide on the turn-keyed unique constraint.
  assert.notEqual(
    buildAssistantMaintenanceUsageRecord({
      assistantSessionId: "asst_123",
      codexThreadId: null,
      credentialSource: "member",
      featureKey: "assistant_idle_compact",
      memberId: "member_123",
      model: "gpt-5.5",
      triggerKind: "automation_idle_compact",
      usage: {
        cachedInputTokens: null,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
      },
    }).turnId,
    record.turnId,
  );
});

test("usage records default and validate token pricing basis", () => {
  const baseRecord = buildAssistantMaintenanceUsageRecord({
    assistantSessionId: "asst_123",
    codexThreadId: "thread_abc",
    credentialSource: "platform",
    featureKey: "assistant_turn",
    memberId: "member_123",
    model: "gpt-5.5",
    triggerKind: "automation_cron",
    usage: {
      cachedInputTokens: null,
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
    },
  });

  assert.equal(
    parseAssistantUsageRecord({
      ...baseRecord,
      tokenPricingBasis: undefined,
    }).tokenPricingBasis,
    "standard",
  );
  assert.equal(
    parseAssistantUsageRecord({
      ...baseRecord,
      tokenPricingBasis: "openai-flex",
    }).tokenPricingBasis,
    "openai-flex",
  );
  assert.throws(
    () => parseAssistantUsageRecord({
      ...baseRecord,
      tokenPricingBasis: "flex",
    }),
    /tokenPricingBasis must be/u,
  );
});

test("OpenAI token pricing provider predicate includes hosted OpenAI alias", () => {
  assert.equal(isAssistantUsageOpenAiTokenPricingProviderName("openai"), true);
  assert.equal(isAssistantUsageOpenAiTokenPricingProviderName(" hosted-openai "), true);
  assert.equal(isAssistantUsageOpenAiTokenPricingProviderName("HOSTED-OPENAI"), true);
  assert.equal(isAssistantUsageOpenAiTokenPricingProviderName("anthropic"), false);
  assert.equal(isAssistantUsageOpenAiTokenPricingProviderName(null), false);
});

test("transcription usage records carry the audio cost basis and dedupe like turn usage", () => {
  const record = buildHostedTranscriptionUsageRecord({
    audioBytes: 1_048_576,
    durationMs: 2_940,
    memberId: "member_123",
    model: "@cf/openai/whisper-large-v3-turbo",
  });

  // Round-trips through the canonical parser (build already parses; prove a
  // re-parse is stable, mirroring what the web record route will do).
  assert.deepEqual(parseAssistantUsageRecord({ ...record }), record);
  assert.match(record.turnId, /^turn_transcribe_[0-9a-f]{32}$/u);
  assert.equal(record.usageId, `${record.turnId}.attempt-1`);
  assert.equal(record.sessionId, record.turnId);
  assert.equal(record.credentialSource, "platform");
  assert.equal(record.provider, "workers-ai");
  assert.equal(record.featureKey, "audio-transcription");
  assert.equal(record.requestedModel, "@cf/openai/whisper-large-v3-turbo");
  assert.equal(record.surface, "hosted-runner");
  assert.deepEqual(record.rawUsageJson, { audioBytes: 1_048_576, durationMs: 2_940 });
  assert.equal(record.inputTokens, null);
  assert.equal(record.outputTokens, null);
  assert.equal(record.totalTokens, null);

  // Workers AI output without transcription_info still records the byte count.
  assert.deepEqual(
    buildHostedTranscriptionUsageRecord({
      audioBytes: 64,
      durationMs: null,
      memberId: "member_123",
      model: "@cf/openai/whisper-large-v3-turbo",
    }).rawUsageJson,
    { audioBytes: 64 },
  );

  // Distinct calls never collide on the turn-keyed unique constraint.
  assert.notEqual(
    buildHostedTranscriptionUsageRecord({
      audioBytes: 1_048_576,
      durationMs: 2_940,
      memberId: "member_123",
      model: "@cf/openai/whisper-large-v3-turbo",
    }).turnId,
    record.turnId,
  );

  // The new audio keys stay under the strict non-negative-integer rule, so a
  // negative or fractional cost basis is rejected at parse before persisting.
  assert.throws(
    () => parseAssistantUsageRecord({ ...record, rawUsageJson: { audioBytes: -1 } }),
    /rawUsageJson\.audioBytes must be a non-negative integer/u,
  );
  assert.throws(
    () =>
      parseAssistantUsageRecord({
        ...record,
        rawUsageJson: { audioBytes: 64, durationMs: 2.94 },
      }),
    /rawUsageJson\.durationMs must be a non-negative integer/u,
  );
});

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
      tokenPricingBasis: "standard",
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
