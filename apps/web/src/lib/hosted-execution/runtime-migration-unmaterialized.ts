import { hasPendingRuntimeCleanupEnrollment } from "./runtime-migration-cleanup";
import { createHash } from "node:crypto";
import type { Prisma, PrismaClient, HostedRuntimeOwner } from "@prisma/client";
import { matchesHostedRuntimeMigrationRelease, type HostedRuntimeMigrationIdentity, type HostedRuntimeObjectMigrationIdentity } from "@murphai/hosted-execution/runtime-migration";
import { lockHostedRuntimeMemberCutoverTx } from "./runtime-cutover";
import { requireSelectedRuntimeObject } from "./runtime-migration-inventory";
import { appendRuntimeMigrationWakeTx, withRuntimeMigrationActivationWake } from "./runtime-member-migration";

/** Exact empty-source activation uses the same member lock and durable wake as
 * ordinary handoff. Preparation is outside the transaction; source identity is
 * revalidated inside it. No other member's disposition delays this activation.
 */
export async function activateEmptyRuntime(input: { prisma: PrismaClient; command: HostedRuntimeObjectMigrationIdentity }) {
  const source = await input.prisma.hostedRuntimeLegacyImport.findUniqueOrThrow({ where: { objectId: input.command.objectId } });
  const userId = source.admittedUserId;
  const run = (prepared: Parameters<typeof appendRuntimeMigrationWakeTx>[0]["prepared"]) => input.prisma.$transaction(async tx => {
    const gate = await requireRollingCampaignTx(tx, input.command);
    requireSelectedRuntimeObject(gate, input.command.objectId);
    if (userId) await lockHostedRuntimeMemberCutoverTx(tx, userId);
    await tx.$queryRaw`SELECT object_id FROM hosted_runtime_legacy_import WHERE object_id = ${input.command.objectId} FOR UPDATE`;
    const receipt = await tx.hostedRuntimeLegacyImport.findUniqueOrThrow({ where: { objectId: input.command.objectId } });
    if (receipt.admittedUserId !== userId) throw new Error("Empty source admission identity changed.");
    if (receipt.userId !== null || receipt.generation !== 0n || !receipt.completedAt || !receipt.lastHash || receipt.nextCursor !== null) {
      throw new Error("Empty activation requires its complete exact empty-source receipt.");
    }
    if (!userId) return { done: true, member: null };
    const bindings = await tx.hostedRuntimeLegacyImport.findMany({
      where: { OR: [{ userId }, { admittedUserId: userId }] }, take: 2, select: { objectId: true },
    });
    if (bindings.length !== 1 || bindings[0]?.objectId !== input.command.objectId) throw new Error("Empty activation has conflicting source identities.");
    const owner = await tx.hostedRuntimeOwner.findUniqueOrThrow({ where: { userId } });
    const eventId = `runtime-control:empty:${createHash("sha256").update(JSON.stringify([input.command.namespaceId, input.command.objectId])).digest("hex")}`;
    if (owner.migrationPhase === "postgres") {
      const wake = await tx.hostedMailboxItem.findUnique({ where: { userId_dedupeKey: { userId, dedupeKey: eventId } }, select: { id: true } });
      return { done: true, member: { userId, mailboxItemId: wake?.id ?? null } };
    }
    requireEmptyDestination(owner);
    const mailboxItemId = await appendRuntimeMigrationWakeTx({ tx, userId, eventId, prepared });
    await tx.hostedRuntimeOwner.update({ where: { userId }, data: { migrationPhase: "postgres" } });
    return { done: true, member: { userId, mailboxItemId } };
  }, { maxWait: 5_000, timeout: 5_000 });
  return userId ? withRuntimeMigrationActivationWake({ prisma: input.prisma, userId, run }) : run(null);
}

/** Compatibility operation for the finite operator: completion audit only.
 * Every bound source must activate its own member before selection advances.
 * A fleet scan cannot grant runtime authority or append activation wakes.
 */
export async function settleUnmaterializedRuntime(input: { prisma: PrismaClient; command: HostedRuntimeMigrationIdentity }) {
  return input.prisma.$transaction(async tx => {
    await requireRollingCampaignTx(tx, input.command);
    if (await tx.hostedRuntimeLegacyImport.findFirst({ where: { completedAt: null }, select: { objectId: true } })) {
      throw new Error("Migration completion requires every source disposition.");
    }
    const candidate = await tx.hostedRuntimeOwner.findFirst({ where: { migrationPhase: { not: "postgres" } }, select: { userId: true } });
    return { done: !candidate && !await hasPendingRuntimeCleanupEnrollment(tx) };
  }, { maxWait: 5_000, timeout: 5_000 });
}

async function requireRollingCampaignTx(tx: Prisma.TransactionClient, identity: HostedRuntimeMigrationIdentity) {
  await tx.$queryRaw`SELECT id FROM hosted_runtime_cutover WHERE id = 'runtime' FOR SHARE`;
  const gate = await tx.hostedRuntimeCutover.findUniqueOrThrow({ where: { id: "runtime" } });
  if (gate.phase !== "rolling" || gate.namespaceId !== identity.namespaceId
    || !matchesHostedRuntimeMigrationRelease(gate, identity) || !gate.creationClosedAt || !gate.inventorySealedAt) {
    throw new Error("Empty activation/completion requires a closed, sealed rolling census.");
  }
  return gate;
}

function requireEmptyDestination(owner: HostedRuntimeOwner) {
  if ((owner.migrationPhase !== "legacy" && owner.migrationPhase !== "pending") || owner.migrationId || owner.generation !== 0n || owner.phase !== "idle"
    || owner.attemptId || owner.runnerContainerName) throw new Error("Empty activation cannot replace prior runtime authority.");
}
