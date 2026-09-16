import { runtimeMigrationReleaseSql } from "./runtime-migration-compatibility";
import { Prisma, type PrismaClient, type HostedRuntimeCutover } from "@prisma/client";
import type { HostedRuntimeMigrationCommand } from "@murphai/hosted-execution/runtime-migration";

type Tx = Prisma.TransactionClient;
const PAGE_SIZE = 100;

/** One statement, at most 100 distinct candidates per existing state owner and
 * 100 returned identities. Anti-joins use the unique source binding, so retry
 * needs no cursor that could skip a concurrent creation or retained deletion.
 * Group runtime identities are canonical hosted_member rows as well.
 */
export async function listUnenrolledRuntimeMembersTx(tx: Tx, gate: HostedRuntimeCutover) {
  requireEnrollmentPhase(gate);
  const owners = [
    ["hosted_member", "id"], ["hosted_runtime_owner", "user_id"],
    ["hosted_runtime_snapshot_upload", "user_id"], ["hosted_runtime_put_drain", "user_id"],
    ["hosted_runtime_orphan", "user_id"], ["hosted_runtime_media", "user_id"],
  ] as const;
  // Identifiers are repository-owned constants, never command input.
  const pages = owners.map(([table, column]) => Prisma.sql`(
    SELECT DISTINCT candidate.${Prisma.raw(column)} AS "userId" FROM ${Prisma.raw(table)} AS candidate
    WHERE NOT EXISTS (SELECT 1 FROM hosted_runtime_legacy_import AS source
      WHERE source.admitted_user_id = candidate.${Prisma.raw(column)})
    ORDER BY candidate.${Prisma.raw(column)} LIMIT ${PAGE_SIZE}
  )`);
  const rows = await tx.$queryRaw<Array<{ userId: string }>>(Prisma.sql`
    SELECT DISTINCT "userId" FROM (${Prisma.join(pages, " UNION ALL ")}) AS candidates
    ORDER BY "userId" LIMIT ${PAGE_SIZE}
  `);
  return { userIds: rows.map(row => row.userId) };
}

/** The bound Worker derives these exact object IDs without obtaining a stub.
 * Expected identity is separate from exported identity: a binding proves neither
 * emptiness nor completion. Conflicts fail the whole page without overwriting
 * source receipts, pending signup state, generations or cleanup authority.
 */
export async function enrollRuntimeSourcesTx(tx: Tx, gate: HostedRuntimeCutover,
  command: Extract<HostedRuntimeMigrationCommand, { operation: "enroll_sources" }>) {
  requireEnrollmentPhase(gate);
  const bindings = [...command.bindings].sort((a, b) => a.objectId.localeCompare(b.objectId));
  const rows = await tx.$queryRaw<Array<{ objectId: string }>>(Prisma.sql`
    INSERT INTO hosted_runtime_legacy_import AS source (object_id, admitted_user_id, inventory_class, next_cursor)
    VALUES ${Prisma.join(bindings.map(row => Prisma.sql`(${row.objectId}, ${row.userId}, ${runtimeInventoryClass(gate)}, '{"section":0,"after":""}'::jsonb)`))}
    ON CONFLICT (object_id) DO UPDATE SET admitted_user_id = EXCLUDED.admitted_user_id
    WHERE (source.admitted_user_id IS NULL OR source.admitted_user_id = EXCLUDED.admitted_user_id)
      AND (source.user_id IS NULL OR source.user_id = EXCLUDED.admitted_user_id)
    RETURNING object_id AS "objectId"
  `);
  if (rows.length !== bindings.length) throw new Error("Source enrollment conflicts with an existing member identity.");
  await tx.hostedRuntimeOwner.createMany({ data: bindings.map(row => ({ userId: row.userId })), skipDuplicates: true });
  return { enrolled: rows.length };
}

function requireEnrollmentPhase(gate: HostedRuntimeCutover) {
  if (gate.phase !== "rolling") {
    throw new Error("Canonical enrollment requires a rolling campaign.");
  }
}

export function runtimeInventoryClass(gate: HostedRuntimeCutover): "baseline" | "late" {
  return gate.creationClosedAt || gate.inventorySealedAt || gate.inventoryCount > 0 ? "late" : "baseline";
}

/** Idempotent acknowledgement from one statement snapshot. This grants no
 * execution authority: later source operations still validate live selection.
 * Avoid taking the exclusive campaign gate on every ordinary first-use retry.
 */
export async function runtimeSourcesAlreadyEnrolled(prisma: PrismaClient,
  command: Extract<HostedRuntimeMigrationCommand, { operation: "enroll_sources" }>) {
  const rows = await prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`
    SELECT count(*)::integer AS count FROM hosted_runtime_cutover AS gate
    JOIN (VALUES ${Prisma.join(command.bindings.map(row => Prisma.sql`(${row.objectId}, ${row.userId})`))})
      AS binding(object_id, user_id) ON true
    JOIN hosted_runtime_legacy_import AS source ON source.object_id = binding.object_id
      AND source.admitted_user_id = binding.user_id
      AND (source.user_id IS NULL OR source.user_id = binding.user_id)
    JOIN hosted_runtime_owner AS owner ON owner.user_id = binding.user_id
    WHERE gate.id = 'runtime' AND gate.phase = 'rolling'
      AND gate.namespace_id = ${command.namespaceId} AND ${runtimeMigrationReleaseSql(command)}
  `);
  return rows[0]?.count === command.bindings.length;
}
