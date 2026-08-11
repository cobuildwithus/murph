import { createHash, randomUUID } from "node:crypto";

import {
  HostedBillingStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  activateMealPhotoCaptureEnrollmentForScopedToken,
} from "@/src/lib/device-sync/meal-photo-capture";
import {
  removeHostedFamilyMemberTx,
  writeHostedAccountGroupStripeBillingTx,
} from "@/src/lib/hosted-onboarding/family-plan";
import { lockHostedMemberRow } from "@/src/lib/hosted-onboarding/shared";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const transactionOptions = {
  maxWait: 10_000,
  timeout: 20_000,
} as const;

if (
  runPostgresProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The meal-photo access concurrency proof requires a local DATABASE_URL.",
  );
}

type AccessLossKind = "group_billing" | "member_removal";
type MemberLossKind = "consent_withdrawal" | "direct_access" | "scoped_deletion";

describe.skipIf(!runPostgresProof)(
  "meal-photo activation PostgreSQL access ordering",
  () => {
    it.each([
      { accessLoss: "member_removal" as const, ordering: "access_loss_first" as const },
      { accessLoss: "member_removal" as const, ordering: "activation_first" as const },
      { accessLoss: "group_billing" as const, ordering: "access_loss_first" as const },
      { accessLoss: "group_billing" as const, ordering: "activation_first" as const },
    ])(
      "serializes $ordering against $accessLoss and rejects replay after loss",
      async ({ accessLoss, ordering }) => {
        const fixture = await createFixture();

        try {
          if (ordering === "access_loss_first") {
            await proveAccessLossFirst({ accessLoss, fixture });
          } else {
            await proveActivationFirst({ accessLoss, fixture });
          }

          await expect(
            activateMealPhotoCaptureEnrollmentForScopedToken({
              prisma: fixture.activation,
              token: fixture.token,
            }),
          ).rejects.toMatchObject({
            code: "HOSTED_ACCESS_REQUIRED",
            httpStatus: 403,
          });
          await expectAccessLossPersisted({ accessLoss, fixture });
        } finally {
          await cleanupFixture(fixture);
        }
      },
    );

    it.each([
      "consent_withdrawal",
      "direct_access",
      "scoped_deletion",
    ] as const)(
      "rejects activation and replay after committed %s wins the member lock",
      async (memberLoss) => {
        const fixture = await createFixture();
        const lossApplied = createDeferred();
        const allowLossCommit = createDeferred();
        let lossTransaction: Promise<void> | null = null;
        let activationOutcome: Promise<Outcome<{ activated: true }>> | null = null;

        try {
          if (memberLoss === "direct_access") {
            await fixture.observer.hostedAccountGroup.update({
              data: { billingStatus: HostedBillingStatus.canceled },
              where: { id: fixture.groupId },
            });
            await fixture.observer.hostedMember.update({
              data: { billingStatus: HostedBillingStatus.active },
              where: { id: fixture.beneficiaryMemberId },
            });
          }

          lossTransaction = fixture.loss.$transaction(async (tx) => {
            await lockHostedMemberRow(tx, fixture.beneficiaryMemberId);
            await applyMemberLoss({ fixture, memberLoss, tx });
            lossApplied.resolve();
            await allowLossCommit.promise;
          }, transactionOptions);
          await Promise.race([lossApplied.promise, lossTransaction]);

          const activationPid = await readBackendPid(fixture.activation);
          activationOutcome = captureOutcome(
            activateMealPhotoCaptureEnrollmentForScopedToken({
              prisma: fixture.activation,
              token: fixture.token,
            }),
          );
          await waitForBlockedBackend({
            observer: fixture.observer,
            pid: activationPid,
          });

          allowLossCommit.resolve();
          await expect(lossTransaction).resolves.toBeUndefined();
          expectAuthorityLoss(
            await activationOutcome,
            expectedAuthorityLossCode(memberLoss),
          );
          await expect(
            activateMealPhotoCaptureEnrollmentForScopedToken({
              prisma: fixture.activation,
              token: fixture.token,
            }),
          ).rejects.toMatchObject({
            code: expectedAuthorityLossCode(memberLoss),
          });
          await expectMemberLossPersisted({ fixture, memberLoss });
        } finally {
          allowLossCommit.resolve();
          await Promise.allSettled([
            ...(lossTransaction ? [lossTransaction] : []),
            ...(activationOutcome ? [activationOutcome] : []),
          ]);
          await cleanupFixture(fixture);
        }
      },
    );
  },
);

type Fixture = {
  activation: PrismaClient;
  beneficiaryMemberId: string;
  enrollmentId: string;
  groupId: string;
  holder: PrismaClient;
  loss: PrismaClient;
  membershipId: string;
  observer: PrismaClient;
  ownerMemberId: string;
  token: string;
};

async function createFixture(): Promise<Fixture> {
  const activation = createPrismaClient({ databaseUrl, poolMax: 1 });
  const holder = createPrismaClient({ databaseUrl, poolMax: 1 });
  const loss = createPrismaClient({ databaseUrl, poolMax: 1 });
  const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
  const suffix = randomUUID().replaceAll("-", "");
  const beneficiaryMemberId = `hbm_meal_access_${suffix}`;
  const ownerMemberId = `hbm_meal_owner_${suffix}`;
  const groupId = `hbag_meal_access_${suffix}`;
  const membershipId = `hbagm_meal_access_${suffix}`;
  const enrollmentId = `hmp_meal_access_${suffix}`;
  const token = `murph_meal_photo_${createHash("sha256")
    .update(`meal-access-token:${suffix}`)
    .digest("base64url")}`;
  const now = new Date();

  await observer.hostedMember.createMany({
    data: [
      {
        billingStatus: HostedBillingStatus.not_started,
        id: beneficiaryMemberId,
      },
      {
        billingStatus: HostedBillingStatus.active,
        id: ownerMemberId,
      },
    ],
  });
  await observer.hostedAccountGroup.create({
    data: {
      billingStatus: HostedBillingStatus.active,
      id: groupId,
      ownerMemberId,
    },
  });
  await observer.hostedAccountGroupMembership.create({
    data: {
      groupId,
      id: membershipId,
      joinedAt: now,
      memberId: beneficiaryMemberId,
      role: "member",
      status: "active",
    },
  });
  await observer.hostedConsentGrant.createMany({
    data: ["launch.legal", "launch.health-data"].map((scope) => ({
      createdAt: now,
      documentVersionsJson: {},
      grantedAt: now,
      memberId: beneficiaryMemberId,
      scope,
      source: "meal-access-postgres-test",
      status: "granted",
      updatedAt: now,
    })),
  });
  await observer.hostedMealPhotoCaptureEnrollment.create({
    data: {
      activatedAt: null,
      authorityRevision: 1,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000),
      id: enrollmentId,
      idempotencySecretEncrypted: "test-encrypted-secret",
      installationIdHash: createHash("sha256")
        .update(`meal-access-installation:${suffix}`)
        .digest("hex"),
      memberId: beneficiaryMemberId,
      updatedAt: now,
      uploadTokenHash: createHash("sha256").update(token).digest("hex"),
    },
  });

  return {
    activation,
    beneficiaryMemberId,
    enrollmentId,
    groupId,
    holder,
    loss,
    membershipId,
    observer,
    ownerMemberId,
    token,
  };
}

async function proveAccessLossFirst(input: {
  accessLoss: AccessLossKind;
  fixture: Fixture;
}): Promise<void> {
  const lossApplied = createDeferred();
  const allowLossCommit = createDeferred();
  let lossTransaction: Promise<boolean> | null = null;
  let activationOutcome: Promise<Outcome<{ activated: true }>> | null = null;

  try {
    lossTransaction = input.fixture.loss.$transaction(async (tx) => {
      const changed = await applyAccessLoss({
        accessLoss: input.accessLoss,
        fixture: input.fixture,
        tx,
      });
      lossApplied.resolve();
      await allowLossCommit.promise;
      return changed;
    }, transactionOptions);
    await Promise.race([lossApplied.promise, lossTransaction]);

    const activationPid = await readBackendPid(input.fixture.activation);
    activationOutcome = captureOutcome(
      activateMealPhotoCaptureEnrollmentForScopedToken({
        prisma: input.fixture.activation,
        token: input.fixture.token,
      }),
    );
    await waitForBlockedBackend({
      observer: input.fixture.observer,
      pid: activationPid,
    });

    allowLossCommit.resolve();
    await expect(lossTransaction).resolves.toBe(true);
    expectAccessRequired(await activationOutcome);
    await expect(input.fixture.observer.hostedMealPhotoCaptureEnrollment.findUniqueOrThrow({
      select: { activatedAt: true },
      where: { id: input.fixture.enrollmentId },
    })).resolves.toEqual({ activatedAt: null });
  } finally {
    allowLossCommit.resolve();
    await Promise.allSettled([
      ...(lossTransaction ? [lossTransaction] : []),
      ...(activationOutcome ? [activationOutcome] : []),
    ]);
  }
}

async function proveActivationFirst(input: {
  accessLoss: AccessLossKind;
  fixture: Fixture;
}): Promise<void> {
  const enrollmentLocked = createDeferred();
  const releaseEnrollment = createDeferred();
  let holderTransaction: Promise<void> | null = null;
  let activationOutcome: Promise<Outcome<{ activated: true }>> | null = null;
  let lossOutcome: Promise<Outcome<boolean>> | null = null;

  try {
    holderTransaction = input.fixture.holder.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT 1
        FROM "hosted_meal_photo_capture_enrollment"
        WHERE "id" = ${input.fixture.enrollmentId}
        FOR UPDATE
      `;
      enrollmentLocked.resolve();
      await releaseEnrollment.promise;
    }, transactionOptions);
    await Promise.race([enrollmentLocked.promise, holderTransaction]);

    const activationPid = await readBackendPid(input.fixture.activation);
    activationOutcome = captureOutcome(
      activateMealPhotoCaptureEnrollmentForScopedToken({
        prisma: input.fixture.activation,
        token: input.fixture.token,
      }),
    );
    await waitForBlockedBackend({
      observer: input.fixture.observer,
      pid: activationPid,
    });

    const lossPid = await readBackendPid(input.fixture.loss);
    lossOutcome = captureOutcome(
      input.fixture.loss.$transaction((tx) => applyAccessLoss({
        accessLoss: input.accessLoss,
        fixture: input.fixture,
        tx,
      }), transactionOptions),
    );
    await waitForBlockedBackend({
      observer: input.fixture.observer,
      pid: lossPid,
    });

    releaseEnrollment.resolve();
    await holderTransaction;
    expect(await activationOutcome).toEqual({
      status: "fulfilled",
      value: { activated: true },
    });
    expect(await lossOutcome).toEqual({ status: "fulfilled", value: true });
    await expect(input.fixture.observer.hostedMealPhotoCaptureEnrollment.findUniqueOrThrow({
      select: { activatedAt: true },
      where: { id: input.fixture.enrollmentId },
    })).resolves.toEqual({ activatedAt: expect.any(Date) });
  } finally {
    releaseEnrollment.resolve();
    await Promise.allSettled([
      ...(holderTransaction ? [holderTransaction] : []),
      ...(activationOutcome ? [activationOutcome] : []),
      ...(lossOutcome ? [lossOutcome] : []),
    ]);
  }
}

async function applyAccessLoss(input: {
  accessLoss: AccessLossKind;
  fixture: Fixture;
  tx: Prisma.TransactionClient;
}): Promise<boolean> {
  if (input.accessLoss === "member_removal") {
    return removeHostedFamilyMemberTx({
      groupId: input.fixture.groupId,
      memberId: input.fixture.beneficiaryMemberId,
      ownerMemberId: input.fixture.ownerMemberId,
      tx: input.tx,
    });
  }

  const snapshot = await writeHostedAccountGroupStripeBillingTx({
    billingStatus: HostedBillingStatus.canceled,
    groupId: input.fixture.groupId,
    tx: input.tx,
  });
  return snapshot !== null;
}

async function applyMemberLoss(input: {
  fixture: Fixture;
  memberLoss: MemberLossKind;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  if (input.memberLoss === "consent_withdrawal") {
    await input.tx.hostedConsentGrant.update({
      data: {
        revokedAt: new Date(),
        status: "revoked",
      },
      where: {
        memberId_scope: {
          memberId: input.fixture.beneficiaryMemberId,
          scope: "launch.health-data",
        },
      },
    });
    return;
  }
  if (input.memberLoss === "direct_access") {
    await input.tx.hostedMember.update({
      data: { billingStatus: HostedBillingStatus.canceled },
      where: { id: input.fixture.beneficiaryMemberId },
    });
    return;
  }
  await input.tx.hostedMealPhotoCaptureEnrollment.update({
    data: {
      activatedAt: null,
      expiresAt: null,
      idempotencySecretEncrypted: null,
      revokeReason: "scoped_token_revoked",
      revokedAt: new Date(),
      uploadTokenHash: null,
    },
    where: { id: input.fixture.enrollmentId },
  });
}

async function expectAccessLossPersisted(input: {
  accessLoss: AccessLossKind;
  fixture: Fixture;
}): Promise<void> {
  if (input.accessLoss === "member_removal") {
    await expect(input.fixture.observer.hostedAccountGroupMembership.findUniqueOrThrow({
      select: { status: true },
      where: { id: input.fixture.membershipId },
    })).resolves.toEqual({ status: "removed" });
    return;
  }

  await expect(input.fixture.observer.hostedAccountGroup.findUniqueOrThrow({
    select: { billingStatus: true },
    where: { id: input.fixture.groupId },
  })).resolves.toEqual({ billingStatus: HostedBillingStatus.canceled });
}

async function expectMemberLossPersisted(input: {
  fixture: Fixture;
  memberLoss: MemberLossKind;
}): Promise<void> {
  if (input.memberLoss === "consent_withdrawal") {
    await expect(input.fixture.observer.hostedConsentGrant.findUniqueOrThrow({
      select: { status: true },
      where: {
        memberId_scope: {
          memberId: input.fixture.beneficiaryMemberId,
          scope: "launch.health-data",
        },
      },
    })).resolves.toEqual({ status: "revoked" });
    return;
  }
  if (input.memberLoss === "direct_access") {
    await expect(input.fixture.observer.hostedMember.findUniqueOrThrow({
      select: { billingStatus: true },
      where: { id: input.fixture.beneficiaryMemberId },
    })).resolves.toEqual({ billingStatus: HostedBillingStatus.canceled });
    return;
  }
  await expect(input.fixture.observer.hostedMealPhotoCaptureEnrollment.findUniqueOrThrow({
    select: { revokedAt: true, uploadTokenHash: true },
    where: { id: input.fixture.enrollmentId },
  })).resolves.toEqual({
    revokedAt: expect.any(Date),
    uploadTokenHash: null,
  });
}

async function cleanupFixture(fixture: Fixture): Promise<void> {
  try {
    await fixture.observer.hostedAccountGroup.deleteMany({
      where: { id: fixture.groupId },
    });
    await fixture.observer.hostedMember.deleteMany({
      where: {
        id: { in: [fixture.beneficiaryMemberId, fixture.ownerMemberId] },
      },
    });
  } finally {
    await Promise.all([
      fixture.activation.$disconnect(),
      fixture.holder.$disconnect(),
      fixture.loss.$disconnect(),
      fixture.observer.$disconnect(),
    ]);
  }
}

type Deferred = {
  promise: Promise<void>;
  resolve(): void;
};

function createDeferred(): Deferred {
  let resolvePromise: (() => void) | null = null;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve() {
      if (!resolvePromise) {
        throw new Error("Deferred promise is not initialized.");
      }
      resolvePromise();
    },
  };
}

type Outcome<T> =
  | { status: "fulfilled"; value: T }
  | { error: unknown; status: "rejected" };

function captureOutcome<T>(promise: Promise<T>): Promise<Outcome<T>> {
  return promise.then(
    (value) => ({ status: "fulfilled", value }),
    (error: unknown) => ({ error, status: "rejected" }),
  );
}

function expectAccessRequired(outcome: Outcome<unknown>): void {
  expect(outcome.status).toBe("rejected");
  if (outcome.status === "rejected") {
    expect(outcome.error).toMatchObject({
      code: "HOSTED_ACCESS_REQUIRED",
      httpStatus: 403,
    });
  }
}

function expectAuthorityLoss(outcome: Outcome<unknown>, code: string): void {
  expect(outcome.status).toBe("rejected");
  if (outcome.status === "rejected") {
    expect(outcome.error).toMatchObject({ code });
  }
}

function expectedAuthorityLossCode(memberLoss: MemberLossKind): string {
  if (memberLoss === "consent_withdrawal") {
    return "HOSTED_CONSENT_REQUIRED";
  }
  if (memberLoss === "direct_access") {
    return "HOSTED_ACCESS_REQUIRED";
  }
  return "AUTH_REQUIRED";
}

async function readBackendPid(prisma: PrismaClient): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ pid: number }>>`
    SELECT pg_backend_pid() AS pid
  `;
  const pid = rows[0]?.pid;
  if (typeof pid !== "number") {
    throw new Error("Expected a PostgreSQL backend pid.");
  }
  return pid;
}

async function waitForBlockedBackend(input: {
  observer: PrismaClient;
  pid: number;
}): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const rows = await input.observer.$queryRaw<Array<{ blocked: boolean }>>`
      SELECT cardinality(pg_blocking_pids(${input.pid})) > 0 AS blocked
    `;
    if (rows[0]?.blocked === true) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Expected the meal-photo authority operation to wait on a row lock.");
}

function isClearlyLocalPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["postgres:", "postgresql:"].includes(url.protocol)
      && ["127.0.0.1", "localhost", "::1", "[::1]"].includes(
        url.hostname.toLowerCase(),
      );
  } catch {
    return false;
  }
}
