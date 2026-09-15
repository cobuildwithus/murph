import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type { HostedRuntimeMigrationCommand, LegacyRuntimeExportPage } from "@murphai/hosted-execution/runtime-migration";
import { hostedMediaObjectKey } from "@murphai/hosted-execution/storage-paths";
import { createPrismaClient } from "@/src/lib/prisma";
import { executeHostedRuntimeMigrationCommand } from "@/src/lib/hosted-execution/runtime-migration";
import { claimHostedRuntime } from "@/src/lib/hosted-execution/runtime-owner";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const databaseUrl = process.env.DATABASE_URL ?? "";
if (enabled) {
  const url = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.searchParams.has('host')) throw new Error("Migration proof requires loopback PostgreSQL.");
}
const identity = { namespaceId: "synthetic_namespace", workerVersion: "synthetic_version" };
const objectId = "a".repeat(64);
const emptyObjectId = "b".repeat(64);
const digest = (text: string) => createHash("sha256").update(text).digest("hex");

describe.skipIf(!enabled)("Postgres fleet migration", () => {
  let prisma: PrismaClient;
  let originalGate: Awaited<ReturnType<PrismaClient['hostedRuntimeCutover']['findUniqueOrThrow']>>;
  const userId = `migration_proof_${randomUUID()}`;
  const mediaId = "c".repeat(64);
  const command = (command: HostedRuntimeMigrationCommand) => executeHostedRuntimeMigrationCommand({ prisma, command });
  beforeAll(async () => {
    prisma = createPrismaClient({ databaseUrl, poolMax: 2 });
    if (await prisma.hostedRuntimeLegacyImport.count()) throw new Error("Synthetic migration proof requires an unused migration inventory.");
    originalGate = await prisma.hostedRuntimeCutover.findUniqueOrThrow({ where: { id: "runtime" } });
    if (originalGate.namespaceId) throw new Error("Synthetic migration proof requires an unused cutover record.");
    await prisma.hostedRuntimeCutover.update({ where: { id: "runtime" }, data: { phase: "legacy" } });
  });
  afterAll(async () => {
    if (originalGate) {
      await prisma.hostedRuntimeLegacyImport.deleteMany({ where: { objectId: { in: [objectId, emptyObjectId] } } });
      await prisma.hostedRuntimeMedia.deleteMany({ where: { userId } });
      await prisma.hostedRuntimeOwner.deleteMany({ where: { userId } });
      await prisma.hostedMember.deleteMany({ where: { id: userId } });
      await prisma.hostedRuntimeCutover.update({ where: { id: "runtime" }, data: originalGate });
    }
    await prisma?.$disconnect();
  });
  it("resumes exact pages, preserves terminal resources without a member, and activates only a complete frozen inventory", async () => {
    await command({ operation: "begin", ...identity });
    expect((await claimHostedRuntime({ prisma, userId, processingMode: "default" })).status).toBe("blocked");
    await expect(command({ operation: "begin", ...identity, workerVersion: "different_version" })).rejects.toThrow("changed");
    await command({ operation: "inventory", ...identity, after: "", objectIds: [objectId, emptyObjectId], complete: true });
    const inventoryHash = digest(`${digest(`${digest("")}\n${objectId}`)}\n${emptyObjectId}`);
    const activation = { operation: "activate" as const, ...identity, inventoryCount: 2, inventoryHash };
    await expect(command(activation)).rejects.toThrow("incomplete");
    const first = page(0, [{ kind: "media", key: mediaId, value: {
      media_id: mediaId, user_id: userId, media_kind: "image", byte_size: 10, sha256: mediaId,
      expires_at: null, retired_at: "2026-01-01T00:00:00.000Z", purged_at: null, revision: 0,
      object_key: await hostedMediaObjectKey({ userId, mediaId }), updated_at: "2026-01-01T00:00:00.000Z",
    } }]);
    await expect(command({ operation: "import", ...identity, objectId, page: { ...first, hash: "0".repeat(64) } })).rejects.toThrow("hash");
    await command({ operation: "import", ...identity, objectId, page: first });
    await command({ operation: "import", ...identity, objectId, page: first });
    expect(await prisma.hostedRuntimeMedia.count({ where: { userId } })).toBe(1);
    expect(await prisma.hostedRuntimeOwner.findUniqueOrThrow({ where: { userId } })).toMatchObject({ generation: 17n, phase: "idle", attemptId: null, platformAiUsageAllowed: false });
    expect(await prisma.hostedRuntimeMedia.findFirstOrThrow({ where: { userId } })).toMatchObject({ registered: true, retiredAt: new Date("2026-01-01T00:00:00.000Z"), revision: 1n });
    await expect(command({ operation: "import", ...identity, objectId, page: page(3) })).rejects.toThrow("cursor");
    for (let section = 1; section <= 3; section++) await command({ operation: "import", ...identity, objectId, page: page(section) });
    await expect(command(activation)).rejects.toThrow("incomplete");
    for (let section = 0; section <= 3; section++) await command({ operation: "import", ...identity, objectId: emptyObjectId, page: page(section, [], null) });
    await expect(command({ ...activation, inventoryHash: "0".repeat(64) })).rejects.toThrow("does not match");
    await command(activation);
    await command(activation);
    await expect(command({ operation: "import", ...identity, objectId, page: first })).rejects.toThrow("draining");
    await prisma.hostedMember.create({ data: { id: userId, billingStatus: "active" } });
    const claimed = await claimHostedRuntime({ prisma, userId, processingMode: "default" });
    expect(claimed.status).toBe("claimed");
    if (claimed.status !== "blocked") expect(claimed.owner.generation).toBe(18n);
  });
  function page(section: number, records: LegacyRuntimeExportPage['records'] = [], member: string | null = userId): LegacyRuntimeExportPage {
    const payload = { schema: "murph.legacy-runtime-export.v1" as const, userId: member, generation: member ? "17" : "0",
      cursor: { section, after: "" }, next: section < 3 ? { section: section + 1, after: "" } : null, records };
    return { ...payload, hash: digest(JSON.stringify(payload)) };
  }
});
