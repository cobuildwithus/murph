import { Prisma, type PrismaClient } from "@prisma/client";
import { readHostedExecutionControlClientIfConfigured } from "./control";
import { hostedRuntimePostgresResourceScopeSql, lockHostedRuntimeMemberCutoverTx } from "./runtime-cutover";
import { lockHostedMemberRow } from "../hosted-onboarding/shared";

/** The clock schedules recovery; only the exact R2 abort/NoSuchUpload receipt
 * discharges a pending write. Retries never assume that a timed-out PUT stopped. */
export async function reconcileHostedRuntimeUploads(input: {
  prisma: PrismaClient; now: Date; deadlineAtMs: number; deletedUserId?: string;
}): Promise<{ recovered: number; failed: number }> {
  const client = readHostedExecutionControlClientIfConfigured(5_000);
  if (!client) return { recovered: 0, failed: 0 };
  const rows = await input.prisma.$transaction(async tx => {
    if (input.deletedUserId) {
      if (await lockHostedRuntimeMemberCutoverTx(tx, input.deletedUserId) !== "postgres") return [];
      await lockHostedMemberRow(tx, input.deletedUserId);
      if (await tx.hostedMember.findUnique({ where: { id: input.deletedUserId }, select: { id: true } })) return [];
    }
    const keys = await tx.$queryRaw<Array<{ userId: string; writeId: string }>>`
      SELECT resource.user_id AS "userId", resource.write_id AS "writeId"
      FROM hosted_runtime_put_drain AS resource
      WHERE resource.completed_at IS NULL AND resource.upload_id IS NOT NULL AND resource.object_key IS NOT NULL
        AND ${input.deletedUserId ? Prisma.sql`resource.user_id = ${input.deletedUserId}` : Prisma.sql`resource.reconcile_after <= ${input.now}`}
        AND ${hostedRuntimePostgresResourceScopeSql(Prisma.sql`resource.user_id`)}
      ORDER BY resource.reconcile_after, resource.user_id, resource.write_id
      LIMIT 50
    `;
    if (keys.length === 0) return [];
    return tx.hostedRuntimePutDrain.findMany({ where: { OR: keys, completedAt: null, uploadId: { not: null }, objectKey: { not: null } },
      orderBy: [{ reconcileAfter: "asc" }, { userId: "asc" }, { writeId: "asc" }], take: 50 });
  }, { timeout: 5_000, maxWait: 5_000 });
  let recovered = 0;
  let failed = 0;
  for (const row of rows) {
    if (Date.now() >= input.deadlineAtMs) break;
    const where = { userId: row.userId, writeId: row.writeId, uploadId: row.uploadId, completedAt: null };
    try {
      await client.purgeRuntimeResource({ userId: row.userId, resource: { kind: "multipart", objectKey: row.objectKey!, uploadId: row.uploadId! } });
      recovered += (await input.prisma.hostedRuntimePutDrain.updateMany({ where, data: { completedAt: input.now } })).count;
    } catch {
      failed++;
      await input.prisma.hostedRuntimePutDrain.updateMany({ where, data: { reconcileAfter: new Date(input.now.getTime() + 60_000) } });
    }
  }
  return { recovered, failed };
}
