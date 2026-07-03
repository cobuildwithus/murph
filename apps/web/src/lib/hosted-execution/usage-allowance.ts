import {
  HostedBillingStatus,
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import {
  type AssistantUsageCredentialSource,
  type AssistantUsageRecord,
  type AssistantUsageTokenPricingBasis,
  normalizeAssistantUsageTokenPricingBasis,
} from "@murphai/hosted-execution/assistant-usage";
import {
  isHostedAiUsageOpenAiTokenPricingProviderName,
  normalizeHostedAiUsageAllowanceElevenLabsMusicModelId,
  normalizeHostedAiUsageAllowanceElevenLabsTtsModelId,
  normalizeHostedAiUsageAllowancePricedModelId,
  type HostedAiUsageAllowanceElevenLabsMusicPricedModel,
  type HostedAiUsageAllowanceElevenLabsTtsPricedModel,
  type HostedAiUsageAllowancePricedModel,
  type HostedAiUsageOpenAiFlexTokenPricingModel,
} from "@murphai/hosted-execution/runtime-control";

import {
  HOSTED_PULSE_TRIAL_OFFER,
  HOSTED_PULSE_TRIAL_USAGE_LIMIT_USD_MICROS,
  HOSTED_FAMILY_SPONSORED_USAGE_ALLOWANCE_USD_MICROS,
  getHostedAiUsageMonthlyAllowanceUsdMicros,
  getHostedDefaultBillingPlanCode,
  parseHostedBillingPlanCode,
  parseHostedBillingPhase,
  parseHostedBillingCheckoutOffer,
  requireHostedPulseTrialPolicy,
  type HostedBillingPlanCode,
} from "../hosted-onboarding/billing-plans";
import {
  HOSTED_FAMILY_BILLING_PLAN_CODE,
  readHostedFamilyAccessForMember,
} from "../hosted-onboarding/family-plan";
import {
  hasActiveHostedMemberAccess,
  type HostedMemberPersonAccessState,
  hostedMemberPersonAccessSelect,
} from "../hosted-onboarding/member-access";
import { getPrisma } from "../prisma";
import { sha256Hex } from "../primitives";
import { renderUserFacingMessage } from "../hosted-messages/user-facing-messages";

type HostedAiUsageAllowanceClient = PrismaClient | Prisma.TransactionClient;

export type HostedAiUsageGateDeniedReason =
  | "ai_usage_limit_exceeded"
  | "hosted_access_inactive"
  | "trial_expired_pending_billing";

export type HostedAiUsageGateNoticeCode =
  | "edge_usage_limit_reached"
  | "family_usage_limit_reached"
  | "pulse_upgrade_edge"
  | "trial_usage_limit_reached"
  | "trial_conversion_pending";

export type HostedAiUsageGateDecision =
  | {
    allowed: true;
    billingPlanCode: HostedBillingPlanCode;
    limitUsdMicros: bigint;
    memberId: string;
    periodEnd: Date;
    periodStart: Date;
    remainingUsdMicros: bigint;
    spentUsdMicros: bigint;
  }
  | {
    allowed: false;
    billingPlanCode: HostedBillingPlanCode;
    limitUsdMicros: bigint;
    memberId: string;
    periodEnd: Date;
    periodStart: Date;
    reason: HostedAiUsageGateDeniedReason;
    remainingUsdMicros: bigint;
    retryAfter: Date;
    spentUsdMicros: bigint;
    userNotice: HostedAiUsageGateUserNotice | null;
  };

export interface HostedAiUsageGateUserNotice {
  code: HostedAiUsageGateNoticeCode;
  message: string;
}

export interface HostedAiUsageAllowancePricingResult {
  costUsdMicros: bigint;
  counted: boolean;
  pricingSnapshot: Prisma.InputJsonObject;
  pricingVersion: string;
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

type HostedAiUsageAllowanceSourceKind =
  | "direct_paid_member_plan"
  | "direct_trial"
  | "family_sponsored_pulse";

interface HostedAiUsageAllowanceTokenPricingBasisConfig {
  multiplierDenominator: bigint;
  multiplierNumerator: bigint;
  pricingVersion: string;
  requiredProviderKind: "openai" | null;
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

interface HostedAiUsageAllowancePeriod {
  allowanceSource: HostedAiUsageAllowanceSourceKind;
  billingPlanCode: HostedBillingPlanCode;
  limitUsdMicros: bigint;
  periodEnd: Date;
  periodStart: Date;
  spentUsdMicros: bigint;
}

type HostedAiUsageAllowancePeriodResult =
  | ({ kind: "period" } & HostedAiUsageAllowancePeriod)
  | ({
    kind: "denied";
    spentUsdMicros: bigint;
  } & Extract<HostedAiUsageAllowancePeriodResolution, { kind: "denied" }>);

type HostedAiUsageAllowancePeriodResolution =
  | ({
    kind: "period";
    allowanceSource: HostedAiUsageAllowanceSourceKind;
    source: "billing" | "calendar" | "trial";
  } & Omit<HostedAiUsageAllowancePeriod, "spentUsdMicros">)
  | {
    billingPlanCode: HostedBillingPlanCode;
    kind: "denied";
    limitUsdMicros: bigint;
    periodEnd: Date;
    periodStart: Date;
    reason: Extract<
      HostedAiUsageGateDeniedReason,
      "hosted_access_inactive" | "trial_expired_pending_billing"
    >;
    retryAfter: Date;
    userNotice: HostedAiUsageGateUserNotice | null;
  };

interface HostedAiUsageAllowanceBillingRef {
  allowanceSource?: "family_sponsored_pulse" | null;
  currentBillingPhase: string | null;
  currentBillingPlanCode: string | null;
  currentCheckoutOffer: string | null;
  currentPeriodEnd: Date | null;
  currentPeriodStart: Date | null;
  currentTrialEndsAt: Date | null;
  currentTrialStartedAt: Date | null;
  pulseTrialPolicyVersion: string | null;
  pulseTrialRedeemedAt: Date | null;
  usageLimitUsdMicrosOverride?: bigint | null;
}

async function resolveHostedAiUsageAllowanceBillingRefForMember(input: {
  at: Date;
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
    parseHostedBillingPhase(input.billingRef?.currentBillingPhase) === "paid"
  ) {
    return {
      billingRef: input.billingRef,
      familyAccessActive: false,
    };
  }

  const familyBillingRef = await readHostedFamilySponsoredBillingRefForMember({
    at: input.at,
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
  at: Date;
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
  if (
    billingRef?.currentBillingPlanCode !== HOSTED_FAMILY_BILLING_PLAN_CODE ||
    billingRef.currentBillingPhase !== "paid"
  ) {
    return null;
  }

  const currentPeriodStart = billingRef.currentPeriodStart;
  const currentPeriodEnd = billingRef.currentPeriodEnd;
  if (
    !currentPeriodStart ||
    !currentPeriodEnd ||
    currentPeriodStart.getTime() >= currentPeriodEnd.getTime() ||
    input.at.getTime() < currentPeriodStart.getTime() ||
    input.at.getTime() >= currentPeriodEnd.getTime()
  ) {
    return null;
  }

  return {
    allowanceSource: "family_sponsored_pulse",
    currentBillingPhase: "paid",
    currentBillingPlanCode: "launch_monthly",
    currentCheckoutOffer: null,
    currentPeriodEnd,
    currentPeriodStart,
    currentTrialEndsAt: null,
    currentTrialStartedAt: null,
    pulseTrialPolicyVersion: null,
    pulseTrialRedeemedAt: null,
    usageLimitUsdMicrosOverride: HOSTED_FAMILY_SPONSORED_USAGE_ALLOWANCE_USD_MICROS,
  };
}

interface HostedAiUsageAllowanceThreadContainerRef {
  monthlyUsageLimitUsdMicros: bigint;
  owner: HostedMemberPersonAccessState;
}

const HOSTED_AI_USAGE_ALLOWANCE_PRICING_VERSION = "openai-api-pricing-2026-05-05-standard";
const HOSTED_AI_USAGE_ALLOWANCE_OPENAI_FLEX_PRICING_VERSION =
  "openai-api-pricing-2026-05-05-openai-flex";
const HOSTED_AI_USAGE_ALLOWANCE_PRICING_SOURCE =
  "https://openai.com/api/pricing/";
const HOSTED_AI_USAGE_HOME_URL = "https://withmurph.ai/home";
const TOKENS_PER_PRICING_UNIT = 1_000_000n;

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

const HOSTED_AI_USAGE_ALLOWANCE_MODEL_PRICES = {
  "gpt-5.5": {
    cachedInputUsdMicrosPerMillionTokens: 500_000n,
    inputUsdMicrosPerMillionTokens: 5_000_000n,
    outputUsdMicrosPerMillionTokens: 30_000_000n,
  },
} as const satisfies Record<
  HostedAiUsageAllowancePricedModel,
  {
    cachedInputUsdMicrosPerMillionTokens: bigint;
    inputUsdMicrosPerMillionTokens: bigint;
    outputUsdMicrosPerMillionTokens: bigint;
  }
>;

const HOSTED_AI_USAGE_ALLOWANCE_MODEL_TOKEN_PRICING_BASES = {
  "gpt-5.5": {
    "openai-flex": {
      multiplierDenominator: 2n,
      multiplierNumerator: 1n,
      pricingVersion: HOSTED_AI_USAGE_ALLOWANCE_OPENAI_FLEX_PRICING_VERSION,
      requiredProviderKind: "openai",
    },
    standard: {
      multiplierDenominator: 1n,
      multiplierNumerator: 1n,
      pricingVersion: HOSTED_AI_USAGE_ALLOWANCE_PRICING_VERSION,
      requiredProviderKind: null,
    },
  },
} as const satisfies HostedAiUsageAllowanceTokenPricingBasesByModel;

export function priceHostedAiUsageForAllowance(
  record: AssistantUsageRecord,
): HostedAiUsageAllowancePricingResult {
  const credentialSource = normalizeAssistantUsageCredentialSource(record.credentialSource);
  const counted = credentialSource !== "member";
  const tokenPricingBasis =
    normalizeAssistantUsageTokenPricingBasis(record.tokenPricingBasis);

  if (isHostedAiUsageAllowanceAudioModelRecord(record)) {
    assertHostedAiUsageAllowanceAudioTokenPricingBasis(tokenPricingBasis);
    return priceHostedAiUsageAudioForAllowance({
      counted,
      credentialSource,
      record,
    });
  }

  const ttsMatch = matchHostedAiUsageElevenLabsTtsRecord(record);
  if (ttsMatch !== null) {
    assertHostedAiUsageAllowanceElevenLabsTokenPricingBasis(tokenPricingBasis, "TTS");
    return priceHostedAiUsageElevenLabsTtsForAllowance({
      counted,
      credentialSource,
      match: ttsMatch,
      record,
    });
  }

  const musicMatch = matchHostedAiUsageElevenLabsMusicRecord(record);
  if (musicMatch !== null) {
    assertHostedAiUsageAllowanceElevenLabsTokenPricingBasis(tokenPricingBasis, "Music");
    return priceHostedAiUsageElevenLabsMusicForAllowance({
      counted,
      credentialSource,
      match: musicMatch,
      record,
    });
  }

  const modelResolution = resolveHostedAiUsageAllowancePricingModel(record);
  const tokenSnapshot = buildHostedAiUsageAllowanceTokenSnapshot(record);
  const tokenPricing = tokenPricingBasis === "standard"
    ? null
    : resolveHostedAiUsageAllowanceTokenPricingBasis({
        model: modelResolution.model,
        record,
      });

  if (!counted) {
    return {
      costUsdMicros: 0n,
      counted: false,
      pricingSnapshot: {
        credentialSource,
        ...buildHostedAiUsageAllowanceModelSnapshot(modelResolution),
        pricingSource: HOSTED_AI_USAGE_ALLOWANCE_PRICING_SOURCE,
        schema: "murph.hosted-ai-usage-allowance-pricing.v1",
        tokenPricingBasis,
        tokens: tokenSnapshot,
      },
      pricingVersion: tokenPricing?.pricingVersion ?? HOSTED_AI_USAGE_ALLOWANCE_PRICING_VERSION,
    };
  }

  const model = modelResolution.model;
  if (!model) {
    throw new TypeError("Hosted AI usage allowance pricing is missing for the model.");
  }

  const prices = HOSTED_AI_USAGE_ALLOWANCE_MODEL_PRICES[model];
  const resolvedTokenPricing = tokenPricing
    ?? resolveHostedAiUsageAllowanceTokenPricingBasis({ model, record });
  const cachedInputTokens = normalizeTokenCount(record.cachedInputTokens);
  const inputTokens = normalizeTokenCount(record.inputTokens);
  const outputTokens = normalizeTokenCount(record.outputTokens);
  const billableInputTokens = inputTokens > cachedInputTokens
    ? inputTokens - cachedInputTokens
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
      outputTokens,
      prices.outputUsdMicrosPerMillionTokens,
    );
  const costUsdMicros = applyTokenPricingAdjustmentUsdMicros(
    standardCostUsdMicros,
    resolvedTokenPricing,
  );

  return {
    costUsdMicros,
    counted: true,
    pricingSnapshot: {
      credentialSource,
      ...buildHostedAiUsageAllowanceModelSnapshot(modelResolution),
      pricingSource: HOSTED_AI_USAGE_ALLOWANCE_PRICING_SOURCE,
      ratesUsdMicrosPerMillionTokens: {
        cachedInput: prices.cachedInputUsdMicrosPerMillionTokens.toString(),
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
  };
}

function validateHostedAiUsageAllowanceDeniedTokenPricingBasis(
  record: AssistantUsageRecord,
): AssistantUsageTokenPricingBasis {
  const tokenPricingBasis =
    normalizeAssistantUsageTokenPricingBasis(record.tokenPricingBasis);

  if (tokenPricingBasis === "standard") {
    return tokenPricingBasis;
  }

  if (isHostedAiUsageAllowanceAudioModelRecord(record)) {
    assertHostedAiUsageAllowanceAudioTokenPricingBasis(tokenPricingBasis);
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
}): Promise<void> {
  const now = input.now ?? new Date();
  const at = normalizeHostedAiUsageAllowanceDate(input.record.occurredAt);
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
          currentTrialEndsAt: true,
          currentTrialStartedAt: true,
          pulseTrialPolicyVersion: true,
          pulseTrialRedeemedAt: true,
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
    },
  });
  if (!memberState) {
    throw new TypeError("Hosted AI usage allowance member does not exist.");
  }
  const allowanceAccess = memberState.suspendedAt === null
    ? await resolveHostedAiUsageAllowanceBillingRefForMember({
        at,
        billingRef: memberState.billingRef,
        billingStatus: memberState.billingStatus,
        memberId: input.memberId,
        tx: input.tx,
      })
    : {
        billingRef: memberState.billingRef,
        familyAccessActive: false,
      };
  const period = await ensureHostedAiUsageAllowancePeriodTx({
    at,
    billingRef: allowanceAccess.billingRef,
    memberId: input.memberId,
    now,
    threadContainer: memberState.threadContainer,
    tx: input.tx,
  });
  if (period.kind === "denied") {
    await markHostedAiUsageAllowanceDeniedTx({
      memberId: input.memberId,
      now,
      period,
      record: input.record,
      tx: input.tx,
    });
    return;
  }

  const priced = priceHostedAiUsageForAllowance(input.record);

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
    return;
  }

  await accountHostedAiUsageAllowancePeriodSpendTx({
    costUsdMicros: priced.costUsdMicros,
    memberId: input.memberId,
    now,
    period,
    recordOccurredAt: normalizeHostedAiUsageAllowanceDate(input.record.occurredAt),
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
}): Promise<HostedAiUsageGateDecision> {
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
            currentTrialEndsAt: true,
            currentTrialStartedAt: true,
            pulseTrialPolicyVersion: true,
            pulseTrialRedeemedAt: true,
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
      },
    });

    if (!memberState) {
      throw new TypeError("Hosted AI usage allowance member does not exist.");
    }

    const allowanceAccess = memberState.suspendedAt === null
      ? await resolveHostedAiUsageAllowanceBillingRefForMember({
          at: now,
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

    if (
      memberState.suspendedAt !== null ||
      (
        memberState.billingStatus !== HostedBillingStatus.active &&
        !familyAccessActive
      )
    ) {
      return resolveHostedAiUsageInactiveGateDecision({
        at: now,
        billingRef: allowanceBillingRef,
        memberId: input.memberId,
        threadContainer: memberState.threadContainer,
      });
    }

    const period = await ensureHostedAiUsageAllowancePeriodTx({
      at: now,
      billingRef: allowanceBillingRef,
      memberId: input.memberId,
      now,
      threadContainer: memberState.threadContainer,
      tx,
    });
    if (period.kind === "denied") {
      return buildHostedAiUsageGateDecision({
        memberId: input.memberId,
        period,
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
}): Promise<HostedAiUsageGateDecision> {
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
            currentTrialEndsAt: true,
            currentTrialStartedAt: true,
            pulseTrialPolicyVersion: true,
            pulseTrialRedeemedAt: true,
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
      },
    });

    if (!memberState) {
      throw new TypeError("Hosted AI usage allowance member does not exist.");
    }

    const allowanceAccess = memberState.suspendedAt === null
      ? await resolveHostedAiUsageAllowanceBillingRefForMember({
          at: now,
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

    if (
      memberState.suspendedAt !== null ||
      (
        memberState.billingStatus !== HostedBillingStatus.active &&
        !familyAccessActive
      )
    ) {
      return resolveHostedAiUsageInactiveGateDecision({
        at: now,
        billingRef: allowanceBillingRef,
        memberId: input.memberId,
        threadContainer: memberState.threadContainer,
      });
    }

    const period = await readHostedAiUsageAllowancePeriodTx({
      at: now,
      billingRef: allowanceBillingRef,
      memberId: input.memberId,
      threadContainer: memberState.threadContainer,
      tx,
    });

    return buildHostedAiUsageGateDecision({
      memberId: input.memberId,
      period,
    });
  });
}

// Read-first gate for hot-path checks: serve allow decisions from the
// write-free read gate and only run the mutating period-bookkeeping
// transaction when the read decision would block AI work, so steady-state
// gate checks stay off the usage-period create/lock path. Denials are always
// confirmed by the mutating gate before callers act on them. The read path
// cannot materialize period rows, plan-change limit updates, or blocked notice
// metadata. The guaranteed mutating resolve on the reply path is turn
// admission (runtime reconciliation facts); spend accounting also
// ensure-creates the period inside the spend transaction as the backstop.
export async function checkHostedAiUsageGate(input: {
  memberId: string;
  now?: Date | string;
  prisma?: HostedAiUsageAllowanceClient;
}): Promise<HostedAiUsageGateDecision> {
  const decision = await readHostedAiUsageGate(input);
  if (decision.allowed) {
    return decision;
  }

  return resolveHostedAiUsageGate(input);
}

export function buildHostedAiUsageGateNoticeIdempotencyKey(input: {
  memberId: string;
  noticeCode: HostedAiUsageGateNoticeCode | string;
  periodStart: Date | string;
}): string {
  const periodStart = normalizeHostedAiUsageAllowanceDate(input.periodStart);

  return `ai-usage-gate:${sha256Hex(JSON.stringify({
    memberId: input.memberId,
    noticeCode: input.noticeCode,
    periodStart: periodStart.toISOString(),
  })).slice(0, 32)}`;
}

export async function claimHostedAiUsageLimitNotice(input: {
  memberId: string;
  periodStart: Date | string;
  prisma?: HostedAiUsageAllowanceClient;
  sentAt?: Date | string;
}): Promise<boolean> {
  const prisma = input.prisma ?? getPrisma();
  const periodStart = normalizeHostedAiUsageAllowanceDate(input.periodStart);
  const sentAt = normalizeHostedAiUsageAllowanceDate(input.sentAt ?? new Date());

  const claimed = await prisma.hostedAiUsagePeriod.updateMany({
    where: {
      AND: [
        {
          periodStart: {
            lte: sentAt,
          },
        },
        {
          periodEnd: {
            gt: sentAt,
          },
        },
      ],
      blockedAt: {
        not: null,
      },
      limitNoticeSentAt: null,
      memberId: input.memberId,
      periodStart,
    },
    data: {
      limitNoticeSentAt: sentAt,
    },
  });

  return claimed.count === 1;
}

export async function releaseHostedAiUsageLimitNotice(input: {
  memberId: string;
  periodStart: Date | string;
  prisma?: HostedAiUsageAllowanceClient;
  sentAt: Date | string;
}): Promise<void> {
  const prisma = input.prisma ?? getPrisma();

  await prisma.hostedAiUsagePeriod.updateMany({
    where: {
      limitNoticeSentAt: normalizeHostedAiUsageAllowanceDate(input.sentAt),
      memberId: input.memberId,
      periodStart: normalizeHostedAiUsageAllowanceDate(input.periodStart),
    },
    data: {
      limitNoticeSentAt: null,
    },
  });
}

function resolveHostedAiUsageInactiveGateDecision(input: {
  at: Date;
  billingRef: HostedAiUsageAllowanceBillingRef | null;
  memberId: string;
  threadContainer?: HostedAiUsageAllowanceThreadContainerRef | null;
}): HostedAiUsageGateDecision {
  const resolved = resolveHostedAiUsageAllowancePeriod({
    at: input.at,
    billingRef: input.billingRef,
    memberId: input.memberId,
    threadContainer: input.threadContainer ?? null,
  });
  const period = resolved.kind === "denied"
    ? resolved
    : {
        billingPlanCode: resolved.billingPlanCode,
        limitUsdMicros: resolved.limitUsdMicros,
        periodEnd: resolved.periodEnd,
        periodStart: resolved.periodStart,
      };
  const retryAfter = period.periodEnd.getTime() > input.at.getTime()
    ? period.periodEnd
    : new Date(input.at.getTime() + 15 * 60_000);

  return {
    allowed: false,
    billingPlanCode: period.billingPlanCode,
    limitUsdMicros: period.limitUsdMicros,
    memberId: input.memberId,
    periodEnd: period.periodEnd,
    periodStart: period.periodStart,
    reason: "hosted_access_inactive",
    remainingUsdMicros: period.limitUsdMicros,
    retryAfter,
    spentUsdMicros: 0n,
    userNotice: null,
  };
}

function buildHostedAiUsageGateDecision(input: {
  memberId: string;
  period: HostedAiUsageAllowancePeriodResult;
}): HostedAiUsageGateDecision {
  const period = input.period;
  if (period.kind === "denied") {
    return {
      allowed: false,
      billingPlanCode: period.billingPlanCode,
      limitUsdMicros: period.limitUsdMicros,
      memberId: input.memberId,
      periodEnd: period.periodEnd,
      periodStart: period.periodStart,
      reason: period.reason,
      remainingUsdMicros: 0n,
      retryAfter: period.retryAfter,
      spentUsdMicros: period.spentUsdMicros,
      userNotice: period.userNotice,
    };
  }

  const remainingUsdMicros = period.limitUsdMicros > period.spentUsdMicros
    ? period.limitUsdMicros - period.spentUsdMicros
    : 0n;

  if (period.spentUsdMicros >= period.limitUsdMicros) {
    return {
      allowed: false,
      billingPlanCode: period.billingPlanCode,
      limitUsdMicros: period.limitUsdMicros,
      memberId: input.memberId,
      periodEnd: period.periodEnd,
      periodStart: period.periodStart,
      reason: "ai_usage_limit_exceeded",
      remainingUsdMicros,
      retryAfter: period.periodEnd,
      spentUsdMicros: period.spentUsdMicros,
      userNotice: buildHostedAiUsageGateLimitNotice({
        allowanceSource: period.allowanceSource,
        billingPlanCode: period.billingPlanCode,
        limitUsdMicros: period.limitUsdMicros,
        memberId: input.memberId,
        periodStart: period.periodStart,
      }),
    };
  }

  return {
    allowed: true,
    billingPlanCode: period.billingPlanCode,
    limitUsdMicros: period.limitUsdMicros,
    memberId: input.memberId,
    periodEnd: period.periodEnd,
    periodStart: period.periodStart,
    remainingUsdMicros,
    spentUsdMicros: period.spentUsdMicros,
  };
}

async function ensureHostedAiUsageAllowancePeriodTx(input: {
  at: Date;
  billingRef: HostedAiUsageAllowanceBillingRef | null;
  memberId: string;
  now: Date;
  threadContainer?: HostedAiUsageAllowanceThreadContainerRef | null;
  tx: Prisma.TransactionClient;
}): Promise<HostedAiUsageAllowancePeriodResult> {
  const resolved = resolveHostedAiUsageAllowancePeriod({
    at: input.at,
    billingRef: input.billingRef,
    memberId: input.memberId,
    threadContainer: input.threadContainer ?? null,
  });
  if (resolved.kind === "denied") {
    return {
      kind: "denied",
      billingPlanCode: resolved.billingPlanCode,
      limitUsdMicros: resolved.limitUsdMicros,
      periodEnd: resolved.periodEnd,
      periodStart: resolved.periodStart,
      reason: resolved.reason,
      retryAfter: resolved.retryAfter,
      spentUsdMicros: 0n,
      userNotice: resolved.userNotice,
    };
  }

  await input.tx.hostedAiUsagePeriod.createMany({
    data: {
      billingPlanCode: resolved.billingPlanCode,
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
      lastUsageAt: true,
      limitNoticeSentAt: true,
      limitUsdMicros: true,
      periodEnd: true,
      periodStart: true,
      spentUsdMicros: true,
    },
  });

  const currentBillingPlanCode = parseHostedBillingPlanCode(current.billingPlanCode)
    ?? resolved.billingPlanCode;
  const periodMatches =
    currentBillingPlanCode === resolved.billingPlanCode &&
    current.limitUsdMicros === resolved.limitUsdMicros &&
    current.periodEnd.getTime() === resolved.periodEnd.getTime();

  if (periodMatches) {
    const metadata = buildHostedAiUsageAllowancePeriodMetadata({
      blockedAt: current.blockedAt,
      limitNoticeSentAt: current.limitNoticeSentAt,
      limitUsdMicros: current.limitUsdMicros,
      now: input.now,
      spentUsdMicros: current.spentUsdMicros,
    });

    if (
      !sameNullableTime(current.blockedAt, metadata.blockedAt) ||
      !sameNullableTime(current.limitNoticeSentAt, metadata.limitNoticeSentAt)
    ) {
      await input.tx.hostedAiUsagePeriod.update({
        where: {
          memberId_periodStart: {
            memberId: input.memberId,
            periodStart: resolved.periodStart,
          },
        },
        data: {
          blockedAt: metadata.blockedAt,
          limitNoticeSentAt: metadata.limitNoticeSentAt,
          updatedAt: input.now,
        },
      });
    }

    return {
      kind: "period",
      allowanceSource: resolved.allowanceSource,
      billingPlanCode: currentBillingPlanCode,
      limitUsdMicros: current.limitUsdMicros,
      periodEnd: current.periodEnd,
      periodStart: current.periodStart,
      spentUsdMicros: current.spentUsdMicros,
    };
  }

  const limitIncreased = current.limitUsdMicros < resolved.limitUsdMicros;
  const metadata = buildHostedAiUsageAllowancePeriodMetadata({
    blockedAt: current.blockedAt,
    limitNoticeSentAt: current.limitNoticeSentAt,
    limitUsdMicros: resolved.limitUsdMicros,
    now: input.now,
    spentUsdMicros: current.spentUsdMicros,
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
      blockedAt: metadata.blockedAt,
      limitUsdMicros: resolved.limitUsdMicros,
      limitNoticeSentAt: limitIncreased ? null : metadata.limitNoticeSentAt,
      periodEnd: resolved.periodEnd,
      updatedAt: input.now,
    },
    select: {
      billingPlanCode: true,
      limitUsdMicros: true,
      periodEnd: true,
      periodStart: true,
      spentUsdMicros: true,
    },
  });

  return {
    kind: "period",
    allowanceSource: resolved.allowanceSource,
    billingPlanCode: parseHostedBillingPlanCode(upgraded.billingPlanCode)
      ?? resolved.billingPlanCode,
    limitUsdMicros: upgraded.limitUsdMicros,
    periodEnd: upgraded.periodEnd,
    periodStart: upgraded.periodStart,
    spentUsdMicros: upgraded.spentUsdMicros,
  };
}

async function readHostedAiUsageAllowancePeriodTx(input: {
  at: Date;
  billingRef: HostedAiUsageAllowanceBillingRef | null;
  memberId: string;
  threadContainer?: HostedAiUsageAllowanceThreadContainerRef | null;
  tx: Prisma.TransactionClient;
}): Promise<HostedAiUsageAllowancePeriodResult> {
  const resolved = resolveHostedAiUsageAllowancePeriod({
    at: input.at,
    billingRef: input.billingRef,
    memberId: input.memberId,
    threadContainer: input.threadContainer ?? null,
  });
  if (resolved.kind === "denied") {
    return {
      kind: "denied",
      billingPlanCode: resolved.billingPlanCode,
      limitUsdMicros: resolved.limitUsdMicros,
      periodEnd: resolved.periodEnd,
      periodStart: resolved.periodStart,
      reason: resolved.reason,
      retryAfter: resolved.retryAfter,
      spentUsdMicros: 0n,
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
      limitUsdMicros: true,
      periodEnd: true,
      periodStart: true,
      spentUsdMicros: true,
    },
  });

  if (current) {
    const currentBillingPlanCode = parseHostedBillingPlanCode(current.billingPlanCode)
      ?? resolved.billingPlanCode;
    const periodMatches =
      currentBillingPlanCode === resolved.billingPlanCode &&
      current.limitUsdMicros === resolved.limitUsdMicros &&
      current.periodEnd.getTime() === resolved.periodEnd.getTime();
    const limitUsdMicros = periodMatches ? current.limitUsdMicros : resolved.limitUsdMicros;

    return {
      kind: "period",
      allowanceSource: resolved.allowanceSource,
      billingPlanCode: periodMatches ? currentBillingPlanCode : resolved.billingPlanCode,
      limitUsdMicros,
      periodEnd: periodMatches ? current.periodEnd : resolved.periodEnd,
      periodStart: periodMatches ? current.periodStart : resolved.periodStart,
      spentUsdMicros: current.spentUsdMicros,
    };
  }

  return {
    kind: "period",
    allowanceSource: resolved.allowanceSource,
    billingPlanCode: resolved.billingPlanCode,
    limitUsdMicros: resolved.limitUsdMicros,
    periodEnd: resolved.periodEnd,
    periodStart: resolved.periodStart,
    spentUsdMicros: 0n,
  };
}

async function accountHostedAiUsageAllowancePeriodSpendTx(input: {
  costUsdMicros: bigint;
  memberId: string;
  now: Date;
  period: Extract<HostedAiUsageAllowancePeriodResult, { kind: "period" }>;
  recordOccurredAt: Date;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  await input.tx.$executeRaw`
    UPDATE "hosted_ai_usage_period"
    SET
      "spent_usd_micros" = "spent_usd_micros" + ${input.costUsdMicros},
      "last_usage_at" = GREATEST(COALESCE("last_usage_at", ${input.recordOccurredAt}), ${input.recordOccurredAt}),
      "limit_notice_sent_at" = CASE
        WHEN "spent_usd_micros" < "limit_usd_micros" THEN NULL
        ELSE "limit_notice_sent_at"
      END,
      "blocked_at" = CASE
        WHEN "spent_usd_micros" + ${input.costUsdMicros} >= "limit_usd_micros" THEN
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
}

function resolveHostedAiUsageAllowancePeriod(input: {
  at: Date;
  billingRef: HostedAiUsageAllowanceBillingRef | null;
  memberId: string;
  threadContainer?: HostedAiUsageAllowanceThreadContainerRef | null;
}): HostedAiUsageAllowancePeriodResolution {
  const billingPlanCode =
    parseHostedBillingPlanCode(input.billingRef?.currentBillingPlanCode)
    ?? getHostedDefaultBillingPlanCode();
  const billingPhase = parseHostedBillingPhase(input.billingRef?.currentBillingPhase);
  const checkoutOffer = parseHostedBillingCheckoutOffer(input.billingRef?.currentCheckoutOffer);

  if (input.threadContainer) {
    const period = resolveHostedAiUsageBillingOrCalendarPeriod({
      at: input.at,
      billingRef: input.billingRef,
    });
    const threadContainerLimitUsdMicros =
      normalizeHostedThreadContainerUsageLimitUsdMicros(input.threadContainer);

    if (
      threadContainerLimitUsdMicros === null
      || !hasActiveHostedMemberAccess(input.threadContainer.owner)
    ) {
      return {
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
      allowanceSource: "direct_paid_member_plan",
      billingPlanCode,
      kind: "period",
      limitUsdMicros: threadContainerLimitUsdMicros,
      periodEnd: period.periodEnd,
      periodStart: period.periodStart,
      source: period.source,
    };
  }

  if (
    billingPhase !== "paid" &&
    (checkoutOffer === HOSTED_PULSE_TRIAL_OFFER || billingPhase === "trial")
  ) {
    return resolveHostedPulseTrialAllowancePeriod({
      at: input.at,
      billingPlanCode,
      billingRef: input.billingRef,
      memberId: input.memberId,
      billingPhase,
      checkoutOffer,
    });
  }

  if (input.billingRef && billingPhase !== "paid" && input.billingRef.pulseTrialRedeemedAt) {
    return buildHostedPulseTrialPendingBillingDeniedPeriod({
      at: input.at,
      billingPlanCode,
      periodEnd: input.billingRef.currentTrialEndsAt,
      memberId: input.memberId,
      periodStart: input.billingRef.currentTrialStartedAt,
    });
  }

  const period = resolveHostedAiUsageBillingOrCalendarPeriod({
    at: input.at,
    billingRef: input.billingRef,
  });

  return {
    allowanceSource:
      input.billingRef?.allowanceSource === "family_sponsored_pulse"
        ? "family_sponsored_pulse"
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

function resolveHostedPulseTrialAllowancePeriod(input: {
  at: Date;
  billingPhase: ReturnType<typeof parseHostedBillingPhase>;
  billingPlanCode: HostedBillingPlanCode;
  billingRef: HostedAiUsageAllowanceBillingRef | null;
  memberId: string;
  checkoutOffer: ReturnType<typeof parseHostedBillingCheckoutOffer>;
}): HostedAiUsageAllowancePeriodResolution {
  const trialPolicy = requireHostedPulseTrialPolicy(input.billingRef?.pulseTrialPolicyVersion);
  const trialStart = input.billingRef?.currentTrialStartedAt ?? null;
  const trialEnd = input.billingRef?.currentTrialEndsAt ?? null;

  if (
    input.billingPhase !== "trial" ||
    input.checkoutOffer !== HOSTED_PULSE_TRIAL_OFFER ||
    input.billingPlanCode !== "launch_monthly" ||
    !trialPolicy ||
    !trialStart ||
    !trialEnd ||
    trialStart.getTime() >= trialEnd.getTime() ||
    input.at.getTime() < trialStart.getTime() ||
    input.at.getTime() >= trialEnd.getTime()
  ) {
    return buildHostedPulseTrialPendingBillingDeniedPeriod({
      at: input.at,
      billingPlanCode: input.billingPlanCode,
      periodEnd: trialEnd,
      memberId: input.memberId,
      periodStart: trialStart,
      trialPolicy,
    });
  }

  return {
    allowanceSource: "direct_trial",
    billingPlanCode: "launch_monthly",
    kind: "period",
    limitUsdMicros: trialPolicy.usageLimitUsdMicros,
    periodEnd: trialEnd,
    periodStart: trialStart,
    source: "trial",
  };
}

function buildHostedPulseTrialPendingBillingDeniedPeriod(input: {
  at: Date;
  billingPlanCode: HostedBillingPlanCode;
  memberId: string;
  periodEnd: Date | null;
  periodStart: Date | null;
  trialPolicy?: ReturnType<typeof requireHostedPulseTrialPolicy>;
}): Extract<HostedAiUsageAllowancePeriodResolution, { kind: "denied" }> {
  const retryAfter = new Date(input.at.getTime() + 15 * 60_000);
  const periodStart = input.periodStart ?? input.at;
  const noticePeriodStart = input.periodStart ?? null;

  return {
    billingPlanCode: input.billingPlanCode,
    kind: "denied",
    limitUsdMicros: input.trialPolicy?.usageLimitUsdMicros ?? 0n,
    periodEnd: input.periodEnd ?? retryAfter,
    periodStart,
    reason: "trial_expired_pending_billing",
    retryAfter,
    userNotice: {
      code: "trial_conversion_pending",
      message: renderUserFacingMessage({
        context: {
          homeUrl: HOSTED_AI_USAGE_HOME_URL,
        },
        key: "linq.ai_usage.trial_conversion_pending",
        seed: buildHostedAiUsageNoticeSeed({
          memberId: input.memberId,
          noticeCode: "trial_conversion_pending",
          periodStart: noticePeriodStart,
        }),
      }).text,
    },
  };
}

function buildHostedAiUsageAllowancePeriodMetadata(input: {
  blockedAt: Date | null;
  limitNoticeSentAt: Date | null;
  limitUsdMicros: bigint;
  now: Date;
  spentUsdMicros: bigint;
}): {
  blockedAt: Date | null;
  limitNoticeSentAt: Date | null;
} {
  if (input.spentUsdMicros < input.limitUsdMicros) {
    return {
      blockedAt: null,
      limitNoticeSentAt: null,
    };
  }

  return {
    blockedAt: input.blockedAt ?? input.now,
    limitNoticeSentAt: input.limitNoticeSentAt,
  };
}

function sameNullableTime(left: Date | null, right: Date | null): boolean {
  return left?.getTime() === right?.getTime();
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

async function runHostedAiUsageAllowanceTransaction<T>(
  prisma: HostedAiUsageAllowanceClient,
  run: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const maybeTransaction = prisma as {
    $transaction?: <R>(
      run: (tx: Prisma.TransactionClient) => Promise<R>,
    ) => Promise<R>;
  };

  if (typeof maybeTransaction.$transaction === "function") {
    return maybeTransaction.$transaction(run);
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

  const config = HOSTED_AI_USAGE_ALLOWANCE_MODEL_TOKEN_PRICING_BASES[
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
): Prisma.InputJsonObject {
  return {
    model: resolution.model,
    modelSource: resolution.source,
    requestedModel: resolution.requestedModel,
    servedModel: resolution.servedModel,
  };
}

function buildHostedAiUsageGateLimitNotice(input: {
  allowanceSource: HostedAiUsageAllowanceSourceKind;
  billingPlanCode: HostedBillingPlanCode;
  limitUsdMicros: bigint;
  memberId: string;
  periodStart: Date;
}): HostedAiUsageGateUserNotice {
  if (
    input.billingPlanCode === "launch_monthly" &&
    input.limitUsdMicros === HOSTED_PULSE_TRIAL_USAGE_LIMIT_USD_MICROS
  ) {
    return {
      code: "trial_usage_limit_reached",
      message: renderHostedAiUsageGateLimitNoticeMessage({
        key: "linq.ai_usage.trial_limit_reached",
        memberId: input.memberId,
        noticeCode: "trial_usage_limit_reached",
        periodStart: input.periodStart,
      }),
    };
  }

  const base = "Hey, you've reached your usage limit for the month.";

  if (input.allowanceSource === "family_sponsored_pulse") {
    return {
      code: "family_usage_limit_reached",
      message: `${base} Murph will resume when your Family usage resets.`,
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
    | "linq.ai_usage.pulse_upgrade_edge"
    | "linq.ai_usage.trial_limit_reached";
  memberId: string;
  noticeCode: HostedAiUsageGateNoticeCode;
  periodStart: Date;
}): string {
  return renderUserFacingMessage({
    context: {
      homeUrl: HOSTED_AI_USAGE_HOME_URL,
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
  const periodStartKey = input.periodStart ? input.periodStart.toISOString() : "pending-billing";
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
