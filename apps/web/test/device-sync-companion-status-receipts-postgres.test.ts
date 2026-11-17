import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readCompanionDeviceSyncStatus } from "@/src/lib/device-sync/companion";
import { PrismaDeviceSyncControlPlaneStore } from "@/src/lib/device-sync/prisma-store";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL ?? "";
const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled) {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.searchParams.has("host")) {
    throw new Error("Companion status receipt proof requires a loopback PostgreSQL database.");
  }
}

const minute = 60_000;

// A phone sends steps every few minutes and workouts now and then. One
// source's status keeps each kind's own latest receipt, so the quiet kind
// isn't pushed out by the busy one.
describe.skipIf(!enabled)("Postgres companion status receipts", () => {
  let prisma: PrismaClient;
  const memberIds: string[] = [];

  beforeAll(() => { prisma = createPrismaClient({ databaseUrl, poolMax: 2 }); });
  afterAll(async () => {
    await prisma.deviceConnection.deleteMany({ where: { userId: { in: memberIds } } });
    await prisma.hostedMember.deleteMany({ where: { id: { in: memberIds } } });
    await prisma.$disconnect();
  });

  async function seedMember(now: Date) {
    const memberId = `synthetic-member-${randomUUID()}`;
    const connectionId = `dsc_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
    memberIds.push(memberId);
    await prisma.hostedMember.create({ data: { id: memberId, billingStatus: "active" } });
    await prisma.deviceConnection.create({ data: {
      id: connectionId, userId: memberId, provider: "junction", status: "active",
      providerAccountBlindIndex: `synthetic-${connectionId}`, connectedAt: new Date(now.getTime() - 30 * 24 * 60 * minute),
    } });
    await prisma.deviceConnectionSource.create({ data: {
      id: `dcs_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
      connectionId,
      sourceInstanceKey: "synthetic-phone",
      sourceProviderSlug: "apple_health_kit",
      status: "connected",
      firstSeenAt: new Date(now.getTime() - 30 * 24 * 60 * minute),
      lastSeenAt: now,
      resourceAvailabilitySummaryJson: { steps: "available", workouts: "available", hrv: "available" },
    } });
    return { memberId, connectionId };
  }

  it("keeps a quiet kind's last receipt beside hundreds of newer busy ones", async () => {
    const now = new Date("2026-11-13T12:00:00.000Z");
    const { memberId, connectionId } = await seedMember(now);
    const otherMember = await seedMember(now);
    const signal = (input: {
      at: Date;
      eventType: string;
      kind?: "canonical_import" | "webhook_hint";
      occurredAt?: Date;
      slug?: string;
      userId?: string;
      connection?: string;
    }) => ({
      userId: input.userId ?? memberId,
      connectionId: input.connection ?? connectionId,
      provider: "junction",
      kind: input.kind ?? "webhook_hint",
      eventType: input.eventType,
      sourceProviderSlug: input.slug ?? "apple_health_kit",
      occurredAt: input.occurredAt ?? null,
      createdAt: input.at,
    });
    const workoutsAt = new Date(now.getTime() - 3 * 24 * 60 * minute);
    const heartRateImportedAt = new Date(now.getTime() - 2 * 24 * 60 * minute);
    await prisma.deviceSyncSignal.createMany({ data: [
      signal({ at: workoutsAt, eventType: "daily.data.workouts.created" }),
      // An import's receipt is when it completed, not when its row was written.
      signal({
        at: new Date(heartRateImportedAt.getTime() + 5 * minute),
        eventType: "canonical.data.heartrate.imported",
        kind: "canonical_import",
        occurredAt: heartRateImportedAt,
      }),
      ...Array.from({ length: 320 }, (_, index) => signal({
        at: new Date(now.getTime() - (320 - index) * minute),
        eventType: "daily.data.steps.updated",
      })),
      // Another wearable on the same connection, and another member, never count.
      signal({ at: now, eventType: "daily.data.sleep.created", slug: "whoop_v2" }),
      signal({
        at: now,
        eventType: "daily.data.hrv.created",
        userId: otherMember.memberId,
        connection: otherMember.connectionId,
      }),
    ] });

    const status = await readCompanionDeviceSyncStatus({
      memberId,
      now: () => now,
      sourceProviderSlug: "apple_health_kit",
      store: new PrismaDeviceSyncControlPlaneStore({ prisma }),
    });

    expect(status).toEqual({
      lastDataReceivedAt: new Date(now.getTime() - minute).toISOString(),
      observedAt: now.toISOString(),
      resources: {
        heartrate: { lastReceivedAt: heartRateImportedAt.toISOString() },
        hrv: { lastReceivedAt: null },
        steps: { lastReceivedAt: new Date(now.getTime() - minute).toISOString() },
        workouts: { lastReceivedAt: workoutsAt.toISOString() },
      },
    });
  });
});
