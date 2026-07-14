import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertCurrentMealPhotoCaptureEnrollmentTx,
  issueMealPhotoCaptureEnrollment,
  requireActiveMealPhotoCaptureEnrollment,
  revokeMealPhotoCaptureEnrollmentForMember,
  revokeMealPhotoCaptureEnrollmentForScopedToken,
} from "../src/lib/device-sync/meal-photo-capture";

const mocks = vi.hoisted(() => ({
  assertActiveHostedMemberAccessAllowed: vi.fn(),
  assertHostedLaunchRequiredConsentGranted: vi.fn(),
  lockHostedMemberRow: vi.fn(),
  lockHostedMemberSponsoredAccessRows: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  assertActiveHostedMemberAccessAllowed: mocks.assertActiveHostedMemberAccessAllowed,
}));

vi.mock("@/src/lib/legal/consent", () => ({
  assertHostedLaunchRequiredConsentGranted: mocks.assertHostedLaunchRequiredConsentGranted,
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

const MEMBER_ID = "member_1";
const INSTALLATION_ID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
const INSTALLATION_HASH = sha256(INSTALLATION_ID);

type MealPhotoCapturePrismaForTest =
  Parameters<typeof issueMealPhotoCaptureEnrollment>[0]["prisma"];
type MealPhotoCaptureTransactionForTest =
  Parameters<typeof assertCurrentMealPhotoCaptureEnrollmentTx>[0]["prisma"];

interface StoredEnrollment {
  createdAt: Date;
  expiresAt: Date;
  id: string;
  idempotencySecretEncrypted: string;
  installationIdHash: string;
  memberId: string;
  revokeReason: string | null;
  revokedAt: Date | null;
  updatedAt: Date;
  uploadTokenHash: string;
}

describe("meal photo capture enrollment credentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertActiveHostedMemberAccessAllowed.mockResolvedValue(undefined);
    mocks.assertHostedLaunchRequiredConsentGranted.mockResolvedValue(undefined);
    mocks.lockHostedMemberRow.mockResolvedValue(undefined);
    mocks.lockHostedMemberSponsoredAccessRows.mockResolvedValue(undefined);
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

    const second = await issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      prisma: prisma.client,
      request: enrollmentRequest(),
    });
    expect(second.uploadToken).not.toBe(first.uploadToken);
    expect(second.idempotencySecret).not.toBe(first.idempotencySecret);
    expect(prisma.getRecord()).toMatchObject({ revokedAt: null, revokeReason: null });
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
      revokeReason: "scoped_token_revoked",
      revokedAt: expect.any(Date),
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

  it("serializes renewal and scoped revocation so token rotation cannot outrun revoke", async () => {
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
      request: enrollmentRequest(),
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
    await expect(revocationPromise).resolves.toEqual({ revoked: true });

    expect(prisma.getRecord()).toMatchObject({
      revokeReason: "scoped_token_revoked",
      revokedAt: expect.any(Date),
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
    expect(mocks.assertHostedLaunchRequiredConsentGranted).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      prisma: prisma.client,
    });

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
    expect(mocks.assertHostedLaunchRequiredConsentGranted).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      prisma: prisma.tx,
    });

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
