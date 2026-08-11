import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { PrismaDeviceSyncControlPlaneStore } from "@/src/lib/device-sync/prisma-store";
import { setHostedSecureBoxStringTestCodecForTests } from "@/src/lib/hosted-crypto/secure-box";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const connectionCodec = {
  decrypt: (value: string) => value.replace(/^enc:/u, ""),
  encrypt: (value: string) => `enc:${value}`,
  keyVersion: "v1",
};

describe.skipIf(!runPostgresProof)(
  "device-sync dirty reconnect retention PostgreSQL boundary",
  () => {
    it("retains and acknowledges credential-independent work across canonical replacement", async () => {
      if (!databaseUrl) {
        throw new Error("DATABASE_URL is required for the PostgreSQL reconnect proof.");
      }

      const fixtureId = randomUUID();
      const userId = `member_dirty_reconnect_${fixtureId}`;
      const externalAccountId = `oura_dirty_reconnect_${fixtureId}`;
      const prisma = createPrismaClient({ databaseUrl, poolMax: 4 });
      const store = new PrismaDeviceSyncControlPlaneStore({
        codec: connectionCodec,
        prisma,
        providerAccountBlindIndexKey: Buffer.alloc(32, 7),
      });
      const decrypt = vi.fn((input: { value: string }) => input.value);
      setHostedSecureBoxStringTestCodecForTests({
        decrypt,
        encrypt: (input) => input.value,
      });

      try {
        await prisma.hostedMember.create({ data: { id: userId } });
        const connection = await store.upsertConnection({
          connectedAt: "2026-07-16T12:00:00.000Z",
          displayName: "Oura",
          existingAccountPolicy: "replace",
          externalAccountId,
          metadata: {},
          nextReconcileAt: null,
          ownerId: userId,
          provider: "oura",
          scopes: ["daily"],
          tokens: {
            accessToken: "access-token-v1",
            refreshToken: "refresh-token-v1",
          },
        });
        await store.upsertDirtyConnection({
          connectionId: connection.id,
          dirtyAt: "2026-07-16T12:01:00.000Z",
          eventType: "daily.data.updated",
          provider: "oura",
          resourceCategory: "sleep",
          resources: [
            {
              count: 1,
              jobKind: "delete",
              payload: { objectId: "sleep-deleted" },
              resource: "sleep",
              resourceCategory: "sleep",
              sourceProviderSlug: "oura",
              windowEnd: null,
              windowStart: null,
            },
            {
              count: 1,
              jobKind: "resource",
              payload: { objectId: "sleep-fetch" },
              resource: "sleep",
              resourceCategory: "sleep",
              sourceProviderSlug: "oura",
              windowEnd: null,
              windowStart: null,
            },
          ],
          traceId: "trace_dirty_reconnect",
          userId,
        });

        await expect(prisma.deviceSyncDirtyPayload.groupBy({
          by: ["credentialIndependent"],
          _count: { _all: true },
          where: { connectionId: connection.id },
        })).resolves.toEqual(expect.arrayContaining([
          expect.objectContaining({ credentialIndependent: false, _count: { _all: 1 } }),
          expect.objectContaining({ credentialIndependent: true, _count: { _all: 1 } }),
        ]));
        decrypt.mockClear();

        const replacement = await store.upsertConnection({
          connectedAt: "2026-07-16T12:02:00.000Z",
          displayName: "Oura",
          existingAccountPolicy: "replace",
          externalAccountId,
          metadata: {},
          nextReconcileAt: null,
          ownerId: userId,
          provider: "oura",
          scopes: ["daily"],
          tokens: {
            accessToken: "access-token-v2",
            refreshToken: "refresh-token-v2",
          },
        });
        expect(replacement.id).toBe(connection.id);
        expect(decrypt).not.toHaveBeenCalled();

        const retainedRows = await prisma.deviceSyncDirtyPayload.findMany({
          where: { connectionId: connection.id },
        });
        expect(retainedRows).toHaveLength(1);
        expect(retainedRows[0]?.credentialIndependent).toBe(true);

        const pending = await store.getDirtyConnection({
          connectionId: connection.id,
          userId,
        });
        expect(pending).not.toBeNull();
        expect(Object.values(pending?.dirtyResources ?? {})).toEqual([
          expect.objectContaining({
            dirtyPayloadId: retainedRows[0]?.id,
            jobKind: "delete",
            resource: "sleep",
          }),
        ]);

        await expect(store.markDirtyConnectionProcessed({
          connectionId: connection.id,
          processedDirtyPayloadIds: [retainedRows[0]!.id],
          processedRevision: pending!.dirtyRevision,
          userId,
        })).resolves.toMatchObject({ stillDirty: false });
        await expect(prisma.deviceSyncDirtyPayload.count({
          where: { connectionId: connection.id },
        })).resolves.toBe(0);
      } finally {
        setHostedSecureBoxStringTestCodecForTests(null);
        await prisma.deviceConnection.deleteMany({ where: { userId } });
        await prisma.hostedMember.deleteMany({ where: { id: userId } });
        await prisma.$disconnect();
      }
    });
  },
);
