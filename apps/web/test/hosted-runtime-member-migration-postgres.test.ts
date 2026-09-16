import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type { HostedRuntimeMigrationCommand, LegacyRuntimeExportPage } from "@murphai/hosted-execution/runtime-migration";
import { createPrismaClient } from "@/src/lib/prisma";
import { executeHostedRuntimeMigrationCommand } from "@/src/lib/hosted-execution/runtime-migration";
import { migrationWakeEventId } from "@/src/lib/hosted-execution/runtime-member-migration";
import { lockHostedRuntimeMemberCutoverTx, readHostedRuntimeMemberBackend } from "@/src/lib/hosted-execution/runtime-cutover";
import { provisionHostedCryptoDomainRootsForUser } from "@/src/lib/hosted-crypto/domain-root-store";
vi.mock("@/src/lib/hosted-crypto/env", async () => {
  const { generateKeyPairSync } = await import("node:crypto");
  const { createHostedAuthorityVerifyKeyring } = await vi.importActual<
    typeof import("@murphai/runtime-state")
  >("@murphai/runtime-state");
  const { createHostedGcpKmsClientFromEnv } = await vi.importActual<
    typeof import("@/src/lib/hosted-crypto/gcp-kms")
  >("@/src/lib/hosted-crypto/gcp-kms");
  const authoritySignKeyVersionName =
    "projects/example/locations/global/keyRings/hosted/cryptoKeys/authority/cryptoKeyVersions/1";
  const authorityKey = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    privateKeyEncoding: { format: "jwk" },
    publicKeyEncoding: { format: "pem", type: "spki" },
  });
  const gcpKms = createHostedGcpKmsClientFromEnv({
    HOSTED_CRYPTO_ENV: "test",
    HOSTED_CRYPTO_GCP_KMS_API_ROOT: "local://murph-hosted-kms",
    HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK:
      JSON.stringify(authorityKey.privateKey),
    HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY: Buffer.alloc(32, 7).toString("base64"),
    NODE_ENV: "test",
  });

  const automation = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    selectActiveHostedCloudflareAutomationRecipient: () => ({ publicJwk: automation.publicKey.export({ format: "jwk" }), recipientKeyId: "synthetic-automation" }),
    getHostedWebCryptoConfig: () => ({
      authoritySignKeyVersionName,
      authoritySignPublicKeyPem: authorityKey.publicKey,
      authorityVerifyKeyring: createHostedAuthorityVerifyKeyring({
        activeKeyVersionName: authoritySignKeyVersionName,
        activePublicKeyPem: authorityKey.publicKey,
      }),
      env: "test",
      gcpKms,
      webWrapKmsKeyName:
        "projects/example/locations/global/keyRings/hosted/cryptoKeys/delete-race",
    }),
  };
});
const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const databaseUrl = process.env.DATABASE_URL ?? "";
if (enabled) {
  const url = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.searchParams.has('host')) throw new Error("Migration proof requires loopback PostgreSQL.");
}

const campaign = { namespaceId: "synthetic_rolling_namespace", workerVersion: "synthetic_rolling_version" };
const objectId = "c".repeat(64);
const otherObjectId = "d".repeat(64);
const emptyObjectId = "e".repeat(64);
const neverStartedObjectId = "f".repeat(63) + "0";
const deletedEmptyObjectId = "f".repeat(63) + "1";
const inventoryIds = [objectId, otherObjectId, emptyObjectId, neverStartedObjectId, deletedEmptyObjectId];
const digest = (text: string) => createHash("sha256").update(text).digest("hex");

describe.skipIf(!enabled)("member-scoped canonical migration", () => {
  let prisma: PrismaClient;
  let originalGate: Awaited<ReturnType<PrismaClient["hostedRuntimeCutover"]["findUniqueOrThrow"]>>;
  const userId = `rolling_proof_${randomUUID()}`;
  const otherId = `rolling_other_${randomUUID()}`;
  const emptyMemberId = `rolling_empty_${randomUUID()}`;
  const neverStartedId = `rolling_never_${randomUUID()}`;
  const deletedEmptyId = `rolling_deleted_empty_${randomUUID()}`;
  const identity = { ...campaign, objectId, userId, migrationId: "synthetic_handoff" };
  const other = { ...campaign, objectId: otherObjectId, userId: otherId, migrationId: "synthetic_other_handoff" };
  const command = (command: HostedRuntimeMigrationCommand) => executeHostedRuntimeMigrationCommand({ prisma, command });
  beforeAll(async () => {
    prisma = createPrismaClient({ databaseUrl, poolMax: 5 });
    if (await prisma.hostedRuntimeLegacyImport.count()) throw new Error("Synthetic proof requires an unused migration inventory.");
    originalGate = await prisma.hostedRuntimeCutover.findUniqueOrThrow({ where: { id: "runtime" } });
    if (originalGate.namespaceId) throw new Error("Synthetic proof requires an unused cutover record.");
    await prisma.hostedRuntimeCutover.update({ where: { id: "runtime" }, data: { phase: "legacy" } });
    await prisma.hostedMember.create({ data: { id: userId, billingStatus: "active" } });
    await provisionHostedCryptoDomainRootsForUser({ prisma, userId, reason: "synthetic-rolling-proof" });
    for (const id of [emptyMemberId, neverStartedId]) {
      await prisma.hostedMember.create({ data: { id, billingStatus: "active" } });
      await provisionHostedCryptoDomainRootsForUser({ prisma, userId: id, reason: "synthetic-rolling-proof" });
    }
  });
  afterAll(async () => {
    if (originalGate) {
      await prisma.hostedRuntimeLegacyImport.deleteMany({ where: { objectId: { in: inventoryIds } } });
      await prisma.hostedRuntimeOwner.deleteMany({ where: { userId: { in: [userId, otherId] } } });
      await prisma.hostedRuntimeOwner.deleteMany({ where: { userId: { in: [emptyMemberId, neverStartedId, deletedEmptyId] } } });
      await prisma.hostedMember.deleteMany({ where: { id: { in: [userId, emptyMemberId, neverStartedId] } } });
      await prisma.hostedRuntimeCutover.update({ where: { id: "runtime" }, data: originalGate });
    }
    await prisma?.$disconnect();
  });

  it("begins a rolling campaign without changing other members' admission", async () => {
    await command({ operation: "begin_rolling", ...campaign });
    await expect(command({ operation: "next_object", ...campaign })).rejects.toThrow("sealed");
    await expect(command({ operation: "begin", ...campaign })).rejects.toThrow("mode changed");
    await expect(command({ operation: "quiesce_member", ...identity })).rejects.toThrow("sealed");
    await command({ operation: "discover", ...campaign, objectIds: inventoryIds, complete: true });
    await command({ operation: "close_legacy_creation", ...campaign });
    await command({ operation: "inventory", ...campaign, after: "", objectIds: inventoryIds, complete: true });
    expect(await command({ operation: "next_object", ...campaign })).toEqual({ objectId });
    expect(await command({ operation: "read_member", ...identity })).toMatchObject({ member: { migrationPhase: "legacy", migrationId: null } });
    expect(await prisma.hostedRuntimeOwner.findUnique({ where: { userId } })).toBeNull();
    expect(await prisma.hostedRuntimeLegacyImport.findUniqueOrThrow({ where: { objectId } })).toMatchObject({ userId: null, lastHash: null });
    await command({ operation: "quiesce_member", ...identity });
    expect(await readHostedRuntimeMemberBackend(prisma, userId)).toBe("legacy");
    expect(await readHostedRuntimeMemberBackend(prisma, otherId)).toBe("legacy");
    await expect(command({ operation: "quiesce_member", ...identity, migrationId: "wrong-token" })).rejects.toThrow("identity changed");
    await expect(command({ operation: "quiesce_member", ...identity, objectId: otherObjectId })).rejects.toThrow("identity changed");
    await expect(command({ operation: "import_member", ...identity, page: page(userId, 0) })).rejects.toThrow("frozen");
  });

  it("waits for same-member callbacks while a different member continues through its shared campaign lock", async () => {
    let release!: () => void;
    let locked!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { locked = resolve; });
    const callback = prisma.$transaction(async tx => {
      expect(await lockHostedRuntimeMemberCutoverTx(tx, userId)).toBe("legacy");
      locked(); await held;
    });
    await ready;
    let finished = false;
    const freezing = command({ operation: "freeze_member", ...identity }).then(result => { finished = true; return result; });
    try {
      await command({ operation: "quiesce_member", ...other });
      expect(finished).toBe(false);
      expect(await readHostedRuntimeMemberBackend(prisma, otherId)).toBe("legacy");
    } finally { release(); }
    await callback;
    await freezing;
    expect(await readHostedRuntimeMemberBackend(prisma, userId)).toBe("draining");
  });

  it("imports exact pages under the member token and activates with one durable wake", async () => {
    await expect(command({ operation: "import_member", ...identity, page: page(otherId, 0) })).rejects.toThrow("own frozen");
    await expect(command({ operation: "activate_member", ...identity })).rejects.toThrow("complete frozen import");
    for (let section = 0; section <= 3; section++) {
      const imported = { operation: "import_member" as const, ...identity, page: page(userId, section) };
      await command(imported); await command(imported);
      expect(await readHostedRuntimeMemberBackend(prisma, userId)).toBe("draining");
    }
    expect(await prisma.hostedMailboxItem.count({ where: { userId } })).toBe(0);
    expect(await Promise.all([command({ operation: "next_object", ...campaign }), command({ operation: "next_object", ...campaign })]))
      .toEqual([{ objectId }, { objectId }]);
    await command({ operation: "activate_member", ...identity });
    await command({ operation: "activate_member", ...identity });
    expect(await readHostedRuntimeMemberBackend(prisma, userId)).toBe("postgres");
    expect(await readHostedRuntimeMemberBackend(prisma, otherId)).toBe("legacy");
    expect(await command({ operation: "next_object", ...campaign })).toEqual({ objectId: otherObjectId });
    const wakes = await prisma.hostedMailboxItem.findMany({ where: { userId }, select: { kind: true, dedupeKey: true, payloadInlineCiphertext: true } });
    expect(wakes).toHaveLength(1);
    expect(wakes[0]).toMatchObject({ kind: "runtime.maintenance-requested", dedupeKey: migrationWakeEventId(identity), payloadInlineCiphertext: expect.any(String) });
    await expect(command({ operation: "import_member", ...identity, page: page(userId, 0) })).rejects.toThrow("frozen");
    expect(await prisma.hostedRuntimeOwner.findUniqueOrThrow({ where: { userId } })).toMatchObject({ generation: 17n, migrationPhase: "postgres" });
  });

  it("migrates deleted-member obligations without a wake and closes despite active migrated execution", async () => {
    await command({ operation: "freeze_member", ...other });
    for (let section = 0; section <= 3; section++) await command({ operation: "import_member", ...other, page: page(otherId, section) });
    await command({ operation: "activate_member", ...other });
    expect(await command({ operation: "next_object", ...campaign })).toEqual({ objectId: emptyObjectId });
    expect(await prisma.hostedMailboxItem.count({ where: { userId: otherId } })).toBe(0);
    await prisma.hostedRuntimeOwner.update({ where: { userId }, data: { phase: "starting", attemptId: "synthetic-active-attempt", allocationId: "synthetic-allocation", processingMode: "default" } });
    await prisma.hostedRuntimeOwner.createMany({ data: [emptyMemberId, neverStartedId].map(userId => ({ userId })) });
    await prisma.hostedRuntimeLegacyImport.update({ where: { objectId: emptyObjectId }, data: { admittedUserId: emptyMemberId } });
    await expect(command({ operation: "settle_unmaterialized", ...campaign })).rejects.toThrow("every source disposition");
    await expect(command({ operation: "import_empty", ...campaign, objectId: emptyObjectId, page: page(userId, 0) })).rejects.toThrow("cannot import member state");
    for (const sourceObjectId of [emptyObjectId, neverStartedObjectId, deletedEmptyObjectId]) {
      for (let section = 0; section <= 3; section++) {
      const payload = { ...page(userId, section), userId: null, generation: "0" };
      const { hash: ignored, ...body } = payload;
      const empty = { operation: "import_empty" as const, ...campaign, objectId: sourceObjectId, page: { ...body, hash: digest(JSON.stringify(body)) } };
      await command(empty); await command(empty);
      }
    }
    expect(await prisma.hostedRuntimeLegacyImport.findUniqueOrThrow({ where: { objectId: emptyObjectId } })).toMatchObject({ userId: null, generation: 0n, completedAt: expect.any(Date) });
    expect(await command({ operation: "next_object", ...campaign })).toEqual({ objectId: null });
    await prisma.hostedRuntimeOwner.update({ where: { userId: emptyMemberId }, data: { generation: 9n } });
    await expect(command({ operation: "settle_unmaterialized", ...campaign })).rejects.toThrow("prior runtime authority");
    await prisma.hostedRuntimeOwner.update({ where: { userId: emptyMemberId }, data: { generation: 0n } });
    // Concurrent and lost-response retries cannot append a second activation wake.
    await Promise.all([command({ operation: "settle_unmaterialized", ...campaign }), command({ operation: "settle_unmaterialized", ...campaign })]);
    await expect(command({ operation: "settle_unmaterialized", ...campaign })).rejects.toThrow("exact empty-source receipt");
    expect(await readHostedRuntimeMemberBackend(prisma, neverStartedId)).toBe("legacy");
    expect(await prisma.hostedMailboxItem.count({ where: { userId: neverStartedId } })).toBe(0);
    await prisma.hostedRuntimeLegacyImport.update({ where: { objectId: neverStartedObjectId }, data: { admittedUserId: neverStartedId } });
    await command({ operation: "settle_unmaterialized", ...campaign });
    expect(await command({ operation: "settle_unmaterialized", ...campaign })).toEqual({ done: true });
    for (const id of [emptyMemberId, neverStartedId]) {
      expect(await readHostedRuntimeMemberBackend(prisma, id)).toBe("postgres");
      const wakes = await prisma.hostedMailboxItem.findMany({ where: { userId: id }, select: { kind: true, payloadInlineCiphertext: true } });
      expect(wakes).toEqual([{ kind: "runtime.maintenance-requested", payloadInlineCiphertext: expect.any(String) }]);
    }
    await prisma.hostedRuntimeOwner.create({ data: { userId: deletedEmptyId } });
    await expect(command({ operation: "settle_unmaterialized", ...campaign })).rejects.toThrow("exact empty-source receipt");
    await prisma.hostedRuntimeLegacyImport.update({ where: { objectId: deletedEmptyObjectId }, data: { admittedUserId: deletedEmptyId } });
    expect(await command({ operation: "settle_unmaterialized", ...campaign })).toEqual({ done: false, mailboxItemId: null });
    expect(await prisma.hostedMailboxItem.count({ where: { userId: deletedEmptyId } })).toBe(0);
    const inventoryHash = inventoryIds.reduce((hash, id) => digest(`${hash}\n${id}`), digest(""));
    await command({ operation: "activate", ...campaign, inventoryCount: inventoryIds.length, inventoryHash });
    expect((await prisma.hostedRuntimeCutover.findUniqueOrThrow({ where: { id: "runtime" } })).phase).toBe("postgres");
    expect(await command({ operation: "begin_rolling", ...campaign })).toMatchObject({ gate: { phase: "postgres" } });
  });
});

function page(userId: string, section: number): LegacyRuntimeExportPage {
  const payload = { schema: "murph.legacy-runtime-export.v1" as const, userId, generation: "17",
    cursor: { section, after: "" }, next: section < 3 ? { section: section + 1, after: "" } : null, records: [] };
  return { ...payload, hash: digest(JSON.stringify(payload)) };
}
