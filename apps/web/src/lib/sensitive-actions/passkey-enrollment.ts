import "server-only";

import { createHash } from "node:crypto";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import {
  assertHostedAppSessionCurrentTx,
  type HostedAppSession,
} from "@/src/lib/hosted-onboarding/app-session";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
} from "@/src/lib/hosted-onboarding/shared";
import { resolveHostedPublicOrigin } from "@/src/lib/hosted-web/public-url";
import {
  buildSensitiveActionMessage,
  buildSettingsSensitiveActionBinding,
  consumeSensitiveActionChallengeTx,
  createSensitiveActionChallenge,
  type VerifiedSensitiveActionChallenge,
  verifySensitiveActionChallenge,
} from "./server";
import { prepareApprovalPasskeyWrite, preserveApprovalPasskeyState, readApprovalPasskeyState } from "./passkey-store";
import { isSensitiveActionToken, parseSensitiveActionAuthorization } from "./shared";
import {
  approvalPasskeyRegistrationOptions,
  verifyApprovalPasskeyRegistration,
} from "./webauthn";

import { requireApprovalPasskeyEnrollmentEnabled } from "./passkey-rollout";

interface EnrollmentInput {
  authorization: unknown;
  initialToken?: unknown;
  prisma: PrismaClient;
  session: HostedAppSession;
}

async function verifyEnrollmentAuthorization(input: EnrollmentInput) {
  requireApprovalPasskeyEnrollmentEnabled();
  if (input.initialToken !== undefined) return verifyInitialEnrollmentAuthorization(input);
  const authorization = parseSensitiveActionAuthorization(input.authorization);
  const origin = resolveHostedPublicOrigin();
  if (!authorization || !origin) {
    throw hostedOnboardingError({ code: "SENSITIVE_ACTION_AUTHORIZATION_REQUIRED", httpStatus: 403, message: "Secure approval is required to add a passkey." });
  }
  const proof = await verifySensitiveActionChallenge({
    authorization,
    bindingHash: buildSettingsSensitiveActionBinding({
      kind: "approval.passkey.enroll",
      memberId: input.session.member.id,
      sessionId: input.session.sessionId,
    }),
    kind: "approval.passkey.enroll",
    memberId: input.session.member.id,
    prisma: input.prisma,
    privyUserId: input.session.privyUserId,
  });
  return {
    proof,
    state: {
      credentials: proof.passkeys,
      encrypted: proof.credentialWrite.expectedEncrypted,
      memberId: input.session.member.id,
    },
    message: buildSensitiveActionMessage({
      bindingHash: proof.bindingHash,
      expiresAt: proof.expiresAt,
      kind: "approval.passkey.enroll",
      origin,
      token: authorization.token,
    }),
    origin,
  };
}

// Initial setup is available only to a fresh first-party principal with no
// legacy binding and no established approval credential. It cannot replace a
// factor, authorize another sensitive action, or use a silently exchanged session.
function requireInitialEnrollmentSession(session: HostedAppSession): void {
  const authenticatedAt = session.primaryAuthenticatedAt?.getTime();
  const age = typeof authenticatedAt === "number" ? Date.now() - authenticatedAt : Number.NaN;
  if (!session.authProof || session.privyUserId || !Number.isFinite(age) || age < 0 || age > 5 * 60 * 1000) {
    throw hostedOnboardingError({ code: "SENSITIVE_ACTION_FRESH_LOGIN_REQUIRED", httpStatus: 403, message: "Sign in again to set up your first passkey." });
  }
}

async function assertInitialEnrollmentIdentity(prisma: PrismaClient | Prisma.TransactionClient, memberId: string) {
  const identity = await prisma.hostedMemberIdentity.findUnique({
    where: { memberId }, select: { privyUserIdEncrypted: true },
  });
  if (!identity || identity.privyUserIdEncrypted !== null) {
    throw hostedOnboardingError({ code: "SENSITIVE_ACTION_AUTHORIZATION_REQUIRED", httpStatus: 403, message: "Use your existing secure approval to add a passkey." });
  }
}

async function readInitialEnrollmentState(input: Pick<EnrollmentInput, "prisma" | "session">) {
  requireApprovalPasskeyEnrollmentEnabled();
  requireInitialEnrollmentSession(input.session);
  await assertInitialEnrollmentIdentity(input.prisma, input.session.member.id);
  const state = await readApprovalPasskeyState({ memberId: input.session.member.id, prisma: input.prisma });
  if (state.encrypted !== null || state.credentials.length > 0) {
    throw hostedOnboardingError({ code: "SENSITIVE_ACTION_AUTHORIZATION_REQUIRED", httpStatus: 403, message: "Use your existing passkey to approve this change." });
  }
  return state;
}

export async function createInitialApprovalPasskeyRegistrationOptions(input: Pick<EnrollmentInput, "prisma" | "session">) {
  const state = await readInitialEnrollmentState(input);
  const origin = resolveHostedPublicOrigin();
  if (!origin) throw new Error("Hosted approval origin is not configured.");
  const challenge = await createSensitiveActionChallenge({
    bindingHash: buildSettingsSensitiveActionBinding({ kind: "approval.passkey.enroll", memberId: input.session.member.id, sessionId: input.session.sessionId }),
    kind: "approval.passkey.enroll", memberId: input.session.member.id, prisma: input.prisma,
  });
  const options = await approvalPasskeyRegistrationOptions({
    credentials: state.credentials, memberId: input.session.member.id, message: challenge.message, origin,
  });
  return { options, token: challenge.token };
}

async function verifyInitialEnrollmentAuthorization(input: EnrollmentInput) {
  if (input.authorization !== undefined || !isSensitiveActionToken(input.initialToken)) {
    throw hostedOnboardingError({ code: "SENSITIVE_ACTION_AUTHORIZATION_REQUIRED", httpStatus: 403, message: "Start passkey setup again." });
  }
  const state = await readInitialEnrollmentState(input);
  const token = input.initialToken;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const bindingHash = buildSettingsSensitiveActionBinding({ kind: "approval.passkey.enroll", memberId: input.session.member.id, sessionId: input.session.sessionId });
  const challenge = await input.prisma.hostedSensitiveActionChallenge.findUnique({ where: { tokenHash } });
  const origin = resolveHostedPublicOrigin();
  if (!origin || !challenge || challenge.memberId !== state.memberId || challenge.kind !== "approval.passkey.enroll"
    || challenge.bindingHash !== bindingHash || challenge.expiresAt <= new Date()) {
    throw hostedOnboardingError({ code: "SENSITIVE_ACTION_AUTHORIZATION_REQUIRED", httpStatus: 403, message: "Start passkey setup again." });
  }
  const proof: VerifiedSensitiveActionChallenge = {
    bindingHash, expiresAt: challenge.expiresAt, kind: "approval.passkey.enroll", memberId: state.memberId,
    tokenHash, passkeys: [], credentialWrite: preserveApprovalPasskeyState(state),
  };
  return { proof, state, origin, message: buildSensitiveActionMessage({ bindingHash, expiresAt: challenge.expiresAt, kind: "approval.passkey.enroll", origin, token }) };
}

export async function createApprovalPasskeyRegistrationOptions(input: EnrollmentInput) {
  const verified = await verifyEnrollmentAuthorization(input);
  return approvalPasskeyRegistrationOptions({
    credentials: verified.state.credentials,
    memberId: input.session.member.id,
    message: verified.message,
    origin: verified.origin,
  });
}

export async function registerApprovalPasskey(input: EnrollmentInput & {
  request: Request;
  response: RegistrationResponseJSON;
}): Promise<void> {
  // Existing protection requires its approved factor again at completion.
  // Initial setup instead rechecks fresh primary proof and the absent factor.
  const verified = await verifyEnrollmentAuthorization(input);
  const credential = await verifyApprovalPasskeyRegistration({
    message: verified.message,
    origin: verified.origin,
    response: input.response,
  }).catch(() => {
    throw hostedOnboardingError({ code: "SENSITIVE_ACTION_REGISTRATION_INVALID", httpStatus: 403, message: "Your passkey could not be verified. Please try again." });
  });
  if (verified.state.credentials.some(({ id }) => id === credential.id)) {
    throw hostedOnboardingError({ code: "SENSITIVE_ACTION_REGISTRATION_DUPLICATE", httpStatus: 409, message: "This passkey is already registered." });
  }
  const prepared = await prepareApprovalPasskeyWrite({
    credentials: [...verified.state.credentials, credential],
    prisma: input.prisma,
    state: verified.state,
  });
  await input.prisma.$transaction(async (prisma) => {
    await lockHostedMemberRow(prisma, input.session.member.id);
    await assertHostedAppSessionCurrentTx({
      memberId: input.session.member.id,
      prisma,
      request: input.request,
      sessionId: input.session.sessionId,
      authProof: input.session.authProof,
    });
    if (input.initialToken !== undefined) {
      requireInitialEnrollmentSession(input.session);
      await assertInitialEnrollmentIdentity(prisma, input.session.member.id);
    }
    await consumeSensitiveActionChallengeTx({
      challenge: { ...verified.proof, credentialWrite: prepared },
      prisma,
    });
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}
