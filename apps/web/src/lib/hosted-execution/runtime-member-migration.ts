import { createHash } from "node:crypto";
import type { Prisma, PrismaClient, HostedRuntimeOwner } from "@prisma/client";
import { buildHostedExecutionRuntimeControlWake } from "@murphai/hosted-execution";
import type { HostedRuntimeMemberMigrationCommand, HostedRuntimeMemberMigrationIdentity } from "@murphai/hosted-execution/runtime-migration";
import { lockHostedRuntimeMemberCutoverTx } from "./runtime-cutover";
import {
  appendHostedMailboxEnvelopeWithPreparedCryptoTx, runWithPreparedHostedMailboxItemAppendCrypto,
  type PreparedHostedMailboxItemAppendCrypto,
} from "../hosted-mailbox/store";

type Tx = Prisma.TransactionClient;
export function isMemberMigrationCommand(command: { operation: string }): command is HostedRuntimeMemberMigrationCommand {
  return ["quiesce_member", "read_member", "freeze_member", "import_member", "activate_member"].includes(command.operation);
}

/** Crypto/provider work precedes the short member transaction. Activation and
 * its ordinary maintenance wake commit together; the existing mailbox handoff
 * sweep owns lost signals. Deleted members transfer cleanup without a wake. */
export async function withMemberMigrationWake<T>(input: {
  prisma: PrismaClient; command: HostedRuntimeMemberMigrationCommand;
  run: (prepared: PreparedHostedMailboxItemAppendCrypto | null) => Promise<T>;
}): Promise<T> {
  if (input.command.operation !== "activate_member") return input.run(null);
  const owner = await input.prisma.hostedRuntimeOwner.findUnique({ where: { userId: input.command.userId } });
  const member = await input.prisma.hostedMember.findUnique({ where: { id: input.command.userId }, select: { id: true } });
  if (owner?.migrationPhase === "postgres" || !member) return input.run(null);
  return runWithPreparedHostedMailboxItemAppendCrypto({ prisma: input.prisma, userId: input.command.userId, append: input.run });
}

/** Routing observation before a local barrier. Never materialize an owner or
 * reserve the source: deletion may still complete before local admission closes. */
export async function readMemberMigrationTx(tx: Tx, command: HostedRuntimeMemberMigrationIdentity) {
  const source = await tx.hostedRuntimeLegacyImport.findUniqueOrThrow({ where: { objectId: command.objectId } });
  const owner = await tx.hostedRuntimeOwner.findUnique({ where: { userId: command.userId } });
  if (!owner || (owner.migrationPhase === "legacy" && owner.migrationId === null)) {
    if (source.userId || source.completedAt || source.lastHash) throw new Error("Member migration source is already reserved.");
    return { userId: command.userId, migrationId: null, migrationPhase: "legacy", generation: owner?.generation.toString() ?? "0" };
  }
  if (owner.migrationId !== command.migrationId || source.userId !== command.userId) throw new Error("Member migration identity changed.");
  return projectMember(owner);
}

/** Lock campaign(shared), canonical member, owner, then exact inventory row.
 * No per-member page or transition takes the campaign's exclusive lock. */
export async function lockMemberMigrationTx(tx: Tx, command: HostedRuntimeMemberMigrationCommand): Promise<HostedRuntimeOwner> {
  await lockHostedRuntimeMemberCutoverTx(tx, command.userId);
  const owner = await tx.hostedRuntimeOwner.findUniqueOrThrow({ where: { userId: command.userId } });
  await tx.$queryRaw`SELECT object_id FROM hosted_runtime_legacy_import WHERE object_id = ${command.objectId} FOR UPDATE`;
  const source = await tx.hostedRuntimeLegacyImport.findUniqueOrThrow({ where: { objectId: command.objectId } });
  if (command.operation === "quiesce_member" && owner.migrationPhase === "legacy") {
    if (owner.migrationId || owner.phase !== "idle" || owner.attemptId || owner.runnerContainerName || source.completedAt || source.lastHash
      || (source.userId !== null && source.userId !== command.userId)) throw new Error("Legacy member is not eligible for migration.");
    await tx.hostedRuntimeLegacyImport.update({ where: { objectId: command.objectId }, data: { userId: command.userId } });
    return tx.hostedRuntimeOwner.update({ where: { userId: command.userId }, data: { migrationId: command.migrationId, migrationPhase: "quiescing" } });
  }
  if (owner.migrationId !== command.migrationId || source.userId !== command.userId) throw new Error("Member migration identity changed.");
  return owner;
}

export async function transitionMemberMigrationTx(input: {
  tx: Tx; command: HostedRuntimeMemberMigrationCommand; owner: HostedRuntimeOwner;
  preparedWake: PreparedHostedMailboxItemAppendCrypto | null;
}) {
  const { tx, command, owner } = input;
  if (command.operation === "freeze_member" && owner.migrationPhase === "quiescing") {
    return projectMember(await tx.hostedRuntimeOwner.update({ where: { userId: command.userId }, data: { migrationPhase: "freezing" } }));
  }
  if (command.operation !== "activate_member") return projectMember(owner);
  if (owner.migrationPhase === "postgres") {
    const wake = await tx.hostedMailboxItem.findUnique({ where: { userId_dedupeKey: { userId: command.userId, dedupeKey: migrationWakeEventId(command) } }, select: { id: true } });
    return { ...projectMember(owner), mailboxItemId: wake?.id ?? null };
  }
  const source = await tx.hostedRuntimeLegacyImport.findUniqueOrThrow({ where: { objectId: command.objectId } });
  if (owner.migrationPhase !== "importing" || !source.completedAt || source.generation === null
    || source.generation > owner.generation || owner.phase !== "idle" || owner.attemptId || owner.runnerContainerName) {
    throw new Error("Member activation requires its complete frozen import and idle destination.");
  }
  const member = await tx.hostedMember.findUnique({ where: { id: command.userId }, select: { id: true } });
  let mailboxItemId: string | null = null;
  if (member) {
    if (!input.preparedWake) throw new Error("Member activation wake preparation is missing.");
    const wake = await appendHostedMailboxEnvelopeWithPreparedCryptoTx({ tx, prepared: input.preparedWake,
      envelope: buildHostedExecutionRuntimeControlWake({ userId: command.userId, eventId: migrationWakeEventId(command),
        kind: "runtime.maintenance-requested", occurredAt: "2026-09-15T00:00:00.000Z" }) });
    mailboxItemId = wake.item.id;
  }
  const activated = await tx.hostedRuntimeOwner.update({ where: { userId: command.userId }, data: { migrationPhase: "postgres" } });
  return { ...projectMember(activated), mailboxItemId };
}

export function migrationWakeEventId(command: HostedRuntimeMemberMigrationIdentity): string {
  return `runtime-control:migration:${createHash("sha256").update(JSON.stringify([command.namespaceId, command.objectId, command.migrationId])).digest("hex")}`;
}
function projectMember(owner: HostedRuntimeOwner) {
  return { userId: owner.userId, migrationId: owner.migrationId, migrationPhase: owner.migrationPhase, generation: owner.generation.toString() };
}
