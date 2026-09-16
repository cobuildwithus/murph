import { hasPendingRuntimeCleanupEnrollment } from "./runtime-migration-cleanup";
import { runtimeMigrationReleaseSql } from "./runtime-migration-compatibility";
import { listUnenrolledRuntimeMembersTx, runtimeInventoryClass } from "./runtime-migration-enrollment";
import type { HostedRuntimeCutover, Prisma, PrismaClient } from "@prisma/client";
import type { HostedRuntimeMigrationCommand, HostedRuntimeMigrationIdentity } from "@murphai/hosted-execution/runtime-migration";

type Tx = Prisma.TransactionClient;

/** Discovery joins provider census and durable materialization intents. It does
 * not pause execution and cannot reopen a sealed inventory.
 */
export async function discoverRuntimeObjectsTx(tx: Tx, gate: HostedRuntimeCutover, command: Extract<HostedRuntimeMigrationCommand, { operation: "discover" }>) {
  if (gate.phase !== "rolling") throw new Error("Discovery requires a rolling campaign.");
  await tx.hostedRuntimeLegacyImport.createMany({ data: command.objectIds.map(objectId => ({ objectId, inventoryClass: runtimeInventoryClass(gate), nextCursor: { section: 0, after: "" } })), skipDuplicates: true });
  if (command.complete && !gate.discoveryCompletedAt) return tx.hostedRuntimeCutover.update({ where: { id: "runtime" }, data: { discoveryCompletedAt: new Date() } });
  return gate;
}

export async function closeLegacyCreationTx(tx: Tx, gate: HostedRuntimeCutover) {
  if (gate.phase !== "rolling" || !gate.discoveryCompletedAt) throw new Error("Legacy creation closure requires a complete provider discovery.");
  if (gate.creationClosedAt) return gate;
  if (await hasPendingRuntimeCleanupEnrollment(tx)) throw new Error("Legacy creation closure has unenrolled cleanup identities.");
  if ((await listUnenrolledRuntimeMembersTx(tx, gate)).userIds.length) throw new Error("Legacy creation closure has unenrolled canonical identities.");
  return tx.hostedRuntimeCutover.update({ where: { id: "runtime" }, data: { creationClosedAt: new Date() } });
}

export async function listRuntimeInventoryTx(tx: Tx, gate: HostedRuntimeCutover, after: string) {
  if (gate.phase !== "rolling" && gate.phase !== "postgres") throw new Error("Runtime inventory listing requires a rolling campaign.");
  const objects = await tx.hostedRuntimeLegacyImport.findMany({ where: { objectId: { gt: after } }, orderBy: { objectId: "asc" }, take: 100,
    select: { objectId: true, inventoryClass: true, admittedUserId: true, userId: true, completedAt: true } });
  return { objects, nextAfter: objects.length === 100 ? objects[objects.length - 1]!.objectId : null };
}

/** Poll an unfinished selection from one statement snapshot without acquiring
 * a campaign lock. This is a routing hint: every source effect rechecks the
 * selected identity. A stale hint can fail, never authorize another handoff.
 * Only selection changes enter the exclusive transaction below.
 */
export async function readSelectedRuntimeObject(prisma: PrismaClient, identity: HostedRuntimeMigrationIdentity) {
  const rows = await prisma.$queryRaw<Array<{ objectId: string }>>`
    SELECT source.object_id AS "objectId"
    FROM hosted_runtime_cutover AS gate
    JOIN hosted_runtime_legacy_import AS source ON source.object_id = gate.selected_object_id
    LEFT JOIN hosted_runtime_owner AS owner ON owner.user_id = COALESCE(source.user_id, source.admitted_user_id)
    WHERE gate.id = 'runtime' AND gate.phase = 'rolling'
      AND gate.namespace_id = ${identity.namespaceId} AND ${runtimeMigrationReleaseSql(identity)}
      AND gate.inventory_sealed_at IS NOT NULL AND gate.creation_closed_at IS NOT NULL
      AND (source.completed_at IS NULL
        OR (COALESCE(source.user_id, source.admitted_user_id) IS NOT NULL AND owner.migration_phase IS DISTINCT FROM 'postgres'))
  `;
  return rows[0]?.objectId ?? null;
}

/** Called with the campaign's exclusive lock. Selection is committed before
 * any local barrier; concurrent operators and lost replies reuse that exact
 * source even when an earlier late ID appears. Only its terminal disposition
 * and member activation permit advancing. There is no expiring operator lease.
 */
export async function nextRuntimeObjectTx(tx: Tx, gate: HostedRuntimeCutover) {
  if (gate.phase !== "rolling" || !gate.inventorySealedAt || !gate.creationClosedAt) {
    throw new Error("Object selection requires a closed, sealed rolling campaign.");
  }
  const selectedObjectId = await unfinishedRuntimeSelectionTx(tx, gate);
  if (selectedObjectId) return { objectId: selectedObjectId };
  const rows = await tx.$queryRaw<Array<{ objectId: string }>>`
    SELECT source.object_id AS "objectId"
    FROM hosted_runtime_legacy_import AS source
    LEFT JOIN hosted_runtime_owner AS owner ON owner.user_id = COALESCE(source.user_id, source.admitted_user_id)
    WHERE source.completed_at IS NULL
      OR (COALESCE(source.user_id, source.admitted_user_id) IS NOT NULL AND owner.migration_phase IS DISTINCT FROM 'postgres')
    ORDER BY source.inventory_class ASC, source.object_id ASC LIMIT 1
  `;
  const objectId = rows[0]?.objectId ?? null;
  if (gate.selectedObjectId !== objectId) await tx.hostedRuntimeCutover.update({ where: { id: "runtime" }, data: { selectedObjectId: objectId } });
  return { objectId };
}

export function requireSelectedRuntimeObject(gate: HostedRuntimeCutover, objectId: string) {
  if (gate.phase === "rolling" && gate.selectedObjectId !== objectId) throw new Error("Migration source is not the selected object.");
}


export async function requireRollingInventoryPageTx(tx: Tx, gate: HostedRuntimeCutover, command: Extract<HostedRuntimeMigrationCommand, { operation: "inventory" }>) {
  if (!gate.creationClosedAt || !gate.discoveryCompletedAt) throw new Error("Rolling inventory cannot seal while legacy creation is open.");
  const rows = await tx.hostedRuntimeLegacyImport.findMany({ where: { inventoryClass: "baseline", objectId: { gt: command.after } }, orderBy: { objectId: "asc" }, take: command.objectIds.length + 1, select: { objectId: true } });
  if (rows.length < command.objectIds.length || command.objectIds.some((id, i) => rows[i]?.objectId !== id)
    || (command.complete && rows.length !== command.objectIds.length)) throw new Error("Rolling inventory page omits a registered legacy source.");
}

async function unfinishedRuntimeSelectionTx(tx: Tx, gate: HostedRuntimeCutover) {
  if (gate.selectedObjectId) {
    const selected = await tx.hostedRuntimeLegacyImport.findUniqueOrThrow({ where: { objectId: gate.selectedObjectId } });
    const userId = selected.userId ?? selected.admittedUserId;
    const owner = userId ? await tx.hostedRuntimeOwner.findUnique({ where: { userId } }) : null;
    if (!selected.completedAt || (userId && owner?.migrationPhase !== "postgres")) return selected.objectId;
  }
  return null;
}

/** Automatic first use may resume the existing selection or select its own
 * pending/late source. It cannot advance the baseline fleet beyond an operator
 * canary budget merely because an unrelated member retries processing.
 */
export async function selectFirstUseRuntimeObjectTx(tx: Tx, gate: HostedRuntimeCutover,
  command: Extract<HostedRuntimeMigrationCommand, { operation: "select_first_use" }>) {
  if (gate.phase !== "rolling" || !gate.inventorySealedAt || !gate.creationClosedAt) throw new Error("First-use selection requires a closed, sealed rolling campaign.");
  const selected = await unfinishedRuntimeSelectionTx(tx, gate);
  if (selected) return { objectId: selected };
  const source = await tx.hostedRuntimeLegacyImport.findUniqueOrThrow({ where: { objectId: command.objectId } });
  if (source.admittedUserId !== command.userId || (source.userId !== null && source.userId !== command.userId)) throw new Error("First-use source identity changed.");
  const owner = await tx.hostedRuntimeOwner.findUniqueOrThrow({ where: { userId: command.userId } });
  if (owner.migrationPhase === "postgres" || (owner.migrationPhase === "legacy" && source.inventoryClass === "baseline")) return { objectId: null };
  if (owner.migrationPhase !== "pending" && owner.migrationPhase !== "legacy") throw new Error("Unselected source already has migration authority.");
  await tx.hostedRuntimeCutover.update({ where: { id: "runtime" }, data: { selectedObjectId: command.objectId } });
  return { objectId: command.objectId };
}
