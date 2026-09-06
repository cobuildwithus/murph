import { HostedBillingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => {
  class HostedDomainRootPreparationMismatchError extends Error {
    readonly code = "HOSTED_DOMAIN_ROOT_PREPARATION_MISMATCH";

    constructor() {
      super("Hosted domain root preparation is stale.");
      this.name = "HostedDomainRootPreparationMismatchError";
    }
  }

  class PrivyApiError extends Error {
    readonly error: unknown;
    readonly headers: Headers;
    readonly status: number;

    constructor(status: number, code: string) {
      super(`Privy API error ${status}`);
      this.name = "APIError";
      this.error = { code };
      this.headers = new Headers({ "x-request-id": "synthetic-request" });
      this.status = status;
    }
  }

  return {
    HostedDomainRootPreparationMismatchError,
    PrivyApiError,
    activateHostedMemberForPositiveSourceTx: vi.fn(),
    assertHostedPrivyAccountDeletionNotPending: vi.fn(),
    cacheScope: null as string | null,
    ensureHostedMemberForPrivyIdentityResolutionTx: vi.fn(),
    freshCacheSequence: 0,
    generateHostedMemberId: vi.fn(),
    getPrisma: vi.fn(),
    identityPreloadCacheScopes: [] as Array<string | null>,
    lookupCacheScopes: [] as Array<string | null>,
    lookupHostedMemberForPrivyAuthAttempt: vi.fn(),
    lookupHostedMemberIdentityByPrivyUserId: vi.fn(),
    materializePendingHostedGroupJoinConfirmationsBestEffort: vi.fn(),
    prepareHostedCryptoDomainRootCandidates: vi.fn(),
    prepareHostedDomainRootForWeb: vi.fn(),
    privyClientConstructor: vi.fn(),
    privyCreate: vi.fn(),
    privyGetByEmailAddress: vi.fn(),
    privyGetById: vi.fn(),
    privyGetByPhoneNumber: vi.fn(),
    privySetCustomMetadata: vi.fn(),
    providerCallsDisabled: false,
    providerCallsDuringTransaction: [] as string[],
    readHostedConsentStatus: vi.fn(),
    readHostedMemberIdentity: vi.fn(),
    recordHostedLaunchRequiredConsent: vi.fn(),
    resolutionCacheScopes: [] as Array<string | null>,
    resolutionProviderDisabledStates: [] as boolean[],
    rootPreparationCacheScopes: [] as Array<string | null>,
    runWithFreshHostedDomainRootUnwrapCache: vi.fn(),
    runWithHostedDomainRootProviderCallsDisabled: vi.fn(),
    runWithHostedDomainRootUnwrapCache: vi.fn(),
    transactionOpen: false,
    transactionOptions: {
      isolationLevel: "Serializable",
      maxWait: 5_000,
      timeout: 10_000,
    },
  };
});

vi.mock("server-only", () => ({}));

vi.mock("@privy-io/node", () => ({
  APIError: dependencies.PrivyApiError,
  NotFoundError: class NotFoundError extends Error {},
  PrivyClient: class PrivyClient {
    constructor(input: unknown) {
      dependencies.privyClientConstructor(input);
    }

    users() {
      return {
        _get: dependencies.privyGetById,
        create: dependencies.privyCreate,
        getByEmailAddress: dependencies.privyGetByEmailAddress,
        getByPhoneNumber: dependencies.privyGetByPhoneNumber,
        setCustomMetadata: dependencies.privySetCustomMetadata,
      };
    }
  },
  verifyIdentityToken: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/env", () => ({
  readHostedContactPrivacyKeyring: () => ({
    currentVersion: "v1",
    keysByVersion: { v1: Buffer.alloc(32, 7) },
    readVersions: ["v1"],
  }),
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
  readHostedMemberIdentity: dependencies.readHostedMemberIdentity,
}));

vi.mock("@/src/lib/hosted-onboarding/member-identity-service", () => ({
  assertHostedPrivyAccountDeletionNotPending:
    dependencies.assertHostedPrivyAccountDeletionNotPending,
  ensureHostedMemberForPrivyIdentityResolutionTx:
    dependencies.ensureHostedMemberForPrivyIdentityResolutionTx,
  lookupHostedMemberForPrivyAuthAttempt:
    dependencies.lookupHostedMemberForPrivyAuthAttempt,
}));

vi.mock("@/src/lib/hosted-onboarding/member-activation", () => ({
  activateHostedMemberForPositiveSourceTx:
    dependencies.activateHostedMemberForPositiveSourceTx,
}));

vi.mock("@/src/lib/hosted-crypto/domain-root-store", () => ({
  HostedDomainRootPreparationMismatchError:
    dependencies.HostedDomainRootPreparationMismatchError,
  prepareHostedCryptoDomainRootCandidates:
    dependencies.prepareHostedCryptoDomainRootCandidates,
  prepareHostedDomainRootForWeb: dependencies.prepareHostedDomainRootForWeb,
}));

vi.mock("@/src/lib/hosted-crypto/domain-root-unwrap-cache", () => ({
  runWithFreshHostedDomainRootUnwrapCache:
    dependencies.runWithFreshHostedDomainRootUnwrapCache,
  runWithHostedDomainRootProviderCallsDisabled:
    dependencies.runWithHostedDomainRootProviderCallsDisabled,
  runWithHostedDomainRootUnwrapCache:
    dependencies.runWithHostedDomainRootUnwrapCache,
}));

vi.mock("@/src/lib/hosted-onboarding/shared", () => ({
  generateHostedMemberId: dependencies.generateHostedMemberId,
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS: dependencies.transactionOptions,
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
const NEW_MEMBER_ID = "member_app_review";
const EXISTING_MEMBER_ID = "member_existing_review";
const WINNER_MEMBER_ID = "member_concurrent_winner";
const PRIVY_USER_ID = "did:privy:app_review";
const REVIEW_EMAIL = "reviewer@example.test";

interface PreparedControlRoot {
  domain: "control";
  rootKeyId: string;
  userId: string;
}

interface ExistingMemberLookup {
  core: {
    billingStatus: HostedBillingStatus;
    createdAt: Date;
    id: string;
    suspendedAt: Date | null;
    updatedAt: Date;
  };
  identity: {
    memberId: string;
    privyUserId: string;
  };
  matchedBy: Array<"privyUserId" | "verifiedEmail">;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

interface TransactionClient {
  index: number;
  transaction: "app-review";
}

interface PrismaHarness {
  $transaction: ReturnType<typeof vi.fn>;
  hostedConsentGrant: {
    findMany: ReturnType<typeof vi.fn>;
  };
  hostedMember: {
    findUniqueOrThrow: ReturnType<typeof vi.fn>;
  };
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function buildPrivyUser() {
  return {
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
  };
}

function buildExistingMemberLookup(
  memberId: string,
  matchedBy: "privyUserId" | "verifiedEmail" = "privyUserId",
): ExistingMemberLookup {
  return {
    core: {
      billingStatus: HostedBillingStatus.active,
      createdAt: NOW,
      id: memberId,
      suspendedAt: null,
      updatedAt: NOW,
    },
    identity: {
      memberId,
      privyUserId: PRIVY_USER_ID,
    },
    matchedBy: [matchedBy],
  };
}

function buildPreparedControlRoot(memberId: string): PreparedControlRoot {
  return {
    domain: "control",
    rootKeyId: `root_${memberId}`,
    userId: memberId,
  };
}

function recordProviderCall(name: string): void {
  if (dependencies.transactionOpen) {
    dependencies.providerCallsDuringTransaction.push(name);
  }
}

function recordMemberLookup(): void {
  recordProviderCall("member-identity-lookup");
  dependencies.lookupCacheScopes.push(dependencies.cacheScope);
}

function recordRootPreparation(): void {
  recordProviderCall("control-root-preparation");
  dependencies.rootPreparationCacheScopes.push(dependencies.cacheScope);
}

function recordIdentityPreload(): void {
  recordProviderCall("member-identity-preload");
  dependencies.identityPreloadCacheScopes.push(dependencies.cacheScope);
}

function recordResolutionProviderState(): void {
  dependencies.resolutionCacheScopes.push(dependencies.cacheScope);
  dependencies.resolutionProviderDisabledStates.push(
    dependencies.providerCallsDisabled,
  );
}

function mockPreparedMemberLookupSequence(
  ...results: Array<ExistingMemberLookup | null>
): void {
  let index = 0;
  dependencies.lookupHostedMemberForPrivyAuthAttempt.mockImplementation(async () => {
    recordMemberLookup();
    const result = results[Math.min(index, results.length - 1)] ?? null;
    index += 1;
    return result;
  });
}

function createPrismaHarness(): PrismaHarness {
  let transactionIndex = 0;
  const harness: PrismaHarness = {
    $transaction: vi.fn(async (
      callback: (tx: TransactionClient) => Promise<unknown>,
    ) => {
      transactionIndex += 1;
      dependencies.transactionOpen = true;
      try {
        return await callback({
          index: transactionIndex,
          transaction: "app-review",
        });
      } finally {
        dependencies.transactionOpen = false;
      }
    }),
    hostedConsentGrant: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    hostedMember: {
      findUniqueOrThrow: vi.fn(async (input: { where: { id: string } }) => ({
        billingStatus: HostedBillingStatus.active,
        id: input.where.id,
        suspendedAt: null,
      })),
    },
  };
  return harness;
}

async function applyReviewerMember() {
  return prepareHostedOpsAppReviewMember({
    mode: "apply",
    now: NOW,
    principal: {
      kind: "email",
      value: REVIEW_EMAIL,
    },
  });
}

describe("prepareHostedOpsAppReviewMember", () => {
  let prisma: PrismaHarness;

  beforeEach(() => {
    vi.clearAllMocks();
    Reflect.deleteProperty(globalThis, "__murphHostedPrivyManagementClient");

    dependencies.cacheScope = null;
    dependencies.freshCacheSequence = 0;
    dependencies.identityPreloadCacheScopes.length = 0;
    dependencies.lookupCacheScopes.length = 0;
    dependencies.providerCallsDisabled = false;
    dependencies.providerCallsDuringTransaction.length = 0;
    dependencies.resolutionCacheScopes.length = 0;
    dependencies.resolutionProviderDisabledStates.length = 0;
    dependencies.rootPreparationCacheScopes.length = 0;
    dependencies.transactionOpen = false;

    dependencies.runWithHostedDomainRootUnwrapCache.mockImplementation(
      async (run: () => Promise<unknown>) => {
        if (dependencies.cacheScope) {
          return run();
        }
        dependencies.cacheScope = "attempt-default";
        try {
          return await run();
        } finally {
          dependencies.cacheScope = null;
        }
      },
    );
    dependencies.runWithFreshHostedDomainRootUnwrapCache.mockImplementation(
      async (run: () => Promise<unknown>) => {
        const parentScope = dependencies.cacheScope;
        dependencies.freshCacheSequence += 1;
        dependencies.cacheScope = `attempt-fresh-${dependencies.freshCacheSequence}`;
        try {
          return await run();
        } finally {
          dependencies.cacheScope = parentScope;
        }
      },
    );
    dependencies.runWithHostedDomainRootProviderCallsDisabled.mockImplementation(
      async (run: () => Promise<unknown>) => {
        const previouslyDisabled = dependencies.providerCallsDisabled;
        dependencies.providerCallsDisabled = true;
        try {
          return await run();
        } finally {
          dependencies.providerCallsDisabled = previouslyDisabled;
        }
      },
    );

    dependencies.privyGetByEmailAddress.mockImplementation(async () => {
      recordProviderCall("privy-email-read");
      return buildPrivyUser();
    });
    dependencies.privyGetByPhoneNumber.mockImplementation(async () => {
      recordProviderCall("privy-phone-read");
      return buildPrivyUser();
    });
    dependencies.privyGetById.mockImplementation(async () => {
      recordProviderCall("privy-user-read");
      return buildPrivyUser();
    });
    dependencies.privyCreate.mockImplementation(async () => {
      recordProviderCall("privy-user-create");
      return buildPrivyUser();
    });

    dependencies.lookupHostedMemberIdentityByPrivyUserId.mockResolvedValue(null);
    dependencies.readHostedMemberIdentity.mockImplementation(async () => {
      recordIdentityPreload();
      return null;
    });
    mockPreparedMemberLookupSequence(null);
    dependencies.generateHostedMemberId.mockReturnValue(NEW_MEMBER_ID);
    dependencies.prepareHostedDomainRootForWeb.mockImplementation(
      async (input: { userId: string }) => {
        recordRootPreparation();
        return buildPreparedControlRoot(input.userId);
      },
    );
    dependencies.ensureHostedMemberForPrivyIdentityResolutionTx.mockImplementation(
      async (input: {
        identity: unknown;
        preparedLiveIdentity: unknown;
        preparedNewMemberId: string;
      }) => {
        recordResolutionProviderState();
        return {
          created: true,
          identity: input.preparedLiveIdentity,
          member: { id: input.preparedNewMemberId },
        };
      },
    );
    dependencies.activateHostedMemberForPositiveSourceTx.mockResolvedValue({
      activated: true,
    });
    dependencies.assertHostedPrivyAccountDeletionNotPending.mockResolvedValue(
      undefined,
    );
    dependencies.materializePendingHostedGroupJoinConfirmationsBestEffort.mockResolvedValue(
      undefined,
    );
    dependencies.prepareHostedCryptoDomainRootCandidates.mockImplementation(async () => {
      recordProviderCall("activation-root-candidates");
      return new Map();
    });
    dependencies.recordHostedLaunchRequiredConsent.mockResolvedValue(undefined);
    dependencies.readHostedConsentStatus.mockResolvedValue({
      launchScopes: [
        { granted: true, scope: "launch.legal" },
        { granted: true, scope: "launch.health-data" },
      ],
    });

    prisma = createPrismaHarness();
    dependencies.getPrisma.mockReturnValue(prisma);
  });

  it("prepares a new member completely before the database-only resolution transaction", async () => {
    const preparedControlRoot = buildPreparedControlRoot(NEW_MEMBER_ID);
    const preparedCryptoDomainRoots = new Map([
      ["control", { domain: "control" }],
    ]);
    dependencies.prepareHostedDomainRootForWeb.mockImplementationOnce(async () => {
      recordRootPreparation();
      return preparedControlRoot;
    });
    dependencies.prepareHostedCryptoDomainRootCandidates.mockImplementationOnce(async () => {
      recordProviderCall("activation-root-candidates");
      return preparedCryptoDomainRoots;
    });

    const summary = await applyReviewerMember();

    expect(dependencies.privyClientConstructor).toHaveBeenCalledTimes(2);
    expect(dependencies.privyGetByEmailAddress).toHaveBeenCalledOnce();
    expect(dependencies.privyGetByEmailAddress).toHaveBeenCalledWith({
      address: REVIEW_EMAIL,
    });
    expect(dependencies.privyGetById).toHaveBeenCalledOnce();
    expect(dependencies.privyGetById).toHaveBeenCalledWith(PRIVY_USER_ID, {
      maxRetries: 0,
      timeout: 5_000,
    });
    expect(dependencies.privyGetByPhoneNumber).not.toHaveBeenCalled();
    expect(dependencies.privyCreate).not.toHaveBeenCalled();
    expect(dependencies.privySetCustomMetadata).not.toHaveBeenCalled();
    expect(dependencies.lookupHostedMemberForPrivyAuthAttempt).toHaveBeenCalledOnce();
    expect(dependencies.assertHostedPrivyAccountDeletionNotPending).toHaveBeenCalledWith({
      prisma,
      privyUserId: PRIVY_USER_ID,
    });
    expect(dependencies.generateHostedMemberId).toHaveBeenCalledOnce();
    expect(dependencies.prepareHostedDomainRootForWeb).toHaveBeenCalledWith({
      domain: "control",
      prisma,
      reason: "hosted-ops.app-review-member",
      userId: NEW_MEMBER_ID,
    });

    const resolutionInput = dependencies.ensureHostedMemberForPrivyIdentityResolutionTx
      .mock.calls[0]?.[0];
    expect(resolutionInput).toEqual(expect.objectContaining({
      authMethod: "email",
      identity: expect.objectContaining({
        userId: PRIVY_USER_ID,
      }),
      now: NOW,
      preparedControlRoot,
      preparedExistingMemberId: null,
      preparedNewMemberId: NEW_MEMBER_ID,
    }));
    expect(resolutionInput).toEqual(expect.not.objectContaining({
      allowVerifiedEmailRebinding: true,
    }));
    expect(resolutionInput?.preparedLiveIdentity).toEqual(expect.objectContaining({
      userId: PRIVY_USER_ID,
    }));
    expect(resolutionInput?.preparedLiveIdentity).toBe(resolutionInput?.identity);
    expect(resolutionInput?.prisma).toEqual({
      index: 1,
      transaction: "app-review",
    });
    expect(prisma.$transaction.mock.calls[0]?.[1]).toBe(
      dependencies.transactionOptions,
    );
    expect(dependencies.lookupCacheScopes).toEqual(["attempt-default"]);
    expect(dependencies.rootPreparationCacheScopes).toEqual(["attempt-default"]);
    expect(dependencies.identityPreloadCacheScopes).toEqual([]);
    expect(dependencies.resolutionCacheScopes).toEqual(["attempt-default"]);
    expect(dependencies.resolutionProviderDisabledStates).toEqual([true]);
    expect(dependencies.providerCallsDuringTransaction).toEqual([]);
    expect(
      dependencies.prepareHostedDomainRootForWeb.mock.invocationCallOrder[0],
    ).toBeLessThan(dependencies.privyGetById.mock.invocationCallOrder[0] ?? 0);
    expect(dependencies.privyGetById.mock.invocationCallOrder[0])
      .toBeLessThan(prisma.$transaction.mock.invocationCallOrder[0] ?? 0);

    expect(dependencies.prepareHostedCryptoDomainRootCandidates).toHaveBeenCalledWith({
      prisma,
      userId: NEW_MEMBER_ID,
    });
    expect(
      dependencies.prepareHostedCryptoDomainRootCandidates.mock.invocationCallOrder[0],
    ).toBeLessThan(prisma.$transaction.mock.invocationCallOrder[1] ?? 0);
    expect(dependencies.activateHostedMemberForPositiveSourceTx).toHaveBeenCalledWith(
      expect.objectContaining({
        memberId: NEW_MEMBER_ID,
        preparedCryptoDomainRoots,
      }),
    );
    expect(
      dependencies.materializePendingHostedGroupJoinConfirmationsBestEffort,
    ).toHaveBeenCalledWith(expect.objectContaining({
      memberId: NEW_MEMBER_ID,
    }));
    expect(dependencies.recordHostedLaunchRequiredConsent).toHaveBeenCalledTimes(2);
    expect(summary).toEqual({
      action: "applied",
      activated: true,
      billingStatus: HostedBillingStatus.active,
      consentGranted: true,
      consentScopes: ["launch.legal", "launch.health-data"],
      member: "memb...view",
      principal: "email:r***@example.test",
      privyUser: "did:...view",
      suspended: false,
    });
  });

  it("stops new-member preparation while the existing deletion owner is pending", async () => {
    const deletionPending = Object.assign(
      new Error("Account deletion is still finishing."),
      { code: "PRIVY_ACCOUNT_DELETION_IN_PROGRESS" },
    );
    dependencies.assertHostedPrivyAccountDeletionNotPending.mockRejectedValueOnce(
      deletionPending,
    );

    await expect(applyReviewerMember()).rejects.toBe(deletionPending);

    expect(dependencies.lookupHostedMemberForPrivyAuthAttempt).toHaveBeenCalledOnce();
    expect(dependencies.assertHostedPrivyAccountDeletionNotPending).toHaveBeenCalledWith({
      prisma,
      privyUserId: PRIVY_USER_ID,
    });
    expect(dependencies.generateHostedMemberId).not.toHaveBeenCalled();
    expect(dependencies.prepareHostedDomainRootForWeb).not.toHaveBeenCalled();
    expect(dependencies.readHostedMemberIdentity).not.toHaveBeenCalled();
    expect(dependencies.privyGetById).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("uses the existing member id and its matching prepared control root", async () => {
    mockPreparedMemberLookupSequence(
      buildExistingMemberLookup(EXISTING_MEMBER_ID, "verifiedEmail"),
    );
    const preparedControlRoot = buildPreparedControlRoot(EXISTING_MEMBER_ID);
    dependencies.prepareHostedDomainRootForWeb.mockImplementationOnce(async () => {
      recordRootPreparation();
      return preparedControlRoot;
    });

    const summary = await applyReviewerMember();

    expect(dependencies.generateHostedMemberId).not.toHaveBeenCalled();
    expect(dependencies.lookupHostedMemberForPrivyAuthAttempt).toHaveBeenCalledWith({
      authMethod: "email",
      identity: expect.objectContaining({ userId: PRIVY_USER_ID }),
      prisma,
    });
    expect(dependencies.prepareHostedDomainRootForWeb).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: EXISTING_MEMBER_ID,
      }),
    );
    expect(dependencies.ensureHostedMemberForPrivyIdentityResolutionTx)
      .toHaveBeenCalledWith(expect.objectContaining({
        preparedControlRoot,
        preparedExistingMemberId: EXISTING_MEMBER_ID,
        preparedNewMemberId: EXISTING_MEMBER_ID,
      }));
    expect(dependencies.assertHostedPrivyAccountDeletionNotPending).not.toHaveBeenCalled();
    expect(dependencies.readHostedMemberIdentity).toHaveBeenCalledWith({
      memberId: EXISTING_MEMBER_ID,
      prisma,
    });
    expect(dependencies.identityPreloadCacheScopes).toEqual(["attempt-default"]);
    expect(dependencies.privyGetByEmailAddress).toHaveBeenCalledOnce();
    expect(dependencies.privyGetById).toHaveBeenCalledOnce();
    expect(dependencies.readHostedMemberIdentity).toHaveBeenCalledOnce();
    expect(dependencies.readHostedMemberIdentity.mock.invocationCallOrder[0])
      .toBeLessThan(dependencies.privyGetById.mock.invocationCallOrder[0] ?? 0);
    expect(dependencies.providerCallsDuringTransaction).toEqual([]);
    expect(dependencies.resolutionProviderDisabledStates).toEqual([true]);
    expect(summary.member).toBe("memb...view");
  });

  it.each([
    ["new", null, NEW_MEMBER_ID],
    ["existing", buildExistingMemberLookup(EXISTING_MEMBER_ID), EXISTING_MEMBER_ID],
  ] as const)(
    "waits for delayed Privy and control-root preparation before opening the %s-member transaction",
    async (_kind, existing, memberId) => {
      const privyDeferred = createDeferred<ReturnType<typeof buildPrivyUser>>();
      const rootDeferred = createDeferred<PreparedControlRoot>();
      const rootStarted = createDeferred<void>();
      dependencies.privyGetByEmailAddress.mockImplementationOnce(async () => {
        recordProviderCall("privy-email-read");
        return privyDeferred.promise;
      });
      mockPreparedMemberLookupSequence(existing);
      dependencies.prepareHostedDomainRootForWeb.mockImplementationOnce(async () => {
        recordRootPreparation();
        rootStarted.resolve();
        return rootDeferred.promise;
      });

      const pending = applyReviewerMember();

      expect(prisma.$transaction).not.toHaveBeenCalled();
      privyDeferred.resolve(buildPrivyUser());
      await rootStarted.promise;
      expect(prisma.$transaction).not.toHaveBeenCalled();
      rootDeferred.resolve(buildPreparedControlRoot(memberId));

      await pending;

      expect(dependencies.ensureHostedMemberForPrivyIdentityResolutionTx)
        .toHaveBeenCalledWith(expect.objectContaining({
          preparedNewMemberId: memberId,
        }));
      expect(dependencies.providerCallsDuringTransaction).toEqual([]);
      expect(dependencies.resolutionProviderDisabledStates).toEqual([true]);
    },
  );

  it("reprepares once when a concurrent existing member wins after the outside new-member snapshot", async () => {
    mockPreparedMemberLookupSequence(
      null,
      buildExistingMemberLookup(WINNER_MEMBER_ID),
    );
    dependencies.ensureHostedMemberForPrivyIdentityResolutionTx
      .mockImplementationOnce(async () => {
        recordResolutionProviderState();
        throw new dependencies.HostedDomainRootPreparationMismatchError();
      })
      .mockImplementationOnce(async (input: {
        preparedLiveIdentity: unknown;
        preparedNewMemberId: string;
      }) => {
        recordResolutionProviderState();
        return {
          created: false,
          identity: input.preparedLiveIdentity,
          member: { id: input.preparedNewMemberId },
        };
      });

    await applyReviewerMember();

    expect(dependencies.lookupHostedMemberForPrivyAuthAttempt).toHaveBeenCalledTimes(2);
    expect(dependencies.generateHostedMemberId).toHaveBeenCalledOnce();
    expect(dependencies.prepareHostedDomainRootForWeb.mock.calls.map(
      ([input]) => input.userId,
    )).toEqual([NEW_MEMBER_ID, WINNER_MEMBER_ID]);
    expect(dependencies.ensureHostedMemberForPrivyIdentityResolutionTx.mock.calls.map(
      ([input]) => input.preparedNewMemberId,
    )).toEqual([NEW_MEMBER_ID, WINNER_MEMBER_ID]);
    expect(dependencies.ensureHostedMemberForPrivyIdentityResolutionTx.mock.calls.map(
      ([input]) => input.preparedControlRoot.userId,
    )).toEqual([NEW_MEMBER_ID, WINNER_MEMBER_ID]);
    expect(dependencies.lookupCacheScopes).toEqual([
      "attempt-default",
      "attempt-fresh-1",
    ]);
    expect(dependencies.rootPreparationCacheScopes).toEqual([
      "attempt-default",
      "attempt-fresh-1",
    ]);
    expect(dependencies.runWithFreshHostedDomainRootUnwrapCache).toHaveBeenCalledOnce();
    expect(dependencies.resolutionCacheScopes).toEqual([
      "attempt-default",
      "attempt-fresh-1",
    ]);
    expect(dependencies.resolutionProviderDisabledStates).toEqual([true, true]);
    expect(dependencies.privyGetByEmailAddress).toHaveBeenCalledOnce();
    const firstResolution = dependencies.ensureHostedMemberForPrivyIdentityResolutionTx
      .mock.calls[0]?.[0];
    const secondResolution = dependencies.ensureHostedMemberForPrivyIdentityResolutionTx
      .mock.calls[1]?.[0];
    expect(firstResolution?.identity).toBe(firstResolution?.preparedLiveIdentity);
    expect(secondResolution?.identity).toBe(secondResolution?.preparedLiveIdentity);
    expect(secondResolution?.identity).not.toBe(firstResolution?.identity);
    expect(firstResolution?.preparedLiveIdentity).toEqual(expect.objectContaining({
      userId: PRIVY_USER_ID,
    }));
    expect(secondResolution?.preparedLiveIdentity).toEqual(expect.objectContaining({
      userId: PRIVY_USER_ID,
    }));
    expect(dependencies.providerCallsDuringTransaction).toEqual([]);
  });

  it("uses a fresh cache and one whole reprepare after exact control-root mismatch", async () => {
    mockPreparedMemberLookupSequence(buildExistingMemberLookup(EXISTING_MEMBER_ID));
    dependencies.ensureHostedMemberForPrivyIdentityResolutionTx
      .mockImplementationOnce(async () => {
        recordResolutionProviderState();
        throw new dependencies.HostedDomainRootPreparationMismatchError();
      })
      .mockImplementationOnce(async (input: {
        preparedLiveIdentity: unknown;
        preparedNewMemberId: string;
      }) => {
        recordResolutionProviderState();
        return {
          created: false,
          identity: input.preparedLiveIdentity,
          member: { id: input.preparedNewMemberId },
        };
      });

    await applyReviewerMember();

    expect(dependencies.lookupHostedMemberForPrivyAuthAttempt).toHaveBeenCalledTimes(2);
    expect(dependencies.prepareHostedDomainRootForWeb).toHaveBeenCalledTimes(2);
    expect(dependencies.prepareHostedDomainRootForWeb.mock.calls.map(
      ([input]) => input.userId,
    )).toEqual([EXISTING_MEMBER_ID, EXISTING_MEMBER_ID]);
    expect(dependencies.runWithFreshHostedDomainRootUnwrapCache).toHaveBeenCalledOnce();
    expect(dependencies.privyGetByEmailAddress).toHaveBeenCalledOnce();
    expect(dependencies.privyGetById).toHaveBeenCalledTimes(2);
    expect(dependencies.readHostedMemberIdentity).toHaveBeenCalledTimes(2);
    expect(dependencies.resolutionProviderDisabledStates).toEqual([true, true]);
    expect(dependencies.providerCallsDuringTransaction).toEqual([]);
  });

  it("fails closed after two exact preparation mismatches without a third transaction", async () => {
    mockPreparedMemberLookupSequence(buildExistingMemberLookup(EXISTING_MEMBER_ID));
    const mismatch = new dependencies.HostedDomainRootPreparationMismatchError();
    dependencies.ensureHostedMemberForPrivyIdentityResolutionTx.mockImplementation(
      async () => {
        recordResolutionProviderState();
        throw mismatch;
      },
    );

    await expect(applyReviewerMember()).rejects.toBe(mismatch);

    expect(dependencies.lookupHostedMemberForPrivyAuthAttempt).toHaveBeenCalledTimes(2);
    expect(dependencies.prepareHostedDomainRootForWeb).toHaveBeenCalledTimes(2);
    expect(dependencies.ensureHostedMemberForPrivyIdentityResolutionTx).toHaveBeenCalledTimes(2);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(dependencies.runWithFreshHostedDomainRootUnwrapCache).toHaveBeenCalledOnce();
    expect(dependencies.privyGetByEmailAddress).toHaveBeenCalledOnce();
    expect(dependencies.privyGetById).toHaveBeenCalledTimes(2);
    expect(dependencies.readHostedMemberIdentity).toHaveBeenCalledTimes(2);
    expect(dependencies.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
    expect(
      dependencies.materializePendingHostedGroupJoinConfirmationsBestEffort,
    ).not.toHaveBeenCalled();
    expect(dependencies.recordHostedLaunchRequiredConsent).not.toHaveBeenCalled();
    expect(dependencies.providerCallsDuringTransaction).toEqual([]);
  });

  it("keeps dry-run read-only and preserves existing consent summary behavior", async () => {
    dependencies.lookupHostedMemberIdentityByPrivyUserId.mockResolvedValueOnce(
      buildExistingMemberLookup(EXISTING_MEMBER_ID),
    );
    prisma.hostedConsentGrant.findMany.mockResolvedValue([
      { scope: "launch.legal" },
      { scope: "launch.health-data" },
    ]);

    const summary = await prepareHostedOpsAppReviewMember({
      mode: "dry-run",
      principal: {
        kind: "email",
        value: REVIEW_EMAIL,
      },
    });

    expect(dependencies.privyGetByEmailAddress).toHaveBeenCalledOnce();
    expect(dependencies.lookupHostedMemberIdentityByPrivyUserId).toHaveBeenCalledOnce();
    expect(dependencies.lookupHostedMemberForPrivyAuthAttempt).not.toHaveBeenCalled();
    expect(dependencies.generateHostedMemberId).not.toHaveBeenCalled();
    expect(dependencies.prepareHostedDomainRootForWeb).not.toHaveBeenCalled();
    expect(dependencies.ensureHostedMemberForPrivyIdentityResolutionTx).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(dependencies.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
    expect(dependencies.recordHostedLaunchRequiredConsent).not.toHaveBeenCalled();
    expect(summary).toEqual({
      action: "dry-run",
      activated: undefined,
      billingStatus: HostedBillingStatus.active,
      consentGranted: true,
      consentScopes: ["launch.legal", "launch.health-data"],
      member: "memb...view",
      principal: "email:r***@example.test",
      privyUser: "did:...view",
      suspended: undefined,
    });
  });

  it("does not retry identity conflicts or run post-resolution side effects", async () => {
    const conflict = {
      code: "PRIVY_USER_MISMATCH",
      httpStatus: 409,
    };
    dependencies.ensureHostedMemberForPrivyIdentityResolutionTx.mockImplementationOnce(
      async () => {
        recordResolutionProviderState();
        throw conflict;
      },
    );

    await expect(applyReviewerMember()).rejects.toBe(conflict);

    expect(dependencies.privyGetByEmailAddress).toHaveBeenCalledOnce();
    expect(dependencies.lookupHostedMemberForPrivyAuthAttempt).toHaveBeenCalledOnce();
    expect(dependencies.prepareHostedDomainRootForWeb).toHaveBeenCalledOnce();
    expect(dependencies.ensureHostedMemberForPrivyIdentityResolutionTx).toHaveBeenCalledOnce();
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(dependencies.runWithFreshHostedDomainRootUnwrapCache).not.toHaveBeenCalled();
    expect(dependencies.prepareHostedCryptoDomainRootCandidates).not.toHaveBeenCalled();
    expect(dependencies.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
    expect(
      dependencies.materializePendingHostedGroupJoinConfirmationsBestEffort,
    ).not.toHaveBeenCalled();
    expect(dependencies.recordHostedLaunchRequiredConsent).not.toHaveBeenCalled();
  });

  it("preserves successful Privy test-user creation without an extra member-wrapper read", async () => {
    dependencies.privyGetByEmailAddress.mockRejectedValueOnce(
      new dependencies.PrivyApiError(404, "user_not_found"),
    );
    dependencies.privyCreate.mockImplementationOnce(async () => {
      recordProviderCall("privy-user-create");
      return buildPrivyUser();
    });

    await prepareHostedOpsAppReviewMember({
      createPrivyUser: true,
      mode: "apply",
      now: NOW,
      principal: {
        kind: "email",
        value: REVIEW_EMAIL,
      },
    });

    expect(dependencies.privyGetByEmailAddress).toHaveBeenCalledOnce();
    expect(dependencies.privyCreate).toHaveBeenCalledOnce();
    expect(dependencies.privyGetById).toHaveBeenCalledOnce();
    expect(dependencies.ensureHostedMemberForPrivyIdentityResolutionTx).toHaveBeenCalledOnce();
    expect(dependencies.providerCallsDuringTransaction).toEqual([]);
  });

  it("preserves Privy create-conflict recovery and reuses that verified snapshot for member resolution", async () => {
    dependencies.privyGetByEmailAddress
      .mockRejectedValueOnce(new dependencies.PrivyApiError(404, "user_not_found"))
      .mockImplementationOnce(async () => {
        recordProviderCall("privy-email-read");
        return buildPrivyUser();
      });
    dependencies.privyCreate.mockRejectedValueOnce(
      new dependencies.PrivyApiError(409, "user_already_exists"),
    );

    await prepareHostedOpsAppReviewMember({
      createPrivyUser: true,
      mode: "apply",
      now: NOW,
      principal: {
        kind: "email",
        value: REVIEW_EMAIL,
      },
    });

    expect(dependencies.privyGetByEmailAddress).toHaveBeenCalledTimes(2);
    expect(dependencies.privyCreate).toHaveBeenCalledOnce();
    expect(dependencies.privyGetById).toHaveBeenCalledOnce();
    const resolutionInput = dependencies.ensureHostedMemberForPrivyIdentityResolutionTx
      .mock.calls[0]?.[0];
    expect(resolutionInput?.preparedLiveIdentity).toEqual(expect.objectContaining({
      userId: PRIVY_USER_ID,
    }));
    expect(dependencies.providerCallsDuringTransaction).toEqual([]);
  });
});
