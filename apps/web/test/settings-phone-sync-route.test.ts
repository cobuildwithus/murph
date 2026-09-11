import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  buildHostedPrivySessionState: vi.fn(),
  deleteHostedPrivyPhoneTransferSourceAccountData: vi.fn(),
  enqueueHostedMemberChannelsUpdatedForActiveMemberTx: vi.fn(),
  getPrisma: vi.fn(),
  hostedPhoneLookupKeyMatchesValue: vi.fn(),
  logHostedOnboardingDiagnostic: vi.fn(),
  prepareHostedPrivyPhoneTransferSourceRetirement: vi.fn(),
  prepareHostedPrivyPhoneTransferSourceRetirementTx: vi.fn(),
  prismaClient: {
    label: "test-prisma",
    $transaction: vi.fn(),
  },
  readHostedMemberIdentity: vi.fn(),
  readHostedPhoneHint: vi.fn(),
  readHostedPrivyPhoneTransferProof: vi.fn(),
  readHostedPrivyUserById: vi.fn(),
  reconcileHostedPrivyIdentityOnMemberTx: vi.fn(),
  requireFreshPrivyMemberAuthForHostedAppSession: vi.fn(),
  signalHostedMailboxAppendRuntime: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-onboarding/logging", () => ({
  logHostedOnboardingDiagnostic: mocks.logHostedOnboardingDiagnostic,
}));

vi.mock("@/src/lib/hosted-onboarding/contact-privacy", () => ({
  hostedPhoneLookupKeyMatchesValue: mocks.hostedPhoneLookupKeyMatchesValue,
  readHostedPhoneHint: mocks.readHostedPhoneHint,
}));

vi.mock("@/src/lib/hosted-privacy/account-data-service", () => ({
  deleteHostedPrivyPhoneTransferSourceAccountData:
    mocks.deleteHostedPrivyPhoneTransferSourceAccountData,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-identity-store", () => ({
  readHostedMemberIdentity: mocks.readHostedMemberIdentity,
}));

vi.mock("@/src/lib/hosted-onboarding/member-identity-service", () => ({
  reconcileHostedPrivyIdentityOnMemberTx: mocks.reconcileHostedPrivyIdentityOnMemberTx,
}));

vi.mock("@/src/lib/hosted-onboarding/privy-phone-transfer-retirement", () => ({
  HOSTED_PRIVY_PHONE_TRANSFER_RETIREMENT_TRANSACTION_OPTIONS: {
    maxWait: 5_000,
    timeout: 30_000,
  },
  prepareHostedPrivyPhoneTransferSourceRetirement:
    mocks.prepareHostedPrivyPhoneTransferSourceRetirement,
  prepareHostedPrivyPhoneTransferSourceRetirementTx:
    mocks.prepareHostedPrivyPhoneTransferSourceRetirementTx,
  readHostedPrivyPhoneTransferProof: mocks.readHostedPrivyPhoneTransferProof,
}));

vi.mock("@/src/lib/hosted-onboarding/privy", () => ({
  readHostedPrivyUserById: mocks.readHostedPrivyUserById,
}));

vi.mock("@/src/lib/hosted-onboarding/privy-user", () => ({
  buildHostedPrivySessionState: mocks.buildHostedPrivySessionState,
}));

vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({
  requireFreshPrivyMemberAuthForHostedAppSession:
    mocks.requireFreshPrivyMemberAuthForHostedAppSession,
}));

vi.mock("@/src/lib/hosted-onboarding/member-channel-sync", () => ({
  enqueueHostedMemberChannelsUpdatedForActiveMemberTx:
    mocks.enqueueHostedMemberChannelsUpdatedForActiveMemberTx,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: mocks.signalHostedMailboxAppendRuntime,
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingEnvironment: () => ({
    publicBaseUrl: "https://join.example.test",
  }),
}));

type SettingsPhoneSyncRouteModule = typeof import("../app/api/settings/phone/sync/route");

let settingsPhoneSyncRoute: SettingsPhoneSyncRouteModule;
const SAME_ORIGIN_HEADERS = {
  "content-type": "application/json",
  origin: "https://join.example.test",
};

describe("settings phone sync route", () => {
  beforeAll(async () => {
    settingsPhoneSyncRoute = await import("../app/api/settings/phone/sync/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue(mocks.prismaClient);
    mocks.readHostedPhoneHint.mockReturnValue("+1 415 555 2671");
    mocks.prismaClient.$transaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) => callback(mocks.prismaClient),
    );
    mocks.readHostedMemberIdentity.mockResolvedValue({
      phoneNumber: null,
    });
    mocks.hostedPhoneLookupKeyMatchesValue.mockReturnValue(true);
    mocks.readHostedPrivyUserById.mockResolvedValue({
      id: "did:privy:user_123",
    });
    mocks.buildHostedPrivySessionState.mockReturnValue({
      identity: {
        phone: {
          number: "+14155552671",
        },
        telegram: null,
        userId: "did:privy:user_123",
      },
      linkedAccounts: [],
      verifiedPrivyUser: {
        id: "did:privy:user_123",
      },
    });
    mocks.readHostedPrivyPhoneTransferProof.mockResolvedValue(null);
    mocks.reconcileHostedPrivyIdentityOnMemberTx.mockResolvedValue(undefined);
    mocks.prepareHostedPrivyPhoneTransferSourceRetirement.mockResolvedValue({
      rawFingerprint: "prepared-fingerprint",
      sourceIdentity: null,
      sourceMemberId: "member_unused",
      targetIdentity: null,
      targetMemberId: "member_123",
    });
    mocks.prepareHostedPrivyPhoneTransferSourceRetirementTx.mockResolvedValue({
      sourceMemberId: "member_unused",
    });
    mocks.deleteHostedPrivyPhoneTransferSourceAccountData.mockResolvedValue({
      channelSyncDispatch: {
        mailboxItemId: "mailbox_item_channels_phone_123",
      },
      deletion: {
        cleanupPending: false,
      },
    });
    mocks.enqueueHostedMemberChannelsUpdatedForActiveMemberTx.mockResolvedValue({
      mailboxItemId: "mailbox_item_channels_phone_123",
    });
    mocks.signalHostedMailboxAppendRuntime.mockResolvedValue({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:member_123",
    });
    mocks.requireFreshPrivyMemberAuthForHostedAppSession.mockResolvedValue({
      appSession: {
        expiresAt: new Date("2026-04-26T00:00:00.000Z"),
        member: {
          billingStatus: "active",
          id: "member_123",
          suspendedAt: null,
        },
        privyUserId: "did:privy:user_123",
        sessionId: "hws_123",
      },
      freshPrivy: {
        identity: {
          phone: null,
          telegram: {
            telegramUserId: "telegram_123",
          },
          userId: "did:privy:user_123",
        },
        linkedAccounts: [],
        member: {
          billingStatus: "active",
          id: "member_123",
          suspendedAt: null,
        },
      },
    });
  });

  it("syncs an exact management-read phone onto the same hosted member", async () => {
    const response = await postSync({
      kind: "exact",
      phoneNumber: "+14155552671",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.requireFreshPrivyMemberAuthForHostedAppSession).toHaveBeenCalledWith(
      expect.any(Request),
    );
    expect(mocks.readHostedPrivyUserById).toHaveBeenCalledWith("did:privy:user_123");
    expect(mocks.buildHostedPrivySessionState).toHaveBeenCalledWith({
      id: "did:privy:user_123",
    });
    expect(mocks.reconcileHostedPrivyIdentityOnMemberTx).toHaveBeenCalledWith({
      identity: {
        phone: {
          number: "+14155552671",
        },
        telegram: null,
        userId: "did:privy:user_123",
      },
      member: {
        billingStatus: "active",
        id: "member_123",
        suspendedAt: null,
      },
      now: expect.any(Date),
      prisma: mocks.prismaClient,
    });
    expect(mocks.enqueueHostedMemberChannelsUpdatedForActiveMemberTx).toHaveBeenCalledWith({
      linkedAccounts: [],
      memberId: "member_123",
      occurredAt: expect.any(String),
      prisma: mocks.prismaClient,
      sourceType: "settings.phone.sync",
    });
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: "member_123",
      mailboxItemId: "mailbox_item_channels_phone_123",
    });
    await expect(response.json()).resolves.toEqual({
      phoneNumber: "+14155552671",
      phoneNumberHint: "+1 415 555 2671",
      runTriggered: true,
      status: "synced",
    });
  });

  it("rejects cross-member phone claims before retirement, billing cleanup or identity writes", async () => {
    mocks.readHostedPrivyPhoneTransferProof.mockResolvedValue({
      phoneNumber: "+12025550146",
      sourceMemberId: "member_other",
      sourcePrivyUserId: "did:privy:other",
    });
    const response = await postSync({ kind: "exact", phoneNumber: "+14155552671" });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "PHONE_IDENTITY_CONFLICT" } });
    expect(mocks.prepareHostedPrivyPhoneTransferSourceRetirement).not.toHaveBeenCalled();
    expect(mocks.prepareHostedPrivyPhoneTransferSourceRetirementTx).not.toHaveBeenCalled();
    expect(mocks.deleteHostedPrivyPhoneTransferSourceAccountData).not.toHaveBeenCalled();
    expect(mocks.reconcileHostedPrivyIdentityOnMemberTx).not.toHaveBeenCalled();
    expect(mocks.prismaClient.$transaction).not.toHaveBeenCalled();
  });

  it("repairs an incomplete canonical projection even when the phone text already matches", async () => {
    mocks.readHostedMemberIdentity.mockResolvedValue({
      phoneNumber: "+14155552671",
      phoneNumberVerifiedAt: null,
      phoneLookupKey: "phone_lookup",
      privyUserId: "did:privy:user_123",
    });

    const response = await postSync({
      kind: "exact",
      phoneNumber: "+14155552671",
    });

    expect(response.status).toBe(200);
    expect(mocks.reconcileHostedPrivyIdentityOnMemberTx).toHaveBeenCalledTimes(1);
    expect(
      mocks.enqueueHostedMemberChannelsUpdatedForActiveMemberTx,
    ).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toMatchObject({
      phoneNumber: "+14155552671",
      status: "synced",
    });
  });

  it("treats an unchanged transfer baseline as a quiet cancellation", async () => {
    mocks.readHostedMemberIdentity.mockResolvedValue({
      phoneNumber: "+14155552671",
      phoneNumberVerifiedAt: new Date("2026-04-06T10:00:00.000Z"),
      phoneLookupKey: "phone_lookup",
      privyUserId: "did:privy:user_123",
    });
    const response = await postSync({
      kind: "changed-from",
      phoneNumber: "+14155552671",
    });

    expect(response.status).toBe(200);
    expect(mocks.reconcileHostedPrivyIdentityOnMemberTx).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedMemberChannelsUpdatedForActiveMemberTx).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      status: "unchanged",
    });
  });

  it("syncs only after a transfer changes the provider phone from its baseline", async () => {
    const response = await postSync({
      kind: "changed-from",
      phoneNumber: "+14155550000",
    });

    expect(response.status).toBe(200);
    expect(mocks.reconcileHostedPrivyIdentityOnMemberTx).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toMatchObject({
      phoneNumber: "+14155552671",
      status: "synced",
    });
  });

  it("waits when exact success has not reached the management-read user yet", async () => {
    const response = await postSync({
      kind: "exact",
      phoneNumber: "+14155550000",
    });

    expect(response.status).toBe(409);
    expect(mocks.logHostedOnboardingDiagnostic).toHaveBeenCalledWith(
      "hosted-onboarding.phone-sync.provider-state",
      expect.objectContaining({
        expectationKind: "exact", expectedPhonePresent: true,
        providerPhonePresent: true, providerPhoneMatchesExpectation: false,
        providerPhoneState: "verified",
      }),
    );
    expect(mocks.reconcileHostedPrivyIdentityOnMemberTx).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "PRIVY_PHONE_NOT_READY",
        message: "Your verified phone number has not reached Privy yet. Wait a moment and try again.",
        retryable: true,
      },
    });
  });

  it.each([
    { accounts: [], state: "absent_account" },
    { accounts: [{ type: "phone", number: "+14155552671" }], state: "unusable_account" },
    { accounts: [{ type: "phone", number: "invalid-private-value", verified_at: 1_700_000_000 }], state: "unusable_account" },
  ])("records $state before rejecting an exact phone, without private values", async ({ accounts, state }) => {
    const { buildHostedPrivySessionState } = await vi.importActual<typeof import("../src/lib/hosted-onboarding/privy-user")>(
      "../src/lib/hosted-onboarding/privy-user",
    );
    mocks.buildHostedPrivySessionState.mockImplementationOnce(buildHostedPrivySessionState);
    mocks.readHostedPrivyUserById.mockResolvedValueOnce({
      id: "did:privy:user_123",
      linked_accounts: [
        { type: "email", address: "private@example.test", verified_at: 1_700_000_000 },
        ...accounts,
      ],
    });
    const response = await postSync({ kind: "exact", phoneNumber: "+14155550000" });

    expect(response.status).toBe(409);
    expect(mocks.reconcileHostedPrivyIdentityOnMemberTx).not.toHaveBeenCalled();
    expect(mocks.logHostedOnboardingDiagnostic).toHaveBeenCalledExactlyOnceWith(
      "hosted-onboarding.phone-sync.provider-state", {
        memberRef: expect.stringMatching(/^[a-f0-9]{16}$/u),
        expectationKind: "exact", expectedPhonePresent: true,
        providerPhonePresent: false, providerPhoneAccountPresent: accounts.length > 0,
        providerPhoneMatchesExpectation: false, providerPhoneState: state,
      },
    );
    const logged = JSON.stringify(mocks.logHostedOnboardingDiagnostic.mock.calls);
    for (const privateValue of ["member_123", "did:privy:user_123", "+14155550000", "+14155552671", "invalid-private-value", "private@example.test"]) {
      expect(logged).not.toContain(privateValue);
    }
  });

  it.each([
    { phoneNumber: "+14155552671", status: 200 },
    { phoneNumber: "+14155550000", status: 409 },
  ])("preserves status $status when diagnostics throw", async ({ phoneNumber, status }) => {
    mocks.logHostedOnboardingDiagnostic.mockImplementationOnce(() => { throw new Error("logger unavailable"); });
    const response = await postSync({ kind: "exact", phoneNumber });
    expect(response.status).toBe(status);
    expect(mocks.reconcileHostedPrivyIdentityOnMemberTx).toHaveBeenCalledTimes(status === 200 ? 1 : 0);
  });

  it("waits through an absent intermediate state in an existing-phone transfer", async () => {
    mocks.buildHostedPrivySessionState.mockReturnValue({
      identity: {
        phone: null,
        telegram: {
          telegramUserId: "telegram_123",
        },
        userId: "did:privy:user_123",
      },
      linkedAccounts: [],
      verifiedPrivyUser: {
        id: "did:privy:user_123",
      },
    });

    const response = await postSync({
      kind: "changed-from",
      phoneNumber: "+14155550000",
    });

    expect(response.status).toBe(409);
    expect(mocks.reconcileHostedPrivyIdentityOnMemberTx).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "PRIVY_PHONE_NOT_READY",
        retryable: true,
      },
    });
  });

  it("treats an unchanged phone-less transfer as a quiet cancellation", async () => {
    mocks.buildHostedPrivySessionState.mockReturnValue({
      identity: {
        phone: null,
        telegram: {
          telegramUserId: "telegram_123",
        },
        userId: "did:privy:user_123",
      },
      linkedAccounts: [],
      verifiedPrivyUser: {
        id: "did:privy:user_123",
      },
    });

    const response = await postSync({
      kind: "changed-from",
      phoneNumber: null,
    });

    expect(response.status).toBe(200);
    expect(mocks.readHostedMemberIdentity).not.toHaveBeenCalled();
    expect(mocks.reconcileHostedPrivyIdentityOnMemberTx).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      status: "unchanged",
    });
  });

  it("does not dispatch channel sync when the hosted member is not active", async () => {
    mocks.enqueueHostedMemberChannelsUpdatedForActiveMemberTx.mockResolvedValueOnce(null);

    const response = await postSync({
      kind: "exact",
      phoneNumber: "+14155552671",
    });

    expect(response.status).toBe(200);
    expect(mocks.reconcileHostedPrivyIdentityOnMemberTx).toHaveBeenCalledTimes(1);
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      runTriggered: false,
      status: "synced",
    });
  });

  it("blocks suspended hosted members before reading or syncing provider state", async () => {
    mocks.requireFreshPrivyMemberAuthForHostedAppSession.mockResolvedValue({
      appSession: {
        member: {
          id: "member_123",
        },
        privyUserId: "did:privy:user_123",
      },
      freshPrivy: {
        member: {
          billingStatus: "active",
          id: "member_123",
          suspendedAt: new Date("2026-04-07T01:00:00.000Z"),
        },
      },
    });

    const response = await postSync({
      kind: "exact",
      phoneNumber: "+14155552671",
    });

    expect(response.status).toBe(403);
    expect(mocks.readHostedPrivyUserById).not.toHaveBeenCalled();
    expect(mocks.reconcileHostedPrivyIdentityOnMemberTx).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_MEMBER_SUSPENDED",
      },
    });
  });

  it("requires the fresh same-member Privy gate before management lookup", async () => {
    mocks.requireFreshPrivyMemberAuthForHostedAppSession.mockRejectedValue(
      hostedOnboardingError({
        code: "PRIVY_SESSION_MEMBER_MISMATCH",
        httpStatus: 409,
        message: "This Privy login does not match your current Murph session.",
      }),
    );

    const response = await postSync({
      kind: "exact",
      phoneNumber: "+14155552671",
    });

    expect(response.status).toBe(409);
    expect(mocks.readHostedPrivyUserById).not.toHaveBeenCalled();
    expect(mocks.reconcileHostedPrivyIdentityOnMemberTx).not.toHaveBeenCalled();
  });

  it("rejects malformed sync expectations before any identity write", async () => {
    const response = await postSync({
      kind: "exact",
      phoneNumber: "not-a-phone",
    });

    expect(response.status).toBe(400);
    expect(mocks.reconcileHostedPrivyIdentityOnMemberTx).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "PHONE_SYNC_REQUEST_INVALID",
      },
    });
  });

  it("surfaces identity conflicts without weakening the member ownership gate", async () => {
    mocks.reconcileHostedPrivyIdentityOnMemberTx.mockRejectedValue(
      hostedOnboardingError({
        code: "PRIVY_IDENTITY_CONFLICT",
        httpStatus: 409,
        message: "That phone number is already linked to a different Murph account.",
      }),
    );

    const response = await postSync({
      kind: "exact",
      phoneNumber: "+14155552671",
    });

    expect(response.status).toBe(409);
    expect(mocks.readHostedPrivyUserById).toHaveBeenCalledWith("did:privy:user_123");
    expect(mocks.reconcileHostedPrivyIdentityOnMemberTx).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "PRIVY_IDENTITY_CONFLICT",
        message: "That phone number is already linked to a different Murph account.",
        retryable: false,
      },
    });
  });
});

async function postSync(expectation: Record<string, unknown>): Promise<Response> {
  return settingsPhoneSyncRoute.POST(
    new Request("https://join.example.test/api/settings/phone/sync", {
      body: JSON.stringify(expectation),
      headers: SAME_ORIGIN_HEADERS,
      method: "POST",
    }),
  );
}
