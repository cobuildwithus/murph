import "server-only";
import { randomUUID } from "node:crypto";
import { HostedBillingStatus, type HostedAuthRecord, type Prisma, type PrismaClient } from "@prisma/client";
import { prepareHostedDomainRootForWeb, revalidatePreparedHostedDomainRootForWebTx } from "../hosted-crypto/domain-root-store";
import { createHostedMember, readHostedMemberCoreState } from "../hosted-onboarding/hosted-member-store";
import { readHostedMemberIdentity, upsertHostedMemberIdentity } from "../hosted-onboarding/hosted-member-identity-store";
import { lookupHostedMemberRoutingByTelegramUserId, readHostedMemberRoutingState, upsertHostedMemberTelegramRoutingBindingTx } from "../hosted-onboarding/hosted-member-routing-store";
import { requireHostedInviteForAuthentication } from "../hosted-onboarding/invite-service";
import { generateHostedMemberId, lockHostedMemberRow } from "../hosted-onboarding/shared";
import { assertHostedMemberNotSuspended } from "../hosted-onboarding/entitlement";
import { HostedAuthIdentityConflictError, readHostedAuthSourceSnapshot } from "./member-snapshot";
import { assertHostedAuthPristineInviteMember, type PreparedHostedAuthMember } from "./member";
import { authLookupKey, openAuthRecord, sealAuthRecord } from "./record-crypto";

type Client = PrismaClient | Prisma.TransactionClient;

export async function prepareHostedAuthTelegramMember(input: {
  telegramUserId: string; prisma: PrismaClient; inviteCode?: string;
}): Promise<PreparedHostedAuthMember> {
  const invite = input.inviteCode ? await requireHostedInviteForAuthentication(input.inviteCode, input.prisma, new Date()) : null;
  const prepared = await prepareTelegramMember(input, invite?.member.id);
  if (!invite) return prepared;
  if (invite.member.id !== prepared.memberId) throw new HostedAuthIdentityConflictError();
  return { ...prepared, commitMember: async (tx) => {
    await prepared.commitMember(tx);
    const current = await requireHostedInviteForAuthentication(input.inviteCode!, tx, new Date());
    if (current.member.id !== prepared.memberId) throw new HostedAuthIdentityConflictError();
  } };
}

async function findTelegramMember(prisma: Client, telegramUserId: string) {
  const match = await lookupHostedMemberRoutingByTelegramUserId({ prisma, telegramUserId });
  if (!match) return null;
  const routing = await readHostedMemberRoutingState({ memberId: match.core.id, prisma });
  if (routing?.telegramUserId !== telegramUserId) throw new HostedAuthIdentityConflictError();
  assertHostedMemberNotSuspended(match.core);
  return match.core;
}

async function prepareTelegramMember(input: { telegramUserId: string; prisma: PrismaClient }, invitedMemberId?: string): Promise<PreparedHostedAuthMember> {
  const { prisma, telegramUserId } = input;
  const row = await prisma.hostedAuthRecord.findFirst({ where: { model: "account", lookupKey: authLookupKey("account", "accountId", telegramUserId) } });
  if (row) return prepareOwnedTelegramLogin(row, input);
  const member = await findTelegramMember(prisma, telegramUserId);
  return prepareNewTelegramLogin(input, member?.id ?? null, member ? undefined : invitedMemberId);
}

async function prepareOwnedTelegramLogin(row: HostedAuthRecord, input: { telegramUserId: string; prisma: PrismaClient }): Promise<PreparedHostedAuthMember> {
  const { prisma } = input;
  const account = await openAuthRecord(row, prisma);
  if (account.accountId !== input.telegramUserId || typeof account.userId !== "string") throw new HostedAuthIdentityConflictError();
  const memberId = account.userId;
  const user = await prisma.hostedAuthRecord.findUnique({ where: { model_id: { model: "user", id: memberId } } });
  if (!user) throw new HostedAuthIdentityConflictError();
  await openAuthRecord(user, prisma);
  const root = await prepareHostedDomainRootForWeb({ domain: "control", prepareMissing: false, prisma, userId: memberId, reason: "hosted-auth.telegram-login" });
  return { memberId, preparedControlRoot: root, commitMember: async (tx) => {
    await lockHostedMemberRow(tx, memberId);
    const member = await readHostedMemberCoreState({ memberId, prisma: tx });
    if (!member) throw new HostedAuthIdentityConflictError();
    assertHostedMemberNotSuspended(member);
    for (const expected of [row, user]) {
      const current = await tx.hostedAuthRecord.findUnique({ where: { model_id: { model: expected.model, id: expected.id } } });
      if (JSON.stringify(current) !== JSON.stringify(expected)) throw new HostedAuthIdentityConflictError();
    }
    await revalidatePreparedHostedDomainRootForWebTx({ prepared: root, tx });
  } };
}

async function prepareNewTelegramLogin(input: { telegramUserId: string; prisma: PrismaClient }, existingId: string | null, invitedMemberId?: string): Promise<PreparedHostedAuthMember> {
  const { prisma, telegramUserId } = input;
  const memberId = existingId ?? invitedMemberId ?? generateHostedMemberId();
  if (invitedMemberId) await assertHostedAuthPristineInviteMember(prisma, memberId);
  const snapshot = await readHostedAuthSourceSnapshot(prisma, memberId);
  const identity = await readHostedMemberIdentity({ memberId, prisma });
  const root = await prepareHostedDomainRootForWeb({ domain: "control", prisma, userId: memberId, reason: "hosted-auth.telegram-signup" });
  const now = new Date();
  const user = {
    id: memberId, name: "", email: `${authLookupKey("user", "member-alias", memberId)}@auth.invalid`,
    emailVerified: false, credentialsChangedAt: now, createdAt: now, updatedAt: now,
  };
  return { memberId, preparedControlRoot: root, commitMember: async (tx) => {
    await lockHostedMemberRow(tx, memberId);
    if (invitedMemberId) await assertHostedAuthPristineInviteMember(tx, memberId);
    const current = await findTelegramMember(tx, telegramUserId);
    const owned = await tx.hostedAuthRecord.findUnique({ where: { model_id: { model: "user", id: memberId } } });
    if ((current?.id ?? null) !== existingId || owned || snapshot !== await readHostedAuthSourceSnapshot(tx, memberId)) throw new HostedAuthIdentityConflictError();
    if (!current && !invitedMemberId) await createHostedMember({ memberId, billingStatus: HostedBillingStatus.not_started, prisma: tx });
    await revalidatePreparedHostedDomainRootForWebTx({ prepared: root, tx });
    if (!identity) await upsertHostedMemberIdentity({
      memberId, maskedPhoneNumberHint: null, phoneLookupKey: null, phoneNumber: null, phoneNumberVerifiedAt: null,
      signupPhoneCodeSendAttemptId: null, signupPhoneCodeSendAttemptStartedAt: null,
      signupPhoneCodeSentAt: null, signupPhoneNumber: null, preparedControlRoot: root, prisma: tx,
    });
    await upsertHostedMemberTelegramRoutingBindingTx({ memberId, telegramUserId, prisma: tx });
    // Root preparation is outside this transaction. Revalidation above installs
    // that exact root; these local encryption calls cannot invoke a provider.
    await tx.hostedAuthRecord.create({ data: await sealAuthRecord("user", user, tx) });
    await tx.hostedAuthRecord.create({ data: await prepareTelegramAccount(tx, memberId, telegramUserId, now) });
  } };
}

function prepareTelegramAccount(prisma: Client, memberId: string, telegramUserId: string, now: Date) {
  return sealAuthRecord("account", {
    id: randomUUID(), userId: memberId, providerId: "telegram", accountId: telegramUserId, createdAt: now, updatedAt: now,
  }, prisma);
}
