import { HostedBillingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  acquireHostedLinqParticipantPhoneLockTx: vi.fn(),
  lockHostedMemberRow: vi.fn(),
  lookupHostedMemberIdentityByPhoneNumber: vi.fn(),
  readHostedMemberBillingSnapshot: vi.fn(),
  readHostedMemberCoreState: vi.fn(),
  readHostedMemberIdentity: vi.fn(),
  readHostedPrivyUserByIdIfExists: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/contact-privacy", () => ({
  createHostedPhoneLookupKeyReadCandidates: (value: string) => [
    `phone:${value}`,
  ],
  createHostedPrivyUserLookupKeyReadCandidates: (value: string) => [
    `privy:${value}`,
  ],
  readHostedPhoneHint: () => "*** 4567",
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-identity-store", () => ({
  lookupHostedMemberIdentityByPhoneNumber:
    mocks.lookupHostedMemberIdentityByPhoneNumber,
  readHostedMemberIdentity: mocks.readHostedMemberIdentity,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  readHostedMemberBillingSnapshot: mocks.readHostedMemberBillingSnapshot,
  readHostedMemberCoreState: mocks.readHostedMemberCoreState,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-participant-contact", () => ({
  acquireHostedLinqParticipantPhoneLockTx:
    mocks.acquireHostedLinqParticipantPhoneLockTx,
}));

vi.mock("@/src/lib/hosted-onboarding/privy", () => ({
  readHostedPrivyUserByIdIfExists:
    mocks.readHostedPrivyUserByIdIfExists,
}));

vi.mock("@/src/lib/hosted-onboarding/shared", () => ({
  lockHostedMemberRow: mocks.lockHostedMemberRow,
}));

import {
  assertHostedPrivyPhoneTransferSourceRetirementFenceTx,
  prepareHostedPrivyPhoneTransferSourceRetirementTx,
} from "@/src/lib/hosted-onboarding/privy-phone-transfer-retirement";
import {
  buildHostedBrowserVaultRefreshRuntimeControlEvent,
} from "@/src/lib/hosted-orchestration/browser-vault-refresh-control";

const NOW = new Date("2026-07-30T17:00:00.000Z");
const TRIAL_END = new Date("2026-08-13T17:00:00.000Z");
const PHONE_NUMBER = "+15551234567";
const SOURCE_MEMBER_ID = "member_source";
const SOURCE_PRIVY_USER_ID = "did:privy:source";
const TARGET_MEMBER_ID = "member_target";
const TARGET_PRIVY_USER_ID = "did:privy:target";
const STRIPE_CUSTOMER_ID = "cus_trial";
const STRIPE_SUBSCRIPTION_ID = "sub_trial";
const BROWSER_VAULT_REFRESH_CONTROL_EVENT_ID =
  buildHostedBrowserVaultRefreshRuntimeControlEvent({
    nowMs: NOW.getTime(),
    userId: SOURCE_MEMBER_ID,
    workspaceVersion: "0",
  }).eventId;

describe("Privy phone-transfer source retirement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.acquireHostedLinqParticipantPhoneLockTx.mockResolvedValue(undefined);
    mocks.lockHostedMemberRow.mockResolvedValue(undefined);
    mocks.readHostedPrivyUserByIdIfExists.mockResolvedValue(null);
  });

  it("fences an exact pristine not-started signup scaffold", async () => {
    const fixture = makeFixture();

    await expect(prepare(fixture)).resolves.toEqual({
      autoTrialBilling: null,
      sourceMemberId: SOURCE_MEMBER_ID,
    });
    expect(fixture.prisma.hostedMember.updateMany).toHaveBeenCalledWith({
      data: {
        suspendedAt: NOW,
      },
      where: {
        billingStatus: HostedBillingStatus.not_started,
        id: SOURCE_MEMBER_ID,
        suspendedAt: null,
      },
    });
  });

  it("fences only the exact untouched automatic-trial scaffold", async () => {
    const fixture = makeFixture({ autoTrial: true });

    await expect(prepare(fixture)).resolves.toEqual({
      autoTrialBilling: {
        stripeCustomerId: STRIPE_CUSTOMER_ID,
        stripeSubscriptionId: STRIPE_SUBSCRIPTION_ID,
      },
      sourceMemberId: SOURCE_MEMBER_ID,
    });
  });

  it("rejects a non-canonical browser-vault refresh event", async () => {
    const fixture = makeFixture({ autoTrial: true });
    const activationEventId =
      `member.activated:hosted.auto_pulse_trial.enrolled:${SOURCE_MEMBER_ID}:auto-pulse-trial:${STRIPE_SUBSCRIPTION_ID}`;
    fixture.prisma.hostedMailboxItem.findMany.mockResolvedValue([
      mailboxItem(1, "member.activated", activationEventId),
      mailboxItem(
        2,
        "assistant.notification.requested",
        `assistant.notification.requested:signup-welcome:${SOURCE_MEMBER_ID}:${activationEventId}`,
      ),
      mailboxItem(
        3,
        "runtime.browser-vault-refresh-requested",
        `auto-pulse-trial:${STRIPE_SUBSCRIPTION_ID}`,
      ),
    ]);

    await expect(prepare(fixture)).rejects.toMatchObject({
      code: "PRIVY_PHONE_TRANSFER_REQUIRES_SUPPORT",
    });
    expect(fixture.prisma.hostedMember.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a browser-vault refresh event outside its canonical time bucket", async () => {
    const fixture = makeFixture({ autoTrial: true });
    const activationEventId =
      `member.activated:hosted.auto_pulse_trial.enrolled:${SOURCE_MEMBER_ID}:auto-pulse-trial:${STRIPE_SUBSCRIPTION_ID}`;
    fixture.prisma.hostedMailboxItem.findMany.mockResolvedValue([
      mailboxItem(1, "member.activated", activationEventId),
      mailboxItem(
        2,
        "assistant.notification.requested",
        `assistant.notification.requested:signup-welcome:${SOURCE_MEMBER_ID}:${activationEventId}`,
      ),
      {
        ...mailboxItem(
          3,
          "runtime.browser-vault-refresh-requested",
          BROWSER_VAULT_REFRESH_CONTROL_EVENT_ID,
        ),
        occurredAt: new Date(NOW.getTime() + 30_000),
      },
    ]);

    await expect(prepare(fixture)).rejects.toMatchObject({
      code: "PRIVY_PHONE_TRANSFER_REQUIRES_SUPPORT",
    });
    expect(fixture.prisma.hostedMember.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "an address-book projection",
      mutate: (fixture: Fixture) => {
        fixture.sourceShape.addressBookProjection = {
          memberId: SOURCE_MEMBER_ID,
        };
      },
    },
    {
      label: "a meal-photo capture enrollment",
      mutate: (fixture: Fixture) => {
        fixture.sourceShape._count.mealPhotoCaptureEnrollments = 1;
      },
    },
    {
      label: "a created usage-credit purchase",
      mutate: (fixture: Fixture) => {
        fixture.sourceShape._count.usageCreditPurchasesPaid = 1;
      },
    },
    {
      label: "a subscription checkout",
      mutate: (fixture: Fixture) => {
        fixture.sourceShape._count.subscriptionCheckouts = 1;
      },
    },
    {
      label: "a sponsorship paid by the source",
      mutate: (fixture: Fixture) => {
        fixture.sourceShape._count.groupSponsorshipsPaid = 1;
      },
    },
    {
      label: "a sponsorship received by the source",
      mutate: (fixture: Fixture) => {
        fixture.sourceShape._count.groupSponsorshipsReceived = 1;
      },
    },
  ])("rejects a source scaffold containing $label", async ({ mutate }) => {
    const fixture = makeFixture({ autoTrial: true });
    mutate(fixture);

    await expect(prepare(fixture)).rejects.toMatchObject({
      code: "PRIVY_PHONE_TRANSFER_REQUIRES_SUPPORT",
    });
    expect(fixture.prisma.hostedMember.updateMany).not.toHaveBeenCalled();
  });

  it("keeps the source fence valid after cleanup changes trial billing state", async () => {
    const fixture = makeFixture({ autoTrial: true });
    fixture.sourceMember.billingStatus = HostedBillingStatus.canceled;
    fixture.sourceMember.suspendedAt = NOW;

    await expect(assertFence(fixture)).resolves.toBeUndefined();
  });
});

type Fixture = ReturnType<typeof makeFixture>;

function prepare(fixture: Fixture) {
  mocks.readHostedMemberCoreState.mockImplementation(
    async ({ memberId }: { memberId: string }) =>
      memberId === TARGET_MEMBER_ID
        ? fixture.targetMember
        : fixture.sourceMember,
  );
  mocks.readHostedMemberIdentity.mockImplementation(
    async ({ memberId }: { memberId: string }) =>
      memberId === TARGET_MEMBER_ID
        ? fixture.targetIdentity
        : fixture.sourceIdentity,
  );
  mocks.readHostedMemberBillingSnapshot.mockResolvedValue(
    fixture.billingSnapshot,
  );

  return prepareHostedPrivyPhoneTransferSourceRetirementTx({
    identity: {
      phone: {
        number: PHONE_NUMBER,
        verifiedAt: 1,
      },
      telegram: null,
      userId: TARGET_PRIVY_USER_ID,
    },
    member: fixture.targetMember,
    now: NOW,
    prisma: fixture.prisma as never,
    transfer: {
      phoneNumber: PHONE_NUMBER,
      sourceMemberId: SOURCE_MEMBER_ID,
      sourcePrivyUserId: SOURCE_PRIVY_USER_ID,
    },
  });
}

function assertFence(fixture: Fixture) {
  mocks.readHostedMemberCoreState.mockImplementation(
    async ({ memberId }: { memberId: string }) =>
      memberId === TARGET_MEMBER_ID
        ? fixture.targetMember
        : fixture.sourceMember,
  );
  mocks.readHostedMemberIdentity.mockImplementation(
    async ({ memberId }: { memberId: string }) =>
      memberId === TARGET_MEMBER_ID
        ? fixture.targetIdentity
        : fixture.sourceIdentity,
  );

  return assertHostedPrivyPhoneTransferSourceRetirementFenceTx({
    identity: {
      phone: {
        number: PHONE_NUMBER,
        verifiedAt: 1,
      },
      telegram: null,
      userId: TARGET_PRIVY_USER_ID,
    },
    member: fixture.targetMember,
    prisma: fixture.prisma as never,
    transfer: {
      phoneNumber: PHONE_NUMBER,
      sourceMemberId: SOURCE_MEMBER_ID,
      sourcePrivyUserId: SOURCE_PRIVY_USER_ID,
    },
  });
}

function makeFixture(input: { autoTrial?: boolean } = {}) {
  const autoTrial = input.autoTrial ?? false;
  const targetMember = makeMember({
    billingStatus: HostedBillingStatus.active,
    id: TARGET_MEMBER_ID,
  });
  const sourceMember = makeMember({
    billingStatus: autoTrial
      ? HostedBillingStatus.active
      : HostedBillingStatus.not_started,
    id: SOURCE_MEMBER_ID,
  });
  const targetIdentity = {
    ...emptyIdentity(),
    memberId: TARGET_MEMBER_ID,
    privyUserId: TARGET_PRIVY_USER_ID,
  };
  const sourceIdentity = {
    ...emptyIdentity(),
    maskedPhoneNumberHint: "*** 4567",
    memberId: SOURCE_MEMBER_ID,
    phoneLookupKey: `phone:${PHONE_NUMBER}`,
    phoneNumber: PHONE_NUMBER,
    phoneNumberVerifiedAt: NOW,
    privyUserId: SOURCE_PRIVY_USER_ID,
  };
  const sourceShape = {
    ...emptySourceShape(),
    billingRef: autoTrial ? { memberId: SOURCE_MEMBER_ID } : null,
    billingStatus: sourceMember.billingStatus,
    hostedWorkspace: autoTrial ? { userId: SOURCE_MEMBER_ID } : null,
    routing: autoTrial ? { memberId: SOURCE_MEMBER_ID } : null,
    _count: makeRelationCounts(autoTrial),
  };
  const rawIdentity = {
    maskedPhoneNumberHint: "*** 4567",
    memberId: SOURCE_MEMBER_ID,
    phoneLookupKey: `phone:${PHONE_NUMBER}`,
    phoneNumberEncrypted: "phone-ciphertext",
    phoneNumberVerifiedAt: NOW,
    privyUserIdEncrypted: "privy-ciphertext",
    privyUserLookupKey: `privy:${SOURCE_PRIVY_USER_ID}`,
    signupPhoneCodeSendAttemptId: null,
    signupPhoneCodeSendAttemptStartedAt: null,
    signupPhoneCodeSentAt: null,
    signupPhoneNumberEncrypted: null,
    walletAddressEncrypted: null,
    walletAddressLookupKey: null,
    walletChainType: null,
    walletCreatedAt: null,
    walletProvider: null,
  };
  const billingSnapshot = autoTrial
    ? {
        billingRef: {
          checkoutAttemptId: null,
          checkoutCreatedAt: null,
          checkoutIntentHash: null,
          currentBillingPhase: "trial",
          currentBillingPlanCode: "launch_monthly",
          currentCheckoutOffer: "pulse_trial_7d",
          currentPeriodEnd: TRIAL_END,
          currentPeriodStart: NOW,
          currentTrialEndsAt: TRIAL_END,
          currentTrialStartedAt: NOW,
          lastStripeEventCreatedAt: NOW,
          pulseTrialPolicyVersion: "pulse-trial-2026-07-15-v3",
          pulseTrialRedeemedAt: NOW,
          scheduledBillingEffectiveAt: null,
          scheduledBillingPlanCode: null,
          stripeCheckoutSessionId: null,
          stripeCustomerId: STRIPE_CUSTOMER_ID,
          stripeSubscriptionId: STRIPE_SUBSCRIPTION_ID,
          stripeSubscriptionScheduleId: null,
        },
        core: sourceMember,
      }
    : null;
  const activationEventId =
    `member.activated:hosted.auto_pulse_trial.enrolled:${SOURCE_MEMBER_ID}:auto-pulse-trial:${STRIPE_SUBSCRIPTION_ID}`;
  const cryptoDomains = autoTrial
    ? ["control", "device", "ingress", "runtime"]
    : ["control"];
  const nullFinder = () => ({
    findFirst: vi.fn().mockResolvedValue(null),
  });
  const prisma = {
    deviceAgentSession: nullFinder(),
    deviceBrowserAssertionNonce: nullFinder(),
    deviceConnectIntent: nullFinder(),
    deviceConnection: nullFinder(),
    deviceOauthSession: nullFinder(),
    deviceSyncCompanionCaptureReceipt: nullFinder(),
    deviceSyncDirtyConnection: nullFinder(),
    deviceSyncDirtyPayload: nullFinder(),
    deviceSyncSignal: nullFinder(),
    deviceTokenAudit: nullFinder(),
    hostedAccountDeletionCleanup: nullFinder(),
    hostedAccountGroupInvite: nullFinder(),
    hostedConsentEvent: {
      findMany: vi.fn().mockResolvedValue(autoTrial
        ? [
            {
              action: "accepted",
              scope: "launch.health-data",
              source: "homepage-auth-dialog",
            },
            {
              action: "accepted",
              scope: "launch.legal",
              source: "homepage-auth-dialog",
            },
          ]
        : []),
    },
    hostedConsentGrant: {
      findMany: vi.fn().mockResolvedValue(autoTrial
        ? [
            {
              revokedAt: null,
              scope: "launch.health-data",
              source: "homepage-auth-dialog",
              status: "granted",
            },
            {
              revokedAt: null,
              scope: "launch.legal",
              source: "homepage-auth-dialog",
              status: "granted",
            },
          ]
        : []),
    },
    hostedGroupJoinOutreach: nullFinder(),
    hostedIngressLatencyTrace: nullFinder(),
    hostedInvite: {
      count: vi.fn().mockResolvedValue(1),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    hostedLinqDelivery: nullFinder(),
    hostedMailboxItem: {
      findMany: vi.fn().mockResolvedValue(autoTrial
        ? [
            mailboxItem(1, "member.activated", activationEventId),
            mailboxItem(
              2,
              "assistant.notification.requested",
              `assistant.notification.requested:signup-welcome:${SOURCE_MEMBER_ID}:${activationEventId}`,
            ),
            mailboxItem(
              3,
              "runtime.browser-vault-refresh-requested",
              BROWSER_VAULT_REFRESH_CONTROL_EVENT_ID,
            ),
          ]
        : []),
    },
    hostedMailboxLaneCounter: {
      findMany: vi.fn().mockResolvedValue(autoTrial
        ? [
            { consumedSeq: 0n, lane: "causal", nextSeq: 4n },
            { consumedSeq: 0n, lane: "system", nextSeq: 4n },
          ]
        : []),
    },
    hostedMember: {
      findUnique: vi.fn().mockImplementation(
        async ({ where }: { where: { id: string } }) =>
          where.id === SOURCE_MEMBER_ID ? sourceShape : null,
      ),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    hostedMemberIdentity: {
      findUnique: vi.fn().mockResolvedValue(rawIdentity),
    },
    hostedMemberRouting: {
      findUnique: vi.fn().mockResolvedValue(autoTrial
        ? {
            linqChatIdEncrypted: null,
            linqChatLookupKey: null,
            linqHomeLineAssignedAt: NOW,
            linqParticipantContactKind: null,
            linqParticipantContactLookupKey: null,
            linqRecipientPhoneEncrypted: "routing-ciphertext",
            linqRecipientPhoneLookupKey: `phone:${PHONE_NUMBER}`,
            pendingLinqChatIdEncrypted: null,
            pendingLinqChatLookupKey: null,
            pendingLinqParticipantContactEncrypted: null,
            pendingLinqParticipantContactKind: null,
            pendingLinqParticipantContactLookupKey: null,
            pendingLinqParticipantContactObservedAt: null,
            pendingLinqRecipientPhoneEncrypted: null,
            pendingLinqRecipientPhoneLookupKey: null,
            replyAliasLookupKey: null,
            telegramUserIdEncrypted: null,
            telegramUserLookupKey: null,
          }
        : null),
    },
    hostedUsageReferral: nullFinder(),
    hostedUserCryptoAudit: {
      findMany: vi.fn().mockResolvedValue(cryptoDomains.map((domain) => ({
        action: "domain-root.provisioned",
        actor: "web",
        domain,
        reason: domain === "control"
          ? "hosted-member.identity-private-fields"
          : "hosted-member.activation",
        rootKeyId: `root:${domain}`,
      }))),
    },
    hostedUserCryptoEnvelope: {
      findMany: vi.fn().mockResolvedValue(cryptoDomains.map((domain) => ({
        activatedAt: NOW,
        decryptOnlyAt: null,
        domain,
        retiredAt: null,
        rootKeyId: `root:${domain}`,
        rotatedFromRootKeyId: null,
        status: "active",
      }))),
    },
    hostedWebInternalRequestNonce: nullFinder(),
    hostedWebSession: {
      count: vi.fn().mockResolvedValue(1),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    hostedWorkspace: {
      findUnique: vi.fn().mockResolvedValue(autoTrial
        ? {
            acceptedAttemptFailureRecheckClaimedAt: null,
            browserVaultReplicaRef: null,
            checkpointedAt: null,
            inboxMediaRetentionSignalAttemptedAt: null,
            inboxMediaRetentionWakeAt: null,
            nextWakeAt: null,
            nextWakeReason: null,
            redactedStatusJson: null,
            snapshotRef: null,
            userId: SOURCE_MEMBER_ID,
            version: 0n,
          }
        : null),
    },
  };

  return {
    billingSnapshot,
    prisma,
    sourceIdentity,
    sourceMember,
    sourceShape,
    targetIdentity,
    targetMember,
  };
}

function emptyIdentity() {
  return {
    maskedPhoneNumberHint: null,
    phoneLookupKey: null,
    phoneNumber: null,
    phoneNumberVerifiedAt: null,
    privyUserId: null,
    signupPhoneCodeSendAttemptId: null,
    signupPhoneCodeSendAttemptStartedAt: null,
    signupPhoneCodeSentAt: null,
    signupPhoneNumber: null,
    walletAddress: null,
    walletChainType: null,
    walletCreatedAt: null,
    walletProvider: null,
  };
}

function emptySourceShape() {
  return {
    addressBookProjection: null as { memberId: string } | null,
    assistantDetail: null,
    assistantDetailCausalSeq: null,
    assistantHumor: null,
    assistantHumorCausalSeq: null,
    assistantModelPreference: null,
    assistantPersona: null,
    assistantPersonaCausalSeq: null,
    assistantProviderPreference: null,
    assistantPush: null,
    assistantPushCausalSeq: null,
    assistantReasoningEffortPreference: null,
    assistantTone: null,
    assistantToneCausalSeq: null,
    assistantUnhinged: null,
    assistantUnhingedCausalSeq: null,
    assistantVoice: null,
    assistantVoiceCausalSeq: null,
    billingRef: null as { memberId: string } | null,
    billingStatus: HostedBillingStatus.not_started,
    codexAuthConnection: null,
    connectedAppsSession: null,
    emailAuthorization: null,
    hostedGroupRuntime: null,
    hostedWorkspace: null as { userId: string } | null,
    pendingActivationTimeZone: null,
    routing: null as { memberId: string } | null,
    signupNotificationEmailAttemptedAt: null,
    signupWelcomeEmailAttemptedAt: null,
    threadContainer: null,
    usageCreditBalanceUsdMicros: 0n,
    usageCreditLedgerVersion: 0n,
    _count: makeRelationCounts(false),
  };
}

function makeRelationCounts(autoTrial: boolean) {
  return {
    accountGroupInvitesAccepted: 0,
    accountGroupInvitesSent: 0,
    accountGroupMemberships: 0,
    accountGroupsOwned: 0,
    aiUsage: 0,
    clinicalRecordConnectIntents: 0,
    clinicalRecordConnections: 0,
    clinicalRecordOauthSessions: 0,
    clinicalRecordRetrievalRequests: 0,
    clinicalRecordRetrievalRuns: 0,
    computerHandoffs: 0,
    computerRuns: 0,
    connectedAppConnectIntents: 0,
    consentEvents: autoTrial ? 2 : 0,
    consentGrants: autoTrial ? 2 : 0,
    groupSponsorshipsPaid: 0,
    groupSponsorshipsReceived: 0,
    groupSponsorshipMomentsCreated: 0,
    hostedAiUsagePeriods: 0,
    hostedCryptoAudits: autoTrial ? 4 : 1,
    hostedCryptoEnvelopes: autoTrial ? 4 : 1,
    hostedGroupMemberships: 0,
    hostedGroupsOwned: 0,
    hostedMailboxItems: autoTrial ? 3 : 0,
    hostedMailboxLaneCounters: autoTrial ? 2 : 0,
    hostedMailboxPayloads: 0,
    hostedRuntimeLogs: 0,
    linqContactCardShares: 0,
    linqDailyStates: 0,
    mealPhotoCaptureEnrollments: 0,
    ownedThreadContainers: 0,
    phoneCalls: 0,
    productFeedback: 0,
    sensitiveActionChallenges: 0,
    subscriptionCheckouts: 0,
    threadContainerParticipations: 0,
    usageCreditEntries: 0,
    usageCreditPurchasesPaid: 0,
    usageCreditPurchasesReceived: 0,
    usageReferralsAsBeneficiary: 0,
    usageReferralsAsIntroduced: 0,
    usageReferralsAsReferrer: 0,
    vaultSharesGranted: 0,
    vaultSharesReceived: 0,
  };
}

function makeMember(input: {
  billingStatus: HostedBillingStatus;
  id: string;
}) {
  return {
    billingStatus: input.billingStatus,
    createdAt: NOW,
    id: input.id,
    pendingActivationTimeZone: null,
    suspendedAt: null as Date | null,
    updatedAt: NOW,
  };
}

function mailboxItem(index: number, kind: string, dedupeKey: string) {
  return {
    causalSeq: BigInt(index),
    consumedAt: null,
    contentRetiredAt: null,
    dedupeKey,
    kind,
    lane: "system",
    laneSeq: BigInt(index),
    occurredAt: NOW,
    payloadSchema: "murph.hosted-mailbox-item.v1",
  };
}
