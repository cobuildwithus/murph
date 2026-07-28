import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import {
  buildHostedExecutionAssistantNotificationRequestedWake,
} from "@murphai/hosted-execution";
import {
  HOSTED_ASSISTANT_SOL_MODEL,
  HOSTED_ASSISTANT_TERRA_MODEL,
  type HostedAssistantProductModel,
} from "@murphai/hosted-execution/assistant-model";
import {
  HOSTED_USAGE_REFERRAL_POLICY_CODES,
  type HostedRuntimeGroupToolRequest,
  type HostedRuntimeGroupToolResponse,
  type HostedRuntimeUsageReferralSnapshot,
  type HostedRuntimeUsageReferralSourceConversation,
  type HostedUsageReferralPolicyCode,
} from "@murphai/hosted-execution/runtime-control";
import {
  resolveAssistantEffectiveStyle,
  type AssistantTonePreference,
} from "@murphai/contracts";

import { appendHostedMailboxEnvelopeTx } from "../hosted-mailbox/store";
import { readHostedGroupUsageStatus } from "../hosted-groups/group-usage-funding";
import {
  lookupHostedGroupParticipantMemberByHandle,
} from "../hosted-groups/participant-member";
import {
  appendHostedUsageCreditGrantTx,
} from "../hosted-execution/usage-credit-grant";
import {
  lockHostedUsageCreditBeneficiaryTx,
} from "../hosted-execution/usage-credit-ledger";
import { readHostedPersonalAiUsageStatus } from "../hosted-execution/usage-status";
import {
  createHostedEmailLookupKey,
  createHostedPhoneLookupKey,
  createHostedTelegramUserLookupKey,
  parseHostedBlindIndex,
} from "../hosted-onboarding/contact-privacy";
import { readActiveHostedMemberAccess } from "../hosted-onboarding/member-access";
import {
  resolveHostedMemberRoutingByTelegramUserId,
} from "../hosted-onboarding/hosted-member-routing-store";
import {
  readHostedMemberAssistantModelPreference,
} from "../hosted-onboarding/assistant-model-preference";
import {
  readHostedMemberAssistantPreferences,
} from "../hosted-onboarding/member-preferences";
import { normalizePhoneNumber } from "../hosted-onboarding/phone";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
} from "../hosted-onboarding/shared";
import type { HostedWebhookWakeHandoff } from "../hosted-onboarding/webhook-service-types";
import {
  resolveHostedAssistantNotificationDestination,
  type HostedAssistantNotificationDestination,
} from "../hosted-routing/assistant-notification-destination";
import { generateHostedRandomPrefixedId } from "../primitives";
import { getPrisma } from "../prisma";

export const HOSTED_USAGE_REFERRAL_POLICY_VERSION =
  "hosted-usage-referral-2026-07-v1";
export const HOSTED_USAGE_REFERRALS_ENABLED_ENV =
  "HOSTED_USAGE_REFERRALS_ENABLED";
export const HOSTED_USAGE_REFERRAL_INTENT_TTL_MS =
  7 * 24 * 60 * 60 * 1_000;
export const HOSTED_USAGE_REFERRAL_LATE_EVIDENCE_GRACE_MS =
  25 * 60 * 60 * 1_000;
export const HOSTED_USAGE_REFERRAL_PERSON_REWARD_USD_MICROS = 2_000_000n;
export const HOSTED_USAGE_REFERRAL_GROUP_REWARD_USD_MICROS = 3_500_000n;
export const HOSTED_USAGE_REFERRAL_GROUP_REQUIRED_MESSAGES = 15;
export const HOSTED_USAGE_REFERRAL_GROUP_REQUIRED_NON_REFERRER_MESSAGES = 8;
export const HOSTED_USAGE_REFERRAL_GROUP_REQUIRED_NON_REFERRER_SPEAKERS = 2;
export const HOSTED_USAGE_REFERRAL_GROUP_MINIMUM_ACTIVITY_SPAN_MS =
  10 * 60 * 1_000;
export const HOSTED_USAGE_REFERRAL_REFERRER_30D_CAP_USD_MICROS = 10_500_000n;
export const HOSTED_USAGE_REFERRAL_BENEFICIARY_30D_CAP_USD_MICROS = 20_000_000n;

const HOSTED_USAGE_REFERRAL_MAX_BOUND_PER_REFERRER = 3;
const HOSTED_USAGE_REFERRAL_EVENT_KEYS_MAX = 32;
const HOSTED_USAGE_REFERRAL_SPEAKER_KEYS_MAX = 16;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1_000;
const ACTIVE_REFERRAL_STATUSES = ["armed", "target_bound"] as const;
const EXPECTED_REFERRAL_UNAVAILABLE_ERRORS = new Set([
  "destination_reward_cap_reached",
  "referrer_reward_cap_reached",
  "too_many_referrals_in_progress",
  "usage_referral_not_available",
]);

type HostedUsageReferralPolicyDefinition = {
  code: HostedUsageReferralPolicyCode;
  messageEstimates: {
    sol: number;
    terra: number;
  };
  requirementsLabel: string;
  rewardUsdMicros: bigint;
};

const POLICIES = {
  new_person_activation_v1: {
    code: "new_person_activation_v1",
    messageEstimates: {
      sol: 50,
      terra: 100,
    },
    requirementsLabel:
      "Start a fresh group with one new person, help them get their own Murph set up, then have them say hi in that group.",
    rewardUsdMicros: HOSTED_USAGE_REFERRAL_PERSON_REWARD_USD_MICROS,
  },
  active_group_v1: {
    code: "active_group_v1",
    messageEstimates: {
      sol: 70,
      terra: 140,
    },
    requirementsLabel:
      "Start a fresh group and make it genuinely active, with multiple people actually talking.",
    rewardUsdMicros: HOSTED_USAGE_REFERRAL_GROUP_REWARD_USD_MICROS,
  },
} as const satisfies Record<
  HostedUsageReferralPolicyCode,
  HostedUsageReferralPolicyDefinition
>;

interface HostedUsageReferralActor {
  beneficiaryMemberId: string;
  referrerMemberId: string;
  referrerSubjectKey: string;
}

interface HostedUsageReferralCelebrationStyleBand {
  humor: number;
  tone: AssistantTonePreference;
  unhinged: number;
}

export function buildHostedUsageReferralRewardLabel(input: {
  destinationKind: "group" | "personal";
  model: HostedAssistantProductModel;
  policyCode: HostedUsageReferralPolicyCode;
}): string {
  const subject = input.destinationKind === "group"
    ? "this room"
    : "your Murph";
  const estimate = input.model === HOSTED_ASSISTANT_SOL_MODEL
    ? POLICIES[input.policyCode].messageEstimates.sol
    : input.model === HOSTED_ASSISTANT_TERRA_MODEL
      ? POLICIES[input.policyCode].messageEstimates.terra
      : null;
  return estimate === null
    ? `bonus usage on the model ${subject} is using now`
    : `about ${estimate} more messages on the model ${subject} is using now`;
}

function outstandingHostedUsageReferralCommitmentWhere(
  now: Date,
): Prisma.HostedUsageReferralWhereInput[] {
  const lateEvidenceCutoff = new Date(
    now.getTime() - HOSTED_USAGE_REFERRAL_LATE_EVIDENCE_GRACE_MS,
  );
  return [
    {
      expiresAt: { gt: now },
      status: "armed",
    },
    {
      expiresAt: { gt: lateEvidenceCutoff },
      status: "target_bound",
    },
    {
      qualifiedAt: { not: null },
      status: "target_bound",
    },
  ];
}

interface HostedUsageReferralLockedRow {
  armedAt: Date;
  beneficiaryMemberId: string;
  expiresAt: Date;
  firstHumanMessageAt: Date | null;
  humanMessageCount: number;
  id: string;
  introducedMemberId: string | null;
  lastHumanMessageAt: Date | null;
  nonReferrerMessageCount: number;
  observedEventKeysJson: Prisma.JsonValue | null;
  observedSpeakerKeysJson: Prisma.JsonValue | null;
  policyCode: HostedUsageReferralPolicyCode;
  qualifiedAt: Date | null;
  referrerMemberId: string | null;
  referrerSubjectKey: string | null;
  rewardUsdMicros: bigint;
  status: string;
  targetBoundAt: Date | null;
  targetContainerMemberId: string | null;
}

const CLEARED_REFERRAL_EVIDENCE = {
  firstHumanMessageAt: null,
  humanMessageCount: 0,
  lastHumanMessageAt: null,
  nonReferrerMessageCount: 0,
  observedEventKeysJson: Prisma.DbNull,
  observedSpeakerKeysJson: Prisma.DbNull,
  referrerSubjectKey: null,
} as const;

export interface HostedUsageReferralObservationResult {
  isBoundReferralTarget: boolean;
  qualificationCandidateReferralId: string | null;
}

export interface HostedUsageReferralBindResult {
  referralId: string | null;
}

export function isHostedUsageReferralEnabled(
  source: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return source[HOSTED_USAGE_REFERRALS_ENABLED_ENV] === "1";
}

export function qualifiesHostedActiveGroupReferral(input: {
  firstHumanMessageAt: Date | null;
  humanMessageCount: number;
  lastHumanMessageAt: Date | null;
  nonReferrerMessageCount: number;
  nonReferrerSpeakerCount: number;
}): boolean {
  if (
    input.humanMessageCount < HOSTED_USAGE_REFERRAL_GROUP_REQUIRED_MESSAGES
    || input.nonReferrerMessageCount
      < HOSTED_USAGE_REFERRAL_GROUP_REQUIRED_NON_REFERRER_MESSAGES
    || input.nonReferrerSpeakerCount
      < HOSTED_USAGE_REFERRAL_GROUP_REQUIRED_NON_REFERRER_SPEAKERS
    || !input.firstHumanMessageAt
    || !input.lastHumanMessageAt
  ) {
    return false;
  }

  return input.lastHumanMessageAt.getTime()
    - input.firstHumanMessageAt.getTime()
    >= HOSTED_USAGE_REFERRAL_GROUP_MINIMUM_ACTIVITY_SPAN_MS;
}

export async function handleHostedUsageReferralGroupTool(input: {
  enabled?: boolean;
  memberId: string;
  request: Extract<
    HostedRuntimeGroupToolRequest,
    {
      action:
        | "arm_usage_referral"
        | "cancel_usage_referral"
        | "read_usage_referral";
    }
  >;
  prisma?: PrismaClient;
}): Promise<HostedRuntimeGroupToolResponse> {
  if (!(input.enabled ?? isHostedUsageReferralEnabled())) {
    return unavailableToolResponse(
      input.request.action,
      "usage_referral_not_available",
    );
  }

  const prisma = input.prisma ?? getPrisma();

  try {
    const actor = await resolveHostedUsageReferralActor({
      linqSenderHandles: input.request.linqSenderHandles ?? [],
      memberId: input.memberId,
      prisma,
      telegramSenderHandles: input.request.telegramSenderHandles ?? [],
    });
    if (!actor) {
      return unavailableToolResponse(
        input.request.action,
        "usage_referral_not_available",
      );
    }

    if (input.request.action === "read_usage_referral") {
      return {
        action: input.request.action,
        result: {
          outcome: "read",
          referral: await readHostedUsageReferralSnapshot({ actor, prisma }),
          status: "ok",
        },
      };
    }

    if (input.request.action === "cancel_usage_referral") {
      const now = new Date();
      const canceled = await prisma.$transaction(async (tx) => {
        await acquireHostedUsageReferralReferrerLockTx({
          referrerMemberId: actor.referrerMemberId,
          tx,
        });
        await expireHostedUsageReferralsForReferrerTx({
          now,
          referrerMemberId: actor.referrerMemberId,
          tx,
        });
        const current = await tx.hostedUsageReferral.findFirst({
          orderBy: [{ armedAt: "desc" }, { id: "desc" }],
          select: { id: true },
          where: {
            expiresAt: { gt: now },
            referrerMemberId: actor.referrerMemberId,
            status: "armed",
          },
        });
        if (current) {
          await tx.hostedUsageReferral.update({
            where: { id: current.id },
            data: {
              ...CLEARED_REFERRAL_EVIDENCE,
              sourceConversationJson: Prisma.DbNull,
              status: "canceled",
              terminalAt: now,
              terminalReason: "referrer_canceled",
            },
          });
        }
        return current !== null;
      }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

      if (!canceled) {
        return unavailableToolResponse(
          input.request.action,
          "no_unbound_usage_referral",
        );
      }
      return await buildCommittedUsageReferralMutationResponse({
        action: input.request.action,
        actor,
        now,
        prisma,
      });
    }

    const policy = POLICIES[input.request.policyCode];
    const personalSource =
      actor.beneficiaryMemberId === actor.referrerMemberId;
    const sourceConversation = personalSource
      ? readHostedUsageReferralSourceConversation(
          input.request.sourceConversation ?? null,
        )
      : null;
    if (
      personalSource
      && (!sourceConversation || sourceConversation.threadIsDirect !== true)
    ) {
      return unavailableToolResponse(
        input.request.action,
        "usage_referral_not_available",
      );
    }
    const availablePolicyCodes =
      await readHostedUsageReferralAvailablePolicyCodes({
        actor,
        prisma,
      });
    if (!availablePolicyCodes.includes(policy.code)) {
      return unavailableToolResponse(
        input.request.action,
        "usage_referral_not_available",
      );
    }

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await acquireHostedUsageReferralReferrerLockTx({
        referrerMemberId: actor.referrerMemberId,
        tx,
      });
      await expireHostedUsageReferralsForReferrerTx({
        now,
        referrerMemberId: actor.referrerMemberId,
        tx,
      });
      const boundCount = await tx.hostedUsageReferral.count({
        where: {
          referrerMemberId: actor.referrerMemberId,
          OR: outstandingHostedUsageReferralCommitmentWhere(now),
          status: "target_bound",
        },
      });
      if (boundCount >= HOSTED_USAGE_REFERRAL_MAX_BOUND_PER_REFERRER) {
        throw new TypeError("too_many_referrals_in_progress");
      }

      const currentArmed = await tx.hostedUsageReferral.findFirst({
        orderBy: [{ armedAt: "desc" }, { id: "desc" }],
        select: {
          beneficiaryMemberId: true,
        },
        where: {
          expiresAt: { gt: now },
          referrerMemberId: actor.referrerMemberId,
          status: "armed",
        },
      });
      const affectedBeneficiaryMemberIds = [
        ...new Set([
          actor.beneficiaryMemberId,
          ...(currentArmed
            ? [currentArmed.beneficiaryMemberId]
            : []),
        ]),
      ].sort();
      for (const beneficiaryMemberId of affectedBeneficiaryMemberIds) {
        await lockHostedUsageCreditBeneficiaryTx({
          beneficiaryMemberId,
          tx,
        });
      }
      await tx.hostedUsageReferral.updateMany({
        where: {
          referrerMemberId: actor.referrerMemberId,
          status: "armed",
        },
        data: {
          ...CLEARED_REFERRAL_EVIDENCE,
          sourceConversationJson: Prisma.DbNull,
          status: "superseded",
          terminalAt: now,
          terminalReason: "newer_referral_armed",
        },
      });
      await assertHostedUsageReferralRewardCapacityTx({
        beneficiaryMemberId: actor.beneficiaryMemberId,
        now,
        referrerMemberId: actor.referrerMemberId,
        rewardUsdMicros: policy.rewardUsdMicros,
        tx,
      });

      await tx.hostedUsageReferral.create({
        data: {
          armedAt: now,
          beneficiaryMemberId: actor.beneficiaryMemberId,
          expiresAt: new Date(now.getTime() + HOSTED_USAGE_REFERRAL_INTENT_TTL_MS),
          id: generateHostedRandomPrefixedId("hur"),
          policyCode: policy.code,
          policyVersion: HOSTED_USAGE_REFERRAL_POLICY_VERSION,
          referrerMemberId: actor.referrerMemberId,
          referrerSubjectKey: actor.referrerSubjectKey,
          rewardUsdMicros: policy.rewardUsdMicros,
          ...(sourceConversation
            ? {
                sourceConversationJson: {
                  channel: sourceConversation.channel,
                  threadId: sourceConversation.threadId,
                  threadIsDirect: sourceConversation.threadIsDirect,
                },
              }
            : {}),
          status: "armed",
        },
      });
    }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
    return await buildCommittedUsageReferralMutationResponse({
      action: input.request.action,
      actor,
      now,
      prisma,
    });
  } catch (error) {
    if (
      error instanceof Error
      && EXPECTED_REFERRAL_UNAVAILABLE_ERRORS.has(error.message)
    ) {
      return unavailableToolResponse(
        input.request.action,
        "usage_referral_not_available",
      );
    }
    throw error;
  }
}

async function buildCommittedUsageReferralMutationResponse(input: {
  action: "arm_usage_referral" | "cancel_usage_referral";
  actor: HostedUsageReferralActor;
  now: Date;
  prisma: PrismaClient;
}): Promise<HostedRuntimeGroupToolResponse> {
  try {
    const referral = await readHostedUsageReferralSnapshot({
      actor: input.actor,
      now: input.now,
      prisma: input.prisma,
    });
    return {
      action: input.action,
      result: {
        outcome:
          input.action === "arm_usage_referral" ? "armed" : "canceled",
        referral,
        status: "ok",
      },
    };
  } catch (error) {
    console.error(
      "Hosted usage referral snapshot refresh failed after committed mutation.",
      {
        action: input.action,
        errorName: error instanceof Error ? error.name : typeof error,
      },
    );
    return unavailableToolResponse(
      input.action,
      input.action === "arm_usage_referral"
        ? "usage_referral_arm_applied_snapshot_unavailable"
        : "usage_referral_cancel_applied_snapshot_unavailable",
    );
  }
}

export async function bindArmedHostedUsageReferralToNewContainerTx(input: {
  enabled?: boolean;
  occurredAt: Date;
  ownerMemberId: string;
  targetContainerMemberId: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedUsageReferralBindResult> {
  if (!(input.enabled ?? isHostedUsageReferralEnabled())) {
    return { referralId: null };
  }

  if (input.ownerMemberId === input.targetContainerMemberId) {
    return { referralId: null };
  }

  await acquireHostedUsageReferralReferrerLockTx({
    referrerMemberId: input.ownerMemberId,
    tx: input.tx,
  });
  await expireHostedUsageReferralsForReferrerTx({
    now: input.occurredAt,
    referrerMemberId: input.ownerMemberId,
    tx: input.tx,
  });

  const referral = await input.tx.hostedUsageReferral.findFirst({
    orderBy: [{ armedAt: "desc" }, { id: "desc" }],
    select: { armedAt: true, id: true },
    where: {
      armedAt: { lte: input.occurredAt },
      expiresAt: { gt: input.occurredAt },
      referrerMemberId: input.ownerMemberId,
      status: "armed",
    },
  });
  if (!referral) {
    return { referralId: null };
  }

  const updated = await input.tx.hostedUsageReferral.updateMany({
    where: {
      id: referral.id,
      status: "armed",
      targetContainerMemberId: null,
    },
    data: {
      status: "target_bound",
      targetBoundAt: input.occurredAt,
      targetContainerMemberId: input.targetContainerMemberId,
    },
  });

  return { referralId: updated.count === 1 ? referral.id : null };
}

export async function observeHostedUsageReferralInboundTx(input: {
  containerMemberId: string;
  enabled?: boolean;
  eventKey: string;
  occurredAt: Date;
  senderMemberId?: string | null;
  senderSubjectKey: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedUsageReferralObservationResult> {
  if (!(input.enabled ?? isHostedUsageReferralEnabled())) {
    return {
      isBoundReferralTarget: false,
      qualificationCandidateReferralId: null,
    };
  }

  const discovered = await input.tx.hostedUsageReferral.findUnique({
    where: { targetContainerMemberId: input.containerMemberId },
    select: {
      id: true,
      referrerMemberId: true,
      status: true,
    },
  });
  if (
    !discovered
    || discovered.status !== "target_bound"
    || !discovered.referrerMemberId
  ) {
    return {
      isBoundReferralTarget: false,
      qualificationCandidateReferralId: null,
    };
  }

  await acquireHostedUsageReferralReferrerLockTx({
    referrerMemberId: discovered.referrerMemberId,
    tx: input.tx,
  });
  await acquireHostedUsageReferralLockTx({
    referralId: discovered.id,
    tx: input.tx,
  });
  const referral = await readHostedUsageReferralLockedRowTx({
    referralId: discovered.id,
    tx: input.tx,
  });
  if (
    !referral
    || referral.status !== "target_bound"
    || !referral.referrerMemberId
    || !referral.referrerSubjectKey
    || !referral.targetBoundAt
  ) {
    return {
      isBoundReferralTarget: false,
      qualificationCandidateReferralId: null,
    };
  }
  if (referral.qualifiedAt) {
    return {
      isBoundReferralTarget: true,
      qualificationCandidateReferralId: referral.id,
    };
  }
  if (input.occurredAt < referral.targetBoundAt) {
    return {
      isBoundReferralTarget: true,
      qualificationCandidateReferralId: null,
    };
  }
  if (input.occurredAt >= referral.expiresAt) {
    return {
      isBoundReferralTarget: true,
      qualificationCandidateReferralId: null,
    };
  }

  const eventKey = input.eventKey.trim();
  const senderSubjectKey = input.senderSubjectKey.trim();
  if (!eventKey || !senderSubjectKey) {
    return {
      isBoundReferralTarget: true,
      qualificationCandidateReferralId: null,
    };
  }
  const eventKeys = readBoundedStringArray(
    referral.observedEventKeysJson,
    HOSTED_USAGE_REFERRAL_EVENT_KEYS_MAX,
  );
  if (eventKeys.includes(eventKey)) {
    return {
      isBoundReferralTarget: true,
      qualificationCandidateReferralId: null,
    };
  }
  eventKeys.push(eventKey);
  if (eventKeys.length > HOSTED_USAGE_REFERRAL_EVENT_KEYS_MAX) {
    eventKeys.shift();
  }

  const senderMemberId = input.senderMemberId
    ?? await resolveHostedUsageReferralSubjectMemberIdTx({
      senderSubjectKey,
      tx: input.tx,
    });
  const isReferrer = senderMemberId === referral.referrerMemberId
    || senderSubjectKey === referral.referrerSubjectKey;
  const nonReferrerSpeakerKeys = readBoundedStringArray(
    referral.observedSpeakerKeysJson,
    HOSTED_USAGE_REFERRAL_SPEAKER_KEYS_MAX,
  );
  if (!isReferrer && !nonReferrerSpeakerKeys.includes(senderSubjectKey)) {
    nonReferrerSpeakerKeys.push(senderSubjectKey);
  }

  const humanMessageCount = Math.min(
    HOSTED_USAGE_REFERRAL_GROUP_REQUIRED_MESSAGES,
    referral.humanMessageCount + 1,
  );
  const nonReferrerMessageCount = Math.min(
    HOSTED_USAGE_REFERRAL_GROUP_REQUIRED_NON_REFERRER_MESSAGES,
    referral.nonReferrerMessageCount + (isReferrer ? 0 : 1),
  );
  const firstHumanMessageAt = !referral.firstHumanMessageAt
    || input.occurredAt < referral.firstHumanMessageAt
      ? input.occurredAt
      : referral.firstHumanMessageAt;
  const lastHumanMessageAt = !referral.lastHumanMessageAt
    || input.occurredAt > referral.lastHumanMessageAt
      ? input.occurredAt
      : referral.lastHumanMessageAt;

  if (referral.policyCode === "new_person_activation_v1") {
    const introducedMemberId = await resolveNewlyActivatedIntroducedMemberTx({
      now: input.occurredAt,
      referral,
      senderMemberId,
      tx: input.tx,
    });
    if (!introducedMemberId) {
      await input.tx.hostedUsageReferral.update({
        where: { id: referral.id },
        data: {
          firstHumanMessageAt,
          humanMessageCount,
          lastHumanMessageAt,
          nonReferrerMessageCount,
          observedEventKeysJson: eventKeys,
          observedSpeakerKeysJson: nonReferrerSpeakerKeys,
        },
      });
      return {
        isBoundReferralTarget: true,
        qualificationCandidateReferralId: null,
      };
    }
    await acquireHostedUsageReferralIntroducedMemberLockTx({
      introducedMemberId,
      tx: input.tx,
    });
    const existing = await input.tx.hostedUsageReferral.findFirst({
      select: { id: true, rewardedAt: true },
      where: {
        id: { not: referral.id },
        introducedMemberId,
      },
    });
    if (existing) {
      await terminateHostedUsageReferralTx({
        referralId: referral.id,
        reason: existing.rewardedAt
          ? "introduced_member_already_rewarded"
          : "introduced_member_already_attributed",
        status: "disqualified",
        terminalAt: input.occurredAt,
        tx: input.tx,
      });
      return {
        isBoundReferralTarget: false,
        qualificationCandidateReferralId: null,
      };
    }
    await input.tx.hostedUsageReferral.update({
      where: { id: referral.id },
      data: {
        firstHumanMessageAt,
        humanMessageCount,
        introducedMemberId,
        lastHumanMessageAt,
        nonReferrerMessageCount,
        observedEventKeysJson: eventKeys,
        observedSpeakerKeysJson: nonReferrerSpeakerKeys,
        qualifiedAt: input.occurredAt,
      },
    });
    return {
      isBoundReferralTarget: true,
      qualificationCandidateReferralId: referral.id,
    };
  }

  const qualified = qualifiesHostedActiveGroupReferral({
    firstHumanMessageAt,
    humanMessageCount,
    lastHumanMessageAt,
    nonReferrerMessageCount,
    nonReferrerSpeakerCount: nonReferrerSpeakerKeys.length,
  });
  await input.tx.hostedUsageReferral.update({
    where: { id: referral.id },
    data: {
      firstHumanMessageAt,
      humanMessageCount,
      lastHumanMessageAt,
      nonReferrerMessageCount,
      observedEventKeysJson: eventKeys,
      observedSpeakerKeysJson: nonReferrerSpeakerKeys,
      ...(qualified ? { qualifiedAt: lastHumanMessageAt } : {}),
    },
  });
  return {
    isBoundReferralTarget: true,
    qualificationCandidateReferralId: qualified ? referral.id : null,
  };
}

export async function reconcileHostedUsageReferralRewardAfterCommit(input: {
  referralId: string;
  prisma?: PrismaClient;
}): Promise<HostedWebhookWakeHandoff | null> {
  const prisma = input.prisma ?? getPrisma();
  const reward = await prisma.$transaction(async (tx) => {
    const discovered = await tx.hostedUsageReferral.findUnique({
      where: { id: input.referralId },
      select: {
        beneficiaryMemberId: true,
        referrerMemberId: true,
        status: true,
      },
    });
    if (!discovered) {
      return null;
    }
    if (discovered.status === "rewarded") {
      return { beneficiaryMemberId: discovered.beneficiaryMemberId };
    }
    if (
      discovered.status !== "target_bound"
      || !discovered.referrerMemberId
    ) {
      return null;
    }

    await acquireHostedUsageReferralReferrerLockTx({
      referrerMemberId: discovered.referrerMemberId,
      tx,
    });
    const lockedBeneficiary = await lockHostedUsageCreditBeneficiaryTx({
      beneficiaryMemberId: discovered.beneficiaryMemberId,
      tx,
    });
    await acquireHostedUsageReferralLockTx({
      referralId: input.referralId,
      tx,
    });
    const referral = await readHostedUsageReferralLockedRowTx({
      referralId: input.referralId,
      tx,
    });
    if (!referral) {
      return null;
    }
    if (referral.status === "rewarded") {
      return { beneficiaryMemberId: referral.beneficiaryMemberId };
    }
    if (
      referral.status !== "target_bound"
      || !referral.referrerMemberId
      || !referral.qualifiedAt
      || referral.qualifiedAt >= referral.expiresAt
    ) {
      return null;
    }

    const now = new Date();
    if (!(await referralStillQualifiesTx({ referral, tx }))) {
      return null;
    }

    if (referral.introducedMemberId) {
      await acquireHostedUsageReferralIntroducedMemberLockTx({
        introducedMemberId: referral.introducedMemberId,
        tx,
      });
      const previous = await tx.hostedUsageReferral.findFirst({
        select: { id: true },
        where: {
          id: { not: referral.id },
          introducedMemberId: referral.introducedMemberId,
          rewardedAt: { not: null },
        },
      });
      if (previous) {
        await terminateHostedUsageReferralTx({
          referralId: referral.id,
          reason: "introduced_member_already_rewarded",
          status: "disqualified",
          terminalAt: now,
          tx,
        });
        return null;
      }
    }

    await appendHostedUsageCreditGrantTx({
      effectiveAt: now,
      grantUsdMicros: referral.rewardUsdMicros,
      lockedBeneficiary,
      semanticSourceKey:
        `hosted-usage-credit:referral:${referral.id}:grant:v1`,
      source: { kind: "referral", referralId: referral.id },
      tx,
    });
    await tx.hostedUsageReferral.update({
      where: { id: referral.id },
      data: {
        ...CLEARED_REFERRAL_EVIDENCE,
        rewardedAt: now,
        status: "rewarded",
        terminalAt: now,
        terminalReason: null,
      },
    });
    return { beneficiaryMemberId: referral.beneficiaryMemberId };
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  if (!reward) {
    return null;
  }
  return appendHostedUsageReferralCelebration({
    beneficiaryMemberId: reward.beneficiaryMemberId,
    prisma,
    referralId: input.referralId,
  });
}

async function appendHostedUsageReferralCelebration(input: {
  beneficiaryMemberId: string;
  prisma: PrismaClient;
  referralId: string;
}): Promise<HostedWebhookWakeHandoff | null> {
  const referral = await input.prisma.hostedUsageReferral.findUnique({
    where: { id: input.referralId },
    select: {
      beneficiaryMemberId: true,
      celebrationQueuedAt: true,
      policyCode: true,
      referrerMemberId: true,
      rewardedAt: true,
      sourceConversationJson: true,
      status: true,
    },
  });
  if (
    !referral
    || referral.status !== "rewarded"
    || !referral.rewardedAt
    || referral.celebrationQueuedAt
    || referral.beneficiaryMemberId !== input.beneficiaryMemberId
  ) {
    return null;
  }
  const rewardedAt = referral.rewardedAt;
  const personalSource =
    referral.referrerMemberId === referral.beneficiaryMemberId;
  const sourceConversation = personalSource
    ? readHostedUsageReferralSourceConversation(
        referral.sourceConversationJson,
      )
    : null;
  if (personalSource && !sourceConversation) {
    await rotateHostedUsageReferralCelebrationRetry({
      prisma: input.prisma,
      referralId: input.referralId,
    });
    return null;
  }
  const destination = await resolveHostedAssistantNotificationDestination({
    ...(sourceConversation
      ? { directChannel: sourceConversation.channel }
      : {}),
    memberId: input.beneficiaryMemberId,
    prisma: input.prisma,
  });
  if (
    !destination
    || (
      sourceConversation
      && !hostedUsageReferralDestinationMatchesSourceConversation({
        destination,
        sourceConversation,
      })
    )
  ) {
    await rotateHostedUsageReferralCelebrationRetry({
      prisma: input.prisma,
      referralId: input.referralId,
    });
    return null;
  }

  const destinationKind = personalSource ? "personal" : "group";
  const destinationModel = await readHostedUsageReferralDestinationModel({
    beneficiaryMemberId: referral.beneficiaryMemberId,
    destinationKind,
    prisma: input.prisma,
  });
  const preferences = await readHostedMemberAssistantPreferences({
    memberId: input.beneficiaryMemberId,
    prisma: input.prisma,
  });
  const policy = POLICIES[referral.policyCode];
  const effectiveStyle = resolveAssistantEffectiveStyle({
    ...(preferences.persona ? { persona: preferences.persona } : {}),
    personality: {
      ...(preferences.personality.detail === null
        ? {}
        : { detail: preferences.personality.detail }),
      ...(preferences.personality.humor === null
        ? {}
        : { humor: preferences.personality.humor }),
      ...(preferences.personality.push === null
        ? {}
        : { push: preferences.personality.push }),
      ...(preferences.personality.unhinged === null
        ? {}
        : { unhinged: preferences.personality.unhinged }),
    },
    ...(preferences.tone ? { tone: preferences.tone } : {}),
    ...(preferences.voice ? { voice: preferences.voice } : {}),
  });
  const notificationKey = `usage-referral-reward:${input.referralId}`;
  const celebrationQueuedAt = new Date(
    Math.max(Date.now(), rewardedAt.getTime()),
  );
  const appended = await input.prisma.$transaction(async (tx) => {
    const mailbox = await appendHostedMailboxEnvelopeTx({
      envelope: buildHostedUsageReferralCelebrationWake({
        beneficiaryMemberId: input.beneficiaryMemberId,
        destination,
        notificationKey,
        rewardLabel: buildHostedUsageReferralRewardLabel({
          destinationKind,
          model: destinationModel,
          policyCode: policy.code,
        }),
        rewardedAt,
        styleBand: {
          humor: effectiveStyle.personality.humor,
          tone: effectiveStyle.tone,
          unhinged: effectiveStyle.personality.unhinged,
        },
      }),
      tx,
    });
    const queued = await tx.hostedUsageReferral.updateMany({
      data: {
        celebrationQueuedAt,
        sourceConversationJson: Prisma.DbNull,
      },
      where: {
        celebrationQueuedAt: null,
        id: input.referralId,
        rewardedAt,
        status: "rewarded",
      },
    });
    if (queued.count !== 1) {
      throw new TypeError(
        "Hosted usage-referral celebration lost its rewarded referral.",
      );
    }
    return mailbox;
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  return {
    eventId: appended.item.dedupeKey,
    ...(destination.route.channel === "linq"
      && destination.route.delivery.kind === "thread"
      ? { linqChatId: destination.route.delivery.target }
      : {}),
    mailboxItemId: appended.item.id,
    source: destination.route.channel === "telegram" ? "telegram" : "linq",
    userId: input.beneficiaryMemberId,
    wakeMailboxCheckpoint: {
      lane: appended.item.lane,
      laneSeq: appended.item.laneSeq,
    },
  };
}

export function buildHostedUsageReferralCelebrationWake(input: {
  beneficiaryMemberId: string;
  destination: HostedAssistantNotificationDestination;
  notificationKey: string;
  rewardLabel: string;
  rewardedAt: Date;
  styleBand: HostedUsageReferralCelebrationStyleBand;
}) {
  const routeAuthority = input.destination.externalThreadRouteAuthority
    ?? (
      input.destination.conversationShape === "direct-member"
        && input.destination.route.channel === "telegram"
        && input.destination.route.threadIsDirect === true
        ? {
            channel: "telegram" as const,
            containerMemberId: input.beneficiaryMemberId,
            threadId: input.destination.route.delivery.target,
          }
        : null
    );
  const route =
    input.destination.conversationShape === "direct-member"
    && input.destination.route.channel === "linq"
    && input.destination.route.delivery.kind === "thread"
      ? {
          ...input.destination.route,
          delivery: {
            ...input.destination.route.delivery,
            kind: "explicit" as const,
          },
        }
      : input.destination.route;
  return buildHostedExecutionAssistantNotificationRequestedWake({
    eventId: `assistant.notification.requested:${input.notificationKey}`,
    memberId: input.beneficiaryMemberId,
    notification: {
      deliveryDedupeToken: input.notificationKey,
      deliveryDispatchMode: "queue-only",
      deliveryIdempotencyKey: input.notificationKey,
      ...(routeAuthority
        ? {
            externalThreadRouteAuthority: routeAuthority,
          }
        : {}),
      instructions: [
        "Continue the source conversation by celebrating its completed usage challenge.",
        `The person who accepted it has already earned ${input.rewardLabel} for this conversation.`,
        "Make this feel like a funny shared achievement, not a billing receipt.",
        `Server-supplied destination style band: tone=${input.styleBand.tone}; Humor=${input.styleBand.humor}/10; Unhinged=${input.styleBand.unhinged}/10.`,
        "Match that band naturally without mentioning settings.",
        "This isolated completion has no transcript or room callback, so do not invent one.",
        "Keep any edge aimed at Murph and do not sexualize or degrade an absent person.",
        "Celebrate without naming or otherwise identifying the person who accepted it.",
        "Keep it playful and concise.",
        "Do not mention internal accounting, qualification checks, or the other conversation.",
      ].join(" "),
      responsePolicy: { kind: "require_send" },
      route,
    },
    occurredAt: input.rewardedAt.toISOString(),
  });
}

export function hostedUsageReferralDestinationMatchesSourceConversation(input: {
  destination: HostedAssistantNotificationDestination;
  sourceConversation: HostedRuntimeUsageReferralSourceConversation;
}): boolean {
  const { destination, sourceConversation } = input;
  if (
    destination.conversationShape !== "direct-member"
    || destination.externalThreadRouteAuthority !== null
    || destination.route.delivery.kind !== "thread"
    || destination.route.channel !== sourceConversation.channel
    || destination.route.threadIsDirect !== true
    || sourceConversation.threadIsDirect !== true
  ) {
    return false;
  }
  return destination.route.threadId === sourceConversation.threadId;
}

function readHostedUsageReferralSourceConversation(
  value: unknown,
): HostedRuntimeUsageReferralSourceConversation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const source = value as Record<string, unknown>;
  if (
    (source.channel !== "linq" && source.channel !== "telegram")
    || typeof source.threadId !== "string"
    || !isHostedUsageReferralBlindedLocator(source.threadId)
    || typeof source.threadIsDirect !== "boolean"
  ) {
    return null;
  }
  return {
    channel: source.channel,
    threadId: source.threadId,
    threadIsDirect: source.threadIsDirect,
  };
}

function isHostedUsageReferralBlindedLocator(value: string): boolean {
  return /^hid_[a-f0-9]{32}$/u.test(value);
}

async function rotateHostedUsageReferralCelebrationRetry(input: {
  prisma: PrismaClient;
  referralId: string;
}): Promise<void> {
  await input.prisma.hostedUsageReferral.updateMany({
    data: { updatedAt: new Date() },
    where: {
      celebrationQueuedAt: null,
      id: input.referralId,
      status: "rewarded",
    },
  });
}

async function referralStillQualifiesTx(input: {
  referral: HostedUsageReferralLockedRow;
  tx: Prisma.TransactionClient;
}): Promise<boolean> {
  if (input.referral.policyCode === "active_group_v1") {
    return qualifiesHostedActiveGroupReferral({
      firstHumanMessageAt: input.referral.firstHumanMessageAt,
      humanMessageCount: input.referral.humanMessageCount,
      lastHumanMessageAt: input.referral.lastHumanMessageAt,
      nonReferrerMessageCount: input.referral.nonReferrerMessageCount,
      nonReferrerSpeakerCount: readBoundedStringArray(
        input.referral.observedSpeakerKeysJson,
        HOSTED_USAGE_REFERRAL_SPEAKER_KEYS_MAX,
      ).length,
    });
  }

  if (
    !input.referral.introducedMemberId
    || input.referral.introducedMemberId === input.referral.referrerMemberId
    || !input.referral.targetBoundAt
  ) {
    return false;
  }

  const member = await input.tx.hostedMember.findUnique({
    select: { createdAt: true },
    where: { id: input.referral.introducedMemberId },
  });
  const activation = await input.tx.hostedMailboxItem.findFirst({
    select: { id: true },
    where: {
      kind: "member.activated",
      occurredAt: {
        gte: input.referral.armedAt,
      },
      userId: input.referral.introducedMemberId,
    },
  });
  return member !== null
    && member.createdAt >= input.referral.armedAt
    && activation !== null
    && input.referral.qualifiedAt !== null;
}

async function resolveNewlyActivatedIntroducedMemberTx(input: {
  now: Date;
  referral: HostedUsageReferralLockedRow;
  senderMemberId: string | null;
  tx: Prisma.TransactionClient;
}): Promise<string | null> {
  const memberId = input.senderMemberId;
  if (
    !memberId
    || memberId === input.referral.referrerMemberId
    || !input.referral.targetBoundAt
  ) {
    return null;
  }

  const member = await input.tx.hostedMember.findUnique({
    where: { id: memberId },
    select: { createdAt: true, suspendedAt: true },
  });
  const activation = await input.tx.hostedMailboxItem.findFirst({
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    select: { id: true },
    where: {
      kind: "member.activated",
      occurredAt: {
        gte: input.referral.armedAt,
        lte: input.now,
      },
      userId: memberId,
    },
  });
  if (
    !member
    || member.suspendedAt
    || member.createdAt < input.referral.armedAt
    || !activation
  ) {
    return null;
  }
  return await readActiveHostedMemberAccess({ memberId, prisma: input.tx })
    ? memberId
    : null;
}

async function resolveHostedUsageReferralSubjectMemberIdTx(input: {
  senderSubjectKey: string;
  tx: Prisma.TransactionClient;
}): Promise<string | null> {
  const subject = parseHostedBlindIndex(input.senderSubjectKey);
  if (!subject) {
    return null;
  }

  if (subject.kind === "phone") {
    const identity = await input.tx.hostedMemberIdentity.findUnique({
      where: { phoneLookupKey: input.senderSubjectKey },
      select: { memberId: true },
    });
    return identity?.memberId ?? null;
  }
  if (subject.kind === "email") {
    const authorization =
      await input.tx.hostedMemberEmailAuthorization.findUnique({
        where: { verifiedEmailLookupKey: input.senderSubjectKey },
        select: { memberId: true },
      });
    return authorization?.memberId ?? null;
  }
  if (subject.kind === "telegram-user") {
    const routing = await input.tx.hostedMemberRouting.findUnique({
      where: { telegramUserLookupKey: input.senderSubjectKey },
      select: { memberId: true },
    });
    return routing?.memberId ?? null;
  }
  return null;
}

async function resolveHostedUsageReferralActor(input: {
  linqSenderHandles: readonly string[];
  memberId: string;
  prisma: PrismaClient;
  telegramSenderHandles: readonly string[];
}): Promise<HostedUsageReferralActor | null> {
  const container = await input.prisma.hostedThreadContainer.findUnique({
    where: { memberId: input.memberId },
    select: { memberId: true },
  });
  if (!container) {
    if (!(await readActiveHostedMemberAccess({
      memberId: input.memberId,
      prisma: input.prisma,
    }))) {
      return null;
    }
    return {
      beneficiaryMemberId: input.memberId,
      referrerMemberId: input.memberId,
      referrerSubjectKey: "authenticated-member",
    };
  }

  const referrer = await resolveHostedUsageReferralSourceMember(input);
  if (!referrer) {
    return null;
  }
  const referrerContainer = await input.prisma.hostedThreadContainer.findUnique({
    where: { memberId: referrer.memberId },
    select: { memberId: true },
  });
  if (
    referrerContainer
    || !(await readActiveHostedMemberAccess({
      memberId: referrer.memberId,
      prisma: input.prisma,
    }))
  ) {
    return null;
  }

  return {
    beneficiaryMemberId: input.memberId,
    referrerMemberId: referrer.memberId,
    referrerSubjectKey: referrer.subjectKey,
  };
}

async function resolveHostedUsageReferralSourceMember(input: {
  linqSenderHandles: readonly string[];
  prisma: PrismaClient;
  telegramSenderHandles: readonly string[];
}): Promise<{ memberId: string; subjectKey: string } | null> {
  if (
    (input.linqSenderHandles.length > 0
      && input.telegramSenderHandles.length > 0)
    || input.linqSenderHandles.length + input.telegramSenderHandles.length !== 1
  ) {
    return null;
  }

  const linqHandle = input.linqSenderHandles[0];
  if (linqHandle) {
    const lookup = await lookupHostedGroupParticipantMemberByHandle({
      handle: linqHandle,
      prisma: input.prisma,
    });
    const subjectKey = linqHandle.includes("@")
      ? createHostedEmailLookupKey(linqHandle)
      : createHostedPhoneLookupKey(normalizePhoneNumber(linqHandle));
    return lookup?.core.id && subjectKey
      ? { memberId: lookup.core.id, subjectKey }
      : null;
  }

  const telegramUserId = input.telegramSenderHandles[0];
  if (!telegramUserId) {
    return null;
  }
  const resolution = await resolveHostedMemberRoutingByTelegramUserId({
    prisma: input.prisma,
    telegramUserId,
  });
  const subjectKey = createHostedTelegramUserLookupKey(telegramUserId);
  return resolution.status === "found" && subjectKey
    ? { memberId: resolution.lookup.core.id, subjectKey }
    : null;
}

async function hasHostedUsageReferralSourceAccess(input: {
  actor: HostedUsageReferralActor;
  prisma: PrismaClient;
}): Promise<boolean> {
  if (input.actor.beneficiaryMemberId !== input.actor.referrerMemberId) {
    const status = await readHostedGroupUsageStatus({
      prisma: input.prisma,
      runtimeMemberId: input.actor.beneficiaryMemberId,
    });
    return status !== null;
  }

  const status = await readHostedPersonalAiUsageStatus({
    memberId: input.actor.beneficiaryMemberId,
    prisma: input.prisma,
  });
  return status.status !== "unavailable";
}

async function readHostedUsageReferralAvailablePolicyCodes(input: {
  actor: HostedUsageReferralActor;
  hasSourceAccess?: boolean;
  now?: Date;
  prisma: PrismaClient;
}): Promise<HostedUsageReferralPolicyCode[]> {
  const hasSourceAccess = input.hasSourceAccess
    ?? await hasHostedUsageReferralSourceAccess(input);
  if (!hasSourceAccess) {
    return [];
  }

  const now = input.now ?? new Date();
  const since = new Date(now.getTime() - THIRTY_DAYS_MS);
  // Keep these root-client operations sequential so one referral request
  // never fans out into several simultaneous pool checkouts.
  const boundCount = await input.prisma.hostedUsageReferral.count({
    where: {
      referrerMemberId: input.actor.referrerMemberId,
      OR: outstandingHostedUsageReferralCommitmentWhere(now),
      status: "target_bound",
    },
  });
  if (boundCount >= HOSTED_USAGE_REFERRAL_MAX_BOUND_PER_REFERRER) {
    return [];
  }

  const currentArmed = await input.prisma.hostedUsageReferral.findFirst({
    orderBy: [{ armedAt: "desc" }, { id: "desc" }],
    select: {
      beneficiaryMemberId: true,
      rewardUsdMicros: true,
    },
    where: {
      expiresAt: { gt: now },
      referrerMemberId: input.actor.referrerMemberId,
      status: "armed",
    },
  });
  const referrerCommitments =
    await input.prisma.hostedUsageReferral.aggregate({
      where: {
        referrerMemberId: input.actor.referrerMemberId,
        OR: [
          { rewardedAt: { gte: since } },
          ...outstandingHostedUsageReferralCommitmentWhere(now),
        ],
      },
      _sum: { rewardUsdMicros: true },
    });
  const beneficiaryCommitments =
    await input.prisma.hostedUsageReferral.aggregate({
      where: {
        beneficiaryMemberId: input.actor.beneficiaryMemberId,
        OR: [
          { rewardedAt: { gte: since } },
          ...outstandingHostedUsageReferralCommitmentWhere(now),
        ],
      },
      _sum: { rewardUsdMicros: true },
    });

  const replaceableArmedReward = currentArmed?.rewardUsdMicros ?? 0n;
  const referrerRewardTotal =
    (referrerCommitments._sum.rewardUsdMicros ?? 0n)
    - replaceableArmedReward;
  const beneficiaryRewardTotal =
    (beneficiaryCommitments._sum.rewardUsdMicros ?? 0n)
    - (
      currentArmed?.beneficiaryMemberId === input.actor.beneficiaryMemberId
        ? replaceableArmedReward
        : 0n
    );
  return HOSTED_USAGE_REFERRAL_POLICY_CODES.filter((code) => {
    const reward = POLICIES[code].rewardUsdMicros;
    return referrerRewardTotal + reward
      <= HOSTED_USAGE_REFERRAL_REFERRER_30D_CAP_USD_MICROS
      && beneficiaryRewardTotal + reward
      <= HOSTED_USAGE_REFERRAL_BENEFICIARY_30D_CAP_USD_MICROS;
  });
}

/**
 * Root-client projection only. Personal usage status owns its own interactive
 * transaction, so callers must build this snapshot outside referral mutation
 * transactions and after their locks have been released. The referral-owned
 * reads remain sequential so this response projection does not amplify pool
 * demand under concurrent traffic.
 */
async function readHostedUsageReferralSnapshot(input: {
  actor: HostedUsageReferralActor;
  now?: Date;
  prisma: PrismaClient;
}): Promise<HostedRuntimeUsageReferralSnapshot> {
  const now = input.now ?? new Date();
  const destinationKind =
    input.actor.beneficiaryMemberId === input.actor.referrerMemberId
      ? "personal"
      : "group";
  const active = await input.prisma.hostedUsageReferral.findFirst({
    orderBy: [{ armedAt: "desc" }, { id: "desc" }],
    where: {
      beneficiaryMemberId: input.actor.beneficiaryMemberId,
      expiresAt: { gt: now },
      referrerMemberId: input.actor.referrerMemberId,
      status: { in: [...ACTIVE_REFERRAL_STATUSES] },
    },
    select: {
      beneficiaryMemberId: true,
      expiresAt: true,
      policyCode: true,
      status: true,
    },
  });
  const personalUsage =
    input.actor.beneficiaryMemberId === input.actor.referrerMemberId
      ? await readHostedPersonalAiUsageStatus({
          memberId: input.actor.beneficiaryMemberId,
          prisma: input.prisma,
        })
      : null;
  const destinationModel = await readHostedUsageReferralDestinationModel({
    beneficiaryMemberId: input.actor.beneficiaryMemberId,
    destinationKind,
    prisma: input.prisma,
  });
  const hasSourceAccess = personalUsage === null
    ? await hasHostedUsageReferralSourceAccess(input)
    : personalUsage.status !== "unavailable";
  const availablePolicyCodes = await readHostedUsageReferralAvailablePolicyCodes({
    ...input,
    hasSourceAccess,
    now,
  });

  return {
    active: active
      ? {
          destinationKind:
            active.beneficiaryMemberId === input.actor.referrerMemberId
              ? "personal"
              : "group",
          expiresAt: active.expiresAt.toISOString(),
          policyCode: active.policyCode,
          rewardLabel: buildHostedUsageReferralRewardLabel({
            destinationKind,
            model: destinationModel,
            policyCode: active.policyCode,
          }),
          state: active.status === "armed" ? "armed" : "target_bound",
        }
      : null,
    availablePolicies: availablePolicyCodes.map((code) => ({
          code,
          requirementsLabel: POLICIES[code].requirementsLabel,
          rewardLabel: buildHostedUsageReferralRewardLabel({
            destinationKind,
            model: destinationModel,
            policyCode: code,
          }),
        })),
    trialCreditNotice:
      personalUsage !== null
      && personalUsage.status !== "unavailable"
      && personalUsage.accessKind === "trial"
        ? "Bonus usage does not extend the trial end date."
        : null,
  };
}

async function readHostedUsageReferralDestinationModel(input: {
  beneficiaryMemberId: string;
  destinationKind: "group" | "personal";
  prisma: PrismaClient;
}): Promise<HostedAssistantProductModel> {
  if (input.destinationKind === "group") {
    return HOSTED_ASSISTANT_SOL_MODEL;
  }
  const resolution = await readHostedMemberAssistantModelPreference({
    memberId: input.beneficiaryMemberId,
    prisma: input.prisma,
  });
  return resolution.model;
}

async function assertHostedUsageReferralRewardCapacityTx(input: {
  beneficiaryMemberId: string;
  now: Date;
  referrerMemberId: string;
  rewardUsdMicros: bigint;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const since = new Date(input.now.getTime() - THIRTY_DAYS_MS);
  const referrerCommitments = await input.tx.hostedUsageReferral.aggregate({
    where: {
      referrerMemberId: input.referrerMemberId,
      OR: [
        { rewardedAt: { gte: since } },
        ...outstandingHostedUsageReferralCommitmentWhere(input.now),
      ],
    },
    _sum: { rewardUsdMicros: true },
  });
  const beneficiaryCommitments = await input.tx.hostedUsageReferral.aggregate({
    where: {
      beneficiaryMemberId: input.beneficiaryMemberId,
      OR: [
        { rewardedAt: { gte: since } },
        ...outstandingHostedUsageReferralCommitmentWhere(input.now),
      ],
    },
    _sum: { rewardUsdMicros: true },
  });

  if (
    (referrerCommitments._sum.rewardUsdMicros ?? 0n) + input.rewardUsdMicros
      > HOSTED_USAGE_REFERRAL_REFERRER_30D_CAP_USD_MICROS
  ) {
    throw new TypeError("referrer_reward_cap_reached");
  }
  if (
    (beneficiaryCommitments._sum.rewardUsdMicros ?? 0n) + input.rewardUsdMicros
      > HOSTED_USAGE_REFERRAL_BENEFICIARY_30D_CAP_USD_MICROS
  ) {
    throw new TypeError("destination_reward_cap_reached");
  }
}

async function expireHostedUsageReferralsForReferrerTx(input: {
  now: Date;
  referrerMemberId: string;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const lateEvidenceCutoff = new Date(
    input.now.getTime() - HOSTED_USAGE_REFERRAL_LATE_EVIDENCE_GRACE_MS,
  );
  await input.tx.hostedUsageReferral.updateMany({
    where: {
      qualifiedAt: null,
      referrerMemberId: input.referrerMemberId,
      OR: [
        {
          expiresAt: { lte: input.now },
          status: "armed",
        },
        {
          expiresAt: { lte: lateEvidenceCutoff },
          status: "target_bound",
        },
      ],
    },
    data: {
      ...CLEARED_REFERRAL_EVIDENCE,
      qualifiedAt: null,
      sourceConversationJson: Prisma.DbNull,
      status: "expired",
      terminalAt: input.now,
      terminalReason: "expired",
    },
  });
}

async function acquireHostedUsageReferralReferrerLockTx(input: {
  referrerMemberId: string;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  await input.tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtext(${"hosted-usage-referral-referrer"}),
      hashtext(${input.referrerMemberId})
    )
  `;
}

async function acquireHostedUsageReferralLockTx(input: {
  referralId: string;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  await input.tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtext(${"hosted-usage-referral"}),
      hashtext(${input.referralId})
    )
  `;
}

async function acquireHostedUsageReferralIntroducedMemberLockTx(input: {
  introducedMemberId: string;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  await input.tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtext(${"hosted-usage-referral-introduced-member"}),
      hashtext(${input.introducedMemberId})
    )
  `;
}

async function readHostedUsageReferralLockedRowTx(input: {
  referralId: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedUsageReferralLockedRow | null> {
  const referral = await input.tx.hostedUsageReferral.findUnique({
    where: { id: input.referralId },
    select: {
      armedAt: true,
      beneficiaryMemberId: true,
      expiresAt: true,
      firstHumanMessageAt: true,
      humanMessageCount: true,
      id: true,
      introducedMemberId: true,
      lastHumanMessageAt: true,
      nonReferrerMessageCount: true,
      observedEventKeysJson: true,
      observedSpeakerKeysJson: true,
      policyCode: true,
      qualifiedAt: true,
      referrerMemberId: true,
      referrerSubjectKey: true,
      rewardUsdMicros: true,
      status: true,
      targetBoundAt: true,
      targetContainerMemberId: true,
    },
  });
  return referral;
}

async function terminateHostedUsageReferralTx(input: {
  referralId: string;
  reason: string;
  status: "disqualified" | "expired";
  terminalAt: Date;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  await input.tx.hostedUsageReferral.update({
    where: { id: input.referralId },
    data: {
      ...CLEARED_REFERRAL_EVIDENCE,
      qualifiedAt: null,
      sourceConversationJson: Prisma.DbNull,
      status: input.status,
      terminalAt: input.terminalAt,
      terminalReason: input.reason,
    },
  });
}

function readBoundedStringArray(
  value: Prisma.JsonValue | null,
  max: number,
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const strings = value.filter((entry): entry is string =>
    typeof entry === "string" && entry.length > 0
  );
  return [...new Set(strings)].slice(-max);
}

function unavailableToolResponse(
  action:
    | "arm_usage_referral"
    | "cancel_usage_referral"
    | "read_usage_referral",
  unavailableReason: string,
): HostedRuntimeGroupToolResponse {
  return {
    action,
    result: {
      referral: null,
      status: "unavailable",
      unavailableReason,
    },
  };
}
