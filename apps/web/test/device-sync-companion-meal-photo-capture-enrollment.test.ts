import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  activateMealPhotoCaptureEnrollmentForScopedToken,
  assertCurrentMealPhotoCaptureEnrollmentTx,
  issueMealPhotoCaptureEnrollment,
  requireActiveMealPhotoCaptureEnrollment,
  revokeAllMealPhotoCaptureEnrollmentsForMember,
  revokeMealPhotoCaptureEnrollmentForMember,
  revokeMealPhotoCaptureEnrollmentForScopedToken,
} from "../src/lib/device-sync/meal-photo-capture";

const mocks = vi.hoisted(() => ({
  assertActiveHostedMemberAccessAllowed: vi.fn(),
  assertHostedHistoricalLaunchConsentGranted: vi.fn(),
  assertHostedLaunchRequiredConsentGranted: vi.fn(),
  lockHostedMemberRow: vi.fn(),
  lockHostedMemberSponsoredAccessRows: vi.fn(),
  prepareRootDelay: null as (() => Promise<void>) | null,
  prewarmDelay: null as (() => Promise<void>) | null,
  readHostedHealthDataConsentState: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  assertActiveHostedMemberAccessAllowed: mocks.assertActiveHostedMemberAccessAllowed,
}));

vi.mock("@/src/lib/legal/consent", () => ({
  assertHostedHistoricalLaunchConsentGranted: mocks.assertHostedHistoricalLaunchConsentGranted,
  assertHostedLaunchRequiredConsentGranted: mocks.assertHostedLaunchRequiredConsentGranted,
  readHostedHealthDataConsentState: mocks.readHostedHealthDataConsentState,
}));

vi.mock("@/src/lib/hosted-onboarding/shared", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-onboarding/shared")
  >();
  return {
    ...actual,
    lockHostedMemberRow: mocks.lockHostedMemberRow,
    lockHostedMemberSponsoredAccessRows: mocks.lockHostedMemberSponsoredAccessRows,
  };
});

vi.mock("@/src/lib/hosted-crypto/domain-root-store", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-crypto/domain-root-store")
  >();
  return {
    ...actual,
    prepareHostedDomainRootForWeb: vi.fn(async (input: {
      domain: "device";
      userId: string;
    }) => {
      await mocks.prepareRootDelay?.();
      return Object.freeze({
        domain: input.domain,
        rootKeyId: "test-device-root",
        userId: input.userId,
      });
    }),
    readPreparedHostedDomainRootForWebLocal: vi.fn((prepared: {
      domain: "device";
      rootKeyId: string;
      userId: string;
    }) => ({
      root: Promise.resolve({
        envelope: prepared,
        rootKey: new Uint8Array([1, 2, 3, 4]),
      }),
      rootKeyId: prepared.rootKeyId,
    })),
    revalidatePreparedHostedDomainRootForWebTx: vi.fn(async (input: {
      prepared: {
        domain: "device";
        rootKeyId: string;
        userId: string;
      };
    }) => ({
      root: Promise.resolve({
        envelope: input.prepared,
        rootKey: new Uint8Array([1, 2, 3, 4]),
      }),
      rootKeyId: input.prepared.rootKeyId,
    })),
  };
});

vi.mock("@/src/lib/hosted-crypto/secure-box", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-crypto/secure-box")
  >();
  return {
    ...actual,
    openHostedUserSecureBoxStringFromPreparedRoot: vi.fn(async (input: {
      value: string;
    }) => input.value.startsWith("hsb-test:")
      ? input.value.slice("hsb-test:".length)
      : null),
    prewarmHostedUserSecureBoxStrings: vi.fn(async () => {
      await mocks.prewarmDelay?.();
    }),
    readHostedUserSecureBoxStringRootReference: vi.fn((input: {
      value: string | null | undefined;
    }) => input.value?.startsWith("hsb-test:")
      ? { domain: "device", rootKeyId: "test-device-root" }
      : null),
    sealHostedUserSecureBoxStringFromPreparedRoot: vi.fn(async (input: {
      preparedRoot: Promise<{
        envelope: { rootKeyId: string };
      }>;
      preparedRootKeyId: string;
      value: string;
    }) => {
      const preparedRoot = await input.preparedRoot;
      if (preparedRoot.envelope.rootKeyId !== input.preparedRootKeyId) {
        throw new Error("Test prepared root does not match the requested root.");
      }
      return `hsb-test:${input.value}`;
    }),
  };
});

const MEMBER_ID = "member_1";
const INSTALLATION_ID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
const INSTALLATION_HASH = sha256(INSTALLATION_ID);

type MealPhotoCapturePrismaForTest =
  Parameters<typeof issueMealPhotoCaptureEnrollment>[0]["prisma"];
type MealPhotoCaptureTransactionForTest =
  Parameters<typeof assertCurrentMealPhotoCaptureEnrollmentTx>[0]["prisma"];

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

describe("meal photo capture enrollment credentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertActiveHostedMemberAccessAllowed.mockResolvedValue(undefined);
    mocks.assertHostedHistoricalLaunchConsentGranted.mockResolvedValue(undefined);
    mocks.assertHostedLaunchRequiredConsentGranted.mockResolvedValue(undefined);
    mocks.lockHostedMemberRow.mockResolvedValue(undefined);
    mocks.lockHostedMemberSponsoredAccessRows.mockResolvedValue(undefined);
    mocks.prepareRootDelay = null;
    mocks.prewarmDelay = null;
    mocks.readHostedHealthDataConsentState.mockResolvedValue("revoked");
  });

  it("persists only hashed bearer/installation values and an encrypted secret", async () => {
    const prisma = createEnrollmentPrismaHarness();
    const issued = await issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      now: new Date("2026-07-12T12:00:00.000Z"),
      prisma: prisma.client,
      request: enrollmentRequest(),
    });
    const stored = prisma.getRecord();

    expect(issued.uploadToken).toMatch(/^murph_meal_photo_[A-Za-z0-9_-]{43}$/u);
    expect(issued.idempotencySecret).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(stored).toMatchObject({
      activatedAt: new Date("2026-07-12T12:00:00.000Z"),
      expiresAt: new Date("2026-08-11T12:00:00.000Z"),
      installationIdHash: INSTALLATION_HASH,
      memberId: MEMBER_ID,
      revokeReason: null,
      revokedAt: null,
      uploadTokenHash: sha256(issued.uploadToken),
    });
    expect(stored?.installationIdHash).not.toBe(INSTALLATION_ID);
    expect(stored?.uploadTokenHash).not.toBe(issued.uploadToken);
    expect(stored?.idempotencySecretEncrypted).not.toBe(issued.idempotencySecret);
    expect(stored?.idempotencySecretEncrypted).toMatch(/^hsb-test:/u);
    expect(mocks.lockHostedMemberRow).toHaveBeenCalledWith(prisma.tx, MEMBER_ID);
  });

  it("rotates the bearer on refresh while preserving the installation secret", async () => {
    const prisma = createEnrollmentPrismaHarness();
    const first = await issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: enrollmentRequest(),
    });
    const second = await issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: enrollmentRequest(),
    });

    expect(second.uploadToken).not.toBe(first.uploadToken);
    expect(second.idempotencySecret).toBe(first.idempotencySecret);
    expect(prisma.getRecord()?.uploadTokenHash).toBe(sha256(second.uploadToken));

    await expect(revokeMealPhotoCaptureEnrollmentForScopedToken({
      prisma: prisma.client,
      token: first.uploadToken,
    })).rejects.toMatchObject({ code: "AUTH_REQUIRED", httpStatus: 401 });
  });

  it("serializes concurrent same-member enrollments and reuses the winner secret", async () => {
    const prisma = createEnrollmentPrismaHarness();
    const firstReachedUpsert = createDeferred();
    const releaseFirstUpsert = createDeferred();
    const secondReachedLock = createDeferred();
    const releaseSecondLock = createDeferred();
    prisma.setBeforeUpsert(async () => {
      firstReachedUpsert.resolve();
      await releaseFirstUpsert.promise;
      prisma.setBeforeUpsert(null);
    });
    mocks.lockHostedMemberRow.mockImplementation(async () => {
      if (mocks.lockHostedMemberRow.mock.calls.length === 2) {
        secondReachedLock.resolve();
        await releaseSecondLock.promise;
      }
    });

    const firstPromise = issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: enrollmentRequest(),
    });
    await firstReachedUpsert.promise;
    const secondPromise = issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: enrollmentRequest(),
    });
    await secondReachedLock.promise;

    releaseFirstUpsert.resolve();
    const first = await firstPromise;
    releaseSecondLock.resolve();
    const second = await secondPromise;

    expect(second.idempotencySecret).toBe(first.idempotencySecret);
    expect(second.uploadToken).not.toBe(first.uploadToken);
    expect(prisma.getRecord()?.uploadTokenHash).toBe(sha256(second.uploadToken));
    expect(mocks.lockHostedMemberRow).toHaveBeenCalledTimes(3);
  });

  it("rotates both credentials after explicit member revocation", async () => {
    const prisma = createEnrollmentPrismaHarness();
    const first = await issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: enrollmentRequest(),
    });
    await expect(revokeMealPhotoCaptureEnrollmentForMember({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: {
        appInstallationId: INSTALLATION_ID,
        schemaVersion: 1,
      },
    })).resolves.toEqual({ revoked: true });
    expect(prisma.getRecord()).toMatchObject({
      expiresAt: null,
      idempotencySecretEncrypted: null,
      uploadTokenHash: null,
    });

    const second = await issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: enrollmentRequest(),
    });
    expect(second.uploadToken).not.toBe(first.uploadToken);
    expect(second.idempotencySecret).not.toBe(first.idempotencySecret);
    expect(prisma.getRecord()).toMatchObject({ revokedAt: null, revokeReason: null });
  });

  it("rejects fresh schema-v1 preparation overtaken by missing-row revocation", async () => {
    const prisma = createEnrollmentPrismaHarness();
    const preparationStarted = createDeferred();
    const releasePreparation = createDeferred();
    let preparationCount = 0;
    mocks.prepareRootDelay = async () => {
      preparationCount += 1;
      preparationStarted.resolve();
      await releasePreparation.promise;
    };

    const issuing = issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: enrollmentRequest(),
    });
    await preparationStarted.promise;

    await expect(revokeMealPhotoCaptureEnrollmentForMember({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: {
        appInstallationId: INSTALLATION_ID,
        schemaVersion: 1,
      },
    })).resolves.toEqual({ revoked: true });
    const tombstoneId = requireStoredEnrollment(prisma.getRecord()).id;

    releasePreparation.resolve();
    await expect(issuing).rejects.toMatchObject({
      code: "MEAL_PHOTO_CAPTURE_AUTHORITY_REVISION_CONFLICT",
      details: {
        currentAuthorityRevision: 0,
        currentAuthorityState: "revoked",
        requestedOperation: "enroll",
      },
      retryable: false,
    });

    expect(preparationCount).toBe(1);
    expect(prisma.getRecord()).toMatchObject({
      id: tombstoneId,
      revokedAt: expect.any(Date),
      uploadTokenHash: null,
    });
  });

  it("rejects existing-secret preparation overtaken by scoped revocation", async () => {
    const prisma = createEnrollmentPrismaHarness();
    const issued = await issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: enrollmentRequest(),
    });
    const originalId = requireStoredEnrollment(prisma.getRecord()).id;
    const preparationStarted = createDeferred();
    const releasePreparation = createDeferred();
    let preparationCount = 0;
    mocks.prewarmDelay = async () => {
      preparationCount += 1;
      preparationStarted.resolve();
      await releasePreparation.promise;
    };
    mocks.prepareRootDelay = async () => {
      preparationCount += 1;
    };

    const renewing = issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: enrollmentRequest(),
    });
    await preparationStarted.promise;

    await expect(revokeMealPhotoCaptureEnrollmentForScopedToken({
      prisma: prisma.client,
      token: issued.uploadToken,
    })).resolves.toEqual({ revoked: true });
    const tombstoneId = requireStoredEnrollment(prisma.getRecord()).id;
    expect(tombstoneId).not.toBe(originalId);

    releasePreparation.resolve();
    await expect(renewing).rejects.toMatchObject({
      code: "MEAL_PHOTO_CAPTURE_AUTHORITY_REVISION_CONFLICT",
      retryable: false,
    });
    expect(preparationCount).toBe(1);
    expect(prisma.getRecord()).toMatchObject({
      id: tombstoneId,
      revokeReason: "scoped_token_revoked",
      revokedAt: expect.any(Date),
    });
  });

  it("advances a repeated schema-v1 revocation past an in-flight re-enrollment", async () => {
    const prisma = createEnrollmentPrismaHarness();
    await revokeMealPhotoCaptureEnrollmentForMember({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: {
        appInstallationId: INSTALLATION_ID,
        schemaVersion: 1,
      },
    });
    const firstTombstoneId = requireStoredEnrollment(prisma.getRecord()).id;
    const preparationStarted = createDeferred();
    const releasePreparation = createDeferred();
    let preparationCount = 0;
    mocks.prepareRootDelay = async () => {
      preparationCount += 1;
      preparationStarted.resolve();
      await releasePreparation.promise;
    };

    const issuing = issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: enrollmentRequest(),
    });
    await preparationStarted.promise;
    await expect(revokeMealPhotoCaptureEnrollmentForMember({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: {
        appInstallationId: INSTALLATION_ID,
        schemaVersion: 1,
      },
    })).resolves.toEqual({ revoked: true });
    const secondTombstoneId = requireStoredEnrollment(prisma.getRecord()).id;
    expect(secondTombstoneId).not.toBe(firstTombstoneId);

    releasePreparation.resolve();
    await expect(issuing).rejects.toMatchObject({
      code: "MEAL_PHOTO_CAPTURE_AUTHORITY_REVISION_CONFLICT",
      retryable: false,
    });
    expect(preparationCount).toBe(1);
    expect(prisma.getRecord()).toMatchObject({
      id: secondTombstoneId,
      revokedAt: expect.any(Date),
    });
  });

  it("rejects stale schema-v1 preparation across revoked-enabled-revoked ABA", async () => {
    const prisma = createEnrollmentPrismaHarness();
    await issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: enrollmentRequest(),
    });
    const originalId = requireStoredEnrollment(prisma.getRecord()).id;
    const preparationStarted = createDeferred();
    const releasePreparation = createDeferred();
    let preparationCount = 0;
    mocks.prewarmDelay = async () => {
      preparationCount += 1;
      preparationStarted.resolve();
      await releasePreparation.promise;
    };
    mocks.prepareRootDelay = async () => {
      preparationCount += 1;
    };

    const staleRenewal = issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: enrollmentRequest(),
    });
    await preparationStarted.promise;
    await revokeMealPhotoCaptureEnrollmentForMember({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: {
        appInstallationId: INSTALLATION_ID,
        schemaVersion: 1,
      },
    });
    await issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: enrollmentRequest(),
    });
    await revokeMealPhotoCaptureEnrollmentForMember({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: {
        appInstallationId: INSTALLATION_ID,
        schemaVersion: 1,
      },
    });
    const finalTombstoneId = requireStoredEnrollment(prisma.getRecord()).id;
    expect(finalTombstoneId).not.toBe(originalId);

    releasePreparation.resolve();
    await expect(staleRenewal).rejects.toMatchObject({
      code: "MEAL_PHOTO_CAPTURE_AUTHORITY_REVISION_CONFLICT",
      retryable: false,
    });
    expect(preparationCount).toBe(2);
    expect(prisma.getRecord()).toMatchObject({
      id: finalTombstoneId,
      revokedAt: expect.any(Date),
      uploadTokenHash: null,
    });
  });

  it("keeps a newer schema-v2 tombstone when a delayed enrollment arrives", async () => {
    const prisma = createEnrollmentPrismaHarness();

    await expect(revokeMealPhotoCaptureEnrollmentForMember({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: v2RevocationRequest(2),
    })).resolves.toEqual({ revoked: true });

    await expect(issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: v2EnrollmentRequest(1),
    })).rejects.toMatchObject({
      code: "MEAL_PHOTO_CAPTURE_AUTHORITY_REVISION_CONFLICT",
      details: {
        currentAuthorityRevision: 2,
        currentAuthorityState: "revoked",
        requestedOperation: "enroll",
      },
      httpStatus: 409,
    });
    expect(prisma.getRecord()).toMatchObject({
      authorityRevision: 2,
      expiresAt: null,
      idempotencySecretEncrypted: null,
      revokeReason: "member_disabled",
      revokedAt: expect.any(Date),
      uploadTokenHash: null,
    });
  });

  it("keeps a newer tombstone over a delayed enrollment after prior authority", async () => {
    const prisma = createEnrollmentPrismaHarness();
    await issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: v2EnrollmentRequest(1),
    });
    await revokeMealPhotoCaptureEnrollmentForMember({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: v2RevocationRequest(3),
    });

    await expect(issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: v2EnrollmentRequest(2),
    })).rejects.toMatchObject({
      code: "MEAL_PHOTO_CAPTURE_AUTHORITY_REVISION_CONFLICT",
      details: { currentAuthorityRevision: 3, currentAuthorityState: "revoked" },
    });
    expect(prisma.getRecord()).toMatchObject({
      authorityRevision: 3,
      idempotencySecretEncrypted: null,
      revokedAt: expect.any(Date),
      uploadTokenHash: null,
    });
  });

  it("ends disabled when schema-v2 enrollment arrives before a newer revocation", async () => {
    const prisma = createEnrollmentPrismaHarness();
    await issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: v2EnrollmentRequest(1),
    });

    await expect(revokeMealPhotoCaptureEnrollmentForMember({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: v2RevocationRequest(2),
    })).resolves.toEqual({ revoked: true });
    const tombstoneUpdatedAt = prisma.getRecord()?.updatedAt;
    await expect(revokeMealPhotoCaptureEnrollmentForMember({
      memberId: MEMBER_ID,
      now: new Date("2026-08-01T12:00:00.000Z"),
      prisma: prisma.client,
      request: v2RevocationRequest(2),
    })).resolves.toEqual({ revoked: true });

    expect(prisma.getRecord()).toMatchObject({
      authorityRevision: 2,
      revokedAt: expect.any(Date),
      updatedAt: tombstoneUpdatedAt,
      uploadTokenHash: null,
    });
  });

  it("allows only a higher schema-v2 revision to re-enable a tombstone", async () => {
    const prisma = createEnrollmentPrismaHarness();
    await revokeMealPhotoCaptureEnrollmentForMember({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: v2RevocationRequest(1),
    });
    const issued = await issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: v2EnrollmentRequest(2),
    });

    await expect(revokeMealPhotoCaptureEnrollmentForMember({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: v2RevocationRequest(1),
    })).rejects.toMatchObject({
      code: "MEAL_PHOTO_CAPTURE_AUTHORITY_REVISION_CONFLICT",
      details: { currentAuthorityRevision: 2, currentAuthorityState: "prepared" },
    });
    await expect(requireActiveMealPhotoCaptureEnrollment({
      prisma: prisma.client,
      request: uploadRequest(issued.uploadToken),
    })).rejects.toMatchObject({ code: "AUTH_REQUIRED", httpStatus: 401 });
  });

  it("rejects duplicate schema-v2 enrollment without rotating plaintext credentials", async () => {
    const prisma = createEnrollmentPrismaHarness();
    const issued = await issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: v2EnrollmentRequest(1),
    });
    const storedTokenHash = prisma.getRecord()?.uploadTokenHash;

    await expect(issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: v2EnrollmentRequest(1),
    })).rejects.toMatchObject({
      code: "MEAL_PHOTO_CAPTURE_AUTHORITY_REVISION_CONFLICT",
      details: { currentAuthorityRevision: 1, currentAuthorityState: "prepared" },
    });
    expect(prisma.getRecord()?.uploadTokenHash).toBe(storedTokenHash);
    await expect(requireActiveMealPhotoCaptureEnrollment({
      prisma: prisma.client,
      request: uploadRequest(issued.uploadToken),
    })).rejects.toMatchObject({ code: "AUTH_REQUIRED", httpStatus: 401 });
  });

  it("keeps a lost schema-v2 enrollment response inactive until exact scoped activation", async () => {
    const prisma = createEnrollmentPrismaHarness();
    const preparedAt = new Date("2026-07-12T12:00:00.000Z");
    const activatedAt = new Date("2026-07-12T12:00:01.000Z");
    const issued = await issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      now: preparedAt,
      prisma: prisma.client,
      request: v2EnrollmentRequest(1),
    });

    expect(prisma.getRecord()).toMatchObject({
      activatedAt: null,
      authorityRevision: 1,
      revokedAt: null,
    });
    await expect(requireActiveMealPhotoCaptureEnrollment({
      now: preparedAt,
      prisma: prisma.client,
      request: uploadRequest(issued.uploadToken),
    })).rejects.toMatchObject({ code: "AUTH_REQUIRED", httpStatus: 401 });

    mocks.lockHostedMemberRow.mockClear();
    mocks.lockHostedMemberSponsoredAccessRows.mockClear();
    mocks.assertHostedHistoricalLaunchConsentGranted.mockClear();
    mocks.assertActiveHostedMemberAccessAllowed.mockClear();
    await expect(activateMealPhotoCaptureEnrollmentForScopedToken({
      now: activatedAt,
      prisma: prisma.client,
      token: issued.uploadToken,
    })).resolves.toEqual({ activated: true });
    expect(mocks.lockHostedMemberRow).toHaveBeenCalledWith(prisma.tx, MEMBER_ID);
    expect(mocks.lockHostedMemberSponsoredAccessRows).toHaveBeenCalledWith(
      prisma.tx,
      MEMBER_ID,
    );
    expect(mocks.lockHostedMemberRow.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.lockHostedMemberSponsoredAccessRows.mock.invocationCallOrder[0] ?? 0);
    expect(mocks.lockHostedMemberSponsoredAccessRows.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.assertHostedHistoricalLaunchConsentGranted.mock.invocationCallOrder[0] ?? 0);
    expect(mocks.lockHostedMemberSponsoredAccessRows.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.assertActiveHostedMemberAccessAllowed.mock.invocationCallOrder[0] ?? 0);
    expect(prisma.getRecord()?.activatedAt).toEqual(activatedAt);
    await expect(requireActiveMealPhotoCaptureEnrollment({
      now: activatedAt,
      prisma: prisma.client,
      request: uploadRequest(issued.uploadToken),
    })).resolves.toMatchObject({ memberId: MEMBER_ID });

    await expect(activateMealPhotoCaptureEnrollmentForScopedToken({
      now: new Date("2026-07-12T12:00:02.000Z"),
      prisma: prisma.client,
      token: issued.uploadToken,
    })).resolves.toEqual({ activated: true });
    expect(prisma.getRecord()?.activatedAt).toEqual(activatedAt);
  });

  it("rejects prepared activation after consent withdrawal commits before cleanup", async () => {
    const prisma = createEnrollmentPrismaHarness();
    const issued = await issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: v2EnrollmentRequest(1),
    });
    const consentError = new Error("historical launch consent was withdrawn");
    mocks.assertHostedHistoricalLaunchConsentGranted.mockClear();
    mocks.assertActiveHostedMemberAccessAllowed.mockClear();
    mocks.assertHostedHistoricalLaunchConsentGranted.mockRejectedValueOnce(
      consentError,
    );

    await expect(activateMealPhotoCaptureEnrollmentForScopedToken({
      prisma: prisma.client,
      token: issued.uploadToken,
    })).rejects.toBe(consentError);

    expect(prisma.getRecord()).toMatchObject({
      activatedAt: null,
      revokedAt: null,
      uploadTokenHash: sha256(issued.uploadToken),
    });
    expect(mocks.assertHostedHistoricalLaunchConsentGranted).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      prisma: prisma.tx,
    });
    expect(mocks.assertActiveHostedMemberAccessAllowed).not.toHaveBeenCalled();
  });

  it("rejects prepared activation when hosted access is inactive", async () => {
    const prisma = createEnrollmentPrismaHarness();
    const issued = await issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: v2EnrollmentRequest(1),
    });
    const accessError = new Error("hosted member access is inactive");
    mocks.assertHostedHistoricalLaunchConsentGranted.mockClear();
    mocks.assertActiveHostedMemberAccessAllowed.mockClear();
    mocks.assertActiveHostedMemberAccessAllowed.mockRejectedValueOnce(accessError);

    await expect(activateMealPhotoCaptureEnrollmentForScopedToken({
      prisma: prisma.client,
      token: issued.uploadToken,
    })).rejects.toBe(accessError);

    expect(prisma.getRecord()).toMatchObject({
      activatedAt: null,
      revokedAt: null,
      uploadTokenHash: sha256(issued.uploadToken),
    });
    expect(mocks.assertHostedHistoricalLaunchConsentGranted).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      prisma: prisma.tx,
    });
    expect(mocks.assertActiveHostedMemberAccessAllowed).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      prisma: prisma.tx,
    });
  });

  it("rechecks consent and active access before idempotent activation success", async () => {
    const prisma = createEnrollmentPrismaHarness();
    const activatedAt = new Date("2026-07-12T12:00:01.000Z");
    const issued = await issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: v2EnrollmentRequest(1),
    });
    await activateMealPhotoCaptureEnrollmentForScopedToken({
      now: activatedAt,
      prisma: prisma.client,
      token: issued.uploadToken,
    });

    const consentError = new Error("historical launch consent was withdrawn");
    mocks.assertHostedHistoricalLaunchConsentGranted.mockRejectedValueOnce(
      consentError,
    );
    await expect(activateMealPhotoCaptureEnrollmentForScopedToken({
      prisma: prisma.client,
      token: issued.uploadToken,
    })).rejects.toBe(consentError);
    expect(prisma.getRecord()?.activatedAt).toEqual(activatedAt);

    const accessError = new Error("hosted member access is inactive");
    mocks.assertActiveHostedMemberAccessAllowed.mockRejectedValueOnce(accessError);
    await expect(activateMealPhotoCaptureEnrollmentForScopedToken({
      prisma: prisma.client,
      token: issued.uploadToken,
    })).rejects.toBe(accessError);
    expect(prisma.getRecord()?.activatedAt).toEqual(activatedAt);
  });

  it("lets a delayed schema-v2 POST after scoped teardown install only prepared state", async () => {
    const prisma = createEnrollmentPrismaHarness();
    const prior = await issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: enrollmentRequest(),
    });
    await revokeMealPhotoCaptureEnrollmentForScopedToken({
      prisma: prisma.client,
      token: prior.uploadToken,
    });

    const delayed = await issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: v2EnrollmentRequest(1),
    });

    expect(prisma.getRecord()).toMatchObject({
      activatedAt: null,
      authorityRevision: 1,
      revokedAt: null,
    });
    await expect(requireActiveMealPhotoCaptureEnrollment({
      prisma: prisma.client,
      request: uploadRequest(delayed.uploadToken),
    })).rejects.toMatchObject({ code: "AUTH_REQUIRED", httpStatus: 401 });
  });

  it("serializes scoped activation and deletion so deletion wins in either order", async () => {
    const activationFirst = createEnrollmentPrismaHarness();
    const first = await issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      prisma: activationFirst.client,
      request: v2EnrollmentRequest(1),
    });
    await activateMealPhotoCaptureEnrollmentForScopedToken({
      prisma: activationFirst.client,
      token: first.uploadToken,
    });
    await expect(revokeMealPhotoCaptureEnrollmentForScopedToken({
      prisma: activationFirst.client,
      token: first.uploadToken,
    })).resolves.toEqual({ revoked: true });
    expect(activationFirst.getRecord()).toMatchObject({
      activatedAt: null,
      revokedAt: expect.any(Date),
      uploadTokenHash: null,
    });

    const deletionFirst = createEnrollmentPrismaHarness();
    const second = await issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      prisma: deletionFirst.client,
      request: v2EnrollmentRequest(1),
    });
    await revokeMealPhotoCaptureEnrollmentForScopedToken({
      prisma: deletionFirst.client,
      token: second.uploadToken,
    });
    await expect(activateMealPhotoCaptureEnrollmentForScopedToken({
      prisma: deletionFirst.client,
      token: second.uploadToken,
    })).rejects.toMatchObject({ code: "AUTH_REQUIRED", httpStatus: 401 });
    expect(deletionFirst.getRecord()).toMatchObject({
      activatedAt: null,
      revokedAt: expect.any(Date),
      uploadTokenHash: null,
    });
  });

  it("rejects activation by an expired or rotated scoped token", async () => {
    const prisma = createEnrollmentPrismaHarness();
    const first = await issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      now: new Date("2026-07-12T12:00:00.000Z"),
      prisma: prisma.client,
      request: v2EnrollmentRequest(1),
    });
    await expect(activateMealPhotoCaptureEnrollmentForScopedToken({
      now: new Date("2026-08-11T12:00:00.000Z"),
      prisma: prisma.client,
      token: first.uploadToken,
    })).rejects.toMatchObject({ code: "AUTH_REQUIRED", httpStatus: 401 });

    const second = await issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: v2EnrollmentRequest(2),
    });
    await expect(activateMealPhotoCaptureEnrollmentForScopedToken({
      prisma: prisma.client,
      token: first.uploadToken,
    })).rejects.toMatchObject({ code: "AUTH_REQUIRED", httpStatus: 401 });
    await expect(activateMealPhotoCaptureEnrollmentForScopedToken({
      prisma: prisma.client,
      token: second.uploadToken,
    })).resolves.toEqual({ activated: true });
  });

  it("keeps schema-v1 behavior at revision zero and blocks it after v2 adoption", async () => {
    const prisma = createEnrollmentPrismaHarness();
    await issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: enrollmentRequest(),
    });
    expect(prisma.getRecord()?.authorityRevision).toBe(0);

    await issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: v2EnrollmentRequest(1),
    });
    await expect(issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: enrollmentRequest(),
    })).rejects.toMatchObject({
      code: "MEAL_PHOTO_CAPTURE_AUTHORITY_REVISION_CONFLICT",
      details: { currentAuthorityRevision: 1 },
    });
    await expect(revokeMealPhotoCaptureEnrollmentForMember({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: {
        appInstallationId: INSTALLATION_ID,
        schemaVersion: 1,
      },
    })).rejects.toMatchObject({
      code: "MEAL_PHOTO_CAPTURE_AUTHORITY_REVISION_CONFLICT",
      details: { currentAuthorityRevision: 1 },
    });
  });

  it("fails closed instead of repairing incomplete active credential state", async () => {
    const prisma = createEnrollmentPrismaHarness();
    const issued = await issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: enrollmentRequest(),
    });
    prisma.setRecord({
      ...requireStoredEnrollment(prisma.getRecord()),
      idempotencySecretEncrypted: null,
    });

    await expect(issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: enrollmentRequest(),
    })).rejects.toThrow("incomplete credentials");
    await expect(requireActiveMealPhotoCaptureEnrollment({
      prisma: prisma.client,
      request: uploadRequest(issued.uploadToken),
    })).rejects.toMatchObject({ code: "AUTH_REQUIRED", httpStatus: 401 });
  });

  it("revokes every active enrollment when health-data consent is withdrawn", async () => {
    const prisma = createEnrollmentPrismaHarness();
    await issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: enrollmentRequest(),
    });
    const now = new Date("2026-07-30T12:00:00.000Z");

    await expect(revokeAllMealPhotoCaptureEnrollmentsForMember({
      memberId: MEMBER_ID,
      now,
      prisma: prisma.client,
    })).resolves.toEqual({ revokedCount: 1 });

    expect(prisma.getRecord()).toMatchObject({
      expiresAt: null,
      idempotencySecretEncrypted: null,
      revokeReason: "health_data_consent_withdrawn",
      revokedAt: now,
      updatedAt: now,
      uploadTokenHash: null,
    });
    expect(mocks.lockHostedMemberRow).toHaveBeenLastCalledWith(
      prisma.tx,
      MEMBER_ID,
    );
  });

  it("does not let deferred withdrawal cleanup revoke a renewed enrollment", async () => {
    const prisma = createEnrollmentPrismaHarness();
    await issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: enrollmentRequest(),
    });
    mocks.readHostedHealthDataConsentState.mockResolvedValueOnce("granted");

    await expect(revokeAllMealPhotoCaptureEnrollmentsForMember({
      memberId: MEMBER_ID,
      prisma: prisma.client,
    })).resolves.toEqual({ revokedCount: 0 });

    expect(prisma.getRecord()).toMatchObject({
      revokeReason: null,
      revokedAt: null,
    });
  });

  it("locks scoped revocation to the enrollment member", async () => {
    const prisma = createEnrollmentPrismaHarness();
    const issued = await issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: enrollmentRequest(),
    });
    vi.clearAllMocks();

    await expect(revokeMealPhotoCaptureEnrollmentForScopedToken({
      prisma: prisma.client,
      token: issued.uploadToken,
    })).resolves.toEqual({ revoked: true });

    expect(mocks.lockHostedMemberRow).toHaveBeenCalledOnce();
    expect(mocks.lockHostedMemberRow).toHaveBeenCalledWith(prisma.tx, MEMBER_ID);
    expect(prisma.getRecord()).toMatchObject({
      expiresAt: null,
      idempotencySecretEncrypted: null,
      revokeReason: "scoped_token_revoked",
      revokedAt: expect.any(Date),
      uploadTokenHash: null,
    });
  });

  it("serializes renewal and member revocation so the completed revoke wins", async () => {
    const prisma = createEnrollmentPrismaHarness();
    await issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: enrollmentRequest(),
    });
    vi.clearAllMocks();

    const renewalReachedUpsert = createDeferred();
    const releaseRenewal = createDeferred();
    const releaseRevocationLock = createDeferred();
    prisma.setBeforeUpsert(async () => {
      renewalReachedUpsert.resolve();
      await releaseRenewal.promise;
      prisma.setBeforeUpsert(null);
    });
    mocks.lockHostedMemberRow.mockImplementation(async () => {
      if (mocks.lockHostedMemberRow.mock.calls.length === 2) {
        await releaseRevocationLock.promise;
      }
    });

    const renewalPromise = issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: enrollmentRequest(),
    });
    await renewalReachedUpsert.promise;
    const revocationPromise = revokeMealPhotoCaptureEnrollmentForMember({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: {
        appInstallationId: INSTALLATION_ID,
        schemaVersion: 1,
      },
    });
    await vi.waitFor(() => {
      expect(mocks.lockHostedMemberRow).toHaveBeenCalledTimes(2);
    });
    expect(prisma.getRecord()?.revokedAt).toBeNull();

    releaseRenewal.resolve();
    const renewed = await renewalPromise;
    releaseRevocationLock.resolve();
    await expect(revocationPromise).resolves.toEqual({ revoked: true });

    expect(prisma.getRecord()).toMatchObject({
      revokeReason: "member_disabled",
      revokedAt: expect.any(Date),
    });
    await expect(requireActiveMealPhotoCaptureEnrollment({
      prisma: prisma.client,
      request: new Request("https://app.example.test/photos", {
        headers: { authorization: `Bearer ${renewed.uploadToken}` },
      }),
    })).rejects.toMatchObject({ code: "AUTH_REQUIRED", httpStatus: 401 });
  });

  it("keeps a delayed schema-v2 prepare inactive when it locks before scoped teardown", async () => {
    const prisma = createEnrollmentPrismaHarness();
    const issued = await issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: enrollmentRequest(),
    });
    vi.clearAllMocks();

    const renewalReachedUpsert = createDeferred();
    const releaseRenewal = createDeferred();
    const releaseRevocationLock = createDeferred();
    prisma.setBeforeUpsert(async () => {
      renewalReachedUpsert.resolve();
      await releaseRenewal.promise;
      prisma.setBeforeUpsert(null);
    });
    mocks.lockHostedMemberRow.mockImplementation(async () => {
      if (mocks.lockHostedMemberRow.mock.calls.length === 2) {
        await releaseRevocationLock.promise;
      }
    });

    const renewalPromise = issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: v2EnrollmentRequest(1),
    });
    await renewalReachedUpsert.promise;
    const revocationPromise = revokeMealPhotoCaptureEnrollmentForScopedToken({
      prisma: prisma.client,
      token: issued.uploadToken,
    });
    await vi.waitFor(() => {
      expect(mocks.lockHostedMemberRow).toHaveBeenCalledTimes(2);
    });
    expect(prisma.getRecord()?.revokedAt).toBeNull();

    releaseRenewal.resolve();
    const renewed = await renewalPromise;
    releaseRevocationLock.resolve();
    await expect(revocationPromise).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      httpStatus: 401,
    });

    expect(prisma.getRecord()).toMatchObject({
      activatedAt: null,
      revokeReason: null,
      revokedAt: null,
    });
    await expect(requireActiveMealPhotoCaptureEnrollment({
      prisma: prisma.client,
      request: new Request("https://app.example.test/photos", {
        headers: { authorization: `Bearer ${renewed.uploadToken}` },
      }),
    })).rejects.toMatchObject({ code: "AUTH_REQUIRED", httpStatus: 401 });
  });

  it("rechecks member access and consent for live scoped uploads", async () => {
    const prisma = createEnrollmentPrismaHarness();
    const issued = await issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      now: new Date("2026-07-12T12:00:00.000Z"),
      prisma: prisma.client,
      request: enrollmentRequest(),
    });
    const request = new Request("https://app.example.test/photos", {
      headers: { authorization: `Bearer ${issued.uploadToken}` },
    });

    await expect(requireActiveMealPhotoCaptureEnrollment({
      now: new Date("2026-07-13T12:00:00.000Z"),
      prisma: prisma.client,
      request,
    })).resolves.toMatchObject({ memberId: MEMBER_ID });
    expect(mocks.assertActiveHostedMemberAccessAllowed).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      prisma: prisma.client,
    });
    expect(mocks.assertHostedHistoricalLaunchConsentGranted).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      prisma: prisma.client,
    });
    expect(mocks.assertHostedLaunchRequiredConsentGranted).not.toHaveBeenCalled();

    mocks.assertActiveHostedMemberAccessAllowed.mockClear();
    prisma.setRecord({
      ...requireStoredEnrollment(prisma.getRecord()),
      expiresAt: new Date("2026-07-13T12:00:00.000Z"),
    });
    await expect(requireActiveMealPhotoCaptureEnrollment({
      now: new Date("2026-07-13T12:00:00.000Z"),
      prisma: prisma.client,
      request,
    })).rejects.toMatchObject({ code: "AUTH_REQUIRED", httpStatus: 401 });
    expect(mocks.assertActiveHostedMemberAccessAllowed).not.toHaveBeenCalled();
  });

  it("rechecks the same enrollment under the member lock before commit", async () => {
    const prisma = createEnrollmentPrismaHarness();
    const issued = await issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: enrollmentRequest(),
    });
    const request = new Request("https://app.example.test/photos", {
      headers: { authorization: `Bearer ${issued.uploadToken}` },
    });
    const enrollment = await requireActiveMealPhotoCaptureEnrollment({
      prisma: prisma.client,
      request,
    });
    vi.clearAllMocks();

    await expect(assertCurrentMealPhotoCaptureEnrollmentTx({
      enrollment,
      prisma: prisma.tx,
      request,
    })).resolves.toBeUndefined();

    expect(mocks.lockHostedMemberRow).toHaveBeenCalledWith(prisma.tx, MEMBER_ID);
    expect(mocks.lockHostedMemberSponsoredAccessRows).toHaveBeenCalledWith(
      prisma.tx,
      MEMBER_ID,
    );
    expect(mocks.lockHostedMemberRow.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.lockHostedMemberSponsoredAccessRows.mock.invocationCallOrder[0] ?? 0);
    expect(mocks.lockHostedMemberSponsoredAccessRows.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.assertActiveHostedMemberAccessAllowed.mock.invocationCallOrder[0] ?? 0);
    expect(mocks.assertActiveHostedMemberAccessAllowed).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      prisma: prisma.tx,
    });
    expect(mocks.assertHostedHistoricalLaunchConsentGranted).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      prisma: prisma.tx,
    });
    expect(mocks.assertHostedLaunchRequiredConsentGranted).not.toHaveBeenCalled();

    prisma.setRecord({
      ...requireStoredEnrollment(prisma.getRecord()),
      revokedAt: new Date(),
    });
    await expect(assertCurrentMealPhotoCaptureEnrollmentTx({
      enrollment,
      prisma: prisma.tx,
      request,
    })).rejects.toMatchObject({ code: "AUTH_REQUIRED", httpStatus: 401 });
  });
});

function enrollmentRequest() {
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

function v2RevocationRequest(authorityRevision: number) {
  return {
    appInstallationId: INSTALLATION_ID,
    authorityRevision,
    schemaVersion: 2 as const,
  };
}

function uploadRequest(uploadToken: string): Request {
  return new Request("https://app.example.test/photos", {
    headers: { authorization: `Bearer ${uploadToken}` },
  });
}

function createEnrollmentPrismaHarness(): {
  client: MealPhotoCapturePrismaForTest;
  getRecord: () => StoredEnrollment | null;
  setBeforeUpsert: (callback: (() => Promise<void>) | null) => void;
  setRecord: (record: StoredEnrollment | null) => void;
  tx: MealPhotoCaptureTransactionForTest;
} {
  let record: StoredEnrollment | null = null;
  let beforeUpsert: (() => Promise<void>) | null = null;
  const delegate = {
    findUnique: vi.fn(async (input: {
      where: {
        id?: string;
        memberId_installationIdHash?: {
          installationIdHash: string;
          memberId: string;
        };
        uploadTokenHash?: string;
      };
    }) => {
      if (!record) {
        return null;
      }
      if (input.where.uploadTokenHash !== undefined) {
        return input.where.uploadTokenHash === record.uploadTokenHash ? { ...record } : null;
      }
      if (input.where.id !== undefined) {
        return input.where.id === record.id ? { ...record } : null;
      }
      const compound = input.where.memberId_installationIdHash;
      return compound
        && compound.memberId === record.memberId
        && compound.installationIdHash === record.installationIdHash
        ? { ...record }
        : null;
    }),
    updateMany: vi.fn(async (input: {
      data: Partial<StoredEnrollment>;
      where: {
        id?: string;
        installationIdHash?: string;
        memberId?: string;
        revokedAt?: null;
        uploadTokenHash?: string;
      };
    }) => {
      if (
        !record
        || (input.where.id !== undefined && input.where.id !== record.id)
        || (input.where.installationIdHash !== undefined
          && input.where.installationIdHash !== record.installationIdHash)
        || (input.where.memberId !== undefined && input.where.memberId !== record.memberId)
        || (input.where.uploadTokenHash !== undefined
          && input.where.uploadTokenHash !== record.uploadTokenHash)
        || (input.where.revokedAt === null && record.revokedAt !== null)
      ) {
        return { count: 0 };
      }
      record = { ...record, ...input.data };
      return { count: 1 };
    }),
    update: vi.fn(async (input: {
      data: Partial<StoredEnrollment>;
      where: { id: string };
    }) => {
      if (!record || input.where.id !== record.id) {
        throw new Error("Missing enrollment update target.");
      }
      record = { ...record, ...input.data };
      return { ...record };
    }),
    upsert: vi.fn(async (input: {
      create: StoredEnrollment;
      update: Partial<StoredEnrollment>;
    }) => {
      if (beforeUpsert) {
        await beforeUpsert();
      }
      record = record ? { ...record, ...input.update } : { ...input.create };
      return { ...record };
    }),
  };
  const tx = { hostedMealPhotoCaptureEnrollment: delegate };
  const client = {
    $transaction: vi.fn(async (
      operation: (transaction: typeof tx) => Promise<unknown>,
    ) => operation(tx)),
    hostedMealPhotoCaptureEnrollment: delegate,
  };

  return {
    client: mealPhotoCapturePrismaClientForTest(client),
    getRecord: () => record,
    setBeforeUpsert: (callback) => {
      beforeUpsert = callback;
    },
    setRecord: (next) => {
      record = next;
    },
    tx: mealPhotoCaptureTransactionForTest(tx),
  };
}

function mealPhotoCaptureTransactionForTest(tx: {
  hostedMealPhotoCaptureEnrollment: object;
}): MealPhotoCaptureTransactionForTest {
  // Narrow test boundary: member locking and the access/consent reads are
  // mocked, so this harness needs only the enrollment delegate.
  const narrowTx = tx as Pick<
    MealPhotoCaptureTransactionForTest,
    "hostedMealPhotoCaptureEnrollment"
  >;
  return narrowTx as MealPhotoCaptureTransactionForTest;
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

function requireStoredEnrollment(record: StoredEnrollment | null): StoredEnrollment {
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
