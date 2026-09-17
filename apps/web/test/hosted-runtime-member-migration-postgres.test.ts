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

const campaign = { namespaceId: "synthetic_rolling_namespace", workerVersion: "synthetic_rolling_version",
  compatibility: { protocol: "member-handoff-v1", namespaceProbeId: "9".repeat(64) } };
const objectId = "c".repeat(64);
const otherObjectId = "d".repeat(64);
const emptyObjectId = "e".repeat(64);
const neverStartedObjectId = "f".repeat(63) + "0";
const deletedEmptyObjectId = "f".repeat(63) + "1";
const unprovisionedObjectId = "f".repeat(63) + "2";
const inventoryIds = [objectId, otherObjectId, emptyObjectId, neverStartedObjectId, deletedEmptyObjectId, unprovisionedObjectId];
const digest = (text: string) => createHash("sha256").update(text).digest("hex");

describe.skipIf(!enabled).each(["legacy", "pending"])("member-scoped canonical migration from %s", initialPhase => {
  let prisma: PrismaClient;
  let originalGate: Awaited<ReturnType<PrismaClient["hostedRuntimeCutover"]["findUniqueOrThrow"]>>;
  const userId = `rolling_proof_${randomUUID()}`;
  const otherId = `rolling_other_${randomUUID()}`;
  const emptyMemberId = `rolling_empty_${randomUUID()}`;
  const neverStartedId = `rolling_never_${randomUUID()}`;
  const deletedEmptyId = `rolling_deleted_empty_${randomUUID()}`;
  const unprovisionedId = `rolling_unprovisioned_${randomUUID()}`;
  const identity = { ...campaign, objectId, userId, migrationId: "synthetic_handoff" };
  const other = { ...campaign, objectId: otherObjectId, userId: otherId, migrationId: "synthetic_other_handoff" };
  const command = (command: HostedRuntimeMigrationCommand) => executeHostedRuntimeMigrationCommand({ prisma, command });
  beforeAll(async () => {
    prisma = createPrismaClient({ databaseUrl, poolMax: 5 });
    if (await prisma.hostedRuntimeLegacyImport.count()) throw new Error("Synthetic proof requires an unused migration inventory.");
    originalGate = await prisma.hostedRuntimeCutover.findUniqueOrThrow({ where: { id: "runtime" } });
    if (originalGate.namespaceId) throw new Error("Synthetic proof requires an unused cutover record.");
    await prisma.hostedRuntimeCutover.update({ where: { id: "runtime" }, data: { phase: "legacy" } });
    if (initialPhase === "pending") await command({ operation: "begin_rolling", ...campaign });
    await prisma.hostedMember.create({ data: { id: userId, billingStatus: "active" } });
    await provisionHostedCryptoDomainRootsForUser({ prisma, userId, reason: "synthetic-rolling-proof" });
    for (const id of [emptyMemberId, neverStartedId]) {
      await prisma.hostedMember.create({ data: { id, billingStatus: "active" } });
      await provisionHostedCryptoDomainRootsForUser({ prisma, userId: id, reason: "synthetic-rolling-proof" });
    }
    // Members created before their crypto roots exist keep a member row with no
    // ingress envelope, which is the fleet state that blocked empty activation.
    await prisma.hostedMember.create({ data: { id: unprovisionedId, billingStatus: "active" } });
  });
  afterAll(async () => {
    if (originalGate) {
      await prisma.hostedRuntimeLegacyImport.deleteMany({ where: { objectId: { in: inventoryIds } } });
      await prisma.hostedMember.deleteMany({ where: { id: { in: [userId, emptyMemberId, neverStartedId, unprovisionedId] } } });
      await prisma.hostedRuntimeOwner.deleteMany({ where: { userId: { in: [userId, otherId] } } });
      await prisma.hostedRuntimeOwner.deleteMany({ where: { userId: { in: [emptyMemberId, neverStartedId, deletedEmptyId, unprovisionedId] } } });
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
    await command({ operation: "enroll_sources", ...campaign, bindings: [
      { userId, objectId }, { userId: emptyMemberId, objectId: emptyObjectId },
      { userId: neverStartedId, objectId: neverStartedObjectId },
      { userId: unprovisionedId, objectId: unprovisionedObjectId },
    ] });
    await command({ operation: "close_legacy_creation", ...campaign });
    await command({ operation: "inventory", ...campaign, after: "", objectIds: inventoryIds, complete: true });
    expect(await command({ operation: "next_object", ...campaign })).toEqual({ objectId });
    expect(await command({ operation: "read_member", ...identity })).toMatchObject({ member: { migrationPhase: initialPhase, migrationId: null } });
    const owner = await prisma.hostedRuntimeOwner.findUnique({ where: { userId } });
    expect(owner).toMatchObject({ migrationPhase: initialPhase, migrationId: null });
    expect(await prisma.hostedRuntimeLegacyImport.findUniqueOrThrow({ where: { objectId } })).toMatchObject({ userId: null, lastHash: null });
    await command({ operation: "quiesce_member", ...identity });
    expect(await readHostedRuntimeMemberBackend(prisma, userId)).toBe("legacy");
    expect(await readHostedRuntimeMemberBackend(prisma, otherId)).toBe("legacy");
    await expect(command({ operation: "quiesce_member", ...identity, migrationId: "wrong-token" })).rejects.toThrow("identity changed");
    await expect(command({ operation: "quiesce_member", ...identity, objectId: otherObjectId })).rejects.toThrow("selected object");
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
      await expect(command({ operation: "quiesce_member", ...other })).rejects.toThrow("selected object");
      expect(await prisma.$transaction(tx => lockHostedRuntimeMemberCutoverTx(tx, otherId))).toBe("legacy");
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
      const imported = { operation: "import_member" as const, ...identity, ...(section >= 2 ? { workerVersion: "synthetic_compatible_release" } : {}), page: page(userId, section) };
      await command(imported); await command(imported);
      expect(await readHostedRuntimeMemberBackend(prisma, userId)).toBe("draining");
    }
    expect(await prisma.hostedMailboxItem.count({ where: { userId } })).toBe(0);
    expect(await Promise.all([command({ operation: "next_object", ...campaign }), command({ operation: "next_object", ...campaign })]))
      .toEqual([{ objectId }, { objectId }]);
    await command({ operation: "activate_member", ...identity, workerVersion: "synthetic_compatible_release" });
    await command({ operation: "activate_member", ...identity, workerVersion: "synthetic_compatible_release" });
    expect(await readHostedRuntimeMemberBackend(prisma, userId)).toBe("postgres");
    expect(await readHostedRuntimeMemberBackend(prisma, otherId)).toBe("legacy");
    expect(await command({ operation: "next_object", ...campaign })).toEqual({ objectId: otherObjectId });
    const wakes = await prisma.hostedMailboxItem.findMany({ where: { userId }, select: { kind: true, dedupeKey: true, payloadInlineCiphertext: true } });
    expect(wakes).toHaveLength(1);
    expect(wakes[0]).toMatchObject({ kind: "runtime.maintenance-requested", dedupeKey: migrationWakeEventId(identity), payloadInlineCiphertext: expect.any(String) });
    await expect(command({ operation: "import_member", ...identity, page: page(userId, 0) })).rejects.toThrow("selected object");
    expect(await prisma.hostedRuntimeOwner.findUniqueOrThrow({ where: { userId } })).toMatchObject({ generation: 17n, migrationPhase: "postgres" });
  });

  it("migrates all enrolled members while retaining the guarded namespace", async () => {
    await command({ operation: "quiesce_member", ...other });
    await command({ operation: "freeze_member", ...other });
    for (let section = 0; section <= 3; section++) await command({ operation: "import_member", ...other, page: page(otherId, section) });
    await command({ operation: "activate_member", ...other });
    expect(await command({ operation: "next_object", ...campaign })).toEqual({ objectId: emptyObjectId });
    expect(await prisma.hostedMailboxItem.count({ where: { userId: otherId } })).toBe(0);
    await prisma.hostedRuntimeOwner.update({ where: { userId }, data: { phase: "starting", attemptId: "synthetic-active-attempt", allocationId: "synthetic-allocation", processingMode: "default" } });
    await prisma.hostedRuntimeLegacyImport.update({ where: { objectId: emptyObjectId }, data: { admittedUserId: emptyMemberId } });
    await expect(command({ operation: "settle_unmaterialized", ...campaign })).rejects.toThrow("every source disposition");
    await expect(command({ operation: "activate_empty", ...campaign, objectId: neverStartedObjectId })).rejects.toThrow("selected object");
    await expect(command({ operation: "activate_empty", ...campaign, objectId: emptyObjectId, workerVersion: "synthetic-stale", compatibility: undefined })).rejects.toThrow("sealed rolling census");
    await expect(command({ operation: "import_empty", ...campaign, objectId: emptyObjectId, page: page(userId, 0) })).rejects.toThrow("cannot import member state");
    await prisma.hostedRuntimeOwner.create({ data: { userId: deletedEmptyId } });
    await prisma.hostedRuntimeLegacyImport.update({ where: { objectId: deletedEmptyObjectId }, data: { admittedUserId: deletedEmptyId } });
    for (const [sourceObjectId, memberId] of [[emptyObjectId, emptyMemberId], [neverStartedObjectId, neverStartedId],
      [deletedEmptyObjectId, deletedEmptyId], [unprovisionedObjectId, unprovisionedId]]) {
      const wakeable = memberId !== deletedEmptyId && memberId !== unprovisionedId;
      expect(await command({ operation: "next_object", ...campaign })).toEqual({ objectId: sourceObjectId });
      const activate = { operation: "activate_empty" as const, ...campaign, objectId: sourceObjectId! };
      await expect(command(activate)).rejects.toThrow("complete exact empty-source receipt");
      for (let section = 0; section <= 3; section++) {
        const payload = { ...page(userId, section), userId: null, generation: "0" };
        const { hash: ignored, ...body } = payload;
        const empty = { operation: "import_empty" as const, ...campaign, objectId: sourceObjectId!, page: { ...body, hash: digest(JSON.stringify(body)) } };
        await command(empty); await command(empty);
      }
      // Even a completed empty export holds selection until its expected member
      // is activated. Other incomplete sources must not delay that activation.
      expect(await command({ operation: "next_object", ...campaign })).toEqual({ objectId: sourceObjectId });
      await prisma.hostedRuntimeOwner.update({ where: { userId: memberId }, data: { generation: 9n } });
      await expect(command(activate)).rejects.toThrow("prior runtime authority");
      await prisma.hostedRuntimeOwner.update({ where: { userId: memberId }, data: { generation: 0n } });
      if (sourceObjectId === emptyObjectId) {
        await prisma.hostedRuntimeLegacyImport.update({ where: { objectId: otherObjectId }, data: { userId: emptyMemberId } });
        await expect(command(activate)).rejects.toThrow("conflicting source identities");
        expect(await prisma.hostedMailboxItem.count({ where: { userId: emptyMemberId } })).toBe(0);
        await prisma.hostedRuntimeLegacyImport.update({ where: { objectId: otherObjectId }, data: { userId: otherId } });
      }
      if (sourceObjectId === deletedEmptyObjectId) {
        expect(await readHostedRuntimeMemberBackend(prisma, deletedEmptyId)).toBe("legacy");
      }
      if (sourceObjectId === unprovisionedObjectId) {
        // Every source is disposed here, so completion reports the one member
        // still awaiting its own activation rather than refusing to answer.
        expect(await command({ operation: "settle_unmaterialized", ...campaign })).toEqual({ done: false });
        expect(await readHostedRuntimeMemberBackend(prisma, unprovisionedId)).toBe(initialPhase === "legacy" ? "legacy" : "draining");
      }
      const [activated, retried] = await Promise.all([command(activate), command(activate)]);
      expect(activated).toEqual(retried);
      expect(activated).toMatchObject({ done: true, member: { userId: memberId,
        mailboxItemId: wakeable ? expect.any(String) : null } });
      expect(await readHostedRuntimeMemberBackend(prisma, memberId!)).toBe("postgres");
      const wakes = await prisma.hostedMailboxItem.findMany({ where: { userId: memberId }, select: { kind: true, payloadInlineCiphertext: true } });
      expect(wakes).toEqual(wakeable ? [{ kind: "runtime.maintenance-requested", payloadInlineCiphertext: expect.any(String) }] : []);
      if (sourceObjectId === emptyObjectId) {
        expect(await readHostedRuntimeMemberBackend(prisma, neverStartedId)).toBe(initialPhase === "legacy" ? "legacy" : "draining");
        expect(await prisma.hostedRuntimeLegacyImport.findUnique({ where: { objectId: neverStartedObjectId } })).toMatchObject({ completedAt: null });
      }
    }
    expect(await command({ operation: "next_object", ...campaign })).toEqual({ objectId: null });
    expect(await command({ operation: "settle_unmaterialized", ...campaign })).toEqual({ done: true });
    const inventoryHash = inventoryIds.reduce((hash, id) => digest(`${hash}\n${id}`), digest(""));
    await expect(command({ operation: "activate", ...campaign, inventoryCount: inventoryIds.length, inventoryHash }))
      .rejects.toThrow("namespace retirement requires separate proof");
    expect((await prisma.hostedRuntimeCutover.findUniqueOrThrow({ where: { id: "runtime" } })).phase).toBe("rolling");
    expect(await command({ operation: "begin_rolling", ...campaign })).toMatchObject({ gate: { phase: "rolling" } });
    for (const id of [userId, otherId, emptyMemberId, neverStartedId, deletedEmptyId, unprovisionedId]) {
      expect(await readHostedRuntimeMemberBackend(prisma, id)).toBe("postgres");
    }
  });
});

function page(userId: string, section: number): LegacyRuntimeExportPage {
  const payload = { schema: "murph.legacy-runtime-export.v1" as const, userId, generation: "17",
    cursor: { section, after: "" }, next: section < 3 ? { section: section + 1, after: "" } : null, records: [] };
  return { ...payload, hash: digest(JSON.stringify(payload)) };
}
