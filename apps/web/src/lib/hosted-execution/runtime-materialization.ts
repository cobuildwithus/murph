import type { HostedRuntimeOwner, Prisma, PrismaClient } from "@prisma/client";
import { resolveHostedRuntimeMemberBackend, type HostedRuntimeBackend } from "@murphai/hosted-execution/runtime-migration";
import { lockHostedMemberRow } from "../hosted-onboarding/shared";

type Input = { prisma: PrismaClient; userId: string; objectId: string; workerVersion: string };

/** Register before obtaining/using a legacy source stub. The shared campaign
 * lock orders this durable intent against creation closure; unrelated members
 * continue using their existing legacy authority after that closure.
 */
export async function resolveHostedLegacyMaterialization(input: Input) {
  return input.prisma.$transaction(async tx => {
    const gates = await tx.$queryRaw<Array<{ phase: string; worker_version: string | null; creation_closed_at: Date | null }>>`
      SELECT phase, worker_version, creation_closed_at FROM hosted_runtime_cutover WHERE id = 'runtime' FOR SHARE
    `;
    const gate = gates[0];
    if (!gate) throw new Error("Hosted runtime cutover state is missing.");
    if (gate.phase === "rolling" && gate.worker_version !== input.workerVersion) return { cutover: "draining" as const, owner: null };
    await lockHostedMemberRow(tx, input.userId);
    if (gate.phase === "postgres" || gate.phase === "draining") return {
      cutover: gate.phase, owner: await tx.hostedRuntimeOwner.findUnique({ where: { userId: input.userId } }),
    };
    if (gate.phase !== "legacy" && gate.phase !== "rolling") throw new Error("Legacy materialization requires a known campaign phase.");
    await tx.hostedRuntimeOwner.createMany({ data: [{ userId: input.userId }], skipDuplicates: true });
    await tx.$queryRaw`SELECT user_id FROM hosted_runtime_owner WHERE user_id = ${input.userId} FOR UPDATE`;
    const owner = await tx.hostedRuntimeOwner.findUniqueOrThrow({ where: { userId: input.userId } });
    const backend = resolveHostedRuntimeMemberBackend(gate.phase, owner.migrationPhase);
    if (backend !== "legacy") return { cutover: backend, owner };
    return admitSourceTx(tx, input, owner, gate.creation_closed_at !== null);
  }, { maxWait: 5_000, timeout: 5_000 });
}

async function admitSourceTx(tx: Prisma.TransactionClient, input: Input, owner: HostedRuntimeOwner, closed: boolean): Promise<{ cutover: HostedRuntimeBackend; owner: HostedRuntimeOwner }> {
  let source = await tx.hostedRuntimeLegacyImport.findUnique({ where: { objectId: input.objectId } });
  if (!source && closed) return activateUnmaterializedTx(tx, owner);
  if (!source) {
    await tx.hostedRuntimeLegacyImport.createMany({ data: [{ objectId: input.objectId, nextCursor: { section: 0, after: "" } }], skipDuplicates: true });
  }
  await tx.$queryRaw`SELECT object_id FROM hosted_runtime_legacy_import WHERE object_id = ${input.objectId} FOR UPDATE`;
  source = await tx.hostedRuntimeLegacyImport.findUniqueOrThrow({ where: { objectId: input.objectId } });
  if ((source.admittedUserId !== null && source.admittedUserId !== input.userId) || (source.userId !== null && source.userId !== input.userId)) {
    throw new Error("Legacy source belongs to a different member.");
  }
  if (source.completedAt) {
    if (!closed) throw new Error("Empty source activation requires closed legacy creation.");
    if (source.userId !== null || source.generation !== 0n) throw new Error("Completed member source cannot admit legacy work.");
    return activateUnmaterializedTx(tx, owner);
  }
  await tx.hostedRuntimeLegacyImport.update({ where: { objectId: input.objectId }, data: { admittedUserId: input.userId } });
  return { cutover: "legacy", owner };
}

/** No source or a verified terminal empty source, after a closed creation
 * census, is positive evidence for first-use routing. Never reset an attempt,
 * imported generation or ambiguous migration to obtain that route.
 */
async function activateUnmaterializedTx(tx: Prisma.TransactionClient, owner: HostedRuntimeOwner) {
  if (owner.migrationPhase !== "legacy" || owner.migrationId || owner.generation !== 0n
    || owner.phase !== "idle" || owner.attemptId || owner.runnerContainerName) throw new Error("Unmaterialized runtime has prior authority.");
  const previous = await tx.hostedRuntimeLegacyImport.findUnique({ where: { admittedUserId: owner.userId } });
  if (previous && (!previous.completedAt || previous.userId !== null || previous.generation !== 0n)) throw new Error("Legacy materialization remains unresolved.");
  return { cutover: "postgres" as const, owner: await tx.hostedRuntimeOwner.update({ where: { userId: owner.userId }, data: { migrationPhase: "postgres" } }) };
}
