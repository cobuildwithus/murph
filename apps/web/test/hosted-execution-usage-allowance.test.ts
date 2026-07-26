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
  settleHostedUsageCreditForUsageTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/usage-credits", () => ({
  settleHostedUsageCreditForUsageTx:
    usageCreditMocks.settleHostedUsageCreditForUsageTx,
}));

import {
  accountHostedAiUsageForAllowanceTx,
  checkHostedAiUsageGate,
  HOSTED_AI_USAGE_RESERVATION_PRE_DISPATCH_TTL_MS,
  priceHostedAiUsageForAllowance,
  readHostedAiUsageGate,
  readHostedAiUsageGateSnapshots,
  reconcileHostedAiUsageAllowancePeriodForMemberTx,
  releaseHostedAiUsageReservation,
  reserveHostedImageGenerationCapacity,
  resolveHostedAiUsageGate,
} from "@/src/lib/hosted-execution/usage-allowance";
import { buildHostedRetellPhoneCallUsageRecord } from "@/src/lib/hosted-execution/usage-retell";

beforeEach(() => {
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

interface HostedAiUsageReservationTestRow {
  allowanceSource: string;
  createdAt: Date;
  dispatchedAt: Date | null;
  estimatedCostUsdMicros: bigint;
  estimatorVersion: string;
  imageQuality: string;
  imageSize: string;
  memberId: string;
  periodEnd: Date;
  periodStart: Date;
  promptUtf8Bytes: number;
  referenceImageCount: number;
  releasedAt: Date | null;
  requestId: string;
  settledUsageId: string | null;
}

type HostedAiUsageReservationTestStore = ReturnType<
  typeof createHostedAiUsageReservationStore
>;

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

function buildOpenAiImageUsageRecord(input: {
  usageId?: string;
} = {}): AssistantUsageRecord {
  const usageId = input.usageId ?? "turn_image_123.attempt-1";
  return {
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
    sessionId: "asst_image_123",
    totalTokens: 1_700,
    turnId: usageId.split(".attempt-")[0] ?? "turn_image_123",
    usageExtractionSourcePath: "openai.images.generate",
    usageExtractionVersion: "openai-images-v1",
    usageId,
  } satisfies AssistantUsageRecord;
}

const LOW_SQUARE_IMAGE_CAPACITY_SPEC = {
  model: "gpt-image-2",
  promptUtf8Bytes: 1,
  quality: "low",
  referenceImageCount: 0,
  size: "1024x1024",
} as const;

const LOW_SQUARE_IMAGE_ESTIMATE_USD_MICROS = 6_005n;

describe("hosted AI usage allowance pricing", () => {
  it("prices platform usage from uncached input, cached input, and output tokens", () => {
    expect(priceHostedAiUsageForAllowance(BASE_USAGE_RECORD)).toMatchObject({
      costUsdMicros: 948n,
      counted: true,
      pricingSnapshot: {
        standardCostUsdMicros: "948",
        tokenPricingAdjustment: {
          denominator: "1",
          numerator: "1",
        },
        tokenPricingBasis: "standard",
      },
      pricingVersion: "openai-api-pricing-2026-07-09-gpt-5.6-standard",
    });
  });

  it("prices OpenAI flex token usage at 50% for allowance accounting", () => {
    expect(priceHostedAiUsageForAllowance({
      ...BASE_USAGE_RECORD,
      tokenPricingBasis: "openai-flex",
    })).toMatchObject({
      costUsdMicros: 474n,
      counted: true,
      pricingSnapshot: {
        standardCostUsdMicros: "948",
        tokenPricingAdjustment: {
          denominator: "2",
          numerator: "1",
        },
        tokenPricingBasis: "openai-flex",
      },
      pricingVersion: "openai-api-pricing-2026-07-09-gpt-5.6-openai-flex",
    });
  });

  it("prices GPT-5.6 model slugs with official standard and flex accounting", () => {
    expect(priceHostedAiUsageForAllowance({
      ...BASE_USAGE_RECORD,
      requestedModel: "gpt-5.6-terra",
      servedModel: "openai/gpt-5.6-terra-2026-07-08",
    })).toMatchObject({
      costUsdMicros: 948n,
      counted: true,
      pricingSnapshot: {
        model: "gpt-5.6-terra",
        modelSource: "served",
        pricingSource: "https://developers.openai.com/api/docs/pricing",
        ratesUsdMicrosPerMillionTokens: {
          cachedInput: "250000",
          cacheWrite: "3125000",
          input: "2500000",
          output: "15000000",
        },
        requestedModel: "gpt-5.6-terra",
        servedModel: "openai/gpt-5.6-terra-2026-07-08",
        tokenPricingBasis: "standard",
      },
      pricingVersion: "openai-api-pricing-2026-07-09-gpt-5.6-standard",
    });

    expect(priceHostedAiUsageForAllowance({
      ...BASE_USAGE_RECORD,
      providerName: "hosted-openai",
      requestedModel: "gpt-5.6-luna",
      servedModel: "gpt-5.6-luna",
      tokenPricingBasis: "openai-flex",
    })).toMatchObject({
      costUsdMicros: 190n,
      counted: true,
      pricingSnapshot: {
        model: "gpt-5.6-luna",
        pricingSource: "https://developers.openai.com/api/docs/pricing",
        ratesUsdMicrosPerMillionTokens: {
          cachedInput: "100000",
          cacheWrite: "1250000",
          input: "1000000",
          output: "6000000",
        },
        tokenPricingAdjustment: {
          denominator: "2",
          numerator: "1",
        },
        tokenPricingBasis: "openai-flex",
      },
      pricingVersion: "openai-api-pricing-2026-07-09-gpt-5.6-openai-flex",
    });
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
      pricingVersion: "openai-api-pricing-2026-07-09-gpt-5.6-standard",
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
        standardCostUsdMicros: "4",
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
      costUsdMicros: 474n,
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
      costUsdMicros: 474n,
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
      costUsdMicros: 312500n,
      counted: true,
    });
    expect(priceHostedAiUsageForAllowance(markedEstimatedIdleCompaction)).toMatchObject({
      costUsdMicros: 312500n,
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
      costUsdMicros: 312500n,
      counted: true,
    });
    expect(priceHostedAiUsageForAllowance({
      ...markedEstimatedIdleCompaction,
      providerRequestId: null,
    })).toMatchObject({
      costUsdMicros: 312500n,
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
        allowanceCostUsdMicros: 948n,
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
      948n,
      new Date("2026-03-29T12:00:00.000Z"),
      new Date("2026-03-29T12:00:00.000Z"),
      948n,
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

  it("uses included capacity first and settles only the excess against purchased credit", async () => {
    const executeRaw = vi.fn<AllowanceExecuteRaw>(async () => 1);
    const tx = createAllowanceTx({
      executeRaw,
      hostedAiUsageUpdateMany: vi.fn(async () => ({ count: 1 })),
      spentUsdMicros: 9_999_948n,
      usageCreditBalanceUsdMicros: 5_000n,
      usageCreditLedgerVersion: 7n,
    });
    usageCreditMocks.settleHostedUsageCreditForUsageTx.mockResolvedValueOnce({
      absorbedUsdMicros: 0n,
      balanceUsdMicros: 4_104n,
      debitedUsdMicros: 896n,
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
      debitUsdMicros: 896n,
      effectiveAt: new Date("2026-03-29T12:00:00.000Z"),
      sourceUsageId: "turn_123.attempt-1",
      tx,
    });
    const [, ...params] = executeRaw.mock.calls[0] ?? [];
    expect(params).toContain(4_104n);
  });

  it("settles Retell cost against included capacity before purchased credit", async () => {
    const tx = createAllowanceTx({
      executeRaw: vi.fn<AllowanceExecuteRaw>(async () => 1),
      hostedAiUsageUpdateMany: vi.fn(async () => ({ count: 1 })),
      spentUsdMicros: 9_900_000n,
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
      spentUsdMicros: 9_999_948n,
      usageCreditBalanceUsdMicros: 5_000n,
      usageCreditLedgerVersion: 7n,
    });
    usageCreditMocks.settleHostedUsageCreditForUsageTx.mockResolvedValueOnce({
      absorbedUsdMicros: 0n,
      balanceUsdMicros: 4_104n,
      debitedUsdMicros: 896n,
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
        debitUsdMicros: 896n,
        sourceUsageId: "turn_123.attempt-1",
      }));
  });

  it("absorbs provider crossing overshoot after consuming available purchased credit", async () => {
    const tx = createAllowanceTx({
      executeRaw: vi.fn<AllowanceExecuteRaw>(async () => 1),
      hostedAiUsageUpdateMany: vi.fn(async () => ({ count: 1 })),
      spentUsdMicros: 9_999_948n,
      usageCreditBalanceUsdMicros: 500n,
      usageCreditLedgerVersion: 4n,
    });
    usageCreditMocks.settleHostedUsageCreditForUsageTx.mockResolvedValueOnce({
      absorbedUsdMicros: 396n,
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
        debitUsdMicros: 896n,
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
      spentUsdMicros: 9_999_948n,
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
        spentUsdMicros: 10_000_000n,
      });
      return await accountHostedAiUsageForAllowanceTx({
        memberId: "member_123",
        now: new Date("2026-03-29T12:00:05.000Z"),
        record,
        tx: tx as never,
      });
    }))).resolves.toEqual([null, null]);
  });

  it("returns a fresh notice candidate when replenished credit is consumed", async () => {
    const tx = createAllowanceTx({
      blockedAt: null,
      executeRaw: vi.fn<AllowanceExecuteRaw>(async () => 1),
      hostedAiUsageUpdateMany: vi.fn(async () => ({ count: 1 })),
      spentUsdMicros: 10_000_000n,
      usageCreditBalanceUsdMicros: 500n,
      usageCreditLedgerVersion: 8n,
    });
    usageCreditMocks.settleHostedUsageCreditForUsageTx.mockResolvedValueOnce({
      absorbedUsdMicros: 448n,
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
          allowanceCostUsdMicros: 10_000_000n,
          allowanceCounted: true,
          allowancePricingSnapshotJson: expect.objectContaining({
            blockCostUsdMicros: "10000000",
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
          allowanceCostUsdMicros: 10_000_000n,
          allowanceCounted: true,
          allowancePricingSnapshotJson: expect.objectContaining({
            blockCostUsdMicros: "10000000",
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
        allowanceCostUsdMicros: 10_000_000n,
        allowanceCounted: true,
        allowancePricingSnapshotJson: expect.objectContaining({
          blockCostUsdMicros: "10000000",
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

  it("marks usage rows as allowance-denied when trial billing state is stale", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const executeRaw = vi.fn<AllowanceExecuteRaw>(async () => 1);
    const tx = createAllowanceTx({
      billingPhase: "trial",
      checkoutOffer: "pulse_trial_7d",
      executeRaw,
      hostedAiUsageUpdateMany: updateMany,
      pulseTrialPolicyVersion: "pulse-trial-2026-06-30-v2",
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
        allowancePeriodEnd: new Date("2026-04-08T12:00:00.000Z"),
        allowancePeriodStart: new Date("2026-04-01T12:00:00.000Z"),
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

  it("marks stale-trial image usage denied when provider usage pricing basis is missing", async () => {
    for (const record of buildMalformedOpenAiImageUsageRecords({
      occurredAt: "2026-04-08T12:00:01.000Z",
    })) {
      const updateMany = vi.fn(async () => ({ count: 1 }));
      const executeRaw = vi.fn<AllowanceExecuteRaw>(async () => 1);
      const tx = createAllowanceTx({
        billingPhase: "trial",
        checkoutOffer: "pulse_trial_7d",
        executeRaw,
        hostedAiUsageUpdateMany: updateMany,
        pulseTrialPolicyVersion: "pulse-trial-2026-06-30-v2",
        trialEndsAt: new Date("2026-04-08T12:00:00.000Z"),
        trialStartedAt: new Date("2026-04-01T12:00:00.000Z"),
      });

      await accountHostedAiUsageForAllowanceTx({
        memberId: "member_123",
        now: new Date("2026-04-08T12:00:05.000Z"),
        record,
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
    }
  });

  it("uses Family-sponsored allowance instead of stale direct trial state", async () => {
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
        allowanceCostUsdMicros: 948n,
        allowanceCounted: true,
        allowancePeriodEnd: new Date("2026-05-01T00:00:00.000Z"),
        allowancePeriodStart: new Date("2026-04-01T00:00:00.000Z"),
        allowancePricingVersion: "openai-api-pricing-2026-07-09-gpt-5.6-standard",
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
        allowanceCostUsdMicros: 948n,
        allowanceCounted: true,
        allowancePeriodEnd: new Date("2026-05-01T00:00:00.000Z"),
        allowancePeriodStart: new Date("2026-04-01T00:00:00.000Z"),
        allowancePricingVersion: "openai-api-pricing-2026-07-09-gpt-5.6-standard",
      }),
    }));
    expect(tx.hostedAiUsagePeriod.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        billingPlanCode: "launch_monthly",
        limitUsdMicros: 10_000_000n,
        memberId: "member_123",
        periodEnd: new Date("2026-05-01T00:00:00.000Z"),
        periodStart: new Date("2026-04-01T00:00:00.000Z"),
      }),
    }));
    expect(countPeriodMetadataUpdateCalls(tx)).toBe(1);
  });

  it("validates OpenAI flex evidence before marking stale-trial usage denied", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const executeRaw = vi.fn<AllowanceExecuteRaw>(async () => 1);
    const tx = createAllowanceTx({
      billingPhase: "trial",
      checkoutOffer: "pulse_trial_7d",
      executeRaw,
      hostedAiUsageUpdateMany: updateMany,
      pulseTrialPolicyVersion: "pulse-trial-2026-06-30-v2",
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
      pulseTrialPolicyVersion: "pulse-trial-2026-06-30-v2",
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
  const trialStartedAt = new Date("2026-07-02T12:00:00.000Z");
  const extendedTrialEnd = new Date("2026-07-16T12:00:00.000Z");
  const now = new Date("2026-07-09T12:00:00.000Z");

  it("creates a missing lazy trial usage period from current billing", async () => {
    const tx = createGatePrisma({
      billingPhase: "trial",
      checkoutOffer: "pulse_trial_7d",
      findUniquePeriod: null,
      limitUsdMicros: 4_500_000n,
      periodEnd: extendedTrialEnd,
      periodStart: trialStartedAt,
      pulseTrialPolicyVersion: "pulse-trial-2026-06-30-v2",
      spentUsdMicros: 0n,
      trialEndsAt: extendedTrialEnd,
      trialStartedAt,
    });

    await expect(reconcileHostedAiUsageAllowancePeriodForMemberTx({
      memberId: "member_123",
      now,
      tx: tx as never,
    })).resolves.toBeUndefined();

    expect(tx.hostedAiUsagePeriod.createMany).toHaveBeenCalledWith({
      data: {
        billingPlanCode: "launch_monthly",
        limitUsdMicros: 4_500_000n,
        memberId: "member_123",
        periodEnd: extendedTrialEnd,
        periodStart: trialStartedAt,
        spentUsdMicros: 0n,
      },
      skipDuplicates: true,
    });
    expect(tx.hostedAiUsagePeriod.update).not.toHaveBeenCalled();
  });

  it("repairs only owner-controlled fields while preserving spend and block state", async () => {
    const originalTrialEnd = new Date("2026-07-09T12:00:00.000Z");
    const blockedAt = new Date("2026-07-08T12:00:00.000Z");
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
      periodStart: trialStartedAt,
      spentUsdMicros: 4_500_000n,
    }));
    const tx = createGatePrisma({
      billingPhase: "trial",
      checkoutOffer: "pulse_trial_7d",
      findUniquePeriod: {
        billingPlanCode: "launch_monthly",
        blockedAt,
        limitUsdMicros: 4_500_000n,
        periodEnd: originalTrialEnd,
        periodStart: trialStartedAt,
        spentUsdMicros: 4_500_000n,
      },
      limitUsdMicros: 4_500_000n,
      periodEnd: extendedTrialEnd,
      periodStart: trialStartedAt,
      pulseTrialPolicyVersion: "pulse-trial-2026-06-30-v2",
      spentUsdMicros: 4_500_000n,
      trialEndsAt: extendedTrialEnd,
      trialStartedAt,
      update,
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
        limitUsdMicros: 4_500_000n,
        periodEnd: extendedTrialEnd,
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

  it("blocks active members when the combined allowance reaches zero", async () => {
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
        message: expect.not.stringContaining("addUsage=true"),
      },
      reason: "ai_usage_limit_exceeded",
      retryAfter: new Date("2026-04-01T00:00:00.000Z"),
      spentUsdMicros: 10_000_000n,
      usageCreditBalanceUsdMicros: 0n,
      usageCreditLedgerVersion: 0n,
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
        limitUsdMicros: 10_000_000n,
        periodEnd: new Date("2026-04-01T00:00:00.000Z"),
        periodStart: new Date("2026-03-01T00:00:00.000Z"),
        spentUsdMicros: 10_000_000n,
      },
      spentUsdMicros: 10_000_000n,
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
      spentUsdMicros: 10_000_000n,
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
      spentUsdMicros: 9_000_000n,
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
        message: expect.not.stringContaining("addUsage=true"),
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
      pulseTrialPolicyVersion: "pulse-trial-2026-06-30-v2",
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
      pulseTrialPolicyVersion: "pulse-trial-2026-06-30-v2",
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
        message: expect.stringContaining("https://withmurph.ai/home"),
      },
    });
  });

  it("uses Pulse Trial period spend and updates only usage-limit metadata", async () => {
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
        spentUsdMicros: 4_500_000n,
      };
    });
    const prisma = createGatePrisma({
      aggregate,
      billingPhase: "trial",
      checkoutOffer: "pulse_trial_7d",
      limitUsdMicros: 4_500_000n,
      periodEnd: new Date("2026-04-08T12:00:00.000Z"),
      periodStart: new Date("2026-04-01T12:00:00.000Z"),
      pulseTrialPolicyVersion: "pulse-trial-2026-06-30-v2",
      spentUsdMicros: 4_500_000n,
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
      spentUsdMicros: 4_500_000n,
      userNotice: {
        code: "trial_usage_limit_reached",
      },
    });

    expect(aggregate).not.toHaveBeenCalled();
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
      pulseTrialPolicyVersion: "pulse-trial-2026-06-30-v2",
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
        message: expect.stringContaining("https://withmurph.ai/home"),
      },
    });
    expect(prisma.hostedAiUsagePeriod.createMany).not.toHaveBeenCalled();
  });

  it("allows Family-sponsored members with expired direct trial billing state", async () => {
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
      limitUsdMicros: 10_000_000n,
      periodEnd: new Date("2026-05-01T00:00:00.000Z"),
      periodStart: new Date("2026-04-01T00:00:00.000Z"),
      remainingUsdMicros: 10_000_000n,
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
      limitUsdMicros: 25_000_000n,
      remainingUsdMicros: 25_000_000n,
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
      limitUsdMicros: 10_000_000n,
      periodEnd: new Date("2026-05-01T00:00:00.000Z"),
      periodStart: new Date("2026-04-01T00:00:00.000Z"),
      remainingUsdMicros: 10_000_000n,
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
      limitUsdMicros: 10_000_000n,
      periodEnd: new Date("2026-05-01T00:00:00.000Z"),
      periodStart: new Date("2026-04-01T00:00:00.000Z"),
      remainingUsdMicros: 10_000_000n,
      spentUsdMicros: 0n,
    });
  });

  it("keeps pending Pulse Trial billing notices stable when no trial start exists", async () => {
    const firstPrisma = createGatePrisma({
      billingPhase: "trial",
      checkoutOffer: "pulse_trial_7d",
      periodEnd: new Date("2026-04-08T12:00:00.000Z"),
      periodStart: new Date("2026-04-01T12:00:00.000Z"),
      pulseTrialPolicyVersion: "pulse-trial-2026-06-30-v2",
      spentUsdMicros: 0n,
      trialEndsAt: new Date("2026-04-08T12:00:00.000Z"),
      trialStartedAt: null,
    });
    const secondPrisma = createGatePrisma({
      billingPhase: "trial",
      checkoutOffer: "pulse_trial_7d",
      periodEnd: new Date("2026-04-08T12:00:00.000Z"),
      periodStart: new Date("2026-04-01T12:00:00.000Z"),
      pulseTrialPolicyVersion: "pulse-trial-2026-06-30-v2",
      spentUsdMicros: 0n,
      trialEndsAt: new Date("2026-04-08T12:00:00.000Z"),
      trialStartedAt: null,
    });

    const first = await resolveHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-04-03T12:00:00.000Z",
      prisma: firstPrisma as never,
    });
    const second = await resolveHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-04-03T12:05:00.000Z",
      prisma: secondPrisma as never,
    });

    if (first.allowed || second.allowed) {
      throw new Error("Expected stale Pulse Trial billing state to be denied.");
    }

    expect(first.userNotice).toMatchObject({
      code: "trial_conversion_pending",
    });
    expect(second.userNotice).toMatchObject({
      code: "trial_conversion_pending",
    });
    expect(first.userNotice?.message).toBe(second.userNotice?.message);
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
        pulseTrialPolicyVersion: "pulse-trial-2026-06-30-v2",
        trialEndsAt: null,
        trialStartedAt: new Date("2026-04-01T12:00:00.000Z"),
      },
      4_500_000n,
    ],
    [
      "reversed trial bounds",
      {
        pulseTrialPolicyVersion: "pulse-trial-2026-06-30-v2",
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
        message: expect.stringContaining("https://withmurph.ai/home"),
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
      pulseTrialPolicyVersion: "pulse-trial-2026-06-30-v2",
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
      limitUsdMicros: 10_000_000n,
      periodEnd: new Date("2026-05-08T12:00:00.000Z"),
      periodStart: new Date("2026-04-08T12:00:00.000Z"),
      remainingUsdMicros: 7_000_000n,
      spentUsdMicros: 3_000_000n,
    });
  });

  it("raises the current period limit without lowering spend", async () => {
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
        limitUsdMicros: 25_000_000n,
      }),
    }));
    const updateData = (update.mock.calls[0]?.[0] as { data?: Record<string, unknown> } | undefined)
      ?.data;
    expect(updateData).not.toHaveProperty("spentUsdMicros");
  });

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
        limitUsdMicros: 25_000_000n,
        periodEnd: new Date("2026-05-15T00:00:00.000Z"),
        periodStart: new Date("2026-04-15T00:00:00.000Z"),
        spentUsdMicros: 0n,
      },
      limitUsdMicros: 25_000_000n,
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
      limitUsdMicros: 25_000_000n,
      remainingUsdMicros: 25_000_000n,
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
        limitUsdMicros: 25_000_000n,
        periodEnd: new Date("2026-05-15T00:00:00.000Z"),
        periodStart: new Date("2026-04-15T00:00:00.000Z"),
        spentUsdMicros: 0n,
      },
      limitUsdMicros: 25_000_000n,
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
      limitUsdMicros: 25_000_000n,
      remainingUsdMicros: 25_000_000n,
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
      limitUsdMicros: 10_000_000n,
      periodEnd: new Date("2026-05-01T00:00:00.000Z"),
      periodStart: new Date("2026-04-01T00:00:00.000Z"),
      remainingUsdMicros: 10_000_000n,
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
      limitUsdMicros: 25_000_000n,
      periodEnd: new Date("2026-05-08T12:00:00.000Z"),
      periodStart: new Date("2026-04-08T12:00:00.000Z"),
      remainingUsdMicros: 25_000_000n,
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
      limitUsdMicros: 10_000_000n,
      periodEnd: new Date("2026-05-01T00:00:00.000Z"),
      periodStart: new Date("2026-04-01T00:00:00.000Z"),
      remainingUsdMicros: 10_000_000n,
      spentUsdMicros: 0n,
    });
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
      allowed: true,
      spentUsdMicros: 5_000_000n,
    });

    expect(prisma.hostedAiUsagePeriod.createMany).not.toHaveBeenCalled();
    expect(prisma.hostedAiUsagePeriod.update).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(aggregate).not.toHaveBeenCalled();
  });

  it("uses Pulse Trial period spend without aggregating historical usage rows", async () => {
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
      pulseTrialPolicyVersion: "pulse-trial-2026-06-30-v2",
      spentUsdMicros: 1_700_000n,
      trialEndsAt: new Date("2026-04-08T12:00:00.000Z"),
      trialStartedAt: new Date("2026-04-01T12:00:00.000Z"),
    });

    await expect(readHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-04-03T13:05:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: true,
      spentUsdMicros: 1_700_000n,
    });

    expect(prisma.hostedAiUsagePeriod.update).not.toHaveBeenCalled();
    expect(aggregate).not.toHaveBeenCalled();
  });

  it("reads period spend and active claims from one repeatable-read snapshot", async () => {
    const tx = createGatePrisma({
      spentUsdMicros: 1_000_000n,
    });
    const transaction = vi.fn(async (
      run: (client: typeof tx) => Promise<unknown>,
    ) => run(tx));

    await expect(readHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-03-29T12:00:00.000Z",
      prisma: { $transaction: transaction } as never,
    })).resolves.toMatchObject({
      allowed: true,
      remainingUsdMicros: 9_000_000n,
      spentUsdMicros: 1_000_000n,
    });
    expect(transaction).toHaveBeenCalledExactlyOnceWith(
      expect.any(Function),
      { isolationLevel: "RepeatableRead" },
    );
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
      },
      periodEnd,
      periodStart,
      spentUsdMicros: 10_000_000n,
    });
    const findPeriods = vi.fn(async () => [{
      billingPlanCode: "launch_monthly",
      blockedAt: new Date("2026-07-22T16:55:00.000Z"),
      limitUsdMicros: 10_000_000n,
      memberId: "member_123",
      periodEnd,
      periodStart,
      spentUsdMicros: 10_000_000n,
      updatedAt: periodUpdatedAt,
    }]);
    Object.assign(prisma.hostedAiUsagePeriod, { findMany: findPeriods });
    const transaction = vi.fn(async (
      run: (tx: typeof prisma) => Promise<unknown>,
    ) => run(prisma));

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
    expect(findPeriods).toHaveBeenCalledWith({
      select: {
        memberId: true,
        periodStart: true,
        updatedAt: true,
      },
      where: {
        OR: [{
          memberId: "member_123",
          periodStart,
        }],
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
      findUniquePeriod: {
        billingPlanCode: "launch_monthly",
        blockedAt: new Date("2026-07-22T16:55:00.000Z"),
        limitUsdMicros: 10_000_000n,
        periodEnd,
        periodStart,
        spentUsdMicros: 10_000_000n,
      },
      periodEnd,
      periodStart,
      spentUsdMicros: 10_000_000n,
    });
    Object.assign(increasedPlan.hostedAiUsagePeriod, {
      findMany: vi.fn(async () => [{
        memberId: "member_123",
        periodStart,
        updatedAt: periodUpdatedAt,
      }]),
    });
    const increasedTransaction = vi.fn(async (
      run: (tx: typeof increasedPlan) => Promise<unknown>,
    ) => run(increasedPlan));

    const increasedSnapshots = await readHostedAiUsageGateSnapshots({
      memberIds: ["member_123"],
      now,
      prisma: { $transaction: increasedTransaction } as never,
    });

    expect(increasedSnapshots.get("member_123")).toMatchObject({
      decision: {
        allowed: true,
        limitUsdMicros: 25_000_000n,
        remainingUsdMicros: 15_000_000n,
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
      },
      periodEnd,
      periodStart,
      spentUsdMicros: 11_000_000n,
    });
    Object.assign(decreasedPlan.hostedAiUsagePeriod, {
      findMany: vi.fn(async () => [{
        memberId: "member_123",
        periodStart,
        updatedAt: periodUpdatedAt,
      }]),
    });
    const decreasedTransaction = vi.fn(async (
      run: (tx: typeof decreasedPlan) => Promise<unknown>,
    ) => run(decreasedPlan));

    const decreasedSnapshots = await readHostedAiUsageGateSnapshots({
      memberIds: ["member_123"],
      now,
      prisma: { $transaction: decreasedTransaction } as never,
    });

    expect(decreasedSnapshots.get("member_123")).toMatchObject({
      decision: {
        allowed: false,
        limitUsdMicros: 10_000_000n,
        reason: "ai_usage_limit_exceeded",
        remainingUsdMicros: 0n,
      },
      periodPersistedAt: periodUpdatedAt,
    });
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

  it("confirms exhausted read decisions through the mutating gate", async () => {
    const prisma = createGatePrisma({
      spentUsdMicros: 10_000_000n,
    });
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
      spentUsdMicros: 10_000_000n,
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
    const update = vi.fn(async (args?: unknown) => {
      void args;
      return undefined;
    });
    const prisma = createGatePrisma({
      spentUsdMicros: 10_000_000n,
      update,
    });
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
      spentUsdMicros: 10_000_000n,
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

describe("hosted image generation capacity reservations", () => {
  const now = new Date("2026-03-29T12:00:05.000Z");

  it("subtracts the safety estimate, preserves exact replay, and defers claim-only pressure", async () => {
    const reservationStore = createHostedAiUsageReservationStore();
    const prisma = createGatePrisma({
      hostedAiUsageReservation: reservationStore.delegate,
      spentUsdMicros: 9_990_000n,
    });

    await expect(reserveHostedImageGenerationCapacity({
      memberId: "member_123",
      now,
      prisma: prisma as never,
      requestId: "image_request_1",
      spec: LOW_SQUARE_IMAGE_CAPACITY_SPEC,
    })).resolves.toEqual({
      requestId: "image_request_1",
      status: "reserved",
    });

    expect(reservationStore.rows.get("image_request_1")).toMatchObject({
      estimatedCostUsdMicros: LOW_SQUARE_IMAGE_ESTIMATE_USD_MICROS,
      estimatorVersion: "gpt-image-2-capacity-2026-07-25-v2",
      imageQuality: "low",
      imageSize: "1024x1024",
      promptUtf8Bytes: 1,
      referenceImageCount: 0,
    });
    await expect(readHostedAiUsageGate({
      memberId: "member_123",
      now,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: true,
      remainingUsdMicros: 3_995n,
    });

    await expect(reserveHostedImageGenerationCapacity({
      memberId: "member_123",
      now,
      prisma: prisma as never,
      requestId: "image_request_1",
      spec: LOW_SQUARE_IMAGE_CAPACITY_SPEC,
    })).resolves.toEqual({
      requestId: "image_request_1",
      status: "reserved",
    });
    expect(reservationStore.delegate.create).toHaveBeenCalledOnce();

    await expect(reserveHostedImageGenerationCapacity({
      memberId: "member_123",
      now,
      prisma: prisma as never,
      requestId: "image_request_2",
      spec: LOW_SQUARE_IMAGE_CAPACITY_SPEC,
    })).resolves.toEqual({
      requestId: "image_request_2",
      status: "insufficient_capacity",
    });
    expect(reservationStore.rows.has("image_request_2")).toBe(false);

    await expect(reserveHostedImageGenerationCapacity({
      memberId: "member_123",
      now,
      prisma: prisma as never,
      requestId: "image_request_1",
      spec: {
        ...LOW_SQUARE_IMAGE_CAPACITY_SPEC,
        promptUtf8Bytes: 2,
      },
    })).rejects.toThrow(
      "already exists with different immutable estimate inputs",
    );

    const storedReplay = reservationStore.rows.get("image_request_1");
    if (!storedReplay) {
      throw new Error("Expected the image reservation replay fixture.");
    }
    storedReplay.estimatorVersion = "gpt-image-2-capacity-older";
    await expect(reserveHostedImageGenerationCapacity({
      memberId: "member_123",
      now,
      prisma: prisma as never,
      requestId: "image_request_1",
      spec: LOW_SQUARE_IMAGE_CAPACITY_SPEC,
    })).rejects.toThrow(
      "already exists with a stale capacity estimate",
    );
    storedReplay.estimatorVersion = "gpt-image-2-capacity-2026-07-25-v2";
    storedReplay.estimatedCostUsdMicros -= 1n;
    await expect(reserveHostedImageGenerationCapacity({
      memberId: "member_123",
      now,
      prisma: prisma as never,
      requestId: "image_request_1",
      spec: LOW_SQUARE_IMAGE_CAPACITY_SPEC,
    })).rejects.toThrow(
      "already exists with a stale capacity estimate",
    );
  });

  it("keeps positive unreserved capacity by denying an estimate equal to the remainder", async () => {
    const reservationStore = createHostedAiUsageReservationStore();
    const prisma = createGatePrisma({
      hostedAiUsageReservation: reservationStore.delegate,
      spentUsdMicros:
        10_000_000n - LOW_SQUARE_IMAGE_ESTIMATE_USD_MICROS,
    });

    await expect(reserveHostedImageGenerationCapacity({
      memberId: "member_123",
      now,
      prisma: prisma as never,
      requestId: "image_request_equal_remainder",
      spec: LOW_SQUARE_IMAGE_CAPACITY_SPEC,
    })).resolves.toEqual({
      requestId: "image_request_equal_remainder",
      status: "would_exhaust",
    });
    expect(reservationStore.rows.size).toBe(0);
  });

  it.each([
    ["fully claimed", 9_990_000n, 10_000n],
    ["partially claimed", 9_980_000n, 15_000n],
  ] as const)(
    "keeps %s reservation pressure noncommercial",
    async (_label, spentUsdMicros, activeEstimateUsdMicros) => {
      const reservationStore = createHostedAiUsageReservationStore([{
        estimatedCostUsdMicros: activeEstimateUsdMicros,
        requestId: "turn_image_active_claim.attempt-1",
      }]);
      const prisma = createGatePrisma({
        hostedAiUsageReservation: reservationStore.delegate,
        spentUsdMicros,
      });

      await expect(reserveHostedImageGenerationCapacity({
        memberId: "member_123",
        now,
        prisma: prisma as never,
        requestId: "turn_image_waiting_for_claim.attempt-1",
        spec: LOW_SQUARE_IMAGE_CAPACITY_SPEC,
      })).resolves.toEqual({
        requestId: "turn_image_waiting_for_claim.attempt-1",
        status: "insufficient_capacity",
      });
      expect(
        reservationStore.rows.has("turn_image_waiting_for_claim.attempt-1"),
      ).toBe(false);
    },
  );

  it("keeps an actual non-fit commercial when claims also consume capacity", async () => {
    const reservationStore = createHostedAiUsageReservationStore([{
      estimatedCostUsdMicros: 5_000n,
      requestId: "turn_image_active_exact_claim.attempt-1",
    }]);
    const prisma = createGatePrisma({
      hostedAiUsageReservation: reservationStore.delegate,
      spentUsdMicros: 9_995_000n,
    });

    await expect(reserveHostedImageGenerationCapacity({
      memberId: "member_123",
      now,
      prisma: prisma as never,
      requestId: "turn_image_actual_non_fit.attempt-1",
      spec: LOW_SQUARE_IMAGE_CAPACITY_SPEC,
    })).resolves.toEqual({
      requestId: "turn_image_actual_non_fit.attempt-1",
      status: "would_exhaust",
    });
    expect(reservationStore.rows.has("turn_image_actual_non_fit.attempt-1"))
      .toBe(false);
  });

  it.each(["1024x1536", "1536x1024"] as const)(
    "rounds medium %s output above the provider calculator cost",
    async (size) => {
      const reservationStore = createHostedAiUsageReservationStore();
      const prisma = createGatePrisma({
        hostedAiUsageReservation: reservationStore.delegate,
        spentUsdMicros: 0n,
      });
      const requestId = `turn_image_medium_${size}.attempt-1`;

      await expect(reserveHostedImageGenerationCapacity({
        memberId: "member_123",
        now,
        prisma: prisma as never,
        requestId,
        spec: {
          model: "gpt-image-2",
          promptUtf8Bytes: 100,
          quality: "medium",
          referenceImageCount: 2,
          size,
        },
      })).resolves.toEqual({
        requestId,
        status: "reserved",
      });
      expect(reservationStore.rows.get(requestId)).toMatchObject({
        estimatedCostUsdMicros: 202_500n,
        estimatorVersion: "gpt-image-2-capacity-2026-07-25-v2",
      });
    },
  );

  it("stops subtracting released, settled, and expired reservations", async () => {
    const reservationStore = createHostedAiUsageReservationStore([
      {
        periodEnd: now,
        requestId: "image_request_expired",
      },
      {
        dispatchedAt: new Date("2026-03-29T12:00:01.000Z"),
        requestId: "turn_image_settled.attempt-1",
        settledUsageId: "turn_image_settled.attempt-1",
      },
    ]);
    const prisma = createGatePrisma({
      hostedAiUsageReservation: reservationStore.delegate,
      spentUsdMicros: 9_990_000n,
    });

    await reserveHostedImageGenerationCapacity({
      memberId: "member_123",
      now,
      prisma: prisma as never,
      requestId: "image_request_release",
      spec: LOW_SQUARE_IMAGE_CAPACITY_SPEC,
    });
    await expect(releaseHostedAiUsageReservation({
      memberId: "member_123",
      now,
      prisma: prisma as never,
      requestId: "image_request_release",
    })).resolves.toEqual({
      requestId: "image_request_release",
      status: "released",
    });
    expect(reservationStore.rows.get("image_request_release")?.releasedAt)
      .toEqual(now);
    await expect(readHostedAiUsageGate({
      memberId: "member_123",
      now,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: true,
      remainingUsdMicros: 10_000n,
    });
  });

  it("rechecks temporary pre-dispatch pressure at TTL without a limit notice", async () => {
    const createdAt = new Date(now.getTime() - 60_000);
    const expiresAt = new Date(
      createdAt.getTime()
      + HOSTED_AI_USAGE_RESERVATION_PRE_DISPATCH_TTL_MS,
    );
    const reservationStore = createHostedAiUsageReservationStore([{
      createdAt,
      estimatedCostUsdMicros: 10_000n,
      requestId: "image_request_temporary_capacity",
    }]);
    const prisma = createGatePrisma({
      hostedAiUsageReservation: reservationStore.delegate,
      spentUsdMicros: 9_990_000n,
    });

    await expect(readHostedAiUsageGate({
      memberId: "member_123",
      now,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: false,
      reason: "ai_usage_capacity_reserved",
      retryAfter: expiresAt,
      userNotice: null,
    });
    await expect(readHostedAiUsageGate({
      memberId: "member_123",
      now: expiresAt,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: true,
      remainingUsdMicros: 10_000n,
    });
  });

  it("rechecks reservation pressure at a nearer current-period reset", async () => {
    const currentPeriodEnd = new Date(now.getTime() + 2 * 60_000);
    const reservationStore = createHostedAiUsageReservationStore([{
      createdAt: now,
      estimatedCostUsdMicros: 10_000n,
      periodEnd: new Date(now.getTime() + 30 * 60_000),
      requestId: "image_request_reset_before_ttl",
    }]);
    const prisma = createGatePrisma({
      hostedAiUsageReservation: reservationStore.delegate,
      periodEnd: currentPeriodEnd,
      spentUsdMicros: 9_990_000n,
    });

    await expect(readHostedAiUsageGate({
      memberId: "member_123",
      now,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: false,
      reason: "ai_usage_capacity_reserved",
      retryAfter: currentPeriodEnd,
      userNotice: null,
    });
  });

  it("rechecks at an overlapping dispatched claim's nearer period end", async () => {
    const claimPeriodEnd = new Date(now.getTime() + 60_000);
    const reservationStore = createHostedAiUsageReservationStore([{
      dispatchedAt: now,
      estimatedCostUsdMicros: 10_000n,
      periodEnd: claimPeriodEnd,
      requestId: "image_request_dispatched_overlap",
    }]);
    const prisma = createGatePrisma({
      hostedAiUsageReservation: reservationStore.delegate,
      periodEnd: new Date(now.getTime() + 30 * 60_000),
      spentUsdMicros: 9_990_000n,
    });

    await expect(readHostedAiUsageGate({
      memberId: "member_123",
      now,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: false,
      reason: "ai_usage_capacity_reserved",
      retryAfter: claimPeriodEnd,
      userNotice: null,
    });
  });

  it("conservatively keeps an overlapping claim against member-wide credit", async () => {
    const reservationStore = createHostedAiUsageReservationStore([{
      dispatchedAt: new Date("2026-03-29T12:00:01.000Z"),
      periodEnd: new Date("2026-04-01T00:00:00.000Z"),
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
      requestId: "image_request_old_entitlement_period",
    }]);
    const prisma = createGatePrisma({
      hostedAiUsageReservation: reservationStore.delegate,
      periodEnd: new Date("2026-04-15T00:00:00.000Z"),
      periodStart: new Date("2026-03-15T00:00:00.000Z"),
      spentUsdMicros: 9_990_000n,
    });

    await expect(readHostedAiUsageGate({
      memberId: "member_123",
      now,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: true,
      remainingUsdMicros: 3_995n,
    });
  });

  it("rejects invalid settlement correlations before accounting provider usage", async () => {
    const imageRecord = buildOpenAiImageUsageRecord();
    const dispatchedAt = new Date("2026-03-29T12:00:01.000Z");
    const invalidCases: Array<{
      expectedError: string;
      memberId?: string;
      record?: AssistantUsageRecord;
      reservationId: string;
      rows: Array<
        Partial<HostedAiUsageReservationTestRow>
        & Pick<HostedAiUsageReservationTestRow, "requestId">
      >;
    }> = [
      {
        expectedError: "does not exist",
        reservationId: "image_request_missing",
        rows: [],
      },
      {
        expectedError: "belongs to a different member",
        reservationId: "image_request_wrong_owner",
        rows: [{
          dispatchedAt,
          memberId: "member_other",
          requestId: "image_request_wrong_owner",
        }],
      },
      {
        expectedError: "must be dispatched before settlement",
        reservationId: imageRecord.usageId,
        rows: [{ requestId: imageRecord.usageId }],
      },
      {
        expectedError: "does not match the expected usage identity",
        reservationId: "image_request_swapped_usage",
        rows: [{
          dispatchedAt,
          requestId: "image_request_swapped_usage",
        }],
      },
      {
        expectedError: "Released hosted AI usage reservation cannot settle",
        reservationId: imageRecord.usageId,
        rows: [{
          releasedAt: new Date("2026-03-29T12:00:02.000Z"),
          requestId: imageRecord.usageId,
        }],
      },
      {
        expectedError: "can settle only OpenAI Images usage",
        record: BASE_USAGE_RECORD,
        reservationId: "image_request_wrong_record",
        rows: [{
          dispatchedAt,
          requestId: "image_request_wrong_record",
        }],
      },
    ];

    for (const invalidCase of invalidCases) {
      const reservationStore = createHostedAiUsageReservationStore(
        invalidCase.rows,
      );
      const usageUpdateMany = vi.fn(async () => ({ count: 1 }));
      const tx = createAllowanceTx({
        executeRaw: vi.fn<AllowanceExecuteRaw>(async () => 1),
        hostedAiUsageReservation: reservationStore.delegate,
        hostedAiUsageUpdateMany: usageUpdateMany,
      });

      await expect(accountHostedAiUsageForAllowanceTx({
        memberId: invalidCase.memberId ?? "member_123",
        now,
        record: invalidCase.record ?? imageRecord,
        reservationId: invalidCase.reservationId,
        tx: tx as never,
      })).rejects.toThrow(invalidCase.expectedError);
      expect(usageUpdateMany).not.toHaveBeenCalled();
    }
  });

  it("does not use already-accounted usage to settle a fresh reservation", async () => {
    const record = buildOpenAiImageUsageRecord();
    const reservationStore = createHostedAiUsageReservationStore([{
      dispatchedAt: new Date("2026-03-29T12:00:01.000Z"),
      requestId: record.usageId,
    }]);
    const tx = createAllowanceTx({
      executeRaw: vi.fn<AllowanceExecuteRaw>(async () => 1),
      hostedAiUsageReservation: reservationStore.delegate,
      hostedAiUsageUpdateMany: vi.fn(async () => ({ count: 0 })),
    });

    await expect(accountHostedAiUsageForAllowanceTx({
      memberId: "member_123",
      now,
      record,
      reservationId: record.usageId,
      tx: tx as never,
    })).rejects.toThrow(
      "cannot settle from already-accounted usage",
    );
    expect(reservationStore.rows.get(record.usageId)).toMatchObject({
      settledUsageId: null,
    });
    expect(reservationStore.delegate.updateMany).not.toHaveBeenCalled();
  });
});

function createHostedAiUsageReservationStore(
  initialRows: Array<
    Partial<HostedAiUsageReservationTestRow>
    & Pick<HostedAiUsageReservationTestRow, "requestId">
  > = [],
) {
  const rows = new Map<string, HostedAiUsageReservationTestRow>(
    initialRows.map((row) => {
      const normalized = {
        allowanceSource: row.allowanceSource ?? "direct_paid_member_plan",
        createdAt: row.createdAt ?? new Date("2026-03-29T12:00:00.000Z"),
        dispatchedAt: row.dispatchedAt ?? null,
        estimatedCostUsdMicros:
          row.estimatedCostUsdMicros ?? LOW_SQUARE_IMAGE_ESTIMATE_USD_MICROS,
        estimatorVersion:
          row.estimatorVersion ?? "gpt-image-2-capacity-2026-07-25-v2",
        imageQuality: row.imageQuality ?? "low",
        imageSize: row.imageSize ?? "1024x1024",
        memberId: row.memberId ?? "member_123",
        periodEnd: row.periodEnd ?? new Date("2026-04-01T00:00:00.000Z"),
        periodStart: row.periodStart ?? new Date("2026-03-01T00:00:00.000Z"),
        promptUtf8Bytes: row.promptUtf8Bytes ?? 1,
        referenceImageCount: row.referenceImageCount ?? 0,
        releasedAt: row.releasedAt ?? null,
        requestId: row.requestId,
        settledUsageId: row.settledUsageId ?? null,
      } satisfies HostedAiUsageReservationTestRow;
      return [normalized.requestId, normalized] as const;
    }),
  );

  function matchesWhere(
    row: HostedAiUsageReservationTestRow,
    where: Record<string, unknown>,
  ): boolean {
    const alternatives = where.OR;
    if (
      Array.isArray(alternatives)
      && !alternatives.some((alternative) =>
        typeof alternative === "object"
        && alternative !== null
        && matchesWhere(row, alternative as Record<string, unknown>)
      )
    ) {
      return false;
    }
    if (typeof where.requestId === "string" && row.requestId !== where.requestId) {
      return false;
    }
    if (typeof where.memberId === "string" && row.memberId !== where.memberId) {
      return false;
    }
    for (const field of [
      "dispatchedAt",
      "releasedAt",
      "settledUsageId",
    ] as const) {
      const condition = where[field];
      if (condition === null && row[field] !== null) {
        return false;
      }
      if (
        typeof condition === "object"
        && condition !== null
        && "not" in condition
        && (condition as { not: unknown }).not === null
        && row[field] === null
      ) {
        return false;
      }
    }
    const periodEnd = where.periodEnd;
    if (
      typeof periodEnd === "object"
      && periodEnd !== null
      && "gt" in periodEnd
      && row.periodEnd <= (periodEnd as { gt: Date }).gt
    ) {
      return false;
    }
    const createdAt = where.createdAt;
    if (
      typeof createdAt === "object"
      && createdAt !== null
      && "gt" in createdAt
      && row.createdAt <= (createdAt as { gt: Date }).gt
    ) {
      return false;
    }
    return true;
  }

  const delegate = {
    aggregate: vi.fn(async (args: {
      where: Record<string, unknown>;
    }) => {
      const matches = [...rows.values()]
        .filter((row) => matchesWhere(row, args.where));
      return {
        _min: {
          createdAt: matches.length > 0
            ? new Date(Math.min(...matches.map((row) => row.createdAt.getTime())))
            : null,
          periodEnd: matches.length > 0
            ? new Date(Math.min(...matches.map((row) => row.periodEnd.getTime())))
            : null,
        },
        _sum: {
          estimatedCostUsdMicros: matches
          .reduce((total, row) => total + row.estimatedCostUsdMicros, 0n),
        },
      };
    }),
    create: vi.fn(async (args: {
      data: Omit<
        HostedAiUsageReservationTestRow,
        "createdAt" | "dispatchedAt" | "releasedAt" | "settledUsageId"
      >;
    }) => {
      const data = args.data;
      if (rows.has(data.requestId)) {
        throw new TypeError("Duplicate hosted AI usage reservation.");
      }
      const row = {
        ...data,
        createdAt: new Date("2026-03-29T12:00:00.000Z"),
        dispatchedAt: null,
        releasedAt: null,
        settledUsageId: null,
      };
      rows.set(data.requestId, row);
      return row;
    }),
    findUnique: vi.fn(async (args: { where: { requestId: string } }) =>
      rows.get(args.where.requestId) ?? null
    ),
    updateMany: vi.fn(async (args: {
      data: Partial<HostedAiUsageReservationTestRow>;
      where: Record<string, unknown>;
    }) => {
      let count = 0;
      for (const row of rows.values()) {
        if (!matchesWhere(row, args.where)) {
          continue;
        }
        Object.assign(row, args.data);
        count += 1;
      }
      return { count };
    }),
  };

  return { delegate, rows };
}

function createAllowanceTx(input: {
  billingPhase?: string | null;
  billingPlanCode?: string;
  billingStatus?: HostedBillingStatus;
  blockedAt?: Date | null;
  checkoutOffer?: string | null;
  executeRaw: AllowanceExecuteRawMock;
  familyAccessActive?: boolean;
  familyBillingPlanCode?: string | null;
  familyPlanCode?: "edge" | "pulse";
  familyPeriodEnd?: Date | null;
  familyPeriodStart?: Date | null;
  hostedAiUsageAggregate?: ReturnType<typeof vi.fn>;
  hostedAiUsageReservation?: HostedAiUsageReservationTestStore["delegate"];
  hostedAiUsageUpdateMany: ReturnType<typeof vi.fn>;
  limitUsdMicros?: bigint;
  memberPeriodEnd?: Date;
  memberPeriodStart?: Date;
  periodEnd?: Date;
  periodStart?: Date;
  pulseTrialPolicyVersion?: string | null;
  pulseTrialRedeemedAt?: Date | null;
  spentUsdMicros?: bigint;
  suspendedAt?: Date | null;
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
        allowanceCostUsdMicros: 948n,
      },
    });

  return {
    $executeRaw: input.executeRaw,
    $queryRaw: vi.fn<AllowanceQueryRaw>(async () => []),
    hostedAiUsage: {
      aggregate: input.hostedAiUsageAggregate ?? defaultAggregate,
      updateMany: input.hostedAiUsageUpdateMany,
    },
    hostedAiUsageReservation:
      input.hostedAiUsageReservation
      ?? createHostedAiUsageReservationStore().delegate,
    hostedAiUsagePeriod: {
      createMany: vi.fn(async () => ({ count: 1 })),
      findUnique: vi.fn(async () => ({
        billingPlanCode: input.billingPlanCode ?? "launch_monthly",
        blockedAt: input.blockedAt ?? null,
        limitUsdMicros: input.limitUsdMicros ?? 10_000_000n,
        periodEnd: input.periodEnd ?? new Date("2026-04-01T00:00:00.000Z"),
        periodStart: input.periodStart ?? new Date("2026-03-01T00:00:00.000Z"),
        spentUsdMicros: input.spentUsdMicros ?? 0n,
      })),
      findUniqueOrThrow: vi.fn(async () => ({
        billingPlanCode: input.billingPlanCode ?? "launch_monthly",
        blockedAt: input.blockedAt ?? null,
        lastUsageAt: null,
        limitUsdMicros: input.limitUsdMicros ?? 10_000_000n,
        periodEnd: input.periodEnd ?? new Date("2026-04-01T00:00:00.000Z"),
        periodStart: input.periodStart ?? new Date("2026-03-01T00:00:00.000Z"),
        spentUsdMicros: input.spentUsdMicros ?? 0n,
      })),
      update: vi.fn(async (args?: {
        data?: {
          billingPlanCode?: string;
          blockedAt?: Date | null;
          limitUsdMicros?: bigint;
          periodEnd?: Date;
        };
      }) => ({
        billingPlanCode: args?.data?.billingPlanCode ?? input.billingPlanCode ?? "launch_monthly",
        blockedAt: args?.data?.blockedAt ?? input.blockedAt ?? null,
        limitUsdMicros: args?.data?.limitUsdMicros ?? input.limitUsdMicros ?? 10_000_000n,
        periodEnd: args?.data?.periodEnd ?? input.periodEnd ?? new Date("2026-04-01T00:00:00.000Z"),
        periodStart: input.periodStart ?? new Date("2026-03-01T00:00:00.000Z"),
        spentUsdMicros: input.spentUsdMicros ?? 0n,
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
          currentPeriodEnd:
            input.memberPeriodEnd
            ?? input.periodEnd
            ?? new Date("2026-04-01T00:00:00.000Z"),
          currentPeriodStart:
            input.memberPeriodStart
            ?? input.periodStart
            ?? new Date("2026-03-01T00:00:00.000Z"),
          currentTrialEndsAt: input.trialEndsAt ?? null,
          currentTrialStartedAt: input.trialStartedAt ?? null,
          pulseTrialPolicyVersion: input.pulseTrialPolicyVersion ?? null,
          pulseTrialRedeemedAt: input.pulseTrialRedeemedAt ?? null,
        },
        billingStatus: input.billingStatus ?? HostedBillingStatus.active,
        id: "member_123",
        suspendedAt: input.suspendedAt ?? null,
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
  billingStatus?: HostedBillingStatus;
  checkoutOffer?: string | null;
  executeRaw?: ReturnType<typeof vi.fn>;
  familyAccessActive?: boolean;
  familyBillingPlanCode?: string | null;
  familyPlanCode?: "edge" | "pulse";
  familyPeriodEnd?: Date | null;
  familyPeriodStart?: Date | null;
  findUniquePeriod?: {
    billingPlanCode: string;
    blockedAt?: Date | null;
    lastUsageAt?: Date | null;
    limitUsdMicros: bigint;
    periodEnd: Date;
    periodStart: Date;
    spentUsdMicros: bigint;
  } | null;
  hostedAiUsageReservation?: HostedAiUsageReservationTestStore["delegate"];
  limitUsdMicros?: bigint;
  periodEnd?: Date;
  periodStart?: Date;
  pulseTrialPolicyVersion?: string | null;
  pulseTrialRedeemedAt?: Date | null;
  queryRaw?: ReturnType<typeof vi.fn>;
  scheduledBillingEffectiveAt?: Date | null;
  scheduledBillingPlanCode?: string | null;
  spentUsdMicros: bigint;
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
    hostedAiUsageReservation:
      input.hostedAiUsageReservation
      ?? createHostedAiUsageReservationStore().delegate,
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
        blockedAt: defaultPeriod.blockedAt,
        limitUsdMicros: args?.data?.limitUsdMicros ?? defaultPeriod.limitUsdMicros,
        periodEnd: args?.data?.periodEnd ?? defaultPeriod.periodEnd,
        periodStart: defaultPeriod.periodStart,
        spentUsdMicros: defaultPeriod.spentUsdMicros,
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
          currentTrialEndsAt: input.trialEndsAt ?? null,
          currentTrialStartedAt: input.trialStartedAt ?? null,
          pulseTrialPolicyVersion: input.pulseTrialPolicyVersion ?? null,
          pulseTrialRedeemedAt: input.pulseTrialRedeemedAt ?? null,
          scheduledBillingEffectiveAt: input.scheduledBillingEffectiveAt ?? null,
          scheduledBillingPlanCode: input.scheduledBillingPlanCode ?? null,
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
