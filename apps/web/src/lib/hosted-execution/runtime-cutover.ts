import { Prisma, type PrismaClient } from "@prisma/client";
import {
  resolveHostedRuntimeMemberBackend,
  type HostedRuntimeBackend,
} from "@murphai/hosted-execution/runtime-migration";
import { lockHostedMemberRow } from "../hosted-onboarding/shared";

/** Apply before a bounded cleanup LIMIT, so unfinished imported resources
 * cannot starve resources already owned by Postgres. Callers supply a static
 * SQL column expression, never a caller-selected identifier.
 */
export function hostedRuntimePostgresResourceScopeSql(userIdColumn: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`EXISTS (
    SELECT 1 FROM hosted_runtime_cutover AS gate
    WHERE gate.id = 'runtime' AND (
      gate.phase = 'postgres' OR (
        gate.phase = 'rolling' AND EXISTS (
          SELECT 1 FROM hosted_runtime_owner AS owner
          WHERE owner.user_id = ${userIdColumn} AND owner.migration_phase = 'postgres'
        )
      )
    )
  )`;
}

/** Lock campaign -> member -> owner. The campaign lock is shared; only finite
 * campaign transitions take it exclusively. No external work belongs here.
 * Materializing the default owner closes the missing-row race, including for
 * deleted accounts whose member row can no longer provide serialization.
 */
export async function lockHostedRuntimeMemberCutoverTx(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<HostedRuntimeBackend> {
  const gates = await tx.$queryRaw<Array<{ phase: string }>>`
    SELECT phase FROM hosted_runtime_cutover WHERE id = 'runtime' FOR SHARE
  `;
  const gate = gates[0];
  if (!gate) throw new Error("Hosted runtime cutover state is missing.");
  if (gate.phase !== "rolling") return resolveHostedRuntimeMemberBackend(gate.phase, null);
  await lockHostedMemberRow(tx, userId);
  await tx.hostedRuntimeOwner.createMany({ data: [{ userId }], skipDuplicates: true });
  const owners = await tx.$queryRaw<Array<{ migration_phase: string }>>`
    SELECT migration_phase FROM hosted_runtime_owner WHERE user_id = ${userId} FOR UPDATE
  `;
  if (!owners[0]) throw new Error("Hosted runtime member ownership is missing.");
  return resolveHostedRuntimeMemberBackend(gate.phase, owners[0].migration_phase);
}

/** Coherent statement snapshot for routing only. Each destination rechecks
 * admission under its own lock; a stale route never authorizes fallback.
 */
export async function readHostedRuntimeMemberBackend(
  prisma: PrismaClient,
  userId: string,
): Promise<HostedRuntimeBackend> {
  const rows = await prisma.$queryRaw<Array<{ phase: string; migration_phase: string | null }>>`
    SELECT gate.phase, owner.migration_phase
    FROM hosted_runtime_cutover AS gate
    LEFT JOIN hosted_runtime_owner AS owner ON owner.user_id = ${userId}
    WHERE gate.id = 'runtime'
  `;
  if (!rows[0]) throw new Error("Hosted runtime cutover state is missing.");
  return resolveHostedRuntimeMemberBackend(rows[0].phase, rows[0].migration_phase);
}
