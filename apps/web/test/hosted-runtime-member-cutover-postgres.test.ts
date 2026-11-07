import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/src/lib/prisma";
import { claimHostedRuntime } from "@/src/lib/hosted-execution/runtime-owner";
import { claimHostedRuntimeResourceCleanup } from "@/src/lib/hosted-execution/runtime-resource-cleanup";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const databaseUrl = process.env.DATABASE_URL ?? "";
if (enabled) {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || !/^\/murph_test_[a-z0-9_]+$/u.test(url.pathname)
    || url.searchParams.has("host")) throw new Error("Resource cleanup proof requires an isolated loopback test database.");
}

describe.skipIf(!enabled)("Postgres ownership after account deletion", () => {
  let prisma: PrismaClient;
  const members: string[] = [];
  beforeAll(() => { prisma = createPrismaClient({ databaseUrl, poolMax: 4 }); });
  afterAll(async () => {
    if (prisma) {
      await prisma.hostedRuntimeOrphan.deleteMany({ where: { userId: { in: members } } });
      await prisma.hostedRuntimeOwner.deleteMany({ where: { userId: { in: members } } });
      await prisma.$disconnect();
    }
  });
  function deletedMember() {
    const userId = `synthetic_deleted_${randomUUID()}`;
    members.push(userId);
    return userId;
  }

  it("keeps retained ownership unchanged when concurrent claims target a deleted member", async () => {
    const userId = deletedMember();
    await prisma.hostedRuntimeOwner.create({ data: { userId, migrationPhase: "postgres", generation: 9n } });
    const results = await Promise.all(Array.from({ length: 2 }, () =>
      claimHostedRuntime({ prisma, userId, processingMode: "default" })));
    expect(results).toEqual(Array.from({ length: 2 }, () => ({ cutover: "postgres", status: "blocked", reason: "admission" })));
    expect(await prisma.hostedRuntimeOwner.findUnique({ where: { userId } })).toMatchObject({ generation: 9n, phase: "idle", attemptId: null });
  });

  it("bounds cleanup for retained resources without a canonical member", async () => {
    const userId = deletedMember();
    await prisma.hostedRuntimeOwner.create({ data: { userId, migrationPhase: "postgres" } });
    await prisma.hostedRuntimeOrphan.createMany({ data: Array.from({ length: 60 }, (_, i) => ({
      userId, kind: "snapshot", resourceId: `synthetic_ready_${i}`, objectKey: `synthetic_ready_${i}`,
      createdAt: new Date("2025-01-01T00:00:00Z"), cleanupAt: new Date("2025-01-01T00:00:00Z"),
    })) });
    const result = await claimHostedRuntimeResourceCleanup({ prisma, now: new Date() });
    expect(result.orphans).toHaveLength(50);
    expect(await prisma.hostedRuntimeOrphan.count({ where: { userId, retiredAt: { not: null } } })).toBe(50);
    expect(await prisma.hostedRuntimeOrphan.count({ where: { userId, retiredAt: null } })).toBe(10);
  });
});
