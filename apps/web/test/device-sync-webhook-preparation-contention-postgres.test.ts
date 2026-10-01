import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { PrismaDeviceSyncControlPlaneStore } from "@/src/lib/device-sync/prisma-store";
import { openHostedDeviceSyncDirtyPayloadJson } from "@/src/lib/device-sync/prisma-store/dirty-payloads";
import { handleHostedDeviceSyncWebhookAccepted } from "@/src/lib/device-sync/wake-service";
import { setHostedSecureBoxStringTestCodecForTests } from "@/src/lib/hosted-crypto/secure-box";
import { createPrismaClient } from "@/src/lib/prisma";

const mailboxPreparation = vi.hoisted(() => vi.fn(async () => Object.freeze({
  testOnlyUnusedMailboxPreparation: true,
})));
vi.mock("@/src/lib/hosted-mailbox/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/src/lib/hosted-mailbox/store")>(),
  // These cases lose the first-dirty race to a sibling before final admission,
  // so the optimistic mailbox capability must never be consumed. Only the
  // external root preparation is substituted; actual append stays production.
  prepareHostedMailboxItemAppendCrypto: mailboxPreparation,
}));

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const databaseUrl = process.env.DATABASE_URL ?? "";
if (enabled) {
  const url = new URL(databaseUrl);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    || !url.pathname.startsWith("/murph_test")) {
    throw new Error("Webhook contention proof requires local murph_test PostgreSQL.");
  }
}

describe.skipIf(!enabled)("payload webhook preparation contention (PostgreSQL)", () => {
  it.each(["interleaved", "burst", "first_dirty", "clean_to_dirty"] as const)("accepts payloads through %s preparation contention", async (mode) => {
    const prisma = createPrismaClient({ databaseUrl, poolMax: 2 });
    mailboxPreparation.mockClear();
    const store = new PrismaDeviceSyncControlPlaneStore({ prisma });
    const suffix = randomUUID();
    const userId = `member_webhook_contention_${suffix}`;
    const connectionId = `dsc_webhook_contention_${suffix}`;
    const traceId = `trace_webhook_contention_${suffix}`;
    const count = mode === "burst" ? 12 : 1;
    const traceIds = Array.from({ length: count }, (_, index) => `${traceId}_${index}`);
    const connectedAt = new Date("2026-08-01T00:00:00.000Z");
    const now = "2026-08-02T00:00:00.000Z";
    // Authenticate all binding fields, including the revision, in this local
    // codec. Provider/KMS transport is outside the concurrency proof.
    const binding = (input: { aad: unknown; lane: string; scope: string; userId: string }) =>
      JSON.stringify([input.aad, input.lane, input.scope, input.userId],
        (_key, value: unknown) => typeof value === "bigint" ? value.toString() : value);
    setHostedSecureBoxStringTestCodecForTests({
      encrypt: (input) => JSON.stringify({ binding: binding(input), value: input.value }),
      decrypt: (input) => {
        const envelope = JSON.parse(input.value) as { binding: string; value: string };
        if (envelope.binding !== binding(input)) throw new Error("Payload binding mismatch.");
        return envelope.value;
      },
    });
    try {
      await prisma.hostedMember.create({ data: { id: userId } });
      await prisma.deviceConnection.create({ data: {
        id: connectionId, userId, provider: "junction", status: "active",
        setupPhase: "source_confirmed", credentialKind: "none", connectedAt,
        providerAccountBlindIndex: `blind_${suffix}`, scopesJson: [], metadataJson: {},
      } });
      await prisma.deviceConnectionSource.create({ data: {
        id: `source_${suffix}`, connectionId, firstSeenAt: connectedAt,
        lastSeenAt: connectedAt, sourceProviderSlug: "garmin", status: "connected",
        sourceInstanceKey: `source_instance_${suffix}`, resourceAvailabilitySummaryJson: {},
      } });
      if (mode !== "first_dirty") {
        await store.upsertDirtyConnection({
          connectionId, userId, provider: "junction", dirtyAt: now, resources: [],
        });
        if (mode === "clean_to_dirty") {
          await prisma.deviceSyncDirtyConnection.update({
            where: { connectionId }, data: { processedRevision: 1n },
          });
        }
      }
      await prisma.deviceWebhookTrace.createMany({ data: traceIds.map((id) => ({
        provider: "junction", traceId: id, claimToken: "synthetic-claim",
        eventType: "daily.data.steps.created", providerAccountBlindIndex: `blind_${suffix}`,
        receivedAt: new Date(now), status: "processing",
        processingExpiresAt: new Date("2026-08-02T01:00:00.000Z"),
      })) });

      const originalPrepare = store.prepareDirtyConnectionUpsert.bind(store);
      let preparedCount = 0;
      let releaseBurst!: () => void;
      const burstPrepared = new Promise<void>((resolve) => { releaseBurst = resolve; });
      const prepare = vi.spyOn(store, "prepareDirtyConnectionUpsert")
        .mockImplementation(async (input) => {
          const prepared = await originalPrepare(input);
          if (mode === "burst") {
            preparedCount += 1;
            if (preparedCount === count) releaseBurst();
            await burstPrepared;
            return prepared;
          }
          // A completed independent transaction deterministically lands in the
          // vulnerable prepare/commit window, including the real owner's retry.
          await store.upsertDirtyConnection({
            connectionId, userId, provider: "junction", dirtyAt: now,
            resources: [{ count: 1, jobKind: "reconcile", resource: "activity",
              resourceCategory: "activity", sourceProviderSlug: "garmin",
              windowStart: null, windowEnd: null }],
          });
          return prepared;
        });
      const payload = { resource: "steps", webhookDataJson: JSON.stringify({ value: 321 }) };
      const results = await Promise.allSettled(traceIds.map((id) => handleHostedDeviceSyncWebhookAccepted({
        account: { connectedAt: connectedAt.toISOString(), id: connectionId, provider: "junction" },
        claimToken: "synthetic-claim", now, ownerId: userId, processingAttemptedAt: now,
        store, traceId: id,
        webhook: {
          acceptanceMode: "level_dirty_hint", dataSourceProviderSlug: "garmin",
          eventType: "daily.data.steps.created", occurredAt: now,
          resourceCategory: "timeseries", sourceProviderSlug: "garmin",
          jobs: [{ kind: "resource", payload }],
        },
      })));
      for (const result of results) {
        if (result.status === "rejected") throw result.reason;
      }
      expect(prepare).toHaveBeenCalledTimes(count);
      const dirty = await prisma.deviceSyncDirtyConnection.findUniqueOrThrow({ where: { connectionId } });
      expect(dirty.dirtyRevision).toBe(mode === "burst" ? 13n : mode === "first_dirty" ? 2n : 3n);
      expect(dirty.processedRevision).toBe(mode === "clean_to_dirty" ? 1n : 0n);
      const rows = await prisma.deviceSyncDirtyPayload.findMany({ where: { connectionId } });
      expect(rows).toHaveLength(count);
      expect(new Set(rows.map((row) => row.dirtyRevision)).size).toBe(count);
      for (const row of rows) {
      const openInput = { connectionId, dirtyRevision: row.dirtyRevision,
        payloadId: row.id, prisma, provider: "junction", userId, value: row.resourceEncrypted };
      expect(await openHostedDeviceSyncDirtyPayloadJson(openInput)).toMatchObject({ payload });
      await expect(openHostedDeviceSyncDirtyPayloadJson({ ...openInput, dirtyRevision: row.dirtyRevision + 1n }))
        .rejects.toThrow("Payload binding mismatch");
      }
      expect(await prisma.deviceWebhookTrace.count({
        where: { provider: "junction", traceId: { in: traceIds }, status: "processed" },
      })).toBe(count);
      expect(await prisma.hostedMailboxItem.count({ where: { userId } })).toBe(0);
      expect(mailboxPreparation).toHaveBeenCalledTimes(
        mode === "first_dirty" || mode === "clean_to_dirty" ? 1 : 0,
      );
    } finally {
      vi.restoreAllMocks();
      setHostedSecureBoxStringTestCodecForTests(null);
      await prisma.deviceWebhookTrace.deleteMany({ where: { provider: "junction", traceId: { in: traceIds } } });
      await prisma.deviceSyncDirtyPayload.deleteMany({ where: { connectionId } });
      await prisma.deviceSyncDirtyConnection.deleteMany({ where: { connectionId } });
      await prisma.deviceConnectionSource.deleteMany({ where: { connectionId } });
      await prisma.deviceConnection.deleteMany({ where: { id: connectionId } });
      await prisma.hostedMember.deleteMany({ where: { id: userId } });
      await prisma.$disconnect();
    }
  });
});
