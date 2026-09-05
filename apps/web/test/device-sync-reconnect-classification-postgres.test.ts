import { randomUUID } from "node:crypto";

import {
  createDeviceSyncPublicIngress,
  createDeviceSyncRegistry,
  type DeviceSyncProvider,
} from "@murphai/device-syncd/public-ingress";
import { describe, expect, it, vi } from "vitest";

import { PrismaDeviceSyncControlPlaneStore } from "@/src/lib/device-sync/prisma-store";
import { sealHostedDeviceSyncDirtyPayloadJson } from "@/src/lib/device-sync/prisma-store/dirty-payloads";
import { setHostedSecureBoxStringTestCodecForTests } from "@/src/lib/hosted-crypto/secure-box";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

describe.skipIf(!runPostgresProof)("reconnect legacy classification PostgreSQL progress", () => {
  it.each([801, 1601])("preserves the callback outcome for %i legacy payloads", async (count) => {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for the PostgreSQL reconnect proof.");
    }
    const prisma = createPrismaClient({ databaseUrl, poolMax: 2 });
    const userId = `member_reconnect_progress_${randomUUID()}`;
    const state = `oauth_reconnect_progress_${randomUUID()}`;
    const connectedAt = "2026-09-01T12:00:00.000Z";
    const consumedAt = "2026-09-02T12:00:00.000Z";
    const store = new PrismaDeviceSyncControlPlaneStore({
      codec: { decrypt: (value) => value, encrypt: (value) => value, keyVersion: "v1" },
      prisma,
      providerAccountBlindIndexKey: Buffer.alloc(32, 23),
    });
    setHostedSecureBoxStringTestCodecForTests({
      decrypt: (input) => input.value,
      encrypt: (input) => input.value,
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(consumedAt));
    try {
      await prisma.hostedMember.create({ data: { id: userId } });
      const input = {
        connectedAt,
        existingAccountPolicy: "replace" as const,
        externalAccountId: `oura_progress_${randomUUID()}`,
        ownerId: userId,
        provider: "oura",
        scopes: ["daily"],
        tokens: { accessToken: "old-access", refreshToken: "old-refresh" },
      };
      const connection = await store.upsertConnection(input);
      const where = { connectionId: connection.id };
      await prisma.deviceSyncDirtyConnection.create({
        data: {
          ...where,
          userId,
          provider: "oura",
          dirtyRevision: 1n,
          processedRevision: 0n,
          firstDirtyAt: new Date(connectedAt),
          latestDirtyAt: new Date(consumedAt),
          eventCount: BigInt(count),
        },
      });
      // Real encrypted/compressed envelopes, with only the external KMS seam replaced.
      // Alternate retained deletion work and credential-scoped resource fetches.
      for (let offset = 0; offset < count; offset += 100) {
        const rows = [];
        for (let index = offset; index < Math.min(offset + 100, count); index += 1) {
          const id = `payload_${userId}_${String(index).padStart(4, "0")}`;
          rows.push({
            ...where,
            id,
            userId,
            provider: "oura",
            dirtyRevision: 1n,
            credentialIndependent: null,
            resourceEncrypted: await sealHostedDeviceSyncDirtyPayloadJson({
              ...where,
              dirtyRevision: 1n,
              payloadId: id,
              prisma,
              provider: "oura",
              userId,
              value: {
                count: 1,
                jobKind: index % 2 === 0 ? "delete" : "resource",
                payload: { objectId: `sleep_${index}` },
                resource: "sleep",
              },
            }),
          });
        }
        await prisma.deviceSyncDirtyPayload.createMany({ data: rows });
      }
      await prisma.deviceOauthSession.create({
        data: {
          state,
          userId,
          provider: "oura",
          createdAt: new Date(connectedAt),
          expiresAt: new Date("2026-09-03T12:00:00.000Z"),
        },
      });
      const originalConnection = await prisma.deviceConnection.findUniqueOrThrow({
        where: { id: connection.id },
      });
      const originalClaim = await prisma.deviceOauthSession.findUniqueOrThrow({ where: { state } });
      const completeConnection = vi.fn(async () => ({
        externalAccountId: input.externalAccountId,
        tokens: { accessToken: "new-access", refreshToken: "new-refresh" },
        scopes: ["daily"],
      }));
      const revokeAccess = vi.fn(async () => {});
      const provider: DeviceSyncProvider = {
        provider: "oura",
        descriptor: {
          provider: "oura",
          displayName: "Oura",
          transportModes: ["oauth_callback"],
          connection: { kind: "oauth2", callbackPath: "/oauth/oura/callback", defaultScopes: ["daily"] },
          normalization: { metricFamilies: ["sleep"], snapshotParser: "schema" },
          sourcePriorityHints: { defaultPriority: 50, metricFamilies: { sleep: 50 } },
        },
        connectionHandler: {
          beginConnection: async () => ({ authorizationUrl: "https://provider.example.test/oauth" }),
          completeConnection,
          refreshTokens: async () => ({ accessToken: "refreshed-access" }),
          revokeAccess,
        },
      };
      const ingress = createDeviceSyncPublicIngress({
        publicBaseUrl: "https://sync.example.test/device-sync",
        registry: createDeviceSyncRegistry([provider]),
        store,
      });
      const callback = {
        provider: "oura",
        state,
        code: "synthetic-authorization-code",
        expectedOwnerId: userId,
      };
      const upsert = vi.spyOn(store, "upsertConnection");
      const markFailed = vi.spyOn(store, "markConnectionSetupFailed");
      if (count > 1600) {
        await expect(ingress.handleOAuthCallback(callback)).rejects.toMatchObject({
          code: "HOSTED_DEVICE_SYNC_DIRTY_PAYLOAD_CLASSIFICATION_PENDING",
          retryable: true,
        });
        expect(await prisma.deviceSyncDirtyPayload.count({ where })).toBe(count);
        expect(await prisma.deviceSyncDirtyPayload.count({
          where: { ...where, credentialIndependent: null },
        })).toBe(1);
        expect(await prisma.deviceConnection.findUnique({ where: { id: connection.id } }))
          .toEqual(originalConnection);
        expect(await prisma.deviceSyncDirtyConnection.findUnique({ where }))
          .toMatchObject({ processedRevision: 0n, dirtyRevision: 1n });
        expect(await prisma.deviceOauthSession.findUnique({ where: { state } }))
          .toEqual({ ...originalClaim, consumedAt: new Date(consumedAt) });
        await expect(ingress.handleOAuthCallback(callback)).rejects.toMatchObject({
          code: "OAUTH_STATE_REPLAYED",
        });
        vi.setSystemTime(new Date("2026-09-04T12:00:00.000Z"));
        await expect(ingress.handleOAuthCallback(callback)).rejects.toMatchObject({
          code: "OAUTH_CALLBACK_RECOVERY_REQUIRED",
        });
        expect(completeConnection).toHaveBeenCalledTimes(1);
        expect(upsert).toHaveBeenCalledTimes(1);
        expect(markFailed).not.toHaveBeenCalled();
        expect(revokeAccess).not.toHaveBeenCalled();
        return;
      }
      await ingress.handleOAuthCallback(callback);
      expect(completeConnection).toHaveBeenCalledTimes(1);
      expect(upsert).toHaveBeenCalledTimes(1);
      expect(markFailed).not.toHaveBeenCalled();
      expect(revokeAccess).not.toHaveBeenCalled();
      expect(await prisma.deviceConnection.findUnique({ where: { id: connection.id } }))
        .toMatchObject({ connectedAt: new Date(consumedAt), tokenVersion: 2, accessTokenEncrypted: "new-access" });
      expect(await prisma.deviceSyncDirtyPayload.count({ where })).toBe(Math.ceil(count / 2));
      expect(await prisma.deviceSyncDirtyPayload.count({
        where: { ...where, credentialIndependent: true },
      })).toBe(Math.ceil(count / 2));
      expect(await prisma.deviceSyncDirtyConnection.findUnique({ where }))
        .toMatchObject({ processedRevision: 1n, dirtyRevision: 1n });
      expect(await prisma.deviceOauthSession.findUnique({ where: { state } })).toBeNull();
    } finally {
      vi.useRealTimers();
      await prisma.deviceOauthSession.deleteMany({ where: { state } });
      await prisma.hostedMember.deleteMany({ where: { id: userId } });
      await prisma.$disconnect();
      setHostedSecureBoxStringTestCodecForTests(null);
    }
  }, 30_000);
});
