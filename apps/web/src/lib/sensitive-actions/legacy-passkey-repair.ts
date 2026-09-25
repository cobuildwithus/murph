import "server-only";
import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { hostedAuthTransactionAdapter } from "../better-auth/adapter";
import { prepareHostedBoundLogin } from "../better-auth/bound-reauthentication";
import { assertHostedBetterAuthIssuanceEnabled } from "../better-auth/config";
import { credentialRecordOptions } from "../better-auth/credential-change";
import { prepareHostedAuthSessionSet } from "../better-auth/session-limit";
import { runWithFreshHostedDomainRootUnwrapCache, runWithHostedDomainRootProviderCallsDisabled } from "../hosted-crypto/domain-root-unwrap-cache";
import { assertHostedAppSessionCurrentTx, type HostedAppSession } from "../hosted-onboarding/app-session";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { lockHostedMemberRow, HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "../hosted-onboarding/shared";
import { resolveHostedPublicOrigin } from "../hosted-web/public-url";
import { prepareApprovalPasskeyWrite } from "./passkey-store";
import { requireApprovalPasskeyEnrollmentEnabled } from "./passkey-rollout";
import { isSensitiveActionToken } from "./shared";
import { buildSensitiveActionMessage, consumeSensitiveActionChallengeTx, createSensitiveActionChallengeMaterial } from "./server";
import { approvalPasskeyRegistrationOptions, verifyApprovalPasskeyRegistration } from "./webauthn";

export const LEGACY_APPROVAL_REPAIR_KIND = "approval.passkey.legacy-repair";
type Input = { prisma: PrismaClient; request: Request; session: HostedAppSession };
type Client = PrismaClient | Prisma.TransactionClient;

// Any aggregate excludes repair, even when corrupt, empty or unreadable. Never
// infer a lost factor from an assertion error or a client report.
export async function isLegacyApprovalRepairEligible(prisma: Client, session: HostedAppSession): Promise<boolean> {
  const [identity, approval] = await Promise.all([
    prisma.hostedMemberIdentity.findUnique({ where: { memberId: session.member.id }, select: { privyUserIdEncrypted: true } }),
    prisma.hostedMemberApprovalCredentials.findUnique({ where: { memberId: session.member.id }, select: { memberId: true } }),
  ]);
  return Boolean(session.privyUserId && identity?.privyUserIdEncrypted && approval === null);
}

function requireFreshPrimary(session: HostedAppSession) {
  assertHostedBetterAuthIssuanceEnabled();
  requireApprovalPasskeyEnrollmentEnabled();
  const age = Date.now() - (session.primaryAuthenticatedAt?.getTime() ?? Number.NaN);
  if (!session.authProof || !Number.isFinite(age) || age < 0 || age > 5 * 60_000) {
    throw hostedOnboardingError({ code: "SENSITIVE_ACTION_FRESH_LOGIN_REQUIRED", httpStatus: 403,
      message: "Sign in again with a method already linked to this account, then add your Murph passkey." });
  }
}

async function prepareRepair(input: Input) {
  // Check the non-replaceable boundary before asking for a different factor.
  if (!await isLegacyApprovalRepairEligible(input.prisma, input.session)) throw changed();
  requireFreshPrimary(input.session);
  const bound = await prepareHostedBoundLogin(input.prisma, input.session.member.id);
  if (bound.identity.privyUserId !== input.session.privyUserId) throw changed();
  const changedAt = bound.current.user.credentialsChangedAt;
  if (changedAt instanceof Date && changedAt > input.session.primaryAuthenticatedAt!) throw changed();
  const origin = resolveHostedPublicOrigin();
  if (!origin) throw new Error("Hosted approval origin is not configured.");
  const bindingHash = digest(JSON.stringify([
    "murph-legacy-approval-repair-v1", input.session.member.id, input.session.sessionId,
    input.session.primaryAuthenticatedAt!.toISOString(), bound.fingerprint,
  ]));
  const sessions = await prepareHostedAuthSessionSet(input.prisma, input.session.member.id);
  return { bound, origin, bindingHash, sessions };
}

async function assertRepairCurrentTx(input: Input, prepared: Awaited<ReturnType<typeof prepareRepair>>, tx: Prisma.TransactionClient) {
  await lockHostedMemberRow(tx, input.session.member.id);
  await assertHostedAppSessionCurrentTx({ memberId: input.session.member.id, prisma: tx,
    request: input.request, sessionId: input.session.sessionId, authProof: input.session.authProof });
  requireFreshPrimary(input.session);
  await prepared.bound.assertCurrentTx(tx);
  await prepared.sessions.assertCurrentTx(tx);
  if (!await isLegacyApprovalRepairEligible(tx, input.session)) throw changed();
}

export async function createLegacyApprovalRepairOptions(input: Input) {
  return runWithFreshHostedDomainRootUnwrapCache(async () => {
    const prepared = await prepareRepair(input);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60_000);
    const material = createSensitiveActionChallengeMaterial({
      bindingHash: prepared.bindingHash, expiresAt, kind: LEGACY_APPROVAL_REPAIR_KIND, origin: prepared.origin,
    });
    const options = await approvalPasskeyRegistrationOptions({ credentials: [], memberId: input.session.member.id,
      message: material.response.message, origin: prepared.origin });
    await input.prisma.$transaction((tx) => runWithHostedDomainRootProviderCallsDisabled(async () => {
      await assertRepairCurrentTx(input, prepared, tx);
      // One pending repair per member; a new attempt supersedes abandoned setup.
      await tx.hostedSensitiveActionChallenge.deleteMany({ where: { memberId: input.session.member.id, kind: LEGACY_APPROVAL_REPAIR_KIND } });
      await tx.hostedSensitiveActionChallenge.create({ data: {
        bindingHash: prepared.bindingHash, createdAt: now, expiresAt, kind: LEGACY_APPROVAL_REPAIR_KIND,
        memberId: input.session.member.id, tokenHash: material.tokenHash,
      } });
    }), HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
    return { options, token: material.response.token };
  });
}

export async function registerLegacyApprovalRepair(input: Input & { token: unknown; response: RegistrationResponseJSON }): Promise<void> {
  return runWithFreshHostedDomainRootUnwrapCache(async () => {
    const prepared = await prepareRepair(input);
    if (!isSensitiveActionToken(input.token)) throw changed();
    const tokenHash = digest(input.token);
    const challenge = await input.prisma.hostedSensitiveActionChallenge.findUnique({ where: { tokenHash } });
    if (!challenge || challenge.memberId !== input.session.member.id || challenge.kind !== LEGACY_APPROVAL_REPAIR_KIND
      || challenge.bindingHash !== prepared.bindingHash || challenge.expiresAt <= new Date()) throw changed();
    const message = buildSensitiveActionMessage({ bindingHash: prepared.bindingHash, kind: LEGACY_APPROVAL_REPAIR_KIND,
      expiresAt: challenge.expiresAt, origin: prepared.origin, token: input.token });
    const credential = await verifyApprovalPasskeyRegistration({ message, origin: prepared.origin, response: input.response })
      .catch(() => { throw hostedOnboardingError({ code: "SENSITIVE_ACTION_REGISTRATION_INVALID", httpStatus: 403,
        message: "Your passkey could not be verified. Please try again." }); });
    const memberId = input.session.member.id;
    const credentialWrite = await prepareApprovalPasskeyWrite({ credentials: [credential], prisma: input.prisma,
      state: { memberId, credentials: [], encrypted: null } });
    const options = credentialRecordOptions(input.prisma);
    await input.prisma.$transaction((tx) => runWithHostedDomainRootProviderCallsDisabled(async () => {
      await assertRepairCurrentTx(input, prepared, tx);
      await consumeSensitiveActionChallengeTx({ prisma: tx, challenge: {
        ...challenge, kind: LEGACY_APPROVAL_REPAIR_KIND, credentialWrite, passkeys: [credential],
      } });
      // Keep this freshly proved browser session. Fence native/legacy exchange
      // and revoke other sessions using the same owners as saved-key recovery.
      const now = new Date();
      const adapter = hostedAuthTransactionAdapter(input.prisma, tx, options);
      const updated = await adapter.update({ model: "user", where: [{ field: "id", value: memberId }],
        update: { credentialsChangedAt: now, updatedAt: now } });
      if (!updated) throw changed();
      await adapter.deleteMany({ model: "session", where: [
        { field: "userId", value: memberId }, { field: "id", operator: "ne", value: input.session.sessionId },
      ] });
      await tx.hostedWebSession.updateMany({ where: { memberId, revokedAt: null },
        data: { revokedAt: now, updatedAt: now, revokeReason: "legacy-approval-repair" } });
    }), HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
  });
}

function digest(value: string) { return createHash("sha256").update(value).digest("hex"); }
function changed() { return hostedOnboardingError({ code: "SENSITIVE_ACTION_CREDENTIALS_CHANGED", httpStatus: 409,
  message: "Passkey setup changed or expired. Try again; an existing Murph passkey cannot be replaced this way." }); }
