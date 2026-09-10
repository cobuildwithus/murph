import "server-only";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import type { PrismaClient } from "@prisma/client";
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
  verifySensitiveActionChallenge,
} from "./server";
import { prepareApprovalPasskeyWrite } from "./passkey-store";
import { parseSensitiveActionAuthorization } from "./shared";
import {
  approvalPasskeyRegistrationOptions,
  verifyApprovalPasskeyRegistration,
} from "./webauthn";

import { requireApprovalPasskeyEnrollmentEnabled } from "./passkey-rollout";

interface EnrollmentInput {
  authorization: unknown;
  prisma: PrismaClient;
  session: HostedAppSession;
}

async function verifyEnrollmentAuthorization(input: EnrollmentInput) {
  requireApprovalPasskeyEnrollmentEnabled();
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
  // The same approved factor is required again at completion. No enrollment
  // session, separate permit service or primary-login shortcut is introduced.
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
    await consumeSensitiveActionChallengeTx({
      challenge: { ...verified.proof, credentialWrite: prepared },
      prisma,
    });
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}
