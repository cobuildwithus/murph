import { HostedBillingStatus } from "@prisma/client";
import {
  HOSTED_AI_USAGE_ALLOWANCE_PRICED_MODELS,
} from "@murphai/hosted-execution/runtime-control";
import {
  buildHostedTranscriptionUsageRecord,
  buildHostedXaiSearchUsageRecord,
  parseAssistantUsageRecord,
  ASSISTANT_IDLE_COMPACTION_USAGE_ESTIMATE_SOURCE_PATH,
  ASSISTANT_IDLE_COMPACTION_USAGE_ESTIMATE_VERSION,
  type AssistantUsageRecord,
} from "@murphai/hosted-execution/assistant-usage";
import {
  parseHostedRuntimeUsageRecordRequest,
} from "@murphai/hosted-execution/parsers";
import { beforeEach, describe, expect, it, vi } from "vitest";

const usageCreditMocks = vi.hoisted(() => ({
  admitHostedGroupSponsorshipRefillTx: vi.fn(),
  settleHostedUsageCreditForUsageTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/usage-credits", () => ({
  settleHostedUsageCreditForUsageTx:
    usageCreditMocks.settleHostedUsageCreditForUsageTx,
}));

vi.mock("@/src/lib/hosted-groups/group-sponsorship-authorization", () => ({
  admitHostedGroupSponsorshipRefillTx:
    usageCreditMocks.admitHostedGroupSponsorshipRefillTx,
}));

import {
  accountHostedAiUsageForAllowanceTx,
  checkHostedAiUsageGate,
  priceHostedAiUsageForAllowance,
  readHostedAiUsageGate,
  readHostedAiUsageGateSnapshots,
  reconcileHostedAiUsageAllowancePeriodForMemberTx,
  reconcileHostedAiUsageGateForBillingModeChangeTx,
  resolveHostedAiUsageGate,
} from "@/src/lib/hosted-execution/usage-allowance";
import { buildHostedRetellPhoneCallUsageRecord } from "@/src/lib/hosted-execution/usage-retell";

const DIRECT_PULSE_ALLOWANCE_USD_MICROS = 6_400_000n;
const DIRECT_EDGE_ALLOWANCE_USD_MICROS = 16_000_000n;
const DIRECT_MAX_ALLOWANCE_USD_MICROS = 40_000_000n;
const FAMILY_PULSE_ALLOWANCE_USD_MICROS = 5_600_000n;
const FAMILY_EDGE_ALLOWANCE_USD_MICROS = 15_200_000n;
const FAMILY_MAX_ALLOWANCE_USD_MICROS = 39_200_000n;

beforeEach(() => {
  usageCreditMocks.admitHostedGroupSponsorshipRefillTx.mockReset();
  usageCreditMocks.admitHostedGroupSponsorshipRefillTx.mockResolvedValue(null);
  usageCreditMocks.settleHostedUsageCreditForUsageTx.mockReset();
  usageCreditMocks.settleHostedUsageCreditForUsageTx.mockImplementation(
    async (input: { debitUsdMicros: bigint }) => ({
      absorbedUsdMicros: input.debitUsdMicros,
      balanceUsdMicros: 0n,
      debitedUsdMicros: 0n,
      ledgerVersion: 0n,
    }),
  );
});

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
  requestedModel: "gpt-5.6-terra",
  routeId: "primary",
  schema: "murph.assistant-usage.v1",
  servedModel: "gpt-5.6-terra",
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

// Wire-compatibility fixture: the EXACT JSON body the Cloudflare interceptor
// POSTs to /api/internal/hosted-execution/usage/record after a successful xAI
// x_search response. apps/cloudflare/test/runner-egress-intercept.test.ts
// carries a byte-for-byte copy (HOSTED_XAI_SEARCH_USAGE_WIRE_FIXTURE) and
// asserts the interceptor's posted body equals it exactly, so a wire-format
// mismatch between what the Worker posts and what this route-parse +
// allowance-accounting path books fails one of the two suites. Keep both
// copies identical. The turn id, usage id, session id, and occurredAt are
// deterministic placeholders for the per-call dynamic values.
const HOSTED_XAI_SEARCH_USAGE_WIRE_FIXTURE = {
  usage: {
    apiKeyEnv: "XAI_API_KEY",
    attemptCount: 1,
    baseUrl: "https://api.x.ai",
    cacheWriteTokens: null,
    cachedInputTokens: null,
    credentialSource: "platform",
    featureKey: "x-search",
    gatewayTags: [],
    inputTokens: null,
    memberId: "member_123",
    occurredAt: "2026-03-29T12:00:00.000Z",
    outputTokens: null,
    provider: "xai",
    providerName: "xAI",
    providerRequestId: "resp_xai_123",
    rawUsageJson: {
      cost_in_usd_ticks: 987_654_321,
      input_tokens: 900,
      input_tokens_details: { cached_tokens: 100 },
      output_tokens: 120,
      output_tokens_details: { reasoning_tokens: 40 },
    },
    rawUsageJsonHash: null,
    reasoningTokens: null,
    reportingUserId: null,
    requestedModel: "grok-4.5",
    routeId: null,
    schema: "murph.assistant-usage.v1",
    servedModel: null,
    sessionId: "turn_xai_search_00000000000000000000000000000000",
    stripeMeterSource: "murph",
    surface: "hosted-runner",
    tokenPricingBasis: "standard",
    totalTokens: null,
    triggerKind: "x-search",
    turnId: "turn_xai_search_00000000000000000000000000000000",
    turnProfileJson: null,
    usageId: "turn_xai_search_00000000000000000000000000000000.attempt-1",
    usageExtractionSourcePath: "xai.responses",
    usageExtractionVersion: "xai-x-search-v1",
  },
} as const;

function cloneHostedXaiSearchUsageWireBody(): {
  usage: Record<string, unknown> & { rawUsageJson: Record<string, unknown> };
} {
  return JSON.parse(JSON.stringify(HOSTED_XAI_SEARCH_USAGE_WIRE_FIXTURE)) as {
    usage: Record<string, unknown> & { rawUsageJson: Record<string, unknown> };
  };
}

type AllowanceExecuteRaw = (sql: TemplateStringsArray, ...params: unknown[]) => Promise<number>;
type AllowanceExecuteRawMock = ReturnType<typeof vi.fn<AllowanceExecuteRaw>>;
type AllowanceQueryRaw = (
  sql: TemplateStringsArray,
  ...params: unknown[]
) => Promise<unknown[]>;

function buildMalformedOpenAiImageUsageRecords(input: {
  occurredAt?: AssistantUsageRecord["occurredAt"];
} = {}): AssistantUsageRecord[] {
  const occurredAt = input.occurredAt ?? BASE_USAGE_RECORD.occurredAt;

  return [
    {
      ...BASE_USAGE_RECORD,
      cachedInputTokens: null,
      inputTokens: null,
      occurredAt,
      outputTokens: null,
      provider: "openai-images",
      providerName: "OpenAI Images",
      rawUsageJson: null,
      requestedModel: "gpt-image-2",
      servedModel: null,
      totalTokens: null,
      usageExtractionSourcePath: "openai.images.generate",
      usageExtractionVersion: "openai-images-v1",
    },
    {
      ...BASE_USAGE_RECORD,
      cachedInputTokens: 100,
      inputTokens: 1_300,
      occurredAt,
      outputTokens: null,
      provider: "openai-images",
      providerName: "OpenAI Images",
      rawUsageJson: {
        input_tokens: 1_300,
        input_tokens_details: {
          cached_tokens: 100,
          image_tokens: 1_000,
          text_tokens: 300,
        },
        total_tokens: 1_300,
      },
      requestedModel: "gpt-image-2",
      servedModel: null,
      totalTokens: 1_300,
      usageExtractionSourcePath: "openai.images.generate",
      usageExtractionVersion: "openai-images-v1",
    },
    {
      ...BASE_USAGE_RECORD,
      cachedInputTokens: null,
      inputTokens: null,
      occurredAt,
      outputTokens: 400,
      provider: "openai-images",
      providerName: "OpenAI Images",
      rawUsageJson: {
        output_tokens: 400,
        output_tokens_details: {
          image_tokens: 400,
          reasoning_tokens: 0,
          text_tokens: 0,
        },
        total_tokens: 400,
      },
      requestedModel: "gpt-image-2",
      servedModel: null,
      totalTokens: 400,
      usageExtractionSourcePath: "openai.images.generate",
      usageExtractionVersion: "openai-images-v1",
    },
  ] satisfies AssistantUsageRecord[];
}

function buildInconsistentOpenAiImageUsageRecords(): AssistantUsageRecord[] {
  return [
    {
      ...BASE_USAGE_RECORD,
      cachedInputTokens: 0,
      inputTokens: 100,
      outputTokens: 400,
      provider: "openai-images",
      providerName: "OpenAI Images",
      rawUsageJson: {
        input_tokens: 101,
        output_tokens: 400,
        total_tokens: 500,
      },
      requestedModel: "gpt-image-2",
      servedModel: null,
      totalTokens: 500,
      usageExtractionSourcePath: "openai.images.generate",
      usageExtractionVersion: "openai-images-v1",
    },
    {
      ...BASE_USAGE_RECORD,
      cachedInputTokens: 0,
      inputTokens: 100,
      outputTokens: 400,
      provider: "openai-images",
      providerName: "OpenAI Images",
      rawUsageJson: {
        input_tokens: 100,
        input_tokens_details: {
          cached_tokens: 0,
          image_tokens: 0,
          text_tokens: 300,
        },
        output_tokens: 400,
        total_tokens: 500,
      },
      requestedModel: "gpt-image-2",
      servedModel: null,
      totalTokens: 500,
      usageExtractionSourcePath: "openai.images.generate",
      usageExtractionVersion: "openai-images-v1",
    },
    {
      ...BASE_USAGE_RECORD,
      cachedInputTokens: 150,
      inputTokens: 100,
      outputTokens: 400,
      provider: "openai-images",
      providerName: "OpenAI Images",
      rawUsageJson: {
        input_tokens: 100,
        input_tokens_details: {
          cached_tokens: 150,
          image_tokens: 0,
          text_tokens: 100,
        },
        output_tokens: 400,
        total_tokens: 500,
      },
      requestedModel: "gpt-image-2",
      servedModel: null,
      totalTokens: 500,
      usageExtractionSourcePath: "openai.images.generate",
      usageExtractionVersion: "openai-images-v1",
    },
    {
      ...BASE_USAGE_RECORD,
      cachedInputTokens: 0,
      inputTokens: 100,
      outputTokens: 400,
      provider: "openai-images",
      providerName: "OpenAI Images",
      rawUsageJson: {
        input_tokens: 100,
        input_tokens_details: {
          cached_tokens: 0,
          image_tokens: 0,
          text_tokens: 100,
        },
        output_tokens: 400,
        output_tokens_details: {
          image_tokens: 399,
          reasoning_tokens: 0,
          text_tokens: 0,
        },
        total_tokens: 500,
      },
      requestedModel: "gpt-image-2",
      servedModel: null,
      totalTokens: 500,
      usageExtractionSourcePath: "openai.images.generate",
      usageExtractionVersion: "openai-images-v1",
    },
    {
      ...BASE_USAGE_RECORD,
      cachedInputTokens: 0,
      inputTokens: 100,
      outputTokens: 400,
      provider: "openai-images",
      providerName: "OpenAI Images",
      rawUsageJson: {
        input_tokens: 100,
        output_tokens: 400,
        total_tokens: 999,
      },
      requestedModel: "gpt-image-2",
      servedModel: null,
      totalTokens: 999,
      usageExtractionSourcePath: "openai.images.generate",
      usageExtractionVersion: "openai-images-v1",
    },
  ] satisfies AssistantUsageRecord[];
}

function buildAggregateOnlyOpenAiImageUsageRecord(): AssistantUsageRecord {
  return {
    ...BASE_USAGE_RECORD,
    cachedInputTokens: 0,
    inputTokens: 120,
    outputTokens: 40,
    provider: "openai-images",
    providerName: "OpenAI Images",
    rawUsageJson: {
      input_tokens: 120,
      output_tokens: 40,
      total_tokens: 160,
    },
    requestedModel: "openai/gpt-image-2",
    servedModel: null,
    totalTokens: 160,
    usageExtractionSourcePath: "openai.images.edit",
    usageExtractionVersion: "openai-images-v1",
  } satisfies AssistantUsageRecord;
}

describe("hosted AI usage allowance pricing", () => {
  it("prices platform usage from uncached input, cached input, and output tokens", () => {
    expect(priceHostedAiUsageForAllowance(BASE_USAGE_RECORD)).toMatchObject({
      costUsdMicros: 759n,
      counted: true,
      pricingSnapshot: {
        standardCostUsdMicros: "759",
        tokenPricingAdjustment: {
          denominator: "1",
          numerator: "1",
        },
        tokenPricingBasis: "standard",
      },
      pricingVersion: "openai-api-pricing-2026-07-30-gpt-5.6-standard",
    });
  });

  it("prices OpenAI flex token usage at 50% for allowance accounting", () => {
    expect(priceHostedAiUsageForAllowance({
      ...BASE_USAGE_RECORD,
      tokenPricingBasis: "openai-flex",
    })).toMatchObject({
      costUsdMicros: 380n,
      counted: true,
      pricingSnapshot: {
        standardCostUsdMicros: "759",
        tokenPricingAdjustment: {
          denominator: "2",
          numerator: "1",
        },
        tokenPricingBasis: "openai-flex",
      },
      pricingVersion: "openai-api-pricing-2026-07-30-gpt-5.6-openai-flex",
    });
  });

  it("prices GPT-5.6 model slugs with official standard and flex accounting", () => {
    expect(priceHostedAiUsageForAllowance({
      ...BASE_USAGE_RECORD,
      requestedModel: "gpt-5.6-terra",
      servedModel: "openai/gpt-5.6-terra-2026-07-08",
    })).toMatchObject({
      costUsdMicros: 759n,
      counted: true,
      pricingSnapshot: {
        model: "gpt-5.6-terra",
        modelSource: "served",
        pricingSource: "https://developers.openai.com/api/docs/pricing",
        ratesUsdMicrosPerMillionTokens: {
          cachedInput: "200000",
          cacheWrite: "2500000",
          input: "2000000",
          output: "12000000",
        },
        requestedModel: "gpt-5.6-terra",
        servedModel: "openai/gpt-5.6-terra-2026-07-08",
        tokenPricingBasis: "standard",
      },
      pricingVersion: "openai-api-pricing-2026-07-30-gpt-5.6-standard",
    });

    expect(priceHostedAiUsageForAllowance({
      ...BASE_USAGE_RECORD,
      providerName: "hosted-openai",
      requestedModel: "gpt-5.6-luna",
      servedModel: "gpt-5.6-luna",
      tokenPricingBasis: "openai-flex",
    })).toMatchObject({
      costUsdMicros: 39n,
      counted: true,
      pricingSnapshot: {
        model: "gpt-5.6-luna",
        pricingSource: "https://developers.openai.com/api/docs/pricing",
        ratesUsdMicrosPerMillionTokens: {
          cachedInput: "20000",
          cacheWrite: "250000",
          input: "200000",
          output: "1200000",
        },
        tokenPricingAdjustment: {
          denominator: "2",
          numerator: "1",
        },
        tokenPricingBasis: "openai-flex",
      },
      pricingVersion: "openai-api-pricing-2026-07-30-gpt-5.6-openai-flex",
    });
  });

  it("prices the code-owned GPT-5.5 maintenance target at the official standard rate", () => {
    expect(priceHostedAiUsageForAllowance({
      ...BASE_USAGE_RECORD,
      providerName: "hosted-openai",
      requestedModel: "gpt-5.5",
      servedModel: "gpt-5.5",
      tokenPricingBasis: "standard",
    })).toMatchObject({
      costUsdMicros: 1_896n,
      counted: true,
      pricingSnapshot: {
        model: "gpt-5.5",
        pricingSource: "https://developers.openai.com/api/docs/pricing",
        ratesUsdMicrosPerMillionTokens: {
          cachedInput: "500000",
          input: "5000000",
          output: "30000000",
        },
        tokenPricingBasis: "standard",
      },
      pricingVersion: "openai-api-pricing-2026-08-20-gpt-5.5-standard",
    });
  });

  it("prices canonical model reroutes from the served model", () => {
    expect(priceHostedAiUsageForAllowance({
      ...BASE_USAGE_RECORD,
      requestedModel: "gpt-5.6-luna",
      servedModel: "gpt-5.6-sol",
    })).toMatchObject({
      costUsdMicros: 1_896n,
      counted: true,
      pricingSnapshot: {
        model: "gpt-5.6-sol",
        modelSource: "served",
        requestedModel: "gpt-5.6-luna",
        servedModel: "gpt-5.6-sol",
      },
    });

    expect(priceHostedAiUsageForAllowance({
      ...BASE_USAGE_RECORD,
      requestedModel: "gpt-5.6-sol",
      servedModel: "gpt-5.6-luna",
    })).toMatchObject({
      costUsdMicros: 77n,
      counted: true,
      pricingSnapshot: {
        model: "gpt-5.6-luna",
        modelSource: "served",
        requestedModel: "gpt-5.6-sol",
        servedModel: "gpt-5.6-luna",
      },
    });
  });

  it("prices Venice GPT-5.6 usage at Venice's official provider rates", () => {
    const cases = [
      {
        costUsdMicros: 10_440_000n,
        model: "gpt-5.6-luna",
        providerModel: "openai-gpt-56-luna",
        rates: {
          cachedInput: "130000",
          cacheWrite: "1560000",
          input: "1250000",
          output: "7500000",
        },
      },
      {
        costUsdMicros: 26_100_000n,
        model: "gpt-5.6-terra",
        providerModel: "openai-gpt-56-terra",
        rates: {
          cachedInput: "310000",
          cacheWrite: "3910000",
          input: "3130000",
          output: "18750000",
        },
      },
      {
        costUsdMicros: 52_190_000n,
        model: "gpt-5.6-sol",
        providerModel: "openai-gpt-56-sol",
        rates: {
          cachedInput: "630000",
          cacheWrite: "7810000",
          input: "6250000",
          output: "37500000",
        },
      },
    ] as const;

    for (const testCase of cases) {
      expect(priceHostedAiUsageForAllowance({
        ...BASE_USAGE_RECORD,
        cachedInputTokens: 1_000_000,
        cacheWriteTokens: 1_000_000,
        inputTokens: 3_000_000,
        outputTokens: 1_000_000,
        providerName: "venice",
        requestedModel: testCase.model,
        servedModel: testCase.model,
        totalTokens: 4_000_000,
      })).toMatchObject({
        costUsdMicros: testCase.costUsdMicros,
        counted: true,
        pricingSnapshot: {
          model: testCase.model,
          pricingSource: "https://docs.venice.ai/overview/pricing",
          providerModel: testCase.providerModel,
          ratesUsdMicrosPerMillionTokens: testCase.rates,
          standardCostUsdMicros: testCase.costUsdMicros.toString(),
          tokenPricingBasis: "standard",
        },
        pricingVersion: "venice-api-pricing-2026-08-04-gpt-5.6-standard",
      });
    }
  });

  it("prices GPT-5.6 cache-write tokens at the official write rate", () => {
    expect(priceHostedAiUsageForAllowance({
      ...BASE_USAGE_RECORD,
      cacheWriteTokens: 1_000,
      cachedInputTokens: 0,
      inputTokens: 1_000,
      outputTokens: 0,
      requestedModel: "gpt-5.6-sol",
      servedModel: "gpt-5.6-sol",
      totalTokens: 1_000,
    })).toMatchObject({
      costUsdMicros: 6_250n,
      counted: true,
      pricingSnapshot: {
        model: "gpt-5.6-sol",
        ratesUsdMicrosPerMillionTokens: {
          cachedInput: "500000",
          cacheWrite: "6250000",
          input: "5000000",
          output: "30000000",
        },
        standardCostUsdMicros: "6250",
        tokenPricingBasis: "standard",
        tokens: {
          billableInput: "0",
          cacheWrite: "1000",
          cachedInput: "0",
          input: "1000",
          output: "0",
        },
      },
      pricingVersion: "openai-api-pricing-2026-07-30-gpt-5.6-standard",
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
      costUsdMicros: 2n,
      counted: true,
      pricingSnapshot: {
        standardCostUsdMicros: "3",
        tokenPricingAdjustment: {
          denominator: "2",
          numerator: "1",
        },
        tokenPricingBasis: "openai-flex",
      },
    });
  });

  it("prices OpenAI image generation with GPT Image 2 text, image, and output tokens", () => {
    const generatedImage = {
      ...BASE_USAGE_RECORD,
      cachedInputTokens: 0,
      inputTokens: 1_300,
      outputTokens: 400,
      provider: "openai-images",
      providerName: "OpenAI Images",
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
      requestedModel: "gpt-image-2",
      servedModel: null,
      totalTokens: 1_700,
      usageExtractionSourcePath: "openai.images.generate",
      usageExtractionVersion: "openai-images-v1",
    } satisfies AssistantUsageRecord;

    expect(priceHostedAiUsageForAllowance(generatedImage)).toMatchObject({
      costUsdMicros: 21_500n,
      counted: true,
      pricingSnapshot: {
        model: "gpt-image-2",
        modelSource: "requested",
        pricingSource: "https://developers.openai.com/api/docs/pricing",
        standardCostUsdMicros: "21500",
        tokenPricingBasis: "standard",
        tokens: {
          openAiImage: {
            billableImageInput: "1000",
            billableTextInput: "300",
            cachedInput: "0",
            cachedInputAllocation: "single_modality_only",
            cachedTextInput: "0",
            imageInput: "1000",
            output: "400",
            textInput: "300",
          },
        },
      },
      pricingVersion: "openai-image-api-pricing-2026-07-08-standard",
    });
  });

  it("prices mixed cached OpenAI image input with conservative text-first allocation", () => {
    expect(priceHostedAiUsageForAllowance({
      ...BASE_USAGE_RECORD,
      cachedInputTokens: 100,
      inputTokens: 1_300,
      outputTokens: 400,
      provider: "openai-images",
      providerName: "OpenAI Images",
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
      requestedModel: "gpt-image-2",
      servedModel: null,
      totalTokens: 1_700,
      usageExtractionSourcePath: "openai.images.generate",
      usageExtractionVersion: "openai-images-v1",
    })).toMatchObject({
      costUsdMicros: 21_125n,
      counted: true,
      pricingSnapshot: {
        standardCostUsdMicros: "21125",
        tokens: {
          openAiImage: {
            billableImageInput: "1000",
            billableTextInput: "200",
            cachedImageInput: "0",
            cachedInput: "100",
            cachedInputAllocation: "text_first_conservative",
            cachedTextInput: "100",
            imageInput: "1000",
            output: "400",
            textInput: "300",
          },
        },
      },
      pricingVersion: "openai-image-api-pricing-2026-07-08-standard",
    });
  });

  it("rejects OpenAI image usage with OpenAI flex token pricing", () => {
    expect(() => priceHostedAiUsageForAllowance({
      ...BASE_USAGE_RECORD,
      cachedInputTokens: 0,
      inputTokens: 1_300,
      outputTokens: 400,
      provider: "openai-images",
      providerName: "OpenAI Images",
      rawUsageJson: {
        input_tokens: 1_300,
        input_tokens_details: {
          cached_tokens: 0,
          image_tokens: 1_000,
          text_tokens: 300,
        },
        output_tokens: 400,
        total_tokens: 1_700,
      },
      requestedModel: "gpt-image-2",
      servedModel: null,
      tokenPricingBasis: "openai-flex",
      totalTokens: 1_700,
      usageExtractionSourcePath: "openai.images.generate",
      usageExtractionVersion: "openai-images-v1",
    })).toThrow("OpenAI image hosted AI usage must use standard token pricing basis");
  });

  it("does not treat GPT Image 2 as a generic token-priced chat model", () => {
    expect(() => priceHostedAiUsageForAllowance({
      ...BASE_USAGE_RECORD,
      provider: "codex-cli",
      providerName: "openai",
      requestedModel: "gpt-image-2",
      servedModel: "gpt-image-2",
    })).toThrow("pricing is missing");
  });

  it("accepts production OpenAI provider evidence for OpenAI flex token pricing", () => {
    expect(priceHostedAiUsageForAllowance({
      ...BASE_USAGE_RECORD,
      providerName: "hosted-openai",
      tokenPricingBasis: "openai-flex",
    })).toMatchObject({
      costUsdMicros: 380n,
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
      costUsdMicros: 380n,
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
      costUsdMicros: 250000n,
      counted: true,
    });
    expect(priceHostedAiUsageForAllowance(markedEstimatedIdleCompaction)).toMatchObject({
      costUsdMicros: 250000n,
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
      costUsdMicros: 250000n,
      counted: true,
    });
    expect(priceHostedAiUsageForAllowance({
      ...markedEstimatedIdleCompaction,
      providerRequestId: null,
    })).toMatchObject({
      costUsdMicros: 250000n,
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

  it("prices every allowance-priced assistant text model", () => {
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
      requestedModel: "openai/gpt-5.6-terra",
      servedModel: "openai/gpt-5.6-terra",
    })).toMatchObject({
      counted: true,
      pricingSnapshot: {
        model: "gpt-5.6-terra",
      },
    });
  });

  it("prices direct OpenAI dated gpt-5.6-terra snapshots", () => {
    expect(priceHostedAiUsageForAllowance({
      ...BASE_USAGE_RECORD,
      requestedModel: "gpt-5.6-terra-2026-07-08",
      servedModel: "gpt-5.6-terra-2026-07-08",
    })).toMatchObject({
      counted: true,
      pricingSnapshot: {
        model: "gpt-5.6-terra",
        modelSource: "served",
        requestedModel: "gpt-5.6-terra-2026-07-08",
        servedModel: "gpt-5.6-terra-2026-07-08",
      },
    });
  });

  it("falls back to a recognized requested model when the served model is decorated", () => {
    expect(priceHostedAiUsageForAllowance({
      ...BASE_USAGE_RECORD,
      requestedModel: "gpt-5.6-terra",
      servedModel: "gpt-5.6-terra-production",
    })).toMatchObject({
      counted: true,
      pricingSnapshot: {
        model: "gpt-5.6-terra",
        modelSource: "requested",
        requestedModel: "gpt-5.6-terra",
        servedModel: "gpt-5.6-terra-production",
      },
    });
  });

  it("keeps raw requested and served model ids in the pricing snapshot", () => {
    expect(priceHostedAiUsageForAllowance({
      ...BASE_USAGE_RECORD,
      requestedModel: "gpt-unpriced",
      servedModel: "openai/gpt-5.6-terra",
    })).toMatchObject({
      counted: true,
      pricingSnapshot: {
        model: "gpt-5.6-terra",
        modelSource: "served",
        requestedModel: "gpt-unpriced",
        servedModel: "openai/gpt-5.6-terra",
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

  it("prices web-owned Retell usage from the final provider-reported cost", () => {
    const usage = buildHostedRetellPhoneCallUsageRecord({
      combinedCostUsdMicros: 187_500,
      memberId: "member_123",
      occurredAt: new Date("2026-06-25T12:00:00.000Z"),
      phoneCallId: "hpc_123",
      providerCallId: "retell_call_123",
    });

    expect(usage).toMatchObject({
      rawUsageJson: {
        combinedCostUsdMicros: 187_500,
      },
      turnId: "turn_phone_call_hpc_123",
      usageId: "turn_phone_call_hpc_123.attempt-1",
    });
    expect(priceHostedAiUsageForAllowance(usage)).toEqual({
      costUsdMicros: 187_500n,
      counted: true,
      pricingSnapshot: {
        credentialSource: "platform",
        providerCost: {
          combinedCostUsdMicros: "187500",
        },
        pricingSource: "https://docs.retellai.com/api-references/get-call",
        schema: "murph.hosted-ai-usage-allowance-pricing.v1",
        tokenPricingBasis: "standard",
      },
      pricingVersion: "retell-reported-call-cost-2026-07-16",
    });
    expect(() => parseAssistantUsageRecord(usage)).toThrow(
      "rawUsageJson.combinedCostUsdMicros is not allowed",
    );

    expect(() => priceHostedAiUsageForAllowance({
      ...usage,
      rawUsageJson: {
        combinedCostUsdMicros: 187_500,
        durationMs: 72_500,
      },
    })).toThrow("pricing is missing");

    expect(() => priceHostedAiUsageForAllowance({
      ...usage,
      rawUsageJson: {
        combinedCostUsdMicros: -1,
      },
    })).toThrow("pricing is missing");
  });

  it("prices xAI x_search from the exact provider-reported cost ticks", () => {
    const usage = buildHostedXaiSearchUsageRecord({
      memberId: "member_123",
      model: "grok-4.5",
      occurredAt: "2026-03-29T12:00:00.000Z",
      providerRequestId: "resp_abc123",
      usage: {
        cached_input_tokens: 0,
        cost_in_usd_ticks: 37_756_000,
        input_tokens: 1_234,
        output_tokens: 640,
        reasoning_tokens: 120,
      },
    });

    expect(usage).toMatchObject({
      featureKey: "x-search",
      provider: "xai",
      rawUsageJson: {
        cost_in_usd_ticks: 37_756_000,
      },
    });
    // 37,756,000 ticks / 10,000 ticks-per-micro = 3,775.6 micros → ceil 3,776
    // ($0.0037756 booked as $0.003776).
    expect(priceHostedAiUsageForAllowance(usage)).toEqual({
      costUsdMicros: 3_776n,
      counted: true,
      pricingSnapshot: {
        credentialSource: "platform",
        providerCost: {
          costInUsdTicks: "37756000",
          usdTicksPerUsdMicro: "10000",
        },
        pricingSource: "https://docs.x.ai/developers/pricing",
        schema: "murph.hosted-ai-usage-allowance-pricing.v1",
        tokenPricingBasis: "standard",
      },
      pricingVersion: "xai-x-search-pricing-2026-07-23",
    });
  });

  it("prices an exact-multiple xAI tick count without rounding up", () => {
    const usage = buildHostedXaiSearchUsageRecord({
      memberId: "member_123",
      model: "grok-4.5",
      occurredAt: "2026-03-29T12:00:00.000Z",
      usage: { cost_in_usd_ticks: 50_000_000 },
    });

    const priced = priceHostedAiUsageForAllowance(usage);
    expect(priced.costUsdMicros).toBe(5_000n);
    expect(priced.counted).toBe(true);
  });

  it("fails closed on xAI x_search rows without a valid provider-reported cost", () => {
    const base = buildHostedXaiSearchUsageRecord({
      memberId: "member_123",
      model: "grok-4.5",
      occurredAt: "2026-03-29T12:00:00.000Z",
      usage: { cost_in_usd_ticks: 37_756_000 },
    });

    for (const malformed of [
      {
        // Missing cost ticks entirely: must not price as free.
        ...base,
        rawUsageJson: { input_tokens: 1_234 },
      },
      {
        // Foreign rawUsageJson key: strict matcher must not accept the row.
        ...base,
        rawUsageJson: { cost_in_usd_ticks: 37_756_000, durationMs: 72_500 },
      },
      {
        // Token columns must stay null on the exact-cost branch.
        ...base,
        inputTokens: 1_234,
      },
      {
        // Non-integer cost ticks.
        ...base,
        rawUsageJson: { cost_in_usd_ticks: 3_775.6 },
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
  it("claims counted usage and increments the allowance period counter", async () => {
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
    })).resolves.toBeNull();

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        allowanceAccountedAt: new Date("2026-03-29T12:00:05.000Z"),
        allowanceCostUsdMicros: 759n,
        allowanceCounted: true,
        allowancePeriodEnd: new Date("2026-04-01T00:00:00.000Z"),
        allowancePeriodStart: new Date("2026-03-01T00:00:00.000Z"),
      }),
      where: {
        allowanceAccountedAt: null,
        id: "turn_123.attempt-1",
      },
    }));
    expect(aggregate).not.toHaveBeenCalled();
    expect(countPeriodMetadataUpdateCalls(tx)).toBe(1);

    const usageClaimOrder = updateMany.mock.invocationCallOrder[0];
    const periodUpdateOrder = executeRaw.mock.invocationCallOrder[0];
    expect(usageClaimOrder).toBeDefined();
    expect(periodUpdateOrder).toBeDefined();
    expect(Number(usageClaimOrder)).toBeLessThan(Number(periodUpdateOrder));

    const [sql, ...params] = executeRaw.mock.calls[0] ?? [];
    const sqlText = Array.isArray(sql) ? sql.join("") : String(sql);
    expect(sqlText).toContain('UPDATE "hosted_ai_usage_period"');
    expect(sqlText).toContain('"spent_usd_micros" = "spent_usd_micros" +');
    expect(sqlText).toContain('"last_usage_at" = GREATEST');
    expect(sqlText).toContain('"blocked_at" = CASE');
    expect(sqlText).toContain("AND");
    expect(sqlText).toContain('OR "blocked_at" IS NULL');
    expect(params).toEqual([
      759n,
      new Date("2026-03-29T12:00:00.000Z"),
      new Date("2026-03-29T12:00:00.000Z"),
      759n,
      0n,
      new Date("2026-03-29T12:00:05.000Z"),
      new Date("2026-03-29T12:00:05.000Z"),
      "member_123",
      new Date("2026-03-01T00:00:00.000Z"),
    ]);
    expect(usageCreditMocks.settleHostedUsageCreditForUsageTx).not.toHaveBeenCalled();

    const memberLockOrder = tx.$queryRaw.mock.invocationCallOrder[0];
    const periodLockOrder = tx.$queryRaw.mock.invocationCallOrder[1];
    const periodCreateOrder = tx.hostedAiUsagePeriod.createMany.mock.invocationCallOrder[0];
    expect(memberLockOrder).toBeDefined();
    expect(periodCreateOrder).toBeDefined();
    expect(periodLockOrder).toBeDefined();
    expect(Number(memberLockOrder)).toBeLessThan(Number(periodCreateOrder));
    expect(Number(periodCreateOrder)).toBeLessThan(Number(periodLockOrder));
    const lockSql = tx.$queryRaw.mock.calls.map(([lockStatement]) =>
      Array.isArray(lockStatement) ? lockStatement.join("") : String(lockStatement)
    );
    expect(lockSql[0]).toContain('FROM "hosted_member"');
    expect(lockSql[1]).toContain('FROM "hosted_ai_usage_period"');
  });

  it("admits one post-settlement refill at the existing thread-container capacity seam", async () => {
    const now = new Date("2026-03-29T12:00:05.000Z");
    const tx = createAllowanceTx({
      executeRaw: vi.fn<AllowanceExecuteRaw>(async () => 1),
      hostedAiUsageUpdateMany: vi.fn(async () => ({ count: 1 })),
      limitUsdMicros: 4_500_000n,
      spentUsdMicros: 3_599_500n,
      threadContainerLimitUsdMicros: 4_500_000n,
    });

    await expect(accountHostedAiUsageForAllowanceTx({
      memberId: "member_123",
      now,
      record: BASE_USAGE_RECORD,
      tx: tx as never,
    })).resolves.toBeNull();

    expect(usageCreditMocks.admitHostedGroupSponsorshipRefillTx)
      .toHaveBeenCalledTimes(1);
    expect(usageCreditMocks.admitHostedGroupSponsorshipRefillTx)
      .toHaveBeenCalledWith({
        beneficiaryMemberId: "member_123",
        capacityState: "low",
        now,
        tx,
      });
  });

  it("uses included capacity first and settles only the excess against purchased credit", async () => {
    const executeRaw = vi.fn<AllowanceExecuteRaw>(async () => 1);
    const tx = createAllowanceTx({
      executeRaw,
      hostedAiUsageUpdateMany: vi.fn(async () => ({ count: 1 })),
      spentUsdMicros: 6_399_948n,
      usageCreditBalanceUsdMicros: 5_000n,
      usageCreditLedgerVersion: 7n,
    });
    usageCreditMocks.settleHostedUsageCreditForUsageTx.mockResolvedValueOnce({
      absorbedUsdMicros: 0n,
      balanceUsdMicros: 4_293n,
      debitedUsdMicros: 707n,
      ledgerVersion: 8n,
    });

    await expect(accountHostedAiUsageForAllowanceTx({
      memberId: "member_123",
      now: new Date("2026-03-29T12:00:05.000Z"),
      record: BASE_USAGE_RECORD,
      tx: tx as never,
    })).resolves.toBeNull();

    expect(usageCreditMocks.settleHostedUsageCreditForUsageTx).toHaveBeenCalledWith({
      beneficiaryMemberId: "member_123",
      debitUsdMicros: 707n,
      effectiveAt: new Date("2026-03-29T12:00:00.000Z"),
      sourceUsageId: "turn_123.attempt-1",
      tx,
    });
    const [, ...params] = executeRaw.mock.calls[0] ?? [];
    expect(params).toContain(4_293n);
  });

  it("settles Retell cost against included capacity before purchased credit", async () => {
    const tx = createAllowanceTx({
      executeRaw: vi.fn<AllowanceExecuteRaw>(async () => 1),
      hostedAiUsageUpdateMany: vi.fn(async () => ({ count: 1 })),
      spentUsdMicros: 6_300_000n,
      usageCreditBalanceUsdMicros: 87_500n,
      usageCreditLedgerVersion: 7n,
    });
    usageCreditMocks.settleHostedUsageCreditForUsageTx.mockResolvedValueOnce({
      absorbedUsdMicros: 0n,
      balanceUsdMicros: 0n,
      debitedUsdMicros: 87_500n,
      ledgerVersion: 8n,
    });
    const occurredAt = new Date("2026-03-29T12:00:00.000Z");
    const usage = buildHostedRetellPhoneCallUsageRecord({
      combinedCostUsdMicros: 187_500,
      memberId: "member_123",
      occurredAt,
      phoneCallId: "hpc_credit_boundary",
      providerCallId: "retell_call_credit_boundary",
    });

    await expect(accountHostedAiUsageForAllowanceTx({
      memberId: "member_123",
      now: new Date("2026-03-29T12:00:05.000Z"),
      record: usage,
      tx: tx as never,
    })).resolves.toMatchObject({
      sourceUsageId: "turn_phone_call_hpc_credit_boundary.attempt-1",
      usageCreditLedgerVersion: 8n,
    });

    expect(usageCreditMocks.settleHostedUsageCreditForUsageTx).toHaveBeenCalledWith({
      beneficiaryMemberId: "member_123",
      debitUsdMicros: 87_500n,
      effectiveAt: occurredAt,
      sourceUsageId: "turn_phone_call_hpc_credit_boundary.attempt-1",
      tx,
    });
  });

  it("books the Worker-posted xAI x_search wire payload through route parsing at the exact tick cost", async () => {
    // Same parse path as the usage record route
    // (apps/web/app/api/internal/hosted-execution/usage/record/route.ts).
    const body = parseHostedRuntimeUsageRecordRequest(
      cloneHostedXaiSearchUsageWireBody(),
    );

    const updateMany = vi.fn(async () => ({ count: 1 }));
    const executeRaw = vi.fn<AllowanceExecuteRaw>(async () => 1);
    const tx = createAllowanceTx({
      executeRaw,
      hostedAiUsageUpdateMany: updateMany,
    });

    await expect(accountHostedAiUsageForAllowanceTx({
      memberId: "member_123",
      now: new Date("2026-03-29T12:00:05.000Z"),
      record: body.usage,
      tx: tx as never,
    })).resolves.toBeNull();

    // 987,654,321 ticks / 10,000 ticks-per-micro = 98,765.4321 → ceil 98,766.
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        allowanceCostUsdMicros: 98_766n,
        allowanceCounted: true,
        allowancePricingVersion: "xai-x-search-pricing-2026-07-23",
      }),
      where: {
        allowanceAccountedAt: null,
        id: "turn_xai_search_00000000000000000000000000000000.attempt-1",
      },
    }));
    // The period spend increment fires exactly once, carrying the exact
    // ceiled cost.
    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(countPeriodMetadataUpdateCalls(tx)).toBe(1);
    const [spendSql, ...spendParams] = executeRaw.mock.calls[0] ?? [];
    const spendSqlText = Array.isArray(spendSql) ? spendSql.join("") : String(spendSql);
    expect(spendSqlText).toContain('UPDATE "hosted_ai_usage_period"');
    expect(spendSqlText).toContain('"spent_usd_micros" = "spent_usd_micros" +');
    expect(spendParams[0]).toBe(98_766n);
  });

  it("rejects the xAI wire payload instead of booking free usage when cost ticks are missing or invalid", async () => {
    // Missing cost ticks: the record parses at the route boundary, but
    // pricing throws before any usage-row claim or period spend, so the
    // transaction rolls back rather than accruing the call for free.
    const missingTicks = cloneHostedXaiSearchUsageWireBody();
    delete missingTicks.usage.rawUsageJson.cost_in_usd_ticks;
    const body = parseHostedRuntimeUsageRecordRequest(missingTicks);

    const updateMany = vi.fn(async () => ({ count: 1 }));
    const executeRaw = vi.fn<AllowanceExecuteRaw>(async () => 1);
    const tx = createAllowanceTx({
      executeRaw,
      hostedAiUsageUpdateMany: updateMany,
    });

    await expect(accountHostedAiUsageForAllowanceTx({
      memberId: "member_123",
      now: new Date("2026-03-29T12:00:05.000Z"),
      record: body.usage,
      tx: tx as never,
    })).rejects.toThrow("pricing is missing");
    expect(updateMany).not.toHaveBeenCalled();
    expect(countPeriodMetadataUpdateCalls(tx)).toBe(0);
    expect(usageCreditMocks.settleHostedUsageCreditForUsageTx).not.toHaveBeenCalled();

    // Non-integer cost ticks never reach accounting at all: the route-level
    // record parse rejects the row.
    const fractionalTicks = cloneHostedXaiSearchUsageWireBody();
    fractionalTicks.usage.rawUsageJson.cost_in_usd_ticks = 3_775.6;
    expect(() => parseHostedRuntimeUsageRecordRequest(fractionalTicks)).toThrow(
      "rawUsageJson.cost_in_usd_ticks must be a non-negative integer",
    );
  });

  it("throws after a credit debit when the locked period spend row is lost", async () => {
    const tx = createAllowanceTx({
      executeRaw: vi.fn<AllowanceExecuteRaw>(async () => 0),
      hostedAiUsageUpdateMany: vi.fn(async () => ({ count: 1 })),
      spentUsdMicros: 6_399_948n,
      usageCreditBalanceUsdMicros: 5_000n,
      usageCreditLedgerVersion: 7n,
    });
    usageCreditMocks.settleHostedUsageCreditForUsageTx.mockResolvedValueOnce({
      absorbedUsdMicros: 0n,
      balanceUsdMicros: 4_293n,
      debitedUsdMicros: 707n,
      ledgerVersion: 8n,
    });

    await expect(accountHostedAiUsageForAllowanceTx({
      memberId: "member_123",
      now: new Date("2026-03-29T12:00:05.000Z"),
      record: BASE_USAGE_RECORD,
      tx: tx as never,
    })).rejects.toThrow(
      "Hosted AI usage allowance period spend lost its locked row.",
    );

    expect(usageCreditMocks.settleHostedUsageCreditForUsageTx)
      .toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        debitUsdMicros: 707n,
        sourceUsageId: "turn_123.attempt-1",
      }));
  });

  it("absorbs provider crossing overshoot after consuming available purchased credit", async () => {
    const tx = createAllowanceTx({
      executeRaw: vi.fn<AllowanceExecuteRaw>(async () => 1),
      hostedAiUsageUpdateMany: vi.fn(async () => ({ count: 1 })),
      spentUsdMicros: 6_399_948n,
      usageCreditBalanceUsdMicros: 500n,
      usageCreditLedgerVersion: 4n,
    });
    usageCreditMocks.settleHostedUsageCreditForUsageTx.mockResolvedValueOnce({
      absorbedUsdMicros: 207n,
      balanceUsdMicros: 0n,
      debitedUsdMicros: 500n,
      ledgerVersion: 5n,
    });
    const now = new Date("2026-03-29T12:00:05.000Z");

    await expect(accountHostedAiUsageForAllowanceTx({
      memberId: "member_123",
      now,
      record: BASE_USAGE_RECORD,
      tx: tx as never,
    })).resolves.toMatchObject({
      crossedAt: now,
      sourceUsageId: "turn_123.attempt-1",
      usageCreditLedgerVersion: 5n,
    });

    expect(usageCreditMocks.settleHostedUsageCreditForUsageTx).toHaveBeenCalledWith(
      expect.objectContaining({
        debitUsdMicros: 707n,
      }),
    );
  });

  it("accounts usage against the record's allowance period without returning notice data before crossing", async () => {
    const tx = createAllowanceTx({
      executeRaw: vi.fn<AllowanceExecuteRaw>(async () => 1),
      hostedAiUsageUpdateMany: vi.fn(async () => ({ count: 1 })),
    });

    await expect(accountHostedAiUsageForAllowanceTx({
      memberId: "member_123",
      now: new Date("2026-04-01T00:00:00.000Z"),
      record: BASE_USAGE_RECORD,
      tx: tx as never,
    })).resolves.toBeNull();

    expect(countPeriodMetadataUpdateCalls(tx)).toBe(1);
  });

  it("returns a limit-notice candidate when the spend update crosses the period limit", async () => {
    const tx = createAllowanceTx({
      executeRaw: vi.fn<AllowanceExecuteRaw>(async () => 1),
      hostedAiUsageUpdateMany: vi.fn(async () => ({ count: 1 })),
      spentUsdMicros: 6_399_948n,
    });
    const now = new Date("2026-03-29T12:00:05.000Z");

    await expect(accountHostedAiUsageForAllowanceTx({
      memberId: "member_123",
      now,
      record: BASE_USAGE_RECORD,
      tx: tx as never,
    })).resolves.toEqual({
      crossedAt: now,
      memberId: "member_123",
      periodEnd: new Date("2026-04-01T00:00:00.000Z"),
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
      planResetAt: null,
      sourceUsageId: "turn_123.attempt-1",
      usageCreditLedgerVersion: 0n,
      userNotice: expect.objectContaining({
        code: "pulse_upgrade_edge",
        message: expect.any(String),
      }),
    });
  });

  it("does not return new notice candidates for concurrent spend after capacity is already zero", async () => {
    const blockedAt = new Date("2026-03-29T11:59:00.000Z");
    const records = [
      BASE_USAGE_RECORD,
      {
        ...BASE_USAGE_RECORD,
        providerRequestId: "req_124",
        turnId: "turn_124",
        usageId: "turn_124.attempt-1",
      },
    ] satisfies AssistantUsageRecord[];

    await expect(Promise.all(records.map(async (record) => {
      const tx = createAllowanceTx({
        blockedAt,
        executeRaw: vi.fn<AllowanceExecuteRaw>(async () => 1),
        hostedAiUsageUpdateMany: vi.fn(async () => ({ count: 1 })),
        spentUsdMicros: DIRECT_PULSE_ALLOWANCE_USD_MICROS,
      });
      return await accountHostedAiUsageForAllowanceTx({
        memberId: "member_123",
        now: new Date("2026-03-29T12:00:05.000Z"),
        record,
        tx: tx as never,
      });
    }))).resolves.toEqual([null, null]);
  });

  it("keeps late pre-reset usage in history without charging the new allowance or credits", async () => {
    const planResetAt = new Date("2026-03-29T12:00:02.000Z");
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const executeRaw = vi.fn<AllowanceExecuteRaw>(async () => 1);
    const tx = createAllowanceTx({
      billingPlanCode: "launch_edge_monthly",
      billingRefUpdatedAt: planResetAt,
      executeRaw,
      hostedAiUsageUpdateMany: updateMany,
      limitUsdMicros: DIRECT_EDGE_ALLOWANCE_USD_MICROS,
      planResetAt,
      spentUsdMicros: 0n,
      usageCreditBalanceUsdMicros: 5_000n,
      usageCreditLedgerVersion: 4n,
    });

    await expect(accountHostedAiUsageForAllowanceTx({
      memberId: "member_123",
      now: new Date("2026-03-29T12:00:05.000Z"),
      record: BASE_USAGE_RECORD,
      tx: tx as never,
    })).resolves.toBeNull();

    expect(updateMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        allowanceAccountedAt: new Date("2026-03-29T12:00:05.000Z"),
        allowanceCounted: false,
        allowancePeriodEnd: new Date("2026-04-01T00:00:00.000Z"),
        allowancePeriodStart: new Date("2026-03-01T00:00:00.000Z"),
        allowancePricingSnapshotJson: expect.objectContaining({
          allowanceDisposition: "forgiven_plan_reset",
          planResetAt: planResetAt.toISOString(),
        }),
      }),
      where: {
        allowanceAccountedAt: null,
        id: BASE_USAGE_RECORD.usageId,
      },
    });
    expect(executeRaw).not.toHaveBeenCalled();
    expect(usageCreditMocks.settleHostedUsageCreditForUsageTx).not.toHaveBeenCalled();
  });

  it("charges usage that starts after the persisted plan reset", async () => {
    const planResetAt = new Date("2026-03-29T11:59:59.000Z");
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const executeRaw = vi.fn<AllowanceExecuteRaw>(async () => 1);
    const tx = createAllowanceTx({
      billingPlanCode: "launch_edge_monthly",
      billingRefUpdatedAt: planResetAt,
      executeRaw,
      hostedAiUsageUpdateMany: updateMany,
      limitUsdMicros: DIRECT_EDGE_ALLOWANCE_USD_MICROS,
      planResetAt,
      spentUsdMicros: 0n,
    });

    await expect(accountHostedAiUsageForAllowanceTx({
      memberId: "member_123",
      now: new Date("2026-03-29T12:00:05.000Z"),
      record: BASE_USAGE_RECORD,
      tx: tx as never,
    })).resolves.toBeNull();

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        allowanceCounted: true,
      }),
    }));
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });

  it("forgives usage predating a paid reset without reconstructing the retired trial window", async () => {
    const trialStart = new Date("2026-03-01T00:00:00.000Z");
    const trialEnd = new Date("2026-03-08T00:00:00.000Z");
    const paidPeriodEnd = new Date("2026-04-08T00:00:00.000Z");
    const resetAt = new Date("2026-03-08T00:00:02.000Z");
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const executeRaw = vi.fn<AllowanceExecuteRaw>(async () => 1);
    const tx = createAllowanceTx({
      billingPhase: "paid",
      billingPlanCode: "launch_monthly",
      billingRefUpdatedAt: resetAt,
      checkoutOffer: "pulse_trial_7d",
      executeRaw,
      hostedAiUsageUpdateMany: updateMany,
      periodEnd: paidPeriodEnd,
      periodStart: trialEnd,
      pulseTrialPolicyVersion: "pulse-trial-2026-06-30-v2",
      pulseTrialRedeemedAt: trialStart,
      spentUsdMicros: 0n,
      trialEndsAt: trialEnd,
      trialStartedAt: trialStart,
    });
    const record = {
      ...BASE_USAGE_RECORD,
      occurredAt: "2026-03-07T23:59:59.000Z",
    } satisfies AssistantUsageRecord;

    await expect(accountHostedAiUsageForAllowanceTx({
      memberId: "member_123",
      now: new Date("2026-03-08T00:00:05.000Z"),
      record,
      tx: tx as never,
    })).resolves.toBeNull();

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        allowanceCounted: false,
        allowancePeriodEnd: new Date("2026-04-01T00:00:00.000Z"),
        allowancePeriodStart: trialEnd,
        allowancePricingSnapshotJson: expect.objectContaining({
          allowanceDisposition: "forgiven_plan_reset",
          planResetAt: resetAt.toISOString(),
        }),
      }),
    }));
    expect(tx.hostedAiUsagePeriod.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          memberId: "member_123",
          periodEnd: new Date("2026-04-01T00:00:00.000Z"),
          periodStart: trialStart,
        }),
        skipDuplicates: true,
      }),
    );
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it("charges usage started after an early trial conversion", async () => {
    const trialStart = new Date("2026-03-01T00:00:00.000Z");
    const trialEnd = new Date("2026-03-08T00:00:00.000Z");
    const resetAt = new Date("2026-03-05T12:00:00.000Z");
    const paidPeriodEnd = new Date("2026-04-05T12:00:00.000Z");
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const executeRaw = vi.fn<AllowanceExecuteRaw>(async () => 1);
    const tx = createAllowanceTx({
      billingPhase: "paid",
      billingPlanCode: "launch_monthly",
      billingRefUpdatedAt: resetAt,
      checkoutOffer: "pulse_trial_7d",
      executeRaw,
      hostedAiUsageUpdateMany: updateMany,
      periodEnd: paidPeriodEnd,
      periodStart: resetAt,
      planResetAt: resetAt,
      pulseTrialPolicyVersion: "pulse-trial-2026-06-30-v2",
      pulseTrialRedeemedAt: trialStart,
      spentUsdMicros: 0n,
      trialEndsAt: trialEnd,
      trialStartedAt: trialStart,
    });
    const record = {
      ...BASE_USAGE_RECORD,
      occurredAt: "2026-03-06T00:00:00.000Z",
    } satisfies AssistantUsageRecord;

    await expect(accountHostedAiUsageForAllowanceTx({
      memberId: "member_123",
      now: new Date("2026-03-06T00:00:05.000Z"),
      record,
      tx: tx as never,
    })).resolves.toBeNull();

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        allowanceCounted: true,
        allowancePeriodEnd: paidPeriodEnd,
        allowancePeriodStart: resetAt,
      }),
    }));
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });

  it("returns a fresh notice candidate when replenished credit is consumed", async () => {
    const tx = createAllowanceTx({
      blockedAt: null,
      executeRaw: vi.fn<AllowanceExecuteRaw>(async () => 1),
      hostedAiUsageUpdateMany: vi.fn(async () => ({ count: 1 })),
      spentUsdMicros: DIRECT_PULSE_ALLOWANCE_USD_MICROS,
      usageCreditBalanceUsdMicros: 500n,
      usageCreditLedgerVersion: 8n,
    });
    usageCreditMocks.settleHostedUsageCreditForUsageTx.mockResolvedValueOnce({
      absorbedUsdMicros: 259n,
      balanceUsdMicros: 0n,
      debitedUsdMicros: 500n,
      ledgerVersion: 9n,
    });
    const record = {
      ...BASE_USAGE_RECORD,
      providerRequestId: "req_post_topup",
      turnId: "turn_post_topup",
      usageId: "turn_post_topup.attempt-1",
    } satisfies AssistantUsageRecord;
    const now = new Date("2026-03-29T12:30:05.000Z");

    await expect(accountHostedAiUsageForAllowanceTx({
      memberId: "member_123",
      now,
      record,
      tx: tx as never,
    })).resolves.toMatchObject({
      crossedAt: now,
      sourceUsageId: "turn_post_topup.attempt-1",
      usageCreditLedgerVersion: 9n,
    });
  });

  it("returns a neutral retryable notice for a thread-container crossing", async () => {
    const tx = createAllowanceTx({
      executeRaw: vi.fn<AllowanceExecuteRaw>(async () => 1),
      hostedAiUsageUpdateMany: vi.fn(async () => ({ count: 1 })),
      spentUsdMicros: 4_499_948n,
      threadContainerLimitUsdMicros: 4_500_000n,
    });

    await expect(accountHostedAiUsageForAllowanceTx({
      memberId: "member_123",
      now: new Date("2026-03-29T12:00:05.000Z"),
      record: BASE_USAGE_RECORD,
      tx: tx as never,
    })).resolves.toMatchObject({
      userNotice: {
        code: "thread_usage_limit_reached",
        message: expect.not.stringContaining("https://"),
      },
    });
  });

  it("accounts a thread crossing 20% remaining without creating a notice", async () => {
    const tx = createAllowanceTx({
      executeRaw: vi.fn<AllowanceExecuteRaw>(async () => 1),
      hostedAiUsageUpdateMany: vi.fn(async () => ({ count: 1 })),
      spentUsdMicros: 3_599_948n,
      threadContainerLimitUsdMicros: 4_500_000n,
    });

    await expect(accountHostedAiUsageForAllowanceTx({
      memberId: "member_123",
      now: new Date("2026-03-29T12:00:05.000Z"),
      record: BASE_USAGE_RECORD,
      tx: tx as never,
    })).resolves.toBeNull();
    expect(tx.$executeRaw).toHaveBeenCalledOnce();
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
        occurredAt: "2026-03-29T12:00:00.000Z",
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
        allowancePeriodEnd: new Date("2026-04-01T00:00:00.000Z"),
        allowancePeriodStart: new Date("2026-03-01T00:00:00.000Z"),
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
    expect(countPeriodMetadataUpdateCalls(tx)).toBe(1);
  });

  it("blocks the allowance period when image provider usage pricing basis is missing", async () => {
    for (const record of buildMalformedOpenAiImageUsageRecords()) {
      const updateMany = vi.fn(async () => ({ count: 1 }));
      const executeRaw = vi.fn<AllowanceExecuteRaw>(async () => 1);
      const tx = createAllowanceTx({
        executeRaw,
        hostedAiUsageUpdateMany: updateMany,
      });

      const notice = await accountHostedAiUsageForAllowanceTx({
        memberId: "member_123",
        record,
        tx: tx as never,
      });

      expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          allowanceCostUsdMicros: DIRECT_PULSE_ALLOWANCE_USD_MICROS,
          allowanceCounted: true,
          allowancePricingSnapshotJson: expect.objectContaining({
            blockCostUsdMicros: "6400000",
            reason: "missing_provider_usage_tokens",
            schema: "murph.hosted-ai-usage-allowance-malformed.v1",
            tokenPricingBasis: "standard",
          }),
          allowancePricingVersion: "openai-image-api-malformed-usage-block-2026-07-08",
        }),
      }));
      expect(countPeriodMetadataUpdateCalls(tx)).toBe(1);
      expect(notice).toMatchObject({
        memberId: "member_123",
        sourceUsageId: record.usageId,
      });
    }
  });

  it("blocks the allowance period when image provider usage buckets are inconsistent", async () => {
    for (const record of buildInconsistentOpenAiImageUsageRecords()) {
      const updateMany = vi.fn(async () => ({ count: 1 }));
      const executeRaw = vi.fn<AllowanceExecuteRaw>(async () => 1);
      const tx = createAllowanceTx({
        executeRaw,
        hostedAiUsageUpdateMany: updateMany,
      });

      await accountHostedAiUsageForAllowanceTx({
        memberId: "member_123",
        record,
        tx: tx as never,
      });

      expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          allowanceCostUsdMicros: DIRECT_PULSE_ALLOWANCE_USD_MICROS,
          allowanceCounted: true,
          allowancePricingSnapshotJson: expect.objectContaining({
            blockCostUsdMicros: "6400000",
            reason: "inconsistent_provider_usage_tokens",
            schema: "murph.hosted-ai-usage-allowance-malformed.v1",
          }),
          allowancePricingVersion: "openai-image-api-malformed-usage-block-2026-07-08",
        }),
      }));
      expect(countPeriodMetadataUpdateCalls(tx)).toBe(1);
    }
  });

  it("blocks the allowance period when image input detail buckets are missing", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const executeRaw = vi.fn<AllowanceExecuteRaw>(async () => 1);
    const tx = createAllowanceTx({
      executeRaw,
      hostedAiUsageUpdateMany: updateMany,
    });

    await accountHostedAiUsageForAllowanceTx({
      memberId: "member_123",
      record: buildAggregateOnlyOpenAiImageUsageRecord(),
      tx: tx as never,
    });

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        allowanceCostUsdMicros: DIRECT_PULSE_ALLOWANCE_USD_MICROS,
        allowanceCounted: true,
        allowancePricingSnapshotJson: expect.objectContaining({
          blockCostUsdMicros: "6400000",
          reason: "missing_provider_usage_tokens",
          schema: "murph.hosted-ai-usage-allowance-malformed.v1",
        }),
        allowancePricingVersion: "openai-image-api-malformed-usage-block-2026-07-08",
      }),
    }));
    expect(countPeriodMetadataUpdateCalls(tx)).toBe(1);
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
    })).resolves.toBeNull();

    expect(countPeriodMetadataUpdateCalls(tx)).toBe(0);
  });

  it("uses Family-sponsored allowance instead of direct starter state", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const executeRaw = vi.fn<AllowanceExecuteRaw>(async () => 1);
    const tx = createAllowanceTx({
      billingPhase: "trial",
      checkoutOffer: "pulse_trial_7d",
      executeRaw,
      familyAccessActive: true,
      hostedAiUsageUpdateMany: updateMany,
      periodEnd: new Date("2026-05-01T00:00:00.000Z"),
      periodStart: new Date("2026-04-01T00:00:00.000Z"),
      pulseTrialPolicyVersion: "pulse-trial-2026-05-05-v1",
      trialEndsAt: new Date("2026-04-08T12:00:00.000Z"),
      trialStartedAt: new Date("2026-04-01T12:00:00.000Z"),
    });

    await accountHostedAiUsageForAllowanceTx({
      memberId: "member_123",
      now: new Date("2026-04-09T12:00:05.000Z"),
      record: {
        ...BASE_USAGE_RECORD,
        occurredAt: "2026-04-09T12:00:01.000Z",
      },
      tx: tx as never,
    });

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        allowanceAccountedAt: new Date("2026-04-09T12:00:05.000Z"),
        allowanceCostUsdMicros: 759n,
        allowanceCounted: true,
        allowancePeriodEnd: new Date("2026-05-01T00:00:00.000Z"),
        allowancePeriodStart: new Date("2026-04-01T00:00:00.000Z"),
        allowancePricingVersion: "openai-api-pricing-2026-07-30-gpt-5.6-standard",
      }),
    }));
    expect(countPeriodMetadataUpdateCalls(tx)).toBe(1);
  });

  it("uses a Family calendar period while the sponsor period projection is missing", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const executeRaw = vi.fn<AllowanceExecuteRaw>(async () => 1);
    const tx = createAllowanceTx({
      billingPhase: "trial",
      checkoutOffer: "pulse_trial_7d",
      executeRaw,
      familyAccessActive: true,
      familyPeriodEnd: null,
      familyPeriodStart: null,
      hostedAiUsageUpdateMany: updateMany,
      periodEnd: new Date("2026-05-01T00:00:00.000Z"),
      periodStart: new Date("2026-04-01T00:00:00.000Z"),
      pulseTrialPolicyVersion: "pulse-trial-2026-05-05-v1",
      trialEndsAt: new Date("2026-04-08T12:00:00.000Z"),
      trialStartedAt: new Date("2026-04-01T12:00:00.000Z"),
    });

    await accountHostedAiUsageForAllowanceTx({
      memberId: "member_123",
      now: new Date("2026-04-09T12:00:05.000Z"),
      record: {
        ...BASE_USAGE_RECORD,
        occurredAt: "2026-04-09T12:00:01.000Z",
      },
      tx: tx as never,
    });

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        allowanceAccountedAt: new Date("2026-04-09T12:00:05.000Z"),
        allowanceCostUsdMicros: 759n,
        allowanceCounted: true,
        allowancePeriodEnd: new Date("2026-05-01T00:00:00.000Z"),
        allowancePeriodStart: new Date("2026-04-01T00:00:00.000Z"),
        allowancePricingVersion: "openai-api-pricing-2026-07-30-gpt-5.6-standard",
      }),
    }));
    expect(tx.hostedAiUsagePeriod.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        billingPlanCode: "launch_monthly",
        limitUsdMicros: FAMILY_PULSE_ALLOWANCE_USD_MICROS,
        memberId: "member_123",
        periodEnd: new Date("2026-05-01T00:00:00.000Z"),
        periodStart: new Date("2026-04-01T00:00:00.000Z"),
      }),
    }));
    expect(countPeriodMetadataUpdateCalls(tx)).toBe(1);
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
    })).resolves.toBeNull();

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

describe("reconcileHostedAiUsageAllowancePeriodForMemberTx", () => {
  const periodStart = new Date(0);
  const periodEnd = new Date("2099-12-31T23:59:59.999Z");
  const now = new Date("2026-07-09T12:00:00.000Z");

  it("creates a missing structural period for starter usage", async () => {
    const tx = createGatePrisma({
      billingPhase: "trial",
      checkoutOffer: "pulse_trial_7d",
      findUniquePeriod: null,
      periodEnd,
      periodStart,
      spentUsdMicros: 0n,
      usageCreditBalanceUsdMicros: 4_500_000n,
      usageCreditLedgerVersion: 1n,
    });

    await expect(reconcileHostedAiUsageAllowancePeriodForMemberTx({
      memberId: "member_123",
      now,
      tx: tx as never,
    })).resolves.toBeUndefined();

    expect(tx.hostedAiUsagePeriod.createMany).toHaveBeenCalledWith({
      data: {
        billingPlanCode: "launch_monthly",
        highestBillingPlanCode: "launch_monthly",
        limitUsdMicros: 0n,
        memberId: "member_123",
        periodEnd,
        periodStart,
        spentUsdMicros: 0n,
      },
      skipDuplicates: true,
    });
    expect(tx.hostedAiUsagePeriod.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          billingPlanCode: "launch_monthly",
          limitUsdMicros: 0n,
          periodEnd,
        }),
      }),
    );
  });

  it("repairs starter-owned period fields while preserving spend and block state", async () => {
    const stalePeriodEnd = new Date("2026-07-09T12:00:00.000Z");
    const blockedAt = new Date("2026-07-08T12:00:00.000Z");
    const update = vi.fn(async (args: {
      data: {
        billingPlanCode: string;
        blockedAt: Date | null;
        highestBillingPlanCode: string;
        limitUsdMicros: bigint;
        periodEnd: Date;
      };
    }) => ({
      billingPlanCode: args.data.billingPlanCode,
      blockedAt: args.data.blockedAt,
      highestBillingPlanCode: args.data.highestBillingPlanCode,
      limitUsdMicros: args.data.limitUsdMicros,
      periodEnd: args.data.periodEnd,
      periodStart,
      planResetAt: null,
      spentUsdMicros: 4_500_000n,
    }));
    const tx = createGatePrisma({
      billingPhase: "trial",
      checkoutOffer: "pulse_trial_7d",
      findUniquePeriod: {
        billingPlanCode: "launch_monthly",
        blockedAt,
        limitUsdMicros: 4_500_000n,
        periodEnd: stalePeriodEnd,
        periodStart,
        spentUsdMicros: 4_500_000n,
      },
      periodEnd,
      periodStart,
      spentUsdMicros: 4_500_000n,
      update,
      usageCreditBalanceUsdMicros: 0n,
      usageCreditLedgerVersion: 2n,
    });

    await expect(reconcileHostedAiUsageAllowancePeriodForMemberTx({
      memberId: "member_123",
      now,
      tx: tx as never,
    })).resolves.toBeUndefined();

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        billingPlanCode: "launch_monthly",
        blockedAt,
        highestBillingPlanCode: "launch_monthly",
        limitUsdMicros: 0n,
        periodEnd,
        updatedAt: now,
      },
    }));
    const data = update.mock.calls[0]?.[0].data;
    expect(data).not.toHaveProperty("spentUsdMicros");
    expect(data).not.toHaveProperty("periodStart");
  });
});

describe("resolveHostedAiUsageGate", () => {
  it("allows active members while recorded spend is below the period limit", async () => {
    const prisma = createGatePrisma({
      spentUsdMicros: 5_400_000n,
    });

    await expect(resolveHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-03-29T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: true,
      limitUsdMicros: DIRECT_PULSE_ALLOWANCE_USD_MICROS,
      remainingUsdMicros: 1_000_000n,
      spentUsdMicros: 5_400_000n,
    });
  });

  it("blocks active members when the combined allowance reaches zero", async () => {
    const prisma = createGatePrisma({
      spentUsdMicros: DIRECT_PULSE_ALLOWANCE_USD_MICROS,
    });

    await expect(resolveHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-03-29T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: false,
      userNotice: {
        code: "pulse_upgrade_edge",
        message: expect.not.stringContaining("addUsage=true"),
      },
      reason: "ai_usage_limit_exceeded",
      retryAfter: new Date("2026-04-01T00:00:00.000Z"),
      spentUsdMicros: DIRECT_PULSE_ALLOWANCE_USD_MICROS,
      usageCreditBalanceUsdMicros: 0n,
      usageCreditLedgerVersion: 0n,
    });
  });

  it("routes an exhausted Max member to the stable Settings recovery handoff", async () => {
    const prisma = createGatePrisma({
      billingPlanCode: "launch_max_monthly",
      limitUsdMicros: DIRECT_MAX_ALLOWANCE_USD_MICROS,
      spentUsdMicros: DIRECT_MAX_ALLOWANCE_USD_MICROS,
    });

    const decision = await resolveHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-03-29T12:00:00.000Z",
      prisma: prisma as never,
    });

    expect(decision).toMatchObject({
      allowed: false,
      billingPlanCode: "launch_max_monthly",
      reason: "ai_usage_limit_exceeded",
      userNotice: {
        code: "max_usage_limit_reached",
        message: expect.any(String),
      },
    });
    if (decision.allowed || !decision.userNotice) {
      throw new Error("Expected exhausted Max usage to return a user notice");
    }
    expect(decision.userNotice.message).toContain(
      "https://withmurph.ai/settings?usageRecovery=true#subscription",
    );
    expect(decision.userNotice.message).not.toMatch(/Pulse|Edge|addUsage=true/iu);
  });

  it("gives an exhausted group gate the deterministic refill admission seam before denial", async () => {
    const now = new Date("2026-03-29T12:00:00.000Z");
    const prisma = createGatePrisma({
      limitUsdMicros: 4_500_000n,
      spentUsdMicros: 4_500_000n,
      threadContainerLimitUsdMicros: 4_500_000n,
    });
    usageCreditMocks.admitHostedGroupSponsorshipRefillTx.mockResolvedValue({
      authorizationId: "hgsa_abcdefghijklmnop",
      purchaseId: "hucp_deterministic_refill",
    });

    await expect(resolveHostedAiUsageGate({
      memberId: "member_123",
      now,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: false,
      allowanceSource: "thread_container",
      reason: "ai_usage_limit_exceeded",
    });

    expect(usageCreditMocks.admitHostedGroupSponsorshipRefillTx)
      .toHaveBeenCalledTimes(1);
    expect(usageCreditMocks.admitHostedGroupSponsorshipRefillTx)
      .toHaveBeenCalledWith({
        beneficiaryMemberId: "member_123",
        capacityState: "exhausted",
        now,
        tx: prisma,
      });
  });

  it("allows base-exhausted members while purchased credit remains", async () => {
    const blockedAt = new Date("2026-03-29T11:00:00.000Z");
    const update = vi.fn(async (args?: unknown) => {
      void args;
      return undefined;
    });
    const prisma = createGatePrisma({
      findUniquePeriod: {
        billingPlanCode: "launch_monthly",
        blockedAt,
        limitUsdMicros: DIRECT_PULSE_ALLOWANCE_USD_MICROS,
        periodEnd: new Date("2026-04-01T00:00:00.000Z"),
        periodStart: new Date("2026-03-01T00:00:00.000Z"),
        spentUsdMicros: DIRECT_PULSE_ALLOWANCE_USD_MICROS,
      },
      spentUsdMicros: DIRECT_PULSE_ALLOWANCE_USD_MICROS,
      update,
      usageCreditBalanceUsdMicros: 2_500_000n,
      usageCreditLedgerVersion: 9n,
    });

    await expect(resolveHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-03-29T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: true,
      remainingUsdMicros: 2_500_000n,
      spentUsdMicros: DIRECT_PULSE_ALLOWANCE_USD_MICROS,
      usageCreditBalanceUsdMicros: 2_500_000n,
      usageCreditLedgerVersion: 9n,
    });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        blockedAt: null,
      }),
    }));
  });

  it("adds purchased credit to remaining included capacity", async () => {
    const prisma = createGatePrisma({
      spentUsdMicros: 5_400_000n,
      usageCreditBalanceUsdMicros: 3_000_000n,
      usageCreditLedgerVersion: 6n,
    });

    await expect(resolveHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-03-29T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: true,
      remainingUsdMicros: 4_000_000n,
      usageCreditBalanceUsdMicros: 3_000_000n,
      usageCreditLedgerVersion: 6n,
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
        limitUsdMicros: DIRECT_PULSE_ALLOWANCE_USD_MICROS,
        periodEnd: nextPeriodEnd,
        periodStart: nextPeriodStart,
        spentUsdMicros: 0n,
      },
      periodEnd: new Date("2026-05-01T00:00:00.000Z"),
      periodStart: new Date("2026-04-01T00:00:00.000Z"),
      spentUsdMicros: DIRECT_PULSE_ALLOWANCE_USD_MICROS,
    });

    await expect(resolveHostedAiUsageGate({
      memberId: "member_123",
      now: nextPeriodStart,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: true,
      limitUsdMicros: DIRECT_PULSE_ALLOWANCE_USD_MICROS,
      periodEnd: nextPeriodEnd,
      periodStart: nextPeriodStart,
      remainingUsdMicros: DIRECT_PULSE_ALLOWANCE_USD_MICROS,
      spentUsdMicros: 0n,
    });

    expect(prisma.hostedAiUsagePeriod.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        limitUsdMicros: DIRECT_PULSE_ALLOWANCE_USD_MICROS,
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
      limitUsdMicros: DIRECT_EDGE_ALLOWANCE_USD_MICROS,
      spentUsdMicros: DIRECT_EDGE_ALLOWANCE_USD_MICROS,
    });

    await expect(resolveHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-03-29T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: false,
      userNotice: {
        code: "edge_usage_limit_reached",
        message: expect.not.stringContaining("addUsage=true"),
      },
    });
  });

  it("keeps Edge allowance while a Pulse switch is only scheduled locally", async () => {
    const prisma = createGatePrisma({
      billingPlanCode: "launch_edge_monthly",
      limitUsdMicros: DIRECT_EDGE_ALLOWANCE_USD_MICROS,
      scheduledBillingEffectiveAt: new Date("2026-04-01T00:00:00.000Z"),
      scheduledBillingPlanCode: "launch_monthly",
      spentUsdMicros: 15_000_000n,
    });

    await expect(resolveHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-03-29T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: true,
      billingPlanCode: "launch_edge_monthly",
      limitUsdMicros: DIRECT_EDGE_ALLOWANCE_USD_MICROS,
      remainingUsdMicros: 1_000_000n,
    });
  });

  it("uses Pulse allowance only after subscription reconciliation writes Pulse as current plan", async () => {
    const prisma = createGatePrisma({
      billingPlanCode: "launch_monthly",
      limitUsdMicros: DIRECT_PULSE_ALLOWANCE_USD_MICROS,
      spentUsdMicros: 5_400_000n,
    });

    await expect(resolveHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-03-29T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: true,
      billingPlanCode: "launch_monthly",
      limitUsdMicros: DIRECT_PULSE_ALLOWANCE_USD_MICROS,
      remainingUsdMicros: 1_000_000n,
    });
  });

  it("uses non-expiring starter credit regardless of legacy trial timestamps", async () => {
    const prisma = createGatePrisma({
      billingPhase: "trial",
      checkoutOffer: "pulse_trial_7d",
      limitUsdMicros: 0n,
      periodEnd: new Date("2099-12-31T23:59:59.999Z"),
      periodStart: new Date(0),
      spentUsdMicros: 2_000_000n,
      trialEndsAt: new Date("2026-04-02T12:00:00.000Z"),
      trialStartedAt: new Date("2026-03-19T12:00:00.000Z"),
      usageCreditBalanceUsdMicros: 2_500_000n,
      usageCreditLedgerVersion: 2n,
    });

    await expect(resolveHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-04-20T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: true,
      allowanceSource: "direct_starter",
      billingPlanCode: "launch_monthly",
      limitUsdMicros: 0n,
      periodEnd: new Date("2099-12-31T23:59:59.999Z"),
      periodStart: new Date(0),
      remainingUsdMicros: 2_500_000n,
      usageCreditBalanceUsdMicros: 2_500_000n,
      usageCreditLedgerVersion: 2n,
    });
  });

  it("routes exhausted non-expiring starter credit to Settings recovery", async () => {
    const prisma = createGatePrisma({
      billingPhase: "trial",
      checkoutOffer: "pulse_trial_7d",
      limitUsdMicros: 0n,
      periodEnd: new Date("2099-12-31T23:59:59.999Z"),
      periodStart: new Date(0),
      spentUsdMicros: 4_500_000n,
      trialEndsAt: new Date("2026-04-02T12:00:00.000Z"),
      trialStartedAt: new Date("2026-03-19T12:00:00.000Z"),
      usageCreditBalanceUsdMicros: 0n,
      usageCreditLedgerVersion: 2n,
    });

    await expect(resolveHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-04-20T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: false,
      allowanceSource: "direct_starter",
      reason: "ai_usage_limit_exceeded",
      userNotice: {
        code: "starter_usage_limit_reached",
        message: expect.stringContaining(
          "https://withmurph.ai/settings?usageRecovery=true#subscription",
        ),
      },
    });
  });

  it("opens a fresh paid allowance when an exhausted Starter member begins paying", async () => {
    const paidPeriodStart = new Date("2026-08-09T12:00:00.000Z");
    const paidPeriodEnd = new Date("2026-09-09T12:00:00.000Z");
    const now = new Date("2026-08-09T12:01:00.000Z");
    const prisma = createGatePrisma({
      billingPhase: "paid",
      billingPlanCode: "launch_monthly",
      checkoutOffer: "standard",
      findUniquePeriod: null,
      periodEnd: paidPeriodEnd,
      periodStart: paidPeriodStart,
      spentUsdMicros: 0n,
      usageCreditBalanceUsdMicros: 0n,
      usageCreditLedgerVersion: 2n,
    });

    await expect(reconcileHostedAiUsageGateForBillingModeChangeTx({
      memberId: "member_123",
      now,
      tx: prisma as never,
    })).resolves.toBeUndefined();

    expect(prisma.hostedAiUsagePeriod.createMany).toHaveBeenCalledWith({
      data: {
        billingPlanCode: "launch_monthly",
        highestBillingPlanCode: "launch_monthly",
        limitUsdMicros: DIRECT_PULSE_ALLOWANCE_USD_MICROS,
        memberId: "member_123",
        periodEnd: paidPeriodEnd,
        periodStart: paidPeriodStart,
        spentUsdMicros: 0n,
      },
      skipDuplicates: true,
    });
  });

  it("allows Family-sponsored members regardless of legacy direct trial timestamps", async () => {
    const prisma = createGatePrisma({
      billingPhase: "trial",
      checkoutOffer: "pulse_trial_7d",
      familyAccessActive: true,
      findUniquePeriod: null,
      periodEnd: new Date("2026-05-01T00:00:00.000Z"),
      periodStart: new Date("2026-04-01T00:00:00.000Z"),
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
      allowed: true,
      billingPlanCode: "launch_monthly",
      limitUsdMicros: FAMILY_PULSE_ALLOWANCE_USD_MICROS,
      periodEnd: new Date("2026-05-01T00:00:00.000Z"),
      periodStart: new Date("2026-04-01T00:00:00.000Z"),
      remainingUsdMicros: FAMILY_PULSE_ALLOWANCE_USD_MICROS,
      spentUsdMicros: 0n,
    });
    expect(prisma.hostedAiUsagePeriod.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        billingPlanCode: "launch_monthly",
        memberId: "member_123",
        periodEnd: new Date("2026-05-01T00:00:00.000Z"),
        periodStart: new Date("2026-04-01T00:00:00.000Z"),
      }),
    }));
  });

  it("uses the sponsored member's exact Edge allowance", async () => {
    const prisma = createGatePrisma({
      billingStatus: HostedBillingStatus.not_started,
      familyAccessActive: true,
      familyPlanCode: "edge",
      findUniquePeriod: null,
      periodEnd: new Date("2026-05-01T00:00:00.000Z"),
      periodStart: new Date("2026-04-01T00:00:00.000Z"),
      spentUsdMicros: 0n,
    });

    await expect(resolveHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-04-09T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: true,
      billingPlanCode: "launch_edge_monthly",
      limitUsdMicros: FAMILY_EDGE_ALLOWANCE_USD_MICROS,
      remainingUsdMicros: FAMILY_EDGE_ALLOWANCE_USD_MICROS,
    });
  });

  it("uses the sponsored member's exact Max allowance", async () => {
    const prisma = createGatePrisma({
      billingStatus: HostedBillingStatus.not_started,
      familyAccessActive: true,
      familyPlanCode: "max",
      findUniquePeriod: null,
      periodEnd: new Date("2026-05-01T00:00:00.000Z"),
      periodStart: new Date("2026-04-01T00:00:00.000Z"),
      spentUsdMicros: 0n,
    });

    await expect(resolveHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-04-09T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: true,
      billingPlanCode: "launch_max_monthly",
      limitUsdMicros: FAMILY_MAX_ALLOWANCE_USD_MICROS,
      remainingUsdMicros: FAMILY_MAX_ALLOWANCE_USD_MICROS,
    });
  });

  it("uses a calendar period for Family-sponsored members when the group period is missing", async () => {
    const prisma = createGatePrisma({
      billingStatus: HostedBillingStatus.not_started,
      familyAccessActive: true,
      familyPeriodEnd: null,
      familyPeriodStart: null,
      findUniquePeriod: null,
      periodEnd: new Date("2026-05-01T00:00:00.000Z"),
      periodStart: new Date("2026-04-01T00:00:00.000Z"),
      spentUsdMicros: 0n,
    });

    await expect(resolveHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-04-09T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: true,
      allowanceSource: "family_sponsored_plan",
      billingPlanCode: "launch_monthly",
      limitUsdMicros: FAMILY_PULSE_ALLOWANCE_USD_MICROS,
      periodEnd: new Date("2026-05-01T00:00:00.000Z"),
      periodStart: new Date("2026-04-01T00:00:00.000Z"),
      remainingUsdMicros: FAMILY_PULSE_ALLOWANCE_USD_MICROS,
      spentUsdMicros: 0n,
    });
  });

  it("keeps Family sponsorship when the group billing projection is invalid", async () => {
    const prisma = createGatePrisma({
      billingPhase: "trial",
      billingStatus: HostedBillingStatus.canceled,
      checkoutOffer: "pulse_trial_7d",
      familyAccessActive: true,
      familyBillingPlanCode: "launch_monthly",
      findUniquePeriod: null,
      periodEnd: new Date("2026-05-01T00:00:00.000Z"),
      periodStart: new Date("2026-04-01T00:00:00.000Z"),
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
      allowed: true,
      billingPlanCode: "launch_monthly",
      limitUsdMicros: FAMILY_PULSE_ALLOWANCE_USD_MICROS,
      periodEnd: new Date("2026-05-01T00:00:00.000Z"),
      periodStart: new Date("2026-04-01T00:00:00.000Z"),
      remainingUsdMicros: FAMILY_PULSE_ALLOWANCE_USD_MICROS,
      spentUsdMicros: 0n,
    });
  });

  it("reports inactive access for canceled legacy trial members", async () => {
    const prisma = createGatePrisma({
      billingPhase: "trial",
      billingStatus: HostedBillingStatus.canceled,
      checkoutOffer: "pulse_trial_7d",
      periodEnd: new Date("2026-04-08T12:00:00.000Z"),
      periodStart: new Date("2026-04-01T12:00:00.000Z"),
      pulseTrialPolicyVersion: "pulse-trial-2026-06-30-v2",
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
      billingRefUpdatedAt: new Date("2026-04-08T11:59:59.000Z"),
      checkoutOffer: "pulse_trial_7d",
      periodEnd: new Date("2026-05-08T12:00:00.000Z"),
      periodStart: new Date("2026-04-08T12:00:00.000Z"),
      pulseTrialPolicyVersion: "pulse-trial-2026-06-30-v2",
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
      limitUsdMicros: DIRECT_PULSE_ALLOWANCE_USD_MICROS,
      periodEnd: new Date("2026-05-08T12:00:00.000Z"),
      periodStart: new Date("2026-04-08T12:00:00.000Z"),
      remainingUsdMicros: 3_400_000n,
      spentUsdMicros: 3_000_000n,
    });
  });

  it("preserves a legacy fixed Edge limit through its current paid period", async () => {
    const update = vi.fn();
    const prisma = createGatePrisma({
      billingPlanCode: "launch_edge_monthly",
      limitUsdMicros: 25_000_000n,
      periodEnd: new Date("2026-04-01T00:00:00.000Z"),
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
      spentUsdMicros: 17_000_000n,
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
      remainingUsdMicros: 8_000_000n,
      spentUsdMicros: 17_000_000n,
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("starts the following Edge period with the price-derived allowance", async () => {
    const periodStart = new Date("2026-04-01T00:00:00.000Z");
    const periodEnd = new Date("2026-05-01T00:00:00.000Z");
    const prisma = createGatePrisma({
      billingPlanCode: "launch_edge_monthly",
      findUniquePeriod: null,
      periodEnd,
      periodStart,
      spentUsdMicros: 0n,
    });

    await expect(resolveHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-04-01T00:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: true,
      billingPlanCode: "launch_edge_monthly",
      limitUsdMicros: DIRECT_EDGE_ALLOWANCE_USD_MICROS,
      remainingUsdMicros: DIRECT_EDGE_ALLOWANCE_USD_MICROS,
    });
    expect(prisma.hostedAiUsagePeriod.createMany).toHaveBeenCalledWith({
      data: {
        billingPlanCode: "launch_edge_monthly",
        highestBillingPlanCode: "launch_edge_monthly",
        limitUsdMicros: DIRECT_EDGE_ALLOWANCE_USD_MICROS,
        memberId: "member_123",
        periodEnd,
        periodStart,
        spentUsdMicros: 0n,
      },
      skipDuplicates: true,
    });
  });

  it("resets current-period spend when Pulse upgrades to Edge", async () => {
    const planResetAt = new Date("2026-03-29T11:59:00.000Z");
    const update = vi.fn(async (args: {
      data: {
        billingPlanCode: string;
        blockedAt: Date | null;
        highestBillingPlanCode: string;
        limitUsdMicros: bigint;
        periodEnd: Date;
        planResetAt?: Date;
        spentUsdMicros?: bigint;
      };
    }) => ({
      billingPlanCode: args.data.billingPlanCode,
      blockedAt: args.data.blockedAt,
      highestBillingPlanCode: args.data.highestBillingPlanCode,
      limitUsdMicros: args.data.limitUsdMicros,
      periodEnd: args.data.periodEnd,
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
      planResetAt: args.data.planResetAt ?? null,
      spentUsdMicros: args.data.spentUsdMicros ?? 6_000_000n,
    }));
    const prisma = createGatePrisma({
      billingPlanCode: "launch_edge_monthly",
      billingRefUpdatedAt: planResetAt,
      findUniquePeriod: {
        billingPlanCode: "launch_monthly",
        blockedAt: new Date("2026-03-28T12:00:00.000Z"),
        limitUsdMicros: DIRECT_PULSE_ALLOWANCE_USD_MICROS,
        periodEnd: new Date("2026-04-01T00:00:00.000Z"),
        periodStart: new Date("2026-03-01T00:00:00.000Z"),
        spentUsdMicros: 6_000_000n,
      },
      periodEnd: new Date("2026-04-01T00:00:00.000Z"),
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
      spentUsdMicros: 6_000_000n,
      update,
    });

    await expect(resolveHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-03-29T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: true,
      billingPlanCode: "launch_edge_monthly",
      limitUsdMicros: DIRECT_EDGE_ALLOWANCE_USD_MICROS,
      remainingUsdMicros: DIRECT_EDGE_ALLOWANCE_USD_MICROS,
      planResetAt,
      spentUsdMicros: 0n,
    });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        billingPlanCode: "launch_edge_monthly",
        blockedAt: null,
        highestBillingPlanCode: "launch_edge_monthly",
        limitUsdMicros: DIRECT_EDGE_ALLOWANCE_USD_MICROS,
        planResetAt,
        spentUsdMicros: 0n,
      }),
    }));
  });

  it("adopts an old writer's reset epoch without erasing later Edge spend", async () => {
    const planResetAt = new Date("2026-03-29T11:59:00.000Z");
    const postResetSpendUsdMicros = 700_000n;
    const update = vi.fn(async (args: {
      data: {
        billingPlanCode?: string;
        blockedAt?: Date | null;
        highestBillingPlanCode?: string;
        limitUsdMicros?: bigint;
        periodEnd?: Date;
        planResetAt?: Date;
      };
    }) => ({
      billingPlanCode: args.data.billingPlanCode ?? "launch_edge_monthly",
      blockedAt: args.data.blockedAt ?? null,
      highestBillingPlanCode:
        args.data.highestBillingPlanCode ?? "launch_monthly",
      limitUsdMicros:
        args.data.limitUsdMicros ?? DIRECT_EDGE_ALLOWANCE_USD_MICROS,
      periodEnd:
        args.data.periodEnd ?? new Date("2026-04-01T00:00:00.000Z"),
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
      planResetAt: args.data.planResetAt ?? null,
      spentUsdMicros: postResetSpendUsdMicros,
    }));
    const prisma = createGatePrisma({
      billingPlanCode: "launch_edge_monthly",
      billingRefUpdatedAt: planResetAt,
      findUniquePeriod: {
        billingPlanCode: "launch_edge_monthly",
        highestBillingPlanCode: "launch_monthly",
        limitUsdMicros: DIRECT_EDGE_ALLOWANCE_USD_MICROS,
        periodEnd: new Date("2026-04-01T00:00:00.000Z"),
        periodStart: new Date("2026-03-01T00:00:00.000Z"),
        planResetAt: null,
        spentUsdMicros: postResetSpendUsdMicros,
      },
      periodEnd: new Date("2026-04-01T00:00:00.000Z"),
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
      spentUsdMicros: postResetSpendUsdMicros,
      update,
    });

    await expect(resolveHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-03-29T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      planResetAt,
      spentUsdMicros: postResetSpendUsdMicros,
    });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        highestBillingPlanCode: "launch_edge_monthly",
        planResetAt,
      }),
    }));
    const updateData = (update.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    }).data;
    expect(updateData).not.toHaveProperty("spentUsdMicros");
  });

  it("keeps the authoritative cutover when unrelated billing bookkeeping changes later", async () => {
    const planResetAt = new Date("2026-03-29T11:55:00.000Z");
    const prisma = createGatePrisma({
      billingPlanCode: "launch_edge_monthly",
      billingRefBookkeepingUpdatedAt: new Date("2026-03-29T11:59:00.000Z"),
      billingRefUpdatedAt: planResetAt,
      findUniquePeriod: {
        billingPlanCode: "launch_monthly",
        highestBillingPlanCode: "launch_monthly",
        limitUsdMicros: DIRECT_PULSE_ALLOWANCE_USD_MICROS,
        periodEnd: new Date("2026-04-01T00:00:00.000Z"),
        periodStart: new Date("2026-03-01T00:00:00.000Z"),
        spentUsdMicros: 6_000_000n,
      },
      periodEnd: new Date("2026-04-01T00:00:00.000Z"),
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
      spentUsdMicros: 6_000_000n,
    });

    await expect(resolveHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-03-29T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      planResetAt,
      spentUsdMicros: 0n,
    });
  });

  it("fails closed when a legacy row has no historical plan classification", async () => {
    const update = vi.fn(async (args: {
      data: {
        billingPlanCode: string;
        blockedAt: Date | null;
        highestBillingPlanCode: string;
        limitUsdMicros: bigint;
        periodEnd: Date;
      };
    }) => ({
      ...args.data,
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
      planResetAt: null,
      spentUsdMicros: 3_000_000n,
    }));
    const prisma = createGatePrisma({
      billingPlanCode: "launch_edge_monthly",
      billingRefUpdatedAt: new Date("2026-03-29T11:59:00.000Z"),
      findUniquePeriod: {
        billingPlanCode: "launch_monthly",
        highestBillingPlanCode: null,
        limitUsdMicros: DIRECT_PULSE_ALLOWANCE_USD_MICROS,
        periodEnd: new Date("2026-04-01T00:00:00.000Z"),
        periodStart: new Date("2026-03-01T00:00:00.000Z"),
        spentUsdMicros: 3_000_000n,
      },
      periodEnd: new Date("2026-04-01T00:00:00.000Z"),
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
      spentUsdMicros: 3_000_000n,
      update,
    });

    await expect(resolveHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-03-29T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      planResetAt: null,
      spentUsdMicros: 3_000_000n,
    });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        highestBillingPlanCode: "launch_edge_monthly",
      }),
    }));
    const updateData = (update.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    }).data;
    expect(updateData).not.toHaveProperty("planResetAt");
    expect(updateData).not.toHaveProperty("spentUsdMicros");
  });

  it("does not grant Family Edge twice after a same-period downgrade and re-upgrade", async () => {
    const update = vi.fn(async (args: {
      data: {
        billingPlanCode: string;
        blockedAt: Date | null;
        highestBillingPlanCode: string;
        limitUsdMicros: bigint;
        periodEnd: Date;
        planResetAt?: Date;
        spentUsdMicros?: bigint;
      };
    }) => ({
      billingPlanCode: args.data.billingPlanCode,
      blockedAt: args.data.blockedAt,
      highestBillingPlanCode: args.data.highestBillingPlanCode,
      limitUsdMicros: args.data.limitUsdMicros,
      periodEnd: args.data.periodEnd,
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
      planResetAt: args.data.planResetAt ?? new Date("2026-03-10T12:00:00.000Z"),
      spentUsdMicros: args.data.spentUsdMicros ?? 3_000_000n,
    }));
    const prisma = createGatePrisma({
      billingPlanCode: "launch_monthly",
      billingStatus: HostedBillingStatus.not_started,
      familyAccessActive: true,
      familyPlanCode: "edge",
      familyUpdatedAt: new Date("2026-03-29T12:00:00.000Z"),
      findUniquePeriod: {
        billingPlanCode: "launch_monthly",
        blockedAt: null,
        highestBillingPlanCode: "launch_edge_monthly",
        limitUsdMicros: FAMILY_PULSE_ALLOWANCE_USD_MICROS,
        periodEnd: new Date("2026-04-01T00:00:00.000Z"),
        periodStart: new Date("2026-03-01T00:00:00.000Z"),
        planResetAt: new Date("2026-03-10T12:00:00.000Z"),
        spentUsdMicros: 3_000_000n,
      },
      periodEnd: new Date("2026-04-01T00:00:00.000Z"),
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
      spentUsdMicros: 3_000_000n,
      update,
    });

    await expect(resolveHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-03-29T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: true,
      billingPlanCode: "launch_edge_monthly",
      limitUsdMicros: FAMILY_EDGE_ALLOWANCE_USD_MICROS,
      remainingUsdMicros: FAMILY_EDGE_ALLOWANCE_USD_MICROS - 3_000_000n,
      spentUsdMicros: 3_000_000n,
    });

    const updateData = (update.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    }).data;
    expect(updateData.highestBillingPlanCode).toBe("launch_edge_monthly");
    expect(updateData).not.toHaveProperty("planResetAt");
    expect(updateData).not.toHaveProperty("spentUsdMicros");
  });

  it("resets trial spend when a same-period Pulse Trial converts to paid Pulse", async () => {
    const periodStart = new Date("2026-04-01T12:00:00.000Z");
    const paidPeriodEnd = new Date("2026-05-01T12:00:00.000Z");
    const update = vi.fn(async (args: {
      data: {
        billingPlanCode: string;
        blockedAt: Date | null;
        limitUsdMicros: bigint;
        periodEnd: Date;
        spentUsdMicros?: bigint;
      };
    }) => ({
      billingPlanCode: args.data.billingPlanCode,
      blockedAt: args.data.blockedAt,
      limitUsdMicros: args.data.limitUsdMicros,
      periodEnd: args.data.periodEnd,
      periodStart,
      spentUsdMicros: args.data.spentUsdMicros ?? 4_000_000n,
    }));
    const prisma = createGatePrisma({
      billingPhase: "paid",
      billingRefUpdatedAt: new Date("2026-04-08T11:59:59.000Z"),
      checkoutOffer: "pulse_trial_7d",
      findUniquePeriod: {
        billingPlanCode: "launch_monthly",
        blockedAt: new Date("2026-04-07T12:00:00.000Z"),
        limitUsdMicros: 4_500_000n,
        periodEnd: new Date("2026-04-08T12:00:00.000Z"),
        periodStart,
        spentUsdMicros: 4_000_000n,
      },
      periodEnd: paidPeriodEnd,
      periodStart,
      pulseTrialPolicyVersion: "pulse-trial-2026-06-30-v2",
      pulseTrialRedeemedAt: periodStart,
      spentUsdMicros: 4_000_000n,
      trialEndsAt: new Date("2026-04-08T12:00:00.000Z"),
      trialStartedAt: periodStart,
      update,
    });

    await expect(resolveHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-04-08T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: true,
      billingPlanCode: "launch_monthly",
      limitUsdMicros: DIRECT_PULSE_ALLOWANCE_USD_MICROS,
      periodEnd: paidPeriodEnd,
      remainingUsdMicros: DIRECT_PULSE_ALLOWANCE_USD_MICROS,
      spentUsdMicros: 0n,
    });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        billingPlanCode: "launch_monthly",
        blockedAt: null,
        limitUsdMicros: DIRECT_PULSE_ALLOWANCE_USD_MICROS,
        periodEnd: paidPeriodEnd,
        spentUsdMicros: 0n,
      }),
    }));
  });

  it("does not reset an ordinary paid Pulse allowance change", async () => {
    const periodStart = new Date("2026-04-08T12:00:00.000Z");
    const periodEnd = new Date("2026-05-08T12:00:00.000Z");
    const update = vi.fn(async (args: {
      data: {
        billingPlanCode: string;
        blockedAt: Date | null;
        limitUsdMicros: bigint;
        periodEnd: Date;
        spentUsdMicros?: bigint;
      };
    }) => ({
      billingPlanCode: args.data.billingPlanCode,
      blockedAt: args.data.blockedAt,
      limitUsdMicros: args.data.limitUsdMicros,
      periodEnd: args.data.periodEnd,
      periodStart,
      spentUsdMicros: args.data.spentUsdMicros ?? 4_000_000n,
    }));
    const prisma = createGatePrisma({
      billingPhase: "paid",
      checkoutOffer: "pulse_trial_7d",
      findUniquePeriod: {
        billingPlanCode: "launch_monthly",
        limitUsdMicros: 4_500_000n,
        periodEnd,
        periodStart,
        spentUsdMicros: 4_000_000n,
      },
      periodEnd,
      periodStart,
      pulseTrialPolicyVersion: "pulse-trial-2026-06-30-v2",
      pulseTrialRedeemedAt: new Date("2026-04-01T12:00:00.000Z"),
      spentUsdMicros: 4_000_000n,
      trialEndsAt: periodStart,
      trialStartedAt: new Date("2026-04-01T12:00:00.000Z"),
      update,
    });

    await expect(resolveHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-04-09T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: true,
      billingPlanCode: "launch_monthly",
      limitUsdMicros: DIRECT_PULSE_ALLOWANCE_USD_MICROS,
      remainingUsdMicros: 2_400_000n,
      spentUsdMicros: 4_000_000n,
    });
    const updateData = (update.mock.calls[0]?.[0] as {
      data?: Record<string, unknown>;
    } | undefined)?.data;
    expect(updateData).not.toHaveProperty("spentUsdMicros");
  });

  it("preserves spend after the upgraded Edge period is already reconciled", async () => {
    const update = vi.fn();
    const prisma = createGatePrisma({
      billingPlanCode: "launch_edge_monthly",
      billingRefUpdatedAt: new Date("2026-03-29T11:59:00.000Z"),
      findUniquePeriod: {
        billingPlanCode: "launch_edge_monthly",
        limitUsdMicros: DIRECT_EDGE_ALLOWANCE_USD_MICROS,
        periodEnd: new Date("2026-04-01T00:00:00.000Z"),
        periodStart: new Date("2026-03-01T00:00:00.000Z"),
        spentUsdMicros: 2_000_000n,
      },
      limitUsdMicros: DIRECT_EDGE_ALLOWANCE_USD_MICROS,
      spentUsdMicros: 2_000_000n,
      update,
    });

    await expect(resolveHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-03-29T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: true,
      billingPlanCode: "launch_edge_monthly",
      limitUsdMicros: DIRECT_EDGE_ALLOWANCE_USD_MICROS,
      remainingUsdMicros: 14_000_000n,
      spentUsdMicros: 2_000_000n,
    });
    expect(update).not.toHaveBeenCalled();
  });

  it.each([
    {
      billingPlanCode: "launch_monthly",
      familyPlanCode: "pulse" as const,
      legacyLimitUsdMicros: 10_000_000n,
      resolvedLimitUsdMicros: FAMILY_PULSE_ALLOWANCE_USD_MICROS,
      spentUsdMicros: 6_000_000n,
    },
    {
      billingPlanCode: "launch_edge_monthly",
      familyPlanCode: "edge" as const,
      legacyLimitUsdMicros: 25_000_000n,
      resolvedLimitUsdMicros: FAMILY_EDGE_ALLOWANCE_USD_MICROS,
      spentUsdMicros: 16_000_000n,
    },
  ])(
    "reconciles direct $familyPlanCode legacy capacity at the Family billing-mode handoff",
    async ({
      billingPlanCode,
      familyPlanCode,
      legacyLimitUsdMicros,
      resolvedLimitUsdMicros,
      spentUsdMicros,
    }) => {
      const now = new Date("2026-03-29T12:00:00.000Z");
      const periodStart = new Date("2026-03-01T00:00:00.000Z");
      const periodEnd = new Date("2026-04-01T00:00:00.000Z");
      const update = vi.fn(async (args: {
        data: {
          billingPlanCode: string;
          blockedAt: Date | null;
          limitUsdMicros: bigint;
          periodEnd: Date;
        };
      }) => ({
        billingPlanCode: args.data.billingPlanCode,
        blockedAt: args.data.blockedAt,
        limitUsdMicros: args.data.limitUsdMicros,
        periodEnd: args.data.periodEnd,
        periodStart,
        spentUsdMicros,
      }));
      const tx = createGatePrisma({
        billingPlanCode,
        billingStatus: HostedBillingStatus.not_started,
        familyAccessActive: true,
        familyPlanCode,
        limitUsdMicros: legacyLimitUsdMicros,
        periodEnd,
        periodStart,
        spentUsdMicros,
        update,
      });

      await expect(reconcileHostedAiUsageGateForBillingModeChangeTx({
        memberId: "member_123",
        now,
        tx: tx as never,
      })).resolves.toBeUndefined();

      expect(update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          billingPlanCode,
          blockedAt: now,
          limitUsdMicros: resolvedLimitUsdMicros,
          periodEnd,
        }),
      }));
      const updateData =
        (update.mock.calls[0]?.[0] as { data?: Record<string, unknown> } | undefined)
          ?.data;
      expect(updateData).not.toHaveProperty("spentUsdMicros");
    },
  );

  it("uses billing-period counter without aggregating historical usage rows", async () => {
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
        limitUsdMicros: DIRECT_PULSE_ALLOWANCE_USD_MICROS,
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
    expect(queryRaw).toHaveBeenCalledTimes(2);
    const queryRawSql = queryRaw.mock.calls.map(([sql]) =>
      Array.isArray(sql) ? sql.join("") : String(sql)
    );
    expect(queryRawSql[0]).toContain('FROM "hosted_member"');
    expect(queryRawSql[0]).toContain("FOR UPDATE");
    expect(queryRawSql[1]).toContain('FROM "hosted_ai_usage_period"');
    expect(queryRawSql[1]).toContain("FOR UPDATE");
    expect(queryRawSql.join("\n")).not.toContain('WITH "candidates"');
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(aggregate).not.toHaveBeenCalled();
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

  it("clears stale block metadata without rewriting usage totals", async () => {
    const aggregate = vi.fn(async () => ({
      _max: {
        occurredAt: new Date("2026-04-20T12:00:00.000Z"),
      },
      _sum: {
        allowanceCostUsdMicros: 177_000_000n,
      },
    }));
    const update = vi.fn(async (args?: unknown) => {
      void args;
      return undefined;
    });
    const prisma = createGatePrisma({
      aggregate,
      billingPlanCode: "launch_edge_monthly",
      findUniquePeriod: {
        billingPlanCode: "launch_edge_monthly",
        blockedAt: new Date("2026-04-20T12:00:00.000Z"),
        limitUsdMicros: DIRECT_EDGE_ALLOWANCE_USD_MICROS,
        periodEnd: new Date("2026-05-15T00:00:00.000Z"),
        periodStart: new Date("2026-04-15T00:00:00.000Z"),
        spentUsdMicros: 0n,
      },
      limitUsdMicros: DIRECT_EDGE_ALLOWANCE_USD_MICROS,
      periodEnd: new Date("2026-05-15T00:00:00.000Z"),
      periodStart: new Date("2026-04-15T00:00:00.000Z"),
      spentUsdMicros: 0n,
      update,
    });

    await expect(resolveHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-04-20T12:05:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: true,
      limitUsdMicros: DIRECT_EDGE_ALLOWANCE_USD_MICROS,
      remainingUsdMicros: DIRECT_EDGE_ALLOWANCE_USD_MICROS,
      spentUsdMicros: 0n,
    });

    expect(aggregate).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        blockedAt: null,
      }),
    }));
    const updateData = (update.mock.calls[0]?.[0] as { data?: Record<string, unknown> } | undefined)
      ?.data;
    expect(updateData).not.toHaveProperty("lastUsageAt");
    expect(updateData).not.toHaveProperty("spentUsdMicros");
  });
});

describe("readHostedAiUsageGate", () => {
  it("shows zero spend immediately when Pulse upgrades to Edge", async () => {
    const prisma = createGatePrisma({
      billingPlanCode: "launch_edge_monthly",
      billingRefUpdatedAt: new Date("2026-03-29T11:59:00.000Z"),
      findUniquePeriod: {
        billingPlanCode: "launch_monthly",
        blockedAt: new Date("2026-03-28T12:00:00.000Z"),
        limitUsdMicros: DIRECT_PULSE_ALLOWANCE_USD_MICROS,
        periodEnd: new Date("2026-04-01T00:00:00.000Z"),
        periodStart: new Date("2026-03-01T00:00:00.000Z"),
        spentUsdMicros: 6_000_000n,
      },
      periodEnd: new Date("2026-04-01T00:00:00.000Z"),
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
      spentUsdMicros: 6_000_000n,
    });

    await expect(readHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-03-29T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: true,
      billingPlanCode: "launch_edge_monthly",
      limitUsdMicros: DIRECT_EDGE_ALLOWANCE_USD_MICROS,
      remainingUsdMicros: DIRECT_EDGE_ALLOWANCE_USD_MICROS,
      spentUsdMicros: 0n,
    });

    expect(prisma.hostedAiUsagePeriod.createMany).not.toHaveBeenCalled();
    expect(prisma.hostedAiUsagePeriod.update).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("shows zero spend immediately when a Pulse Trial converts to paid Pulse", async () => {
    const periodStart = new Date("2026-04-01T12:00:00.000Z");
    const paidPeriodEnd = new Date("2026-05-01T12:00:00.000Z");
    const prisma = createGatePrisma({
      billingPhase: "paid",
      billingRefUpdatedAt: new Date("2026-04-08T11:59:59.000Z"),
      checkoutOffer: "pulse_trial_7d",
      findUniquePeriod: {
        billingPlanCode: "launch_monthly",
        blockedAt: new Date("2026-04-07T12:00:00.000Z"),
        limitUsdMicros: 4_500_000n,
        periodEnd: new Date("2026-04-08T12:00:00.000Z"),
        periodStart,
        spentUsdMicros: 4_000_000n,
      },
      periodEnd: paidPeriodEnd,
      periodStart,
      pulseTrialPolicyVersion: "pulse-trial-2026-06-30-v2",
      pulseTrialRedeemedAt: periodStart,
      spentUsdMicros: 4_000_000n,
      trialEndsAt: new Date("2026-04-08T12:00:00.000Z"),
      trialStartedAt: periodStart,
    });

    await expect(readHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-04-08T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: true,
      billingPlanCode: "launch_monthly",
      limitUsdMicros: DIRECT_PULSE_ALLOWANCE_USD_MICROS,
      periodEnd: paidPeriodEnd,
      remainingUsdMicros: DIRECT_PULSE_ALLOWANCE_USD_MICROS,
      spentUsdMicros: 0n,
    });

    expect(prisma.hostedAiUsagePeriod.createMany).not.toHaveBeenCalled();
    expect(prisma.hostedAiUsagePeriod.update).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("honors manual usage-period counter resets on the read-first gate", async () => {
    const aggregate = vi.fn(async () => ({
      _max: {
        occurredAt: new Date("2026-04-20T12:00:00.000Z"),
      },
      _sum: {
        allowanceCostUsdMicros: 177_000_000n,
      },
    }));
    const prisma = createGatePrisma({
      aggregate,
      billingPlanCode: "launch_edge_monthly",
      findUniquePeriod: {
        billingPlanCode: "launch_edge_monthly",
        blockedAt: new Date("2026-04-20T12:00:00.000Z"),
        limitUsdMicros: DIRECT_EDGE_ALLOWANCE_USD_MICROS,
        periodEnd: new Date("2026-05-15T00:00:00.000Z"),
        periodStart: new Date("2026-04-15T00:00:00.000Z"),
        spentUsdMicros: 0n,
      },
      limitUsdMicros: DIRECT_EDGE_ALLOWANCE_USD_MICROS,
      periodEnd: new Date("2026-05-15T00:00:00.000Z"),
      periodStart: new Date("2026-04-15T00:00:00.000Z"),
      spentUsdMicros: 0n,
    });

    await expect(checkHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-04-20T12:05:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: true,
      limitUsdMicros: DIRECT_EDGE_ALLOWANCE_USD_MICROS,
      remainingUsdMicros: DIRECT_EDGE_ALLOWANCE_USD_MICROS,
      spentUsdMicros: 0n,
    });

    expect(prisma.hostedAiUsagePeriod.createMany).not.toHaveBeenCalled();
    expect(prisma.hostedAiUsagePeriod.update).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(aggregate).not.toHaveBeenCalled();
    expect(prisma.hostedMember.findUnique).toHaveBeenCalledTimes(1);
  });

  it("reads Family-sponsored allowance instead of stale direct trial state without writes", async () => {
    const prisma = createGatePrisma({
      billingPhase: "trial",
      checkoutOffer: "pulse_trial_7d",
      familyAccessActive: true,
      findUniquePeriod: null,
      periodEnd: new Date("2026-05-01T00:00:00.000Z"),
      periodStart: new Date("2026-04-01T00:00:00.000Z"),
      pulseTrialPolicyVersion: "pulse-trial-2026-05-05-v1",
      spentUsdMicros: 0n,
      trialEndsAt: new Date("2026-04-08T12:00:00.000Z"),
      trialStartedAt: new Date("2026-04-01T12:00:00.000Z"),
    });

    await expect(readHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-04-09T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: true,
      billingPlanCode: "launch_monthly",
      limitUsdMicros: FAMILY_PULSE_ALLOWANCE_USD_MICROS,
      periodEnd: new Date("2026-05-01T00:00:00.000Z"),
      periodStart: new Date("2026-04-01T00:00:00.000Z"),
      remainingUsdMicros: FAMILY_PULSE_ALLOWANCE_USD_MICROS,
      spentUsdMicros: 0n,
    });

    expect(prisma.hostedAiUsagePeriod.createMany).not.toHaveBeenCalled();
    expect(prisma.hostedAiUsagePeriod.update).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("keeps direct paid billing periods for Family-sponsored members", async () => {
    const prisma = createGatePrisma({
      billingPhase: "paid",
      billingPlanCode: "launch_edge_monthly",
      familyAccessActive: true,
      findUniquePeriod: null,
      periodEnd: new Date("2026-05-08T12:00:00.000Z"),
      periodStart: new Date("2026-04-08T12:00:00.000Z"),
      spentUsdMicros: 3_000_000n,
    });

    await expect(readHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-04-20T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: true,
      billingPlanCode: "launch_edge_monthly",
      limitUsdMicros: DIRECT_EDGE_ALLOWANCE_USD_MICROS,
      periodEnd: new Date("2026-05-08T12:00:00.000Z"),
      periodStart: new Date("2026-04-08T12:00:00.000Z"),
      remainingUsdMicros: DIRECT_EDGE_ALLOWANCE_USD_MICROS,
      spentUsdMicros: 0n,
    });

    expect(prisma.hostedAiUsagePeriod.createMany).not.toHaveBeenCalled();
    expect(prisma.hostedAiUsagePeriod.update).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("uses Family-sponsored allowance when stale direct paid phase is not active", async () => {
    const prisma = createGatePrisma({
      billingPhase: "paid",
      billingPlanCode: "launch_edge_monthly",
      billingStatus: HostedBillingStatus.canceled,
      familyAccessActive: true,
      findUniquePeriod: null,
      periodEnd: new Date("2026-05-01T00:00:00.000Z"),
      periodStart: new Date("2026-04-01T00:00:00.000Z"),
      spentUsdMicros: 0n,
    });

    await expect(readHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-04-20T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: true,
      billingPlanCode: "launch_monthly",
      limitUsdMicros: FAMILY_PULSE_ALLOWANCE_USD_MICROS,
      periodEnd: new Date("2026-05-01T00:00:00.000Z"),
      periodStart: new Date("2026-04-01T00:00:00.000Z"),
      remainingUsdMicros: FAMILY_PULSE_ALLOWANCE_USD_MICROS,
      spentUsdMicros: 0n,
    });
  });

  it("reads a direct legacy fixed Pulse limit through its current paid period", async () => {
    const prisma = createGatePrisma({
      billingPhase: "paid",
      billingPlanCode: "launch_monthly",
      limitUsdMicros: 10_000_000n,
      periodEnd: new Date("2026-04-01T00:00:00.000Z"),
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
      spentUsdMicros: 8_000_000n,
    });

    await expect(readHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-03-29T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: true,
      allowanceSource: "direct_paid_member_plan",
      billingPlanCode: "launch_monthly",
      limitUsdMicros: 10_000_000n,
      remainingUsdMicros: 2_000_000n,
      spentUsdMicros: 8_000_000n,
    });

    expect(prisma.hostedAiUsagePeriod.createMany).not.toHaveBeenCalled();
    expect(prisma.hostedAiUsagePeriod.update).not.toHaveBeenCalled();
  });

  it("reads a Family-sponsored legacy fixed Edge limit through its current paid period", async () => {
    const prisma = createGatePrisma({
      billingPlanCode: "launch_edge_monthly",
      billingStatus: HostedBillingStatus.not_started,
      familyAccessActive: true,
      familyPlanCode: "edge",
      limitUsdMicros: 25_000_000n,
      periodEnd: new Date("2026-04-01T00:00:00.000Z"),
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
      spentUsdMicros: 17_000_000n,
    });

    await expect(readHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-03-29T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: true,
      allowanceSource: "family_sponsored_plan",
      billingPlanCode: "launch_edge_monthly",
      limitUsdMicros: 25_000_000n,
      remainingUsdMicros: 8_000_000n,
      spentUsdMicros: 17_000_000n,
    });

    expect(prisma.hostedAiUsagePeriod.createMany).not.toHaveBeenCalled();
    expect(prisma.hostedAiUsagePeriod.update).not.toHaveBeenCalled();
  });

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
      allowed: true,
      spentUsdMicros: 0n,
    });

    expect(prisma.hostedAiUsagePeriod.createMany).not.toHaveBeenCalled();
    expect(prisma.hostedAiUsagePeriod.update).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(aggregate).not.toHaveBeenCalled();
  });

  it("uses a thread-container monthly cap instead of the normal member allowance", async () => {
    const prisma = createGatePrisma({
      spentUsdMicros: 1_000_000n,
      threadContainerLimitUsdMicros: 4_500_000n,
    });

    await expect(readHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-03-29T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: true,
      limitUsdMicros: 4_500_000n,
      remainingUsdMicros: 3_500_000n,
      spentUsdMicros: 1_000_000n,
    });

    expect(prisma.hostedAiUsagePeriod.createMany).not.toHaveBeenCalled();
    expect(prisma.hostedAiUsagePeriod.update).not.toHaveBeenCalled();
  });

  it("blocks exhausted thread-container usage with a neutral notice", async () => {
    const prisma = createGatePrisma({
      spentUsdMicros: 4_500_000n,
      threadContainerLimitUsdMicros: 4_500_000n,
    });

    await expect(readHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-03-29T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: false,
      allowanceSource: "thread_container",
      reason: "ai_usage_limit_exceeded",
      userNotice: {
        code: "thread_usage_limit_reached",
        message: expect.not.stringContaining("https://"),
      },
    });
  });

  it("allows a not_started container member through its active owner", async () => {
    // Containers are created not_started; their own billing must never be an
    // early denial — the container branch decides via the owner.
    const prisma = createGatePrisma({
      billingStatus: HostedBillingStatus.not_started,
      spentUsdMicros: 1_000_000n,
      threadContainerLimitUsdMicros: 4_500_000n,
    });

    await expect(readHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-03-29T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: true,
      limitUsdMicros: 4_500_000n,
      remainingUsdMicros: 3_500_000n,
    });
  });

  it("allows a not_started container member through a family-sponsored owner", async () => {
    const prisma = createGatePrisma({
      billingStatus: HostedBillingStatus.not_started,
      spentUsdMicros: 0n,
      threadContainerLimitUsdMicros: 4_500_000n,
      threadContainerOwnerFamilySponsored: true,
    });

    await expect(readHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-03-29T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: true,
      limitUsdMicros: 4_500_000n,
    });
  });

  it("denies a suspended container member even with an active owner", async () => {
    const prisma = createGatePrisma({
      billingStatus: HostedBillingStatus.not_started,
      spentUsdMicros: 0n,
      suspendedAt: new Date("2026-03-20T00:00:00.000Z"),
      threadContainerLimitUsdMicros: 4_500_000n,
    });

    await expect(readHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-03-29T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: false,
      reason: "hosted_access_inactive",
    });
  });

  it("denies thread-container usage when the owner authority is inactive", async () => {
    const prisma = createGatePrisma({
      billingStatus: HostedBillingStatus.not_started,
      spentUsdMicros: 1_000_000n,
      threadContainerLimitUsdMicros: 4_500_000n,
      threadContainerOwnerBillingStatus: HostedBillingStatus.paused,
    });

    await expect(readHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-03-29T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: false,
      limitUsdMicros: 4_500_000n,
      reason: "hosted_access_inactive",
      remainingUsdMicros: 0n,
      spentUsdMicros: 0n,
    });

    expect(prisma.hostedAiUsagePeriod.createMany).not.toHaveBeenCalled();
    expect(prisma.hostedAiUsagePeriod.update).not.toHaveBeenCalled();
  });

  it("allows thread-container usage when an active participant has access", async () => {
    const prisma = createGatePrisma({
      billingStatus: HostedBillingStatus.not_started,
      spentUsdMicros: 1_000_000n,
      threadContainerLimitUsdMicros: 4_500_000n,
      threadContainerOwnerBillingStatus: HostedBillingStatus.paused,
      threadContainerParticipantActive: true,
    });

    await expect(readHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-03-29T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: true,
      limitUsdMicros: 4_500_000n,
      remainingUsdMicros: 3_500_000n,
      spentUsdMicros: 1_000_000n,
    });

    expect(prisma.hostedThreadContainerParticipant.findFirst).toHaveBeenCalledWith({
      select: {
        participantMemberId: true,
      },
      where: expect.objectContaining({
        containerMemberId: "member_123",
        lastSeenAt: { gte: new Date("2026-03-22T12:00:00.000Z") },
        removedAt: null,
      }),
    });
  });

  it("uses usage-period spend for billing periods before allowing", async () => {
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
        limitUsdMicros: DIRECT_PULSE_ALLOWANCE_USD_MICROS,
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
      allowed: true,
      spentUsdMicros: 5_000_000n,
    });

    expect(prisma.hostedAiUsagePeriod.createMany).not.toHaveBeenCalled();
    expect(prisma.hostedAiUsagePeriod.update).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(aggregate).not.toHaveBeenCalled();
  });

  it("uses non-expiring starter credit without aggregating historical usage rows", async () => {
    const aggregate = vi.fn(async () => ({
      _max: { occurredAt: null },
      _sum: { allowanceCostUsdMicros: 0n },
    }));
    const periodStart = new Date(0);
    const periodEnd = new Date("2099-12-31T23:59:59.999Z");
    const prisma = createGatePrisma({
      aggregate,
      findUniquePeriod: {
        billingPlanCode: "launch_monthly",
        limitUsdMicros: 0n,
        periodEnd,
        periodStart,
        spentUsdMicros: 0n,
      },
      limitUsdMicros: 0n,
      periodEnd,
      periodStart,
      spentUsdMicros: 0n,
      stripeSubscriptionLookupKey: null,
      usageCreditBalanceUsdMicros: 2_800_000n,
      usageCreditLedgerVersion: 2n,
    });

    await expect(readHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-04-20T13:05:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: true,
      allowanceSource: "direct_starter",
      remainingUsdMicros: 2_800_000n,
      spentUsdMicros: 0n,
      usageCreditBalanceUsdMicros: 2_800_000n,
    });

    expect(prisma.hostedAiUsagePeriod.update).not.toHaveBeenCalled();
    expect(aggregate).not.toHaveBeenCalled();
  });

});

describe("readHostedAiUsageGateSnapshots", () => {
  it("uses the canonical gate decision and attaches exact persisted metadata", async () => {
    const now = new Date("2026-07-22T18:00:00.000Z");
    const periodStart = new Date("2026-07-05T00:00:00.000Z");
    const periodEnd = new Date("2026-08-05T00:00:00.000Z");
    const periodUpdatedAt = new Date("2026-07-22T17:00:00.000Z");
    const prisma = createGatePrisma({
      findUniquePeriod: {
        billingPlanCode: "launch_monthly",
        blockedAt: new Date("2026-07-22T16:55:00.000Z"),
        limitUsdMicros: 10_000_000n,
        periodEnd,
        periodStart,
        spentUsdMicros: 10_000_000n,
        updatedAt: periodUpdatedAt,
      },
      periodEnd,
      periodStart,
      spentUsdMicros: 10_000_000n,
    });
    const transaction = vi.fn(async (
      run: (tx: typeof prisma) => Promise<unknown>,
      options?: { isolationLevel?: string },
    ) => {
      void options;
      return run(prisma);
    });

    const snapshots = await readHostedAiUsageGateSnapshots({
      memberIds: ["member_123"],
      now,
      prisma: { $transaction: transaction } as never,
    });

    expect(snapshots.get("member_123")).toMatchObject({
      decision: {
        allowed: false,
        allowanceSource: "direct_paid_member_plan",
        periodEnd,
        periodStart,
        reason: "ai_usage_limit_exceeded",
        spentUsdMicros: 10_000_000n,
      },
      periodPersistedAt: periodUpdatedAt,
    });
    expect(prisma.hostedAiUsagePeriod.findUnique).toHaveBeenCalledWith({
      select: { updatedAt: true },
      where: {
        memberId_periodStart: {
          memberId: "member_123",
          periodStart,
        },
      },
    });
    expect(transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: "RepeatableRead" },
    );
  });

  it("derives admission from the current plan instead of stale block metadata", async () => {
    const now = new Date("2026-07-22T18:00:00.000Z");
    const periodStart = new Date("2026-07-05T00:00:00.000Z");
    const periodEnd = new Date("2026-08-05T00:00:00.000Z");
    const periodUpdatedAt = new Date("2026-07-22T17:00:00.000Z");

    const increasedPlan = createGatePrisma({
      billingPlanCode: "launch_edge_monthly",
      billingRefUpdatedAt: new Date("2026-07-22T16:54:00.000Z"),
      findUniquePeriod: {
        billingPlanCode: "launch_monthly",
        blockedAt: new Date("2026-07-22T16:55:00.000Z"),
        limitUsdMicros: 10_000_000n,
        periodEnd,
        periodStart,
        spentUsdMicros: 10_000_000n,
        updatedAt: periodUpdatedAt,
      },
      periodEnd,
      periodStart,
      spentUsdMicros: 10_000_000n,
    });
    const increasedTransaction = vi.fn(async (
      run: (tx: typeof increasedPlan) => Promise<unknown>,
      options?: { isolationLevel?: string },
    ) => {
      void options;
      return run(increasedPlan);
    });

    const increasedSnapshots = await readHostedAiUsageGateSnapshots({
      memberIds: ["member_123"],
      now,
      prisma: { $transaction: increasedTransaction } as never,
    });

    expect(increasedSnapshots.get("member_123")).toMatchObject({
      decision: {
        allowed: true,
        limitUsdMicros: DIRECT_EDGE_ALLOWANCE_USD_MICROS,
        remainingUsdMicros: DIRECT_EDGE_ALLOWANCE_USD_MICROS,
        spentUsdMicros: 0n,
      },
      periodPersistedAt: periodUpdatedAt,
    });

    const decreasedPlan = createGatePrisma({
      billingPlanCode: "launch_monthly",
      findUniquePeriod: {
        billingPlanCode: "launch_edge_monthly",
        blockedAt: null,
        limitUsdMicros: 25_000_000n,
        periodEnd,
        periodStart,
        spentUsdMicros: 11_000_000n,
        updatedAt: periodUpdatedAt,
      },
      periodEnd,
      periodStart,
      spentUsdMicros: 11_000_000n,
    });
    const decreasedTransaction = vi.fn(async (
      run: (tx: typeof decreasedPlan) => Promise<unknown>,
      options?: { isolationLevel?: string },
    ) => {
      void options;
      return run(decreasedPlan);
    });

    const decreasedSnapshots = await readHostedAiUsageGateSnapshots({
      memberIds: ["member_123"],
      now,
      prisma: { $transaction: decreasedTransaction } as never,
    });

    expect(decreasedSnapshots.get("member_123")).toMatchObject({
      decision: {
        allowed: false,
        limitUsdMicros: DIRECT_PULSE_ALLOWANCE_USD_MICROS,
        reason: "ai_usage_limit_exceeded",
        remainingUsdMicros: 0n,
      },
      periodPersistedAt: periodUpdatedAt,
    });
  });

  it("uses one sequential short transaction per admitted dashboard member", async () => {
    const now = new Date("2026-07-22T18:00:00.000Z");
    const periodStart = new Date("2026-07-05T00:00:00.000Z");
    const periodEnd = new Date("2026-08-05T00:00:00.000Z");
    const periodUpdatedAt = new Date("2026-07-22T17:00:00.000Z");
    const memberIds = Array.from(
      { length: 25 },
      (_, index) => `member_${String(index + 1).padStart(2, "0")}`,
    );
    const prisma = createGatePrisma({
      findUniquePeriod: {
        billingPlanCode: "launch_monthly",
        blockedAt: null,
        limitUsdMicros: 10_000_000n,
        periodEnd,
        periodStart,
        spentUsdMicros: 1_000_000n,
        updatedAt: periodUpdatedAt,
      },
      periodEnd,
      periodStart,
      spentUsdMicros: 1_000_000n,
    });
    let activeTransactions = 0;
    let maximumActiveTransactions = 0;
    const transaction = vi.fn(async (
      run: (tx: typeof prisma) => Promise<unknown>,
      options?: { isolationLevel?: string },
    ) => {
      expect(options).toEqual({ isolationLevel: "RepeatableRead" });
      activeTransactions += 1;
      maximumActiveTransactions = Math.max(
        maximumActiveTransactions,
        activeTransactions,
      );
      try {
        return await run(prisma);
      } finally {
        activeTransactions -= 1;
      }
    });

    const snapshots = await readHostedAiUsageGateSnapshots({
      memberIds,
      now,
      prisma: { $transaction: transaction } as never,
    });

    expect([...snapshots.keys()]).toEqual(memberIds);
    expect(transaction).toHaveBeenCalledTimes(memberIds.length);
    expect(maximumActiveTransactions).toBe(1);
    expect(prisma.hostedMember.findUnique).toHaveBeenCalledTimes(
      memberIds.length,
    );
    expect(prisma.hostedAiUsagePeriod.findUnique).toHaveBeenCalledTimes(
      memberIds.length * 2,
    );
    for (const memberId of memberIds) {
      expect(prisma.hostedAiUsagePeriod.findUnique).toHaveBeenCalledWith({
        select: { updatedAt: true },
        where: {
          memberId_periodStart: { memberId, periodStart },
        },
      });
    }
    expect(prisma.hostedAiUsagePeriod).not.toHaveProperty("findMany");
  });
});

describe("checkHostedAiUsageGate", () => {
  it("serves allow decisions from the read gate without usage-period writes", async () => {
    const prisma = createGatePrisma({
      spentUsdMicros: 5_400_000n,
    });

    await expect(checkHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-03-29T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: true,
      remainingUsdMicros: 1_000_000n,
      spentUsdMicros: 5_400_000n,
    });

    expect(prisma.hostedAiUsagePeriod.createMany).not.toHaveBeenCalled();
    expect(prisma.hostedAiUsagePeriod.update).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("confirms exhausted read decisions through the mutating gate", async () => {
    const prisma = createGatePrisma({
      spentUsdMicros: DIRECT_PULSE_ALLOWANCE_USD_MICROS,
    });
    prisma.hostedMember.findUnique = vi.fn(async () => ({
      billingRef: {
        currentBillingPhase: null,
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: null,
        currentPeriodEnd: new Date("2026-04-01T00:00:00.000Z"),
        currentPeriodStart: new Date("2026-03-01T00:00:00.000Z"),
        stripeSubscriptionLookupKey: null,
        currentTrialEndsAt: null,
        currentTrialStartedAt: null,
        pulseTrialPolicyVersion: null,
        pulseTrialRedeemedAt: null,
        scheduledBillingEffectiveAt: null,
        scheduledBillingPlanCode: null,
        usagePlanTransitionAt: null,
        usagePlanTransitionFromCode: null,
        usagePlanTransitionKind: null,
        usagePlanTransitionToCode: null,
        updatedAt: new Date("2026-03-01T00:00:00.000Z"),
      },
      billingStatus: HostedBillingStatus.active,
      id: "member_123",
      suspendedAt: null,
      threadContainer: null,
      usageCreditBalanceUsdMicros: 0n,
      usageCreditLedgerVersion: 0n,
    }));

    await expect(checkHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-03-29T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: false,
      reason: "ai_usage_limit_exceeded",
      spentUsdMicros: DIRECT_PULSE_ALLOWANCE_USD_MICROS,
    });

    expect(prisma.hostedMember.findUnique).toHaveBeenCalledTimes(2);
    expect(prisma.hostedAiUsagePeriod.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.hostedAiUsagePeriod.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          blockedAt: new Date("2026-03-29T12:00:00.000Z"),
        }),
      }),
    );
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it("records blocked metadata when the mutating gate confirms exhaustion", async () => {
    const prisma = createGatePrisma({
      spentUsdMicros: DIRECT_PULSE_ALLOWANCE_USD_MICROS,
    });
    const update = prisma.hostedAiUsagePeriod.update;
    prisma.hostedMember.findUnique = vi.fn(async () => ({
      billingRef: {
        currentBillingPhase: null,
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: null,
        currentPeriodEnd: new Date("2026-04-01T00:00:00.000Z"),
        currentPeriodStart: new Date("2026-03-01T00:00:00.000Z"),
        stripeSubscriptionLookupKey: null,
        currentTrialEndsAt: null,
        currentTrialStartedAt: null,
        pulseTrialPolicyVersion: null,
        pulseTrialRedeemedAt: null,
        scheduledBillingEffectiveAt: null,
        scheduledBillingPlanCode: null,
        usagePlanTransitionAt: null,
        usagePlanTransitionFromCode: null,
        usagePlanTransitionKind: null,
        usagePlanTransitionToCode: null,
        updatedAt: new Date("2026-03-01T00:00:00.000Z"),
      },
      billingStatus: HostedBillingStatus.active,
      id: "member_123",
      suspendedAt: null,
      threadContainer: null,
      usageCreditBalanceUsdMicros: 0n,
      usageCreditLedgerVersion: 0n,
    }));
    await expect(checkHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-03-29T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: false,
      reason: "ai_usage_limit_exceeded",
      spentUsdMicros: DIRECT_PULSE_ALLOWANCE_USD_MICROS,
    });

    expect(prisma.hostedAiUsagePeriod.createMany).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        blockedAt: new Date("2026-03-29T12:00:00.000Z"),
      }),
    }));
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });
});

function createAllowanceTx(input: {
  billingPhase?: string | null;
  billingPlanCode?: string;
  billingRefBookkeepingUpdatedAt?: Date;
  billingRefUpdatedAt?: Date;
  blockedAt?: Date | null;
  checkoutOffer?: string | null;
  executeRaw: AllowanceExecuteRawMock;
  familyAccessActive?: boolean;
  familyBillingPlanCode?: string | null;
  familyPlanCode?: "edge" | "max" | "pulse";
  familyPeriodEnd?: Date | null;
  familyPeriodStart?: Date | null;
  familyUpdatedAt?: Date;
  highestBillingPlanCode?: string | null;
  hostedAiUsageAggregate?: ReturnType<typeof vi.fn>;
  hostedAiUsageUpdateMany: ReturnType<typeof vi.fn>;
  limitUsdMicros?: bigint;
  periodEnd?: Date;
  periodStart?: Date;
  planResetAt?: Date | null;
  pulseTrialPolicyVersion?: string | null;
  pulseTrialRedeemedAt?: Date | null;
  spentUsdMicros?: bigint;
  stripeSubscriptionLookupKey?: string | null;
  threadContainerLimitUsdMicros?: bigint | null;
  trialEndsAt?: Date | null;
  trialStartedAt?: Date | null;
  usageCreditBalanceUsdMicros?: bigint;
  usageCreditLedgerVersion?: bigint;
}) {
  const familyPeriodStart = input.familyPeriodStart === undefined
    ? input.periodStart ?? new Date("2026-03-01T00:00:00.000Z")
    : input.familyPeriodStart;
  const familyPeriodEnd = input.familyPeriodEnd === undefined
    ? input.periodEnd ?? new Date("2026-04-01T00:00:00.000Z")
    : input.familyPeriodEnd;
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
        allowanceCostUsdMicros: 759n,
      },
    });

  return {
    $executeRaw: input.executeRaw,
    $queryRaw: vi.fn<AllowanceQueryRaw>(async () => []),
    hostedAiUsage: {
      aggregate: input.hostedAiUsageAggregate ?? defaultAggregate,
      updateMany: input.hostedAiUsageUpdateMany,
    },
    hostedAiUsagePeriod: {
      createMany: vi.fn(async () => ({ count: 1 })),
      findUniqueOrThrow: vi.fn(async () => ({
        billingPlanCode: input.billingPlanCode ?? "launch_monthly",
        blockedAt: input.blockedAt ?? null,
        highestBillingPlanCode:
          input.highestBillingPlanCode === undefined
            ? input.billingPlanCode ?? "launch_monthly"
            : input.highestBillingPlanCode,
        lastUsageAt: null,
        limitUsdMicros: input.limitUsdMicros ?? DIRECT_PULSE_ALLOWANCE_USD_MICROS,
        periodEnd: input.periodEnd ?? new Date("2026-04-01T00:00:00.000Z"),
        periodStart: input.periodStart ?? new Date("2026-03-01T00:00:00.000Z"),
        planResetAt: input.planResetAt ?? null,
        spentUsdMicros: input.spentUsdMicros ?? 0n,
      })),
      update: vi.fn(async (args?: {
        data?: {
          billingPlanCode?: string;
          blockedAt?: Date | null;
          highestBillingPlanCode?: string;
          limitUsdMicros?: bigint;
          periodEnd?: Date;
          planResetAt?: Date;
          spentUsdMicros?: bigint;
        };
      }) => ({
        billingPlanCode: args?.data?.billingPlanCode ?? input.billingPlanCode ?? "launch_monthly",
        blockedAt: args?.data?.blockedAt ?? input.blockedAt ?? null,
        highestBillingPlanCode:
          args?.data?.highestBillingPlanCode
          ?? input.highestBillingPlanCode
          ?? input.billingPlanCode
          ?? "launch_monthly",
        limitUsdMicros:
          args?.data?.limitUsdMicros
          ?? input.limitUsdMicros
          ?? DIRECT_PULSE_ALLOWANCE_USD_MICROS,
        periodEnd: args?.data?.periodEnd ?? input.periodEnd ?? new Date("2026-04-01T00:00:00.000Z"),
        periodStart: input.periodStart ?? new Date("2026-03-01T00:00:00.000Z"),
        planResetAt: args?.data?.planResetAt ?? input.planResetAt ?? null,
        spentUsdMicros: args?.data?.spentUsdMicros ?? input.spentUsdMicros ?? 0n,
      })),
    },
    hostedAccountGroupMembership: {
      count: vi.fn(async () => input.familyAccessActive ? 2 : 0),
      findFirst: vi.fn(async () => input.familyAccessActive
        ? {
            group: {
              billingStatus: HostedBillingStatus.active,
              id: "hbag_family",
              ownerMemberId: "member_owner",
              suspendedAt: null,
            },
            groupId: "hbag_family",
            memberId: "member_123",
            planCode: input.familyPlanCode ?? "pulse",
            role: "member",
            status: "active",
            usagePlanTransitionAt: input.familyUpdatedAt ?? null,
            usagePlanTransitionFromCode: input.familyUpdatedAt
              ? "launch_monthly"
              : null,
            usagePlanTransitionKind: input.familyUpdatedAt
              ? "plan_upgrade"
              : null,
            usagePlanTransitionToCode: input.familyUpdatedAt
              ? "launch_edge_monthly"
              : null,
            updatedAt: input.familyUpdatedAt ?? new Date("2026-03-01T00:00:00.000Z"),
          }
        : null),
    },
    hostedAccountGroupInvite: {
      count: vi.fn(async () => 0),
    },
    hostedAccountGroupBillingRef: {
      findUnique: vi.fn(async () => input.familyAccessActive
        ? {
            billedSeatCount: 2,
            currentBillingPlanCode: input.familyBillingPlanCode ?? "launch_family_monthly",
            currentBillingPhase: "paid",
            currentPeriodEnd: familyPeriodEnd,
            currentPeriodStart: familyPeriodStart,
          }
        : null),
    },
    hostedMember: {
      findUnique: vi.fn(async () => ({
        billingRef: {
          currentBillingPhase: input.billingPhase ?? null,
          currentBillingPlanCode: input.billingPlanCode ?? "launch_monthly",
          currentCheckoutOffer: input.checkoutOffer ?? null,
          currentPeriodEnd: input.periodEnd ?? new Date("2026-04-01T00:00:00.000Z"),
          currentPeriodStart: input.periodStart ?? new Date("2026-03-01T00:00:00.000Z"),
          stripeSubscriptionLookupKey:
            input.stripeSubscriptionLookupKey === undefined
              ? "subscription-lookup"
              : input.stripeSubscriptionLookupKey,
          currentTrialEndsAt: input.trialEndsAt ?? null,
          currentTrialStartedAt: input.trialStartedAt ?? null,
          pulseTrialPolicyVersion: input.pulseTrialPolicyVersion ?? null,
          pulseTrialRedeemedAt: input.pulseTrialRedeemedAt ?? null,
          usagePlanTransitionAt: input.billingRefUpdatedAt ?? null,
          usagePlanTransitionFromCode: input.billingRefUpdatedAt
            ? "launch_monthly"
            : null,
          usagePlanTransitionKind: input.billingRefUpdatedAt
            ? input.billingPhase === "paid" && input.trialStartedAt
              ? "trial_conversion"
              : "plan_upgrade"
            : null,
          usagePlanTransitionToCode: input.billingRefUpdatedAt
            ? input.billingPlanCode ?? "launch_monthly"
            : null,
          updatedAt:
            input.billingRefBookkeepingUpdatedAt
            ?? input.billingRefUpdatedAt
            ?? new Date("2026-03-01T00:00:00.000Z"),
        },
        billingStatus: HostedBillingStatus.active,
        id: "member_123",
        suspendedAt: null,
        threadContainer: input.threadContainerLimitUsdMicros == null
          ? null
          : {
              monthlyUsageLimitUsdMicros: input.threadContainerLimitUsdMicros,
              owner: {
                accountGroupMemberships: [],
                billingStatus: HostedBillingStatus.active,
                suspendedAt: null,
              },
            },
        usageCreditBalanceUsdMicros: input.usageCreditBalanceUsdMicros ?? 0n,
        usageCreditLedgerVersion: input.usageCreditLedgerVersion ?? 0n,
      })),
      findUniqueOrThrow: vi.fn(async () => ({
        usageCreditLedgerVersion: input.usageCreditLedgerVersion ?? 0n,
      })),
    },
  };
}

function createGatePrisma(input: {
  aggregate?: ReturnType<typeof vi.fn>;
  billingPhase?: string | null;
  billingPlanCode?: string;
  billingRefBookkeepingUpdatedAt?: Date;
  billingRefUpdatedAt?: Date;
  billingStatus?: HostedBillingStatus;
  checkoutOffer?: string | null;
  executeRaw?: ReturnType<typeof vi.fn>;
  familyAccessActive?: boolean;
  familyBillingPlanCode?: string | null;
  familyPlanCode?: "edge" | "max" | "pulse";
  familyPeriodEnd?: Date | null;
  familyPeriodStart?: Date | null;
  familyUpdatedAt?: Date;
  highestBillingPlanCode?: string | null;
  findUniquePeriod?: {
    billingPlanCode: string;
    blockedAt?: Date | null;
    highestBillingPlanCode?: string | null;
    lastUsageAt?: Date | null;
    limitUsdMicros: bigint;
    periodEnd: Date;
    periodStart: Date;
    planResetAt?: Date | null;
    spentUsdMicros: bigint;
    updatedAt?: Date;
  } | null;
  limitUsdMicros?: bigint;
  periodEnd?: Date;
  periodStart?: Date;
  planResetAt?: Date | null;
  pulseTrialPolicyVersion?: string | null;
  pulseTrialRedeemedAt?: Date | null;
  queryRaw?: ReturnType<typeof vi.fn>;
  scheduledBillingEffectiveAt?: Date | null;
  scheduledBillingPlanCode?: string | null;
  spentUsdMicros: bigint;
  stripeSubscriptionLookupKey?: string | null;
  threadContainerLimitUsdMicros?: bigint | null;
  threadContainerOwnerBillingStatus?: HostedBillingStatus;
  threadContainerOwnerFamilySponsored?: boolean;
  threadContainerOwnerSuspendedAt?: Date | null;
  threadContainerParticipantActive?: boolean;
  trialEndsAt?: Date | null;
  trialStartedAt?: Date | null;
  suspendedAt?: Date | null;
  update?: ReturnType<typeof vi.fn>;
  usageCreditBalanceUsdMicros?: bigint;
  usageCreditLedgerVersion?: bigint;
}) {
  const periodStart = input.periodStart ?? new Date("2026-03-01T00:00:00.000Z");
  const periodEnd = input.periodEnd ?? new Date("2026-04-01T00:00:00.000Z");
  const familyPeriodStart = input.familyPeriodStart === undefined
    ? periodStart
    : input.familyPeriodStart;
  const familyPeriodEnd = input.familyPeriodEnd === undefined
    ? periodEnd
    : input.familyPeriodEnd;
  const threadContainer = input.threadContainerLimitUsdMicros == null
    ? null
    : {
        monthlyUsageLimitUsdMicros: input.threadContainerLimitUsdMicros,
        owner: {
          accountGroupMemberships: input.threadContainerOwnerFamilySponsored
            ? [{
                group: {
                  billingStatus: HostedBillingStatus.active,
                  suspendedAt: null,
                },
                status: "active",
              }]
            : [],
          billingStatus: input.threadContainerOwnerFamilySponsored
            ? HostedBillingStatus.not_started
            : input.threadContainerOwnerBillingStatus ?? HostedBillingStatus.active,
          suspendedAt: input.threadContainerOwnerSuspendedAt ?? null,
        },
      };
  const defaultPeriod = {
    billingPlanCode: input.billingPlanCode ?? "launch_monthly",
    blockedAt: null,
    highestBillingPlanCode: input.highestBillingPlanCode === undefined
      ? input.findUniquePeriod?.billingPlanCode
        ?? input.billingPlanCode
        ?? "launch_monthly"
      : input.highestBillingPlanCode,
    lastUsageAt: input.spentUsdMicros > 0n
      ? new Date(periodStart.getTime() + 60_000)
      : null,
    limitUsdMicros: input.limitUsdMicros ?? DIRECT_PULSE_ALLOWANCE_USD_MICROS,
    periodEnd,
    periodStart,
    planResetAt: input.planResetAt ?? null,
    spentUsdMicros: input.spentUsdMicros,
    updatedAt: input.findUniquePeriod?.updatedAt ?? periodStart,
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
        input.findUniquePeriod === null
          ? null
          : input.findUniquePeriod === undefined
            ? defaultPeriod
            : { ...defaultPeriod, ...input.findUniquePeriod }
      ),
      findUniqueOrThrow: vi.fn(async () =>
        input.findUniquePeriod === undefined
          ? defaultPeriod
          : { ...defaultPeriod, ...input.findUniquePeriod }
      ),
      update: input.update ?? vi.fn(async (args?: {
        data?: {
          billingPlanCode?: string;
          highestBillingPlanCode?: string;
          limitUsdMicros?: bigint;
          periodEnd?: Date;
          planResetAt?: Date;
          spentUsdMicros?: bigint;
        };
      }) => ({
        billingPlanCode: args?.data?.billingPlanCode ?? defaultPeriod.billingPlanCode,
        blockedAt: defaultPeriod.blockedAt,
        highestBillingPlanCode:
          args?.data?.highestBillingPlanCode ?? defaultPeriod.highestBillingPlanCode,
        limitUsdMicros: args?.data?.limitUsdMicros ?? defaultPeriod.limitUsdMicros,
        periodEnd: args?.data?.periodEnd ?? defaultPeriod.periodEnd,
        periodStart: defaultPeriod.periodStart,
        planResetAt: args?.data?.planResetAt ?? defaultPeriod.planResetAt,
        spentUsdMicros: args?.data?.spentUsdMicros ?? defaultPeriod.spentUsdMicros,
      })),
    },
    hostedAccountGroupMembership: {
      count: vi.fn(async () => input.familyAccessActive ? 2 : 0),
      findFirst: vi.fn(async () => input.familyAccessActive
        ? {
            group: {
              billingStatus: HostedBillingStatus.active,
              id: "hbag_family",
              ownerMemberId: "member_owner",
              suspendedAt: null,
            },
            groupId: "hbag_family",
            memberId: "member_123",
            planCode: input.familyPlanCode ?? "pulse",
            role: "member",
            status: "active",
            usagePlanTransitionAt: input.familyUpdatedAt ?? null,
            usagePlanTransitionFromCode: input.familyUpdatedAt
              ? "launch_monthly"
              : null,
            usagePlanTransitionKind: input.familyUpdatedAt
              ? "plan_upgrade"
              : null,
            usagePlanTransitionToCode: input.familyUpdatedAt
              ? "launch_edge_monthly"
              : null,
            updatedAt: input.familyUpdatedAt ?? periodStart,
          }
        : null),
    },
    hostedAccountGroupInvite: {
      count: vi.fn(async () => 0),
    },
    hostedAccountGroupBillingRef: {
      findUnique: vi.fn(async () => input.familyAccessActive
        ? {
            billedSeatCount: 2,
            currentBillingPlanCode: input.familyBillingPlanCode ?? "launch_family_monthly",
            currentBillingPhase: "paid",
            currentPeriodEnd: familyPeriodEnd,
            currentPeriodStart: familyPeriodStart,
          }
        : null),
    },
    hostedMember: {
      findUnique: vi.fn(async () => ({
        billingRef: {
          currentBillingPhase: input.billingPhase ?? null,
          currentBillingPlanCode: input.billingPlanCode ?? "launch_monthly",
          currentCheckoutOffer: input.checkoutOffer ?? null,
          currentPeriodEnd: periodEnd,
          currentPeriodStart: periodStart,
          stripeSubscriptionLookupKey:
            input.stripeSubscriptionLookupKey === undefined
              ? "subscription-lookup"
              : input.stripeSubscriptionLookupKey,
          currentTrialEndsAt: input.trialEndsAt ?? null,
          currentTrialStartedAt: input.trialStartedAt ?? null,
          pulseTrialPolicyVersion: input.pulseTrialPolicyVersion ?? null,
          pulseTrialRedeemedAt: input.pulseTrialRedeemedAt ?? null,
          scheduledBillingEffectiveAt: input.scheduledBillingEffectiveAt ?? null,
          scheduledBillingPlanCode: input.scheduledBillingPlanCode ?? null,
          usagePlanTransitionAt: input.billingRefUpdatedAt ?? null,
          usagePlanTransitionFromCode: input.billingRefUpdatedAt
            ? "launch_monthly"
            : null,
          usagePlanTransitionKind: input.billingRefUpdatedAt
            ? input.billingPhase === "paid" && input.trialStartedAt
              ? "trial_conversion"
              : "plan_upgrade"
            : null,
          usagePlanTransitionToCode: input.billingRefUpdatedAt
            ? input.billingPlanCode ?? "launch_monthly"
            : null,
          updatedAt:
            input.billingRefBookkeepingUpdatedAt
            ?? input.billingRefUpdatedAt
            ?? periodStart,
        },
        billingStatus: input.billingStatus ?? HostedBillingStatus.active,
        id: "member_123",
        suspendedAt: input.suspendedAt ?? null,
        threadContainer,
        usageCreditBalanceUsdMicros: input.usageCreditBalanceUsdMicros ?? 0n,
        usageCreditLedgerVersion: input.usageCreditLedgerVersion ?? 0n,
      })),
    },
    hostedThreadContainerParticipant: {
      findFirst: vi.fn(async () => input.threadContainerParticipantActive
        ? { participantMemberId: "member_participant" }
        : null),
    },
  };
}
