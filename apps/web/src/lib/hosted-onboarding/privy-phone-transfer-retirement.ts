import {
  HostedBillingStatus,
  Prisma,
  type PrismaClient,
} from "@prisma/client";

import {
  HOSTED_PULSE_TRIAL_OFFER,
  HOSTED_PULSE_TRIAL_POLICY_VERSION,
} from "./billing-plans";
import {
  createHostedPhoneLookupKeyReadCandidates,
  createHostedPrivyUserLookupKeyReadCandidates,
  readHostedPhoneHint,
} from "./contact-privacy";
import { assertHostedMemberNotSuspended } from "./entitlement";
import { hostedOnboardingError } from "./errors";
import {
  readHostedMemberIdentity,
  lookupHostedMemberIdentityByPhoneNumber,
} from "./hosted-member-identity-store";
import {
  readHostedMemberBillingSnapshot,
  readHostedMemberCoreState,
  type HostedMemberCoreState,
} from "./hosted-member-store";
import { buildHostedLinqInviteSignupEffectIdMemberPrefix } from "./linq-invite-signup-effect-id";
import { acquireHostedLinqParticipantPhoneLockTx } from "./linq-participant-contact";
import {
  readHostedPrivyUserByIdIfExists,
  type HostedPrivyIdentity,
} from "./privy";
import { lockHostedMemberRow } from "./shared";
import {
  isHostedBrowserVaultRefreshRuntimeControlEvent,
} from "../hosted-orchestration/browser-vault-refresh-control";
import { getPrisma } from "../prisma";

const HOSTED_PRIVY_PHONE_TRANSFER_AUTHORITY_TIMEOUT_MS = 5_000;
const HOSTED_PRIVY_PHONE_TRANSFER_MAX_SCAFFOLD_SESSIONS = 20;

export interface HostedPrivyPhoneTransferProof {
  phoneNumber: string;
  sourceMemberId: string;
  sourcePrivyUserId: string;
}

export interface HostedPrivyPhoneTransferSourceRetirementProof {
  autoTrialBilling: {
    stripeCustomerId: string;
    stripeSubscriptionId: string;
  } | null;
  sourceMemberId: string;
}

export async function readHostedPrivyPhoneTransferProof(input: {
  identity: HostedPrivyIdentity;
  memberId: string;
  prisma?: PrismaClient;
}): Promise<HostedPrivyPhoneTransferProof | null> {
  const phoneNumber = input.identity.phone?.number;
  if (!phoneNumber) {
    return null;
  }

  const existingPhoneOwner = await lookupHostedMemberIdentityByPhoneNumber({
    phoneNumber,
    prisma: input.prisma ?? getPrisma(),
  });
  if (!existingPhoneOwner || existingPhoneOwner.core.id === input.memberId) {
    return null;
  }

  const sourcePrivyUserId = existingPhoneOwner.identity.privyUserId;
  if (!sourcePrivyUserId || sourcePrivyUserId === input.identity.userId) {
    throwHostedPrivyPhoneTransferChanged();
  }

  const sourcePrivyUser = await readHostedPrivyUserByIdIfExists(
    sourcePrivyUserId,
    {
      maxRetries: 0,
      timeout: HOSTED_PRIVY_PHONE_TRANSFER_AUTHORITY_TIMEOUT_MS,
    },
  );
  if (sourcePrivyUser) {
    throw hostedOnboardingError({
      code: "PRIVY_PHONE_NOT_READY",
      httpStatus: 409,
      message:
        "Privy is still finishing the phone transfer. Wait a moment and try again.",
      retryable: true,
    });
  }

  return {
    phoneNumber,
    sourceMemberId: existingPhoneOwner.core.id,
    sourcePrivyUserId,
  };
}

export async function prepareHostedPrivyPhoneTransferSourceRetirementTx(input: {
  identity: HostedPrivyIdentity;
  member: HostedMemberCoreState;
  now: Date;
  prisma: Prisma.TransactionClient;
  transfer: HostedPrivyPhoneTransferProof;
}): Promise<HostedPrivyPhoneTransferSourceRetirementProof> {
  const phoneNumber = input.identity.phone?.number;
  if (
    !phoneNumber
    || phoneNumber !== input.transfer.phoneNumber
    || input.member.id === input.transfer.sourceMemberId
    || input.identity.userId === input.transfer.sourcePrivyUserId
  ) {
    throwHostedPrivyPhoneTransferChanged();
  }

  await acquireHostedLinqParticipantPhoneLockTx({
    phoneNumber,
    tx: input.prisma,
  });
  for (const memberId of [
    input.member.id,
    input.transfer.sourceMemberId,
  ].sort()) {
    await lockHostedMemberRow(input.prisma, memberId);
  }

  await Promise.all([
    assertHostedPrivyAccountDeletionNotPendingTx({
      prisma: input.prisma,
      privyUserId: input.identity.userId,
    }),
    assertHostedPrivyAccountDeletionNotPendingTx({
      prisma: input.prisma,
      privyUserId: input.transfer.sourcePrivyUserId,
    }),
  ]);

  const [currentMember, currentIdentity, sourceMember, sourceIdentity] =
    await Promise.all([
      readHostedMemberCoreState({
        memberId: input.member.id,
        prisma: input.prisma,
      }),
      readHostedMemberIdentity({
        memberId: input.member.id,
        prisma: input.prisma,
      }),
      readHostedMemberCoreState({
        memberId: input.transfer.sourceMemberId,
        prisma: input.prisma,
      }),
      readHostedMemberIdentity({
        memberId: input.transfer.sourceMemberId,
        prisma: input.prisma,
      }),
    ]);

  if (!currentMember || !sourceMember || !currentIdentity || !sourceIdentity) {
    throwHostedPrivyPhoneTransferChanged();
  }
  assertHostedMemberNotSuspended(currentMember);
  if (
    currentIdentity.privyUserId !== input.identity.userId
    || sourceIdentity.privyUserId !== input.transfer.sourcePrivyUserId
    || sourceIdentity.phoneNumber !== phoneNumber
  ) {
    throwHostedPrivyPhoneTransferChanged();
  }

  const autoTrialBilling =
    await classifyHostedPrivyPhoneTransferSourceScaffoldTx({
      identity: sourceIdentity,
      memberId: sourceMember.id,
      phoneNumber,
      prisma: input.prisma,
      sourcePrivyUserId: input.transfer.sourcePrivyUserId,
    });

  if (!sourceMember.suspendedAt) {
    const sourceMemberFence = await input.prisma.hostedMember.updateMany({
      where: {
        billingStatus: sourceMember.billingStatus,
        id: sourceMember.id,
        suspendedAt: null,
      },
      data: {
        suspendedAt: input.now,
      },
    });
    if (sourceMemberFence.count !== 1) {
      throwHostedPrivyPhoneTransferChanged();
    }
  }

  return {
    autoTrialBilling,
    sourceMemberId: sourceMember.id,
  };
}

export async function assertHostedPrivyPhoneTransferSourceRetirementFenceTx(
  input: {
    identity: HostedPrivyIdentity;
    member: HostedMemberCoreState;
    prisma: Prisma.TransactionClient;
    transfer: HostedPrivyPhoneTransferProof;
  },
): Promise<void> {
  // The full disposable-account classifier runs before provider cleanup.
  // This final assertion intentionally ignores billing fields because the
  // account-deletion-owned Stripe cancellation may already have updated them.
  const phoneNumber = input.identity.phone?.number;
  if (
    !phoneNumber
    || phoneNumber !== input.transfer.phoneNumber
    || input.member.id === input.transfer.sourceMemberId
    || input.identity.userId === input.transfer.sourcePrivyUserId
  ) {
    throwHostedPrivyPhoneTransferChanged();
  }

  const [currentMember, currentIdentity, sourceMember, sourceIdentity] =
    await Promise.all([
      readHostedMemberCoreState({
        memberId: input.member.id,
        prisma: input.prisma,
      }),
      readHostedMemberIdentity({
        memberId: input.member.id,
        prisma: input.prisma,
      }),
      readHostedMemberCoreState({
        memberId: input.transfer.sourceMemberId,
        prisma: input.prisma,
      }),
      readHostedMemberIdentity({
        memberId: input.transfer.sourceMemberId,
        prisma: input.prisma,
      }),
    ]);

  if (!currentMember || !sourceMember || !currentIdentity || !sourceIdentity) {
    throwHostedPrivyPhoneTransferChanged();
  }
  assertHostedMemberNotSuspended(currentMember);
  if (
    !sourceMember.suspendedAt
    || currentIdentity.privyUserId !== input.identity.userId
    || sourceIdentity.privyUserId !== input.transfer.sourcePrivyUserId
    || sourceIdentity.phoneNumber !== phoneNumber
  ) {
    throwHostedPrivyPhoneTransferChanged();
  }
}

async function classifyHostedPrivyPhoneTransferSourceScaffoldTx(input: {
  identity: NonNullable<Awaited<ReturnType<typeof readHostedMemberIdentity>>>;
  memberId: string;
  phoneNumber: string;
  prisma: Prisma.TransactionClient;
  sourcePrivyUserId: string;
}): Promise<HostedPrivyPhoneTransferSourceRetirementProof["autoTrialBilling"]> {
  const [source, rawIdentity, inviteCount, invalidInvite, webSessionCount, invalidWebSession] =
    await Promise.all([
      readHostedPrivyPhoneTransferSourceShapeTx(input),
      input.prisma.hostedMemberIdentity.findUnique({
        where: { memberId: input.memberId },
        select: {
          maskedPhoneNumberHint: true,
          memberId: true,
          phoneLookupKey: true,
          phoneNumberEncrypted: true,
          phoneNumberVerifiedAt: true,
          privyUserIdEncrypted: true,
          privyUserLookupKey: true,
          signupPhoneCodeSendAttemptId: true,
          signupPhoneCodeSendAttemptStartedAt: true,
          signupPhoneCodeSentAt: true,
          signupPhoneNumberEncrypted: true,
          walletAddressEncrypted: true,
          walletAddressLookupKey: true,
          walletChainType: true,
          walletCreatedAt: true,
          walletProvider: true,
        },
      }),
      input.prisma.hostedInvite.count({
        where: { memberId: input.memberId },
      }),
      input.prisma.hostedInvite.findFirst({
        where: {
          memberId: input.memberId,
          OR: [
            { channel: { not: "web" } },
            { sentAt: { not: null } },
            { instantStartAdmissionEventId: { not: null } },
          ],
        },
        select: { id: true },
      }),
      input.prisma.hostedWebSession.count({
        where: { memberId: input.memberId },
      }),
      input.prisma.hostedWebSession.findFirst({
        where: {
          memberId: input.memberId,
          OR: [
            { privyUserId: { not: input.sourcePrivyUserId } },
            { computerHandoffViewportHeight: { not: null } },
            { computerHandoffViewportObservedAt: { not: null } },
            { computerHandoffViewportWidth: { not: null } },
          ],
        },
        select: { id: true },
      }),
    ]);

  if (
    !source
    || !isExactHostedPrivyPhoneTransferSourceIdentity({
      decrypted: input.identity,
      phoneNumber: input.phoneNumber,
      raw: rawIdentity,
      sourcePrivyUserId: input.sourcePrivyUserId,
    })
    || inviteCount > 1
    || invalidInvite
    || webSessionCount > HOSTED_PRIVY_PHONE_TRANSFER_MAX_SCAFFOLD_SESSIONS
    || invalidWebSession
    || hasHostedPrivyPhoneTransferSourceCoreCustomization(source)
  ) {
    throwHostedPrivyPhoneTransferSourceNotDisposable();
  }

  await assertNoHostedPrivyPhoneTransferExternalMaterialTx({
    memberId: input.memberId,
    phoneNumber: input.phoneNumber,
    prisma: input.prisma,
  });

  if (source.billingStatus === HostedBillingStatus.not_started) {
    if (
      source.billingRef
      || source.hostedWorkspace
      || source.routing
      || hasUnexpectedHostedPrivyPhoneTransferRelationCount(source._count, {
        hostedCryptoAudits: 1,
        hostedCryptoEnvelopes: 1,
      })
    ) {
      throwHostedPrivyPhoneTransferSourceNotDisposable();
    }
    await assertHostedPrivyPhoneTransferCryptoScaffoldTx({
      domains: ["control"],
      memberId: input.memberId,
      prisma: input.prisma,
    });
    return null;
  }

  if (
    (
      source.billingStatus !== HostedBillingStatus.active
      && source.billingStatus !== HostedBillingStatus.canceled
      && source.billingStatus !== HostedBillingStatus.incomplete
    )
    || !source.billingRef
    || !source.hostedWorkspace
    || !source.routing
    || hasUnexpectedHostedPrivyPhoneTransferRelationCount(source._count, {
      consentEvents: 2,
      consentGrants: 2,
      hostedCryptoAudits: 4,
      hostedCryptoEnvelopes: 4,
      hostedMailboxItems: 3,
      hostedMailboxLaneCounters: 2,
    })
  ) {
    throwHostedPrivyPhoneTransferSourceNotDisposable();
  }

  return assertHostedPrivyPhoneTransferAutoTrialScaffoldTx({
    memberId: input.memberId,
    phoneNumber: input.phoneNumber,
    prisma: input.prisma,
  });
}

async function readHostedPrivyPhoneTransferSourceShapeTx(input: {
  memberId: string;
  prisma: Prisma.TransactionClient;
}) {
  return input.prisma.hostedMember.findUnique({
    where: { id: input.memberId },
    select: {
      assistantDetail: true,
      assistantDetailCausalSeq: true,
      assistantHumor: true,
      assistantHumorCausalSeq: true,
      assistantModelPreference: true,
      assistantPersona: true,
      assistantPersonaCausalSeq: true,
      assistantProviderPreference: true,
      assistantPush: true,
      assistantPushCausalSeq: true,
      assistantReasoningEffortPreference: true,
      assistantTone: true,
      assistantToneCausalSeq: true,
      assistantUnhinged: true,
      assistantUnhingedCausalSeq: true,
      assistantVoice: true,
      assistantVoiceCausalSeq: true,
      billingRef: { select: { memberId: true } },
      billingStatus: true,
      codexAuthConnection: { select: { memberId: true } },
      connectedAppsSession: { select: { memberId: true } },
      emailAuthorization: { select: { memberId: true } },
      hostedGroupRuntime: { select: { id: true } },
      hostedWorkspace: { select: { userId: true } },
      pendingActivationTimeZone: true,
      routing: { select: { memberId: true } },
      signupNotificationEmailAttemptedAt: true,
      signupWelcomeEmailAttemptedAt: true,
      threadContainer: { select: { memberId: true } },
      usageCreditBalanceUsdMicros: true,
      usageCreditLedgerVersion: true,
      addressBookProjection: { select: { memberId: true } },
      _count: {
        select: {
          accountGroupInvitesAccepted: true,
          accountGroupInvitesSent: true,
          accountGroupMemberships: true,
          accountGroupsOwned: true,
          aiUsage: true,
          clinicalRecordConnectIntents: true,
          clinicalRecordConnections: true,
          clinicalRecordOauthSessions: true,
          clinicalRecordRetrievalRequests: true,
          clinicalRecordRetrievalRuns: true,
          computerHandoffs: true,
          computerRuns: true,
          connectedAppConnectIntents: true,
          consentEvents: true,
          consentGrants: true,
          groupSponsorshipsPaid: true,
          groupSponsorshipsReceived: true,
          groupSponsorshipMomentsCreated: true,
          hostedAiUsagePeriods: true,
          hostedCryptoAudits: true,
          hostedCryptoEnvelopes: true,
          hostedGroupMemberships: true,
          hostedGroupsOwned: true,
          hostedMailboxItems: true,
          hostedMailboxLaneCounters: true,
          hostedMailboxPayloads: true,
          hostedRuntimeLogs: true,
          linqContactCardShares: true,
          linqDailyStates: true,
          mealPhotoCaptureEnrollments: true,
          ownedThreadContainers: true,
          phoneCalls: true,
          productFeedback: true,
          sensitiveActionChallenges: true,
          subscriptionCheckouts: true,
          threadContainerParticipations: true,
          usageCreditEntries: true,
          usageCreditPurchasesPaid: true,
          usageCreditPurchasesReceived: true,
          usageReferralsAsBeneficiary: true,
          usageReferralsAsIntroduced: true,
          usageReferralsAsReferrer: true,
          vaultSharesGranted: true,
          vaultSharesReceived: true,
        },
      },
    },
  });
}

function hasHostedPrivyPhoneTransferSourceCoreCustomization(
  source: NonNullable<
    Awaited<ReturnType<typeof readHostedPrivyPhoneTransferSourceShapeTx>>
  >,
): boolean {
  return (
    (source.usageCreditBalanceUsdMicros ?? 0n) !== 0n
    || (source.usageCreditLedgerVersion ?? 0n) !== 0n
    || Boolean(
      source.addressBookProjection
      || source.codexAuthConnection
      || source.connectedAppsSession
      || source.emailAuthorization
      || source.hostedGroupRuntime
      || source.threadContainer
      || source.pendingActivationTimeZone
      || source.signupNotificationEmailAttemptedAt
      || source.signupWelcomeEmailAttemptedAt
    )
    || [
      source.assistantDetail,
      source.assistantDetailCausalSeq,
      source.assistantHumor,
      source.assistantHumorCausalSeq,
      source.assistantModelPreference,
      source.assistantPersona,
      source.assistantPersonaCausalSeq,
      source.assistantProviderPreference,
      source.assistantPush,
      source.assistantPushCausalSeq,
      source.assistantReasoningEffortPreference,
      source.assistantTone,
      source.assistantToneCausalSeq,
      source.assistantUnhinged,
      source.assistantUnhingedCausalSeq,
      source.assistantVoice,
      source.assistantVoiceCausalSeq,
    ].some((value) => value !== null)
  );
}

function hasUnexpectedHostedPrivyPhoneTransferRelationCount(
  counts: Record<string, number>,
  expectedNonZero: Readonly<Record<string, number>>,
): boolean {
  return Object.entries(counts).some(([name, count]) =>
    count !== (expectedNonZero[name] ?? 0)
  );
}

function isExactHostedPrivyPhoneTransferSourceIdentity(input: {
  decrypted: NonNullable<Awaited<ReturnType<typeof readHostedMemberIdentity>>>;
  phoneNumber: string;
  raw: {
    maskedPhoneNumberHint: string | null;
    memberId: string;
    phoneLookupKey: string | null;
    phoneNumberEncrypted: string | null;
    phoneNumberVerifiedAt: Date | null;
    privyUserIdEncrypted: string | null;
    privyUserLookupKey: string | null;
    signupPhoneCodeSendAttemptId: string | null;
    signupPhoneCodeSendAttemptStartedAt: Date | null;
    signupPhoneCodeSentAt: Date | null;
    signupPhoneNumberEncrypted: string | null;
    walletAddressEncrypted: string | null;
    walletAddressLookupKey: string | null;
    walletChainType: string | null;
    walletCreatedAt: Date | null;
    walletProvider: string | null;
  } | null;
  sourcePrivyUserId: string;
}): boolean {
  const phoneLookupKeys =
    createHostedPhoneLookupKeyReadCandidates(input.phoneNumber);
  const privyLookupKeys =
    createHostedPrivyUserLookupKeyReadCandidates(input.sourcePrivyUserId);
  return Boolean(
    input.raw
    && input.raw.memberId === input.decrypted.memberId
    && input.raw.phoneLookupKey
    && phoneLookupKeys.includes(input.raw.phoneLookupKey)
    && input.raw.phoneNumberEncrypted
    && input.raw.phoneNumberVerifiedAt
    && input.raw.maskedPhoneNumberHint === readHostedPhoneHint(input.phoneNumber)
    && input.raw.privyUserLookupKey
    && privyLookupKeys.includes(input.raw.privyUserLookupKey)
    && input.raw.privyUserIdEncrypted
    && !input.raw.signupPhoneCodeSendAttemptId
    && !input.raw.signupPhoneCodeSendAttemptStartedAt
    && !input.raw.signupPhoneCodeSentAt
    && !input.raw.signupPhoneNumberEncrypted
    && !input.raw.walletAddressLookupKey
    && !input.raw.walletAddressEncrypted
    && !input.raw.walletChainType
    && !input.raw.walletCreatedAt
    && !input.raw.walletProvider
    && input.decrypted.phoneNumber === input.phoneNumber
    && input.decrypted.phoneNumberVerifiedAt
    && input.decrypted.privyUserId === input.sourcePrivyUserId
    && !input.decrypted.signupPhoneCodeSendAttemptId
    && !input.decrypted.signupPhoneCodeSendAttemptStartedAt
    && !input.decrypted.signupPhoneCodeSentAt
    && !input.decrypted.signupPhoneNumber
    && !input.decrypted.walletAddress
    && !input.decrypted.walletChainType
    && !input.decrypted.walletCreatedAt
    && !input.decrypted.walletProvider
  );
}

async function assertNoHostedPrivyPhoneTransferExternalMaterialTx(input: {
  memberId: string;
  phoneNumber: string;
  prisma: Prisma.TransactionClient;
}): Promise<void> {
  const phoneLookupKeys =
    createHostedPhoneLookupKeyReadCandidates(input.phoneNumber);
  const blockers = await Promise.all([
    input.prisma.deviceConnection.findFirst({ where: { userId: input.memberId }, select: { id: true } }),
    input.prisma.deviceTokenAudit.findFirst({ where: { userId: input.memberId }, select: { id: true } }),
    input.prisma.deviceOauthSession.findFirst({ where: { userId: input.memberId }, select: { state: true } }),
    input.prisma.deviceConnectIntent.findFirst({ where: { memberId: input.memberId }, select: { claimHash: true } }),
    input.prisma.deviceSyncSignal.findFirst({ where: { userId: input.memberId }, select: { id: true } }),
    input.prisma.deviceSyncDirtyConnection.findFirst({ where: { userId: input.memberId }, select: { connectionId: true } }),
    input.prisma.deviceSyncDirtyPayload.findFirst({ where: { userId: input.memberId }, select: { id: true } }),
    input.prisma.deviceSyncCompanionCaptureReceipt.findFirst({ where: { userId: input.memberId }, select: { id: true } }),
    input.prisma.deviceAgentSession.findFirst({ where: { userId: input.memberId }, select: { id: true } }),
    input.prisma.deviceBrowserAssertionNonce.findFirst({ where: { userId: input.memberId }, select: { nonceHash: true } }),
    input.prisma.hostedWebInternalRequestNonce.findFirst({ where: { userId: input.memberId }, select: { nonceHash: true } }),
    input.prisma.hostedIngressLatencyTrace.findFirst({ where: { userId: input.memberId }, select: { id: true } }),
    input.prisma.hostedLinqDelivery.findFirst({
      where: {
        sourceRef: {
          startsWith:
            buildHostedLinqInviteSignupEffectIdMemberPrefix(input.memberId),
        },
      },
      select: { id: true },
    }),
    input.prisma.hostedGroupJoinOutreach.findFirst({
      where: { participantPhoneLookupKey: { in: phoneLookupKeys } },
      select: { id: true },
    }),
    input.prisma.hostedAccountGroupInvite.findFirst({
      where: {
        status: "pending",
        targetPhoneLookupKey: { in: phoneLookupKeys },
      },
      select: { id: true },
    }),
    input.prisma.hostedUsageReferral.findFirst({
      where: { referrerSubjectKey: { in: phoneLookupKeys } },
      select: { id: true },
    }),
  ]);
  if (blockers.some(Boolean)) {
    throwHostedPrivyPhoneTransferSourceNotDisposable();
  }
}

async function assertHostedPrivyPhoneTransferAutoTrialScaffoldTx(input: {
  memberId: string;
  phoneNumber: string;
  prisma: Prisma.TransactionClient;
}): Promise<NonNullable<
  HostedPrivyPhoneTransferSourceRetirementProof["autoTrialBilling"]
>> {
  const billing = await readHostedMemberBillingSnapshot({
    memberId: input.memberId,
    prisma: input.prisma,
  });
  const billingRef = billing?.billingRef;
  const hasExpectedTrialLifecycle =
    billing?.core.billingStatus === HostedBillingStatus.active
      ? billingRef?.currentBillingPhase === "trial"
      : (
        billing?.core.billingStatus === HostedBillingStatus.canceled
        || billing?.core.billingStatus === HostedBillingStatus.incomplete
      )
        && billingRef?.currentBillingPhase === null;
  if (
    !billing
    || !billingRef
    || !hasExpectedTrialLifecycle
    || billingRef.currentBillingPlanCode !== "launch_monthly"
    || billingRef.currentCheckoutOffer !== HOSTED_PULSE_TRIAL_OFFER
    || billingRef.pulseTrialPolicyVersion
      !== HOSTED_PULSE_TRIAL_POLICY_VERSION
    || !billingRef.pulseTrialRedeemedAt
    || !billingRef.currentTrialStartedAt
    || billingRef.currentTrialStartedAt.getTime()
      !== billingRef.pulseTrialRedeemedAt.getTime()
    || !billingRef.currentTrialEndsAt
    || billingRef.currentTrialEndsAt <= billingRef.currentTrialStartedAt
    || !billingRef.currentPeriodStart
    || billingRef.currentPeriodStart.getTime()
      !== billingRef.currentTrialStartedAt.getTime()
    || !billingRef.currentPeriodEnd
    || billingRef.currentPeriodEnd.getTime()
      !== billingRef.currentTrialEndsAt.getTime()
    || !billingRef.lastStripeEventCreatedAt
    || !billingRef.stripeCustomerId
    || !billingRef.stripeSubscriptionId
    || billingRef.stripeSubscriptionScheduleId
    || billingRef.stripeCheckoutSessionId
    || billingRef.checkoutAttemptId
    || billingRef.checkoutIntentHash
    || billingRef.checkoutCreatedAt
    || billingRef.scheduledBillingPlanCode
    || billingRef.scheduledBillingEffectiveAt
  ) {
    throwHostedPrivyPhoneTransferSourceNotDisposable();
  }

  const [
    routing,
    workspace,
    mailboxItems,
    mailboxLaneCounters,
    consentEvents,
    consentGrants,
  ] = await Promise.all([
    input.prisma.hostedMemberRouting.findUnique({
      where: { memberId: input.memberId },
    }),
    input.prisma.hostedWorkspace.findUnique({
      where: { userId: input.memberId },
    }),
    input.prisma.hostedMailboxItem.findMany({
      where: { userId: input.memberId },
      orderBy: { laneSeq: "asc" },
      select: {
        causalSeq: true,
        consumedAt: true,
        contentRetiredAt: true,
        dedupeKey: true,
        kind: true,
        lane: true,
        laneSeq: true,
        occurredAt: true,
        payloadSchema: true,
      },
    }),
    input.prisma.hostedMailboxLaneCounter.findMany({
      where: { userId: input.memberId },
      orderBy: { lane: "asc" },
      select: {
        consumedSeq: true,
        lane: true,
        nextSeq: true,
      },
    }),
    input.prisma.hostedConsentEvent.findMany({
      where: { memberId: input.memberId },
      select: {
        action: true,
        scope: true,
        source: true,
      },
    }),
    input.prisma.hostedConsentGrant.findMany({
      where: { memberId: input.memberId },
      select: {
        revokedAt: true,
        scope: true,
        source: true,
        status: true,
      },
    }),
  ]);
  const workspaceVersion = workspace?.version.toString() ?? "";

  if (
    !isHostedPrivyPhoneTransferAutoTrialRoutingScaffold({
      phoneNumber: input.phoneNumber,
      routing,
    })
    || !isHostedPrivyPhoneTransferAutoTrialWorkspaceScaffold(workspace)
    || !isHostedPrivyPhoneTransferAutoTrialMailboxScaffold({
      items: mailboxItems,
      memberId: input.memberId,
      stripeSubscriptionId: billingRef.stripeSubscriptionId,
      workspaceVersion,
    })
    || !isHostedPrivyPhoneTransferAutoTrialMailboxCounters(
      mailboxLaneCounters,
    )
    || !isHostedPrivyPhoneTransferAutoTrialConsentScaffold({
      events: consentEvents,
      grants: consentGrants,
    })
  ) {
    throwHostedPrivyPhoneTransferSourceNotDisposable();
  }
  await assertHostedPrivyPhoneTransferCryptoScaffoldTx({
    domains: ["control", "device", "ingress", "runtime"],
    memberId: input.memberId,
    prisma: input.prisma,
  });

  return {
    stripeCustomerId: billingRef.stripeCustomerId,
    stripeSubscriptionId: billingRef.stripeSubscriptionId,
  };
}

async function assertHostedPrivyPhoneTransferCryptoScaffoldTx(input: {
  domains: readonly ("control" | "device" | "ingress" | "runtime")[];
  memberId: string;
  prisma: Prisma.TransactionClient;
}): Promise<void> {
  const [envelopes, audits] = await Promise.all([
    input.prisma.hostedUserCryptoEnvelope.findMany({
      where: { userId: input.memberId },
      select: {
        activatedAt: true,
        decryptOnlyAt: true,
        domain: true,
        retiredAt: true,
        rootKeyId: true,
        rotatedFromRootKeyId: true,
        status: true,
      },
    }),
    input.prisma.hostedUserCryptoAudit.findMany({
      where: { userId: input.memberId },
      select: {
        action: true,
        actor: true,
        domain: true,
        reason: true,
        rootKeyId: true,
      },
    }),
  ]);
  const exact = envelopes.length === input.domains.length
    && audits.length === input.domains.length
    && input.domains.every((domain) => {
      const envelope = envelopes.find((candidate) =>
        candidate.domain === domain
      );
      const audit = audits.find((candidate) => candidate.domain === domain);
      return Boolean(
        envelope
        && envelope.status === "active"
        && envelope.activatedAt
        && !envelope.rotatedFromRootKeyId
        && !envelope.decryptOnlyAt
        && !envelope.retiredAt
        && audit
        && audit.action === "domain-root.provisioned"
        && audit.actor === "web"
        && audit.rootKeyId === envelope.rootKeyId
        && audit.reason === (
          domain === "control"
            ? "hosted-member.identity-private-fields"
            : "hosted-member.activation"
        )
      );
    });
  if (!exact) {
    throwHostedPrivyPhoneTransferSourceNotDisposable();
  }
}

function isHostedPrivyPhoneTransferAutoTrialRoutingScaffold(input: {
  phoneNumber: string;
  routing: Awaited<
    ReturnType<Prisma.TransactionClient["hostedMemberRouting"]["findUnique"]>
  >;
}): boolean {
  const phoneLookupKeys =
    createHostedPhoneLookupKeyReadCandidates(input.phoneNumber);
  const routing = input.routing;
  return Boolean(
    routing
    && !routing.linqChatLookupKey
    && !routing.linqChatIdEncrypted
    && !routing.linqParticipantContactKind
    && !routing.linqParticipantContactLookupKey
    && routing.linqRecipientPhoneLookupKey
    && phoneLookupKeys.includes(routing.linqRecipientPhoneLookupKey)
    && routing.linqRecipientPhoneEncrypted
    && routing.linqHomeLineAssignedAt
    && !routing.pendingLinqChatLookupKey
    && !routing.pendingLinqChatIdEncrypted
    && !routing.pendingLinqRecipientPhoneLookupKey
    && !routing.pendingLinqRecipientPhoneEncrypted
    && !routing.pendingLinqParticipantContactKind
    && !routing.pendingLinqParticipantContactLookupKey
    && !routing.pendingLinqParticipantContactEncrypted
    && !routing.pendingLinqParticipantContactObservedAt
    && !routing.replyAliasLookupKey
    && !routing.telegramUserLookupKey
    && !routing.telegramUserIdEncrypted
  );
}

function isHostedPrivyPhoneTransferAutoTrialWorkspaceScaffold(
  workspace: Awaited<
    ReturnType<Prisma.TransactionClient["hostedWorkspace"]["findUnique"]>
  >,
): boolean {
  return Boolean(
    workspace
    && workspace.version === 0n
    && !workspace.snapshotRef
    && !workspace.browserVaultReplicaRef
    && !workspace.nextWakeAt
    && !workspace.nextWakeReason
    && !workspace.inboxMediaRetentionWakeAt
    && !workspace.inboxMediaRetentionSignalAttemptedAt
    && !workspace.acceptedAttemptFailureRecheckClaimedAt
    && !workspace.redactedStatusJson
    && !workspace.checkpointedAt
  );
}

function isHostedPrivyPhoneTransferAutoTrialMailboxScaffold(input: {
  items: ReadonlyArray<{
    causalSeq: bigint | null;
    consumedAt: Date | null;
    contentRetiredAt: Date | null;
    dedupeKey: string;
    kind: string;
    lane: string;
    laneSeq: bigint;
    occurredAt: Date;
    payloadSchema: string;
  }>;
  memberId: string;
  stripeSubscriptionId: string;
  workspaceVersion: string;
}): boolean {
  const sourceEventId = `auto-pulse-trial:${input.stripeSubscriptionId}`;
  const activationEventId =
    `member.activated:hosted.auto_pulse_trial.enrolled:${input.memberId}:${sourceEventId}`;
  const expected = [
    {
      dedupeKey: activationEventId,
      kind: "member.activated",
    },
    {
      dedupeKey:
        `assistant.notification.requested:signup-welcome:${input.memberId}:${activationEventId}`,
      kind: "assistant.notification.requested",
    },
    {
      kind: "runtime.browser-vault-refresh-requested",
    },
  ];
  return input.items.length === expected.length
    && input.items.every((item, index) =>
      item.kind === expected[index]?.kind
      && (
        index === 2
          ? isHostedBrowserVaultRefreshRuntimeControlEvent({
              eventId: item.dedupeKey,
              occurredAt: item.occurredAt,
              userId: input.memberId,
              workspaceVersion: input.workspaceVersion,
            })
          : item.dedupeKey === expected[index]?.dedupeKey
      )
      && item.lane === "system"
      && item.laneSeq === BigInt(index + 1)
      && item.causalSeq === BigInt(index + 1)
      && item.payloadSchema === "murph.hosted-mailbox-item.v1"
      && !item.consumedAt
      && !item.contentRetiredAt
    );
}

function isHostedPrivyPhoneTransferAutoTrialMailboxCounters(
  counters: ReadonlyArray<{
    consumedSeq: bigint;
    lane: string;
    nextSeq: bigint;
  }>,
): boolean {
  return counters.length === 2
    && counters.every((counter) =>
      (counter.lane === "causal" || counter.lane === "system")
      && counter.nextSeq === 4n
      && counter.consumedSeq === 0n
    );
}

function isHostedPrivyPhoneTransferAutoTrialConsentScaffold(input: {
  events: ReadonlyArray<{
    action: string;
    scope: string;
    source: string;
  }>;
  grants: ReadonlyArray<{
    revokedAt: Date | null;
    scope: string;
    source: string;
    status: string;
  }>;
}): boolean {
  const scopes = ["launch.health-data", "launch.legal"] as const;
  return input.events.length === scopes.length
    && input.grants.length === scopes.length
    && scopes.every((scope) =>
      input.events.some((event) =>
        event.action === "accepted"
        && event.scope === scope
        && event.source === "homepage-auth-dialog"
      )
      && input.grants.some((grant) =>
        grant.scope === scope
        && grant.source === "homepage-auth-dialog"
        && grant.status === "granted"
        && !grant.revokedAt
      )
    );
}

async function assertHostedPrivyAccountDeletionNotPendingTx(input: {
  prisma: Prisma.TransactionClient;
  privyUserId: string;
}): Promise<void> {
  const privyUserLookupKeys =
    createHostedPrivyUserLookupKeyReadCandidates(input.privyUserId);
  if (privyUserLookupKeys.length === 0) {
    return;
  }
  const pendingCleanup =
    await input.prisma.hostedAccountDeletionCleanup.findFirst({
      select: { id: true },
      where: {
        privyCompletedAt: null,
        privyUserLookupKey: { in: privyUserLookupKeys },
      },
    });
  if (pendingCleanup) {
    throw hostedOnboardingError({
      code: "PRIVY_ACCOUNT_DELETION_IN_PROGRESS",
      httpStatus: 409,
      message:
        "Your previous account deletion is still finishing. Wait a moment and try again.",
      retryable: true,
    });
  }
}

function throwHostedPrivyPhoneTransferChanged(): never {
  throw hostedOnboardingError({
    code: "PRIVY_PHONE_NOT_READY",
    httpStatus: 409,
    message:
      "The phone transfer changed while Murph was reconciling it. Try again.",
    retryable: true,
  });
}

function throwHostedPrivyPhoneTransferSourceNotDisposable(): never {
  throw hostedOnboardingError({
    code: "PRIVY_PHONE_TRANSFER_REQUIRES_SUPPORT",
    httpStatus: 409,
    message:
      "That phone belongs to another Murph account with saved activity. Contact support to reconcile it safely.",
  });
}
