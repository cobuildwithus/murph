import {
  HostedBillingStatus,
  type PrismaClient,
} from "@prisma/client";

import { getPrisma } from "../prisma";
import { assertHostedHistoricalLaunchConsentGranted } from "../legal/consent";
import { completeHostedPrivyVerification } from "./authentication-service";
import { ensureHostedAutoPulseTrialEnrollment } from "./auto-trial-enrollment-service";
import { assertHostedMemberNotSuspended } from "./entitlement";
import { hostedOnboardingError } from "./errors";
import type { HostedMemberCoreState } from "./hosted-member-store";
import {
  assertActiveHostedMemberAccessAllowed,
  readActiveHostedMemberAccess,
} from "./member-access";
import { lookupHostedMemberForPrivyPrincipal } from "./member-identity-service";
import {
  remapHostedPrivyCompletionLagError,
  type HostedPrivyIdentity,
} from "./privy";
import { resolveHostedPrivySessionFromBearerToken } from "./hosted-session";

/**
 * Native companion admission reuses the hosted Web lifecycle rather than
 * creating a second signup or entitlement owner. The first authenticated
 * request may create the canonical member and invite, but consent is checked
 * before trial activation or Junction authority is issued.
 */
export async function requireHostedCompanionMemberAccessFromRequest(
  request: Request,
  prisma: PrismaClient = getPrisma(),
): Promise<HostedMemberCoreState> {
  const session = await resolveHostedPrivySessionFromBearerToken(request);

  if (!session) {
    throw hostedOnboardingError({
      code: "AUTH_REQUIRED",
      message: "Sign in to continue.",
      httpStatus: 401,
    });
  }

  return ensureHostedCompanionMemberAccess({
    identity: session.identity,
    prisma,
  });
}

export async function ensureHostedCompanionMemberAccess(input: {
  identity: HostedPrivyIdentity;
  now?: Date;
  prisma?: PrismaClient;
}): Promise<HostedMemberCoreState> {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();
  const existingMember = await lookupHostedMemberForPrivyPrincipal({
    identity: input.identity,
    prisma,
  });

  if (existingMember) {
    assertHostedMemberNotSuspended(existingMember);

    if (await readActiveHostedMemberAccess({
      memberId: existingMember.id,
      prisma,
    })) {
      await assertHostedHistoricalLaunchConsentGranted({
        memberId: existingMember.id,
        prisma,
      });
      return existingMember;
    }
  }

  const completion = await completeHostedPrivyVerification({
    identity: input.identity,
    now,
    prisma,
  }).catch((error: unknown) => {
    throw remapHostedPrivyCompletionLagError(error);
  });

  await assertHostedHistoricalLaunchConsentGranted({
    memberId: completion.memberId,
    prisma,
  });

  if (await readActiveHostedMemberAccess({
    memberId: completion.memberId,
    prisma,
  })) {
    return completion.member;
  }

  // Only the untouched hosted acquisition state may enter automatic trial
  // enrollment here. Incomplete and lapsed billing retain their existing Web
  // recovery owners instead of being reinterpreted as a native signup.
  if (completion.member.billingStatus === HostedBillingStatus.not_started) {
    await ensureHostedAutoPulseTrialEnrollment({
      inviteCode: completion.inviteCode,
      member: {
        id: completion.member.id,
        suspendedAt: completion.member.suspendedAt,
      },
      now,
      prisma,
    });
  }

  await assertActiveHostedMemberAccessAllowed({
    memberId: completion.memberId,
    prisma,
  });

  return completion.member;
}
