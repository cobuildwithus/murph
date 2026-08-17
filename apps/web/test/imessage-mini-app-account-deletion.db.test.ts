import { createHash, randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PrismaHostedAgentSessionStore } from "../src/lib/device-sync/prisma-store/agent-sessions";
import {
  IMessageMiniAppService,
  issueIMessageMiniAppEnrollment,
} from "../src/lib/imessage-mini-app/service";
import {
  recordHostedLaunchRequiredConsent,
} from "../src/lib/legal/consent";
import { lockHostedMemberRow } from "../src/lib/hosted-onboarding/shared";
import { createPrismaClient } from "../src/lib/prisma";

vi.mock("server-only", () => ({}));

const TEST_DATABASE_ENV = "MURPH_IMESSAGE_ENROLLMENT_TEST_DB_URL";
const APPLICATION_NAME_RUN_ID = randomUUID().replaceAll("-", "").slice(0, 8);
const testDatabaseUrl = process.env[TEST_DATABASE_ENV]?.trim() || null;

if (testDatabaseUrl && !isClearlyLocalPostgresUrl(testDatabaseUrl)) {
  throw new Error(`${TEST_DATABASE_ENV} must point to a local PostgreSQL database.`);
}

describe.runIf(Boolean(testDatabaseUrl))(
  "iMessage mini-app enrollment/account-deletion serialization",
  defineEnrollmentDeletionSerializationSuite,
);

function defineEnrollmentDeletionSerializationSuite(): void {
  const clients: PrismaClient[] = [];
  let memberId = "";
  let observer: PrismaClient | null = null;

  beforeEach(async () => {
    memberId = `member_imessage_delete_${randomUUID().replaceAll("-", "")}`;
    const setupObserver = createTestPrismaClient("observer");
    observer = setupObserver;

    await setupObserver.hostedMember.create({
      data: {
        billingStatus: "active",
        id: memberId,
      },
    });
    await recordHostedLaunchRequiredConsent({
      memberId,
      prisma: setupObserver,
      scope: "launch.legal",
      source: "imessage-enrollment-concurrency-test",
    });
    await recordHostedLaunchRequiredConsent({
      memberId,
      prisma: setupObserver,
      scope: "launch.health-data",
      source: "imessage-enrollment-concurrency-test",
    });
  });

  afterEach(async () => {
    try {
      if (observer) {
        await observer.deviceAgentSession.deleteMany({ where: { userId: memberId } });
        await observer.hostedMember.deleteMany({ where: { id: memberId } });
      }
    } finally {
      await Promise.all(clients.map(async (client) => await client.$disconnect()));
      clients.length = 0;
      observer = null;
    }
  });

  it("lets deletion win without allowing enrollment to recreate a session", async () => {
    const deletion = createTestPrismaClient("deletion-first");
    const enrollment = createTestPrismaClient("enrollment-waiter");
    const deletionLocked = deferred();
    const continueDeletion = deferred();
    const deletionPromise = deletion.$transaction(async (tx) => {
      await lockHostedMemberRow(tx, memberId);
      deletionLocked.resolve();
      await continueDeletion.promise;
      await deleteMemberAndAgentSessionsTx({ memberId, prisma: tx });
    });

    await Promise.race([deletionLocked.promise, deletionPromise]);
    const enrollmentPromise = issueIMessageMiniAppEnrollment({
      memberId,
      prisma: enrollment,
    });

    try {
      await waitForPostgresLockWait(requireObserver(), applicationName("enrollment-waiter"));
      continueDeletion.resolve();
      await deletionPromise;

      await expect(enrollmentPromise).rejects.toMatchObject({
        code: "HOSTED_ACCESS_REQUIRED",
        httpStatus: 403,
      });
      await expect(readMemberAndSessionCounts(requireObserver(), memberId)).resolves.toEqual({
        members: 0,
        sessions: 0,
      });
    } finally {
      continueDeletion.resolve();
      await Promise.allSettled([deletionPromise, enrollmentPromise]);
    }
  });

  it("lets enrollment commit first, then deletion removes its session", async () => {
    const tableBlocker = createTestPrismaClient("session-table-blocker");
    const enrollment = createTestPrismaClient("enrollment-first");
    const deletion = createTestPrismaClient("deletion-waiter");
    const tableLocked = deferred();
    const releaseTable = deferred();
    const deletionStarted = deferred();
    const deletionLocked = deferred();
    const continueDeletion = deferred();
    let deletionPromise: Promise<void> | null = null;
    const tableBlockerPromise = tableBlocker.$transaction(async (tx) => {
      await tx.$queryRaw`select set_config('lock_timeout', '5000ms', true)`;
      await tx.$executeRaw`LOCK TABLE "device_agent_session" IN ACCESS EXCLUSIVE MODE`;
      tableLocked.resolve();
      await releaseTable.promise;
    });

    await Promise.race([tableLocked.promise, tableBlockerPromise]);
    const enrollmentPromise = issueIMessageMiniAppEnrollment({
      memberId,
      prisma: enrollment,
    });

    try {
      await waitForPostgresLockWait(requireObserver(), applicationName("enrollment-first"));
      deletionPromise = deletion.$transaction(async (tx) => {
        deletionStarted.resolve();
        await lockHostedMemberRow(tx, memberId);
        deletionLocked.resolve();
        await continueDeletion.promise;
        await deleteMemberAndAgentSessionsTx({ memberId, prisma: tx });
      });

      await Promise.race([deletionStarted.promise, deletionPromise]);
      await waitForPostgresLockWait(requireObserver(), applicationName("deletion-waiter"));
      releaseTable.resolve();
      await tableBlockerPromise;
      await expect(enrollmentPromise).resolves.toMatchObject({
        credential: {
          token: expect.stringMatching(/^hbds_imessage_/u),
        },
        schemaVersion: 1,
      });
      await Promise.race([deletionLocked.promise, deletionPromise]);
      await expect(readMemberAndSessionCounts(requireObserver(), memberId)).resolves.toEqual({
        members: 1,
        sessions: 1,
      });

      continueDeletion.resolve();
      await deletionPromise;
      await expect(readMemberAndSessionCounts(requireObserver(), memberId)).resolves.toEqual({
        members: 0,
        sessions: 0,
      });
    } finally {
      releaseTable.resolve();
      continueDeletion.resolve();
      await Promise.allSettled([tableBlockerPromise, enrollmentPromise]);
      if (deletionPromise) {
        await Promise.allSettled([deletionPromise]);
      }
    }
  });

  it("rotates one Messages-owned row without changing ordinary device-agent sessions", async () => {
    const prisma = requireObserver();
    const ordinaryCreatedAt = new Date("2026-07-14T00:00:00.000Z");
    const ordinarySession = await prisma.deviceAgentSession.create({
      data: {
        id: `dsa_ordinary_${randomUUID().replaceAll("-", "")}`,
        userId: memberId,
        label: "Ordinary device agent",
        tokenHash: createHash("sha256")
          .update(`ordinary-device-agent\0${randomUUID()}`)
          .digest("hex"),
        createdAt: ordinaryCreatedAt,
        updatedAt: ordinaryCreatedAt,
        expiresAt: new Date("2026-07-15T00:00:00.000Z"),
        lastSeenAt: ordinaryCreatedAt,
      },
    });
    const expectedMessagesSessionId = `dsa_imessage_${createHash("sha256")
      .update(`murph:imessage-mini-app:session:v1\0${memberId}`)
      .digest("hex")}`;

    const first = await issueIMessageMiniAppEnrollment({ memberId, prisma });
    const firstCredentialService = createMessagesCredentialService(
      prisma,
      first.credential.token,
    );
    const firstAuthenticatedSession = await firstCredentialService.requireCredential();
    const firstMessagesSession = await prisma.deviceAgentSession.findUniqueOrThrow({
      where: { id: expectedMessagesSessionId },
    });
    expect(await prisma.deviceAgentSession.count({ where: { userId: memberId } })).toBe(2);

    const second = await issueIMessageMiniAppEnrollment({ memberId, prisma });
    const secondMessagesSession = await prisma.deviceAgentSession.findUniqueOrThrow({
      where: { id: expectedMessagesSessionId },
    });

    expect(second.credential.token).not.toBe(first.credential.token);
    expect(secondMessagesSession.tokenHash).not.toBe(firstMessagesSession.tokenHash);
    expect(await prisma.deviceAgentSession.count({ where: { userId: memberId } })).toBe(2);
    await expect(prisma.deviceAgentSession.findUniqueOrThrow({
      where: { id: ordinarySession.id },
    })).resolves.toEqual(ordinarySession);
    await expect(
      createMessagesCredentialService(prisma, first.credential.token).requireCredential(),
    ).rejects.toMatchObject({ code: "IMESSAGE_MINI_APP_AUTH_INVALID" });
    await expect(
      firstCredentialService.revoke(firstAuthenticatedSession),
    ).rejects.toMatchObject({ code: "IMESSAGE_MINI_APP_AUTH_INVALID" });

    const secondCredentialService = createMessagesCredentialService(
      prisma,
      second.credential.token,
    );
    const secondAuthenticatedSession = await secondCredentialService.requireCredential();
    await expect(secondCredentialService.revoke(secondAuthenticatedSession)).resolves.toEqual({
      schemaVersion: 1,
      revoked: true,
    });

    const third = await issueIMessageMiniAppEnrollment({ memberId, prisma });
    const thirdMessagesSession = await prisma.deviceAgentSession.findUniqueOrThrow({
      where: { id: expectedMessagesSessionId },
    });
    expect(thirdMessagesSession).toMatchObject({
      revokedAt: null,
      revokeReason: null,
      replacedBySessionId: null,
    });
    expect(await prisma.deviceAgentSession.count({ where: { userId: memberId } })).toBe(2);
    await expect(
      createMessagesCredentialService(prisma, second.credential.token).requireCredential(),
    ).rejects.toMatchObject({ code: "IMESSAGE_MINI_APP_AUTH_INVALID" });
    await expect(
      createMessagesCredentialService(prisma, third.credential.token).requireCredential(),
    ).resolves.toMatchObject({ id: expectedMessagesSessionId });

    await prisma.deviceAgentSession.update({
      where: { id: expectedMessagesSessionId },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    await expect(
      createMessagesCredentialService(prisma, third.credential.token).requireCredential(),
    ).rejects.toMatchObject({ code: "IMESSAGE_MINI_APP_AUTH_EXPIRED" });

    const fourth = await issueIMessageMiniAppEnrollment({ memberId, prisma });
    const fourthMessagesSession = await prisma.deviceAgentSession.findUniqueOrThrow({
      where: { id: expectedMessagesSessionId },
    });
    expect(fourthMessagesSession).toMatchObject({
      revokedAt: null,
      revokeReason: null,
      replacedBySessionId: null,
    });
    expect(await prisma.deviceAgentSession.count({ where: { userId: memberId } })).toBe(2);
    await expect(
      createMessagesCredentialService(prisma, third.credential.token).requireCredential(),
    ).rejects.toMatchObject({ code: "IMESSAGE_MINI_APP_AUTH_INVALID" });
    await expect(
      createMessagesCredentialService(prisma, fourth.credential.token).requireCredential(),
    ).resolves.toMatchObject({ id: expectedMessagesSessionId });
    await expect(prisma.deviceAgentSession.findUniqueOrThrow({
      where: { id: ordinarySession.id },
    })).resolves.toEqual(ordinarySession);
  });

  function createTestPrismaClient(role: string): PrismaClient {
    const databaseUrl = new URL(requireTestDatabaseUrl());
    databaseUrl.searchParams.set("application_name", applicationName(role));
    const client = createPrismaClient({
      databaseUrl: databaseUrl.toString(),
      poolMax: 1,
    });
    clients.push(client);
    return client;
  }

  function requireObserver(): PrismaClient {
    if (!observer) {
      throw new Error("The Postgres test observer is not initialized.");
    }
    return observer;
  }
}

function createMessagesCredentialService(
  prisma: PrismaClient,
  token: string,
): IMessageMiniAppService {
  return new IMessageMiniAppService({
    request: new Request(
      "https://example.test/api/device-sync/companion/imessage-mini-app/member-actions",
      { headers: { authorization: `Bearer ${token}` } },
    ),
    store: new PrismaHostedAgentSessionStore(prisma),
  });
}

async function deleteMemberAndAgentSessionsTx(input: {
  memberId: string;
  prisma: Prisma.TransactionClient;
}): Promise<void> {
  await input.prisma.deviceAgentSession.deleteMany({
    where: { userId: input.memberId },
  });
  await input.prisma.hostedMember.deleteMany({
    where: { id: input.memberId },
  });
}

async function readMemberAndSessionCounts(
  prisma: PrismaClient,
  memberId: string,
): Promise<{ members: number; sessions: number }> {
  const [members, sessions] = await Promise.all([
    prisma.hostedMember.count({ where: { id: memberId } }),
    prisma.deviceAgentSession.count({ where: { userId: memberId } }),
  ]);
  return { members, sessions };
}

async function waitForPostgresLockWait(
  prisma: PrismaClient,
  targetApplicationName: string,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<Array<{ waiting: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM pg_stat_activity
        WHERE application_name = ${targetApplicationName}
          AND wait_event_type = 'Lock'
      ) AS waiting
    `;
    if (rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${targetApplicationName} to block on a Postgres lock.`);
}

function requireTestDatabaseUrl(): string {
  if (!testDatabaseUrl) {
    throw new Error(`${TEST_DATABASE_ENV} is required for this Postgres concurrency test.`);
  }
  return testDatabaseUrl;
}

function isClearlyLocalPostgresUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    return false;
  }

  const hostOverrides = parsed.searchParams.getAll("host");
  if (hostOverrides.length > 1) {
    return false;
  }
  const effectiveHost = (hostOverrides[0] || parsed.hostname).toLowerCase();
  return ["127.0.0.1", "::1", "[::1]", "localhost"].includes(effectiveHost)
    || effectiveHost.startsWith("/");
}

function applicationName(role: string): string {
  return `pr547-${role}-${APPLICATION_NAME_RUN_ID}`;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}
