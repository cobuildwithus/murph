import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class HostedDomainRootPreparationMismatchError extends Error {
    readonly code = "HOSTED_DOMAIN_ROOT_PREPARATION_MISMATCH";

    constructor() {
      super("Hosted domain root preparation is stale.");
      this.name = "HostedDomainRootPreparationMismatchError";
    }
  }

  return {
    HostedDomainRootPreparationMismatchError,
    activeRootKeyId: "control-root-a",
    assertTransactionContext: () => undefined,
    currentScopeId: null as number | null,
    freshScopeCount: 0,
    isProviderDisabled: false,
    lockHostedMemberRow: vi.fn(),
    nextScopeId: 0,
    openEvents: [] as Array<{ scopeId: number; value: string }>,
    prepareHostedDomainRootForWeb: vi.fn(),
    prepareRootDelay: null as (() => Promise<void>) | null,
    prepareRootEvents: [] as Array<{ rootKeyId: string; scopeId: number }>,
    preparedRootScopes: new WeakMap<object, number>(),
    prewarmDelay: null as (() => Promise<void>) | null,
    prewarmEvents: [] as Array<{ scopeId: number; values: string[] }>,
    prewarmedByScope: new Map<number, Set<string>>(),
    providerEvents: [] as Array<{
      lockActive: boolean;
      operation: string;
      transactionActive: boolean;
    }>,
    readCriticalSectionState: () => ({
      lockActive: false,
      transactionActive: false,
    }),
    readPreparedHostedDomainRootForWebLocal: vi.fn(),
    revalidatePreparedHostedDomainRootForWebTx: vi.fn(),
    runWithFreshHostedDomainRootUnwrapCache: vi.fn(),
    runWithHostedDomainRootProviderCallsDisabled: vi.fn(),
    runWithHostedDomainRootUnwrapCache: vi.fn(),
    sealHostedUserSecureBoxString: vi.fn(),
    sealHostedUserSecureBoxStringFromPreparedRoot: vi.fn(),
  };
});

vi.mock("@/src/lib/hosted-crypto/domain-root-unwrap-cache", () => ({
  runWithFreshHostedDomainRootUnwrapCache:
    mocks.runWithFreshHostedDomainRootUnwrapCache,
  runWithHostedDomainRootProviderCallsDisabled:
    mocks.runWithHostedDomainRootProviderCallsDisabled,
  runWithHostedDomainRootUnwrapCache:
    mocks.runWithHostedDomainRootUnwrapCache,
}));

vi.mock("@/src/lib/hosted-crypto/domain-root-store", () => ({
  HostedDomainRootPreparationMismatchError:
    mocks.HostedDomainRootPreparationMismatchError,
  prepareHostedDomainRootForWeb: mocks.prepareHostedDomainRootForWeb,
  readPreparedHostedDomainRootForWebLocal:
    mocks.readPreparedHostedDomainRootForWebLocal,
  revalidatePreparedHostedDomainRootForWebTx:
    mocks.revalidatePreparedHostedDomainRootForWebTx,
}));

vi.mock("@/src/lib/hosted-crypto/secure-box", () => ({
  isHostedSecureBoxStringTestCodecConfiguredForTests: () => false,
  openHostedUserSecureBoxStringFromPreparedRoot: vi.fn(async (input: {
    preparedRootKeyId: string | null;
    value: string;
  }) => {
    const scopeId = requireCurrentScopeId();
    if (!mocks.prewarmedByScope.get(scopeId)?.has(input.value)) {
      throw new Error("Secure-box ciphertext was not prewarmed in this request scope.");
    }
    const parsed = parseSyntheticCiphertext(input.value);
    if (input.preparedRootKeyId !== parsed.rootKeyId) {
      throw new Error("Secure-box prepared root does not match ciphertext.");
    }
    mocks.openEvents.push({ scopeId, value: input.value });
    return parsed.plaintext;
  }),
  prewarmHostedUserSecureBoxStrings: vi.fn(async (input: {
    entries: ReadonlyArray<{ value: string }>;
  }) => {
    recordProviderEvent("prewarm-existing-secret");
    await mocks.prewarmDelay?.();
    const scopeId = requireCurrentScopeId();
    const values = input.entries.map((entry) => entry.value);
    const prewarmed = mocks.prewarmedByScope.get(scopeId) ?? new Set<string>();
    for (const value of values) {
      parseSyntheticCiphertext(value);
      prewarmed.add(value);
    }
    mocks.prewarmedByScope.set(scopeId, prewarmed);
    mocks.prewarmEvents.push({ scopeId, values });
  }),
  readHostedUserSecureBoxStringRootReference: (input: {
    value: string | null | undefined;
  }) => {
    if (!input.value) {
      return null;
    }
    const parsed = parseSyntheticCiphertext(input.value);
    return { domain: "control", rootKeyId: parsed.rootKeyId };
  },
  sealHostedUserSecureBoxString: mocks.sealHostedUserSecureBoxString,
  sealHostedUserSecureBoxStringFromPreparedRoot:
    mocks.sealHostedUserSecureBoxStringFromPreparedRoot,
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  assertActiveHostedMemberAccessAllowed: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/member-identity-service", () => ({
  lookupHostedMemberForPrivyPrincipal: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/shared", () => ({
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS: {
    maxWait: 1_000,
    timeout: 5_000,
  },
  lockHostedMemberRow: mocks.lockHostedMemberRow,
  lockHostedMemberSponsoredAccessRows: vi.fn(),
}));

vi.mock("@/src/lib/legal/consent", () => ({
  assertHostedHistoricalLaunchConsentGranted: vi.fn(),
  readHostedHealthDataConsentState: vi.fn(),
}));

import { issueMealPhotoCaptureEnrollment } from "../src/lib/device-sync/meal-photo-capture";

type MealPhotoCapturePrismaForTest =
  Parameters<typeof issueMealPhotoCaptureEnrollment>[0]["prisma"];

interface StoredEnrollment {
  activatedAt: Date | null;
  authorityRevision: number;
  createdAt: Date;
  expiresAt: Date | null;
  id: string;
  idempotencySecretEncrypted: string | null;
  installationIdHash: string;
  memberId: string;
  revokeReason: string | null;
  revokedAt: Date | null;
  updatedAt: Date;
  uploadTokenHash: string | null;
}

const MEMBER_ID = "member_crypto_boundary";
const INSTALLATION_ID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
const INSTALLATION_HASH = sha256(INSTALLATION_ID);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.activeRootKeyId = "control-root-a";
  mocks.currentScopeId = null;
  mocks.freshScopeCount = 0;
  mocks.isProviderDisabled = false;
  mocks.nextScopeId = 0;
  mocks.openEvents.length = 0;
  mocks.prepareRootDelay = null;
  mocks.prepareRootEvents.length = 0;
  mocks.preparedRootScopes = new WeakMap<object, number>();
  mocks.prewarmDelay = null;
  mocks.prewarmEvents.length = 0;
  mocks.prewarmedByScope.clear();
  mocks.providerEvents.length = 0;
  mocks.readCriticalSectionState = () => ({
    lockActive: false,
    transactionActive: false,
  });
  mocks.assertTransactionContext = () => undefined;

  mocks.runWithHostedDomainRootUnwrapCache.mockImplementation(
    async <T>(run: () => Promise<T>) => {
      if (mocks.currentScopeId !== null) {
        return run();
      }
      return runInNewUnwrapScope(run);
    },
  );
  mocks.runWithFreshHostedDomainRootUnwrapCache.mockImplementation(
    async <T>(run: () => Promise<T>) => {
      mocks.freshScopeCount += 1;
      return runInNewUnwrapScope(run);
    },
  );
  mocks.runWithHostedDomainRootProviderCallsDisabled.mockImplementation(
    async <T>(run: () => Promise<T>) => {
      const previous = mocks.isProviderDisabled;
      mocks.isProviderDisabled = true;
      try {
        return await run();
      } finally {
        mocks.isProviderDisabled = previous;
      }
    },
  );
  mocks.prepareHostedDomainRootForWeb.mockImplementation(async (input: {
    domain: "control";
    userId: string;
  }) => {
    recordProviderEvent("prepare-new-root");
    await mocks.prepareRootDelay?.();
    const scopeId = requireCurrentScopeId();
    const prepared = Object.freeze({
      domain: input.domain,
      rootKeyId: mocks.activeRootKeyId,
      userId: input.userId,
    });
    mocks.preparedRootScopes.set(prepared, scopeId);
    mocks.prepareRootEvents.push({
      rootKeyId: prepared.rootKeyId,
      scopeId,
    });
    return prepared;
  });
  mocks.readPreparedHostedDomainRootForWebLocal.mockImplementation((prepared: {
    domain: "control";
    rootKeyId: string;
    userId: string;
  }) => {
    assertPreparedRootScope(prepared);
    return {
      root: Promise.resolve({
        envelope: prepared,
        rootKey: new Uint8Array([1, 2, 3, 4]),
      }),
      rootKeyId: prepared.rootKeyId,
    };
  });
  mocks.revalidatePreparedHostedDomainRootForWebTx.mockImplementation(
    async (input: {
      prepared: { domain: "control"; rootKeyId: string; userId: string };
    }) => {
      mocks.assertTransactionContext();
      if (!mocks.isProviderDisabled) {
        throw new Error("Prepared root revalidation was not provider-disabled.");
      }
      assertPreparedRootScope(input.prepared);
      if (input.prepared.rootKeyId !== mocks.activeRootKeyId) {
        throw new mocks.HostedDomainRootPreparationMismatchError();
      }
      return mocks.readPreparedHostedDomainRootForWebLocal(input.prepared);
    },
  );
  mocks.sealHostedUserSecureBoxString.mockImplementation(async () => {
    recordProviderEvent("provider-capable-seal-fallback");
    throw new Error("Provider-capable secure-box seal fallback was called.");
  });
  mocks.sealHostedUserSecureBoxStringFromPreparedRoot.mockImplementation(
    async (input: {
      preparedRoot: Promise<{
        envelope: { domain: "control"; rootKeyId: string; userId: string };
      }>;
      preparedRootKeyId: string;
      value: string;
    }) => {
      const cached = await input.preparedRoot;
      if (cached.envelope.rootKeyId !== input.preparedRootKeyId) {
        throw new Error("Local secure-box seal received the wrong prepared root.");
      }
      return syntheticCiphertext(input.preparedRootKeyId, input.value);
    },
  );
});

describe("meal photo enrollment crypto preparation boundary", () => {
  it("finishes delayed new-enrollment provider work before transaction checkout and lock", async () => {
    const providerStarted = createDeferred();
    const releaseProvider = createDeferred();
    mocks.prepareRootDelay = async () => {
      providerStarted.resolve();
      await releaseProvider.promise;
    };
    const prisma = createEnrollmentPrismaHarness(null);

    const issuing = issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: v1EnrollmentRequest(),
    });
    await providerStarted.promise;

    expect(prisma.transactionCount()).toBe(0);
    expect(prisma.lockCount()).toBe(0);
    releaseProvider.resolve();
    await expect(issuing).resolves.toMatchObject({
      expiresAt: expect.any(Date),
      idempotencySecret: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
      uploadToken: expect.stringMatching(/^murph_meal_photo_/u),
    });

    expect(prisma.transactionCount()).toBe(1);
    expect(prisma.lockCount()).toBe(1);
    expect(mocks.prepareHostedDomainRootForWeb).toHaveBeenCalledOnce();
    expect(mocks.sealHostedUserSecureBoxString).not.toHaveBeenCalled();
    expectProvidersOutsideCriticalSection();
  });

  it("finishes delayed existing-secret provider work before transaction checkout and lock", async () => {
    const providerStarted = createDeferred();
    const releaseProvider = createDeferred();
    mocks.prewarmDelay = async () => {
      providerStarted.resolve();
      await releaseProvider.promise;
    };
    const prisma = createEnrollmentPrismaHarness(activeEnrollment({
      ciphertext: syntheticCiphertext("existing-root", "existing-secret"),
    }));

    const issuing = issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: v1EnrollmentRequest(),
    });
    await providerStarted.promise;

    expect(prisma.transactionCount()).toBe(0);
    expect(prisma.lockCount()).toBe(0);
    releaseProvider.resolve();
    await expect(issuing).resolves.toMatchObject({
      idempotencySecret: "existing-secret",
    });

    expect(prisma.transactionCount()).toBe(1);
    expect(prisma.lockCount()).toBe(1);
    expect(mocks.prepareHostedDomainRootForWeb).not.toHaveBeenCalled();
    expect(mocks.openEvents).toHaveLength(1);
    expectProvidersOutsideCriticalSection();
  });

  it("reprepares once after exact authority state drift", async () => {
    const prisma = createEnrollmentPrismaHarness(activeEnrollment({
      authorityRevision: 1,
      ciphertext: syntheticCiphertext("existing-root", "old-secret"),
    }));
    prisma.setBeforeTransaction((transactionNumber) => {
      if (transactionNumber === 1) {
        prisma.setRecord(revokedEnrollment({ authorityRevision: 1 }));
      }
    });

    const issued = await issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: v2EnrollmentRequest(3),
    });

    expect(prisma.transactionCount()).toBe(2);
    expect(prisma.lockCount()).toBe(2);
    expect(prisma.upsertCount()).toBe(1);
    expect(mocks.freshScopeCount).toBe(1);
    expect(issued.idempotencySecret).not.toBe("old-secret");
    expect(prisma.getRecord()).toMatchObject({
      activatedAt: null,
      authorityRevision: 3,
      revokedAt: null,
    });
    expectProvidersOutsideCriticalSection();
  });

  it("fails closed after one whole reprepare when authority revision drift persists", async () => {
    const prisma = createEnrollmentPrismaHarness(activeEnrollment({
      authorityRevision: 1,
      ciphertext: syntheticCiphertext("existing-root", "stable-secret"),
    }));
    prisma.setBeforeTransaction(() => {
      const current = requireStoredEnrollment(prisma.getRecord());
      prisma.setRecord({
        ...current,
        authorityRevision: current.authorityRevision + 1,
      });
    });

    await expect(issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: v2EnrollmentRequest(10),
    })).rejects.toBeInstanceOf(
      mocks.HostedDomainRootPreparationMismatchError,
    );

    expect(prisma.transactionCount()).toBe(2);
    expect(prisma.lockCount()).toBe(2);
    expect(prisma.upsertCount()).toBe(0);
    expect(mocks.freshScopeCount).toBe(1);
    expect(mocks.prewarmEvents).toHaveLength(2);
    expectProvidersOutsideCriticalSection();
  });

  it("does not reuse stale plaintext after ciphertext and root identity drift", async () => {
    const firstCiphertext = syntheticCiphertext("root-a", "secret-a");
    const secondCiphertext = syntheticCiphertext("root-b", "secret-b");
    const prisma = createEnrollmentPrismaHarness(activeEnrollment({
      ciphertext: firstCiphertext,
    }));
    prisma.setBeforeTransaction((transactionNumber) => {
      if (transactionNumber === 1) {
        prisma.setRecord({
          ...requireStoredEnrollment(prisma.getRecord()),
          idempotencySecretEncrypted: secondCiphertext,
        });
      }
    });

    const issued = await issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: v1EnrollmentRequest(),
    });

    expect(issued.idempotencySecret).toBe("secret-b");
    expect(issued.idempotencySecret).not.toBe("secret-a");
    expect(prisma.transactionCount()).toBe(2);
    expect(mocks.freshScopeCount).toBe(1);
    expect(mocks.openEvents.map((event) => event.value)).toEqual([
      firstCiphertext,
      secondCiphertext,
    ]);
    expect(prisma.getRecord()?.idempotencySecretEncrypted).toBe(secondCiphertext);
    expectProvidersOutsideCriticalSection();
  });

  it("reprepares a new secret when exact active-root revalidation loses the race", async () => {
    const prisma = createEnrollmentPrismaHarness(null);
    prisma.setBeforeTransaction((transactionNumber) => {
      if (transactionNumber === 1) {
        mocks.activeRootKeyId = "control-root-b";
      }
    });

    await expect(issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: v1EnrollmentRequest(),
    })).resolves.toMatchObject({
      idempotencySecret: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
    });

    expect(prisma.transactionCount()).toBe(2);
    expect(mocks.freshScopeCount).toBe(1);
    expect(mocks.prepareRootEvents.map((event) => event.rootKeyId)).toEqual([
      "control-root-a",
      "control-root-b",
    ]);
    expect(prisma.getRecord()?.idempotencySecretEncrypted)
      .toMatch(/^secure:control-root-b:/u);
    expectProvidersOutsideCriticalSection();
  });

  it("does not carry prepared plaintext or roots across sequential request scopes", async () => {
    const firstCiphertext = syntheticCiphertext("root-a", "secret-a");
    const secondCiphertext = syntheticCiphertext("root-b", "secret-b");
    const prisma = createEnrollmentPrismaHarness(activeEnrollment({
      ciphertext: firstCiphertext,
    }));

    const first = await issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: v1EnrollmentRequest(),
    });
    prisma.setRecord({
      ...requireStoredEnrollment(prisma.getRecord()),
      idempotencySecretEncrypted: secondCiphertext,
    });
    const second = await issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: v1EnrollmentRequest(),
    });

    expect(first.idempotencySecret).toBe("secret-a");
    expect(second.idempotencySecret).toBe("secret-b");
    expect(mocks.openEvents).toEqual([
      { scopeId: 1, value: firstCiphertext },
      { scopeId: 2, value: secondCiphertext },
    ]);
    expect(mocks.prewarmEvents.map((event) => event.scopeId)).toEqual([1, 2]);
    expect(mocks.freshScopeCount).toBe(0);
    expectProvidersOutsideCriticalSection();
  });
});

function createEnrollmentPrismaHarness(initial: StoredEnrollment | null): {
  client: MealPhotoCapturePrismaForTest;
  getRecord: () => StoredEnrollment | null;
  lockCount: () => number;
  setBeforeTransaction: (
    callback: ((transactionNumber: number) => void | Promise<void>) | null,
  ) => void;
  setRecord: (record: StoredEnrollment | null) => void;
  transactionCount: () => number;
  upsertCount: () => number;
} {
  let record = cloneEnrollment(initial);
  let transactionCount = 0;
  let lockCount = 0;
  let transactionActive = false;
  let lockActive = false;
  let beforeTransaction:
    ((transactionNumber: number) => void | Promise<void>) | null = null;

  const delegate = {
    findUnique: vi.fn(async (input: {
      where: {
        memberId_installationIdHash?: {
          installationIdHash: string;
          memberId: string;
        };
      };
    }) => {
      const compound = input.where.memberId_installationIdHash;
      return record
        && compound?.memberId === record.memberId
        && compound.installationIdHash === record.installationIdHash
        ? { ...record }
        : null;
    }),
    upsert: vi.fn(async (input: {
      create: StoredEnrollment;
      update: Partial<StoredEnrollment>;
    }) => {
      record = record ? { ...record, ...input.update } : { ...input.create };
      return { ...record };
    }),
  };
  const tx = { hostedMealPhotoCaptureEnrollment: delegate };
  const client = {
    hostedMealPhotoCaptureEnrollment: delegate,
    $transaction: vi.fn(async (
      operation: (transaction: typeof tx) => Promise<unknown>,
    ) => {
      transactionCount += 1;
      transactionActive = true;
      lockActive = false;
      try {
        await beforeTransaction?.(transactionCount);
        return await operation(tx);
      } finally {
        lockActive = false;
        transactionActive = false;
      }
    }),
  };

  mocks.readCriticalSectionState = () => ({ lockActive, transactionActive });
  mocks.assertTransactionContext = () => {
    if (!transactionActive || !lockActive) {
      throw new Error("Expected prepared-root revalidation under the member lock.");
    }
  };
  mocks.lockHostedMemberRow.mockImplementation(async () => {
    if (!transactionActive || !mocks.isProviderDisabled) {
      throw new Error("Member lock was not inside a provider-disabled transaction.");
    }
    lockCount += 1;
    lockActive = true;
  });

  return {
    client: mealPhotoCapturePrismaClientForTest(client),
    getRecord: () => cloneEnrollment(record),
    lockCount: () => lockCount,
    setBeforeTransaction: (callback) => {
      beforeTransaction = callback;
    },
    setRecord: (next) => {
      record = cloneEnrollment(next);
    },
    transactionCount: () => transactionCount,
    upsertCount: () => delegate.upsert.mock.calls.length,
  };
}

function mealPhotoCapturePrismaClientForTest(client: {
  $transaction: (
    operation: (transaction: { hostedMealPhotoCaptureEnrollment: object }) => Promise<unknown>,
  ) => Promise<unknown>;
  hostedMealPhotoCaptureEnrollment: object;
}): MealPhotoCapturePrismaForTest {
  // Narrow test boundary: the service touches only this delegate and the
  // transaction callback; access/consent and member locking are mocked above.
  const narrowClient = client as Pick<
    MealPhotoCapturePrismaForTest,
    "$transaction" | "hostedMealPhotoCaptureEnrollment"
  >;
  return narrowClient as MealPhotoCapturePrismaForTest;
}

async function runInNewUnwrapScope<T>(run: () => Promise<T>): Promise<T> {
  const previous = mocks.currentScopeId;
  const scopeId = mocks.nextScopeId + 1;
  mocks.nextScopeId = scopeId;
  mocks.currentScopeId = scopeId;
  mocks.prewarmedByScope.set(scopeId, new Set());
  try {
    return await run();
  } finally {
    mocks.prewarmedByScope.delete(scopeId);
    mocks.currentScopeId = previous;
  }
}

function requireCurrentScopeId(): number {
  if (mocks.currentScopeId === null) {
    throw new Error("Expected a request-scoped hosted domain-root cache.");
  }
  return mocks.currentScopeId;
}

function assertPreparedRootScope(prepared: object): void {
  if (mocks.preparedRootScopes.get(prepared) !== requireCurrentScopeId()) {
    throw new TypeError("Prepared root escaped its exact request scope.");
  }
}

function recordProviderEvent(operation: string): void {
  const state = mocks.readCriticalSectionState();
  mocks.providerEvents.push({ operation, ...state });
  if (state.transactionActive || state.lockActive) {
    throw new Error(`${operation} ran inside the database critical section.`);
  }
}

function expectProvidersOutsideCriticalSection(): void {
  expect(mocks.providerEvents.length).toBeGreaterThan(0);
  expect(mocks.providerEvents).toEqual(
    mocks.providerEvents.map((event) => ({
      ...event,
      lockActive: false,
      transactionActive: false,
    })),
  );
}

function activeEnrollment(input: {
  authorityRevision?: number;
  ciphertext: string;
}): StoredEnrollment {
  const now = new Date("2026-08-20T12:00:00.000Z");
  return {
    activatedAt: now,
    authorityRevision: input.authorityRevision ?? 0,
    createdAt: now,
    expiresAt: new Date("2026-09-19T12:00:00.000Z"),
    id: "hmp_existing_enrollment",
    idempotencySecretEncrypted: input.ciphertext,
    installationIdHash: INSTALLATION_HASH,
    memberId: MEMBER_ID,
    revokeReason: null,
    revokedAt: null,
    updatedAt: now,
    uploadTokenHash: "existing-token-hash",
  };
}

function revokedEnrollment(input: { authorityRevision: number }): StoredEnrollment {
  const now = new Date("2026-08-21T12:00:00.000Z");
  return {
    activatedAt: null,
    authorityRevision: input.authorityRevision,
    createdAt: now,
    expiresAt: null,
    id: "hmp_existing_enrollment",
    idempotencySecretEncrypted: null,
    installationIdHash: INSTALLATION_HASH,
    memberId: MEMBER_ID,
    revokeReason: "member_disabled",
    revokedAt: now,
    updatedAt: now,
    uploadTokenHash: null,
  };
}

function v1EnrollmentRequest() {
  return {
    appInstallationId: INSTALLATION_ID,
    appVersion: "1.2.3",
    schemaVersion: 1 as const,
  };
}

function v2EnrollmentRequest(authorityRevision: number) {
  return {
    appInstallationId: INSTALLATION_ID,
    appVersion: "1.2.3",
    authorityRevision,
    schemaVersion: 2 as const,
  };
}

function syntheticCiphertext(rootKeyId: string, plaintext: string): string {
  return `secure:${rootKeyId}:${plaintext}`;
}

function parseSyntheticCiphertext(value: string): {
  plaintext: string;
  rootKeyId: string;
} {
  const prefix = "secure:";
  if (!value.startsWith(prefix)) {
    throw new Error("Synthetic secure-box ciphertext is malformed.");
  }
  const rootEnd = value.indexOf(":", prefix.length);
  if (rootEnd <= prefix.length || rootEnd === value.length - 1) {
    throw new Error("Synthetic secure-box ciphertext is malformed.");
  }
  return {
    plaintext: value.slice(rootEnd + 1),
    rootKeyId: value.slice(prefix.length, rootEnd),
  };
}

function cloneEnrollment(record: StoredEnrollment | null): StoredEnrollment | null {
  return record ? { ...record } : null;
}

function requireStoredEnrollment(
  record: StoredEnrollment | null,
): StoredEnrollment {
  if (!record) {
    throw new Error("Expected a stored meal photo enrollment.");
  }
  return record;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function createDeferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return {
    promise,
    resolve: () => resolve?.(),
  };
}
