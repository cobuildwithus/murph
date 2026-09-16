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
    expect(await resolve(userId, object())).toMatchObject({ cutover: "draining" });
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
