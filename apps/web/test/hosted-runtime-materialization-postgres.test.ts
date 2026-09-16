import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
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
  const groups: string[] = [];
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
    await prisma.hostedGroup.deleteMany({ where: { id: { in: groups } } });
    await prisma.hostedRuntimeOrphan.deleteMany({ where: { userId: { in: members } } });
    await prisma.hostedMember.deleteMany({ where: { id: { in: members } } });
    await prisma.hostedRuntimeOwner.deleteMany({ where: { userId: { in: members } } });
    await prisma.hostedRuntimeCutover.update({ where: { id: "runtime" }, data: original });
  });
  afterAll(async () => { await prisma?.$disconnect(); });

  it("enrolls canonical members omitted by the provider and retains deleted identities", async () => {
    const userId = await member(); const deletedId = await member();
    await command({ operation: "begin_rolling", ...campaign });
    expect(await command({ operation: "list_unenrolled", ...campaign })).toEqual({ userIds: [userId, deletedId].sort() });
    await prisma.hostedMember.delete({ where: { id: deletedId } });
    await command({ operation: "discover", ...campaign, objectIds: [], complete: true });
    await expect(command({ operation: "close_legacy_creation", ...campaign })).rejects.toThrow("unenrolled canonical");
    expect(await command({ operation: "list_unenrolled", ...campaign })).toEqual({ userIds: [userId, deletedId].sort() });
    const bindings = [{ userId, objectId: object() }, { userId: deletedId, objectId: object() }];
    await command({ operation: "enroll_sources", ...campaign, bindings });
    await command({ operation: "enroll_sources", ...campaign, bindings });
    expect(await command({ operation: "list_unenrolled", ...campaign })).toEqual({ userIds: [] });
    for (const binding of bindings) {
      expect(await prisma.hostedRuntimeLegacyImport.findUnique({ where: { objectId: binding.objectId } }))
        .toMatchObject({ admittedUserId: binding.userId, userId: null, completedAt: null });
    }
    await command({ operation: "close_legacy_creation", ...campaign });
    expect(await resolve(userId, bindings[0]!.objectId)).toMatchObject({ cutover: "legacy" });
    expect(await prisma.hostedRuntimeOwner.findUnique({ where: { userId: deletedId } })).toMatchObject({ migrationPhase: "legacy" });
  });

  it("includes group runtimes and retained resource owners without source data", async () => {
    const personal = await member(); const groupRuntime = await member();
    const groupId = `enrollment_group_${randomUUID()}`; groups.push(groupId);
    await prisma.hostedGroup.create({ data: { id: groupId, ownerMemberId: personal, runtimeMemberId: groupRuntime } });
    const retained = `enrollment_retained_${randomUUID()}`; members.push(retained);
    await prisma.hostedRuntimeOrphan.create({ data: { userId: retained, resourceId: "synthetic-orphan", kind: "snapshot",
      objectKey: "synthetic-retained-snapshot", createdAt: new Date(), cleanupAt: new Date() } });
    await command({ operation: "begin_rolling", ...campaign });
    expect(await command({ operation: "list_unenrolled", ...campaign })).toEqual({ userIds: [personal, groupRuntime, retained].sort() });
    const bindings = [personal, groupRuntime, retained].map(userId => ({ userId, objectId: object() }));
    await command({ operation: "enroll_sources", ...campaign, bindings });
    expect(await command({ operation: "list_unenrolled", ...campaign })).toEqual({ userIds: [] });
    expect(await prisma.hostedRuntimeOwner.findUnique({ where: { userId: retained } })).toMatchObject({ migrationPhase: "legacy" });
    expect(await prisma.hostedRuntimeLegacyImport.count({ where: { completedAt: { not: null } } })).toBe(0);
  });

  it("bounds enrollment pages and includes a new creation between pages", async () => {
    const ids = Array.from({ length: 101 }, () => `enrollment_page_${randomUUID()}`).sort(); members.push(...ids);
    await prisma.hostedMember.createMany({ data: ids.map(id => ({ id, billingStatus: "active" })) });
    await command({ operation: "begin_rolling", ...campaign });
    const first = await command({ operation: "list_unenrolled", ...campaign });
    expect(first).toEqual({ userIds: ids.slice(0, 100) });
    const bindings = ids.slice(0, 100).map(userId => ({ userId, objectId: object() }));
    await command({ operation: "enroll_sources", ...campaign, bindings });
    const created = await member();
    expect(await command({ operation: "list_unenrolled", ...campaign })).toEqual({ userIds: [ids[100]!, created].sort() });
    await command({ operation: "enroll_sources", ...campaign, bindings: [ids[100]!, created].map(userId => ({ userId, objectId: object() })) });
    expect(await prisma.hostedRuntimeOwner.findUnique({ where: { userId: created } })).toMatchObject({ migrationPhase: "pending" });
    expect(await command({ operation: "list_unenrolled", ...campaign })).toEqual({ userIds: [] });
  });

  it("rolls back a conflicting enrollment page without changing prior source identity", async () => {
    const first = await member(); const second = await member(); const occupied = object(); const fresh = object();
    await command({ operation: "begin_rolling", ...campaign });
    await command({ operation: "enroll_sources", ...campaign, bindings: [{ userId: first, objectId: occupied }] });
    await expect(command({ operation: "enroll_sources", ...campaign, bindings: [
      { userId: second, objectId: occupied }, { userId: first, objectId: fresh },
    ] })).rejects.toThrow();
    expect(await prisma.hostedRuntimeLegacyImport.findUnique({ where: { objectId: occupied } })).toMatchObject({ admittedUserId: first, userId: null });
    expect(await prisma.hostedRuntimeLegacyImport.findUnique({ where: { objectId: fresh } })).toBeNull();
    expect(await prisma.hostedRuntimeOwner.findUnique({ where: { userId: second } })).toBeNull();
    await prisma.hostedRuntimeLegacyImport.update({ where: { objectId: occupied }, data: { admittedUserId: null, userId: first } });
    await expect(command({ operation: "enroll_sources", ...campaign, bindings: [{ userId: second, objectId: occupied }] }))
      .rejects.toThrow("conflicts");
    expect(await prisma.hostedRuntimeLegacyImport.findUnique({ where: { objectId: occupied } })).toMatchObject({ admittedUserId: null, userId: first });
  });

  it("retains the selected source if an earlier ID appears before reservation is acknowledged", async () => {
    const [late, selected, next] = [object(), object(), object()].sort() as [string, string, string];
    await command({ operation: "begin_rolling", ...campaign });
    await command({ operation: "discover", ...campaign, objectIds: [selected, next], complete: true });
    await command({ operation: "close_legacy_creation", ...campaign });
    await command({ operation: "inventory", ...campaign, after: "", objectIds: [selected, next], complete: true });
    // The caller may now persist a local barrier and lose its reservation reply.
    expect(await command({ operation: "next_object", ...campaign })).toEqual({ objectId: selected });
    const sealed = await prisma.hostedRuntimeCutover.findUniqueOrThrow({ where: { id: "runtime" } });
    await command({ operation: "discover", ...campaign, objectIds: [late], complete: true });
    expect(await Promise.all([command({ operation: "next_object", ...campaign }), command({ operation: "next_object", ...campaign })]))
      .toEqual([{ objectId: selected }, { objectId: selected }]);
    expect(await prisma.hostedRuntimeLegacyImport.findUnique({ where: { objectId: late } })).toMatchObject({ inventoryClass: "late" });
    expect(await prisma.hostedRuntimeCutover.findUniqueOrThrow({ where: { id: "runtime" } })).toMatchObject({
      selectedObjectId: selected, inventoryHash: sealed.inventoryHash, inventoryCount: sealed.inventoryCount,
    });
    await expect(command({ operation: "read_object", ...campaign, objectId: late })).rejects.toThrow("selected object");
    await prisma.hostedRuntimeLegacyImport.update({ where: { objectId: selected }, data: { completedAt: new Date(), generation: 0n } });
    expect(await command({ operation: "next_object", ...campaign })).toEqual({ objectId: next });
    await prisma.hostedRuntimeLegacyImport.update({ where: { objectId: next }, data: { completedAt: new Date(), generation: 0n } });
    expect(await command({ operation: "next_object", ...campaign })).toEqual({ objectId: late });
  });

  it("polls an unfinished selection without waiting for ordinary shared campaign holders", async () => {
    const source = object();
    await command({ operation: "begin_rolling", ...campaign });
    await command({ operation: "discover", ...campaign, objectIds: [source], complete: true });
    await command({ operation: "close_legacy_creation", ...campaign });
    await command({ operation: "inventory", ...campaign, after: "", objectIds: [source], complete: true });
    expect(await command({ operation: "next_object", ...campaign })).toEqual({ objectId: source });
    let release!: () => void; let locked!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { locked = resolve; });
    const ordinary = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM hosted_runtime_cutover WHERE id = 'runtime' FOR SHARE`;
      locked(); await held;
    });
    await ready;
    const polling = command({ operation: "next_object", ...campaign });
    try {
      expect(await Promise.race([polling, delay(1_000).then(() => "blocked")])).toEqual({ objectId: source });
    } finally { release(); await ordinary; await polling; }
  });

  it("keeps new member and late materialization enrollment outside the original seal and legacy admission", async () => {
    await command({ operation: "begin_rolling", ...campaign });
    await command({ operation: "discover", ...campaign, objectIds: [], complete: true });
    await command({ operation: "close_legacy_creation", ...campaign });
    await command({ operation: "inventory", ...campaign, after: "", objectIds: [], complete: true });
    const originalSeal = await prisma.hostedRuntimeCutover.findUniqueOrThrow({ where: { id: "runtime" } });
    const created = await member(); const createdSource = object();
    await command({ operation: "enroll_sources", ...campaign, bindings: [{ userId: created, objectId: createdSource }] });
    expect(await prisma.hostedRuntimeOwner.findUnique({ where: { userId: created } })).toMatchObject({ migrationPhase: "pending" });
    expect(await prisma.hostedRuntimeLegacyImport.findUnique({ where: { objectId: createdSource } })).toMatchObject({ inventoryClass: "late", admittedUserId: created });
    const historical = `materialization_deleted_${randomUUID()}`; members.push(historical); const historicalSource = object();
    expect(await resolve(historical, historicalSource)).toMatchObject({ cutover: "draining" });
    expect(await resolve(historical, historicalSource)).toMatchObject({ cutover: "draining" });
    expect(await prisma.hostedRuntimeOwner.findUnique({ where: { userId: historical } })).toMatchObject({ migrationPhase: "legacy" });
    expect(await prisma.hostedRuntimeLegacyImport.findUnique({ where: { objectId: historicalSource } })).toMatchObject({ inventoryClass: "late", admittedUserId: historical, completedAt: null });
    const gate = await prisma.hostedRuntimeCutover.findUniqueOrThrow({ where: { id: "runtime" } });
    expect(gate.inventoryHash).toBe(originalSeal.inventoryHash); expect(gate.inventoryCount).toBe(0);
  });

  it("classifies post-closure discovery as late even before the first seal page", async () => {
    const baseline = object(); const late = object();
    await command({ operation: "begin_rolling", ...campaign });
    await command({ operation: "discover", ...campaign, objectIds: [baseline], complete: true });
    await command({ operation: "close_legacy_creation", ...campaign });
    await command({ operation: "discover", ...campaign, objectIds: [late], complete: true });
    const historical = `materialization_closed_${randomUUID()}`; members.push(historical);
    expect(await resolve(historical, late)).toMatchObject({ cutover: "draining" });
    expect(await prisma.hostedRuntimeLegacyImport.findUnique({ where: { objectId: late } })).toMatchObject({ inventoryClass: "late" });
    await command({ operation: "inventory", ...campaign, after: "", objectIds: [baseline], complete: true });
    expect(await prisma.hostedRuntimeCutover.findUniqueOrThrow({ where: { id: "runtime" } })).toMatchObject({ inventoryCount: 1 });
  });

  it("keeps the baseline cursor valid when an earlier late source appears during sealing", async () => {
    const [late, first, second] = [object(), object(), object()].sort() as [string, string, string];
    await command({ operation: "begin_rolling", ...campaign });
    await command({ operation: "discover", ...campaign, objectIds: [first, second], complete: true });
    await command({ operation: "close_legacy_creation", ...campaign });
    await command({ operation: "inventory", ...campaign, after: "", objectIds: [first], complete: false });
    await command({ operation: "discover", ...campaign, objectIds: [late, first], complete: true });
    await command({ operation: "inventory", ...campaign, after: first, objectIds: [second], complete: true });
    expect(await prisma.hostedRuntimeCutover.findUniqueOrThrow({ where: { id: "runtime" } })).toMatchObject({ inventoryCount: 2, inventoryAfter: second });
    expect(await prisma.hostedRuntimeLegacyImport.findUnique({ where: { objectId: first } })).toMatchObject({ inventoryClass: "baseline" });
    expect(await prisma.hostedRuntimeLegacyImport.findUnique({ where: { objectId: late } })).toMatchObject({ inventoryClass: "late" });
  });

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
    const discoveredLate = object();
    await command({ operation: "discover", ...campaign, objectIds: [discoveredLate], complete: true });
    expect(await prisma.hostedRuntimeLegacyImport.findUnique({ where: { objectId: discoveredLate } })).toMatchObject({ inventoryClass: "late" });
  });

  it("requires exact enrollment of an undiscovered older member before creation closes", async () => {
    const userId = await member(); const objectId = object();
    await command({ operation: "begin_rolling", ...campaign });
    await command({ operation: "discover", ...campaign, objectIds: [], complete: true });
    await expect(command({ operation: "close_legacy_creation", ...campaign })).rejects.toThrow("unenrolled canonical");
    await command({ operation: "enroll_sources", ...campaign, bindings: [{ userId, objectId }] });
    await command({ operation: "close_legacy_creation", ...campaign });
    expect(await resolve(userId, objectId)).toMatchObject({ cutover: "legacy", owner: { generation: "0", phase: "idle" } });
    expect(await prisma.hostedRuntimeLegacyImport.findUnique({ where: { objectId } })).toMatchObject({ admittedUserId: userId, completedAt: null });
    expect(await prisma.hostedRuntimeOwner.findUnique({ where: { userId } })).toMatchObject({ migrationPhase: "legacy" });
  });

  it("rejects contradictory member/object bindings and cannot hide an earlier intent", async () => {
    const userId = await member(); const other = await member(); const objectId = object();
    await resolve(userId, objectId);
    await expect(resolve(other, objectId)).rejects.toThrow("different member");
    await expect(resolve(userId, object())).rejects.toThrow();
    await command({ operation: "begin_rolling", ...campaign });
    await command({ operation: "discover", ...campaign, objectIds: [objectId], complete: true });
    await command({ operation: "enroll_sources", ...campaign, bindings: [{ userId: other, objectId: object() }] });
    await command({ operation: "close_legacy_creation", ...campaign });
    await expect(resolve(userId, object())).rejects.toThrow();
    expect(await prisma.hostedRuntimeOwner.findUnique({ where: { userId } })).toMatchObject({ migrationPhase: "legacy" });
  });

  it("keeps stale releases away from creation admission while preserving current legacy routing", async () => {
    const userId = await member(); const objectId = object();
    await command({ operation: "begin_rolling", ...campaign });
    expect(await resolve(userId, objectId, "old_version")).toMatchObject({ cutover: "draining" });
    expect(await prisma.hostedRuntimeLegacyImport.count()).toBe(0);
    expect(await resolve(userId, objectId)).toMatchObject({ cutover: "legacy" });
  });

  it("leaves empty-source activation to the explicit durable-wake handoff", async () => {
    const userId = await member(); const objectId = object();
    await resolve(userId, objectId);
    await command({ operation: "begin_rolling", ...campaign });
    await command({ operation: "discover", ...campaign, objectIds: [objectId], complete: true });
    await command({ operation: "close_legacy_creation", ...campaign });
    await prisma.hostedRuntimeLegacyImport.update({ where: { objectId }, data: { generation: 0n, completedAt: new Date() } });
    await prisma.hostedRuntimeOwner.update({ where: { userId }, data: { generation: 7n } });
    expect(await resolve(userId, objectId)).toMatchObject({ cutover: "draining" });
    expect(await prisma.hostedRuntimeOwner.findUnique({ where: { userId } })).toMatchObject({ migrationPhase: "legacy", generation: 7n });
    await prisma.hostedRuntimeOwner.update({ where: { userId }, data: { generation: 0n } });
    expect(await resolve(userId, objectId)).toMatchObject({ cutover: "draining" });
  });

  it("does not use an empty receipt to activate before legacy creation closes", async () => {
    const userId = await member(); const objectId = object();
    await resolve(userId, objectId);
    await prisma.hostedRuntimeLegacyImport.update({ where: { objectId }, data: { generation: 0n, completedAt: new Date() } });
    await expect(resolve(userId, objectId)).rejects.toThrow("closed legacy creation");
    expect(await prisma.hostedRuntimeOwner.findUnique({ where: { userId } })).toMatchObject({ migrationPhase: "legacy" });
  });
});
