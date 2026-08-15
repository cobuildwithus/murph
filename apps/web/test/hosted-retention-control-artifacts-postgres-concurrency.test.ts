import { createHash, randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const clinicalMocks = vi.hoisted(() => ({
  assertHostedLaunchRequiredConsentGranted: vi.fn(),
  getPrisma: vi.fn(),
  requireActiveHostedAppSessionFromRequest: vi.fn(),
}));

vi.mock("@/src/lib/prisma", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/src/lib/prisma")>(),
  getPrisma: clinicalMocks.getPrisma,
}));
vi.mock("@/src/lib/hosted-onboarding/app-session", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/src/lib/hosted-onboarding/app-session")>(),
  requireActiveHostedAppSessionFromRequest:
    clinicalMocks.requireActiveHostedAppSessionFromRequest,
}));
vi.mock("@/src/lib/legal/consent", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/src/lib/legal/consent")>(),
  assertHostedLaunchRequiredConsentGranted:
    clinicalMocks.assertHostedLaunchRequiredConsentGranted,
}));

import { HOSTED_CONNECTED_APP_STARTED_INTENT_OWNER_GRACE_MS } from "@/src/lib/connected-apps/connect-intent-ownership";
import { completeHostedConnectedAppConnection } from "@/src/lib/connected-apps/service";
import { finishClinicalRecordAuthorization } from "@/src/lib/clinical-records/control-plane";
import { normalizeSmartStateHash } from "@/src/lib/clinical-records/smart";
import { PrismaHostedOAuthSessionStore } from "@/src/lib/device-sync/prisma-store/oauth-sessions";
import { createPrismaClient } from "@/src/lib/prisma";
import {
  compactOldLinqProviderEventDiagnostics,
  deleteExpiredClinicalRecordOauthSessions,
  deleteExpiredConnectedAppConnectIntents,
  deleteExpiredDeviceOauthSessions,
  retireExpiredMailboxContent,
} from "@/src/lib/hosted-retention/cleanup";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (
  runPostgresProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The hosted retention concurrency proof requires a local DATABASE_URL.",
  );
}

describe.skipIf(!runPostgresProof)(
  "hosted retention concurrency",
  () => {
    let cleanupClient: PrismaClient | null = null;
    let consumeClient: PrismaClient | null = null;
    let lockClient: PrismaClient | null = null;

    beforeAll(() => {
      cleanupClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      consumeClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      lockClient = createPrismaClient({ databaseUrl, poolMax: 1 });
    });

    beforeEach(() => {
      vi.clearAllMocks();
      clinicalMocks.getPrisma.mockImplementation(() => requirePrisma(consumeClient));
      clinicalMocks.requireActiveHostedAppSessionFromRequest.mockResolvedValue({
        member: { id: "retention-clinical-member" },
        sessionId: "retention-clinical-session",
      });
      clinicalMocks.assertHostedLaunchRequiredConsentGranted.mockResolvedValue(undefined);
      vi.stubEnv("COMPOSIO_API_KEY", "retention-proof-key");
      vi.stubEnv("COMPOSIO_BASE_URL", "https://backend.composio.test");
      vi.stubEnv("COMPOSIO_CONNECTED_APP_TOOLKITS", "gmail");
      vi.stubEnv("COMPOSIO_MAX_ACCOUNTS_PER_TOOLKIT", "5");
    });

    afterAll(async () => {
      vi.unstubAllEnvs();
      await Promise.all([
        cleanupClient?.$disconnect(),
        consumeClient?.$disconnect(),
        lockClient?.$disconnect(),
      ]);
    });

    it("skips a concurrently locked expired row and retires other eligible work", async () => {
      const cleanup = requirePrisma(cleanupClient);
      const locker = requirePrisma(lockClient);
      const suffix = randomUUID();
      const lockedState = `retention-locked-${suffix}`;
      const freeState = `retention-free-${suffix}`;
      const now = new Date("2026-08-11T12:00:00.000Z");
      const expiredAt = new Date("2026-08-11T11:00:00.000Z");
      let releaseLock = (): void => undefined;
      const lockGate = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });
      let markLocked = (): void => undefined;
      const locked = new Promise<void>((resolve) => {
        markLocked = resolve;
      });

      await cleanup.deviceOauthSession.createMany({
        data: [lockedState, freeState].map((state) => ({
          createdAt: expiredAt,
          expiresAt: expiredAt,
          provider: "retention-proof",
          state,
        })),
      });

      const holder = locker.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT "state"
          FROM "device_oauth_session"
          WHERE "state" = ${lockedState}
          FOR UPDATE
        `;
        markLocked();
        await lockGate;
      });

      try {
        await locked;
        await cleanup.$executeRawUnsafe("SET statement_timeout = '1s'");
        await expect(deleteExpiredDeviceOauthSessions({
          now,
          prisma: cleanup,
        })).resolves.toBe(1);
        await expect(cleanup.deviceOauthSession.findMany({
          orderBy: { state: "asc" },
          select: { state: true },
          where: { state: { in: [lockedState, freeState] } },
        })).resolves.toEqual([{ state: lockedState }]);

        releaseLock();
        await holder;
        await expect(deleteExpiredDeviceOauthSessions({
          now,
          prisma: cleanup,
        })).resolves.toBe(1);
      } finally {
        releaseLock();
        await holder.catch(() => undefined);
        await cleanup.$executeRawUnsafe("RESET statement_timeout")
          .catch(() => undefined);
        await cleanup.deviceOauthSession.deleteMany({
          where: { state: { in: [lockedState, freeState] } },
        });
      }
    });

    it("keeps an actual OAuth consumer authoritative over concurrent retention", async () => {
      const cleanup = requirePrisma(cleanupClient);
      const consumer = requirePrisma(consumeClient);
      const locker = requirePrisma(lockClient);
      const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
      const functionName = `rt_oauth_gate_fn_${suffix}`;
      const triggerName = `rt_oauth_gate_tr_${suffix}`;
      const state = `retention-consume-${suffix}`;
      const keyMaterial = randomUUID().replaceAll("-", "");
      const advisoryKeyA = toPostgresInt32(keyMaterial.slice(0, 8));
      const advisoryKeyB = toPostgresInt32(keyMaterial.slice(8, 16));
      const callbackNow = new Date("2026-08-11T11:59:59.000Z");
      const expiresAt = new Date("2026-08-11T12:00:00.000Z");
      const retentionNow = new Date("2026-08-11T12:00:01.000Z");
      let releaseGate = (): void => undefined;
      const gate = new Promise<void>((resolve) => {
        releaseGate = resolve;
      });
      let markGateHeld = (): void => undefined;
      const gateHeld = new Promise<void>((resolve) => {
        markGateHeld = resolve;
      });
      let consume: ReturnType<PrismaHostedOAuthSessionStore["consumeOAuthState"]>
        | null = null;

      let holder: Promise<void> | null = null;
      try {
        await cleanup.$executeRawUnsafe(`
          CREATE FUNCTION "${functionName}"()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $function$
          BEGIN
            IF current_setting('murph.retention_oauth_consume_gate', true) = '${suffix}' THEN
              PERFORM pg_advisory_xact_lock(${advisoryKeyA}, ${advisoryKeyB});
            END IF;
            RETURN NULL;
          END;
          $function$
        `);
        await cleanup.$executeRawUnsafe(`
          CREATE TRIGGER "${triggerName}"
          BEFORE UPDATE ON "device_oauth_session"
          FOR EACH STATEMENT
          EXECUTE FUNCTION "${functionName}"()
        `);
        await cleanup.deviceOauthSession.create({
          data: {
            createdAt: new Date("2026-08-11T11:45:00.000Z"),
            expiresAt,
            provider: "retention-proof",
            state,
          },
        });
        await consumer.$executeRawUnsafe(
          `SET murph.retention_oauth_consume_gate = '${suffix}'`,
        );
        const [backend] = await consumer.$queryRaw<Array<{ pid: number }>>`
          SELECT pg_backend_pid()::int AS "pid"
        `;
        if (!backend) {
          throw new Error("Expected the OAuth consumer PostgreSQL backend pid.");
        }

        holder = locker.$transaction(async (tx) => {
          await tx.$executeRaw`
            SELECT pg_advisory_xact_lock(${advisoryKeyA}, ${advisoryKeyB})
          `;
          markGateHeld();
          await gate;
        });
        await Promise.race([
          gateHeld,
          holder.then(() => {
            throw new Error(
              "Expected the advisory gate holder to remain open until release.",
            );
          }),
        ]);
        consume = new PrismaHostedOAuthSessionStore(consumer).consumeOAuthState(
          state,
          callbackNow.toISOString(),
          "retention-proof",
        );
        await waitForAdvisoryLock({
          observer: cleanup,
          pid: backend.pid,
        });

        await expect(deleteExpiredDeviceOauthSessions({
          now: retentionNow,
          prisma: cleanup,
        })).resolves.toBe(0);
        await expect(cleanup.deviceOauthSession.findUnique({
          select: { consumedAt: true },
          where: { state },
        })).resolves.toEqual({ consumedAt: null });

        releaseGate();
        await holder;
        await expect(consume).resolves.toMatchObject({ status: "consumed" });
        await expect(deleteExpiredDeviceOauthSessions({
          now: retentionNow,
          prisma: cleanup,
        })).resolves.toBe(0);
        await expect(cleanup.deviceOauthSession.findUnique({
          select: { consumedAt: true },
          where: { state },
        })).resolves.toEqual({ consumedAt: callbackNow });
      } finally {
        releaseGate();
        await holder?.catch(() => undefined);
        await consume?.catch(() => undefined);
        await consumer.$executeRawUnsafe(
          "RESET murph.retention_oauth_consume_gate",
        ).catch(() => undefined);
        await cleanup.$executeRawUnsafe(
          `DROP TRIGGER IF EXISTS "${triggerName}" ON "device_oauth_session"`,
        );
        await cleanup.$executeRawUnsafe(
          `DROP FUNCTION IF EXISTS "${functionName}"()`,
        );
        await cleanup.deviceOauthSession.deleteMany({ where: { state } });
      }
    });

    it("preserves a consumed phone-transfer blocker until its exact owner removes it", async () => {
      const cleanup = requirePrisma(cleanupClient);
      const suffix = randomUUID();
      const memberId = `retention-transfer-member-${suffix}`;
      const state = `retention-transfer-state-${suffix}`;
      const consumedAt = new Date("2026-08-11T11:59:59.000Z");
      const retentionNow = new Date("2026-08-11T12:00:01.000Z");

      try {
        await cleanup.hostedMember.create({ data: { id: memberId } });
        await cleanup.deviceOauthSession.create({
          data: {
            consumedAt,
            createdAt: new Date("2026-08-11T11:45:00.000Z"),
            expiresAt: new Date("2026-08-11T12:00:00.000Z"),
            provider: "retention-proof",
            state,
            userId: memberId,
          },
        });

        await expect(deleteExpiredDeviceOauthSessions({
          now: retentionNow,
          prisma: cleanup,
        })).resolves.toBe(0);
        await expect(cleanup.deviceOauthSession.findFirst({
          select: { state: true },
          where: { userId: memberId },
        })).resolves.toEqual({ state });

        await cleanup.deviceOauthSession.delete({ where: { state } });
        await expect(cleanup.deviceOauthSession.findFirst({
          select: { state: true },
          where: { userId: memberId },
        })).resolves.toBeNull();
      } finally {
        await cleanup.deviceOauthSession.deleteMany({ where: { state } });
        await cleanup.hostedMember.deleteMany({ where: { id: memberId } });
      }
    });

    it("keeps a connected-app callback authoritative through its exact owner grace", async () => {
      const cleanup = requirePrisma(cleanupClient);
      const consumer = requirePrisma(consumeClient);
      const locker = requirePrisma(lockClient);
      const suffix = randomUUID().replaceAll("-", "");
      const memberId = `retention-connected-member-${suffix}`;
      const claim = `cai_${suffix}`;
      const claimHash = createHash("sha256").update(claim).digest("hex");
      const connectedAccountId = `ca_${suffix}`;
      const functionName = `rt_connected_gate_fn_${suffix.slice(0, 16)}`;
      const triggerName = `rt_connected_gate_tr_${suffix.slice(0, 16)}`;
      const advisoryKeyA = toPostgresInt32(suffix.slice(0, 8));
      const advisoryKeyB = toPostgresInt32(suffix.slice(8, 16));
      const callbackStartedAt = new Date();
      const expiresAt = new Date(
        callbackStartedAt.getTime()
        - HOSTED_CONNECTED_APP_STARTED_INTENT_OWNER_GRACE_MS
        + 60_000,
      );
      const retentionNow = new Date(
        expiresAt.getTime()
        + HOSTED_CONNECTED_APP_STARTED_INTENT_OWNER_GRACE_MS,
      );
      let releaseGate = (): void => undefined;
      const gate = new Promise<void>((resolve) => {
        releaseGate = resolve;
      });
      let markGateHeld = (): void => undefined;
      const gateHeld = new Promise<void>((resolve) => {
        markGateHeld = resolve;
      });
      let callback: ReturnType<typeof completeHostedConnectedAppConnection> | null = null;
      let holder: Promise<void> | null = null;

      try {
        await cleanup.$executeRawUnsafe(`
          CREATE FUNCTION "${functionName}"()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $function$
          BEGIN
            IF current_setting('murph.retention_connected_callback_gate', true) = '${suffix}' THEN
              PERFORM pg_advisory_xact_lock(${advisoryKeyA}, ${advisoryKeyB});
            END IF;
            RETURN NEW;
          END;
          $function$
        `);
        await cleanup.$executeRawUnsafe(`
          CREATE TRIGGER "${triggerName}"
          BEFORE UPDATE ON "hosted_connected_app_connect_intent"
          FOR EACH ROW
          EXECUTE FUNCTION "${functionName}"()
        `);
        await cleanup.hostedMember.create({
          data: { billingStatus: "active", id: memberId },
        });
        await cleanup.hostedConnectedAppConnectIntent.create({
          data: {
            alias: "work",
            claimHash,
            connectedAccountId,
            createdAt: new Date(expiresAt.getTime() - 60_000),
            expiresAt,
            memberId,
            startedAt: new Date(expiresAt.getTime() - 30_000),
            toolkit: "gmail",
          },
        });
        await consumer.$executeRawUnsafe(
          `SET murph.retention_connected_callback_gate = '${suffix}'`,
        );
        const [backend] = await consumer.$queryRaw<Array<{ pid: number }>>`
          SELECT pg_backend_pid()::int AS "pid"
        `;
        if (!backend) throw new Error("Expected the connected-app callback backend pid.");

        holder = locker.$transaction(async (tx) => {
          await tx.$executeRaw`
            SELECT pg_advisory_xact_lock(${advisoryKeyA}, ${advisoryKeyB})
          `;
          markGateHeld();
          await gate;
        });
        await gateHeld;
        callback = completeHostedConnectedAppConnection({
          claim,
          connectedAccountId,
          fetchImpl: createConnectedAppVerificationFetch({ connectedAccountId, memberId }),
          prisma: consumer,
        });
        await waitForAdvisoryLock({ observer: cleanup, pid: backend.pid });

        await expect(deleteExpiredConnectedAppConnectIntents({
          now: retentionNow,
          prisma: cleanup,
        })).resolves.toBe(0);
        await expect(cleanup.hostedConnectedAppConnectIntent.findUnique({
          select: { completedAt: true },
          where: { claimHash },
        })).resolves.toEqual({ completedAt: null });

        releaseGate();
        await holder;
        await expect(callback).resolves.toMatchObject({
          intent: { completedAt: expect.any(Date) },
        });
        await expect(deleteExpiredConnectedAppConnectIntents({
          now: retentionNow,
          prisma: cleanup,
        })).resolves.toBe(1);
      } finally {
        releaseGate();
        await holder?.catch(() => undefined);
        await callback?.catch(() => undefined);
        await consumer.$executeRawUnsafe(
          "RESET murph.retention_connected_callback_gate",
        ).catch(() => undefined);
        await cleanup.$executeRawUnsafe(
          `DROP TRIGGER IF EXISTS "${triggerName}" ON "hosted_connected_app_connect_intent"`,
        );
        await cleanup.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"()`);
        await cleanup.hostedMember.deleteMany({ where: { id: memberId } });
      }
    });

    it("keeps the production Clinical callback authoritative over concurrent retention", async () => {
      const cleanup = requirePrisma(cleanupClient);
      const consumer = requirePrisma(consumeClient);
      const locker = requirePrisma(lockClient);
      const suffix = randomUUID().replaceAll("-", "");
      const memberId = `retention-clinical-member-${suffix}`;
      const webSessionId = `retention-clinical-session-${suffix}`;
      const state = `crs_${"a".repeat(43)}`;
      const stateHash = normalizeSmartStateHash(state);
      if (!stateHash) throw new Error("Expected valid Clinical OAuth state.");
      const connectIntentClaimHash = createHash("sha256")
        .update(`clinical-${suffix}`)
        .digest("hex");
      const functionName = `rt_clinical_gate_fn_${suffix.slice(0, 16)}`;
      const triggerName = `rt_clinical_gate_tr_${suffix.slice(0, 16)}`;
      const advisoryKeyA = toPostgresInt32(suffix.slice(0, 8));
      const advisoryKeyB = toPostgresInt32(suffix.slice(8, 16));
      const expiresAt = new Date(Date.now() + 60_000);
      const retentionNow = new Date(expiresAt.getTime() + 1);
      let releaseGate = (): void => undefined;
      const gate = new Promise<void>((resolve) => {
        releaseGate = resolve;
      });
      let markGateHeld = (): void => undefined;
      const gateHeld = new Promise<void>((resolve) => {
        markGateHeld = resolve;
      });
      let callback: ReturnType<typeof finishClinicalRecordAuthorization> | null = null;
      let holder: Promise<void> | null = null;

      try {
        clinicalMocks.getPrisma.mockReturnValue(consumer);
        clinicalMocks.requireActiveHostedAppSessionFromRequest.mockResolvedValue({
          member: { id: memberId },
          sessionId: webSessionId,
        });
        await cleanup.$executeRawUnsafe(`
          CREATE FUNCTION "${functionName}"()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $function$
          BEGIN
            IF current_setting('murph.retention_clinical_callback_gate', true) = '${suffix}' THEN
              PERFORM pg_advisory_xact_lock(${advisoryKeyA}, ${advisoryKeyB});
            END IF;
            RETURN NEW;
          END;
          $function$
        `);
        await cleanup.$executeRawUnsafe(`
          CREATE TRIGGER "${triggerName}"
          BEFORE UPDATE ON "clinical_record_oauth_session"
          FOR EACH ROW
          EXECUTE FUNCTION "${functionName}"()
        `);
        await cleanup.hostedMember.create({ data: { id: memberId } });
        await cleanup.clinicalRecordConnectIntent.create({
          data: {
            claimHash: connectIntentClaimHash,
            createdAt: new Date(expiresAt.getTime() - 60_000),
            expiresAt,
            memberId,
            providerDirectoryEntryId: "retention-proof",
            startedAt: new Date(expiresAt.getTime() - 30_000),
          },
        });
        await cleanup.clinicalRecordOauthSession.create({
          data: {
            clientId: "retention-client",
            codeVerifierEncrypted: "sealed-retention-verifier",
            connectIntentClaimHash,
            createdAt: new Date(expiresAt.getTime() - 60_000),
            expiresAt,
            fhirBaseHash: "retention-fhir-hash",
            memberId,
            providerDirectoryEntryId: "retention-proof",
            redirectUri: "https://join.example.test/api/clinical-records/oauth/callback",
            requestedScopesJson: [],
            stateHash,
            tokenEndpoint: "https://provider.example.test/token",
            webSessionId,
          },
        });
        await consumer.$executeRawUnsafe(
          `SET murph.retention_clinical_callback_gate = '${suffix}'`,
        );
        const [backend] = await consumer.$queryRaw<Array<{ pid: number }>>`
          SELECT pg_backend_pid()::int AS "pid"
        `;
        if (!backend) throw new Error("Expected the Clinical callback backend pid.");

        holder = locker.$transaction(async (tx) => {
          await tx.$executeRaw`
            SELECT pg_advisory_xact_lock(${advisoryKeyA}, ${advisoryKeyB})
          `;
          markGateHeld();
          await gate;
        });
        await gateHeld;
        callback = finishClinicalRecordAuthorization({
          code: null,
          providerDenied: true,
          providerError: false,
          request: new Request("https://join.example.test/api/clinical-records/oauth/callback"),
          state,
        });
        await waitForAdvisoryLock({ observer: cleanup, pid: backend.pid });

        await expect(deleteExpiredClinicalRecordOauthSessions({
          now: retentionNow,
          prisma: cleanup,
        })).resolves.toBe(0);
        await expect(cleanup.clinicalRecordOauthSession.findUnique({
          select: { consumedAt: true },
          where: { stateHash },
        })).resolves.toEqual({ consumedAt: null });

        releaseGate();
        await holder;
        await expect(callback).rejects.toMatchObject({
          code: "CLINICAL_RECORD_AUTHORIZATION_DECLINED",
        });
        await expect(deleteExpiredClinicalRecordOauthSessions({
          now: retentionNow,
          prisma: cleanup,
        })).resolves.toBe(1);
      } finally {
        releaseGate();
        await holder?.catch(() => undefined);
        await callback?.catch(() => undefined);
        await consumer.$executeRawUnsafe(
          "RESET murph.retention_clinical_callback_gate",
        ).catch(() => undefined);
        await cleanup.$executeRawUnsafe(
          `DROP TRIGGER IF EXISTS "${triggerName}" ON "clinical_record_oauth_session"`,
        );
        await cleanup.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"()`);
        await cleanup.hostedMember.deleteMany({ where: { id: memberId } });
      }
    });

    it("keeps a consumed Clinical session until its incomplete intent owner retires", async () => {
      const cleanup = requirePrisma(cleanupClient);
      const suffix = randomUUID().replaceAll("-", "");
      const memberId = `retention-clinical-owner-${suffix}`;
      const claimHash = createHash("sha256")
        .update(`clinical-owner-${suffix}`)
        .digest("hex");
      const stateHash = createHash("sha256")
        .update(`clinical-state-${suffix}`)
        .digest("hex");
      const expiresAt = new Date("2026-08-11T12:00:00.000Z");
      const retentionNow = new Date("2026-08-11T12:31:00.000Z");

      try {
        await cleanup.hostedMember.create({ data: { id: memberId } });
        await cleanup.clinicalRecordConnectIntent.create({
          data: {
            claimHash,
            createdAt: new Date("2026-08-11T11:45:00.000Z"),
            expiresAt,
            memberId,
            providerDirectoryEntryId: "retention-proof",
            startedAt: new Date("2026-08-11T11:50:00.000Z"),
          },
        });
        await cleanup.clinicalRecordOauthSession.create({
          data: {
            clientId: "retention-client",
            codeVerifierEncrypted: "sealed-retention-verifier",
            connectIntentClaimHash: claimHash,
            consumedAt: new Date("2026-08-11T11:55:00.000Z"),
            createdAt: new Date("2026-08-11T11:45:00.000Z"),
            expiresAt,
            fhirBaseHash: "retention-fhir-hash",
            memberId,
            providerDirectoryEntryId: "retention-proof",
            redirectUri: "https://join.example.test/api/clinical-records/oauth/callback",
            requestedScopesJson: [],
            stateHash,
            tokenEndpoint: "https://provider.example.test/token",
            webSessionId: `retention-clinical-session-${suffix}`,
          },
        });

        await expect(deleteExpiredClinicalRecordOauthSessions({
          now: retentionNow,
          prisma: cleanup,
        })).resolves.toBe(0);
        await expect(cleanup.clinicalRecordOauthSession.count({
          where: { stateHash },
        })).resolves.toBe(1);

        await cleanup.clinicalRecordConnectIntent.delete({ where: { claimHash } });
        await expect(deleteExpiredClinicalRecordOauthSessions({
          now: retentionNow,
          prisma: cleanup,
        })).resolves.toBe(1);
      } finally {
        await cleanup.hostedMember.deleteMany({ where: { id: memberId } });
      }
    });

    it("does not wait behind a locked mailbox item", async () => {
      const cleanup = requirePrisma(cleanupClient);
      const locker = requirePrisma(lockClient);
      const suffix = randomUUID();
      const memberId = `retention-mailbox-member-${suffix}`;
      const lockedId = `retention-mailbox-locked-${suffix}`;
      const freeId = `retention-mailbox-free-${suffix}`;
      const now = new Date("2026-08-11T12:00:00.000Z");
      const expiredAt = new Date("2026-08-01T12:00:00.000Z");
      let releaseLock = (): void => undefined;
      const lockGate = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });
      let markLocked = (): void => undefined;
      const locked = new Promise<void>((resolve) => {
        markLocked = resolve;
      });

      await cleanup.hostedMember.create({ data: { id: memberId } });
      await cleanup.hostedMailboxItem.createMany({
        data: [lockedId, freeId].map((id, index) => ({
          createdAt: expiredAt,
          dedupeKey: `retention-mailbox-dedupe-${index}-${suffix}`,
          expiresAt: expiredAt,
          id,
          kind: "retention.proof",
          lane: "system",
          laneSeq: BigInt(index + 1),
          occurredAt: expiredAt,
          payloadInlineCiphertext: "encrypted-retention-proof",
          payloadSchema: "retention.proof.v1",
          updatedAt: expiredAt,
          userId: memberId,
        })),
      });

      const holder = locker.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT "id"
          FROM "hosted_mailbox_item"
          WHERE "id" = ${lockedId}
          FOR UPDATE
        `;
        markLocked();
        await lockGate;
      });

      try {
        await locked;
        await cleanup.$executeRawUnsafe("SET statement_timeout = '1s'");
        await expect(retireExpiredMailboxContent({
          now,
          prisma: cleanup,
        })).resolves.toEqual({
          policyNonReplies: 0,
          retired: 1,
          tombstonesDeleted: 0,
        });
        await expect(cleanup.hostedMailboxItem.findMany({
          orderBy: { id: "asc" },
          select: { contentRetiredAt: true, id: true },
          where: { id: { in: [lockedId, freeId] } },
        })).resolves.toEqual([
          { contentRetiredAt: now, id: freeId },
          { contentRetiredAt: null, id: lockedId },
        ]);

        releaseLock();
        await holder;
        await expect(retireExpiredMailboxContent({
          now,
          prisma: cleanup,
        })).resolves.toEqual({
          policyNonReplies: 0,
          retired: 1,
          tombstonesDeleted: 0,
        });
      } finally {
        releaseLock();
        await holder.catch(() => undefined);
        await cleanup.hostedMember.deleteMany({ where: { id: memberId } });
      }
    });

    it("does not wait behind a locked Linq provider event", async () => {
      const cleanup = requirePrisma(cleanupClient);
      const locker = requirePrisma(lockClient);
      const suffix = randomUUID();
      const lockedId = `retention-linq-locked-${suffix}`;
      const freeId = `retention-linq-free-${suffix}`;
      const now = new Date("2026-08-11T12:00:00.000Z");
      const expiredAt = new Date("2026-08-01T12:00:00.000Z");
      let releaseLock = (): void => undefined;
      const lockGate = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });
      let markLocked = (): void => undefined;
      const locked = new Promise<void>((resolve) => {
        markLocked = resolve;
      });

      await cleanup.hostedLinqProviderEvent.createMany({
        data: [lockedId, freeId].map((eventId) => ({
          eventId,
          eventType: "retention.proof",
          extractionJson: { retained: true },
          providerCreatedAt: expiredAt,
          receivedAt: expiredAt,
        })),
      });

      const holder = locker.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT "event_id"
          FROM "hosted_linq_provider_event"
          WHERE "event_id" = ${lockedId}
          FOR UPDATE
        `;
        markLocked();
        await lockGate;
      });

      try {
        await locked;
        await cleanup.$executeRawUnsafe("SET statement_timeout = '1s'");
        await expect(compactOldLinqProviderEventDiagnostics({
          now,
          prisma: cleanup,
        })).resolves.toBe(1);
        await expect(cleanup.hostedLinqProviderEvent.findMany({
          orderBy: { eventId: "asc" },
          select: { eventId: true, extractionJson: true },
          where: { eventId: { in: [lockedId, freeId] } },
        })).resolves.toEqual([
          { eventId: freeId, extractionJson: null },
          { eventId: lockedId, extractionJson: { retained: true } },
        ]);

        releaseLock();
        await holder;
        await expect(compactOldLinqProviderEventDiagnostics({
          now,
          prisma: cleanup,
        })).resolves.toBe(1);
      } finally {
        releaseLock();
        await holder.catch(() => undefined);
        await cleanup.hostedLinqProviderEvent.deleteMany({
          where: { eventId: { in: [lockedId, freeId] } },
        });
      }
    });
  },
);

function createConnectedAppVerificationFetch(input: {
  connectedAccountId: string;
  memberId: string;
}): typeof fetch {
  return (async (request: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(request));
    if (url.pathname !== "/api/v3.1/connected_accounts" || init?.method !== "GET") {
      throw new Error(`Unexpected connected-app verification request ${url.pathname}.`);
    }
    if (
      url.searchParams.getAll("connected_account_ids")[0] !== input.connectedAccountId
      || url.searchParams.getAll("user_ids")[0] !== input.memberId
    ) {
      throw new Error("Connected-app verification request lost its exact owner binding.");
    }
    return new Response(JSON.stringify({
      items: [{
        alias: "work",
        id: input.connectedAccountId,
        is_disabled: false,
        status: "ACTIVE",
        toolkit: { name: "Gmail", slug: "gmail" },
        word_id: "retention-proof",
      }],
    }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  }) as typeof fetch;
}

async function waitForAdvisoryLock(input: {
  observer: PrismaClient;
  pid: number;
}): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const [activity] = await input.observer.$queryRaw<Array<{
      waitEvent: string | null;
      waitEventType: string | null;
    }>>`
      SELECT
        wait_event AS "waitEvent",
        wait_event_type AS "waitEventType"
      FROM pg_stat_activity
      WHERE pid = ${input.pid}
    `;
    if (
      activity?.waitEventType === "Lock"
      && activity.waitEvent === "advisory"
    ) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("Expected the OAuth consumer to wait on the advisory gate.");
}

function toPostgresInt32(hex: string): number {
  const value = Number.parseInt(hex, 16);
  return value > 0x7fff_ffff ? value - 0x1_0000_0000 : value;
}

function requirePrisma(value: PrismaClient | null): PrismaClient {
  if (!value) {
    throw new Error("PostgreSQL test client was not initialized.");
  }
  return value;
}

function isClearlyLocalPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol.startsWith("postgres")
      && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}
