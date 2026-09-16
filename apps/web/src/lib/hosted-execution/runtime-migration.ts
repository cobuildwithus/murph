import { createHash } from "node:crypto";
import { Prisma, type PrismaClient, type HostedRuntimeCutover } from "@prisma/client";
import { parseHostedRuntimeMigrationCommand, type HostedRuntimeMigrationCommand, type LegacyRuntimeExportPage } from "@murphai/hosted-execution/runtime-migration";
import { prepareLegacyMigrationResources, type LegacyMigrationResources } from "./runtime-migration-resources";
import { recordRuntimeOrphansTx } from "./runtime-orphans";

const INITIAL_CURSOR = { section: 0, after: "" };
const INITIAL_INVENTORY_HASH = digest("");
type MigrationCommand = Exclude<HostedRuntimeMigrationCommand, { operation: "status" | "inspect_object" }>;

/** Trusted, finite fleet operation. Every transition takes the exclusive gate;
 * canonical callbacks/claims take its shared lock. No network work enters it. */
export async function executeHostedRuntimeMigrationCommand(input: { prisma: PrismaClient; command: HostedRuntimeMigrationCommand }) {
  const command = parseHostedRuntimeMigrationCommand(input.command);
  if (command.operation === "status") return { gate: await input.prisma.hostedRuntimeCutover.findUniqueOrThrow({ where: { id: "runtime" } }) };
  if (command.operation === "inspect_object") throw new Error("Live inspection belongs to the source Worker.");
  const resources = command.operation === "import" ? await validatePage(command.page) : null;
  return input.prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM hosted_runtime_cutover WHERE id = 'runtime' FOR UPDATE`;
    const gate = await tx.hostedRuntimeCutover.findUniqueOrThrow({ where: { id: "runtime" } });
    if (command.operation === "begin") return { gate: await beginTx(tx, gate, command) };
    requireIdentity(gate, command);
    switch (command.operation) {
      case "inventory": return { gate: await inventoryTx(tx, gate, command) };
      case "read_object": return { object: projectImport(await tx.hostedRuntimeLegacyImport.findUniqueOrThrow({ where: { objectId: command.objectId } })) };
      case "import": return { object: projectImport(await importPageTx(tx, gate, command, resources!)) };
      case "activate": return { gate: await activateTx(tx, gate, command) };
    }
  }, { maxWait: 5_000, timeout: 5_000 });
}

async function beginTx(tx: Prisma.TransactionClient, gate: HostedRuntimeCutover, command: Extract<MigrationCommand, { operation: "begin" }>) {
  if (gate.phase !== "legacy") { requireIdentity(gate, command); return gate; }
  return tx.hostedRuntimeCutover.update({ where: { id: "runtime" }, data: {
    phase: "draining", namespaceId: command.namespaceId, workerVersion: command.workerVersion, inventoryHash: INITIAL_INVENTORY_HASH,
  } });
}
function requireIdentity(gate: HostedRuntimeCutover, command: MigrationCommand) {
  if (gate.namespaceId !== command.namespaceId || gate.workerVersion !== command.workerVersion) throw new Error("Migration namespace or serving Worker version changed.");
}
async function inventoryTx(tx: Prisma.TransactionClient, gate: HostedRuntimeCutover, command: Extract<MigrationCommand, { operation: "inventory" }>) {
  if (gate.phase !== "draining" || gate.inventorySealedAt || command.after !== gate.inventoryAfter
    || (!command.complete && command.objectIds.length === 0)) throw new Error("Migration inventory cursor is stale or sealed.");
  let previous = gate.inventoryAfter;
  let hash = gate.inventoryHash!;
  for (const id of command.objectIds) {
    if (id <= previous) throw new TypeError("Migration inventory must be strictly ordered and unique.");
    hash = digest(`${hash}\n${id}`);
    previous = id;
  }
  if (command.objectIds.length) await tx.hostedRuntimeLegacyImport.createMany({ data: command.objectIds.map(objectId => ({ objectId, nextCursor: INITIAL_CURSOR })) });
  return tx.hostedRuntimeCutover.update({ where: { id: "runtime" }, data: {
    inventoryAfter: previous, inventoryHash: hash, inventoryCount: { increment: command.objectIds.length },
    ...(command.complete ? { inventorySealedAt: new Date() } : {}),
  } });
}

async function importPageTx(tx: Prisma.TransactionClient, gate: HostedRuntimeCutover, command: Extract<MigrationCommand, { operation: "import" }>, resources: LegacyMigrationResources) {
  if (gate.phase !== "draining" || !gate.inventorySealedAt) throw new Error("Resource import requires the sealed draining inventory.");
  const row = await tx.hostedRuntimeLegacyImport.findUniqueOrThrow({ where: { objectId: command.objectId } });
  const page = command.page;
  if (sameCursor(row.lastCursor, page.cursor)) {
    if (row.lastHash !== page.hash) throw new Error("Frozen legacy export changed after import.");
    return row;
  }
  if (row.completedAt || !sameCursor(row.nextCursor, page.cursor)) throw new Error("Legacy import cursor is stale.");
  if (row.lastHash !== null && (row.userId !== page.userId || row.generation?.toString() !== page.generation)) throw new Error("Frozen legacy identity changed between pages.");
  if (page.userId) {
    await importHighWaterTx(tx, page.userId, BigInt(page.generation));
    // Conflicting identities fail instead of reviving or overwriting a tombstone.
    if (resources.media.length) await tx.hostedRuntimeMedia.createMany({ data: resources.media });
    if (resources.sessions.length) await tx.hostedRuntimeSnapshotUpload.createMany({ data: resources.sessions });
    await recordRuntimeOrphansTx(tx, page.userId, resources.orphans, new Date());
  }
  return tx.hostedRuntimeLegacyImport.update({ where: { objectId: command.objectId }, data: {
    userId: page.userId, generation: BigInt(page.generation), lastCursor: page.cursor, lastHash: page.hash,
    nextCursor: page.next ?? Prisma.JsonNull, completedAt: page.next === null ? new Date() : null,
  } });
}
async function importHighWaterTx(tx: Prisma.TransactionClient, userId: string, generation: bigint) {
  const existing = await tx.hostedRuntimeOwner.findUnique({ where: { userId } });
  if (existing && (existing.phase !== "idle" || existing.attemptId || existing.runnerContainerName)) throw new Error("Legacy import cannot overwrite runtime authority.");
  await tx.hostedRuntimeOwner.upsert({ where: { userId }, create: { userId, generation },
    update: { generation: existing && existing.generation > generation ? existing.generation : generation } });
}
async function activateTx(tx: Prisma.TransactionClient, gate: HostedRuntimeCutover, command: Extract<MigrationCommand, { operation: "activate" }>) {
  if (!gate.inventorySealedAt || command.inventoryHash !== gate.inventoryHash || command.inventoryCount !== gate.inventoryCount) throw new Error("Final namespace inventory does not match the sealed inventory.");
  if (gate.phase === "postgres") return gate;
  if (gate.phase !== "draining") throw new Error("Postgres activation requires the draining gate.");
  if (await tx.hostedRuntimeLegacyImport.findFirst({ where: { completedAt: null }, select: { objectId: true } })) throw new Error("Legacy resource import is incomplete.");
  if (await tx.hostedRuntimeOwner.findFirst({ where: { OR: [ { phase: { not: "idle" } }, { runnerContainerName: { not: null } }, { attemptId: { not: null } } ] }, select: { userId: true } })) throw new Error("Runtime targets remain active during migration.");
  return tx.hostedRuntimeCutover.update({ where: { id: "runtime" }, data: { phase: "postgres", activatedAt: new Date() } });
}

async function validatePage(page: LegacyRuntimeExportPage): Promise<LegacyMigrationResources> {
  const { hash, ...payload } = page;
  const serialized = JSON.stringify(payload);
  if (Buffer.byteLength(serialized) > 1024 * 1024 || digest(serialized) !== hash) throw new TypeError("Legacy export page hash or size is invalid.");
  let previous = page.cursor.after;
  const prefix = ["", "workspace-snapshot-upload-session:current", "workspace-snapshot-orphan-candidate:", "browser-vault-replica-orphan-candidate:"][page.cursor.section]!;
  for (const record of page.records) {
    if (record.key <= previous || !record.key.startsWith(prefix)
      || record.kind !== (page.cursor.section === 0 ? "media" : "resource")) throw new TypeError("Legacy export records do not match their cursor.");
    previous = record.key;
  }
  const expectedNext = page.records.length === 50 ? { section: page.cursor.section, after: previous }
    : page.cursor.section < 3 ? { section: page.cursor.section + 1, after: "" } : null;
  if (!sameCursor(page.next, expectedNext)) throw new TypeError("Legacy export next cursor is invalid.");
  return prepareLegacyMigrationResources(page);
}
function projectImport(row: { objectId: string; userId: string | null; generation: bigint | null; nextCursor: Prisma.JsonValue; lastHash: string | null; completedAt: Date | null }) {
  return { ...row, generation: row.generation?.toString() ?? null };
}
function sameCursor(left: unknown, right: unknown): boolean {
  if (left === null || right === null) return left === right;
  return typeof left === "object" && left !== null && "section" in left && "after" in left
    && typeof right === "object" && right !== null && "section" in right && "after" in right
    && left.section === right.section && left.after === right.after;
}
function digest(text: string) { return createHash("sha256").update(text).digest("hex"); }
