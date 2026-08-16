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
  buildHostedCodexMemoryUsageRecord,
  buildHostedElevenLabsMusicUsageRecord,
  buildHostedElevenLabsTtsUsageRecord,
  buildHostedTranscriptionUsageRecord,
  buildHostedXaiSearchUsageRecord,
  classifyAssistantOpenAiImageUsageBasis,
  createAssistantUsageId,
  createAssistantUsageReportingUserId,
  parseAssistantUsageRecord,
  resolveAssistantUsageCredentialSource,
} from "../src/assistant-usage.ts";

const PROVIDER_REQUEST_STARTED_AT = "2026-06-18T12:00:00.000Z";

test("maintenance usage records parse, attribute, and dedupe like turn usage", () => {
  const record = buildAssistantMaintenanceUsageRecord({
    assistantSessionId: "asst_123",
    codexThreadId: "thread_abc",
    credentialSource: "platform",
    featureKey: "assistant_idle_compact",
    memberId: "member_123",
    model: "gpt-5.6-terra",
    occurredAt: PROVIDER_REQUEST_STARTED_AT,
    providerName: "hosted-openai",
    tokenPricingBasis: "openai-flex",
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
  assert.equal(record.occurredAt, PROVIDER_REQUEST_STARTED_AT);
  assert.equal(record.providerName, "hosted-openai");
  assert.equal(record.tokenPricingBasis, "openai-flex");
  // sessionId is the Murph assistant session; the provider thread id lands in
  // providerRequestId so the two identities can never be conflated.
  assert.equal(record.sessionId, "asst_123");
  assert.equal(record.providerRequestId, "thread_abc");
  assert.equal(record.requestedModel, "gpt-5.6-terra");
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
      model: "gpt-5.6-terra",
      occurredAt: PROVIDER_REQUEST_STARTED_AT,
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

test("native Codex memory usage is exact and replay-idempotent", () => {
  const input = {
    apiKeyEnv: "OPENAI_API_KEY",
    baseUrl: "https://api.openai.com/v1",
    cacheWriteTokens: 50,
    cachedInputTokens: 700,
    inputTokens: 1_500,
    memberId: "member_123",
    occurredAt: "2026-04-01T12:00:00.000Z",
    outputTokens: 180,
    providerName: "hosted-openai",
    providerRequestId: "resp_memory_123",
    providerRequestOutcome: "succeeded" as const,
    rawUsageJson: {
      cacheWriteInputTokens: 50,
      input_tokens: 1_500,
      input_tokens_details: {
        cache_write_tokens: 50,
        cached_tokens: 700,
      },
      output_tokens: 180,
      output_tokens_details: { reasoning_tokens: 40 },
      total_tokens: 1_680,
    },
    reasoningTokens: 40,
    requestedModel: "gpt-5.6-terra",
    servedModel: "gpt-5.6-terra-2026-07-30",
    tokenPricingBasis: "openai-flex" as const,
    totalTokens: 1_680,
  };

  const record = buildHostedCodexMemoryUsageRecord(input);
  assert.deepEqual(parseAssistantUsageRecord({ ...record }), record);
  assert.match(record.turnId, /^turn_codex_memory_[0-9a-f]{32}$/u);
  assert.equal(record.usageId, `${record.turnId}.attempt-1`);
  assert.equal(record.occurredAt, input.occurredAt);
  assert.equal(record.credentialSource, "platform");
  assert.equal(record.provider, "codex-cli");
  assert.equal(record.providerName, "hosted-openai");
  assert.equal(record.providerRequestId, "resp_memory_123");
  assert.equal(record.providerRequestOutcome, "succeeded");
  assert.equal(record.requestedModel, "gpt-5.6-terra");
  assert.equal(record.servedModel, "gpt-5.6-terra-2026-07-30");
  assert.equal(record.tokenPricingBasis, "openai-flex");
  assert.equal(record.cacheWriteTokens, 50);
  assert.deepEqual(record.rawUsageJson, input.rawUsageJson);

  const duplicate = buildHostedCodexMemoryUsageRecord(input);
  assert.deepEqual(duplicate, record);
  assert.notEqual(
    buildHostedCodexMemoryUsageRecord({
      ...input,
      providerRequestId: "resp_memory_456",
    }).usageId,
    record.usageId,
  );
});

test("usage records default and validate token pricing basis", () => {
  const baseRecord = buildAssistantMaintenanceUsageRecord({
    assistantSessionId: "asst_123",
    codexThreadId: "thread_abc",
    credentialSource: "platform",
    featureKey: "assistant_turn",
    memberId: "member_123",
    model: "gpt-5.6-terra",
    occurredAt: PROVIDER_REQUEST_STARTED_AT,
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

test("OpenAI image usage basis classifier returns priceable token buckets", () => {
  const result = classifyAssistantOpenAiImageUsageBasis({
    cachedInputTokens: 0,
    inputTokens: 1_300,
    outputTokens: 400,
    rawUsageJson: {
      input_tokens: 1_300,
      input_tokens_details: {
        cached_tokens: 0,
        image_tokens: 1_000,
        text_tokens: 300,
      },
      output_tokens: 400,
      output_tokens_details: {
        image_tokens: 400,
        reasoning_tokens: 0,
        text_tokens: 0,
      },
      total_tokens: 1_700,
    },
    totalTokens: 1_700,
  });

  assert.equal(result.priceable, true);
  if (!result.priceable) throw new Error("Expected priceable image usage.");
  assert.deepEqual(result.tokenBuckets, {
    billableImageInputTokens: 1_000n,
    billableTextInputTokens: 300n,
    cachedImageInputTokens: 0n,
    cachedInputTokens: 0n,
    cachedTextInputTokens: 0n,
    imageInputTokens: 1_000n,
    outputTokens: 400n,
    textInputTokens: 300n,
  });

  const mixedCachedInput = classifyAssistantOpenAiImageUsageBasis({
    cachedInputTokens: 100,
    inputTokens: 1_300,
    outputTokens: 400,
    rawUsageJson: {
      input_tokens: 1_300,
      input_tokens_details: {
        cached_tokens: 100,
        image_tokens: 1_000,
        text_tokens: 300,
      },
      output_tokens: 400,
      total_tokens: 1_700,
    },
    totalTokens: 1_700,
  });
  assert.equal(mixedCachedInput.priceable, true);
  if (!mixedCachedInput.priceable) {
    throw new Error("Expected mixed cached image usage to be priceable.");
  }
  assert.deepEqual(mixedCachedInput.tokenBuckets, {
    billableImageInputTokens: 1_000n,
    billableTextInputTokens: 200n,
    cachedImageInputTokens: 0n,
    cachedInputTokens: 100n,
    cachedTextInputTokens: 100n,
    imageInputTokens: 1_000n,
    outputTokens: 400n,
    textInputTokens: 300n,
  });
});

test("OpenAI image usage basis classifier explains unpriceable usage", () => {
  assert.deepEqual(
    classifyAssistantOpenAiImageUsageBasis({
      cachedInputTokens: 0,
      inputTokens: 120,
      outputTokens: 40,
      rawUsageJson: {
        input_tokens: 120,
        output_tokens: 40,
        total_tokens: 160,
      },
      totalTokens: 160,
    }),
    {
      priceable: false,
      reason: "missing_provider_usage_tokens",
    },
  );

  assert.deepEqual(
    classifyAssistantOpenAiImageUsageBasis({
      cachedInputTokens: 0,
      inputTokens: 100,
      outputTokens: 400,
      rawUsageJson: {
        input_tokens: 101,
        output_tokens: 400,
        total_tokens: 500,
      },
      totalTokens: 500,
    }),
    {
      priceable: false,
      reason: "inconsistent_provider_usage_tokens",
    },
  );

});

test("transcription usage records carry the audio cost basis and dedupe like turn usage", () => {
  const record = buildHostedTranscriptionUsageRecord({
    audioBytes: 1_048_576,
    durationMs: 2_940,
    memberId: "member_123",
    model: "@cf/openai/whisper-large-v3-turbo",
    occurredAt: PROVIDER_REQUEST_STARTED_AT,
  });

  // Round-trips through the canonical parser (build already parses; prove a
  // re-parse is stable, mirroring what the web record route will do).
  assert.deepEqual(parseAssistantUsageRecord({ ...record }), record);
  assert.match(record.turnId, /^turn_transcribe_[0-9a-f]{32}$/u);
  assert.equal(record.usageId, `${record.turnId}.attempt-1`);
  assert.equal(record.sessionId, record.turnId);
  assert.equal(record.credentialSource, "platform");
  assert.equal(record.provider, "workers-ai");
  assert.equal(record.occurredAt, PROVIDER_REQUEST_STARTED_AT);
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
      occurredAt: PROVIDER_REQUEST_STARTED_AT,
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
      occurredAt: PROVIDER_REQUEST_STARTED_AT,
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

test("assistant usage records accept TTS character cost basis", () => {
  const parsed = parseAssistantUsageRecord({
    apiKeyEnv: "ELEVENLABS_API_KEY",
    attemptCount: 1,
    baseUrl: "https://api.elevenlabs.io",
    cacheWriteTokens: null,
    cachedInputTokens: null,
    credentialSource: "platform",
    featureKey: "assistant-reply",
    gatewayTags: [],
    inputTokens: null,
    memberId: "member_123",
    occurredAt: "2026-06-18T12:00:00.000Z",
    outputTokens: null,
    provider: "elevenlabs",
    providerName: "ElevenLabs",
    providerRequestId: null,
    rawUsageJson: { characterCount: 27 },
    rawUsageJsonHash: "sha256:character-count-hash",
    reasoningTokens: null,
    reportingUserId: "member_123",
    requestedModel: "eleven_multilingual_v2",
    routeId: "route_123",
    schema: ASSISTANT_USAGE_SCHEMA,
    servedModel: null,
    sessionId: "asst_123",
    stripeMeterSource: "murph",
    surface: "hosted-runtime",
    tokenPricingBasis: "standard",
    totalTokens: null,
    triggerKind: "manual-deliver",
    turnId: "turn_123",
    turnProfileJson: null,
    usageId: "turn_123.attempt-1",
    usageExtractionSourcePath: "elevenlabs.text_to_speech",
    usageExtractionVersion: "elevenlabs-tts-v1",
  });

  assert.deepEqual(parsed.rawUsageJson, { characterCount: 27 });
  assert.throws(
    () =>
      parseAssistantUsageRecord({
        ...parsed,
        rawUsageJson: { characterCount: 2.7 },
      }),
    /rawUsageJson\.characterCount must be a non-negative integer/u,
  );
});

test("hosted ElevenLabs TTS usage records carry character cost basis and dedupe like turn usage", () => {
  const record = buildHostedElevenLabsTtsUsageRecord({
    characterCount: 27,
    memberId: "member_123",
    model: "eleven_multilingual_v2",
    occurredAt: PROVIDER_REQUEST_STARTED_AT,
  });

  assert.deepEqual(parseAssistantUsageRecord({ ...record }), record);
  assert.match(record.turnId, /^turn_elevenlabs_tts_[0-9a-f]{32}$/u);
  assert.equal(record.usageId, `${record.turnId}.attempt-1`);
  assert.equal(record.sessionId, record.turnId);
  assert.equal(record.apiKeyEnv, "ELEVENLABS_API_KEY");
  assert.equal(record.baseUrl, "https://api.elevenlabs.io");
  assert.equal(record.credentialSource, "platform");
  assert.equal(record.featureKey, "assistant-reply");
  assert.equal(record.provider, "elevenlabs");
  assert.equal(record.providerName, "ElevenLabs");
  assert.equal(record.occurredAt, PROVIDER_REQUEST_STARTED_AT);
  assert.equal(record.requestedModel, "eleven_multilingual_v2");
  assert.equal(record.surface, "hosted-runner");
  assert.equal(record.triggerKind, "voice-memo-delivery");
  assert.deepEqual(record.rawUsageJson, { characterCount: 27 });
  assert.equal(record.inputTokens, null);
  assert.equal(record.outputTokens, null);
  assert.equal(record.totalTokens, null);
  assert.equal(record.usageExtractionSourcePath, "elevenlabs.text_to_speech");
  assert.equal(record.usageExtractionVersion, "elevenlabs-tts-v1");

  assert.notEqual(
    buildHostedElevenLabsTtsUsageRecord({
      characterCount: 27,
      memberId: "member_123",
      model: "eleven_multilingual_v2",
      occurredAt: PROVIDER_REQUEST_STARTED_AT,
    }).turnId,
    record.turnId,
  );
});

test("hosted ElevenLabs music usage retains the provider request start", () => {
  const record = buildHostedElevenLabsMusicUsageRecord({
    durationMs: 45_000,
    memberId: "member_123",
    model: "music_v2",
    occurredAt: PROVIDER_REQUEST_STARTED_AT,
    providerRequestId: "music_request_123",
  });

  assert.equal(record.occurredAt, PROVIDER_REQUEST_STARTED_AT);
  assert.equal(record.providerRequestId, "music_request_123");
  assert.deepEqual(record.rawUsageJson, { durationMs: 45_000 });
});

test("hosted xAI search usage records carry the provider-reported cost basis and dedupe like turn usage", () => {
  const record = buildHostedXaiSearchUsageRecord({
    memberId: "member_123",
    model: "grok-4.5",
    occurredAt: PROVIDER_REQUEST_STARTED_AT,
    providerRequestId: "resp_abc123",
    usage: {
      cost_in_usd_ticks: 123_456_789,
      input_tokens: 1_024,
      input_tokens_details: { cached_tokens: 256 },
      num_sources_used: 4,
      output_tokens: 128,
      output_tokens_details: { reasoning_tokens: 64 },
      total_tokens: 1_152,
    },
  });

  // Round-trips through the canonical parser (build already parses; prove a
  // re-parse is stable, mirroring what the web record route will do).
  assert.deepEqual(parseAssistantUsageRecord({ ...record }), record);
  assert.match(record.turnId, /^turn_xai_search_[0-9a-f]{32}$/u);
  assert.equal(record.usageId, `${record.turnId}.attempt-1`);
  assert.equal(record.sessionId, record.turnId);
  assert.equal(record.apiKeyEnv, "XAI_API_KEY");
  assert.equal(record.baseUrl, "https://api.x.ai");
  assert.equal(record.credentialSource, "platform");
  assert.equal(record.featureKey, "x-search");
  assert.equal(record.provider, "xai");
  assert.equal(record.providerName, "xAI");
  assert.equal(record.occurredAt, PROVIDER_REQUEST_STARTED_AT);
  assert.equal(record.providerRequestId, "resp_abc123");
  assert.equal(record.requestedModel, "grok-4.5");
  assert.equal(record.surface, "hosted-runner");
  assert.equal(record.triggerKind, "x-search");
  assert.equal(record.usageExtractionSourcePath, "xai.responses");
  assert.equal(record.usageExtractionVersion, "xai-x-search-v1");
  // The exact billed cost passes through untouched; unknown provider keys
  // (num_sources_used, total_tokens outside the copied set) are dropped.
  assert.deepEqual(record.rawUsageJson, {
    cost_in_usd_ticks: 123_456_789,
    input_tokens: 1_024,
    input_tokens_details: { cached_tokens: 256 },
    output_tokens: 128,
    output_tokens_details: { reasoning_tokens: 64 },
  });
  // Token columns stay null: pricing reads cost_in_usd_ticks, never tokens.
  assert.equal(record.inputTokens, null);
  assert.equal(record.outputTokens, null);
  assert.equal(record.totalTokens, null);

  // Missing or malformed usage still records the call with whatever is
  // present; the pricing side treats a missing tick count as uncounted.
  assert.equal(
    buildHostedXaiSearchUsageRecord({
      memberId: "member_123",
      model: "grok-4.5",
      occurredAt: PROVIDER_REQUEST_STARTED_AT,
      providerRequestId: null,
      usage: null,
    }).rawUsageJson,
    null,
  );
  assert.deepEqual(
    buildHostedXaiSearchUsageRecord({
      memberId: "member_123",
      model: "grok-4.5",
      occurredAt: PROVIDER_REQUEST_STARTED_AT,
      usage: {
        cost_in_usd_ticks: 12.5,
        input_tokens: 10,
        output_tokens: -1,
      },
    }).rawUsageJson,
    { input_tokens: 10 },
  );

  // The cost key stays under the strict non-negative-integer parse rule.
  assert.throws(
    () =>
      parseAssistantUsageRecord({
        ...record,
        rawUsageJson: { cost_in_usd_ticks: -1 },
      }),
    /rawUsageJson\.cost_in_usd_ticks must be a non-negative integer/u,
  );

  // Distinct calls never collide on the turn-keyed unique constraint.
  assert.notEqual(
    buildHostedXaiSearchUsageRecord({
      memberId: "member_123",
      model: "grok-4.5",
      occurredAt: PROVIDER_REQUEST_STARTED_AT,
      providerRequestId: "resp_abc123",
      usage: { cost_in_usd_ticks: 1 },
    }).turnId,
    record.turnId,
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

test("assistant usage parsing accepts the v2 tool profile and drops invalid v2 invariants", () => {
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
  const profile = {
    modelContextWindow: null,
    requestCount: 0,
    requests: [],
    requestsTruncated: false,
    schema: "murph.assistant-turn-profile.v2",
    tools: [
      {
        calls: 2,
        durationKnownCalls: 1,
        durationMs: 0,
        failedCalls: 1,
        kind: "command",
        label: "vault-cli memory show",
        outputBytesMax: 8,
        outputBytesTotal: 12,
      },
      {
        calls: 1,
        durationKnownCalls: 1,
        durationMs: 10,
        failedCalls: 1,
        kind: "command",
        label: "curl",
        outputBytesMax: 0,
        outputBytesTotal: 0,
      },
      {
        calls: 1,
        durationKnownCalls: 0,
        durationMs: 0,
        failedCalls: 0,
        kind: "dynamic_tool",
        label: "t_c",
        outputBytesMax: 2,
        outputBytesTotal: 2,
      },
    ],
    toolsTruncated: false,
  };

  assert.deepEqual(
    parseAssistantUsageRecord({
      ...baseRecord,
      turnProfileJson: profile,
    }).turnProfileJson,
    profile,
  );

  const invalidTools = [
    { ...profile.tools[0], kind: "browser" },
    { ...profile.tools[0], label: "member-private-command" },
    { ...profile.tools[0], durationKnownCalls: 3 },
    { ...profile.tools[0], calls: 0, failedCalls: 0 },
    { ...profile.tools[0], durationKnownCalls: 0, durationMs: 1 },
    { ...profile.tools[0], failedCalls: 3 },
    { ...profile.tools[0], outputBytesMax: 13 },
    { ...profile.tools[0], outputBytesMax: 5, outputBytesTotal: 11 },
    {
      ...profile.tools[0],
      calls: Number.MAX_SAFE_INTEGER,
      durationKnownCalls: 0,
      durationMs: 0,
      failedCalls: 0,
      outputBytesMax: 2,
      outputBytesTotal: 2,
    },
    { ...profile.tools[2], label: "a.b.c" },
    { ...profile.tools[2], label: "t_" },
    { ...profile.tools[2], label: "t_a.b" },
    { ...profile.tools[2], label: "n01_at1_b" },
    { ...profile.tools[2], label: "n2_abt1_c" },
    { ...profile.tools[2], label: "n7_private/path_t1_c" },
  ];
  for (const tool of invalidTools) {
    const parsed = parseAssistantUsageRecord({
      ...baseRecord,
      turnProfileJson: { ...profile, tools: [tool] },
    });
    assert.equal(parsed.turnProfileJson, null);
    assert.equal(parsed.inputTokens, 10);
  }

  const duplicate = parseAssistantUsageRecord({
    ...baseRecord,
    turnProfileJson: {
      ...profile,
      tools: [profile.tools[0], { ...profile.tools[0] }],
    },
  });
  assert.equal(duplicate.turnProfileJson, null);

  for (const requestFields of [
    { requestCount: 1, requests: [], requestsTruncated: false },
    { requestCount: 1, requests: [], requestsTruncated: true },
    {
      requestCount: ASSISTANT_TURN_PROFILE_MAX_REQUESTS + 1,
      requests: [{ cachedInput: 0, input: 1, output: 1 }],
      requestsTruncated: true,
    },
  ]) {
    const parsed = parseAssistantUsageRecord({
      ...baseRecord,
      turnProfileJson: { ...profile, ...requestFields },
    });
    assert.equal(parsed.turnProfileJson, null);
  }
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
    {
      ...validProfile,
      tools: [{ calls: 1, durationMs: 0, failedCalls: -1, label: "tool", outputChars: 1 }],
    },
    {
      ...validProfile,
      tools: [{ calls: 1, durationMs: 0, failedCalls: 2, label: "tool", outputChars: 1 }],
    },
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

test("assistant usage parsing preserves optional failed tool counts", () => {
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
  const profile = {
    modelContextWindow: null,
    requestCount: 0,
    requests: [],
    requestsTruncated: false,
    schema: "murph.assistant-turn-profile.v1",
    tools: [
      {
        calls: 2,
        durationMs: 100,
        failedCalls: 1,
        label: "vault-cli batch food.search-labels-batch",
        outputChars: 20,
      },
    ],
    toolsTruncated: false,
  };

  assert.deepEqual(
    parseAssistantUsageRecord({
      ...baseRecord,
      turnProfileJson: profile,
    }).turnProfileJson,
    profile,
  );
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
      apiKeyEnv: null,
      credentialSourceHint: "member",
      provider: "codex-cli",
      userEnvKeys: [],
    }),
    "member",
  );
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
