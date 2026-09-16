import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHostedMember } from "@/src/lib/hosted-onboarding/hosted-member-store";
import { createPrismaClient } from "@/src/lib/prisma";
import { lockHostedRuntimeMemberCutoverTx, readHostedRuntimeMemberBackend } from "@/src/lib/hosted-execution/runtime-cutover";
import { claimHostedRuntime, requireHostedRuntimeCallbackTx } from "@/src/lib/hosted-execution/runtime-owner";
import { claimHostedRuntimeResourceCleanup } from "@/src/lib/hosted-execution/runtime-resource-cleanup";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const databaseUrl = process.env.DATABASE_URL ?? "";
if (enabled) {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || !/^\/murph_test_[a-z0-9_]+$/u.test(url.pathname)
    || url.searchParams.has("host")) throw new Error("Rolling migration proof requires an isolated loopback test database.");
}

describe.skipIf(!enabled)("member-scoped Postgres migration admission", () => {
  let prisma: PrismaClient;
  let previousPhase: string;
  const members: string[] = [];
  beforeAll(async () => {
    prisma = createPrismaClient({ databaseUrl, poolMax: 4 });
    previousPhase = (await prisma.hostedRuntimeCutover.findUniqueOrThrow({ where: { id: "runtime" } })).phase;
    await prisma.hostedRuntimeCutover.update({ where: { id: "runtime" }, data: { phase: "rolling" } });
  });
  afterAll(async () => {
    if (prisma) {
      await prisma.hostedRuntimeOrphan.deleteMany({ where: { userId: { in: members } } });
      await prisma.hostedMember.deleteMany({ where: { id: { in: members } } });
      await prisma.hostedRuntimeOwner.deleteMany({ where: { userId: { in: members } } });
      if (previousPhase) await prisma.hostedRuntimeCutover.update({ where: { id: "runtime" }, data: { phase: previousPhase } });
      await prisma.$disconnect();
    }
  });
  async function member(exists = true) {
    const userId = `rolling_proof_${randomUUID()}`;
    members.push(userId);
    if (exists) {
      // Existing-member fixtures precede campaign start; new-writer cases below
      // deliberately insert during rolling without going through this helper.
      await prisma.$transaction(async tx => {
        await tx.hostedRuntimeCutover.update({ where: { id: "runtime" }, data: { phase: "legacy" } });
        await tx.hostedMember.create({ data: { id: userId, billingStatus: "active" } });
        await tx.hostedRuntimeCutover.update({ where: { id: "runtime" }, data: { phase: "rolling" } });
      });
    }
    return userId;
  }

  const create = (tx: Prisma.TransactionClient, userId: string, writer: string) => writer === "current"
    ? createHostedMember({ prisma: tx, memberId: userId, billingStatus: "active" })
    : tx.hostedMember.create({ data: { id: userId, billingStatus: "active" } });

  it.each(["legacy", "rolling", "postgres"])("assigns new runtime ownership atomically during %s", async phase => {
    const userId = await member(false);
    await prisma.hostedRuntimeCutover.update({ where: { id: "runtime" }, data: { phase } });
    try {
      await prisma.$transaction(tx => createHostedMember({ prisma: tx, memberId: userId, billingStatus: "active" }));
      const expected = phase === "rolling" ? "draining" : phase;
      expect(await readHostedRuntimeMemberBackend(prisma, userId)).toBe(expected);
      const owner = await prisma.hostedRuntimeOwner.findUnique({ where: { userId } });
      if (phase !== "rolling") expect(owner).toBeNull();
      else expect(owner).toMatchObject({ migrationPhase: "pending", generation: 0n, phase: "idle" });
      await prisma.hostedMember.delete({ where: { id: userId } });
      expect(await readHostedRuntimeMemberBackend(prisma, userId)).toBe(expected);
    } finally {
      await prisma.hostedRuntimeCutover.update({ where: { id: "runtime" }, data: { phase: "rolling" } });
    }
  });

  it("enrolls an old writer's new member without granting either runtime authority", async () => {
    const userId = await member(false);
    // Deliberately bypass the current Web helper, as an older deployment can.
    await prisma.hostedMember.create({ data: { id: userId, billingStatus: "active" } });
    expect(await prisma.hostedRuntimeOwner.findUnique({ where: { userId } })).toMatchObject({
      migrationPhase: "pending", migrationId: null, generation: 0n,
    });
    expect(await readHostedRuntimeMemberBackend(prisma, userId)).toBe("draining");
    expect(await claimHostedRuntime({ prisma, userId, processingMode: "default" })).toEqual({ status: "blocked", reason: "cutover" });
    await expect(prisma.$transaction(tx => requireHostedRuntimeCallbackTx(tx, userId, null)))
      .rejects.toMatchObject({ code: "HOSTED_RUNTIME_OWNER_STALE" });
    await prisma.hostedMember.delete({ where: { id: userId } });
    expect(await readHostedRuntimeMemberBackend(prisma, userId)).toBe("draining");
  });

  it.each(["current", "old"])("does not resurrect or overwrite a deleted runtime identity (%s writer)", async writer => {
    const userId = await member(false);
    await prisma.hostedRuntimeOwner.create({ data: { userId, migrationPhase: "importing", migrationId: "synthetic_existing", generation: 9n } });
    await expect(prisma.$transaction(tx => create(tx, userId, writer))).rejects.toThrow();
    expect(await prisma.hostedMember.findUnique({ where: { id: userId } })).toBeNull();
    expect(await prisma.hostedRuntimeOwner.findUnique({ where: { userId } })).toMatchObject({ migrationPhase: "importing", generation: 9n });
  });

  it.each(["current", "old"])("rolls the route back with failed member creation (%s writer)", async writer => {
    const userId = await member(false);
    await expect(prisma.$transaction(async tx => {
      await create(tx, userId, writer);
      throw new Error("synthetic creation failure");
    })).rejects.toThrow("synthetic creation failure");
    expect(await prisma.hostedRuntimeOwner.findUnique({ where: { userId } })).toBeNull();
    expect(await prisma.hostedMember.findUnique({ where: { id: userId } })).toBeNull();
  });

  it.each(["current", "old"])("keeps creation on one side of campaign start (%s writer)", async writer => {
    const userId = await member(false);
    await prisma.hostedRuntimeCutover.update({ where: { id: "runtime" }, data: { phase: "legacy" } });
    const created = latch();
    const release = latch();
    const creation = prisma.$transaction(async tx => {
      await create(tx, userId, writer);
      created.resolve();
      await release.promise;
    }, { timeout: 10_000 });
    try {
      await created.promise;
      await expect(prisma.$transaction(async tx => {
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '100ms'");
        await tx.hostedRuntimeCutover.update({ where: { id: "runtime" }, data: { phase: "rolling" } });
      })).rejects.toThrow();
    } finally {
      release.resolve();
      await creation;
      await prisma.hostedRuntimeCutover.update({ where: { id: "runtime" }, data: { phase: "rolling" } });
    }
    expect(await readHostedRuntimeMemberBackend(prisma, userId)).toBe("legacy");
    const next = await member(false);
    await prisma.$transaction(tx => create(tx, next, writer));
    expect(await readHostedRuntimeMemberBackend(prisma, next)).toBe("draining");
  });

  it("retries creation without waiting behind an exclusive campaign transition", async () => {
    const userId = await member(false);
    const locked = latch();
    const release = latch();
    const transition = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM hosted_runtime_cutover WHERE id = 'runtime' FOR UPDATE`;
      locked.resolve();
      await release.promise;
    }, { timeout: 10_000 });
    try {
      await locked.promise;
      await expect(prisma.$transaction(tx => createHostedMember({ prisma: tx, memberId: userId, billingStatus: "active" })))
        .rejects.toMatchObject({ code: "HOSTED_RUNTIME_CREATION_RETRY", httpStatus: 503, retryable: true });
      expect(await prisma.hostedMember.findUnique({ where: { id: userId } })).toBeNull();
      expect(await prisma.hostedRuntimeOwner.findUnique({ where: { userId } })).toBeNull();
    } finally { release.resolve(); await transition; }
    await prisma.$transaction(tx => createHostedMember({ prisma: tx, memberId: userId, billingStatus: "active" }));
    expect(await readHostedRuntimeMemberBackend(prisma, userId)).toBe("draining");
  });

  it("makes an old writer retry when a campaign transition already holds the lock", async () => {
    const userId = await member(false);
    const locked = latch();
    const release = latch();
    const transition = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM hosted_runtime_cutover WHERE id = 'runtime' FOR UPDATE`;
      locked.resolve(); await release.promise;
    }, { timeout: 10_000 });
    try {
      await locked.promise;
      await expect(prisma.hostedMember.create({ data: { id: userId, billingStatus: "active" } }))
        .rejects.toThrow(/could not obtain lock/u);
      expect(await prisma.hostedMember.findUnique({ where: { id: userId } })).toBeNull();
      expect(await prisma.hostedRuntimeOwner.findUnique({ where: { userId } })).toBeNull();
    } finally { release.resolve(); await transition; }
    await prisma.hostedMember.create({ data: { id: userId, billingStatus: "active" } });
    expect(await readHostedRuntimeMemberBackend(prisma, userId)).toBe("draining");
  });

  it("keeps missing and partially imported owners closed to Postgres while migrated members can claim", async () => {
    const legacy = await member();
    const importing = await member();
    const migrated = await member();
    await prisma.hostedRuntimeOwner.createMany({ data: [
      { userId: importing, migrationPhase: "importing", migrationId: "synthetic_handoff", generation: 7n },
      { userId: migrated, migrationPhase: "postgres", generation: 9n },
    ] });
    expect(await readHostedRuntimeMemberBackend(prisma, legacy)).toBe("legacy");
    expect(await claimHostedRuntime({ prisma, userId: legacy, processingMode: "default" })).toEqual({ status: "blocked", reason: "cutover" });
    expect(await readHostedRuntimeMemberBackend(prisma, importing)).toBe("draining");
    expect(await claimHostedRuntime({ prisma, userId: importing, processingMode: "default" })).toEqual({ status: "blocked", reason: "cutover" });
    const result = await claimHostedRuntime({ prisma, userId: migrated, processingMode: "default" });
    expect(result.status).toBe("claimed");
    if (result.status !== "blocked") expect(result.owner.generation).toBe(10n);
  });

  it("fences the legacy callback transaction against its member seal without blocking another member", async () => {
    const legacy = await member();
    const other = await member();
    await prisma.hostedRuntimeOwner.createMany({ data: [
      { userId: legacy }, { userId: other, migrationPhase: "postgres" },
    ] });
    const admitted = latch();
    const release = latch();
    const callback = prisma.$transaction(async tx => {
      expect(await requireHostedRuntimeCallbackTx(tx, legacy, null)).toBeNull();
      admitted.resolve();
      await release.promise;
    }, { timeout: 10_000 });
    try {
      await admitted.promise;
      expect((await claimHostedRuntime({ prisma, userId: other, processingMode: "default" })).status).toBe("claimed");
      await expect(prisma.$transaction(async tx => {
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '100ms'");
        await tx.hostedRuntimeOwner.update({ where: { userId: legacy }, data: { migrationPhase: "importing", migrationId: "synthetic_seal" } });
      })).rejects.toThrow();
    } finally {
      release.resolve();
      await callback;
    }
    await prisma.hostedRuntimeOwner.update({ where: { userId: legacy }, data: { migrationPhase: "importing", migrationId: "synthetic_seal" } });
    await expect(prisma.$transaction(tx => requireHostedRuntimeCallbackTx(tx, legacy, null))).rejects.toMatchObject({ code: "HOSTED_RUNTIME_OWNER_STALE" });
  });

  it("serializes default ownership even after the canonical member was deleted", async () => {
    const userId = await member(false);
    const results = await Promise.all([
      prisma.$transaction(tx => lockHostedRuntimeMemberCutoverTx(tx, userId)),
      prisma.$transaction(tx => lockHostedRuntimeMemberCutoverTx(tx, userId)),
    ]);
    expect(results).toEqual(["legacy", "legacy"]);
    expect(await prisma.hostedRuntimeOwner.count({ where: { userId } })).toBe(1);
    await prisma.hostedRuntimeOwner.update({ where: { userId }, data: { migrationPhase: "postgres" } });
    expect(await claimHostedRuntime({ prisma, userId, processingMode: "default" })).toEqual({ status: "blocked", reason: "admission" });
  });

  it("excludes unfinished imports before the cleanup batch limit", async () => {
    const importing = await member(false);
    const migrated = await member(false);
    await prisma.hostedRuntimeOwner.createMany({ data: [
      { userId: importing, migrationPhase: "importing", migrationId: "synthetic_import" },
      { userId: migrated, migrationPhase: "postgres" },
    ] });
    await prisma.hostedRuntimeOrphan.createMany({ data: [
      ...Array.from({ length: 60 }, (_, i) => ({
        userId: importing, kind: "snapshot", resourceId: `synthetic_pending_${i}`,
        objectKey: `synthetic_pending_${i}`, createdAt: new Date("2025-01-01T00:00:00Z"), cleanupAt: new Date("2025-01-01T00:00:00Z"),
      })),
      { userId: migrated, kind: "snapshot", resourceId: "synthetic_ready",
        objectKey: "synthetic_ready", createdAt: new Date("2025-01-01T00:00:00Z"), cleanupAt: new Date("2025-02-01T00:00:00Z") },
    ] });
    const result = await claimHostedRuntimeResourceCleanup({ prisma, now: new Date() });
    expect(result.orphans.map(row => row.resourceId)).toEqual(["synthetic_ready"]);
    expect(await prisma.hostedRuntimeOrphan.count({ where: { userId: importing, retiredAt: { not: null } } })).toBe(0);
  });
});

function latch() {
  let resolve: () => void = () => { throw new Error("Latch not initialized."); };
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
