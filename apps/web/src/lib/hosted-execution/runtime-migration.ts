import { listRuntimeMigrationCandidates } from "./runtime-migration-cleanup";
import { enrollRuntimeSourcesTx, runtimeSourcesAlreadyEnrolled } from "./runtime-migration-enrollment";
import { closeLegacyCreationTx, discoverRuntimeObjectsTx, listRuntimeInventoryTx, nextRuntimeObjectTx, selectMemberRuntimeObjectTx, selectFirstUseRuntimeObjectTx, readSelectedRuntimeObject, requireSelectedRuntimeObject, requireRollingInventoryPageTx } from "./runtime-migration-inventory";
import { activateEmptyRuntime, settleUnmaterializedRuntime } from "./runtime-migration-unmaterialized";
import { createHash } from "node:crypto";
import { Prisma, type PrismaClient, type HostedRuntimeCutover } from "@prisma/client";
import { HOSTED_RUNTIME_ROLLING_PROTOCOL, matchesHostedRuntimeMigrationRelease, parseHostedRuntimeMigrationCommand, type HostedRuntimeMigrationCommand, type HostedRuntimeMigrationIdentity, type LegacyRuntimeExportPage } from "@murphai/hosted-execution/runtime-migration";
import { prepareLegacyMigrationResources, type LegacyMigrationResources } from "./runtime-migration-resources";
import { isMemberMigrationCommand, lockMemberMigrationTx, readMemberMigrationTx, transitionMemberMigrationTx, withMemberMigrationWake } from "./runtime-member-migration";
import type { PreparedHostedMailboxItemAppendCrypto } from "../hosted-mailbox/store";
import { recordRuntimeOrphansTx } from "./runtime-orphans";

const INITIAL_CURSOR = { section: 0, after: "" };
const INITIAL_INVENTORY_HASH = digest("");
type MigrationCommand = Exclude<HostedRuntimeMigrationCommand, { operation: "status" | "inspect_object" | "advance_member" | "advance_empty" | "enroll_members" | "list_unenrolled" }>;

/** Trusted finite campaign. Campaign transitions take the exclusive gate;
 * member transitions/pages share it and serialize only the affected owner. */
export async function executeHostedRuntimeMigrationCommand(input: { prisma: PrismaClient; command: HostedRuntimeMigrationCommand }) {
  const command = parseHostedRuntimeMigrationCommand(input.command);
  if (command.operation === "status") return { gate: await input.prisma.hostedRuntimeCutover.findUniqueOrThrow({ where: { id: "runtime" } }) };
  if (command.operation === "enroll_sources" && await runtimeSourcesAlreadyEnrolled(input.prisma, command)) return { enrolled: 0 };
  if (command.operation === "activate_empty") return activateEmptyRuntime({ prisma: input.prisma, command });
  if (command.operation === "settle_unmaterialized") return settleUnmaterializedRuntime({ prisma: input.prisma, command });
  if (command.operation === "enroll_members" || command.operation === "inspect_object" || command.operation === "advance_member" || command.operation === "advance_empty") throw new Error("Live member migration belongs to the source Worker.");
  if (command.operation === "next_object" || command.operation === "select_first_use") {
    const objectId = await readSelectedRuntimeObject(input.prisma, command);
    if (objectId) return { objectId };
  }
  if (command.operation === "list_unenrolled") return listRuntimeMigrationCandidates(input.prisma, command);
  const resources = command.operation === "import" || command.operation === "import_member" || command.operation === "import_empty" ? await validatePage(command.page) : null;
  if (isMemberMigrationCommand(command)) return withMemberMigrationWake({ prisma: input.prisma, command,
    run: prepared => input.prisma.$transaction(tx => executeMemberTx(tx, command, resources, prepared), { maxWait: 5_000, timeout: 5_000 }) });
  return input.prisma.$transaction(async tx => {
    if (["read_object", "import_empty", "list_inventory"].includes(command.operation)) await tx.$queryRaw`SELECT id FROM hosted_runtime_cutover WHERE id = 'runtime' FOR SHARE`;
    else await tx.$queryRaw`SELECT id FROM hosted_runtime_cutover WHERE id = 'runtime' FOR UPDATE`;
    const gate = await tx.hostedRuntimeCutover.findUniqueOrThrow({ where: { id: "runtime" } });
    if (command.operation === "begin" || command.operation === "begin_rolling") return { gate: await beginTx(tx, gate, command) };
    requireIdentity(gate, command);
    switch (command.operation) {
      case "enroll_sources": return enrollRuntimeSourcesTx(tx, gate, command);
      case "discover": return { gate: await discoverRuntimeObjectsTx(tx, gate, command) };
      case "close_legacy_creation": return { gate: await closeLegacyCreationTx(tx, gate) };
      case "list_inventory": return listRuntimeInventoryTx(tx, gate, command.after);
      case "next_object": return nextRuntimeObjectTx(tx, gate);
      case "select_member": return selectMemberRuntimeObjectTx(tx, gate, command.userId);
      case "select_first_use": return selectFirstUseRuntimeObjectTx(tx, gate, command);
      case "inventory": return { gate: await inventoryTx(tx, gate, command) };
      case "read_object":
        requireSelectedRuntimeObject(gate, command.objectId);
        return { object: projectImport(await tx.hostedRuntimeLegacyImport.findUniqueOrThrow({ where: { objectId: command.objectId } })) };
      case "import_empty": {
        requireSelectedRuntimeObject(gate, command.objectId);
        await tx.$queryRaw`SELECT object_id FROM hosted_runtime_legacy_import WHERE object_id = ${command.objectId} FOR UPDATE`;
        return { object: projectImport(await importPageTx(tx, gate, command, resources!)) };
      }
      case "import": return { object: projectImport(await importPageTx(tx, gate, command, resources!)) };
      case "activate": return { gate: await activateTx(tx, gate, command) };
    }
  }, { maxWait: 5_000, timeout: 5_000 });
}

async function executeMemberTx(tx: Prisma.TransactionClient,
  command: import("@murphai/hosted-execution/runtime-migration").HostedRuntimeMemberMigrationCommand,
  resources: LegacyMigrationResources | null, preparedWake: PreparedHostedMailboxItemAppendCrypto | null) {
  await tx.$queryRaw`SELECT id FROM hosted_runtime_cutover WHERE id = 'runtime' FOR SHARE`;
  const gate = await tx.hostedRuntimeCutover.findUniqueOrThrow({ where: { id: "runtime" } });
  requireIdentity(gate, command);
  if (gate.phase !== "rolling" || !gate.inventorySealedAt || !gate.creationClosedAt) throw new Error("Member migration requires a sealed rolling campaign.");
  requireSelectedRuntimeObject(gate, command.objectId);
  if (command.operation === "read_member") return { member: await readMemberMigrationTx(tx, command) };
  const owner = await lockMemberMigrationTx(tx, command);
  if (command.operation !== "import_member") return { member: await transitionMemberMigrationTx({ tx, command, owner, preparedWake }) };
  if (command.page.userId !== command.userId || (owner.migrationPhase !== "freezing" && owner.migrationPhase !== "importing")) {
    throw new Error("Member import requires its own frozen legacy authority.");
  }
  const object = projectImport(await importPageTx(tx, gate, command, resources!));
  await tx.hostedRuntimeOwner.update({ where: { userId: command.userId }, data: { migrationPhase: "importing" } });
  return { object };
}

async function beginTx(tx: Prisma.TransactionClient, gate: HostedRuntimeCutover, command: Extract<MigrationCommand, { operation: "begin" | "begin_rolling" }>) {
  if (gate.phase !== "legacy") {
    requireIdentity(gate, command);
    if (gate.phase !== "postgres" && gate.phase !== (command.operation === "begin_rolling" ? "rolling" : "draining")) throw new Error("Migration campaign mode changed.");
    return gate;
  }
  if (command.operation === "begin_rolling" && command.compatibility?.protocol !== HOSTED_RUNTIME_ROLLING_PROTOCOL) {
    throw new Error("Rolling migration requires a compatible namespace binding.");
  }
  return tx.hostedRuntimeCutover.update({ where: { id: "runtime" }, data: {
    namespaceProbeId: command.operation === "begin_rolling" ? command.compatibility!.namespaceProbeId : null,
    phase: command.operation === "begin_rolling" ? "rolling" : "draining", namespaceId: command.namespaceId, workerVersion: command.workerVersion, inventoryHash: INITIAL_INVENTORY_HASH,
  } });
}
function requireIdentity(gate: HostedRuntimeCutover, command: HostedRuntimeMigrationIdentity) {
  if (gate.namespaceId !== command.namespaceId || !(gate.phase === "rolling" ? matchesHostedRuntimeMigrationRelease(gate, command) : gate.workerVersion === command.workerVersion)) throw new Error("Migration namespace or serving Worker version changed.");
}
async function inventoryTx(tx: Prisma.TransactionClient, gate: HostedRuntimeCutover, command: Extract<MigrationCommand, { operation: "inventory" }>) {
  if ((gate.phase !== "draining" && gate.phase !== "rolling") || gate.inventorySealedAt || command.after !== gate.inventoryAfter
    || (!command.complete && command.objectIds.length === 0)) throw new Error("Migration inventory cursor is stale or sealed.");
  if (gate.phase === "rolling") await requireRollingInventoryPageTx(tx, gate, command);
  let previous = gate.inventoryAfter;
  let hash = gate.inventoryHash!;
  for (const id of command.objectIds) {
    if (id <= previous) throw new TypeError("Migration inventory must be strictly ordered and unique.");
    hash = digest(`${hash}\n${id}`);
    previous = id;
  }
  if (gate.phase === "draining" && command.objectIds.length) await tx.hostedRuntimeLegacyImport.createMany({ data: command.objectIds.map(objectId => ({ objectId, nextCursor: INITIAL_CURSOR })) });
  return tx.hostedRuntimeCutover.update({ where: { id: "runtime" }, data: {
    inventoryAfter: previous, inventoryHash: hash, inventoryCount: { increment: command.objectIds.length },
    ...(command.complete ? { inventorySealedAt: new Date() } : {}),
  } });
}

async function importPageTx(tx: Prisma.TransactionClient, gate: HostedRuntimeCutover, command: Extract<MigrationCommand, { operation: "import" | "import_member" | "import_empty" }>, resources: LegacyMigrationResources) {
  if (!gate.inventorySealedAt || (gate.phase !== "draining" && !(gate.phase === "rolling" && (command.operation === "import_member" || command.operation === "import_empty")))) {
    throw new Error("Resource import requires the sealed draining inventory or a fenced member import.");
  }
  const row = await tx.hostedRuntimeLegacyImport.findUniqueOrThrow({ where: { objectId: command.objectId } });
  const page = command.page;
  if (command.operation === "import_empty") requireEmptyImport(row.userId, page);
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
  if (gate.phase === "rolling") throw new Error("Rolling migration completes individual members; namespace retirement requires separate proof.");
  if (gate.phase !== "draining") throw new Error("Postgres activation requires a draining campaign.");
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

function requireEmptyImport(reservedUserId: string | null, page: LegacyRuntimeExportPage): void {
  if (reservedUserId !== null || page.userId !== null || page.generation !== "0" || page.records.length !== 0) {
    throw new Error("Empty migration cannot import member state.");
  }
}
