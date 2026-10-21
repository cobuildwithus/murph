import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { hostedAuthTransactionAdapter } from "../better-auth/adapter";
import { credentialRecordOptions } from "../better-auth/credential-change";
import { prepareHostedDomainRootForWeb, revalidatePreparedHostedDomainRootForWebTx } from "../hosted-crypto/domain-root-store";
import { runWithHostedDomainRootProviderCallsDisabled } from "../hosted-crypto/domain-root-unwrap-cache";
import { assertHostedAppSessionCurrentTx, type HostedAppSession } from "../hosted-onboarding/app-session";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { decryptHostedWebNullableString, encryptHostedWebNullableString } from "../hosted-web/encryption";
import { resolveHostedPublicOrigin } from "../hosted-web/public-url";
import { readApprovalPasskeyState, prepareApprovalPasskeyWrite } from "./passkey-store";
import { requireApprovalPasskeyEnrollmentEnabled } from "./passkey-rollout";
import { isSensitiveActionToken } from "./shared";
import { buildSensitiveActionMessage, buildSettingsSensitiveActionBinding, consumeSensitiveActionChallengeTx, createSensitiveActionChallenge, verifySensitiveActionChallenge, type VerifiedSensitiveActionChallenge } from "./server";
import { approvalPasskeyRegistrationOptions, verifyApprovalPasskeyRegistration } from "./webauthn";

const RECOVERY_FIELD = "hosted-member-approval-recovery.v1";
const RECOVERY_KIND = "approval.passkey.recover";
const ROTATE_KIND = "approval.recovery-key.rotate";
type Input = { prisma: PrismaClient; request: Request; session: HostedAppSession };

function requireRecoverySession(session: HostedAppSession, fresh = false) {
  requireApprovalPasskeyEnrollmentEnabled();
  if (!session.authProof) throw freshLoginRequired();
  if (fresh) {
    const age = session.primaryAuthenticatedAt ? Date.now() - session.primaryAuthenticatedAt.getTime() : NaN;
    if (!Number.isFinite(age) || age < 0 || age > 5 * 60 * 1000) throw freshLoginRequired();
  }
}

// A key is provisioned only after a current Murph passkey approval. Existing
// provider factors must first complete their ordinary authorized enrollment.
export async function rotateApprovalRecoveryKey(input: Input & { authorization: unknown }): Promise<string> {
  requireRecoverySession(input.session);
  const { prisma, session } = input;
  const memberId = session.member.id;
  const proof = await verifySensitiveActionChallenge({
    authorization: input.authorization, bindingHash: buildSettingsSensitiveActionBinding({ kind: ROTATE_KIND, memberId, sessionId: session.sessionId }),
    kind: ROTATE_KIND, memberId, prisma,
  });
  if (proof.passkeys.length === 0) throw unavailable();
  const key = randomBytes(32).toString("base64url");
  const encrypted = await encryptHostedWebNullableString({ field: RECOVERY_FIELD, memberId, prisma, value: digest(key) });
  if (!encrypted) throw unavailable();
  const root = await prepareHostedDomainRootForWeb({ domain: "control", prepareMissing: false, prisma, userId: memberId, reason: "hosted-auth.recovery-key" });
  await prisma.$transaction((tx) => runWithHostedDomainRootProviderCallsDisabled(async () => {
    await assertHostedAppSessionCurrentTx({ memberId, prisma: tx, request: input.request, sessionId: session.sessionId, authProof: session.authProof });
    await revalidatePreparedHostedDomainRootForWebTx({ prepared: root, tx });
    await consumeSensitiveActionChallengeTx({ challenge: proof, prisma: tx });
    await tx.hostedMemberApprovalCredentials.update({ where: { memberId }, data: { recoveryHashEncrypted: encrypted } });
  }), { maxWait: 5_000, timeout: 10_000 });
  return key;
}

async function readRecoveryProof(input: Input & { key: unknown }) {
  requireRecoverySession(input.session, true);
  if (typeof input.key !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(input.key)
    || Buffer.from(input.key, "base64url").toString("base64url") !== input.key) throw unavailable();
  const memberId = input.session.member.id;
  const state = await readApprovalPasskeyState({ memberId, prisma: input.prisma });
  const row = await input.prisma.hostedMemberApprovalCredentials.findUnique({ where: { memberId } });
  if (!row?.recoveryHashEncrypted || state.encrypted !== row.credentialsEncrypted) throw unavailable();
  const hash = await decryptHostedWebNullableString({ field: RECOVERY_FIELD, memberId, prisma: input.prisma, value: row.recoveryHashEncrypted });
  if (!hash || !/^[a-f0-9]{64}$/u.test(hash) || !timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(digest(input.key), "hex"))) throw unavailable();
  const origin = resolveHostedPublicOrigin();
  if (!origin) throw new Error("Hosted approval origin is not configured.");
  const bindingHash = digest(JSON.stringify(["murph-approval-recovery-v1", memberId, input.session.sessionId, row.recoveryHashEncrypted]));
  return { bindingHash, encrypted: row.recoveryHashEncrypted, state, origin };
}

export async function createApprovalRecoveryOptions(input: Input & { key: unknown }) {
  const proof = await readRecoveryProof(input);
  const challenge = await createSensitiveActionChallenge({ bindingHash: proof.bindingHash, kind: RECOVERY_KIND, memberId: input.session.member.id, prisma: input.prisma });
  const options = await approvalPasskeyRegistrationOptions({ credentials: [], memberId: input.session.member.id, message: challenge.message, origin: proof.origin });
  return { options, token: challenge.token };
}

export async function recoverApprovalPasskey(input: Input & { key: unknown; token: unknown; response: RegistrationResponseJSON }): Promise<void> {
  const proof = await readRecoveryProof(input);
  if (!isSensitiveActionToken(input.token)) throw unavailable();
  const { prisma, session } = input;
  const memberId = session.member.id;
  const tokenHash = digest(input.token);
  const challenge = await prisma.hostedSensitiveActionChallenge.findUnique({ where: { tokenHash } });
  if (!challenge || challenge.memberId !== memberId || challenge.kind !== RECOVERY_KIND
    || challenge.bindingHash !== proof.bindingHash || challenge.expiresAt <= new Date()) throw unavailable();
  const message = buildSensitiveActionMessage({ bindingHash: proof.bindingHash, kind: RECOVERY_KIND, expiresAt: challenge.expiresAt, origin: proof.origin, token: input.token });
  const credential = await verifyApprovalPasskeyRegistration({ message, origin: proof.origin, response: input.response }).catch(() => { throw unavailable(); });
  if (proof.state.credentials.some(({ id }) => id === credential.id)) throw unavailable();
  const credentialWrite = await prepareApprovalPasskeyWrite({ credentials: [credential], prisma, state: proof.state });
  const accepted: VerifiedSensitiveActionChallenge = { ...challenge, kind: RECOVERY_KIND, credentialWrite, passkeys: [credential] };
  const root = await prepareHostedDomainRootForWeb({ domain: "control", prepareMissing: false, prisma, userId: memberId, reason: "hosted-auth.passkey-recovery" });
  const options = credentialRecordOptions(prisma);
  await prisma.$transaction((tx) => runWithHostedDomainRootProviderCallsDisabled(async () => {
    await assertHostedAppSessionCurrentTx({ memberId, prisma: tx, request: input.request, sessionId: session.sessionId, authProof: session.authProof });
    requireRecoverySession(session, true);
    await revalidatePreparedHostedDomainRootForWebTx({ prepared: root, tx });
    await consumeSensitiveActionChallengeTx({ challenge: accepted, prisma: tx });
    const consumed = await tx.hostedMemberApprovalCredentials.updateMany({
      where: { memberId, recoveryHashEncrypted: proof.encrypted }, data: { recoveryHashEncrypted: null },
    });
    if (consumed.count !== 1) throw unavailable();
    const now = new Date();
    const adapter = hostedAuthTransactionAdapter(prisma, tx, options);
    const updated = await adapter.update({ model: "user", where: [{ field: "id", value: memberId }], update: { credentialsChangedAt: now, updatedAt: now } });
    if (!updated) throw unavailable();
    await adapter.deleteMany({ model: "session", where: [{ field: "userId", value: memberId }, { field: "id", operator: "ne", value: session.sessionId }] });

  }), { maxWait: 5_000, timeout: 10_000 });
}

function digest(value: string) { return createHash("sha256").update(value).digest("hex"); }
function unavailable() { return hostedOnboardingError({ code: "APPROVAL_RECOVERY_INVALID", httpStatus: 403, message: "Recovery could not be verified. Check your saved recovery key and try again." }); }
function freshLoginRequired() { return hostedOnboardingError({ code: "SENSITIVE_ACTION_FRESH_LOGIN_REQUIRED", httpStatus: 403, message: "Sign in again before recovering your passkey." }); }
