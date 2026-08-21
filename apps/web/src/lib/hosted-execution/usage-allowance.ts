import {
  HostedBillingStatus,
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import {
  classifyAssistantOpenAiImageUsageBasis,
  HOSTED_GEMINI_VIDEO_ANALYSIS_USAGE_EXTRACTION_SOURCE_PATH,
  HOSTED_GEMINI_VIDEO_ANALYSIS_USAGE_EXTRACTION_VERSION,
  type AssistantOpenAiImageUsageTokenBuckets,
  type AssistantOpenAiImageUsageUnpriceableReason,
  type AssistantUsageCredentialSource,
  type AssistantUsageRecord,
  type AssistantUsageTokenPricingBasis,
  normalizeAssistantUsageTokenPricingBasis,
} from "@murphai/hosted-execution/assistant-usage";
import {
  HOSTED_GEMINI_VIDEO_ANALYSIS_API_BASE_URL,
  HOSTED_GEMINI_VIDEO_ANALYSIS_API_KEY_ENV,
  HOSTED_GEMINI_VIDEO_ANALYSIS_MODEL,
} from "@murphai/hosted-execution/assistant-capabilities";
import {
  isHostedAiUsageOpenAiTokenPricingProviderName,
  normalizeHostedAiUsageAllowanceElevenLabsMusicModelId,
  normalizeHostedAiUsageAllowanceElevenLabsTtsModelId,
  normalizeHostedAiUsageAllowanceOpenAiImageModelId,
  normalizeHostedAiUsageAllowancePricedModelId,
  type HostedAiUsageAllowanceElevenLabsMusicPricedModel,
  type HostedAiUsageAllowanceElevenLabsTtsPricedModel,
  type HostedAiUsageAllowanceOpenAiImagePricedModel,
  type HostedAiUsageAllowancePricedModel,
  type HostedAiUsageOpenAiFlexTokenPricingModel,
} from "@murphai/hosted-execution/runtime-control";
import {
  HOSTED_ASSISTANT_VENICE_PROVIDER,
  HOSTED_ASSISTANT_VENICE_PROVIDER_MODELS,
} from "@murphai/hosted-execution/assistant-model";

import {
  getHostedAiUsageMonthlyAllowanceUsdMicros,
  getHostedDefaultBillingPlanCode,
  getHostedFamilyAiUsageMonthlyAllowanceForPlan,
  getHostedFamilyBillingPlanCode,
  isHostedBillingPlanImmediateUpgrade,
  parseHostedBillingPlanCode,
  parseHostedFamilyPlanCode,
  type HostedBillingPlanCode,
} from "../hosted-onboarding/billing-plans";
import {
  hasHostedPaidBillingRefEvidence,
} from "../hosted-onboarding/entitlement";
import {
  buildHostedStarterUsageLifetimePeriod,
} from "../hosted-onboarding/starter-usage";
import {
  HOSTED_FAMILY_BILLING_PLAN_CODE,
  readHostedFamilyAccessForMember,
} from "../hosted-onboarding/family-plan";
import {
  type HostedMemberPersonAccessState,
  hostedMemberPersonAccessSelect,
  readActiveHostedMemberAccess,
} from "../hosted-onboarding/member-access";
import { getPrisma } from "../prisma";
import {
  admitHostedGroupSponsorshipRefillTx,
} from "../hosted-groups/group-sponsorship-authorization";
import {
  classifyHostedGroupUsageCapacity,
} from "../hosted-groups/group-usage-capacity";
import { renderUserFacingMessage } from "../hosted-messages/user-facing-messages";
import { settleHostedUsageCreditForUsageTx } from "./usage-credits";
import {
  HOSTED_LOB_USAGE_PRICING_SOURCE,
  HOSTED_LOB_USAGE_PRICING_VERSION,
  matchHostedLobPhysicalNoteUsageRecord,
} from "./usage-lob";
import {
  HOSTED_RETELL_USAGE_COST_KEY,
  HOSTED_RETELL_USAGE_PRICING_SOURCE,
  HOSTED_RETELL_USAGE_PRICING_VERSION,
  HOSTED_RETELL_USAGE_SOURCE_PATH,
  HOSTED_RETELL_USAGE_VERSION,
} from "./usage-retell";

type HostedAiUsageAllowanceClient = PrismaClient | Prisma.TransactionClient;
export type HostedAiUsageGateDeniedReason =
  | "ai_usage_limit_exceeded"
  | "hosted_access_inactive";
type HostedAiUsageAccessDeniedReason = Exclude<
  HostedAiUsageGateDeniedReason,
  "ai_usage_limit_exceeded"
>;

export type HostedAiUsageGateNoticeCode =
  | "edge_usage_limit_reached"
  | "family_usage_limit_reached"
  | "group_upgrade_pulse"
  | "max_usage_limit_reached"
  | "pulse_upgrade_edge"
  | "starter_usage_limit_reached"
  | "thread_usage_limit_reached";

export type HostedAiUsageLimitNoticeCode = HostedAiUsageGateNoticeCode;

export type HostedAiUsageGateDecision =
  | {
    allowed: true;
    billingPlanCode: HostedBillingPlanCode;
    limitUsdMicros: bigint;
    memberId: string;
    periodEnd: Date;
    periodStart: Date;
    planResetAt: Date | null;
    remainingUsdMicros: bigint;
    spentUsdMicros: bigint;
    usageCreditBalanceUsdMicros: bigint;
    usageCreditLedgerVersion: bigint;
  }
  | {
    allowed: false;
    billingPlanCode: HostedBillingPlanCode;
    limitUsdMicros: bigint;
    memberId: string;
    periodEnd: Date;
    periodStart: Date;
    planResetAt: Date | null;
    reason: "ai_usage_limit_exceeded";
    remainingUsdMicros: bigint;
    retryAfter: Date;
    spentUsdMicros: bigint;
    usageCreditBalanceUsdMicros: bigint;
    usageCreditLedgerVersion: bigint;
    userNotice: HostedAiUsageGateUserNotice;
  }
  | {
    allowed: false;
    billingPlanCode: HostedBillingPlanCode;
    limitUsdMicros: bigint;
    memberId: string;
    periodEnd: Date;
    periodStart: Date;
    planResetAt: Date | null;
    reason: HostedAiUsageAccessDeniedReason;
    remainingUsdMicros: bigint;
    retryAfter: Date;
    spentUsdMicros: bigint;
    usageCreditBalanceUsdMicros: bigint;
    usageCreditLedgerVersion: bigint;
    userNotice: HostedAiUsageGateUserNotice | null;
  };

export type HostedAiUsageGateDecisionWithSource =
  | (Extract<HostedAiUsageGateDecision, { allowed: true }> & {
    allowanceSource: HostedAiUsageAllowanceSourceKind;
  })
  | (Extract<HostedAiUsageGateDecision, { allowed: false }> & {
    allowanceSource: HostedAiUsageAllowanceSourceKind;
  });

export interface HostedAiUsageGateSnapshot {
  decision: HostedAiUsageGateDecisionWithSource;
  periodPersistedAt: Date | null;
}

export interface HostedAiUsageGateUserNotice {
  code: HostedAiUsageGateNoticeCode;
  message: string;
}

export interface HostedAiUsageLimitNotice extends HostedAiUsageGateUserNotice {
  code: HostedAiUsageLimitNoticeCode;
}

export interface HostedAiUsageAllowancePricingResult {
  costUsdMicros: bigint;
  counted: boolean;
  pricingSnapshot: Prisma.InputJsonObject;
  pricingVersion: string;
}

export interface HostedAiUsageLimitNoticeCandidate {
  crossedAt: Date;
  memberId: string;
  periodEnd: Date;
  periodStart: Date;
  planResetAt: Date | null;
  sourceUsageId: string;
  usageCreditLedgerVersion: bigint;
  userNotice: HostedAiUsageLimitNotice;
}

type HostedAiUsageAllowancePricingModelSource =
  | "requested"
  | "served";

interface HostedAiUsageAllowancePricingModelResolution {
  model: HostedAiUsageAllowancePricedModel | null;
  requestedModel: string | null;
  servedModel: string | null;
  source: HostedAiUsageAllowancePricingModelSource | null;
}

export type HostedAiUsageAllowanceSourceKind =
  | "direct_paid_member_plan"
  | "direct_starter"
  | "family_sponsored_plan"
  | "thread_container";

interface HostedAiUsageAllowanceTokenPricingBasisConfig {
  multiplierDenominator: bigint;
  multiplierNumerator: bigint;
  pricingSource: string;
  pricingVersion: string;
  requiredProviderKind: "openai" | "venice" | null;
}

type HostedAiUsageAllowanceTokenPricingBasesByModel = Record<
  HostedAiUsageAllowancePricedModel,
  Partial<Record<AssistantUsageTokenPricingBasis, HostedAiUsageAllowanceTokenPricingBasisConfig>>
  & {
    standard: HostedAiUsageAllowanceTokenPricingBasisConfig;
  }
> & Record<
  HostedAiUsageOpenAiFlexTokenPricingModel,
  {
    "openai-flex": HostedAiUsageAllowanceTokenPricingBasisConfig;
  }
>;

type HostedAiUsageAllowanceTokenPricingBasisResolution =
  HostedAiUsageAllowanceTokenPricingBasisConfig & {
    basis: AssistantUsageTokenPricingBasis;
  };

interface HostedAiUsageAllowanceModelPrice {
  cachedInputUsdMicrosPerMillionTokens: bigint;
  cacheWriteUsdMicrosPerMillionTokens?: bigint;
  inputUsdMicrosPerMillionTokens: bigint;
  outputUsdMicrosPerMillionTokens: bigint;
}

interface HostedAiUsageAllowancePeriod {
  allowanceSource: HostedAiUsageAllowanceSourceKind;
  billingPlanCode: HostedBillingPlanCode;
  blockedAt: Date | null;
  highestBillingPlanCode: HostedBillingPlanCode;
  limitUsdMicros: bigint;
  periodEnd: Date;
  periodStart: Date;
  planResetAt: Date | null;
  spentUsdMicros: bigint;
  usageCreditBalanceUsdMicros: bigint;
  usageCreditLedgerVersion: bigint;
}

type HostedAiUsageAllowancePeriodResult =
  | ({ kind: "period" } & HostedAiUsageAllowancePeriod)
  | ({
    kind: "denied";
    spentUsdMicros: bigint;
  } & HostedAiUsageCreditProjection
    & Extract<HostedAiUsageAllowancePeriodResolution, { kind: "denied" }>);

interface HostedAiUsageCreditProjection {
  usageCreditBalanceUsdMicros: bigint;
  usageCreditLedgerVersion: bigint;
}

type HostedAiUsageAllowancePeriodResolution =
  | ({
    kind: "period";
    allowanceSource: HostedAiUsageAllowanceSourceKind;
    source: "billing" | "calendar" | "starter";
  } & Omit<
    HostedAiUsageAllowancePeriod,
    | "blockedAt"
    | "highestBillingPlanCode"
    | "planResetAt"
    | "spentUsdMicros"
    | "usageCreditBalanceUsdMicros"
    | "usageCreditLedgerVersion"
  >)
  | {
    allowanceSource: HostedAiUsageAllowanceSourceKind;
    billingPlanCode: HostedBillingPlanCode;
    kind: "denied";
    limitUsdMicros: bigint;
    periodEnd: Date;
    periodStart: Date;
    reason: HostedAiUsageAccessDeniedReason;
    retryAfter: Date;
    userNotice: HostedAiUsageGateUserNotice | null;
  };

interface HostedAiUsageAllowanceBillingRef {
  allowanceSource?: "family_sponsored_plan" | null;
  currentBillingPhase: string | null;
  currentBillingPlanCode: string | null;
  currentCheckoutOffer?: string | null;
  currentPeriodEnd: Date | null;
  currentPeriodStart: Date | null;
  stripeSubscriptionLookupKey?: string | null;
  usagePlanTransitionAt?: Date | null;
  usagePlanTransitionFromCode?: string | null;
  usagePlanTransitionKind?: string | null;
  usagePlanTransitionToCode?: string | null;
  usageLimitUsdMicrosOverride?: bigint | null;
}

type HostedAiUsageAllowancePricingDecision =
  | {
    kind: "priced";
    priced: HostedAiUsageAllowancePricingResult;
  }
  | {
    counted: boolean;
    credentialSource: AssistantUsageCredentialSource;
    kind: "unpriceable_openai_image";
    modelResolution: HostedAiUsageAllowanceOpenAiImageModelResolution;
    reason: AssistantOpenAiImageUsageUnpriceableReason;
    tokenPricingBasis: AssistantUsageTokenPricingBasis;
  };

async function resolveHostedAiUsageAllowanceBillingRefForMember(input: {
  billingRef: HostedAiUsageAllowanceBillingRef | null;
  billingStatus: HostedBillingStatus;
  memberId: string;
  tx: Prisma.TransactionClient;
}): Promise<{
  billingRef: HostedAiUsageAllowanceBillingRef | null;
  familyAccessActive: boolean;
}> {
  if (
    input.billingStatus === HostedBillingStatus.active &&
    isHostedAiUsagePaidBillingRef(input.billingRef)
  ) {
    return {
      billingRef: input.billingRef,
      familyAccessActive: false,
    };
  }

  const familyBillingRef = await readHostedFamilySponsoredBillingRefForMember({
    memberId: input.memberId,
    tx: input.tx,
  });
  if (familyBillingRef) {
    return {
      billingRef: familyBillingRef,
      familyAccessActive: true,
    };
  }

  return {
    billingRef: input.billingRef,
    familyAccessActive: false,
  };
}

async function readHostedFamilySponsoredBillingRefForMember(input: {
  memberId: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedAiUsageAllowanceBillingRef | null> {
  const familyAccess = await readHostedFamilyAccessForMember({
    memberId: input.memberId,
    prisma: input.tx,
  });
  if (!familyAccess) {
    return null;
  }
  const planCode = parseHostedFamilyPlanCode(familyAccess.planCode);
  if (!planCode) {
    return null;
  }

  const billingRef = await input.tx.hostedAccountGroupBillingRef.findUnique({
    select: {
      currentBillingPlanCode: true,
      currentBillingPhase: true,
      currentPeriodEnd: true,
      currentPeriodStart: true,
    },
    where: {
      groupId: familyAccess.groupId,
    },
  });
  const periodBillingRef =
    billingRef?.currentBillingPlanCode === HOSTED_FAMILY_BILLING_PLAN_CODE &&
    billingRef.currentBillingPhase === "paid"
      ? billingRef
      : null;
  const currentPeriodStart = periodBillingRef?.currentPeriodStart ?? null;
  const currentPeriodEnd = periodBillingRef?.currentPeriodEnd ?? null;

  // Family sponsorship owns the plan, tier, and allowance. Only a paid Family
  // projection is eligible to define the billing period; the shared resolver
  // validates its bounds and falls back to a UTC month when they lag.
  return {
    allowanceSource: "family_sponsored_plan",
    currentBillingPhase: "paid",
    currentBillingPlanCode: getHostedFamilyBillingPlanCode(planCode),
    currentCheckoutOffer: null,
    currentPeriodEnd,
    currentPeriodStart,
    stripeSubscriptionLookupKey: null,
    usagePlanTransitionAt: familyAccess.usagePlanTransitionAt,
    usagePlanTransitionFromCode: familyAccess.usagePlanTransitionFromCode,
    usagePlanTransitionKind: familyAccess.usagePlanTransitionKind,
    usagePlanTransitionToCode: familyAccess.usagePlanTransitionToCode,
    usageLimitUsdMicrosOverride:
      getHostedFamilyAiUsageMonthlyAllowanceForPlan(planCode),
  };
}

function isHostedAiUsagePaidBillingRef(
  billingRef: HostedAiUsageAllowanceBillingRef | null,
): boolean {
  return hasHostedPaidBillingRefEvidence(billingRef);
}

interface HostedAiUsageAllowanceThreadContainerRef {
  monthlyUsageLimitUsdMicros: bigint;
  owner: HostedMemberPersonAccessState;
}

async function hasHostedAiUsageThreadContainerAccess(input: {
  container: { suspendedAt: Date | null };
  containerMemberId: string;
  now: Date;
  threadContainer: HostedAiUsageAllowanceThreadContainerRef | null;
  tx: Prisma.TransactionClient;
}): Promise<boolean | null> {
  if (!input.threadContainer) {
    return null;
  }

  return await readActiveHostedMemberAccess({
    memberId: input.containerMemberId,
    now: input.now,
    prisma: input.tx,
  });
}

const HOSTED_AI_USAGE_ALLOWANCE_PRICING_VERSION = "openai-api-pricing-2026-05-05-standard";
const HOSTED_AI_USAGE_ALLOWANCE_GPT_56_PRICING_VERSION =
  "openai-api-pricing-2026-08-21-gpt-5.6-standard";
const HOSTED_AI_USAGE_ALLOWANCE_GPT_56_OPENAI_FLEX_PRICING_VERSION =
  "openai-api-pricing-2026-08-21-gpt-5.6-openai-flex";
const HOSTED_AI_USAGE_ALLOWANCE_GPT_56_VENICE_PRICING_VERSION =
  "venice-api-pricing-2026-08-04-gpt-5.6-standard";
const HOSTED_AI_USAGE_ALLOWANCE_PRICING_SOURCE =
  "https://openai.com/api/pricing/";
const HOSTED_AI_USAGE_ALLOWANCE_GPT_56_PRICING_SOURCE =
  "https://developers.openai.com/api/docs/pricing";
const HOSTED_AI_USAGE_ALLOWANCE_GPT_56_VENICE_PRICING_SOURCE =
  "https://docs.venice.ai/overview/pricing";
const HOSTED_AI_USAGE_RECOVERY_URL =
  "https://withmurph.ai/settings?usageRecovery=true#subscription";
const TOKENS_PER_PRICING_UNIT = 1_000_000n;

// GPT Image API pricing has separate text/image token buckets and is not part
// of HOSTED_AI_USAGE_ALLOWANCE_PRICED_MODELS, which validates the assistant
// chat model in deploy preflight.
const HOSTED_AI_USAGE_ALLOWANCE_OPENAI_IMAGE_PRICING_VERSION =
  "openai-image-api-pricing-2026-07-08-standard";
const HOSTED_AI_USAGE_ALLOWANCE_OPENAI_IMAGE_MALFORMED_PRICING_VERSION =
  "openai-image-api-malformed-usage-block-2026-07-08";
const HOSTED_AI_USAGE_ALLOWANCE_OPENAI_IMAGE_PRICING_SOURCE =
  "https://developers.openai.com/api/docs/pricing";
const HOSTED_AI_USAGE_ALLOWANCE_OPENAI_IMAGE_TEXT_INPUT_USD_MICROS_PER_MILLION_TOKENS =
  5_000_000n;
const HOSTED_AI_USAGE_ALLOWANCE_OPENAI_IMAGE_CACHED_TEXT_INPUT_USD_MICROS_PER_MILLION_TOKENS =
  1_250_000n;
const HOSTED_AI_USAGE_ALLOWANCE_OPENAI_IMAGE_INPUT_USD_MICROS_PER_MILLION_TOKENS =
  8_000_000n;
const HOSTED_AI_USAGE_ALLOWANCE_OPENAI_IMAGE_CACHED_INPUT_USD_MICROS_PER_MILLION_TOKENS =
  2_000_000n;
const HOSTED_AI_USAGE_ALLOWANCE_OPENAI_IMAGE_OUTPUT_USD_MICROS_PER_MILLION_TOKENS =
  30_000_000n;

// Workers AI audio transcription is duration-priced rather than token-priced.
// Rate: $0.00051 per audio minute, from
// https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/
// The model id stays out of HOSTED_AI_USAGE_ALLOWANCE_PRICED_MODELS because
// that list also validates HOSTED_ASSISTANT_MODEL in deploy preflight.
const HOSTED_AI_USAGE_ALLOWANCE_AUDIO_MODEL = "@cf/openai/whisper-large-v3-turbo";
const HOSTED_AI_USAGE_ALLOWANCE_AUDIO_PRICING_VERSION =
  "workers-ai-audio-pricing-2026-06-12";
const HOSTED_AI_USAGE_ALLOWANCE_AUDIO_PRICING_SOURCE =
  "https://developers.cloudflare.com/workers-ai/platform/pricing/";
const HOSTED_AI_USAGE_ALLOWANCE_AUDIO_USD_MICROS_PER_MINUTE = 510n;
const MS_PER_PRICING_MINUTE = 60_000n;

// ElevenLabs TTS is character-priced rather than token-priced.
// Rates are the public ElevenAPI pay-as-you-go rates for Text to Speech:
// Flash/Turbo: $0.05 per 1K characters; Multilingual v2/v3: $0.10 per 1K.
const HOSTED_AI_USAGE_ALLOWANCE_ELEVENLABS_TTS_PRICING_VERSION =
  "elevenlabs-tts-pricing-2026-06-18";
const HOSTED_AI_USAGE_ALLOWANCE_ELEVENLABS_TTS_PRICING_SOURCE =
  "https://elevenlabs.io/pricing/api";
const CHARACTERS_PER_TTS_PRICING_UNIT = 1_000n;
const HOSTED_AI_USAGE_ALLOWANCE_ELEVENLABS_TTS_MODEL_PRICES = {
  eleven_flash_v2: 50_000n,
  eleven_flash_v2_5: 50_000n,
  eleven_multilingual_v2: 100_000n,
  eleven_turbo_v2: 50_000n,
  eleven_turbo_v2_5: 50_000n,
  eleven_v3: 100_000n,
} as const satisfies Record<HostedAiUsageAllowanceElevenLabsTtsPricedModel, bigint>;

// ElevenLabs Music is priced by generated duration.
const HOSTED_AI_USAGE_ALLOWANCE_ELEVENLABS_MUSIC_PRICING_VERSION =
  "elevenlabs-music-pricing-2026-06-24";
const HOSTED_AI_USAGE_ALLOWANCE_ELEVENLABS_MUSIC_PRICING_SOURCE =
  "https://elevenlabs.io/pricing/api";
const HOSTED_AI_USAGE_ALLOWANCE_ELEVENLABS_MUSIC_USD_MICROS_PER_MINUTE = 150_000n;

// xAI x_search is priced from the provider-reported exact cost carried on the
// record: usage.cost_in_usd_ticks covers tokens plus server-side tool
// invocations for the whole request, post-discount. 1 USD = 10^10 ticks, so
// 1 USD micro = 10^4 ticks; convert with a ceiling so aggregate metering never
// undercounts. A record missing a valid tick count deliberately falls through
// to token-model pricing, which fails closed on the unpriced model instead of
// accounting the call as free.
const HOSTED_AI_USAGE_ALLOWANCE_XAI_SEARCH_PRICING_VERSION =
  "xai-x-search-pricing-2026-07-23";
const HOSTED_AI_USAGE_ALLOWANCE_XAI_SEARCH_PRICING_SOURCE =
  "https://docs.x.ai/developers/pricing";
const HOSTED_AI_USAGE_ALLOWANCE_XAI_SEARCH_COST_KEY = "cost_in_usd_ticks";
const HOSTED_AI_USAGE_ALLOWANCE_XAI_SEARCH_RAW_USAGE_KEYS: ReadonlySet<string> =
  new Set([
    "cached_input_tokens",
    HOSTED_AI_USAGE_ALLOWANCE_XAI_SEARCH_COST_KEY,
    "input_tokens",
    "input_tokens_details",
    "output_tokens",
    "output_tokens_details",
    "reasoning_tokens",
  ]);
const HOSTED_AI_USAGE_ALLOWANCE_XAI_USD_TICKS_PER_USD_MICRO = 10_000n;

// Gemini 3.7 Flash video analysis is token-priced independently from Murph's
// primary assistant-model catalog. Google publishes one introductory rate
// through 2026-12-31 and a higher rate beginning 2027-01-01. Output pricing
// includes thinking tokens, so candidates and thoughts share one output bucket.
const HOSTED_AI_USAGE_ALLOWANCE_GEMINI_VIDEO_PRICING_SOURCE =
  "https://ai.google.dev/gemini-api/docs/pricing";
const HOSTED_AI_USAGE_ALLOWANCE_GEMINI_VIDEO_2026_PRICING_VERSION =
  "gemini-3.7-flash-video-pricing-through-2026-12-31";
const HOSTED_AI_USAGE_ALLOWANCE_GEMINI_VIDEO_2027_PRICING_VERSION =
  "gemini-3.7-flash-video-pricing-from-2027-01-01";
const HOSTED_AI_USAGE_ALLOWANCE_GEMINI_VIDEO_2027_START_MS =
  Date.parse("2027-01-01T00:00:00.000Z");
const HOSTED_AI_USAGE_ALLOWANCE_GEMINI_VIDEO_2026_INPUT_USD_MICROS_PER_MILLION_TOKENS =
  750_000n;
const HOSTED_AI_USAGE_ALLOWANCE_GEMINI_VIDEO_2026_CACHED_INPUT_USD_MICROS_PER_MILLION_TOKENS =
  75_000n;
const HOSTED_AI_USAGE_ALLOWANCE_GEMINI_VIDEO_2026_OUTPUT_USD_MICROS_PER_MILLION_TOKENS =
  3_750_000n;
const HOSTED_AI_USAGE_ALLOWANCE_GEMINI_VIDEO_2027_INPUT_USD_MICROS_PER_MILLION_TOKENS =
  1_500_000n;
const HOSTED_AI_USAGE_ALLOWANCE_GEMINI_VIDEO_2027_CACHED_INPUT_USD_MICROS_PER_MILLION_TOKENS =
  150_000n;
const HOSTED_AI_USAGE_ALLOWANCE_GEMINI_VIDEO_2027_OUTPUT_USD_MICROS_PER_MILLION_TOKENS =
  7_500_000n;
const HOSTED_AI_USAGE_ALLOWANCE_GEMINI_VIDEO_RAW_USAGE_KEYS: ReadonlySet<string> =
  new Set([
    "cachedContentTokenCount",
    "candidatesTokenCount",
    "promptTokenCount",
    "thoughtsTokenCount",
    "totalTokenCount",
  ]);

const HOSTED_AI_USAGE_ALLOWANCE_GPT_56_SOL_MODEL_PRICE = {
  cachedInputUsdMicrosPerMillionTokens: 400_000n,
  cacheWriteUsdMicrosPerMillionTokens: 5_000_000n,
  inputUsdMicrosPerMillionTokens: 4_000_000n,
  outputUsdMicrosPerMillionTokens: 20_000_000n,
} as const;

const HOSTED_AI_USAGE_ALLOWANCE_GPT_56_TERRA_MODEL_PRICE = {
  cachedInputUsdMicrosPerMillionTokens: 200_000n,
  cacheWriteUsdMicrosPerMillionTokens: 2_500_000n,
  inputUsdMicrosPerMillionTokens: 2_000_000n,
  outputUsdMicrosPerMillionTokens: 12_000_000n,
} as const;

const HOSTED_AI_USAGE_ALLOWANCE_GPT_56_LUNA_MODEL_PRICE = {
  cachedInputUsdMicrosPerMillionTokens: 20_000n,
  cacheWriteUsdMicrosPerMillionTokens: 250_000n,
  inputUsdMicrosPerMillionTokens: 200_000n,
  outputUsdMicrosPerMillionTokens: 1_200_000n,
} as const;

const HOSTED_AI_USAGE_ALLOWANCE_OPENAI_MODEL_PRICES: Record<
  HostedAiUsageAllowancePricedModel,
  HostedAiUsageAllowanceModelPrice
> = {
  "gpt-5.6-sol": HOSTED_AI_USAGE_ALLOWANCE_GPT_56_SOL_MODEL_PRICE,
  "gpt-5.6-terra": HOSTED_AI_USAGE_ALLOWANCE_GPT_56_TERRA_MODEL_PRICE,
  "gpt-5.6-luna": HOSTED_AI_USAGE_ALLOWANCE_GPT_56_LUNA_MODEL_PRICE,
};

const HOSTED_AI_USAGE_ALLOWANCE_VENICE_MODEL_PRICES: Record<
  HostedAiUsageAllowancePricedModel,
  HostedAiUsageAllowanceModelPrice
> = {
  "gpt-5.6-sol": {
    cachedInputUsdMicrosPerMillionTokens: 630_000n,
    cacheWriteUsdMicrosPerMillionTokens: 7_810_000n,
    inputUsdMicrosPerMillionTokens: 6_250_000n,
    outputUsdMicrosPerMillionTokens: 37_500_000n,
  },
  "gpt-5.6-terra": {
    cachedInputUsdMicrosPerMillionTokens: 310_000n,
    cacheWriteUsdMicrosPerMillionTokens: 3_910_000n,
    inputUsdMicrosPerMillionTokens: 3_130_000n,
    outputUsdMicrosPerMillionTokens: 18_750_000n,
  },
  "gpt-5.6-luna": {
    cachedInputUsdMicrosPerMillionTokens: 130_000n,
    cacheWriteUsdMicrosPerMillionTokens: 1_560_000n,
    inputUsdMicrosPerMillionTokens: 1_250_000n,
    outputUsdMicrosPerMillionTokens: 7_500_000n,
  },
};

const HOSTED_AI_USAGE_ALLOWANCE_GPT_56_VENICE_TOKEN_PRICING_BASIS = {
  multiplierDenominator: 1n,
  multiplierNumerator: 1n,
  pricingSource: HOSTED_AI_USAGE_ALLOWANCE_GPT_56_VENICE_PRICING_SOURCE,
  pricingVersion: HOSTED_AI_USAGE_ALLOWANCE_GPT_56_VENICE_PRICING_VERSION,
  requiredProviderKind: "venice",
} as const satisfies HostedAiUsageAllowanceTokenPricingBasisConfig;

const HOSTED_AI_USAGE_ALLOWANCE_GPT_56_TOKEN_PRICING_BASES = {
  "openai-flex": {
    multiplierDenominator: 2n,
    multiplierNumerator: 1n,
    pricingSource: HOSTED_AI_USAGE_ALLOWANCE_GPT_56_PRICING_SOURCE,
    pricingVersion: HOSTED_AI_USAGE_ALLOWANCE_GPT_56_OPENAI_FLEX_PRICING_VERSION,
    requiredProviderKind: "openai",
  },
  standard: {
    multiplierDenominator: 1n,
    multiplierNumerator: 1n,
    pricingSource: HOSTED_AI_USAGE_ALLOWANCE_GPT_56_PRICING_SOURCE,
    pricingVersion: HOSTED_AI_USAGE_ALLOWANCE_GPT_56_PRICING_VERSION,
    requiredProviderKind: null,
  },
} as const;

const HOSTED_AI_USAGE_ALLOWANCE_MODEL_TOKEN_PRICING_BASES = {
  "gpt-5.6-sol": HOSTED_AI_USAGE_ALLOWANCE_GPT_56_TOKEN_PRICING_BASES,
  "gpt-5.6-terra": HOSTED_AI_USAGE_ALLOWANCE_GPT_56_TOKEN_PRICING_BASES,
  "gpt-5.6-luna": HOSTED_AI_USAGE_ALLOWANCE_GPT_56_TOKEN_PRICING_BASES,
} as const satisfies HostedAiUsageAllowanceTokenPricingBasesByModel;

export function priceHostedAiUsageForAllowance(
  record: AssistantUsageRecord,
): HostedAiUsageAllowancePricingResult {
  const decision = resolveHostedAiUsageAllowancePricingDecision(record);
  if (decision.kind === "unpriceable_openai_image") {
    throw new TypeError(
      "OpenAI image hosted AI usage requires period-aware allowance accounting.",
    );
  }

  return decision.priced;
}

function resolveHostedAiUsageAllowancePricingDecision(
  record: AssistantUsageRecord,
): HostedAiUsageAllowancePricingDecision {
  const credentialSource = normalizeAssistantUsageCredentialSource(record.credentialSource);
  const counted = credentialSource !== "member";
  const tokenPricingBasis =
    normalizeAssistantUsageTokenPricingBasis(record.tokenPricingBasis);

  const lobPhysicalNote = matchHostedLobPhysicalNoteUsageRecord(record);
  if (lobPhysicalNote !== null) {
    assertHostedAiUsageLobPhysicalNoteTokenPricingBasis(tokenPricingBasis);
    return {
      kind: "priced",
      priced: {
        costUsdMicros: counted ? lobPhysicalNote.providerCostUsdMicros : 0n,
        counted,
        pricingSnapshot: {
          credentialSource,
          providerCost: {
            providerCostUsdMicros:
              lobPhysicalNote.providerCostUsdMicros.toString(),
            providerPricingVersion:
              lobPhysicalNote.providerPricingVersion,
          },
          pricingSource: HOSTED_LOB_USAGE_PRICING_SOURCE,
          schema: "murph.hosted-ai-usage-allowance-pricing.v1",
          tokenPricingBasis,
        },
        pricingVersion: HOSTED_LOB_USAGE_PRICING_VERSION,
      },
    };
  }

  const retellMatch = matchHostedAiUsageRetellPhoneCallRecord(record);
  if (retellMatch !== null) {
    assertHostedAiUsageRetellTokenPricingBasis(tokenPricingBasis);
    return {
      kind: "priced",
      priced: {
        costUsdMicros: counted ? retellMatch.combinedCostUsdMicros : 0n,
        counted,
        pricingSnapshot: {
          credentialSource,
          providerCost: {
            combinedCostUsdMicros: retellMatch.combinedCostUsdMicros.toString(),
          },
          pricingSource: HOSTED_RETELL_USAGE_PRICING_SOURCE,
          schema: "murph.hosted-ai-usage-allowance-pricing.v1",
          tokenPricingBasis,
        },
        pricingVersion: HOSTED_RETELL_USAGE_PRICING_VERSION,
      },
    };
  }

  const xaiSearchMatch = matchHostedAiUsageXaiSearchRecord(record);
  if (xaiSearchMatch !== null) {
    assertHostedAiUsageXaiSearchTokenPricingBasis(tokenPricingBasis);
    const costUsdMicros = divideXaiUsdTicksToMicrosCeil(xaiSearchMatch.costInUsdTicks);
    return {
      kind: "priced",
      priced: {
        costUsdMicros: counted ? costUsdMicros : 0n,
        counted,
        pricingSnapshot: {
          credentialSource,
          providerCost: {
            costInUsdTicks: xaiSearchMatch.costInUsdTicks.toString(),
            usdTicksPerUsdMicro:
              HOSTED_AI_USAGE_ALLOWANCE_XAI_USD_TICKS_PER_USD_MICRO.toString(),
          },
          pricingSource: HOSTED_AI_USAGE_ALLOWANCE_XAI_SEARCH_PRICING_SOURCE,
          schema: "murph.hosted-ai-usage-allowance-pricing.v1",
          tokenPricingBasis,
        },
        pricingVersion: HOSTED_AI_USAGE_ALLOWANCE_XAI_SEARCH_PRICING_VERSION,
      },
    };
  }

  const geminiVideoMatch = matchHostedAiUsageGeminiVideoAnalysisRecord(record);
  if (geminiVideoMatch !== null) {
    assertHostedAiUsageGeminiVideoTokenPricingBasis(tokenPricingBasis);
    return {
      kind: "priced",
      priced: priceHostedAiUsageGeminiVideoForAllowance({
        counted,
        credentialSource,
        match: geminiVideoMatch,
        record,
      }),
    };
  }

  if (isHostedAiUsageAllowanceAudioModelRecord(record)) {
    assertHostedAiUsageAllowanceAudioTokenPricingBasis(tokenPricingBasis);
    return {
      kind: "priced",
      priced: priceHostedAiUsageAudioForAllowance({
        counted,
        credentialSource,
        record,
      }),
    };
  }

  const imageMatch = matchHostedAiUsageOpenAiImageRecord(record);
  if (imageMatch !== null) {
    assertHostedAiUsageAllowanceOpenAiImageTokenPricingBasis(tokenPricingBasis);
    if (imageMatch.kind === "unpriceable") {
      return {
        counted,
        credentialSource,
        kind: "unpriceable_openai_image",
        modelResolution: imageMatch.modelResolution,
        reason: imageMatch.reason,
        tokenPricingBasis,
      };
    }

    return {
      kind: "priced",
      priced: priceHostedAiUsageOpenAiImageForAllowance({
        counted,
        credentialSource,
        match: imageMatch,
        record,
      }),
    };
  }

  const ttsMatch = matchHostedAiUsageElevenLabsTtsRecord(record);
  if (ttsMatch !== null) {
    assertHostedAiUsageAllowanceElevenLabsTokenPricingBasis(tokenPricingBasis, "TTS");
    return {
      kind: "priced",
      priced: priceHostedAiUsageElevenLabsTtsForAllowance({
        counted,
        credentialSource,
        match: ttsMatch,
        record,
      }),
    };
  }

  const musicMatch = matchHostedAiUsageElevenLabsMusicRecord(record);
  if (musicMatch !== null) {
    assertHostedAiUsageAllowanceElevenLabsTokenPricingBasis(tokenPricingBasis, "Music");
    return {
      kind: "priced",
      priced: priceHostedAiUsageElevenLabsMusicForAllowance({
        counted,
        credentialSource,
        match: musicMatch,
        record,
      }),
    };
  }

  const modelResolution = resolveHostedAiUsageAllowancePricingModel(record);
  const tokenSnapshot = buildHostedAiUsageAllowanceTokenSnapshot(record);
  const tokenPricing = modelResolution.model || tokenPricingBasis !== "standard"
    ? resolveHostedAiUsageAllowanceTokenPricingBasis({
        model: modelResolution.model,
        record,
      })
    : null;

  if (!counted) {
    return {
      kind: "priced",
      priced: {
        costUsdMicros: 0n,
        counted: false,
        pricingSnapshot: {
          credentialSource,
          ...buildHostedAiUsageAllowanceModelSnapshot(modelResolution, record),
          pricingSource: tokenPricing?.pricingSource ?? HOSTED_AI_USAGE_ALLOWANCE_PRICING_SOURCE,
          schema: "murph.hosted-ai-usage-allowance-pricing.v1",
          tokenPricingBasis,
          tokens: tokenSnapshot,
        },
        pricingVersion:
          tokenPricing?.pricingVersion ?? HOSTED_AI_USAGE_ALLOWANCE_PRICING_VERSION,
      },
    };
  }

  const model = modelResolution.model;
  if (!model) {
    throw new TypeError("Hosted AI usage allowance pricing is missing for the model.");
  }

  const prices = resolveHostedAiUsageAllowanceModelPrices({ model, record });
  const resolvedTokenPricing = tokenPricing
    ?? resolveHostedAiUsageAllowanceTokenPricingBasis({ model, record });
  const cachedInputTokens = normalizeTokenCount(record.cachedInputTokens);
  const cacheWriteTokens = normalizeTokenCount(record.cacheWriteTokens);
  const cacheWriteUsdMicrosPerMillionTokens =
    prices.cacheWriteUsdMicrosPerMillionTokens ?? 0n;
  const inputTokens = normalizeTokenCount(record.inputTokens);
  const outputTokens = normalizeTokenCount(record.outputTokens);
  const inputTokenSubsetTokens = cachedInputTokens + (
    cacheWriteUsdMicrosPerMillionTokens > 0n ? cacheWriteTokens : 0n
  );
  const billableInputTokens = inputTokens > inputTokenSubsetTokens
    ? inputTokens - inputTokenSubsetTokens
    : 0n;
  const standardCostUsdMicros =
    priceTokenBucketUsdMicros(
      billableInputTokens,
      prices.inputUsdMicrosPerMillionTokens,
    )
    + priceTokenBucketUsdMicros(
      cachedInputTokens,
      prices.cachedInputUsdMicrosPerMillionTokens,
    )
    + priceTokenBucketUsdMicros(
      cacheWriteTokens,
      cacheWriteUsdMicrosPerMillionTokens,
    )
    + priceTokenBucketUsdMicros(
      outputTokens,
      prices.outputUsdMicrosPerMillionTokens,
    );
  const costUsdMicros = applyTokenPricingAdjustmentUsdMicros(
    standardCostUsdMicros,
    resolvedTokenPricing,
  );

  return {
    kind: "priced",
    priced: {
      costUsdMicros,
      counted: true,
      pricingSnapshot: {
        credentialSource,
        ...buildHostedAiUsageAllowanceModelSnapshot(modelResolution, record),
        pricingSource: resolvedTokenPricing.pricingSource,
        ratesUsdMicrosPerMillionTokens: {
          cachedInput: prices.cachedInputUsdMicrosPerMillionTokens.toString(),
          ...(cacheWriteUsdMicrosPerMillionTokens > 0n
            ? { cacheWrite: cacheWriteUsdMicrosPerMillionTokens.toString() }
            : {}),
          input: prices.inputUsdMicrosPerMillionTokens.toString(),
          output: prices.outputUsdMicrosPerMillionTokens.toString(),
        },
        schema: "murph.hosted-ai-usage-allowance-pricing.v1",
        standardCostUsdMicros: standardCostUsdMicros.toString(),
        tokenPricingAdjustment: {
          denominator: resolvedTokenPricing.multiplierDenominator.toString(),
          numerator: resolvedTokenPricing.multiplierNumerator.toString(),
        },
        tokenPricingBasis: resolvedTokenPricing.basis,
        tokens: {
          ...tokenSnapshot,
          billableInput: billableInputTokens.toString(),
        },
      },
      pricingVersion: resolvedTokenPricing.pricingVersion,
    },
  };
}

function validateHostedAiUsageAllowanceDeniedTokenPricingBasis(
  record: AssistantUsageRecord,
): AssistantUsageTokenPricingBasis {
  const tokenPricingBasis =
    normalizeAssistantUsageTokenPricingBasis(record.tokenPricingBasis);

  if (matchHostedLobPhysicalNoteUsageRecord(record) !== null) {
    assertHostedAiUsageLobPhysicalNoteTokenPricingBasis(tokenPricingBasis);
    return tokenPricingBasis;
  }

  if (matchHostedAiUsageRetellPhoneCallRecord(record) !== null) {
    assertHostedAiUsageRetellTokenPricingBasis(tokenPricingBasis);
    return tokenPricingBasis;
  }

  if (matchHostedAiUsageXaiSearchRecord(record) !== null) {
    assertHostedAiUsageXaiSearchTokenPricingBasis(tokenPricingBasis);
    return tokenPricingBasis;
  }

  if (matchHostedAiUsageGeminiVideoAnalysisRecord(record) !== null) {
    assertHostedAiUsageGeminiVideoTokenPricingBasis(tokenPricingBasis);
    return tokenPricingBasis;
  }

  if (isHostedAiUsageAllowanceAudioModelRecord(record)) {
    assertHostedAiUsageAllowanceAudioTokenPricingBasis(tokenPricingBasis);
    return tokenPricingBasis;
  }

  if (isHostedAiUsageAllowanceOpenAiImageRecord(record)) {
    assertHostedAiUsageAllowanceOpenAiImageTokenPricingBasis(tokenPricingBasis);
    return tokenPricingBasis;
  }

  if (tokenPricingBasis === "standard") {
    return tokenPricingBasis;
  }

  if (matchHostedAiUsageElevenLabsTtsRecord(record) !== null) {
    assertHostedAiUsageAllowanceElevenLabsTokenPricingBasis(tokenPricingBasis, "TTS");
    return tokenPricingBasis;
  }

  if (matchHostedAiUsageElevenLabsMusicRecord(record) !== null) {
    assertHostedAiUsageAllowanceElevenLabsTokenPricingBasis(tokenPricingBasis, "Music");
    return tokenPricingBasis;
  }

  resolveHostedAiUsageAllowanceTokenPricingBasis({
    model: resolveHostedAiUsageAllowancePricingModel(record).model,
    record,
  });

  return tokenPricingBasis;
}

export async function accountHostedAiUsageForAllowanceTx(input: {
  memberId: string;
  now?: Date;
  record: AssistantUsageRecord;
  tx: Prisma.TransactionClient;
}): Promise<HostedAiUsageLimitNoticeCandidate | null> {
  const now = input.now ?? new Date();
  const at = normalizeHostedAiUsageAllowanceDate(input.record.occurredAt);
  await lockHostedAiUsageAllowanceBeneficiaryTx({
    memberId: input.memberId,
    tx: input.tx,
  });
  const memberState = await input.tx.hostedMember.findUnique({
    where: {
      id: input.memberId,
    },
    select: {
      billingRef: {
        select: {
          currentBillingPhase: true,
          currentBillingPlanCode: true,
          currentCheckoutOffer: true,
          currentPeriodEnd: true,
          currentPeriodStart: true,
          stripeSubscriptionLookupKey: true,
          usagePlanTransitionAt: true,
          usagePlanTransitionFromCode: true,
          usagePlanTransitionKind: true,
          usagePlanTransitionToCode: true,
        },
      },
      threadContainer: {
        select: {
          monthlyUsageLimitUsdMicros: true,
          owner: {
            select: hostedMemberPersonAccessSelect,
          },
        },
      },
      billingStatus: true,
      suspendedAt: true,
      usageCreditBalanceUsdMicros: true,
      usageCreditLedgerVersion: true,
    },
  });
  if (!memberState) {
    throw new TypeError("Hosted AI usage allowance member does not exist.");
  }
  const usageCreditProjection = normalizeHostedAiUsageCreditProjection(memberState);
  const allowanceAccess = memberState.suspendedAt === null
    ? await resolveHostedAiUsageAllowanceBillingRefForMember({
        billingRef: memberState.billingRef,
        billingStatus: memberState.billingStatus,
        memberId: input.memberId,
        tx: input.tx,
      })
    : {
        billingRef: memberState.billingRef,
        familyAccessActive: false,
      };
  const threadContainerAccessActive = await hasHostedAiUsageThreadContainerAccess({
    container: memberState,
    containerMemberId: input.memberId,
    now,
    threadContainer: memberState.threadContainer,
    tx: input.tx,
  });
  const period = await ensureHostedAiUsageAllowancePeriodTx({
    at,
    billingRef: allowanceAccess.billingRef,
    memberId: input.memberId,
    now,
    threadContainer: memberState.threadContainer,
    threadContainerAccessActive,
    tx: input.tx,
    ...usageCreditProjection,
  });
  if (period.kind === "denied") {
    await markHostedAiUsageAllowanceDeniedTx({
      memberId: input.memberId,
      now,
      period,
      record: input.record,
      tx: input.tx,
    });
    return null;
  }

  const pricingDecision = resolveHostedAiUsageAllowancePricingDecision(input.record);
  if (
    period.planResetAt
    && at.getTime() < period.planResetAt.getTime()
  ) {
    await markHostedAiUsageForgivenByPlanResetTx({
      decision: pricingDecision,
      now,
      period,
      record: input.record,
      tx: input.tx,
    });
    return null;
  }
  if (pricingDecision.kind === "unpriceable_openai_image") {
    return accountHostedAiUsageOpenAiImageMalformedForAllowanceTx({
      decision: pricingDecision,
      memberId: input.memberId,
      now,
      period,
      record: input.record,
      tx: input.tx,
    });
  }
  const priced = pricingDecision.priced;

  const accounted = await input.tx.hostedAiUsage.updateMany({
    where: {
      allowanceAccountedAt: null,
      id: input.record.usageId,
    },
    data: {
      allowanceAccountedAt: now,
      allowanceCostUsdMicros: priced.costUsdMicros,
      allowanceCounted: priced.counted,
      allowancePeriodEnd: period.periodEnd,
      allowancePeriodStart: period.periodStart,
      allowancePricingSnapshotJson: priced.pricingSnapshot,
      allowancePricingVersion: priced.pricingVersion,
    },
  });

  if (accounted.count !== 1 || !priced.counted) {
    return null;
  }

  return accountHostedAiUsageAllowancePeriodSpendTx({
    costUsdMicros: priced.costUsdMicros,
    memberId: input.memberId,
    now,
    period,
    recordOccurredAt: normalizeHostedAiUsageAllowanceDate(input.record.occurredAt),
    sourceUsageId: input.record.usageId,
    tx: input.tx,
  });
}

async function markHostedAiUsageForgivenByPlanResetTx(input: {
  decision: HostedAiUsageAllowancePricingDecision;
  now: Date;
  period: Extract<HostedAiUsageAllowancePeriodResult, { kind: "period" }>;
  record: AssistantUsageRecord;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const priced = input.decision.kind === "priced"
    ? input.decision.priced
    : {
        costUsdMicros: 0n,
        counted: false,
        pricingSnapshot: {
          credentialSource: input.decision.credentialSource,
          model: input.decision.modelResolution.model,
          modelSource: input.decision.modelResolution.source,
          pricingSource: HOSTED_AI_USAGE_ALLOWANCE_OPENAI_IMAGE_PRICING_SOURCE,
          reason: input.decision.reason,
          requestedModel: input.record.requestedModel ?? null,
          schema: "murph.hosted-ai-usage-allowance-malformed.v1",
          servedModel: input.record.servedModel ?? null,
          tokenPricingBasis: input.decision.tokenPricingBasis,
          tokens: buildHostedAiUsageAllowanceTokenSnapshot(input.record),
          usageExtractionSourcePath: input.record.usageExtractionSourcePath,
        },
        pricingVersion:
          HOSTED_AI_USAGE_ALLOWANCE_OPENAI_IMAGE_MALFORMED_PRICING_VERSION,
      } satisfies HostedAiUsageAllowancePricingResult;

  await input.tx.hostedAiUsage.updateMany({
    where: {
      allowanceAccountedAt: null,
      id: input.record.usageId,
    },
    data: {
      allowanceAccountedAt: input.now,
      allowanceCostUsdMicros: priced.costUsdMicros,
      allowanceCounted: false,
      allowancePeriodEnd: input.period.periodEnd,
      allowancePeriodStart: input.period.periodStart,
      allowancePricingSnapshotJson: {
        ...priced.pricingSnapshot,
        allowanceDisposition: "forgiven_plan_reset",
        planResetAt: input.period.planResetAt?.toISOString() ?? null,
      },
      allowancePricingVersion: priced.pricingVersion,
    },
  });
}

async function accountHostedAiUsageOpenAiImageMalformedForAllowanceTx(input: {
  decision: Extract<
    HostedAiUsageAllowancePricingDecision,
    { kind: "unpriceable_openai_image" }
  >;
  memberId: string;
  now: Date;
  period: Extract<HostedAiUsageAllowancePeriodResult, { kind: "period" }>;
  record: AssistantUsageRecord;
  tx: Prisma.TransactionClient;
}): Promise<HostedAiUsageLimitNoticeCandidate | null> {
  const blockCostUsdMicros = input.decision.counted
    ? resolveHostedAiUsageAllowanceRemainingUsdMicros(input.period)
    : 0n;

  const accounted = await input.tx.hostedAiUsage.updateMany({
    where: {
      allowanceAccountedAt: null,
      id: input.record.usageId,
    },
    data: {
      allowanceAccountedAt: input.now,
      allowanceCostUsdMicros: blockCostUsdMicros,
      allowanceCounted: input.decision.counted,
      allowancePeriodEnd: input.period.periodEnd,
      allowancePeriodStart: input.period.periodStart,
      allowancePricingSnapshotJson: {
        blockCostUsdMicros: blockCostUsdMicros.toString(),
        credentialSource: input.decision.credentialSource,
        model: input.decision.modelResolution.model,
        modelSource: input.decision.modelResolution.source,
        pricingSource: HOSTED_AI_USAGE_ALLOWANCE_OPENAI_IMAGE_PRICING_SOURCE,
        reason: input.decision.reason,
        requestedModel: input.record.requestedModel ?? null,
        schema: "murph.hosted-ai-usage-allowance-malformed.v1",
        servedModel: input.record.servedModel ?? null,
        tokenPricingBasis: input.decision.tokenPricingBasis,
        tokens: buildHostedAiUsageAllowanceTokenSnapshot(input.record),
        usageExtractionSourcePath: input.record.usageExtractionSourcePath,
      },
      allowancePricingVersion:
        HOSTED_AI_USAGE_ALLOWANCE_OPENAI_IMAGE_MALFORMED_PRICING_VERSION,
    },
  });

  if (accounted.count !== 1 || !input.decision.counted) {
    return null;
  }

  return accountHostedAiUsageAllowancePeriodSpendTx({
    costUsdMicros: blockCostUsdMicros,
    memberId: input.memberId,
    now: input.now,
    period: input.period,
    recordOccurredAt: normalizeHostedAiUsageAllowanceDate(input.record.occurredAt),
    sourceUsageId: input.record.usageId,
    tx: input.tx,
  });
}

async function markHostedAiUsageAllowanceDeniedTx(input: {
  memberId: string;
  now: Date;
  period: Extract<HostedAiUsageAllowancePeriodResult, { kind: "denied" }>;
  record: AssistantUsageRecord;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const tokenPricingBasis =
    validateHostedAiUsageAllowanceDeniedTokenPricingBasis(input.record);

  await input.tx.hostedAiUsage.updateMany({
    where: {
      allowanceAccountedAt: null,
      id: input.record.usageId,
    },
    data: {
      allowanceAccountedAt: input.now,
      allowanceCostUsdMicros: 0n,
      allowanceCounted: false,
      allowancePeriodEnd: input.period.periodEnd,
      allowancePeriodStart: input.period.periodStart,
      allowancePricingSnapshotJson: {
        credentialSource: normalizeAssistantUsageCredentialSource(input.record.credentialSource),
        reason: input.period.reason,
        requestedModel: input.record.requestedModel ?? null,
        schema: "murph.hosted-ai-usage-allowance-denied.v1",
        servedModel: input.record.servedModel ?? null,
        tokenPricingBasis,
      },
      allowancePricingVersion: "hosted-ai-usage-allowance-denied-2026-05-05",
    },
  });
}

export async function resolveHostedAiUsageGate(input: {
  memberId: string;
  now?: Date | string;
  prisma?: HostedAiUsageAllowanceClient;
}): Promise<HostedAiUsageGateDecisionWithSource> {
  return resolveHostedAiUsageGateWithPolicy({
    ...input,
    preserveExistingLegacyPaidPeriodLimit: true,
  });
}

export async function reconcileHostedAiUsageGateForBillingModeChangeTx(input: {
  memberId: string;
  now: Date;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  await resolveHostedAiUsageGateWithPolicy({
    memberId: input.memberId,
    now: input.now,
    preserveExistingLegacyPaidPeriodLimit: false,
    prisma: input.tx,
  });
}

async function resolveHostedAiUsageGateWithPolicy(input: {
  memberId: string;
  now?: Date | string;
  preserveExistingLegacyPaidPeriodLimit: boolean;
  prisma?: HostedAiUsageAllowanceClient;
}): Promise<HostedAiUsageGateDecisionWithSource> {
  const prisma = input.prisma ?? getPrisma();
  const now = normalizeHostedAiUsageAllowanceDate(input.now ?? new Date());

  return runHostedAiUsageAllowanceTransaction(prisma, async (tx) => {
    await lockHostedAiUsageAllowanceBeneficiaryTx({
      memberId: input.memberId,
      tx,
    });
    const memberState = await tx.hostedMember.findUnique({
      where: {
        id: input.memberId,
      },
      select: {
        billingRef: {
          select: {
            currentBillingPhase: true,
            currentBillingPlanCode: true,
            currentCheckoutOffer: true,
            currentPeriodEnd: true,
            currentPeriodStart: true,
            stripeSubscriptionLookupKey: true,
            usagePlanTransitionAt: true,
            usagePlanTransitionFromCode: true,
            usagePlanTransitionKind: true,
            usagePlanTransitionToCode: true,
          },
        },
        threadContainer: {
          select: {
            monthlyUsageLimitUsdMicros: true,
            owner: {
              select: hostedMemberPersonAccessSelect,
            },
          },
        },
        billingStatus: true,
        suspendedAt: true,
        usageCreditBalanceUsdMicros: true,
        usageCreditLedgerVersion: true,
      },
    });

    if (!memberState) {
      throw new TypeError("Hosted AI usage allowance member does not exist.");
    }
    const usageCreditProjection = normalizeHostedAiUsageCreditProjection(memberState);

    const allowanceAccess = memberState.suspendedAt === null
      ? await resolveHostedAiUsageAllowanceBillingRefForMember({
          billingRef: memberState.billingRef,
          billingStatus: memberState.billingStatus,
          memberId: input.memberId,
          tx,
        })
      : {
          billingRef: memberState.billingRef,
          familyAccessActive: false,
        };
    const allowanceBillingRef = allowanceAccess.billingRef;
    const familyAccessActive = allowanceAccess.familyAccessActive;
    const threadContainerAccessActive = await hasHostedAiUsageThreadContainerAccess({
      container: memberState,
      containerMemberId: input.memberId,
      now,
      threadContainer: memberState.threadContainer,
      tx,
    });

    // Thread-container members are synthetic (`not_started` own billing):
    // their access is decided by the container branch of the allowance-period
    // resolver below. Only non-container members are denied on their own
    // billing here; suspension always fails closed.
    if (
      memberState.suspendedAt !== null ||
      (
        !memberState.threadContainer &&
        memberState.billingStatus !== HostedBillingStatus.active &&
        !familyAccessActive
      )
    ) {
      return resolveHostedAiUsageInactiveGateDecision({
        at: now,
        billingRef: allowanceBillingRef,
        billingStatus: memberState.billingStatus,
        memberId: input.memberId,
        suspendedAt: memberState.suspendedAt,
        threadContainer: memberState.threadContainer,
        threadContainerAccessActive,
        ...usageCreditProjection,
      });
    }

    const period = await ensureHostedAiUsageAllowancePeriodTx({
      at: now,
      billingRef: allowanceBillingRef,
      memberId: input.memberId,
      now,
      preserveExistingLegacyPaidPeriodLimit:
        input.preserveExistingLegacyPaidPeriodLimit,
      threadContainer: memberState.threadContainer,
      threadContainerAccessActive,
      tx,
      ...usageCreditProjection,
    });
    if (period.kind === "denied") {
      return buildHostedAiUsageGateDecision({
        memberId: input.memberId,
        period,
      });
    }

    // Settlement is not the only point at which authorization can change.
    // A sponsor may raise the cap, resume, or cross a lazy calendar rollover
    // while the group is already exhausted, so the mutating gate must give the
    // same deterministic admission owner a chance before returning the denial.
    // This transaction only creates the exact $5 purchase; the existing sweep
    // remains the sole provider-work owner.
    if (period.allowanceSource === "thread_container") {
      await admitHostedGroupSponsorshipRefillTx({
        beneficiaryMemberId: input.memberId,
        capacityState: classifyHostedGroupUsageCapacity({
          limitUsdMicros: period.limitUsdMicros,
          remainingUsdMicros:
            resolveHostedAiUsageAllowanceRemainingUsdMicros(period),
        }),
        now,
        tx,
      });
    }

    return buildHostedAiUsageGateDecision({
      memberId: input.memberId,
      period,
    });
  });
}

export async function readHostedAiUsageGate(input: {
  memberId: string;
  now?: Date | string;
  prisma?: HostedAiUsageAllowanceClient;
}): Promise<HostedAiUsageGateDecisionWithSource> {
  const prisma = input.prisma ?? getPrisma();
  const now = normalizeHostedAiUsageAllowanceDate(input.now ?? new Date());

  return runHostedAiUsageAllowanceTransaction(prisma, async (tx) => {
    const memberState = await tx.hostedMember.findUnique({
      where: {
        id: input.memberId,
      },
      select: {
        billingRef: {
          select: {
            currentBillingPhase: true,
            currentBillingPlanCode: true,
            currentCheckoutOffer: true,
            currentPeriodEnd: true,
            currentPeriodStart: true,
            stripeSubscriptionLookupKey: true,
            usagePlanTransitionAt: true,
            usagePlanTransitionFromCode: true,
            usagePlanTransitionKind: true,
            usagePlanTransitionToCode: true,
          },
        },
        threadContainer: {
          select: {
            monthlyUsageLimitUsdMicros: true,
            owner: {
              select: hostedMemberPersonAccessSelect,
            },
          },
        },
        billingStatus: true,
        suspendedAt: true,
        usageCreditBalanceUsdMicros: true,
        usageCreditLedgerVersion: true,
      },
    });

    if (!memberState) {
      throw new TypeError("Hosted AI usage allowance member does not exist.");
    }
    const usageCreditProjection = normalizeHostedAiUsageCreditProjection(memberState);

    const allowanceAccess = memberState.suspendedAt === null
      ? await resolveHostedAiUsageAllowanceBillingRefForMember({
          billingRef: memberState.billingRef,
          billingStatus: memberState.billingStatus,
          memberId: input.memberId,
          tx,
        })
      : {
          billingRef: memberState.billingRef,
          familyAccessActive: false,
        };
    const allowanceBillingRef = allowanceAccess.billingRef;
    const familyAccessActive = allowanceAccess.familyAccessActive;
    const threadContainerAccessActive = await hasHostedAiUsageThreadContainerAccess({
      container: memberState,
      containerMemberId: input.memberId,
      now,
      threadContainer: memberState.threadContainer,
      tx,
    });

    // Thread-container members are synthetic (`not_started` own billing):
    // their access is decided by the container branch of the allowance-period
    // resolver below. Only non-container members are denied on their own
    // billing here; suspension always fails closed.
    if (
      memberState.suspendedAt !== null ||
      (
        !memberState.threadContainer &&
        memberState.billingStatus !== HostedBillingStatus.active &&
        !familyAccessActive
      )
    ) {
      return resolveHostedAiUsageInactiveGateDecision({
        at: now,
        billingRef: allowanceBillingRef,
        billingStatus: memberState.billingStatus,
        memberId: input.memberId,
        suspendedAt: memberState.suspendedAt,
        threadContainer: memberState.threadContainer,
        threadContainerAccessActive,
        ...usageCreditProjection,
      });
    }

    const period = await readHostedAiUsageAllowancePeriodTx({
      at: now,
      billingRef: allowanceBillingRef,
      memberId: input.memberId,
      threadContainer: memberState.threadContainer,
      threadContainerAccessActive,
      tx,
      ...usageCreditProjection,
    });

    return buildHostedAiUsageGateDecision({
      memberId: input.memberId,
      period,
    });
  });
}

/**
 * Canonical read projection for low-frequency operator/reporting surfaces.
 * Each member decision and its exact period metadata run through the ordinary
 * gate owner in one short transaction. Callers must cap member IDs; this owner
 * processes them sequentially so it never pins multiple pooled connections.
 */
export async function readHostedAiUsageGateSnapshots(input: {
  memberIds: readonly string[];
  now?: Date | string;
  prisma?: PrismaClient;
}): Promise<Map<string, HostedAiUsageGateSnapshot>> {
  const prisma = input.prisma ?? getPrisma();
  const now = normalizeHostedAiUsageAllowanceDate(input.now ?? new Date());
  const memberIds = [...new Set(input.memberIds.map((memberId) => memberId.trim()))]
    .filter(Boolean);
  if (memberIds.length === 0) {
    return new Map<string, HostedAiUsageGateSnapshot>();
  }

  const snapshots = new Map<string, HostedAiUsageGateSnapshot>();
  for (const memberId of memberIds) {
    const snapshot = await prisma.$transaction(
      async (tx) => {
        const decision = await readHostedAiUsageGate({
          memberId,
          now,
          prisma: tx,
        });
        const persisted = decision.allowed
          || decision.reason === "ai_usage_limit_exceeded"
          ? await tx.hostedAiUsagePeriod.findUnique({
              select: { updatedAt: true },
              where: {
                memberId_periodStart: {
                  memberId,
                  periodStart: decision.periodStart,
                },
              },
            })
          : null;
        return {
          decision,
          periodPersistedAt: persisted?.updatedAt ?? null,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    snapshots.set(memberId, snapshot);
  }
  return snapshots;
}

// Read-first gate for hot-path checks: denials are confirmed by the mutating
// gate before callers act on them. The read path cannot lock or materialize
// period rows or apply plan-change limit updates; spend accounting
// ensure-creates the period inside the spend transaction as the backstop.
export async function checkHostedAiUsageGate(input: {
  memberId: string;
  now?: Date | string;
  prisma?: HostedAiUsageAllowanceClient;
}): Promise<HostedAiUsageGateDecisionWithSource> {
  const decision = await readHostedAiUsageGate(input);
  if (decision.allowed) {
    return decision;
  }

  return resolveHostedAiUsageGate(input);
}

function resolveHostedAiUsageInactiveGateDecision(input: {
  at: Date;
  billingRef: HostedAiUsageAllowanceBillingRef | null;
  billingStatus: HostedBillingStatus;
  memberId: string;
  suspendedAt: Date | null;
  threadContainer?: HostedAiUsageAllowanceThreadContainerRef | null;
  threadContainerAccessActive?: boolean | null;
} & HostedAiUsageCreditProjection): HostedAiUsageGateDecisionWithSource {
  const resolved = resolveHostedAiUsageAllowancePeriod({
    at: input.at,
    billingRef: input.billingRef,
    threadContainer: input.threadContainer ?? null,
    threadContainerAccessActive: input.threadContainerAccessActive ?? null,
  });
  const period = resolved.kind === "denied"
    ? resolved
    : {
        allowanceSource: resolved.allowanceSource,
        billingPlanCode: resolved.billingPlanCode,
        limitUsdMicros: resolved.limitUsdMicros,
        periodEnd: resolved.periodEnd,
        periodStart: resolved.periodStart,
      };
  // Inactive access changes only through an external account or billing
  // transition. Lifetime Starter periods use a far-future structural end, so
  // they must not suppress the bounded recovery recheck.
  const retryAfter = new Date(input.at.getTime() + 15 * 60_000);

  return {
    allowed: false,
    allowanceSource: period.allowanceSource,
    billingPlanCode: period.billingPlanCode,
    limitUsdMicros: period.limitUsdMicros,
    memberId: input.memberId,
    periodEnd: period.periodEnd,
    periodStart: period.periodStart,
    planResetAt: null,
    reason: "hosted_access_inactive",
    remainingUsdMicros: period.limitUsdMicros,
    retryAfter,
    spentUsdMicros: 0n,
    usageCreditBalanceUsdMicros: input.usageCreditBalanceUsdMicros,
    usageCreditLedgerVersion: input.usageCreditLedgerVersion,
    userNotice: null,
  };
}

function buildHostedAiUsageGateDecision(input: {
  memberId: string;
  period: HostedAiUsageAllowancePeriodResult;
}): HostedAiUsageGateDecisionWithSource {
  const period = input.period;
  if (period.kind === "denied") {
    return {
      allowed: false,
      allowanceSource: period.allowanceSource,
      billingPlanCode: period.billingPlanCode,
      limitUsdMicros: period.limitUsdMicros,
      memberId: input.memberId,
      periodEnd: period.periodEnd,
      periodStart: period.periodStart,
      planResetAt: null,
      reason: period.reason,
      remainingUsdMicros: 0n,
      retryAfter: period.retryAfter,
      spentUsdMicros: period.spentUsdMicros,
      usageCreditBalanceUsdMicros: period.usageCreditBalanceUsdMicros,
      usageCreditLedgerVersion: period.usageCreditLedgerVersion,
      userNotice: period.userNotice,
    };
  }

  const baseRemainingUsdMicros = period.limitUsdMicros > period.spentUsdMicros
    ? period.limitUsdMicros - period.spentUsdMicros
    : 0n;
  const remainingUsdMicros =
    baseRemainingUsdMicros + period.usageCreditBalanceUsdMicros;

  if (remainingUsdMicros === 0n) {
    return {
      allowed: false,
      allowanceSource: period.allowanceSource,
      billingPlanCode: period.billingPlanCode,
      limitUsdMicros: period.limitUsdMicros,
      memberId: input.memberId,
      periodEnd: period.periodEnd,
      periodStart: period.periodStart,
      planResetAt: period.planResetAt,
      reason: "ai_usage_limit_exceeded",
      remainingUsdMicros,
      retryAfter: period.periodEnd,
      spentUsdMicros: period.spentUsdMicros,
      usageCreditBalanceUsdMicros: period.usageCreditBalanceUsdMicros,
      usageCreditLedgerVersion: period.usageCreditLedgerVersion,
      userNotice: buildHostedAiUsageGateLimitNotice({
        allowanceSource: period.allowanceSource,
        billingPlanCode: period.billingPlanCode,
        memberId: input.memberId,
        periodStart: period.periodStart,
      }),
    };
  }

  return {
    allowed: true,
    allowanceSource: period.allowanceSource,
    billingPlanCode: period.billingPlanCode,
    limitUsdMicros: period.limitUsdMicros,
    memberId: input.memberId,
    periodEnd: period.periodEnd,
    periodStart: period.periodStart,
    planResetAt: period.planResetAt,
    remainingUsdMicros,
    spentUsdMicros: period.spentUsdMicros,
    usageCreditBalanceUsdMicros: period.usageCreditBalanceUsdMicros,
    usageCreditLedgerVersion: period.usageCreditLedgerVersion,
  };
}

export async function reconcileHostedAiUsageAllowancePeriodForMemberTx(input: {
  memberId: string;
  now: Date;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  await lockHostedAiUsageAllowanceBeneficiaryTx({
    memberId: input.memberId,
    tx: input.tx,
  });
  const memberState = await input.tx.hostedMember.findUnique({
    where: {
      id: input.memberId,
    },
    select: {
      billingRef: {
        select: {
          currentBillingPhase: true,
          currentBillingPlanCode: true,
          currentCheckoutOffer: true,
          currentPeriodEnd: true,
          currentPeriodStart: true,
          stripeSubscriptionLookupKey: true,
          usagePlanTransitionAt: true,
          usagePlanTransitionFromCode: true,
          usagePlanTransitionKind: true,
          usagePlanTransitionToCode: true,
        },
      },
      billingStatus: true,
      suspendedAt: true,
      usageCreditBalanceUsdMicros: true,
      usageCreditLedgerVersion: true,
    },
  });
  if (
    !memberState ||
    memberState.billingStatus !== HostedBillingStatus.active ||
    memberState.suspendedAt !== null
  ) {
    throw new Error("Hosted AI usage allowance member is not active.");
  }
  const usageCreditProjection = normalizeHostedAiUsageCreditProjection(memberState);

  const period = await ensureHostedAiUsageAllowancePeriodTx({
    at: input.now,
    billingRef: memberState.billingRef,
    memberId: input.memberId,
    now: input.now,
    tx: input.tx,
    ...usageCreditProjection,
  });
  if (period.kind === "denied") {
    throw new Error("Hosted AI usage allowance period could not be reconciled.");
  }
}

async function ensureHostedAiUsageAllowancePeriodTx(input: {
  at: Date;
  billingRef: HostedAiUsageAllowanceBillingRef | null;
  memberId: string;
  now: Date;
  preserveExistingLegacyPaidPeriodLimit?: boolean;
  threadContainer?: HostedAiUsageAllowanceThreadContainerRef | null;
  threadContainerAccessActive?: boolean | null;
  tx: Prisma.TransactionClient;
} & HostedAiUsageCreditProjection): Promise<HostedAiUsageAllowancePeriodResult> {
  const resolved = resolveHostedAiUsageAllowancePeriod({
    at: input.at,
    billingRef: input.billingRef,
    threadContainer: input.threadContainer ?? null,
    threadContainerAccessActive: input.threadContainerAccessActive ?? null,
  });
  if (resolved.kind === "denied") {
    return {
      allowanceSource: resolved.allowanceSource,
      kind: "denied",
      billingPlanCode: resolved.billingPlanCode,
      limitUsdMicros: resolved.limitUsdMicros,
      periodEnd: resolved.periodEnd,
      periodStart: resolved.periodStart,
      reason: resolved.reason,
      retryAfter: resolved.retryAfter,
      spentUsdMicros: 0n,
      usageCreditBalanceUsdMicros: input.usageCreditBalanceUsdMicros,
      usageCreditLedgerVersion: input.usageCreditLedgerVersion,
      userNotice: resolved.userNotice,
    };
  }

  await input.tx.hostedAiUsagePeriod.createMany({
    data: {
      billingPlanCode: resolved.billingPlanCode,
      highestBillingPlanCode: resolved.billingPlanCode,
      limitUsdMicros: resolved.limitUsdMicros,
      memberId: input.memberId,
      periodEnd: resolved.periodEnd,
      periodStart: resolved.periodStart,
      spentUsdMicros: 0n,
    },
    skipDuplicates: true,
  });
  await lockHostedAiUsageAllowancePeriodTx({
    memberId: input.memberId,
    periodStart: resolved.periodStart,
    tx: input.tx,
  });

  const current = await input.tx.hostedAiUsagePeriod.findUniqueOrThrow({
    where: {
      memberId_periodStart: {
        memberId: input.memberId,
        periodStart: resolved.periodStart,
      },
    },
    select: {
      billingPlanCode: true,
      blockedAt: true,
      highestBillingPlanCode: true,
      lastUsageAt: true,
      limitUsdMicros: true,
      periodEnd: true,
      periodStart: true,
      planResetAt: true,
      spentUsdMicros: true,
    },
  });

  const currentBillingPlanCode = parseHostedBillingPlanCode(current.billingPlanCode)
    ?? resolved.billingPlanCode;
  const storedHighestBillingPlanCode =
    parseHostedBillingPlanCode(current.highestBillingPlanCode);
  const highestBillingPlanCode =
    storedHighestBillingPlanCode ?? currentBillingPlanCode;
  const nextHighestBillingPlanCode =
    resolveHostedAiUsageObservedHighestPlanCode({
      highestBillingPlanCode,
      observedBillingPlanCode: resolved.billingPlanCode,
    });
  const periodIdentityMatches =
    currentBillingPlanCode === resolved.billingPlanCode &&
    current.periodEnd.getTime() === resolved.periodEnd.getTime();
  const periodMatches =
    periodIdentityMatches &&
    (
      current.limitUsdMicros === resolved.limitUsdMicros ||
      (
        input.preserveExistingLegacyPaidPeriodLimit !== false &&
        shouldPreserveExistingPaidPeriodLimit({
          currentLimitUsdMicros: current.limitUsdMicros,
          resolved,
        })
      )
    );
  const planResetAt = resolveHostedAiUsagePlanResetAt({
    billingRef: input.billingRef,
    highestBillingPlanCode,
    planHistoryInitialized: storedHighestBillingPlanCode !== null,
    resolved,
  });
  const resetForPlanUpgrade = planResetAt !== null && !periodMatches;

  if (periodMatches) {
    const blockedAt = resolveHostedAiUsageAllowanceBlockedAt({
      blockedAt: current.blockedAt,
      limitUsdMicros: current.limitUsdMicros,
      now: input.now,
      spentUsdMicros: current.spentUsdMicros,
      usageCreditBalanceUsdMicros: input.usageCreditBalanceUsdMicros,
    });

    if (
      !sameNullableTime(current.blockedAt, blockedAt) ||
      storedHighestBillingPlanCode === null ||
      (
        planResetAt !== null &&
        !sameNullableTime(current.planResetAt, planResetAt)
      )
    ) {
      await input.tx.hostedAiUsagePeriod.update({
        where: {
          memberId_periodStart: {
            memberId: input.memberId,
            periodStart: resolved.periodStart,
          },
        },
        data: {
          blockedAt,
          highestBillingPlanCode: nextHighestBillingPlanCode,
          ...(planResetAt ? { planResetAt } : {}),
          updatedAt: input.now,
        },
      });
    }

    return {
      kind: "period",
      allowanceSource: resolved.allowanceSource,
      billingPlanCode: currentBillingPlanCode,
      highestBillingPlanCode: nextHighestBillingPlanCode,
      limitUsdMicros: current.limitUsdMicros,
      periodEnd: current.periodEnd,
      periodStart: current.periodStart,
      planResetAt: planResetAt ?? current.planResetAt,
      blockedAt,
      spentUsdMicros: current.spentUsdMicros,
      usageCreditBalanceUsdMicros: input.usageCreditBalanceUsdMicros,
      usageCreditLedgerVersion: input.usageCreditLedgerVersion,
    };
  }

  const blockedAt = resetForPlanUpgrade
    ? null
    : resolveHostedAiUsageAllowanceBlockedAt({
        blockedAt: current.blockedAt,
        limitUsdMicros: resolved.limitUsdMicros,
        now: input.now,
        spentUsdMicros: current.spentUsdMicros,
        usageCreditBalanceUsdMicros: input.usageCreditBalanceUsdMicros,
      });
  const upgraded = await input.tx.hostedAiUsagePeriod.update({
    where: {
      memberId_periodStart: {
        memberId: input.memberId,
        periodStart: resolved.periodStart,
      },
    },
    data: {
      billingPlanCode: resolved.billingPlanCode,
      blockedAt,
      highestBillingPlanCode: nextHighestBillingPlanCode,
      limitUsdMicros: resolved.limitUsdMicros,
      periodEnd: resolved.periodEnd,
      ...(resetForPlanUpgrade
        ? {
            planResetAt,
            spentUsdMicros: 0n,
          }
        : {}),
      updatedAt: input.now,
    },
    select: {
      billingPlanCode: true,
      blockedAt: true,
      highestBillingPlanCode: true,
      limitUsdMicros: true,
      periodEnd: true,
      periodStart: true,
      planResetAt: true,
      spentUsdMicros: true,
    },
  });

  return {
    kind: "period",
    allowanceSource: resolved.allowanceSource,
    billingPlanCode: parseHostedBillingPlanCode(upgraded.billingPlanCode)
      ?? resolved.billingPlanCode,
    blockedAt: upgraded.blockedAt,
    highestBillingPlanCode:
      parseHostedBillingPlanCode(upgraded.highestBillingPlanCode)
      ?? resolved.billingPlanCode,
    limitUsdMicros: upgraded.limitUsdMicros,
    periodEnd: upgraded.periodEnd,
    periodStart: upgraded.periodStart,
    planResetAt: upgraded.planResetAt,
    spentUsdMicros: upgraded.spentUsdMicros,
    usageCreditBalanceUsdMicros: input.usageCreditBalanceUsdMicros,
    usageCreditLedgerVersion: input.usageCreditLedgerVersion,
  };
}

async function readHostedAiUsageAllowancePeriodTx(input: {
  at: Date;
  billingRef: HostedAiUsageAllowanceBillingRef | null;
  memberId: string;
  threadContainer?: HostedAiUsageAllowanceThreadContainerRef | null;
  threadContainerAccessActive?: boolean | null;
  tx: Prisma.TransactionClient;
} & HostedAiUsageCreditProjection): Promise<HostedAiUsageAllowancePeriodResult> {
  const resolved = resolveHostedAiUsageAllowancePeriod({
    at: input.at,
    billingRef: input.billingRef,
    threadContainer: input.threadContainer ?? null,
    threadContainerAccessActive: input.threadContainerAccessActive ?? null,
  });
  if (resolved.kind === "denied") {
    return {
      allowanceSource: resolved.allowanceSource,
      kind: "denied",
      billingPlanCode: resolved.billingPlanCode,
      limitUsdMicros: resolved.limitUsdMicros,
      periodEnd: resolved.periodEnd,
      periodStart: resolved.periodStart,
      reason: resolved.reason,
      retryAfter: resolved.retryAfter,
      spentUsdMicros: 0n,
      usageCreditBalanceUsdMicros: input.usageCreditBalanceUsdMicros,
      usageCreditLedgerVersion: input.usageCreditLedgerVersion,
      userNotice: resolved.userNotice,
    };
  }

  const current = await input.tx.hostedAiUsagePeriod.findUnique({
    where: {
      memberId_periodStart: {
        memberId: input.memberId,
        periodStart: resolved.periodStart,
      },
    },
    select: {
      billingPlanCode: true,
      blockedAt: true,
      highestBillingPlanCode: true,
      limitUsdMicros: true,
      periodEnd: true,
      periodStart: true,
      planResetAt: true,
      spentUsdMicros: true,
    },
  });

  if (current) {
    const currentBillingPlanCode = parseHostedBillingPlanCode(current.billingPlanCode)
      ?? resolved.billingPlanCode;
    const storedHighestBillingPlanCode =
      parseHostedBillingPlanCode(current.highestBillingPlanCode);
    const highestBillingPlanCode =
      storedHighestBillingPlanCode ?? currentBillingPlanCode;
    const nextHighestBillingPlanCode =
      resolveHostedAiUsageObservedHighestPlanCode({
        highestBillingPlanCode,
        observedBillingPlanCode: resolved.billingPlanCode,
      });
    const periodIdentityMatches =
      currentBillingPlanCode === resolved.billingPlanCode &&
      current.periodEnd.getTime() === resolved.periodEnd.getTime();
    const periodMatches =
      periodIdentityMatches &&
      (
        current.limitUsdMicros === resolved.limitUsdMicros ||
        shouldPreserveExistingPaidPeriodLimit({
          currentLimitUsdMicros: current.limitUsdMicros,
          resolved,
        })
      );
    const planResetAt = resolveHostedAiUsagePlanResetAt({
      billingRef: input.billingRef,
      highestBillingPlanCode,
      planHistoryInitialized: storedHighestBillingPlanCode !== null,
      resolved,
    });
    const resetForPlanUpgrade = planResetAt !== null && !periodMatches;
    const limitUsdMicros = periodMatches ? current.limitUsdMicros : resolved.limitUsdMicros;

    return {
      kind: "period",
      allowanceSource: resolved.allowanceSource,
      billingPlanCode: periodMatches ? currentBillingPlanCode : resolved.billingPlanCode,
      blockedAt: resetForPlanUpgrade ? null : current.blockedAt,
      highestBillingPlanCode: nextHighestBillingPlanCode,
      limitUsdMicros,
      periodEnd: periodMatches ? current.periodEnd : resolved.periodEnd,
      periodStart: periodMatches ? current.periodStart : resolved.periodStart,
      planResetAt: planResetAt ?? current.planResetAt,
      spentUsdMicros: resetForPlanUpgrade ? 0n : current.spentUsdMicros,
      usageCreditBalanceUsdMicros: input.usageCreditBalanceUsdMicros,
      usageCreditLedgerVersion: input.usageCreditLedgerVersion,
    };
  }

  return {
    kind: "period",
    allowanceSource: resolved.allowanceSource,
    billingPlanCode: resolved.billingPlanCode,
    blockedAt: null,
    highestBillingPlanCode: resolved.billingPlanCode,
    limitUsdMicros: resolved.limitUsdMicros,
    periodEnd: resolved.periodEnd,
    periodStart: resolved.periodStart,
    planResetAt: null,
    spentUsdMicros: 0n,
    usageCreditBalanceUsdMicros: input.usageCreditBalanceUsdMicros,
    usageCreditLedgerVersion: input.usageCreditLedgerVersion,
  };
}

function resolveHostedAiUsagePlanResetAt(input: {
  billingRef: HostedAiUsageAllowanceBillingRef | null;
  highestBillingPlanCode: HostedBillingPlanCode;
  planHistoryInitialized: boolean;
  resolved: Extract<HostedAiUsageAllowancePeriodResolution, { kind: "period" }>;
}): Date | null {
  if (
    !input.planHistoryInitialized ||
    (
      input.resolved.allowanceSource !== "direct_paid_member_plan" &&
      input.resolved.allowanceSource !== "family_sponsored_plan"
    )
  ) {
    return null;
  }

  const transition = readHostedAiUsagePlanTransition(input.billingRef);
  if (!transition || transition.toPlanCode !== input.resolved.billingPlanCode) {
    return null;
  }

  if (
    transition.kind === "plan_upgrade" &&
    isHostedBillingPlanImmediateUpgrade({
      currentPlanCode: transition.fromPlanCode,
      targetPlanCode: transition.toPlanCode,
    }) &&
    isHostedBillingPlanImmediateUpgrade({
      currentPlanCode: input.highestBillingPlanCode,
      targetPlanCode: input.resolved.billingPlanCode,
    })
  ) {
    return resolveHostedAiUsagePlanAppliedAt({
      appliedAt: transition.at,
      resolved: input.resolved,
    });
  }

  if (
    input.resolved.allowanceSource !== "direct_paid_member_plan" ||
    transition.kind !== "trial_conversion" ||
    transition.fromPlanCode !== "launch_monthly" ||
    transition.toPlanCode !== "launch_monthly"
  ) {
    return null;
  }

  // Existing Stripe trials can still convert during the rollout. They share
  // Pulse's plan code, so the persisted transition is the only compatibility
  // signal needed to begin the paid allowance without retaining trial dates.
  return resolveHostedAiUsagePlanAppliedAt({
    appliedAt: transition.at,
    resolved: input.resolved,
  });
}

function resolveHostedAiUsagePlanAppliedAt(input: {
  appliedAt: Date;
  resolved: Extract<HostedAiUsageAllowancePeriodResolution, { kind: "period" }>;
}): Date | null {
  return input.appliedAt.getTime() >= input.resolved.periodStart.getTime() &&
      input.appliedAt.getTime() < input.resolved.periodEnd.getTime()
    ? input.appliedAt
    : null;
}

function readHostedAiUsagePlanTransition(
  billingRef: HostedAiUsageAllowanceBillingRef | null,
): {
  at: Date;
  fromPlanCode: HostedBillingPlanCode;
  kind: "plan_upgrade" | "trial_conversion";
  toPlanCode: HostedBillingPlanCode;
} | null {
  const at = billingRef?.usagePlanTransitionAt ?? null;
  const fromPlanCode = parseHostedBillingPlanCode(
    billingRef?.usagePlanTransitionFromCode,
  );
  const toPlanCode = parseHostedBillingPlanCode(
    billingRef?.usagePlanTransitionToCode,
  );
  const kind = billingRef?.usagePlanTransitionKind;
  return at && fromPlanCode && toPlanCode &&
      (kind === "plan_upgrade" || kind === "trial_conversion")
    ? { at, fromPlanCode, kind, toPlanCode }
    : null;
}

function resolveHostedAiUsageObservedHighestPlanCode(input: {
  highestBillingPlanCode: HostedBillingPlanCode;
  observedBillingPlanCode: HostedBillingPlanCode;
}): HostedBillingPlanCode {
  return isHostedBillingPlanImmediateUpgrade({
    currentPlanCode: input.highestBillingPlanCode,
    targetPlanCode: input.observedBillingPlanCode,
  })
    ? input.observedBillingPlanCode
    : input.highestBillingPlanCode;
}

function shouldPreserveExistingPaidPeriodLimit(input: {
  currentLimitUsdMicros: bigint;
  resolved: Extract<HostedAiUsageAllowancePeriodResolution, { kind: "period" }>;
}): boolean {
  return (
    (
      input.resolved.allowanceSource === "direct_paid_member_plan" ||
      input.resolved.allowanceSource === "family_sponsored_plan"
    ) &&
    (
      input.currentLimitUsdMicros === 10_000_000n ||
      input.currentLimitUsdMicros === 25_000_000n
    ) &&
    input.currentLimitUsdMicros > input.resolved.limitUsdMicros
  );
}

async function accountHostedAiUsageAllowancePeriodSpendTx(input: {
  costUsdMicros: bigint;
  memberId: string;
  now: Date;
  period: Extract<HostedAiUsageAllowancePeriodResult, { kind: "period" }>;
  recordOccurredAt: Date;
  sourceUsageId: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedAiUsageLimitNoticeCandidate | null> {
  const baseRemainingUsdMicros = input.period.limitUsdMicros > input.period.spentUsdMicros
    ? input.period.limitUsdMicros - input.period.spentUsdMicros
    : 0n;
  const creditDebitUsdMicros = input.costUsdMicros > baseRemainingUsdMicros
    ? input.costUsdMicros - baseRemainingUsdMicros
    : 0n;
  let usageCreditBalanceUsdMicros = input.period.usageCreditBalanceUsdMicros;
  let usageCreditLedgerVersion = input.period.usageCreditLedgerVersion;

  if (creditDebitUsdMicros > 0n) {
    const settlement = await settleHostedUsageCreditForUsageTx({
      beneficiaryMemberId: input.memberId,
      debitUsdMicros: creditDebitUsdMicros,
      effectiveAt: input.recordOccurredAt,
      sourceUsageId: input.sourceUsageId,
      tx: input.tx,
    });
    usageCreditBalanceUsdMicros = settlement.balanceUsdMicros;
    usageCreditLedgerVersion = settlement.ledgerVersion;
  }

  const remainingBeforeUsdMicros =
    baseRemainingUsdMicros + input.period.usageCreditBalanceUsdMicros;
  const noticeEligible = remainingBeforeUsdMicros > 0n
    && input.costUsdMicros >= remainingBeforeUsdMicros;

  const updated = await input.tx.$executeRaw`
    UPDATE "hosted_ai_usage_period"
    SET
      "spent_usd_micros" = "spent_usd_micros" + ${input.costUsdMicros},
      "last_usage_at" = GREATEST(COALESCE("last_usage_at", ${input.recordOccurredAt}), ${input.recordOccurredAt}),
      "blocked_at" = CASE
        WHEN "spent_usd_micros" + ${input.costUsdMicros} >= "limit_usd_micros"
          AND ${usageCreditBalanceUsdMicros} <= 0 THEN
          CASE
            WHEN "spent_usd_micros" < "limit_usd_micros" OR "blocked_at" IS NULL THEN ${input.now}
            ELSE "blocked_at"
          END
        ELSE NULL
      END,
      "updated_at" = ${input.now}
    WHERE "member_id" = ${input.memberId}
      AND "period_start" = ${input.period.periodStart}
  `;

  if (updated !== 1) {
    throw new TypeError("Hosted AI usage allowance period spend lost its locked row.");
  }

  if (input.period.allowanceSource === "thread_container") {
    const spentAfterUsdMicros =
      input.period.spentUsdMicros + input.costUsdMicros;
    const baseRemainingAfterUsdMicros =
      input.period.limitUsdMicros > spentAfterUsdMicros
        ? input.period.limitUsdMicros - spentAfterUsdMicros
        : 0n;
    await admitHostedGroupSponsorshipRefillTx({
      beneficiaryMemberId: input.memberId,
      capacityState: classifyHostedGroupUsageCapacity({
        limitUsdMicros: input.period.limitUsdMicros,
        remainingUsdMicros:
          baseRemainingAfterUsdMicros + usageCreditBalanceUsdMicros,
      }),
      now: input.now,
      tx: input.tx,
    });
  }

  if (!noticeEligible) {
    return null;
  }

  return {
    crossedAt: input.period.blockedAt ?? input.now,
    memberId: input.memberId,
    periodEnd: input.period.periodEnd,
    periodStart: input.period.periodStart,
    planResetAt: input.period.planResetAt,
    sourceUsageId: input.sourceUsageId,
    usageCreditLedgerVersion,
    userNotice: buildHostedAiUsageGateLimitNotice({
      allowanceSource: input.period.allowanceSource,
      billingPlanCode: input.period.billingPlanCode,
      memberId: input.memberId,
      periodStart: input.period.periodStart,
    }),
  };
}

function resolveHostedAiUsageAllowanceRemainingUsdMicros(
  period: Extract<HostedAiUsageAllowancePeriodResult, { kind: "period" }>,
): bigint {
  const baseRemainingUsdMicros = period.limitUsdMicros > period.spentUsdMicros
    ? period.limitUsdMicros - period.spentUsdMicros
    : 0n;

  return baseRemainingUsdMicros + period.usageCreditBalanceUsdMicros;
}

function resolveHostedAiUsageAllowancePeriod(input: {
  at: Date;
  billingRef: HostedAiUsageAllowanceBillingRef | null;
  threadContainer?: HostedAiUsageAllowanceThreadContainerRef | null;
  threadContainerAccessActive?: boolean | null;
}): HostedAiUsageAllowancePeriodResolution {
  const billingPlanCode =
    parseHostedBillingPlanCode(input.billingRef?.currentBillingPlanCode)
    ?? getHostedDefaultBillingPlanCode();

  if (input.threadContainer) {
    const period = resolveHostedAiUsageBillingOrCalendarPeriod({
      at: input.at,
      billingRef: input.billingRef,
    });
    const threadContainerLimitUsdMicros =
      normalizeHostedThreadContainerUsageLimitUsdMicros(input.threadContainer);

    if (
      threadContainerLimitUsdMicros === null
      || input.threadContainerAccessActive !== true
    ) {
      return {
        allowanceSource: "thread_container",
        billingPlanCode,
        kind: "denied",
        limitUsdMicros: threadContainerLimitUsdMicros ?? 0n,
        periodEnd: period.periodEnd,
        periodStart: period.periodStart,
        reason: "hosted_access_inactive",
        retryAfter: resolveHostedAiUsageInactiveRetryAfter({
          at: input.at,
          periodEnd: period.periodEnd,
        }),
        userNotice: null,
      };
    }

    return {
      allowanceSource: "thread_container",
      billingPlanCode,
      kind: "period",
      limitUsdMicros: threadContainerLimitUsdMicros,
      periodEnd: period.periodEnd,
      periodStart: period.periodStart,
      source: period.source,
    };
  }

  const familySponsored =
    input.billingRef?.allowanceSource === "family_sponsored_plan";
  if (!familySponsored && !isHostedAiUsagePaidBillingRef(input.billingRef)) {
    const period = buildHostedStarterUsageLifetimePeriod();
    return {
      allowanceSource: "direct_starter",
      billingPlanCode,
      kind: "period",
      limitUsdMicros: 0n,
      periodEnd: period.periodEnd,
      periodStart: period.periodStart,
      source: "starter",
    };
  }

  const period = resolveHostedAiUsageBillingOrCalendarPeriod({
    at: input.at,
    billingRef: input.billingRef,
  });

  return {
    allowanceSource:
      familySponsored
        ? "family_sponsored_plan"
        : "direct_paid_member_plan",
    billingPlanCode,
    kind: "period",
    limitUsdMicros:
      input.billingRef?.usageLimitUsdMicrosOverride ??
      getHostedAiUsageMonthlyAllowanceUsdMicros(billingPlanCode),
    periodEnd: period.periodEnd,
    periodStart: period.periodStart,
    source: period.source,
  };
}

function normalizeHostedThreadContainerUsageLimitUsdMicros(
  threadContainer: HostedAiUsageAllowanceThreadContainerRef | null | undefined,
): bigint | null {
  const limit = threadContainer?.monthlyUsageLimitUsdMicros ?? null;
  return typeof limit === "bigint" && limit > 0n ? limit : null;
}

function resolveHostedAiUsageInactiveRetryAfter(input: {
  at: Date;
  periodEnd: Date;
}): Date {
  return input.periodEnd.getTime() > input.at.getTime()
    ? input.periodEnd
    : new Date(input.at.getTime() + 15 * 60_000);
}

function resolveHostedAiUsageBillingOrCalendarPeriod(input: {
  at: Date;
  billingRef: HostedAiUsageAllowanceBillingRef | null;
}): {
  periodEnd: Date;
  periodStart: Date;
  source: "billing" | "calendar";
} {
  const currentPeriodStart = input.billingRef?.currentPeriodStart ?? null;
  const currentPeriodEnd = input.billingRef?.currentPeriodEnd ?? null;

  return currentPeriodStart
    && currentPeriodEnd
    && currentPeriodStart.getTime() < currentPeriodEnd.getTime()
    && input.at.getTime() >= currentPeriodStart.getTime()
    && input.at.getTime() < currentPeriodEnd.getTime()
    ? {
        periodEnd: currentPeriodEnd,
        periodStart: currentPeriodStart,
        source: "billing",
      }
    : {
        ...buildUtcCalendarMonthPeriod(input.at),
        source: "calendar",
      };
}


function resolveHostedAiUsageAllowanceBlockedAt(input: {
  blockedAt: Date | null;
  limitUsdMicros: bigint;
  now: Date;
  spentUsdMicros: bigint;
  usageCreditBalanceUsdMicros: bigint;
}): Date | null {
  const baseRemainingUsdMicros = input.limitUsdMicros > input.spentUsdMicros
    ? input.limitUsdMicros - input.spentUsdMicros
    : 0n;
  if (baseRemainingUsdMicros + input.usageCreditBalanceUsdMicros > 0n) {
    return null;
  }

  return input.blockedAt ?? input.now;
}

function sameNullableTime(left: Date | null, right: Date | null): boolean {
  return left?.getTime() === right?.getTime();
}

function normalizeHostedAiUsageCreditProjection(input: {
  usageCreditBalanceUsdMicros: bigint | null;
  usageCreditLedgerVersion: bigint | null;
}): HostedAiUsageCreditProjection {
  return {
    usageCreditBalanceUsdMicros: input.usageCreditBalanceUsdMicros ?? 0n,
    usageCreditLedgerVersion: input.usageCreditLedgerVersion ?? 0n,
  };
}

async function lockHostedAiUsageAllowancePeriodTx(input: {
  memberId: string;
  periodStart: Date;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  await input.tx.$queryRaw`
    SELECT 1
    FROM "hosted_ai_usage_period"
    WHERE "member_id" = ${input.memberId}
      AND "period_start" = ${input.periodStart}
    FOR UPDATE
  `;
}

async function lockHostedAiUsageAllowanceBeneficiaryTx(input: {
  memberId: string;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  await input.tx.$queryRaw`
    SELECT 1
    FROM "hosted_member"
    WHERE "id" = ${input.memberId}
    FOR UPDATE
  `;
}

async function runHostedAiUsageAllowanceTransaction<T>(
  prisma: HostedAiUsageAllowanceClient,
  run: (tx: Prisma.TransactionClient) => Promise<T>,
  isolationLevel?: Prisma.TransactionIsolationLevel,
): Promise<T> {
  const maybeTransaction = prisma as {
    $transaction?: <R>(
      run: (tx: Prisma.TransactionClient) => Promise<R>,
      options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
    ) => Promise<R>;
  };

  if (typeof maybeTransaction.$transaction === "function") {
    return isolationLevel
      ? maybeTransaction.$transaction(run, { isolationLevel })
      : maybeTransaction.$transaction(run);
  }

  return run(prisma as Prisma.TransactionClient);
}

function priceTokenBucketUsdMicros(
  tokens: bigint,
  usdMicrosPerMillionTokens: bigint,
): bigint {
  if (tokens <= 0n || usdMicrosPerMillionTokens <= 0n) {
    return 0n;
  }

  return ((tokens * usdMicrosPerMillionTokens) + TOKENS_PER_PRICING_UNIT - 1n)
    / TOKENS_PER_PRICING_UNIT;
}

function applyTokenPricingAdjustmentUsdMicros(
  standardCostUsdMicros: bigint,
  tokenPricing: HostedAiUsageAllowanceTokenPricingBasisResolution,
): bigint {
  if (
    standardCostUsdMicros <= 0n ||
    tokenPricing.multiplierNumerator <= 0n
  ) {
    return 0n;
  }

  return (
    (standardCostUsdMicros * tokenPricing.multiplierNumerator)
    + tokenPricing.multiplierDenominator - 1n
  ) / tokenPricing.multiplierDenominator;
}

function resolveHostedAiUsageAllowanceTokenPricingBasis(input: {
  model: HostedAiUsageAllowancePricedModel | null;
  record: AssistantUsageRecord;
}): HostedAiUsageAllowanceTokenPricingBasisResolution {
  const basis = normalizeAssistantUsageTokenPricingBasis(
    input.record.tokenPricingBasis,
  );
  if (!input.model) {
    throw new TypeError("Hosted AI usage allowance pricing is missing for the model.");
  }

  const config = basis === "standard"
      && isHostedAiUsageVeniceTokenPricingProviderName(input.record.providerName)
    ? HOSTED_AI_USAGE_ALLOWANCE_GPT_56_VENICE_TOKEN_PRICING_BASIS
    : HOSTED_AI_USAGE_ALLOWANCE_MODEL_TOKEN_PRICING_BASES[
      input.model
    ][basis];

  if (!config) {
    throw new TypeError(
      "Hosted AI usage allowance token pricing basis is missing for the model.",
    );
  }

  if (config.requiredProviderKind === "openai") {
    if (!isHostedAiUsageOpenAiTokenPricingProviderName(input.record.providerName)) {
      throw new TypeError(
        "OpenAI flex token pricing requires OpenAI provider evidence.",
      );
    }
  }
  if (
    config.requiredProviderKind === "venice"
    && !isHostedAiUsageVeniceTokenPricingProviderName(input.record.providerName)
  ) {
    throw new TypeError(
      "Venice token pricing requires Venice provider evidence.",
    );
  }

  return {
    ...config,
    basis,
  };
}

function assertHostedAiUsageAllowanceAudioTokenPricingBasis(
  basis: AssistantUsageTokenPricingBasis,
): void {
  if (basis !== "standard") {
    throw new TypeError(
      "Audio-priced hosted AI usage must use standard token pricing basis.",
    );
  }
}

function assertHostedAiUsageAllowanceOpenAiImageTokenPricingBasis(
  basis: AssistantUsageTokenPricingBasis,
): void {
  if (basis !== "standard") {
    throw new TypeError(
      "OpenAI image hosted AI usage must use standard token pricing basis.",
    );
  }
}

function assertHostedAiUsageLobPhysicalNoteTokenPricingBasis(
  basis: AssistantUsageTokenPricingBasis,
): void {
  if (basis !== "standard") {
    throw new TypeError(
      "Lob physical-note hosted usage must use standard token pricing basis.",
    );
  }
}

function assertHostedAiUsageAllowanceElevenLabsTokenPricingBasis(
  basis: AssistantUsageTokenPricingBasis,
  feature: "TTS" | "Music",
): void {
  if (basis !== "standard") {
    throw new TypeError(
      `ElevenLabs ${feature} hosted AI usage must use standard token pricing basis.`,
    );
  }
}

interface HostedAiUsageAllowanceOpenAiImageModelResolution {
  model: HostedAiUsageAllowanceOpenAiImagePricedModel;
  source: HostedAiUsageAllowancePricingModelSource;
}

type HostedAiUsageAllowanceOpenAiImageMatch =
  | {
    kind: "priceable";
    modelResolution: HostedAiUsageAllowanceOpenAiImageModelResolution;
    tokenBuckets: AssistantOpenAiImageUsageTokenBuckets;
  }
  | {
    kind: "unpriceable";
    modelResolution: HostedAiUsageAllowanceOpenAiImageModelResolution;
    reason: AssistantOpenAiImageUsageUnpriceableReason;
  };

function matchHostedAiUsageOpenAiImageRecord(
  record: AssistantUsageRecord,
): HostedAiUsageAllowanceOpenAiImageMatch | null {
  if (
    record.provider !== "openai-images"
    || !isHostedAiUsageOpenAiImageSourcePath(record.usageExtractionSourcePath)
    || record.cacheWriteTokens !== null
  ) {
    return null;
  }

  const modelResolution = resolveHostedAiUsageAllowanceOpenAiImageModel(record);
  if (modelResolution.model === null || modelResolution.source === null) {
    return null;
  }

  const usageBasis = classifyAssistantOpenAiImageUsageBasis(record);
  if (!usageBasis.priceable) {
    return {
      kind: "unpriceable",
      modelResolution: {
        model: modelResolution.model,
        source: modelResolution.source,
      },
      reason: usageBasis.reason,
    };
  }

  return {
    kind: "priceable",
    modelResolution: {
      model: modelResolution.model,
      source: modelResolution.source,
    },
    tokenBuckets: usageBasis.tokenBuckets,
  };
}

function isHostedAiUsageAllowanceOpenAiImageRecord(
  record: AssistantUsageRecord,
): boolean {
  if (
    record.provider !== "openai-images"
    || !isHostedAiUsageOpenAiImageSourcePath(record.usageExtractionSourcePath)
    || record.cacheWriteTokens !== null
  ) {
    return false;
  }

  const modelResolution = resolveHostedAiUsageAllowanceOpenAiImageModel(record);
  return modelResolution.model !== null && modelResolution.source !== null;
}

function isHostedAiUsageOpenAiImageSourcePath(value: string | null): boolean {
  return value === "openai.images.generate" || value === "openai.images.edit";
}

function priceHostedAiUsageOpenAiImageForAllowance(input: {
  counted: boolean;
  credentialSource: AssistantUsageCredentialSource;
  match: Extract<HostedAiUsageAllowanceOpenAiImageMatch, { kind: "priceable" }>;
  record: AssistantUsageRecord;
}): HostedAiUsageAllowancePricingResult {
  const { modelResolution, tokenBuckets } = input.match;
  const standardCostUsdMicros =
    priceTokenBucketUsdMicros(
      tokenBuckets.billableTextInputTokens,
      HOSTED_AI_USAGE_ALLOWANCE_OPENAI_IMAGE_TEXT_INPUT_USD_MICROS_PER_MILLION_TOKENS,
    )
    + priceTokenBucketUsdMicros(
      tokenBuckets.cachedTextInputTokens,
      HOSTED_AI_USAGE_ALLOWANCE_OPENAI_IMAGE_CACHED_TEXT_INPUT_USD_MICROS_PER_MILLION_TOKENS,
    )
    + priceTokenBucketUsdMicros(
      tokenBuckets.billableImageInputTokens,
      HOSTED_AI_USAGE_ALLOWANCE_OPENAI_IMAGE_INPUT_USD_MICROS_PER_MILLION_TOKENS,
    )
    + priceTokenBucketUsdMicros(
      tokenBuckets.cachedImageInputTokens,
      HOSTED_AI_USAGE_ALLOWANCE_OPENAI_IMAGE_CACHED_INPUT_USD_MICROS_PER_MILLION_TOKENS,
    )
    + priceTokenBucketUsdMicros(
      tokenBuckets.outputTokens,
      HOSTED_AI_USAGE_ALLOWANCE_OPENAI_IMAGE_OUTPUT_USD_MICROS_PER_MILLION_TOKENS,
    );

  return {
    costUsdMicros: input.counted ? standardCostUsdMicros : 0n,
    counted: input.counted,
    pricingSnapshot: {
      credentialSource: input.credentialSource,
      model: modelResolution.model,
      modelSource: modelResolution.source,
      pricingSource: HOSTED_AI_USAGE_ALLOWANCE_OPENAI_IMAGE_PRICING_SOURCE,
      ratesUsdMicrosPerMillionTokens: {
        cachedImageInput:
          HOSTED_AI_USAGE_ALLOWANCE_OPENAI_IMAGE_CACHED_INPUT_USD_MICROS_PER_MILLION_TOKENS
            .toString(),
        cachedTextInput:
          HOSTED_AI_USAGE_ALLOWANCE_OPENAI_IMAGE_CACHED_TEXT_INPUT_USD_MICROS_PER_MILLION_TOKENS
            .toString(),
        imageInput:
          HOSTED_AI_USAGE_ALLOWANCE_OPENAI_IMAGE_INPUT_USD_MICROS_PER_MILLION_TOKENS
            .toString(),
        imageOutput:
          HOSTED_AI_USAGE_ALLOWANCE_OPENAI_IMAGE_OUTPUT_USD_MICROS_PER_MILLION_TOKENS
            .toString(),
        textInput:
          HOSTED_AI_USAGE_ALLOWANCE_OPENAI_IMAGE_TEXT_INPUT_USD_MICROS_PER_MILLION_TOKENS
            .toString(),
      },
      requestedModel: input.record.requestedModel,
      schema: "murph.hosted-ai-usage-allowance-pricing.v1",
      servedModel: input.record.servedModel,
      standardCostUsdMicros: standardCostUsdMicros.toString(),
      tokenPricingBasis: "standard",
      tokens: {
        ...buildHostedAiUsageAllowanceTokenSnapshot(input.record),
        openAiImage: {
          billableImageInput: tokenBuckets.billableImageInputTokens.toString(),
          billableTextInput: tokenBuckets.billableTextInputTokens.toString(),
          cachedImageInput: tokenBuckets.cachedImageInputTokens.toString(),
          cachedInput: tokenBuckets.cachedInputTokens.toString(),
          cachedInputAllocation:
            resolveHostedAiUsageAllowanceOpenAiImageCachedInputAllocation(
              tokenBuckets,
            ),
          cachedTextInput: tokenBuckets.cachedTextInputTokens.toString(),
          imageInput: tokenBuckets.imageInputTokens.toString(),
          output: tokenBuckets.outputTokens.toString(),
          textInput: tokenBuckets.textInputTokens.toString(),
        },
      },
    },
    pricingVersion: HOSTED_AI_USAGE_ALLOWANCE_OPENAI_IMAGE_PRICING_VERSION,
  };
}

function resolveHostedAiUsageAllowanceOpenAiImageCachedInputAllocation(
  tokenBuckets: AssistantOpenAiImageUsageTokenBuckets,
): "single_modality_only" | "text_first_conservative" {
  return tokenBuckets.cachedInputTokens > 0n
    && tokenBuckets.textInputTokens > 0n
    && tokenBuckets.imageInputTokens > 0n
    ? "text_first_conservative"
    : "single_modality_only";
}

function resolveHostedAiUsageAllowanceOpenAiImageModel(
  record: AssistantUsageRecord,
): {
  model: HostedAiUsageAllowanceOpenAiImagePricedModel | null;
  source: HostedAiUsageAllowancePricingModelSource | null;
} {
  const served = normalizeHostedAiUsageAllowanceOpenAiImageModelId(record.servedModel);
  if (served) {
    return {
      model: served,
      source: "served",
    };
  }

  const requested =
    normalizeHostedAiUsageAllowanceOpenAiImageModelId(record.requestedModel);
  if (requested) {
    return {
      model: requested,
      source: "requested",
    };
  }

  return {
    model: null,
    source: null,
  };
}

function matchHostedAiUsageRetellPhoneCallRecord(record: AssistantUsageRecord): {
  combinedCostUsdMicros: bigint;
} | null {
  const rawUsageJson = record.rawUsageJson;
  if (
    record.provider !== "retell"
    || record.providerName !== "Retell AI"
    || record.apiKeyEnv !== "RETELL_API_KEY"
    || record.baseUrl !== "https://api.retellai.com"
    || record.credentialSource !== "platform"
    || record.featureKey !== "phone-call"
    || record.surface !== "hosted-web"
    || record.triggerKind !== "phone-call"
    || record.usageExtractionSourcePath !== HOSTED_RETELL_USAGE_SOURCE_PATH
    || record.usageExtractionVersion !== HOSTED_RETELL_USAGE_VERSION
    || record.requestedModel !== null
    || record.servedModel !== null
    || record.inputTokens !== null
    || record.outputTokens !== null
    || record.reasoningTokens !== null
    || record.cachedInputTokens !== null
    || record.cacheWriteTokens !== null
    || record.totalTokens !== null
    || rawUsageJson === null
    || !Object.keys(rawUsageJson).every((key) => key === HOSTED_RETELL_USAGE_COST_KEY)
  ) {
    return null;
  }

  const combinedCostUsdMicros = readHostedAiUsageNonNegativeInteger(
    rawUsageJson[HOSTED_RETELL_USAGE_COST_KEY],
  );
  if (combinedCostUsdMicros === null) {
    return null;
  }
  return {
    combinedCostUsdMicros,
  };
}

function assertHostedAiUsageRetellTokenPricingBasis(
  tokenPricingBasis: AssistantUsageTokenPricingBasis,
): void {
  if (tokenPricingBasis !== "standard") {
    throw new TypeError(
      "Retell phone-call hosted usage must use standard token pricing basis.",
    );
  }
}

// Only Worker-recorded xAI x_search rows with a valid provider-reported cost
// take the exact-cost branch. A malformed row that merely claims the xai
// provider must fall through to token-model pricing and fail closed instead of
// being accounted as free.
function matchHostedAiUsageXaiSearchRecord(record: AssistantUsageRecord): {
  costInUsdTicks: bigint;
} | null {
  const rawUsageJson = record.rawUsageJson;
  if (
    record.provider !== "xai"
    || record.providerName !== "xAI"
    || record.apiKeyEnv !== "XAI_API_KEY"
    || record.baseUrl !== "https://api.x.ai"
    || record.credentialSource !== "platform"
    || record.featureKey !== "x-search"
    || record.surface !== "hosted-runner"
    || record.triggerKind !== "x-search"
    || record.usageExtractionSourcePath !== "xai.responses"
    || record.usageExtractionVersion !== "xai-x-search-v1"
    || typeof record.requestedModel !== "string"
    || record.servedModel !== null
    || record.inputTokens !== null
    || record.outputTokens !== null
    || record.reasoningTokens !== null
    || record.cachedInputTokens !== null
    || record.cacheWriteTokens !== null
    || record.totalTokens !== null
    || rawUsageJson === null
    || !Object.keys(rawUsageJson).every((key) =>
      HOSTED_AI_USAGE_ALLOWANCE_XAI_SEARCH_RAW_USAGE_KEYS.has(key),
    )
  ) {
    return null;
  }

  const costInUsdTicks = readHostedAiUsageNonNegativeInteger(
    rawUsageJson[HOSTED_AI_USAGE_ALLOWANCE_XAI_SEARCH_COST_KEY],
  );
  if (costInUsdTicks === null) {
    return null;
  }
  return {
    costInUsdTicks,
  };
}

function assertHostedAiUsageXaiSearchTokenPricingBasis(
  tokenPricingBasis: AssistantUsageTokenPricingBasis,
): void {
  if (tokenPricingBasis !== "standard") {
    throw new TypeError(
      "xAI x_search hosted usage must use standard token pricing basis.",
    );
  }
}

function divideXaiUsdTicksToMicrosCeil(costInUsdTicks: bigint): bigint {
  return (
    costInUsdTicks
    + HOSTED_AI_USAGE_ALLOWANCE_XAI_USD_TICKS_PER_USD_MICRO
    - 1n
  ) / HOSTED_AI_USAGE_ALLOWANCE_XAI_USD_TICKS_PER_USD_MICRO;
}

interface HostedAiUsageAllowanceGeminiVideoMatch {
  cachedInputTokens: bigint;
  inputTokens: bigint;
  outputTokens: bigint;
  reasoningTokens: bigint;
  totalTokens: bigint;
}

// Only the exact Worker-authored Gemini video-analysis row takes this pricing
// branch. A malformed row that merely claims the provider or model falls
// through to generic model pricing and fails closed rather than booking free.
function matchHostedAiUsageGeminiVideoAnalysisRecord(
  record: AssistantUsageRecord,
): HostedAiUsageAllowanceGeminiVideoMatch | null {
  const rawUsageJson = record.rawUsageJson;
  if (
    record.provider !== "gemini"
    || record.providerName !== "Google Gemini"
    || record.apiKeyEnv !== HOSTED_GEMINI_VIDEO_ANALYSIS_API_KEY_ENV
    || record.baseUrl !== HOSTED_GEMINI_VIDEO_ANALYSIS_API_BASE_URL
    || record.credentialSource !== "platform"
    || record.featureKey !== "video-analysis"
    || record.surface !== "hosted-runner"
    || record.triggerKind !== "analyze-video"
    || record.usageExtractionSourcePath
      !== HOSTED_GEMINI_VIDEO_ANALYSIS_USAGE_EXTRACTION_SOURCE_PATH
    || record.usageExtractionVersion
      !== HOSTED_GEMINI_VIDEO_ANALYSIS_USAGE_EXTRACTION_VERSION
    || record.requestedModel !== HOSTED_GEMINI_VIDEO_ANALYSIS_MODEL
    || record.servedModel !== null
    || record.cacheWriteTokens !== null
    || rawUsageJson === null
    || !Object.keys(rawUsageJson).every((key) =>
      HOSTED_AI_USAGE_ALLOWANCE_GEMINI_VIDEO_RAW_USAGE_KEYS.has(key)
    )
  ) {
    return null;
  }

  const inputTokens = readHostedAiUsageNonNegativeInteger(
    rawUsageJson.promptTokenCount,
  );
  const output = readHostedAiUsageOptionalNonNegativeInteger(
    rawUsageJson,
    "candidatesTokenCount",
  );
  const totalTokens = readHostedAiUsageNonNegativeInteger(
    rawUsageJson.totalTokenCount,
  );
  const cachedInput = readHostedAiUsageOptionalNonNegativeInteger(
    rawUsageJson,
    "cachedContentTokenCount",
  );
  const reasoning = readHostedAiUsageOptionalNonNegativeInteger(
    rawUsageJson,
    "thoughtsTokenCount",
  );
  if (
    inputTokens === null
    || output === null
    || totalTokens === null
    || cachedInput === null
    || reasoning === null
    || cachedInput.value > inputTokens
    || totalTokens !== inputTokens + output.value + reasoning.value
    || record.inputTokens !== Number(inputTokens)
    || record.outputTokens !== (output.present ? Number(output.value) : null)
    || record.totalTokens !== Number(totalTokens)
    || record.cachedInputTokens
      !== (cachedInput.present ? Number(cachedInput.value) : null)
    || record.reasoningTokens
      !== (reasoning.present ? Number(reasoning.value) : null)
  ) {
    return null;
  }

  return {
    cachedInputTokens: cachedInput.value,
    inputTokens,
    outputTokens: output.value,
    reasoningTokens: reasoning.value,
    totalTokens,
  };
}

function readHostedAiUsageOptionalNonNegativeInteger(
  record: Record<string, unknown>,
  key: string,
): { present: boolean; value: bigint } | null {
  if (!Object.prototype.hasOwnProperty.call(record, key)) {
    return { present: false, value: 0n };
  }
  const value = readHostedAiUsageNonNegativeInteger(record[key]);
  return value === null ? null : { present: true, value };
}

function assertHostedAiUsageGeminiVideoTokenPricingBasis(
  tokenPricingBasis: AssistantUsageTokenPricingBasis,
): void {
  if (tokenPricingBasis !== "standard") {
    throw new TypeError(
      "Gemini video-analysis hosted AI usage must use standard token pricing basis.",
    );
  }
}

function priceHostedAiUsageGeminiVideoForAllowance(input: {
  counted: boolean;
  credentialSource: AssistantUsageCredentialSource;
  match: HostedAiUsageAllowanceGeminiVideoMatch;
  record: AssistantUsageRecord;
}): HostedAiUsageAllowancePricingResult {
  const pricing = resolveHostedAiUsageGeminiVideoPricing(input.record.occurredAt);
  const billableNonCachedInputTokens =
    input.match.inputTokens - input.match.cachedInputTokens;
  const billableOutputTokens =
    input.match.outputTokens + input.match.reasoningTokens;
  const standardCostUsdMicros =
    priceTokenBucketUsdMicros(
      billableNonCachedInputTokens,
      pricing.inputUsdMicrosPerMillionTokens,
    )
    + priceTokenBucketUsdMicros(
      input.match.cachedInputTokens,
      pricing.cachedInputUsdMicrosPerMillionTokens,
    )
    + priceTokenBucketUsdMicros(
      billableOutputTokens,
      pricing.outputUsdMicrosPerMillionTokens,
    );

  return {
    costUsdMicros: input.counted ? standardCostUsdMicros : 0n,
    counted: input.counted,
    pricingSnapshot: {
      credentialSource: input.credentialSource,
      model: HOSTED_GEMINI_VIDEO_ANALYSIS_MODEL,
      modelSource: "requested",
      pricingSource: HOSTED_AI_USAGE_ALLOWANCE_GEMINI_VIDEO_PRICING_SOURCE,
      pricingWindow: {
        effectiveFrom: pricing.effectiveFrom,
        effectiveThrough: pricing.effectiveThrough,
      },
      ratesUsdMicrosPerMillionTokens: {
        cachedInput: pricing.cachedInputUsdMicrosPerMillionTokens.toString(),
        input: pricing.inputUsdMicrosPerMillionTokens.toString(),
        outputIncludingThinking:
          pricing.outputUsdMicrosPerMillionTokens.toString(),
      },
      requestedModel: input.record.requestedModel,
      schema: "murph.hosted-ai-usage-allowance-pricing.v1",
      servedModel: input.record.servedModel,
      standardCostUsdMicros: standardCostUsdMicros.toString(),
      tokenPricingBasis: "standard",
      tokens: {
        ...buildHostedAiUsageAllowanceTokenSnapshot(input.record),
        billableCachedInput: input.match.cachedInputTokens.toString(),
        billableNonCachedInput: billableNonCachedInputTokens.toString(),
        billableOutputIncludingThinking: billableOutputTokens.toString(),
        cachedInputIncludedInPromptInput:
          input.match.cachedInputTokens.toString(),
        providerTotal: input.match.totalTokens.toString(),
      },
    },
    pricingVersion: pricing.pricingVersion,
  };
}

function resolveHostedAiUsageGeminiVideoPricing(
  occurredAt: Date | string,
): {
  cachedInputUsdMicrosPerMillionTokens: bigint;
  effectiveFrom: string | null;
  effectiveThrough: string | null;
  inputUsdMicrosPerMillionTokens: bigint;
  outputUsdMicrosPerMillionTokens: bigint;
  pricingVersion: string;
} {
  const at = normalizeHostedAiUsageAllowanceDate(occurredAt);
  if (at.getTime() >= HOSTED_AI_USAGE_ALLOWANCE_GEMINI_VIDEO_2027_START_MS) {
    return {
      effectiveFrom: "2027-01-01T00:00:00.000Z",
      effectiveThrough: null,
      cachedInputUsdMicrosPerMillionTokens:
        HOSTED_AI_USAGE_ALLOWANCE_GEMINI_VIDEO_2027_CACHED_INPUT_USD_MICROS_PER_MILLION_TOKENS,
      inputUsdMicrosPerMillionTokens:
        HOSTED_AI_USAGE_ALLOWANCE_GEMINI_VIDEO_2027_INPUT_USD_MICROS_PER_MILLION_TOKENS,
      outputUsdMicrosPerMillionTokens:
        HOSTED_AI_USAGE_ALLOWANCE_GEMINI_VIDEO_2027_OUTPUT_USD_MICROS_PER_MILLION_TOKENS,
      pricingVersion:
        HOSTED_AI_USAGE_ALLOWANCE_GEMINI_VIDEO_2027_PRICING_VERSION,
    };
  }

  return {
    effectiveFrom: null,
    effectiveThrough: "2026-12-31T23:59:59.999Z",
    cachedInputUsdMicrosPerMillionTokens:
      HOSTED_AI_USAGE_ALLOWANCE_GEMINI_VIDEO_2026_CACHED_INPUT_USD_MICROS_PER_MILLION_TOKENS,
    inputUsdMicrosPerMillionTokens:
      HOSTED_AI_USAGE_ALLOWANCE_GEMINI_VIDEO_2026_INPUT_USD_MICROS_PER_MILLION_TOKENS,
    outputUsdMicrosPerMillionTokens:
      HOSTED_AI_USAGE_ALLOWANCE_GEMINI_VIDEO_2026_OUTPUT_USD_MICROS_PER_MILLION_TOKENS,
    pricingVersion:
      HOSTED_AI_USAGE_ALLOWANCE_GEMINI_VIDEO_2026_PRICING_VERSION,
  };
}

function readHostedAiUsageNonNegativeInteger(value: unknown): bigint | null {
  return typeof value === "number"
      && Number.isSafeInteger(value)
      && value >= 0
    ? BigInt(value)
    : null;
}

// Only Worker-recorded Workers AI transcription rows take the audio-priced
// branch. A malformed row that merely claims the whisper id must fall through
// to token-model pricing and fail closed instead of being accounted as free.
function isHostedAiUsageAllowanceAudioModelRecord(record: AssistantUsageRecord): boolean {
  return record.provider === "workers-ai"
    && record.featureKey === "audio-transcription"
    && record.usageExtractionSourcePath === "workers-ai.transcribe"
    && record.cacheWriteTokens === null
    && record.cachedInputTokens === null
    && record.inputTokens === null
    && record.outputTokens === null
    && record.reasoningTokens === null
    && record.totalTokens === null
    && readHostedAiUsageAudioBytes(record) !== null
    && (
      isHostedAiUsageAllowanceAudioModelId(record.servedModel)
      || isHostedAiUsageAllowanceAudioModelId(record.requestedModel)
    );
}

function isHostedAiUsageAllowanceAudioModelId(value: string | null): boolean {
  return typeof value === "string"
    && value.trim().toLowerCase() === HOSTED_AI_USAGE_ALLOWANCE_AUDIO_MODEL;
}

function priceHostedAiUsageAudioForAllowance(input: {
  counted: boolean;
  credentialSource: AssistantUsageCredentialSource;
  record: AssistantUsageRecord;
}): HostedAiUsageAllowancePricingResult {
  const durationMs = readHostedAiUsageDurationMs(input.record);
  const costUsdMicros = input.counted && durationMs !== null
    ? priceAudioDurationUsdMicros(durationMs)
    : 0n;

  return {
    costUsdMicros,
    counted: input.counted,
    pricingSnapshot: {
      audio: {
        durationMs: durationMs === null ? null : durationMs.toString(),
        usdMicrosPerAudioMinute:
          HOSTED_AI_USAGE_ALLOWANCE_AUDIO_USD_MICROS_PER_MINUTE.toString(),
      },
      credentialSource: input.credentialSource,
      model: HOSTED_AI_USAGE_ALLOWANCE_AUDIO_MODEL,
      modelSource: isHostedAiUsageAllowanceAudioModelId(input.record.servedModel)
        ? "served"
        : "requested",
      pricingSource: HOSTED_AI_USAGE_ALLOWANCE_AUDIO_PRICING_SOURCE,
      requestedModel: input.record.requestedModel,
      schema: "murph.hosted-ai-usage-allowance-pricing.v1",
      servedModel: input.record.servedModel,
      tokens: buildHostedAiUsageAllowanceTokenSnapshot(input.record),
    },
    pricingVersion: HOSTED_AI_USAGE_ALLOWANCE_AUDIO_PRICING_VERSION,
  };
}

function readHostedAiUsageDurationMs(record: AssistantUsageRecord): bigint | null {
  const durationMs = record.rawUsageJson?.durationMs;

  return typeof durationMs === "number"
      && Number.isSafeInteger(durationMs)
      && durationMs >= 0
    ? BigInt(durationMs)
    : null;
}

function readHostedAiUsageAudioBytes(record: AssistantUsageRecord): bigint | null {
  const audioBytes = record.rawUsageJson?.audioBytes;

  return typeof audioBytes === "number"
      && Number.isSafeInteger(audioBytes)
      && audioBytes > 0
    ? BigInt(audioBytes)
    : null;
}

function priceAudioDurationUsdMicros(
  durationMs: bigint,
  usdMicrosPerMinute = HOSTED_AI_USAGE_ALLOWANCE_AUDIO_USD_MICROS_PER_MINUTE,
): bigint {
  if (durationMs <= 0n) {
    return 0n;
  }

  return ((durationMs * usdMicrosPerMinute)
    + MS_PER_PRICING_MINUTE - 1n)
    / MS_PER_PRICING_MINUTE;
}

interface HostedAiUsageAllowanceElevenLabsTtsMatch {
  characterCount: bigint;
  modelResolution: {
    model: HostedAiUsageAllowanceElevenLabsTtsPricedModel | null;
    source: HostedAiUsageAllowancePricingModelSource | null;
  };
}

function matchHostedAiUsageElevenLabsTtsRecord(
  record: AssistantUsageRecord,
): HostedAiUsageAllowanceElevenLabsTtsMatch | null {
  if (
    record.provider !== "elevenlabs"
    || record.usageExtractionSourcePath !== "elevenlabs.text_to_speech"
    || record.cacheWriteTokens !== null
    || record.cachedInputTokens !== null
    || record.inputTokens !== null
    || record.outputTokens !== null
    || record.reasoningTokens !== null
    || record.totalTokens !== null
  ) {
    return null;
  }
  const characterCount = readHostedAiUsageElevenLabsTtsCharacterCount(record);
  if (characterCount === null) {
    return null;
  }
  return {
    characterCount,
    modelResolution: resolveHostedAiUsageAllowanceElevenLabsTtsModel(record),
  };
}

function priceHostedAiUsageElevenLabsTtsForAllowance(input: {
  counted: boolean;
  credentialSource: AssistantUsageCredentialSource;
  match: HostedAiUsageAllowanceElevenLabsTtsMatch;
  record: AssistantUsageRecord;
}): HostedAiUsageAllowancePricingResult {
  const { characterCount, modelResolution } = input.match;
  const usdMicrosPerThousandCharacters = modelResolution.model
    ? HOSTED_AI_USAGE_ALLOWANCE_ELEVENLABS_TTS_MODEL_PRICES[modelResolution.model]
    : null;

  if (input.counted && usdMicrosPerThousandCharacters === null) {
    throw new TypeError(
      "Hosted AI usage allowance ElevenLabs TTS pricing is missing for the model.",
    );
  }

  const costUsdMicros = input.counted && usdMicrosPerThousandCharacters !== null
    ? priceTtsCharactersUsdMicros(characterCount, usdMicrosPerThousandCharacters)
    : 0n;

  return {
    costUsdMicros,
    counted: input.counted,
    pricingSnapshot: {
      characters: {
        count: characterCount.toString(),
        usdMicrosPerThousandCharacters:
          usdMicrosPerThousandCharacters?.toString() ?? null,
      },
      credentialSource: input.credentialSource,
      model: modelResolution.model,
      modelSource: modelResolution.source,
      pricingSource: HOSTED_AI_USAGE_ALLOWANCE_ELEVENLABS_TTS_PRICING_SOURCE,
      requestedModel: input.record.requestedModel,
      schema: "murph.hosted-ai-usage-allowance-pricing.v1",
      servedModel: input.record.servedModel,
      tokens: buildHostedAiUsageAllowanceTokenSnapshot(input.record),
    },
    pricingVersion: HOSTED_AI_USAGE_ALLOWANCE_ELEVENLABS_TTS_PRICING_VERSION,
  };
}

function readHostedAiUsageElevenLabsTtsCharacterCount(
  record: AssistantUsageRecord,
): bigint | null {
  const characterCount = record.rawUsageJson?.characterCount;

  return typeof characterCount === "number"
      && Number.isSafeInteger(characterCount)
      && characterCount > 0
    ? BigInt(characterCount)
    : null;
}

function priceTtsCharactersUsdMicros(
  characterCount: bigint,
  usdMicrosPerThousandCharacters: bigint,
): bigint {
  if (characterCount <= 0n || usdMicrosPerThousandCharacters <= 0n) {
    return 0n;
  }

  return (
    (characterCount * usdMicrosPerThousandCharacters)
    + CHARACTERS_PER_TTS_PRICING_UNIT - 1n
  ) / CHARACTERS_PER_TTS_PRICING_UNIT;
}

function resolveHostedAiUsageAllowanceElevenLabsTtsModel(
  record: AssistantUsageRecord,
): {
  model: HostedAiUsageAllowanceElevenLabsTtsPricedModel | null;
  source: HostedAiUsageAllowancePricingModelSource | null;
} {
  const served = normalizeHostedAiUsageAllowanceElevenLabsTtsModel(record.servedModel);
  if (served) {
    return {
      model: served,
      source: "served",
    };
  }

  const requested =
    normalizeHostedAiUsageAllowanceElevenLabsTtsModel(record.requestedModel);
  if (requested) {
    return {
      model: requested,
      source: "requested",
    };
  }

  return {
    model: null,
    source: null,
  };
}

function normalizeHostedAiUsageAllowanceElevenLabsTtsModel(
  value: string | null,
): HostedAiUsageAllowanceElevenLabsTtsPricedModel | null {
  return normalizeHostedAiUsageAllowanceElevenLabsTtsModelId(value);
}

interface HostedAiUsageAllowanceElevenLabsMusicMatch {
  durationMs: bigint;
  modelResolution: {
    model: HostedAiUsageAllowanceElevenLabsMusicPricedModel | null;
    source: HostedAiUsageAllowancePricingModelSource | null;
  };
}

function matchHostedAiUsageElevenLabsMusicRecord(
  record: AssistantUsageRecord,
): HostedAiUsageAllowanceElevenLabsMusicMatch | null {
  if (
    record.provider !== "elevenlabs"
    || record.featureKey !== "music-generation"
    || record.usageExtractionSourcePath !== "elevenlabs.music.compose"
    || record.cacheWriteTokens !== null
    || record.cachedInputTokens !== null
    || record.inputTokens !== null
    || record.outputTokens !== null
    || record.reasoningTokens !== null
    || record.totalTokens !== null
  ) {
    return null;
  }
  const durationMs = readHostedAiUsageDurationMs(record);
  if (durationMs === null) {
    return null;
  }
  const modelResolution = resolveHostedAiUsageAllowanceElevenLabsMusicModel(record);
  if (modelResolution.model === null) {
    return null;
  }
  return { durationMs, modelResolution };
}

function priceHostedAiUsageElevenLabsMusicForAllowance(input: {
  counted: boolean;
  credentialSource: AssistantUsageCredentialSource;
  match: HostedAiUsageAllowanceElevenLabsMusicMatch;
  record: AssistantUsageRecord;
}): HostedAiUsageAllowancePricingResult {
  const { durationMs, modelResolution } = input.match;
  const costUsdMicros = input.counted
    ? priceAudioDurationUsdMicros(
        durationMs,
        HOSTED_AI_USAGE_ALLOWANCE_ELEVENLABS_MUSIC_USD_MICROS_PER_MINUTE,
      )
    : 0n;

  return {
    costUsdMicros,
    counted: input.counted,
    pricingSnapshot: {
      credentialSource: input.credentialSource,
      model: modelResolution.model,
      modelSource: modelResolution.source,
      audio: {
        durationMs: durationMs.toString(),
        usdMicrosPerGeneratedMinute:
          HOSTED_AI_USAGE_ALLOWANCE_ELEVENLABS_MUSIC_USD_MICROS_PER_MINUTE.toString(),
      },
      pricingSource: HOSTED_AI_USAGE_ALLOWANCE_ELEVENLABS_MUSIC_PRICING_SOURCE,
      requestedModel: input.record.requestedModel,
      schema: "murph.hosted-ai-usage-allowance-pricing.v1",
      servedModel: input.record.servedModel,
      tokens: buildHostedAiUsageAllowanceTokenSnapshot(input.record),
    },
    pricingVersion: HOSTED_AI_USAGE_ALLOWANCE_ELEVENLABS_MUSIC_PRICING_VERSION,
  };
}

function resolveHostedAiUsageAllowanceElevenLabsMusicModel(
  record: AssistantUsageRecord,
): {
  model: HostedAiUsageAllowanceElevenLabsMusicPricedModel | null;
  source: HostedAiUsageAllowancePricingModelSource | null;
} {
  const served = normalizeHostedAiUsageAllowanceElevenLabsMusicModelId(record.servedModel);
  if (served) {
    return { model: served, source: "served" };
  }

  const requested = normalizeHostedAiUsageAllowanceElevenLabsMusicModelId(
    record.requestedModel,
  );
  return requested
    ? { model: requested, source: "requested" }
    : { model: null, source: null };
}

function buildHostedAiUsageAllowanceTokenSnapshot(
  record: AssistantUsageRecord,
): Prisma.InputJsonObject {
  return {
    cachedInput: normalizeTokenCount(record.cachedInputTokens).toString(),
    cacheWrite: normalizeTokenCount(record.cacheWriteTokens).toString(),
    input: normalizeTokenCount(record.inputTokens).toString(),
    output: normalizeTokenCount(record.outputTokens).toString(),
    reasoning: normalizeTokenCount(record.reasoningTokens).toString(),
    total: normalizeTokenCount(record.totalTokens).toString(),
  };
}


function normalizeAssistantUsageCredentialSource(
  value: AssistantUsageCredentialSource,
): AssistantUsageCredentialSource {
  return value === "member" || value === "platform" ? value : "unknown";
}

function normalizeHostedAiUsageAllowanceModel(
  value: string | null,
): HostedAiUsageAllowancePricedModel | null {
  if (typeof value !== "string") {
    return null;
  }

  return normalizeHostedAiUsageAllowancePricedModelId(value);
}

function resolveHostedAiUsageAllowancePricingModel(
  record: AssistantUsageRecord,
): HostedAiUsageAllowancePricingModelResolution {
  const requestedModel = record.requestedModel ?? null;
  const servedModel = record.servedModel ?? null;
  const served = normalizeHostedAiUsageAllowanceModel(servedModel);
  if (served) {
    return {
      model: served,
      requestedModel,
      servedModel,
      source: "served",
    };
  }

  const requested = normalizeHostedAiUsageAllowanceModel(requestedModel);
  if (requested) {
    return {
      model: requested,
      requestedModel,
      servedModel,
      source: "requested",
    };
  }

  return {
    model: null,
    requestedModel,
    servedModel,
    source: null,
  };
}

function buildHostedAiUsageAllowanceModelSnapshot(
  resolution: HostedAiUsageAllowancePricingModelResolution,
  record: AssistantUsageRecord,
): Prisma.InputJsonObject {
  return {
    model: resolution.model,
    modelSource: resolution.source,
    ...(resolution.model
        && isHostedAiUsageVeniceTokenPricingProviderName(record.providerName)
      ? {
        providerModel:
          HOSTED_ASSISTANT_VENICE_PROVIDER_MODELS[resolution.model],
      }
      : {}),
    requestedModel: resolution.requestedModel,
    servedModel: resolution.servedModel,
  };
}

function resolveHostedAiUsageAllowanceModelPrices(input: {
  model: HostedAiUsageAllowancePricedModel;
  record: AssistantUsageRecord;
}): HostedAiUsageAllowanceModelPrice {
  return isHostedAiUsageVeniceTokenPricingProviderName(input.record.providerName)
    ? HOSTED_AI_USAGE_ALLOWANCE_VENICE_MODEL_PRICES[input.model]
    : HOSTED_AI_USAGE_ALLOWANCE_OPENAI_MODEL_PRICES[input.model];
}

function isHostedAiUsageVeniceTokenPricingProviderName(
  value: unknown,
): boolean {
  return typeof value === "string"
    && value.trim().toLowerCase() === HOSTED_ASSISTANT_VENICE_PROVIDER;
}

function buildHostedAiUsageGateLimitNotice(input: {
  allowanceSource: HostedAiUsageAllowanceSourceKind;
  billingPlanCode: HostedBillingPlanCode;
  memberId: string;
  periodStart: Date;
}): HostedAiUsageLimitNotice {
  if (input.allowanceSource === "thread_container") {
    return {
      code: "thread_usage_limit_reached",
      message: renderUserFacingMessage({
        context: {},
        key: "linq.ai_usage.thread_limit_reached",
        seed: buildHostedAiUsageNoticeSeed({
          memberId: input.memberId,
          noticeCode: "thread_usage_limit_reached",
          periodStart: input.periodStart,
        }),
      }).text,
    };
  }

  if (input.allowanceSource === "direct_starter") {
    return {
      code: "starter_usage_limit_reached",
      message: renderHostedAiUsageGateLimitNoticeMessage({
        key: "linq.ai_usage.starter_limit_reached",
        memberId: input.memberId,
        noticeCode: "starter_usage_limit_reached",
        periodStart: input.periodStart,
      }),
    };
  }

  if (input.allowanceSource === "family_sponsored_plan") {
    return {
      code: "family_usage_limit_reached",
      message: renderHostedAiUsageGateLimitNoticeMessage({
        key: "linq.ai_usage.family_limit_reached",
        memberId: input.memberId,
        noticeCode: "family_usage_limit_reached",
        periodStart: input.periodStart,
      }),
    };
  }

  if (input.billingPlanCode === "launch_group_monthly") {
    return {
      code: "group_upgrade_pulse",
      message: renderHostedAiUsageGateLimitNoticeMessage({
        key: "linq.ai_usage.group_upgrade_pulse",
        memberId: input.memberId,
        noticeCode: "group_upgrade_pulse",
        periodStart: input.periodStart,
      }),
    };
  }

  if (input.billingPlanCode === "launch_edge_monthly") {
    return {
      code: "edge_usage_limit_reached",
      message: renderHostedAiUsageGateLimitNoticeMessage({
        key: "linq.ai_usage.edge_limit_reached",
        memberId: input.memberId,
        noticeCode: "edge_usage_limit_reached",
        periodStart: input.periodStart,
      }),
    };
  }

  if (input.billingPlanCode === "launch_max_monthly") {
    return {
      code: "max_usage_limit_reached",
      message: renderHostedAiUsageGateLimitNoticeMessage({
        key: "linq.ai_usage.max_limit_reached",
        memberId: input.memberId,
        noticeCode: "max_usage_limit_reached",
        periodStart: input.periodStart,
      }),
    };
  }

  return {
    code: "pulse_upgrade_edge",
    message: renderHostedAiUsageGateLimitNoticeMessage({
      key: "linq.ai_usage.pulse_upgrade_edge",
      memberId: input.memberId,
      noticeCode: "pulse_upgrade_edge",
      periodStart: input.periodStart,
    }),
  };
}

function renderHostedAiUsageGateLimitNoticeMessage(input: {
  key:
    | "linq.ai_usage.edge_limit_reached"
    | "linq.ai_usage.family_limit_reached"
    | "linq.ai_usage.group_upgrade_pulse"
    | "linq.ai_usage.max_limit_reached"
    | "linq.ai_usage.pulse_upgrade_edge"
    | "linq.ai_usage.starter_limit_reached";
  memberId: string;
  noticeCode: HostedAiUsageGateNoticeCode;
  periodStart: Date;
}): string {
  return renderUserFacingMessage({
    context: {
      settingsUrl: HOSTED_AI_USAGE_RECOVERY_URL,
    },
    key: input.key,
    seed: buildHostedAiUsageNoticeSeed(input),
  }).text;
}

function buildHostedAiUsageNoticeSeed(input: {
  memberId: string;
  noticeCode: HostedAiUsageGateNoticeCode;
  periodStart: Date | null;
}): string {
  const periodStartKey = input.periodStart ? input.periodStart.toISOString() : "none";
  return `linq.ai_usage:${input.memberId}:${input.noticeCode}:${periodStartKey}`;
}

function normalizeTokenCount(value: number | null | undefined): bigint {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    return 0n;
  }

  return BigInt(value);
}

function normalizeHostedAiUsageAllowanceDate(value: Date | string): Date {
  if (value instanceof Date) {
    return new Date(value.getTime());
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError("Hosted AI usage allowance date is invalid.");
  }

  return parsed;
}

function buildUtcCalendarMonthPeriod(at: Date): {
  periodEnd: Date;
  periodStart: Date;
} {
  const periodStart = new Date(Date.UTC(
    at.getUTCFullYear(),
    at.getUTCMonth(),
    1,
    0,
    0,
    0,
    0,
  ));
  const periodEnd = new Date(Date.UTC(
    at.getUTCFullYear(),
    at.getUTCMonth() + 1,
    1,
    0,
    0,
    0,
    0,
  ));

  return {
    periodEnd,
    periodStart,
  };
}
