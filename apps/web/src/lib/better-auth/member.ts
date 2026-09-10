import "server-only";
import { HostedBillingStatus, type Prisma, type PrismaClient } from "@prisma/client";
import { prepareHostedDomainRootForWeb, revalidatePreparedHostedDomainRootForWebTx, type PreparedHostedDomainRootForWeb } from "../hosted-crypto/domain-root-store";
import { acquireHostedLinqParticipantContactLockTx, createHostedLinqParticipantContactLookupKeyReadCandidates, type HostedLinqParticipantContact } from "../hosted-onboarding/linq-participant-contact";
import { assertHostedMemberNotSuspended } from "../hosted-onboarding/entitlement";
import { createHostedMember, lookupHostedMemberByVerifiedEmailAddress, prepareHostedMemberVerifiedEmailReplyAlias, readHostedMemberCoreState, syncHostedMemberVerifiedEmailAuthorization } from "../hosted-onboarding/hosted-member-store";
import { lookupHostedMemberIdentityByPhoneNumber, readHostedMemberIdentity, upsertHostedMemberIdentity } from "../hosted-onboarding/hosted-member-identity-store";
import { readHostedMemberRoutingState } from "../hosted-onboarding/hosted-member-routing-store";
import { requireHostedInviteForAuthentication } from "../hosted-onboarding/invite-service";
import { buildHostedMemberPhoneIdentityFields } from "../hosted-onboarding/member-identity-fields";
import { generateHostedMemberId, lockHostedMemberRow } from "../hosted-onboarding/shared";
import { authLookupKey, openAuthRecord } from "./record-crypto";
import { HostedAuthIdentityConflictError, readHostedAuthSourceSnapshot } from "./member-snapshot";

type Client = PrismaClient | Prisma.TransactionClient;
export type PreparedHostedAuthMember = {
  memberId: string;
  preparedControlRoot: PreparedHostedDomainRootForWeb;
  commitMember(tx: Prisma.TransactionClient): Promise<void>;
};

async function findCanonicalMember(prisma: Client, contact: HostedLinqParticipantContact) {
  const verified = contact.kind === "email"
    ? (await lookupHostedMemberByVerifiedEmailAddress({ address: contact.value, prisma }))?.core ?? null
    : (await lookupHostedMemberIdentityByPhoneNumber({ phoneNumber: contact.value, prisma }))?.core ?? null;
  if (verified) return verified;
  // Text-first signup may have only a pending contact. OTP proof can claim its
  // exact stub, but a routing blind index alone is never login authority.
  const pending = await prisma.hostedMemberRouting.findMany({
    where: { pendingLinqParticipantContactLookupKey: { in: createHostedLinqParticipantContactLookupKeyReadCandidates(contact) } },
    select: { memberId: true }, take: 2,
  });
  if (pending.length > 1) throw new HostedAuthIdentityConflictError();
  if (!pending[0]) return null;
  const routing = await readHostedMemberRoutingState({ memberId: pending[0].memberId, prisma });
  if (routing?.pendingLinqParticipantContact?.kind !== contact.kind || routing.pendingLinqParticipantContact.value !== contact.value) {
    throw new HostedAuthIdentityConflictError();
  }
  return readHostedMemberCoreState({ memberId: pending[0].memberId, prisma });
}

export async function prepareHostedAuthOtpMember(input: {
  contact: HostedLinqParticipantContact;
  prisma: PrismaClient;
  inviteCode?: string;
}): Promise<PreparedHostedAuthMember> {
  const invite = input.inviteCode
    ? await requireHostedInviteForAuthentication(input.inviteCode, input.prisma, new Date()) : null;
  const prepared = await prepareContactMember({ ...input, invitedMemberId: invite?.member.id });
  if (!invite) return prepared;
  if (invite.member.id !== prepared.memberId) throw new HostedAuthIdentityConflictError();
  return { ...prepared, commitMember: async (tx) => {
    await prepared.commitMember(tx);
    const current = await requireHostedInviteForAuthentication(input.inviteCode!, tx, new Date());
    if (current.member.id !== prepared.memberId) throw new HostedAuthIdentityConflictError();
  } };
}

async function prepareContactMember(input: { contact: HostedLinqParticipantContact; prisma: PrismaClient; invitedMemberId?: string }): Promise<PreparedHostedAuthMember> {
  const { contact, prisma } = input;
  const selector = authLookupKey("user", contact.kind === "email" ? "email" : "phoneNumber", contact.value);
  const row = await prisma.hostedAuthRecord.findFirst({ where: {
    model: "user", ...(contact.kind === "email" ? { lookupKey: selector } : { secondaryLookupKey: selector }),
  } });
  if (row) {
    const user = await openAuthRecord(row, prisma);
    const valid = contact.kind === "email" ? user.emailVerified && user.email === contact.value
      : user.phoneNumberVerified && user.phoneNumber === contact.value;
    if (!valid) throw new HostedAuthIdentityConflictError();
    const root = await prepareHostedDomainRootForWeb({
      domain: "control", prepareMissing: false, prisma, userId: user.id, reason: "hosted-auth.login",
    });
    return { memberId: user.id, preparedControlRoot: root, commitMember: async (tx) => {
      await acquireHostedLinqParticipantContactLockTx({ contact, tx, lockTimeoutMs: 5_000 });
      await lockHostedMemberRow(tx, user.id, { timeoutMs: 5_000 });
      const member = await readHostedMemberCoreState({ memberId: user.id, prisma: tx });
      if (!member) throw new HostedAuthIdentityConflictError();
      assertHostedMemberNotSuspended(member);
      const current = await tx.hostedAuthRecord.findUnique({ where: { model_id: { model: "user", id: user.id } } });
      if (!current || JSON.stringify(current) !== JSON.stringify(row)) throw new HostedAuthIdentityConflictError();
      await openAuthRecord(current, tx);
      await revalidatePreparedHostedDomainRootForWebTx({ prepared: root, tx });
    } };
  }
  const member = await findCanonicalMember(prisma, contact);
  if (member) assertHostedMemberNotSuspended(member);
  return prepareUnclaimedLogin(prisma, contact, member?.id ?? null, member ? undefined : input.invitedMemberId);
}

export async function assertHostedAuthPristineInviteMember(prisma: Client, memberId: string): Promise<void> {
  const [member, identity, email, routing, user] = await Promise.all([
    prisma.hostedMember.findUnique({ where: { id: memberId }, select: {
      billingStatus: true, suspendedAt: true, initialOnboardingCompletedAt: true,
      identity: { select: { linqEmailHandleEncrypted: true } },
    } }),
    readHostedMemberIdentity({ memberId, prisma }),
    prisma.hostedMemberEmailAuthorization.findUnique({ where: { memberId }, select: { memberId: true } }),
    prisma.hostedMemberRouting.findUnique({ where: { memberId }, select: { memberId: true } }),
    prisma.hostedAuthRecord.findUnique({ where: { model_id: { model: "user", id: memberId } }, select: { id: true } }),
  ]);
  if (!member || member.billingStatus !== HostedBillingStatus.not_started || member.suspendedAt || member.initialOnboardingCompletedAt
    || identity?.phoneNumber || identity?.signupPhoneNumber || member.identity?.linqEmailHandleEncrypted || email || routing || user) {
    throw new HostedAuthIdentityConflictError();
  }
}

async function prepareUnclaimedLogin(prisma: PrismaClient, contact: HostedLinqParticipantContact, existingId: string | null, invitedMemberId?: string): Promise<PreparedHostedAuthMember> {
  const memberId = existingId ?? invitedMemberId ?? generateHostedMemberId();
  if (invitedMemberId) await assertHostedAuthPristineInviteMember(prisma, memberId);
  const snapshot = await readHostedAuthSourceSnapshot(prisma, memberId);
  const identity = existingId || invitedMemberId ? await readHostedMemberIdentity({ memberId, prisma }) : null;
  const root = await prepareHostedDomainRootForWeb({ domain: "control", prisma, userId: memberId, reason: "hosted-auth.signup" });
  const replyAlias = contact.kind === "email"
    ? await prepareHostedMemberVerifiedEmailReplyAlias({ address: contact.value, memberId, prisma }) : undefined;
  return { memberId, preparedControlRoot: root, commitMember: async (tx) => {
    await acquireHostedLinqParticipantContactLockTx({ contact, tx, lockTimeoutMs: 5_000 });
    await lockHostedMemberRow(tx, memberId, { timeoutMs: 5_000 });
    if (invitedMemberId) await assertHostedAuthPristineInviteMember(tx, memberId);
    const current = await findCanonicalMember(tx, contact);
    const owned = await tx.hostedAuthRecord.findUnique({ where: { model_id: { model: "user", id: memberId } } });
    if ((current?.id ?? null) !== existingId || owned || snapshot !== await readHostedAuthSourceSnapshot(tx, memberId)) {
      throw new HostedAuthIdentityConflictError();
    }
    if (current) assertHostedMemberNotSuspended(current);
    else if (!invitedMemberId) await createHostedMember({ memberId, billingStatus: HostedBillingStatus.not_started, prisma: tx });
    await revalidatePreparedHostedDomainRootForWebTx({ prepared: root, tx });
    if (contact.kind === "email") {
      if (!identity) await upsertHostedMemberIdentity({
        memberId, maskedPhoneNumberHint: null, phoneLookupKey: null, phoneNumber: null, phoneNumberVerifiedAt: null,
        signupPhoneCodeSendAttemptId: null, signupPhoneCodeSendAttemptStartedAt: null,
        signupPhoneCodeSentAt: null, signupPhoneNumber: null, preparedControlRoot: root, prisma: tx,
      });
      await syncHostedMemberVerifiedEmailAuthorization({
        memberId, address: contact.value, verifiedAt: new Date(), preparedControlRoot: root, preparedReplyAlias: replyAlias, prisma: tx,
      });
    } else {
      await upsertHostedMemberIdentity({
        ...buildHostedMemberPhoneIdentityFields(contact.value), memberId, phoneNumberVerifiedAt: new Date(),
        signupPhoneCodeSendAttemptId: identity?.signupPhoneCodeSendAttemptId ?? null,
        signupPhoneCodeSendAttemptStartedAt: identity?.signupPhoneCodeSendAttemptStartedAt ?? null,
        signupPhoneCodeSentAt: identity?.signupPhoneCodeSentAt ?? null,
        signupPhoneNumber: identity?.signupPhoneNumber ?? null, preparedControlRoot: root, prisma: tx,
      });
    }
  } };
}
