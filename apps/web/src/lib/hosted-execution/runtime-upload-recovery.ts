import type { PrismaClient } from "@prisma/client";
import { readHostedExecutionControlClientIfConfigured } from "./control";
import { lockHostedRuntimeCutoverTx } from "./runtime-owner";
import { lockHostedMemberRow } from "../hosted-onboarding/shared";

/** The clock schedules recovery; only the exact R2 abort/NoSuchUpload receipt
 * discharges a pending write. Retries never assume that a timed-out PUT stopped. */
export async function reconcileHostedRuntimeUploads(input: {
  prisma: PrismaClient; now: Date; deadlineAtMs: number; deletedUserId?: string;
}): Promise<{ recovered: number; failed: number }> {
  const client = readHostedExecutionControlClientIfConfigured(5_000);
  if (!client) return { recovered: 0, failed: 0 };
  const rows = await input.prisma.$transaction(async tx => {
    if (await lockHostedRuntimeCutoverTx(tx) !== "postgres") return [];
    if (input.deletedUserId) {
      await lockHostedMemberRow(tx, input.deletedUserId);
      if (await tx.hostedMember.findUnique({ where: { id: input.deletedUserId }, select: { id: true } })) return [];
    }
    const candidates = await tx.hostedRuntimePutDrain.findMany({ where: {
      completedAt: null, uploadId: { not: null }, objectKey: { not: null },
      ...(input.deletedUserId ? { userId: input.deletedUserId } : { reconcileAfter: { lte: input.now } }),
    }, orderBy: [{ reconcileAfter: "asc" }, { userId: "asc" }, { writeId: "asc" }], take: 50 });
    return candidates;
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
