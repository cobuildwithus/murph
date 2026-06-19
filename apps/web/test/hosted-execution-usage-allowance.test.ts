import { HostedBillingStatus } from "@prisma/client";
import {
  HOSTED_AI_USAGE_ALLOWANCE_PRICED_MODELS,
} from "@murphai/hosted-execution/runtime-control";
import {
  buildHostedTranscriptionUsageRecord,
  ASSISTANT_IDLE_COMPACTION_USAGE_ESTIMATE_SOURCE_PATH,
  ASSISTANT_IDLE_COMPACTION_USAGE_ESTIMATE_VERSION,
  type AssistantUsageRecord,
} from "@murphai/hosted-execution/assistant-usage";
import { describe, expect, it, vi } from "vitest";

import {
  accountHostedAiUsageForAllowanceTx,
  checkHostedAiUsageGate,
  claimHostedAiUsageLimitNotice,
  priceHostedAiUsageForAllowance,
  readHostedAiUsageGate,
  releaseHostedAiUsageLimitNotice,
  resolveHostedAiUsageGate,
} from "@/src/lib/hosted-execution/usage-allowance";

const BASE_USAGE_RECORD = {
  apiKeyEnv: "OPENAI_API_KEY",
  attemptCount: 1,
  baseUrl: "https://api.openai.com/v1",
  cacheWriteTokens: null,
  cachedInputTokens: 12,
  credentialSource: "platform",
  featureKey: null,
  gatewayTags: [],
  inputTokens: 120,
  memberId: "member_123",
  occurredAt: "2026-03-29T12:00:00.000Z",
  outputTokens: 45,
  provider: "codex-cli",
  providerName: "openai",
  providerRequestId: "req_123",
  providerRequestOutcome: "succeeded",
  providerRequestOrdinal: 0,
  rawUsageJson: null,
  rawUsageJsonHash: null,
  reasoningTokens: null,
  reportingUserId: "member_123",
  requestedModel: "gpt-5.5",
  routeId: "primary",
  schema: "murph.assistant-usage.v1",
  servedModel: "gpt-5.5",
  sessionId: "asst_123",
  stripeMeterSource: "murph",
  surface: null,
  tokenPricingBasis: "standard",
  totalTokens: 165,
  triggerKind: null,
  turnId: "turn_123",
  turnProfileJson: null,
  usageId: "turn_123.attempt-1",
  usageExtractionSourcePath: null,
  usageExtractionVersion: "codex-usage-v1",
} as const satisfies AssistantUsageRecord;

type AllowanceExecuteRaw = (sql: TemplateStringsArray, ...params: unknown[]) => Promise<number>;
type AllowanceExecuteRawMock = ReturnType<typeof vi.fn<AllowanceExecuteRaw>>;

describe("hosted AI usage allowance pricing", () => {
  it("prices platform usage from uncached input, cached input, and output tokens", () => {
    expect(priceHostedAiUsageForAllowance(BASE_USAGE_RECORD)).toMatchObject({
      costUsdMicros: 1896n,
      counted: true,
      pricingSnapshot: {
        standardCostUsdMicros: "1896",
        tokenPricingAdjustment: {
          denominator: "1",
          numerator: "1",
        },
        tokenPricingBasis: "standard",
      },
      pricingVersion: "openai-api-pricing-2026-05-05-standard",
    });
  });

  it("prices OpenAI flex token usage at 50% for allowance accounting", () => {
    expect(priceHostedAiUsageForAllowance({
      ...BASE_USAGE_RECORD,
      tokenPricingBasis: "openai-flex",
    })).toMatchObject({
      costUsdMicros: 948n,
      counted: true,
      pricingSnapshot: {
        standardCostUsdMicros: "1896",
        tokenPricingAdjustment: {
          denominator: "2",
          numerator: "1",
        },
        tokenPricingBasis: "openai-flex",
      },
      pricingVersion: "openai-api-pricing-2026-05-05-openai-flex",
    });
  });

  it("applies OpenAI flex adjustment once to the rounded standard token cost", () => {
    expect(priceHostedAiUsageForAllowance({
      ...BASE_USAGE_RECORD,
      cachedInputTokens: 1,
      inputTokens: 2,
      outputTokens: 0,
      tokenPricingBasis: "openai-flex",
      totalTokens: 2,
    })).toMatchObject({
      costUsdMicros: 3n,
      counted: true,
      pricingSnapshot: {
        standardCostUsdMicros: "6",
        tokenPricingAdjustment: {
          denominator: "2",
          numerator: "1",
        },
        tokenPricingBasis: "openai-flex",
      },
    });
  });

  it("accepts production OpenAI provider evidence for OpenAI flex token pricing", () => {
    expect(priceHostedAiUsageForAllowance({
      ...BASE_USAGE_RECORD,
      providerName: "hosted-openai",
      tokenPricingBasis: "openai-flex",
    })).toMatchObject({
      costUsdMicros: 948n,
      counted: true,
      pricingSnapshot: {
        tokenPricingBasis: "openai-flex",
      },
    });
    expect(priceHostedAiUsageForAllowance({
      ...BASE_USAGE_RECORD,
      providerName: "openai",
      tokenPricingBasis: "openai-flex",
    })).toMatchObject({
      costUsdMicros: 948n,
      counted: true,
      pricingSnapshot: {
        tokenPricingBasis: "openai-flex",
      },
    });
  });

  it("rejects OpenAI flex token pricing without OpenAI provider evidence", () => {
    expect(() => priceHostedAiUsageForAllowance({
      ...BASE_USAGE_RECORD,
      providerName: "venice",
      tokenPricingBasis: "openai-flex",
    })).toThrow("OpenAI flex token pricing requires OpenAI provider evidence");
    expect(() => priceHostedAiUsageForAllowance({
      ...BASE_USAGE_RECORD,
      providerName: "anthropic",
      tokenPricingBasis: "openai-flex",
    })).toThrow("OpenAI flex token pricing requires OpenAI provider evidence");
    expect(() => priceHostedAiUsageForAllowance({
      ...BASE_USAGE_RECORD,
      providerName: "openai-local-test",
      tokenPricingBasis: "openai-flex",
    })).toThrow("OpenAI flex token pricing requires OpenAI provider evidence");
  });

  it("records member-provided credential usage without counting it against allowance", () => {
    expect(priceHostedAiUsageForAllowance({
      ...BASE_USAGE_RECORD,
      credentialSource: "member",
    })).toMatchObject({
      costUsdMicros: 0n,
      counted: false,
    });
  });

  it("validates OpenAI flex evidence before returning uncounted member usage", () => {
    expect(() => priceHostedAiUsageForAllowance({
      ...BASE_USAGE_RECORD,
      credentialSource: "member",
      providerName: "venice",
      tokenPricingBasis: "openai-flex",
    })).toThrow("OpenAI flex token pricing requires OpenAI provider evidence");

    expect(() => priceHostedAiUsageForAllowance({
      ...BASE_USAGE_RECORD,
      credentialSource: "member",
      providerName: "openai",
      requestedModel: "gpt-unpriced",
      servedModel: "gpt-unpriced",
      tokenPricingBasis: "openai-flex",
    })).toThrow("pricing is missing");
  });

  it("counts estimated idle compaction fallback usage in allowance accounting", () => {
    const estimatedIdleCompaction = {
      ...BASE_USAGE_RECORD,
      cachedInputTokens: null,
      featureKey: "assistant_idle_compact",
      inputTokens: 125_000,
      outputTokens: null,
      servedModel: null,
      surface: "hosted-runtime",
      totalTokens: 125_000,
      triggerKind: "automation_idle_compact",
    } satisfies AssistantUsageRecord;
    const markedEstimatedIdleCompaction = {
      ...estimatedIdleCompaction,
      usageExtractionSourcePath: ASSISTANT_IDLE_COMPACTION_USAGE_ESTIMATE_SOURCE_PATH,
      usageExtractionVersion: ASSISTANT_IDLE_COMPACTION_USAGE_ESTIMATE_VERSION,
    } satisfies AssistantUsageRecord;

    expect(priceHostedAiUsageForAllowance(estimatedIdleCompaction)).toMatchObject({
      costUsdMicros: 625000n,
      counted: true,
    });
    expect(priceHostedAiUsageForAllowance(markedEstimatedIdleCompaction)).toMatchObject({
      costUsdMicros: 625000n,
      counted: true,
      pricingSnapshot: {
        credentialSource: "platform",
        tokens: {
          cachedInput: "0",
          input: "125000",
          output: "0",
          total: "125000",
        },
      },
    });
    expect(priceHostedAiUsageForAllowance({
      ...markedEstimatedIdleCompaction,
      surface: null,
    })).toMatchObject({
      costUsdMicros: 625000n,
      counted: true,
    });
    expect(priceHostedAiUsageForAllowance({
      ...markedEstimatedIdleCompaction,
      providerRequestId: null,
    })).toMatchObject({
      costUsdMicros: 625000n,
      counted: true,
    });
  });

  it("fails closed for unknown platform model prices", () => {
    expect(() => priceHostedAiUsageForAllowance({
      ...BASE_USAGE_RECORD,
      requestedModel: "gpt-unpriced",
      servedModel: "gpt-unpriced",
    })).toThrow("pricing is missing");
  });

  it("prices every hosted assistant launch model accepted by deploy preflight", () => {
    for (const model of HOSTED_AI_USAGE_ALLOWANCE_PRICED_MODELS) {
      expect(priceHostedAiUsageForAllowance({
        ...BASE_USAGE_RECORD,
        requestedModel: model,
        servedModel: model,
      })).toMatchObject({
        counted: true,
      });
    }
  });

  it("prices provider-prefixed OpenAI model ids", () => {
    expect(priceHostedAiUsageForAllowance({
      ...BASE_USAGE_RECORD,
      requestedModel: "openai/gpt-5.5",
      servedModel: "openai/gpt-5.5",
    })).toMatchObject({
      counted: true,
      pricingSnapshot: {
        model: "gpt-5.5",
      },
    });
  });

  it("prices direct OpenAI dated gpt-5.5 snapshots", () => {
    expect(priceHostedAiUsageForAllowance({
      ...BASE_USAGE_RECORD,
      requestedModel: "gpt-5.5-2026-04-23",
      servedModel: "gpt-5.5-2026-04-23",
    })).toMatchObject({
      counted: true,
      pricingSnapshot: {
        model: "gpt-5.5",
        modelSource: "served",
        requestedModel: "gpt-5.5-2026-04-23",
        servedModel: "gpt-5.5-2026-04-23",
      },
    });
  });

  it("falls back to a recognized requested model when the served model is decorated", () => {
    expect(priceHostedAiUsageForAllowance({
      ...BASE_USAGE_RECORD,
      requestedModel: "gpt-5.5",
      servedModel: "gpt-5.5-production",
    })).toMatchObject({
      counted: true,
      pricingSnapshot: {
        model: "gpt-5.5",
        modelSource: "requested",
        requestedModel: "gpt-5.5",
        servedModel: "gpt-5.5-production",
      },
    });
  });

  it("keeps raw requested and served model ids in the pricing snapshot", () => {
    expect(priceHostedAiUsageForAllowance({
      ...BASE_USAGE_RECORD,
      requestedModel: "gpt-unpriced",
      servedModel: "openai/gpt-5.5",
    })).toMatchObject({
      counted: true,
      pricingSnapshot: {
        model: "gpt-5.5",
        modelSource: "served",
        requestedModel: "gpt-unpriced",
        servedModel: "openai/gpt-5.5",
      },
    });
  });

  it("prices Workers AI transcription by audio duration at $0.00051 per minute", () => {
    const transcription = {
      ...BASE_USAGE_RECORD,
      apiKeyEnv: null,
      baseUrl: null,
      cachedInputTokens: null,
      featureKey: "audio-transcription",
      inputTokens: null,
      outputTokens: null,
      provider: "workers-ai",
      providerName: "Workers AI",
      providerRequestId: null,
      rawUsageJson: { audioBytes: 1_048_576, durationMs: 60_000 },
      requestedModel: "@cf/openai/whisper-large-v3-turbo",
      servedModel: null,
      totalTokens: null,
      usageExtractionSourcePath: "workers-ai.transcribe",
      usageExtractionVersion: "workers-ai-transcribe-v1",
    } satisfies AssistantUsageRecord;

    // One full audio minute costs exactly the Workers AI per-minute rate.
    expect(priceHostedAiUsageForAllowance(transcription)).toMatchObject({
      costUsdMicros: 510n,
      counted: true,
      pricingSnapshot: {
        audio: {
          durationMs: "60000",
          usdMicrosPerAudioMinute: "510",
        },
        model: "@cf/openai/whisper-large-v3-turbo",
        modelSource: "requested",
      },
      pricingVersion: "workers-ai-audio-pricing-2026-06-12",
    });

    // Partial minutes prorate with ceil rounding (2.94s ≈ 25 USD micros).
    expect(priceHostedAiUsageForAllowance({
      ...transcription,
      rawUsageJson: { audioBytes: 1_048_576, durationMs: 2_940 },
    })).toMatchObject({
      costUsdMicros: 25n,
      counted: true,
    });

    // Missing duration records a zero-cost counted row instead of throwing.
    expect(priceHostedAiUsageForAllowance({
      ...transcription,
      rawUsageJson: { audioBytes: 1_048_576 },
    })).toMatchObject({
      costUsdMicros: 0n,
      counted: true,
      pricingSnapshot: {
        audio: {
          durationMs: null,
        },
      },
    });

    // Member-credential audio rows are recorded without counting, like tokens.
    expect(priceHostedAiUsageForAllowance({
      ...transcription,
      credentialSource: "member",
    })).toMatchObject({
      costUsdMicros: 0n,
      counted: false,
    });

    expect(() => priceHostedAiUsageForAllowance({
      ...transcription,
      tokenPricingBasis: "openai-flex",
    })).toThrow("Audio-priced hosted AI usage must use standard token pricing basis");

    // A token-bearing row that merely claims the whisper id is not a
    // transcription record; it fails closed through token-model pricing.
    expect(() => priceHostedAiUsageForAllowance({
      ...transcription,
      inputTokens: 120,
      outputTokens: 45,
      totalTokens: 165,
    })).toThrow("pricing is missing");

    // Rows that claim the Whisper model but lack the worker transcription
    // cost-basis shape fail closed through token-model pricing.
    for (const malformed of [
      {
        ...transcription,
        rawUsageJson: null,
      },
      {
        ...transcription,
        rawUsageJson: {},
      },
      {
        ...transcription,
        rawUsageJson: { durationMs: 60_000 },
      },
      {
        ...transcription,
        featureKey: "maintenance",
      },
      {
        ...transcription,
        usageExtractionSourcePath: null,
      },
      {
        ...transcription,
        cachedInputTokens: 1,
      },
      {
        ...transcription,
        cacheWriteTokens: 1,
      },
      {
        ...transcription,
        reasoningTokens: 1,
      },
    ] satisfies AssistantUsageRecord[]) {
      expect(() => priceHostedAiUsageForAllowance(malformed)).toThrow(
        "pricing is missing",
      );
    }
  });

  it("prices ElevenLabs TTS by character count for allowance accounting", () => {
    const voiceMemo = {
      ...BASE_USAGE_RECORD,
      apiKeyEnv: "ELEVENLABS_API_KEY",
      baseUrl: "https://api.elevenlabs.io",
      cachedInputTokens: null,
      inputTokens: null,
      outputTokens: null,
      provider: "elevenlabs",
      providerName: "ElevenLabs",
      rawUsageJson: { characterCount: 4_000 },
      requestedModel: "eleven_multilingual_v2",
      servedModel: null,
      totalTokens: null,
      usageExtractionSourcePath: "elevenlabs.text_to_speech",
      usageExtractionVersion: "elevenlabs-tts-v1",
    } satisfies AssistantUsageRecord;

    expect(priceHostedAiUsageForAllowance(voiceMemo)).toMatchObject({
      costUsdMicros: 400_000n,
      counted: true,
      pricingSnapshot: {
        characters: {
          count: "4000",
          usdMicrosPerThousandCharacters: "100000",
        },
        model: "eleven_multilingual_v2",
        modelSource: "requested",
        pricingSource: "https://elevenlabs.io/pricing/api",
      },
      pricingVersion: "elevenlabs-tts-pricing-2026-06-18",
    });

    expect(priceHostedAiUsageForAllowance({
      ...voiceMemo,
      rawUsageJson: { characterCount: 1_001 },
      requestedModel: "eleven_flash_v2_5",
    })).toMatchObject({
      costUsdMicros: 50_050n,
      counted: true,
      pricingSnapshot: {
        characters: {
          count: "1001",
          usdMicrosPerThousandCharacters: "50000",
        },
        model: "eleven_flash_v2_5",
      },
    });

    expect(priceHostedAiUsageForAllowance({
      ...voiceMemo,
      credentialSource: "member",
      requestedModel: "eleven_private_test",
    })).toMatchObject({
      costUsdMicros: 0n,
      counted: false,
      pricingSnapshot: {
        model: null,
      },
    });

    expect(() => priceHostedAiUsageForAllowance({
      ...voiceMemo,
      requestedModel: "eleven_private_test",
    })).toThrow("ElevenLabs TTS pricing is missing");

    expect(() => priceHostedAiUsageForAllowance({
      ...voiceMemo,
      tokenPricingBasis: "openai-flex",
    })).toThrow("ElevenLabs TTS hosted AI usage must use standard token pricing basis");
  });
});

describe("accountHostedAiUsageForAllowanceTx", () => {
  it("claims counted usage without updating period metadata", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const executeRaw = vi.fn<AllowanceExecuteRaw>(async () => 1);
    const aggregate = vi.fn(async () => ({
      _max: {
        occurredAt: null,
      },
      _sum: {
        allowanceCostUsdMicros: null,
      },
    }));
    const tx = createAllowanceTx({
      executeRaw,
      hostedAiUsageAggregate: aggregate,
      hostedAiUsageUpdateMany: updateMany,
    });

    await expect(accountHostedAiUsageForAllowanceTx({
      memberId: "member_123",
      now: new Date("2026-03-29T12:00:05.000Z"),
      record: BASE_USAGE_RECORD,
      tx: tx as never,
    })).resolves.toBeUndefined();

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        allowanceAccountedAt: new Date("2026-03-29T12:00:05.000Z"),
        allowanceCostUsdMicros: 1896n,
        allowanceCounted: true,
      }),
      where: {
        allowanceAccountedAt: null,
        id: "turn_123.attempt-1",
      },
    }));
    expect(aggregate).toHaveBeenCalledTimes(1);
    expect(countPeriodMetadataUpdateCalls(tx)).toBe(0);
  });

  it("accounts an already-ended allowance period without returning notice data", async () => {
    const tx = createAllowanceTx({
      executeRaw: vi.fn<AllowanceExecuteRaw>(async () => 1),
      hostedAiUsageUpdateMany: vi.fn(async () => ({ count: 1 })),
    });

    await expect(accountHostedAiUsageForAllowanceTx({
      memberId: "member_123",
      now: new Date("2026-04-01T00:00:00.000Z"),
      record: BASE_USAGE_RECORD,
      tx: tx as never,
    })).resolves.toBeUndefined();

    expect(countPeriodMetadataUpdateCalls(tx)).toBe(0);
  });

  it("accounts usage when the period was already blocked", async () => {
    const tx = createAllowanceTx({
      executeRaw: vi.fn<AllowanceExecuteRaw>(async () => 1),
      hostedAiUsageUpdateMany: vi.fn(async () => ({ count: 1 })),
    });

    await expect(accountHostedAiUsageForAllowanceTx({
      memberId: "member_123",
      now: new Date("2026-03-29T12:00:05.000Z"),
      record: BASE_USAGE_RECORD,
      tx: tx as never,
    })).resolves.toBeUndefined();
  });

  it("accounts a worker-built transcription record with duration pricing", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const executeRaw = vi.fn<AllowanceExecuteRaw>(async () => 1);
    const tx = createAllowanceTx({
      executeRaw,
      hostedAiUsageUpdateMany: updateMany,
    });
    // The exact record shape the worker egress intercept produces (null token
    // columns, workers-ai provider, whisper model). Only occurredAt is pinned
    // so the record lands in the mocked billing period.
    const record = {
      ...buildHostedTranscriptionUsageRecord({
        audioBytes: 1_048_576,
        durationMs: 2_940,
        memberId: "member_123",
        model: "@cf/openai/whisper-large-v3-turbo",
      }),
      occurredAt: "2026-03-29T12:00:00.000Z",
    };

    await accountHostedAiUsageForAllowanceTx({
      memberId: "member_123",
      now: new Date("2026-03-29T12:00:05.000Z"),
      record,
      tx: tx as never,
    });

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        allowanceAccountedAt: new Date("2026-03-29T12:00:05.000Z"),
        allowanceCostUsdMicros: 25n,
        allowanceCounted: true,
        allowancePricingSnapshotJson: expect.objectContaining({
          audio: {
            durationMs: "2940",
            usdMicrosPerAudioMinute: "510",
          },
          model: "@cf/openai/whisper-large-v3-turbo",
        }),
        allowancePricingVersion: "workers-ai-audio-pricing-2026-06-12",
      }),
      where: {
        allowanceAccountedAt: null,
        id: record.usageId,
      },
    }));
    expect(countPeriodMetadataUpdateCalls(tx)).toBe(0);
  });

  it("does not update period metadata again when allowanceAccountedAt was already set", async () => {
    const executeRaw = vi.fn<AllowanceExecuteRaw>(async () => 1);
    const tx = createAllowanceTx({
      executeRaw,
      hostedAiUsageUpdateMany: vi.fn(async () => ({ count: 0 })),
    });

    await expect(accountHostedAiUsageForAllowanceTx({
      memberId: "member_123",
      record: BASE_USAGE_RECORD,
      tx: tx as never,
    })).resolves.toBeUndefined();

    expect(countPeriodMetadataUpdateCalls(tx)).toBe(0);
  });

  it("marks usage rows as allowance-denied when trial billing state is stale", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const executeRaw = vi.fn<AllowanceExecuteRaw>(async () => 1);
    const tx = createAllowanceTx({
      billingPhase: "trial",
      checkoutOffer: "pulse_trial_7d",
      executeRaw,
      hostedAiUsageUpdateMany: updateMany,
      pulseTrialPolicyVersion: "pulse-trial-2026-05-05-v1",
      trialEndsAt: new Date("2026-04-08T12:00:00.000Z"),
      trialStartedAt: new Date("2026-04-01T12:00:00.000Z"),
    });

    await accountHostedAiUsageForAllowanceTx({
      memberId: "member_123",
      now: new Date("2026-04-08T12:00:05.000Z"),
      record: {
        ...BASE_USAGE_RECORD,
        occurredAt: "2026-04-08T12:00:01.000Z",
      },
      tx: tx as never,
    });

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        allowanceAccountedAt: new Date("2026-04-08T12:00:05.000Z"),
        allowanceCostUsdMicros: 0n,
        allowanceCounted: false,
        allowancePricingSnapshotJson: expect.objectContaining({
          reason: "trial_expired_pending_billing",
          schema: "murph.hosted-ai-usage-allowance-denied.v1",
          tokenPricingBasis: "standard",
        }),
        allowancePricingVersion: "hosted-ai-usage-allowance-denied-2026-05-05",
      }),
    }));
    expect(countPeriodMetadataUpdateCalls(tx)).toBe(0);
    expect(tx.hostedAiUsagePeriod.createMany).not.toHaveBeenCalled();
  });

  it("validates OpenAI flex evidence before marking stale-trial usage denied", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const executeRaw = vi.fn<AllowanceExecuteRaw>(async () => 1);
    const tx = createAllowanceTx({
      billingPhase: "trial",
      checkoutOffer: "pulse_trial_7d",
      executeRaw,
      hostedAiUsageUpdateMany: updateMany,
      pulseTrialPolicyVersion: "pulse-trial-2026-05-05-v1",
      trialEndsAt: new Date("2026-04-08T12:00:00.000Z"),
      trialStartedAt: new Date("2026-04-01T12:00:00.000Z"),
    });

    await expect(accountHostedAiUsageForAllowanceTx({
      memberId: "member_123",
      now: new Date("2026-04-08T12:00:05.000Z"),
      record: {
        ...BASE_USAGE_RECORD,
        occurredAt: "2026-04-08T12:00:01.000Z",
        providerName: "venice",
        tokenPricingBasis: "openai-flex",
      },
      tx: tx as never,
    })).rejects.toThrow("OpenAI flex token pricing requires OpenAI provider evidence");

    expect(updateMany).not.toHaveBeenCalled();
    expect(countPeriodMetadataUpdateCalls(tx)).toBe(0);
  });

  it("records OpenAI flex basis in stale-trial denied snapshots", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const executeRaw = vi.fn<AllowanceExecuteRaw>(async () => 1);
    const tx = createAllowanceTx({
      billingPhase: "trial",
      checkoutOffer: "pulse_trial_7d",
      executeRaw,
      hostedAiUsageUpdateMany: updateMany,
      pulseTrialPolicyVersion: "pulse-trial-2026-05-05-v1",
      trialEndsAt: new Date("2026-04-08T12:00:00.000Z"),
      trialStartedAt: new Date("2026-04-01T12:00:00.000Z"),
    });

    await accountHostedAiUsageForAllowanceTx({
      memberId: "member_123",
      now: new Date("2026-04-08T12:00:05.000Z"),
      record: {
        ...BASE_USAGE_RECORD,
        occurredAt: "2026-04-08T12:00:01.000Z",
        tokenPricingBasis: "openai-flex",
      },
      tx: tx as never,
    });

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        allowancePricingSnapshotJson: expect.objectContaining({
          reason: "trial_expired_pending_billing",
          schema: "murph.hosted-ai-usage-allowance-denied.v1",
          tokenPricingBasis: "openai-flex",
        }),
      }),
    }));
    expect(countPeriodMetadataUpdateCalls(tx)).toBe(0);
  });

  it("does not update period metadata for member credentials", async () => {
    const executeRaw = vi.fn<AllowanceExecuteRaw>(async () => 1);
    const tx = createAllowanceTx({
      executeRaw,
      hostedAiUsageUpdateMany: vi.fn(async () => ({ count: 1 })),
    });

    await expect(accountHostedAiUsageForAllowanceTx({
      memberId: "member_123",
      record: {
        ...BASE_USAGE_RECORD,
        credentialSource: "member",
      },
      tx: tx as never,
    })).resolves.toBeUndefined();

    expect(countPeriodMetadataUpdateCalls(tx)).toBe(0);
  });
});

function countPeriodMetadataUpdateCalls(tx: { $executeRaw: ReturnType<typeof vi.fn> }): number {
  return tx.$executeRaw.mock.calls.filter(([sql]) => {
    const sqlText = Array.isArray(sql) ? sql.join("") : String(sql);
    return sqlText.includes('UPDATE "hosted_ai_usage_period"')
      && sqlText.includes('"last_usage_at"');
  }).length;
}

describe("resolveHostedAiUsageGate", () => {
  it("allows active members while recorded spend is below the period limit", async () => {
    const prisma = createGatePrisma({
      spentUsdMicros: 9_000_000n,
    });

    await expect(resolveHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-03-29T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: true,
      limitUsdMicros: 10_000_000n,
      remainingUsdMicros: 1_000_000n,
      spentUsdMicros: 9_000_000n,
    });
  });

  it("blocks active members once recorded spend reaches the period limit", async () => {
    const prisma = createGatePrisma({
      spentUsdMicros: 10_000_000n,
    });

    await expect(resolveHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-03-29T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: false,
      userNotice: {
        code: "pulse_upgrade_edge",
        message:
          "Hey, you've reached your usage limit for the month. Upgrade to Edge: https://withmurph.ai/home",
      },
      reason: "ai_usage_limit_exceeded",
      retryAfter: new Date("2026-04-01T00:00:00.000Z"),
      spentUsdMicros: 10_000_000n,
    });
  });

  it("starts a fresh calendar allowance period automatically after the previous month ends", async () => {
    const nextPeriodStart = new Date("2026-05-01T00:00:00.000Z");
    const nextPeriodEnd = new Date("2026-06-01T00:00:00.000Z");
    const prisma = createGatePrisma({
      aggregate: vi.fn(async () => ({
        _max: {
          occurredAt: null,
        },
        _sum: {
          allowanceCostUsdMicros: null,
        },
      })),
      findUniquePeriod: {
        billingPlanCode: "launch_monthly",
        limitUsdMicros: 10_000_000n,
        periodEnd: nextPeriodEnd,
        periodStart: nextPeriodStart,
        spentUsdMicros: 0n,
      },
      periodEnd: new Date("2026-05-01T00:00:00.000Z"),
      periodStart: new Date("2026-04-01T00:00:00.000Z"),
      spentUsdMicros: 10_000_000n,
    });

    await expect(resolveHostedAiUsageGate({
      memberId: "member_123",
      now: nextPeriodStart,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: true,
      limitUsdMicros: 10_000_000n,
      periodEnd: nextPeriodEnd,
      periodStart: nextPeriodStart,
      remainingUsdMicros: 10_000_000n,
      spentUsdMicros: 0n,
    });

    expect(prisma.hostedAiUsagePeriod.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        limitUsdMicros: 10_000_000n,
        memberId: "member_123",
        periodEnd: nextPeriodEnd,
        periodStart: nextPeriodStart,
        spentUsdMicros: 0n,
      }),
      skipDuplicates: true,
    }));
  });

  it("uses the Edge usage limit notice when an Edge member is over limit", async () => {
    const prisma = createGatePrisma({
      billingPlanCode: "launch_edge_monthly",
      limitUsdMicros: 25_000_000n,
      spentUsdMicros: 25_000_000n,
    });

    await expect(resolveHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-03-29T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: false,
      userNotice: {
        code: "edge_usage_limit_reached",
        message:
          "Hey, you've reached your usage limit for the month. Murph will resume when your included allowance resets: https://withmurph.ai/home",
      },
    });
  });

  it("keeps Edge allowance while a Pulse switch is only scheduled locally", async () => {
    const prisma = createGatePrisma({
      billingPlanCode: "launch_edge_monthly",
      limitUsdMicros: 25_000_000n,
      scheduledBillingEffectiveAt: new Date("2026-04-01T00:00:00.000Z"),
      scheduledBillingPlanCode: "launch_monthly",
      spentUsdMicros: 24_000_000n,
    });

    await expect(resolveHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-03-29T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: true,
      billingPlanCode: "launch_edge_monthly",
      limitUsdMicros: 25_000_000n,
      remainingUsdMicros: 1_000_000n,
    });
  });

  it("uses Pulse allowance only after subscription reconciliation writes Pulse as current plan", async () => {
    const prisma = createGatePrisma({
      billingPlanCode: "launch_monthly",
      limitUsdMicros: 10_000_000n,
      spentUsdMicros: 9_000_000n,
    });

    await expect(resolveHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-03-29T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: true,
      billingPlanCode: "launch_monthly",
      limitUsdMicros: 10_000_000n,
      remainingUsdMicros: 1_000_000n,
    });
  });

  it("uses the Pulse Trial allowance while the active trial period is current", async () => {
    const prisma = createGatePrisma({
      billingPhase: "trial",
      checkoutOffer: "pulse_trial_7d",
      limitUsdMicros: 4_500_000n,
      periodEnd: new Date("2026-04-08T12:00:00.000Z"),
      periodStart: new Date("2026-04-01T12:00:00.000Z"),
      pulseTrialPolicyVersion: "pulse-trial-2026-05-05-v1",
      spentUsdMicros: 2_000_000n,
      trialEndsAt: new Date("2026-04-08T12:00:00.000Z"),
      trialStartedAt: new Date("2026-04-01T12:00:00.000Z"),
    });

    await expect(resolveHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-04-03T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: true,
      billingPlanCode: "launch_monthly",
      limitUsdMicros: 4_500_000n,
      periodEnd: new Date("2026-04-08T12:00:00.000Z"),
      periodStart: new Date("2026-04-01T12:00:00.000Z"),
      remainingUsdMicros: 2_500_000n,
      spentUsdMicros: 2_000_000n,
    });
  });

  it("uses trial-specific copy when Pulse Trial spend reaches the trial cap", async () => {
    const prisma = createGatePrisma({
      billingPhase: "trial",
      checkoutOffer: "pulse_trial_7d",
      limitUsdMicros: 4_500_000n,
      periodEnd: new Date("2026-04-08T12:00:00.000Z"),
      periodStart: new Date("2026-04-01T12:00:00.000Z"),
      pulseTrialPolicyVersion: "pulse-trial-2026-05-05-v1",
      spentUsdMicros: 4_500_000n,
      trialEndsAt: new Date("2026-04-08T12:00:00.000Z"),
      trialStartedAt: new Date("2026-04-01T12:00:00.000Z"),
    });

    await expect(resolveHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-04-03T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: false,
      reason: "ai_usage_limit_exceeded",
      retryAfter: new Date("2026-04-08T12:00:00.000Z"),
      userNotice: {
        code: "trial_usage_limit_reached",
        message:
          "You've reached the hosted AI usage included in your trial. Upgrade: https://withmurph.ai/home",
      },
    });
  });

  it("uses ledger Pulse Trial spend and updates only period metadata", async () => {
    const aggregate = vi.fn(async () => ({
      _max: {
        occurredAt: new Date("2026-04-03T13:00:00.000Z"),
      },
      _sum: {
        allowanceCostUsdMicros: 6_500_000n,
      },
    }));
    const update = vi.fn(async (args?: unknown) => {
      void args;
      return {
      billingPlanCode: "launch_monthly",
      limitUsdMicros: 4_500_000n,
      periodEnd: new Date("2026-04-08T12:00:00.000Z"),
      periodStart: new Date("2026-04-01T12:00:00.000Z"),
      spentUsdMicros: 6_500_000n,
      };
    });
    const prisma = createGatePrisma({
      aggregate,
      billingPhase: "trial",
      checkoutOffer: "pulse_trial_7d",
      limitUsdMicros: 4_500_000n,
      periodEnd: new Date("2026-04-08T12:00:00.000Z"),
      periodStart: new Date("2026-04-01T12:00:00.000Z"),
      pulseTrialPolicyVersion: "pulse-trial-2026-05-05-v1",
      spentUsdMicros: 1_700_000n,
      trialEndsAt: new Date("2026-04-08T12:00:00.000Z"),
      trialStartedAt: new Date("2026-04-01T12:00:00.000Z"),
      update,
    });

    await expect(resolveHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-04-03T13:05:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: false,
      reason: "ai_usage_limit_exceeded",
      spentUsdMicros: 6_500_000n,
      userNotice: {
        code: "trial_usage_limit_reached",
      },
    });

    expect(aggregate).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        allowanceAccountedAt: { not: null },
        allowanceCounted: true,
        memberId: "member_123",
        occurredAt: {
          gte: new Date("2026-04-01T12:00:00.000Z"),
          lt: new Date("2026-04-08T12:00:00.000Z"),
        },
      }),
    }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        blockedAt: new Date("2026-04-03T13:05:00.000Z"),
      }),
    }));
    const updateData = (update.mock.calls[0]?.[0] as { data?: Record<string, unknown> } | undefined)
      ?.data;
    expect(updateData).not.toHaveProperty("lastUsageAt");
    expect(updateData).not.toHaveProperty("spentUsdMicros");
  });

  it("denies stale Pulse Trial billing state instead of falling back to the paid Pulse allowance", async () => {
    const prisma = createGatePrisma({
      billingPhase: "trial",
      checkoutOffer: "pulse_trial_7d",
      limitUsdMicros: 4_500_000n,
      periodEnd: new Date("2026-04-08T12:00:00.000Z"),
      periodStart: new Date("2026-04-01T12:00:00.000Z"),
      pulseTrialPolicyVersion: "pulse-trial-2026-05-05-v1",
      spentUsdMicros: 2_000_000n,
      trialEndsAt: new Date("2026-04-08T12:00:00.000Z"),
      trialStartedAt: new Date("2026-04-01T12:00:00.000Z"),
    });

    await expect(resolveHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-04-08T12:00:01.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: false,
      limitUsdMicros: 4_500_000n,
      reason: "trial_expired_pending_billing",
      retryAfter: new Date("2026-04-08T12:15:01.000Z"),
      userNotice: {
        code: "trial_conversion_pending",
      },
    });
    expect(prisma.hostedAiUsagePeriod.createMany).not.toHaveBeenCalled();
  });

  it.each([
    [
      "unknown policy",
      {
        pulseTrialPolicyVersion: "old-policy",
        trialEndsAt: new Date("2026-04-08T12:00:00.000Z"),
        trialStartedAt: new Date("2026-04-01T12:00:00.000Z"),
      },
      0n,
    ],
    [
      "missing trial end",
      {
        pulseTrialPolicyVersion: "pulse-trial-2026-05-05-v1",
        trialEndsAt: null,
        trialStartedAt: new Date("2026-04-01T12:00:00.000Z"),
      },
      4_500_000n,
    ],
    [
      "reversed trial bounds",
      {
        pulseTrialPolicyVersion: "pulse-trial-2026-05-05-v1",
        trialEndsAt: new Date("2026-04-01T12:00:00.000Z"),
        trialStartedAt: new Date("2026-04-08T12:00:00.000Z"),
      },
      4_500_000n,
    ],
  ])("denies malformed Pulse Trial billing state for %s", async (_name, trialState, limitUsdMicros) => {
    const prisma = createGatePrisma({
      billingPhase: "trial",
      checkoutOffer: "pulse_trial_7d",
      limitUsdMicros: 4_500_000n,
      periodEnd: new Date("2026-04-08T12:00:00.000Z"),
      periodStart: new Date("2026-04-01T12:00:00.000Z"),
      spentUsdMicros: 0n,
      ...trialState,
    });

    await expect(resolveHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-04-03T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: false,
      limitUsdMicros,
      reason: "trial_expired_pending_billing",
      userNotice: {
        code: "trial_conversion_pending",
      },
    });
    expect(prisma.hostedAiUsagePeriod.createMany).not.toHaveBeenCalled();
  });

  it("denies Pulse Trial offers with no persisted trial phase instead of using paid fallback", async () => {
    const prisma = createGatePrisma({
      billingPhase: null,
      checkoutOffer: "pulse_trial_7d",
      periodEnd: new Date("2026-04-08T12:00:00.000Z"),
      periodStart: new Date("2026-04-01T12:00:00.000Z"),
      pulseTrialPolicyVersion: "pulse-trial-2026-05-05-v1",
      spentUsdMicros: 0n,
      trialEndsAt: new Date("2026-04-08T12:00:00.000Z"),
      trialStartedAt: new Date("2026-04-01T12:00:00.000Z"),
    });

    await expect(resolveHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-04-03T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: false,
      limitUsdMicros: 4_500_000n,
      reason: "trial_expired_pending_billing",
    });
    expect(prisma.hostedAiUsagePeriod.createMany).not.toHaveBeenCalled();
  });

  it("reports inactive access before stale-trial retry semantics for canceled trial members", async () => {
    const prisma = createGatePrisma({
      billingPhase: "trial",
      billingStatus: HostedBillingStatus.canceled,
      checkoutOffer: "pulse_trial_7d",
      periodEnd: new Date("2026-04-08T12:00:00.000Z"),
      periodStart: new Date("2026-04-01T12:00:00.000Z"),
      pulseTrialPolicyVersion: "pulse-trial-2026-05-05-v1",
      spentUsdMicros: 0n,
      trialEndsAt: new Date("2026-04-08T12:00:00.000Z"),
      trialStartedAt: new Date("2026-04-01T12:00:00.000Z"),
    });

    await expect(resolveHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-04-09T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: false,
      reason: "hosted_access_inactive",
      retryAfter: new Date("2026-04-09T12:15:00.000Z"),
      userNotice: null,
    });
    expect(prisma.hostedAiUsagePeriod.createMany).not.toHaveBeenCalled();
  });

  it("returns the normal Pulse allowance after a Pulse Trial converts to paid", async () => {
    const prisma = createGatePrisma({
      billingPhase: "paid",
      checkoutOffer: "pulse_trial_7d",
      periodEnd: new Date("2026-05-08T12:00:00.000Z"),
      periodStart: new Date("2026-04-08T12:00:00.000Z"),
      pulseTrialPolicyVersion: "pulse-trial-2026-05-05-v1",
      pulseTrialRedeemedAt: new Date("2026-04-01T12:00:00.000Z"),
      spentUsdMicros: 3_000_000n,
      trialEndsAt: new Date("2026-04-08T12:00:00.000Z"),
      trialStartedAt: new Date("2026-04-01T12:00:00.000Z"),
    });

    await expect(resolveHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-04-20T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: true,
      billingPlanCode: "launch_monthly",
      limitUsdMicros: 10_000_000n,
      periodEnd: new Date("2026-05-08T12:00:00.000Z"),
      periodStart: new Date("2026-04-08T12:00:00.000Z"),
      remainingUsdMicros: 7_000_000n,
      spentUsdMicros: 3_000_000n,
    });
  });

  it("raises the current period limit on upgrade without lowering spend", async () => {
    const update = vi.fn(async (args?: unknown) => {
      void args;
      return {
      billingPlanCode: "launch_edge_monthly",
      limitUsdMicros: 25_000_000n,
      periodEnd: new Date("2026-04-01T00:00:00.000Z"),
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
      spentUsdMicros: 14_000_000n,
      };
    });
    const prisma = createGatePrisma({
      billingPlanCode: "launch_edge_monthly",
      limitUsdMicros: 10_000_000n,
      periodEnd: new Date("2026-04-01T00:00:00.000Z"),
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
      spentUsdMicros: 14_000_000n,
      update,
    });

    await expect(resolveHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-03-29T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: true,
      billingPlanCode: "launch_edge_monthly",
      limitUsdMicros: 25_000_000n,
      remainingUsdMicros: 11_000_000n,
    });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        blockedAt: null,
        limitNoticeSentAt: null,
        limitUsdMicros: 25_000_000n,
      }),
    }));
    const updateData = (update.mock.calls[0]?.[0] as { data?: Record<string, unknown> } | undefined)
      ?.data;
    expect(updateData).not.toHaveProperty("spentUsdMicros");
  });

  it("uses occurredAt ledger spend for billing periods without relocating usage rows", async () => {
    const queryRaw = vi.fn(async (sql: TemplateStringsArray) => {
      void sql;
      return [];
    });
    const aggregate = vi.fn(async () => ({
      _max: {
        occurredAt: new Date("2026-04-20T12:00:00.000Z"),
      },
      _sum: {
        allowanceCostUsdMicros: 11_000_000n,
      },
    }));
    const update = vi.fn(async (args?: unknown) => {
      void args;
      return undefined;
    });
    const prisma = createGatePrisma({
      aggregate,
      findUniquePeriod: {
        billingPlanCode: "launch_monthly",
        limitUsdMicros: 10_000_000n,
        periodEnd: new Date("2026-05-15T00:00:00.000Z"),
        periodStart: new Date("2026-04-15T00:00:00.000Z"),
        spentUsdMicros: 11_000_000n,
      },
      periodEnd: new Date("2026-05-15T00:00:00.000Z"),
      periodStart: new Date("2026-04-15T00:00:00.000Z"),
      queryRaw,
      spentUsdMicros: 5_000_000n,
      update,
    });

    await expect(resolveHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-04-20T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: false,
      periodEnd: new Date("2026-05-15T00:00:00.000Z"),
      periodStart: new Date("2026-04-15T00:00:00.000Z"),
      reason: "ai_usage_limit_exceeded",
      spentUsdMicros: 11_000_000n,
    });
    expect(queryRaw).toHaveBeenCalledTimes(1);
    const queryRawSql = queryRaw.mock.calls.map(([sql]) =>
      Array.isArray(sql) ? sql.join("") : String(sql)
    );
    expect(queryRawSql[0]).toContain('FROM "hosted_ai_usage_period"');
    expect(queryRawSql[0]).toContain("FOR UPDATE");
    expect(queryRawSql.join("\n")).not.toContain('WITH "candidates"');
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(aggregate).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        allowanceAccountedAt: { not: null },
        allowanceCounted: true,
        memberId: "member_123",
        occurredAt: {
          gte: new Date("2026-04-15T00:00:00.000Z"),
          lt: new Date("2026-05-15T00:00:00.000Z"),
        },
      }),
    }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        blockedAt: new Date("2026-04-20T12:00:00.000Z"),
      }),
    }));
    const updateData = (update.mock.calls[0]?.[0] as { data?: Record<string, unknown> } | undefined)
      ?.data;
    expect(updateData).not.toHaveProperty("lastUsageAt");
    expect(updateData).not.toHaveProperty("spentUsdMicros");
  });
});

describe("readHostedAiUsageGate", () => {
  it("reads gate state without creating or updating usage-period rows", async () => {
    const aggregate = vi.fn(async () => ({
      _max: {
        occurredAt: new Date("2026-03-29T12:00:00.000Z"),
      },
      _sum: {
        allowanceCostUsdMicros: 11_000_000n,
      },
    }));
    const prisma = createGatePrisma({
      aggregate,
      findUniquePeriod: null,
      spentUsdMicros: 0n,
    });

    await expect(readHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-03-29T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: false,
      reason: "ai_usage_limit_exceeded",
      spentUsdMicros: 11_000_000n,
    });

    expect(prisma.hostedAiUsagePeriod.createMany).not.toHaveBeenCalled();
    expect(prisma.hostedAiUsagePeriod.update).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(
      aggregate.mock.invocationCallOrder[0],
    ).toBeLessThan(
      prisma.hostedAiUsagePeriod.findUnique.mock.invocationCallOrder[0],
    );
    expect(aggregate).toHaveBeenCalledTimes(1);
    expect(aggregate).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        allowanceAccountedAt: { not: null },
        allowanceCounted: true,
        memberId: "member_123",
        occurredAt: {
          gte: new Date("2026-03-01T00:00:00.000Z"),
          lt: new Date("2026-04-01T00:00:00.000Z"),
        },
      }),
    }));
  });

  it("uses occurredAt ledger spend for billing periods before allowing", async () => {
    const aggregate = vi.fn(async () => ({
      _max: {
        occurredAt: new Date("2026-04-20T12:00:00.000Z"),
      },
      _sum: {
        allowanceCostUsdMicros: 11_000_000n,
      },
    }));
    const prisma = createGatePrisma({
      aggregate,
      findUniquePeriod: {
        billingPlanCode: "launch_monthly",
        limitUsdMicros: 10_000_000n,
        periodEnd: new Date("2026-05-15T00:00:00.000Z"),
        periodStart: new Date("2026-04-15T00:00:00.000Z"),
        spentUsdMicros: 5_000_000n,
      },
      periodEnd: new Date("2026-05-15T00:00:00.000Z"),
      periodStart: new Date("2026-04-15T00:00:00.000Z"),
      spentUsdMicros: 5_000_000n,
    });

    await expect(readHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-04-20T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: false,
      reason: "ai_usage_limit_exceeded",
      spentUsdMicros: 11_000_000n,
    });

    expect(prisma.hostedAiUsagePeriod.createMany).not.toHaveBeenCalled();
    expect(prisma.hostedAiUsagePeriod.update).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(
      aggregate.mock.invocationCallOrder[0],
    ).toBeLessThan(
      prisma.hostedAiUsagePeriod.findUnique.mock.invocationCallOrder[0],
    );
    expect(aggregate).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        allowanceAccountedAt: { not: null },
        allowanceCounted: true,
        memberId: "member_123",
        occurredAt: {
          gte: new Date("2026-04-15T00:00:00.000Z"),
          lt: new Date("2026-05-15T00:00:00.000Z"),
        },
      }),
    }));
  });

  it("uses ledger spend when a Pulse Trial period row is stale without writing", async () => {
    const aggregate = vi.fn(async () => ({
      _max: {
        occurredAt: new Date("2026-04-03T13:00:00.000Z"),
      },
      _sum: {
        allowanceCostUsdMicros: 6_500_000n,
      },
    }));
    const prisma = createGatePrisma({
      aggregate,
      billingPhase: "trial",
      checkoutOffer: "pulse_trial_7d",
      findUniquePeriod: {
        billingPlanCode: "launch_monthly",
        limitUsdMicros: 4_500_000n,
        periodEnd: new Date("2026-04-08T12:00:00.000Z"),
        periodStart: new Date("2026-04-01T12:00:00.000Z"),
        spentUsdMicros: 1_700_000n,
      },
      limitUsdMicros: 4_500_000n,
      periodEnd: new Date("2026-04-08T12:00:00.000Z"),
      periodStart: new Date("2026-04-01T12:00:00.000Z"),
      pulseTrialPolicyVersion: "pulse-trial-2026-05-05-v1",
      spentUsdMicros: 1_700_000n,
      trialEndsAt: new Date("2026-04-08T12:00:00.000Z"),
      trialStartedAt: new Date("2026-04-01T12:00:00.000Z"),
    });

    await expect(readHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-04-03T13:05:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: false,
      reason: "ai_usage_limit_exceeded",
      spentUsdMicros: 6_500_000n,
      userNotice: {
        code: "trial_usage_limit_reached",
      },
    });

    expect(prisma.hostedAiUsagePeriod.update).not.toHaveBeenCalled();
    expect(aggregate).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        allowanceAccountedAt: { not: null },
        allowanceCounted: true,
        memberId: "member_123",
        occurredAt: {
          gte: new Date("2026-04-01T12:00:00.000Z"),
          lt: new Date("2026-04-08T12:00:00.000Z"),
        },
      }),
    }));
  });
});

describe("checkHostedAiUsageGate", () => {
  it("serves allow decisions from the read gate without usage-period writes", async () => {
    const prisma = createGatePrisma({
      spentUsdMicros: 9_000_000n,
    });

    await expect(checkHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-03-29T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: true,
      remainingUsdMicros: 1_000_000n,
      spentUsdMicros: 9_000_000n,
    });

    expect(prisma.hostedAiUsagePeriod.createMany).not.toHaveBeenCalled();
    expect(prisma.hostedAiUsagePeriod.update).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("confirms read denials with the mutating gate before reporting them", async () => {
    const prisma = createGatePrisma({
      spentUsdMicros: 10_000_000n,
    });
    // createGatePrisma queues single-gate-call member lookups; the check gate
    // runs read + resolve, so both legs need the same active member state.
    prisma.hostedMember.findUnique = vi.fn(async () => ({
      billingRef: {
        currentBillingPhase: null,
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: null,
        currentPeriodEnd: new Date("2026-04-01T00:00:00.000Z"),
        currentPeriodStart: new Date("2026-03-01T00:00:00.000Z"),
        currentTrialEndsAt: null,
        currentTrialStartedAt: null,
        pulseTrialPolicyVersion: null,
        pulseTrialRedeemedAt: null,
        scheduledBillingEffectiveAt: null,
        scheduledBillingPlanCode: null,
      },
      billingStatus: HostedBillingStatus.active,
      suspendedAt: null,
    }));

    await expect(checkHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-03-29T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: false,
      reason: "ai_usage_limit_exceeded",
      spentUsdMicros: 10_000_000n,
    });

    // The denial escalated to the mutating gate: the resolve leg re-reads
    // member state after the read leg's single lookup.
    expect(
      prisma.hostedMember.findUnique.mock.calls.length,
    ).toBeGreaterThan(1);
  });

  it("confirms read denials and records blocked metadata from ledger spend", async () => {
    const update = vi.fn(async (args?: unknown) => {
      void args;
      return undefined;
    });
    const prisma = createGatePrisma({
      spentUsdMicros: 10_000_000n,
      update,
    });
    // createGatePrisma queues single-gate-call member lookups; the check gate
    // runs read + resolve, so both legs need the same active member state.
    prisma.hostedMember.findUnique = vi.fn(async () => ({
      billingRef: {
        currentBillingPhase: null,
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: null,
        currentPeriodEnd: new Date("2026-04-01T00:00:00.000Z"),
        currentPeriodStart: new Date("2026-03-01T00:00:00.000Z"),
        currentTrialEndsAt: null,
        currentTrialStartedAt: null,
        pulseTrialPolicyVersion: null,
        pulseTrialRedeemedAt: null,
        scheduledBillingEffectiveAt: null,
        scheduledBillingPlanCode: null,
      },
      billingStatus: HostedBillingStatus.active,
      suspendedAt: null,
    }));
    await expect(checkHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-03-29T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: false,
      reason: "ai_usage_limit_exceeded",
      spentUsdMicros: 10_000_000n,
    });

    expect(prisma.hostedAiUsagePeriod.createMany).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        blockedAt: new Date("2026-03-29T12:00:00.000Z"),
      }),
    }));
    const updateData = (update.mock.calls[0]?.[0] as { data?: Record<string, unknown> } | undefined)
      ?.data;
    expect(updateData).not.toHaveProperty("lastUsageAt");
    expect(updateData).not.toHaveProperty("spentUsdMicros");
  });
});

describe("claimHostedAiUsageLimitNotice", () => {
  it("claims the usage-period limit notice once", async () => {
    const updateMany = vi.fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const prisma = {
      hostedAiUsagePeriod: {
        updateMany,
      },
    };

    await expect(claimHostedAiUsageLimitNotice({
      memberId: "member_123",
      periodStart: "2026-03-01T00:00:00.000Z",
      prisma: prisma as never,
      sentAt: "2026-03-29T12:00:00.000Z",
    })).resolves.toBe(true);

    await expect(claimHostedAiUsageLimitNotice({
      memberId: "member_123",
      periodStart: "2026-03-01T00:00:00.000Z",
      prisma: prisma as never,
      sentAt: "2026-03-29T12:00:01.000Z",
    })).resolves.toBe(false);

    expect(updateMany).toHaveBeenNthCalledWith(1, {
      data: {
        limitNoticeSentAt: new Date("2026-03-29T12:00:00.000Z"),
      },
      where: {
        AND: [
          {
            periodStart: {
              lte: new Date("2026-03-29T12:00:00.000Z"),
            },
          },
          {
            periodEnd: {
              gt: new Date("2026-03-29T12:00:00.000Z"),
            },
          },
        ],
        blockedAt: {
          not: null,
        },
        limitNoticeSentAt: null,
        memberId: "member_123",
        periodStart: new Date("2026-03-01T00:00:00.000Z"),
      },
    });
  });
});

describe("releaseHostedAiUsageLimitNotice", () => {
  it("clears only a claim with the exact sentAt timestamp", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const prisma = {
      hostedAiUsagePeriod: {
        updateMany,
      },
    };

    await releaseHostedAiUsageLimitNotice({
      memberId: "member_123",
      periodStart: "2026-03-01T00:00:00.000Z",
      prisma: prisma as never,
      sentAt: "2026-03-29T12:00:00.000Z",
    });

    expect(updateMany).toHaveBeenCalledWith({
      data: {
        limitNoticeSentAt: null,
      },
      where: {
        limitNoticeSentAt: new Date("2026-03-29T12:00:00.000Z"),
        memberId: "member_123",
        periodStart: new Date("2026-03-01T00:00:00.000Z"),
      },
    });
  });
});

function createAllowanceTx(input: {
  billingPhase?: string | null;
  billingPlanCode?: string;
  checkoutOffer?: string | null;
  executeRaw: AllowanceExecuteRawMock;
  hostedAiUsageAggregate?: ReturnType<typeof vi.fn>;
  hostedAiUsageUpdateMany: ReturnType<typeof vi.fn>;
  limitUsdMicros?: bigint;
  pulseTrialPolicyVersion?: string | null;
  pulseTrialRedeemedAt?: Date | null;
  trialEndsAt?: Date | null;
  trialStartedAt?: Date | null;
}) {
  const defaultAggregate = vi.fn()
    .mockResolvedValueOnce({
      _max: {
        occurredAt: null,
      },
      _sum: {
        allowanceCostUsdMicros: null,
      },
    })
    .mockResolvedValue({
      _max: {
        occurredAt: new Date("2026-03-29T12:00:00.000Z"),
      },
      _sum: {
        allowanceCostUsdMicros: 1896n,
      },
    });

  return {
    $executeRaw: input.executeRaw,
    $queryRaw: vi.fn(async () => []),
    hostedAiUsage: {
      aggregate: input.hostedAiUsageAggregate ?? defaultAggregate,
      updateMany: input.hostedAiUsageUpdateMany,
    },
    hostedAiUsagePeriod: {
      createMany: vi.fn(async () => ({ count: 1 })),
      findUniqueOrThrow: vi.fn(async () => ({
        billingPlanCode: input.billingPlanCode ?? "launch_monthly",
        blockedAt: null,
        lastUsageAt: null,
        limitUsdMicros: input.limitUsdMicros ?? 10_000_000n,
        periodEnd: new Date("2026-04-01T00:00:00.000Z"),
        periodStart: new Date("2026-03-01T00:00:00.000Z"),
      })),
      update: vi.fn(async () => undefined),
    },
    hostedMember: {
      findUnique: vi.fn(async () => ({
        billingRef: {
          currentBillingPhase: input.billingPhase ?? null,
          currentBillingPlanCode: input.billingPlanCode ?? "launch_monthly",
          currentCheckoutOffer: input.checkoutOffer ?? null,
          currentPeriodEnd: new Date("2026-04-01T00:00:00.000Z"),
          currentPeriodStart: new Date("2026-03-01T00:00:00.000Z"),
          currentTrialEndsAt: input.trialEndsAt ?? null,
          currentTrialStartedAt: input.trialStartedAt ?? null,
          pulseTrialPolicyVersion: input.pulseTrialPolicyVersion ?? null,
          pulseTrialRedeemedAt: input.pulseTrialRedeemedAt ?? null,
        },
        id: "member_123",
      })),
    },
  };
}

function createGatePrisma(input: {
  aggregate?: ReturnType<typeof vi.fn>;
  billingPhase?: string | null;
  billingPlanCode?: string;
  billingStatus?: HostedBillingStatus;
  checkoutOffer?: string | null;
  executeRaw?: ReturnType<typeof vi.fn>;
  findUniquePeriod?: {
    billingPlanCode: string;
    blockedAt?: Date | null;
    lastUsageAt?: Date | null;
    limitUsdMicros: bigint;
    periodEnd: Date;
    periodStart: Date;
    spentUsdMicros: bigint;
  } | null;
  limitUsdMicros?: bigint;
  periodEnd?: Date;
  periodStart?: Date;
  pulseTrialPolicyVersion?: string | null;
  pulseTrialRedeemedAt?: Date | null;
  queryRaw?: ReturnType<typeof vi.fn>;
  scheduledBillingEffectiveAt?: Date | null;
  scheduledBillingPlanCode?: string | null;
  spentUsdMicros: bigint;
  trialEndsAt?: Date | null;
  trialStartedAt?: Date | null;
  suspendedAt?: Date | null;
  update?: ReturnType<typeof vi.fn>;
}) {
  const periodStart = input.periodStart ?? new Date("2026-03-01T00:00:00.000Z");
  const periodEnd = input.periodEnd ?? new Date("2026-04-01T00:00:00.000Z");
  const defaultPeriod = {
    billingPlanCode: input.billingPlanCode ?? "launch_monthly",
    blockedAt: null,
    lastUsageAt: input.spentUsdMicros > 0n
      ? new Date(periodStart.getTime() + 60_000)
      : null,
    limitUsdMicros: input.limitUsdMicros ?? 10_000_000n,
    periodEnd,
    periodStart,
    spentUsdMicros: input.spentUsdMicros,
  };

  return {
    $executeRaw: input.executeRaw ?? vi.fn(async () => 1),
    $queryRaw: input.queryRaw ?? vi.fn(async () => []),
    hostedAiUsage: {
      aggregate: input.aggregate ?? vi.fn(async () => ({
        _max: {
          occurredAt: input.spentUsdMicros > 0n
            ? new Date(periodStart.getTime() + 60_000)
            : null,
        },
        _sum: {
          allowanceCostUsdMicros: input.spentUsdMicros,
        },
      })),
    },
    hostedAiUsagePeriod: {
      createMany: vi.fn(async () => ({ count: 1 })),
      delete: vi.fn(async () => undefined),
      findUnique: vi.fn(async () =>
        input.findUniquePeriod === undefined
          ? defaultPeriod
          : input.findUniquePeriod
      ),
      findUniqueOrThrow: vi.fn(async () => input.findUniquePeriod ?? defaultPeriod),
      update: input.update ?? vi.fn(async (args?: {
        data?: {
          billingPlanCode?: string;
          limitUsdMicros?: bigint;
          periodEnd?: Date;
        };
      }) => ({
        billingPlanCode: args?.data?.billingPlanCode ?? defaultPeriod.billingPlanCode,
        limitUsdMicros: args?.data?.limitUsdMicros ?? defaultPeriod.limitUsdMicros,
        periodEnd: args?.data?.periodEnd ?? defaultPeriod.periodEnd,
        periodStart: defaultPeriod.periodStart,
      })),
    },
    hostedMember: {
      findUnique: vi.fn()
        .mockResolvedValueOnce({
          billingRef: {
            currentBillingPhase: input.billingPhase ?? null,
            currentBillingPlanCode: input.billingPlanCode ?? "launch_monthly",
            currentCheckoutOffer: input.checkoutOffer ?? null,
            currentPeriodEnd: periodEnd,
            currentPeriodStart: periodStart,
            currentTrialEndsAt: input.trialEndsAt ?? null,
            currentTrialStartedAt: input.trialStartedAt ?? null,
            pulseTrialPolicyVersion: input.pulseTrialPolicyVersion ?? null,
            pulseTrialRedeemedAt: input.pulseTrialRedeemedAt ?? null,
            scheduledBillingEffectiveAt: input.scheduledBillingEffectiveAt ?? null,
            scheduledBillingPlanCode: input.scheduledBillingPlanCode ?? null,
          },
          billingStatus: input.billingStatus ?? HostedBillingStatus.active,
          suspendedAt: input.suspendedAt ?? null,
        })
        .mockResolvedValueOnce({
          billingRef: {
            currentBillingPhase: input.billingPhase ?? null,
            currentBillingPlanCode: input.billingPlanCode ?? "launch_monthly",
            currentCheckoutOffer: input.checkoutOffer ?? null,
            currentPeriodEnd: periodEnd,
            currentPeriodStart: periodStart,
            currentTrialEndsAt: input.trialEndsAt ?? null,
            currentTrialStartedAt: input.trialStartedAt ?? null,
            pulseTrialPolicyVersion: input.pulseTrialPolicyVersion ?? null,
            pulseTrialRedeemedAt: input.pulseTrialRedeemedAt ?? null,
            scheduledBillingEffectiveAt: input.scheduledBillingEffectiveAt ?? null,
            scheduledBillingPlanCode: input.scheduledBillingPlanCode ?? null,
          },
          id: "member_123",
        }),
    },
  };
}
