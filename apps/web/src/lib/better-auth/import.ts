import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { revalidatePreparedHostedDomainRootForWebTx } from "../hosted-crypto/domain-root-store";
import { runWithFreshHostedDomainRootUnwrapCache, runWithHostedDomainRootProviderCallsDisabled } from "../hosted-crypto/domain-root-unwrap-cache";
import { acquireHostedLinqParticipantContactLockTx, createHostedLinqParticipantContact } from "../hosted-onboarding/linq-participant-contact";
import { assertHostedMemberNotSuspended } from "../hosted-onboarding/entitlement";
import { assertHostedPrivyAccountDeletionNotPending } from "../hosted-onboarding/member-identity-service";
import { readHostedMemberCoreState } from "../hosted-onboarding/hosted-member-store";
import { lockHostedMemberRow } from "../hosted-onboarding/shared";
import { HostedAuthMigrationConflictError, prepareHostedAuthImport, readHostedAuthSourceSnapshot } from "./migration-source";
import { openAuthRecord, sealAuthRecord } from "./record-crypto";

export type PreparedHostedAuthImport = Extract<Awaited<ReturnType<typeof prepareHostedAuthImport>>, { kind: "prepared" }>;

export async function lockHostedAuthImportContacts(tx: Prisma.TransactionClient, prepared: PreparedHostedAuthImport): Promise<void> {
  const contacts = [
    prepared.user.emailVerified ? createHostedLinqParticipantContact({ kind: "email", value: prepared.user.email }) : null,
    prepared.user.phoneNumber ? createHostedLinqParticipantContact({ kind: "phone", value: prepared.user.phoneNumber }) : null,
  ].filter((contact) => contact !== null).sort((a, b) => a.lookupKey.localeCompare(b.lookupKey));
  for (const contact of contacts) await acquireHostedLinqParticipantContactLockTx({ contact, tx, lockTimeoutMs: 5_000 });
}

// Caller already holds the contact locks. This same guard is shared by the
// importer and just-in-time login; a stale preparation never replaces an owner.
export async function revalidateHostedAuthImportTx(tx: Prisma.TransactionClient, prepared: PreparedHostedAuthImport): Promise<"unowned" | "already_owned"> {
  await lockHostedMemberRow(tx, prepared.memberId, { timeoutMs: 5_000 });
  const member = await readHostedMemberCoreState({ memberId: prepared.memberId, prisma: tx });
  if (!member) throw new HostedAuthMigrationConflictError();
  assertHostedMemberNotSuspended(member);
  const owned = await tx.hostedAuthRecord.findUnique({ where: { model_id: { model: "user", id: prepared.memberId } } });
  if (owned) {
    await openAuthRecord(owned, tx);
    return "already_owned";
  }
  if (prepared.snapshot !== await readHostedAuthSourceSnapshot(tx, prepared.memberId)) throw new HostedAuthMigrationConflictError();
  await assertHostedPrivyAccountDeletionNotPending({ prisma: tx, privyUserId: prepared.privyUserId });
  await revalidatePreparedHostedDomainRootForWebTx({ prepared: prepared.preparedRoot, tx });
  return "unowned";
}

export async function importHostedAuthMember(input: { memberId: string; prisma: PrismaClient }): Promise<"imported" | "already_owned" | "unbound"> {
  return runWithFreshHostedDomainRootUnwrapCache(async () => {
    const prepared = await prepareHostedAuthImport(input);
    if (prepared.kind !== "prepared") return prepared.kind;
    const now = new Date();
    const user = await sealAuthRecord("user", { id: input.memberId, ...prepared.user, createdAt: now, updatedAt: now }, input.prisma);
    const account = prepared.telegramUserId ? await sealAuthRecord("account", {
      id: randomUUID(), userId: input.memberId, providerId: "telegram",
      accountId: prepared.telegramUserId, createdAt: now, updatedAt: now,
    }, input.prisma) : null;
    return input.prisma.$transaction((tx) => runWithHostedDomainRootProviderCallsDisabled(async () => {
      await lockHostedAuthImportContacts(tx, prepared);
      if (await revalidateHostedAuthImportTx(tx, prepared) === "already_owned") return "already_owned";
      await tx.hostedAuthRecord.create({ data: user });
      if (account) await tx.hostedAuthRecord.create({ data: account });
      return "imported";
    }), { maxWait: 5_000, timeout: 10_000 });
  });
}
