import { randomBytes, randomUUID } from "node:crypto";
import type { PrismaClient, HostedRuntimeCutover } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { HostedRuntimeMigrationCommand } from "@murphai/hosted-execution/runtime-migration";
import { createPrismaClient } from "@/src/lib/prisma";
import { executeHostedRuntimeOwnerCommand } from "@/src/lib/hosted-execution/runtime-owner-control";
import { executeHostedRuntimeMigrationCommand } from "@/src/lib/hosted-execution/runtime-migration";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const databaseUrl = process.env.DATABASE_URL ?? "";
if (enabled) {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost"].includes(url.hostname)
    || !/^\/murph_test_[a-z0-9_]+$/u.test(url.pathname) || url.searchParams.has("host")) throw new Error("Materialization proof requires an isolated loopback database.");
}
const campaign = { namespaceId: "synthetic_namespace", workerVersion: "synthetic_version" };

describe.skipIf(!enabled)("finite legacy materialization census", () => {
  let prisma: PrismaClient;
  let original: HostedRuntimeCutover;
  const members: string[] = [];
  const objects: string[] = [];
  const command = (command: HostedRuntimeMigrationCommand) => executeHostedRuntimeMigrationCommand({ prisma, command });
  const resolve = (userId: string, objectId: string, workerVersion = campaign.workerVersion) => executeHostedRuntimeOwnerCommand({ prisma, userId, command: { operation: "resolve_legacy", objectId, workerVersion } });
  const object = () => { const id = randomBytes(32).toString("hex"); objects.push(id); return id; };
  async function member() {
    const id = `materialization_${randomUUID()}`; members.push(id);
    await prisma.hostedMember.create({ data: { id, billingStatus: "active" } }); return id;
  }
  beforeAll(async () => {
    prisma = createPrismaClient({ databaseUrl, poolMax: 4 });
    original = await prisma.hostedRuntimeCutover.findUniqueOrThrow({ where: { id: "runtime" } });
    if (original.namespaceId || await prisma.hostedRuntimeLegacyImport.count()) throw new Error("Materialization proof requires an unused synthetic campaign.");
  });
  beforeEach(async () => {
    await prisma.hostedRuntimeCutover.update({ where: { id: "runtime" }, data: { ...original, phase: "legacy" } });
  });
  afterEach(async () => {
    await prisma.hostedRuntimeLegacyImport.deleteMany({ where: { objectId: { in: objects } } });
    await prisma.hostedRuntimeOwner.deleteMany({ where: { userId: { in: members } } });
    await prisma.hostedMember.deleteMany({ where: { id: { in: members } } });
    await prisma.hostedRuntimeCutover.update({ where: { id: "runtime" }, data: original });
  });
  afterAll(async () => { await prisma?.$disconnect(); });

  it("persists first-use intent before a source call, including lost responses and member deletion", async () => {
    const userId = await member(); const objectId = object();
    expect(await resolve(userId, objectId)).toMatchObject({ cutover: "legacy" });
    expect(await resolve(userId, objectId)).toMatchObject({ cutover: "legacy" });
    await prisma.hostedMember.delete({ where: { id: userId } });
    expect(await resolve(userId, objectId)).toMatchObject({ cutover: "legacy" });
    expect(await prisma.hostedRuntimeLegacyImport.findUnique({ where: { objectId } })).toMatchObject({ admittedUserId: userId, userId: null, completedAt: null });
    expect(await prisma.hostedRuntimeLegacyImport.count()).toBe(1);
  });

  it("joins a provider census with an intent that arrived after its page passed", async () => {
    const first = object(); const late = object(); const userId = await member();
    await command({ operation: "begin_rolling", ...campaign });
    await command({ operation: "discover", ...campaign, objectIds: [first], complete: false });
    await expect(command({ operation: "close_legacy_creation", ...campaign })).rejects.toThrow("complete provider discovery");
    await resolve(userId, late);
    await command({ operation: "discover", ...campaign, objectIds: [], complete: true });
    await expect(command({ operation: "inventory", ...campaign, after: "", objectIds: [first], complete: true })).rejects.toThrow("creation is open");
    await command({ operation: "close_legacy_creation", ...campaign });
    const ids = [first, late].sort();
    expect(await command({ operation: "list_inventory", ...campaign, after: "" })).toMatchObject({ objects: ids.map(objectId => ({ objectId })), nextAfter: null });
    await expect(command({ operation: "inventory", ...campaign, after: "", objectIds: [ids[0]!], complete: true })).rejects.toThrow("omits");
    await command({ operation: "inventory", ...campaign, after: "", objectIds: ids, complete: true });
    expect(await resolve(userId, late)).toMatchObject({ cutover: "legacy" });
    await expect(command({ operation: "discover", ...campaign, objectIds: [object()], complete: true })).rejects.toThrow("unsealed");
  });

  it("routes an older member's first use directly to Postgres after creation closes", async () => {
    const userId = await member(); const objectId = object();
    await command({ operation: "begin_rolling", ...campaign });
    await command({ operation: "discover", ...campaign, objectIds: [], complete: true });
    await command({ operation: "close_legacy_creation", ...campaign });
    expect(await resolve(userId, objectId)).toMatchObject({ cutover: "postgres", owner: { generation: "0", phase: "idle" } });
    expect(await prisma.hostedRuntimeLegacyImport.findUnique({ where: { objectId } })).toBeNull();
    expect(await prisma.hostedRuntimeOwner.findUnique({ where: { userId } })).toMatchObject({ migrationPhase: "postgres" });
  });

  it("rejects contradictory member/object bindings and cannot hide an earlier intent", async () => {
    const userId = await member(); const other = await member(); const objectId = object();
    await resolve(userId, objectId);
    await expect(resolve(other, objectId)).rejects.toThrow("different member");
    await expect(resolve(userId, object())).rejects.toThrow();
    await command({ operation: "begin_rolling", ...campaign });
    await command({ operation: "discover", ...campaign, objectIds: [objectId], complete: true });
    await command({ operation: "close_legacy_creation", ...campaign });
    await expect(resolve(userId, object())).rejects.toThrow("unresolved");
    expect(await prisma.hostedRuntimeOwner.findUnique({ where: { userId } })).toMatchObject({ migrationPhase: "legacy" });
  });

  it("keeps stale releases away from creation admission while preserving current legacy routing", async () => {
    const userId = await member(); const objectId = object();
    await command({ operation: "begin_rolling", ...campaign });
    expect(await resolve(userId, objectId, "old_version")).toMatchObject({ cutover: "draining" });
    expect(await prisma.hostedRuntimeLegacyImport.count()).toBe(0);
    expect(await resolve(userId, objectId)).toMatchObject({ cutover: "legacy" });
  });

  it("uses a terminal empty-source receipt without reviving previous runtime authority", async () => {
    const userId = await member(); const objectId = object();
    await resolve(userId, objectId);
    await command({ operation: "begin_rolling", ...campaign });
    await command({ operation: "discover", ...campaign, objectIds: [objectId], complete: true });
    await command({ operation: "close_legacy_creation", ...campaign });
    await prisma.hostedRuntimeLegacyImport.update({ where: { objectId }, data: { generation: 0n, completedAt: new Date() } });
    await prisma.hostedRuntimeOwner.update({ where: { userId }, data: { generation: 7n } });
    await expect(resolve(userId, objectId)).rejects.toThrow("prior authority");
    await prisma.hostedRuntimeOwner.update({ where: { userId }, data: { generation: 0n } });
    expect(await resolve(userId, objectId)).toMatchObject({ cutover: "postgres" });
  });

  it("does not use an empty receipt to activate before legacy creation closes", async () => {
    const userId = await member(); const objectId = object();
    await resolve(userId, objectId);
    await prisma.hostedRuntimeLegacyImport.update({ where: { objectId }, data: { generation: 0n, completedAt: new Date() } });
    await expect(resolve(userId, objectId)).rejects.toThrow("closed legacy creation");
    expect(await prisma.hostedRuntimeOwner.findUnique({ where: { userId } })).toMatchObject({ migrationPhase: "legacy" });
  });
});
