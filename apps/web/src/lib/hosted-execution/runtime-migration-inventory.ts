import { listUnenrolledRuntimeMembersTx } from "./runtime-migration-enrollment";
import type { HostedRuntimeCutover, Prisma } from "@prisma/client";
import type { HostedRuntimeMigrationCommand } from "@murphai/hosted-execution/runtime-migration";

type Tx = Prisma.TransactionClient;

/** Discovery joins provider census and durable materialization intents. It does
 * not pause execution and cannot reopen a sealed inventory.
 */
export async function discoverRuntimeObjectsTx(tx: Tx, gate: HostedRuntimeCutover, command: Extract<HostedRuntimeMigrationCommand, { operation: "discover" }>) {
  if (gate.phase !== "rolling" || gate.inventorySealedAt || gate.inventoryCount !== 0) throw new Error("Discovery requires an unsealed rolling inventory.");
  await tx.hostedRuntimeLegacyImport.createMany({ data: command.objectIds.map(objectId => ({ objectId, nextCursor: { section: 0, after: "" } })), skipDuplicates: true });
  if (command.complete && !gate.discoveryCompletedAt) return tx.hostedRuntimeCutover.update({ where: { id: "runtime" }, data: { discoveryCompletedAt: new Date() } });
  return gate;
}

export async function closeLegacyCreationTx(tx: Tx, gate: HostedRuntimeCutover) {
  if (gate.phase !== "rolling" || !gate.discoveryCompletedAt) throw new Error("Legacy creation closure requires a complete provider discovery.");
  if (gate.creationClosedAt) return gate;
  if ((await listUnenrolledRuntimeMembersTx(tx, gate)).userIds.length) throw new Error("Legacy creation closure has unenrolled canonical identities.");
  return tx.hostedRuntimeCutover.update({ where: { id: "runtime" }, data: { creationClosedAt: new Date() } });
}

export async function listRuntimeInventoryTx(tx: Tx, gate: HostedRuntimeCutover, after: string) {
  if (gate.phase !== "rolling" && gate.phase !== "postgres") throw new Error("Runtime inventory listing requires a rolling campaign.");
  const objects = await tx.hostedRuntimeLegacyImport.findMany({ where: { objectId: { gt: after } }, orderBy: { objectId: "asc" }, take: 100,
    select: { objectId: true, admittedUserId: true, userId: true, completedAt: true } });
  return { objects, nextAfter: objects.length === 100 ? objects[objects.length - 1]!.objectId : null };
}

/** Immutable inventory order and monotonic source/activation receipts keep all
 * operator retries on the same unfinished object. Import completion alone must
 * not advance past a member whose destination has not activated. No expiring
 * operator lease can authorize a second handoff after an ambiguous response.
 */
export async function nextRuntimeObjectTx(tx: Tx, gate: HostedRuntimeCutover) {
  if ((gate.phase !== "rolling" && gate.phase !== "postgres") || !gate.inventorySealedAt || !gate.creationClosedAt) {
    throw new Error("Object selection requires a closed, sealed rolling campaign.");
  }
  const rows = await tx.$queryRaw<Array<{ objectId: string }>>`
    SELECT source.object_id AS "objectId"
    FROM hosted_runtime_legacy_import AS source
    LEFT JOIN hosted_runtime_owner AS owner ON owner.user_id = source.user_id
    WHERE source.completed_at IS NULL
      OR (source.user_id IS NOT NULL AND owner.migration_phase IS DISTINCT FROM 'postgres')
    ORDER BY source.object_id ASC LIMIT 1
  `;
  return { objectId: rows[0]?.objectId ?? null };
}

export async function requireRollingInventoryPageTx(tx: Tx, gate: HostedRuntimeCutover, command: Extract<HostedRuntimeMigrationCommand, { operation: "inventory" }>) {
  if (!gate.creationClosedAt || !gate.discoveryCompletedAt) throw new Error("Rolling inventory cannot seal while legacy creation is open.");
  const rows = await tx.hostedRuntimeLegacyImport.findMany({ where: { objectId: { gt: command.after } }, orderBy: { objectId: "asc" }, take: command.objectIds.length + 1, select: { objectId: true } });
  if (rows.length < command.objectIds.length || command.objectIds.some((id, i) => rows[i]?.objectId !== id)
    || (command.complete && rows.length !== command.objectIds.length)) throw new Error("Rolling inventory page omits a registered legacy source.");
}
