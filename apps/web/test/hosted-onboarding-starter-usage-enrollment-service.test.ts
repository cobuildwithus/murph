import { HostedBillingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class HostedCryptoDomainRootCandidateRequiredError extends Error {
    readonly domain: string;

    constructor(input: { domain: string }) {
      super(`Prepared hosted ${input.domain} domain root candidate is required.`);
      this.name = "HostedCryptoDomainRootCandidateRequiredError";
      this.domain = input.domain;
    }
  }

  return {
    HostedCryptoDomainRootCandidateRequiredError,
    activateHostedMemberForPositiveSourceTx: vi.fn(),
    assertHostedLaunchRequiredConsentGranted: vi.fn(),
    assertHostedMemberBillingStartMessagingReady: vi.fn(),
    ensureHostedStarterUsageGrantTx: vi.fn(),
    lockAndReadActiveHostedDomainRootKeyIdTx: vi.fn(),
    lockHostedUsageCreditBeneficiaryTx: vi.fn(),
    prepareHostedCryptoDomainRootCandidates: vi.fn(),
    prewarmPreparedHostedCryptoDomainRootForWeb: vi.fn(),
    providerWork: vi.fn(),
    readHostedStarterUsageGrantTx: vi.fn(),
    requireHostedInviteForBillingCheckout: vi.fn(),
    runWithHostedDomainRootUnwrapCache: vi.fn(),
    sendHostedSignupWelcomeEmailForMemberBestEffort: vi.fn(),
    signalHostedMemberActivationRuntimeWakeBestEffortResult: vi.fn(),
    unwrapHostedDomainRootForWeb: vi.fn(),
  };
});

vi.mock("@/src/lib/hosted-crypto/domain-root-store", () => ({
  HostedCryptoDomainRootCandidateRequiredError:
    mocks.HostedCryptoDomainRootCandidateRequiredError,
  lockAndReadActiveHostedDomainRootKeyIdTx:
    mocks.lockAndReadActiveHostedDomainRootKeyIdTx,
  prepareHostedCryptoDomainRootCandidates:
    mocks.prepareHostedCryptoDomainRootCandidates,
  prewarmPreparedHostedCryptoDomainRootForWeb:
    mocks.prewarmPreparedHostedCryptoDomainRootForWeb,
  unwrapHostedDomainRootForWeb: mocks.unwrapHostedDomainRootForWeb,
}));

vi.mock("@/src/lib/hosted-crypto/domain-root-unwrap-cache", () => ({
  runWithHostedDomainRootUnwrapCache:
    mocks.runWithHostedDomainRootUnwrapCache,
}));

vi.mock("@/src/lib/hosted-execution/usage-credit-ledger", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-execution/usage-credit-ledger")
  >("@/src/lib/hosted-execution/usage-credit-ledger");
  return {
    ...actual,
    lockHostedUsageCreditBeneficiaryTx:
      mocks.lockHostedUsageCreditBeneficiaryTx,
  };
});

vi.mock("@/src/lib/legal/consent", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/legal/consent")
  >("@/src/lib/legal/consent");
  return {
    ...actual,
    assertHostedLaunchRequiredConsentGranted:
      mocks.assertHostedLaunchRequiredConsentGranted,
  };
});

vi.mock("@/src/lib/hosted-onboarding/billing-start-preconditions", () => ({
  assertHostedMemberBillingStartMessagingReady:
    mocks.assertHostedMemberBillingStartMessagingReady,
}));

vi.mock("@/src/lib/hosted-onboarding/invite-service", () => ({
  requireHostedInviteForBillingCheckout:
    mocks.requireHostedInviteForBillingCheckout,
}));

vi.mock("@/src/lib/hosted-onboarding/member-activation", () => ({
  activateHostedMemberForPositiveSourceTx:
    mocks.activateHostedMemberForPositiveSourceTx,
}));

vi.mock("@/src/lib/hosted-onboarding/member-activation-runtime-wake", () => ({
  signalHostedMemberActivationRuntimeWakeBestEffortResult:
    mocks.signalHostedMemberActivationRuntimeWakeBestEffortResult,
}));

vi.mock("@/src/lib/hosted-onboarding/signup-welcome-email", () => ({
  sendHostedSignupWelcomeEmailForMemberBestEffort:
    mocks.sendHostedSignupWelcomeEmailForMemberBestEffort,
}));

vi.mock("@/src/lib/hosted-onboarding/starter-usage-grant", () => ({
  ensureHostedStarterUsageGrantTx: mocks.ensureHostedStarterUsageGrantTx,
  readHostedStarterUsageGrantTx: mocks.readHostedStarterUsageGrantTx,
}));

import {
  ensureHostedLinqInstantStartStarterUsageEnrollment,
  ensureHostedStarterUsageEnrollment,
} from "@/src/lib/hosted-onboarding/starter-usage-enrollment-service";

const NOW = new Date("2026-08-09T14:00:00.000Z");

type MemberState = {
  billingRef: {
    currentBillingPhase: string | null;
    currentCheckoutOffer: string | null;
    stripeSubscriptionLookupKey: string | null;
  } | null;
  billingStatus: HostedBillingStatus;
  id: string;
  suspendedAt: Date | null;
};

const ACTIVATION_CRYPTO_DOMAINS = ["control", "ingress"] as const;

type ActivationCryptoDomain = typeof ACTIVATION_CRYPTO_DOMAINS[number];

type CryptoEnvelope = {
  domain: ActivationCryptoDomain;
  rootKeyId: string;
  userId: string;
};

type ProviderWork = {
  domain?: ActivationCryptoDomain;
  kind:
    | "kms-sign"
    | "kms-unwrap"
    | "messaging"
    | "runtime-wake"
    | "welcome-email";
  rootKeyId?: string;
  transactionOpen: boolean;
};

let activeRootKeyIds: Map<ActivationCryptoDomain, string>;
let candidateGeneration: number;
let providerCallsInFlight: number;
let scopedRootKeyIds: Map<string, string> | null;
let transactionOpen: boolean;

describe("Starter usage enrollment owner", () => {
  let activationWritten: boolean;
  let createdGrantCount: number;
  let grantState: { effectiveAt: Date } | null;
  let memberState: MemberState;

  beforeEach(() => {
    vi.clearAllMocks();
    activationWritten = false;
    activeRootKeyIds = new Map([
      ["control", "control_active_1"],
      ["ingress", "ingress_active_1"],
    ]);
    candidateGeneration = 0;
    createdGrantCount = 0;
    grantState = null;
    memberState = buildMemberState();
    providerCallsInFlight = 0;
    scopedRootKeyIds = null;
    transactionOpen = false;

    mocks.runWithHostedDomainRootUnwrapCache.mockImplementation(
      async (callback: () => Promise<unknown>) => {
        if (scopedRootKeyIds) {
          return callback();
        }
        scopedRootKeyIds = new Map();
        try {
          return await callback();
        } finally {
          scopedRootKeyIds = null;
        }
      },
    );
    mocks.providerWork.mockImplementation(async (input: ProviderWork) => {
      if (input.transactionOpen) {
        throw new Error("Provider work executed inside the transaction callback.");
      }
    });
    mocks.requireHostedInviteForBillingCheckout.mockImplementation(
      async () => buildInvite(memberState),
    );
    mocks.assertHostedLaunchRequiredConsentGranted.mockResolvedValue(undefined);
    mocks.assertHostedMemberBillingStartMessagingReady.mockImplementation(
      async () => runProviderWork({ kind: "messaging" }),
    );
    mocks.prepareHostedCryptoDomainRootCandidates.mockImplementation(
      async (input: { userId: string }) => {
        candidateGeneration += 1;
        const prepared = new Map<ActivationCryptoDomain, CryptoEnvelope>();
        for (const domain of ACTIVATION_CRYPTO_DOMAINS) {
          if (activeRootKeyIds.has(domain)) {
            continue;
          }
          const envelope = buildCryptoEnvelope({
            domain,
            rootKeyId: `${domain}_candidate_${candidateGeneration}`,
            userId: input.userId,
          });
          await runProviderWork({
            domain,
            kind: "kms-sign",
            rootKeyId: envelope.rootKeyId,
          });
          prepared.set(domain, envelope);
        }
        return prepared;
      },
    );
    mocks.prewarmPreparedHostedCryptoDomainRootForWeb.mockImplementation(
      async (input: {
        domain: ActivationCryptoDomain;
        prepared: ReadonlyMap<ActivationCryptoDomain, CryptoEnvelope>;
        userId: string;
      }) => {
        const envelope = input.prepared.get(input.domain);
        if (!envelope) {
          throw new mocks.HostedCryptoDomainRootCandidateRequiredError({
            domain: input.domain,
          });
        }
        await runProviderWork({
          domain: input.domain,
          kind: "kms-unwrap",
          rootKeyId: envelope.rootKeyId,
        });
        cacheUnwrappedRoot(envelope);
      },
    );
    mocks.unwrapHostedDomainRootForWeb.mockImplementation(
      async (input: { domain: ActivationCryptoDomain; userId: string }) => {
        const activeCacheKey = buildActiveRootCacheKey(
          input.userId,
          input.domain,
        );
        const cachedRootKeyId = scopedRootKeyIds?.get(activeCacheKey);
        if (cachedRootKeyId) {
          return buildUnwrappedCryptoRoot({
            domain: input.domain,
            rootKeyId: cachedRootKeyId,
            userId: input.userId,
          });
        }

        const activeRootKeyId = activeRootKeyIds.get(input.domain);
        if (!activeRootKeyId) {
          throw new Error(`Active ${input.domain} root is unavailable.`);
        }
        await runProviderWork({
          domain: input.domain,
          kind: "kms-unwrap",
          rootKeyId: activeRootKeyId,
        });
        const root = buildCryptoEnvelope({
          domain: input.domain,
          rootKeyId: activeRootKeyId,
          userId: input.userId,
        });
        cacheUnwrappedRoot(root);
        return buildUnwrappedCryptoRoot(root);
      },
    );
    mocks.lockAndReadActiveHostedDomainRootKeyIdTx.mockImplementation(
      async (input: { domain: ActivationCryptoDomain }) =>
        activeRootKeyIds.get(input.domain) ?? null,
    );
    mocks.lockHostedUsageCreditBeneficiaryTx.mockResolvedValue({
      balanceUsdMicros: 0n,
      beneficiaryMemberId: memberState.id,
      ledgerVersion: 0n,
    });
    mocks.readHostedStarterUsageGrantTx.mockImplementation(async () => grantState);
    mocks.ensureHostedStarterUsageGrantTx.mockImplementation(async () => {
      if (!grantState) {
        grantState = { effectiveAt: NOW };
        createdGrantCount += 1;
      }
      return {
        balanceUsdMicros: 4_500_000n,
        effectiveAt: grantState.effectiveAt,
        entryId: "huce_starter",
        granted: createdGrantCount === 1,
        ledgerVersion: 1n,
      };
    });
    mocks.activateHostedMemberForPositiveSourceTx.mockImplementation(
      async (input: {
        memberId: string;
        preparedCryptoDomainRoots: ReadonlyMap<
          ActivationCryptoDomain,
          CryptoEnvelope
        >;
        prisma: unknown;
      }) => mocks.runWithHostedDomainRootUnwrapCache(async () => {
        for (const domain of ACTIVATION_CRYPTO_DOMAINS) {
          let rootKeyId = activeRootKeyIds.get(domain);
          if (!rootKeyId) {
            const candidate = input.preparedCryptoDomainRoots.get(domain);
            if (!candidate) {
              throw new mocks.HostedCryptoDomainRootCandidateRequiredError({
                domain,
              });
            }
            rootKeyId = candidate.rootKeyId;
            activeRootKeyIds.set(domain, rootKeyId);
          }

          const activeCacheKey = buildActiveRootCacheKey(input.memberId, domain);
          const concreteCacheKey = buildConcreteRootCacheKey(
            input.memberId,
            domain,
            rootKeyId,
          );
          if (
            scopedRootKeyIds?.get(activeCacheKey) !== rootKeyId
            || scopedRootKeyIds.get(concreteCacheKey) !== rootKeyId
          ) {
            await runProviderWork({
              domain,
              kind: "kms-unwrap",
              rootKeyId,
            });
          }
          const root = await mocks.unwrapHostedDomainRootForWeb({
            domain,
            prisma: input.prisma,
            userId: input.memberId,
          });
          root.rootKey.fill(0);
        }

        if (activationWritten) {
          return {
            activated: false,
            hostedExecutionEventId: null,
          };
        }
        activationWritten = true;
        return {
          activated: true,
          hostedExecutionEventId: "execution_activation_1",
        };
      }),
    );
    mocks.signalHostedMemberActivationRuntimeWakeBestEffortResult
      .mockImplementation(async () => {
        await runProviderWork({ kind: "runtime-wake" });
        return { signaled: true };
      });
    mocks.sendHostedSignupWelcomeEmailForMemberBestEffort
      .mockImplementation(async () => {
        await runProviderWork({ kind: "welcome-email" });
      });
  });

  it("enrolls once across supported channels and emits activation effects once", async () => {
    const prisma = buildPrisma(() => memberState);

    await expect(ensureHostedStarterUsageEnrollment({
      inviteCode: "invite_123",
      member: { id: memberState.id, suspendedAt: null },
      now: NOW,
      prisma: prisma as never,
      source: "web_onboarding",
    })).resolves.toEqual({
      redirectPath: "/home",
      status: "enrolled",
    });
    await expect(ensureHostedStarterUsageEnrollment({
      inviteCode: "invite_123",
      member: { id: memberState.id, suspendedAt: null },
      now: new Date("2026-08-09T14:05:00.000Z"),
      prisma: prisma as never,
      source: "companion_onboarding",
    })).resolves.toEqual({
      redirectPath: "/home",
      status: "already_enrolled",
    });

    expect(createdGrantCount).toBe(1);
    expect(mocks.activateHostedMemberForPositiveSourceTx).toHaveBeenCalledTimes(2);
    expect(mocks.signalHostedMemberActivationRuntimeWakeBestEffortResult)
      .toHaveBeenCalledOnce();
    expect(mocks.sendHostedSignupWelcomeEmailForMemberBestEffort)
      .toHaveBeenCalledOnce();
  });

  it("prewarms exact active roots and reuses both cache identities inside the transaction", async () => {
    const prisma = buildPrisma(() => memberState);

    await expect(ensureHostedStarterUsageEnrollment({
      inviteCode: "invite_123",
      member: { id: memberState.id, suspendedAt: null },
      now: NOW,
      prisma: prisma as never,
      source: "web_onboarding",
    })).resolves.toMatchObject({ status: "enrolled" });

    expect(mocks.prewarmPreparedHostedCryptoDomainRootForWeb)
      .not.toHaveBeenCalled();
    expect(readProviderWorkByKind("kms-unwrap")).toEqual([
      expect.objectContaining({
        domain: "control",
        rootKeyId: "control_active_1",
        transactionOpen: false,
      }),
      expect.objectContaining({
        domain: "ingress",
        rootKeyId: "ingress_active_1",
        transactionOpen: false,
      }),
    ]);
    expect(readLockedCryptoDomains()).toEqual(["control", "ingress"]);
    expectAllProviderWorkOutsideTransaction();
  });

  it("settles missing-root prewarms before BEGIN and reuses the exact candidates", async () => {
    activeRootKeyIds.clear();
    const ingressUnwrapStarted = createDeferred();
    const releaseIngressUnwrap = createDeferred();
    mocks.providerWork.mockImplementation(async (input: ProviderWork) => {
      if (input.transactionOpen) {
        throw new Error("Provider work executed inside the transaction callback.");
      }
      if (input.kind === "kms-unwrap" && input.domain === "ingress") {
        ingressUnwrapStarted.resolve();
        await releaseIngressUnwrap.promise;
      }
    });
    const prisma = buildPrisma(() => memberState);

    const enrollment = ensureHostedStarterUsageEnrollment({
      inviteCode: "invite_123",
      member: { id: memberState.id, suspendedAt: null },
      now: NOW,
      prisma: prisma as never,
      source: "web_onboarding",
    });
    await ingressUnwrapStarted.promise;
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(providerCallsInFlight).toBeGreaterThan(0);
    releaseIngressUnwrap.resolve();

    await expect(enrollment).resolves.toMatchObject({ status: "enrolled" });
    expect(readPreparedCryptoDomains()).toEqual(["control", "ingress"]);
    expect(activeRootKeyIds).toEqual(new Map([
      ["control", "control_candidate_1"],
      ["ingress", "ingress_candidate_1"],
    ]));
    expectAllProviderWorkOutsideTransaction();
  });

  it("reprepares once when a concurrent provision wins one missing-root race", async () => {
    activeRootKeyIds.clear();
    let injectedConcurrentControlRoot = false;
    const prisma = buildPrisma(
      () => memberState,
      undefined,
      false,
      () => {
        if (!injectedConcurrentControlRoot) {
          activeRootKeyIds.set("control", "control_competitor_1");
          injectedConcurrentControlRoot = true;
        }
      },
    );

    await expect(ensureHostedStarterUsageEnrollment({
      inviteCode: "invite_123",
      member: { id: memberState.id, suspendedAt: null },
      now: NOW,
      prisma: prisma as never,
      source: "web_onboarding",
    })).resolves.toMatchObject({ status: "enrolled" });

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(mocks.prepareHostedCryptoDomainRootCandidates).toHaveBeenCalledTimes(2);
    expect(mocks.ensureHostedStarterUsageGrantTx).toHaveBeenCalledOnce();
    expect(mocks.activateHostedMemberForPositiveSourceTx).toHaveBeenCalledOnce();
    expect(activeRootKeyIds).toEqual(new Map([
      ["control", "control_competitor_1"],
      ["ingress", "ingress_candidate_2"],
    ]));
    expectAllProviderWorkOutsideTransaction();
  });

  it("reprepares once when activation discovers a missing non-write root candidate", async () => {
    mocks.activateHostedMemberForPositiveSourceTx.mockImplementationOnce(
      async () => {
        throw new mocks.HostedCryptoDomainRootCandidateRequiredError({
          domain: "device",
        });
      },
    );
    let transactionAttempt = 0;
    const prisma = buildPrisma(
      () => memberState,
      undefined,
      false,
      () => {
        transactionAttempt += 1;
        if (transactionAttempt === 2) {
          grantState = null;
          createdGrantCount = 0;
        }
      },
    );

    await expect(ensureHostedStarterUsageEnrollment({
      inviteCode: "invite_123",
      member: { id: memberState.id, suspendedAt: null },
      now: NOW,
      prisma: prisma as never,
      source: "web_onboarding",
    })).resolves.toMatchObject({ status: "enrolled" });

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(mocks.prepareHostedCryptoDomainRootCandidates).toHaveBeenCalledTimes(2);
    expect(mocks.activateHostedMemberForPositiveSourceTx).toHaveBeenCalledTimes(2);
    expect(createdGrantCount).toBe(1);
    expectAllProviderWorkOutsideTransaction();
  });

  it("bounds repeated exact-root churn to two preparation attempts", async () => {
    let rootVersion = 0;
    const prisma = buildPrisma(
      () => memberState,
      undefined,
      false,
      () => {
        rootVersion += 1;
        activeRootKeyIds.set("control", `control_race_${rootVersion}`);
      },
    );

    await expect(ensureHostedStarterUsageEnrollment({
      inviteCode: "invite_123",
      member: { id: memberState.id, suspendedAt: null },
      now: NOW,
      prisma: prisma as never,
      source: "web_onboarding",
    })).rejects.toMatchObject({
      code: "HOSTED_STARTER_USAGE_CRYPTO_PREPARATION_REQUIRED",
      details: {
        domain: "control",
        reason: "active-root-changed",
      },
      httpStatus: 503,
      retryable: true,
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(mocks.prepareHostedCryptoDomainRootCandidates).toHaveBeenCalledTimes(2);
    expect(mocks.ensureHostedStarterUsageGrantTx).not.toHaveBeenCalled();
    expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
    expectAllProviderWorkOutsideTransaction();
  });

  it("keeps paid billing and conflicting history outside Starter authority", async () => {
    memberState = buildMemberState({
      billingRef: {
        currentBillingPhase: "paid",
        currentCheckoutOffer: "standard",
        stripeSubscriptionLookupKey: "subscription_lookup_paid",
      },
      billingStatus: HostedBillingStatus.active,
    });
    const paidPrisma = buildPrisma(() => memberState);

    await expect(ensureHostedStarterUsageEnrollment({
      inviteCode: "invite_123",
      member: { id: memberState.id, suspendedAt: null },
      now: NOW,
      prisma: paidPrisma as never,
      source: "web_onboarding",
    })).resolves.toMatchObject({ status: "already_active" });
    expect(mocks.ensureHostedStarterUsageGrantTx).not.toHaveBeenCalled();
    expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();

    memberState = buildMemberState({
      billingStatus: HostedBillingStatus.paused,
    });
    const historyPrisma = buildPrisma(() => memberState);
    await expect(ensureHostedStarterUsageEnrollment({
      inviteCode: "invite_123",
      member: { id: memberState.id, suspendedAt: null },
      now: NOW,
      prisma: historyPrisma as never,
      source: "web_onboarding",
    })).rejects.toMatchObject({
      code: "HOSTED_STARTER_USAGE_ENROLLMENT_BLOCKED",
      httpStatus: 409,
    });
  });

  it("keeps active Family sponsorship outside Starter grant authority", async () => {
    const prisma = buildPrisma(() => memberState, undefined, true);

    await expect(ensureHostedStarterUsageEnrollment({
      inviteCode: "invite_123",
      member: { id: memberState.id, suspendedAt: null },
      now: NOW,
      prisma: prisma as never,
      source: "web_onboarding",
    })).resolves.toEqual({
      redirectPath: "/home",
      status: "already_active",
    });

    expect(mocks.ensureHostedStarterUsageGrantTx).not.toHaveBeenCalled();
    expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
    expect(prisma.hostedAccountGroupMembership.findFirst).toHaveBeenCalledWith({
      select: { id: true },
      where: {
        group: {
          billingStatus: HostedBillingStatus.active,
          suspendedAt: null,
        },
        memberId: memberState.id,
        status: "active",
      },
    });
    expect(
      mocks.lockHostedUsageCreditBeneficiaryTx.mock.invocationCallOrder[0],
    ).toBeLessThan(
      prisma.hostedAccountGroupMembership.findFirst.mock.invocationCallOrder[0]
        ?? Number.POSITIVE_INFINITY,
    );
  });

  it("preserves a preexisting Starter grant after Family sponsorship begins", async () => {
    grantState = { effectiveAt: NOW };
    const prisma = buildPrisma(() => memberState, undefined, true);

    await expect(ensureHostedStarterUsageEnrollment({
      inviteCode: "invite_123",
      member: { id: memberState.id, suspendedAt: null },
      now: NOW,
      prisma: prisma as never,
      source: "web_onboarding",
    })).resolves.toMatchObject({ status: "already_enrolled" });

    expect(createdGrantCount).toBe(0);
    expect(mocks.ensureHostedStarterUsageGrantTx).toHaveBeenCalledOnce();
    expect(prisma.hostedAccountGroupMembership.findFirst).not.toHaveBeenCalled();
  });

  it("fails closed for suspended and invite-mismatched members", async () => {
    const prisma = buildPrisma(() => memberState);
    await expect(ensureHostedStarterUsageEnrollment({
      inviteCode: "invite_123",
      member: { id: memberState.id, suspendedAt: NOW },
      now: NOW,
      prisma: prisma as never,
      source: "web_onboarding",
    })).rejects.toMatchObject({ code: "HOSTED_MEMBER_SUSPENDED" });

    mocks.requireHostedInviteForBillingCheckout.mockResolvedValueOnce(
      buildInvite(buildMemberState({ id: "member_other" })),
    );
    await expect(ensureHostedStarterUsageEnrollment({
      inviteCode: "invite_123",
      member: { id: memberState.id, suspendedAt: null },
      now: NOW,
      prisma: prisma as never,
      source: "web_onboarding",
    })).rejects.toMatchObject({ code: "AUTH_INVITE_MISMATCH" });
    expect(mocks.ensureHostedStarterUsageGrantTx).not.toHaveBeenCalled();
  });

  it("clears the exact instant-start token in the grant transaction and defers one wake", async () => {
    const admission = {
      eventId: "event_admission_1",
      inviteCode: "invite_123",
      inviteId: "invite_id_123",
      memberId: memberState.id,
    };
    const prisma = buildPrisma(() => memberState, admission);

    await expect(ensureHostedLinqInstantStartStarterUsageEnrollment({
      admissionEventId: admission.eventId,
      inviteCode: admission.inviteCode,
      memberId: admission.memberId,
      now: NOW,
      prisma: prisma as never,
    })).resolves.toEqual({
      deferredActivationWake: {
        hostedExecutionEventId: "execution_activation_1",
        memberId: memberState.id,
      },
      redirectPath: "/home",
      status: "enrolled",
    });

    expect(prisma.hostedInvite.updateMany).toHaveBeenCalledWith({
      data: { instantStartAdmissionEventId: null },
      where: {
        id: admission.inviteId,
        instantStartAdmissionEventId: admission.eventId,
      },
    });
    expect(mocks.assertHostedLaunchRequiredConsentGranted).not.toHaveBeenCalled();
    expect(mocks.assertHostedMemberBillingStartMessagingReady).not.toHaveBeenCalled();
    expect(mocks.sendHostedSignupWelcomeEmailForMemberBestEffort)
      .not.toHaveBeenCalled();
    expect(mocks.signalHostedMemberActivationRuntimeWakeBestEffortResult)
      .not.toHaveBeenCalled();

    await expect(ensureHostedLinqInstantStartStarterUsageEnrollment({
      admissionEventId: admission.eventId,
      inviteCode: admission.inviteCode,
      memberId: admission.memberId,
      now: NOW,
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_INSTANT_START_ADMISSION_REVOKED",
    });
    expect(createdGrantCount).toBe(1);
  });
});

function buildMemberState(overrides: Partial<MemberState> = {}): MemberState {
  return {
    billingRef: null,
    billingStatus: HostedBillingStatus.not_started,
    id: "member_123",
    suspendedAt: null,
    ...overrides,
  };
}

function buildInvite(member: MemberState) {
  return {
    expiresAt: new Date("2026-08-10T14:00:00.000Z"),
    id: "invite_id_123",
    inviteCode: "invite_123",
    member: {
      ...member,
      identity: { phoneLookupKey: "phone_lookup_123" },
      routing: null,
    },
    memberId: member.id,
  };
}

function buildPrisma(
  readMember: () => MemberState,
  admissionInput?: {
    eventId: string;
    inviteCode: string;
    inviteId: string;
    memberId: string;
  },
  familySponsored = false,
  beforeTransactionBegin?: () => void,
) {
  let admission = admissionInput ?? null;
  const tx = {
    hostedInvite: {
      findUnique: vi.fn(async (input: {
        where: {
          expiresAt: { gt: Date };
          instantStartAdmissionEventId: string;
          inviteCode: string;
          memberId: string;
          sentAt: null;
        };
      }) => admission
        && input.where.instantStartAdmissionEventId === admission.eventId
        && input.where.inviteCode === admission.inviteCode
        && input.where.memberId === admission.memberId
          ? { id: admission.inviteId }
          : null),
      updateMany: vi.fn(async (input: {
        where: { id: string; instantStartAdmissionEventId: string };
      }) => {
        if (
          admission
          && input.where.id === admission.inviteId
          && input.where.instantStartAdmissionEventId === admission.eventId
        ) {
          admission = null;
          return { count: 1 };
        }
        return { count: 0 };
      }),
    },
    hostedMember: {
      findUnique: vi.fn(async () => readMember()),
    },
    hostedAccountGroupMembership: {
      findFirst: vi.fn(async () => familySponsored ? { id: "family_123" } : null),
    },
  };
  return {
    ...tx,
    $transaction: vi.fn(async (callback: (prismaTx: typeof tx) => unknown) => {
      beforeTransactionBegin?.();
      if (providerCallsInFlight !== 0) {
        throw new Error("The transaction began while provider work was still active.");
      }
      if (transactionOpen) {
        throw new Error("Nested interactive transactions are not supported by this fixture.");
      }

      transactionOpen = true;
      try {
        return await callback(tx);
      } finally {
        transactionOpen = false;
      }
    }),
  };
}

function buildCryptoEnvelope(input: {
  domain: ActivationCryptoDomain;
  rootKeyId: string;
  userId: string;
}): CryptoEnvelope {
  return input;
}

function buildUnwrappedCryptoRoot(envelope: CryptoEnvelope) {
  return {
    envelope,
    rootKey: new Uint8Array(32),
  };
}

function cacheUnwrappedRoot(envelope: CryptoEnvelope): void {
  if (!scopedRootKeyIds) {
    throw new Error("Hosted root prewarm requires an unwrap-cache scope.");
  }
  const activeCacheKey = buildActiveRootCacheKey(
    envelope.userId,
    envelope.domain,
  );
  const cachedRootKeyId = scopedRootKeyIds.get(activeCacheKey);
  if (cachedRootKeyId && cachedRootKeyId !== envelope.rootKeyId) {
    throw new Error("Prepared root conflicts with the cached active root.");
  }
  scopedRootKeyIds.set(activeCacheKey, envelope.rootKeyId);
  scopedRootKeyIds.set(
    buildConcreteRootCacheKey(
      envelope.userId,
      envelope.domain,
      envelope.rootKeyId,
    ),
    envelope.rootKeyId,
  );
}

function buildActiveRootCacheKey(
  userId: string,
  domain: ActivationCryptoDomain,
): string {
  return `${userId}|${domain}|@active`;
}

function buildConcreteRootCacheKey(
  userId: string,
  domain: ActivationCryptoDomain,
  rootKeyId: string,
): string {
  return `${userId}|${domain}|${rootKeyId}`;
}

async function runProviderWork(
  input: Omit<ProviderWork, "transactionOpen">,
): Promise<void> {
  providerCallsInFlight += 1;
  try {
    await mocks.providerWork({
      ...input,
      transactionOpen,
    });
  } finally {
    providerCallsInFlight -= 1;
  }
}

function expectAllProviderWorkOutsideTransaction(): void {
  expect(mocks.providerWork).toHaveBeenCalled();
  const calls = mocks.providerWork.mock.calls as Array<[ProviderWork]>;
  for (const [call] of calls) {
    expect(call.transactionOpen).toBe(false);
  }
}

function readProviderWorkByKind(kind: ProviderWork["kind"]): ProviderWork[] {
  const calls = mocks.providerWork.mock.calls as Array<[ProviderWork]>;
  return calls.map(([call]) => call).filter((call) => call.kind === kind);
}

function readPreparedCryptoDomains(): ActivationCryptoDomain[] {
  const calls = mocks.prewarmPreparedHostedCryptoDomainRootForWeb.mock.calls as
    Array<[{ domain: ActivationCryptoDomain }]>;
  return calls.map(([call]) => call.domain);
}

function readLockedCryptoDomains(): ActivationCryptoDomain[] {
  const calls = mocks.lockAndReadActiveHostedDomainRootKeyIdTx.mock.calls as
    Array<[{ domain: ActivationCryptoDomain }]>;
  return calls.map(([call]) => call.domain);
}

function createDeferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
