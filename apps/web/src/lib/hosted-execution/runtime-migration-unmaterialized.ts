import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { HostedRuntimeMigrationIdentity } from "@murphai/hosted-execution/runtime-migration";
import { lockHostedRuntimeMemberCutoverTx } from "./runtime-cutover";
import { appendRuntimeMigrationWakeTx, withRuntimeMigrationActivationWake } from "./runtime-member-migration";

/** A failed first-use request can leave a default owner with no source data.
 * Settle one such identity per call, only after every registered source has a
 * terminal receipt. Empty imports never stand in for a missing fleet census.
 * The ordinary durable mailbox sweep recovers a lost response/wake signal.
 */
export async function settleUnmaterializedRuntime(input: { prisma: PrismaClient; command: HostedRuntimeMigrationIdentity }) {
  const candidate = await input.prisma.hostedRuntimeOwner.findFirst({
    where: { migrationPhase: { not: "postgres" } }, orderBy: { userId: "asc" }, select: { userId: true },
  });
  const run = (prepared: Parameters<typeof appendRuntimeMigrationWakeTx>[0]["prepared"]) => input.prisma.$transaction(async tx => {
    await requireCompletedSourcesTx(tx, input.command);
    if (!candidate) return { done: true };
    await lockHostedRuntimeMemberCutoverTx(tx, candidate.userId);
    const owner = await tx.hostedRuntimeOwner.findUniqueOrThrow({ where: { userId: candidate.userId } });
    if (owner.migrationPhase === "postgres") return { done: false };
    if (owner.migrationPhase !== "legacy" || owner.migrationId || owner.generation !== 0n || owner.phase !== "idle"
      || owner.attemptId || owner.runnerContainerName) throw new Error("Unmaterialized settlement cannot replace prior runtime authority.");
    const bound = await tx.hostedRuntimeLegacyImport.findMany({
      where: { OR: [{ userId: candidate.userId }, { admittedUserId: candidate.userId }] },
      take: 2, select: { userId: true, generation: true, completedAt: true },
    });
    if (bound.some(row => row.userId !== null || row.generation !== 0n || !row.completedAt)) throw new Error("Member source requires ordinary migration activation.");
    const eventId = `runtime-control:unmaterialized:${createHash("sha256").update(JSON.stringify([input.command.namespaceId, candidate.userId])).digest("hex")}`;
    const mailboxItemId = await appendRuntimeMigrationWakeTx({ tx, userId: candidate.userId, eventId, prepared });
    await tx.hostedRuntimeOwner.update({ where: { userId: candidate.userId }, data: { migrationPhase: "postgres" } });
    return { done: false, mailboxItemId };
  }, { maxWait: 5_000, timeout: 5_000 });
  return candidate ? withRuntimeMigrationActivationWake({ prisma: input.prisma, userId: candidate.userId, run }) : run(null);
}

async function requireCompletedSourcesTx(tx: Prisma.TransactionClient, identity: HostedRuntimeMigrationIdentity) {
  await tx.$queryRaw`SELECT id FROM hosted_runtime_cutover WHERE id = 'runtime' FOR SHARE`;
  const gate = await tx.hostedRuntimeCutover.findUniqueOrThrow({ where: { id: "runtime" } });
  if (gate.phase !== "rolling" || gate.namespaceId !== identity.namespaceId
    || gate.workerVersion !== identity.workerVersion || !gate.creationClosedAt || !gate.inventorySealedAt) {
    throw new Error("Unmaterialized settlement requires a closed, sealed rolling census.");
  }
  if (await tx.hostedRuntimeLegacyImport.findFirst({ where: { completedAt: null }, select: { objectId: true } })) {
    throw new Error("Unmaterialized settlement requires every source disposition.");
  }
}
