import { HostedBillingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  activateHostedMemberForPositiveSourceTx: vi.fn(),
  ensureHostedMemberForPrivyIdentity: vi.fn(),
  getPrisma: vi.fn(),
  lookupHostedMemberIdentityByPrivyUserId: vi.fn(),
  materializePendingHostedGroupJoinConfirmationsBestEffort: vi.fn(),
  prepareHostedCryptoDomainRootCandidates: vi.fn(),
  privyClientConstructor: vi.fn(),
  privyGetByEmailAddress: vi.fn(),
  privySetCustomMetadata: vi.fn(),
  readHostedConsentStatus: vi.fn(),
  recordHostedLaunchRequiredConsent: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@privy-io/node", () => ({
  APIError: class APIError extends Error {},
  PrivyClient: class PrivyClient {
    constructor(input: unknown) {
      dependencies.privyClientConstructor(input);
    }

    users() {
      return {
        getByEmailAddress: dependencies.privyGetByEmailAddress,
        setCustomMetadata: dependencies.privySetCustomMetadata,
      };
    }
  },
  verifyIdentityToken: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/env", () => ({
  readHostedOnboardingEnvironment: () => ({
    privyAppId: "cm_app_review",
    privyAppSecret: "privy-app-secret",
  }),
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingEnvironment: () => ({
    privyAppId: "cm_app_review",
    privyAppSecret: "privy-app-secret",
  }),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: dependencies.getPrisma,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-identity-store", () => ({
  lookupHostedMemberIdentityByPrivyUserId:
    dependencies.lookupHostedMemberIdentityByPrivyUserId,
}));

vi.mock("@/src/lib/hosted-onboarding/member-identity-service", () => ({
  ensureHostedMemberForPrivyIdentity: dependencies.ensureHostedMemberForPrivyIdentity,
}));

vi.mock("@/src/lib/hosted-onboarding/member-activation", () => ({
  activateHostedMemberForPositiveSourceTx:
    dependencies.activateHostedMemberForPositiveSourceTx,
}));

vi.mock("@/src/lib/hosted-crypto/domain-root-store", () => ({
  prepareHostedCryptoDomainRootCandidates:
    dependencies.prepareHostedCryptoDomainRootCandidates,
}));

vi.mock("@/src/lib/hosted-groups/group-join-confirmation", () => ({
  materializePendingHostedGroupJoinConfirmationsBestEffort:
    dependencies.materializePendingHostedGroupJoinConfirmationsBestEffort,
}));

vi.mock("@/src/lib/legal/consent", () => ({
  readHostedConsentStatus: dependencies.readHostedConsentStatus,
  recordHostedLaunchRequiredConsent: dependencies.recordHostedLaunchRequiredConsent,
}));

import { prepareHostedOpsAppReviewMember } from "@/src/lib/hosted-ops/app-review-member";

const NOW = new Date("2026-07-23T12:00:00.000Z");
const MEMBER_ID = "member_app_review";
const PRIVY_USER_ID = "did:privy:app_review";
const REVIEW_EMAIL = "reviewer@example.test";

describe("prepareHostedOpsAppReviewMember", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Reflect.deleteProperty(globalThis, "__murphHostedPrivyManagementClient");

    dependencies.privyGetByEmailAddress.mockResolvedValue({
      custom_metadata: {
        murph_member_id: "stale_member_hint",
      },
      id: PRIVY_USER_ID,
      linked_accounts: [
        {
          address: REVIEW_EMAIL,
          type: "email",
          verified_at: 1_753_276_800,
        },
      ],
    });
    dependencies.lookupHostedMemberIdentityByPrivyUserId.mockResolvedValue(null);
    dependencies.ensureHostedMemberForPrivyIdentity.mockResolvedValue({
      id: MEMBER_ID,
    });
    dependencies.activateHostedMemberForPositiveSourceTx.mockResolvedValue({
      activated: true,
    });
    dependencies.materializePendingHostedGroupJoinConfirmationsBestEffort.mockResolvedValue(
      undefined,
    );
    dependencies.prepareHostedCryptoDomainRootCandidates.mockResolvedValue(new Map());
    dependencies.recordHostedLaunchRequiredConsent.mockResolvedValue(undefined);
    dependencies.readHostedConsentStatus.mockResolvedValue({
      launchScopes: [
        { granted: true, scope: "launch.legal" },
        { granted: true, scope: "launch.health-data" },
      ],
    });

    const transactionPrisma = { transaction: "app-review" };
    dependencies.getPrisma.mockReturnValue({
      $transaction: vi.fn(
        async (callback: (tx: typeof transactionPrisma) => Promise<unknown>) =>
          callback(transactionPrisma),
      ),
      hostedMember: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.active,
          id: MEMBER_ID,
          suspendedAt: null,
        }),
      },
    });
  });

  it("applies reviewer access without writing redundant Privy member metadata", async () => {
    const summary = await prepareHostedOpsAppReviewMember({
      mode: "apply",
      now: NOW,
      principal: {
        kind: "email",
        value: REVIEW_EMAIL,
      },
    });

    expect(dependencies.privyClientConstructor).toHaveBeenCalledOnce();
    expect(dependencies.privyGetByEmailAddress).toHaveBeenCalledWith({
      address: REVIEW_EMAIL,
    });
    expect(dependencies.privySetCustomMetadata).not.toHaveBeenCalled();
    expect(dependencies.ensureHostedMemberForPrivyIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        authMethod: "email",
        identity: expect.objectContaining({
          userId: PRIVY_USER_ID,
        }),
        now: NOW,
      }),
    );
    expect(dependencies.activateHostedMemberForPositiveSourceTx).toHaveBeenCalledOnce();
    expect(
      dependencies.materializePendingHostedGroupJoinConfirmationsBestEffort,
    ).toHaveBeenCalledWith(expect.objectContaining({
      memberId: MEMBER_ID,
    }));
    expect(dependencies.recordHostedLaunchRequiredConsent).toHaveBeenCalledTimes(2);
    expect(summary).toMatchObject({
      action: "applied",
      activated: true,
      billingStatus: HostedBillingStatus.active,
      consentGranted: true,
      consentScopes: ["launch.legal", "launch.health-data"],
      suspended: false,
    });
    expect(summary).not.toHaveProperty("metadataSynced");
  });
});
