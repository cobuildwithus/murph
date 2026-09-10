import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import * as z from "@murphai/contracts/zod-runtime";
import { prepareHostedDomainRootForWeb, revalidatePreparedHostedDomainRootForWebTx } from "../hosted-crypto/domain-root-store";
import { assertHostedAppSessionCurrentTx, type HostedAppSession } from "../hosted-onboarding/app-session";
import { createHostedEmailLookupKeyReadCandidates, createHostedPhoneLookupKeyReadCandidates, createHostedTelegramUserLookupKeyReadCandidates, normalizeHostedEmailAddress } from "../hosted-onboarding/contact-privacy";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { prepareHostedMailboxItemAppendCrypto } from "../hosted-mailbox/store";
import { readActiveHostedMemberAccess } from "../hosted-onboarding/member-access";
import { enqueueHostedMemberChannelsUpdatedForActiveMemberTx } from "../hosted-onboarding/member-channel-sync";
import { readHostedMemberIdentity, upsertHostedMemberIdentity } from "../hosted-onboarding/hosted-member-identity-store";
import { readHostedMemberRoutingState, upsertHostedMemberTelegramRoutingBindingTx } from "../hosted-onboarding/hosted-member-routing-store";
import { prepareHostedMemberVerifiedEmailReplyAlias, readHostedMemberEmailAuthorization, readHostedMemberSnapshot, syncHostedMemberVerifiedEmailAuthorization } from "../hosted-onboarding/hosted-member-store";
import { acquireHostedLinqParticipantContactLockTx, createHostedLinqParticipantContact } from "../hosted-onboarding/linq-participant-contact";
import { removeHostedMemberLinkedAccountProjectionTx } from "../hosted-onboarding/linked-account-removal";
import { buildHostedMemberPhoneIdentityFields } from "../hosted-onboarding/member-identity-fields";
import { consumeSensitiveActionChallengeTx, verifySensitiveActionChallenge } from "../sensitive-actions/server";
import { hostedAuthAdapter, hostedAuthTransactionAdapter } from "./adapter";
import { hostedBetterAuthOptions } from "./auth";
import { requireHostedBetterAuthConfig } from "./config";
import { readHostedAuthSourceSnapshot } from "./migration-source";
import type { AuthRecord } from "./record";
import { authLookupKey } from "./record-crypto";

export const HOSTED_CREDENTIAL_CHANGE_KIND = "account.credential.change";
const changeSchema = z.object({
  method: z.enum(["email", "phone", "telegram"]), operation: z.enum(["set", "remove"]),
  expectedIdentity: z.string().min(1).max(320).nullable(), value: z.string().min(1).max(320).nullable(),
}).strict();
export type HostedCredentialChange = z.infer<typeof changeSchema>;
type Client = PrismaClient | Prisma.TransactionClient;

export function parseHostedCredentialChange(value: unknown): HostedCredentialChange {
  const parsed = changeSchema.safeParse(value);
  if (!parsed.success) throw invalidChange();
  const change = parsed.data;
  if ((change.operation === "set" && !change.value) || (change.operation === "remove" && (change.value !== null || !change.expectedIdentity))) throw invalidChange();
  for (const value of [change.value, change.expectedIdentity]) {
    if (value === null) continue;
    const normalized = change.method === "telegram" ? value : createHostedLinqParticipantContact({ kind: change.method, value })?.value;
    const valid = change.method === "email" ? z.string().email().safeParse(value).success && !value.endsWith("@auth.invalid")
      : change.method === "phone" ? /^\+[1-9]\d{6,14}$/u.test(value) : /^[1-9]\d{0,19}$/u.test(value);
    if (!valid || normalized !== value) throw invalidChange();
  }
  if (change.value !== null && change.value === change.expectedIdentity) throw invalidChange();
  return change;
}

export function hostedCredentialChangeBinding(input: { change: HostedCredentialChange; memberId: string; sessionId: string }): string {
  const { change } = input;
  return createHash("sha256").update(JSON.stringify([
    "murph-credential-change-v1", input.memberId, input.sessionId,
    change.operation, change.method, change.expectedIdentity, change.value,
  ])).digest("hex");
}

export async function readHostedLoginMethods(prisma: PrismaClient, memberId: string) {
  const adapter = hostedAuthAdapter(prisma)(credentialRecordOptions(prisma));
  const user = await adapter.findOne<AuthRecord>({ model: "user", where: [{ field: "id", value: memberId }] });
  if (!user) throw changedIdentity();
  const accounts = await adapter.findMany<AuthRecord>({ model: "account", where: [{ field: "userId", value: memberId }], limit: 2 });
  if (accounts.length > 1) throw changedIdentity();
  const account = accounts[0] ?? null;
  const methods = {
    email: user.emailVerified && typeof user.email === "string" ? user.email : null,
    phone: user.phoneNumberVerified && typeof user.phoneNumber === "string" ? user.phoneNumber : null,
    telegram: account && typeof account.accountId === "string" ? account.accountId : null,
  };
  return { user, account, methods };
}

export function credentialRecordOptions(prisma: PrismaClient) {
  return hostedBetterAuthOptions({ ...requireHostedBetterAuthConfig(), prisma, delivery: {
    email: async () => { throw new Error("Credential record operations cannot send codes."); },
    sms: async () => { throw new Error("Credential record operations cannot send codes."); },
  } });
}

async function readCanonicalCredentialIdentity(prisma: PrismaClient, memberId: string, methods: Awaited<ReturnType<typeof readHostedLoginMethods>>["methods"]) {
  const [identity, email, routing] = await Promise.all([
    readHostedMemberIdentity({ memberId, prisma }), readHostedMemberEmailAuthorization({ memberId, prisma }), readHostedMemberRoutingState({ memberId, prisma }),
  ]);
  if (!identity || methods.email !== (email?.verifiedEmail ? normalizeHostedEmailAddress(email.verifiedEmail.address) : null)
    || methods.phone !== (identity.phoneNumberVerifiedAt ? identity.phoneNumber : null)
    || methods.telegram !== (routing?.telegramUserId ?? null)) throw changedIdentity();
  return identity;
}

export async function prepareHostedCredentialChange(input: {
  change: HostedCredentialChange; request: Request; session: HostedAppSession; prisma: PrismaClient;
  authorization?: unknown;
}) {
  const { change, session, prisma } = input;
  const memberId = session.member.id;
  const options = credentialRecordOptions(prisma);
  if (!session.authProof) throw hostedOnboardingError({ code: "AUTH_FRESH_LOGIN_REQUIRED", httpStatus: 403, message: "Sign in again before changing your sign-in methods." });
  const current = await readHostedLoginMethods(prisma, memberId);
  const source = await readHostedAuthSourceSnapshot(prisma, memberId);
  const identity = await readCanonicalCredentialIdentity(prisma, memberId, current.methods);
  if (current.methods[change.method] !== change.expectedIdentity) throw changedIdentity();
  if (change.operation === "remove" && Object.values(current.methods).filter(Boolean).length <= 1) {
    throw hostedOnboardingError({ code: "LINKED_ACCOUNT_LAST_SIGN_IN", httpStatus: 409, message: "Add another sign-in method before removing this one." });
  }
  await assertCredentialTargetAvailable(prisma, memberId, change);
  const bindingHash = hostedCredentialChangeBinding({ change, memberId, sessionId: session.sessionId });
  const proof = input.authorization === undefined ? null : await verifySensitiveActionChallenge({
    authorization: input.authorization, bindingHash, kind: HOSTED_CREDENTIAL_CHANGE_KIND,
    memberId, prisma, privyUserId: session.privyUserId,
  });
  const root = await prepareHostedDomainRootForWeb({ domain: "control", prepareMissing: false, prisma, userId: memberId, reason: "hosted-auth.credential-change" });
  const channelCrypto = proof && await readActiveHostedMemberAccess({ memberId, prisma })
    ? await prepareHostedMailboxItemAppendCrypto({ userId: memberId, prisma }) : null;
  if (proof) await readHostedMemberSnapshot({ memberId, prisma });
  const replyAlias = change.method === "email" && change.value ? await prepareHostedMemberVerifiedEmailReplyAlias({
    address: change.value, memberId, prisma, ...(change.expectedIdentity ? { afterRemoval: true } : {}),
  }) : undefined;
  const revoked = change.expectedIdentity !== null;
  return { current, bindingHash, async lockAndRevalidate(tx: Prisma.TransactionClient) {
    const method = change.method;
    const contacts = method === "telegram" ? [] : [change.expectedIdentity, change.value]
      .flatMap((value) => { const contact = value ? createHostedLinqParticipantContact({ kind: method, value }) : null; return contact ? [contact] : []; })
      .sort((a, b) => a.lookupKey.localeCompare(b.lookupKey));
    for (const contact of contacts) await acquireHostedLinqParticipantContactLockTx({ contact, tx, lockTimeoutMs: 5_000 });
    await assertHostedAppSessionCurrentTx({ memberId, prisma: tx, request: input.request, sessionId: session.sessionId, authProof: session.authProof });
    await revalidatePreparedHostedDomainRootForWebTx({ prepared: root, tx });
    if (source !== await readHostedAuthSourceSnapshot(tx, memberId)) throw changedIdentity();
    const adapter = hostedAuthTransactionAdapter(prisma, tx, options);
    const user = await adapter.findOne<AuthRecord>({ model: "user", where: [{ field: "id", value: memberId }] });
    const accounts = await adapter.findMany<AuthRecord>({ model: "account", where: [{ field: "userId", value: memberId }], limit: 2 });
    if (JSON.stringify(user) !== JSON.stringify(current.user) || JSON.stringify(accounts) !== JSON.stringify(current.account ? [current.account] : [])) throw changedIdentity();
    await assertCredentialTargetAvailable(tx, memberId, change);
  }, async commit(tx: Prisma.TransactionClient) {
    if (!proof) throw invalidChange();
    await consumeSensitiveActionChallengeTx({ challenge: proof, prisma: tx });
    if (change.expectedIdentity) await removeHostedMemberLinkedAccountProjectionTx({
      expectedIdentity: change.expectedIdentity, memberId, method: change.method, authSource: "better-auth", prisma: tx,
    });
    const now = new Date();
    const adapter = hostedAuthTransactionAdapter(prisma, tx, options);
    if (change.method === "email" && change.value) await syncHostedMemberVerifiedEmailAuthorization({
      authSource: "better-auth", memberId, address: change.value, verifiedAt: now, preparedControlRoot: root, preparedReplyAlias: replyAlias, prisma: tx,
    });
    if (change.method === "phone" && change.value) await upsertHostedMemberIdentity({
      ...identity, ...buildHostedMemberPhoneIdentityFields(change.value), privyUserId: identity.privyUserId,
      phoneNumberVerifiedAt: now, signupPhoneCodeSendAttemptId: null, signupPhoneCodeSendAttemptStartedAt: null,
      signupPhoneCodeSentAt: null, signupPhoneNumber: null, preparedControlRoot: root, prisma: tx,
    });
    if (change.method === "telegram") {
      if (current.account) await adapter.delete({ model: "account", where: [{ field: "id", value: current.account.id }] });
      if (change.value) {
        await upsertHostedMemberTelegramRoutingBindingTx({ memberId, telegramUserId: change.value, prisma: tx });
        await adapter.create({ model: "account", data: { id: randomUUID(), userId: memberId, providerId: "telegram", accountId: change.value, createdAt: now, updatedAt: now } });
      }
    }
    const fields = change.method === "email" ? {
      email: change.value ?? `${authLookupKey("user", "member-alias", memberId)}@auth.invalid`, emailVerified: change.value !== null,
    } : change.method === "phone" ? { phoneNumber: change.value, phoneNumberVerified: change.value !== null } : {};
    const updated = await adapter.update<AuthRecord>({ model: "user", where: [{ field: "id", value: memberId }], update: {
      ...fields, updatedAt: now, credentialsChangedAt: revoked ? now : current.user.credentialsChangedAt,
    } });
    if (!updated) throw changedIdentity();
    if (revoked) {
      await adapter.deleteMany({ model: "session", where: [{ field: "userId", value: memberId }, { field: "id", operator: "ne", value: session.sessionId }] });
      await tx.hostedWebSession.updateMany({ where: { memberId, revokedAt: null }, data: { revokedAt: now, updatedAt: now, revokeReason: "credential-change" } });
    }
    if (channelCrypto) await revalidatePreparedHostedDomainRootForWebTx({ prepared: channelCrypto, tx });
    return enqueueHostedMemberChannelsUpdatedForActiveMemberTx({ memberId, occurredAt: now.toISOString(), prisma: tx, sourceType: "settings.credential.change" });
  } };
}

async function assertCredentialTargetAvailable(prisma: Client, memberId: string, change: HostedCredentialChange) {
  if (!change.value) return;
  // Blind selectors can reject a conflict; they never grant another account's
  // authority. No foreign member decryption/provider call is needed under locks.
  const keys = change.method === "email" ? createHostedEmailLookupKeyReadCandidates(change.value)
    : change.method === "phone" ? createHostedPhoneLookupKeyReadCandidates(change.value) : createHostedTelegramUserLookupKeyReadCandidates(change.value);
  const canonical = change.method === "email" ? await prisma.hostedMemberEmailAuthorization.findMany({ where: { verifiedEmailLookupKey: { in: keys } }, select: { memberId: true }, take: 2 })
    : change.method === "phone" ? await prisma.hostedMemberIdentity.findMany({ where: { phoneLookupKey: { in: keys } }, select: { memberId: true }, take: 2 })
      : await prisma.hostedMemberRouting.findMany({ where: { telegramUserLookupKey: { in: keys } }, select: { memberId: true }, take: 2 });
  const model = change.method === "telegram" ? "account" : "user";
  const key = authLookupKey(model, change.method === "telegram" ? "accountId" : change.method === "email" ? "email" : "phoneNumber", change.value);
  const projected = await prisma.hostedAuthRecord.findMany({ where: { model, ...(change.method === "phone" ? { secondaryLookupKey: key } : { lookupKey: key }) }, select: { memberId: true }, take: 2 });
  const pending = change.method === "telegram" ? [] : await prisma.hostedMemberRouting.findMany({ where: { pendingLinqParticipantContactLookupKey: { in: keys } }, select: { memberId: true }, take: 2 });
  const handles = change.method === "email" ? await prisma.hostedMemberIdentity.findMany({ where: { linqEmailHandleLookupKey: { in: keys } }, select: { memberId: true }, take: 2 }) : [];
  if ([...canonical, ...projected, ...pending, ...handles].some((row) => row.memberId !== memberId)) throw hostedOnboardingError({
    code: "AUTH_CONTACT_IN_USE", httpStatus: 409, message: "That sign-in belongs to another account. Use a different one.",
  });
}

function invalidChange() { return hostedOnboardingError({ code: "AUTH_CREDENTIAL_REQUEST_INVALID", httpStatus: 400, message: "The account change was invalid. Refresh Settings and try again." }); }
function changedIdentity() { return hostedOnboardingError({ code: "LINKED_ACCOUNT_CHANGED", httpStatus: 409, message: "Your sign-in methods changed. Refresh Settings and try again." }); }
