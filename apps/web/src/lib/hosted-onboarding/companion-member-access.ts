import {
  HostedBillingStatus,
  type PrismaClient,
} from "@prisma/client";

import { getPrisma } from "../prisma";
import { assertHostedHistoricalLaunchConsentGranted } from "../legal/consent";
import { completeHostedPrivyVerification } from "./authentication-service";
import {
  ensureHostedStarterUsageEnrollment,
  retryPendingHostedStarterUsageActivationRuntimeWake,
} from "./starter-usage-enrollment-service";
import { assertHostedMemberNotSuspended } from "./entitlement";
import { hostedOnboardingError } from "./errors";
import {
  assertActiveHostedMemberAccessAllowed,
  readActiveHostedMemberAccess,
} from "./member-access";
import { lookupHostedMemberForPrivyPrincipal } from "./member-identity-service";
import {
  remapHostedPrivyCompletionLagError,
  type HostedPrivyIdentity,
} from "./privy";
import {
  buildHostedSignupNotificationContext,
  type HostedSignupNotificationContextV1,
} from "./signup-notification-context";
import {
  readHostedMemberMessagingSetupState,
} from "./hosted-member-store";
import {
  isHostedMemberMessagingSetupRequired,
} from "./messaging-state";
import {
  isHostedSignupNotificationEmailConfigured,
} from "./signup-notification-email-config";
import { resolveHostedPrivySessionFromBearerToken } from "./hosted-session";

/**
 * Native companion admission reuses the hosted Web lifecycle rather than
 * creating a second signup or entitlement owner. The first authenticated
 * request may create the canonical member and invite, but consent is checked
 * before Starter enrollment or Junction authority is issued.
 */
export async function requireHostedCompanionMemberIdFromRequest(input: {
  prisma?: PrismaClient;
  request: Request;
  timeZone?: string | null;
}): Promise<string> {
  const prisma = input.prisma ?? getPrisma();
  const session = await resolveHostedPrivySessionFromBearerToken(input.request);

  if (!session) {
    throw hostedOnboardingError({
      code: "AUTH_REQUIRED",
      message: "Sign in to continue.",
      httpStatus: 401,
    });
  }

  const now = new Date();
  const signupNotificationContext = isHostedSignupNotificationEmailConfigured()
    ? buildHostedSignupNotificationContext({
        headers: input.request.headers,
        occurredAt: now,
        surface: "mobile_app",
        timeZone: input.timeZone,
      })
    : undefined;
  return ensureHostedCompanionMemberId({
    identity: session.identity,
    now,
    prisma,
    ...(signupNotificationContext ? { signupNotificationContext } : {}),
    ...(input.timeZone ? { timeZone: input.timeZone } : {}),
  });
}

export async function ensureHostedCompanionMemberId(input: {
  identity: HostedPrivyIdentity;
  now?: Date;
  prisma?: PrismaClient;
  signupNotificationContext?: HostedSignupNotificationContextV1;
  timeZone?: string | null;
}): Promise<string> {
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
      const messagingState = await readHostedMemberMessagingSetupState({
        memberId: existingMember.id,
        prisma,
      });
      if (
        isHostedMemberMessagingSetupRequired({
          identity: messagingState?.identity ?? null,
          routing: messagingState?.routing ?? null,
        })
        && (input.identity.phone || input.identity.telegram)
      ) {
        // Existing active members normally stay on the read-only fast path.
        // A member whose live Privy identity now includes phone or Telegram is
        // the narrow exception: repeating canonical completion synchronizes
        // the newly linked account before readiness is projected again.
        const completion = await completeHostedPrivyVerification({
          identity: input.identity,
          now,
          prisma,
          ...(input.timeZone ? { timeZone: input.timeZone } : {}),
        }).catch((error: unknown) => {
          throw remapHostedPrivyCompletionLagError(error);
        });
        if (completion.messagingSetupRequired) {
          throw hostedOnboardingError({
            code: "PRIVY_ACCOUNT_NOT_READY",
            httpStatus: 409,
            message:
              "Your verified messaging account has not reached Murph yet. Wait a moment and try again.",
            retryable: true,
          });
        }
      }
      await requireHostedCompanionActivationRuntimeWake({
        memberId: existingMember.id,
        prisma,
      });
      return existingMember.id;
    }
  }

  const completion = await completeHostedPrivyVerification({
    identity: input.identity,
    now,
    prisma,
    ...(input.signupNotificationContext
      ? { signupNotificationContext: input.signupNotificationContext }
      : {}),
    ...(input.timeZone ? { timeZone: input.timeZone } : {}),
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
    await requireHostedCompanionActivationRuntimeWake({
      memberId: completion.memberId,
      prisma,
    });
    return completion.memberId;
  }

  // Only the untouched hosted acquisition state may enter Starter enrollment
  // here. Incomplete and lapsed billing retain their existing Web
  // recovery owners instead of being reinterpreted as a native signup.
  if (completion.member.billingStatus === HostedBillingStatus.not_started) {
    await ensureHostedStarterUsageEnrollment({
      inviteCode: completion.inviteCode,
      member: {
        id: completion.member.id,
        suspendedAt: completion.member.suspendedAt,
      },
      now,
      prisma,
      source: "companion_onboarding",
    });
  }

  await assertActiveHostedMemberAccessAllowed({
    memberId: completion.memberId,
    prisma,
  });

  return completion.memberId;
}

async function requireHostedCompanionActivationRuntimeWake(input: {
  memberId: string;
  prisma: PrismaClient;
}): Promise<void> {
  const runtimeWake =
    await retryPendingHostedStarterUsageActivationRuntimeWake(input);
  if (runtimeWake && !runtimeWake.accepted) {
    throw hostedOnboardingError({
      code: "HOSTED_STARTER_USAGE_RUNTIME_WAKE_REQUIRED",
      httpStatus: 503,
      message: "Murph account setup is waiting for runtime recovery.",
      retryable: true,
    });
  }
}
