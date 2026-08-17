import { HostedBillingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  acquireHostedLinqParticipantPhoneLockTx: vi.fn(),
  buildHostedPrivySessionState: vi.fn(),
  deleteHostedPrivyPhoneTransferSourceAccountData: vi.fn(),
  enqueueHostedMemberChannelsUpdatedForActiveMemberTx: vi.fn(),
  getPrisma: vi.fn(),
  hostedPhoneLookupKeyMatchesValue: vi.fn(),
  lockHostedMemberRow: vi.fn(),
  lookupHostedMemberIdentityByPhoneNumber: vi.fn(),
  readHostedMemberBillingSnapshot: vi.fn(),
  readHostedMemberCoreState: vi.fn(),
  readHostedMemberIdentity: vi.fn(),
  readHostedPrivyUserById: vi.fn(),
  readHostedPrivyUserByIdIfExists: vi.fn(),
  reconcileHostedPrivyIdentityOnMemberTx: vi.fn(),
  requireFreshPrivyMemberAuthForHostedAppSession: vi.fn(),
  signalHostedMailboxAppendRuntime: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-privacy/account-data-service", () => ({
  deleteHostedPrivyPhoneTransferSourceAccountData:
    mocks.deleteHostedPrivyPhoneTransferSourceAccountData,
}));

vi.mock("@/src/lib/hosted-onboarding/contact-privacy", () => ({
  createHostedPhoneLookupKeyReadCandidates: (value: string) => [
    `phone:${value}`,
  ],
  createHostedPrivyUserLookupKeyReadCandidates: (value: string) => [
    `privy:${value}`,
  ],
  hostedPhoneLookupKeyMatchesValue: mocks.hostedPhoneLookupKeyMatchesValue,
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

vi.mock("@/src/lib/hosted-onboarding/member-channel-sync", () => ({
  enqueueHostedMemberChannelsUpdatedForActiveMemberTx:
    mocks.enqueueHostedMemberChannelsUpdatedForActiveMemberTx,
}));

vi.mock("@/src/lib/hosted-onboarding/member-identity-service", () => ({
  reconcileHostedPrivyIdentityOnMemberTx:
    mocks.reconcileHostedPrivyIdentityOnMemberTx,
}));

vi.mock("@/src/lib/hosted-onboarding/privy", () => ({
  readHostedPrivyUserById: mocks.readHostedPrivyUserById,
  readHostedPrivyUserByIdIfExists:
    mocks.readHostedPrivyUserByIdIfExists,
}));

vi.mock("@/src/lib/hosted-onboarding/privy-user", () => ({
  buildHostedPrivySessionState: mocks.buildHostedPrivySessionState,
}));

vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({
  requireFreshPrivyMemberAuthForHostedAppSession:
    mocks.requireFreshPrivyMemberAuthForHostedAppSession,
}));

vi.mock("@/src/lib/hosted-onboarding/shared", () => ({
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS: { maxWait: 5_000 },
  lockHostedMemberRow: mocks.lockHostedMemberRow,
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingEnvironment: () => ({
    publicBaseUrl: "https://join.example.test",
  }),
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: mocks.signalHostedMailboxAppendRuntime,
}));

import {
  acquireHostedPrivyPhoneTransferPhoneLocksTx,
  assertHostedPrivyPhoneTransferSourceRetirementFenceTx,
  prepareHostedPrivyPhoneTransferSourceRetirementTx,
  readHostedPrivyPhoneTransferProof,
} from "@/src/lib/hosted-onboarding/privy-phone-transfer-retirement";
import {
  buildHostedBrowserVaultRefreshRuntimeControlEvent,
} from "@/src/lib/hosted-orchestration/browser-vault-refresh-control";
import {
  HOSTED_STARTER_USAGE_GRANT_USD_MICROS,
  buildHostedStarterUsageSemanticSourceKey,
  buildHostedStarterUsageSourceReferenceLookupKey,
  type HostedStarterUsageSource,
} from "@/src/lib/hosted-onboarding/starter-usage";

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

  describe("surviving provider source accounts", () => {
    function stubPhoneOwner() {
      mocks.lookupHostedMemberIdentityByPhoneNumber.mockResolvedValue({
        core: { id: SOURCE_MEMBER_ID },
        identity: { privyUserId: SOURCE_PRIVY_USER_ID },
      });
    }

    function readProof() {
      return readHostedPrivyPhoneTransferProof({
        identity: {
          phone: { number: PHONE_NUMBER, verifiedAt: 1 },
          telegram: null,
          userId: TARGET_PRIVY_USER_ID,
        },
        memberId: TARGET_MEMBER_ID,
        prisma: {} as never,
      });
    }

    it("asks the member to wait while the source still holds the phone", async () => {
      stubPhoneOwner();
      mocks.readHostedPrivyUserByIdIfExists.mockResolvedValue({
        id: SOURCE_PRIVY_USER_ID,
        linkedAccounts: [
          {
            latest_verified_at: 1,
            phone_number: PHONE_NUMBER,
            type: "phone",
          },
        ],
      });

      await expect(readProof()).rejects.toMatchObject({
        code: "PRIVY_PHONE_NOT_READY",
        retryable: true,
      });
    });

    it("stops retrying once the source keeps other sign-ins without the phone", async () => {
      stubPhoneOwner();
      mocks.readHostedPrivyUserByIdIfExists.mockResolvedValue({
        id: SOURCE_PRIVY_USER_ID,
        linkedAccounts: [
          {
            address: "owner@example.com",
            latest_verified_at: 1,
            type: "email",
          },
          {
            telegram_user_id: "telegram-source-a",
            type: "telegram",
          },
          {
            telegram_user_id: "telegram-source-b",
            type: "telegram",
          },
        ],
      });

      await expect(readProof()).rejects.toMatchObject({
        code: "PRIVY_PHONE_TRANSFER_SOURCE_STILL_ACTIVE",
        retryable: false,
      });
    });

    it("returns transfer proof once the provider released the source", async () => {
      stubPhoneOwner();
      mocks.readHostedPrivyUserByIdIfExists.mockResolvedValue(null);

      await expect(readProof()).resolves.toEqual({
        phoneNumber: PHONE_NUMBER,
        sourceMemberId: SOURCE_MEMBER_ID,
        sourcePrivyUserId: SOURCE_PRIVY_USER_ID,
      });
    });
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

  it("locks the target's prior phone and transferred phone before member rows", async () => {
    const targetPhoneNumber = "+15550000001";
    const fixture = makeFixture({ targetPhoneNumber });

    await expect(prepare(fixture, targetPhoneNumber)).resolves.toEqual({
      autoTrialBilling: null,
      sourceMemberId: SOURCE_MEMBER_ID,
    });

    expect(mocks.acquireHostedLinqParticipantPhoneLockTx).toHaveBeenNthCalledWith(
      1,
      {
        phoneNumber: targetPhoneNumber,
        tx: fixture.prisma,
      },
    );
    expect(mocks.acquireHostedLinqParticipantPhoneLockTx).toHaveBeenNthCalledWith(
      2,
      {
        phoneNumber: PHONE_NUMBER,
        tx: fixture.prisma,
      },
    );
    expect(
      mocks.acquireHostedLinqParticipantPhoneLockTx.mock.invocationCallOrder[1],
    ).toBeLessThan(mocks.lockHostedMemberRow.mock.invocationCallOrder[0] ?? 0);
  });

  it("locks the transferred phone once when the target had no phone", async () => {
    const fixture = makeFixture();

    await acquireHostedPrivyPhoneTransferPhoneLocksTx({
      prisma: fixture.prisma as never,
      targetPhoneNumberBeforeTransfer: null,
      transferPhoneNumber: PHONE_NUMBER,
    });

    expect(mocks.acquireHostedLinqParticipantPhoneLockTx).toHaveBeenCalledOnce();
  });

  it("normalizes and deduplicates equal prior and transferred phones", async () => {
    const fixture = makeFixture();

    await acquireHostedPrivyPhoneTransferPhoneLocksTx({
      prisma: fixture.prisma as never,
      targetPhoneNumberBeforeTransfer: "1 (555) 123-4567",
      transferPhoneNumber: PHONE_NUMBER,
    });

    expect(mocks.acquireHostedLinqParticipantPhoneLockTx).toHaveBeenCalledOnce();
    expect(mocks.acquireHostedLinqParticipantPhoneLockTx).toHaveBeenCalledWith({
      phoneNumber: PHONE_NUMBER,
      tx: fixture.prisma,
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

  it("fences the exact untouched Web Starter scaffold without Stripe cleanup", async () => {
    const fixture = makeFixture({ starterSource: "web_onboarding" });

    await expect(prepare(fixture)).resolves.toEqual({
      autoTrialBilling: null,
      sourceMemberId: SOURCE_MEMBER_ID,
    });
    expect(fixture.prisma.hostedUsageCreditEntry.findUnique).toHaveBeenCalledWith({
      where: {
        semanticSourceKey:
          buildHostedStarterUsageSemanticSourceKey(SOURCE_MEMBER_ID),
      },
      select: expect.objectContaining({
        amountUsdMicros: true,
        beneficiaryMemberId: true,
        grant: {
          select: { remainingUsdMicros: true },
        },
      }),
    });
  });

  it("fences the exact untouched companion Starter scaffold without a welcome item", async () => {
    const fixture = makeFixture({ starterSource: "companion_onboarding" });

    await expect(prepare(fixture)).resolves.toEqual({
      autoTrialBilling: null,
      sourceMemberId: SOURCE_MEMBER_ID,
    });
  });

  it("fences the exact untouched companion Starter scaffold with its hosted welcome", async () => {
    const fixture = makeFixture({
      includeStarterWelcome: true,
      starterSource: "companion_onboarding",
    });

    await expect(prepare(fixture)).resolves.toEqual({
      autoTrialBilling: null,
      sourceMemberId: SOURCE_MEMBER_ID,
    });
  });

  it("ignores platform-authored Starter welcome attempt timestamps", async () => {
    const fixture = makeFixture({ starterSource: "web_onboarding" });
    Object.assign(fixture.sourceShape, {
      signupNotificationEmailAttemptedAt: NOW,
      signupWelcomeEmailAttemptedAt: NOW,
    });

    await expect(prepare(fixture)).resolves.toEqual({
      autoTrialBilling: null,
      sourceMemberId: SOURCE_MEMBER_ID,
    });
  });

  it("rejects a Starter source after any of its canonical grant was consumed", async () => {
    const fixture = makeFixture({ starterSource: "web_onboarding" });
    fixture.starterGrant.grant.remainingUsdMicros = 4_000_000n;
    fixture.sourceShape.usageCreditBalanceUsdMicros = 4_000_000n;
    fixture.sourceShape.usageCreditLedgerVersion = 2n;
    fixture.sourceShape._count.usageCreditEntries = 2;

    await expect(prepare(fixture)).rejects.toMatchObject({
      code: "PRIVY_PHONE_TRANSFER_REQUIRES_SUPPORT",
    });
    expect(fixture.prisma.hostedMember.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a Web Starter scaffold without its canonical welcome item", async () => {
    const fixture = makeFixture({ starterSource: "web_onboarding" });
    const [activation, , runtimeControl] =
      await fixture.prisma.hostedMailboxItem.findMany();
    fixture.prisma.hostedMailboxItem.findMany.mockResolvedValue([
      activation,
      runtimeControl,
    ]);
    fixture.prisma.hostedMailboxLaneCounter.findMany.mockResolvedValue([
      { consumedSeq: 0n, lane: "causal", nextSeq: 3n },
      { consumedSeq: 0n, lane: "system", nextSeq: 3n },
    ]);

    await expect(prepare(fixture)).rejects.toMatchObject({
      code: "PRIVY_PHONE_TRANSFER_REQUIRES_SUPPORT",
    });
  });

  it("accepts a companion Starter welcome before runtime controls are enqueued", async () => {
    const fixture = makeFixture({ starterSource: "companion_onboarding" });
    const activationEventId =
      `member.activated:hosted.starter_usage.enrolled:${SOURCE_MEMBER_ID}:`
      + buildHostedStarterUsageSemanticSourceKey(SOURCE_MEMBER_ID);
    fixture.prisma.hostedMailboxItem.findMany.mockResolvedValue([
      mailboxItem(1, "member.activated", activationEventId),
      mailboxItem(
        2,
        "assistant.notification.requested",
        `assistant.notification.requested:signup-welcome:${SOURCE_MEMBER_ID}:${activationEventId}`,
      ),
    ]);
    fixture.prisma.hostedMailboxLaneCounter.findMany.mockResolvedValue([
      { consumedSeq: 0n, lane: "causal", nextSeq: 3n },
      { consumedSeq: 0n, lane: "system", nextSeq: 3n },
    ]);

    await expect(prepare(fixture)).resolves.toEqual({
      autoTrialBilling: null,
      sourceMemberId: SOURCE_MEMBER_ID,
    });
  });

  it("rejects a Starter grant with a noncanonical first ledger sequence", async () => {
    const fixture = makeFixture({ starterSource: "web_onboarding" });
    fixture.starterGrant.beneficiarySequence = 2n;

    await expect(prepare(fixture)).rejects.toMatchObject({
      code: "PRIVY_PHONE_TRANSFER_REQUIRES_SUPPORT",
    });
  });

  it.each([
    ["conversation-bearing", "linq_instant_start"],
    ["legacy-migrated", "legacy_trial_migration"],
  ] as const)(
    "rejects a %s Starter grant source",
    async (_label, source) => {
      const fixture = makeFixture({ starterSource: "web_onboarding" });
      fixture.starterGrant.sourceReferenceLookupKey =
        buildHostedStarterUsageSourceReferenceLookupKey(source);

      await expect(prepare(fixture)).rejects.toMatchObject({
        code: "PRIVY_PHONE_TRANSFER_REQUIRES_SUPPORT",
      });
      expect(fixture.prisma.hostedMember.updateMany).not.toHaveBeenCalled();
    },
  );

  it("ignores an expired hosted callback nonce on an otherwise disposable source", async () => {
    const fixture = makeFixture({ autoTrial: true });
    stubHostedCallbackNonce(fixture, new Date(NOW.getTime() - 1));

    await expect(prepare(fixture)).resolves.toEqual({
      autoTrialBilling: {
        stripeCustomerId: STRIPE_CUSTOMER_ID,
        stripeSubscriptionId: STRIPE_SUBSCRIPTION_ID,
      },
      sourceMemberId: SOURCE_MEMBER_ID,
    });
    expect(
      fixture.prisma.hostedWebInternalRequestNonce.findFirst,
    ).toHaveBeenCalledWith({
      where: {
        expiresAt: { gte: NOW },
        userId: SOURCE_MEMBER_ID,
      },
      select: { nonceHash: true },
    });
  });

  it.each([
    ["at the exact freshness boundary", NOW],
    ["after the freshness boundary", new Date(NOW.getTime() + 1)],
  ])("keeps a hosted callback nonce %s as a source blocker", async (
    _label,
    expiresAt,
  ) => {
    const fixture = makeFixture({ autoTrial: true });
    stubHostedCallbackNonce(fixture, expiresAt);

    await expect(prepare(fixture)).rejects.toMatchObject({
      code: "PRIVY_PHONE_TRANSFER_REQUIRES_SUPPORT",
    });
    expect(fixture.prisma.hostedMember.updateMany).not.toHaveBeenCalled();
  });

  it("lets Settings phone sync retire a source with only an expired callback nonce", async () => {
    const fixture = makeFixture({ autoTrial: true });
    stubHostedCallbackNonce(fixture, new Date(0));
    const prisma = Object.assign(fixture.prisma, {
      $transaction: vi.fn(
        async (callback: (tx: typeof fixture.prisma) => Promise<unknown>) =>
          callback(fixture.prisma),
      ),
    });
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.hostedPhoneLookupKeyMatchesValue.mockReturnValue(true);
    mocks.lookupHostedMemberIdentityByPhoneNumber.mockResolvedValue({
      core: { id: SOURCE_MEMBER_ID },
      identity: { privyUserId: SOURCE_PRIVY_USER_ID },
    });
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
    mocks.readHostedPrivyUserById.mockResolvedValue({
      id: TARGET_PRIVY_USER_ID,
    });
    mocks.buildHostedPrivySessionState.mockReturnValue({
      identity: {
        phone: {
          number: PHONE_NUMBER,
          verifiedAt: NOW.getTime(),
        },
        telegram: null,
        userId: TARGET_PRIVY_USER_ID,
      },
      linkedAccounts: [],
      verifiedPrivyUser: {
        id: TARGET_PRIVY_USER_ID,
      },
    });
    mocks.requireFreshPrivyMemberAuthForHostedAppSession.mockResolvedValue({
      appSession: {
        member: fixture.targetMember,
        privyUserId: TARGET_PRIVY_USER_ID,
        sessionId: "session_target",
      },
      freshPrivy: {
        identity: {
          phone: null,
          telegram: null,
          userId: TARGET_PRIVY_USER_ID,
        },
        linkedAccounts: [],
        member: fixture.targetMember,
      },
    });
    mocks.deleteHostedPrivyPhoneTransferSourceAccountData.mockResolvedValue({
      channelSyncDispatch: null,
      deletion: {
        cleanupPending: false,
      },
    });
    const route = await import("../app/api/settings/phone/sync/route");

    const response = await route.POST(
      new Request("https://join.example.test/api/settings/phone/sync", {
        body: JSON.stringify({
          kind: "exact",
          phoneNumber: PHONE_NUMBER,
        }),
        headers: {
          "content-type": "application/json",
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      phoneNumber: PHONE_NUMBER,
      status: "synced",
    });
    expect(JSON.stringify(body)).not.toContain(
      "PRIVY_PHONE_TRANSFER_REQUIRES_SUPPORT",
    );
    expect(JSON.stringify(body)).not.toContain("saved activity");
    expect(
      fixture.prisma.hostedWebInternalRequestNonce.findFirst,
    ).toHaveBeenCalledWith({
      where: {
        expiresAt: { gte: expect.any(Date) },
        userId: SOURCE_MEMBER_ID,
      },
      select: { nonceHash: true },
    });
  });

  it("retries an exact automatic-trial scaffold after cleanup cancellation", async () => {
    const fixture = makeFixture({ autoTrial: true });
    if (!fixture.billingSnapshot) {
      throw new TypeError("Expected automatic-trial billing fixture.");
    }
    fixture.sourceMember.billingStatus = HostedBillingStatus.canceled;
    fixture.sourceMember.suspendedAt = NOW;
    fixture.sourceShape.billingStatus = HostedBillingStatus.canceled;
    fixture.billingSnapshot.billingRef.currentBillingPhase = null;

    await expect(prepare(fixture)).resolves.toEqual({
      autoTrialBilling: {
        stripeCustomerId: STRIPE_CUSTOMER_ID,
        stripeSubscriptionId: STRIPE_SUBSCRIPTION_ID,
      },
      sourceMemberId: SOURCE_MEMBER_ID,
    });
    expect(fixture.prisma.hostedMember.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ["active + trial", HostedBillingStatus.active, "trial", true],
    ["canceled + null", HostedBillingStatus.canceled, null, true],
    ["incomplete + null", HostedBillingStatus.incomplete, null, true],
    ["canceled + trial", HostedBillingStatus.canceled, "trial", false],
    ["active + null", HostedBillingStatus.active, null, false],
  ] as const)(
    "enforces the exact automatic-trial lifecycle pair for %s",
    async (
      _label,
      billingStatus,
      currentBillingPhase,
      isAccepted,
    ) => {
      const fixture = makeFixture({ autoTrial: true });
      if (!fixture.billingSnapshot) {
        throw new TypeError("Expected automatic-trial billing fixture.");
      }
      fixture.sourceMember.billingStatus = billingStatus;
      fixture.sourceMember.suspendedAt =
        billingStatus === HostedBillingStatus.active ? null : NOW;
      fixture.sourceShape.billingStatus = billingStatus;
      fixture.billingSnapshot.billingRef.currentBillingPhase =
        currentBillingPhase;

      if (isAccepted) {
        await expect(prepare(fixture)).resolves.toEqual({
          autoTrialBilling: {
            stripeCustomerId: STRIPE_CUSTOMER_ID,
            stripeSubscriptionId: STRIPE_SUBSCRIPTION_ID,
          },
          sourceMemberId: SOURCE_MEMBER_ID,
        });
        return;
      }

      await expect(prepare(fixture)).rejects.toMatchObject({
        code: "PRIVY_PHONE_TRANSFER_REQUIRES_SUPPORT",
      });
    },
  );

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

  it("fences an automatic-trial scaffold the runtime already booted", async () => {
    const fixture = makeFixture({ autoTrial: true });
    const activationEventId =
      `member.activated:hosted.auto_pulse_trial.enrolled:${SOURCE_MEMBER_ID}:auto-pulse-trial:${STRIPE_SUBSCRIPTION_ID}`;
    // The welcome delivery established the provider chat identity and
    // observed the phone participant handle within seconds of signup.
    fixture.prisma.hostedMemberRouting.findUnique.mockResolvedValue({
      ...makeAutoTrialRouting(),
      linqChatIdEncrypted: "chat-ciphertext",
      linqChatLookupKey: "chat:established",
      linqParticipantContactKind: "phone",
      linqParticipantContactLookupKey: "participant:phone",
    });
    fixture.prisma.hostedWorkspace.findUnique.mockResolvedValue({
      acceptedAttemptFailureRecheckClaimedAt: null,
      browserVaultReplicaRef: null,
      checkpointedAt: NOW,
      inboxMediaRetentionSignalAttemptedAt: null,
      inboxMediaRetentionWakeAt: null,
      nextWakeAt: new Date(NOW.getTime() + 60_000),
      nextWakeReason: "maintenance",
      redactedStatusJson: null,
      snapshotRef: "snapshots/source",
      userId: SOURCE_MEMBER_ID,
      version: 6n,
    });
    fixture.prisma.hostedMailboxItem.findMany.mockResolvedValue([
      { ...mailboxItem(1, "member.activated", activationEventId), consumedAt: NOW },
      {
        ...mailboxItem(
          2,
          "assistant.notification.requested",
          `assistant.notification.requested:signup-welcome:${SOURCE_MEMBER_ID}:${activationEventId}`,
        ),
        consumedAt: NOW,
      },
      {
        ...mailboxItem(
          3,
          "runtime.browser-vault-refresh-requested",
          BROWSER_VAULT_REFRESH_CONTROL_EVENT_ID,
        ),
        consumedAt: NOW,
        occurredAt: new Date(NOW.getTime() + 30_000),
      },
      {
        ...mailboxItem(
          4,
          "runtime.browser-vault-refresh-requested",
          `${BROWSER_VAULT_REFRESH_CONTROL_EVENT_ID}later`,
        ),
        causalSeq: 9n,
        occurredAt: new Date(NOW.getTime() + 120_000),
      },
    ]);
    fixture.prisma.hostedMailboxLaneCounter.findMany.mockResolvedValue([
      { consumedSeq: 0n, lane: "causal", nextSeq: 76n },
      { consumedSeq: 0n, lane: "conversation", nextSeq: 1n },
      { consumedSeq: 3n, lane: "system", nextSeq: 55n },
    ]);
    fixture.sourceShape._count.hostedAiUsagePeriods = 1;
    fixture.sourceShape._count.hostedMailboxItems = 4;
    fixture.sourceShape._count.hostedMailboxLaneCounters = 3;
    fixture.sourceShape._count.hostedMailboxPayloads = 2;
    fixture.sourceShape._count.aiUsage = 2;
    fixture.sourceShape._count.linqDailyStates = 1;

    await expect(prepare(fixture)).resolves.toEqual({
      autoTrialBilling: {
        stripeCustomerId: STRIPE_CUSTOMER_ID,
        stripeSubscriptionId: STRIPE_SUBSCRIPTION_ID,
      },
      sourceMemberId: SOURCE_MEMBER_ID,
    });
  });

  it.each([
    {
      label: "a non-phone participant handle",
      routing: {
        linqParticipantContactKind: "email",
        linqParticipantContactLookupKey: "participant:email",
      },
    },
    {
      label: "a participant handle without its kind",
      routing: {
        linqParticipantContactLookupKey: "participant:unknown",
      },
    },
    {
      label: "a telegram routing identity",
      routing: {
        telegramUserIdEncrypted: "telegram-ciphertext",
        telegramUserLookupKey: "telegram:user",
      },
    },
  ])("rejects a source routing with $label", async ({ routing }) => {
    const fixture = makeFixture({ autoTrial: true });
    fixture.prisma.hostedMemberRouting.findUnique.mockResolvedValue({
      ...makeAutoTrialRouting(),
      ...routing,
    });

    await expect(prepare(fixture)).rejects.toMatchObject({
      code: "PRIVY_PHONE_TRANSFER_REQUIRES_SUPPORT",
    });
    expect(fixture.prisma.hostedMember.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a source routed through an unknown line", async () => {
    const fixture = makeFixture({ autoTrial: true });
    fixture.prisma.hostedLinqLine.findUnique.mockResolvedValue(null);

    await expect(prepare(fixture)).rejects.toMatchObject({
      code: "PRIVY_PHONE_TRANSFER_REQUIRES_SUPPORT",
    });
    expect(fixture.prisma.hostedMember.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a source whose conversation counter recorded any input", async () => {
    const fixture = makeFixture({ autoTrial: true });
    fixture.prisma.hostedMailboxLaneCounter.findMany.mockResolvedValue([
      { consumedSeq: 0n, lane: "causal", nextSeq: 4n },
      { consumedSeq: 1n, lane: "conversation", nextSeq: 2n },
      { consumedSeq: 0n, lane: "system", nextSeq: 4n },
    ]);

    await expect(prepare(fixture)).rejects.toMatchObject({
      code: "PRIVY_PHONE_TRANSFER_REQUIRES_SUPPORT",
    });
    expect(fixture.prisma.hostedMember.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a source holding a conversation-lane mailbox item", async () => {
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
        ...mailboxItem(3, "conversation.message", "conversation:inbound-1"),
        lane: "conversation",
        laneSeq: 1n,
      },
    ]);

    await expect(prepare(fixture)).rejects.toMatchObject({
      code: "PRIVY_PHONE_TRANSFER_REQUIRES_SUPPORT",
    });
    expect(fixture.prisma.hostedMember.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a source with an unexpected system mailbox kind", async () => {
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
        "member.preferences.updated",
        `member.preferences.updated:${SOURCE_MEMBER_ID}:1`,
      ),
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

  it.each([
    ["a connected-app intent", "connectedAppConnectIntents"],
    ["a Clinical connect intent", "clinicalRecordConnectIntents"],
    ["a Clinical OAuth session", "clinicalRecordOauthSessions"],
    ["a sensitive-action challenge", "sensitiveActionChallenges"],
  ] as const)("rejects a source retaining $label", async (_, relation) => {
    const fixture = makeFixture({ autoTrial: true });
    fixture.sourceShape._count[relation] = 1;

    await expect(prepare(fixture)).rejects.toMatchObject({
      code: "PRIVY_PHONE_TRANSFER_REQUIRES_SUPPORT",
    });
    expect(fixture.prisma.hostedMember.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ["a device-connect intent", "deviceConnectIntent", { claimHash: "claim" }],
    ["a device OAuth session", "deviceOauthSession", { state: "state" }],
  ] as const)("rejects a source retaining $label", async (_, model, blocker) => {
    const fixture = makeFixture({ autoTrial: true });
    fixture.prisma[model].findFirst.mockResolvedValue(blocker);

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

  it("does not suspend the source after the target phone projection changes", async () => {
    const fixture = makeFixture({
      autoTrial: true,
      targetPhoneNumber: "+15557654321",
    });

    await expect(prepare(fixture)).rejects.toMatchObject({
      code: "PRIVY_PHONE_NOT_READY",
    });
    expect(fixture.prisma.hostedMember.updateMany).not.toHaveBeenCalled();
  });

  it("rejects the final fence after the target phone projection changes", async () => {
    const fixture = makeFixture({
      autoTrial: true,
      targetPhoneNumber: "+15557654321",
    });
    fixture.sourceMember.billingStatus = HostedBillingStatus.canceled;
    fixture.sourceMember.suspendedAt = NOW;

    await expect(assertFence(fixture)).rejects.toMatchObject({
      code: "PRIVY_PHONE_NOT_READY",
    });
  });
});

type Fixture = ReturnType<typeof makeFixture>;

function stubHostedCallbackNonce(fixture: Fixture, expiresAt: Date): void {
  fixture.prisma.hostedWebInternalRequestNonce.findFirst.mockImplementation(
    async (input: {
      where: {
        expiresAt?: { gte?: Date };
        userId: string;
      };
    }) => {
      if (input.where.userId !== SOURCE_MEMBER_ID) {
        return null;
      }
      const activeFrom = input.where.expiresAt?.gte;
      if (
        activeFrom
        && expiresAt.getTime() < activeFrom.getTime()
      ) {
        return null;
      }
      return { nonceHash: "hosted-callback-nonce" };
    },
  );
}

function prepare(
  fixture: Fixture,
  targetPhoneNumberBeforeTransfer: string | null = null,
) {
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
    targetPhoneNumberBeforeTransfer,
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
    targetPhoneNumberBeforeTransfer: null,
    transfer: {
      phoneNumber: PHONE_NUMBER,
      sourceMemberId: SOURCE_MEMBER_ID,
      sourcePrivyUserId: SOURCE_PRIVY_USER_ID,
    },
  });
}

function makeFixture(input: {
  autoTrial?: boolean;
  includeStarterWelcome?: boolean;
  starterSource?: Extract<
    HostedStarterUsageSource,
    "companion_onboarding" | "web_onboarding"
  >;
  targetPhoneNumber?: string | null;
} = {}) {
  const autoTrial = input.autoTrial ?? false;
  const starterSource = input.starterSource ?? null;
  const includeStarterWelcome = starterSource !== null
    && (input.includeStarterWelcome ?? starterSource === "web_onboarding");
  const includeActivationWelcome = autoTrial || includeStarterWelcome;
  const activated = autoTrial || starterSource !== null;
  const targetMember = makeMember({
    billingStatus: HostedBillingStatus.active,
    id: TARGET_MEMBER_ID,
  });
  const sourceMember = makeMember({
    billingStatus: activated
      ? HostedBillingStatus.active
      : HostedBillingStatus.not_started,
    id: SOURCE_MEMBER_ID,
  });
  const targetIdentity = {
    ...emptyIdentity(),
    memberId: TARGET_MEMBER_ID,
    phoneNumber: input.targetPhoneNumber ?? null,
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
    hostedWorkspace: activated ? { userId: SOURCE_MEMBER_ID } : null,
    routing: activated ? { memberId: SOURCE_MEMBER_ID } : null,
    usageCreditBalanceUsdMicros: starterSource
      ? HOSTED_STARTER_USAGE_GRANT_USD_MICROS
      : 0n,
    usageCreditLedgerVersion: starterSource ? 1n : 0n,
    _count: makeRelationCounts({
      activated,
      mailboxItems: activated
        ? includeActivationWelcome ? 3 : 2
        : 0,
      starter: Boolean(starterSource),
    }),
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
          currentBillingPhase: "trial" as string | null,
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
  const starterSemanticSourceKey = buildHostedStarterUsageSemanticSourceKey(
    SOURCE_MEMBER_ID,
  );
  const starterGrant = {
    amountUsdMicros: HOSTED_STARTER_USAGE_GRANT_USD_MICROS,
    beneficiaryMemberId: SOURCE_MEMBER_ID,
    beneficiarySequence: 1n,
    grant: {
      remainingUsdMicros: HOSTED_STARTER_USAGE_GRANT_USD_MICROS,
    },
    kind: "starter_grant",
    parentGrantEntryId: null,
    purchaseId: null,
    referralId: null,
    sourceReferenceLookupKey: starterSource
      ? buildHostedStarterUsageSourceReferenceLookupKey(starterSource)
      : null,
    sourceUsageId: null,
  };
  const activationEventId = autoTrial
    ? `member.activated:hosted.auto_pulse_trial.enrolled:${SOURCE_MEMBER_ID}:auto-pulse-trial:${STRIPE_SUBSCRIPTION_ID}`
    : starterSource
      ? `member.activated:hosted.starter_usage.enrolled:${SOURCE_MEMBER_ID}:${starterSemanticSourceKey}`
      : null;
  const consentSource = starterSource === "companion_onboarding"
    ? "native-companion"
    : "homepage-auth-dialog";
  const cryptoDomains = activated
    ? ["control", "device", "ingress", "runtime"]
    : ["control"];
  const activationMailboxItems = activationEventId
    ? [
        mailboxItem(1, "member.activated", activationEventId),
        ...(includeActivationWelcome
          ? [
              mailboxItem(
                2,
                "assistant.notification.requested",
                `assistant.notification.requested:signup-welcome:${SOURCE_MEMBER_ID}:${activationEventId}`,
              ),
            ]
          : []),
        mailboxItem(
          includeActivationWelcome ? 3 : 2,
          "runtime.browser-vault-refresh-requested",
          BROWSER_VAULT_REFRESH_CONTROL_EVENT_ID,
        ),
      ]
    : [];
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
      findMany: vi.fn().mockResolvedValue(activated
        ? [
            {
              action: "accepted",
              scope: "launch.health-data",
              source: consentSource,
            },
            {
              action: "accepted",
              scope: "launch.legal",
              source: consentSource,
            },
          ]
        : []),
    },
    hostedConsentGrant: {
      findMany: vi.fn().mockResolvedValue(activated
        ? [
            {
              revokedAt: null,
              scope: "launch.health-data",
              source: consentSource,
              status: "granted",
            },
            {
              revokedAt: null,
              scope: "launch.legal",
              source: consentSource,
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
    hostedLinqLine: {
      findUnique: vi.fn().mockResolvedValue(activated
        ? { phoneNumberLookupKey: `phone:${PHONE_NUMBER}` }
        : null),
    },
    hostedMailboxItem: {
      findMany: vi.fn().mockResolvedValue(activationMailboxItems),
    },
    hostedMailboxLaneCounter: {
      findMany: vi.fn().mockResolvedValue(activated
        ? [
            {
              consumedSeq: 0n,
              lane: "causal",
              nextSeq: BigInt(activationMailboxItems.length + 1),
            },
            {
              consumedSeq: 0n,
              lane: "system",
              nextSeq: BigInt(activationMailboxItems.length + 1),
            },
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
      findUnique: vi.fn().mockResolvedValue(activated
        ? makeAutoTrialRouting()
        : null),
    },
    hostedUsageCreditEntry: {
      findUnique: vi.fn().mockImplementation(
        async ({ where }: { where: { semanticSourceKey: string } }) =>
          starterSource
            && where.semanticSourceKey === starterSemanticSourceKey
            ? starterGrant
            : null,
      ),
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
      findUnique: vi.fn().mockResolvedValue(activated
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
    starterGrant,
    targetIdentity,
    targetMember,
  };
}

function makeAutoTrialRouting() {
  return {
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
    _count: makeRelationCounts({
      activated: false,
      mailboxItems: 0,
      starter: false,
    }),
  };
}

function makeRelationCounts(input: {
  activated: boolean;
  mailboxItems: number;
  starter: boolean;
}) {
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
    consentEvents: input.activated ? 2 : 0,
    consentGrants: input.activated ? 2 : 0,
    groupSponsorshipsPaid: 0,
    groupSponsorshipsReceived: 0,
    groupSponsorshipMomentsCreated: 0,
    hostedAiUsagePeriods: 0,
    hostedCryptoAudits: input.activated ? 4 : 1,
    hostedCryptoEnvelopes: input.activated ? 4 : 1,
    hostedGroupMemberships: 0,
    hostedGroupsOwned: 0,
    hostedMailboxItems: input.mailboxItems,
    hostedMailboxLaneCounters: input.activated ? 2 : 0,
    hostedMailboxPayloads: 0,
    linqContactCardShares: 0,
    linqDailyStates: 0,
    mealPhotoCaptureEnrollments: 0,
    ownedThreadContainers: 0,
    phoneCalls: 0,
    productFeedback: 0,
    sensitiveActionChallenges: 0,
    subscriptionCheckouts: 0,
    threadContainerParticipations: 0,
    usageCreditEntries: input.starter ? 1 : 0,
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
