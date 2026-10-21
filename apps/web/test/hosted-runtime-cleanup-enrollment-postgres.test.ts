import { createHash, randomUUID } from "node:crypto";
import type { HostedRuntimeCutover, PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostedRuntimeMigrationCommand } from "@murphai/hosted-execution/runtime-migration";
import { createPrismaClient } from "@/src/lib/prisma";
import { executeHostedRuntimeMigrationCommand } from "@/src/lib/hosted-execution/runtime-migration";

import { prepareRuntimeCleanupEnrollment, retainRuntimeCleanupEnrollmentTx } from "@/src/lib/hosted-execution/runtime-migration-cleanup";

import { runHostedAccountDeletionCleanup } from "@/src/lib/hosted-privacy/account-deletion-cleanup";

const crypto = vi.hoisted(() => ({ decrypt: vi.fn() }));
vi.mock("@/src/lib/hosted-crypto/env", () => ({ getHostedWebCryptoConfig: () => ({ env: "test", gcpKms: { decrypt: crypto.decrypt } }) }));
const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const databaseUrl = process.env.DATABASE_URL ?? "";
if (enabled) {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost"].includes(url.hostname)
    || !/^\/murph_test_[a-z0-9_]+$/u.test(url.pathname) || url.searchParams.has("host")) throw new Error("Cleanup enrollment proof requires an isolated loopback database.");
}
const campaign = { namespaceId: "synthetic_cleanup_namespace", workerVersion: "synthetic_cleanup_version",
  compatibility: { protocol: "member-handoff-v1", namespaceProbeId: "9".repeat(64) } };

describe.skipIf(!enabled)("historical encrypted runtime enrollment", () => {
  let prisma: PrismaClient;
  let original: HostedRuntimeCutover;
  const cleanupIds: string[] = [];
  const memberIds: string[] = [];
  const objectIds: string[] = [];
  const command = (command: HostedRuntimeMigrationCommand) => executeHostedRuntimeMigrationCommand({ prisma, command });
  const identities = (count: number) => {
    const ids = Array.from({ length: count }, () => `synthetic_deleted_${randomUUID()}`); memberIds.push(...ids); return ids;
  };
  async function cleanup(ids: string[]) {
    const now = new Date(); const id = `synthetic_cleanup_${randomUUID()}`; cleanupIds.push(id);
    return prisma.hostedAccountDeletionCleanup.create({ data: { id, environment: "test", nextAttemptAt: now,
      kmsKeyName: "projects/murph-test/locations/global/keyRings/test/cryptoKeys/account-cleanup",
      payloadCiphertext: Buffer.from(JSON.stringify({ schema: "murph.hosted-account-deletion-cleanup.v1", runtimeMemberIds: ids,
        privyUserId: null, stripeCustomerIds: [] })).toString("base64"),
      cloudflareCompletedAt: now, stripeCompletedAt: now, runtimeLogsCompletedAt: now, temporalCompletedAt: now } });
  }
  async function bind(ids: string[]) {
    const bindings = ids.map(userId => ({ userId, objectId: createHash("sha256").update(userId).digest("hex") }));
    objectIds.push(...bindings.map(row => row.objectId));
    await command({ operation: "enroll_sources", ...campaign, bindings });
  }
  beforeAll(async () => {
    prisma = createPrismaClient({ databaseUrl, poolMax: 4 });
    original = await prisma.hostedRuntimeCutover.findUniqueOrThrow({ where: { id: "runtime" } });
    if (original.namespaceId || await prisma.hostedRuntimeLegacyImport.count()
      || await prisma.hostedAccountDeletionCleanup.count()) throw new Error("Cleanup proof requires an unused synthetic campaign.");
  });
  beforeEach(() => {
    crypto.decrypt.mockReset().mockImplementation(async ({ ciphertext }: { ciphertext: string }) => ({ plaintext: new Uint8Array(Buffer.from(ciphertext, "base64")) }));
  });
  afterEach(async () => {
    await prisma.hostedRuntimeCutover.update({ where: { id: "runtime" }, data: original });
    await prisma.hostedRuntimeLegacyImport.deleteMany({ where: { objectId: { in: objectIds } } });
    await prisma.hostedAccountDeletionCleanup.deleteMany({ where: { id: { in: cleanupIds } } });
    await prisma.hostedRuntimeOwner.deleteMany({ where: { userId: { in: memberIds } } });
  });
  afterAll(async () => { await prisma?.$disconnect(); });

  it("retains historical personal and group identities that exist only in encrypted cleanup", async () => {
    const ids = identities(2); await cleanup(ids);
    await command({ operation: "begin_rolling", ...campaign });
    expect(await command({ operation: "list_unenrolled", ...campaign })).toMatchObject({ userIds: [...ids].sort() });
    expect(await prisma.hostedRuntimeOwner.count({ where: { userId: { in: ids }, migrationPhase: "legacy" } })).toBe(2);
    expect(await prisma.hostedRuntimeLegacyImport.count()).toBe(0);
  });


  it("pages duplicate historical identities without skipping the remaining cleanup payload", async () => {
    const ids = identities(201); const receipt = await cleanup(ids);
    await command({ operation: "begin_rolling", ...campaign });
    await bind(ids.slice(0, 100));
    expect(await command({ operation: "list_unenrolled", ...campaign })).toEqual({ userIds: [], cleanupPending: true });
    expect(await prisma.hostedAccountDeletionCleanup.findUnique({ where: { id: receipt.id } })).toMatchObject({ runtimeMigrationNextIndex: 100 });
    expect(await command({ operation: "list_unenrolled", ...campaign })).toEqual({ userIds: ids.slice(100, 200).sort(), cleanupPending: true });
    await bind(ids.slice(100, 200));
    expect(await command({ operation: "list_unenrolled", ...campaign })).toEqual({ userIds: [ids[200]] });
    await bind(ids.slice(200));
    expect(await command({ operation: "list_unenrolled", ...campaign })).toEqual({ userIds: [] });
    expect(await prisma.hostedAccountDeletionCleanup.findUnique({ where: { id: receipt.id } })).toMatchObject({ runtimeMigrationNextIndex: null });
    expect(crypto.decrypt).toHaveBeenCalledTimes(3);
    expect(await prisma.hostedRuntimeOwner.count({ where: { userId: { in: ids } } })).toBe(201);
  });

  it("retains a completed vendor receipt until its runtime identities have independent owners", async () => {
    const ids = identities(1); const receipt = await cleanup(ids);
    await command({ operation: "begin_rolling", ...campaign });
    await command({ operation: "discover", ...campaign, objectIds: [], complete: true });
    await expect(command({ operation: "close_legacy_creation", ...campaign })).rejects.toThrow("unenrolled cleanup");
    await expect(prisma.hostedAccountDeletionCleanup.delete({ where: { id: receipt.id } })).rejects.toThrow("runtime enrollment");
    await command({ operation: "list_unenrolled", ...campaign });
    await prisma.hostedAccountDeletionCleanup.delete({ where: { id: receipt.id } });
    expect(await command({ operation: "list_unenrolled", ...campaign })).toEqual({ userIds: ids });
    await expect(command({ operation: "close_legacy_creation", ...campaign })).rejects.toThrow("unenrolled canonical");
    await bind(ids);
    await expect(command({ operation: "close_legacy_creation", ...campaign })).resolves.toMatchObject({ gate: { phase: "rolling" } });
  });

  it("does not hold database locks during decryption and fences concurrent page preparation", async () => {
    const ids = identities(101); const receipt = await cleanup(ids);
    await command({ operation: "begin_rolling", ...campaign });
    let ready!: () => void; let resume!: () => void; let calls = 0;
    const started = new Promise<void>(resolve => { ready = resolve; });
    const paused = new Promise<void>(resolve => { resume = resolve; });
    const plaintexts: Uint8Array[] = [];
    crypto.decrypt.mockImplementation(async ({ ciphertext }: { ciphertext: string }) => {
      calls++; if (calls === 2) ready(); await paused;
      const plaintext = new Uint8Array(Buffer.from(ciphertext, "base64")); plaintexts.push(plaintext); return { plaintext };
    });
    const requests = Promise.all([command({ operation: "list_unenrolled", ...campaign }), command({ operation: "list_unenrolled", ...campaign })]);
    await started;
    try {
      await prisma.$transaction(async tx => { await tx.$queryRaw`SELECT id FROM hosted_runtime_cutover WHERE id = 'runtime' FOR UPDATE NOWAIT`; });
    } finally { resume(); }
    const pages = await requests;
    expect(pages).toEqual([{ userIds: ids.slice(0, 100).sort(), cleanupPending: true }, { userIds: ids.slice(0, 100).sort(), cleanupPending: true }]);
    expect(await prisma.hostedAccountDeletionCleanup.findUnique({ where: { id: receipt.id } })).toMatchObject({ runtimeMigrationNextIndex: 100 });
    expect(plaintexts.every(bytes => bytes.every(byte => byte === 0))).toBe(true);
    expect(await prisma.hostedRuntimeOwner.findUnique({ where: { userId: ids[100]! } })).toBeNull();
  });

  it("does not advance on decryption failure or an incompatible caller", async () => {
    const ids = identities(1); const receipt = await cleanup(ids);
    await command({ operation: "begin_rolling", ...campaign });
    await expect(command({ operation: "list_unenrolled", ...campaign, namespaceId: "synthetic_wrong_namespace" })).rejects.toThrow("compatible rolling campaign");
    expect(crypto.decrypt).not.toHaveBeenCalled();
    crypto.decrypt.mockRejectedValueOnce(new Error("synthetic KMS unavailable"));
    await expect(command({ operation: "list_unenrolled", ...campaign })).rejects.toThrow("KMS unavailable");
    expect(await prisma.hostedAccountDeletionCleanup.findUnique({ where: { id: receipt.id } })).toMatchObject({ runtimeMigrationNextIndex: 0 });
    expect(await prisma.hostedRuntimeOwner.count({ where: { userId: { in: ids } } })).toBe(0);
  });

  it("revalidates the ciphertext and rolls back retained owners with their cursor", async () => {
    const ids = identities(1); const receipt = await cleanup(ids);
    await command({ operation: "begin_rolling", ...campaign });
    const prepared = await prepareRuntimeCleanupEnrollment(prisma, campaign);
    await expect(prisma.$transaction(async tx => {
      await retainRuntimeCleanupEnrollmentTx(tx, prepared); throw new Error("synthetic transaction rollback");
    })).rejects.toThrow("transaction rollback");
    expect(await prisma.hostedAccountDeletionCleanup.findUnique({ where: { id: receipt.id } })).toMatchObject({ runtimeMigrationNextIndex: 0 });
    expect(await prisma.hostedRuntimeOwner.count({ where: { userId: { in: ids } } })).toBe(0);
    await prisma.hostedAccountDeletionCleanup.update({ where: { id: receipt.id }, data: { payloadCiphertext: "synthetic changed ciphertext" } });
    await prisma.$transaction(tx => retainRuntimeCleanupEnrollmentTx(tx, prepared));
    expect(await prisma.hostedRuntimeOwner.count({ where: { userId: { in: ids } } })).toBe(0);
    expect(await prisma.hostedAccountDeletionCleanup.findUnique({ where: { id: receipt.id } })).toMatchObject({ runtimeMigrationNextIndex: 0 });
  });

  it("keeps late cleanup work pending without altering a sealed baseline", async () => {
    await command({ operation: "begin_rolling", ...campaign });
    await command({ operation: "discover", ...campaign, objectIds: [], complete: true });
    await command({ operation: "close_legacy_creation", ...campaign });
    await command({ operation: "inventory", ...campaign, objectIds: [], after: "", complete: true });
    const before = await prisma.hostedRuntimeCutover.findUniqueOrThrow({ where: { id: "runtime" } });
    const ids = identities(1); await cleanup(ids);
    expect(await command({ operation: "settle_unmaterialized", ...campaign })).toEqual({ done: false });
    expect(await command({ operation: "list_unenrolled", ...campaign })).toEqual({ userIds: ids });
    await bind(ids);
    expect(await prisma.hostedRuntimeLegacyImport.findMany({ select: { inventoryClass: true } })).toEqual([{ inventoryClass: "late" }]);
    expect(await prisma.hostedRuntimeCutover.findUniqueOrThrow({ where: { id: "runtime" } })).toEqual(before);
    await expect(command({ operation: "settle_unmaterialized", ...campaign })).rejects.toThrow("every source disposition");
  });

  it("preserves ordinary cleanup deletion before a rolling campaign", async () => {
    const receipt = await cleanup(identities(1));
    await expect(prisma.hostedAccountDeletionCleanup.delete({ where: { id: receipt.id } })).resolves.toMatchObject({ id: receipt.id });
    expect(crypto.decrypt).not.toHaveBeenCalled();
  });
  it.each([1, 201])("finishes later cleanup for %i identities through ordinary retries after the operator stops", async count => {
    await command({ operation: "begin_rolling", ...campaign });
    const ids = identities(count); const receipt = await cleanup(ids);
    await prisma.hostedRuntimeOwner.create({ data: { userId: ids[0]!, migrationPhase: "postgres", generation: 11n } });
    for (let retained = 0; retained < count; retained += 100) {
      expect(await runHostedAccountDeletionCleanup({ prisma, cleanupId: receipt.id })).toMatchObject({ cleanupPending: retained + 100 < count });
      expect(await prisma.hostedRuntimeOwner.count({ where: { userId: { in: ids } } })).toBe(Math.min(count, retained + 100));
    }
    expect(await prisma.hostedAccountDeletionCleanup.findUnique({ where: { id: receipt.id } })).toBeNull();
    expect(await prisma.hostedRuntimeOwner.findUnique({ where: { userId: ids[0]! } })).toMatchObject({ migrationPhase: "postgres", generation: 11n });
    expect(await prisma.hostedRuntimeLegacyImport.count()).toBe(0);
  });

});
