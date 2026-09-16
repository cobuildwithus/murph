import { listUnenrolledRuntimeMembersTx } from "./runtime-migration-enrollment";
import type { HostedRuntimeCutover, Prisma, PrismaClient } from "@prisma/client";
import { matchesHostedRuntimeMigrationRelease, type HostedRuntimeMigrationIdentity } from "@murphai/hosted-execution/runtime-migration";
import { readHostedAccountCleanupRuntimePage, retainHostedAccountCleanupRuntimePageTx } from "../hosted-privacy/account-deletion-cleanup";

/** One ciphertext and at most 100 retained identities per request. Decrypt
 * before taking the campaign/receipt locks; repeat its identity check inside
 * the command transaction before committing the prepared projection.
 */
export async function prepareRuntimeCleanupEnrollment(prisma: PrismaClient, identity: HostedRuntimeMigrationIdentity) {
  const gate = await prisma.hostedRuntimeCutover.findUniqueOrThrow({ where: { id: "runtime" } });
  requireCleanupEnrollmentCampaign(gate, identity);
  const cleanup = await prisma.hostedAccountDeletionCleanup.findFirst({
    where: { runtimeMigrationNextIndex: { not: null } },
    orderBy: [{ runtimeMigrationNextIndex: "asc" }, { id: "asc" }],
    select: { id: true, environment: true, kmsKeyName: true, payloadCiphertext: true, runtimeMigrationNextIndex: true },
  });
  if (!cleanup || cleanup.runtimeMigrationNextIndex === null) return null;
  const page = await readHostedAccountCleanupRuntimePage({ cleanup, after: cleanup.runtimeMigrationNextIndex, signal: AbortSignal.timeout(5_000) });
  return { cleanup, ...page };
}

export const retainRuntimeCleanupEnrollmentTx = retainHostedAccountCleanupRuntimePageTx;

export async function hasPendingRuntimeCleanupEnrollment(tx: Prisma.TransactionClient) {
  return await tx.hostedAccountDeletionCleanup.findFirst({ where: { runtimeMigrationNextIndex: { not: null } }, select: { id: true } }) !== null;
}

/** Existing census entrypoint also drains the encrypted historical owner. An
 * empty duplicate-only page is not exhaustion while another receipt/page waits.
 */
export async function listRuntimeMigrationCandidates(prisma: PrismaClient, identity: HostedRuntimeMigrationIdentity) {
  const prepared = await prepareRuntimeCleanupEnrollment(prisma, identity);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM hosted_runtime_cutover WHERE id = 'runtime' FOR SHARE`;
    const gate = await tx.hostedRuntimeCutover.findUniqueOrThrow({ where: { id: "runtime" } });
    requireCleanupEnrollmentCampaign(gate, identity);
    await retainRuntimeCleanupEnrollmentTx(tx, prepared);
    const candidates = await listUnenrolledRuntimeMembersTx(tx, gate);
    return { ...candidates, ...(await hasPendingRuntimeCleanupEnrollment(tx) ? { cleanupPending: true } : {}) };
  }, { maxWait: 5_000, timeout: 5_000 });
}

function requireCleanupEnrollmentCampaign(gate: HostedRuntimeCutover, identity: HostedRuntimeMigrationIdentity) {
  if (gate.phase !== "rolling" || gate.namespaceId !== identity.namespaceId || !matchesHostedRuntimeMigrationRelease(gate, identity)) {
    throw new Error("Cleanup enrollment requires the compatible rolling campaign.");
  }
}
