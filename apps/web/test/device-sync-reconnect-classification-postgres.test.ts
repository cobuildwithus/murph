import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { PrismaHostedConnectionStore } from "@/src/lib/device-sync/prisma-store/connections";
import { sealHostedDeviceSyncDirtyPayloadJson } from "@/src/lib/device-sync/prisma-store/dirty-payloads";
import { setHostedSecureBoxStringTestCodecForTests } from "@/src/lib/hosted-crypto/secure-box";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

describe.skipIf(!runPostgresProof)("reconnect legacy classification PostgreSQL progress", () => {
  it.each([801, 1601])("commits bounded progress for %i legacy payloads", async (count) => {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for the PostgreSQL reconnect proof.");
    }
    const prisma = createPrismaClient({ databaseUrl, poolMax: 2 });
    const userId = `member_reconnect_progress_${randomUUID()}`;
    const state = `oauth_reconnect_progress_${randomUUID()}`;
    const connectedAt = "2026-09-01T12:00:00.000Z";
    const consumedAt = "2026-09-02T12:00:00.000Z";
    const store = new PrismaHostedConnectionStore({
      codec: { decrypt: (value) => value, encrypt: (value) => value, keyVersion: "v1" },
      prisma,
      providerAccountBlindIndexKey: Buffer.alloc(32, 23),
    });
    setHostedSecureBoxStringTestCodecForTests({
      decrypt: (input) => input.value,
      encrypt: (input) => input.value,
    });
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
          consumedAt: new Date(consumedAt),
          expiresAt: new Date("2026-09-03T12:00:00.000Z"),
        },
      });
      const replacement = {
        ...input,
        connectedAt: consumedAt,
        oauthClaim: { state, consumedAt },
        tokens: { accessToken: "new-access", refreshToken: "new-refresh" },
      };
      if (count > 1600) {
        await expect(store.upsertConnection(replacement)).rejects.toMatchObject({
          code: "HOSTED_DEVICE_SYNC_DIRTY_PAYLOAD_CLASSIFICATION_PENDING",
          retryable: true,
        });
        expect(await prisma.deviceSyncDirtyPayload.count({ where })).toBe(count);
        expect(await prisma.deviceSyncDirtyPayload.count({
          where: { ...where, credentialIndependent: null },
        })).toBe(1);
        expect(await prisma.deviceConnection.findUnique({ where: { id: connection.id } }))
          .toMatchObject({ connectedAt: new Date(connectedAt), tokenVersion: 1, accessTokenEncrypted: "old-access" });
        expect(await prisma.deviceSyncDirtyConnection.findUnique({ where }))
          .toMatchObject({ processedRevision: 0n, dirtyRevision: 1n });
        expect(await prisma.deviceOauthSession.findUnique({ where: { state } }))
          .toMatchObject({ consumedAt: new Date(consumedAt) });
      }
      await store.upsertConnection(replacement);
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
      await prisma.deviceOauthSession.deleteMany({ where: { state } });
      await prisma.hostedMember.deleteMany({ where: { id: userId } });
      await prisma.$disconnect();
      setHostedSecureBoxStringTestCodecForTests(null);
    }
  }, 30_000);
});
